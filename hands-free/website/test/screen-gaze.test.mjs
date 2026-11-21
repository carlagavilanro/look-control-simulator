import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAIN_TARGETS,CHECK_TARGETS,ALIGN_TARGETS,calibrationTargets,fitAlignment,predictDetailed,settledSummary,fitCalibration,validateCalibration,predict,screenFeature,TargetDwell,GazeFilter,subdivide,sameSetup} from '../public/screen-gaze.mjs';
function feature(x,y,j=0){return {h:.25+.4*x+j,v:-.075+.15*y+j*.25,x:.5,y:.45,scale:.3,roll:0};}
const group=target=>({target,samples:Array.from({length:30},(_,i)=>feature(...target,(i%5-2)*.0002))});
test('thirteen-point model predicts independent coordinates and checks held-out targets',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group));const p=predict(feature(.27,.69),m);
 assert.ok(Math.abs(p.x-.27)<.01);assert.ok(Math.abs(p.y-.69)<.01);
 const v=validateCalibration(CHECK_TARGETS.map(group),m,1920,1080);assert.ok(v.passed);assert.ok(v.meanPixels<15);
});

test('a noisy training map proceeds to independent verification instead of a worst-point loop',()=>{
 const g=TRAIN_TARGETS.map(group);g[3]={target:TRAIN_TARGETS[3],samples:group([.25,.75]).samples};
 const m=fitCalibration(g);assert.ok(validModel(m));assert.equal(m.trainingReliable,false);assert.ok(m.crossValidation>.10);
 const shifted=CHECK_TARGETS.map(target=>({...group([target[0]+.3,target[1]]),target}));
 assert.equal(validateCalibration(shifted,m,1280,720).passed,false);
 g[3]=group(TRAIN_TARGETS[3]);assert.ok(validModel(fitCalibration(g)));
});

test('weak movement fails and changed head positions remain gated during independent verification',()=>{
 let error;try{fitCalibration(TRAIN_TARGETS.map(t=>({...group(t),samples:group([t[0],.5]).samples})));}catch(e){error=e;}
 assert.equal(error.calibration.reason,'range');assert.ok(error.calibration.pointIndices.length>0);
 const g=TRAIN_TARGETS.map(group);g[6].samples=g[6].samples.map(f=>({...f,x:.7}));
 const m=fitCalibration(g);assert.ok(m.trainingHeadMismatches>=1);assert.equal(predict(g[6].samples[0],m),null);
});

