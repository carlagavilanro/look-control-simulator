import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAIN_TARGETS,REFINE_TARGETS,CHECK_TARGETS,calibrationTargets,fitCalibration,fitRefinement,validateCalibration,predictDetailed,validModel,GazePointer} from '../public/screen-gaze.mjs';
const feature=(x,y,j=0)=>({h:.25+.4*x+j,v:-.075+.15*y+j*.2,x:.5,y:.45,scale:.3,roll:0});
const groups=(targets,warp=(x,y)=>[x,y])=>targets.map(target=>({target,samples:Array.from({length:36},(_,i)=>feature(...warp(...target),.0001*Math.sin(i*1.7)))}));
const base=fitCalibration(groups(TRAIN_TARGETS));

test('nine fresh anchors correct offset and curvature without using seven check targets',()=>{
 assert.ok(REFINE_TARGETS.every(a=>!CHECK_TARGETS.some(b=>a[0]===b[0]&&a[1]===b[1])));
 const warp=(x,y)=>[x+.02*Math.sin(2*Math.PI*y),y-.12*Math.exp(-((x-.5)**2+(y-.1)**2)/.18)];
 const checks=groups(CHECK_TARGETS,warp),before=validateCalibration(checks,base,1600,900),m=fitRefinement(groups(REFINE_TARGETS,warp),base),after=validateCalibration(checks,m,1600,900);
 assert.ok(validModel(m));assert.equal(m.validation,undefined);assert.equal(m.repairComparison.anchorCount,9);
 assert.ok(after.meanPixels<before.meanPixels*.5);assert.ok(after.p90Pixels<before.p90Pixels*.6);
 assert.throws(()=>fitRefinement(groups(CHECK_TARGETS,warp),base),/nine refinement/);
 assert.throws(()=>fitRefinement(groups(REFINE_TARGETS).map(g=>({...g,samples:g.samples.map(f=>({...f,x:.85}))})),base),/changed too much/);
 // Bad later measurements must still fail; fitting anchors cannot pass a check.
 const noisy=checks.map(g=>({...g,samples:g.samples.map((f,i)=>({...f,h:f.h+(i%2?.15:-.15)}))}));
 assert.equal(validateCalibration(noisy,m,1600,900).passed,false);
});

test('dense nonlinear mapping generalizes to unseen screen points',()=>{
 const warp=(x,y)=>[x+.08*Math.sin(2*Math.PI*x),y+.09*Math.sin(2*Math.PI*y)];
 const m=fitCalibration(groups(calibrationTargets(true),warp));assert.ok(m.refinement);
 assert.ok(validModel(m));const checks=groups(CHECK_TARGETS,warp),after=validateCalibration(checks,m,1600,900);
 const unrefined={...m};delete unrefined.refinement;
 const before=validateCalibration(checks,unrefined,1600,900);
 assert.ok(after.meanPixels<before.meanPixels*.65,`${after.meanPixels} vs ${before.meanPixels}`);
 assert.ok(after.p90Pixels<before.p90Pixels);
 assert.ok(validModel(JSON.parse(JSON.stringify(m))));
 assert.equal(validModel({...m,refinement:{...m.refinement,radius:0}}),false);
 assert.equal(validModel({...m,refinement:{...m.refinement,weights:[[NaN],[]]}}),false);
 const off=predictDetailed(feature(-.5,.5),m);assert.equal(off.point,null);assert.ok(off.raw.x<0);assert.equal(off.reason,'outside-screen');
});

test('refinement retains a good map and rejects degenerate measurements',()=>{
 const m=fitRefinement(groups(REFINE_TARGETS),base);
 assert.equal(m.repairComparison.unchanged,true);assert.equal(m.refinement,undefined);
 assert.equal(validateCalibration(groups(CHECK_TARGETS),m,1600,900).passed,true);
 // Inadequate sample counts cannot produce or save a correction.
 assert.throws(()=>fitRefinement(groups(REFINE_TARGETS).map(g=>({...g,samples:g.samples.slice(0,3)})),base),/samples/);
});

test('rejected pointer markers stay visible briefly but cannot select',()=>{
 const p=new GazePointer(),good={point:{x:.4,y:.5},raw:{x:.4,y:.5},reason:'usable'};
 assert.equal(p.update(good,0).usable,true);
 const off={point:null,raw:{x:1.2,y:-.2},reason:'outside-screen'};
 const held=p.update(off,66);assert.deepEqual(held.point,{x:.4,y:.5});assert.equal(held.usable,false);assert.equal(held.held,true);
 const heldAgain=p.update(off,300);assert.equal(heldAgain.usable,false);assert.equal(heldAgain.clipped,false);assert.deepEqual(heldAgain.point,good.point);assert.deepEqual(off.raw,{x:1.2,y:-.2});
 assert.equal(p.update({point:null,raw:null,reason:'eyes-unavailable'},600).point,null);
 assert.equal(p.update(good,633).usable,false);
 p.update(good,680);assert.deepEqual(p.update(good,730).point,good.point);assert.equal(p.update(good,763).usable,true);
});

test('rejected bursts cannot fling the marker or turn a single recovery frame into a click',()=>{
 const p=new GazePointer(),good={point:{x:.4,y:.5},raw:{x:.4,y:.5},reason:'usable'};
 p.update(good,0);
 for(let t=33;t<=330;t+=33){
  const view=p.update({point:null,raw:{x:t%2?2:-1,y:t%2?-3:2},reason:'outside-screen'},t);
  assert.deepEqual(view.point,good.point);assert.equal(view.usable,false);
 }
 for(let t=363;t<=693;t+=33){
  const point={x:t%2?.2:.8,y:t%2?.2:.8},view=p.update({point,raw:point,reason:'usable'},t);
  assert.deepEqual(view.point,good.point);assert.equal(view.usable,false);
 }
 // A real new fixation can recover anywhere; it is not snapped to the old gaze.
 const next={point:{x:.7,y:.25},raw:{x:.7,y:.25},reason:'usable'};
 let view;for(let t=726;t<=1056;t+=33)view=p.update(next,t);
 assert.equal(view.usable,true);assert.ok(Math.hypot(view.point.x-.7,view.point.y-.25)<.001);
});

test('a short blink keeps the same pointer filter instead of resetting it',()=>{
 const p=new GazePointer();
 for(let t=0;t<200;t+=33)p.update({point:{x:.4,y:.5}},t);
 p.update({point:null,raw:null,reason:'eyes-unavailable'},200);
 const recovered=p.update({point:{x:.42,y:.51}},266);
 assert.equal(recovered.usable,true);assert.ok(recovered.point.x<.42);
});

test('head rejection and loss never reuse a previous selectable gaze',()=>{
 const p=new GazePointer();p.update({point:{x:.5,y:.5}},100);
 const head=p.update({point:null,raw:{x:.6,y:.6},reason:'head-position'},400);assert.equal(head.usable,false);
 p.reset();assert.equal(p.update({point:null,raw:null},450).point,null);
});
