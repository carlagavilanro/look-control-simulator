import test from 'node:test';
import assert from 'node:assert/strict';
import {GazeFilter,FixationStabilizer,GazePointer,FixationGate,TargetDwell,containedTarget,quantile} from '../public/screen-gaze.mjs';
const distance=(a,b,w,h)=>Math.hypot((a.x-b.x)*w,(a.y-b.y)*h);

test('steady fixation suppresses pixel-scale jitter at multiple display sizes and frame rates',()=>{
 for(const [width,height] of [[390,844],[1280,720],[1920,1080]])for(const fps of [15,28,60]){
  const f=new GazeFilter(),raw=[],out=[];let seed=17;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296-.5;};
  for(let i=0;i<fps*6;i++){
   const at=i*1000/fps,p={x:.5+random()*18/width,y:.5+random()*14/height};
   const next=f.update(p,at,{width,height});if(at>1500){raw.push(p);out.push(next);}
  }
  const scatter=values=>{const c={x:quantile(values.map(p=>p.x),.5),y:quantile(values.map(p=>p.y),.5)};return quantile(values.map(p=>distance(p,c,width,height)),.9);};
  assert.ok(scatter(out)<scatter(raw)*.35,`${width}/${fps}: ${scatter(out)}`);
  assert.ok(distance(out.at(-1),{x:.5,y:.5},width,height)<8);
 }
});

test('small deliberate steps escape the hold and large movements reach the new target promptly',()=>{
 for(const [width,height] of [[390,844],[1280,720],[1920,1080]])for(const fps of [15,28,60])for(const pixels of [4,8,20,200]){
  const f=new GazeFilter(),dt=1000/fps;let at=0,p;
  for(;at<1500;at+=dt)f.update({x:.3,y:.5},at,{width,height});
  const start=at,target={x:.3+pixels/width,y:.5};
  for(;at-start<1100;at+=dt){
   p=f.update(target,at,{width,height});
   if(pixels===200&&at-start>=400)assert.ok(distance(p,target,width,height)<25,`${width}/${fps}: movement response too slow`);
  }
  assert.ok(distance(p,target,width,height)<1,`${width}/${fps}/${pixels}: failed fine movement`);
 }
});

test('the display follows continuous slow movement instead of accumulating dead-zone error',()=>{
 const f=new GazeFilter(),width=1280,height=720;let last;
 for(let i=0;i<180;i++){
  const at=i*1000/28,target={x:.3+Math.max(0,i-42)*.0008,y:.5};last=f.update(target,at,{width,height});
  if(i>80)assert.ok(distance(last,target,width,height)<16);
 }
});

test('brief return movements do not drag a fixation anchor across the screen',()=>{
 const f=new GazeFilter(),viewport={width:1280,height:720};let p;
 for(let i=0;i<40;i++)f.update({x:.5,y:.5},i*33,viewport);
 for(let i=40;i<42;i++)p=f.update({x:.53,y:.47},i*33,viewport);
 for(let i=42;i<48;i++)p=f.update({x:.5,y:.5},i*33,viewport);
 assert.ok(distance(p,{x:.5,y:.5},1280,720)<1);
});

test('a held marker cannot complete a dwell after raw gaze leaves its target or is lost',()=>{
 const pointer=new GazePointer(),gate=new FixationGate(),dwell=new TargetDwell();
 const rect={left:400,right:600,top:200,bottom:400,width:200,height:200};
 const tick=(point,at)=>{
  const view=pointer.update({point,raw:point},at,{width:1000,height:600});
  const stable=gate.update(point,at,{});
  const hit=view.usable&&stable&&containedTarget(point,rect,1000,600)&&containedTarget(view.point,rect,1000,600);
  return dwell.update(hit?'target':null,at);
 };
 for(let at=0;at<1200;at+=33)assert.equal(tick({x:.5,y:.5},at),null);
 assert.equal(tick({x:.7,y:.5},1212),null);
 assert.equal(dwell.progress,0);
 assert.equal(tick(null,1245),null);
 assert.equal(dwell.progress,0);
});

test('tracking gaps, clock reversal, bad input, and changed screen size discard the fixation hold',()=>{
 const f=new FixationStabilizer();for(let i=0;i<30;i++)f.update({x:.5,y:.5},i*33);
 assert.equal(f.fixating,true);
 assert.deepEqual(f.update({x:.7,y:.3},1800),{x:.7,y:.3});assert.equal(f.fixating,false);
 assert.deepEqual(f.update({x:.4,y:.5},100),{x:.4,y:.5});
 assert.equal(f.update(null,133),null);
 for(let i=0;i<30;i++)f.update({x:.5,y:.5},200+i*33);
 assert.equal(f.fixating,true);f.update({x:.6,y:.6},1200,390,844);assert.equal(f.fixating,false);
 assert.equal(f.update({x:NaN,y:.5},1233),null);
});

