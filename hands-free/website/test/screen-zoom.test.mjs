// Head-position limits at different zoom levels, and the per-person comparison
// of the two eyes in Face + eyes mode. Synthetic numbers, not camera accuracy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAIN_TARGETS,CHECK_TARGETS,POSE_REFERENCE_SCALE,EDGE_ALLOWANCE,poseZoom,screenPoint,containedTarget,fitCalibration,validateCalibration,headRejections,predictDetailed,settledSummary,screenFeature} from '../public/screen-gaze.mjs';
import {HeadPositionSelector,headDistance,nextHeadPosition} from '../public/screen-positions.mjs';
import {BinocularAgreement} from '../public/screen-eye-crop.mjs';

// The same eye readings seen at a given apparent head size and position.
const feature=(x,y,{scale=.3,head=.5,headY=.45}={})=>({h:.25+.4*x,v:-.075+.15*y,x:head,y:headY,scale,roll:0});
const group=(target,options)=>({target,samples:Array.from({length:32},()=>feature(...target,options))});
const model=scale=>fitCalibration(TRAIN_TARGETS.map(t=>group(t,{scale})));

test('limits are unchanged at ordinary framing and grow in proportion when zoomed in',()=>{
 for(const scale of [.1,.2,.3,POSE_REFERENCE_SCALE])assert.equal(poseZoom(scale),1);
 assert.ok(Math.abs(poseZoom(.7)-2)<1e-12);assert.ok(Math.abs(poseZoom(1.05)-3)<1e-12);
 // A missing or impossible head size never loosens or breaks a limit.
 for(const invalid of [NaN,undefined,-1,0,Infinity])assert.equal(poseZoom(invalid),1);
});

test('a close-up no longer pauses for a head movement that ordinary framing would allow',()=>{
 const ordinary=model(.3),closeUp=model(.9);
 // Ordinary framing: 4% of the frame is inside the limit, 6% is outside. Unchanged.
 assert.deepEqual(headRejections(feature(.5,.5,{head:.54}),ordinary),[]);
 assert.deepEqual(headRejections(feature(.5,.5,{head:.56}),ordinary),['x']);
 assert.deepEqual(headRejections(feature(.5,.5,{headY:.51}),ordinary),['y']);
 // Eyes three times larger in the frame: the same physical movement covers
 // three times as much of it. 12% of the frame is now inside the limit.
 const close=options=>feature(.5,.5,{scale:.9,...options});
 assert.deepEqual(headRejections(close({head:.56}),closeUp),[]);assert.deepEqual(headRejections(close({head:.62}),closeUp),[]);
 assert.deepEqual(headRejections(close({head:.64}),closeUp),['x']);assert.deepEqual(headRejections(close({headY:.59}),closeUp),['y']);
 const point=predictDetailed(close({head:.6}),closeUp);assert.equal(point.reason,'usable');assert.ok(Math.abs(point.point.x-.5)<.01);
 // Distance and tilt limits are ratios and angles; zoom does not loosen them.
 assert.deepEqual(headRejections({...close(),scale:.9*1.2},closeUp),['scale']);assert.deepEqual(headRejections({...close(),roll:.13},closeUp),['roll']);
});

test('calibration in a close-up accepts the small head sway that every person has',()=>{
 // Head drifts 2% of the frame while one dot is measured.
 const drifting=scale=>Array.from({length:32},(_,i)=>({...feature(.5,.5,{scale}),x:.5+(i<16?0:.02)}));
 assert.throws(()=>settledSummary(drifting(.3)),/head is still moving/);
 assert.ok(settledSummary(drifting(.9)));
 // A drift that is large even for the close-up is still refused.
 assert.throws(()=>settledSummary(drifting(.9).map((f,i)=>({...f,x:.5+(i<16?0:.05)}))),/head is still moving/);
});

