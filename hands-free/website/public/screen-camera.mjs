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
// ---- Choosing the lens ------------------------------------------------------
// A camera with a second, telephoto lens puts more of its pixels on the eyes:
// in one recorded morning each eye was 128 to 140 camera pixels wide through
// the wide lens and 213 to 230 through the telephoto, and the check that
// followed read 85 px off instead of 110 to 125. Digital zoom cannot do this
// (it enlarges the same pixels), so the lens is worth choosing for the person.
//
// The telephoto is tried once per camera setup, from the wide lens, when the
// face has been followed steadily and would still fit with room to spare. It
// is then watched for a few seconds and kept only if the whole face stays in
// its picture; otherwise the wide lens comes back. A lens the person picks by
// hand ends the choosing (cancel).
export class LensChooser{
 constructor({steady=20,settle=1500,watch=2500,margin=.04,found=.7,magnify=1.7,room=.8,close=45}={}){Object.assign(this,{steadyFrames:steady,settle,watch,margin,found,magnify,room,close});this.reset();}
 reset(){this.state='idle';this.at=0;this.steady=0;this.near=0;this.total=0;this.inside=0;this.kept=null;this.reason='';this.edge=null;this.past={top:0,bottom:0,side:0};this.sizes=[];}
 cancel(){if(this.state!=='done'){this.state='done';this.reason='chosen by hand';}}
 // Watch the telephoto picture once more, after the app's own framing of it changed.
 again(now){this.state='watching';this.at=now;this.total=this.inside=0;this.kept=null;this.reason='';this.edge=null;this.past={top:0,bottom:0,side:0};this.sizes=[];}
 // One tracked frame. `lens` is the lens in use, `face` the face's extent as
 // shares of the tracker's picture (or null), `zoom` how much of the camera
 // picture that is (the app's own crop). Returns 'telephoto' or 'wide' when
 // the lens should be changed now, otherwise null.
 frame(lens,face,now,zoom=1){
  if(this.state==='done')return null;
  const seen=face&&[face.x0,face.y0,face.x1,face.y1].every(Number.isFinite);
  if(this.state==='idle'){
   if(lens!=='wide'){this.state='done';this.reason='already on '+lens;return null;}
   if(!seen){this.steady=0;return null;}
   const w=(face.x1-face.x0)/Math.max(1,zoom),h=(face.y1-face.y0)/Math.max(1,zoom);
   // Too close for the telephoto picture: say so after a while, and stay.
   if(w*this.magnify>this.room||h*this.magnify>this.room){this.steady=0;if(++this.near>=this.close){this.state='done';this.reason='face too large for the telephoto picture';}return null;}
   this.near=0;if(++this.steady<this.steadyFrames)return null;
   this.state='switching';return 'telephoto';
  }
  if(this.state==='switching'){if(lens==='telephoto'){this.state='watching';this.at=now;this.total=this.inside=0;this.past={top:0,bottom:0,side:0};this.sizes=[];}return null;}
  // Watching the telephoto picture: after the lens and exposure settle, count the frames with the whole face in it.
  if(now-this.at<this.settle)return null;
  this.total++;if(seen&&face.x0>=this.margin&&face.y0>=this.margin&&face.x1<=1-this.margin&&face.y1<=1-this.margin)this.inside++;
  else if(seen){
   // Which edge the face runs past, and how large it is: a face that would fit if the camera
   // pointed at it is a different matter from one that is too large for this lens.
   if(face.y1>1-this.margin)this.past.bottom++;if(face.y0<this.margin)this.past.top++;if(face.x0<this.margin||face.x1>1-this.margin)this.past.side++;
   this.sizes.push([face.x1-face.x0,face.y1-face.y0]);
  }
  if(now-this.at<this.settle+this.watch)return null;
  this.state='done';this.kept=this.total>=10&&this.inside/this.total>=this.found;this.reason=this.kept?'whole face fits':'face does not fit';
  if(!this.kept&&this.sizes.length>=5){
   const middle=k=>{const v=this.sizes.map(s=>s[k]).sort((a,b)=>a-b);return v[v.length>>1];},room=1-2*this.margin-.04;
   const [edge,count]=Object.entries(this.past).sort((a,b)=>b[1]-a[1])[0];
   if(middle(0)<=room&&middle(1)<=room&&count>=this.sizes.length*.6){this.edge=edge;this.reason='face cut off at the '+edge;}
  }
  return this.kept?null:'wide';
 }
 // The change asked for could not be made.
 failed(){this.state='done';this.kept=false;this.reason='lens could not be changed';}
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
 // Windows passes a camera's gain under this name.
 {key:'exposureCompensation',label:'Exposure / gain'},
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
  // Whole steps of the control: a camera may refuse or round anything else.
  const wanted=Math.max(control.min,Math.min(control.max,value));
  change[key]=Math.max(control.min,Math.min(control.max,Number((control.min+Math.round((wanted-control.min)/control.step)*control.step).toFixed(6))));
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
//
// What a camera reports and what it does are different things. While it sets
// its own exposure, a camera usually accepts a gain and carries on as before,
// and the exposure time it reports need not be the one it is using (one camera
// got brighter when given a quarter of its reported time). So:
//  - every change is judged only by what it did to the eyes in the picture;
//  - an adjustment that does nothing is put back and the next one is tried;
//  - the exposure is taken over from the camera two stops below the reported
//    time and lengthened stop by stop, never beyond one frame (that would
//    halve the frame rate and blur every eye movement);
//  - a picture too bright or too dark to read the eyes in is walked back
//    without readings until they can be read again;
//  - whatever does not end better than it began is put back as it was.
// The order: exposure compensation with the camera's own exposure running;
// then the takeover, exposure time (whole stops: Windows knows no finer ones)
// and gain (Windows passes a camera's gain as "exposure compensation"); then
// brightness. Everything tried, and what came of it, is kept in `log`.
const BAND={low:130,high:205};
const outside=level=>level<BAND.low?BAND.low-level:level>BAND.high?level-BAND.high:0;
const LEVER_NAME={comp:'exposure',takeover:'exposure taken over',time:'exposure time',gain:'gain',brightness:'brightness'};
const LEVER_KEY={comp:'exposureCompensation',time:'exposureTime',gain:'exposureCompensation',brightness:'brightness'};
const TUNED=['exposureCompensation','brightness','exposureTime'];
const eyeLevel=light=>{const eyes=(light||[]).filter(e=>e&&Number.isFinite(e.white));return eyes.length?eyes.reduce((s,e)=>s+e.white,0)/eyes.length:null;};
// Exposure times are in units of 100 microseconds.
const frameTime=track=>10000/(track?.getSettings?.().frameRate||30);
const adjustable=(track,key)=>pictureControls(track).find(c=>c.key===key&&c.canManual&&c.value!==null)||null;
export class PictureTuner{
 constructor(track){
  this.track=track;this.steps=0;this.done=false;this.log=[];this.tried=new Set();this.used=new Set();this.dead=new Set();
  this.current=null;this.pending=null;this.last=0;this.helped=false;this.first=null;this.level=null;this.origin=null;
  this.manual=false;this.manualHelped=false;this.settling=null;this.lost=0;this.blind=0;this.longest=false;this.picture0=null;
 }
 get available(){return TUNED.some(key=>adjustable(this.track,key));}
 snapshot(){return Object.fromEntries(TUNED.flatMap(key=>{const c=pictureControls(this.track).find(x=>x.key===key);return c?[[key,{value:c.value,automatic:c.automatic}]]:[];}));}
 changed(){const now=this.snapshot();return Object.entries(this.origin||{}).some(([key,was])=>now[key]&&(now[key].automatic!==was.automatic||!was.automatic&&now[key].value!==was.value));}
 // Everything back as it was when the first reading was taken.
 async restore(){
  for(const key of TUNED){
   const c=pictureControls(this.track).find(x=>x.key===key),was=this.origin?.[key];if(!c||!was)continue;
   try{
    if(was.automatic){if(c.canAuto&&!c.automatic)await setPicture(this.track,key,'auto');}
    else if(Number.isFinite(was.value)&&c.canManual&&(c.value!==was.value||c.automatic))await setPicture(this.track,key,was.value);
   }catch{/* A camera that ignored the change has nothing to put back. */}
  }
  this.manual=false;this.current=null;this.pending=null;
 }
 // The adjustments still worth trying, best first.
 candidates(direction){
  const time=adjustable(this.track,'exposureTime'),gain=adjustable(this.track,'exposureCompensation'),bright=adjustable(this.track,'brightness');
  const list=[];
  if(time&&!time.automatic){for(const id of direction>0?['time','gain']:['gain','time'])if(id==='time'||gain)list.push(id);}
  else{if(gain)list.push('comp');if(time)list.push('takeover');}
  if(bright)list.push('brightness');
  return list.filter(id=>!this.used.has(id));
 }
 async begin(id){
  if(id==='takeover'){
   this.used.add(id);
   const time=adjustable(this.track,'exposureTime'),start=Math.max(time.min,Math.min(frameTime(this.track),time.value/4));
   try{await setPicture(this.track,'exposureTime',start);}catch(e){this.log.push({lever:LEVER_NAME[id],error:String(e?.message||e)});return null;}
   if(this.track.getSettings?.().exposureMode!=='manual'){this.log.push({lever:LEVER_NAME[id],skipped:'the camera kept its exposure automatic'});return null;}
   this.manual=true;this.tried.add(LEVER_NAME[id]);this.settling={before:this.level,to:start};
   return 'settle';
  }
  const c=adjustable(this.track,LEVER_KEY[id]);
  if(!c){this.used.add(id);return null;}
  return {id,key:LEVER_KEY[id],name:LEVER_NAME[id],size:(c.max-c.min)*.12,start:c.value,good:c.value,misses:0};
 }
 // Give up on the current adjustment: back to the last value that did something.
 async drop(){
  const c=this.current;this.current=null;this.pending=null;if(!c)return;
  this.used.add(c.id);this.dead.add(c.id);
  try{await setPicture(this.track,c.key,c.good);}catch{/* Nothing to put back. */}
 }
 // light: one entry per eye, or null when the eyes are not seen. picture: the
 // average brightness of the whole view (0 to 255), which tells a burnt-out
 // picture from a black one when the eyes are lost in it.
 async step(light,{picture=null}={}){
  const level=eyeLevel(light),clipped=Math.max(0,...(light||[]).filter(Boolean).map(e=>e.clipped||0));
  if(level===null&&this.first===null)return {done:false,message:'Waiting to see both eyes…'};
  // dark, bright, ok; burnt (eyes burnt out, or lost in a white picture);
  // black (lost in a black picture); null (lost, and the picture does not say why).
  let state;
  if(level!==null){this.lost=0;const way=pictureStep(light);state=level>=240||clipped>.05?'burnt':way>0?'dark':way<0?'bright':'ok';}
  // Lost eyes are blamed on the picture only when it is white or black, or has
  // become far brighter or darker than it was at the first reading.
  else{const was=this.picture0,now=picture;state=now===null?null:now>=185||was!==null&&now>=150&&now>=2*was?'burnt':now<=12||was!==null&&now<=.45*was?'black':null;}
  if(state===null){
   if(++this.lost>=6)return this.finish(null,null);
   return {done:false,message:'Waiting to see both eyes…'};
  }
  if(level!==null){this.first??=level;this.level=level;}
  if(!this.origin){this.origin=this.snapshot();this.picture0=picture;}
  const direction=state==='ok'?0:state==='dark'||state==='black'?1:-1,unreadable=state==='burnt'||state==='black';
  const enough=from=>Math.max(1.5,.03*from); // More than a reading wobbles.
  const rank=(s,l)=>s==='black'?-1:s==='burnt'?1000:l,shown=(s,l)=>l===null||s==='burnt'?s:Math.round(l);
  if(this.settling){
   // The first reading after the takeover. It judges nothing.
   this.log.push({lever:LEVER_NAME.takeover,to:this.settling.to,eyesBefore:shown('',this.settling.before),eyesAfter:shown(state,level)});this.settling=null;
  }else if(this.pending&&this.current){
   const p=this.pending,cur=this.current;this.pending=null;
   // Unreadable before and after: nothing is learned, the step is kept and the next one is larger.
   const unseen=p.unreadable&&unreadable&&p.state===state,before=rank(p.state,p.level),after=rank(state,level);
   const worked=!unseen&&Math.sign(after-before)===p.direction&&(p.unreadable||unreadable||Math.abs(after-before)>=enough(before));
   const value=Number.isFinite(p.reported)?p.reported:p.to;
   this.log.push({lever:cur.name,key:p.key,from:p.from,to:p.to,reported:p.reported,eyesBefore:shown(p.state,p.level),eyesAfter:shown(state,level),worked:unseen?null:worked});
   if(worked){this.helped=true;cur.misses=0;cur.good=value;if(cur.id==='time'||cur.id==='gain')this.manualHelped=true;}
   else if(unseen){cur.good=value;if(cur.key!=='exposureTime')cur.size*=2;if(++this.blind>12)return this.finish(level,state);}
   else if(++cur.misses>=2)await this.drop();
  }
  if(state==='ok'){
   // In range: everything stays as it is, also a last step too small to be told from a wobble.
   this.done=true;
   return {done:true,message:this.changed()?`Picture set for your eyes (eye brightness ${Math.round(level)}).`:'The eyes are already well lit. Nothing was changed.'};
  }
  for(;;){
   if(++this.steps>40)return this.finish(level,state);
   if(!this.current){
    // A takeover that neither exposure time nor gain made any use of goes back to the camera.
    if(this.manual&&!this.manualHelped&&!this.candidates(direction).some(id=>id==='time'||id==='gain')){
     try{await setPicture(this.track,'exposureTime','auto');}catch{/* Nothing to give back. */}
     this.manual=false;this.log.push({lever:LEVER_NAME.takeover,released:true});
     return {done:false,message:'The camera does not obey a manual exposure. Giving the exposure back to it…'};
    }
    const id=this.candidates(direction)[0];
    if(!id)return this.finish(level,state);
    const begun=await this.begin(id);
    if(begun==='settle')return {done:false,message:'Taking the exposure over from the camera…'};
    if(!begun)continue;
    this.current=begun;
   }
   const cur=this.current,c=adjustable(this.track,cur.key);
   if(!c){this.used.add(cur.id);this.current=null;continue;}
   const turned=this.last!==0&&direction!==this.last;
   if(turned&&cur.id==='time'){
    // A whole stop too far. It is kept when a finer adjustment can come back
    // from there; otherwise the stop is undone and the finer ones finish from
    // the other side.
    const fine=['gain','brightness'].some(id=>{const k=!this.dead.has(id)&&adjustable(this.track,LEVER_KEY[id]);return k&&(direction>0?k.value<k.max:k.value>k.min);});
    this.used.add('time');this.current=null;for(const id of ['gain','brightness'])if(!this.dead.has(id))this.used.delete(id);
    if(!fine&&Number.isFinite(cur.previous)){
     try{await setPicture(this.track,'exposureTime',cur.previous);}catch{/* Stays where it is. */}
     this.last=0;return {done:false,message:'One stop back, to finish with the finer adjustments…'};
    }
    this.last=direction;continue;
   }
   if(turned&&!unreadable)cur.size/=2;
   const from=c.value,target=Math.max(c.min,Math.min(c.max,cur.key==='exposureTime'?from*(direction>0?2:.5):from+direction*cur.size));
   const tooLong=cur.key==='exposureTime'&&direction>0&&target>frameTime(this.track);
   if(tooLong)this.longest=true;
   // Used up: at its end, or the steps have become smaller than it can make.
   if(tooLong||cur.size<c.step/2||Math.abs(target-from)<1e-9){
    if(cur.misses)await this.drop();else{this.used.add(cur.id);this.current=null;}
    continue;
   }
   let reported=null;
   try{reported=(await setPicture(this.track,cur.key,target))?.value??null;}
   catch(e){this.log.push({lever:cur.name,key:cur.key,from,to:target,error:String(e?.message||e)});this.used.add(cur.id);this.dead.add(cur.id);this.current=null;continue;}
   if(cur.id==='time')cur.previous=from;
   this.tried.add(cur.name);
   this.pending={key:cur.key,from,to:target,reported,level,state,unreadable,direction};this.last=direction;
   return {done:false,message:`${direction<0?'Darkening':'Brightening'} the picture for your eyes: ${cur.name}.${level===null?'':` Eye brightness ${Math.round(level)}…`}`};
  }
 }
 // The end of the adjustments. Anything that is not clearly better for the
 // eyes than the picture the camera started with is put back.
 async finish(level,state){
  this.done=true;
  if(this.current?.misses)await this.drop();
  if(!this.tried.size)return {done:true,message:'This camera does not let the app change its brightness. Use Windows camera settings or the camera maker’s app.'};
  const readable=level!==null&&state!=='burnt',was=this.changed();
  const better=readable&&was&&outside(level)<outside(this.first)-Math.max(2,.03*this.first);
  const tried=` Tried: ${[...this.tried].join(', ')}.`,longest=this.longest?' The camera already exposes for a whole frame.':'';
  if(!better){
   await this.restore();
   if(level===null&&state===null)return {done:true,message:'Your eyes were lost from view while the picture was being set, so it was put back as it was. Check that the outlines follow your eyes, then try again.'};
   if(this.helped&&was)return {done:true,message:'The camera’s adjustments could not be settled for your eyes, so the picture was put back as it was. Use the sliders below, or change the light on your face.'};
   return {done:true,message:this.first<BAND.low?`Nothing the camera offers made your eyes brighter (eye brightness ${Math.round(this.first)} of 255; 130 or more works best).${tried}${longest} Add light in front of your face.`:`Nothing the camera offers made your eyes darker.${tried} The eyes are still too bright: dim the screen, or move lamps and windows out from behind you.`};
  }
  const far=`This is as far as the camera’s adjustments go: eye brightness ${Math.round(this.first)} → ${Math.round(level)}`;
  return {done:true,message:level<BAND.low?`${far} (130 or more works best).${longest} Add light in front of your face.`:`${far}. The eyes are still too bright: dim the screen, or move lamps and windows out from behind you.`};
 }
}
// Finds out which picture adjustments a camera really obeys. Each one is moved
// well away from its value, the picture is compared before and after, and the
// adjustment is put back. measure() returns the picture as lists of pixel
// values (each list is compared with its own earlier self). The verdicts:
//   'works'         the picture changed;
//   'reported only' the camera reports the new value, the picture did not change;
//   'ignored'       neither changed;
//   'rejected'      the camera refused the request.
export async function probePicture(track,measure,{pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),settle=800,onProgress=()=>{},cancelled=()=>false}={}){
 const mean=a=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i];return a.length?s/a.length:0;};
 const difference=(a,b)=>{const n=Math.min(a.length,b.length);let s=0;for(let i=0;i<n;i++)s+=Math.abs(a[i]-b[i]);return n?s/n:0;};
 const plan=[];
 for(const c of pictureControls(track)){
  if(!c.canManual||c.value===null)continue;
  plan.push({key:c.key});
  if(c.key==='exposureCompensation'&&adjustable(track,'exposureTime')?.automatic)plan.push({key:c.key,hold:true});
 }
 const results=[];
 for(const item of plan){
  if(cancelled())break;
  const c=adjustable(track,item.key);if(!c)continue;
  const from=c.value,wasAutomatic=!!c.mode&&c.automatic,held=item.hold?adjustable(track,'exposureTime'):null;
  // Exposure time: two stops shorter, which never slows the frame rate.
  // Everything else: 30% of its range, towards the side with more room.
  let to=c.key==='exposureTime'?(from/4>=c.min?from/4:Math.min(c.max,from*2)):from+(c.max-from>=from-c.min?1:-1)*.3*(c.max-c.min);
  to=Math.max(c.min,Math.min(c.max,c.min+Math.round((to-c.min)/c.step)*c.step));
  const result={key:c.key,label:c.label+(item.hold?', exposure time held':''),from,to};
  onProgress(result,results.length+1,plan.length);
  try{
   if(held){await setPicture(track,'exposureTime',held.value);await pause(settle);}
   // The picture also changes by itself (a person moves). How much, is taken
   // from an equally long wait before the change. The first list is the whole
   // view; further lists are fine detail, which only sharpness and focus alter.
   const first=await measure();await pause(settle);const before=await measure();
   result.reported=(await setPicture(track,c.key,to))?.value??null;
   await pause(settle);
   const after=await measure(),parts=before.map((_,i)=>i).filter(i=>i===0||c.key==='sharpness'||c.key==='focusDistance');
   result.noise=Math.max(...parts.map(i=>difference(before[i],first[i]||[])));
   result.change=Math.max(...parts.map(i=>difference(after[i]||[],before[i])));
   result.brighter=mean(after[0]||[])-mean(before[0]||[]);
   result.pictureChanged=parts.some(i=>difference(after[i]||[],before[i])>Math.max(2.5*difference(before[i],first[i]||[]),1.5));
   result.reportedChanged=Number.isFinite(result.reported)&&Math.abs(result.reported-from)>1e-9;
  }catch(e){result.error=String(e?.message||e);}
  try{await setPicture(track,c.key,wasAutomatic?'auto':from);if(held)await setPicture(track,'exposureTime','auto');}catch{/* Nothing to put back. */}
  await pause(settle*.6);
  result.verdict=result.error?'rejected':result.pictureChanged?'works':result.reportedChanged?'reported only':'ignored';
  for(const k of ['noise','change','brighter'])if(Number.isFinite(result[k]))result[k]=Math.round(result[k]*10)/10;
  results.push(result);
 }
 return results;
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
// Which edge of the camera picture the face runs past, over the recent frames. A face cut off
// at an edge is tracked less steadily, and the telephoto lens is not chosen for it.
//   add(face): face is the extent {x0,y0,x1,y1} as shares of the picture, or null.
//   edge: 'bottom' | 'top' | 'side' | null.
export class FaceEdges{
 constructor({size=60,least=20,share=.5}={}){Object.assign(this,{size,least,share});this.reset();}
 reset(){this.frames=[];}
 add(face){
  if(!face||![face.x0,face.y0,face.x1,face.y1].every(Number.isFinite))return;
  this.frames.push(face.y1>1?'bottom':face.y0<0?'top':face.x0<0||face.x1>1?'side':'');
  if(this.frames.length>this.size)this.frames.shift();
 }
 get edge(){
  if(this.frames.length<this.least)return null;
  for(const edge of ['bottom','top','side'])if(this.frames.filter(e=>e===edge).length>=this.frames.length*this.share)return edge;
  return null;
 }
}
// Where on the screen the eyes could not be read because something bright covered the irises, by
// band of the screen (top, middle and bottom third, by the height of the dot being looked at).
// (Written in 0.4.32 for reflections in glasses. What it counted on 20 Nov turned out to be the
// upper lid over the iris, on a person without glasses; see eyeLight. It stays as a measure.)
//   add(y, reason, oneEye): y is the dot's height (0 top, 1 bottom); reason is the frame's status
//   ('glare': no reading because both irises were covered); oneEye: read with one eye only.
//   worst: null, or {band, hidden, oneEye, elsewhere} as shares of that band's frames.
export class ReflectionTally{
 constructor({least=150,hidden=.15,either=.25}={}){Object.assign(this,{least,hiddenShare:hidden,eitherShare:either});this.reset();}
 reset(){this.bands=Object.fromEntries(['top','middle','bottom'].map(k=>[k,{frames:0,hidden:0,oneEye:0}]));}
 add(y,reason,oneEye=false){
  if(!Number.isFinite(y))return;
  const b=this.bands[y<1/3?'top':y>2/3?'bottom':'middle'];b.frames++;
  if(reason==='glare')b.hidden++;else if(oneEye)b.oneEye++;
 }
 get worst(){
  const cost=b=>b.frames?(b.hidden+b.oneEye/2)/b.frames:0,entries=Object.entries(this.bands).filter(([,b])=>b.frames>=this.least);
  if(!entries.length)return null;
  const [band,b]=entries.sort((a,c)=>cost(c[1])-cost(a[1]))[0];
  if(!(b.hidden/b.frames>=this.hiddenShare||(b.hidden+b.oneEye)/b.frames>=this.eitherShare))return null;
  const rest=Object.entries(this.bands).filter(([k])=>k!==band).reduce((a,[,v])=>({frames:a.frames+v.frames,hidden:a.hidden+v.hidden}),{frames:0,hidden:0});
  return {band,hidden:b.hidden/b.frames,oneEye:b.oneEye/b.frames,elsewhere:rest.frames?rest.hidden/rest.frames:0};
 }
}
export const FACE_EDGE_ADVICE={bottom:'Your chin is at the bottom edge of the camera picture: tilt the camera down a little so your whole face is inside.',top:'The top of your face is at the top edge of the camera picture: tilt the camera up a little so your whole face is inside.',side:'Your face is at the side edge of the camera picture: turn the camera towards you so your whole face is inside.'};
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
