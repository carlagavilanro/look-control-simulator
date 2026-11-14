import test from 'node:test';
import assert from 'node:assert/strict';
import {videoConstraints,cameraSnapshot,sameCameraGeometry,restoreCameraControls,cameraSetupFields,cameraCrop,CameraZoomQueue,lensControl,lensZoom,lensCalibrationBank,calibrationForLens,identifySavedLens} from '../public/screen-camera.mjs';
import {sameSetup,balancedCalibrationScore,horizontalAccuracy} from '../public/screen-gaze.mjs';
const track=(initial={zoom:2})=>{
 const s={deviceId:'external',width:3840,height:2160,frameRate:30,...initial};
 return {label:'EMEET',getSettings:()=>({...s}),getCapabilities:()=>({zoom:{min:1,max:11},pan:{min:-10,max:10},focusMode:['continuous','manual']}),applyConstraints:async c=>Object.assign(s,c.advanced[0])};
};
const preferences={lens:'telephoto',externalZoom:3,mode:'4k'};

test('older unnamed C60E lens maps use saved driver geometry, never the present lens or another device',()=>{
 const t={label:'EMEET SmartCam C60E 4K Dual',getSettings:()=>({zoom:0,deviceId:'external'}),getCapabilities:()=>({zoom:{min:0,max:400}})};
 const old={model:{id:1},setup:{cameraVersion:1,lens:'unspecified',externalZoom:2,deviceId:'external',controls:{zoom:330}},headPositions:[{id:1}]};
 const identified=identifySavedLens(old,t);assert.equal(identified.setup.lens,'telephoto');assert.equal(identified.setup.controls.zoom,330);assert.equal(identified.setup.externalZoom,null);assert.deepEqual(identified.headPositions,old.headPositions);assert.equal(old.setup.lens,'unspecified');
 assert.equal(identifySavedLens({...old,setup:{...old.setup,deviceId:'other'}},t).setup.lens,'unspecified');
 assert.equal(identifySavedLens({...old,setup:{...old.setup,controls:{}}},t).setup.lens,'unspecified');
 assert.equal(identifySavedLens({...old,setup:{...old.setup,lens:'wide'}},t).setup.lens,'wide');
 assert.equal(identifySavedLens(old,null),old);
});

