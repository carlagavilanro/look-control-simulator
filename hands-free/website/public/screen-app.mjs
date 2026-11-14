import {TRAIN_TARGETS,CHECK_TARGETS,ALIGN_TARGETS,REFINE_TARGETS,calibrationTargets,settledSummary,fitCalibration,fitAlignment,fitRefinement,fitOffset,validateCalibration,predict,predictDetailed,validModel,sameSetup,quantile,GazePointer,FixationGate,TargetIntent,TargetDwell,nearTarget,contextTarget,subdivide,selectionMargin,containedTarget,chooseLayout,controlGeometry,zoomComplete} from './screen-gaze.mjs';
import {videoConstraints,cameraSnapshot,restoreCameraControls,sameCameraGeometry,cameraCrop,CameraZoomQueue,lensControl,lensZoom,lensCalibrationBank,calibrationForLens,identifySavedLens} from './screen-camera.mjs';
import {drawEyeOverlay} from './screen-eye-overlay.mjs';
import {DEFAULT_EYE_REGIONS,eyeRegionRect,previewEyePoint,validEyeRegions} from './screen-eye-crop.mjs';
import {WordSuggestions,insertText,completeWord} from './screen-typing.mjs';
import {MAX_HEAD_POSITIONS,savedHeadPositions,HeadPositionSelector,resetDwellForPosition,estimateHeadPositions,nextHeadPosition,HeadCaptureGuide,HeadReturnGuide} from './screen-positions.mjs';
import {focusTarget,visibleFocusTargets} from './screen-targets.mjs';
const $=id=>document.getElementById(id),desktop=window.desktopControl,pointer=new GazePointer(),fixation=new FixationGate(),intent=new TargetIntent(),dwell=new TargetDwell(600,{pauseMs:300,releaseMs:200});
const KEY='hands-free.screen-calibration.v1';
let stream,worker,ready=false,inFlight=false,lastVideo=-1,lastFrame=0,lastSample=0,lastReceived=0,generation=0,sessionSetup=null;
let model=null,validation=null,stage='welcome',capture=null,active=false,busy=false,blockedUntil=0,items=[],text='',uppercase=false;
let rect={x:0,y:0,w:1,h:1},depth=0,snapshot=null,lastHeartbeat=0,layout={columns:3,rows:3,capacity:9},pauseTask=Promise.resolve(),uiRevision=0;
let nativeProfiles=[],saveNotice='',resizeTimer=null;
let resultReport='';
let headPositions=[],positionId=1,positionSession=null,headEstimate=null;
const headSelector=new HeadPositionSelector();
const returnGuide=new HeadReturnGuide();
let lastHeadFeature=null,lastEyeFeature=null,returnRelease=false;
// Testing is an explicit, session-only choice. Never write it into calibration results.
let testing=false;
let selectionsPaused=false,previewUnverified=false;
let reading=false,wakeRelease=null,wakeReleaseAt=null,readingPracticeHidden=true;
let readingDock='bottom-right';
try{const saved=localStorage.getItem('hands-free.reading-dock');if(['top-left','top-right','bottom-left','bottom-right'].includes(saved))readingDock=saved;}catch{}
const trackingRuns=new Map();
let destination='youtube',letterGroup=null,clickThen=null,clickPurpose='button';
const drafts={youtube:'',google:'',app:''};
const composerButtons=['draft-space','draft-delete','draft-submit','draft-enter','draft-options','draft-compact','draft-hide','draft-pause','word-0','word-1','word-2','draft-undo'];
let wordEngine=new WordSuggestions(),wordChoices=[],typingUndo=null,autocorrect=true,typingRegion=null;
try{autocorrect=localStorage.getItem('hands-free.autocorrect')!=='off';}catch{}
fetch('/vendor/english-words.json').then(r=>{if(!r.ok)throw Error('Dictionary unavailable');return r.json();}).then(words=>{wordEngine=new WordSuggestions(words);refreshWords();}).catch(()=>{});
let keyboardLayout='compact',keyboardPage='letters';
try{
 // Restore compact typing once on upgrade from the easily-hit size key.
 // Touch only this preference; saved camera and gaze calibration stay intact.
 if(localStorage.getItem('hands-free.keyboard-layout-revision')!=='2'){
  localStorage.setItem('hands-free.keyboard-layout','compact');
  localStorage.setItem('hands-free.keyboard-layout-revision','2');
 }
 if(localStorage.getItem('hands-free.keyboard-layout')==='large')keyboardLayout='large';
}catch{}
let focusTargets=[],focusScope=null,focusAt=0,focusQuery=false,focusRebind=true,focusRevision=0;
let pointRetry=null,waitingMode=null,alignmentStart=null,alignmentLast=0,lastQuality='Starting camera',lastQualityAt=0;
let cameraProbe=[],cameraProbeDone=false,cameraStats=null,frameTimes=[],lastFrameReason='usable',alignmentError='';
const REJECTION={'head-position':'outside the saved head positions','head-reacquiring':'settling into a saved head position','outside-screen':'estimate outside screen','eyes-unavailable':'eye tracking unavailable','eye-features':'incomplete eye features','invalid-estimate':'invalid estimate','no-model':'no saved map'};
const HEAD_REASON={x:'horizontal position',y:'vertical position',scale:'distance',roll:'head tilt',yaw:'left/right rotation',pitch:'up/down rotation',unavailable:'unavailable'};
const QUALITY={'usable':'Both eyes are clear','eye-crop-unavailable':'Keep both eyes, eyelids and corners inside the marked areas.','no-face':'Face not found. Face the camera.','landmarks':'Eye landmarks are incomplete.','too-small':'Eyes are too small in the image. Move the camera closer.','iris':'Iris details are unclear. Adjust lighting or glasses glare.','closed-eye':'One or both eyes look closed to the tracker. Adjust the camera height.','eye-edge':'Look toward the dot without turning away.','disagreement':'The two eye estimates disagree. Adjust the camera angle or eye markings.'};
document.body.classList.toggle('desktop',!!desktop);$('browser-info').hidden=!!desktop;
$('quit').hidden=!desktop;$('quit').onclick=()=>desktop?.quit();
if(!desktop)$('start').textContent='Try eye control in this browser';
function headStatus(message){const button=$('head-status'),label=message.startsWith('Position ')?message.split(' · ')[0]+' · Align':message.startsWith('Between')||message.startsWith('Learned')?'Saved range · Align':'Find my position';if(button.textContent!==label)button.textContent=label;button.title=message+' · Find your saved head position';}
function report(message){$('status').textContent=message;$('welcome-status').textContent=message;}
function canControl(){return !!stream&&validModel(model)&&(validation?.passed===true||testing);}
function layoutValidation(){
 if(testing)return null;
 const measured=headPositions.filter(e=>e.validation?.passed).map(e=>e.validation);
 // Keep target locations fixed when another measured position becomes active.
 return measured.length?{...validation,radiusX:Math.max(...measured.map(v=>v.radiusX||0)),radiusY:Math.max(...measured.map(v=>v.radiusY||0)),jitterX:Math.max(...measured.map(v=>v.jitterX||0)),jitterY:Math.max(...measured.map(v=>v.jitterY||0))}:validation?.passed?validation:null;
}
function controlLayout(){return testing?{columns:2,rows:2,capacity:4}:chooseLayout(innerWidth,innerHeight,layoutValidation());}
function hitMargin(){return $('tiles').matches('.keyboard,.navigation,.compact-menu')?{x:6,y:6}:selectionMargin(testing?null:layoutValidation(),innerWidth,innerHeight);}
function updateTestNotice(){
 document.body.classList.toggle('testing',testing);$('test-mode-banner').hidden=!testing;
 $('test-mode-banner').textContent=`Test mode · ${stage==='paused'||!active?'Paused':'Accuracy unverified'} · Escape pauses`;
}
function clearTestMode(){testing=false;updateTestNotice();}
function profileKey(){return $('person').value.trim().toLocaleLowerCase();}
function isEyeCrop(){return $('tracking-mode').value==='eyes';}
function setupStamp(){const track=stream?.getVideoTracks()[0],physical=lensControl(track);return {...(track?cameraSnapshot(track,{lens:physical.lens||$('camera-lens').value,externalZoom:physical.supported?null:$('camera-remote-zoom').value?Number($('camera-remote-zoom').value):null,mode:$('camera-mode').value,crop:frameCrop,trackingMode:$('tracking-mode').value,eyeRegions}):{}),screenWidth:innerWidth,screenHeight:innerHeight,pixelRatio:devicePixelRatio};}
let cameraChoiceDirty=false,cameraSettingsAt=0,chosenCameraSettings=null;
let frameCrop={zoom:1,x:.5,y:.5},zoomQueue=null,cameraPreviewTimer=null,lensBusy=false;
let eyeRegions=DEFAULT_EYE_REGIONS.map(r=>({...r})),eyeMark=0;
function drawEyeRegions(){
 const settings=stream?.getVideoTracks()[0]?.getSettings();if(!settings)return;
 const c=cameraCrop(settings.width,settings.height,frameCrop),canvas=$('eye-regions');canvas.width=c.width;canvas.height=c.height;
 const ctx=canvas.getContext('2d');ctx.lineWidth=Math.max(2,c.width/400);ctx.setLineDash([c.width/80,c.width/160]);
 eyeRegions.forEach((r,i)=>{const box=eyeRegionRect(r,c.width,c.height);ctx.strokeStyle=i===0?'#00cfff':'#ffdd32';ctx.strokeRect(box.x,box.y,box.size,box.size);});
}
function trackingUI(){
 document.body.classList.toggle('eyes-tracking',isEyeCrop());$('eye-crop-setup').hidden=!isEyeCrop();$('eye-regions').hidden=!isEyeCrop()||stage!=='camera-preview';
 $('camera').classList.toggle('eye-setup',isEyeCrop()&&stage==='camera-preview');$('eye-region-size').value=eyeRegions[0].size;
 if(stage==='camera-preview'&&isEyeCrop())drawEyeRegions();
}
function updateEyeRegions(){
 cameraChoiceDirty=true;chosenCameraSettings=null;drawEyeRegions();worker?.postMessage({type:'regions',eyeRegions});
}
for(let i=0;i<2;i++)$('mark-eye-'+i).onclick=()=>{eyeMark=i;report('Click the center of eye '+(i+1)+' in the preview.');};
$('eye-regions').onclick=e=>{
 if(stage!=='camera-preview'||!isEyeCrop())return;
 const s=stream.getVideoTracks()[0].getSettings(),c=cameraCrop(s.width,s.height,frameCrop),point=previewEyePoint(e.clientX,e.clientY,$('eye-regions').getBoundingClientRect(),c.width,c.height);
 if(!point)return;eyeRegions=eyeRegions.map((r,i)=>i===eyeMark?{...r,...point}:r);
 if(!validEyeRegions(eyeRegions)){report('Mark two different eyes.');drawEyeRegions();return;}
 updateEyeRegions();eyeMark=1-eyeMark;report('Eye marked. Check that each box includes the eyelids and both corners.');
};
$('eye-region-size').oninput=()=>{eyeRegions=eyeRegions.map(r=>({...r,size:Number($('eye-region-size').value)}));updateEyeRegions();};
function cameraPresetBank(){
 const saved=nativeProfiles.find(p=>p.name.toLocaleLowerCase()===profileKey())?.record;let local=[];
 try{local=JSON.parse(localStorage.getItem('hands-free.camera-framing.'+profileKey())||'[]');}catch{}
 const entries=[...(saved?.cameraPresets||[]),...(Array.isArray(local)?local:[])].filter(s=>s?.cameraVersion===1&&s.deviceId&&['wide','telephoto','unspecified'].includes(s.lens));
 return [...new Map(entries.map(s=>[s.deviceId+'|'+s.lens+'|'+(s.trackingMode||'face'),s])).values()].slice(-6);
}
function rememberCameraPreset(s){
 const entries=[...cameraPresetBank().filter(p=>p.deviceId!==s.deviceId||p.lens!==s.lens||(p.trackingMode||'face')!==(s.trackingMode||'face')),s].slice(-6);
 try{localStorage.setItem('hands-free.camera-framing.'+profileKey(),JSON.stringify(entries));}catch{}
 return entries;
}
function lensPreset(){
 const track=stream?.getVideoTracks()[0],actual=track?.getSettings();if(!actual)return null;
 const map=calibrationForLens(identifySavedLens(rootSaved(),track),actual.deviceId,$('camera-lens').value,$('tracking-mode').value);
 const candidates=[map?.setup,...cameraPresetBank()];
 return candidates.find(s=>s?.deviceId===actual.deviceId&&s.lens===$('camera-lens').value&&(s.trackingMode||'face')===$('tracking-mode').value&&s.width===actual.width&&s.height===actual.height&&(!lensControl(track).supported||lensControl({label:track.label,getCapabilities:()=>track.getCapabilities(),getSettings:()=>({...actual,zoom:s.controls?.zoom})}).lens===s.lens));
}
function cameraBusy(value){lensBusy=value;for(const id of ['camera-lens-wide','camera-lens-telephoto','camera-use','camera-zoom','restore-lens-framing'])$(id).disabled=value;}
function syncPhysicalLens(){
 const physical=lensControl(stream?.getVideoTracks()[0]);
 if(physical.supported){if($('camera-lens').value!==physical.lens){cameraChoiceDirty=true;chosenCameraSettings=null;}$('camera-lens').value=physical.lens;$('camera-remote-zoom').value='';}
 $('camera-lens-buttons').hidden=!physical.supported;
 for(const lens of ['wide','telephoto'])$('camera-lens-'+lens).setAttribute('aria-pressed',String(physical.lens===lens));
 $('camera-lens-status').textContent=physical.supported?(physical.lens==='wide'?'Wide-angle lens':'Telephoto lens'):'Lens switching is unavailable for this camera or driver.';
 $('camera-active-lens').value=$('camera-lens').value;
 return physical;
}
function updateCropControls(){
 $('camera-crop').value=frameCrop.zoom;$('camera-crop-x').value=frameCrop.x;$('camera-crop-y').value=frameCrop.y;
 $('camera-crop-value').textContent=frameCrop.zoom.toFixed(2)+'×';
 $('camera').classList.toggle('crop-frame',frameCrop.zoom>1);
 $('camera-active-lens').value=$('camera-lens').value;$('restore-lens-framing').hidden=!lensPreset();if(stage==='camera-preview')cameraPreviewPoll(generation);
 trackingUI();
}
function paintCameraFrame(bitmap){
 if(frameCrop.zoom<=1)return;
 const canvas=$('camera-frame');if(canvas.width!==bitmap.width||canvas.height!==bitmap.height){canvas.width=bitmap.width;canvas.height=bitmap.height;}
 canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0);
}
function cameraPreviewPoll(current){
 clearTimeout(cameraPreviewTimer);if(current!==generation||stage!=='camera-preview')return;
 if(!lensBusy&&!zoomQueue?.running)cameraZoomControls();
 const s=stream.getVideoTracks()[0].getSettings(),c=cameraCrop(s.width,s.height,frameCrop);
 $('camera-live').textContent=`${stream.getVideoTracks()[0].label} · capture ${s.width} × ${s.height} · tracker frame ${c.width} × ${c.height}`;
 cameraPreviewTimer=setTimeout(()=>cameraPreviewPoll(current),700);
}
for(const [id,key] of [['camera-crop','zoom'],['camera-crop-x','x'],['camera-crop-y','y']])$(id).oninput=()=>{frameCrop={...frameCrop,[key]:Number($(id).value)};updateCropControls();};
for(const lens of ['wide','telephoto'])$('camera-lens-'+lens).onclick=async()=>{
 if(stage!=='camera-preview'||lensBusy)return;
 const track=stream?.getVideoTracks()[0],current=generation;cameraBusy(true);
 try{
  zoomQueue??=new CameraZoomQueue(track);await zoomQueue.set(lensZoom(track,lens));
  // Allow the camera's physical switch and exposure to settle before setup.
  await new Promise(resolve=>setTimeout(resolve,400));if(current!==generation||stage!=='camera-preview')return;
  if(syncPhysicalLens().lens!==lens)throw Error('The camera did not confirm the lens change.');
  const saved=lensPreset();
  if(saved){await restoreCameraControls(track,saved);frameCrop=saved.crop||{zoom:1,x:.5,y:.5};if(saved.eyeRegions)eyeRegions=saved.eyeRegions.map(r=>({...r}));}
  else frameCrop={zoom:1,x:.5,y:.5};
  cameraChoiceDirty=true;chosenCameraSettings=null;updateCropControls();cameraZoomControls();
  if(isEyeCrop())worker?.postMessage({type:'regions',eyeRegions});
  report((lens==='wide'?'Wide-angle':'Telephoto')+' lens selected. '+(saved?'Saved framing restored.':isEyeCrop()?'Mark both eyes in the preview.':'Keep your full face visible, then use these settings.'));
 }catch(e){report('Lens switch: '+e.message);}finally{cameraBusy(false);if(stage==='camera-preview')cameraZoomControls();}
};
$('restore-lens-framing').onclick=async()=>{
 const s=lensPreset(),track=stream?.getVideoTracks()[0];if(!s||!track)return;
 cameraBusy(true);try{await restoreCameraControls(track,s);frameCrop=s.crop||{zoom:1,x:.5,y:.5};if(s.eyeRegions)eyeRegions=s.eyeRegions.map(r=>({...r}));updateCropControls();cameraZoomControls();if(isEyeCrop())worker?.postMessage({type:'regions',eyeRegions});report('Saved framing restored.');}catch(e){report(e.message);}finally{cameraBusy(false);}
};
$('windows-camera-settings').hidden=!desktop?.openCameraSettings;
$('windows-camera-settings').onclick=()=>desktop?.openCameraSettings().catch(()=>report('Open Windows Settings → Bluetooth & devices → Cameras.'));

