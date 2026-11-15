import {validEyeRegions} from './screen-eye-crop.mjs';
// Hardware settings and numerical eye regions only. No video frames persisted.
// Close-up maps depend on how the eye boxes are framed and read. Revision 2
// (0.4.17) frames them from eye spacing and averages several boxes, so maps
// made with the earlier tracker must be re-made rather than silently reused.
export const EYE_TRACKER_REVISION=2;
export const CAMERA_CONTROLS=['zoom','pan','tilt','focusMode','focusDistance','exposureMode','exposureTime','exposureCompensation','whiteBalanceMode','colorTemperature','brightness','contrast','saturation','sharpness'];
// C60E Dual's own control software selects its physical wide/near lens by
// writing the minimum/maximum UVC zoom value. This is model-specific: never
// present arbitrary webcams' digital zoom as a physical lens selector.
export function lensControl(track){
 const label=track?.label||'',cap=track?.getCapabilities?.().zoom,s=track?.getSettings?.()||{};
 if(!/EMEET.*C60E\s*4K\s*Dual/i.test(label)||!Number.isFinite(cap?.min)||!Number.isFinite(cap?.max)||cap.max<=cap.min||!Number.isFinite(s.zoom))return {supported:false,lens:null};
 return {supported:true,min:cap.min,max:cap.max,lens:Math.abs(s.zoom-cap.min)<=Math.abs(cap.max-s.zoom)?'wide':'telephoto',lensOnly:s.height>=1440||s.frameRate>30};
}
export function lensZoom(track,lens){
 const c=lensControl(track);if(!c.supported||!['wide','telephoto'].includes(lens))throw Error('This camera does not expose supported physical lens switching.');
 return lens==='wide'?c.min:c.max;
}
export function lensCalibrationBank(record,entries=[]){
 const pick=r=>({model:r.model,setup:r.setup,validation:r.validation??null,savedAt:r.savedAt??Date.now(),...(r.headPositions?{headPositions:r.headPositions,activePositionId:r.activePositionId}:{})});
 const all=[...entries,record].filter(r=>r?.model&&r.setup?.deviceId&&['wide','telephoto','unspecified'].includes(r.setup.lens));
 const bank=new Map();for(const r of all){const key=r.setup.deviceId+'|'+r.setup.lens+'|'+(r.setup.trackingMode||'face');bank.delete(key);bank.set(key,pick(r));}
 return [...bank.values()].slice(-6);
}
export function calibrationForLens(record,deviceId,lens,trackingMode='face'){
 return lensCalibrationBank(record,record?.lensCalibrations||[]).find(r=>r.setup.deviceId===deviceId&&r.setup.lens===lens&&(r.setup.trackingMode||'face')===trackingMode)||null;
}
export function identifySavedLens(record,track){
 // Older C60E profiles recorded the actual driver zoom without naming the
 // lens. Identify only from that saved value and this same device's bounds;
 // never infer an old lens from the camera's current view or relabel its map.
 const physical=lensControl(track),actual=track?.getSettings?.();
 if(!record||!physical.supported)return record;
 const identify=r=>{
  const s=r?.setup,zoom=s?.controls?.zoom;
  if(s?.cameraVersion!==1||s.lens!=='unspecified'||s.deviceId!==actual.deviceId||!Number.isFinite(zoom)||zoom<physical.min||zoom>physical.max)return r;
  const lens=Math.abs(zoom-physical.min)<=Math.abs(physical.max-zoom)?'wide':'telephoto';
  return {...r,setup:{...s,lens,externalZoom:null}};
 };
 const identified=identify(record);
 return record.lensCalibrations?{...identified,lensCalibrations:record.lensCalibrations.map(identify)}:identified;
}
export function videoConstraints({deviceId='',mode='auto',saved=null,ptz=false}={}){
 const sizes={'4k':[3840,2160],'1080p':[1920,1080],balanced:[1280,720]};
 const [width,height]=saved?[saved.width,saved.height]:(sizes[mode]||sizes['1080p']);
 const exact=!!saved||mode!=='auto';
 return {video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:'user'}),width:{[exact?'exact':'ideal']:width},height:{[exact?'exact':'ideal']:height},frameRate:{ideal:30,max:30},resizeMode:'none',...(ptz?{zoom:true,pan:true,tilt:true}:{})},audio:false};
}
export function cameraCrop(width,height,{zoom=1,x=.5,y=.5}={}){
 if(![width,height,zoom,x,y].every(Number.isFinite)||width<1||height<1||zoom<1||zoom>4||x<0||x>1||y<0||y>1)throw Error('Invalid camera crop');
 const w=Math.max(1,Math.round(width/zoom)),h=Math.max(1,Math.round(height/zoom));
 return {x:Math.round((width-w)*x),y:Math.round((height-h)*y),width:w,height:h};
}
export class CameraZoomQueue{
 constructor(track,onApplied=()=>{}){this.track=track;this.onApplied=onApplied;this.pending=null;this.running=null;}
 set(value){
  if(!Number.isFinite(value))return Promise.reject(Error('Invalid zoom'));
  this.pending=value;
  if(!this.running)this.running=this.drain().finally(()=>{this.running=null;});
  return this.running;
 }
 async drain(){
  while(this.pending!==null){const value=this.pending;this.pending=null;await this.track.applyConstraints({zoom:{exact:value}});const actual=this.track.getSettings().zoom;if(!Number.isFinite(actual)||Math.abs(actual-value)>1e-6)throw Error('Camera did not apply the requested zoom');if(this.pending===null)this.onApplied(actual);}
 }
}
export function cameraSnapshot(track,{lens='unspecified',externalZoom=null,mode='auto',crop,trackingMode='face',eyeRegions}={}){
 const s=track.getSettings();
 return {cameraVersion:1,deviceId:s.deviceId||'',cameraLabel:track.label||'',width:s.width,height:s.height,frameRate:s.frameRate||0,cameraMode:mode,lens,externalZoom,...(crop?{crop:{zoom:crop.zoom??1,x:crop.x??.5,y:crop.y??.5}}:{}),...(trackingMode==='eyes'?{trackingMode,eyeTracker:EYE_TRACKER_REVISION,eyeRegions:eyeRegions?.map(r=>({x:r.x,y:r.y,size:r.size}))}:{}),
  controls:Object.fromEntries(CAMERA_CONTROLS.filter(k=>typeof s[k]==='string'||Number.isFinite(s[k])).map(k=>[k,s[k]]))};
}
export function sameCameraGeometry(a,b){
 if(!a?.cameraVersion&&!b?.cameraVersion)return true; // Legacy-to-legacy comparisons only.
 if(a?.cameraVersion!==1||b?.cameraVersion!==1)return false;
 if((a.trackingMode||'face')!==(b.trackingMode||'face'))return false;
 // Eye boxes only say where close-up tracking starts. The tracker follows the
 // eyes and finds them again by itself, and the head-position limits decide
 // whether a saved map still applies, so differing boxes are the same setup.
 if(a.trackingMode==='eyes'&&(!validEyeRegions(a.eyeRegions)||!validEyeRegions(b.eyeRegions)||(a.eyeTracker||1)!==(b.eyeTracker||1)))return false;
 if(a.lens!==b.lens||a.externalZoom!==b.externalZoom)return false;
 const ac=a.crop||{zoom:1,x:.5,y:.5},bc=b.crop||{zoom:1,x:.5,y:.5};
 if(['zoom','x','y'].some(k=>ac[k]!==bc[k]))return false;
 return ['zoom','pan','tilt'].every(k=>{
  const x=a.controls?.[k],y=b.controls?.[k];
  return x===undefined&&y===undefined||Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=1e-6*Math.max(1,Math.abs(x));
 });
}
export async function restoreCameraControls(track,saved){
 if(saved?.cameraVersion!==1)return;
 const caps=track.getCapabilities?.()||{},settings=saved.controls||{},values={};
 for(const k of CAMERA_CONTROLS){
  const v=settings[k],c=caps[k];if(v===undefined)continue;
  if(k==='focusDistance'&&settings.focusMode!=='manual'||k==='exposureTime'&&settings.exposureMode!=='manual'||k==='colorTemperature'&&settings.whiteBalanceMode!=='manual')continue;
  if(Array.isArray(c)&&c.includes(v))values[k]=v;
  else if(Number.isFinite(v)&&Number.isFinite(c?.min)&&v>=c.min&&v<=c.max)values[k]=v;
 }
 if(Object.keys(values).length)await track.applyConstraints({advanced:[values]});
 // advanced constraints may be ignored by a driver. Verify actual geometry.
 // This checks camera zoom and framing only. Whether a close-up map was made by
 // the current tracker is decided separately, when the map is about to be used.
 const now={...cameraSnapshot(track,{lens:saved.lens,externalZoom:saved.externalZoom,crop:saved.crop,trackingMode:saved.trackingMode,eyeRegions:saved.eyeRegions}),eyeTracker:saved.eyeTracker};
 if(!sameCameraGeometry(saved,now))throw Error('Saved zoom or framing could not be restored. Set the camera to its saved settings, or start a new calibration.');
}
export function cameraSetupFields(s){
 if(s.cameraVersion===undefined)return {};
 if(s.cameraVersion!==1||!['unspecified','wide','telephoto'].includes(s.lens)||!['auto','4k','1080p','balanced'].includes(s.cameraMode)||
  !(s.externalZoom===null||Number.isFinite(s.externalZoom)&&s.externalZoom>=1&&s.externalZoom<=11)||
  typeof s.cameraLabel!=='string'||s.cameraLabel.length>256||!Number.isFinite(s.frameRate)||s.frameRate<0||s.frameRate>240||
  !s.controls||typeof s.controls!=='object'||Array.isArray(s.controls))throw Error('Invalid saved camera settings');
 const controls={};
 for(const [k,v] of Object.entries(s.controls)){
  if(!CAMERA_CONTROLS.includes(k)||!(Number.isFinite(v)&&Math.abs(v)<=1e9||['focusMode','exposureMode','whiteBalanceMode'].includes(k)&&['none','manual','single-shot','continuous'].includes(v)))throw Error('Invalid camera control');
  controls[k]=v;
 }
 if(s.crop){if(!['zoom','x','y'].every(k=>Number.isFinite(s.crop[k])))throw Error('Invalid camera crop');cameraCrop(s.width,s.height,s.crop);}
 if(s.trackingMode!==undefined&&!['face','eyes'].includes(s.trackingMode)||s.trackingMode==='eyes'&&!validEyeRegions(s.eyeRegions))throw Error('Invalid eye tracking mode or regions');
 if(s.eyeTracker!==undefined&&!(Number.isInteger(s.eyeTracker)&&s.eyeTracker>=1&&s.eyeTracker<=99))throw Error('Invalid eye tracker revision');
 return {cameraVersion:1,cameraLabel:s.cameraLabel,cameraMode:s.cameraMode,lens:s.lens,externalZoom:s.externalZoom,frameRate:s.frameRate,controls,...(s.crop?{crop:{zoom:s.crop.zoom,x:s.crop.x,y:s.crop.y}}:{}),...(s.trackingMode==='eyes'?{trackingMode:'eyes',...(s.eyeTracker!==undefined?{eyeTracker:s.eyeTracker}:{}),eyeRegions:s.eyeRegions.map(r=>({x:r.x,y:r.y,size:r.size}))}:{})};
}

