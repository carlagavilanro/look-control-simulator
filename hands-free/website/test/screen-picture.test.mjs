import test from 'node:test';
import assert from 'node:assert/strict';
import {pictureControls,setPicture,pictureStep,PictureTuner,probePicture,FaceFraming,cameraSnapshot,cameraSetupFields,CAMERA_CONTROLS} from '../public/screen-camera.mjs';
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
 // Values are sent in whole steps of the control.
 assert.equal((await setPicture(track,'brightness',140.4)).value,140);assert.equal((await setPicture(track,'focusDistance',103)).value,105);assert.equal((await setPicture(track,'exposureCompensation',1.3)).value,1.5);
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
 const track=camera({ignores:true}),before=track.getSettings(),ignoring=new PictureTuner(track);
 let result;for(let i=0;i<40;i++){result=await ignoring.step(lit(60));if(result.done)break;}
 assert.ok(result.done);assert.match(result.message,/Nothing the camera offers made your eyes brighter \(eye brightness 60 of 255; 130 or more works best\)\. Tried: exposure, brightness\. Add light/);
 assert.deepEqual(track.getSettings(),before);assert.ok(ignoring.log.length>=4&&ignoring.log.every(entry=>entry.skipped||entry.worked===false));
 const none=new PictureTuner({getSettings:()=>({}),getCapabilities:()=>({})});
 assert.equal(none.available,false);assert.match((await none.step(lit(60))).message,/does not let the app/);
 // Eyes that stay burnt out whatever is tried end with advice, and the camera as it was.
 const glare=camera(),was=glare.getSettings(),stuck=new PictureTuner(glare);let last;for(let i=0;i<60;i++){last=await stuck.step(lit(255),{picture:120});if(last.done)break;}
 assert.ok(last.done);assert.match(last.message,/still too bright/);
 const now=glare.getSettings();for(const key of ['exposureMode','exposureCompensation','brightness'])assert.equal(now[key],was[key],key);
 // No reading of the eyes: nothing is changed.
 const blind=camera(),waiting=new PictureTuner(blind);assert.equal((await waiting.step([null,null])).done,false);assert.equal(blind.applied.length,0);
});

// A webcam as Windows presents it. Left to itself it uses its own exposure time
// and gain (`time`, `gain`), whatever it reports: it reports 1/32 s and
// `reports` as its gain. It stores a gain it is given and ignores it until the
// exposure is manual; the "exposure compensation" the browser shows is that
// gain. Exposure time moves in whole stops. `obeys` says which adjustments have
// any effect, `mode:false` never leaves automatic exposure, and `deaf` accepts
// and reports everything and changes nothing.
function webcam({room=.96,gain=40,reports=gain,time=312.5,gainMax=100,deaf=false,mode=true,obeys={}}={}){
 obeys={time:true,gain:true,brightness:true,compensation:false,...obeys};
 const s={deviceId:'cam',width:3840,height:2160,frameRate:30,exposureMode:'continuous',exposureTime:312.5,exposureCompensation:reports,brightness:128,contrast:128,whiteBalanceMode:'continuous',colorTemperature:3524};
 const caps={exposureMode:['continuous','manual'],exposureTime:{min:1.220703125,max:10000,step:1.220703125},exposureCompensation:{min:0,max:gainMax,step:1},brightness:{min:0,max:255,step:1},contrast:{min:0,max:255,step:1},whiteBalanceMode:['continuous','manual'],colorTemperature:{min:2800,max:6500,step:1}};
 const track={applied:[],getSettings:()=>({...s}),getCapabilities:()=>caps,applyConstraints:async constraints=>{
  const c=constraints.advanced[0];track.applied.push(c);
  if(deaf){Object.assign(s,c);if(c.exposureMode==='continuous')s.exposureTime=312.5;if(c.whiteBalanceMode==='continuous')s.colorTemperature=3524;return;}
  if(c.exposureMode&&(mode||c.exposureMode==='continuous')){s.exposureMode=c.exposureMode;if(c.exposureMode==='continuous')s.exposureTime=312.5;}
  if(c.exposureTime!==undefined&&s.exposureMode==='manual')s.exposureTime=10000*2**Math.round(Math.log2(c.exposureTime/10000));
  for(const key of ['exposureCompensation','brightness','contrast','whiteBalanceMode','colorTemperature'])if(c[key]!==undefined)s[key]=c[key];
  if(c.whiteBalanceMode==='continuous')s.colorTemperature=3524;
 }};
 // How bright the white of the eye would be without the limit of 255.
 track.raw=()=>{
  if(deaf)return room*time/312.5*(1+gain/25)*20;
  const manual=s.exposureMode==='manual',t=manual&&obeys.time?s.exposureTime:time;
  const g=manual&&obeys.gain?s.exposureCompensation:gain+(obeys.compensation&&!manual?s.exposureCompensation-reports:0);
  return room*t/312.5*(1+Math.max(0,g)/25)*20+(obeys.brightness?(s.brightness-128)*.5:0);
 };
 track.white=()=>Math.max(0,Math.min(255,track.raw()));
 return track;
}
// Runs the tuning to its end. `lose` gives the raw brightness beyond which the
// tracker no longer finds the eyes; the whole picture's brightness goes with it.
async function tune(track,{limit=90,lose=null}={}){
 const tuner=new PictureTuner(track),seen=[];let result,calls=0;
 for(;calls<limit;calls++){
  const raw=track.raw();seen.push(raw);
  const visible=!lose||raw<=lose.above&&raw>=lose.below;
  result=await tuner.step(visible?lit(Math.max(0,Math.min(255,raw))):null,{picture:Math.max(0,Math.min(255,raw*.75))});
  if(result.done)break;
 }
 return {tuner,result,calls,seen};
}