async function listCameras(requestPermission=false){
 try{const chosen=$('camera-device').value;let devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
  if(requestPermission&&!stream&&(!devices.length||devices.every(d=>!d.label))){const temporary=await navigator.mediaDevices.getUserMedia({video:true,audio:false});temporary.getTracks().forEach(t=>t.stop());devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');}
  devices=devices.filter(d=>d.deviceId);
  $('camera-device').replaceChildren(new Option('Default camera',''),...devices.map((d,i)=>new Option(d.label||`Camera ${i+1}`,d.deviceId)));
  if(devices.some(d=>d.deviceId===chosen))$('camera-device').value=chosen;
 }catch{report('Camera list unavailable. Check Windows camera permission.');}
}
function cameraPreferences(saved){
 if(!saved?.setup||cameraChoiceDirty)return;
 const s=saved.setup;if(s.deviceId&&!Array.from($('camera-device').options).some(o=>o.value===s.deviceId))$('camera-device').add(new Option(s.cameraLabel||'Saved camera',s.deviceId));
 frameCrop=s.crop||{zoom:1,x:.5,y:.5};$('tracking-mode').value=s.trackingMode||'face';if(s.eyeRegions)eyeRegions=s.eyeRegions.map(r=>({...r}));updateCropControls();$('camera-device').value=s.deviceId;$('camera-mode').value=s.cameraMode||'auto';$('camera-lens').value=s.lens||'unspecified';$('camera-remote-zoom').value=s.externalZoom??'';
 $('camera-saved').textContent=s.cameraVersion?`${s.cameraLabel||'Saved camera'} · ${s.width} × ${s.height} · ${s.lens}${s.externalZoom?' · remote zoom '+s.externalZoom+'×':''}`:'Older calibration: camera zoom was not recorded. Use a new calibration for this camera.';
}
function cameraZoomControls(preserveSlider=false){
 const track=stream?.getVideoTracks()[0],cap=track?.getCapabilities?.().zoom,zoom=track?.getSettings().zoom;
 const physical=syncPhysicalLens(),supported=Number.isFinite(cap?.min)&&cap.max>cap.min&&Number.isFinite(zoom)&&!physical.lensOnly;
 $('camera-zoom-row').hidden=!supported;$('camera-zoom-note').hidden=supported;
 $('camera-zoom-note').textContent=physical.lensOnly?'At this resolution, use the two lens buttons. Extra frame crop is available below.':'Camera zoom is unavailable in this driver. Try Windows camera settings.';
 $('restore-lens-framing').hidden=!lensPreset();
 if(supported){const control=$('camera-zoom');control.min=cap.min;control.max=cap.max;control.step=cap.step||.01;if(!preserveSlider)control.value=zoom;$('camera-zoom-value').textContent=`${zoom} / ${cap.max} device units`;}
}
function finishCameraPreview(){
 if(lensBusy||zoomQueue?.running)return;
 if(isEyeCrop()&&!validEyeRegions(eyeRegions)){report('Mark two different eyes before continuing.');return;}
 sessionSetup=setupStamp();rememberCameraPreset(sessionSetup);chosenCameraSettings=sessionSetup;worker?.terminate();worker=null;ready=false;inFlight=false;$('eye-regions').hidden=true;$('camera-settings').hidden=true;document.body.classList.remove('camera-preview');
 clearTimeout(cameraPreviewTimer);cameraPreviewTimer=null;cameraChoiceDirty=true;stage='camera-ready';$('workspace').hidden=true;$('welcome').hidden=false;$('camera').hidden=true;$('tracking-info').hidden=true;refreshProfile();const saved=loadSaved();report(saved&&sameSetup(saved.setup,sessionSetup)?'Framing kept. This lens’s saved calibration is ready.':'Framing kept. Calibrate this lens when ready.');
}
$('camera-preview').onclick=()=>startCamera('camera');$('camera-use').onclick=finishCameraPreview;$('camera-refresh').onclick=()=>listCameras(true);
for(const id of ['camera-device','camera-mode','camera-lens','camera-remote-zoom'])$(id).onchange=()=>{cameraChoiceDirty=true;chosenCameraSettings=null;refreshProfile();};
$('tracking-mode').onchange=()=>{
 cameraChoiceDirty=true;chosenCameraSettings=null;const saved=loadSaved()?.setup;
 if(saved){chosenCameraSettings=saved;frameCrop=saved.crop||{zoom:1,x:.5,y:.5};if(saved.eyeRegions)eyeRegions=saved.eyeRegions.map(r=>({...r}));$('camera-mode').value=saved.cameraMode||'auto';}
 trackingUI();refreshProfile();
};
$('camera-zoom').oninput=async()=>{
 if(!stream||stage!=='camera-preview'||lensBusy)return;
 zoomQueue??=new CameraZoomQueue(stream.getVideoTracks()[0]);for(const id of ['camera-use','camera-lens-wide','camera-lens-telephoto','restore-lens-framing'])$(id).disabled=true;
 try{await zoomQueue.set(Number($('camera-zoom').value));if(stage==='camera-preview')cameraZoomControls(true);}catch{report('Camera rejected this zoom. Use Windows settings or try 1080p.');}finally{cameraBusy(false);}
};
$('camera-zoom').onchange=async()=>{try{await zoomQueue?.running;}catch{}if(stage==='camera-preview')cameraZoomControls();};
await listCameras();navigator.mediaDevices?.addEventListener('devicechange',()=>listCameras());

function rootSaved(){
 const native=nativeProfiles.find(p=>p.name.toLocaleLowerCase()===profileKey())?.record;
 if(native)return native;
 try{const all=JSON.parse(localStorage.getItem(KEY)||'{}');return Object.hasOwn(all,profileKey())?all[profileKey()]:null;}catch{return null;}
}
function loadSaved(){
 const record=identifySavedLens(rootSaved(),stream?.getVideoTracks()[0]);if(!cameraChoiceDirty)return record;
 return calibrationForLens(record,$('camera-device').value,$('camera-lens').value,$('tracking-mode').value);
}
async function saveModel(updatePosition=true){
 if(!profileKey()||!validModel(model))return;
 if(updatePosition){const entry={id:positionId,model,validation,savedAt:Date.now()};headPositions=[...headPositions.filter(e=>e.id!==positionId),entry].sort((a,b)=>a.id-b.id);}
 const name=$('person').value.trim(),key=profileKey();
 const record={model,setup:sessionSetup||setupStamp(),cameraPresets:rememberCameraPreset(sessionSetup||setupStamp()),validation,savedAt:Date.now(),headPositions,activePositionId:positionId};let saved=false;
 const previous=identifySavedLens(rootSaved(),stream?.getVideoTracks()[0]);record.lensCalibrations=lensCalibrationBank(record,lensCalibrationBank(previous,previous?.lensCalibrations||[]));
 if(desktop?.saveCalibration)try{
  const result=await desktop.saveCalibration(name,record);
  nativeProfiles=nativeProfiles.filter(p=>p.name.toLocaleLowerCase()!==key);nativeProfiles.push({name,record:result});saved=true;
 }catch{}
 try{const all=JSON.parse(localStorage.getItem(KEY)||'{}');Object.defineProperty(all,key,{value:record,enumerable:true,configurable:true,writable:true});localStorage.setItem(KEY,JSON.stringify(all));saved=true;}catch{}
 saveNotice=saved?'Calibration saved on this computer.':'Calibration could not be saved. It will work only for this session.';
 $('save-status').textContent=saveNotice;
 refreshProfile();
}
function refreshProfile(){
 const saved=loadSaved(),usable=saved&&validModel(saved.model);cameraPreferences(saved);
 const prepared=saved&&(stage==='camera-ready'&&sessionSetup&&sameSetup(saved.setup,sessionSetup)||chosenCameraSettings&&sameSetup(saved.setup,chosenCameraSettings));
 $('start').textContent=usable?(cameraChoiceDirty&&!prepared||!saved.setup?.cameraVersion?'Start new calibration':'Use saved calibration'):desktop?'Start camera & setup':'Try eye control in this browser';
 $('restore').hidden=!usable;
 $('return-saved').hidden=!usable;
 $('align-saved').hidden=!usable;
 $('eye-only-saved').hidden=!usable;$('refine-saved').hidden=!usable;
 $('positions-saved').hidden=!usable;
 $('positions-count').textContent=usable?`${savedHeadPositions(saved).length} head position(s) saved`:'';
 $('test-saved').hidden=!usable;$('test-description').hidden=!usable;
 $('profile-status').textContent=usable?(saved.validation?.passed?'Calibration saved':'Calibration saved · alignment needed'):'Create a calibration for this profile';$('new-calibration').hidden=!usable;
}
function restorePositionBackup(){
 if(!positionSession)return;
 ({model,validation,positionId}=positionSession.backup);headSelector.reset();
}
async function openHeadPositions(){
 if(isEyeCrop()){report('Guided face positions are available in Face + eyes mode.');return;}
 if(!stream||!validModel(model)){await startCamera('positions');return;}
 if(capture)return;
 await pause(false);clearTestMode();hideComposer();$('result-dialog').close();
 if(!headPositions.length)headPositions=[{id:positionId,model,validation,savedAt:Date.now()}];
 positionSession={backup:{model,validation,positionId},pending:null,skipped:[],span:.75,manual:false,captureGuide:new HeadCaptureGuide(),captureState:null};
 showHeadPositions();
}
function showHeadPositions(message=''){
 stage='positions';capture=null;pointRetry=null;active=false;headSelector.reset();
 $('workspace').classList.remove('calibrating','previewing');$('cal-dot').hidden=true;$('cal-message').hidden=true;$('retry-point').hidden=true;
 $('gaze').hidden=true;$('tiles').hidden=true;$('accuracy-preview').hidden=true;setCameraPreview(true);
 $('mode-label').textContent='Head positions';$('positions-message').textContent=message||'';
 $('position-instruction').textContent=`${headPositions.length} / ${MAX_HEAD_POSITIONS} positions saved`;
 $('position-list').replaceChildren(...headPositions.map(e=>{
  const li=document.createElement('li'),label=document.createElement('span'),button=document.createElement('button');
  label.textContent=`Position ${e.id} · ${e.validation?.passed?'Ready':'Test only — accuracy check not passed'}${Number.isFinite(e.validation?.p90Pixels)?' · 90% within '+e.validation.p90Pixels+' px':''}`;
  button.textContent=`Replace position ${e.id}`;button.onclick=()=>startHeadPosition(e.id);li.append(label,button);return li;
 }));
 positionSession.plan=nextHeadPosition(headPositions,{skip:positionSession.skipped,span:positionSession.span});
 renderHeadGuide();
 $('position-resume').hidden=!headPositions.some(e=>e.validation?.passed);
 $('position-test').hidden=!headPositions.some(e=>!e.validation?.passed);
 if(!$('positions-dialog').open)$('positions-dialog').showModal();
 $('positions-title').focus({preventScroll:true});$('positions-dialog').scrollTop=0;
 report('Head-position setup. Desktop input is paused.');
}
function startHeadPosition(id=Math.max(0,...headPositions.map(e=>e.id))+1){
 if(!positionSession||positionSession.pending)return;
 if(!headPositions.some(e=>e.id===id)&&(!positionSession.captureState?.captureReady||performance.now()-lastReceived>250))return;
 if(!headPositions.some(e=>e.id===id)&&headPositions.length>=MAX_HEAD_POSITIONS)return;
 restorePositionBackup();positionSession.pending=id;
 $('positions-dialog').close();beginCapture('adjust',true);
 report(`Position ${id}: keep your head comfortably here and follow the five dots with your eyes.`);
}
function guideTransform(head,reference,side=false){
 const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 const x=(side?345:115)-(head.x-reference.x)/.05*36,y=110+(head.y-reference.y)/.05*36;
 const angle=side?(head.pitch-reference.pitch)/.07*18:-(head.roll-reference.roll)*180/Math.PI;
 return `translate(${clamp(x,side?290:55,side?400:175)} ${clamp(y,65,155)}) rotate(${clamp(Number.isFinite(angle)?angle:0,-25,25)}) scale(${clamp(head.scale/reference.scale,.65,1.4)})`;
}
function renderHeadGuide(){
 if(!positionSession)return;
 positionSession.captureGuide.reset();positionSession.captureState=null;
 const {plan,manual}=positionSession;
 $('position-guide-title').textContent=manual?'Capture your chosen position':plan?`Suggested position ${Math.max(0,...headPositions.map(e=>e.id))+1}`:'Choose a comfortable additional position';
 $('position-guide-direction').textContent=manual?'Choose a comfortable position.':plan?`${plan.label}${plan.id.startsWith('tilt')?` · about ${Math.abs(plan.tiltDegrees)}°`:''}`:'Choose another comfortable position.';
 $('position-guide-drawing').toggleAttribute('hidden',!plan||manual);
 $('position-next').disabled=manual||!plan;$('position-smaller').disabled=manual||!plan||positionSession.span<=.4;
 $('position-manual').textContent=manual?'Use suggestions':'Choose my position';
 $('position-add').textContent='Capture this position';
 $('position-add').disabled=true;
 $('position-guide-progress').value=0;
 $('position-guide-feedback').textContent=manual?'Choose a comfortable position.':'Move toward the oval, then hold. Five points start automatically.';
 if(plan){
  $('guide-target-face').setAttribute('transform',guideTransform(plan.target,plan.reference));
  $('guide-target-side').setAttribute('transform',guideTransform(plan.target,plan.reference,true));
  const nose=-(plan.target.yaw-plan.reference.yaw)/.07*18,shift=Number.isFinite(nose)?nose:0;
  $('guide-target-nose').setAttribute('d',`M${shift} -5L${shift+7} 14H${shift-5}`);
  $('guide-drawing-description').textContent=`${plan.label}. Solid outline is the target, dotted outline is your current camera estimate. Start from the gray outline.`;
 }
}
function updateHeadGuide(feature,now,head=feature){
 if(stage!=='positions'||!positionSession||positionSession.pending)return;
 const session=positionSession;
 const state=session.captureGuide.update(head,session.plan,headPositions,now,{eyesReady:!!feature,manual:session.manual});session.captureState=state;
 $('position-add').disabled=!state.captureReady||headPositions.length>=MAX_HEAD_POSITIONS;
 $('position-guide-progress').value=state.holdProgress||state.progress;
 $('position-guide-feedback').textContent=state.message;
 const current=state.head,reference=session.plan?.reference;
 if(current&&reference){
  $('guide-live-face').setAttribute('transform',guideTransform(current,reference));
  $('guide-live-side').setAttribute('transform',guideTransform(current,reference,true));
  const shift=Math.max(-28,Math.min(28,-(current.yaw-reference.yaw)/.07*18))||0;
  $('guide-live-nose').setAttribute('d',`M${shift} -5L${shift+7} 14H${shift-5}`);
 }
 $('guide-live-face').style.visibility=head?'visible':'hidden';$('guide-live-side').style.visibility=head?'visible':'hidden';
 if(state.autoStart&&headPositions.length<MAX_HEAD_POSITIONS)startHeadPosition();
}
function returnOptions(){return {allowUnverified:testing||(stage==='preview'&&previewUnverified),preferredId:positionId};}
function resetReturnGuide({snooze=false,release=false}={}){
 if(snooze)returnGuide.dismiss(performance.now());else returnGuide.reset();
 const wasOpen=$('return-dialog').open;$('return-dialog').close();document.body.classList.remove('return-guiding');
 if(wasOpen&&reading)desktop?.readingPointer(false);
 if(wasOpen){pointer.reset();fixation.reset();intent.reset();resetDwellForPosition(dwell);clearHighlight();headSelector.reset();desktop?.heartbeat(false);lastHeartbeat=0;blockedUntil=performance.now()+500;returnRelease=release&&!reading;}
}
function renderReturnGuide(state,feature){
 if(!state.visible)return;
 const {plan}=state,dialog=$('return-dialog');
 if(!dialog.open){
  desktop?.heartbeat(false);intent.reset();resetDwellForPosition(dwell);clearHighlight();$('gaze').hidden=true;
  document.body.classList.add('return-guiding');dialog.showModal();$('return-title').focus({preventScroll:true});
  if(reading)desktop?.readingPointer(true);
 }
 $('return-position').textContent=`Position ${plan.entry.id}${plan.entry.validation?.passed?'':' · test calibration'}`;
 $('return-next').hidden=plan.ids.length<2;
 $('return-target-face').setAttribute('transform',guideTransform(plan.target,plan.reference));
 $('return-target-side').setAttribute('transform',guideTransform(plan.target,plan.reference,true));
 const visible=!!feature&&plan.fields.every(k=>Number.isFinite(feature[k]))&&feature.scale>0;
 for(const id of ['return-live-face','return-live-side'])$(id).style.visibility=visible?'visible':'hidden';
 if(visible){
  $('return-live-face').setAttribute('transform',guideTransform(feature,plan.reference));
  $('return-live-side').setAttribute('transform',guideTransform(feature,plan.reference,true));
  const shift=Math.max(-28,Math.min(28,-(feature.yaw-plan.reference.yaw)/.07*18))||0;
  $('return-live-nose').setAttribute('d',`M${shift} -5L${shift+7} 14H${shift-5}`);
 }
 dialog.classList.toggle('matched',state.ready);
 $('return-feedback').textContent=state.ready?'Matched. Hold here…':state.message==='Position matched. Hold here.'?'Head matched. Open both eyes.':state.message;
 $('return-progress').value=state.ready?state.holdProgress:state.progress;
 if(state.complete){resetReturnGuide({release:true});report('Saved position found. Look at a control.');}
}
function openReturnGuide(){
 if(!stream||!validModel(model)||capture||positionSession)return;
 const fresh=performance.now()-lastReceived<=250;
 const state=returnGuide.update(fresh?lastHeadFeature:null,headPositions,performance.now(),{...returnOptions(),force:true,eyesReady:false});
 renderReturnGuide(state,fresh?lastHeadFeature:null);
 if(!state.visible)report('A saved head position is needed.');
}
async function finishHeadPosition(){
 const session=positionSession;
 const id=positionSession.pending,entry={id,model,validation,savedAt:Date.now()},previous=headPositions.find(e=>e.id===id);
 const keepPrevious=previous?.validation?.passed&&!validation.passed;
 if(!keepPrevious)headPositions=[...headPositions.filter(e=>e.id!==id),entry].sort((a,b)=>a.id-b.id);
 restorePositionBackup();positionSession.pending=null;
 // Keep the original startup map; commit the extra position only after all
 // separate checks finish. Cancellation never overwrites a measured map.
 if(headPositions.some(e=>e.id===positionId)){
  const retained=headPositions.find(e=>e.id===positionId);model=retained.model;validation=retained.validation;
  positionSession.backup={model,validation,positionId};
 }
 await saveModel(false);
 if(positionSession!==session)return;
 showHeadPositions(keepPrevious?'Previous working position is kept.':`Position ${id} saved${entry.validation.passed?'':' · test mode only'}`);
}
async function finishPositions(test=false){
 if(!positionSession)return;
 restorePositionBackup();positionSession=null;$('positions-dialog').close();headSelector.reset();
 const initial=headPositions.find(e=>test||e.validation?.passed);
 if(!initial){backToSetup();return;}
 positionId=initial.id;model=initial.model;validation=initial.validation;
 await activate(test);
}
function cancelPositions(){restorePositionBackup();positionSession=null;$('positions-dialog').close();backToSetup();}
try{const p=JSON.parse(localStorage.getItem('look-control.profiles.v1')||'{}');$('person').value=p.profiles?.find(x=>x.id===p.activeId)?.name||localStorage.getItem('hands-free.screen-name')||'';}catch{}
$('person').oninput=()=>{cameraChoiceDirty=false;chosenCameraSettings=null;refreshProfile();};
$('start').disabled=true;
try{if(desktop?.loadCalibrations){const saved=await desktop.loadCalibrations();nativeProfiles=saved.profiles||[];if(saved.lastName)$('person').value=saved.lastName;}}catch{report('Saved profiles could not be read. You can still start a new calibration.');}
$('start').disabled=false;refreshProfile();
$('forget').onclick=async()=>{
 await pause(false);
 try{
  if(desktop?.deleteCalibration)await desktop.deleteCalibration($('person').value.trim());
  nativeProfiles=nativeProfiles.filter(p=>p.name.toLocaleLowerCase()!==profileKey());
  const all=JSON.parse(localStorage.getItem(KEY)||'{}');delete all[profileKey()];localStorage.setItem(KEY,JSON.stringify(all));
  model=null;validation=null;refreshProfile();report('Screen calibration removed for this profile.');
 }catch{report('Unable to change saved calibration.');}
};
async function startCamera(mode='resume'){
 try{
  hideComposer();$('more-controls').hidden=true;
  if(!$('camera-remote-zoom').reportValidity())return;
  if(!$('person').value.trim()){$('person').focus();report('Enter a name to keep calibrations separate.');return;}
  const keepStream=stage==='camera-ready'&&stream&&sessionSetup&&$('camera-device').value===sessionSetup.deviceId&&$('camera-mode').value===sessionSetup.cameraMode&&sameSetup(sessionSetup,setupStamp());
  await pause(false);clearTestMode();if(!keepStream)stopCamera();else{clearTimeout(cameraPreviewTimer);cameraPreviewTimer=null;}const current=++generation;model=null;validation=null;saveNotice='';$('save-status').textContent='';
  try{localStorage.setItem('hands-free.screen-name',$('person').value.trim());}catch{}
  if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Use HTTPS or localhost to enable the camera.');
  report('Allow the selected camera when asked.');
  const saved=loadSaved(),reuse=mode!=='train'&&mode!=='camera'&&!cameraChoiceDirty&&saved?.setup,balanced=$('camera-mode').value==='balanced';
  const chosen=$('camera-device').value||reuse?.deviceId||'';
  trackingRuns.clear();cameraProbe=[];frameTimes=[];cameraStats=null;cameraProbeDone=!!reuse||$('camera-mode').value!=='auto';alignmentError='';
  const acquired=keepStream?stream:await navigator.mediaDevices.getUserMedia(videoConstraints({deviceId:chosen,mode:$('camera-mode').value,saved:reuse,ptz:!!navigator.mediaDevices.getSupportedConstraints?.().zoom}));
  if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
  stream=acquired;if(mode!=='camera'&&!keepStream)await restoreCameraControls(stream.getVideoTracks()[0],reuse||(chosenCameraSettings?.deviceId===stream.getVideoTracks()[0].getSettings().deviceId?chosenCameraSettings:null));await listCameras();$('camera-device').value=stream.getVideoTracks()[0].getSettings().deviceId||'';stream.getVideoTracks()[0].onended=()=>fail('The camera disconnected. Reconnect it and start setup again.');
  $('video').srcObject=stream;await $('video').play();
  if(current!==generation)return;syncPhysicalLens();sessionSetup=setupStamp();$('retry-point').hidden=true;
  $('welcome').hidden=true;$('workspace').hidden=false;$('workspace').classList.add('calibrating');setCameraPreview(true);$('cal-message').hidden=true;$('cal-dot').hidden=true;$('tiles').hidden=true;
  $('workspace').classList.remove('previewing');$('accuracy-preview').hidden=true;$('preview-check').hidden=true;
  if(mode==='camera'){
   stage='camera-preview';zoomQueue=new CameraZoomQueue(stream.getVideoTracks()[0]);updateCropControls();document.body.classList.add('camera-preview');$('camera-settings').hidden=false;$('mode-label').textContent='Camera preview';cameraZoomControls();
   const s=stream.getVideoTracks()[0].getSettings();$('camera-live').textContent=`${stream.getVideoTracks()[0].label} · ${s.width} × ${s.height} · ${Math.round(s.frameRate||0)} capture fps`;
   cameraBusy(false);trackingUI();report(isEyeCrop()?'Mark both eyes. Include eyelids and both eye corners.':'Keep your full face visible. Choose a lens, then use these settings.');cameraPreviewPoll(current);
   if(!isEyeCrop()){frame(current);return;}
  }
  cameraSettingsAt=0;
  worker=new Worker('/screen-worker.mjs',{type:'module'});
  worker.onerror=()=>fail('Eye tracking stopped. Restart camera setup.');
  worker.onmessage=async({data})=>{
   if(current!==generation)return;
   if(data.type==='ready'){
    ready=true;
    if(mode==='camera'){report('Mark each eye, then check the blue iris outlines.');return;}
    if(mode==='find'){
     stage='starting';try{await startAligned(mode);}catch(e){fail(e.message);}return;
    }
    waitingMode=mode;alignmentStart=null;stage='align';$('mode-label').textContent='Camera check';$('tiles').hidden=true;$('cal-dot').hidden=true;setCameraPreview(true);$('tracking-info').hidden=false;report(isEyeCrop()?'Keep both eyes inside the marked areas. Calibration starts when they are clear.':'Face the camera. Calibration starts when both eyes are clear.');return;
   }
   if(data.type==='error'){inFlight=false;fail('Eye model could not run: '+data.message);return;}
   if(data.type==='sample'){
    inFlight=false;lastReceived=performance.now();drawEyes(data.eyes,data.width,data.height);
    const reason=data.quality?.reason||(data.feature?'usable':'no-face');lastFrameReason=reason;lastQuality=QUALITY[reason]||'Waiting for clear eyes';
    const delay=Math.max(0,lastReceived-data.timestamp);cameraProbe.push(delay);if(cameraProbe.length>60)cameraProbe.shift();frameTimes.push(lastReceived);frameTimes=frameTimes.filter(t=>lastReceived-t<3000);
    cameraStats={width:$('video').videoWidth,height:$('video').videoHeight,processedWidth:data.width,processedHeight:data.height,cropZoom:frameCrop.zoom,processingMs:Math.round(quantile(cameraProbe,.5)),fps:frameTimes.length>1?Math.round((frameTimes.length-1)*1000/(lastReceived-frameTimes[0])):0,eyePixels:data.quality?.eyePixels||[]};
    const cameraText=`${cameraStats.width} × ${cameraStats.height} · ${cameraStats.fps} tracking fps · ${cameraStats.processingMs} ms processing`;
    $('camera-stats').textContent=cameraText;
    if(stage==='camera-preview'){$('eye-crop-status').textContent=lastQuality+(cameraStats.eyePixels.length?' · '+cameraStats.eyePixels.join(' / ')+' px':'')+' · '+cameraStats.fps+' fps';return;}
    if(lastReceived-lastQualityAt>200){lastQualityAt=lastReceived;$('tracking-info').textContent=lastQuality+(cameraStats.eyePixels.length?' · Eye detail: '+cameraStats.eyePixels.join(' / ')+' px':'')+' · '+cameraText;}
    if(!['resizing','camera-adjust'].includes(stage)&&lastReceived-cameraSettingsAt>1000){cameraSettingsAt=lastReceived;
     const currentSetup=setupStamp();if(sessionSetup&&!sameSetup(sessionSetup,currentSetup)){fail('Camera zoom, framing, or resolution changed. Restore the saved settings or start a new calibration.');return;}
    }
    if(stage==='resizing'||stage==='point-help'||stage==='camera-adjust')return;
    if(stage==='align'){
     if($('camera-mode').value!=='auto'&&cameraStats.fps>0&&cameraStats.fps<10)report('Tracking is slow at this resolution. You can choose 1080p in setup; resolution will stay as selected.');
     if(!cameraProbeDone&&$('camera-mode').value==='auto'){
      if(cameraProbe.length<24)return;
      cameraProbeDone=true;
      if((quantile(cameraProbe,.9)>180||cameraStats.fps<10)&&cameraStats.height>720){
       stage='camera-adjust';report('Adjusting camera resolution to keep tracking responsive.');
       try{await stream.getVideoTracks()[0].applyConstraints({width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}});}catch{}
       if(current!==generation)return;sessionSetup=setupStamp();cameraProbe=[];frameTimes=[];alignmentStart=null;alignmentLast=0;stage='align';return;
      }
     }
     if(data.feature&&lastReceived-data.timestamp<=1000){if(lastReceived-alignmentLast>1000)alignmentStart=null;alignmentStart??=lastReceived;alignmentLast=lastReceived;if(lastReceived-alignmentStart>=700){const mode=waitingMode;stage='starting';try{await startAligned(mode);}catch(e){fail(e.message);}}}return;
    }
    const maxAge=capture?1000:250;
    if(lastReceived-data.timestamp>maxAge||data.timestamp<=lastSample){if(capture){recordObservation(null,lastReceived,'stale-frame');report('Camera is running slowly. Waiting for a clear sample…');}else desktop?.heartbeat(false);return;}
    lastSample=data.timestamp;lastHeadFeature=data.head||data.feature||null;lastEyeFeature=data.feature;
    sample(data.feature,data.timestamp,lastHeadFeature);
   }
  };
  worker.postMessage({type:'init',trackingMode:$('tracking-mode').value,eyeRegions});report('Loading eye tracking locally…');frame(current);
 }catch(e){fail(e.name==='NotAllowedError'?'Camera permission was denied. Allow the camera, then try again.':e.name==='OverconstrainedError'?'The selected camera cannot provide this resolution. Choose 1080p or another camera.':e.name==='NotReadableError'?'The camera is busy. Close Camera/EMEET preview and try again.':e.message);}
}
async function startAligned(mode){
    const saved=loadSaved();
    if((mode==='positions'||mode==='adjust'||mode==='eye-only'||mode==='refine'||mode==='test'||mode==='find')&&(!saved||!validModel(saved.model)||!sameSetup(saved.setup,sessionSetup)))
     throw Error('The saved map uses a different camera or screen setup. Restore that setup to use this map, or choose New calibration.');
    if(mode!=='train'&&saved&&validModel(saved.model)&&sameSetup(saved.setup,sessionSetup)){
     model=saved.model;validation=saved.validation;
     headPositions=savedHeadPositions(saved);positionId=headPositions.some(e=>e.id===saved.activePositionId)?saved.activePositionId:headPositions[0].id;headSelector.reset();
     if(mode==='find'){
      const measured=headPositions.find(e=>e.id===positionId&&e.validation?.passed)||headPositions.find(e=>e.validation?.passed);
      if(measured){positionId=measured.id;model=measured.model;validation=measured.validation;await run(activate);}
      else await previewGaze();
      openReturnGuide();
     }
     else if(mode==='positions')await openHeadPositions();
     else if(mode==='adjust'||mode==='eye-only'||mode==='refine')beginCapture(mode==='refine'?'refine':'adjust',mode==='eye-only');
     else if(mode==='test')await run(()=>activate(true));
     else if(mode==='resume'&&validation?.passed){await saveModel(false);await run(activate);}
     else beginCapture('check');
    }else beginCapture('train');

}
function stopCamera(){clearTimeout(cameraPreviewTimer);cameraPreviewTimer=null;zoomQueue=null;document.body.classList.remove('camera-preview');$('camera-settings').hidden=true;resetReturnGuide();lastHeadFeature=null;lastEyeFeature=null;returnRelease=false;positionSession=null;headSelector.reset();$('positions-dialog').close();generation++;ready=false;inFlight=false;lastVideo=-1;lastSample=0;lastReceived=0;lastFrame=0;sessionSetup=null;clearTimeout(resizeTimer);resizeTimer=null;pointRetry=null;waitingMode=null;worker?.terminate();worker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;setCameraPreview(false);$('tracking-info').hidden=true;}
function frame(current){
 if(current!==generation)return;
 const now=performance.now();
 if((ready||stage==='camera-preview')&&!inFlight&&now-lastFrame>=33&&$('video').readyState>=2&&$('video').currentTime!==lastVideo){
  inFlight=true;lastFrame=now;lastVideo=$('video').currentTime;
  const c=cameraCrop($('video').videoWidth,$('video').videoHeight,frameCrop);
  createImageBitmap($('video'),c.x,c.y,c.width,c.height).then(bitmap=>{if(current!==generation){bitmap.close();return;}paintCameraFrame(bitmap);if(stage==='camera-preview'&&(!isEyeCrop()||!ready)){bitmap.close();inFlight=false;return;}worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);}).catch(()=>{inFlight=false;});
 }
 // Keep capture running while the native overlay briefly hides or loses focus.
 setTimeout(()=>frame(current),ready?Math.max(4,34-(performance.now()-lastFrame)):34);
}
function setCameraPreview(visible){$('camera').hidden=!stream;$('camera').classList.toggle('preview-hidden',!visible);}
function drawEyes(eyes,width=$('video').videoWidth||640,height=$('video').videoHeight||480){
 // Video and overlay share object-fit:contain and centered letterboxing.
 drawEyeOverlay($('eyes'),eyes,width,height);
}
function beginCapture(kind,eyeOnly=false,singleCheck=false){
 resultReport='';
 const bankCheck=kind==='check'&&!singleCheck&&!positionSession&&headPositions.length>1;
 if(kind==='train'){headPositions=[];positionId=1;positionSession=null;$('positions-dialog').close();}
 headSelector.reset();
 hideComposer();$('more-controls').hidden=true;
 clearTestMode();$('test-result').hidden=true;$('result-positions').hidden=true;
 const previousCheck=['adjust','refine','offset'].includes(kind)&&validation?{meanPixels:validation.meanPixels,p90Pixels:validation.p90Pixels,validFraction:validation.validFraction}:null;
 pause(false);uiRevision++;pointRetry=null;validation=null;stage=kind;alignmentError='';const targets=kind==='train'?calibrationTargets($('calibration-mode').value==='detailed'):kind==='adjust'?ALIGN_TARGETS:kind==='refine'?REFINE_TARGETS:kind==='offset'?[[.5,.5]]:CHECK_TARGETS;capture={kind,eyeOnly,bankCheck,previousCheck,targets,index:0,pending:targets.slice(1).map((_,i)=>i+1),groups:[],samples:[],started:performance.now(),validMs:0,last:null,noticeAt:0};
 $('workspace').classList.remove('previewing');$('accuracy-preview').hidden=true;$('preview-check').hidden=true;
 $('workspace').classList.add('calibrating');
 sizeControls();
 $('tiles').hidden=true;$('snapshot').hidden=true;$('practice-scene').hidden=true;$('cal-dot').hidden=false;$('cal-message').hidden=true;$('gaze').hidden=true;setCameraPreview(false);$('tracking-info').hidden=true;$('retry-point').hidden=true;
 $('hint').textContent='Look at the dot until it moves. Blinking is okay.';
 $('mode-label').textContent=kind==='train'?'Calibration':kind==='adjust'?'Alignment':kind==='refine'?'Refine accuracy':kind==='offset'?'Quick alignment':'Accuracy check';nextPoint();
}
function nextPoint(retry=false){
 capture.samples=[];capture.sampleTimes=[];capture.observations=[];capture.started=performance.now();capture.validMs=0;capture.last=null;capture.noticeAt=0;
 if(!retry)capture.retries=0;
 const [x,y]=capture.targets[capture.index];$('cal-dot').style.left=x*100+'%';$('cal-dot').style.top=y*100+'%';
 $('camera').style.left=x<.5?'auto':'20px';$('camera').style.right=x<.5?'20px':'auto';$('camera').style.top=y>.5?'100px':'auto';$('camera').style.bottom=y>.5?'auto':'110px';
 report(`${retry?'Let’s measure this point again. ':''}Look at the purple dot. ${capture.kind==='train'?'Point':capture.kind==='adjust'?'Alignment':capture.kind==='refine'?'Refinement':'Check'} ${capture.index+1} of ${capture.targets.length}.`);$('progress').value=0;
}
function recordObservation(feature,now,reason=lastFrameReason){
 if(!capture||now-capture.started<900)return;
 capture.observations.push({feature,now,reason});capture.observations=capture.observations.filter(o=>now-o.now<=4000);
}
async function collect(f,now){
 if(!capture)return;
 if(now-capture.started>20000){showPointHelp(lastQuality);return;}
 if(now-capture.started<900)return;
 recordObservation(f,now);
 if(!f){if(capture.last!==null&&now-capture.last>1000){capture.samples=[];capture.sampleTimes=[];capture.validMs=0;capture.last=null;}return;}
 // Short blinks pause accumulation. They do not erase an entire point.
 if(capture.last!==null&&now-capture.last<=500)capture.validMs+=Math.min(100,now-capture.last);
 else if(capture.last!==null&&now-capture.last>1000){capture.samples=[];capture.sampleTimes=[];capture.validMs=0;}
 capture.last=now;capture.samples.push(f);capture.sampleTimes.push(now);
 // A slow camera needs extra frames: sixteen collected frames can become fewer
 // than sixteen usable frames after removing even one outlier. Keep collecting.
 while(capture.sampleTimes.length&&now-capture.sampleTimes[0]>4000){capture.sampleTimes.shift();capture.samples.shift();}
 $('progress').value=Math.min(1,capture.validMs/1500,capture.samples.length/24);
 if(capture.validMs<1500||capture.samples.length<24)return;
 if(capture.kind!=='check')try{settledSummary(capture.samples);}catch(e){if(now-capture.noticeAt>1000){capture.noticeAt=now;report(`Point ${capture.index+1}: waiting for a settled gaze. Blinking is okay.`);}return;}
 const trackingLoss={};for(const o of capture.observations)if(!o.feature)trackingLoss[o.reason]=(trackingLoss[o.reason]||0)+1;
 capture.groups[capture.index]={target:capture.targets[capture.index],samples:capture.kind==='check'?capture.observations.map(o=>o.feature):capture.samples,trackingLoss};
 if(capture.pending.length){capture.index=capture.pending.shift();nextPoint();return;}
 const done=capture,revision=uiRevision;capture=null;$('cal-dot').hidden=true;
 stage='fitting';report(done.kind==='train'?'All points collected. Checking the screen map…':'Checking accuracy…');
 try{
  if(['train','adjust','refine','offset'].includes(done.kind)){
   // Let the progress message paint before fitting the local numerical model.
   await new Promise(resolve=>setTimeout(resolve,30));if(revision!==uiRevision)return;
   model=done.kind==='train'?fitCalibration(done.groups):done.kind==='refine'?fitRefinement(done.groups,model):done.kind==='offset'?fitOffset(done.groups[0].samples,model):fitAlignment(done.groups,model,{eyeOnly:done.eyeOnly});
   if(['adjust','refine'].includes(done.kind)&&done.previousCheck)model.repairComparison.previousCheck=done.previousCheck;
   if(!positionSession?.pending)await saveModel();if(revision!==uiRevision)return;beginCapture('check',false,true);return;
  }
  validation=validateCalibration(done.groups,model,innerWidth,innerHeight,done.bankCheck?{predictor:f=>estimateHeadPositions(f,headPositions)}:{});
  if(cameraStats)validation.camera={...cameraStats};
  if(positionSession?.pending){await finishHeadPosition();return;}
  $('result-dialog').style.setProperty('--result-target-height','115px');
  $('result-title').textContent=validation.passed?'Ready':'Alignment needed';
  const errorText=Number.isFinite(validation.meanPixels)?`Average mapping error: ${validation.meanPixels} pixels; 90% within ${validation.p90Pixels} pixels; largest ${validation.worstPixels} pixels. This includes estimates outside the screen and estimates rejected for head position.`:'No finite gaze positions were available to measure error.';
  const mappingText=done.bankCheck?'Combined saved-position map. These independent checks did not change any saved calibration.':model.offset?'Mapping with a fresh one-point offset correction.':model.refinement?'Mapping with regional error correction.':model.alignment?.rebuilt?`Eye-only map rebuilt from ${model.repairComparison?.anchorCount||5} fresh reference points.`:model.version===4?'Separate-eye mapping'+(model.featureIndices.some(i=>i>=4)?' with head-position features.':'.'):model.poseCorrection?'Mapping with learned head-motion correction.':'Combined-eye mapping selected by held-out target accuracy.';
  const driftText=model.centerRepeatCount>1?` ${model.repairComparison?'Previous full-calibration center drift':'Repeated-center drift'}: ${Math.round(Math.hypot((model.centerDriftX||0)*innerWidth,(model.centerDriftY||0)*innerHeight))} pixels.`:'';
  const before=model.repairComparison?.previousCheck;
  const comparisonText=before&&Number.isFinite(before.meanPixels)&&Number.isFinite(before.p90Pixels)?` Before this repair: average ${before.meanPixels} pixels; 90% within ${before.p90Pixels} pixels. `:'';
  $('result-copy').textContent=`${errorText} ${Math.round(validation.estimatedFraction*100)}% of frames produced an estimate; ${Math.round(validation.validFraction*100)}% were usable for control. ${mappingText}${driftText} ${cameraStats?`Camera: ${cameraStats.width} × ${cameraStats.height}, ${cameraStats.fps} tracking fps, ${cameraStats.processingMs} ms processing. `:''}${validation.passed?'The accuracy check passed.':'Your calibration is saved. Adjust alignment compares a correction of this map with a simpler eye-only repair using five new reference points, then runs a fresh accuracy check. Refine accuracy uses nine new anchors to compare regional corrections, then a fresh check. You can also test the pointer. No clicks are enabled yet.'}`;
  $('result-copy').textContent+=comparisonText+(!validation.passed&&model.poseCorrection?' Try eye-only repair to compare a new five-point map without head-motion correction.':'');
  resultReport=$('result-copy').textContent;
  $('result-copy').textContent=Number.isFinite(validation.meanPixels)?`Average ${validation.meanPixels} px · 90% within ${validation.p90Pixels} px`:'Gaze could not be measured.';
  const sides=validation.horizontalSummary;$('result-sides').textContent=sides?`Left / right Â· average per-target 90% error: ${sides.left.p90Pixels??'unavailable'} / ${sides.right.p90Pixels??'unavailable'} px Â· usable ${sides.left.usable}% / ${sides.right.usable}%.`:'';
  $('result-details').replaceChildren(...validation.perTarget.map((p,i)=>{
   const li=document.createElement('li'),reasons=Object.entries(p.rejected).map(([k,n])=>`${n} ${REJECTION[k]||k}`).join(', '),loss=Object.entries(p.trackingLoss).map(([k,n])=>`${n} ${(QUALITY[k]||k).replace(/[.]+$/,'')}`).join(', '),head=Object.entries(p.headRejections||{}).map(([k,n])=>`${n} ${HEAD_REASON[k]||k}`).join(', ');
   li.textContent=`Check ${i+1}: ${Number.isFinite(p.p90Pixels)?p.p90Pixels+' px':'unavailable'} (90% mapping error), ${Math.round(p.validFraction*100)}% usable. ${Number.isFinite(p.jitterPixels)?`Scatter: ${p.jitterPixels} px. `:''}${Number.isFinite(p.offsetX)&&Number.isFinite(p.offsetY)?`Median: ${Math.abs(p.offsetX)} px ${p.offsetX<0?'left':'right'}, ${Math.abs(p.offsetY)} px ${p.offsetY<0?'up':'down'}. `:''}${reasons?`Rejected: ${reasons}. `:''}${head?`Head limits exceeded: ${head}. `:''}${Number.isFinite(p.headCorrectionP90Pixels)?`Head correction changed the estimate by up to ${p.headCorrectionP90Pixels} px for 90% of estimated frames (contribution, not error). `:''}${loss?`Camera: ${loss}.`:''}`;return li;
  }));
  if(!done.bankCheck)await saveModel();if(revision!==uiRevision)return;
  if(validation.passed){await run(activate);if(active)report('Eye control is on. '+saveNotice);return;}
  $('preview').hidden=false;$('refine-result').hidden=done.bankCheck;$('adjust').hidden=done.bankCheck;$('eye-only-result').hidden=done.bankCheck;$('result-positions').hidden=!done.bankCheck;$('test-result').hidden=false;$('retry-check').hidden=false;$('continue').hidden=false;$('continue').textContent='Open controls (eyes paused)';$('copy-report-status').textContent='';
  stage='result';$('result-dialog').showModal();
 }catch(e){
  if(revision!==uiRevision)return;
  if(positionSession?.pending){restorePositionBackup();positionSession.pending=null;showHeadPositions('This position could not be fitted. Your saved positions are unchanged. '+e.message);return;}
  if(done.kind==='train')showFitHelp(done,e);
  else if(['adjust','refine','offset'].includes(done.kind)){
   alignmentError=e.message;stage='result';$('result-title').textContent=done.kind==='refine'?'Refinement could not be applied':'Alignment could not be applied';$('result-copy').textContent=e.message+' Your previous map is kept. No clicks are enabled.';$('result-details').replaceChildren();$('refine-result').hidden=false;$('adjust').hidden=false;$('eye-only-result').hidden=false;$('preview').hidden=false;$('test-result').hidden=!validModel(model);$('retry-check').hidden=false;$('continue').textContent='Open controls (eyes paused)';$('copy-report-status').textContent='';$('result-dialog').showModal();
  }else{capture=done;capture.index=0;capture.pending=done.targets.slice(1).map((_,i)=>i+1);showPointHelp(e.message);}
 }
}
function showFitHelp(done,error){
 stage='fit-help';active=false;model=null;validation=null;
 $('mode-label').textContent='Calibration review';setCameraPreview(false);$('tracking-info').hidden=true;
 $('result-title').textContent='Measurements collected — a gaze map could not be built';
 $('result-copy').textContent=error.message+' No screen clicks are enabled. Check the camera position and lighting before choosing a new calibration.';
 $('result-details').replaceChildren(...done.groups.map((g,i)=>{const li=document.createElement('li');li.textContent=`Point ${i+1}: ${g.samples.length} samples collected`;return li;}));
 $('preview').hidden=true;$('adjust').hidden=true;$('eye-only-result').hidden=true;$('refine-result').hidden=true;$('test-result').hidden=true;$('copy-report-status').textContent='';
 $('retry-check').hidden=true;$('continue').hidden=false;$('continue').textContent='Open controls (eyes paused)';
 $('result-dialog').showModal();report('The measurements could not produce a gaze map. No automatic retries.');
}
function showPointHelp(message){
 if(!capture)return;
 pointRetry=capture;capture=null;stage='point-help';$('cal-dot').hidden=true;$('retry-point').hidden=false;
 setCameraPreview(true);$('tracking-info').hidden=false;
 $('cal-message').textContent=message+' Completed points are kept. Adjust your position, then choose Retry this point.';$('cal-message').hidden=false;report('Calibration paused at this point. '+message);
}
function renderPointer(view){
 const gaze=$('gaze'),p=view.point;gaze.hidden=!p;
 gaze.classList.toggle('tracking-rejected',!view.usable);gaze.classList.toggle('offscreen-estimate',!!view.clipped);
 if(!p)return;
 gaze.style.left=(view.usable?p.x*innerWidth:Math.max(16,Math.min(innerWidth-16,p.x*innerWidth)))+'px';
 gaze.style.top=(view.usable?p.y*innerHeight:Math.max(16,Math.min(innerHeight-16,p.y*innerHeight)))+'px';
 const envelope=layoutValidation(),margin=selectionMargin(envelope,innerWidth,innerHeight);
 gaze.style.setProperty('--error-opacity',view.usable&&Number.isFinite(envelope?.radiusX)&&Number.isFinite(envelope?.radiusY)?'1':'0');
 gaze.style.setProperty('--error-width',margin.x*2+'px');gaze.style.setProperty('--error-height',margin.y*2+'px');
}
function sample(f,now,head=f){
 if(capture){collect(f,now);return;}
 if(positionSession){updateHeadGuide(f,now,head);return;}
 let prediction;
 if((active||stage==='preview')&&headPositions.length){
  const match=headSelector.update(f,headPositions,now,{allowUnverified:testing||(stage==='preview'&&previewUnverified)});
  if(match.entry){
   if(match.switched){pointer.reset();fixation.reset();intent.reset();resetDwellForPosition(dwell);clearHighlight();desktop?.heartbeat(false);}
   positionId=match.entry.id;model=match.entry.model;validation=match.entry.validation;
   headEstimate={weights:match.weights,residual:match.residual,interpolated:match.interpolated,compensated:!!match.compensated,heldOutError:match.compensationError??null,heldOutPositionError:match.positionError??null};
   const ids=match.weights.filter(w=>w.weight>.01).map(w=>w.id).sort((a,b)=>a-b).join(' + ');
   headStatus(match.compensated?`Learned head correction · ${headPositions.length} saved`:match.interpolated?`Between positions ${ids}`:`Position ${positionId} · ${headPositions.length} saved`);
   prediction=match;
  }else{headEstimate=null;headStatus(match.reason==='head-reacquiring'?'Finding your saved position…':'Face the screen within your saved range');prediction={point:null,raw:null,reason:match.reason};}
 }else prediction=predictDetailed(f,model);
 if(!isEyeCrop()&&(active||stage==='preview')&&headPositions.length){
  const recovery=returnGuide.update(head,headPositions,now,{...returnOptions(),reason:prediction.reason,eyesReady:!!f,supported:!!headEstimate,auto:stage!=='paused'&&!busy&&(!reading||!!head)});
  if(recovery.visible){
   renderReturnGuide(recovery,head);intent.reset();resetDwellForPosition(dwell);fixation.reset();clearHighlight();$('gaze').hidden=true;$('wake-progress').value=0;desktop?.heartbeat(false);return;
  }
 }
 const raw=prediction.point,view=pointer.update(prediction,now,{width:innerWidth,height:innerHeight}),p=view.point,steady=fixation.update(raw,now,layoutValidation());
 recordTracking(prediction,view,now);
 if(reading){
  $('gaze').hidden=true;desktop?.heartbeat(false);
  const button=$('wake-pointer'),bounds=button.getBoundingClientRect();
  const hit=q=>containedTarget(q,bounds,innerWidth,innerHeight,{x:12,y:12});
  const target=view.usable&&hit(p)&&hit(raw)?'wake-pointer':null;
  const near=nearTarget(raw,button.getBoundingClientRect(),innerWidth,innerHeight)&&nearTarget(p,button.getBoundingClientRect(),innerWidth,innerHeight);
  const fired=selectionDwell(target,steady,view,now,near);
  $('wake-progress').value=dwell.progress;button.classList.toggle('gaze-active',intent.target==='wake-pointer');
  if(fired!==null)run(exitReading);
  return;
 }
 $('focus-target').hidden=true;
 if(stage==='preview'||selectionsPaused)renderPointer(view);else $('gaze').hidden=true;
 if(desktop&&active&&now-lastHeartbeat>80){lastHeartbeat=now;desktop.heartbeat(view.usable&&!selectionsPaused);}
 if(!view.usable){
  selectionDwell(null,false,view,now);$('progress').value=dwell.progress;desktop?.heartbeat(false);
  if(active||stage==='preview'){
   report(view.recovering?'Tracking settling…':`Selection paused · ${REJECTION[prediction.reason]||lastQuality}`);
  }
  return;
 }
 if(returnRelease&&!reading&&active){
  returnRelease=false;const radius=Math.max(35,Math.min(70,innerWidth*.04)),x=p.x*innerWidth,y=p.y*innerHeight;
  wakeRelease={left:x-radius,right:x+radius,top:y-radius,bottom:y+radius,width:radius*2,height:radius*2};wakeReleaseAt=null;
 }
 if(stage==='preview'){
  desktop?.heartbeat(false);report(`Pointer test · ${Math.round(p.x*innerWidth)}, ${Math.round(p.y*innerHeight)} px`);return;
 }
 if(stage==='result'&&validation?.passed){
  const buttons=[$('continue'),$('retry'),$('exit-setup')],target=buttons.findIndex(b=>inside(b,p)&&inside(b,raw));
  const fired=selectionDwell(target<0?null:target,steady,view,now);if(fired!==null)buttons[fired].click();return;
 }
 // Sending an action can pause selection briefly without erasing the pointer.
 if(!active||busy){intent.reset();dwell.update(null,now);clearHighlight();return;}
 if(wakeRelease){
  if(nearTarget(raw,wakeRelease,innerWidth,innerHeight)||nearTarget(p,wakeRelease,innerWidth,innerHeight))wakeReleaseAt=null;
  else wakeReleaseAt??=now;
  if(wakeReleaseAt===null||now-wakeReleaseAt<150){intent.reset();dwell.reset();clearHighlight();return;}
  wakeRelease=null;wakeReleaseAt=null;
 }
 if(selectionsPaused){
  // Same controls, camera, map and pointer state; only selection is paused.
  const target=inside($('pointer-test'),p)&&inside($('pointer-test'),raw)?'resume-selections':null;
  const fired=selectionDwell(target,steady,view,now);$('progress').value=dwell.progress;
  $('pointer-test').classList.toggle('gaze-active',!!target);
  report('Pointer test · selections paused');
  if(fired!==null)toggleSelections();return;
 }
 if(now<blockedUntil)return;
 const targets=[...$('tiles').children,...composerButtons.map($),$('more-controls'),$('pointer-test'),$('pause'),$('cancel'),$('read-mode'),$('head-status')];
 const eligible=b=>inside(b,p)&&inside(b,raw);
 const toolbar=targets.findIndex((b,i)=>i>=items.length&&eligible(b));
 const direct=toolbar>=0?toolbar:targets.findIndex(eligible);
 const target=direct>=0?direct:contextTarget(raw,p,targets.map(b=>!b.hidden&&!b.disabled&&b.getClientRects().length?b.getBoundingClientRect():null),innerWidth,innerHeight,hitMargin());
 const button=targets[target],action=target<items.length?items[target]:button?entry(button.textContent,()=>button.click()):null;
 const previous=Number.isInteger(intent.target)?targets[intent.target]:null;
 const near=previous&&nearTarget(raw,previous.getBoundingClientRect(),innerWidth,innerHeight)&&nearTarget(p,previous.getBoundingClientRect(),innerWidth,innerHeight);
 if(stage==='browse'&&target<0){selectPageTarget(raw,p,steady,view,now);return;}
 $('focus-target').hidden=true;
 const fired=selectionDwell(target<0?null:target,steady,view,now,near);$('progress').value=dwell.progress;
 targets.forEach((b,i)=>b.classList.toggle('gaze-active',i===intent.target));
 report(target>=0?`${action.label} · ${Math.max(0,(1-dwell.progress)*dwell.ms/1000).toFixed(1)} s`:dwell.progress>0?'Holding your selection…':'Look at a button');
 if(fired!==null){if(target<items.length)run(action.action);else button.click();}
}
function selectionDwell(target,steady,view,now,nearCurrent=false){
 const selection=intent.update(target,now,{valid:view.usable,nearCurrent});
 if(selection.target===null)return dwell.update(null,now);
 return selection.confirmed&&(steady||selection.confident)?dwell.update(selection.target,now):dwell.suspend(selection.target,now);
}
function inside(button,p){return !!button&&!button.hidden&&!button.disabled&&button.getClientRects().length>0&&containedTarget(p,button.getBoundingClientRect(),innerWidth,innerHeight,hitMargin());}
function clearHighlight(){document.querySelectorAll('.gaze-active').forEach(b=>b.classList.remove('gaze-active'));$('progress').value=0;$('focus-target').hidden=true;}
function updateSelectionMode(){
 $('head-status').disabled=!stream||!validModel(model)||!!capture;
 $('read-mode').hidden=!active||stage==='paused';
 $('pointer-test').hidden=!active||stage==='paused';$('pointer-test').textContent=selectionsPaused?'Enable selections':'Pointer test';
 $('pointer-test').setAttribute('aria-pressed',String(selectionsPaused));$('copy-tracking').hidden=!selectionsPaused;
}
function resetReading(){
 if(reading)$('practice-scene').hidden=readingPracticeHidden;
 reading=false;wakeRelease=null;wakeReleaseAt=null;document.body.classList.remove('reading');
 $('wake-pointer').hidden=true;$('wake-pointer').classList.remove('gaze-active');$('wake-progress').value=0;
}
async function enterReading(){
 if(!active||!canControl()||capture||positionSession||reading||stage==='paused')return;
 resetReturnGuide();
 const revision=++uiRevision;
 readingPracticeHidden=$('practice-scene').hidden;reading=true;selectionsPaused=false;
 intent.reset();dwell.reset();fixation.reset();clearHighlight();$('gaze').hidden=true;
 const margin=selectionMargin(layoutValidation()||validation,innerWidth,innerHeight),button=$('wake-pointer');
 button.style.setProperty('--wake-width',Math.min(innerWidth-36,Math.max(220,innerWidth*.4),Math.max(220,margin.x*2+90))+'px');
 button.style.setProperty('--wake-height',Math.min(innerHeight-36,Math.max(100,innerHeight*.25),Math.max(100,margin.y*2+60))+'px');
 button.style.top=readingDock.startsWith('top')?'18px':'auto';button.style.bottom=readingDock.startsWith('bottom')?'18px':'auto';
 button.style.left=readingDock.endsWith('left')?'18px':'auto';button.style.right=readingDock.endsWith('right')?'18px':'auto';
 button.hidden=false;button.disabled=true;document.body.classList.add('reading');
 if(!desktop)$('practice-scene').hidden=false;
 if(desktop)await desktop.readingMode(true);
 if(revision!==uiRevision)return;
 button.disabled=false;lastHeartbeat=0;
}
async function exitReading(){
 if(!reading||!active||!canControl())return;
 const revision=++uiRevision,bounds=$('wake-pointer').getBoundingClientRect();
 $('wake-pointer').disabled=true;
 if(desktop){await desktop.readingMode(false);if(revision!==uiRevision)return;await desktop.arm();}
 if(revision!==uiRevision)return;
 resetReading();wakeRelease={left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,width:bounds.width,height:bounds.height};
 pointer.reset();fixation.reset();intent.reset();dwell.reset();blockedUntil=performance.now()+200;lastHeartbeat=0;
 updateSelectionMode();report('Look at a control');
}
function toggleSelections(){
 if(!active||capture||stage==='paused')return;
 selectionsPaused=!selectionsPaused;intent.reset();dwell.reset();fixation.reset();clearHighlight();desktop?.heartbeat(false);lastHeartbeat=0;
 dwell.locked=selectionsPaused?'resume-selections':items.length+composerButtons.length+1;
 blockedUntil=performance.now()+200;updateSelectionMode();sizeControls();
}
function recordTracking(prediction,view,now){
 if(!(active||stage==='preview'))return;
 const mode=reading?'reading':stage==='preview'?'pointer-preview':selectionsPaused?'controls-pointer-test':'controls';
 const records=trackingRuns.get(mode)||[];
 records.push({at:now,raw:prediction.raw,display:view.point?{...view.point}:null,fixating:!!view.fixating,excursionHeld:!!view.excursionHeld,relocated:!!view.relocated,usable:view.usable,reason:prediction.reason,recovering:!!view.recovering,stage});
 trackingRuns.set(mode,records.filter(r=>now-r.at<=15000).slice(-600));
}
function trackingReport(){
 const stamp=JSON.stringify(model);let hash=2166136261;for(let i=0;i<stamp.length;i++)hash=Math.imul(hash^stamp.charCodeAt(i),16777619);
 return {version:'0.4.11',filter:{movementConfirmationMs:120,maximumInTargetPauseMs:300,medianWindowMs:150,selectionHoldMs:600,intentWindowMs:240},headEstimate,activePositionId:positionId,savedHeadPositions:headPositions.length,mapId:(hash>>>0).toString(16),camera:cameraStats,viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},
  note:'Local session diagnostics. Movement between frames includes intentional eye movement; these are not target accuracy results. These are pointer stability measurements, not identified microsaccades or proof of gaze accuracy. No images, typed text, profile name, or raw eye features included.',
  runs:Object.fromEntries([...trackingRuns].map(([mode,rows])=>{
   const r=rows.filter(x=>performance.now()-x.at<=120000),rejected={};for(const x of r)if(!x.usable){const k=x.recovering?'recovering':x.reason;rejected[k]=(rejected[k]||0)+1;}
   const steps=r.slice(1).flatMap((x,i)=>x.raw&&r[i].raw&&x.at-r[i].at<250?[Math.hypot((x.raw.x-r[i].raw.x)*innerWidth,(x.raw.y-r[i].raw.y)*innerHeight)]:[]);
   const displayed=r.slice(1).flatMap((x,i)=>x.usable&&r[i].usable&&x.display&&r[i].display&&x.at-r[i].at<250?[Math.hypot((x.display.x-r[i].display.x)*innerWidth,(x.display.y-r[i].display.y)*innerHeight)]:[]);
   return [mode,{samples:r.length,trackingFps:r.length>1?Math.round((r.length-1)*1000/(r.at(-1).at-r[0].at)):0,usablePercent:r.length?Math.round(r.filter(x=>x.usable).length/r.length*100):null,rejected,rawStepP90Pixels:steps.length?Math.round(quantile(steps,.9)):null,displayStepP90Pixels:displayed.length?Math.round(quantile(displayed,.9)):null,fixationHoldPercent:r.length?Math.round(r.filter(x=>x.usable&&x.fixating).length/r.length*100):null,briefExcursionHoldFrames:r.filter(x=>x.excursionHeld).length,confirmedRelocations:r.filter(x=>x.relocated).length,rawStepRmsPixels:steps.length?Math.round(Math.sqrt(steps.reduce((s,v)=>s+v*v,0)/steps.length)*10)/10:null,displayStepRmsPixels:displayed.length?Math.round(Math.sqrt(displayed.reduce((s,v)=>s+v*v,0)/displayed.length)*10)/10:null}];
  }))};
}
async function copyTrackingReport(){try{await navigator.clipboard.writeText(JSON.stringify(trackingReport(),null,2));report('Tracking report copied. No images or typed text are included.');}catch{report('Could not copy the tracking report.');}}
function clearPageTargets(){focusTargets=[];focusScope=null;focusAt=0;focusRevision++;$('focus-target').hidden=true;}
async function refreshPageTargets(){
 if(stage!=='browse'||reading||!active||busy||focusQuery)return;
 focusQuery=true;const revision=focusRevision;
 try{
  let result;
  if(desktop?.focusTargets){result=await desktop.focusTargets(focusRebind);focusRebind=false;}
  else if(!desktop){
   result={scope:'practice',targets:[...document.querySelectorAll('[data-practice-action]')].map(b=>({id:b.dataset.practiceAction,label:b.getAttribute('aria-label')||b.textContent,kind:b.tagName==='INPUT'?'Edit':'Button',rect:b.getBoundingClientRect(),enabled:!b.disabled}))};
  }else result={scope:null,targets:[]};
  if(stage!=='browse'||reading||revision!==focusRevision)return;
  const dock=$('tiles').getBoundingClientRect(),top=document.querySelector('.statusbar').getBoundingClientRect().bottom+8;
  focusTargets=visibleFocusTargets(result.targets||[],innerWidth,innerHeight,{top,bottom:innerHeight-dock.top+8});focusScope=result.scope;focusAt=performance.now();
  $('hint').textContent=focusTargets.length?'Look near a link, button or text box. Hold its highlight to select.':'No shared controls. Use region click, or choose another app.';
 }catch{
  if(revision===focusRevision){focusTargets=[];focusAt=0;$('focus-target').hidden=true;$('hint').textContent='App controls unavailable. Use region click, or choose another app.';}
 }finally{focusQuery=false;}
}
function selectPageTarget(raw,p,steady,view,now){
 const margin=selectionMargin(layoutValidation(),innerWidth,innerHeight);
 const found=now-focusAt<=2600?focusTarget(raw,p,focusTargets,innerWidth,innerHeight,{radiusX:Math.max(40,Math.min(110,margin.x)),radiusY:Math.max(32,Math.min(82,margin.y))}):null;
 const key=found?'page:'+found.id:null;
 const prior=typeof intent.target==='string'&&intent.target.startsWith('page:')?focusTargets.find(t=>'page:'+t.id===intent.target):null;
 const near=prior&&nearTarget(raw,{...prior.rect,width:prior.rect.right-prior.rect.left,height:prior.rect.bottom-prior.rect.top},innerWidth,innerHeight);
 const fired=selectionDwell(key,steady,view,now,near);$('progress').value=dwell.progress;
 document.querySelectorAll('.gaze-active').forEach(b=>b.classList.remove('gaze-active'));
 if(found){
  const box=$('focus-target'),r=found.rect;box.hidden=false;box.style.left=r.left+'px';box.style.top=r.top+'px';box.style.width=(r.right-r.left)+'px';box.style.height=(r.bottom-r.top)+'px';
  box.querySelector('span').textContent=found.label||found.kind;
  report((found.label||found.kind)+' · '+Math.max(0,(1-dwell.progress)*dwell.ms/1000).toFixed(1)+' s');
 }else report(focusTargets.length?'Look near a link or button':'Looking for app controls…');
 if(fired===key&&found)run(async()=>{
  try{
   let result;
   if(desktop)result=await desktop.activateTarget(focusScope,found.id,found.rect);
   else{
    const element=[...document.querySelectorAll('[data-practice-action]')].find(b=>b.dataset.practiceAction===found.id);
    if(!element)return;element.focus();if(found.kind!=='Edit'){element.click();$('practice-selection').textContent='Opened '+found.label;}
    result={edit:found.kind==='Edit'};
   }
   // Hold the acquisition area, including a near miss in adjacent blank
   // space, until a deliberate look away. A changed page must not chain-click.
   const x=raw.x*innerWidth,y=raw.y*innerHeight;
   wakeRelease={left:x-36,right:x+36,top:y-28,bottom:y+28,width:72,height:56};wakeReleaseAt=null;
   clearPageTargets();if(result.edit)compose('app');else{blockedUntil=performance.now()+300;setTimeout(refreshPageTargets,350);}
  }catch{clearPageTargets();blockedUntil=performance.now()+300;report('That control changed. Look again.');setTimeout(refreshPageTargets,350);}
 });
}
setInterval(refreshPageTargets,1200);
function sizeControls(){
 if(!$('composer').hidden){
  $('workspace').style.setProperty('--control-footer','52px');
  $('workspace').style.setProperty('--control-cancelWidth','90px');
  syncTypingRegion();return;
 }
 const compact=$('tiles').matches('.keyboard,.navigation,.compact-menu');
 const g=compact?{top:innerHeight<=550?74:90,bottom:82,footer:72,cancelWidth:100}:controlGeometry(innerWidth,innerHeight,layoutValidation());
 g.top=Math.max(g.top,document.querySelector('.statusbar').getBoundingClientRect().bottom+12);
 $('composer').style.top=g.top+'px';
 $('workspace').style.setProperty('--compose-button-height',(compact?48:Math.max(72,Math.ceil(hitMargin().y*2+30)))+'px');
 if(!$('composer').hidden)g.top=$('composer').getBoundingClientRect().bottom+12;
 for(const [name,value] of Object.entries(g))$('workspace').style.setProperty('--control-'+name,value+'px');
}
function compactMenuLayout(count){
 const columns=count<=4?2:Math.max(2,Math.min(4,Math.floor((innerWidth-56)/190)));
 const top=parseFloat($('workspace').style.getPropertyValue('--control-top'))||90;
 const rowHeight=innerHeight<=550?56:64,gap=8,padding=24;
 const available=innerHeight-top-82;
 const maxRows=Math.max(1,Math.floor((available-padding+gap)/(rowHeight+gap)));
 const rows=Math.min(Math.ceil(count/columns),maxRows);
 $('tiles').style.setProperty('--menu-height',(rows*rowHeight+(rows-1)*gap+padding)+'px');
 $('tiles').style.setProperty('--menu-width',(columns*210+(columns-1)*gap+padding)+'px');
 return {columns,rows,capacity:columns*rows};
}
function tiles(label,entries,grid=false,page=0,options={}){
 const locked=dwell.locked;intent.reset();dwell.reset();dwell.locked=locked;blockedUntil=performance.now()+200;
 if(!grid&&label!=='Viewing screen'&&$('composer').hidden)$('practice-scene').hidden=true;
 const groupedKeys=!$('composer').hidden&&['keyboard','letters','symbols'].includes(stage);
 const compactMenu=!grid&&!options.kind&&!groupedKeys;
 $('tiles').classList.toggle('keyboard',options.kind==='keyboard');$('tiles').classList.toggle('navigation',options.kind==='navigation');$('tiles').classList.toggle('compact-menu',compactMenu);
 // Typing uses a bottom dock; task panels keep the existing screen layout.
 if(compactMenu)document.body.classList.toggle('viewing',$('composer').hidden&&stage!=='paused');
 $('focus-target').hidden=true;
 fixation.reset();sizeControls();layout=controlLayout();updateTestNotice();
 if(!grid&&(!$('composer').hidden||entries.length<=4))layout={columns:2,rows:2,capacity:4};
 if(options.columns&&options.rows)layout={columns:options.columns,rows:options.rows,capacity:options.columns*options.rows};
 if(compactMenu)layout=$('composer').hidden?compactMenuLayout(entries.length):{columns:innerWidth<700?2:3,rows:Math.ceil(entries.length/(innerWidth<700?2:3)),capacity:entries.length};
 $('more-controls').hidden=['train','check','adjust','refine','paused'].includes(stage);
 $('tiles').style.gridTemplateColumns=`repeat(${layout.columns},1fr)`;$('tiles').style.gridTemplateRows=`repeat(${layout.rows},1fr)`;
 const navigationSlots=layout.capacity>2?2:1,pageSize=Math.max(1,layout.capacity-navigationSlots);
 const pages=entries.length>layout.capacity?Math.ceil(entries.length/pageSize):1;
 if(!grid&&pages>1){const all=entries;entries=[...all.slice(page*pageSize,(page+1)*pageSize),...(navigationSlots===2?[entry('Previous page',()=>tiles(label,all,false,(page+pages-1)%pages,options))]:[]),entry('Next page',()=>tiles(label,all,false,(page+1)%pages,options))];}
 $('pause').textContent=active?'Pause':'Setup';items=entries;$('tiles').replaceChildren();$('tiles').hidden=false;$('tiles').classList.remove('view');$('tiles').classList.toggle('grid',grid);$('mode-label').textContent=label;
 for(const item of entries){const b=document.createElement('button'),s=document.createElement('span');s.textContent=item.label;b.append(s);b.onclick=()=>run(item.action);$('tiles').append(b);}
 $('tiles').style.setProperty('--typing-rows',layout.rows);$('tiles').style.setProperty('--typing-key-height',(layout.rows*44+Math.max(0,layout.rows-1)*6)+'px');
 if(!$('composer').hidden)requestAnimationFrame(syncTypingRegion);
 $('cancel').textContent='Back';$('typed').textContent='';$('hint').textContent=grid?`Choose the area containing the ${clickPurpose==='field'?'text box':'video or button'}. Zoom ${depth+1}. Back undoes one zoom.`:`${pages>1?'Page '+(page+1)+' of '+pages+' · ':''}Hold for 0.6 seconds. Look away after selection.`;
}
function entry(label,action,description=''){return {label,action,description};}
async function run(action){if(busy)return;busy=true;try{await action();}catch(e){await pause();report(e.message);}finally{busy=false;}}
async function command(payload){if(desktop)await desktop.command(payload);else{
 if(payload.type==='text')$('practice-text').value+=payload.text;
 if(payload.type==='key'&&payload.key==='backspace')$('practice-text').value=$('practice-text').value.slice(0,-1);
 report('Practice only: '+payload.type);
}}
function menu(){
 hideComposer();clickThen=null;
 $('workspace').classList.remove('previewing');$('accuracy-preview').hidden=true;$('preview-check').hidden=true;
 setCameraPreview(false);$('tracking-info').hidden=true;
 stage='menu';$('workspace').classList.remove('calibrating');$('cal-message').hidden=true;$('retry-point').hidden=true;document.body.classList.remove('viewing');snapshot=null;$('snapshot').hidden=true;$('practice-scene').hidden=!!desktop;
 tiles('Choose a task',[
  entry('Search YouTube',()=>compose('youtube'),'Write a search, then open the video results'),
  entry('Search Google',()=>compose('google'),'Write a search, then open the results'),
  entry('Type into a text box',()=>typeHelp(),'Choose a text box in your browser or another app'),
  entry('Browse & scroll',()=>browse(),'See your open app, scroll, or click a video')]);
}
function browse(){hideComposer();stage='browse';document.body.classList.add('viewing');snapshot=null;$('snapshot').hidden=true;$('practice-scene').hidden=!!desktop;
 const columns=innerWidth<700?3:5,rows=Math.ceil(5/columns);
 tiles('Browse & scroll',[
 entry('Scroll down',()=>command({type:'scroll',amount:-3})),entry('Scroll up',()=>command({type:'scroll',amount:3})),
 entry('Click a video or button',()=>startGrid()),entry('Type text',()=>compose('app')),
 entry('Use another app',()=>{focusRebind=true;clearPageTargets();refreshPageTargets();})],false,0,{kind:'navigation',columns,rows});
 $('tiles').classList.add('view');$('tiles').style.setProperty('--view-height',(rows*60+(rows-1)*10)+'px');$('practice-scene').hidden=!!desktop;
 $('hint').textContent='Look near a link, button or text box. Hold its highlight to select.';
 clearPageTargets();refreshPageTargets();}
