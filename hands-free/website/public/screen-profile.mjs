// What a profile keeps for Screen control besides its calibrations: the camera picked for it and
// the options set under it. It lives where the calibrations live (this browser, or the Windows
// app), under the profile's name. Names of cameras and yes/no options only: no picture, no eye data.
export const SETTINGS_KEY='hands-free.screen-profile.v1';
export const CALIBRATION_KEY='hands-free.screen-calibration.v1';
const MODES=['auto','4k','1080p','balanced'],TRACKING=['face','eyes'],DOCKS=['top-left','top-right','bottom-left','bottom-right'];
const SWITCHES=['dimCapture','autoRecentre','headMove','lidInput','autocorrect'];
const CHOICES={calibrationMode:['detailed','standard'],keyboardLayout:['compact','large'],readingDock:DOCKS};
const MODE_NAMES={auto:'Auto',  '4k':'4K', '1080p':'1080p', balanced:'720p'};
export function profileId(name){return String(name??'').trim().toLocaleLowerCase();}
const words=(value,most)=>typeof value==='string'?value.slice(0,most):'';
// camera: the one picked from the list. An empty deviceId is a choice too: "Default camera".
export function cleanCamera(camera){
 if(!camera||typeof camera!=='object')return null;
 return {deviceId:words(camera.deviceId,256),label:words(camera.label,120)};
}
export function cleanSetup(setup){
 if(!setup||typeof setup!=='object')return null;
 return {mode:MODES.includes(setup.mode)?setup.mode:'auto',tracking:TRACKING.includes(setup.tracking)?setup.tracking:'face'};
}
export function cleanControls(controls){
 if(!controls||typeof controls!=='object')return null;
 const kept={};
 for(const key of SWITCHES)if(typeof controls[key]==='boolean')kept[key]=controls[key];
 for(const [key,allowed] of Object.entries(CHOICES))if(allowed.includes(controls[key]))kept[key]=controls[key];
 return kept;
}
function all(storage){
 try{const saved=JSON.parse(storage.getItem(SETTINGS_KEY)||'{}');return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};}catch{return {};}
}
export function readProfile(storage,name){
 const id=profileId(name),saved=id&&Object.hasOwn(all(storage),id)?all(storage)[id]:null;
 return {camera:cleanCamera(saved?.camera),setup:cleanSetup(saved?.setup),controls:cleanControls(saved?.controls)};
}
// Only the parts given are replaced. Returns whether the profile was written.
export function writeProfile(storage,name,parts,now=Date.now()){
 const id=profileId(name);if(!id||id.length>40)return false;
 try{
  const everyone=all(storage),before=Object.hasOwn(everyone,id)?everyone[id]:{};
  const next={camera:cleanCamera(parts.camera===undefined?before.camera:parts.camera),setup:cleanSetup(parts.setup===undefined?before.setup:parts.setup),controls:cleanControls(parts.controls===undefined?before.controls:{...before.controls,...parts.controls}),savedAt:now};
  Object.defineProperty(everyone,id,{value:next,enumerable:true,configurable:true,writable:true});
  // The least recently saved profiles go first when there are very many.
  const names=Object.keys(everyone).sort((a,b)=>(everyone[b]?.savedAt||0)-(everyone[a]?.savedAt||0)).slice(0,40);
  storage.setItem(SETTINGS_KEY,JSON.stringify(Object.fromEntries(names.map(key=>[key,everyone[key]]))));return true;
 }catch{return false;}
}
export function forgetProfile(storage,name){
 try{const everyone=all(storage);delete everyone[profileId(name)];storage.setItem(SETTINGS_KEY,JSON.stringify(everyone));return true;}catch{return false;}
}
// The camera worth choosing over a laptop's own when both are there: the EMEET C60E this project
// is set up with (two lenses, 4K), or any camera that says 4K in its name.
export function fancyCamera(label){return /EMEET|\b4K\b/i.test(String(label||''));}
// Which camera to use, from the cameras the browser lists ({deviceId,label}; no names are listed
// before the camera has been allowed once).
//   profile      the camera picked from the list for this profile
//   fancy        nothing was picked, and the better camera is plugged in
//   calibration  the camera of the profile's saved calibration
//   default      whatever the browser gives
// missing: the camera picked for the profile is not among the cameras now connected.
export function chooseCamera(devices,{saved=null,calibrated=null}={}){
 const list=(devices||[]).filter(d=>d&&d.deviceId),named=list.some(d=>d.label);
 const find=camera=>!camera?null:list.find(d=>d.deviceId===camera.deviceId)||(camera.label?list.find(d=>d.label===camera.label):null)||null;
 let missing=null;
 if(saved){
  if(!saved.deviceId)return {deviceId:'',label:'',reason:'profile',missing:null};
  const found=find(saved);
  if(found)return {deviceId:found.deviceId,label:found.label||saved.label,reason:'profile',missing:null};
  // Without names the list cannot say whether the camera is there. It is asked for as saved.
  if(!named)return {deviceId:saved.deviceId,label:saved.label,reason:'profile',missing:null};
  missing=saved.label||'The camera chosen for this profile';
 }
 const usual=find(calibrated),better=list.find(d=>fancyCamera(d.label));
 if(better&&!saved&&!(usual&&fancyCamera(usual.label||calibrated.label)))return {deviceId:better.deviceId,label:better.label,reason:'fancy',missing};
 if(missing&&better)return {deviceId:better.deviceId,label:better.label,reason:'fancy',missing};
 if(usual)return {deviceId:usual.deviceId,label:usual.label||calibrated.label||'',reason:'calibration',missing};
 return {deviceId:'',label:'',reason:'default',missing};
}
// What a profile has saved for Screen control, for a line of text on another page.
export function screenSummary(storage,name){
 const kept=readProfile(storage,name);let record=null;
 try{const saved=JSON.parse(storage.getItem(CALIBRATION_KEY)||'{}'),id=profileId(name);record=id&&Object.hasOwn(saved,id)?saved[id]:null;}catch{}
 const setup=record?.setup&&typeof record.setup==='object'?record.setup:null;
 const calibrated=setup&&record.model?{deviceId:words(setup.deviceId,256),label:words(setup.cameraLabel,120),savedAt:Number.isFinite(record.savedAt)?record.savedAt:null,passed:record.validation?.passed===true}:null;
 return {camera:kept.camera,setup:kept.setup,controls:kept.controls,calibrated};
}
export function summaryText(summary){
 const camera=summary.camera?(summary.camera.deviceId?summary.camera.label||'the camera picked in Screen control':'the default camera'):summary.calibrated?.label||'';
 const mode=summary.setup?MODE_NAMES[summary.setup.mode]+' · '+(summary.setup.tracking==='eyes'?'Eyes close-up':'Face + eyes'):'';
 const parts=[];
 if(camera)parts.push('Camera: '+camera+(mode?' ('+mode+')':''));
 parts.push(summary.calibrated?'Pointer calibration saved'+(summary.calibrated.passed?'':' (accuracy not checked yet)'):'Pointer calibration needed');
 if(summary.controls&&Object.keys(summary.controls).length)parts.push('Options saved');
 return parts.join(' · ');
}