test('a camera that ignores its gain while it sets its own exposure is taken over, and the eyes get brighter',async()=>{
 const track=webcam();assert.equal(Math.round(track.white()),50);
 const {tuner,result}=await tune(track);
 assert.ok(result.done);assert.match(result.message,/Picture set for your eyes/);assert.equal(pictureStep(lit(track.white())),0);
 const now=track.getSettings();
 assert.equal(now.exposureMode,'manual');assert.equal(now.exposureTime,312.5);assert.equal(now.exposureCompensation,100);assert.ok(now.brightness>128);
 // The first attempt (with the camera's own exposure running) did nothing and was recorded as such.
 const first=tuner.log.filter(entry=>entry.lever==='exposure');assert.equal(first.length,2);assert.ok(first.every(entry=>entry.worked===false&&entry.eyesBefore===50&&entry.eyesAfter===50));
 assert.ok(tuner.log.some(entry=>entry.lever==='gain'&&entry.worked));assert.ok(tuner.log.some(entry=>entry.lever==='exposure time'&&entry.worked));
 // The exposure is never made longer than a frame, which would slow the camera down.
 assert.ok(track.applied.every(c=>c.exposureTime===undefined||c.exposureTime<=333));
});

test('a camera that exposes far less than it reports is taken over from below and never burnt out',async()=>{
 // Reported: 1/32 s. Used: 1/256 s. Given a quarter of the reported time it gets brighter, as one real camera did.
 const track=webcam({room:4,time:312.5/8,gain:100});assert.equal(Math.round(track.white()),50);
 const {result,seen}=await tune(track);
 assert.ok(result.done);assert.match(result.message,/Picture set for your eyes/);assert.equal(pictureStep(lit(track.white())),0);
 assert.ok(Math.max(...seen)<=BRIGHTEST,`brightest on the way ${Math.max(...seen)}`);
 const now=track.getSettings();assert.equal(now.exposureMode,'manual');assert.ok(now.exposureTime<312.5);
 // Even one that turns white the moment it is taken over, losing the eyes, is walked back into range.
 const wild=webcam({room:32,time:312.5/64,gain:100});assert.equal(Math.round(wild.white()),50);
 const walked=await tune(wild,{lose:{above:300,below:8}});
 assert.ok(walked.result.done);assert.match(walked.result.message,/Picture set for your eyes/);assert.equal(pictureStep(lit(wild.white())),0);
 assert.ok(walked.tuner.log.some(entry=>entry.worked===null),'steps without a reading were taken');
});
const BRIGHTEST=205;