test('head-motion compensation improves independent gaze estimates without using check targets to fit',()=>{
 const moved=(x,y,px,py)=>({...feature(x,y),h:.25+.4*x+.8*(px-.5),v:-.075+.15*y+.45*(py-.45),x:px,y:py,yaw:.5,pitch:.25});
 const g=TRAIN_TARGETS.map((target,i)=>({target,samples:Array.from({length:60},(_,j)=>moved(...target,.5+.022*Math.sin(i*2.3)+.012*Math.sin(j*.5),.45+.018*Math.cos(i*1.7)+.010*Math.cos(j*.7)))}));
 const m=fitCalibration(g);assert.equal(m.version,3);assert.ok(validModel(m));assert.ok(m.crossValidation<m.baselineError*.5);
 const checks=CHECK_TARGETS.map((target,i)=>({target,samples:Array.from({length:50},(_,j)=>moved(...target,.5+.025*Math.sin(j*.6+i),.45+.024*Math.cos(j*.4+i)))}));
 const v=validateCalibration(checks,m,1920,1080);assert.ok(v.passed);assert.ok(v.mean<.02);
 assert.equal(validModel({...m,poseCorrection:{...m.poseCorrection,indices:[0,0,2,3]}}),false);
 assert.equal(predict({...checks[0].samples[0],x:.75},m),null);
});
test('poor held-out accuracy fails even when calibration fits',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group));const shifted=CHECK_TARGETS.map(target=>({...group([target[0]+.22,target[1]]),target}));
 assert.equal(validateCalibration(shifted,m,1920,1080).passed,false);
});
test('rejects weak vertical movement, inadequate samples, blinks and missing eyes',()=>{
 assert.throws(()=>fitCalibration(TRAIN_TARGETS.map(t=>({...group(t),samples:Array.from({length:30},()=>feature(t[0],.5))}))),/distinct/);
 assert.throws(()=>fitCalibration(TRAIN_TARGETS.map(t=>({...group(t),samples:[feature(...t)]}))),/samples/);
 assert.equal(screenFeature(null),null);assert.equal(screenFeature(Array.from({length:478},()=>({x:.5,y:.5,z:0}))),null);
});
test('head drift and nonfinite features never produce a usable pointer',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group));assert.equal(predict({...feature(.5,.5),x:.7},m),null);assert.equal(predict({...feature(.5,.5),h:NaN},m),null);
});
test('one-second dwell fires at one second, once, then requires release',()=>{
 const d=new TargetDwell();assert.equal(d.ms,1000);
 for(let t=0;t<1000;t+=50)assert.equal(d.update(1,t),null);
 assert.equal(d.update(1,1000),1);
 for(let t=1050;t<=4500;t+=50)assert.equal(d.update(1,t),null);
 for(let t=4550;t<=5100;t+=50)assert.equal(d.update(null,t),null);
 for(let t=5150;t<6150;t+=50)assert.equal(d.update(1,t),null);
 assert.equal(d.update(1,6150),1);
});
test('lost, stale, backward-time frames and changing targets cannot complete a dwell',()=>{
 const d=new TargetDwell();for(let t=0;t<900;t+=50)d.update(2,t);assert.equal(d.update(2,3000),null);assert.equal(d.progress,0);
 d.update(null,3050);assert.equal(d.update(2,3100),null);assert.equal(d.progress,0);assert.equal(d.update(3,3150),null);assert.equal(d.progress,0);
 assert.equal(d.update(3,200),null);assert.equal(d.progress,0);
});
test('three zoom levels map to a 1/27-width region without escaping the original screen',()=>{
 let r={x:0,y:0,w:1,h:1};for(const n of [8,8,8])r=subdivide(r,n);assert.ok(Math.abs(r.w-1/27)<1e-9);assert.ok(Math.abs(r.x+r.w-1)<1e-9);assert.throws(()=>subdivide(r,9));
});
test('smoothing resets on loss and camera/display changes invalidate saved setup',()=>{
 const f=new GazeFilter();f.update({x:.2,y:.2},1);assert.equal(f.update(null,20),null);assert.deepEqual(f.update({x:.8,y:.8},30),{x:.8,y:.8});
 const s={deviceId:'cam',width:1280,height:720,screenWidth:1920,screenHeight:1080,pixelRatio:1};assert.ok(sameSetup(s,{...s}));assert.equal(sameSetup(s,{...s,pixelRatio:1.5}),false);
});

// Regression cases for accuracy, rather than an apparent fit to the training dots.
import {validModel,summarize,FixationGate,selectionMargin,containedTarget,chooseLayout,zoomComplete} from '../public/screen-gaze.mjs';

test('new calibration rejects obsolete models and checks different screen locations',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group));assert.ok(validModel(m));assert.equal(validModel({...m,version:1}),false);
 assert.ok(CHECK_TARGETS.every(p=>!TRAIN_TARGETS.some(t=>t[0]===p[0]&&t[1]===p[1])));
 // Just past an edge counts as that edge, so edge controls are not interrupted;
 // the unclipped estimate is kept for accuracy reports. Further out is rejected.
 const left=predictDetailed(feature(-.01,.5),m),right=predictDetailed(feature(1.01,.5),m);
 assert.equal(left.point.x,0);assert.ok(left.raw.x<0);assert.equal(right.point.x,1);assert.ok(right.raw.x>1);assert.equal(left.reason,'usable');
 assert.equal(predict(feature(-.06,.5),m),null);assert.equal(predict(feature(1.06,.5),m),null);assert.equal(predict(feature(.5,1.06),m),null);
});

