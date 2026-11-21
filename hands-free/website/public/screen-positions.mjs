import {validModel,headRejections,predictDetailed,fitHeadCompensation,quantile,poseZoom,screenPoint} from './screen-gaze.mjs';

const compensationCache=new WeakMap();
function compensationFor(entries,eligible){
 const signature=eligible.map(e=>`${e.id}:${e.savedAt||0}`).join(',');
 const cached=compensationCache.get(entries);
 if(cached?.signature===signature)return cached.value;
 const value=fitHeadCompensation(eligible,{baselinePredictor:(feature,bank)=>{
  const result=estimateHeadPositions(feature,bank,{allowUnverified:true,useCompensation:false});
  return result.entry?result.raw:null;
 }});
 compensationCache.set(entries,{signature,value});
 return value;
}

export const MAX_HEAD_POSITIONS=15;
export function resetDwellForPosition(dwell){
 const locked=dwell.locked;dwell.reset();dwell.locked=locked;
}
export function savedHeadPositions(record){
 const entries=record?.headPositions;
 if(Array.isArray(entries)&&entries.length>0&&entries.length<=MAX_HEAD_POSITIONS&&new Set(entries.map(e=>e?.id)).size===entries.length&&entries.every(e=>Number.isInteger(e?.id)&&e.id>0&&validModel(e.model)))
  return entries.map(e=>({id:e.id,model:e.model,validation:e.validation||null,savedAt:e.savedAt||0}));
 return validModel(record?.model)?[{id:1,model:record.model,validation:record.validation||null,savedAt:record.savedAt||0}]:[];
}
export function headDistance(f,head){
 if(!f||!head)return Infinity;
 const limit=.05*poseZoom(head.scale),values=[(f.x-head.x)/limit,(f.y-head.y)/limit,(f.scale/head.scale-1)/.18,(f.roll-head.roll)/.12];
 for(const key of ['yaw','pitch'])if(head[key]!==undefined)values.push((f[key]-head[key])/.07);
 return values.every(Number.isFinite)?Math.sqrt(values.reduce((s,v)=>s+v*v,0)/values.length):Infinity;
}
// Pose distances describe face location, apparent size and orientation, NOT
// where the eyes are pointing. Gaze remains an input to every source map.
const baseFields=['x','y','scale','roll'];
const scales={x:.05,y:.05,roll:.12,yaw:.07,pitch:.07};
// Sideways and up/down units follow the apparent head size (see poseZoom), so a
// zoomed-in view is not treated as a large movement for a small real one.
const shiftUnit=(k,scale)=>scales[k]*(k==='x'||k==='y'?poseZoom(scale):1);
function delta(a,b,fields){const scale=Math.sqrt(a.scale*b.scale);return fields.map(k=>k==='scale'?Math.log(a.scale/b.scale)/Math.log(1.18):(a[k]-b[k])/shiftUnit(k,scale));}
const norm=v=>Math.hypot(...v);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);