test('saved head positions use the same zoom-aware distances',()=>{
 const scale=.9,m=model(scale),entry={id:1,model:m,validation:validateCalibration(CHECK_TARGETS.map(t=>group(t,{scale})),m,1920,1080)};
 assert.ok(entry.validation.passed);
 const selector=new HeadPositionSelector();let result;
 // The head settles 8% of the frame from where it was calibrated: within range at this zoom.
 for(let t=0;t<=500;t+=50)result=selector.update(feature(.3,.7,{scale,head:.58}),[entry],t);
 assert.equal(result.entry.id,1);assert.ok(result.point);
 assert.ok(headDistance(feature(.5,.5,{scale,head:.58}),m.head)<headDistance(feature(.5,.5,{head:.58}),model(.3).head));
 // Suggested positions move by the same physical amount at any zoom.
 const near=nextHeadPosition([{id:1,model:model(.3)}]),far=nextHeadPosition([entry]),step=plan=>Math.hypot(plan.target.x-plan.reference.x,plan.target.y-plan.reference.y);
 assert.equal(near.id,far.id);assert.ok(Math.abs(step(far)/step(near)-poseZoom(scale))<1e-9);
});

test('Face + eyes compares the two eyes against their usual difference when a tracker is supplied',()=>{
 // Face landmarks with each iris offset toward the nose by a chosen amount.
 const face=difference=>{
  const p=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  const eye=(a,b,iris,top,bottom,x,shift)=>{p[a]={x:x-.07,y:.4};p[b]={x:x+.07,y:.4};p[iris]={x:x+shift*.14,y:.4};p[top]={x,y:.38};p[bottom]={x,y:.42};for(let i=1;i<=4;i++){const t=(i-1)*Math.PI/2;p[iris+i]={x:x+shift*.14+Math.cos(t)*.018,y:.4+Math.sin(t)*.024};}};
  eye(33,133,468,159,145,.27,difference/2);eye(362,263,473,386,374,.62,-difference/2);p[1]={x:.45,y:.6};return p;
 };
 const read=(difference,agreement)=>{const quality={};return [screenFeature(face(difference),4/3,720,quality,agreement),quality.reason];};
 // Without a tracker the comparison is against zero, as before.
 assert.ok(read(.18)[0]);assert.deepEqual(read(.24),[null,'disagreement']);
 const agreement=new BinocularAgreement();
 for(let i=0;i<40;i++)assert.ok(read(.24,agreement)[0],'a steady natural difference is accepted');
 assert.ok(read(.24+.15,agreement)[0]);assert.ok(read(.24-.15,agreement)[0]);
 assert.deepEqual(read(.24-.3,agreement),[null,'disagreement']);
 const f=read(.24,agreement)[0];assert.ok(Math.abs(f.lh-f.rh-.24)<1e-9);assert.ok(Math.abs(f.h-.5)<1e-9);
});

test('an estimate just past a screen edge keeps tracking alive but can never select by itself',()=>{
 assert.deepEqual(screenPoint({x:.4,y:.6}),{x:.4,y:.6});
 assert.deepEqual(screenPoint({x:1+EDGE_ALLOWANCE/2,y:-EDGE_ALLOWANCE/2}),{x:1,y:0});
 for(const outside of [{x:1+EDGE_ALLOWANCE+.001,y:.5},{x:.5,y:-EDGE_ALLOWANCE-.001},{x:NaN,y:.5},{x:.5,y:Infinity},null])assert.equal(screenPoint(outside),null);
 // A point placed on the edge is never inside a control, even one touching that
 // edge: selection needs readings that are really on the control.
 const control={left:1720,right:1920,top:400,bottom:600,width:200,height:200};
 assert.equal(containedTarget(screenPoint({x:1.02,y:.46}),control,1920,1080),false);
 assert.equal(containedTarget(screenPoint({x:.95,y:.46}),control,1920,1080),true);
 // Accuracy checks still measure the unclipped estimate: clipping cannot flatter a map.
 const feature=(x,y)=>({h:.25+.4*x,v:-.075+.15*y,x:.5,y:.45,scale:.3,roll:0}),group=(target,shift=0)=>({target,samples:Array.from({length:32},()=>feature(target[0]+shift,target[1]))});
 const m=fitCalibration(TRAIN_TARGETS.map(t=>group(t))),biased=validateCalibration(CHECK_TARGETS.map(t=>group(t,.2)),m,1920,1080);
 assert.equal(biased.passed,false);assert.ok(biased.meanPixels>350);
});