test('independent frame errors expose jitter that a median-only check would hide',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group));
 const noisy=CHECK_TARGETS.map(target=>({target,samples:Array.from({length:40},(_,i)=>feature(target[0]+(i%4===0?.22:i%4===1?-.22:0),target[1]))}));
 assert.equal(validateCalibration(noisy,m,1280,720).passed,false);
 const dropout=CHECK_TARGETS.map(t=>({...group(t),samples:[...group(t).samples,...Array(10).fill(null)]}));
 assert.equal(validateCalibration(dropout,m,1280,720).passed,false);
});

test('an isolated bad validation corner cannot hide in an overall average',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group)),g=CHECK_TARGETS.map(group);
 g[0].samples=Array.from({length:30},()=>feature(g[0].target[0]+.19,g[0].target[1]));
 const v=validateCalibration(g,m,390,844);assert.equal(v.passed,false);assert.ok(v.perTarget[0].p90>.15);
});

test('robust training tolerates isolated corrupted frames without learning them',()=>{
 const dirty=TRAIN_TARGETS.map(t=>({target:t,samples:[...group(t).samples,...Array.from({length:5},()=>feature(t[0]+.3,t[1]+.15))]}));
 const m=fitCalibration(dirty),p=predict(feature(.4,.6),m);assert.ok(Math.hypot(p.x-.4,p.y-.6)<.01);
 assert.throws(()=>summarize(Array.from({length:30},(_,i)=>feature(i%2,.5))),/moved/);
});

function curvedFeature(x,y){
 let u=(x-.5)/.4,v=(y-.5)/.4;
 for(let i=0;i<60;i++){u=(x-.5-.065*u*u-.03*u*v)/.4;v=(y-.5-.035*v*v)/.4;}
 return {...feature(.5,.5),h:.45+.16*u,v:.06*v};
}
test('cross-validated curved mapping generalizes to non-training positions',()=>{
 const g=TRAIN_TARGETS.map(target=>({target,samples:Array.from({length:30},()=>curvedFeature(...target))}));
 const m=fitCalibration(g);assert.equal(m.degree,2);
 let sum=0;for(const [x,y] of [[.15,.43],[.63,.15],[.43,.86],[.84,.38]]){const p=predict(curvedFeature(x,y),m);sum+=Math.hypot(p.x-x,p.y-y);}
 assert.ok(sum/4<.012);
});

test('binocular calibration downweights the less consistent eye',()=>{
 const g=TRAIN_TARGETS.map((target,i)=>{const f=feature(...target),bias=Math.sin(i*2.3)*.025;return {target,samples:Array.from({length:30},()=>({...f,lh:f.h,lv:f.v,rh:f.h+bias,rv:f.v+bias*.5}))};});
 const m=fitCalibration(g);assert.equal(m.binocular,true);
 const f=feature(.34,.61),p=predict({...f,lh:f.h,lv:f.v,rh:f.h+.04,rv:f.v+.02},m);
 assert.ok(Math.hypot(p.x-.34,p.y-.61)<.035);
 assert.equal(predict(feature(.5,.5),m),null);
});

test('face rotation is rejected even when nose translation is unchanged',()=>{
 const g=TRAIN_TARGETS.map(t=>({target:t,samples:group(t).samples.map(f=>({...f,yaw:.5,pitch:.25}))})),m=fitCalibration(g);
 assert.equal(predict({...feature(.5,.5),yaw:.63,pitch:.25},m),null);
 assert.ok(predict({...feature(.5,.5),yaw:.51,pitch:.25},m));
});

test('adaptive filtering reduces stationary noise and follows an intentional movement',()=>{
 const filter=new GazeFilter();let rawError=0,filteredError=0;
 for(let i=0;i<90;i++){const x=.4+Math.sin(i*2)*.015,p=filter.update({x,y:.4},i*33);if(i>30){rawError+=(x-.4)**2;filteredError+=(p.x-.4)**2;}}
 assert.ok(filteredError<rawError*.35);
 let p;for(let i=90;i<=96;i++)p=filter.update({x:.8,y:.4},i*33);assert.ok(Math.abs(p.x-.8)<.04);
});