const guideDirections=[
 ['left','Move slightly to your left','x',1],['right','Move slightly to your right','x',-1],
 ['up','Sit slightly higher','y',-1],['down','Sit slightly lower','y',1],
 ['near','Move slightly closer','scale',1],['far','Move slightly farther away','scale',-1],
 ['turn-left','Turn your face slightly left','yaw',1],['turn-right','Turn your face slightly right','yaw',-1],
 ['look-up','Raise your chin slightly','pitch',-1],['look-down','Lower your chin slightly','pitch',1],
 ['tilt-left','Tilt your head slightly left','roll',1],['tilt-right','Tilt your head slightly right','roll',-1]
];
// Greedy experimental design: prefer a new pose direction with high remaining
// uncertainty in the measured six-dimensional head range. Selection depends
// on the actual saved poses, including combinations captured by the person.
// The ridge term keeps sparse and correlated head positions well conditioned.
export function nextHeadPosition(entries,{skip=[],span=.75}={}){
 const reference=(entries.find(e=>e.id===1)||entries[0])?.model?.head;
 if(!reference)return null;
 const fields=[...baseFields,...['yaw','pitch'].filter(k=>Number.isFinite(reference[k])&&entries.every(e=>Number.isFinite(e.model.head[k])))];
 const saved=entries.map(e=>delta(e.model.head,reference,fields)),n=fields.length;
 const information=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>saved.reduce((s,v)=>s+v[i]*v[j],i===j?.15:0)));
 const variance=vector=>{
  const matrix=information.map((row,i)=>[...row,vector[i]]);
  for(let i=0;i<n;i++){
   const pivot=matrix[i][i];for(let j=i;j<=n;j++)matrix[i][j]/=pivot;
   for(let k=0;k<n;k++)if(k!==i){const factor=matrix[k][i];for(let j=i;j<=n;j++)matrix[k][j]-=factor*matrix[i][j];}
  }
  return dot(vector,matrix.map(row=>row[n]));
 };
 const candidates=guideDirections.filter(([, ,field])=>fields.includes(field)).map(([id,label,field,sign])=>({id,label,vector:fields.map(k=>k===field?sign*span:0)}));
 for(const sign of [-1,1])candidates.push({id:sign===1?'left-near':'right-far',label:sign===1?'Move a little left and closer':'Move a little right and farther away',vector:fields.map(k=>['x','scale'].includes(k)?sign*span*.7:0)});
 const ranked=candidates.filter(c=>!skip.includes(c.id)).map(c=>({...c,gap:Math.min(...saved.map(v=>norm(v.map((x,i)=>x-c.vector[i]))))})).filter(c=>c.gap>.28);
 for(const c of ranked)c.score=variance(c.vector)+.15*c.gap;
 ranked.sort((a,b)=>b.score-a.score);
 const best=ranked[0];if(!best)return null;
 const target=Object.fromEntries(fields.map((key,i)=>[key,key==='scale'?reference.scale*Math.exp(best.vector[i]*Math.log(1.18)):reference[key]+best.vector[i]*shiftUnit(key,reference.scale)]));
 return {...best,fields,reference:{...reference},target,tiltDegrees:Math.round((target.roll-reference.roll)*180/Math.PI)};
}

