import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAIN_TARGETS,ALIGN_TARGETS,CHECK_TARGETS,fitCalibration,fitOffset,fitHeadCompensation,predictDetailed,validModel,settledSummary} from '../public/screen-gaze.mjs';
import {estimateHeadPositions,HeadPositionSelector} from '../public/screen-positions.mjs';

const feature=(x,y,head=.5)=>({h:.25+.4*x+1.4*(head-.5),v:-.075+.15*y+.3*(head-.5),x:head,y:.45,scale:.3,roll:0});
const base=fitCalibration(TRAIN_TARGETS.map(target=>({target,samples:Array.from({length:32},()=>feature(...target))})));

test('one-point correction repairs a steady offset and keeps independent check targets untouched',()=>{
 const samples=Array.from({length:32},()=>({...feature(.5,.5),h:feature(.5,.5).h+.025,v:.01}));
 const before=JSON.stringify(base),repaired=fitOffset(samples,base);
 assert.equal(validModel(repaired),true);
 assert.equal(repaired.anchors,undefined);
 assert.equal(JSON.stringify(base),before);
 for(const target of CHECK_TARGETS){
  const f={...feature(...target),h:feature(...target).h+.025,v:feature(...target).v+.01};
  // Center's original v is zero, so v=.01 above represents the same shift.
  const old=predictDetailed(f,base).raw,p=predictDetailed(f,repaired).raw;
  assert.ok(Math.hypot(p.x-target[0],p.y-target[1])<.005);
  assert.ok(Math.hypot(p.x-target[0],p.y-target[1])<Math.hypot(old.x-target[0],old.y-target[1]));
 }
 assert.throws(()=>fitOffset(samples.map(f=>({...f,x:.8})),base),/outside/);
 assert.throws(()=>fitOffset(samples.map(f=>({...f,h:f.h+.3})),base),/five-point/);
});

test('matched-target head learning improves a held-out noisy multi-position fixture',()=>{
 const entries=Array.from({length:9},(_,i)=>{
  const head=.45+.0125*i;
  const anchors=ALIGN_TARGETS.map((target,j)=>({target,feature:{...feature(...target,head),h:feature(...target,head).h+.01*Math.sin(i*11+j*7),v:feature(...target,head).v+.004*Math.cos(i*7+j*11)}}));
  return {id:i+1,savedAt:1,model:{...base,head:{...base.head,x:head},anchors},validation:{passed:true}};
 });
 const before=JSON.stringify(entries),learned=fitHeadCompensation(entries);
 assert.ok(learned);
 assert.ok(learned.heldOutError<learned.baselineError*.85);
 let total=0;
 for(const head of [.462,.487,.512,.537])for(const target of CHECK_TARGETS){
  const result=estimateHeadPositions(feature(...target,head),entries);
  assert.equal(result.compensated,true);assert.ok(result.raw);
  total+=Math.hypot(result.raw.x-target[0],result.raw.y-target[1]);
 }
 assert.ok(total/28<.025);
 assert.equal(estimateHeadPositions(feature(.5,.5,.8),entries).entry,null);
 assert.equal(JSON.stringify(entries),before);
 const failed=entries.map(e=>({...e,validation:{passed:false}}));
 assert.equal(estimateHeadPositions(feature(.5,.5),failed).entry,null);
});

test('a legacy position outside the learned anchors cannot extend learned compensation coverage',()=>{
 const entries=Array.from({length:9},(_,i)=>{
  const head=.45+.0125*i;
  return {id:i+1,model:{...base,head:{...base.head,x:head},anchors:ALIGN_TARGETS.map((target,j)=>({target,feature:{...feature(...target,head),h:feature(...target,head).h+.01*Math.sin(i*11+j*7),v:feature(...target,head).v+.004*Math.cos(i*7+j*11)}}))},validation:{passed:true}};
 });
 const legacy={id:10,model:{...base,head:{...base.head,x:.7}},validation:{passed:true}};
 delete legacy.model.anchors;
 assert.ok(fitHeadCompensation(entries));
 const result=estimateHeadPositions(feature(.5,.5,.7),[...entries,legacy]);
 assert.notEqual(result.compensated,true);
});

test('abrupt supported head movement pauses input and reacquires without modifying maps',()=>{
 const entries=[.44,.56].map((head,i)=>({id:i+1,model:fitCalibration(TRAIN_TARGETS.map(target=>({target,samples:Array.from({length:32},()=>feature(...target,head))}))),validation:{passed:true}}));
 const selector=new HeadPositionSelector(),before=JSON.stringify(entries);
 for(let at=0;at<=500;at+=40)selector.update(feature(.3,.7,.44),entries,at);
 const jerk=selector.update(feature(.3,.7,.56),entries,520);
 assert.equal(jerk.point,null);assert.equal(jerk.reason,'head-reacquiring');
 let result;
 for(let at=560;at<=1000;at+=40)result=selector.update(feature(.3,.7,.56),entries,at);
 assert.ok(result.point);assert.ok(Math.hypot(result.point.x-.3,result.point.y-.7)<.005);
 assert.equal(JSON.stringify(entries),before);
});

test('calibration refuses a changing head pose even when eye ratios look steady',()=>{
 const samples=Array.from({length:32},(_,i)=>({...feature(.5,.5),x:i<16?.48:.52}));
 assert.throws(()=>settledSummary(samples),/head is still moving/);
 assert.equal(validModel({...base,anchors:[{target:[.5,NaN],feature:feature(.5,.5)}]}),false);
});

test('an isolated head-landmark spike is gated and the original fixation resumes after coherent frames',()=>{
 const entries=[{id:1,model:base,validation:{passed:true}}],selector=new HeadPositionSelector();
 for(let at=0;at<=500;at+=40)selector.update(feature(.3,.7),entries,at);
 assert.equal(selector.update({...feature(.3,.7),x:.8},entries,520).point,null);
 assert.equal(selector.update(feature(.3,.7),entries,560).point,null);
 assert.equal(selector.update(feature(.3,.7),entries,600).point,null);
 const result=selector.update(feature(.3,.7),entries,640);
 assert.ok(result.point);assert.equal(result.switched,false);
 assert.equal(selector.update(null,entries,680).point,null);
 assert.equal(selector.update(feature(.3,.7),entries,1200).point,null);
});