test('short tracking spikes do not pull a settled pointer to another target',()=>{
 const filter=new GazeFilter();
 for(let i=0;i<20;i++)filter.update({x:.4,y:.5},i*33);
 for(let i=20;i<22;i++){
  const p=filter.update({x:.8,y:.1},i*33);
  assert.ok(Math.abs(p.x-.4)<.001&&Math.abs(p.y-.5)<.001);
 }
 for(let i=22;i<28;i++){
  const p=filter.update({x:.4,y:.5},i*33);
  assert.ok(Math.abs(p.x-.4)<.001&&Math.abs(p.y-.5)<.001);
 }
 // A sustained new fixation must still move, even after rejecting a burst.
 let p;for(let i=28;i<36;i++)p=filter.update({x:.8,y:.1},i*33);
 assert.ok(Math.abs(p.x-.8)<.04&&Math.abs(p.y-.1)<.04);
});

test('smoothing does not freeze small deliberate movements or retain stale history',()=>{
 const filter=new GazeFilter();
 for(let i=0;i<30;i++)filter.update({x:.4,y:.5},i*33);
 let p;for(let i=30;i<60;i++)p=filter.update({x:.41,y:.51},i*33);
 assert.ok(Math.abs(p.x-.41)<.001&&Math.abs(p.y-.51)<.001);
 assert.deepEqual(filter.update({x:.8,y:.2},2400),{x:.8,y:.2});
 assert.deepEqual(filter.update({x:.3,y:.7},100),{x:.3,y:.7});
});

test('fixation gate stops a nearly completed dwell during a saccade or tracking loss',()=>{
 const gate=new FixationGate(),d=new TargetDwell();let fired=null;
 for(let t=0;t<1200;t+=33){const p={x:.3,y:.4},stable=gate.update(p,t,{});fired=d.update(stable?1:null,t);assert.equal(fired,null);}
 assert.equal(gate.update({x:.8,y:.4},1215,{}),false);d.update(null,1215);assert.equal(d.progress,0);
 assert.equal(gate.update(null,1248,{}),false);assert.equal(gate.update({x:.8,y:.4},1281,{}),false);
});

test('small-screen controls get fewer columns and uncertain boundaries do not select',()=>{
 const v={radiusX:.06,radiusY:.06},small=chooseLayout(390,844,v),large=chooseLayout(1920,1080,v);
 assert.equal(small.columns,2);assert.ok(small.capacity<large.capacity);
 const r={left:20,top:100,right:200,bottom:300,width:180,height:200},margin=selectionMargin(v,390,844);
 assert.equal(containedTarget({x:25/390,y:200/844},r,390,844,margin),false);
 assert.equal(containedTarget({x:110/390,y:200/844},r,390,844,margin),true);
});

test('adaptive zoom keeps the chosen region inside the desktop and reaches small targets',()=>{
 for(const [width,height,columns,rows] of [[3840,2160,3,3],[390,844,2,3],[1280,720,3,2]]){
  let r={x:0,y:0,w:1,h:1},steps=0;
  while(!zoomComplete(r,width,height)&&steps++<12)r=subdivide(r,columns*rows-1,columns,rows);
  assert.ok(steps<=9);assert.ok(r.w*width<=12&&r.h*height<=12);assert.ok(Math.abs(r.x+r.w-1)<1e-9);assert.ok(Math.abs(r.y+r.h-1)<1e-9);
 }
});

test('eye feature extraction rejects blinks, inconsistent iris rings and insufficient camera detail',()=>{
 const p=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
 function eye(a,b,iris,top,bottom,x){p[a]={x:x-.07,y:.4};p[b]={x:x+.07,y:.4};p[iris]={x,y:.4};p[top]={x,y:.38};p[bottom]={x,y:.42};for(let i=1;i<=4;i++){const t=(i-1)*Math.PI/2;p[iris+i]={x:x+Math.cos(t)*.018,y:.4+Math.sin(t)*.024};}}
 eye(33,133,468,159,145,.27);eye(362,263,473,386,374,.62);p[1]={x:.45,y:.6};
 assert.ok(screenFeature(p,4/3,720));assert.equal(screenFeature(p,4/3,16),null);
 p[159].y=.399;p[145].y=.401;assert.equal(screenFeature(p,4/3,720),null);
 p[159].y=.38;p[145].y=.42;p[469].x+=.3;assert.equal(screenFeature(p,4/3,720),null);
});

