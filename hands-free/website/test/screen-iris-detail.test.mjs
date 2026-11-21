import test from 'node:test';
import assert from 'node:assert/strict';
import {refineIris,eyeLight,irisReading,irisPatch,refineInFrame,IrisDetail,lightSummary,GLARE_LIMIT} from '../public/screen-iris-detail.mjs';
import {eyeScene,twoEyes,sceneLuminance,sceneReader,lidLines} from './support/synthetic-eyes.mjs';
// A drawn eye of width W in a 200 x 160 patch. Returns the luminance, the true
// iris circle and the lid lines, all in patch pixels (pixel i sits at i+.5).
function drawn(W,i,{noise=4,blur=1,openUp=.16,openLo=.2,overlay=null,gaze=null}={}){
 const dx=gaze?gaze[0]:-.12+.24*((i*7)%11)/10,dy=gaze?gaze[1]:-.04+.08*((i*3)%7)/6,cx=100+(i*.37)%1,cy=80+(i*.61)%1;
 const eye={cx,cy,w:W,inner:1,irisDx:dx,irisDy:dy,openUp,openLo},scene=eyeScene({width:200,height:160,eyes:[eye]}),lids=lidLines(eye);
 const shift=line=>line.map(p=>({x:p.x-.5,y:p.y-.5}));
 return {gray:sceneLuminance(scene,{x:0,y:0,width:200,height:160},{noise,blur,seed:i+1,overlay}),truth:{x:cx+dx*W-.5,y:cy+dy*W-.5,r:.2*W},lids:{upper:shift(lids.upper),lower:shift(lids.lower)}};
}
const guessFor=(truth,i,error=.15)=>({x:truth.x+error*truth.r*Math.cos(i*1.7),y:truth.y+error*truth.r*Math.sin(i*1.7),r:truth.r*(1+.1*Math.sin(i))});

test('the iris edge is located to a fraction of a camera pixel at every eye size',()=>{
 const missed={};
 for(const W of [40,60,100,150])for(let i=0;i<12;i++){
  const {gray,truth,lids}=drawn(W,i),found=refineIris(gray,200,160,guessFor(truth,i),{lids});
  // With the iris in the corner of the eye one side of its edge is hidden.
  // Before the iris size is known that gives no reading, never a wrong one.
  if(!found){missed[W]=(missed[W]||0)+1;continue;}
  assert.ok(Math.abs(found.x-truth.x)<.15&&Math.abs(found.y-truth.y)<.45,`W=${W} i=${i}: ${found.x-truth.x}, ${found.y-truth.y}`);
  assert.ok(Math.abs(found.r/truth.r-1)<.06);
 }
 for(const W of [40,60,100,150])assert.ok((missed[W]||0)<=1,`W=${W} missed ${missed[W]}`);
 // Once the size is known, the visible side is enough.
 const {gray,truth,lids}=drawn(150,3),found=refineIris(gray,200,160,guessFor(truth,3),{lids,radius:truth.r});
 assert.ok(found);assert.ok(Math.abs(found.x-truth.x)<.3,`one-sided: ${found.x-truth.x}`);
});

test('the same eye reads the same from frame to frame under sensor noise',()=>{
 const xs=[],ys=[];
 for(let i=0;i<30;i++){const {gray,truth,lids}=drawn(100,i,{gaze:[.03,.01],noise:6}),found=refineIris(gray,200,160,guessFor(truth,i),{lids});assert.ok(found);xs.push(found.x-truth.x);ys.push(found.y-truth.y);}
 const spread=a=>{const m=a.reduce((s,v)=>s+v,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);};
 assert.ok(spread(xs)<.08,`x spread ${spread(xs)}`);assert.ok(spread(ys)<.2,`y spread ${spread(ys)}`);
});

test('a poor starting estimate does not settle on the pupil edge, and works without lid lines',()=>{
 for(let i=0;i<12;i++){
  const {gray,truth}=drawn(100,i),found=refineIris(gray,200,160,guessFor(truth,i,.45));
  assert.ok(found,`i=${i}`);assert.ok(Math.hypot(found.x-truth.x,found.y-truth.y)<.5,`i=${i}`);
 }
});

test('a reflection is measured and kept out of the edge search',()=>{
 // A bright patch over one side of the iris, as glasses or a lamp produce.
 const blob=(share,side=1)=>({overlay:(c,x,y)=>Math.hypot(x-(100+side*.2*100*.8),y-78)<share*20?[255,255,255]:c,gaze:[0,0]});
 const small=drawn(100,3,blob(.45)),foundSmall=refineIris(small.gray,200,160,guessFor(small.truth,3),{lids:small.lids});
 assert.ok(foundSmall);assert.ok(Math.abs(foundSmall.x-small.truth.x)<.3,`pulled by ${foundSmall.x-small.truth.x}`);assert.ok(foundSmall.skipped>0);
 const light=eyeLight(small.gray,200,160,small.truth);assert.ok(light.glare>.02&&light.glare<GLARE_LIMIT);
 const large=drawn(100,3,blob(1.1,0));
 assert.ok(eyeLight(large.gray,200,160,large.truth).glare>GLARE_LIMIT);
 assert.equal(lightSummary(null),null);assert.ok(lightSummary(light).white>lightSummary(light).dark);
});

