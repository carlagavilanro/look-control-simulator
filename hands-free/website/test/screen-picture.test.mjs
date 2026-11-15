import test from 'node:test';
import assert from 'node:assert/strict';
import {pictureControls,setPicture,pictureStep,PictureTuner,FaceFraming,cameraSnapshot,cameraSetupFields,CAMERA_CONTROLS} from '../public/screen-camera.mjs';
import {framePoints,faceExtent,faceEyes} from '../public/screen-face-detail.mjs';
// A camera whose picture responds to its controls like a real one: the white of
// the eye gets brighter with exposure compensation and brightness.
function camera({compensation=true,ignores=false}={}){
 const s={deviceId:'cam',width:1920,height:1080,frameRate:30,brightness:128,contrast:32,exposureMode:'continuous',exposureTime:156,whiteBalanceMode:'continuous',colorTemperature:4600,focusMode:'continuous',focusDistance:100,...(compensation?{exposureCompensation:0}:{})};
 const caps={brightness:{min:0,max:255,step:1},contrast:{min:0,max:64,step:1},hue:{min:-10,max:10},exposureMode:['continuous','manual'],exposureTime:{min:1,max:5000,step:1},whiteBalanceMode:['continuous','manual'],colorTemperature:{min:2800,max:6500,step:10},focusMode:['continuous','manual'],focusDistance:{min:0,max:255,step:5},sharpness:{min:3,max:3},...(compensation?{exposureCompensation:{min:-4,max:4,step:.5}}:{})};
 const track={label:'EMEET SmartCam C60E 4K Dual',applied:[],getSettings:()=>({...s}),getCapabilities:()=>caps,applyConstraints:async c=>{track.applied.push(c.advanced[0]);if(!ignores)Object.assign(s,c.advanced[0]);}};
 track.white=base=>Math.max(0,Math.min(255,base+(s.exposureCompensation||0)*30+(s.brightness-128)*.8));
 return track;
}
const lit=white=>[{white,dark:60,contrast:white-60,glare:0,clipped:white>=250?.2:0},{white,dark:60,contrast:white-60,glare:0,clipped:white>=250?.2:0}];

test('only picture adjustments the camera really reports are offered',()=>{
 const controls=pictureControls(camera());
 assert.deepEqual(controls.map(c=>c.key),['exposureCompensation','exposureTime','brightness','contrast','colorTemperature','focusDistance']);
 // A fixed "range" (sharpness 3..3) and anything outside the browser interface (hue) are not listed.
 const exposure=controls.find(c=>c.key==='exposureTime');assert.equal(exposure.automatic,true);assert.equal(exposure.canAuto,true);
 assert.equal(controls.find(c=>c.key==='brightness').value,128);assert.equal(controls.find(c=>c.key==='brightness').canAuto,false);
 assert.deepEqual(pictureControls(null),[]);assert.deepEqual(pictureControls({getSettings:()=>({}),getCapabilities:()=>({})}),[]);
});

test('a manual value switches its own mode, is clamped and read back; automatic can be restored',async()=>{
 const track=camera();
 const time=await setPicture(track,'exposureTime',99999);
 assert.deepEqual(track.applied.at(-1),{exposureMode:'manual',exposureTime:5000});assert.equal(time.value,5000);assert.equal(time.automatic,false);
 assert.equal((await setPicture(track,'exposureTime','auto')).automatic,true);assert.deepEqual(track.applied.at(-1),{exposureMode:'continuous'});
 assert.equal((await setPicture(track,'brightness',-5)).value,0);
 await assert.rejects(()=>setPicture(track,'brightness','auto'),/no automatic/);
 await assert.rejects(()=>setPicture(track,'hue',3),/does not offer/);
 await assert.rejects(()=>setPicture(track,'contrast',NaN),/Invalid/);
 // The chosen values are part of the saved camera setup.
 assert.ok(CAMERA_CONTROLS.includes('exposureCompensation'));
 const saved=cameraSnapshot(camera(),{lens:'telephoto',mode:'4k'});assert.equal(saved.controls.exposureCompensation,0);
 assert.equal(cameraSetupFields(saved).controls.exposureCompensation,0);
});