test('eye weighting accounts for frame jitter even when both median eye positions agree',()=>{
 const g=TRAIN_TARGETS.map(target=>({target,samples:Array.from({length:40},(_,i)=>{const f=feature(...target),j=Math.sin(i*Math.PI/2)*.025;return {...f,lh:f.h,lv:f.v,rh:f.h+j,rv:f.v+j*.5};})}));
 const m=fitCalibration(g),f=feature(.41,.62),p=predict({...f,lh:f.h,lv:f.v,rh:f.h+.02,rv:f.v+.01},m);
 assert.ok(Math.hypot(p.x-.41,p.y-.62)<.012);
});

test('calibration sequences repeat the center and preserve distinct held-out checks',()=>{
 for(const dense of [false,true]){
  const targets=calibrationTargets(dense);
  assert.equal(targets.length,dense?27:15);
  assert.equal(new Set(targets.map(p=>p.map(v=>v.toFixed(5)).join(','))).size,dense?25:13);
  assert.equal(targets.filter(([x,y])=>x===.5&&y===.5).length,3);
  assert.ok(CHECK_TARGETS.every(p=>!targets.some(t=>Math.hypot(t[0]-p[0],t[1]-p[1])<.001)));
 }
});

test('repeated center observations expose drift without counting as distinct training locations',()=>{
 const targets=calibrationTargets(),g=targets.map(group);
 g.at(-1).samples=g.at(-1).samples.map(f=>({...f,h:f.h+.025}));
 const m=fitCalibration(g);
 assert.equal(m.trainingLocations,13);assert.equal(m.centerRepeatCount,3);assert.ok(m.centerDrift>.04);
});

test('a settling gaze is distinguished from a stable fixation',()=>{
 assert.ok(settledSummary(group([.5,.5]).samples));
 const moving=Array.from({length:40},(_,i)=>feature(.5,.5,i<20?-.008:.008));
 assert.throws(()=>settledSummary(moving),/settling/);
});

test('off-screen and head-rejected predictions are counted and remain in mapping error',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group));
 const off=predictDetailed(feature(1.2,.5),m);assert.equal(off.reason,'outside-screen');assert.ok(off.raw.x>1);assert.equal(off.point,null);
 const shifted=predictDetailed({...feature(.5,.5),x:.6},m);assert.equal(shifted.reason,'head-position');assert.ok(shifted.raw);
 const g=CHECK_TARGETS.map(t=>({target:t,samples:[feature(t[0]+1,t[1]),{...feature(...t),x:.7},null]}));
 const v=validateCalibration(g,m,1000,700);
 assert.equal(v.passed,false);assert.equal(v.validFraction,0);assert.equal(v.estimatedFraction,2/3);
 assert.ok(v.meanPixels>490);assert.equal(v.rejected['outside-screen'],7);assert.equal(v.rejected['head-position'],7);assert.equal(v.rejected['eyes-unavailable'],7);
});

test('five new alignment targets correct drift and still require separate verification',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group));
 const shifted=t=>({target:t,samples:group([t[0]+.12,t[1]-.08]).samples.map(f=>({...f,x:.575}))});
 assert.equal(validateCalibration(CHECK_TARGETS.map(shifted),m,1600,900).passed,false);
 const adjusted=fitAlignment(ALIGN_TARGETS.map(shifted),m);
 assert.ok(validModel(adjusted));assert.equal(adjusted.validation,undefined);
 const v=validateCalibration(CHECK_TARGETS.map(shifted),adjusted,1600,900);assert.equal(v.passed,true);assert.ok(v.meanPixels<5);
 assert.equal(predict({...feature(.4,.6),x:.8},adjusted),null);
 assert.throws(()=>fitAlignment(CHECK_TARGETS.map(shifted),m),/five alignment/);
 assert.throws(()=>fitAlignment(ALIGN_TARGETS.map(t=>({...shifted(t),samples:shifted(t).samples.map(f=>({...f,x:.8}))})),m),/changed too much/);
});

