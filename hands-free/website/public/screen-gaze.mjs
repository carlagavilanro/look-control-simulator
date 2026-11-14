import {sameCameraGeometry} from './screen-camera.mjs';
// Local webcam estimates, not gaze coordinates supplied by MediaPipe.
export const TRAIN_TARGETS = [[.5,.5],[.07,.07],[.5,.07],[.93,.07],[.93,.5],[.93,.93],[.5,.93],[.07,.93],[.07,.5],[.28,.28],[.72,.28],[.72,.72],[.28,.72]];
// Different locations and later samples: never used to fit or choose the model.
export const CHECK_TARGETS = [[.17,.18],[.83,.18],[.17,.82],[.83,.82],[.35,.53],[.65,.47],[.5,.22]];
export const ALIGN_TARGETS = [[.5,.5],[.15,.18],[.85,.82],[.85,.18],[.15,.82]];
// Fresh anchors for regional error correction, distinct from the seven checks.
export const REFINE_TARGETS = [[.5,.5],[.12,.12],[.88,.88],[.88,.12],[.12,.88],[.5,.12],[.5,.88],[.12,.5],[.88,.5]];
export function calibrationTargets(dense=false){
 // Alternate screen regions so gradual drift is less confounded with a
 // top-to-bottom sweep. Keep the center revisits as separate observations.
 const order=[12,0,24,4,20,2,22,10,14,6,18,8,16,1,23,3,21,5,19,9,15,7,17,11,13];
 const locations=dense?order.map(i=>[.07+(i%5)*.215,.07+Math.floor(i/5)*.215]):TRAIN_TARGETS;
 // Revisit the center at different times. These are drift observations, not
 // independent targets for cross-validation.
 const halfway=Math.ceil(locations.length/2);
 return [...locations.slice(0,halfway),[.5,.5],...locations.slice(halfway),[.5,.5]];
}
export const quantile = (a,q=.5) => {if(!a.length)return Infinity;const s=[...a].sort((x,y)=>x-y),i=(s.length-1)*q;return s[Math.floor(i)]+(s[Math.ceil(i)]-s[Math.floor(i)])*(i%1);};
export const median = a => quantile(a,.5);
const finite = a => a.every(Number.isFinite);
const core=['h','v','x','y','scale','roll'];
const eyes=['lh','lv','rh','rv'];
const pose=['yaw','pitch'];
const validFeature=f=>!!f&&core.every(k=>Number.isFinite(f[k]))&&f.scale>0;
// Head alignment must keep working through a blink or unclear iris reading.
// These are the same face coordinates used by the saved gaze maps.
export function screenHeadFeature(p,aspect=4/3){
 if(!p||!Number.isFinite(aspect)||aspect<=0||[1,33,263].some(i=>!p[i]||!finite([p[i].x,p[i].y])))return null;
 const left={x:p[33].x*aspect,y:p[33].y},right={x:p[263].x*aspect,y:p[263].y},nose={x:p[1].x*aspect,y:p[1].y};
 const dx=right.x-left.x,dy=right.y-left.y,w=dx*dx+dy*dy;
 if(w<=1e-8)return null;
 const head={x:p[1].x,y:p[1].y,scale:Math.sqrt(w),roll:Math.atan2(dy,dx),yaw:((nose.x-left.x)*dx+(nose.y-left.y)*dy)/w,pitch:(-(nose.x-left.x)*dy+(nose.y-left.y)*dx)/w};
 return finite(Object.values(head))?head:null;
}
export function screenFeature(p, aspect=4/3, imageHeight=720, diagnostics=null) {
  const reject=reason=>{if(diagnostics)diagnostics.reason=reason;return null;};
  if(diagnostics){diagnostics.reason='usable';diagnostics.eyePixels=[];diagnostics.openings=[];}
  if (!p || p.length<478 || !finite([aspect,imageHeight]) || aspect<=0 || imageHeight<=0) return reject('no-face');
  const ids=[1,33,133,468,469,470,471,472,159,145,362,263,473,474,475,476,477,386,374];
  if(ids.some(i=>!p[i]||!finite([p[i].x,p[i].y])))return reject('landmarks');
  const point=i=>({x:p[i].x*aspect,y:p[i].y});
  function eye(a,b,iris,top,bottom) {
    if(p[a].x>p[b].x) [a,b]=[b,a];
    const l=point(a),r=point(b),c=point(iris),t=point(top),d=point(bottom);
    const dx=r.x-l.x,dy=r.y-l.y,w=dx*dx+dy*dy,width=Math.sqrt(w);
    if(diagnostics)diagnostics.eyePixels.push(Math.round(width*imageHeight));
    if(width*imageHeight<18)return reject('too-small'); // Insufficient camera detail; screen size cannot recover it.
    const opening=Math.hypot(t.x-d.x,t.y-d.y)/width;
    if(diagnostics)diagnostics.openings.push(Math.round(opening*1000)/1000);
    const ring=[1,2,3,4].map(k=>point(iris+k));
    const ringCenter={x:median(ring.map(q=>q.x)),y:median(ring.map(q=>q.y))};
    const diameter=2*median(ring.map(q=>Math.hypot(q.x-c.x,q.y-c.y)));
    if(diameter*imageHeight<2.5||diameter/width<.09||diameter/width>.65||Math.max(...ring.map(q=>Math.hypot(q.x-c.x,q.y-c.y)))/width>.4||Math.hypot(c.x-ringCenter.x,c.y-ringCenter.y)/width>.08)return reject('iris');
    const x=((c.x-l.x)*dx+(c.y-l.y)*dy)/w;
    const y=(-(c.x-(l.x+r.x)/2)*dy+(c.y-(l.y+r.y)/2)*dx)/w;
    if(!finite([x,y,opening]))return reject('landmarks');
    if(opening<=.14)return reject('closed-eye');
    if(x<=.04||x>=.96)return reject('eye-edge');
    return {x,y};
  }
  const a=eye(33,133,468,159,145),b=eye(362,263,473,386,374);
  if(!a||!b)return null;
  if(Math.abs(a.x-b.x)>.20||Math.abs(a.y-b.y)>.12)return reject('disagreement');
  const head=screenHeadFeature(p,aspect);if(!head)return reject('landmarks');
  const f={h:(a.x+b.x)/2,v:(a.y+b.y)/2,lh:a.x,lv:a.y,rh:b.x,rv:b.y,...head};
  return finite(Object.values(f))?f:null;
}
export function summarize(samples) {
  const usable=samples.filter(validFeature);
  if(usable.length<16||usable.length<samples.length*.8)throw Error('Not enough clear eye samples. Check the light and camera position.');
  const fields=[...core,...eyes.filter(k=>usable.every(f=>Number.isFinite(f[k]))),...pose.filter(k=>usable.every(f=>Number.isFinite(f[k])))];
  const center=Object.fromEntries(fields.map(k=>[k,median(usable.map(f=>f[k]))]));
  const mad=Object.fromEntries(['h','v'].map(k=>[k,median(usable.map(f=>Math.abs(f[k]-center[k])))]));
  if(mad.h>.025||mad.v>.018)throw Error('Eye samples moved too much. Please try that point again.');
  const headFields=fields.filter(k=>!['h','v',...eyes].includes(k));
  const floors={x:.003,y:.003,scale:.005,roll:.015,yaw:.01,pitch:.01};
  const headSpread=Object.fromEntries(headFields.map(k=>[k,Math.max(floors[k],4*median(usable.map(f=>Math.abs(f[k]-center[k]))))]));
  const kept=usable.filter(f=>Math.abs(f.h-center.h)<=Math.max(.0015,4*mad.h)&&Math.abs(f.v-center.v)<=Math.max(.001,4*mad.v)&&headFields.every(k=>Math.abs(f[k]-center[k])<=headSpread[k]));
  if(kept.length<16||kept.length<usable.length*.7)throw Error('Eye samples were inconsistent. Please try that point again.');
  return Object.fromEntries(fields.map(k=>[k,median(kept.map(f=>f[k]))]));
}
export function settledSummary(samples){
 const summary=summarize(samples),usable=samples.filter(validFeature),half=Math.floor(usable.length/2);
 for(const [key,limit] of [['h',.008],['v',.005]]){
  if(Math.abs(median(usable.slice(0,half).map(f=>f[key]))-median(usable.slice(half).map(f=>f[key])))>limit)
   throw Error('Your gaze is still settling. Keep looking at this dot.');
 }
 for(const [key,limit] of [['x',.0125],['y',.0125],['roll',.03],['yaw',.025],['pitch',.025]]){
  if(usable.every(f=>Number.isFinite(f[key]))&&Math.abs(median(usable.slice(0,half).map(f=>f[key]))-median(usable.slice(half).map(f=>f[key])))>limit)
   throw Error('Your head is still moving. Keep a comfortable position while this dot is measured.');
 }
 return summary;
}
function solve(matrix,vector){
  const a=matrix.map((r,i)=>[...r,vector[i]]),n=a.length;
  for(let i=0;i<n;i++){
    let p=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[p][i]))p=j;
    [a[i],a[p]]=[a[p],a[i]];
    if(Math.abs(a[i][i])<1e-10)throw Error('Calibration is not distinct enough.');
    const d=a[i][i];for(let j=i;j<=n;j++)a[i][j]/=d;
    for(let k=0;k<n;k++)if(k!==i){const f=a[k][i];for(let j=i;j<=n;j++)a[k][j]-=f*a[i][j];}
  }return a.map(r=>r[n]);
}
function fused(f,leftWeight){return eyes.every(k=>Number.isFinite(f[k]))?[leftWeight*f.lh+(1-leftWeight)*f.rh,leftWeight*f.lv+(1-leftWeight)*f.rv]:[f.h,f.v];}
const POSE_FIELDS=['x','y','scale','roll','yaw','pitch'];
const POSE_SCALES=[.05,.05,.05,.12,.07,.07];
function correctedEyes(f,m){
 const xy=fused(f,m.leftWeight),c=m.poseCorrection;if(!c)return xy;
 const delta=c.indices.map((index,i)=>(f[POSE_FIELDS[index]]-c.reference[i])/POSE_SCALES[index]);
 return xy.map((v,axis)=>v-c.weights[axis].reduce((sum,w,i)=>sum+w*delta[i],0));
}
const RICH_FIELDS=[...eyes,...POSE_FIELDS];
function basis(f,m){
 if(m.version===4)return [1,...m.featureIndices.map((index,i)=>(f[RICH_FIELDS[index]]-m.featureCenters[i])/m.featureScales[i])];
 const xy=correctedEyes(f,m),h=(xy[0]-m.center[0])/m.spread[0],v=(xy[1]-m.center[1])/m.spread[1];return m.degree===1?[1,h,v]:[1,h,v,h*v,h*h,v*v];
}
const targetKey=g=>g.target.map(v=>v.toFixed(5)).join(',');
// Equal-location, held-out scoring. A good average must not conceal a poor
// screen side. This ranks maps only; independent accuracy checks never train it.
export function balancedCalibrationScore(errors,targets){
 const rms=a=>Math.sqrt(a.reduce((s,e)=>s+e*e,0)/a.length);
 const overall=rms(errors),sides=[errors.filter((_,i)=>targets[i][0]<.45),errors.filter((_,i)=>targets[i][0]>.55)].filter(a=>a.length);
 return .7*overall+.3*Math.max(overall,...sides.map(rms));
}
export function horizontalAccuracy(perTarget){
 const side=items=>{
  const finiteItems=items.filter(p=>Number.isFinite(p.p90Pixels));
  return {p90Pixels:finiteItems.length?Math.round(finiteItems.reduce((s,p)=>s+p.p90Pixels,0)/finiteItems.length):null,
   offsetX:finiteItems.length?Math.round(median(finiteItems.map(p=>p.offsetX))):null,
   usable:items.length?Math.round(items.reduce((s,p)=>s+p.validFraction,0)/items.length*100):0};
 };
 const left=side(perTarget.filter(p=>p.x<.45)),right=side(perTarget.filter(p=>p.x>.55));
 const text=`Screen sides Â· average per-target 90% error: left ${left.p90Pixels??'unavailable'} px / right ${right.p90Pixels??'unavailable'} px. Usable: ${left.usable}% / ${right.usable}%.`;
 return {left,right};
}