// ---- Picture controls -------------------------------------------------------
// The camera's own picture adjustments, as far as its driver reports them to
// the browser: exposure, brightness, contrast, sharpness, colour strength,
// white balance and focus. (Hue is not part of the browser's camera interface,
// so it cannot be read or set from here; it also has no effect on tracking,
// which works on brightness.) Only controls the camera really reports are
// listed, and every change is read back, because a driver may accept a value
// and ignore it.
const PICTURE=[
 {key:'exposureCompensation',label:'Exposure'},
 {key:'exposureTime',label:'Exposure time',mode:'exposureMode'},
 {key:'brightness',label:'Brightness'},
 {key:'contrast',label:'Contrast'},
 {key:'sharpness',label:'Sharpness'},
 {key:'saturation',label:'Colour strength'},
 {key:'colorTemperature',label:'White balance',mode:'whiteBalanceMode'},
 {key:'focusDistance',label:'Focus',mode:'focusMode'}];
export function pictureControls(track){
 const caps=track?.getCapabilities?.()||{},now=track?.getSettings?.()||{};
 return PICTURE.flatMap(c=>{
  const cap=caps[c.key];if(!Number.isFinite(cap?.min)||!Number.isFinite(cap?.max)||!(cap.max>cap.min))return [];
  const modes=c.mode&&Array.isArray(caps[c.mode])?caps[c.mode]:null,canAuto=!!modes?.includes('continuous');
  return [{...c,min:cap.min,max:cap.max,step:cap.step>0?cap.step:(cap.max-cap.min)/100,value:Number.isFinite(now[c.key])?now[c.key]:null,canAuto,canManual:!c.mode||!!modes?.includes('manual'),automatic:canAuto&&now[c.mode]!=='manual'}];
 });
}
// value is a number, or 'auto' to hand the control back to the camera.
export async function setPicture(track,key,value){
 const control=pictureControls(track).find(c=>c.key===key);
 if(!control)throw Error('This camera does not offer that control.');
 const change={};
 if(value==='auto'){if(!control.canAuto)throw Error('This control has no automatic setting.');change[control.mode]='continuous';}
 else{
  if(!Number.isFinite(value))throw Error('Invalid picture value');
  if(control.mode){if(!control.canManual)throw Error('This camera only sets that automatically.');change[control.mode]='manual';}
  change[key]=Math.max(control.min,Math.min(control.max,value));
 }
 await track.applyConstraints({advanced:[change]});
 return pictureControls(track).find(c=>c.key===key);
}
// Whether the eyes are lit well for tracking: -1 too bright, +1 too dark, 0 fine.
// `light` holds one entry per eye (null when unknown): how bright the white of
// the eye is (0 to 255) and what share of the eye area is burnt out.
export function pictureStep(light,{low=130,high=205}={}){
 const eyes=(light||[]).filter(e=>e&&Number.isFinite(e.white));if(!eyes.length)return 0;
 const white=eyes.reduce((s,e)=>s+e.white,0)/eyes.length,clipped=Math.max(...eyes.map(e=>e.clipped||0));
 return clipped>.01||white>high?-1:white<low?1:0;
}
// Sets the camera's brightness for the eyes rather than for the whole picture.
// A camera exposes for the frame as a whole, so eyes under a brow, behind
// glasses or in front of a window often end up too dark or burnt out. Each
// step() takes the latest reading of how the eyes are lit and makes one change.
export class PictureTuner{
 constructor(track){
  this.track=track;this.steps=0;this.last=0;this.done=false;
  // Prefer the control that keeps the camera's automatic exposure working.
  this.control=['exposureCompensation','brightness','exposureTime'].map(key=>pictureControls(track).find(c=>c.key===key&&c.canManual&&c.value!==null)).find(Boolean)||null;
  this.size=this.control?(this.control.max-this.control.min)*.08:0;
 }
 get available(){return !!this.control;}
 async step(light){
  if(!this.control){this.done=true;return {done:true,message:'This camera does not let the app change its brightness. Use Windows camera settings or the camera maker’s app.'};}
  const direction=pictureStep(light);
  if(direction===0){this.done=true;return {done:true,message:this.steps?'Picture set for your eyes.':'The eyes are already well lit. Nothing was changed.'};}
  if(this.last&&direction!==this.last)this.size/=2;
  const c=pictureControls(this.track).find(x=>x.key===this.control.key)||this.control,from=c.value??this.control.value;
  const multiply=c.key==='exposureTime',target=multiply?from*(direction>0?1.3:1/1.3):from+direction*this.size;
  if(++this.steps>14||this.size<c.step/2||target<c.min&&from<=c.min||target>c.max&&from>=c.max){this.done=true;return {done:true,message:direction<0?'The eyes are still bright at the lowest setting. Dim the screen or move lamps and windows out from behind you.':'The eyes are still dark at the highest setting. Add light in front of you.'};}
  const applied=await setPicture(this.track,c.key,target);this.last=direction;
  if(!applied||applied.value===null||Math.abs(applied.value-from)<1e-9){this.done=true;return {done:true,message:'The camera accepted the change but did not apply it. Use Windows camera settings or the camera maker’s app.'};}
  return {done:false,message:(direction<0?'Darkening':'Brightening')+' the picture for your eyes…'};
 }
}
// ---- Following the face -----------------------------------------------------
// The face model sees a small copy of whatever it is given. Far from the camera
// a face is a small part of a 1080p or 4K frame, so the copy holds little of it
// and, further away still, the face is not found at all. Instead of the whole
// frame, the tracker is given a square around the face at the camera's own
// resolution. The square stays put while the face is well inside it (a moving
// square would unsettle the model's frame-to-frame tracking) and is renewed
// when the face nears its edge or changes size. With no face, the whole frame
// is tried first and then overlapping tiles, which finds a small, distant face.
const FIT=768; // Largest side sent to the face model.
export class FaceFraming{
 constructor(){this.reset();}
 reset(){this.view=null;this.missing=0;this.scan=null;}
 // The part of a width x height frame to send next, and the size to send it at.
 next(width,height){
  const tile=this.scan?this.scan.tiles[this.scan.index]:null,v=this.view||tile;
  if(v){const out=Math.min(FIT,v.size);return {x:v.x,y:v.y,width:v.size,height:v.size,outWidth:out,outHeight:out};}
  const k=Math.min(1,1280/Math.max(width,height));
  return {x:0,y:0,width,height,outWidth:Math.round(width*k),outHeight:Math.round(height*k)};
 }
 // face {x0,y0,x1,y1} is the face's extent as shares of the frame, or null.
 update(face,width,height){
  const short=Math.min(width,height);
  if(face){
   const size=Math.max((face.x1-face.x0)*width,(face.y1-face.y0)*height),cx=(face.x0+face.x1)/2*width,cy=(face.y0+face.y1)/2*height;
   this.missing=0;this.scan=null;
   if(!(size>=8))return;
   const v=this.view,least=Math.min(192,short),wanted=Math.round(Math.max(least,Math.min(short,2.3*size)));
   const place=(centre,limit,side)=>Math.round(Math.max(0,Math.min(limit-side,centre-side/2)));
   if(!v){this.view={x:place(cx,width,wanted),y:place(cy,height,wanted),size:wanted};return;}
   // Change only what needs changing. A square already as large (or small) as
   // it can be is not resized, and it moves only along the direction in which
   // the face has left its middle; otherwise ordinary landmark jitter would
   // move it by a pixel every frame.
   const share=size/v.size,resize=share>.6&&v.size<short||share<.3&&v.size>least,side=resize?wanted:v.size;
   const offX=Math.abs(cx-(v.x+v.size/2))>.16*v.size,offY=Math.abs(cy-(v.y+v.size/2))>.16*v.size;
   if(!resize&&!offX&&!offY)return;
   const next={x:resize||offX?place(cx,width,side):v.x,y:resize||offY?place(cy,height,side):v.y,size:side};
   if(next.x!==v.x||next.y!==v.y||next.size!==v.size)this.view=next;
   return;
  }
  this.missing++;
  if(this.view){if(this.missing>=6){this.view=null;this.missing=0;}return;}
  if(this.scan){if(++this.scan.index>=this.scan.tiles.length){this.scan=null;this.missing=0;}return;}
  // A dozen empty whole-frame looks: try tiles, nearest the middle first.
  if(this.missing>=12&&short>=640){
   const tiles=[];
   for(const share of [.5,.3]){
    const side=Math.round(short*share);if(side<256)continue;
    const columns=Math.max(1,Math.ceil((width-side)/(side/2))),rows=Math.max(1,Math.ceil((height-side)/(side/2)));
    for(let r=0;r<=rows;r++)for(let c=0;c<=columns;c++)tiles.push({x:Math.round((width-side)*c/columns),y:Math.round((height-side)*r/rows),size:side,level:share});
   }
   const middle=t=>Math.hypot(t.x+t.size/2-width/2,t.y+t.size/2-height/2);
   tiles.sort((a,b)=>b.level-a.level||middle(a)-middle(b));
   this.scan={tiles,index:0};
  }
 }
}