test('C60E physical lens commands use actual device endpoints and readback',async()=>{
 let zoom=330;const t={label:'EMEET SmartCam C60E 4K Dual',getSettings:()=>({zoom,height:2160,frameRate:30}),getCapabilities:()=>({zoom:{min:0,max:400}}),applyConstraints:async c=>{zoom=c.zoom.exact;}};
 assert.equal(lensControl(t).lens,'telephoto');assert.equal(lensControl(t).lensOnly,true);
 const q=new CameraZoomQueue(t);await q.set(lensZoom(t,'wide'));assert.equal(zoom,0);assert.equal(lensControl(t).lens,'wide');
 await q.set(lensZoom(t,'telephoto'));assert.equal(zoom,400);assert.equal(lensControl(t).lens,'telephoto');
 t.getSettings=()=>({zoom:200,height:1080,frameRate:30});assert.equal(lensControl(t).lens,'wide');assert.equal(lensControl(t).lensOnly,false);
 t.getSettings=()=>({zoom:201,height:1080,frameRate:60});assert.equal(lensControl(t).lens,'telephoto');assert.equal(lensControl(t).lensOnly,true);
});
test('ordinary webcam zoom and unsupported camera drivers are never called physical lens switching',()=>{
 const t=track();assert.equal(lensControl(t).supported,false);assert.throws(()=>lensZoom(t,'wide'),/does not expose/);
 t.label='EMEET SmartCam C60E 4K Dual';t.getCapabilities=()=>({});assert.equal(lensControl(t).supported,false);
 assert.throws(()=>lensZoom(t,'telephoto'));assert.equal(lensControl(null).supported,false);
});
test('lens banks keep each camera and lens map and head positions without recursive records',()=>{
 const make=(lens,deviceId='external')=>({model:{id:lens},setup:{deviceId,lens},validation:{passed:false},headPositions:[{id:1}],activePositionId:1,savedAt:123,cameraPresets:[{}],lensCalibrations:[{}]});
 const wide=make('wide'),tele=make('telephoto'),other=make('wide','other');
 const lensCalibrations=lensCalibrationBank(tele,[wide,other]),root={...tele,lensCalibrations};
 assert.equal(lensCalibrations.length,3);assert.equal(calibrationForLens(root,'external','wide').model.id,'wide');
 assert.deepEqual(calibrationForLens(root,'external','wide').headPositions,wide.headPositions);
 assert.equal(calibrationForLens(root,'other','telephoto'),null);assert.equal(calibrationForLens(root,'unknown','wide'),null);
 assert.ok(lensCalibrations.every(r=>!r.lensCalibrations&&!r.cameraPresets));assert.equal(wide.cameraPresets.length,1);
 const updated={...wide,model:{id:'new wide'}};assert.equal(lensCalibrationBank(updated,lensCalibrations).length,3);
 assert.equal(calibrationForLens({...updated,lensCalibrations},'external','wide').model.id,'new wide');
 assert.equal(lensCalibrationBank(other,Array.from({length:12},(_,i)=>make('wide','camera'+i))).length,6);
 const recent=lensCalibrationBank(make('wide','camera0'),Array.from({length:6},(_,i)=>make('wide','camera'+i)));
 assert.equal(recent.at(-1).setup.deviceId,'camera0');assert.equal(lensCalibrationBank(make('wide','new'),recent).some(r=>r.setup.deviceId==='camera0'),true);
});
test('4K crop uses original pixels and keeps the chosen aspect ratio without upscaling',()=>{
 assert.deepEqual(cameraCrop(3840,2160,{zoom:2,x:.5,y:.5}),{x:960,y:540,width:1920,height:1080});
 assert.deepEqual(cameraCrop(3840,2160,{zoom:4,x:1,y:0}),{x:2880,y:0,width:960,height:540});
 assert.deepEqual(cameraCrop(3840,2160),{x:0,y:0,width:3840,height:2160});
 for(const c of [{zoom:0},{zoom:5},{zoom:2,x:2},{zoom:NaN}])assert.throws(()=>cameraCrop(3840,2160,c));
});
test('crop framing is saved, validated and invalidates the old geometry when changed',()=>{
 const s=cameraSnapshot(track(),{...preferences,crop:{zoom:2,x:.6,y:.4}});
 assert.deepEqual(cameraSetupFields(s).crop,s.crop);assert.equal(sameCameraGeometry(s,{...s,crop:{zoom:2,x:.5,y:.4}}),false);
 assert.throws(()=>cameraSetupFields({...s,crop:{zoom:Infinity,x:.5,y:.5}}));
 assert.equal(sameCameraGeometry({...s,crop:undefined},{...s,crop:{zoom:1,x:.5,y:.5}}),true);
});
test('rapid zoom dragging serializes driver calls and applies the final requested endpoint',async()=>{
 let value=0,inFlight=0,maxInFlight=0;const seen=[];
 const t={getSettings:()=>({zoom:value}),applyConstraints:async c=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(r=>setTimeout(r,8));value=c.zoom.exact;seen.push(value);inFlight--;}};
 const q=new CameraZoomQueue(t);const a=q.set(10),b=q.set(100),c=q.set(400);await Promise.all([a,b,c]);
 assert.equal(value,400);assert.equal(maxInFlight,1);assert.deepEqual(seen,[10,400]);
 await q.set(0);assert.equal(value,0);
});
test('a driver that ignores zoom is reported instead of presenting false movement',async()=>{
 const q=new CameraZoomQueue({getSettings:()=>({zoom:3}),applyConstraints:async()=>{}});await assert.rejects(q.set(7),/did not apply/);
});
test('4K and chosen device are exact, never silently replaced by a built-in camera or 720p',()=>{
 const c=videoConstraints({deviceId:'external',mode:'4k'});assert.deepEqual(c.video.deviceId,{exact:'external'});assert.deepEqual(c.video.width,{exact:3840});assert.deepEqual(c.video.height,{exact:2160});assert.equal(c.video.resizeMode,'none');
 assert.deepEqual(videoConstraints().video.width,{ideal:1920});assert.deepEqual(videoConstraints({mode:'balanced'}).video.width,{exact:1280});
});
test('actual settings and remote labels survive validated persistence',()=>{
 const s=cameraSnapshot(track({zoom:2,focusMode:'continuous'}),preferences),fields=cameraSetupFields(s);
 assert.deepEqual(fields.controls,{zoom:2,focusMode:'continuous'});assert.equal(fields.externalZoom,3);assert.equal(fields.lens,'telephoto');
 assert.throws(()=>cameraSetupFields({...s,externalZoom:NaN}));assert.throws(()=>cameraSetupFields({...s,controls:{zoom:'11; arbitrary'}}));
});
test('saved zoom is reapplied and read back before a map may be reused',async()=>{
 const t=track(),s=cameraSnapshot(t,preferences);await t.applyConstraints({advanced:[{zoom:5}]});await restoreCameraControls(t,s);assert.equal(t.getSettings().zoom,2);
 t.applyConstraints=async()=>{};const wrong={...s,controls:{zoom:8}};await assert.rejects(restoreCameraControls(t,wrong),/could not be restored/);
});
test('unsupported PTZ is not presented as restored, while remote-only settings remain recordable',async()=>{
 const t=track({zoom:undefined});t.getCapabilities=()=>({});const s=cameraSnapshot(t,preferences);assert.equal(s.controls.zoom,undefined);await restoreCameraControls(t,s);assert.equal(s.externalZoom,3);
 await assert.rejects(restoreCameraControls(t,{...s,controls:{zoom:2}}),/could not be restored/);
});
test('zoom, pan, lens, resolution and external zoom changes invalidate calibration, autofocus changes do not',()=>{
 const s={...cameraSnapshot(track(),preferences),screenWidth:1708,screenHeight:1020,pixelRatio:1.5};
 assert.equal(sameSetup(s,{...s}),true);
 for(const b of [{...s,lens:'wide'},{...s,externalZoom:5},{...s,width:1920},{...s,deviceId:'integrated'},{...s,controls:{zoom:3}},{...s,controls:{zoom:2,pan:1}}])assert.equal(sameSetup(s,b),false);
 assert.equal(sameSetup(s,{...s,controls:{...s.controls,focusDistance:1.1}}),true);
 assert.equal(sameCameraGeometry(s,{...s,cameraVersion:undefined}),false);
});
test('balanced scoring penalizes sacrificing the right side and is left/right symmetric',()=>{
 const targets=[[.1,.1],[.1,.9],[.9,.1],[.9,.9]];
 const unbalanced=balancedCalibrationScore([.01,.01,.19,.19],targets),balanced=balancedCalibrationScore([.13,.13,.13,.13],targets);
 assert.ok(unbalanced>balanced);assert.ok(Math.abs(unbalanced-balancedCalibrationScore([.19,.19,.01,.01],targets))<1e-12);
});
test('left/right diagnostics report real offsets and missing estimates without calling them accurate',()=>{
 const s=horizontalAccuracy([{x:.1,p90Pixels:40,offsetX:-20,validFraction:1},{x:.9,p90Pixels:200,offsetX:-160,validFraction:.5}]);
 assert.equal(s.left.p90Pixels,40);assert.equal(s.right.p90Pixels,200);assert.equal(s.right.offsetX,-160);assert.equal(s.right.usable,50);
 assert.equal(horizontalAccuracy([{x:.9,p90Pixels:Infinity,validFraction:0}]).right.p90Pixels,null);
});

test('restoring an automatic camera does not lock stale focus, exposure or color temperature',async()=>{
 const t=track({focusMode:'continuous',focusDistance:400,exposureMode:'continuous',exposureTime:300,whiteBalanceMode:'continuous',colorTemperature:5000}),snapshot=cameraSnapshot(t,preferences);let applied;
 t.getCapabilities=()=>({zoom:{min:1,max:11},focusMode:['continuous','manual'],focusDistance:{min:0,max:1000},exposureMode:['continuous','manual'],exposureTime:{min:0,max:5000},whiteBalanceMode:['continuous','manual'],colorTemperature:{min:2300,max:7500}});
 const original=t.applyConstraints;t.applyConstraints=async c=>{applied=c.advanced[0];await original(c);};await restoreCameraControls(t,snapshot);
 assert.equal(applied.focusMode,'continuous');for(const k of ['focusDistance','exposureTime','colorTemperature'])assert.equal(Object.hasOwn(applied,k),false);
});
