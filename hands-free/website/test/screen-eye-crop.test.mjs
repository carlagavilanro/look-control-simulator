import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_EYE_REGIONS,EYE_BOX_PER_DISTANCE,validEyeRegions,eyeRegionRect,previewEyePoint,eyeCropMeasurement,eyeFrameFeature,eyeImageEvidence,eyeBoxSize,markedEyeRegions,eyeCropPlan,canvasCapture,BinocularAgreement} from '../public/screen-eye-crop.mjs';
import {cameraSnapshot,cameraSetupFields,sameCameraGeometry,restoreCameraControls,lensCalibrationBank,calibrationForLens,EYE_TRACKER_REVISION} from '../public/screen-camera.mjs';
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
 // The boxes are only where tracking starts; the tracker follows and re-finds
 // the eyes, so re-marking them must not discard a saved calibration.
 assert.equal(sameCameraGeometry(eyes,{...eyes,eyeRegions:DEFAULT_EYE_REGIONS.map(r=>({...r,x:r.x+.01}))}),true);
 assert.equal(sameCameraGeometry(eyes,{...eyes,eyeRegions:[]}),false);
 const old={model:{id:'face'},setup:face},close={model:{id:'eyes'},setup:eyes},root={...close,lensCalibrations:lensCalibrationBank(close,[old])};
 assert.equal(root.lensCalibrations.length,2);assert.equal(calibrationForLens(root,'camera','telephoto','face').model.id,'face');assert.equal(calibrationForLens(root,'camera','telephoto','eyes').model.id,'eyes');
});
test('wide-open eyes are a valid reading; only a nearly closed eye or impossible landmarks are rejected',()=>{
 const open=(ratio)=>{const p=points();p[12]={x:.3,y:.5-.14*ratio/2};p[4]={x:.3,y:.5+.14*ratio/2};return eyeCropMeasurement(p,1000,1000);};
 for(const ratio of [.2,.4,.6,.85,.98])assert.ok(open(ratio),'opening '+ratio);
 assert.ok(Math.abs(open(.85).opening-.85)<1e-9);
 assert.equal(open(.1),null);assert.equal(open(1.2),null);
});
test('the eye box is sized from the spacing of the two eyes, not from a slider or the model',()=>{
 // Half the frame apart on a 16:9 frame: the box is that spacing times a fixed factor.
 assert.ok(Math.abs(eyeBoxSize({x:.25,y:.5},{x:.75,y:.5},1920,1080)-.5*EYE_BOX_PER_DISTANCE)<1e-12);
 // A vertical offset counts in pixels, not in mismatched frame fractions.
 assert.ok(Math.abs(eyeBoxSize({x:.4,y:.5},{x:.4,y:.9},1000,500)-.2*EYE_BOX_PER_DISTANCE)<1e-12);
 assert.equal(eyeBoxSize({x:.1,y:.5},{x:.95,y:.5},1920,1080),.8);assert.equal(eyeBoxSize({x:.5,y:.5},{x:.51,y:.5},1920,1080),.06);
 const marked=markedEyeRegions([{x:.35,y:.5,size:.7},{x:.65,y:.5,size:.1}],1920,1080);
 assert.ok(validEyeRegions(marked));assert.ok(marked.every(r=>Math.abs(r.size-.3*EYE_BOX_PER_DISTANCE)<1e-12));assert.equal(marked[0].x,.35);
});
test('a box that extends past the frame keeps its size and is filled from the visible part',()=>{
 assert.deepEqual(eyeCropPlan({x:100,y:50,size:200},1920,1080),{source:{x:100,y:50,width:200,height:200},target:{x:0,y:0,width:64,height:64}});
 // 25% above the frame: the visible three quarters land in the lower three quarters of the input.
 assert.deepEqual(eyeCropPlan({x:0,y:-200,size:800},1920,1080),{source:{x:0,y:0,width:800,height:600},target:{x:0,y:16,width:64,height:48}});
 // Taller than the whole frame (eyes filling a 16:9 view): nothing is shrunk to fit.
 const tall=eyeCropPlan({x:300,y:-100,size:1280},1920,1080);assert.equal(tall.source.height,1080);assert.equal(tall.target.y,5);assert.equal(tall.target.height,54);
 assert.equal(eyeCropPlan({x:-700,y:0,size:800},1920,1080),null);assert.equal(eyeCropPlan({x:0,y:0,size:4},1920,1080),null);assert.equal(eyeCropPlan({x:NaN,y:0,size:100},1920,1080),null);
});
test('two eyes are compared against their usual difference, with the same tolerance on both sides',()=>{
 const pair=(dh,dv=0)=>{const a=eyeCropMeasurement(points(.3),1000,1000),b=eyeCropMeasurement(points(.7),1000,1000);return [{...a,h:.5+dh/2,v:dv/2},{...b,h:.5-dh/2,v:-dv/2}];};
 // Compared against zero, a natural difference of -0.14 leaves 0.06 of room one way and 0.34 the other.
 assert.ok(eyeFrameFeature(pair(-.14),1000,1000));assert.equal(eyeFrameFeature(pair(-.22),1000,1000),null);
 const agreement=new BinocularAgreement();
 for(let i=0;i<40;i++)assert.ok(eyeFrameFeature(pair(-.14+(i%3-1)*.01),1000,1000,agreement));
 assert.ok(Math.abs(agreement.dh+.14)<.01);
 // The same excursion is now allowed in both directions around the usual difference...
 assert.ok(eyeFrameFeature(pair(-.14-.15),1000,1000,agreement));assert.ok(eyeFrameFeature(pair(-.14+.15),1000,1000,agreement));
 // ...and a reading far from it is still rejected, vertical disagreement included.
 assert.equal(eyeFrameFeature(pair(-.14+.3),1000,1000,agreement),null);assert.equal(eyeFrameFeature(pair(-.14,.2),1000,1000,agreement),null);
 assert.equal(eyeFrameFeature(pair(NaN),1000,1000,agreement),null);
 // The input order of the two eyes must not matter or be changed.
 const input=pair(-.14).reverse(),first=input[0];assert.ok(eyeFrameFeature(input,1000,1000,agreement));assert.equal(input[0],first);
});
test('a usual difference learned from bad frames cannot lock out good ones forever',()=>{
 const agreement=new BinocularAgreement();
 for(let i=0;i<40;i++)assert.ok(agreement.check(.3,0));
 for(let i=0;i<89;i++)assert.equal(agreement.check(-.1,0),false);
 assert.equal(agreement.check(-.1,0),false);assert.equal(agreement.count,0);
 assert.ok(agreement.check(-.1,0));assert.ok(Math.abs(agreement.dh+.1)<1e-12);
});
// A minimal stand-in for an offscreen canvas: grey fill, bilinear drawImage of a
// source rectangle into a destination rectangle, and pixel read-back.
class Surface{
 constructor(size){this.width=size;this.height=size;this.data=new Uint8ClampedArray(size*size*4);}
 getContext(){
  const target=this;
  return {fillStyle:'',fillRect(){for(let i=0;i<target.data.length;i+=4){target.data[i]=target.data[i+1]=target.data[i+2]=128;target.data[i+3]=255;}},
   drawImage(source,sx,sy,sw,sh,dx,dy,dw,dh){
    const from=source===target?{width:source.width,height:source.height,data:source.data.slice()}:source;
    // Like a real canvas, sampling never reads outside the source rectangle.
    const x0=Math.max(0,Math.floor(sx)),x1=Math.min(from.width,Math.ceil(sx+sw))-1,y0=Math.max(0,Math.floor(sy)),y1=Math.min(from.height,Math.ceil(sy+sh))-1;
    const at=(x,y,c)=>from.data[(Math.max(y0,Math.min(y1,y))*from.width+Math.max(x0,Math.min(x1,x)))*4+c];
    for(let py=Math.ceil(dy-.5);py+.5<dy+dh;py++)for(let px=Math.ceil(dx-.5);px+.5<dx+dw;px++){
     if(px<0||py<0||px>=target.width||py>=target.height)continue;
     const u=sx+(px+.5-dx)/dw*sw-.5,v=sy+(py+.5-dy)/dh*sh-.5,x=Math.floor(u),y=Math.floor(v),tx=u-x,ty=v-y;
     for(let c=0;c<3;c++)target.data[(py*target.width+px)*4+c]=(at(x,y,c)*(1-tx)+at(x+1,y,c)*tx)*(1-ty)+(at(x,y+1,c)*(1-tx)+at(x+1,y+1,c)*tx)*ty;
     target.data[(py*target.width+px)*4+3]=255;
    }
   },
   getImageData(){return {data:target.data};}};
 }
}
test('camera pixels reach the model at the right place: averaged, mirrored for the second eye, edge-filled outside the frame',()=>{
 // Red encodes the column and green the row, so every model pixel reveals which part of the frame it shows.
 const width=800,height=450,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=x/width*255;data[i+1]=y/height*255;data[i+2]=40;data[i+3]=255;}
 const capture=canvasCapture(size=>new Surface(size)),frame={width,height,data};
 const crops=[
  {x:100,y:50,size:300,flip:false}, // four camera pixels averaged per model pixel in each direction
  {x:420,y:120,size:160,flip:true}, // the second eye, mirrored
  {x:500,y:-150,size:400,flip:false}, // extends above and to the right of the frame
  {x:300,y:200,size:64,flip:false}, // one camera pixel per model pixel
  {x:-900,y:0,size:300,flip:false} // not in the frame at all
 ],input=new Float32Array(crops.length*12288);
 capture(frame,crops,input);
 const read=(index,x,y)=>{const k=index*12288+(y*64+x)*3;return [input[k],input[k+1],input[k+2]];};
 crops.slice(0,4).forEach((crop,index)=>{
  for(const [x,y] of [[0,0],[63,0],[0,63],[63,63],[31,32],[10,50],[55,5]]){
   // Centre of this model pixel in the frame; outside the frame the nearest edge repeats.
   const column=crop.flip?63-x:x,fx=Math.max(0,Math.min(width-1,crop.x+(column+.5)*crop.size/64)),fy=Math.max(0,Math.min(height-1,crop.y+(y+.5)*crop.size/64));
   const [r,g,b]=read(index,x,y);
   assert.ok(Math.abs(r-fx/width)<.012,`crop ${index} pixel ${x},${y}: column ${r} vs ${fx/width}`);
   assert.ok(Math.abs(g-fy/height)<.012,`crop ${index} pixel ${x},${y}: row ${g} vs ${fy/height}`);
   assert.ok(Math.abs(b-40/255)<.005);
  }
 });
 // The mirrored eye shows frame-right content on the model's left.
 assert.ok(read(1,0,32)[0]>read(1,63,32)[0]);assert.ok(read(0,0,32)[0]<read(0,63,32)[0]);
 // Nothing to read: a neutral input instead of stale or uninitialised pixels.
 assert.deepEqual(read(4,20,20),[.5,.5,.5]);
});
test('close-up maps made by the earlier tracker are re-made, not silently reused',async()=>{
 const track={label:'EMEET',getSettings:()=>({deviceId:'camera',width:3840,height:2160,zoom:400}),getCapabilities:()=>({}),applyConstraints:async()=>{}};
 const current=cameraSnapshot(track,{lens:'telephoto',mode:'4k',trackingMode:'eyes',eyeRegions:DEFAULT_EYE_REGIONS});
 assert.equal(current.eyeTracker,EYE_TRACKER_REVISION);assert.equal(cameraSetupFields(current).eyeTracker,EYE_TRACKER_REVISION);
 // A 0.4.16 record has no tracker revision. It stays readable and storable...
 const {eyeTracker,...earlier}=current;assert.equal(Object.hasOwn(cameraSetupFields(earlier),'eyeTracker'),false);
 // ...its camera framing can still be restored, so setup can start from it...
 await restoreCameraControls(track,earlier);
 // ...but its map is not the same setup as the current tracker's.
 assert.equal(sameCameraGeometry(earlier,current),false);assert.equal(sameCameraGeometry(current,{...current}),true);assert.equal(sameCameraGeometry(earlier,{...earlier}),true);
 for(const invalid of [0,1.5,'2',100])assert.throws(()=>cameraSetupFields({...current,eyeTracker:invalid}));
 // Face + eyes records never carry or need a tracker revision.
 const face=cameraSnapshot(track,{lens:'telephoto',mode:'4k'});assert.equal(Object.hasOwn(face,'eyeTracker'),false);assert.equal(sameCameraGeometry(face,{...face}),true);
});
