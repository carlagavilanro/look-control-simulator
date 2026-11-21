// Close-up tracker behaviour with the bundled MediaPipe Iris model on a
// procedural eye scene. The scene is a drawing: these tests cover framing,
// loss and recovery, never the accuracy of gaze pointing for a person.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EyeCropTracker,EYE_BOX_PER_DISTANCE,eyeCropMeasurement} from '../public/screen-eye-crop.mjs';
import {twoEyes,eyeScene,sceneCapture,sceneReader} from './support/synthetic-eyes.mjs';
import {irisModel} from './support/iris-model.mjs';

const W=1920,H=1080,infer=await irisModel();
// These tests read thousands of eye boxes. Without the WebAssembly runtime they
// would take many minutes, so they are reported as skipped instead.
const options={skip:infer.backend==='wasm'?false:'The WebAssembly model runtime did not start in Node.'};
const marked=(spacing=.34,centerX=.5,centerY=.5)=>[{x:centerX-spacing/2,y:centerY,size:.3},{x:centerX+spacing/2,y:centerY,size:.3}];
// samples: scene samples per model pixel along each axis. Whole-frame searches read
// hundreds of boxes, so those tests use one sample to stay quick.
const tracker=(regions=marked(),detail=2,samples=2)=>new EyeCropTracker(regions,{infer,capture:sceneCapture({samples,noise:2,seed:7}),detail});
const view=(options={})=>twoEyes({width:W,height:H,distance:.34,...options});
const nobody=eyeScene({width:W,height:H,eyes:[]});
// Plays frames at 30 per second and returns one result per frame.
async function play(t,frames,sceneAt,start=0){const out=[];for(let f=0;f<frames;f++){const result=await t.detect(sceneAt(f),(start+f)*33);out.push({...result,box:t.size});}return out;}
const usable=results=>results.filter(r=>r.feature).length;
const mean=values=>values.reduce((s,v)=>s+v,0)/values.length;
const eyeError=(t,scene)=>Math.max(...t.eyes.map((eye,i)=>Math.hypot(eye.x-scene.eyes[i].cx,eye.y-scene.eyes[i].cy)))/t.size;

test('the iris model under-reports eye width in a tight box, so it cannot be trusted to size the box',options,async()=>{
 // This is why 0.4.16 lost wide-open eyes: it sized each box from this output.
 const scene=view(),eye=scene.eyes[0],capture=sceneCapture({samples:2}),width=[];
 for(const share of [.4,.6,.75]){
  const size=eye.w/share,crop={x:eye.cx-size/2,y:eye.cy-size/2,size,flip:false},input=new Float32Array(12288);capture(scene,[crop],input);
  const output=await infer(input,1),points=Array.from({length:76},(_,j)=>({x:(crop.x+output[j*3]*size/64)/W,y:(crop.y+output[j*3+1]*size/64)/H}));
  width.push(eyeCropMeasurement(points,W,H).width/eye.w);
 }
 assert.ok(width[0]>.85&&width[0]<1.15,'near the trained framing the width is about right: '+width[0]);
 assert.ok(width[1]<.8&&width[2]<.6,'a tighter box reads as a smaller eye: '+width.slice(1));
});

test('opening the eyes wide does not change the box or lose tracking',options,async()=>{
 const t=tracker(),wide=f=>f>=20&&f<45,results=await play(t,60,f=>view(wide(f)?{openUp:.4,openLo:.17}:{})),sizes=results.map(r=>r.box);
 assert.ok(usable(results)>=57,'usable frames: '+usable(results));
 assert.ok(results.slice(3).every(r=>r.feature),'no frame is lost once tracking has started');
 const openings=results.map(r=>mean(r.quality.openings));
 assert.ok(mean(openings.slice(25,45))>mean(openings.slice(5,20))+.05,'the wider opening is measured, not rejected');
 // The box follows eye spacing only: it stays within 2% through the change.
 const settled=sizes.slice(10);assert.ok(Math.max(...settled)/Math.min(...settled)<1.02,'box range '+Math.min(...settled)+'..'+Math.max(...settled));
 assert.ok(Math.abs(settled.at(-1)/(EYE_BOX_PER_DISTANCE*.34*W)-1)<.12);
 // Gaze has not changed, so the gaze reading should not move with the eyelids.
 const h=results.map(r=>r.feature?.h);assert.ok(Math.abs(mean(h.slice(25,45))-mean(h.slice(5,20)))<.02);
});

test('both eyes are found without marking, in a close-up and with the whole face in view',options,async()=>{
 const wrong=[{x:.1,y:.2,size:.2},{x:.9,y:.8,size:.2}];
 for(const [spacing,centerX,centerY] of [[.5,.5,.5],[.3,.4,.36],[.16,.68,.6]]){
  const scene=view({distance:spacing,centerX,centerY}),t=tracker(wrong,2,1);t.find();
  const results=await play(t,5,()=>scene);
  assert.ok(usable(results)>=4,`spacing ${spacing}: usable ${usable(results)}/5`);
  assert.ok(eyeError(t,scene)<.06,`spacing ${spacing}: boxes sit on the eyes`);
  assert.ok(Math.abs(t.size/(EYE_BOX_PER_DISTANCE*spacing*W)-1)<.12,`spacing ${spacing}: box size follows eye spacing`);
  const regions=results.at(-1).regions;assert.ok(regions[0].x<regions[1].x&&regions.every(r=>r.size>=.06&&r.size<=.8));
 }
});