async function openSite(site){if(desktop)await desktop.openSite(site,'');else report('Practice only. Use the Windows companion to open other apps.');browse();}
function syncTypingRegion(){
 const top=!$('composer').hidden&&![...document.querySelectorAll('dialog')].some(d=>d.open)?Math.floor($('typing-dock').getBoundingClientRect().top):null;
 if(top===typingRegion)return;typingRegion=top;desktop?.typingRegion?.(top)?.catch(()=>{});
}
function hideComposer(){if(!$('composer').hidden)drafts[destination]=text;$('composer').hidden=true;$('typing-dock').hidden=true;document.body.classList.remove('typing-docked');$('workspace').classList.remove('composing');$('workspace').insertBefore($('tiles'),$('gaze'));syncTypingRegion();}
function refreshWords(){
 const field=$('draft-text');if(!field)return;const previous=wordChoices.map(c=>c.word).join('|');wordChoices=wordEngine.suggest(text,field.selectionStart);
 if(previous!==wordChoices.map(c=>c.word).join('|')){const locked=dwell.locked;intent.reset();dwell.reset();dwell.locked=locked;blockedUntil=performance.now()+200;}
 for(let i=0;i<3;i++){const choice=wordChoices[i],button=$('word-'+i);button.textContent=choice?.word||'—';button.disabled=!choice;button.setAttribute('aria-label',choice?'Use word '+choice.word:'No word suggestion');}
 $('draft-undo').disabled=!typingUndo;
}
function setDraft(value,caret=value.length,undo=null){
 text=value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1000);drafts[destination]=text;typingUndo=undo;
 $('draft-text').value=text;$('draft-text').setSelectionRange(Math.min(caret,text.length),Math.min(caret,text.length));$('draft-submit').disabled=!text.trim();$('draft-enter').disabled=!text.trim();$('draft-delete').disabled=!text;refreshWords();
 const locked=dwell.locked;intent.reset();dwell.reset();dwell.locked=locked;blockedUntil=performance.now()+200;
}
function compose(target){hideComposer();destination=target;text=drafts[target];letterGroup=null;keyboardPage='letters';document.body.classList.add('viewing','typing-docked');$('snapshot').hidden=true;$('composer').hidden=false;$('typing-dock').hidden=false;$('typing-dock').append($('tiles'));$('workspace').classList.add('composing');$('practice-scene').hidden=!!desktop;
 $('draft-label').textContent=target==='app'?'Text to type into the selected box':target==='youtube'?'Your YouTube search':'Your Google search';
 $('draft-help').textContent='';
 $('draft-submit').textContent=target==='app'?'Type only':target==='youtube'?'Search YouTube':'Search Google';$('draft-submit').classList.toggle('primary',target!=='app');$('draft-enter').hidden=target!=='app';setDraft(text);keyboard();
}
function keyboard(){stage='keyboard';letterGroup=null;keyboardPage='letters';$('snapshot').hidden=true;
 $('draft-compact').hidden=keyboardLayout==='compact';
 if(keyboardLayout==='compact'){flatKeyboard();return;}
 tiles(destination==='app'?'Write your text':destination==='youtube'?'Write a YouTube search':'Write a Google search',[
 ...['ABCDEFGHI','JKLMNOPQR','STUVWXYZ'].map(g=>entry(g[0]+' – '+g.at(-1),()=>letters(g),g.split('').join(' '))),entry('Numbers & symbols',()=>symbols(),'0–9, punctuation and other characters')]);}