test('alignment cannot turn unmeasured jitter into a passing accuracy result',()=>{
 const m=fitCalibration(TRAIN_TARGETS.map(group)),adjusted=fitAlignment(ALIGN_TARGETS.map(group),m);
 const g=CHECK_TARGETS.map(t=>({target:t,samples:Array.from({length:40},(_,i)=>feature(t[0]+(i%2?.20:-.20),t[1]))}));
 assert.equal(validateCalibration(g,adjusted,1280,720).passed,false);
});

test('looking with the head during training must not become a substitute for eye movement',()=>{
 const binocular=(x,y,j=0)=>{const f=feature(x,y,j);return {...f,lh:f.h,lv:f.v,rh:f.h,rv:f.v};};
 const g=calibrationTargets(true).map((target,i)=>({target,samples:Array.from({length:40},(_,j)=>{
  const f=binocular(...target,.006*Math.sin(i*2.3)+.002*Math.sin(j*1.7));
  return {...f,x:.5+(target[0]-.5)*.08,y:.45+(target[1]-.5)*.08};
 })}));
 const m=fitCalibration(g);
 const check=CHECK_TARGETS.map(target=>({target,samples:Array.from({length:40},(_,j)=>binocular(...target,.001*Math.sin(j)))}));
 const result=validateCalibration(check,m,1600,900);
 assert.ok(result.meanPixels<45,`Head/target correlation led to ${result.meanPixels}px independent error`);
 assert.ok(result.passed);
});

function headDependentModel(){
 const base=fitCalibration(TRAIN_TARGETS.map(group));
 return {...base,version:4,degree:1,binocular:true,featureIndices:[0,1,2,3,4,5],
  featureCenters:[.45,0,.45,0,.5,.45],featureScales:[.2,.075,.2,.075,.05,.05],
  weights:[[.5,.25,0,.25,0,1.8,0],[.5,0,.25,0,.25,0,2.5]]};
}
function repairSamples(target){
 return {target,samples:Array.from({length:50},(_,j)=>{
  const f=feature(...target,.0002*Math.sin(j*1.4));
  return {...f,lh:f.h,lv:f.v,rh:f.h,rv:f.v,x:.515+.005*Math.sin(j*.7),y:.438+.005*Math.cos(j*.6)};
 })};
}
test('five-point repair replaces a head-dependent saved map when fresh eye measurements generalize better',()=>{
 const bad=headDependentModel(),before=validateCalibration(CHECK_TARGETS.map(repairSamples),bad,1600,900);
 assert.ok(before.meanPixels>300);assert.ok(!before.passed);
 const repaired=fitAlignment(ALIGN_TARGETS.map(repairSamples),bad);
 assert.ok(repaired.alignment.rebuilt);assert.equal(repaired.validation,undefined);
 const after=validateCalibration(CHECK_TARGETS.map(repairSamples),repaired,1600,900);
 assert.ok(after.passed);assert.ok(after.meanPixels<10);
 assert.equal(predict({...repairSamples([.5,.5]).samples[0],x:.8},repaired),null);
});

test('explicit eye-only repair removes head correction and still needs independent verification',()=>{
 const base=fitCalibration(TRAIN_TARGETS.map(group));
 const m={...base,version:3,poseCorrection:{indices:[0,1,2,3],reference:[.5,.45,.3,0],weights:[[.1,0,0,0],[0,.08,0,0]]}};
 const automatic=fitAlignment(ALIGN_TARGETS.map(group),m);
 assert.ok(automatic.poseCorrection);
 const eyesOnly=fitAlignment(ALIGN_TARGETS.map(group),m,{eyeOnly:true});
 assert.equal(eyesOnly.version,2);assert.equal(eyesOnly.poseCorrection,undefined);
 assert.equal(eyesOnly.repairComparison.eyeOnlyRequested,true);assert.equal(eyesOnly.validation,undefined);
 assert.ok(validateCalibration(CHECK_TARGETS.map(group),eyesOnly,1280,720).passed);
 const shifted=CHECK_TARGETS.map(target=>({...group([target[0]+.25,target[1]]),target}));
 assert.equal(validateCalibration(shifted,eyesOnly,1280,720).passed,false);
 assert.throws(()=>fitAlignment(ALIGN_TARGETS.map(target=>({...group([.5,.5]),target})),m,{eyeOnly:true}),/could not form an eye-only map/);
});

