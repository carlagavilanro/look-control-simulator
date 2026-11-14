import test from 'node:test';
import assert from 'node:assert/strict';
import {HeadCaptureGuide,capturePositionFeedback,headGuideFeedback,nextHeadPosition,estimateHeadPositions} from '../public/screen-positions.mjs';
import {TRAIN_TARGETS,ALIGN_TARGETS,CHECK_TARGETS,fitCalibration,fitHeadCompensation} from '../public/screen-gaze.mjs';
const head={x:.5,y:.45,scale:.3,roll:0,yaw:.5,pitch:.2};
const entries=[{id:1,model:{head},validation:{passed:true}}],plan=nextHeadPosition(entries);
test('a useful sideways capture accepts naturally coupled height, size and rotation changes',()=>{
 const actual={...head,x:plan.target.x-.005,y:.46,scale:.294,yaw:.52,pitch:.208,roll:.01};
 assert.equal(headGuideFeedback(actual,plan).ready,false);
 assert.equal(capturePositionFeedback(actual,plan).ready,true);
 const gate=new HeadCaptureGuide();let state;
 for(let t=0;t<=1400;t+=40){const jitter=.001*Math.sin(t);state=gate.update({...actual,x:actual.x+jitter,y:actual.y-jitter},plan,entries,t,{eyesReady:true});}
 assert.equal(state.captureReady,true);assert.equal(state.autoStart,true);
});
test('the explicit capture button can use a steady chosen pose outside the suggested outline',()=>{
 const actual={...head,y:.49},gate=new HeadCaptureGuide();let state;
 for(let t=0;t<=1600;t+=40)state=gate.update(actual,plan,entries,t,{eyesReady:true});
 assert.equal(state.captureReady,true);assert.equal(state.autoStart,false);
 assert.equal(capturePositionFeedback({...head,x:.8},plan).ready,false);
});
test('missing eyes or stale frames cannot start an automatic head-position calibration',()=>{
 const gate=new HeadCaptureGuide();let state;
 for(let t=0;t<=1800;t+=40)state=gate.update(plan.target,plan,entries,t,{eyesReady:false});
 assert.equal(state.captureReady,false);assert.equal(state.autoStart,false);
 for(let t=1840;t<=2400;t+=40)state=gate.update(plan.target,plan,entries,t,{eyesReady:true});
 assert.equal(gate.update(plan.target,plan,entries,4000,{eyesReady:true}).autoStart,false);
 assert.equal(gate.update(null,plan,entries,4040,{eyesReady:true}).captureReady,false);
});
test('a baseline duplicate and sustained movement do not trigger automatic capture',()=>{
 const gate=new HeadCaptureGuide();let state;
 for(let t=0;t<=1800;t+=40)state=gate.update(head,plan,entries,t,{eyesReady:true});
 assert.equal(state.captureReady,false);assert.equal(state.autoStart,false);
 gate.reset();
 for(let t=0;t<=2400;t+=40){state=gate.update({...head,x:.5+(t%800)/6000},plan,entries,t,{eyesReady:true});assert.equal(state.autoStart,false);}
});
const eye=(x,y,p,bias=0)=>({...p,h:.25+.4*x+1.4*(p.x-.5)+bias,v:-.075+.15*y+.3*(p.x-.5)});
const base=fitCalibration(TRAIN_TARGETS.map(target=>({target,samples:Array.from({length:32},()=>eye(...target,head))})));
const bankEntry=(id,x,bias=0)=>{
 const p={...head,x},offset=1.4*(x-.5)+bias;
 return {id,model:{...base,head:p,center:[base.center[0]+offset,base.center[1]+.3*(x-.5)],anchors:ALIGN_TARGETS.map(target=>({target,feature:eye(...target,p,bias)}))},validation:{passed:true}};
};
test('small measurement errors in several head axes retain interpolation without accepting a new large rotation',()=>{
 const bank=[bankEntry(1,.44),bankEntry(2,.56)];
 const p={...head,y:head.y+.0075,scale:head.scale*Math.exp(.15*Math.log(1.18)),roll:.018,yaw:head.yaw+.0105,pitch:head.pitch+.0105};
 const result=estimateHeadPositions(eye(.3,.7,p),bank,{useCompensation:false});
 assert.equal(result.interpolated,true);assert.ok(result.point);assert.ok(Math.hypot(result.point.x-.3,result.point.y-.7)<.01);
 assert.equal(estimateHeadPositions(eye(.3,.7,{...p,pitch:.4}),bank).point,null);
});
test('held-out head positions can select a correction even when existing-pose target fits look perfect',()=>{
 const bank=Array.from({length:9},(_,i)=>bankEntry(i+1,.44+i*.015,(i%2?1:-1)*.004));
 const before=JSON.stringify(bank);
 const learned=fitHeadCompensation(bank,{baselinePredictor:(feature,entries)=>{
  const result=estimateHeadPositions(feature,entries,{useCompensation:false});return result.entry?result.raw:null;
 }});
 assert.ok(learned);assert.ok(learned.positionError<learned.positionBaseline*.85);
 assert.ok(learned.heldOutError+.002>=learned.baselineError*.85);
 const errors=[];
 for(const x of [.462,.487,.512,.537])for(const target of CHECK_TARGETS){const r=estimateHeadPositions(eye(...target,{...head,x}),bank);assert.equal(r.compensated,true);errors.push(Math.hypot(r.raw.x-target[0],r.raw.y-target[1]));}
 assert.ok(errors.reduce((s,v)=>s+v,0)/errors.length<.02);
 assert.equal(JSON.stringify(bank),before);
});