function setKeyboardLayout(value){keyboardLayout=value;try{localStorage.setItem('hands-free.keyboard-layout',value);}catch{}keyboard();}
function flatKeyboard(){
 stage=keyboardPage==='letters'?'keyboard':'symbols';letterGroup=null;
 const characters=keyboardPage==='letters'?'QWERTYUIOPASDFGHJKL.ZXCVBNM?':'1234567890@/:_-+?!,.;()\'"&=%#';
 const keys=[...characters].map(c=>entry(uppercase?c:c.toLowerCase(),()=>append(uppercase?c:c.toLowerCase())));
 keys.push(entry(keyboardPage==='letters'?'123':'ABC',()=>{keyboardPage=keyboardPage==='letters'?'symbols':'letters';flatKeyboard();}),entry('Aa',()=>{uppercase=!uppercase;flatKeyboard();}));
 const columns=Math.max(5,Math.min(10,Math.floor((innerWidth-32)/48)));
 tiles(destination==='app'?'Write your text':destination==='youtube'?'Write a YouTube search':'Write a Google search',keys,false,0,{kind:'keyboard',columns,rows:Math.ceil(keys.length/columns)});
 $('tiles').style.gridTemplateRows=`repeat(${Math.ceil(keys.length/columns)},minmax(44px,86px))`;
}
function letters(group){stage='letters';letterGroup=group;
 const groups=group.length>4?Array.from({length:Math.ceil(group.length/3)},(_,i)=>group.slice(i*3,i*3+3)):null;
 tiles(groups?'Choose a smaller group':'Choose a letter',groups?groups.map(g=>entry(g.split('').join(' '),()=>letters(g))):Array.from(group,c=>entry(uppercase?c:c.toLowerCase(),()=>append(uppercase?c:c.toLowerCase()))));
}
function symbols(){if(keyboardLayout==='compact'){keyboardPage='symbols';flatKeyboard();return;}stage='symbols';letterGroup=null;tiles('Numbers & symbols',[entry('0 1 2 3 4',()=>letters('01234')),entry('5 6 7 8 9',()=>letters('56789')),entry('. , ? !',()=>letters('.,?!')),entry('@ / : _ − +',()=>letters('@/:_-+'))]);}
function append(c){const field=$('draft-text'),result=insertText(text,field.selectionStart,field.selectionEnd,c,wordEngine,autocorrect);setDraft(result.text,result.caret,result.undo);if(result.corrected)report('Corrected to '+result.corrected+' · Undo is available');if(!$('tiles').classList.contains('keyboard'))keyboard();}
function typeHelp(){hideComposer();stage='type-help';document.body.classList.remove('viewing');$('snapshot').hidden=true;tiles('Choose where to type',[
 entry('Find a text box',()=>browse(),'Look near the text box to select it'),
 entry('Text box already selected',()=>compose('app'),'Write into the box that already has the cursor'),
 entry('Press Enter',async()=>{await command({type:'key',key:'enter'});browse();},'Submit text already in the other app'),entry('Back to tasks',()=>menu())]);}