test('five-point eye-only recovery learns a new head position without the old 27-point calibration',()=>{
 const previous=fitCalibration(TRAIN_TARGETS.map(group)),snapshot=JSON.stringify(previous);
 const relocated=target=>({...group(target),samples:group(target).samples.map(f=>({...f,x:.67,y:.59,scale:.43,roll:.28}))});
 assert.equal(predictDetailed(relocated([.5,.5]).samples[0],previous).reason,'head-position');
 assert.throws(()=>fitAlignment(ALIGN_TARGETS.map(relocated),previous),/Realign after moving/);
 const repaired=fitAlignment(ALIGN_TARGETS.map(relocated),previous,{eyeOnly:true});
 assert.equal(repaired.repairComparison.anchorCount,5);assert.equal(repaired.repairComparison.eyeOnlyRequested,true);
 assert.equal(repaired.poseCorrection,undefined);assert.equal(repaired.validation,undefined);
 assert.equal(validateCalibration(CHECK_TARGETS.map(relocated),repaired,1280,720).passed,true);
 assert.equal(JSON.stringify(previous),snapshot);
 // A new map is local to the new position; stale pose protection is not removed.
 assert.equal(predictDetailed(group([.5,.5]).samples[0],repaired).reason,'head-position');
 const unstable=ALIGN_TARGETS.map(relocated);unstable[0].samples=unstable[0].samples.map(f=>({...f,x:.9}));
 assert.throws(()=>fitAlignment(unstable,previous,{eyeOnly:true}),/position changed during these five points/);
 assert.equal(JSON.stringify(previous),snapshot);
});

test('diagnostics identify head rejection components and correction contribution without relaxing checks',()=>{
 const base=fitCalibration(TRAIN_TARGETS.map(group));
 const m={...base,version:3,head:{...base.head,yaw:.5,pitch:.25},poseCorrection:{indices:[0,1,2,3],reference:[.5,.45,.3,0],weights:[[.1,0,0,0],[0,0,0,0]]}};
 const checks=CHECK_TARGETS.map(target=>({target,samples:group(target).samples.map(f=>({...f,x:.51,yaw:.5,pitch:.25}))}));
 const diagnostic=validateCalibration(checks,m,1000,700);
 assert.ok(diagnostic.perTarget.every(p=>p.headCorrectionP90Pixels>=49&&p.headCorrectionP90Pixels<=51));
 const rejected=validateCalibration(checks.map(g=>({...g,samples:g.samples.map(f=>({...f,x:.56,yaw:.62}))})),m,1000,700);
 assert.equal(rejected.passed,false);assert.equal(rejected.validFraction,0);
 assert.ok(rejected.perTarget.every(p=>p.headRejections.x===30&&p.headRejections.yaw===30));
});

test('Back stays large enough for the measured uncertainty, including narrow displays',async()=>{
 const {controlGeometry}=await import('../public/screen-gaze.mjs');
 for(const [w,h] of [[390,844],[1280,720],[1920,1080]]){
  const v={radiusX:.06,radiusY:.08},g=controlGeometry(w,h,v),m=selectionMargin(v,w,h),button={left:w-g.cancelWidth-12,right:w-12,top:h-g.footer+12,bottom:h-12,width:g.cancelWidth,height:g.footer-24};
  assert.ok(containedTarget({x:(button.left+button.right)/2/w,y:(button.top+button.bottom)/2/h},button,w,h,m));
  const layout=chooseLayout(w,h,v);assert.ok((h-g.top-g.bottom)/layout.rows>m.y*2+20);
 }
});
