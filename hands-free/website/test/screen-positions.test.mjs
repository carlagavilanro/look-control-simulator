import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAIN_TARGETS,CHECK_TARGETS,fitCalibration,validateCalibration,predictDetailed,TargetDwell} from '../public/screen-gaze.mjs';
import {savedHeadPositions,HeadPositionSelector,resetDwellForPosition,estimateHeadPositions,MAX_HEAD_POSITIONS} from '../public/screen-positions.mjs';
const feature=(x,y,head=.5)=>({h:.25+.4*x+(head-.5)*1.4,v:-.075+.15*y,x:head,y:.45,scale:.3,roll:0});
const group=(target,head)=>({target,samples:Array.from({length:32},()=>feature(...target,head))});
const entry=(id,head)=>{const model=fitCalibration(TRAIN_TARGETS.map(t=>group(t,head)));return {id,model,validation:validateCalibration(CHECK_TARGETS.map(t=>group(t,head)),model,1440,960)};};
const bank=[entry(1,.5),entry(2,.58),entry(3,.42)];
const feed=(s,head,start,end,opts)=>{let r;for(let t=start;t<=end;t+=50)r=s.update(head===null?null:feature(.3,.7,head),bank,t,opts);return r;};
test('legacy single-position records and multiple measured maps survive serialization',()=>{
 assert.equal(savedHeadPositions(bank[0]).length,1);
 assert.deepEqual(savedHeadPositions(JSON.parse(JSON.stringify({headPositions:bank}))),JSON.parse(JSON.stringify(bank.map(e=>({...e,savedAt:0})))));
 assert.equal(savedHeadPositions({...bank[0],headPositions:[bank[0],bank[0]]}).length,1);
});
test('returning from a look-away automatically chooses the correct independently calibrated map',()=>{
 const s=new HeadPositionSelector(),snapshot=JSON.stringify(bank);
 assert.equal(feed(s,.5,0,350).entry,null);assert.equal(feed(s,.5,400,400).entry.id,1);
 assert.equal(feed(s,null,450,1200).entry,null);
 assert.equal(feed(s,.58,1250,1600).entry,null);
 const r=feed(s,.58,1650,1650);assert.equal(r.entry.id,2);assert.equal(r.switched,true);
 const p=predictDetailed(feature(.3,.7,.58),r.entry.model);assert.ok(Math.hypot(p.point.x-.3,p.point.y-.7)<.01);
 assert.equal(feed(s,null,1700,2000).entry,null);
 assert.equal(feed(s,.42,2050,2450).entry.id,3);
 assert.equal(feed(s,.5,2500,2900).entry.id,1);
 assert.equal(JSON.stringify(bank),snapshot);
});
test('unmeasured positions and nonfinite frames never select the nearest map outside its limits',()=>{
 const s=new HeadPositionSelector();feed(s,.5,0,500);
 assert.equal(feed(s,.8,550,2000).entry,null);
 assert.equal(s.update({...feature(.3,.7),roll:.5},bank,2050).entry,null);
});
test('unverified positions are opt-in and never become passed by being selected',()=>{
 const failed=JSON.parse(JSON.stringify(bank));failed[1].validation.passed=false;
 const s=new HeadPositionSelector();for(let t=0;t<1000;t+=50)assert.equal(s.update(feature(.3,.7,.58),failed,t).entry,null);
 let r;for(let t=1000;t<=1500;t+=50)r=s.update(feature(.3,.7,.58),failed,t,{allowUnverified:true});
 assert.equal(r.entry.id,2);assert.equal(r.entry.validation.passed,false);
 assert.equal(s.update(feature(.3,.7,.58),failed,1550).entry,null);
});
test('continuous movement between maps does not reset the pointer or dwell at their boundary',()=>{
 const s=new HeadPositionSelector();feed(s,.5,0,500);
 let maxError=0;
 for(let t=550;t<=2550;t+=50){
  const head=.5+.08*(t-550)/2000,r=feed(s,head,t,t);
  assert.ok(r.entry);assert.equal(r.switched,false);
  maxError=Math.max(maxError,Math.hypot(r.point.x-.3,r.point.y-.7));
 }
 assert.ok(maxError<.004,`intermediate error ${maxError}`);
});

test('a tracking gap, invalid clock or changed map cannot finish a partial one-second dwell',()=>{
 const s=new HeadPositionSelector(),dwell=new TargetDwell();
 for(let t=0;t<=1150;t+=50){const r=s.update(feature(.3,.7),bank,t);if(r.switched)dwell.reset();assert.equal(dwell.update(r.entry?'key':null,t),null);}
 assert.equal(dwell.progress,.75);
 const gap=s.update(feature(.3,.7),bank,1600);assert.equal(gap.entry,null);assert.equal(dwell.update(null,1600),null);assert.equal(dwell.progress,0);
 assert.equal(s.update(feature(.3,.7),bank,NaN).entry,null);
 assert.equal(s.update(feature(.3,.7),bank,100).entry,null);
});
test('switching head positions cannot repeat a selected key until the user releases it',()=>{
 const d=new TargetDwell();for(let t=0;t<1000;t+=50)assert.equal(d.update('key',t),null);
 assert.equal(d.update('key',1000),'key');resetDwellForPosition(d);
 for(let t=1050;t<=3000;t+=50)assert.equal(d.update('key',t),null);
 for(let t=3050;t<=3650;t+=50)d.update(null,t);
 for(let t=3700;t<4700;t+=50)assert.equal(d.update('key',t),null);
 assert.equal(d.update('key',4700),'key');
});