test('brightness is judged from the eyes: too dark, too bright or burnt out',()=>{
 assert.equal(pictureStep(lit(90)),1);assert.equal(pictureStep(lit(170)),0);assert.equal(pictureStep(lit(230)),-1);
 assert.equal(pictureStep([{white:170,clipped:.05},null]),-1);
 assert.equal(pictureStep([null,null]),0);assert.equal(pictureStep(null),0);
});

test('the picture is brought into range for the eyes and then left alone',async()=>{
 for(const [base,compensation] of [[70,true],[250,true],[80,false]]){
  const track=camera({compensation}),tuner=new PictureTuner(track);assert.ok(tuner.available);
  let result;for(let i=0;i<20;i++){result=await tuner.step(lit(track.white(base)));if(result.done)break;}
  assert.ok(result.done,`base ${base}`);assert.match(result.message,/Picture set/);
  assert.equal(pictureStep(lit(track.white(base))),0,`white ${track.white(base)}`);
  // Automatic exposure stays on: compensation or brightness is used first.
  assert.equal(track.getSettings().exposureMode,'continuous');
 }
 const fine=new PictureTuner(camera());assert.match((await fine.step(lit(170))).message,/already well lit/);
});

test('a camera that ignores or lacks the control is reported, not retried forever',async()=>{
 const ignoring=new PictureTuner(camera({ignores:true}));
 const result=await ignoring.step(lit(60));assert.ok(result.done);assert.match(result.message,/did not apply/);
 const none=new PictureTuner({getSettings:()=>({}),getCapabilities:()=>({})});
 assert.equal(none.available,false);assert.match((await none.step(lit(60))).message,/does not let the app/);
 // Eyes that stay too bright at the lowest setting end with advice.
 const track=camera(),stuck=new PictureTuner(track);let last;for(let i=0;i<30;i++){last=await stuck.step(lit(255));if(last.done)break;}
 assert.ok(last.done);assert.match(last.message,/still bright/);
});

test('a distant face is followed in a square of camera pixels that stays put while the face is inside it',()=>{
 const framing=new FaceFraming(),W=3840,H=2160;
 // Nothing known yet: the whole frame, reduced for the model.
 assert.deepEqual(framing.next(W,H),{x:0,y:0,width:W,height:H,outWidth:1280,outHeight:720});
 const face=(cx,cy,size)=>({x0:(cx-size/2)/W,x1:(cx+size/2)/W,y0:(cy-size/2)/H,y1:(cy+size/2)/H});
 framing.update(face(2000,900,240),W,H);
 const view=framing.next(W,H);
 // 2.3 face sizes across, centred on the face, sent pixel for pixel.
 assert.deepEqual(view,{x:1724,y:624,width:552,height:552,outWidth:552,outHeight:552});
 framing.update(face(2040,930,250),W,H);assert.deepEqual(framing.next(W,H),view);
 // Near the edge of the square, or much larger: a new square.
 framing.update(face(2140,930,250),W,H);assert.deepEqual(framing.next(W,H),{...view,x:2140-276});
 framing.update(face(2140,930,420),W,H);assert.equal(framing.next(W,H).width,Math.round(2.3*420));
 // A face that fills the picture is sent reduced, and squares never leave the frame.
 framing.update(face(1900,1100,1500),W,H);assert.deepEqual(framing.next(W,H),{x:820,y:0,width:2160,height:2160,outWidth:768,outHeight:768});
 // A face too large for the largest square does not keep moving it: only a
 // real move sideways does, and the square never leaves the frame.
 const largest=framing.next(W,H);
 for(const jitter of [3,-2,5,-4])framing.update(face(1900+jitter,1100+jitter,1500+jitter),W,H);
 assert.deepEqual(framing.next(W,H),largest);
 framing.update(face(1900,1500,1500),W,H);assert.deepEqual(framing.next(W,H),largest,'cannot move up or down: unchanged');
 framing.update(face(2500,1100,1500),W,H);assert.equal(framing.next(W,H).x,2500-1080);
 framing.update(face(60,50,200),W,H);const corner=framing.next(W,H);assert.equal(corner.x,0);assert.equal(corner.y,0);assert.equal(corner.width,460);
});