test('small sustained movement below a noisy hold threshold is not permanently swallowed',()=>{
 const f=new GazeFilter(),width=1280,height=720;let p;
 for(let i=0;i<150;i++){
  const x=.5+(i<75?0:6)/width;
  p=f.update({x:x+Math.sin(i*2.1)*6/width,y:.5+Math.cos(i*1.7)*5/height},i*1000/28,{width,height});
 }
 assert.ok(distance(p,{x:.5+6/width,y:.5},width,height)<3);
});

test('a three-frame returning excursion is held without disguising raw movement',()=>{
 const f=new GazeFilter(),viewport={width:1280,height:720},center={x:.5,y:.5};let p;
 for(let i=0;i<45;i++)f.update(center,i*1000/28,viewport);
 for(let i=45;i<48;i++){p=f.update({x:.5+55/1280,y:.5},i*1000/28,viewport);assert.ok(distance(p,center,1280,720)<1);assert.equal(f.fixation.excursionHeld,true);}
 for(let i=48;i<57;i++){p=f.update(center,i*1000/28,viewport);assert.ok(distance(p,center,1280,720)<1);}
});

test('confirmed large movement releases promptly instead of freezing indefinitely',()=>{
 for(const fps of [15,28,60]){
  const f=new GazeFilter(),viewport={width:1280,height:720},dt=1000/fps;let at=0,p;
  for(;at<1500;at+=dt)f.update({x:.3,y:.5},at,viewport);
  const start=at;for(;at-start<=250;at+=dt)p=f.update({x:.8,y:.3},at,viewport);
  assert.ok(distance(p,{x:.8,y:.3},1280,720)<4,`release at ${fps} fps`);
 }
});

test('returning 90 ms excursions remain contained across camera rates',()=>{
 for(const fps of [15,28,60]){
  const f=new GazeFilter(),width=1280,height=720;let seed=193;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296-.5;};
  for(let i=0;i<fps*10;i++){
   const at=i*1000/fps,phase=at%1400,excursion=at>2000&&phase>=400&&phase<490;
   const raw={x:.5+(random()*6+(excursion?55:0))/width,y:.5+random()*6/height};
   const p=f.update(raw,at,{width,height});
   if(at>1500)assert.ok(distance(p,{x:.5,y:.5},width,height)<4,`brief excursion escaped at ${fps} fps`);
  }
 }
});

test('the newest displaced gaze fails immediately but a past outlier does not block the return',()=>{
 const gate=new FixationGate();for(let at=0;at<=700;at+=35)gate.update({x:.5,y:.5},at,{});
 assert.equal(gate.update({x:.54,y:.5},735,{}),false);
 assert.equal(gate.update({x:.5,y:.5},770,{}),true);
 assert.equal(gate.update(null,805,{}),false);
});

test('short in-target pauses preserve progress but add no dwell time and cannot fire',()=>{
 const d=new TargetDwell();for(let at=0;at<=850;at+=50)assert.equal(d.update('key',at),null);
 assert.equal(d.progress,.85);
 for(const at of [900,950,1000]){assert.equal(d.suspend('key',at),null);assert.equal(d.progress,.85);}
 assert.equal(d.update('key',1050),null);assert.equal(d.progress,.85);
 assert.equal(d.update('key',1100),null);assert.equal(d.update('key',1150),null);assert.equal(d.update('key',1200),'key');
});

test('long instability, a different target, and tracking loss erase partial dwell',()=>{
 for(const mode of ['long','target','loss','gap']){
  const d=new TargetDwell();for(let at=0;at<=850;at+=50)d.update('key',at);
  if(mode==='long')for(let at=900;at<=1050;at+=50)d.suspend('key',at);
  else if(mode==='target')d.suspend('another-key',900);
  else if(mode==='loss')d.update(null,900);
  else d.suspend('key',1200);
  assert.equal(d.progress,0,mode);
 }
});

test('in-target jitter cannot unlock an already selected key for repeated clicks',()=>{
 const d=new TargetDwell();for(let at=0;at<1000;at+=50)d.update('key',at);assert.equal(d.update('key',1000),'key');
 for(let at=1050;at<=2500;at+=50)assert.equal(d.suspend('key',at),null);
 assert.equal(d.locked,'key');
});