test('a camera that reports more gain than it uses is brightened by the takeover itself',async()=>{
 const track=webcam({gain:40,reports:100});assert.equal(Math.round(track.white()),50);
 const {result}=await tune(track);
 assert.ok(result.done);assert.match(result.message,/Picture set for your eyes/);
 const now=track.getSettings();assert.equal(now.exposureMode,'manual');assert.equal(now.exposureCompensation,100);assert.ok(now.brightness>128);
 // Already well lit: nothing is touched.
 const fine=webcam({room:2.9}),before=fine.getSettings();assert.match((await tune(fine)).result.message,/already well lit/);assert.deepEqual(fine.getSettings(),before);
});

test('when the camera has nothing more to give, it is left as bright as it got and the person is told to add light',async()=>{
 const track=webcam({room:.3});
 const {tuner,result}=await tune(track);
 assert.ok(result.done);assert.match(result.message,/as far as the camera’s adjustments go: eye brightness 16 → \d+ \(130 or more works best\)\. The camera already exposes for a whole frame\. Add light in front of your face\./);
 const now=track.getSettings();assert.equal(now.exposureCompensation,100);assert.ok(now.brightness>=250);assert.ok(track.white()>80);assert.equal(tuner.longest,true);
});

test('a camera that accepts every value and changes nothing is put back exactly as it was',async()=>{
 const track=webcam({deaf:true}),before=track.getSettings();
 const {tuner,result}=await tune(track);
 assert.ok(result.done);assert.match(result.message,/Nothing the camera offers made your eyes brighter \(eye brightness 50 of 255; 130 or more works best\)\. Tried: exposure, exposure taken over, exposure time, gain, brightness\./);
 assert.deepEqual(track.getSettings(),before);
 assert.ok(tuner.log.filter(entry=>entry.worked===false).length>=8);assert.ok(!tuner.log.some(entry=>entry.worked));
 // One that never leaves automatic exposure, and one whose manual exposure does nothing: the exposure stays with the camera.
 for(const odd of [webcam({mode:false}),webcam({obeys:{time:false,gain:false}})]){
  const run=await tune(odd);assert.ok(run.result.done);assert.match(run.result.message,/Picture set|as far as/);assert.equal(odd.getSettings().exposureMode,'continuous');assert.ok(odd.white()>50);
 }
});

test('exposure time moves in whole stops, and a stop too far is undone and finished with the finer adjustments',async()=>{
 // Burnt out, gain already at its lowest, brightness already used up: only a shorter exposure is left.
 const track=webcam({room:16,gain:0});await setPicture(track,'brightness',0);
 assert.equal(pictureStep(lit(track.white())),-1);
 const {result}=await tune(track);
 assert.ok(result.done,result.message);assert.match(result.message,/Picture set/);
 const now=track.getSettings();assert.equal(now.exposureMode,'manual');assert.ok(now.exposureTime<312.5);
 assert.ok(Number.isInteger(Math.log2(312.5/now.exposureTime)),'whole stops');
 assert.equal(pictureStep(lit(track.white())),0,`eye brightness ${track.white()}`);
});

test('eyes lost from view for another reason end the tuning with the camera as it was',async()=>{
 const track=webcam(),before=track.getSettings(),tuner=new PictureTuner(track);
 let result;for(let i=0;i<5;i++)result=await tuner.step(lit(track.white()),{picture:90});
 assert.equal(result.done,false);assert.notDeepEqual(track.getSettings(),before);
 for(let i=0;i<8&&!result.done;i++)result=await tuner.step(null,{picture:90});
 assert.ok(result.done);assert.match(result.message,/lost from view.*put back as it was/);assert.deepEqual(track.getSettings(),before);
});