test('one eye, or no eyes, never produces a reading',options,async()=>{
 for(const scene of [nobody,eyeScene({width:W,height:H,eyes:[{cx:700,cy:540,w:290,inner:1}]})]){
  const t=tracker(marked(),2,1);t.find();const results=await play(t,20,()=>scene);
  assert.equal(usable(results),0);assert.ok(results.some(r=>r.quality.reason==='searching'));
 }
});

test('after a sudden head movement the eyes are found again without re-marking',options,async()=>{
 const before=view(),after=view({centerX:.5+.4*.38,centerY:.56}),t=tracker();
 const first=await play(t,12,()=>before);assert.ok(usable(first)>=9);
 const moved=await play(t,45,()=>after,12);
 // A blink-length pause, one search, then tracking continues at the new place.
 assert.ok(usable(moved)>=20,'usable after the jump: '+usable(moved));assert.ok(moved.slice(-10).every(r=>r.feature));
 assert.ok(eyeError(t,after)<.06);
});

test('eyes that leave the view are found again at a new place and zoom',options,async()=>{
 const t=tracker(marked(),2,1),back=view({distance:.26,centerX:.62,centerY:.4});
 assert.ok(usable(await play(t,10,()=>view()))>=7);
 assert.equal(usable(await play(t,30,()=>nobody,10)),0);
 // Searches are spaced out while nobody is in view, so allow a few seconds.
 const returned=await play(t,150,()=>back,40);
 assert.ok(returned.slice(-10).every(r=>r.feature),'tracking resumed');
 assert.ok(eyeError(t,back)<.06);assert.ok(Math.abs(t.size/(EYE_BOX_PER_DISTANCE*.26*W)-1)<.12);
});

test('the boxes follow zooming and may extend past the frame in an extreme close-up',options,async()=>{
 const t=tracker(),zoom=f=>.34*(1+.8*Math.min(1,Math.max(0,(f-8)/40))),results=await play(t,56,f=>view({distance:zoom(f)}));
 assert.ok(usable(results)>=52,'usable while zooming: '+usable(results));
 // Spacing 0.61 of the frame width: each box is taller than the 16:9 frame.
 assert.ok(t.size>H,'box '+t.size);assert.ok(Math.abs(t.size/(EYE_BOX_PER_DISTANCE*zoom(56)*W)-1)<.12);
 assert.ok(results.slice(-8).every(r=>r.feature));
});

test('gaze readings rise steadily from left to right and mirror around the centre',options,async()=>{
 const t=tracker(marked(),4),h=[];
 for(const gaze of [-.2,-.1,0,.1,.2]){const results=await play(t,10,()=>view({irisDx:gaze}),h.length*10);assert.ok(usable(results)>=7,'gaze '+gaze);h.push(mean(results.slice(4).filter(r=>r.feature).map(r=>r.feature.h)));}
 for(let i=1;i<h.length;i++)assert.ok(h[i]-h[i-1]>.03,'each step moves the reading: '+h);
 // A symmetric scene must read symmetrically: no built-in pull to one side.
 assert.ok(Math.abs(h[2]-.5)<.02,'centre '+h[2]);
 assert.ok(Math.abs(h[0]+h[4]-1)<.03&&Math.abs(h[1]+h[3]-1)<.03,'left and right mirror: '+h);
});

test('each close-up frame also carries the iris reading from camera pixels and how the eyes are lit',options,async()=>{
 const read=sceneReader({noise:4,blur:1}),at=dx=>twoEyes({width:W,height:H,distance:.2,irisDx:dx,openUp:.16,openLo:.2});
 const run=async dx=>{const t=new EyeCropTracker(marked(.2),{infer,capture:sceneCapture({samples:2,noise:2,seed:7}),detail:2,read});return (await play(t,12,()=>at(dx))).filter(r=>r.feature).slice(-6);};
 const left=await run(-.06),right=await run(.06);
 assert.ok(left.length>=5&&right.length>=5);
 for(const r of [...left,...right]){
  assert.ok(r.feature.alt,'second reading present');
  for(const key of ['h','v','lh','lv','rh','rv'])assert.ok(Number.isFinite(r.feature.alt[key]),key);
  assert.equal(r.quality.light.length,2);assert.ok(r.quality.light.every(l=>l.white>l.dark&&l.glare<.1));
 }
 // Both readings move the same way with the gaze; the camera-pixel one by the
 // amount the iris really moved relative to the corners the model reports.
 const shift=key=>mean(right.map(r=>r.feature.alt[key]))-mean(left.map(r=>r.feature.alt[key])),plain=mean(right.map(r=>r.feature.h))-mean(left.map(r=>r.feature.h));
 assert.ok(shift('h')>.03&&plain>.03,`alt ${shift('h')} plain ${plain}`);
 // Without a reader (as in Node without a canvas) frames simply have one reading.
 const bare=await play(tracker(marked(.2)),8,()=>at(0));assert.ok(bare.at(-1).feature&&!bare.at(-1).feature.alt);
});