test('a nearly closed eye and a featureless patch give no reading rather than a wrong one',()=>{
 const closed=drawn(100,2,{openUp:.04,openLo:.04});
 assert.equal(refineIris(closed.gray,200,160,guessFor(closed.truth,2),{lids:closed.lids}),null);
 assert.equal(refineIris(new Float32Array(200*160).fill(128),200,160,{x:100,y:80,r:20}),null);
 assert.equal(refineIris(new Float32Array(200*160).fill(128),200,160,{x:100,y:80,r:1}),null);
});

test('the reading matches the eye models: position along and across the corner line',()=>{
 assert.deepEqual(irisReading({x:10,y:20},{x:110,y:20},{x:60,y:25}),{h:.5,v:.05});
 // Corner order does not matter, and a tilted eye is read in its own axes.
 assert.deepEqual(irisReading({x:110,y:20},{x:10,y:20},{x:60,y:25}),{h:.5,v:.05});
 const tilted=irisReading({x:0,y:0},{x:80,y:60},{x:40,y:30});assert.ok(Math.abs(tilted.h-.5)<1e-9&&Math.abs(tilted.v)<1e-9);
 assert.equal(irisReading({x:1,y:1},{x:1,y:1},{x:2,y:2}),null);
});

test('irises are read in frame coordinates, pixel for pixel when small and reduced when large',()=>{
 const patch=irisPatch({x:700.4,y:400.2,r:20},1920,1080);
 assert.equal(patch.scale,1);assert.ok(patch.x<=650&&patch.x+patch.width>=750);
 const big=irisPatch({x:900,y:500,r:60},1920,1080);assert.ok(big.scale<1&&big.outWidth<=112);
 assert.equal(irisPatch({x:5,y:5,r:20},1920,1080),null); // Mostly outside the frame.
 const scene=twoEyes({width:1920,height:1080,distance:.13,irisDx:.04,irisDy:-.01,openUp:.16,openLo:.2}),read=sceneReader({noise:4,blur:1});
 scene.eyes.forEach((eye,i)=>{
  const truth={x:eye.cx+.04*eye.w,y:eye.cy-.01*eye.w,r:.2*eye.w},lids=lidLines({...eye,irisDx:.04,irisDy:-.01,openUp:.16,openLo:.2});
  const found=refineInFrame(scene,{x:truth.x+2,y:truth.y-1.5,r:truth.r*1.05},read,{lids});
  assert.ok(found.iris,`eye ${i}`);assert.ok(Math.abs(found.iris.x-truth.x)<.2&&Math.abs(found.iris.y-truth.y)<.4,`eye ${i}: ${found.iris.x-truth.x}, ${found.iris.y-truth.y}`);
  assert.ok(found.light.white>found.light.dark);
 });
});

test('both eyes are read together, and the reading follows the iris, not the model estimate',()=>{
 const detail=new IrisDetail(sceneReader({noise:4,blur:1})),read=dx=>{
  const scene=twoEyes({width:1920,height:1080,distance:.13,irisDx:dx,openUp:.16,openLo:.2});
  return detail.refine(scene,scene.eyes.map(eye=>{const lids=lidLines({...eye,irisDx:dx,openUp:.16,openLo:.2});
   // The model's iris estimate is deliberately a little off, the same way for every gaze.
   return {a:{x:eye.cx-eye.w/2,y:eye.cy},b:{x:eye.cx+eye.w/2,y:eye.cy},iris:{x:eye.cx+dx*eye.w+1.5,y:eye.cy+1,r:.21*eye.w},...lids};}));
 };
 const left=read(-.06),right=read(.06);
 for(const r of [...left,...right])assert.ok(Number.isFinite(r.h)&&r.light);
 // The iris moved by .12 of the eye's width; the reading must move by the same.
 for(let i=0;i<2;i++)assert.ok(Math.abs(right[i].h-left[i].h-.12)<.004,`eye ${i}: ${right[i].h-left[i].h}`);
});

// 0.4.33. A person without glasses, a lamp on the face, eyes looking at the bottom of the screen:
// the upper lid lies over the top of the iris, and its skin is lit more brightly than the white
// of the eye. On 20 Nov (23:22) that was refused as a reflection in 31% of the frames at the
// bottom row of dots, and in 0 to 1% when the eyes were wide open.
const lamp=c=>c[0]-c[2]>40&&c[0]>140?[246,239,231]:c[0]-c[2]<=40&&c[1]>150?c.map(v=>v*.62):c;
const lowered=(i,extra={})=>drawn(100,i,{openUp:.03,openLo:.2,gaze:[0,.02],overlay:lamp,...extra});