const rowWeight=(g,rows)=>1/rows.filter(r=>targetKey(r)===targetKey(g)).length;
function fitRich(rows,lambda){
 const m=fit(rows,1,.5,.02);m.version=4;m.binocular=true;m.lambda=lambda;
 // Head position can correlate with targets during calibration without
 // predicting gaze afterward. Do not use it as a substitute for eye features.
 // Version 3 still estimates compensation from WITHIN-target movements only.
 // Older version-4 maps with pose inputs remain readable for five-point repair.
 m.featureIndices=[0,1,2,3];
 m.featureCenters=m.featureIndices.map(i=>median(rows.map(g=>g.feature[RICH_FIELDS[i]])));
 m.featureScales=m.featureIndices.map((index,i)=>index<4?Math.max(index%2?.009:.0225,(Math.max(...rows.map(g=>g.feature[RICH_FIELDS[index]]))-Math.min(...rows.map(g=>g.feature[RICH_FIELDS[index]])))/2):POSE_SCALES[index-4]);
 const n=m.featureIndices.length+1,a=Array.from({length:n},()=>Array(n).fill(0)),b=[Array(n).fill(0),Array(n).fill(0)];
 for(const g of rows){
  const samples=g.samples.filter(f=>Math.abs(f.h-g.feature.h)<.05&&Math.abs(f.v-g.feature.v)<.035),weight=rowWeight(g,rows)/samples.length;
  for(const f of samples){const v=basis(f,m);for(let i=0;i<n;i++){for(let j=0;j<n;j++)a[i][j]+=weight*v[i]*v[j];for(let axis=0;axis<2;axis++)b[axis][i]+=weight*v[i]*g.target[axis];}}
 }
 for(let i=1;i<n;i++)a[i][i]+=lambda*(m.featureIndices[i-1]>=4?3:1);
 m.weights=b.map(v=>solve(a,v));return m;
}
function fitPoseCorrection(rows,leftWeight){
 // Estimate head-induced iris motion only WITHIN a fixed target. Differences
 // between screen targets must not be mistaken for head-motion compensation.
 const indices=POSE_FIELDS.flatMap((key,i)=>rows.every(g=>Number.isFinite(g.feature[key])&&g.samples.every(f=>Number.isFinite(f[key])))?[i]:[]);
 const reference=indices.map(i=>median(rows.map(g=>g.feature[POSE_FIELDS[i]]))),n=indices.length;
 const a=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?.02:0)),b=[Array(n).fill(0),Array(n).fill(0)];
 for(const g of rows){
  const center=fused(g.feature,leftWeight),dh=median(g.samples.map(f=>Math.abs(f.h-g.feature.h))),dv=median(g.samples.map(f=>Math.abs(f.v-g.feature.v)));
  const samples=g.samples.filter(f=>Math.abs(f.h-g.feature.h)<=Math.max(.0015,4*dh)&&Math.abs(f.v-g.feature.v)<=Math.max(.001,4*dv)),weight=rowWeight(g,rows)/samples.length;
  for(const f of samples){
   const p=indices.map(i=>(f[POSE_FIELDS[i]]-g.feature[POSE_FIELDS[i]])/POSE_SCALES[i]),eye=fused(f,leftWeight);
   for(let i=0;i<n;i++){for(let j=0;j<n;j++)a[i][j]+=p[i]*p[j]*weight;for(let axis=0;axis<2;axis++)b[axis][i]+=p[i]*(eye[axis]-center[axis])*weight;}
  }
 }
 return {indices,reference,weights:b.map(v=>solve(a,v))};
}
function fit(rows,degree,leftWeight,lambda,motion=false){
  const poseCorrection=motion?fitPoseCorrection(rows,leftWeight):undefined;
  const xy=rows.map(g=>correctedEyes(g.feature,{leftWeight,poseCorrection}));
  const model={version:motion?3:2,degree,leftWeight,lambda,binocular:rows.every(g=>eyes.every(k=>Number.isFinite(g.feature[k]))),
    center:[0,1].map(i=>median(xy.map(p=>p[i]))),spread:[0,1].map(i=>(Math.max(...xy.map(p=>p[i]))-Math.min(...xy.map(p=>p[i])))/2),
    head:Object.fromEntries([...core.slice(2),...pose.filter(k=>rows.every(g=>Number.isFinite(g.feature[k])))].map(k=>[k,median(rows.map(g=>g.feature[k]))]))};
  if(poseCorrection)model.poseCorrection=poseCorrection;
  if(model.spread[0]<.0225||model.spread[1]<.009)throw Error('Eye movement is not distinct enough in both directions. Adjust the camera and retry.');
  // Fit the observed spread at each target as well as its median. A map fit
  // only to medians can amplify small iris errors into large screen movements.
  // Give each target the same total weight regardless of its frame count.
  const observations=rows.flatMap(g=>{
   const samples=g.samples.filter(f=>Math.abs(f.h-g.feature.h)<.05&&Math.abs(f.v-g.feature.v)<.035);
   return samples.map(f=>({feature:f,target:g.target,weight:rowWeight(g,rows)/samples.length}));
  });
  const b=observations.map(g=>basis(g.feature,model)),n=b[0].length,weights=observations.map(g=>g.weight);
  const a=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>b.reduce((s,r,k)=>s+weights[k]*r[i]*r[j],0)+(i===j&&i!==0?lambda:0)));
  model.weights=[0,1].map(axis=>solve(a,Array.from({length:n},(_,i)=>b.reduce((s,r,j)=>s+weights[j]*r[i]*observations[j].target[axis],0))));
  return model;
}
function estimate(f,m){
 const b=basis(f,m);let xy=m.weights.map(w=>w.reduce((s,v,i)=>s+v*b[i],0));
 if(m.alignment)xy=m.alignment.weights.map(w=>w[0]+w[1]*xy[0]+w[2]*xy[1]);
 if(m.refinement)xy=regionalEstimate(xy,m.refinement);
 if(m.offset)xy=xy.map((v,i)=>v+m.offset[i]);
 return {x:xy[0],y:xy[1]};
}
function regionalEstimate(xy,r){
 const k=r.centers.map(c=>Math.exp(-((xy[0]-c[0])**2+(xy[1]-c[1])**2)/(2*r.radius*r.radius)));
 return xy.map((value,axis)=>value+k.reduce((sum,v,i)=>sum+v*r.weights[axis][i],0));
}
function fitRegional(rows,base,radius,lambda){
 // Regularized Gaussian RBF correction to an existing map. Each coefficient
 // describes a screen-space residual, not a raw eye sample. Check samples are
 // never available here. Gaussian kernel + ridge: SciPy RBFInterpolator notes.
 const model={...base};delete model.refinement;
 const unique=[...new Set(rows.map(targetKey))].map(key=>{
  const group=rows.filter(g=>targetKey(g)===key),p=group.map(g=>estimate(g.feature,model));
  return {center:[median(p.map(v=>v.x)),median(p.map(v=>v.y))],target:group[0].target};
 });
 if(unique.length<8)throw Error('More regional anchors are needed.');
 const centers=unique.map(g=>g.center),matrix=centers.map((a,i)=>centers.map((b,j)=>Math.exp(-((a[0]-b[0])**2+(a[1]-b[1])**2)/(2*radius*radius))+(i===j?lambda:0)));
 const weights=[0,1].map(axis=>solve(matrix,unique.map(g=>g.target[axis]-g.center[axis])));
 if(weights.some(w=>!finite(w)||w.some(v=>Math.abs(v)>2)))throw Error('Regional correction is unstable.');
 const refinement={centers,weights,radius,lambda};
 // Reject folds and excessive amplification in the screen region. Never clip
 // final predictions to the display: off-screen errors must remain measurable.
 for(let ix=0;ix<=8;ix++)for(let iy=0;iy<=8;iy++){
  const p=[ix/8,iy/8],q=regionalEstimate(p,refinement),qx=regionalEstimate([p[0]+.001,p[1]],refinement),qy=regionalEstimate([p[0],p[1]+.001],refinement);
  const a=(qx[0]-q[0])/.001,b=(qy[0]-q[0])/.001,c=(qx[1]-q[1])/.001,d=(qy[1]-q[1])/.001;
  if(Math.hypot(q[0]-p[0],q[1]-p[1])>.3||a<.25||d<.25||a*d-b*c<.2||Math.max(Math.abs(a),Math.abs(b),Math.abs(c),Math.abs(d))>2.5)throw Error('Regional correction would distort the map.');
 }
 return {...model,refinement};
}
function calibrationError(message,details){return Object.assign(new Error(message),{calibration:details});}
function referenceAnchors(rows){
 // Only numerical target/feature summaries are retained, never camera frames.
 return rows.map(g=>({target:[...g.target],feature:{...g.feature}}));
}