const CAMERAS=Number(process.env.HANDS_FREE_CAMERAS)||1500;
test('whatever the camera, the tuning ends, never leaves the eyes worse lit, and reaches the range when the camera can',async()=>{
 let state=20261115;const random=()=>{state=(state*1103515245+12345)%2147483648;return state/2147483648;},pick=list=>list[Math.floor(random()*list.length)];
 const off=level=>level<130?130-level:level>205?level-205:0;
 let reachable=0,reached=0;const failures=[];
 for(let n=0;n<CAMERAS;n++){
  const gain=Math.round(random()*100),spec={room:.2*150**random(),time:312.5/2**Math.floor(random()*7),gain,reports:pick([gain,gain,100,0]),deaf:random()<.08,mode:random()<.9,
   obeys:{time:random()<.85,gain:random()<.8,brightness:random()<.8,compensation:random()<.2}};
  const track=webcam(spec),start=track.white(),before=track.getSettings(),lose=random()<.6?{above:280+random()*400,below:2+random()*8}:null;
  // Eyes that cannot be seen to begin with: the page asks for them to be found first.
  if(lose&&(track.raw()<lose.below||track.raw()>lose.above))continue;
  const {result,calls}=await tune(track,{lose,limit:120}),end=track.white(),label=JSON.stringify({...spec,lose,start:Math.round(start),end:Math.round(end),calls,message:result.message});
  if(!result.done){failures.push('did not end: '+label);continue;}
  const unchanged=JSON.stringify(track.getSettings())===JSON.stringify(before);
  if(off(end)>off(start)+1e-9||end>=250&&start<250)failures.push('worse: '+label);
  if(!unchanged&&!(off(end)<off(start)))failures.push('changed without being better: '+label);
  // What a camera that obeys everything could reach: all the way down and all the way up.
  const able=!spec.deaf&&spec.mode&&spec.obeys.time&&spec.obeys.gain&&spec.obeys.brightness;
  if(able&&off(start)>0&&spec.room*5*20+63.5>=140){reachable++;if(off(end)===0)reached++;else failures.push('not reached: '+label);}
 }
 assert.deepEqual(failures.slice(0,6),[],`${failures.length} failures`);
 assert.ok(reachable>CAMERAS/6,`reachable ${reachable}`);assert.equal(reached,reachable);
 if(process.env.HANDS_FREE_CAMERAS)console.log(`cameras ${CAMERAS}, able to reach the range ${reachable}, reached ${reached}`);
});

test('the camera test says which adjustments change the picture, and puts every one back',async()=>{
 const picture=track=>[Array.from({length:40},()=>track.white())];
 const track=webcam(),before=track.getSettings(),seen=[];
 const results=await probePicture(track,async()=>picture(track),{pause:async()=>{},onProgress:(r,i,n)=>seen.push(`${i}/${n} ${r.label}`)});
 const verdicts=Object.fromEntries(results.map(r=>[r.label,r.verdict]));
 assert.deepEqual(verdicts,{'Exposure / gain':'reported only','Exposure / gain, exposure time held':'works','Exposure time':'works','Brightness':'works','Contrast':'reported only','White balance':'reported only'});
 assert.deepEqual(track.getSettings(),before);assert.equal(seen.length,6);assert.equal(seen[0],'1/6 Exposure / gain');
 const time=results.find(r=>r.key==='exposureTime');assert.equal(time.to,312.5/4);assert.ok(time.brighter<0);
 // Brightness had more room below its value: the picture got darker, and was put back.
 assert.ok(results.find(r=>r.label==='Brightness').brighter<0);
 // A camera that takes every value and does nothing, and one that refuses.
 const deaf=webcam({deaf:true}),same=deaf.getSettings();
 assert.ok((await probePicture(deaf,async()=>picture(deaf),{pause:async()=>{}})).every(r=>r.verdict==='reported only'));assert.deepEqual(deaf.getSettings(),same);
 const frozen=camera({ignores:true});
 assert.ok((await probePicture(frozen,async()=>[[5,5,5]],{pause:async()=>{}})).every(r=>r.verdict==='ignored'));
 const refusing=webcam();refusing.applyConstraints=async()=>{throw Error('no');};
 assert.ok((await probePicture(refusing,async()=>[[5]],{pause:async()=>{}})).every(r=>r.verdict==='rejected'&&r.error==='no'));
 // A picture that changes by itself (a person moving) is not mistaken for the camera obeying.
 let n=0;const restless=webcam({deaf:true});
 assert.ok((await probePicture(restless,async()=>[[n++%2?60:40]],{pause:async()=>{}})).every(r=>r.verdict!=='works'));
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
