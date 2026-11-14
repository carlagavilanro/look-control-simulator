import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_EYE_REGIONS,validEyeRegions,eyeRegionRect,previewEyePoint,eyeCropMeasurement,eyeFrameFeature,eyeImageEvidence} from '../public/screen-eye-crop.mjs';
import {cameraSnapshot,cameraSetupFields,sameCameraGeometry,lensCalibrationBank,calibrationForLens} from '../public/screen-camera.mjs';
function points(x=.3,y=.5){
 const p=Array.from({length:76},()=>({x,y}));p[0]={x:x-.07,y};p[8]={x:x+.07,y};p[12]={x,y:y-.02};p[4]={x,y:y+.02};p[71]={x,y};
 for(let i=0;i<4;i++)p[72+i]={x:x+Math.cos(i*Math.PI/2)*.02,y:y+Math.sin(i*Math.PI/2)*.02};return p;
}
test('close-up regions require two different visible eyes and squares stay inside the actual frame',()=>{
 assert.ok(validEyeRegions(DEFAULT_EYE_REGIONS));assert.equal(validEyeRegions([DEFAULT_EYE_REGIONS[0],DEFAULT_EYE_REGIONS[0]]),false);
 assert.equal(validEyeRegions([{x:NaN,y:.5,size:.2},DEFAULT_EYE_REGIONS[1]]),false);
 for(const [w,h] of [[3840,2160],[800,200],[163,83]])for(const r of DEFAULT_EYE_REGIONS){const b=eyeRegionRect(r,w,h);assert.ok(b.x>=0&&b.y>=0&&b.x+b.size<=w&&b.y+b.size<=h);}
});
test('marking eyes accounts for the mirrored, letterboxed preview',()=>{
 const r={left:100,top:50,width:400,height:400};assert.equal(previewEyePoint(300,60,r,1920,1080),null);
 assert.deepEqual(previewEyePoint(200,250,r,1920,1080),{x:.75,y:.5});assert.deepEqual(previewEyePoint(400,250,r,1920,1080),{x:.25,y:.5});
});
test('measured eye corners and irises yield gaze and frame alignment without a nose or face landmarks',()=>{
 const a=eyeCropMeasurement(points(.3),1000,1000),b=eyeCropMeasurement(points(.7),1000,1000),f=eyeFrameFeature([a,b],1000,1000);
 assert.ok(f);assert.ok(Math.abs(f.h-.5)<1e-12);assert.equal(f.v,0);assert.equal(f.x,.5);assert.equal(f.y,.5);assert.ok(Math.abs(f.scale-.4)<1e-12);assert.equal(f.roll,0);
 assert.equal(Object.hasOwn(f,'yaw'),false);assert.equal(Object.hasOwn(f,'pitch'),false);
 const closed=points();closed[12]=closed[4];assert.equal(eyeCropMeasurement(closed,1000,1000),null);assert.equal(eyeCropMeasurement([],1000,1000),null);
 assert.equal(eyeFrameFeature([null,b],1000,1000),null);
});
test('uniform or texture-only crops cannot be accepted merely because a model outputs landmarks',()=>{
 const image={width:64,height:64,data:new Uint8ClampedArray(64*64*4).fill(100)},p=points().map(q=>({x:q.x*64,y:q.y*64}));assert.equal(eyeImageEvidence(image,p),false);
 for(let i=0;i<image.data.length;i+=4){image.data[i]=image.data[i+1]=image.data[i+2]=(i/4)%2?255:0;}assert.equal(eyeImageEvidence(image,p),false);
});
test('tracking modes, numerical eye regions and calibrations stay separate while legacy face maps still match',()=>{
 const track={label:'EMEET',getSettings:()=>({deviceId:'camera',width:3840,height:2160,zoom:400})};
 const face=cameraSnapshot(track,{lens:'telephoto',mode:'4k'}),eyes=cameraSnapshot(track,{lens:'telephoto',mode:'4k',trackingMode:'eyes',eyeRegions:DEFAULT_EYE_REGIONS});
 assert.equal(sameCameraGeometry(face,eyes),false);assert.equal(sameCameraGeometry(face,{...face,trackingMode:'face'}),true);
 assert.equal(cameraSetupFields(eyes).trackingMode,'eyes');assert.deepEqual(cameraSetupFields(eyes).eyeRegions,DEFAULT_EYE_REGIONS);
 assert.throws(()=>cameraSetupFields({...eyes,eyeRegions:[]}));assert.throws(()=>cameraSetupFields({...eyes,trackingMode:'fake'}));
 assert.equal(sameCameraGeometry(eyes,{...eyes,eyeRegions:DEFAULT_EYE_REGIONS.map(r=>({...r,x:r.x+.01}))}),false);
 const old={model:{id:'face'},setup:face},close={model:{id:'eyes'},setup:eyes},root={...close,lensCalibrations:lensCalibrationBank(close,[old])};
 assert.equal(root.lensCalibrations.length,2);assert.equal(calibrationForLens(root,'camera','telephoto','face').model.id,'face');assert.equal(calibrationForLens(root,'camera','telephoto','eyes').model.id,'eyes');
});