test('a lid over the top of the iris is not a reflection',()=>{
 for(let i=0;i<6;i++){
  const eye=lowered(i),before=eyeLight(eye.gray,200,160,eye.truth),now=eyeLight(eye.gray,200,160,eye.truth,eye.lids);
  // Judged over the whole iris circle, the lit lid reads as a reflection large enough to refuse the eye.
  assert.ok(before.glare>GLARE_LIMIT,`i=${i}: ${before.glare}`);assert.equal(before.covered,undefined);
  // Judged over the open part of the eye, there is none; the lid's share is reported for what it is.
  assert.ok(now.glare<.03,`i=${i}: ${now.glare}`);assert.ok(now.covered>.3&&now.covered<.55,`covered ${now.covered}`);
  assert.ok(Math.abs(now.white-before.white)<12&&now.contrast>40,'the white of the eye and the iris are read as before');
  // The eye model's lid lines are never exact: a few pixels either way must not bring the fault back.
  for(const shift of [-6,-3,3,6]){
   const lids={upper:eye.lids.upper.map(p=>({x:p.x,y:p.y+shift})),lower:eye.lids.lower.map(p=>({x:p.x,y:p.y-shift}))},light=eyeLight(eye.gray,200,160,eye.truth,lids);
   assert.ok(light.glare<GLARE_LIMIT/2,`lid lines ${shift} px out: ${light.glare}`);
  }
  assert.equal(lightSummary(now).covered,Math.round(now.covered*100)/100);assert.equal('covered' in lightSummary(before),false);
 }
 // An eye wide open is read the same with and without the lines.
 const wide=drawn(100,2,{gaze:[0,0],overlay:lamp}),a=eyeLight(wide.gray,200,160,wide.truth),b=eyeLight(wide.gray,200,160,wide.truth,wide.lids);
 assert.ok(a.glare<.03&&b.glare<.03&&b.covered<.12&&Math.abs(a.white-b.white)<6);
 // Lid lines that are not lines are ignored, not obeyed.
 for(const bad of [{upper:[],lower:[]},{upper:[{x:1,y:NaN},{x:2,y:2}],lower:wide.lids.lower},{upper:wide.lids.upper}])assert.deepEqual(eyeLight(wide.gray,200,160,wide.truth,bad),a);
});

test('a real reflection in the open part of the eye is still measured and still refused when large',()=>{
 const spot=(radius,dy=6)=>(c,x,y)=>Math.hypot(x-100,y-(80+2+dy))<radius?[255,255,255]:lamp(c);
 const small=lowered(3,{overlay:spot(4)}),large=lowered(3,{overlay:spot(11)});
 const s=eyeLight(small.gray,200,160,small.truth,small.lids),l=eyeLight(large.gray,200,160,large.truth,large.lids);
 assert.ok(s.glare>.02&&s.glare<GLARE_LIMIT,`small ${s.glare}`);assert.ok(l.glare>GLARE_LIMIT,`large ${l.glare}`);
 // The burnt-out share is taken over the eye, not over the lids around it.
 const burnt=c=>c[0]-c[2]>40&&c[0]>140?[255,255,255]:lamp(c),skin=lowered(4,{overlay:burnt});
 assert.ok(eyeLight(skin.gray,200,160,skin.truth).clipped>.25);assert.ok(eyeLight(skin.gray,200,160,skin.truth,skin.lids).clipped<.02);
});

test('read from a camera frame, both eyes under lowered lids are lit eyes without a reflection',()=>{
 const options={width:1920,height:1080,distance:.13,irisDx:0,irisDy:.02,openUp:.03,openLo:.2},scene=twoEyes(options);
 const detail=new IrisDetail(sceneReader({noise:4,blur:1,overlay:lamp}));
 const eyes=scene.eyes.map(eye=>({a:{x:eye.cx-eye.w/2,y:eye.cy},b:{x:eye.cx+eye.w/2,y:eye.cy},iris:{x:eye.cx+1,y:eye.cy+.02*eye.w+1,r:.2*eye.w},...lidLines({...eye,...options})}));
 const readings=detail.refine(scene,eyes);
 for(const r of readings){assert.ok(r.light,'lit');assert.ok(r.light.glare<=GLARE_LIMIT/4,`glare ${r.light.glare}`);assert.ok(r.light.covered>.25);}
 // The same frame without lid lines: what 0.4.32 saw.
 const blind=new IrisDetail(sceneReader({noise:4,blur:1,overlay:lamp})).refine(scene,eyes.map(({upper,lower,...eye})=>eye));
 assert.ok(blind.every(r=>r.light&&r.light.glare>GLARE_LIMIT));
});