async function submitDraft(enter=false){
 if(!text.trim()){report('Choose some letters before sending your text.');return;}
 const value=text;
 if(destination==='app')await command({type:'text',text:value,...(enter?{submit:true}:{})});
 else if(desktop)await desktop.openSite(destination,value.trim());else $('practice-text').value=value.trim();
 setDraft('');focusRebind=true;browse();report(desktop?(destination==='app'?(enter?'Text typed and Enter pressed.':'Text typed.'):'Search results opened. Look near a link to select it.'):'Practice search shown here.');
}
function textMenu(){stage='text-options';tiles('Text options',[
 entry('Keep writing',()=>keyboard()),entry(uppercase?'Use lowercase':'Use uppercase',()=>{uppercase=!uppercase;keyboard();}),
 entry('Clear this draft',()=>{setDraft('');keyboard();}),
 destination==='app'?entry('Type + Enter',()=>submitDraft(true),'Type this draft and submit it in one action'):entry(destination==='youtube'?'Open YouTube home':'Open Google home',()=>openSite(destination),'Open the website without searching'),
 entry(keyboardLayout==='compact'?'Larger keys':'Compact keyboard',()=>setKeyboardLayout(keyboardLayout==='compact'?'large':'compact')),
 entry('Autocorrect: '+(autocorrect?'on':'off'),()=>{autocorrect=!autocorrect;try{localStorage.setItem('hands-free.autocorrect',autocorrect?'on':'off');}catch{}textMenu();})],false,0,{columns:3,rows:2});}