test('an unseen midpoint is estimated even outside both individual head boxes',()=>{
 const endpoints=[entry(1,.44),entry(2,.56)],f=feature(.37,.64,.5),before=JSON.stringify(endpoints);
 for(const e of endpoints)assert.equal(predictDetailed(f,e.model).reason,'head-position');
 const r=estimateHeadPositions(f,endpoints);
 assert.equal(r.interpolated,true);assert.ok(r.point);assert.ok(Math.abs(r.point.x-.37)<.003);assert.ok(Math.abs(r.point.y-.64)<.003);
 assert.ok(r.weights.every(w=>w.weight>=0));assert.ok(Math.abs(r.weights.reduce((s,w)=>s+w.weight,0)-1)<1e-9);
 assert.equal(JSON.stringify(endpoints),before);
});

test('gaze changes while the head stays at an interpolated position',()=>{
 for(const x of [.05,.2,.5,.8,.95])for(const y of [.05,.5,.95]){
  const r=estimateHeadPositions(feature(x,y,.54),bank);
  assert.ok(r.point);assert.ok(Math.hypot(r.point.x-x,r.point.y-y)<.004);
 }
});

test('no screen clipping, no unsupported extrapolation, no interpolation of tracking loss',()=>{
 const off=estimateHeadPositions(feature(.3,-.2,.54),bank);
 assert.equal(off.reason,'outside-screen');assert.equal(off.point,null);assert.ok(off.raw.y<0);
 assert.equal(estimateHeadPositions(feature(.3,.7,.9),bank).entry,null);
 assert.equal(estimateHeadPositions(null,bank).point,null);
 assert.equal(estimateHeadPositions({...feature(.3,.7,.54),h:NaN},bank).point,null);
 assert.equal(estimateHeadPositions({...feature(.3,.7,.54),roll:.2},bank).point,null);
 const far=[entry(1,.3),entry(2,.7)];assert.equal(estimateHeadPositions(feature(.3,.7,.5),far).point,null);
});

const simplePose={x:.5,y:.45,scale:.3,roll:0,yaw:.5,pitch:.25};
const poseEye=(x,y,p)=>({...p,h:.25+.4*x+1.2*(p.x-.5)+.5*(p.y-.45)+.3*(p.yaw-.5),v:-.075+.15*y+.25*(p.y-.45)+.2*Math.log(p.scale/.3)+.2*(p.pitch-.25)});
const poseEntry=(id,p)=>{const groups=targets=>targets.map(target=>({target,samples:Array.from({length:32},()=>poseEye(...target,p))})),model=fitCalibration(groups(TRAIN_TARGETS));return {id,model,validation:validateCalibration(groups(CHECK_TARGETS),model,1440,960)};};

test('two-dimensional interior uses surrounding poses, not just the nearest one',()=>{
 const corners=[[-.06,-.06],[.06,-.06],[.06,.06],[-.06,.06]].map(([dx,dy],i)=>poseEntry(i+1,{...simplePose,x:.5+dx,y:.45+dy}));
 for(const dx of [-.03,0,.03])for(const dy of [-.03,0,.03]){
  const r=estimateHeadPositions(poseEye(.3,.7,{...simplePose,x:.5+dx,y:.45+dy}),corners);
  assert.ok(r.point);assert.ok(Math.hypot(r.point.x-.3,r.point.y-.7)<.006);
 }
 const bad=estimateHeadPositions(poseEye(.3,.7,{...simplePose,pitch:.4}),corners);assert.equal(bad.point,null);
});

test('depth and rotation are part of the measured range',()=>{
 const p1={...simplePose,scale:.28,yaw:.46,pitch:.22},p2={...simplePose,scale:.32,yaw:.54,pitch:.28};
 const entries=[poseEntry(1,p1),poseEntry(2,p2)],mid={...simplePose,scale:Math.sqrt(.28*.32)};
 const r=estimateHeadPositions(poseEye(.3,.7,mid),entries);assert.ok(r.point);assert.ok(Math.hypot(r.point.x-.3,r.point.y-.7)<.006);
 assert.equal(estimateHeadPositions({...poseEye(.3,.7,mid),yaw:NaN},entries).point,null);
});