test('a lost face is looked for in the whole frame and then in tiles that cover it',()=>{
 const framing=new FaceFraming(),W=3840,H=2160;
 framing.update({x0:.5,x1:.56,y0:.4,y1:.5},W,H);assert.ok(framing.view);
 for(let i=0;i<5;i++)framing.update(null,W,H);assert.ok(framing.view,'a blink does not drop the square');
 framing.update(null,W,H);assert.equal(framing.view,null);assert.equal(framing.next(W,H).width,W);
 for(let i=0;i<12;i++)framing.update(null,W,H);
 assert.ok(framing.scan);
 const covered=new Uint8Array((W/40)*(H/40));let count=0,first=null;
 while(framing.scan){
  const t=framing.next(W,H);first??=t;count++;assert.ok(t.x>=0&&t.y>=0&&t.x+t.width<=W&&t.y+t.height<=H);assert.ok(t.outWidth<=768);
  for(let y=Math.floor(t.y/40);y<Math.ceil((t.y+t.height)/40);y++)for(let x=Math.floor(t.x/40);x<Math.ceil((t.x+t.width)/40);x++)covered[y*(W/40)+x]=1;
  framing.update(null,W,H);
 }
 assert.ok(covered.every(Boolean),'tiles cover the frame');assert.ok(count>20&&count<120,`tiles ${count}`);
 // The first tile is in the middle, where a person usually is.
 assert.ok(Math.abs(first.x+first.width/2-W/2)<=first.width/2&&Math.abs(first.y+first.height/2-H/2)<=first.height/2);
 // A face seen in a tile becomes the square at once; a small frame is never tiled.
 for(let i=0;i<12;i++)framing.update(null,W,H);framing.next(W,H);framing.update({x0:.1,x1:.14,y0:.2,y1:.27},W,H);
 assert.equal(framing.scan,null);assert.ok(framing.view&&framing.view.size<700);
 const small=new FaceFraming();for(let i=0;i<40;i++)small.update(null,640,360);assert.equal(small.scan,null);
});

test('landmarks from the square are reported in whole-frame coordinates',()=>{
 const view={x:1724,y:624,width:552,height:552,frameWidth:3840,frameHeight:2160};
 const points=framePoints([{x:0,y:0,z:.1},{x:1,y:1,z:0},{x:.5,y:.25,z:0}],view);
 assert.ok(Math.abs(points[0].x-1724/3840)<1e-12&&Math.abs(points[1].y-(624+552)/2160)<1e-12&&Math.abs(points[2].x-2000/3840)<1e-12);
 assert.ok(Math.abs(points[0].z-.1*552/3840)<1e-12);
 const extent=faceExtent(points);for(const [key,value] of Object.entries({x0:1724/3840,y0:624/2160,x1:2276/3840,y1:1176/2160}))assert.ok(Math.abs(extent[key]-value)<1e-12,key);
 assert.equal(faceExtent(null),null);assert.equal(framePoints(undefined,view),undefined);
 // Eyes for the camera-pixel reader: corners, iris circle and lid lines in image pixels.
 const local=Array.from({length:478},(_,i)=>({x:.5,y:.5,z:0}));
 Object.assign(local[33],{x:.30});Object.assign(local[133],{x:.42});Object.assign(local[468],{x:.36});
 [469,470,471,472].forEach((i,k)=>Object.assign(local[i],{x:.36+.02*Math.cos(k*Math.PI/2),y:.5+.02*Math.sin(k*Math.PI/2)}));
 const [right,left]=faceEyes(local,500,500);
 assert.deepEqual(right.a,{x:150,y:250});assert.deepEqual(right.b,{x:210,y:250});assert.ok(Math.abs(right.iris.x-180)<1e-9&&Math.abs(right.iris.r-10)<1e-9);
 assert.equal(right.upper.length,9);assert.equal(right.lower.length,9);assert.equal(left.upper.length,9);
});