export function fitHeadCompensation(entries,{baselinePredictor=null}={}){
 // Compare equal screen targets across head positions. This isolates how head
 // movement changes iris measurements without treating a head turn as gaze.
 const positioned=entries.filter(e=>Array.isArray(e.model.anchors)&&e.model.anchors.length>=5);
 if(positioned.length<2)return null;
 const rows=positioned.flatMap(e=>e.model.anchors.map(g=>({...g,position:e.id,samples:[g.feature]})));
 if(rows.some(g=>!validFeature(g.feature)||!Array.isArray(g.target)||g.target.length!==2||!finite(g.target)))return null;
 const keys=[...new Set(rows.map(targetKey))];
 const common=keys.filter(key=>new Set(rows.filter(g=>targetKey(g)===key).map(g=>g.position)).size>=2);
 if(common.length<4)return null;
 const factory=(rs,degree,weight,lambda)=>{
  const repeated=[...new Set(rs.map(targetKey))].map(key=>rs.filter(g=>targetKey(g)===key)).filter(group=>new Set(group.map(g=>g.position)).size>=2);
  if(repeated.length<3)throw Error('More shared reference targets are needed.');
  const pooled=repeated.map(group=>({target:group[0].target,feature:summarizeForBank(group.map(g=>g.feature)),samples:group.map(g=>g.feature)}));
  const correction=fitPoseCorrection(pooled,weight);
  // fit() learns a local correction from within-fixation samples. Here the
  // correction is learned from matched targets at DIFFERENT head positions.
  const corrected=rs.map(g=>{
   const [h,v]=correctedEyes(g.feature,{leftWeight:weight,poseCorrection:correction});
   return {...g,feature:{...g.feature,h,v,lh:h,lv:v,rh:h,rv:v},samples:[{...g.feature,h,v,lh:h,lv:v,rh:h,rv:v}]};
  });
  const m=fit(corrected,degree,weight,lambda);
  return {...m,version:3,binocular:rs.every(g=>eyes.every(k=>Number.isFinite(g.feature[k]))),poseCorrection:correction};
 };
 // Hold out the same target in ALL poses, so a position cannot teach the
 // answer to the target being evaluated. The seven checks never enter here.
 const score=factory=>{
  const errors=common.map(key=>{
   const train=rows.filter(g=>targetKey(g)!==key),m=factory(train);
   return quantile(rows.filter(g=>targetKey(g)===key).map(g=>{const p=estimate(g.feature,m);return Math.hypot(p.x-g.target[0],p.y-g.target[1]);}),.9);
  });
  return {mean:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),worst:Math.max(...errors)};
 };
 try{
  // Baseline refits each position independently without the held-out target.
  const baselineErrors=common.flatMap(key=>positioned.flatMap(e=>{
   const own=rows.filter(g=>g.position===e.id),held=own.filter(g=>targetKey(g)===key),train=own.filter(g=>targetKey(g)!==key);
   if(!held.length)return [];
   const m=fit(train,1,e.model.leftWeight,.02);
   return held.map(g=>{const p=estimate(g.feature,m);return Math.hypot(p.x-g.target[0],p.y-g.target[1]);});
  }));
  const baseline=Math.sqrt(baselineErrors.reduce((s,e)=>s+e*e,0)/baselineErrors.length);
  const candidates=[];
  for(const degree of [1,2])for(const weight of [.5,.25,.75])for(const lambda of [.02,.2]){
   try{const build=rs=>factory(rs,degree,weight,lambda),error=score(build);candidates.push({build,...error});}catch{}
  }
  candidates.sort((a,b)=>a.mean-b.mean);
  const best=candidates[0];
  if(!best||best.worst>.15)return null;
  const targetBetter=best.mean+.002<baseline*.85;
  let positionError=null,positionBaseline=null,positionWorst=null;
  if(typeof baselinePredictor==='function'&&positioned.length>=3){
   const errors=[],baselines=[];
   for(const held of positioned){
    const trainEntries=positioned.filter(e=>e.id!==held.id),train=rows.filter(g=>g.position!==held.id);
    let map;try{map=best.build(train);}catch{continue;}
    const local=[],prior=[];
    for(const g of rows.filter(g=>g.position===held.id)){
     const old=baselinePredictor(g.feature,trainEntries);if(!old||!finite([old.x,old.y]))continue;
     const point=estimate(g.feature,map);if(!finite([point.x,point.y]))continue;
     local.push(Math.hypot(point.x-g.target[0],point.y-g.target[1]));prior.push(Math.hypot(old.x-g.target[0],old.y-g.target[1]));
    }
    if(local.length>=4){errors.push(quantile(local,.9));baselines.push(quantile(prior,.9));}
   }
   if(errors.length>=2){positionError=Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length);positionBaseline=Math.sqrt(baselines.reduce((s,e)=>s+e*e,0)/baselines.length);positionWorst=Math.max(...errors);}
  }
  // A perfect fit at each EXISTING pose does not establish how well the bank
  // predicts a new pose. A second route holds out whole poses, while keeping
  // independent target performance bounded. Neither route fits the seven checks.
  const positionBetter=positionError!==null&&positionError+.002<positionBaseline*.85&&positionWorst<=.15&&best.mean<=Math.max(.02,baseline+.008);
  if(!targetBetter&&!positionBetter)return null;
  return {model:best.build(rows),heldOutError:best.mean,baselineError:baseline,positionError,positionBaseline,positions:positioned.length};
 }catch{return null;}
}
function summarizeForBank(samples){
 const fields=[...core,...eyes.filter(k=>samples.every(f=>Number.isFinite(f[k]))),...pose.filter(k=>samples.every(f=>Number.isFinite(f[k])))];
 return Object.fromEntries(fields.map(k=>[k,median(samples.map(f=>f[k]))]));
}
export function fitCalibration(groups){
  if(groups.length<13||new Set(groups.map(targetKey)).size<13)throw Error('Complete all calibration points, covering at least thirteen different locations.');
  const rows=groups.map((g,i)=>{try{return {target:g.target,feature:summarize(g.samples),samples:g.samples.filter(validFeature)};}catch(e){throw calibrationError(e.message,{reason:'samples',pointIndices:[i]});}}),candidates=[];
  try{fit(rows,1,.5,.02);}catch(e){throw calibrationError(e.message,{reason:'range',pointIndices:[1,5,3,7]});}
  const binocular=rows.every(g=>eyes.every(k=>Number.isFinite(g.feature[k])));
  // Hold out an entire target, not individual frames of the same fixation.
  const keys=[...new Set(rows.map(targetKey))];
  const scoreCandidate=(factory,settings)=>{
    try{
      const errors=keys.map(key=>{const m=factory(rows.filter(g=>targetKey(g)!==key));return quantile(rows.filter(g=>targetKey(g)===key).flatMap(g=>g.samples.map(f=>{const p=estimate(f,m);return Math.hypot(p.x-g.target[0],p.y-g.target[1]);})),.75);});
      candidates.push({...settings,factory,errors,score:balancedCalibrationScore(errors,keys.map(key=>rows.find(g=>targetKey(g)===key).target)),worst:Math.max(...errors)});
    }catch{/* A degenerate candidate must not be selected. */}
  };
  for(const motion of [false,true])for(const degree of [1,2])for(const leftWeight of binocular?[.5,.25,.75]:[.5])for(const lambda of [.002,.02,.2])
   scoreCandidate(r=>fit(r,degree,leftWeight,lambda,motion),{degree,leftWeight,lambda,motion,rich:false});
  if(binocular)for(const lambda of [.02,.2,2])
   scoreCandidate(r=>fitRich(r,lambda),{degree:1,leftWeight:.5,lambda,motion:false,rich:true});
  candidates.sort((a,b)=>a.score-b.score);
  if(!candidates.length)throw calibrationError('These measurements could not produce a reliable screen map.',{reason:'range',pointIndices:[1,5,3,7]});
  const best=candidates[0];
  // Cross-validation ranks candidate maps. It must not send the person through
  // an unbounded worst-point replacement loop. Separate, later gaze samples
  // still have to pass validateCalibration before this map can send input.
  // Prefer the simpler map and both eyes equally when their held-out error is similar.
  const eligible=candidates.filter(c=>c.score<=best.score*1.08+.001);
  eligible.sort((a,b)=>Number(a.rich)-Number(b.rich)||Number(a.motion)-Number(b.motion)||a.degree-b.degree||Math.abs(a.leftWeight-.5)-Math.abs(b.leftWeight-.5)||a.score-b.score);
  let selected=eligible[0];
  // Dense calibrations can reveal curvature a single global map misses.
  // Refit BOTH the base map and residual correction without each held-out
  // location; fitting the base on all locations here would leak test targets.
  if(keys.length>=20){
   const baseFactory=selected.factory;
   for(const radius of [.35,.65])for(const lambda of [.03,.2])scoreCandidate(r=>fitRegional(r,baseFactory(r),radius,lambda),{regional:true});
   const regional=candidates.filter(c=>c.regional).sort((a,b)=>a.score-b.score)[0];
   if(regional&&regional.score+.002<selected.score*.9&&regional.worst<=selected.worst)selected=regional;
  }
  const model=selected.factory(rows);
  model.crossValidation=selected.score;
  model.baselineError=candidates.find(c=>!c.motion&&!c.rich)?.score??selected.score;
  model.trainingReliable=selected.score<=.10&&selected.worst<=.22;
  model.trainingHeadMismatches=rows.filter(g=>!headMatches(g.feature,model)).length;
  const centers=rows.filter(g=>Math.abs(g.target[0]-.5)<.001&&Math.abs(g.target[1]-.5)<.001).map(g=>estimate(g.feature,model));
  const drift=centers.flatMap(a=>centers.map(b=>({x:a.x-b.x,y:a.y-b.y}))).sort((a,b)=>Math.hypot(b.x,b.y)-Math.hypot(a.x,a.y))[0]||{x:0,y:0};
  model.centerRepeatCount=centers.length;model.centerDrift=Math.hypot(drift.x,drift.y);model.centerDriftX=drift.x;model.centerDriftY=drift.y;
  model.trainingLocations=keys.length;
  model.trainingRevision=1;
  model.anchors=referenceAnchors(rows);
  return model;
}
export function validModel(m){
  const c=m?.poseCorrection;
  const correctionValid=m?.version!==3?!c:!!c&&Array.isArray(c.indices)&&c.indices.length>=4&&c.indices.length<=6&&new Set(c.indices).size===c.indices.length&&c.indices.every(i=>Number.isInteger(i)&&i>=0&&i<6)&&Array.isArray(c.reference)&&c.reference.length===c.indices.length&&finite(c.reference)&&Array.isArray(c.weights)&&c.weights.length===2&&c.weights.every(w=>Array.isArray(w)&&w.length===c.indices.length&&finite(w));
  const richValid=m?.version!==4||(m.binocular===true&&m.degree===1&&Array.isArray(m.featureIndices)&&m.featureIndices.length>=4&&m.featureIndices.length<=10&&m.featureIndices.slice(0,4).every((v,i)=>v===i)&&new Set(m.featureIndices).size===m.featureIndices.length&&m.featureIndices.every(i=>Number.isInteger(i)&&i>=0&&i<10)&&['featureCenters','featureScales'].every(k=>Array.isArray(m[k])&&m[k].length===m.featureIndices.length&&finite(m[k]))&&m.featureScales.every(v=>v>0));
  const alignmentValid=!m?.alignment||(Array.isArray(m.alignment.weights)&&m.alignment.weights.length===2&&m.alignment.weights.every(w=>Array.isArray(w)&&w.length===3&&finite(w))&&!!m.alignment.sourceHead&&core.slice(2).every(k=>Number.isFinite(m.alignment.sourceHead[k]))&&m.alignment.sourceHead.scale>0);
  const r=m?.refinement,refinementValid=!r||(Array.isArray(r.centers)&&r.centers.length>=8&&r.centers.length<=25&&r.centers.every(c=>Array.isArray(c)&&c.length===2&&finite(c)&&c.every(v=>Math.abs(v)<5))&&Number.isFinite(r.radius)&&r.radius>=.2&&r.radius<=1&&Number.isFinite(r.lambda)&&r.lambda>=.01&&Array.isArray(r.weights)&&r.weights.length===2&&r.weights.every(w=>Array.isArray(w)&&w.length===r.centers.length&&finite(w)&&w.every(v=>Math.abs(v)<=2)));
  const offsetValid=!m?.offset||(Array.isArray(m.offset)&&m.offset.length===2&&finite(m.offset)&&m.offset.every(v=>Math.abs(v)<=.3));
  const anchorsValid=m?.anchors===undefined||(Array.isArray(m.anchors)&&m.anchors.length>=5&&m.anchors.length<=27&&m.anchors.every(g=>validFeature(g?.feature)&&Array.isArray(g.target)&&g.target.length===2&&finite(g.target)&&g.target.every(v=>v>=0&&v<=1)));
  return [2,3,4].includes(m?.version)&&correctionValid&&richValid&&alignmentValid&&refinementValid&&offsetValid&&anchorsValid&&[1,2].includes(m.degree)&&[.25,.5,.75].includes(m.leftWeight)&&typeof m.binocular==='boolean'&&
    Array.isArray(m.center)&&m.center.length===2&&finite(m.center)&&Array.isArray(m.spread)&&m.spread.length===2&&finite(m.spread)&&m.spread.every(x=>x>0)&&
    Array.isArray(m.weights)&&m.weights.length===2&&m.weights.every(r=>Array.isArray(r)&&r.length===(m.version===4?m.featureIndices.length+1:m.degree===1?3:6)&&finite(r))&&
    !!m.head&&core.slice(2).every(k=>Number.isFinite(m.head[k]))&&m.head.scale>0&&pose.every(k=>m.head[k]===undefined||Number.isFinite(m.head[k]));
}
export function headRejections(f,m){
 if(!validFeature(f)||!m?.head)return ['unavailable'];
 const differences={x:Math.abs(f.x-m.head.x)/.05,y:Math.abs(f.y-m.head.y)/.05,scale:Math.abs(f.scale/m.head.scale-1)/.18,roll:Math.abs(f.roll-m.head.roll)/.12};
 for(const key of pose)if(m.head[key]!==undefined)differences[key]=Math.abs(f[key]-m.head[key])/.07;
 return Object.entries(differences).filter(([,v])=>!Number.isFinite(v)||v>=1).map(([key])=>key);
}
export function headMatches(f,m){return headRejections(f,m).length===0;}
export function predict(f,m){
 return predictDetailed(f,m).point;
}
export function predictDetailed(f,m){
 if(!validModel(m))return {point:null,raw:null,reason:'no-model'};
 if(!validFeature(f))return {point:null,raw:null,reason:'eyes-unavailable'};
 if((m.binocular&&!eyes.every(k=>Number.isFinite(f[k])))||(m.version===4&&!m.featureIndices.every(i=>Number.isFinite(f[RICH_FIELDS[i]]))))return {point:null,raw:null,reason:'eye-features'};
 const raw=estimate(f,m);if(!finite([raw.x,raw.y]))return {point:null,raw:null,reason:'invalid-estimate'};
 const headReasons=headRejections(f,m);
 if(headReasons.length)return {point:null,raw,reason:'head-position',headReasons};
 if(raw.x<0||raw.x>1||raw.y<0||raw.y>1)return {point:null,raw,reason:'outside-screen'};
 return {point:raw,raw,reason:'usable'};
}
export function fitAlignment(groups,model,{eyeOnly=false}={}){return fitRepair(groups,model,{eyeOnly});}
export function fitOffset(samples,model){
 if(!validModel(model))throw Error('A saved calibration is needed for quick alignment.');
 const feature=settledSummary(samples);
 if(!headMatches(feature,model))throw Error('This position is outside the current map. Add this position under Head positions using five dots.');
 const points=samples.filter(validFeature).map(f=>estimate(f,model));
 const center={x:median(points.map(p=>p.x)),y:median(points.map(p=>p.y))};
 if(quantile(points.map(p=>Math.hypot(p.x-center.x,p.y-center.y)),.9)>.06)throw Error('Gaze readings varied too much for a one-point correction. Use the five-point alignment.');
 const shift=[.5-center.x,.5-center.y],offset=shift.map((v,i)=>v+(model.offset?.[i]||0));
 if(offset.some(v=>!Number.isFinite(v)||Math.abs(v)>.3))throw Error('This offset needs a five-point alignment.');
 const result={...model,offset,quickAlignment:{shift,recordedAt:Date.now()}};
 // Old target summaries no longer describe the shifted measurement session.
 delete result.anchors;
 return result;
}
export function fitRefinement(groups,model){return fitRepair(groups,model,{refine:true});}
function fitRepair(groups,model,{eyeOnly=false,refine=false}={}){
 const targets=refine?REFINE_TARGETS:ALIGN_TARGETS;
 if(!validModel(model)||groups.length!==targets.length||groups.some((g,i)=>g.target.length!==2||g.target.some((v,j)=>v!==targets[i][j])))throw Error(refine?'Complete all nine refinement points.':'Complete all five alignment points.');
 const base={...model};delete base.alignment;delete base.refinement;delete base.offset;
 const sourceHead=model.alignment?.sourceHead||model.head;
 const rows=groups.map(g=>({target:g.target,feature:settledSummary(g.samples),samples:g.samples.filter(validFeature)}));
 const head=Object.fromEntries(Object.keys(model.head).map(k=>[k,median(rows.map(g=>g.feature[k]))]));
 // A fresh eye-only fit does not use the old pose or old coefficients. Its
 // anchors must agree with EACH OTHER, rather than with yesterday's position.
 if(eyeOnly&&rows.some(g=>!headMatches(g.feature,{head})))
  throw Error('Your position changed during these five points. Settle into a comfortable position and retry the five-point eye-only repair. Your previous calibration is kept.');
 if(!eyeOnly&&rows.some(({feature:f})=>Math.abs(f.x-sourceHead.x)>.12||Math.abs(f.y-sourceHead.y)>.12||Math.abs(f.scale/sourceHead.scale-1)>.35||Math.abs(f.roll-sourceHead.roll)>.25))
  throw Error('Your head position changed too much to reuse the old mapping. Choose Realign after moving · 5 points to rebuild an eye-only map at your new position. Your previous calibration is kept.');
 const fitA=(rs,affine)=>{
  rs=rs.map(g=>({...g,point:estimate(g.feature,base)}));
  if(rs.some(g=>!finite([g.point.x,g.point.y])))throw Error('Alignment could not estimate your gaze. Use New calibration.');
  if(!affine)return [[median(rs.map(g=>g.target[0]-g.point.x)),1,0],[median(rs.map(g=>g.target[1]-g.point.y)),0,1]];
  const v=rs.map(g=>[1,g.point.x,g.point.y]),a=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>v.reduce((s,r)=>s+r[i]*r[j],0)+(i===j?.01:0)));
  return [0,1].map(axis=>solve(a,Array.from({length:3},(_,i)=>v.reduce((s,r,j)=>s+r[i]*rs[j].target[axis],0)+(i===axis+1?.01:0))));
 };
 const candidates=[];
 const compare=(factory,options)=>{
  try{
   // Hold out a whole anchor and score its individual frames. A median-only
   // comparison can hide head-induced jitter even when five medians fit well.
   const errors=rows.map((g,i)=>{
    const m=factory(rows.filter((_,j)=>i!==j));
    return quantile(g.samples.map(f=>{const p=estimate(f,m);return Math.hypot(p.x-g.target[0],p.y-g.target[1]);}),.9);
   });
   const score=balancedCalibrationScore(errors,rows.map(g=>g.target));
   if(Number.isFinite(score))candidates.push({...options,factory,score});
  }catch{/* A degenerate repair candidate is not usable. */}
 };
 for(const affine of [false,true])compare(rs=>{
  const weights=fitA(rs,affine),det=weights[0][1]*weights[1][2]-weights[0][2]*weights[1][1];
  if(!weights.every(finite)||det<.25||det>4||Math.max(...weights.flat().map(Math.abs))>3)throw Error('Unstable correction');
  return {...base,alignment:{weights,sourceHead,affine}};
 },{rebuilt:false,affine});
 // A saved model can be the problem, not merely its offset. Fit a small,
 // regularized eye-only map using these NEW anchors; never fit accuracy checks.
 for(const leftWeight of rows.every(g=>eyes.every(k=>Number.isFinite(g.feature[k])))?[.5,.25,.75]:[.5])
  for(const lambda of [.002,.02,.2])compare(rs=>fit(rs,1,leftWeight,lambda),{rebuilt:true,affine:false,leftWeight,lambda});
 const translation=candidates.find(c=>!c.rebuilt&&!c.affine),affine=candidates.find(c=>!c.rebuilt&&c.affine);
 const existing=affine&&(!translation||affine.score<translation.score*.85)?affine:translation;
 const repair=candidates.filter(c=>c.rebuilt).sort((a,b)=>a.score-b.score)[0];
 let selected=eyeOnly?repair:repair&&(!existing||repair.score+.005<existing.score*.85)?repair:existing;
 if(refine){
  // The original map is also a candidate, so fresh anchors need not force a
  // replacement. Use the simpler option unless a regional map generalizes.
  compare(()=>model,{unchanged:true,rebuilt:false,affine:false});
  const unchanged=candidates.find(c=>c.unchanged);
  if(unchanged&&(!selected||unchanged.score<=selected.score*1.05+.003))selected=unchanged;
  const bases=candidates.filter(c=>!c.unchanged).sort((a,b)=>a.score-b.score).slice(0,2);
  for(const candidate of bases)for(const radius of [.35,.65])for(const lambda of [.03,.2]){
   compare(rs=>fitRegional(rs,candidate.factory(rs),radius,lambda),{regional:true,rebuilt:candidate.rebuilt,affine:candidate.affine});
  }
  const regional=candidates.filter(c=>c.regional).sort((a,b)=>a.score-b.score)[0];
  if(regional&&(!selected||regional.score+.002<selected.score*.9))selected=regional;
 }
 if(eyeOnly&&!selected)throw Error('These five points could not form an eye-only map. The previous map is kept. Check the camera position before trying again.');
 if(!selected)throw Error('The alignment is inconsistent. Use New calibration.');
 const fitted=selected.factory(rows);
 const result={...fitted,head,alignment:{...(fitted.alignment||{weights:[[0,1,0],[0,0,1]],sourceHead:head,affine:false}),rebuilt:selected.rebuilt,estimatedError:selected.score},
  repairComparison:{existingError:existing?.score??null,eyeOnlyError:repair?.score??null,rebuilt:selected.rebuilt,eyeOnlyRequested:eyeOnly,refined:refine,regional:!!selected.regional,unchanged:!!selected.unchanged,selectedError:selected.score,anchorCount:rows.length},trainingRevision:1};
 if(selected.rebuilt){result.trainingLocations=rows.length;result.centerRepeatCount=1;result.centerDrift=0;result.centerDriftX=0;result.centerDriftY=0;}
 result.anchors=referenceAnchors(rows);
 if(!validModel(result))throw Error('Alignment could not be saved. Use New calibration.');
 return result;
}
export function validateCalibration(groups,model,width,height,{predictor=null}={}){
  if(groups.length!==CHECK_TARGETS.length)throw Error('Complete all seven accuracy checks.');
  if(!finite([width,height])||Math.min(width,height)<=0)throw Error('Display dimensions are unavailable.');
  const errors=[],jx=[],jy=[],perTarget=[],rejected={};let total=0,valid=0;
  // This measures the correction's contribution, not the accuracy of a newly
  // fitted eye-only model. Do not use it to select or enable another model.
  const withoutCorrection=!predictor&&model.poseCorrection?{...model,version:2}:null;
  if(withoutCorrection)delete withoutCorrection.poseCorrection;
  for(const g of groups){
    const results=g.samples.map(f=>predictor?predictor(f):predictDetailed(f,model)),points=results.map(r=>r.raw).filter(Boolean),usable=results.filter(r=>r.point).length,reasons={},headReasons={},correction=[];
    for(const r of results)if(r.reason!=='usable')reasons[r.reason]=(reasons[r.reason]||0)+1;
    for(const r of results)for(const key of r.headReasons||[])headReasons[key]=(headReasons[key]||0)+1;
    if(withoutCorrection)results.forEach((r,i)=>{
      if(!r.raw)return;const other=estimate(g.samples[i],withoutCorrection);
      const shift=Math.hypot((r.raw.x-other.x)*width,(r.raw.y-other.y)*height);
      if(Number.isFinite(shift))correction.push(shift);
    });
    for(const [key,value] of Object.entries(reasons))rejected[key]=(rejected[key]||0)+value;
    total+=g.samples.length;valid+=usable;
    const cx=median(points.map(p=>p.x)),cy=median(points.map(p=>p.y)),local=[];
    for(const p of points){const dx=Math.abs(p.x-g.target[0]),dy=Math.abs(p.y-g.target[1]),e={dx,dy,n:Math.hypot(dx,dy),px:Math.hypot(dx*width,dy*height)};errors.push(e);local.push(e);jx.push(Math.abs(p.x-cx));jy.push(Math.abs(p.y-cy));}
    perTarget.push({x:g.target[0],y:g.target[1],validFraction:usable/Math.max(1,g.samples.length),estimatedFraction:points.length/Math.max(1,g.samples.length),sampleCount:g.samples.length,rejected:reasons,headRejections:headReasons,headCorrectionP90Pixels:correction.length?Math.round(quantile(correction,.9)):null,trackingLoss:g.trackingLoss||{},p90:quantile(local.map(e=>e.n),.9),p90Pixels:Math.round(quantile(local.map(e=>e.px),.9)),jitterPixels:Math.round(quantile(points.map(p=>Math.hypot((p.x-cx)*width,(p.y-cy)*height)),.9)),offsetX:Math.round((cx-g.target[0])*width),offsetY:Math.round((cy-g.target[1])*height)});
  }
  const mean=errors.length?errors.reduce((s,e)=>s+e.n,0)/errors.length:Infinity,worst=errors.length?Math.max(...errors.map(e=>e.n)):Infinity;
  const p90=quantile(errors.map(e=>e.n),.9),radiusX=quantile(errors.map(e=>e.dx),.9),radiusY=quantile(errors.map(e=>e.dy),.9);
  return {passed:mean<=.07&&p90<=.12&&perTarget.every(p=>p.validFraction>=.85&&p.p90<=.15),mean,worst,p90,radiusX,radiusY,
    jitterX:quantile(jx,.9),jitterY:quantile(jy,.9),validFraction:valid/Math.max(1,total),estimatedFraction:errors.length/Math.max(1,total),sampleCount:total,rejected,perTarget,horizontalSummary:horizontalAccuracy(perTarget),
    meanPixels:Math.round(errors.length?errors.reduce((s,e)=>s+e.px,0)/errors.length:Infinity),worstPixels:Math.round(errors.length?Math.max(...errors.map(e=>e.px)):Infinity),
    p90Pixels:Math.round(quantile(errors.map(e=>e.px),.9)),checkedAt:Date.now()};
}
// Display-only stabilization. This cannot identify physiological microsaccades
// separately from webcam noise, and never changes calibration or raw hit tests.
// All distances below are CSS pixels, not fractions of the whole screen.
export class FixationStabilizer{
 constructor(){this.reset();}
 reset(){this.values=[];this.anchor=null;this.noise=0;this.at=null;this.anchorAt=null;this.size=null;this.fixating=false;this.excursion=[];this.relocated=false;this.excursionHeld=false;}
 update(p,at,width=1280,height=720,observation=p){
  if(!p||!observation||!finite([p.x,p.y,observation.x,observation.y,at,width,height])||width<=0||height<=0){this.reset();return null;}
  const size=width+':'+height;
  if(this.at!==null&&(at<=this.at||at-this.at>250||size!==this.size))this.reset();
  const dt=this.at===null?0:at-this.at;this.at=at;this.size=size;this.relocated=false;this.excursionHeld=false;
  const q={x:p.x*width,y:p.y*height,rawX:observation.x*width,rawY:observation.y*height,at};
  this.values.push(q);this.values=this.values.filter(v=>at-v.at<=800);
  const center=values=>({x:median(values.map(v=>v.x)),y:median(values.map(v=>v.y))});
  const rawCenter=values=>({x:median(values.map(v=>v.rawX)),y:median(values.map(v=>v.rawY))});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const release=(relocated=false)=>{this.anchor=null;this.fixating=false;this.values=[q];this.excursion=[];this.relocated=relocated;};
  if(this.anchor){
   // These are screen-pixel interaction thresholds, not a biological
   // microsaccade detector. At webcam frame rates, require temporal evidence
   // before moving the held marker; isolated/returning excursions are common.
   const radius=Math.min(48,Math.max(18,this.noise*4));
   const observation={x:q.rawX,y:q.rawY};
   if(distance(observation,this.anchor)>radius){
    this.excursion.push({...observation,at});this.excursion=this.excursion.filter(v=>at-v.at<=220);
    const duration=at-this.excursion[0].at,ec=center(this.excursion);
    const clustered=quantile(this.excursion.map(v=>distance(v,ec)),.9)<=Math.max(6,this.noise*1.5);
    if(this.excursion.length>=3&&duration>=120&&(clustered||duration>=160))release(true);
    else this.excursionHeld=true;
   }else{
    // Raw readings returned even if the median window still contains the
    // excursion. Do not let that delayed window drag the anchor afterward.
    this.excursion=[];
   }
  }
  if(this.anchor){
   const recent=this.values.filter(v=>at-v.at<=260),c=center(recent);
   const shift=distance(c,this.anchor),threshold=Math.max(2,Math.min(14,this.noise*1.2));
   const direction={x:c.x-this.anchor.x,y:c.y-this.anchor.y};
   const consistent=recent.filter(v=>(v.x-this.anchor.x)*direction.x+(v.y-this.anchor.y)*direction.y>threshold*shift*.5).length/recent.length;
   const spread=quantile(recent.map(v=>distance(v,c)),.9);
   const rawRecent=rawCenter(recent),rawShift=distance(rawRecent,this.anchor);
   const rawPath=recent.map(v=>({x:v.rawX,y:v.rawY})),travel=distance(rawPath[0],rawPath.at(-1));
   const pathLength=rawPath.slice(1).reduce((s,v,i)=>s+distance(v,rawPath[i]),0);
   const pursuit=travel>=Math.max(4,this.noise*1.8)&&travel/Math.max(.001,pathLength)>.8;
   if(!this.excursionHeld&&recent.length>=4&&at-recent[0].at>=160&&shift>threshold&&rawShift>threshold&&distance({x:q.rawX,y:q.rawY},this.anchor)>threshold&&consistent>=.85&&(spread<=Math.max(3,this.noise*.8)||pursuit))release();
   else if(at-this.anchorAt>=750){
    // Follow sustained fine changes gradually, rather than making a periodic
    // jump every 750 ms. No permanent spatial dead zone and no target snapping.
    const c=rawCenter(this.values.filter(v=>at-v.at<=400));
    if(!this.excursionHeld&&distance(c,this.anchor)>=1){const a=1-Math.exp(-Math.min(dt,100)/400);this.anchor={x:this.anchor.x+a*(c.x-this.anchor.x),y:this.anchor.y+a*(c.y-this.anchor.y)};}
   }
  }else if(this.values.length>=5&&at-this.values[0].at>=220){
   const window=this.values.filter(v=>at-v.at<=320);
   const c=center(window);
   const noise=quantile(window.map(v=>Math.hypot(v.rawX-c.x,v.rawY-c.y)),.9);
   const half=Math.floor(window.length/2),trend=distance(center(window.slice(0,half)),center(window.slice(half)));
   // Do not turn large tracking errors or continuous pursuit into a fixation.
   const limit=Math.min(24,Math.min(width,height)*.035);
   const tail=center(window.filter(v=>at-v.at<=120));
   if(noise<=limit&&trend<=Math.max(1,noise*.8)&&distance(c,tail)<=Math.max(.5,noise*.5)){
    this.anchor=rawCenter(window);this.anchorAt=at;this.noise=noise>1?Math.max(6,noise):noise;this.fixating=true;
   }
  }
  const out=this.anchor||q;
  return {x:out.x/width,y:out.y/height};
 }
}
// Display-only smoothing. Training, accuracy statistics and the fixation gate
// still use the original estimates. A short median window stops one/two-frame
// spikes from opening up the adaptive filter's fast movement response.
// One Euro adaptive low-pass filter: steadier fixation, quicker movement response.
// Algorithm: https://github.com/casiez/OneEuroFilter
export class GazeFilter{
  constructor(){this.fixation=new FixationStabilizer();this.reset();}
  reset(){this.fixation.reset();this.values=[];this.point=null;this.at=null;this.previous=null;this.velocity={x:0,y:0};this.size=null;}
  update(p,at,{width=1280,height=720}={}){
    if(!p||!finite([p.x,p.y,at])){this.reset();return null;}
    const size=width+':'+height;
    if(this.at!==null&&(at<=this.at||at-this.at>250||size!==this.size))this.reset();this.size=size;
    this.values.push({...p,at});this.values=this.values.filter(v=>at-v.at<=150).slice(-5);
    const robust={x:median(this.values.map(v=>v.x)),y:median(this.values.map(v=>v.y))};
    const next=this.fixation.update(robust,at,width,height,p);
    if(!next){this.reset();return null;}
    // A sustained move has already been confirmed from fresh raw samples.
    // Reset old velocity instead of adding another long low-pass catch-up.
    if(this.fixation.relocated){this.point={...next};this.previous=next;this.velocity={x:0,y:0};this.at=at;return {...this.point};}
    if(this.at===null){this.point={...next};this.previous=next;this.at=at;return this.point;}
    const dt=(at-this.at)/1000,alpha=cutoff=>1/(1+1/(2*Math.PI*cutoff*dt)),da=alpha(1);
    const near=Math.hypot((next.x-this.point.x)*width,(next.y-this.point.y)*height)<4;
    for(const axis of ['x','y']){
      const speed=(next[axis]-this.previous[axis])/dt;
      this.velocity[axis]+=da*(speed-this.velocity[axis]);
      const a=alpha(this.fixation.fixating&&near?.45:.65+5*Math.abs(this.velocity[axis]));this.point[axis]+=a*(next[axis]-this.point[axis]);
    }
    this.previous=next;this.at=at;return {...this.point};
  }
}
// One display path for preview and controls. Rejected samples NEVER become
// selectable, even when an edge marker or brief last-position marker is shown.
export class GazePointer{
 constructor(){this.filter=new GazeFilter();this.reset();}
 reset(){this.filter.reset();this.last=null;this.lastAt=null;this.at=null;this.rejectedAt=null;this.recovering=[];}
 update(prediction,at,viewport){
  if(!Number.isFinite(at)){this.reset();return {point:null,usable:false};}
  if(this.at!==null&&(at<=this.at||at-this.at>500))this.reset();this.at=at;
  if(prediction.point){
   if(this.rejectedAt!==null&&at-this.rejectedAt>=180){
    // A rejected head/eye estimate must not bypass filtering and become a
    // selectable jump on the next single good frame. Reacquire a small,
    // consistent group; a new genuine gaze location is allowed anywhere.
    this.recovering.push({...prediction.point,at});this.recovering=this.recovering.filter(p=>at-p.at<=180);
    const center={x:median(this.recovering.map(p=>p.x)),y:median(this.recovering.map(p=>p.y))};
    const settled=this.recovering.length>=3&&at-this.recovering[0].at>=80&&this.recovering.every(p=>Math.hypot(p.x-center.x,p.y-center.y)<=.035);
    if(!settled)return {point:this.last,usable:false,held:!!this.last,clipped:false,recovering:true};
    this.filter.reset();this.filter.update(center,at-1,viewport);
   }
   this.rejectedAt=null;this.recovering=[];
   const point=this.filter.update(prediction.point,at,viewport);this.last=point;this.lastAt=at;
   return {point,usable:!!point,held:false,clipped:false,fixating:this.filter.fixation.fixating,excursionHeld:this.filter.fixation.excursionHeld,relocated:this.filter.fixation.relocated};
  }
  this.rejectedAt??=at;this.recovering=[];
  const age=this.lastAt===null?Infinity:at-this.lastAt;
  // Never animate raw rejected coordinates around the screen. They remain
  // in accuracy statistics, while the display holds a clearly inactive mark.
  const point=prediction.raw||age<=500?this.last:null;
  return {point,usable:false,held:!!point,clipped:false};
 }
}
export class FixationGate{
  constructor(){this.reset();}
  reset(){this.values=[];this.at=null;}
  update(p,at,validation){
    if(!p||!finite([p.x,p.y,at])){this.reset();return false;}
    if(this.at!==null&&(at<=this.at||at-this.at>250))this.reset();
    this.at=at;this.values.push({...p,at});this.values=this.values.filter(v=>at-v.at<=320);
    if(this.values.length<5||at-this.values[0].at<220)return false;
    return ['x','y'].every(axis=>{
      const center=median(this.values.map(v=>v[axis])),tolerance=Math.min(.06,Math.max(.018,(validation?.[axis==='x'?'jitterX':'jitterY']||0)*1.6));
      // The newest reading must agree immediately. A brief past outlier must
      // not poison the whole 320 ms window after the eyes return to the target.
      return Math.abs(p[axis]-center)<=tolerance&&quantile(this.values.map(v=>Math.abs(v[axis]-center)),.8)<=tolerance;
    });
  }
}
// The empirical error envelope is a usability guard, not a confidence guarantee.
export function selectionMargin(v,width,height){return {x:Math.max(6,(Number.isFinite(v?.radiusX)?v.radiusX:0)*width),y:Math.max(6,(Number.isFinite(v?.radiusY)?v.radiusY:0)*height)};}
export function containedTarget(p,rect,width,height,margin={x:6,y:6}){
  if(!p)return false;const x=p.x*width,y=p.y*height,mx=Math.max(margin.x,rect.width*.08),my=Math.max(margin.y,rect.height*.08);
  return x>rect.left+mx&&x<rect.right-mx&&y>rect.top+my&&y<rect.bottom-my;
}
export function nearTarget(p,rect,width,height){
 if(!p||!rect)return false;
 const padding=Math.min(16,Math.min(rect.width,rect.height)*.05),x=p.x*width,y=p.y*height;
 return x>=rect.left-padding&&x<=rect.right+padding&&y>=rect.top-padding&&y<=rect.bottom+padding;
}
export function contextTarget(raw,display,rects,width,height,margin={x:12,y:12}){
 if(!raw||!display||!finite([raw.x,raw.y,display.x,display.y,width,height])||width<=0||height<=0)return -1;
 const radius=Math.min(48,Math.max(12,Math.max(margin.x,margin.y)*.35));
 const distance=(p,r)=>Math.hypot(Math.max(r.left-p.x*width,0,p.x*width-r.right),Math.max(r.top-p.y*height,0,p.y*height-r.bottom));
 const candidates=rects.flatMap((rect,index)=>{
  if(!rect||!finite([rect.left,rect.top,rect.right,rect.bottom,rect.width,rect.height])||rect.width<=0||rect.height<=0)return [];
  const score=Math.max(distance(raw,rect),distance(display,rect));
  return [{index,score}];
 }).sort((a,b)=>a.score-b.score);
 const best=candidates[0];if(!best||best.score>radius)return -1;
 // Two nearby controls with similar scores remain ambiguous. Do not assign
 // the empty gap to an arbitrary control or infer targets in another app.
 if(candidates[1]&&candidates[1].score-best.score<Math.max(10,radius*.35))return -1;
 return best.index;
}