export function headGuideFeedback(feature,plan){
 if(!plan||!feature||!plan.fields.every(k=>Number.isFinite(feature[k]))||feature.scale<=0)return {ready:false,progress:0,message:'Face the camera so both eyes are visible.'};
 const remaining=delta(plan.target,feature,plan.fields),error=norm(remaining),start=norm(plan.vector);
 const progress=Math.max(0,Math.min(1,1-error/Math.max(.01,start)));
 const index=remaining.reduce((best,v,i)=>Math.abs(v)>Math.abs(remaining[best])?i:best,0),field=plan.fields[index],sign=Math.sign(remaining[index]);
 const hints={x:sign>0?'Move a little left':'Move a little right',y:sign>0?'Move a little lower':'Move a little higher',scale:sign>0?'Move a little closer':'Move a little farther away',roll:sign>0?'Tilt a little left':'Tilt a little right',yaw:sign>0?'Turn a little left':'Turn a little right',pitch:sign>0?'Lower your chin a little':'Raise your chin a little'};
 const ready=error<=.25;
 return {ready,progress,message:ready?'Position matched. Hold comfortably here.':hints[field]+'. Keep both eyes visible.'};
}
// Suggested poses are useful DIRECTIONS, not six independently achievable
// coordinates. A head turn also shifts the nose and apparent eye spacing.
// Fit the five-point map at the actual pose, rather than forcing those
// coupled measurements to equal an artificial target in every dimension.
export function capturePositionFeedback(feature,plan){
 const feedback=headGuideFeedback(feature,plan);
 if(!plan||!feature||!plan.fields.every(k=>Number.isFinite(feature[k]))||feature.scale<=0)return {...feedback,ready:false};
 const movement=delta(feature,plan.reference,plan.fields),remaining=delta(plan.target,feature,plan.fields);
 const intended=plan.vector.map((v,i)=>({v,i})).filter(({v})=>Math.abs(v)>.01);
 const fractions=intended.map(({v,i})=>movement[i]/v);
 const ready=fractions.length>0&&fractions.every(v=>v>=.45&&v<=1.8)&&movement.every(v=>Math.abs(v)<=2.2);
 const progress=Math.max(0,Math.min(1,Math.min(...fractions)/.8));
 const worst=intended.sort((a,b)=>Math.abs(remaining[b.i])-Math.abs(remaining[a.i]))[0];
 // For a suggested sideways movement, a small coupled chin movement should
// not repeatedly redirect the person away from the useful sideways target.
 const directionPlan=worst?{...plan,fields:[plan.fields[worst.i]],vector:[plan.vector[worst.i]]}:plan;
 const direction=headGuideFeedback(feature,directionPlan).message;
 return {...feedback,ready,progress,message:ready?'Close enough. Hold comfortably here.':direction};
}
export class HeadCaptureGuide{
 constructor(){this.reset();}
 reset(){this.samples=[];this.lastAt=null;this.autoMs=0;this.eyeGap=null;}
 update(feature,plan,entries,at,{eyesReady=false,manual=false}={}){
  const empty=message=>({captureReady:false,autoStart:false,stable:false,progress:0,holdProgress:0,message,head:feature});
  if(!Number.isFinite(at)){this.reset();return empty('Waiting for the camera.');}
  const dt=this.lastAt===null?0:at-this.lastAt;
  if(dt<=0||dt>250){this.samples=[];this.autoMs=0;}
  this.lastAt=at;
  const fields=plan?.fields||[...baseFields,...['yaw','pitch'].filter(k=>Number.isFinite(feature?.[k]))];
  if(!feature||!fields.every(k=>Number.isFinite(feature[k]))||feature.scale<=0){this.autoMs=0;this.samples=[];return empty('Face the camera.');}
  this.samples.push({head:{...feature},at,eyesReady});this.samples=this.samples.filter(s=>at-s.at<=700);
  const center=Object.fromEntries(fields.map(k=>[k,quantile(this.samples.map(s=>s.head[k]),.5)]));
  const deviations=this.samples.map(s=>delta(s.head,center,fields));
  const scatter=fields.map((_,i)=>quantile(deviations.map(v=>Math.abs(v[i])),.9));
  const stable=this.samples.length>=8&&at-this.samples[0].at>=550&&scatter.every(v=>v<=.22)&&norm(scatter)<=.38;
  const fraction=this.samples.filter(s=>s.eyesReady).length/this.samples.length;
  const different=entries.every(e=>norm(delta(center,e.model.head,fields.filter(k=>Number.isFinite(e.model.head[k]))))>.25);
  // The explicit button can start capture once eyes are clear. The point
  // collector still waits for settled samples. Only AUTO start needs the
  // stronger stability window, so noise cannot trap the person at this guide.
  const captureReady=eyesReady&&fraction>=.6&&this.samples.length>=4&&at-this.samples[0].at>=150&&different;
  const feedback=manual?{ready:true,progress:1,message:'Hold comfortably here.'}:capturePositionFeedback(center,plan);
  if(eyesReady)this.eyeGap=null;else this.eyeGap??=at;
  if(captureReady&&stable&&fraction>=.75&&feedback.ready&&!manual)this.autoMs+=Math.max(0,Math.min(100,dt));
  else if(!stable||!feedback.ready||(this.eyeGap!==null&&at-this.eyeGap>200))this.autoMs=0;
  const message=!eyesReady?'Open both eyes.':!different?'Move a little to add another position.':!stable?'Hold comfortably for a moment.':feedback.ready&&!manual?'Hold here. Starting five points…':feedback.message;
  return {captureReady,autoStart:captureReady&&feedback.ready&&!manual&&this.autoMs>=450,stable,progress:feedback.progress,holdProgress:Math.min(1,this.autoMs/450),message,head:center};
 }
}
// Revisit an existing measured pose without fitting or overwriting anything.
// Pin the chosen target while the person lines up, instead of chasing whichever
// saved position happens to be nearest in each noisy camera frame.
export function savedPositionReturnPlan(entries,{feature=null,preferredId=null,targetId=null,allowUnverified=false}={}){
 const eligible=entries.slice(0,MAX_HEAD_POSITIONS).filter(e=>validModel(e.model)&&(e.validation?.passed===true||allowUnverified));
 if(!eligible.length)return null;
 const fieldsFor=e=>[...baseFields,...['yaw','pitch'].filter(k=>Number.isFinite(e.model.head[k]))];
 const distance=e=>feature&&fieldsFor(e).every(k=>Number.isFinite(feature[k]))&&feature.scale>0?norm(delta(e.model.head,feature,fieldsFor(e))):Infinity;
 const ranked=[...eligible].sort((a,b)=>distance(a)-distance(b)||Number(b.id===preferredId)-Number(a.id===preferredId)||a.id-b.id);
 const entry=eligible.find(e=>e.id===targetId)||ranked[0],fields=fieldsFor(entry);
 return {entry,fields,target:{...entry.model.head},reference:{...entry.model.head},vector:fields.map(()=>1),label:`Saved position ${entry.id}`,ids:eligible.map(e=>e.id)};
}
export function savedPositionFeedback(feature,plan){
 const feedback=headGuideFeedback(feature,plan);
 if(!plan||!feature||!plan.fields.every(k=>Number.isFinite(feature[k]))||feature.scale<=0)return {...feedback,ready:false};
 const remaining=delta(plan.target,feature,plan.fields),error=norm(remaining);
 const ready=error<=.6&&remaining.every(v=>Math.abs(v)<=.55);
 return {...feedback,ready,error,progress:Math.max(0,Math.min(1,1-error/2)),message:ready?'Position matched. Hold here.':feedback.message};
}
// Before a map is checked, the head goes back to where it was when the map was
// calibrated: a check made with the head elsewhere measures the wrong thing.
// The plan has the shape of a saved-position plan, so the same drawing and the
// same words ("Move a little higher") can guide the way.
export function calibrationReturnPlan(model){
 const head=model?.head;
 if(!head||!baseFields.every(k=>Number.isFinite(head[k]))||!(head.scale>0))return null;
 const fields=[...baseFields,...['yaw','pitch'].filter(k=>Number.isFinite(head[k]))];
 return {fields,target:{...head},reference:{...head},vector:fields.map(()=>1)};
}
// In position when every head reading is within this share of its limit (at 1
// selection would pause): clearly inside the map's range, not just at its edge.
export const RETURN_WITHIN=.7;
export function calibrationReturnFeedback(feature,plan,within=RETURN_WITHIN){
 const feedback=headGuideFeedback(feature,plan);
 if(!plan||!feature||!plan.fields.every(k=>Number.isFinite(feature[k]))||feature.scale<=0)return {ready:false,worst:Infinity,progress:0,message:feedback.message};
 const worst=Math.max(...delta(plan.target,feature,plan.fields).map(Math.abs)),ready=worst<=within;
 return {ready,worst,progress:Math.max(0,Math.min(1,1-(worst-within)/2)),message:ready?'In position. Hold here.':feedback.message.replace(' Keep both eyes visible.','')};
}
export class HeadReturnGuide{
 constructor(){this.reset();}
 reset(){this.visible=false;this.plan=null;this.lostSince=null;this.matchedSince=null;this.lastAt=null;this.snoozeUntil=0;}
 dismiss(now){this.reset();this.snoozeUntil=now+15000;}
 update(feature,entries,now,{reason='usable',eyesReady=false,supported=false,allowUnverified=false,preferredId=null,force=false,auto=true}={}){
  if(!Number.isFinite(now)){this.reset();return {visible:false,complete:false};}
  if(this.lastAt!==null&&(now<=this.lastAt||now-this.lastAt>250))this.matchedSince=null;
  this.lastAt=now;
  const lost=['head-position','head-reacquiring','eyes-unavailable','eye-features'].includes(reason);
  if(lost)this.lostSince??=now;else this.lostSince=null;
  if(!this.visible&&!force&&(!auto||now<this.snoozeUntil||this.lostSince===null||now-this.lostSince<1200))return {visible:false,complete:false};
  const plan=savedPositionReturnPlan(entries,{feature,preferredId,targetId:this.plan?.entry.id,allowUnverified});
  if(!plan){this.reset();return {visible:false,complete:false};}
  this.plan=plan;this.visible=true;
  const feedback=savedPositionFeedback(feature,plan),matched=feedback.ready&&eyesReady&&supported;
  if(matched)this.matchedSince??=now;else this.matchedSince=null;
  const held=matched?Math.max(0,now-this.matchedSince):0;
  return {visible:true,plan,...feedback,ready:matched,complete:matched&&held>=750,holdProgress:matched?Math.min(1,held/750):0};
 }
 next(entries,feature,now,options={}){
  const plan=savedPositionReturnPlan(entries,{...options,feature,targetId:this.plan?.entry.id});
  if(!plan)return null;
  const index=plan.ids.indexOf(plan.entry.id),id=plan.ids[(index+1)%plan.ids.length];
  this.plan=savedPositionReturnPlan(entries,{...options,feature,targetId:id});this.visible=true;this.matchedSince=null;this.lastAt=now;
  return this.plan;
 }
}
function simplex(v){
 const sorted=[...v].sort((a,b)=>b-a);let sum=0,theta=0;
 for(let i=0;i<sorted.length;i++){sum+=sorted[i];const next=(sum-1)/(i+1);if(sorted[i]>next)theta=next;}
 return v.map(x=>Math.max(0,x-theta));
}
function convexWeights(vectors){
 // Locally supported convex regression. Nonnegative weights sum to one;
 // nearby anchors are preferred. This handles collinear/sparse pose banks
 // without inverting an ill-conditioned matrix or using negative weights.
 const distances=vectors.map(v=>dot(v,v)),n=vectors.length;
 if(Math.min(...distances)<1e-12)return distances.map(d=>d===Math.min(...distances)?1:0).map((w,_,all)=>w/all.reduce((s,v)=>s+v,0));
 const matrix=vectors.map((a,i)=>vectors.map((b,j)=>dot(a,b)+(i===j?1e-5:0)));
 const lipschitz=Math.max(...matrix.map(row=>row.reduce((s,v)=>s+Math.abs(v),0)),1e-5);
 const initial=distances.map(d=>1/(d+.01)**2),total=initial.reduce((s,v)=>s+v,0);
 let w=initial.map(v=>v/total),y=[...w],t=1;
 for(let iteration=0;iteration<240;iteration++){
  const next=simplex(y.map((v,i)=>v-(dot(matrix[i],y)+.0005*distances[i])/lipschitz));
  const nt=(1+Math.sqrt(1+4*t*t))/2;
  y=next.map((v,i)=>v+(t-1)/nt*(v-w[i]));w=next;t=nt;
 }
 const totalWeight=w.reduce((s,v)=>s+v,0);return w.map(v=>v/totalWeight);
}
// Estimate between locally supported poses. The saved models and their
// measured check results are immutable; an interpolated estimate is NOT a
// newly passed accuracy check. In particular, do not interpolate model
// coefficients: maps can have different bases and normalization parameters.
export function estimateHeadPositions(feature,entries,{allowUnverified=false,useCompensation=true}={}){
 const eligible=entries.slice(0,MAX_HEAD_POSITIONS).filter(e=>validModel(e.model)&&(e.validation?.passed===true||allowUnverified));
 const empty=reason=>({entry:null,point:null,raw:null,reason,weights:[],interpolated:false});
 if(!feature||!baseFields.every(k=>Number.isFinite(feature[k]))||feature.scale<=0)return empty('eyes-unavailable');
 if(!eligible.length)return empty('no-model');
 const fields=[...baseFields,...['yaw','pitch'].filter(k=>eligible.every(e=>Number.isFinite(e.model.head[k])))];
 if(!fields.every(k=>Number.isFinite(feature[k])))return empty('head-position');
 const ranked=eligible.map(entry=>({entry,vector:delta(entry.model.head,feature,fields)})).map(r=>({...r,distance:norm(r.vector)})).sort((a,b)=>a.distance-b.distance||a.entry.id-b.entry.id);
 // A distant calibration cannot bridge an arbitrary, unmeasured gap. Add a
 // position in that gap instead. Limit both distance from the current pose
 // and pairwise span; 3 normalized units is 15% frame width for x alone.
 const nearby=[];
 for(const r of ranked)if(r.distance<=3&&nearby.every(p=>Math.max(...delta(r.entry.model.head,p.entry.model.head,fields).map(Math.abs))<=3.1))nearby.push(r);
 let sources=[],residual=null;
 if(nearby.length>=2){
  const weights=convexWeights(nearby.map(r=>r.vector));
  residual=norm(fields.map((_,j)=>weights.reduce((s,w,i)=>s+w*nearby[i].vector[j],0)));
  // Reject poses well outside the locally measured span, including a new
  // rotation when the saved positions only covered sideways translation.
  const remaining=fields.map((_,j)=>weights.reduce((s,w,i)=>s+w*nearby[i].vector[j],0));
  // Small errors in several measured head coordinates should not collapse a
  // supported blend into a single map. Keep each axis bounded separately.
  if(residual<=.5&&remaining.every(v=>Math.abs(v)<=.25))sources=nearby.map((r,i)=>({...r,weight:weights[i]})).filter(r=>r.weight>1e-6);
 }
 if(!sources.length){
  const single=ranked.find(r=>headRejections(feature,r.entry.model).length===0);
  if(!single)return empty('head-position');
  sources=[{...single,weight:1}];residual=null;
 }
 const sum=sources.reduce((s,r)=>s+r.weight,0);sources.forEach(r=>r.weight/=sum);
 const dominant=[...sources].sort((a,b)=>b.weight-a.weight||a.entry.id-b.entry.id)[0];
 const weights=sources.map(r=>({id:r.entry.id,weight:r.weight}));
 const info={entry:dominant.entry,weights,residual,interpolated:sources.some(r=>r.entry.id!==dominant.entry.id&&r.weight>.01)};
 const compensation=useCompensation?compensationFor(entries,eligible):null;
 const supported=compensation?estimateHeadPositions(feature,eligible.filter(e=>e.model.anchors),{allowUnverified,useCompensation:false}):null;
 if(compensation&&supported?.entry){
  // The support test above still limits extrapolation. Only its head-bound
  // check is supplied by the bank; the learned correction sees actual pose.
  const result=predictDetailed(feature,{...compensation.model,head:{...feature}});
  return {...info,...result,entry:result.raw?dominant.entry:null,compensated:true,compensationError:compensation.heldOutError,positionError:compensation.positionError??null};
 }
 // Evaluate each local map at its own head reference, plus the small pose
 // residual not covered by the blend. Keep the ACTUAL eye readings. Otherwise
 // a source's learned local head correction is extrapolated across the whole
 // bank, on top of the interpolation, and can introduce a second correction.
 // Log scale is transported multiplicatively. A single map is unchanged.
 const reference=Object.fromEntries(fields.map(k=>[k,k==='scale'?Math.exp(sources.reduce((s,r)=>s+r.weight*Math.log(r.entry.model.head.scale),0)):sources.reduce((s,r)=>s+r.weight*r.entry.model.head[k],0)]));
 const results=sources.map(r=>{
  const local={...feature};
  for(const k of fields)local[k]=k==='scale'?r.entry.model.head.scale*feature.scale/reference.scale:r.entry.model.head[k]+feature[k]-reference[k];
  return predictDetailed(local,r.entry.model);
 });
 // Preserve finite off-screen estimates in the blend and in accuracy reports.
 const invalid=results.find(r=>!r.raw);
 if(invalid)return {...empty(invalid.reason),...info,entry:null};
 const raw={x:results.reduce((s,r,i)=>s+r.raw.x*sources[i].weight,0),y:results.reduce((s,r,i)=>s+r.raw.y*sources[i].weight,0)};
 if(!Number.isFinite(raw.x)||!Number.isFinite(raw.y))return {...empty('invalid-estimate'),...info,entry:null};
 // Legacy maps may not store yaw/pitch. Their presence must not disable
 // orientation checks belonging to the newer contributors in a mixed bank.
 const headReasons=[...new Set(results.flatMap(r=>r.headReasons||[]))];
 if(headReasons.length)return {...info,entry:null,raw,point:null,reason:'head-position',headReasons};
 const point=screenPoint(raw);
 return {...info,raw,point,reason:point?'usable':'outside-screen'};
}
// One acquisition gate for the whole continuous map. Crossing the halfway
// point between anchors must not restart the filter or selection countdown.
export class HeadPositionSelector{
 constructor(){this.reset();}
 reset(){this.active=false;this.anchor=null;this.lastFeature=null;this.since=null;this.lastAt=null;this.signature=null;this.resume=null;}
 update(feature,entries,at,{allowUnverified=false}={}){
  const paused=reason=>({entry:null,point:null,raw:null,reason,weights:[],switched:false});
  if(!Number.isFinite(at)){this.reset();return paused('eyes-unavailable');}
  const signature=entries.filter(e=>allowUnverified||e.validation?.passed).map(e=>`${e.id}:${e.savedAt||0}`).join(',')+':'+allowUnverified;
  if(signature!==this.signature)this.reset();this.signature=signature;
  if(this.lastAt!==null&&(at<=this.lastAt||at-this.lastAt>250))this.reset();
  this.lastAt=at;this.signature=signature;
  const fields=[...baseFields,...['yaw','pitch'].filter(k=>Number.isFinite(feature?.[k])&&Number.isFinite(this.lastFeature?.[k]))];
  const moved=this.lastFeature&&feature&&baseFields.every(k=>Number.isFinite(feature[k]))&&norm(delta(feature,this.lastFeature,fields))>.75;
  if(this.active&&(!feature||moved))this.resume={feature:{...this.lastFeature},at,stableAt:null,count:0};
  if(this.resume&&at-this.resume.at>300)this.resume=null;
  const result=estimateHeadPositions(feature,entries,{allowUnverified});
  if(!result.entry){this.active=false;this.anchor=null;this.lastFeature=null;this.since=null;return {...result,switched:false};}
  if(this.resume){
   const recoveryFields=[...baseFields,...['yaw','pitch'].filter(k=>Number.isFinite(this.resume.feature[k]))];
   if(norm(delta(feature,this.resume.feature,recoveryFields))<=.35){
    this.resume.stableAt??=at;this.resume.count++;
    if(this.resume.count<3||at-this.resume.stableAt<80)return paused('head-reacquiring');
    this.resume=null;this.active=true;this.lastFeature={...feature};return {...result,switched:false};
   }
   this.resume.stableAt=null;this.resume.count=0;
  }
  if(moved){
   // Do not feed an abrupt head-motion frame to the pointer or dwell. Resume
   // from fresh, coherent readings rather than the previous fixation anchor.
   this.active=false;this.since=null;
  }
  this.lastFeature={...feature};
  if(this.active)return {...result,switched:false};
  const settling=this.anchor?delta(feature,this.anchor,fields):[];
  if(this.since===null||norm(settling)>.6||settling.some(v=>Math.abs(v)>.45)){this.since=at;this.anchor={...feature};}
  if(at-this.since<400)return paused('head-reacquiring');
  this.resume=null;this.active=true;return {...result,switched:true};
 }
}