function keyMenu(){hideComposer();stage='keys';document.body.classList.remove('viewing');tiles('More controls',[
 ...[['Next field (Tab)','tab'],['Previous field','shifttab'],['Address bar','address'],['Browser back','back']].map(([label,key])=>entry(label,async()=>{await command({type:'key',key});browse();})),
 ...(stream&&validModel(model)?[entry('Quick alignment · 1 dot',()=>beginCapture('offset'),'Correct a steady offset, then measure seven fresh checks')]:[]),
 entry('Press Enter',async()=>{await command({type:'key',key:'enter'});browse();},'Submit text already in the other app'),
 entry('Other keys & settings',()=>settingsMenu()),entry('Back to tasks',()=>menu())]);}
function settingsMenu(){stage='settings';tiles('Keys & settings',[
 ...[['Next field (Tab)','tab'],['Previous field','shifttab'],['Address bar','address'],['Browser back','back']].map(([label,key])=>entry(label,async()=>{await command({type:'key',key});browse();})),
 entry(active?'Check accuracy':canControl()?'Resume eye control':'Set up eye control',()=>active?beginCapture('check'):canControl()?activate():backToSetup()),...(stream&&validModel(model)?[entry('Saved head positions',()=>openHeadPositions(),'Add nearby positions once; estimate the positions between them'),entry('Test gaze pointer',()=>previewGaze()),entry('Reading button position',()=>readingPositionMenu()),entry('Refine accuracy · 9 points',()=>beginCapture('refine'))]:[]),entry('Device controls',()=>openSite('home')),entry('Back to tasks',()=>menu())]);}