// Infer continued interest in an already acquired target from recent gaze
// occupancy. A brief excursion pauses selection. A sustained new target wins.
// No semantic guesses about which command the person should choose are made.
export class TargetIntent{
 constructor(){this.reset();}
 reset(){this.target=null;this.startedAt=null;this.pending=null;this.pendingAt=null;this.missedAt=null;this.at=null;this.history=[];}
 update(candidate,at,{valid=true,nearCurrent=false}={}){
  if(!Number.isFinite(at)){this.reset();return {target:null,confirmed:false,confident:false};}
  if(this.at!==null&&(at<=this.at||at-this.at>250))this.reset();
  this.at=at;this.history.push({target:valid?candidate:null,at});this.history=this.history.filter(v=>at-v.at<=240);
  if(this.target===null){if(valid&&candidate!==null){this.target=candidate;this.startedAt=at;}}
  else if(valid&&candidate===this.target){this.pending=null;this.pendingAt=null;this.missedAt=null;}
  else{
   this.missedAt??=at;
   if(valid&&candidate!==null){
    if(this.pending!==candidate){this.pending=candidate;this.pendingAt=at;}
    if(at-this.pendingAt>=100){this.target=candidate;this.startedAt=this.pendingAt;this.pending=null;this.pendingAt=null;this.missedAt=null;}
   }else{this.pending=null;this.pendingAt=null;}
   if((valid&&candidate===null&&!nearCurrent)||this.missedAt!==null&&at-this.missedAt>300){this.target=null;this.startedAt=null;this.pending=null;this.pendingAt=null;this.missedAt=null;}
  }
  const confirmed=valid&&candidate!==null&&candidate===this.target;
  const hits=this.history.filter(v=>v.target===this.target),confident=confirmed&&hits.length>=3&&at-this.startedAt>=150&&hits.length/this.history.length>=.7;
  return {target:this.target,confirmed,confident};
 }
}
export function chooseLayout(width,height,validation){
  const geometry=controlGeometry(width,height,validation),margin=selectionMargin(validation,width,height),usableWidth=Math.max(1,width-32),usableHeight=Math.max(1,height-geometry.top-geometry.bottom);
  // Keep enough usable center area after accounting for measured error.
  const columns=usableWidth/3>=Math.max(160,margin.x*2+70)?3:2;
  const rows=usableHeight/3>=Math.max(105,margin.y*2+48)?3:2;
  return {columns,rows,capacity:columns*rows};
}
export function controlGeometry(width,height,validation){
  const margin=selectionMargin(validation,width,height),footer=Math.max(height<=550?70:84,Math.ceil(margin.y*2+64));
  return {top:height<=550?74:90,bottom:footer+10,footer,cancelWidth:Math.max(118,Math.ceil(margin.x*2+48))};
}
export class TargetDwell{
  constructor(ms=1000,{pauseMs=120,releaseMs=500}={}){this.ms=ms;this.pauseMs=pauseMs;this.releaseMs=releaseMs;this.reset();}
  reset(){this.target=null;this.at=null;this.elapsed=0;this.progress=0;this.locked=null;this.releaseAt=null;this.suspendedAt=null;}
  suspend(target,at){
    // A short in-target fluctuation can pause, but never advance or complete,
    // a selection. Loss, a target change or a longer excursion still resets.
    if(this.locked!==null)return this.update(target,at);
    if(target===null||target!==this.target||!Number.isFinite(at)||this.at===null||at<=this.at||at-this.at>250)return this.update(null,at);
    this.suspendedAt??=at;
    if(at-this.suspendedAt>this.pauseMs)return this.update(null,at);
    this.at=at;return null;
  }
  update(target,at){
    if(!Number.isFinite(at))return null;
    if(this.locked!==null){
      if(target!==this.locked){this.releaseAt??=at;if(at-this.releaseAt>=this.releaseMs){this.locked=null;this.target=null;this.at=null;}}
      else this.releaseAt=null;return null;
    }
    if(target===null||target!==this.target||this.at===null||at<=this.at||at-this.at>250){this.target=target;this.elapsed=0;this.progress=0;this.at=at;this.suspendedAt=null;return null;}
    if(this.suspendedAt!==null){this.suspendedAt=null;this.at=at;return null;}
    this.elapsed+=at-this.at;this.at=at;this.progress=Math.min(1,this.elapsed/this.ms);
    if(this.progress<1)return null;
    this.locked=target;this.releaseAt=null;this.elapsed=0;this.progress=0;return target;
  }
}
export function subdivide(rect,index,columns=3,rows=3){
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<2||rows<2||!Number.isInteger(index)||index<0||index>=columns*rows)throw Error('Invalid grid cell');
  return {x:rect.x+(index%columns)*rect.w/columns,y:rect.y+Math.floor(index/columns)*rect.h/rows,w:rect.w/columns,h:rect.h/rows};
}
export function zoomComplete(rect,width,height){return rect.w*width<=12&&rect.h*height<=12;}
export function sameSetup(a,b){return !!a&&!!b&&typeof a.deviceId==='string'&&a.deviceId.length>0&&['width','height','screenWidth','screenHeight','pixelRatio'].every(k=>Number.isFinite(a[k])&&a[k]>0)&&['deviceId','width','height','screenWidth','screenHeight','pixelRatio'].every(k=>a[k]===b[k])&&sameCameraGeometry(a,b);}
