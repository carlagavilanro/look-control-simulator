import {validEyeRegions} from './screen-eye-crop.mjs';
// Hardware settings and numerical eye regions only. No video frames persisted.
export const CAMERA_CONTROLS=['zoom','pan','tilt','focusMode','focusDistance','exposureMode','exposureTime','whiteBalanceMode','colorTemperature','brightness','contrast','saturation','sharpness'];
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
 return {cameraVersion:1,deviceId:s.deviceId||'',cameraLabel:track.label||'',width:s.width,height:s.height,frameRate:s.frameRate||0,cameraMode:mode,lens,externalZoom,...(crop?{crop:{zoom:crop.zoom??1,x:crop.x??.5,y:crop.y??.5}}:{}),...(trackingMode==='eyes'?{trackingMode,eyeRegions:eyeRegions?.map(r=>({x:r.x,y:r.y,size:r.size}))}:{}),
  controls:Object.fromEntries(CAMERA_CONTROLS.filter(k=>typeof s[k]==='string'||Number.isFinite(s[k])).map(k=>[k,s[k]]))};
}
export function sameCameraGeometry(a,b){
 if(!a?.cameraVersion&&!b?.cameraVersion)return true; // Legacy-to-legacy comparisons only.
 if(a?.cameraVersion!==1||b?.cameraVersion!==1)return false;
 if((a.trackingMode||'face')!==(b.trackingMode||'face'))return false;
 if(a.trackingMode==='eyes'&&(!validEyeRegions(a.eyeRegions)||!validEyeRegions(b.eyeRegions)||a.eyeRegions.some((r,i)=>['x','y','size'].some(k=>Math.abs(r[k]-b.eyeRegions[i][k])>1e-8))))return false;
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
 const now=cameraSnapshot(track,{lens:saved.lens,externalZoom:saved.externalZoom,crop:saved.crop,trackingMode:saved.trackingMode,eyeRegions:saved.eyeRegions});
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
 return {cameraVersion:1,cameraLabel:s.cameraLabel,cameraMode:s.cameraMode,lens:s.lens,externalZoom:s.externalZoom,frameRate:s.frameRate,controls,...(s.crop?{crop:{zoom:s.crop.zoom,x:s.crop.x,y:s.crop.y}}:{}),...(s.trackingMode==='eyes'?{trackingMode:'eyes',eyeRegions:s.eyeRegions.map(r=>({x:r.x,y:r.y,size:r.size}))}:{})};
}