test('fifteen stored positions and duplicate poses remain finite and usable',()=>{
 assert.equal(MAX_HEAD_POSITIONS,15);
 const entries=Array.from({length:15},(_,i)=>({...bank[i%3],id:i+1}));
 assert.equal(savedHeadPositions({headPositions:entries}).length,15);
 for(const head of [.42,.46,.5,.54,.58]){
  const r=estimateHeadPositions(feature(.3,.7,head),entries);assert.ok(r.point);assert.ok(Math.hypot(r.point.x-.3,r.point.y-.7)<.006);
 }
});

test('passed endpoints are never relabeled with invented between-position accuracy',()=>{
 const endpoints=[entry(1,.44),entry(2,.56)],before=JSON.stringify(endpoints);
 const groups=CHECK_TARGETS.map(target=>group(target,.5));
 const result=validateCalibration(groups,endpoints[0].model,1440,960,{predictor:f=>estimateHeadPositions(f,endpoints)});
 assert.equal(result.passed,true);assert.ok(result.meanPixels<4);assert.equal(JSON.stringify(endpoints),before);
 const failed=endpoints.map(e=>({...e,validation:{...e.validation,passed:false}}));
 assert.equal(estimateHeadPositions(feature(.3,.7),failed).point,null);
 const test=estimateHeadPositions(feature(.3,.7),failed,{allowUnverified:true});assert.ok(test.point);assert.equal(test.entry.validation.passed,false);
});

test('local learned head corrections are not extrapolated and counted a second time',()=>{
 const endpoints=[entry(1,.44),entry(2,.56)].map((e,i)=>({...e,model:{...e.model,version:3,poseCorrection:{indices:[0,1,2,3],reference:[e.model.head.x,.45,.3,0],weights:[[i?-.02:.02,0,0,0],[0,0,0,0]]}}}));
 const r=estimateHeadPositions(feature(.3,.7,.5),endpoints);
 assert.ok(r.point);assert.ok(Math.hypot(r.point.x-.3,r.point.y-.7)<.004);
});

test('a one-second hold survives gradual travel through an intermediate pose',()=>{
 const s=new HeadPositionSelector(),d=new TargetDwell();let fired=0;
 for(let t=0;t<=1600;t+=50){const head=.5+.08*Math.max(0,t-400)/1200,r=feed(s,head,t,t);if(r.switched)resetDwellForPosition(d);if(d.update(r.point?'same-target':null,t))fired++;}
 assert.equal(fired,1);
});

test('a corrupt bank falls back to the previous valid single map',()=>{
 assert.equal(savedHeadPositions({...bank[0],headPositions:[null]}).length,1);
});

test('legacy maps do not bypass rotation checks in newer contributing maps',()=>{
 const endpoints=[entry(1,.44),entry(2,.56)];endpoints[1].model.head.yaw=.5;
 const r=estimateHeadPositions({...feature(.3,.7,.5),yaw:.7},endpoints);
 assert.equal(r.point,null);assert.equal(r.reason,'head-position');assert.ok(r.headReasons.includes('yaw'));
});

// ---- 0.4.29: back to the calibration position before a check ----
import {calibrationReturnPlan,calibrationReturnFeedback,RETURN_WITHIN} from '../public/screen-positions.mjs';
test('before a check the head is guided back to where the map was calibrated',()=>{
 const head={x:.38,y:.69,scale:.31,roll:.04,yaw:.56,pitch:.49},plan=calibrationReturnPlan({head});
 assert.deepEqual(plan.fields,['x','y','scale','roll','yaw','pitch']);assert.deepEqual(plan.target,head);
 const here=calibrationReturnFeedback({...head},plan);assert.ok(here.ready&&here.worst===0&&/In position/.test(here.message));
 // As recorded: 6% of the picture lower and nodded further down.
 const low=calibrationReturnFeedback({...head,y:.748,pitch:.533},plan);
 assert.equal(low.ready,false);assert.ok(low.worst>1);assert.match(low.message,/^Move a little higher\.$/);
 // Ordinary settling stays in position; the edge of the map's range does not.
 assert.ok(calibrationReturnFeedback({...head,yaw:.56+.07*.5,roll:.04+.12*.4},plan).ready);
 const edge=calibrationReturnFeedback({...head,yaw:.56+.07*.9},plan);assert.equal(edge.ready,false);assert.ok(edge.worst>RETURN_WITHIN&&edge.worst<1);assert.match(edge.message,/^Turn a little/);
 // Nothing to compare with, or no face: never ready, never a crash.
 assert.equal(calibrationReturnPlan({}),null);assert.equal(calibrationReturnPlan(null),null);
 assert.equal(calibrationReturnFeedback(null,plan).ready,false);assert.equal(calibrationReturnFeedback({...head,pitch:NaN},plan).ready,false);
 // A map without turn and nod readings is matched on the four it has.
 const four=calibrationReturnPlan({head:{x:.38,y:.69,scale:.31,roll:.04}});assert.deepEqual(four.fields,['x','y','scale','roll']);assert.ok(calibrationReturnFeedback({x:.38,y:.69,scale:.31,roll:.04},four).ready);
});