function readingPositionMenu(){stage='reading-position';tiles('Reading button position',[
 ...['top-left','top-right','bottom-left','bottom-right'].map(dock=>entry(dock.replace('-',' '),()=>{
  readingDock=dock;try{localStorage.setItem('hands-free.reading-dock',dock);}catch{}
  browse();return enterReading();
 }))]);}
async function startGrid(after=browse,purpose='button'){
 if(!active||stage==='paused'||!canControl())throw Error('Set up or resume eye control before choosing a screen region.');
 hideComposer();clickThen=after;clickPurpose=purpose;
 rect={x:0,y:0,w:1,h:1};depth=0;zoomHistory=[];
 if(desktop){const data=await desktop.capture();snapshot=new Image();snapshot.src=data;await snapshot.decode();}
 else{snapshot=null;$('practice-scene').hidden=false;}
 grid();
}
function drawSnapshot(){
 $('snapshot').hidden=!snapshot;if(!snapshot)return;
 const c=$('snapshot'),bounds=$('tiles').getBoundingClientRect();c.width=Math.round(bounds.width*devicePixelRatio);c.height=Math.round(bounds.height*devicePixelRatio);
 c.getContext('2d').drawImage(snapshot,rect.x*snapshot.width,rect.y*snapshot.height,rect.w*snapshot.width,rect.h*snapshot.height,0,0,c.width,c.height);
}
let zoomHistory=[];
function grid(){stage='grid';layout=controlLayout();const {columns,rows}=layout;tiles('Choose a region',Array.from({length:columns*rows},(_,i)=>entry(String(i+1),async()=>{
 zoomHistory.push({...rect});rect=subdivide(rect,i,columns,rows);depth++;
 if(!zoomComplete(rect,snapshot?.width||innerWidth*devicePixelRatio,snapshot?.height||innerHeight*devicePixelRatio)){grid();return;}
 await command({type:'click',x:rect.x+rect.w/2,y:rect.y+rect.h/2});const next=clickThen||browse;clickThen=null;next();
})),true);drawSnapshot();}
async function activate(test=false){
 if(test&&stream&&validModel(model))testing=true;
 if(!canControl())throw Error('Complete the accuracy check or explicitly choose Test controls with this calibration.');
 const revision=++uiRevision;
 $('result-dialog').close();$('cal-dot').hidden=true;menu();
 await pauseTask;
 if(revision!==uiRevision)return;
 if(desktop)await desktop.arm();
 if(revision!==uiRevision){await desktop?.pause();return;}
 active=true;selectionsPaused=false;headSelector.reset();document.body.classList.add('active');setCameraPreview(false);$('tracking-info').hidden=true;fixation.reset();intent.reset();dwell.reset();lastHeartbeat=0;updateSelectionMode();
 menu();report(testing?'Test eye control is on. Choose a task and hold its button for 0.6 seconds.':'Eye control is on. '+saveNotice);
}
async function pause(show=true){
 resetReturnGuide();
 resetReading();
 if(show&&(capture||pointRetry)){if(capture)showPointHelp('Setup paused.');await desktop?.pause();return;}
 const revision=++uiRevision;
 active=false;selectionsPaused=false;updateSelectionMode();capture=null;pointer.reset();fixation.reset();intent.reset();dwell.reset();$('gaze').hidden=true;clearHighlight();document.body.classList.remove('active','viewing');updateTestNotice();
 if(desktop)pauseTask=Promise.resolve(desktop.pause()).catch(()=>{});
 await pauseTask;
 if(revision!==uiRevision)return;
 if(show){
  hideComposer();
  $('result-dialog').close();$('snapshot').hidden=true;$('cal-dot').hidden=true;
  if(canControl()){stage='paused';active=true;tiles('Paused',[entry('Resume',()=>activate()),entry('Check accuracy',()=>beginCapture('check')),entry('Back to setup',()=>backToSetup()),...(desktop?[entry('Close companion',()=>desktop.quit())]:[])]);report('Input is paused. Look at Resume for 0.6 seconds to continue.');}
  else{menu();report('Eye control is off. Setup starts the camera. You can explore the search controls with the mouse.');}
 }
}
async function showControls(){
 restorePositionBackup();positionSession=null;$('positions-dialog').close();headSelector.reset();
 clearTestMode();
 await pause(false);$('result-dialog').close();$('cal-dot').hidden=true;$('cal-message').hidden=true;$('retry-point').hidden=true;setCameraPreview(false);$('tracking-info').hidden=true;$('welcome').hidden=true;$('workspace').hidden=false;
 menu();report('Eye control is off. Pause / Setup opens camera setup. You can explore Search YouTube or Search Google with the mouse.');
}
async function previewGaze(){
 if(!validModel(model)||!stream)return;
 previewUnverified=testing||!headPositions.some(e=>e.validation?.passed===true);
 clearTestMode();
 await pause(false);stage='preview';$('result-dialog').close();$('workspace').classList.remove('calibrating');$('workspace').classList.add('previewing');
 $('cal-dot').hidden=true;$('cal-message').hidden=true;$('retry-point').hidden=true;$('tiles').hidden=true;$('snapshot').hidden=true;$('practice-scene').hidden=true;
 $('accuracy-preview').hidden=false;$('preview-check').hidden=false;setCameraPreview(true);$('tracking-info').hidden=false;$('mode-label').textContent='Gaze pointer test';$('hint').textContent=Number.isFinite(validation?.radiusX)&&Number.isFinite(validation?.radiusY)?'Blue dot: estimated gaze. Dashed outline: saved-position error allowance, not measured accuracy between positions. No clicks are sent.':'Blue dot: estimated gaze. Run an accuracy check to measure its error. No clicks are sent.';$('pause').textContent=previewUnverified?'Test eye controls':'Use eye controls';$('cancel').textContent='Back to setup';report('Gaze preview only. Use eye controls to continue with tracking enabled.');
}
function backToSetup(){hideComposer();pause(false);clearTestMode();stopCamera();$('result-dialog').close();$('workspace').hidden=true;$('welcome').hidden=false;refreshProfile();stage='welcome';}
function fail(message){hideComposer();pause(false);clearTestMode();capture=null;$('cal-dot').hidden=true;stopCamera();$('result-dialog').close();$('welcome').hidden=false;$('workspace').hidden=true;refreshProfile();report(message);stage='welcome';}
$('retry-point').onclick=()=>{if(!pointRetry)return;capture=pointRetry;pointRetry=null;stage=capture.kind;$('retry-point').hidden=true;$('cal-message').hidden=true;$('cal-dot').hidden=false;setCameraPreview(false);$('tracking-info').hidden=true;nextPoint(true);};
$('preview').onclick=()=>run(previewGaze);$('preview-check').onclick=()=>beginCapture('check');
$('refine-result').onclick=()=>{$('result-dialog').close();beginCapture('refine');};$('refine-saved').onclick=()=>startCamera('refine');
$('adjust').onclick=()=>{$('result-dialog').close();beginCapture('adjust');};$('align-saved').onclick=()=>startCamera('adjust');
$('eye-only-result').onclick=()=>{$('result-dialog').close();beginCapture('adjust',true);};$('eye-only-saved').onclick=()=>startCamera('eye-only');
$('realign-controls').onclick=()=>run(openHeadPositions);
$('head-status').onclick=openReturnGuide;
$('return-next').onclick=()=>{
 const now=performance.now(),head=now-lastReceived<=250?lastHeadFeature:null;
 returnGuide.next(headPositions,head,now,returnOptions());
 renderReturnGuide(returnGuide.update(head,headPositions,now,{...returnOptions(),force:true,eyesReady:false}),head);
};
$('return-close').onclick=()=>resetReturnGuide({snooze:true,release:true});
$('return-dialog').addEventListener('cancel',e=>{e.preventDefault();pause();});
$('result-positions').onclick=()=>run(openHeadPositions);
$('positions-saved').onclick=()=>startCamera('positions');
$('position-add').onclick=()=>startHeadPosition();
$('position-next').onclick=()=>{if(!positionSession?.plan)return;positionSession.skipped.push(positionSession.plan.id);showHeadPositions();};
$('position-smaller').onclick=()=>{if(!positionSession)return;positionSession.span=Math.max(.4,positionSession.span*.75);showHeadPositions();};
$('position-manual').onclick=()=>{if(!positionSession)return;positionSession.manual=!positionSession.manual;renderHeadGuide();};
$('position-resume').onclick=()=>run(()=>finishPositions(false));
$('position-test').onclick=()=>run(()=>finishPositions(true));
$('position-back').onclick=cancelPositions;
$('positions-dialog').addEventListener('cancel',e=>{e.preventDefault();cancelPositions();});
$('test-result').onclick=()=>run(()=>activate(true));$('test-saved').onclick=()=>startCamera('test');
$('copy-report').onclick=async()=>{
 const content=['Screen control 0.4.16',$('result-title').textContent,resultReport||$('result-copy').textContent,$('result-sides').textContent,...[...$('result-details').children].map(n=>n.textContent)].join('\n\n');
 try{await navigator.clipboard.writeText(content);$('copy-report-status').textContent='Report copied. It contains results only, without images or raw eye samples.';}
 catch{$('copy-report-status').textContent='The browser could not copy the report. You can select and copy the results above.';}
};
$('setup-controls').onclick=()=>run(showControls);
$('start').onclick=()=>startCamera('resume');$('restore').onclick=()=>startCamera('check');$('new-calibration').onclick=()=>startCamera('train');
$('return-saved').onclick=()=>startCamera('find');
$('retry').onclick=()=>{$('result-dialog').close();beginCapture('train');};
$('retry-check').onclick=()=>{$('result-dialog').close();beginCapture('check');};
$('continue').onclick=()=>run(validation?.passed?activate:showControls);$('exit-setup').onclick=backToSetup;
$('open-controls').onclick=()=>run(showControls);
$('pause').onclick=()=>stage==='preview'?run(()=>activate(previewUnverified||validation?.passed!==true)):active||capture?pause():backToSetup();$('cancel').onclick=()=>{if(stage==='preview')backToSetup();else if(capture)backToSetup();else if(stage==='grid'&&zoomHistory.length){rect=zoomHistory.pop();depth--;grid();}else if(['letters','symbols','text-options'].includes(stage))keyboard();else if(stage==='paused')backToSetup();else if(stage!=='welcome')menu();else backToSetup();};
$('more-controls').onclick=()=>keyMenu();
$('pointer-test').onclick=toggleSelections;$('copy-tracking').onclick=copyTrackingReport;
$('read-mode').onclick=()=>run(enterReading);$('wake-pointer').onclick=()=>run(exitReading);
addEventListener('mousemove',e=>{if(reading)desktop?.readingPointer($('return-dialog').open||!!e.target.closest?.('#wake-pointer'));});
$('wake-pointer').addEventListener('mouseleave',()=>{if(reading)desktop?.readingPointer(false);});
$('draft-space').onclick=()=>append(' ');
$('draft-delete').onclick=()=>{const f=$('draft-text'),start=f.selectionStart,end=f.selectionEnd,left=start===end?Array.from(text.slice(0,start)).slice(0,-1).join('').length:start;setDraft(text.slice(0,left)+text.slice(end),left);if(!$('tiles').classList.contains('keyboard'))keyboard();};
$('draft-submit').onclick=()=>run(()=>submitDraft());
$('draft-enter').onclick=()=>run(()=>submitDraft(true));
$('draft-options').onclick=()=>textMenu();
$('draft-compact').onclick=()=>setKeyboardLayout('compact');
$('draft-hide').onclick=()=>browse();$('draft-pause').onclick=()=>pause();
for(let i=0;i<3;i++)$('word-'+i).onclick=()=>{const word=wordChoices[i];if(!word)return;const result=completeWord(text,$('draft-text').selectionStart,word.word);if(result)setDraft(result.text,result.caret,result.undo);};
$('draft-undo').onclick=()=>{if(typingUndo){const previous=typingUndo;setDraft(previous.text,previous.caret);}};
$('draft-text').oninput=e=>setDraft(e.target.value,e.target.selectionStart);
$('draft-text').addEventListener('beforeinput',e=>{if(e.inputType==='insertText'&&e.data===' '&&!e.isComposing){e.preventDefault();append(' ');}});
for(const event of ['select','keyup','click'])$('draft-text').addEventListener(event,refreshWords);
new ResizeObserver(()=>{if(!$('composer').hidden)syncTypingRegion();}).observe($('typing-dock'));
for(const dialog of document.querySelectorAll('dialog'))new MutationObserver(syncTypingRegion).observe(dialog,{attributes:true,attributeFilter:['open']});
addEventListener('resize',()=>{if(!$('composer').hidden)syncTypingRegion();});
$('home').onclick=async e=>{if(desktop){e.preventDefault();await desktop.openSite('home','');}stopCamera();};
document.querySelector('a[href="icontrol-eyes://open"]').onclick=()=>{pause(false);stopCamera();};
addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();pause();}});
addEventListener('resize',()=>{
 if(!stream||!sessionSetup)return;
 const changed=Math.abs(sessionSetup.screenWidth-innerWidth)>3||Math.abs(sessionSetup.screenHeight-innerHeight)>3||Math.abs(sessionSetup.pixelRatio-devicePixelRatio)>.01;
 if(!changed&&stage!=='resizing')return;
 if(stage!=='resizing'){resetReturnGuide();restorePositionBackup();positionSession=null;$('positions-dialog').close();headSelector.reset();capture=null;pointRetry=null;uiRevision++;active=false;clearTestMode();desktop?.pause();intent.reset();dwell.reset();pointer.reset();$('gaze').hidden=true;$('cal-dot').hidden=true;$('result-dialog').close();stage='resizing';}
 clearTimeout(resizeTimer);report('Window size changed. Waiting for the window to settle…');
 resizeTimer=setTimeout(()=>{
  if(!stream||stage!=='resizing')return;
  sessionSetup=setupStamp();model=null;validation=null;
  // Measurements from different viewport sizes must not be mixed. Keep the camera running.
  beginCapture('train');report('Window size is ready. Follow the dots for this size; the camera is still running.');
 },600);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!desktop){alignmentStart=null;alignmentLast=0;if(stage==='preview')run(showControls);else if(capture||pointRetry||active)pause();}});
addEventListener('pagehide',()=>{desktop?.pause();stopCamera();});
desktop?.onPause(()=>pause());
desktop?.onToggle(()=>{if(reading)run(exitReading);else if(active&&stage!=='paused')pause();else if(canControl())run(activate);});
setInterval(()=>{if(returnGuide.visible&&performance.now()-lastSample>250)renderReturnGuide(returnGuide.update(null,headPositions,performance.now(),{...returnOptions(),reason:'eyes-unavailable'}),null);if((active||stage==='preview')&&performance.now()-lastSample>500){intent.reset();dwell.update(null,performance.now());pointer.reset();$('gaze').hidden=true;$('wake-progress').value=0;drawEyes(null);clearHighlight();desktop?.heartbeat(false);report('Waiting for fresh eye tracking. No action will be sent.');}if(capture&&lastReceived&&performance.now()-lastReceived>5000)showPointHelp('Camera frames stopped arriving.');if(capture&&performance.now()-capture.started>20000)showPointHelp(lastQuality);},100);
