import {TRAIN_TARGETS,CHECK_TARGETS,ALIGN_TARGETS,REFINE_TARGETS,calibrationTargets,settledSummary,fitCalibration,MOVE_TARGETS,MOVED_ENOUGH,MOVED_AWAY,MOVED_FAR,headRange,headOffsets,signalFeature,readsIrisPixels,applyCheckOffset,shiftedModel,shiftPrediction,Recentre,median,fitAlignment,fitRefinement,fitOffset,validateCalibration,predict,predictDetailed,validModel,sameSetup,quantile,poseZoom,GazePointer,FixationGate,TargetIntent,TargetDwell,nearTarget,contextTarget,subdivide,selectionMargin,containedTarget,chooseLayout,controlGeometry,zoomComplete,typingGrid,letterGroups,menuGrid} from './screen-gaze.mjs';
import {videoConstraints,cameraSnapshot,restoreCameraControls,sameCameraGeometry,cameraCrop,CameraZoomQueue,lensControl,lensZoom,lensCalibrationBank,calibrationForLens,identifySavedLens,EYE_TRACKER_REVISION,pictureControls,setPicture,PictureTuner,probePicture,FaceFraming,FaceEdges,FACE_EDGE_ADVICE,ReflectionTally,LensChooser} from './screen-camera.mjs';
import {drawEyeOverlay} from './screen-eye-overlay.mjs';
import {DEFAULT_EYE_REGIONS,eyeRegionRect,previewEyePoint,validEyeRegions,markedEyeRegions} from './screen-eye-crop.mjs';
import {WordSuggestions,insertText,completeWord} from './screen-typing.mjs';
import {MAX_HEAD_POSITIONS,savedHeadPositions,HeadPositionSelector,resetDwellForPosition,estimateHeadPositions,nextHeadPosition,HeadCaptureGuide,HeadReturnGuide,calibrationReturnPlan,calibrationReturnFeedback} from './screen-positions.mjs';
import {focusChoice,visibleFocusTargets,coveredFocusTargets,controlNames,readingOrder,CHOICES} from './screen-targets.mjs';
import {CALIBRATION_KEY,readProfile,writeProfile,chooseCamera} from './screen-profile.mjs';
const $=id=>document.getElementById(id),desktop=window.desktopControl,pointer=new GazePointer(),fixation=new FixationGate(),intent=new TargetIntent(),dwell=new TargetDwell(600,{pauseMs:300,releaseMs:200});
const KEY=CALIBRATION_KEY;
// Where the profile's camera and options are kept (see screen-profile.mjs). A browser that
// refuses storage gives none; nothing is saved then, and nothing fails.
const kept=(()=>{try{return window.localStorage;}catch{return null;}})();
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
const drafts={youtube:'',google:'',app:'',launch:'',ask:''};
// ask: a name being written with the keyboard (a device or one of its buttons). waitingFor: the
// button the receiver board is being waited on for. linkingApp: this app is showing a link code.
let ask=null,waitingFor=null,linkingApp=false;
// site: in a browser on the website, the site's own pages (Devices, Set up a device) take the
// place of the practice page and are used with the eye pointer. See screen-site.mjs.
let site=null,arrivedForSite=false;
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
let focusTargets=[],coveredTargets=[],focusScope=null,focusAt=0,focusQuery=false,focusRebind=true,focusRevision=0;
// Several app controls on offer as one: too close together to tell apart, or
// reached only by the stretch out to a screen edge (see focusChoice). Holding
// the group opens a list of them.
let pageGroup=null,pageGroups=0,coveredEntry=null,hintHold=0;
let pointRetry=null,waitingMode=null,alignmentStart=null,alignmentLast=0,lastQuality='Starting camera',lastQualityAt=0;
let cameraProbe=[],cameraProbeDone=false,cameraStats=null,frameTimes=[],lastFrameReason='usable',alignmentError='';
const REJECTION={'head-position':'outside the saved head positions','head-reacquiring':'settling into a saved head position','outside-screen':'estimate outside screen','eyes-unavailable':'eye tracking unavailable','eye-features':'incomplete eye features','invalid-estimate':'invalid estimate','no-model':'no saved map'};
const HEAD_REASON={x:'horizontal position',y:'vertical position',scale:'distance',roll:'head tilt',yaw:'left/right rotation',pitch:'up/down rotation',unavailable:'unavailable'};
const QUALITY={'usable':'Both eyes are clear','eye-crop-unavailable':'Both eyes are not clear. Keep both eyes open and in view.','searching':'Looking for both eyes. Keep both eyes in view of the camera.','no-face':'Face not found. Face the camera.','landmarks':'Eye landmarks are incomplete.','too-small':'Eyes are too small in the image. Zoom in or move the camera closer.','iris':'Iris details are unclear. Adjust lighting or glasses glare.','closed-eye':'One or both eyes look closed to the tracker. Adjust the camera height.','eye-edge':'Look toward the dot without turning away.','disagreement':'The two eyes read differently. Check the camera angle and lighting.','framing':'Following your face…','glare':'Something bright covers both irises (a reflection). Move lamps, dim the screen, or tilt glasses slightly if you wear them.','iris-detail':'The iris edge is not clear in this frame. Check the light and reflections.'};
const faceFraming=new FaceFraming();let lastLight=null,lightAt=0,pictureRun=0,lightRecent=[],pictureProbe=null,pictureBusy=false,sampleCanvas=null;
document.body.classList.toggle('desktop',!!desktop);$('browser-info').hidden=!!desktop;
$('quit').hidden=!desktop;$('quit').onclick=()=>desktop?.quit();
if(!desktop)$('start').textContent='Try eye control in this browser';
function headStatus(message){const button=$('head-status'),label=message.startsWith('Position ')?message.split(' · ')[0]+' · Align':message.startsWith('Between')||message.startsWith('Learned')?'Saved range · Align':'Find my position';if(button.textContent!==label)button.textContent=label;button.title=message+' · Find your saved head position';}
function report(message){$('status').textContent=message;$('welcome-status').textContent=message;$('welcome-status').classList.remove('alert');}
function canControl(){return !!stream&&validModel(model)&&(validation?.passed===true||testing);}
function layoutValidation(){
 if(testing)return null;
 const measured=headPositions.filter(e=>e.validation?.passed).map(e=>e.validation);
 // Keep target locations fixed when another measured position becomes active.
 return measured.length?{...validation,radiusX:Math.max(...measured.map(v=>v.radiusX||0)),radiusY:Math.max(...measured.map(v=>v.radiusY||0)),jitterX:Math.max(...measured.map(v=>v.jitterX||0)),jitterY:Math.max(...measured.map(v=>v.jitterY||0))}:validation?.passed?validation:null;
}
function controlLayout(){return testing?{columns:2,rows:2,capacity:4}:chooseLayout(innerWidth,innerHeight,layoutValidation());}
// How far estimates lie from the gaze nine times in ten, in pixels, by the
// latest accuracy check, passed or not: a failed check calls for larger
// buttons, not for the smallest. Unknown (null) before any check.
function measured(){return [validation,...headPositions.map(e=>e.validation)].find(v=>Number.isFinite(v?.radiusX)&&Number.isFinite(v?.radiusY))||null;}
// Controls opened for a test without a measurement: assume a tenth of the screen.
function reach(){const latest=measured(),r=latest?.afterShift||latest;return r?{x:r.radiusX*innerWidth,y:r.radiusY*innerHeight}:testing?{x:.1*innerWidth,y:.1*innerHeight}:null;}
// The typing panel's rows and columns for that reach (see typingGrid).
let typing=typingGrid(innerWidth,innerHeight,null);
function typingLayout(){
 typing=typingGrid(innerWidth,innerHeight,reach());
 const root=document.documentElement.style;root.setProperty('--typing-row',typing.row+'px');root.setProperty('--typing-button',(typing.fine?42:typing.row)+'px');
 document.body.classList.toggle('typing-roomy',!typing.fine);
 return typing;
}
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
const lensChooser=new LensChooser();let eyesBeforeLens=null,lensNote='',lensAhead=null,lensTrialFailed=false,lensChoice=null;
// A lens pressed by hand is the person's own choice: the app does not try the other
// one, and puts the chosen one back when the camera comes up on the other (it does
// after being closed and opened again).
function handLensFor(deviceId){try{const v=JSON.parse(localStorage.getItem('hands-free.lens-by-hand.'+profileKey())||'null');return v&&deviceId&&v.deviceId===deviceId&&['wide','telephoto'].includes(v.lens)?v.lens:null;}catch{return null;}}
function handLens(){return handLensFor(stream?.getVideoTracks()[0]?.getSettings().deviceId);}
function rememberHandLens(lens){try{localStorage.setItem('hands-free.lens-by-hand.'+profileKey(),JSON.stringify({deviceId:stream?.getVideoTracks()[0]?.getSettings().deviceId,lens}));}catch{}}
let handLensTried=false,handLensFailed=false;
function armLensChooser(close){
 lensChooser.reset();lensChooser.close=close;lensNote='';lensAhead=null;handLensTried=false;
 const hand=handLens();
 if(hand){lensChooser.cancel();lensNote=hand==='wide'?'kept because you chose it by hand; press Telephoto to try the other lens':'kept because you chose it by hand';}
}
// The lens chosen by hand, when the camera is on the other one and this start should use the
// chosen one: the camera preview, a new calibration, or a saved calibration made with it. (Only
// when all there is saved was made with the other lens, and that is what is being used, does
// the camera stay as it is.)
function handLensWanted(){
 if(handLensTried)return null;
 const track=stream?.getVideoTracks()[0],physical=lensControl(track);if(!physical.supported)return null;
 const hand=handLens();if(!hand||physical.lens===hand)return null;
 if(stage==='camera-preview')return hand;
 if(stage!=='align')return null;
 const own=calibrationForLens(identifySavedLens(rootSaved(),track),track.getSettings().deviceId,hand,$('tracking-mode').value);
 return newCalibrationAhead()||own&&validModel(own.model)?hand:null;
}
// What happened to the lens, kept for the diagnostics file: the camera itself does not say
// why it is on one lens or the other.
const lensLog=[];
function lensEvent(event,extra={}){
 const track=stream?.getVideoTracks()[0];
 lensLog.push({at:Math.round(performance.now()),event,lens:lensControl(track).lens,zoom:track?.getSettings?.().zoom??null,stage,...extra});
 if(lensLog.length>80)lensLog.splice(0,lensLog.length-80);
}
const lensName=lens=>lens==='wide'?'wide-angle':lens==='telephoto'?'telephoto':'';
// Whether the face runs past an edge of the camera picture: now (for the preview and the camera
// check) and over a calibration and its checks (for their result).
const faceEdges=new FaceEdges();let edgeTally={frames:0,bottom:0,top:0,side:0};
function edgeAdvice(){const edge=faceEdges.edge;return edge?FACE_EDGE_ADVICE[edge]:'';}
function framingNote(){
 if(edgeTally.frames<100)return '';
 const [edge,count]=Object.entries(edgeTally).filter(([k])=>k!=='frames').sort((a,b)=>b[1]-a[1])[0];
 return count>=edgeTally.frames*.25?` Camera framing: in ${Math.round(100*count/edgeTally.frames)}% of the frames ${FACE_EDGE_ADVICE[edge][0].toLowerCase()+FACE_EDGE_ADVICE[edge].slice(1)} A face that is whole in the picture is tracked more steadily.`:'';
}
// Where something bright over the irises (a reflection, with or without glasses) kept the eyes
// from being read during the calibration and its checks.
const reflections=new ReflectionTally();
function reflectionNote(){
 const w=reflections.worst;if(!w)return '';
 const where={top:'at the top of the screen',middle:'in the middle of the screen',bottom:'at the bottom of the screen'}[w.band],pct=v=>Math.round(v*100)+'%';
 return ` Reflections: ${where} something bright covered both irises in ${pct(w.hidden)} of the frames`+(w.oneEye>=.05?` and one of them in a further ${pct(w.oneEye)}`:'')+` (elsewhere ${pct(w.elsewhere)}), so the eyes could not be read then. Usually that is a lamp or the screen mirrored in the eye or in glasses: moving the lamp, or "Dark calibration screen" in More setup options, can help.`;
}
// The lens in use, for the result of a calibration or check.
function lensInUse(){const lens=lensControl(stream?.getVideoTracks()[0]).lens;return lens?lensName(lens)+' lens'+(handLens()===lens?' (your choice)':handLens()?' (not the lens you chose: choose it again in Set camera / preview)':''):'';}
// True when the start now under way will make a new calibration rather than use a saved one.
function newCalibrationAhead(){
 if(!['resume','check','train'].includes(waitingMode))return false;
 if(waitingMode==='train')return true;
 const saved=loadSaved();return !(saved&&validModel(saved.model)&&sameSetup(saved.setup,sessionSetup));
}
// Before a new calibration: true while the app is still deciding which lens to calibrate with.
function lensHolding(){
 if(handLensWanted())return true;
 if(isEyeCrop()||lensChooser.state==='done')return false;
 if(lensAhead===null)lensAhead=!lensTrialFailed&&newCalibrationAhead()&&lensControl(stream?.getVideoTracks()[0]).supported;
 return lensAhead;
}
let eyeRegions=DEFAULT_EYE_REGIONS.map(r=>({...r})),eyeMark=0,trackedRegions=null,noFaceSince=null;
function drawEyeRegions(){
 const settings=stream?.getVideoTracks()[0]?.getSettings();if(!settings)return;
 const c=cameraCrop(settings.width,settings.height,frameCrop),canvas=$('eye-regions');canvas.width=c.width;canvas.height=c.height;
 const ctx=canvas.getContext('2d');ctx.lineWidth=Math.max(2,c.width/400);ctx.setLineDash([c.width/80,c.width/160]);
 // Show where the tracker is reading now; the marked boxes are only its start.
 (validEyeRegions(trackedRegions)?trackedRegions:eyeRegions).forEach((r,i)=>{const box=eyeRegionRect(r,c.width,c.height);ctx.strokeStyle=i===0?'#00cfff':'#ffdd32';ctx.strokeRect(box.x,box.y,box.size,box.size);});
}
function trackingUI(){
 document.body.classList.toggle('eyes-tracking',isEyeCrop());$('eye-crop-setup').hidden=!isEyeCrop();$('eye-regions').hidden=!isEyeCrop()||stage!=='camera-preview';
 $('camera').classList.toggle('eye-setup',isEyeCrop()&&stage==='camera-preview');
 if(stage==='camera-preview'&&isEyeCrop())drawEyeRegions();
}
function updateEyeRegions(){
 cameraChoiceDirty=true;chosenCameraSettings=null;trackedRegions=null;drawEyeRegions();worker?.postMessage({type:'regions',eyeRegions});
}
for(let i=0;i<2;i++)$('mark-eye-'+i).onclick=()=>{eyeMark=i;report('Click the center of eye '+(i+1)+' in the preview.');};
$('eye-regions').onclick=e=>{
 if(stage!=='camera-preview'||!isEyeCrop())return;
 const s=stream.getVideoTracks()[0].getSettings(),c=cameraCrop(s.width,s.height,frameCrop),point=previewEyePoint(e.clientX,e.clientY,$('eye-regions').getBoundingClientRect(),c.width,c.height);
 if(!point)return;eyeRegions=markedEyeRegions(eyeRegions.map((r,i)=>i===eyeMark?{...r,...point}:r),c.width,c.height);
 if(!validEyeRegions(eyeRegions)){report('Mark two different eyes.');drawEyeRegions();return;}
 updateEyeRegions();eyeMark=1-eyeMark;report('Eye marked. The boxes size themselves from the distance between your eyes and then follow them.');
};
$('find-eyes').onclick=()=>{if(stage!=='camera-preview'||!isEyeCrop()||!worker)return;trackedRegions=null;worker.postMessage({type:'find'});report('Looking for both eyes…');};
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
 $('camera-lens-status').textContent=physical.supported?(physical.lens==='wide'?'Wide-angle lens':'Telephoto lens')+(lensNote?' · '+lensNote:''):'Lens switching is unavailable for this camera or driver.';
 $('camera-active-lens').value=$('camera-lens').value;
 return physical;
}
function updateCropControls(){
 $('camera-crop').value=frameCrop.zoom;$('camera-crop-x').value=frameCrop.x;$('camera-crop-y').value=frameCrop.y;
 $('camera-crop-value').textContent=frameCrop.zoom.toFixed(2)+'×';
 $('camera').classList.toggle('crop-frame',frameCrop.zoom>1);faceFraming.reset();
 $('camera-active-lens').value=$('camera-lens').value;$('restore-lens-framing').hidden=!lensPreset();if(stage==='camera-preview')cameraPreviewPoll(generation);
 trackingUI();
}
function paintCameraFrame(c){
 if(frameCrop.zoom<=1)return;
 const canvas=$('camera-frame');if(canvas.width!==c.width||canvas.height!==c.height){canvas.width=c.width;canvas.height=c.height;}
 canvas.getContext('2d',{alpha:false}).drawImage($('video'),c.x,c.y,c.width,c.height,0,0,c.width,c.height);
}
function cameraPreviewPoll(current){
 clearTimeout(cameraPreviewTimer);if(current!==generation||stage!=='camera-preview')return;
 if(!lensBusy&&!zoomQueue?.running)cameraZoomControls();
 const s=stream.getVideoTracks()[0].getSettings(),c=cameraCrop(s.width,s.height,frameCrop);
 const view=!isEyeCrop()&&faceFraming.view;
 $('camera-live').textContent=`${stream.getVideoTracks()[0].label} · capture ${s.width} × ${s.height} · tracker frame ${c.width} × ${c.height}`+(view&&view.size<.87*Math.min(c.width,c.height)?` · the tracker reads the ${view.size} × ${view.size} square around your face, ${(Math.min(c.width,c.height)/view.size).toFixed(1)}× closer than the whole picture`:'');
 cameraPreviewTimer=setTimeout(()=>cameraPreviewPoll(current),700);
}
for(const [id,key] of [['camera-crop','zoom'],['camera-crop-x','x'],['camera-crop-y','y']])$(id).oninput=()=>{frameCrop={...frameCrop,[key]:Number($(id).value)};updateCropControls();};
for(const lens of ['wide','telephoto'])$('camera-lens-'+lens).onclick=async()=>{lensChooser.cancel();lensNote='';handLensTried=true;const changed=await switchLens(lens);if(changed){rememberHandLens(lens);handLensFailed=false;lensChoice={by:'hand',lens};}lensEvent(changed?'chosen by hand':'hand choice not confirmed by the camera',{wanted:lens});};
// Changes the lens; returns whether the camera confirmed it. `automatic`: the app is choosing (see LensChooser).
async function switchLens(lens,automatic=false){
 // The app's own change just before a new calibration pauses that start, as a resolution change does.
 const aligning=automatic&&stage==='align',during=aligning?'camera-adjust':'camera-preview';
 if(stage!=='camera-preview'&&!aligning||lensBusy)return false;
 const track=stream?.getVideoTracks()[0],current=generation;cameraBusy(true);if(aligning)stage=during;
 try{
  zoomQueue??=new CameraZoomQueue(track);await zoomQueue.set(lensZoom(track,lens));
  // Allow the camera's physical switch and exposure to settle before setup.
  await new Promise(resolve=>setTimeout(resolve,400));if(current!==generation||stage!==during)return false;
  if(syncPhysicalLens().lens!==lens)throw Error('The camera did not confirm the lens change.');
  const saved=lensPreset();
  if(saved){await restoreCameraControls(track,saved);frameCrop=saved.crop||{zoom:1,x:.5,y:.5};if(saved.eyeRegions)eyeRegions=saved.eyeRegions.map(r=>({...r}));}
  else frameCrop={zoom:1,x:.5,y:.5};
  cameraChoiceDirty=true;chosenCameraSettings=null;updateCropControls();cameraZoomControls();
  // A different lens is a different view: start from any saved boxes, otherwise look afresh.
  if(isEyeCrop()){trackedRegions=null;worker?.postMessage({type:'regions',eyeRegions});if(!saved?.eyeRegions)worker?.postMessage({type:'find'});}
  if(!automatic)report((lens==='wide'?'Wide-angle':'Telephoto')+' lens selected. '+(saved?'Saved framing restored.':isEyeCrop()?'Looking for both eyes in the new view.':'Keep your full face visible, then use these settings.'));
  // The calibration about to be made belongs to the lens now in use.
  if(aligning){sessionSetup=setupStamp();cameraProbe=[];frameTimes=[];}
  return true;
 }catch(e){report(automatic?'The '+(lens==='wide'?'wide-angle':'telephoto')+' lens could not be selected automatically ('+e.message+').':'Lens switch: '+e.message);return false;}
 finally{cameraBusy(false);if(stage==='camera-preview')cameraZoomControls();if(aligning&&current===generation&&stage===during){alignmentStart=null;alignmentLast=0;stage='align';}}
}
// The app's own choice of lens while the camera is being set up: the telephoto
// when the whole face fits in it, because it puts more camera pixels on the eyes.
async function putBackHandLens(lens,current){
 handLensTried=true;const setup=stage==='camera-preview',next=setup?'Use these settings when the outlines follow your eyes.':newCalibrationAhead()?'Calibration starts when both eyes are clear.':'Starting when both eyes are clear.';
 lensEvent('camera is not on the lens chosen by hand',{wanted:lens});
 report(`Putting back the ${lensName(lens)} lens you chose. Stay as you are for a moment.`);
 const changed=await switchLens(lens,true);if(current!==generation)return;
 const now=lensControl(stream?.getVideoTracks()[0]).lens||null;handLensFailed=!changed;
 lensNote=changed?'your choice; put back because the camera had started on the other lens':`the ${lensName(lens)} lens you chose could not be selected`;syncPhysicalLens();
 lensChoice=changed?{by:'hand',lens,putBack:true}:{by:'hand',lens:now,wanted:lens,failed:true};
 lensEvent(changed?'put back':'could not be put back',{wanted:lens});
 report(changed?`${lens==='wide'?'Wide-angle':'Telephoto'} lens put back: the camera had started on the other one. ${next}`:`The camera did not change to the ${lensName(lens)} lens you chose, so the ${lensName(now)||'other'} lens is in use. Choose the lens again in Set camera / preview. ${next}`);
}
const LENS_EDGE={bottom:['your chin is cut off at the bottom of the picture','Tilt the camera down a little'],top:['the top of your face is cut off at the top of the picture','Tilt the camera up a little'],side:['your face is cut off at the side of the picture','Turn the camera towards you']};
async function chooseLens(data){
 const setup=stage==='camera-preview',current=generation;
 if(!lensBusy&&!zoomQueue?.running){const wanted=handLensWanted();if(wanted){await putBackHandLens(wanted,current);return;}}
 if(!setup&&!(stage==='align'&&lensAhead)||isEyeCrop()||lensBusy||zoomQueue?.running||lensChooser.state==='done')return;
 const track=stream?.getVideoTracks()[0],physical=lensControl(track);if(!physical.supported)return;
 const before=lensChooser.state,eyes=data.quality?.eyePixels||[],across=eyes.length?Math.round((eyes[0]+eyes[eyes.length-1])/2):null;
 const next=setup?'Use these settings when the outlines follow your eyes.':'Calibration starts when both eyes are clear.';
 const change=lensChooser.frame(physical.lens,data.face||null,performance.now(),frameCrop.zoom);
 if(change==='telephoto'){
  eyesBeforeLens=across;lensEvent('trying the telephoto lens');
  report('Trying the telephoto lens: it puts more of the camera on your eyes. Stay as you are for a few seconds.');
  const changed=await switchLens('telephoto',true);if(current!==generation)return;
  if(!changed){lensChooser.failed();lensTrialFailed=true;lensChoice={by:'app',lens:lensControl(track).lens||'wide',reason:lensChooser.reason};lensEvent('telephoto could not be selected');}
 }else if(change==='wide'){
  // A saved framing for this lens that cuts the face off is not the lens's fault: use the whole picture and look again.
  if(frameCrop.zoom>1){frameCrop={zoom:1,x:.5,y:.5};updateCropControls();if(!setup)sessionSetup=setupStamp();lensChooser.again(performance.now());return;}
  // Cut off at one edge but small enough to fit: the camera points past the face, which the person can change.
  const edge=LENS_EDGE[lensChooser.edge];
  lensNote=edge?`telephoto tried: ${edge[0]}. ${edge[1]}, then press Telephoto`:'telephoto tried: your whole face does not fit in it from here';lensTrialFailed=true;
  const back=await switchLens('wide',true);if(current!==generation)return;syncPhysicalLens();
  lensChoice={by:'app',lens:back?'wide':'telephoto',reason:lensChooser.reason,eyesBefore:eyesBeforeLens};lensEvent('telephoto tried and not kept',{reason:lensChooser.reason});
  report(back?(edge?`On the telephoto lens ${edge[0]}, so the wide-angle lens stays. ${edge[1]} and press Telephoto in Set camera / preview to use it. `:'Your whole face does not fit in the telephoto picture from where you sit, so the wide-angle lens stays. ')+next:'Your whole face does not fit in the telephoto picture, and the camera did not change back. Choose Wide-angle in Set camera / preview.');
 }else if(before==='watching'&&lensChooser.state==='done'&&lensChooser.kept){
  lensNote='chosen automatically: your whole face fits'+(across&&eyesBeforeLens?`, ${across} camera pixels across each eye instead of ${eyesBeforeLens}`:'');syncPhysicalLens();
  lensChoice={by:'app',lens:'telephoto',reason:lensChooser.reason,eyesBefore:eyesBeforeLens,eyesAfter:across};lensEvent('telephoto kept',{reason:lensChooser.reason});
  report('Telephoto lens kept: your whole face fits'+(across&&eyesBeforeLens?`, and each eye is now about ${across} camera pixels wide instead of ${eyesBeforeLens}`:'')+'. '+(setup?'Calibrate with this lens. Wide-angle remains available above.':next));
 }
}
$('restore-lens-framing').onclick=async()=>{
 const s=lensPreset(),track=stream?.getVideoTracks()[0];if(!s||!track)return;
 cameraBusy(true);try{await restoreCameraControls(track,s);frameCrop=s.crop||{zoom:1,x:.5,y:.5};if(s.eyeRegions)eyeRegions=s.eyeRegions.map(r=>({...r}));updateCropControls();cameraZoomControls();if(isEyeCrop()){trackedRegions=null;worker?.postMessage({type:'regions',eyeRegions});}report('Saved framing restored.');}catch(e){report(e.message);}finally{cameraBusy(false);}
};
$('windows-camera-settings').hidden=!desktop?.openCameraSettings;
$('windows-camera-settings').onclick=()=>desktop?.openCameraSettings().catch(()=>report('Open Windows Settings → Bluetooth & devices → Cameras.'));

// Eyes that are dark in the picture give the eye model little to work with.
// (One recorded session had the white of the eye at 50 of 255.)
function darkEyes(light=lastLight){
 const seen=(light||[]).filter(Boolean);
 return seen.length>0&&seen.reduce((s,l)=>s+l.white,0)/seen.length<100;
}
// How the eyes are lit, for the preview status line.
function lightText(){
 if(!lastLight||performance.now()-lightAt>2000||!lastLight.some(Boolean))return '';
 const white=lastLight.filter(Boolean).map(l=>l.white),glare=Math.max(...lastLight.filter(Boolean).map(l=>l.glare)),level=white.reduce((a,b)=>a+b,0)/white.length;
 return ' · eye brightness '+Math.round(level)+(level<130?' (dark)':level>205?' (too bright)':'')+(glare>.2?' · reflection over an iris: move the lamp, dim the screen, or tilt glasses slightly if you wear them':'');
}
// The picture adjustments as the camera had them before this app changed any,
// kept per camera so that everything can be put back, also on a later day.
function pictureOriginal(track){
 const key='hands-free.picture-original.'+(track.getSettings().deviceId||'default');
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&typeof saved==='object')return saved;}catch{}
 const now=Object.fromEntries(pictureControls(track).map(c=>[c.key,{value:c.value,automatic:c.automatic}]));
 try{localStorage.setItem(key,JSON.stringify(now));}catch{}
 return now;
}
// Sliders for the picture adjustments this camera reports.
function renderPicture(){
 const track=stream?.getVideoTracks()[0],controls=track?pictureControls(track):[];
 if(track&&controls.length)pictureOriginal(track);
 $('picture-tune').disabled=$('picture-probe').disabled=!track||pictureBusy;$('picture-auto').hidden=!controls.length;$('picture-auto').disabled=pictureBusy;
 $('picture-controls').replaceChildren(...controls.map(c=>{
  const label=document.createElement('label'),output=document.createElement('output'),input=document.createElement('input');
  const round=v=>Math.round(v*100)/100;
  // A camera can accept a value and keep its own. Show both when they differ.
  const show=(v,asked)=>{output.textContent=' '+(c.automatic&&v===undefined?'automatic':asked!==undefined&&Number.isFinite(v)&&Math.abs(v-asked)>Math.max(c.step,1e-9)?`${round(asked)} asked, camera reports ${round(v)}`:round(v??c.value??c.min));};
  input.type='range';input.min=c.min;input.max=c.max;input.step=c.step;input.value=c.value??c.min;input.setAttribute('aria-label',c.label);input.disabled=pictureBusy;show();
  const tested=pictureProbe?.results.filter(r=>r.key===c.key)||[],note=document.createElement('small');
  if(tested.length)note.textContent=' · '+(tested.some(r=>r.verdict==='works')?(tested[0].verdict==='works'?'changes the picture':'changes the picture once the exposure is held'):'no effect on this camera');
  input.oninput=async()=>{
   const asked=Number(input.value);
   try{const applied=await setPicture(track,c.key,asked);show(applied?.value??asked,asked);pictureLog.push({key:c.key,to:asked,reported:applied?.value??null,by:'slider'});cameraChoiceDirty=true;chosenCameraSettings=null;$('picture-status').textContent=lightText().replace(/^ · /,'');}
   catch(e){pictureLog.push({key:c.key,to:asked,error:String(e.message||e),by:'slider'});$('picture-status').textContent=c.label+': the camera rejected this ('+e.message+').';}
   if(pictureLog.length>200)pictureLog.splice(0,pictureLog.length-200);
  };
  label.append(c.label,output,note,input);return label;
 }));
 if(track&&!controls.length)$('picture-status').textContent='This camera’s driver does not report picture adjustments to the app. Use Windows camera settings or the camera maker’s app.';
}
// How the eyes were lit since a moment, averaged over its frames: one frame's
// reading wobbles by a level or two, which is what a small change looks like.
function settledLight(since){
 const recent=lightRecent.filter(entry=>entry.at>=since);if(recent.length<3)return null;
 const eyes=[0,1].map(i=>{const seen=recent.map(entry=>entry.light[i]).filter(Boolean);return seen.length?{white:seen.reduce((s,l)=>s+l.white,0)/seen.length,clipped:Math.max(...seen.map(l=>l.clipped||0))}:null;});
 return eyes.some(Boolean)?eyes:null;
}
// The picture as numbers, for testing what the camera's adjustments do: the
// whole view reduced to 64 x 36, and 96 x 96 camera pixels at the face (or the
// middle of the view), where sharpness and focus show. Nothing is kept.
function pictureSample(){
 const video=$('video'),w=video.videoWidth,h=video.videoHeight;if(!(w>=96&&h>=96))return [[],[]];
 sampleCanvas??=document.createElement('canvas');sampleCanvas.width=96;sampleCanvas.height=132;
 const ctx=sampleCanvas.getContext('2d',{willReadFrequently:true}),c=cameraCrop(w,h,frameCrop),v=!isEyeCrop()&&faceFraming.view;
 const cx=v?c.x+v.x+v.size/2:w/2,cy=v?c.y+v.y+v.size/2:h/2;
 ctx.drawImage(video,0,0,w,h,0,0,64,36);
 ctx.drawImage(video,Math.max(0,Math.min(w-96,Math.round(cx-48))),Math.max(0,Math.min(h-96,Math.round(cy-48))),96,96,0,36,96,96);
 const colours=d=>{const out=new Uint8Array(d.length/4*3);for(let i=0,j=0;i<d.length;i+=4){out[j++]=d[i];out[j++]=d[i+1];out[j++]=d[i+2];}return out;};
 return [colours(ctx.getImageData(0,0,64,36).data),colours(ctx.getImageData(0,36,96,96).data)];
}
// The average brightness of the whole view, 0 to 255.
function pictureMean(){const whole=pictureSample()[0];if(!whole.length)return null;let sum=0;for(let i=0;i<whole.length;i++)sum+=whole[i];return sum/whole.length;}
const PROBE_VERDICT={works:'changes the picture','reported only':'the camera reports the new value, but the picture does not change',ignored:'no effect: the camera keeps its own value',rejected:'refused by the camera'};
function renderProbe(){
 const results=pictureProbe?.results||[];$('picture-report').hidden=!results.length;
 $('picture-report').replaceChildren(...results.map(r=>{const item=document.createElement('li');item.textContent=`${r.label}: ${PROBE_VERDICT[r.verdict]}${r.verdict==='works'&&Math.abs(r.brighter)>=3?(r.brighter>0?' (brighter)':' (darker)'):''}${r.error?' ('+r.error+')':''}`;return item;}));
}
// Moves every adjustment the camera reports, watches whether the picture
// follows, and puts each one back. A camera can report a value it ignores, so
// the picture is the only witness.
async function probeCamera(){
 const track=stream?.getVideoTracks()[0];if(!track||stage!=='camera-preview'||pictureBusy)return;
 const run=++pictureRun;pictureBusy=true;renderPicture();
 $('picture-status').textContent='Testing the camera. The picture will change for a moment at a time. Please sit still.';
 let results=[];
 try{results=await probePicture(track,async()=>pictureSample(),{cancelled:()=>run!==pictureRun,onProgress:(r,i,n)=>{if(run===pictureRun)$('picture-status').textContent=`Testing ${r.label.toLowerCase()} (${i} of ${n}). The picture will change for a moment. Please sit still.`;}});}
 catch(e){results=[];$('picture-status').textContent='The test stopped: '+e.message;}
 if(run!==pictureRun)return;
 pictureBusy=false;pictureProbe={at:new Date().toISOString(),results};
 const working=new Set(results.filter(r=>r.verdict==='works').map(r=>r.key)).size,total=new Set(results.map(r=>r.key)).size;
 if(results.length)$('picture-status').textContent=!total?'':working===total?`All ${total} adjustments change the picture.`:working?`${working} of ${total} adjustments change the picture. The others are listed below.`:'The camera took the requests and its picture did not change. If the camera maker’s app is open, close it and test again; otherwise its settings can only be changed there or in Windows camera settings.';
 else if(!$('picture-status').textContent.startsWith('The test stopped'))$('picture-status').textContent='This camera’s driver does not report picture adjustments to the app. Use Windows camera settings or the camera maker’s app.';
 renderProbe();renderPicture();
}
$('picture-probe').onclick=probeCamera;
// Sets the camera's brightness from how the eyes themselves are lit.
async function tunePicture(){
 const track=stream?.getVideoTracks()[0];if(!track||stage!=='camera-preview'||pictureBusy)return;
 const run=++pictureRun,tuner=new PictureTuner(track);let waits=0;
 pictureBusy=true;renderPicture();$('picture-status').textContent='Reading how your eyes are lit…';
 for(;;){
  const since=performance.now();
  // Give the camera time to apply a change, then use a reading taken after it.
  await new Promise(resolve=>setTimeout(resolve,900));
  // Interrupted (the preview was left): put back whatever was changed so far.
  if(run!==pictureRun||stage!=='camera-preview'){try{await tuner.restore();}catch{}return;}
  const light=settledLight(since+350);
  // Before the first reading the eyes have to be found. After it, losing them
  // is the tuner's to deal with: a burnt-out or black picture loses them too.
  if(!light&&tuner.first===null){if(++waits>10){$('picture-status').textContent='Both eyes must be found first. Check that the outlines follow your eyes, then try again.';pictureBusy=false;renderPicture();return;}continue;}
  let result;try{result=await tuner.step(light,{picture:pictureMean()});}catch(e){try{await tuner.restore();}catch{}result={done:true,message:'The camera rejected a change, so the picture was put back as it was ('+e.message+').'};}
  if(run!==pictureRun)return;
  if(result.done){pictureBusy=false;pictureLog.push(...tuner.log.map(entry=>({...entry,by:'button'})));cameraChoiceDirty=true;chosenCameraSettings=null;}
  $('picture-status').textContent=result.message;renderPicture();
  if(result.done)return;
 }
}
$('picture-tune').onclick=tunePicture;
$('picture-auto').onclick=async()=>{
 const track=stream?.getVideoTracks()[0];if(!track||pictureBusy)return;pictureRun++;
 // Values first, then whatever the camera set by itself goes back to automatic.
 const original=pictureOriginal(track);
 for(const c of pictureControls(track)){const was=original[c.key];if(was&&!was.automatic&&Number.isFinite(was.value)&&c.canManual)try{await setPicture(track,c.key,was.value);}catch{}}
 for(const c of pictureControls(track))if(c.canAuto&&original[c.key]?.automatic!==false)try{await setPicture(track,c.key,'auto');}catch{}
 pictureLog.push({by:'put back'});renderPicture();cameraChoiceDirty=true;chosenCameraSettings=null;$('picture-status').textContent='The picture is back as the camera had it before this app changed it.';
};
// Re-centring from the buttons a person selects (see Recentre). On unless switched off.
const recentre=new Recentre();let recentreFor=null,gazeTrail=[],recentreTold={x:0,y:0};
try{$('auto-recentre').checked=localStorage.getItem('hands-free.auto-recentre')!=='0';}catch{}
const recentreOn=()=>$('auto-recentre').checked;
$('auto-recentre').onchange=()=>{try{localStorage.setItem('hands-free.auto-recentre',$('auto-recentre').checked?'1':'0');}catch{}if(!recentreOn()){recentre.reset();gazeTrail=[];recentreTold={x:0,y:0};}};
// The head-movement step after the calibration dots (see beginHeadMove). On unless switched off.
// 0.4.34 to 0.4.36 had it off unless switched on, because in three sessions its frames had not been
// clear enough to use and the checks after it read no better. That compared different days and
// lenses. The first session with a laptop's own camera (21 Nov, the step switched back on by hand)
// compared like with like: the map that uses head position checked at 73 px and passed; the same
// check with the maps the app would have used without the step read 120 px (eyes only) and 225 px
// (eyes and eyelids), and failed. The head sat lower and more turned at the check than at any
// calibration dot, which is what the step is for. Replayed with today's code, one of the three
// earlier sessions gains as well (156 px against 222) and the other two are unchanged.
// When no head movement is measured the step ends by itself after its first dot.
// Eyes close-up tracking cannot see the head, so the step is left out there.
try{$('head-move').checked=localStorage.getItem('hands-free.head-move')!=='0';}catch{}
$('head-move').onchange=()=>{try{localStorage.setItem('hands-free.head-move',$('head-move').checked?'1':'0');}catch{}};
const headMoveOn=()=>$('head-move').checked&&!isEyeCrop();
// The eyelid input (see lidOpening in screen-gaze.mjs): how far the eyes are open, read beside the
// iris for up and down. On unless switched off; a new calibration is needed for a change to count.
try{$('lid-input').checked=localStorage.getItem('hands-free.lid-input')!=='0';}catch{}
$('lid-input').onchange=()=>{try{localStorage.setItem('hands-free.lid-input',$('lid-input').checked?'1':'0');}catch{}};
// A light screen is the largest reflection in a pair of glasses.
try{$('dim-capture').checked=localStorage.getItem('hands-free.dim-capture')==='1';}catch{}
document.body.classList.toggle('dim-capture',$('dim-capture').checked);
$('dim-capture').onchange=()=>{document.body.classList.toggle('dim-capture',$('dim-capture').checked);try{localStorage.setItem('hands-free.dim-capture',$('dim-capture').checked?'1':'0');}catch{}};
// ---- What the profile keeps besides its calibrations ----------------------------------------------
// The options above, the keyboard's, and the camera picked from the list are saved under the
// profile's name as they are changed, and come back when that profile is chosen. Until 0.4.41
// the options were one set for everybody on the computer, and a camera was kept only inside a
// finished calibration: picked and not yet calibrated, it was "Default camera" again next time.
const OPTION_BOXES={dimCapture:'dim-capture',autoRecentre:'auto-recentre',headMove:'head-move',lidInput:'lid-input'};
function currentOptions(){return {...Object.fromEntries(Object.entries(OPTION_BOXES).map(([key,id])=>[key,$(id).checked])),calibrationMode:$('calibration-mode').value,keyboardLayout,autocorrect,readingDock};}
function rememberOptions(){if(profileKey())writeProfile(kept,profileKey(),{controls:currentOptions(),setup:{mode:$('camera-mode').value,tracking:$('tracking-mode').value}});}
function applyOptions(saved){
 if(!saved)return;
 for(const [key,id] of Object.entries(OPTION_BOXES))if(typeof saved[key]==='boolean')$(id).checked=saved[key];
 document.body.classList.toggle('dim-capture',$('dim-capture').checked);
 if(!recentreOn()){recentre.reset();gazeTrail=[];recentreTold={x:0,y:0};}
 if(saved.calibrationMode)$('calibration-mode').value=saved.calibrationMode;
 if(saved.keyboardLayout)keyboardLayout=saved.keyboardLayout;
 if(typeof saved.autocorrect==='boolean')autocorrect=saved.autocorrect;
 if(saved.readingDock)readingDock=saved.readingDock;
}
for(const id of [...Object.values(OPTION_BOXES),'calibration-mode'])$(id).addEventListener('change',rememberOptions);
// The camera picked from the list, by hand. "Default camera" is a pick too.
function rememberCamera(){
 if(!profileKey())return;
 const option=$('camera-device').selectedOptions[0];
 writeProfile(kept,profileKey(),{camera:{deviceId:$('camera-device').value,label:$('camera-device').value?option?.textContent||'':''}});
}
let cameraNote='',pickedForProfile=false,connectedCameras=[];
// Puts the profile's options back, and its camera: the one picked for it, or, with none picked,
// the better camera when it is plugged in (see chooseCamera). The camera of a saved calibration is
// put back by cameraPreferences with everything else the calibration was made with, as before;
// this only steps in when another camera is to be used.
function applyProfile(options=true){
 const profile=readProfile(kept,profileKey());if(options)applyOptions(profile.controls);
 cameraNote='';if(stream||!profileKey())return;
 const record=rootSaved(),made=record?.setup||null;
 const pick=chooseCamera(connectedCameras,{saved:profile.camera,calibrated:made?{deviceId:made.deviceId,label:made.cameraLabel}:null});
 if(pick.missing)cameraNote=pick.missing+' is not connected. Plug it in and press Refresh cameras, or go on with the camera shown.';
 if(made&&(pick.reason==='calibration'||!pick.deviceId||pick.deviceId===made.deviceId)){
  // Back to the calibration's own camera, when it was this function that had moved away from it.
  if(pickedForProfile){pickedForProfile=false;cameraChoiceDirty=false;chosenCameraSettings=null;}
  return;
 }
 if(profile.setup){$('camera-mode').value=profile.setup.mode;$('tracking-mode').value=profile.setup.tracking;trackingUI();}
 if(!pick.deviceId)return;
 if(!Array.from($('camera-device').options).some(o=>o.value===pick.deviceId))$('camera-device').add(new Option(pick.label||'Saved camera',pick.deviceId));
 $('camera-device').value=pick.deviceId;
 if(made){cameraChoiceDirty=true;chosenCameraSettings=null;pickedForProfile=true;}
 if(pick.reason==='fancy')cameraNote=(pick.label||'The better camera')+' is plugged in and will be used'+(made?', with its own calibration. The calibration made with '+(made.cameraLabel||'the other camera')+' stays saved.':'.')+' Another camera can be chosen above; the choice is kept for this profile.';
}
async function listCameras(requestPermission=false){
 try{const chosen=$('camera-device').value;let devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
  if(requestPermission&&!stream&&(!devices.length||devices.every(d=>!d.label))){const temporary=await navigator.mediaDevices.getUserMedia({video:true,audio:false});temporary.getTracks().forEach(t=>t.stop());devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');}
  devices=devices.filter(d=>d.deviceId);connectedCameras=devices.map(d=>({deviceId:d.deviceId,label:d.label||''}));
  $('camera-device').replaceChildren(new Option('Default camera',''),...devices.map((d,i)=>new Option(d.label||`Camera ${i+1}`,d.deviceId)));
  if(devices.some(d=>d.deviceId===chosen))$('camera-device').value=chosen;
 }catch{report('Camera list unavailable. Check Windows camera permission.');}
}
let savedCameraText='';
function cameraPreferences(saved){
 if(!saved?.setup||cameraChoiceDirty)return;
 const s=saved.setup;if(s.deviceId&&!Array.from($('camera-device').options).some(o=>o.value===s.deviceId))$('camera-device').add(new Option(s.cameraLabel||'Saved camera',s.deviceId));
 frameCrop=s.crop||{zoom:1,x:.5,y:.5};$('tracking-mode').value=s.trackingMode||'face';if(s.eyeRegions)eyeRegions=s.eyeRegions.map(r=>({...r}));updateCropControls();$('camera-device').value=s.deviceId;$('camera-mode').value=s.cameraMode||'auto';$('camera-lens').value=s.lens||'unspecified';$('camera-remote-zoom').value=s.externalZoom??'';
 savedCameraText=s.cameraVersion?`${s.cameraLabel||'Saved camera'} · ${s.width} × ${s.height} · ${s.lens}${s.externalZoom?' · remote zoom '+s.externalZoom+'×':''}`:'';
 $('camera-saved').textContent=savedCameraText||'Older calibration: camera zoom was not recorded. Use a new calibration for this camera.';
}
function cameraZoomControls(preserveSlider=false){
 const track=stream?.getVideoTracks()[0],cap=track?.getCapabilities?.().zoom,zoom=track?.getSettings().zoom;
 const physical=syncPhysicalLens(),supported=Number.isFinite(cap?.min)&&cap.max>cap.min&&Number.isFinite(zoom)&&!physical.lensOnly;
 $('camera-zoom-row').hidden=!supported;$('camera-zoom-note').hidden=supported;
 $('camera-zoom-note').textContent=physical.lensOnly?'At this resolution the camera’s zoom control only switches between its two lenses (the buttons above). Zooming further would crop the picture, which the tracker already does around your face: the dashed square.':'Camera zoom is unavailable in this driver. Try Windows camera settings.';
 $('restore-lens-framing').hidden=!lensPreset();
 if(supported){const control=$('camera-zoom');control.min=cap.min;control.max=cap.max;control.step=cap.step||.01;if(!preserveSlider)control.value=zoom;$('camera-zoom-value').textContent=`${zoom} / ${cap.max} device units`;}
}
function finishCameraPreview(){
 if(lensBusy||zoomQueue?.running)return;
 if(isEyeCrop()&&validEyeRegions(trackedRegions))eyeRegions=trackedRegions.map(r=>({...r}));
 if(isEyeCrop()&&!validEyeRegions(eyeRegions)){report('Mark two different eyes before continuing.');return;}
 sessionSetup=setupStamp();rememberCameraPreset(sessionSetup);chosenCameraSettings=sessionSetup;worker?.terminate();worker=null;ready=false;inFlight=false;$('eye-regions').hidden=true;$('camera-settings').hidden=true;document.body.classList.remove('camera-preview');
 clearTimeout(cameraPreviewTimer);cameraPreviewTimer=null;cameraChoiceDirty=true;stage='camera-ready';$('workspace').hidden=true;$('welcome').hidden=false;$('camera').hidden=true;$('tracking-info').hidden=true;refreshProfile();const saved=loadSaved();report(saved&&sameSetup(saved.setup,sessionSetup)?'Framing kept. This lens’s saved calibration is ready.':'Framing kept. Calibrate this lens when ready.');
}
$('camera-preview').onclick=()=>startCamera('camera');$('camera-use').onclick=finishCameraPreview;$('camera-refresh').onclick=()=>listCameras(true);
for(const id of ['camera-device','camera-mode','camera-lens','camera-remote-zoom'])$(id).onchange=()=>{cameraChoiceDirty=true;chosenCameraSettings=null;pickedForProfile=false;if(id==='camera-device'){cameraNote='';rememberCamera();}rememberOptions();refreshProfile();
 // The line under Tracking described the saved calibration and went on doing so, unlabelled, with another camera chosen.
 if(savedCameraText)$('camera-saved').textContent=`Your saved calibration was made with: ${savedCameraText}. Another camera or resolution gets its own calibration.`;};
$('tracking-mode').onchange=()=>{
 cameraChoiceDirty=true;chosenCameraSettings=null;const saved=loadSaved()?.setup;
 if(saved){chosenCameraSettings=saved;frameCrop=saved.crop||{zoom:1,x:.5,y:.5};if(saved.eyeRegions)eyeRegions=saved.eyeRegions.map(r=>({...r}));$('camera-mode').value=saved.cameraMode||'auto';}
 trackingUI();rememberOptions();refreshProfile();
};
$('camera-zoom').oninput=async()=>{
 if(!stream||stage!=='camera-preview'||lensBusy)return;
 zoomQueue??=new CameraZoomQueue(stream.getVideoTracks()[0]);for(const id of ['camera-use','camera-lens-wide','camera-lens-telephoto','restore-lens-framing'])$(id).disabled=true;
 try{await zoomQueue.set(Number($('camera-zoom').value));if(stage==='camera-preview')cameraZoomControls(true);}catch{report('Camera rejected this zoom. Use Windows settings or try 1080p.');}finally{cameraBusy(false);}
};
$('camera-zoom').onchange=async()=>{try{await zoomQueue?.running;}catch{}if(stage==='camera-preview')cameraZoomControls();};
await listCameras();navigator.mediaDevices?.addEventListener('devicechange',async()=>{await listCameras();if(!stream&&stage==='welcome'){applyProfile(false);refreshProfile();}});

function rootSaved(){
 const native=nativeProfiles.find(p=>p.name.toLocaleLowerCase()===profileKey())?.record;
 if(native)return native;
 try{const all=JSON.parse(localStorage.getItem(KEY)||'{}');return Object.hasOwn(all,profileKey())?all[profileKey()]:null;}catch{return null;}
}
function loadSaved(){
 const record=identifySavedLens(rootSaved(),stream?.getVideoTracks()[0]);
 if(cameraChoiceDirty)return calibrationForLens(record,$('camera-device').value,$('camera-lens').value,$('tracking-mode').value);
 // The lens pressed by hand is the one to use. When the calibration saved last was made with
 // the other lens (the camera had come up on it), the chosen lens's own calibration is used.
 const s=record?.setup,hand=s&&!handLensFailed?handLensFor(s.deviceId):null;
 if(hand&&['wide','telephoto'].includes(s.lens)&&s.lens!==hand){const own=calibrationForLens(record,s.deviceId,hand,s.trackingMode||'face');if(own&&validModel(own.model))return own;}
 return record;
}
// 0.4.18 marked a camera-pixel map with text, which the companion refuses to
// store (numbers and true/false only). Such a map is rewritten with the flag.
const savable=m=>{if(m?.signal!=='detail')return m;const {signal,...rest}=m;return {...rest,irisPixels:true};};
async function saveModel(updatePosition=true){
 if(!profileKey()||!validModel(model))return;
 model=savable(model);headPositions=headPositions.map(e=>e.model?.signal==='detail'?{...e,model:savable(e.model)}:e);
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
 const saved=loadSaved(),known=saved&&validModel(saved.model);cameraPreferences(saved);
 if(cameraNote)$('camera-saved').textContent=cameraNote;else if(!savedCameraText&&!saved?.setup)$('camera-saved').textContent='';
 // A close-up map made by an earlier tracker reads the eyes differently. Offer a
 // new calibration instead of quietly pointing with the old one.
 const outdated=known&&saved.setup?.trackingMode==='eyes'&&(saved.setup.eyeTracker||1)!==EYE_TRACKER_REVISION,usable=known&&!outdated;
 const prepared=saved&&(stage==='camera-ready'&&sessionSetup&&sameSetup(saved.setup,sessionSetup)||chosenCameraSettings&&sameSetup(saved.setup,chosenCameraSettings));
 $('start').textContent=known?(outdated||cameraChoiceDirty&&!prepared||!saved.setup?.cameraVersion?'Start new calibration':'Use saved calibration'):desktop?'Start camera & setup':'Try eye control in this browser';
 $('restore').hidden=!usable;
 $('return-saved').hidden=!usable;
 $('align-saved').hidden=!usable;
 $('eye-only-saved').hidden=!usable;$('refine-saved').hidden=!usable;
 $('positions-saved').hidden=!usable;
 $('positions-count').textContent=usable?`${savedHeadPositions(saved).length} head position(s) saved`:'';
 $('test-saved').hidden=!usable;$('test-description').hidden=!usable;
 $('profile-status').textContent=outdated?'Eyes close-up tracking changed in version 0.4.17. This profile needs one new calibration for close-up mode.':known?(saved.validation?.passed?'Calibration saved':'Calibration saved · alignment needed'):'Create a calibration for this profile';$('new-calibration').hidden=!usable;
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
 const unit=.05*poseZoom(reference.scale),x=(side?345:115)-(head.x-reference.x)/unit*36,y=110+(head.y-reference.y)/unit*36;
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
$('person').oninput=()=>{cameraChoiceDirty=false;chosenCameraSettings=null;pickedForProfile=false;applyProfile();refreshProfile();};
$('start').disabled=true;
try{if(desktop?.loadCalibrations){const saved=await desktop.loadCalibrations();nativeProfiles=saved.profiles||[];if(saved.lastName)$('person').value=saved.lastName;}}catch{report('Saved profiles could not be read. You can still start a new calibration.');}
$('start').disabled=false;applyProfile();refreshProfile();
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
  rememberOptions();
  if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Use HTTPS or localhost to enable the camera.');
  report('Allow the selected camera when asked.');
  // "Default camera" with no saved calibration to go by: the profile's camera is used, or the
  // better camera when one is plugged in. A browser names no cameras before the camera has been
  // allowed once, so the names are asked for here (this is when the browser asks permission).
  if(!keepStream&&!$('camera-device').value&&!(mode!=='train'&&mode!=='camera'&&!cameraChoiceDirty&&loadSaved()?.setup)){
   await listCameras(true);if(current!==generation)return;
   applyProfile(false);if(cameraNote)report(cameraNote);
  }
  const saved=loadSaved(),reuse=mode!=='train'&&mode!=='camera'&&!cameraChoiceDirty&&saved?.setup,balanced=$('camera-mode').value==='balanced';
  const chosen=$('camera-device').value||reuse?.deviceId||'';
  trackingRuns.clear();cameraProbe=[];frameTimes=[];cameraStats=null;cameraProbeDone=!!reuse||$('camera-mode').value!=='auto';alignmentError='';
  const ask=cameraMode=>navigator.mediaDevices.getUserMedia(videoConstraints({deviceId:chosen,mode:cameraMode,saved:reuse,ptz:!!navigator.mediaDevices.getSupportedConstraints?.().zoom}));
  let acquired=keepStream?stream:null,resolutionNote='';
  if(!acquired){
   try{acquired=await ask($('camera-mode').value);}
   catch(e){
    // A resolution chosen for one camera stays chosen when another camera is picked, and that one
    // may not have it: a laptop's own camera has no 4K. Until 0.4.34 the start then stopped with a
    // line of small print under the setup panel, which read as "the buttons do nothing". A saved
    // calibration needs its own resolution. Anything else goes on with what this camera can give,
    // and says so.
    if(e.name!=='OverconstrainedError'||e.constraint==='deviceId'||reuse||$('camera-mode').value==='auto')throw e;
    const wanted=$('camera-mode').selectedOptions[0]?.textContent.split(' · ')[0]||'the chosen resolution';
    acquired=await ask('auto');
    if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
    $('camera-mode').value='auto';cameraProbeDone=false;
    const got=acquired.getVideoTracks()[0].getSettings();
    resolutionNote=`This camera cannot give ${wanted}: it is used at ${got.width} × ${got.height}. `;
   }
  }
  if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
  stream=acquired;const chosenBefore=chosenCameraSettings?.deviceId===stream.getVideoTracks()[0].getSettings().deviceId?chosenCameraSettings:null;let restoreFailed=false;
  if(mode!=='camera'&&!keepStream){
   // A saved calibration needs the camera exactly as it was. A new calibration does not: when the
   // settings chosen in the preview cannot be put back, it goes on with the camera as it is (the
   // lens chosen by hand is still put back before the first dot; see putBackHandLens).
   try{await restoreCameraControls(stream.getVideoTracks()[0],reuse||chosenBefore);}
   catch(e){if(reuse)throw e;restoreFailed=true;cameraChoiceDirty=true;chosenCameraSettings=null;}
  }
  await listCameras();$('camera-device').value=stream.getVideoTracks()[0].getSettings().deviceId||'';stream.getVideoTracks()[0].onended=()=>fail('The camera disconnected. Reconnect it and start setup again.');
  $('video').srcObject=stream;await $('video').play();
  if(current!==generation)return;syncPhysicalLens();sessionSetup=setupStamp();$('retry-point').hidden=true;
  lensEvent('camera started',{mode,kept:keepStream,restored:mode!=='camera'&&!keepStream?(restoreFailed?'settings chosen in the preview could not be put back':reuse?'saved calibration':chosenBefore?'settings chosen in the preview':'nothing'):'nothing',wanted:(reuse||chosenBefore||{}).lens??null,byHand:handLens()});
  $('welcome').hidden=true;$('workspace').hidden=false;$('workspace').classList.add('calibrating');setCameraPreview(true);$('cal-message').hidden=true;$('cal-dot').hidden=true;$('tiles').hidden=true;
  $('workspace').classList.remove('previewing');$('accuracy-preview').hidden=true;$('preview-check').hidden=true;
  if(mode==='camera'){
   stage='camera-preview';armLensChooser(45);zoomQueue=new CameraZoomQueue(stream.getVideoTracks()[0]);updateCropControls();document.body.classList.add('camera-preview');$('camera-settings').hidden=false;$('mode-label').textContent='Camera preview';cameraZoomControls();
   const s=stream.getVideoTracks()[0].getSettings();$('camera-live').textContent=`${stream.getVideoTracks()[0].label} · ${s.width} × ${s.height} · ${Math.round(s.frameRate||0)} capture fps`;
   cameraBusy(false);trackingUI();renderPicture();report(resolutionNote+(isEyeCrop()?'Finding both eyes. Keep both eyes in view; nothing needs to be clicked.':'Keep your full face visible. Choose a lens, then use these settings.'));cameraPreviewPoll(current);
  }
  cameraSettingsAt=0;
  worker=new Worker('/screen-worker.mjs',{type:'module'});
  worker.onerror=()=>fail('Eye tracking stopped. Restart camera setup.');
  worker.onmessage=async({data})=>{
   if(current!==generation)return;
   if(data.type==='ready'){
    ready=true;
    if(mode==='camera'){report(resolutionNote+(isEyeCrop()?'Check that the blue outlines follow both eyes. If they do not, choose Find eyes automatically or click each eye.':'Check that the outlines follow both eyes. The camera picture does not zoom: the dashed square is the part of it the tracker reads, at full camera detail, and it follows your face.'));return;}
    if(mode==='find'){
     stage='starting';try{await startAligned(mode);}catch(e){fail(e.message);}return;
    }
    waitingMode=mode;alignmentStart=null;stage='align';armLensChooser(20);$('mode-label').textContent='Camera check';$('tiles').hidden=true;$('cal-dot').hidden=true;setCameraPreview(true);$('tracking-info').hidden=false;report(resolutionNote+(isEyeCrop()?'Keep both eyes in view. Calibration starts when they are clear.':'Face the camera. Calibration starts when both eyes are clear.'));return;
   }
   if(data.type==='error'){inFlight=false;fail('Eye model could not run: '+data.message);return;}
   if(data.type==='sample'){
    inFlight=false;lastReceived=performance.now();drawEyes(data.eyes,data.width,data.height);
    if(!isEyeCrop())faceFraming.update(data.face||null,data.width,data.height);
    // Only the whole camera picture has edges the person can do something about by moving the camera.
    if(!isEyeCrop()&&frameCrop.zoom===1){faceEdges.add(data.face||null);const past=faceEdges.frames[faceEdges.frames.length-1];if(capture&&data.face&&['train','move','check'].includes(capture.kind)){edgeTally.frames++;if(past)edgeTally[past]++;}}else faceEdges.reset();
    chooseLens(data);
    if(data.quality?.light){lastLight=data.quality.light;lightAt=lastReceived;lightRecent.push({at:lastReceived,light:lastLight});if(lightRecent.length>90)lightRecent.shift();}
    if(data.regions&&isEyeCrop()){trackedRegions=data.regions;if(stage==='camera-preview')drawEyeRegions();}
    const reason=data.quality?.reason||(data.feature?'usable':'no-face');lastFrameReason=reason;lastQuality=data.quality?.oneEye&&data.feature?`Reflection over your ${data.quality.oneEye} eye. Reading the other eye.`:QUALITY[reason]||'Waiting for clear eyes';
    // A whole-frame eye search is slow by design; it says nothing about per-frame speed.
    const delay=Math.max(0,lastReceived-data.timestamp);if(reason!=='searching'){cameraProbe.push(delay);if(cameraProbe.length>60)cameraProbe.shift();}frameTimes.push(lastReceived);frameTimes=frameTimes.filter(t=>lastReceived-t<3000);
    cameraStats={width:$('video').videoWidth,height:$('video').videoHeight,processedWidth:data.width,processedHeight:data.height,cropZoom:frameCrop.zoom,processingMs:cameraProbe.length?Math.round(quantile(cameraProbe,.5)):0,fps:frameTimes.length>1?Math.round((frameTimes.length-1)*1000/(lastReceived-frameTimes[0])):0,eyePixels:data.quality?.eyePixels||[],...(data.face?{face:[data.face.x0,data.face.y0,data.face.x1,data.face.y1].map(v=>Math.round(v*1000)/1000)}:{}),...(lastLight&&lastReceived-lightAt<2000?{light:lastLight}:{})};
    const cameraText=`${cameraStats.width} × ${cameraStats.height} · ${cameraStats.fps} tracking fps · ${cameraStats.processingMs} ms processing`;
    $('camera-stats').textContent=cameraText;
    if(stage==='camera-preview'){
     // Each mode suits a different view; say so when the other one would also work.
     const spacing=validEyeRegions(trackedRegions)?Math.hypot(trackedRegions[1].x-trackedRegions[0].x,(trackedRegions[1].y-trackedRegions[0].y)*data.height/data.width):1;
     $('camera-eye-status').textContent=$('eye-crop-status').textContent=(isEyeCrop()&&reason==='usable'&&spacing<.2?'Your whole face fits in this view, so Face + eyes would also work and can follow head turns. ':'')+lastQuality+(cameraStats.eyePixels.length?' · eye width '+cameraStats.eyePixels.join(' / ')+' px'+(Math.min(...cameraStats.eyePixels)<56?' · small: zoom in or raise the resolution for more detail':''):'')+lightText()+' · '+cameraStats.fps+' fps'+(edgeAdvice()?' · '+edgeAdvice():'');return;
    }
    if(lastReceived-lastQualityAt>200){lastQualityAt=lastReceived;$('tracking-info').textContent=(lensInUse()?lensInUse()[0].toUpperCase()+lensInUse().slice(1)+' · ':'')+lastQuality+(cameraStats.eyePixels.length?' · Eye detail: '+cameraStats.eyePixels.join(' / ')+' px':'')+(edgeAdvice()?' · '+edgeAdvice():'')+(performance.now()-lightAt<2000&&darkEyes()?' · Eyes are dark in the picture: add light in front of you, or use Picture in Set camera / preview':'')+' · '+cameraText;}
    if(!['resizing','camera-adjust'].includes(stage)&&lastReceived-cameraSettingsAt>1000){cameraSettingsAt=lastReceived;
     const currentSetup=setupStamp();if(sessionSetup&&!sameSetup(sessionSetup,currentSetup)){fail('Camera zoom, framing, or resolution changed. Restore the saved settings or start a new calibration.');return;}
    }
    if(stage==='resizing'||stage==='point-help'||stage==='camera-adjust')return;
    if(stage==='align'){
     // Each mode suits a different view. Say so when this one cannot see what it needs.
     if(!isEyeCrop()&&reason==='no-face'){noFaceSince??=lastReceived;if(lastReceived-noFaceSince>4000)report('Face not found. If the camera is zoomed in on your eyes, go back and choose Tracking: Eyes close-up.');}else noFaceSince=null;
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
     if(lensHolding())return;
     if(data.feature&&lastReceived-data.timestamp<=1000){if(lastReceived-alignmentLast>1000)alignmentStart=null;alignmentStart??=lastReceived;alignmentLast=lastReceived;if(lastReceived-alignmentStart>=700){const mode=waitingMode;stage='starting';try{await startAligned(mode);}catch(e){fail(e.message);}}}return;
    }
    const maxAge=capture?1000:250;
    if(lastReceived-data.timestamp>maxAge||data.timestamp<=lastSample){if(capture){recordObservation(null,lastReceived,'stale-frame');report('Camera is running slowly. Waiting for a clear sample…');}else desktop?.heartbeat(false);return;}
    // A saved map reads one of the frame's two iris readings. While a new map
    // is being measured, both are kept so calibration can choose between them.
    const feature=['train','move'].includes(capture?.kind)?data.feature:signalFeature(data.feature,model);
    if(capture){rememberFrame(data,reason);if(!capture.seat&&capture.kind!=='move'&&capture.targets?.[capture.index])reflections.add(capture.targets[capture.index][1],reason,!!data.quality?.oneEye);}
    if(data.feature&&!feature){lastFrameReason='iris-detail';lastQuality=QUALITY['iris-detail'];}
    lastSample=data.timestamp;lastHeadFeature=data.head||data.feature||null;lastEyeFeature=feature;
    sample(feature,data.timestamp,lastHeadFeature);
   }
  };
  worker.postMessage({type:'init',trackingMode:$('tracking-mode').value,eyeRegions});report('Loading eye tracking locally…');frame(current);
 }catch(e){fail(e.name==='NotAllowedError'?'Camera permission was denied. Allow the camera, then try again.':e.name==='OverconstrainedError'?(e.constraint==='deviceId'?'The chosen camera was not found. Plug it in and press Refresh cameras, or choose another camera.':'This camera cannot give the resolution its saved calibration was made with. Choose the camera and resolution you want, then start a new calibration.'):e.name==='NotReadableError'?'The camera is busy. Close Camera/EMEET preview and try again.':e.message);}
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
function stopCamera(){if(stream)lensEvent('camera closed');clearTimeout(cameraPreviewTimer);cameraPreviewTimer=null;zoomQueue=null;trackedRegions=null;noFaceSince=null;faceFraming.reset();faceEdges.reset();edgeTally={frames:0,bottom:0,top:0,side:0};reflections.reset();lastLight=null;lightRecent=[];pictureRun++;pictureBusy=false;document.body.classList.remove('camera-preview');$('camera-settings').hidden=true;resetReturnGuide();lastHeadFeature=null;lastEyeFeature=null;returnRelease=false;positionSession=null;headSelector.reset();$('positions-dialog').close();generation++;ready=false;inFlight=false;lastVideo=-1;lastSample=0;lastReceived=0;lastFrame=0;sessionSetup=null;clearTimeout(resizeTimer);resizeTimer=null;pointRetry=null;waitingMode=null;worker?.terminate();worker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;setCameraPreview(false);$('tracking-info').hidden=true;}
function frame(current){
 if(current!==generation)return;
 const now=performance.now();
 if((ready||stage==='camera-preview')&&!inFlight&&now-lastFrame>=33&&$('video').readyState>=2&&$('video').currentTime!==lastVideo){
  lastFrame=now;lastVideo=$('video').currentTime;
  const c=cameraCrop($('video').videoWidth,$('video').videoHeight,frameCrop);paintCameraFrame(c);
  if(ready){
   inFlight=true;
   // Face + eyes is sent the square around the face at the camera's own
   // resolution. Close-up tracking reads its own eye boxes from the frame.
   const v=isEyeCrop()?{x:0,y:0,width:c.width,height:c.height,outWidth:c.width,outHeight:c.height}:faceFraming.next(c.width,c.height),resize=v.outWidth!==v.width||v.outHeight!==v.height;
   createImageBitmap($('video'),c.x+v.x,c.y+v.y,v.width,v.height,resize?{resizeWidth:v.outWidth,resizeHeight:v.outHeight,resizeQuality:'medium'}:{}).then(bitmap=>{if(current!==generation){bitmap.close();return;}worker.postMessage({type:'frame',bitmap,timestamp:now,view:{x:v.x,y:v.y,width:v.width,height:v.height,frameWidth:c.width,frameHeight:c.height}},[bitmap]);}).catch(()=>{inFlight=false;});
  }
 }
 // Keep capture running while the native overlay briefly hides or loses focus.
 setTimeout(()=>frame(current),ready?Math.max(4,34-(performance.now()-lastFrame)):34);
}
function setCameraPreview(visible){$('camera').hidden=!stream;$('camera').classList.toggle('preview-hidden',!visible);}
function drawEyes(eyes,width=$('video').videoWidth||640,height=$('video').videoHeight||480){
 // Video and overlay share object-fit:contain and centered letterboxing.
 drawEyeOverlay($('eyes'),eyes,width,height,!isEyeCrop()&&faceFraming.view?faceFraming.view:null);
}
function beginCapture(kind,eyeOnly=false,singleCheck=false,measureOnly=false){
 resultReport='';
 const bankCheck=kind==='check'&&!singleCheck&&!positionSession&&headPositions.length>1;
 // What re-centring has learned becomes part of the map before the map is
 // checked, so the check measures what the person has been using. Any other
 // capture replaces or re-aligns the map, and starts re-centring afresh.
 if(kind==='check'&&!bankCheck&&recentreOn()&&recentre.active){const moved=shiftedModel(model,recentre.shift);if(moved){model=moved;recentreFor=model;}}
 recentre.reset();gazeTrail=[];recentreTold={x:0,y:0};
 if(kind==='train'){headPositions=[];positionId=1;positionSession=null;$('positions-dialog').close();}
 headSelector.reset();
 hideComposer();$('more-controls').hidden=true;
 clearTestMode();$('test-result').hidden=true;$('result-positions').hidden=true;
 const previousCheck=['adjust','refine','offset'].includes(kind)&&validation?{meanPixels:validation.meanPixels,p90Pixels:validation.p90Pixels,validFraction:validation.validFraction}:null;
 // The map a repair starts from, and its check: kept so that a repair which does not check out can be undone (see completeCapture).
 const before=['adjust','refine','offset'].includes(kind)&&!positionSession?.pending&&validModel(model)?{model,validation,kind}:null;
 pause(false);uiRevision++;pointRetry=null;validation=null;stage=kind;alignmentError='';if(kind==='train'){edgeTally={frames:0,bottom:0,top:0,side:0};reflections.reset();lensEvent('calibration starts',{byHand:handLens(),eyePixels:cameraStats?.eyePixels||null});}const targets=kind==='train'?calibrationTargets($('calibration-mode').value==='detailed'):kind==='adjust'?ALIGN_TARGETS:kind==='refine'?REFINE_TARGETS:kind==='offset'?[[.5,.5]]:CHECK_TARGETS;capture={kind,eyeOnly,bankCheck,measureOnly,previousCheck,before,targets,index:0,pending:targets.slice(1).map((_,i)=>i+1),groups:[],samples:[],started:performance.now(),validMs:0,last:null,noticeAt:0};
 $('workspace').classList.remove('previewing');$('accuracy-preview').hidden=true;$('preview-check').hidden=true;
 $('workspace').classList.add('calibrating');
 sizeControls();
 $('tiles').hidden=true;$('snapshot').hidden=true;$('practice-scene').hidden=true;$('cal-dot').hidden=false;$('cal-message').hidden=true;$('gaze').hidden=true;setCameraPreview(false);$('tracking-info').hidden=true;$('retry-point').hidden=true;
 $('hint').textContent='Look at the dot until it moves. Blinking is okay.'+(isEyeCrop()?' Keep your head still and move only your eyes: this mode cannot see head turns.':'');
 $('mode-label').textContent=kind==='train'?'Calibration':kind==='adjust'?'Alignment':kind==='refine'?'Refine accuracy':kind==='offset'?'Quick alignment':'Accuracy check';seatOrStart();
}
// A dot near the top or bottom edge sits on one of the bars. The bar's text
// and buttons fade while it is there, so that nothing next to the dot draws
// the eyes away from it.
function dotOverBars(y){
 const half=28,at=y*innerHeight;
 $('workspace').classList.toggle('dot-top',at-half<document.querySelector('.statusbar').getBoundingClientRect().bottom);
 $('workspace').classList.toggle('dot-bottom',at+half>document.querySelector('.controlbar').getBoundingClientRect().top);
}
function nextPoint(retry=false){
 capture.samples=[];capture.sampleTimes=[];capture.observations=[];capture.started=performance.now();capture.validMs=0;capture.last=null;capture.noticeAt=0;
 if(!retry)capture.retries=0;
 const [x,y]=capture.targets[capture.index];$('cal-dot').style.left=x*100+'%';$('cal-dot').style.top=y*100+'%';dotOverBars(y);
 $('camera').style.left=x<.5?'auto':'20px';$('camera').style.right=x<.5?'20px':'auto';$('camera').style.top=y>.5?'100px':'auto';$('camera').style.bottom=y>.5?'auto':'110px';
 report(`${retry?'Let’s measure this point again. ':''}Look at the purple dot. ${capture.kind==='train'?'Point':capture.kind==='adjust'?'Alignment':capture.kind==='refine'?'Refinement':'Check'} ${capture.index+1} of ${capture.targets.length}.`);$('progress').value=0;
}
function recordObservation(feature,now,reason=lastFrameReason){
 if(!capture||now-capture.started<900)return;
 capture.observations.push({feature,now,reason});capture.observations=capture.observations.filter(o=>now-o.now<=4000);
}
async function collect(f,now,head=f){
 if(!capture)return;
 if(capture.kind==='move'){await collectMove(f,now);return;}
 if(capture.seat){seatStep(f,head,now);return;}
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
 if(capture.kind==='train'&&headMoveOn()){beginHeadMove(capture);return;}
 await completeCapture(capture);
}
// Back to the calibration position before a check. A check made with the head
// somewhere else measures the wrong thing: in the first recorded session with
// the head-movement step the head ended up lower and tilted, and nearly every
// frame of the two checks after it was outside the map's range. So before the
// first check dot the head has to be where the map was calibrated (every head
// reading within RETURN_WITHIN of its limit) and held there for a moment. A
// drawing shows the way, as in "Find your saved position". It only appears when
// the head is not in place; a person who sat still never sees it. After half a
// minute the check starts anyway, and its result says so.
const SEAT_HOLD_MS=600,SEAT_SHOW_MS=900,SEAT_LIMIT_MS=30000;
// A check repeated straight after one that began out of place does not wait a second time:
// the person evidently sits differently now, and has already been asked.
let seatWaived=false;
function seatOrStart(){
 const plan=capture.kind==='check'&&!capture.bankCheck&&!isEyeCrop()?calibrationReturnPlan(model):null;
 if(!plan){seatWaived=false;nextPoint();return;}
 if(seatWaived){seatWaived=false;capture.seated={matched:false,skipped:true,shown:false,waitedMs:0};nextPoint();return;}
 capture.seat={plan,started:performance.now(),since:null,shown:false,worst:null};
 $('cal-dot').hidden=true;$('progress').value=0;
 report('Checking that you sit as you sat for the calibration dots…');
}
function seatStep(eyes,head,now){
 // Frames taken before the wait began (they queue up while a map is being fitted) do not count.
 if(now<capture.seat.started)return;
 const seat=capture.seat,state=calibrationReturnFeedback(head,seat.plan);
 if(Number.isFinite(state.worst))seat.worst=state.worst;
 if(state.ready&&eyes)seat.since??=now;else seat.since=null;
 const held=seat.since===null?0:now-seat.since;
 if(held>=SEAT_HOLD_MS){startCheckDots(true,now);return;}
 if(now-seat.started>=SEAT_LIMIT_MS){startCheckDots(false,now);return;}
 if(!seat.shown){
  if(now-seat.started<SEAT_SHOW_MS)return;
  seat.shown=true;$('seat-guide').hidden=false;$('hint').textContent='Solid outline: where your head was for the dots. Dotted outline: where it is now.';
 }
 const ref=seat.plan.reference,visible=!!head&&seat.plan.fields.every(k=>Number.isFinite(head[k]))&&head.scale>0;
 $('seat-target-face').setAttribute('transform',guideTransform(ref,ref));$('seat-target-side').setAttribute('transform',guideTransform(ref,ref,true));
 for(const id of ['seat-live-face','seat-live-side'])$(id).style.visibility=visible?'visible':'hidden';
 if(visible){
  $('seat-live-face').setAttribute('transform',guideTransform(head,ref));$('seat-live-side').setAttribute('transform',guideTransform(head,ref,true));
  const shift=Math.max(-28,Math.min(28,-(head.yaw-ref.yaw)/.07*18))||0;$('seat-live-nose').setAttribute('d',`M${shift} -5L${shift+7} 14H${shift-5}`);
 }
 $('seat-guide').classList.toggle('matched',state.ready);
 const words=state.ready?(eyes?'In position. Hold here…':'In position. Open both eyes.'):state.message;
 $('seat-feedback').textContent=words;$('seat-progress').value=state.ready?held/SEAT_HOLD_MS:state.progress*.9;
 report(`Before the check: sit as you sat for the dots. ${words} The check starts by itself in ${Math.max(0,Math.ceil((SEAT_LIMIT_MS-(now-seat.started))/1000))} s.`);
}
function startCheckDots(matched,now,skipped=false){
 const seat=capture.seat;capture.seat=null;
 // Kept with the check's result. Numbers and true/false only.
 capture.seated={matched,skipped,shown:seat.shown,waitedMs:Math.round(now-seat.started),...(Number.isFinite(seat.worst)?{reach:Math.round(seat.worst*100)/100}:{})};
 $('seat-guide').hidden=true;$('cal-dot').hidden=false;$('hint').textContent='Look at the dot until it moves. Blinking is okay.';
 nextPoint();
 if(!matched)report(`Your head is not where it was for the calibration dots, so this check will read worse. Look at the purple dot. Check 1 of ${capture.targets.length}.`);
}
$('seat-skip').onclick=()=>{if(capture?.seat)startCheckDots(false,performance.now(),true);};
// For the result text: a check that began with the head out of place.
function seatNote(v=validation){return v?.seat&&!v.seat.matched?' This check began with the head away from where it was for the calibration dots, which makes it read worse.':'';}
// The drawing of "Find your saved position", once more for the wait above.
{
 const drawing=$('return-drawing').cloneNode(true);
 for(const node of [drawing,...drawing.querySelectorAll('[id]')])node.id=node.id.replace('return-','seat-');
 drawing.setAttribute('aria-labelledby','seat-drawing-title seat-drawing-description');
 drawing.querySelector('#seat-drawing-title').textContent='Head position during calibration and now';
 drawing.querySelector('#seat-drawing-description').textContent='Line up the dotted head with the solid head.';
 $('seat-guide').insertBefore(drawing,$('seat-feedback'));
}
// The head-movement step. The calibration dots are held with a still head, so they cannot show
// what the eye readings do when the head moves. Here three dots are held in turn while the person
// moves the head a little on purpose: the gaze stays, only the head changes. Each dot asks for one
// movement in words shown right under it, a ring round the dot fills as the head covers that
// movement, and the dot turns amber when the head goes too far. (The first version only said
// "move your head"; the first person to use it turned the face to each dot and held it there, up
// to two and a half times the pause limit away, and stayed away for the check that followed.)
// A person who cannot or does not move the head loses a few seconds: the step ends by itself
// after the first dot.
const MOVE_INTRO_MS=11000,MOVE_SETTLE_MS=2500,MOVE_VALID_MS=4000,MOVE_FULL_MS=8000,MOVE_LIMIT_MS=18000;
// What each dot asks for, and the head readings that show it.
const MOVES=[
 {say:'Nod: chin a little down, then a little up',fields:['pitch','y']},
 {say:'Turn: nose a little left, then a little right',fields:['yaw','x']},
 {say:'Tilt: one ear a little towards its shoulder, then the other',fields:['roll']}];
// Enough of a movement: its reading has travelled one pause limit in all (half a limit each way).
// Too far: any reading more than this many limits from where it was during calibration.
const MOVE_SPAN=1,MOVE_TOO_FAR=1.4;
const MOVE_INTRO='One more step, about 40 seconds. Three dots appear in turn. Keep your eyes on the dot and your face towards the screen, and move your head a little, slowly, as the words under the dot say: first nod, then turn, then tilt. Small movements are enough, about two fingers wide. Do not point your face at the dot. If you cannot move your head, keep still and this step ends by itself.';
// The words under the dot. Empty hides them.
function moveLabel(text,target=null){
 const label=$('move-label');label.hidden=!text;if(!text)return;
 label.textContent=text;
 if(target){label.style.left=target[0]*100+'%';label.style.top=`calc(${target[1]*100}% + 50px)`;}
}
function beginHeadMove(train){
 // Where the head was while the calibration dots were held.
 const all=train.groups.flatMap(g=>g.samples).filter(Boolean),head={};
 for(const key of ['x','y','scale','roll','yaw','pitch']){const v=all.map(f=>f[key]).filter(Number.isFinite);if(v.length)head[key]=median(v);}
 capture={kind:'move',train,head,targets:MOVE_TARGETS,index:-1,groups:[],samples:[],observations:[],started:performance.now(),validMs:0,last:null,noticeAt:0,phase:'intro'};
 stage='move';$('mode-label').textContent='Head movement';$('cal-dot').hidden=true;$('progress').value=0;
 $('cal-message').textContent=MOVE_INTRO;
 $('cal-message').hidden=false;$('skip-move').hidden=false;
 $('hint').textContent='Eyes on the dot, face towards the screen, small slow head movements.';
 report('Head movement: three dots. The first dot appears in a few seconds.');
}
function moveDot(now){
 capture.index++;capture.samples=[];capture.observations=[];capture.started=now;capture.validMs=0;capture.last=null;capture.noticeAt=now;capture.phase='dot';
 capture.low={};capture.high={};capture.tooFar=0;
 const [x,y]=capture.targets[capture.index];$('cal-dot').style.left=x*100+'%';$('cal-dot').style.top=y*100+'%';dotOverBars(y);
 $('camera').style.left=x<.5?'auto':'20px';$('camera').style.right=x<.5?'20px':'auto';$('camera').style.top=y>.5?'100px':'auto';$('camera').style.bottom=y>.5?'auto':'110px';
 $('cal-message').hidden=true;$('cal-dot').hidden=false;$('progress').value=0;
 $('cal-dot').classList.add('moving');$('cal-dot').classList.remove('too-far');$('cal-dot').style.setProperty('--move','0');
 moveLabel(MOVES[capture.index].say,capture.targets[capture.index]);
 report(`Eyes on the dot. ${MOVES[capture.index].say}. Dot ${capture.index+1} of ${capture.targets.length}.`);
}
const headMoved=samples=>samples.length>=20?Math.max(...headRange(samples)):0;
// How much of the movement a dot asks for has been made: the travel of its readings, in pause limits.
function moveSpan(){return Math.max(0,...MOVES[capture.index].fields.map(k=>Number.isFinite(capture.low[k])?capture.high[k]-capture.low[k]:0));}
async function collectMove(f,now){
 if(capture.phase==='done')return;
 if(capture.phase==='intro'){if(now-capture.started>=MOVE_INTRO_MS)moveDot(now);return;}
 const elapsed=now-capture.started,move=MOVES[capture.index];
 if(elapsed<MOVE_SETTLE_MS)return;
 let far=false;
 if(f){
  // Blinks pause the count, as in calibration.
  if(capture.last!==null&&now-capture.last<=500)capture.validMs+=Math.min(100,now-capture.last);
  capture.last=now;capture.samples.push(f);
  const offsets=headOffsets(f,capture.head);
  if(offsets){
   const reach=Math.max(...Object.values(offsets).map(Math.abs));far=reach>MOVE_TOO_FAR;if(far)capture.tooFar++;
   // Only what was done within reach of the calibration pose counts towards the movement.
   if(reach<=MOVED_FAR)for(const k of move.fields)if(Number.isFinite(offsets[k])){capture.low[k]=Math.min(capture.low[k]??offsets[k],offsets[k]);capture.high[k]=Math.max(capture.high[k]??offsets[k],offsets[k]);}
  }
 }
 const span=moveSpan(),done=span>=MOVE_SPAN,progress=Math.min(1,.5*Math.min(1,capture.validMs/MOVE_VALID_MS)+.5*Math.min(1,span/MOVE_SPAN));
 $('progress').value=progress;$('cal-dot').style.setProperty('--move',progress.toFixed(3));$('cal-dot').classList.toggle('too-far',far);
 moveLabel(far?'Too far. Come back a little.':done?'Good. A little longer.':move.say);
 const finished=(capture.validMs>=MOVE_VALID_MS&&done)||capture.validMs>=MOVE_FULL_MS||elapsed>=MOVE_LIMIT_MS;
 if(!finished){
  if(now-capture.noticeAt>3000){
   if(far){capture.noticeAt=now;report('Too far from where you sat for the dots. Come back a little. Small movements are enough.');}
   else if(capture.validMs>=MOVE_VALID_MS/2&&span<MOVE_SPAN/3){capture.noticeAt=now;report(`${move.say}. A little more: the ring round the dot fills as you move. If you keep still, this step is skipped.`);}
  }
  return;
 }
 capture.groups.push({target:capture.targets[capture.index],samples:capture.samples});
 // No movement of any kind on the first dot: the person cannot or does not want to, and the step ends.
 const away=capture.samples.map(v=>headOffsets(v,capture.head)).filter(Boolean).map(o=>Math.max(...Object.values(o).map(Math.abs)));
 if(capture.index===0&&headMoved(capture.samples)<MOVED_ENOUGH&&!(away.length&&median(away)>=MOVED_AWAY)){await finishHeadMove('No head movement was measured, so this step is skipped.');return;}
 if(capture.index+1<capture.targets.length){moveDot(now);return;}
 await finishHeadMove('Thank you. Now sit again as you sat for the calibration dots.');
}
async function finishHeadMove(note){
 // Frames keep arriving while the note is shown: they must not be counted as more dots.
 if(capture.phase==='done')return;capture.phase='done';
 const train=capture.train;train.moved=capture.groups;
 $('skip-move').hidden=true;$('cal-message').hidden=true;$('cal-dot').hidden=true;$('cal-dot').classList.remove('moving','too-far');moveLabel('');
 if(note){report(note);await new Promise(resolve=>setTimeout(resolve,1500));if(capture?.train!==train)return;}
 await completeCapture(train);
}
$('skip-move').onclick=()=>{if(capture?.kind==='move')finishHeadMove('Head movement skipped.');};
// Whether the map uses where the head is, and if not, why: for the result text and the status line.
function headNote(m=model){
 if(!m)return '';
 if(m.headTerms)return m.headStep?.withMovement?' Head position is used: measured in the head-movement step.':' Head position is used.';
 const step=m.headStep;if(!step)return '';
 if(step.setAside)return ' Head position is not used: reading the eyelids placed the calibration dots better.';
 if(!(step.dots>=2))return headMoveOn()?' Head position is not used: no head movement was measured.':'';
 if(step.unclear)return ' Head position is not used: the head-movement frames were not clear enough to judge it (the eyes may have left the dot, or the head went too far). If this is the usual outcome, the step can be switched off in More setup options; calibration is then 40 seconds shorter.';
 return ' Head position is not used: it did not improve the estimates while the head moved.';
}
// Whether the map reads the eyelids, and if it could have and does not, why: for the result text and the status line.
function lidNote(m=model){
 if(!m)return '';
 if(m.lidTerms)return ' The eyelids are read as well, for up and down.';
 const step=m.lidStep;if(!step||step.off||step.unavailable)return '';
 return ' The eyelids are not read: they did not place the calibration dots better.';
}
async function completeCapture(done){
 const revision=uiRevision;capture=null;$('cal-dot').hidden=true;$('cal-dot').classList.remove('moving','too-far');moveLabel('');$('skip-move').hidden=true;
 stage='fitting';report(done.kind==='train'?'All points collected. Checking the screen map…':'Checking accuracy…');
 try{
  if(['train','adjust','refine','offset'].includes(done.kind)){
   // Let the progress message paint before fitting the local numerical model.
   await new Promise(resolve=>setTimeout(resolve,30));if(revision!==uiRevision)return;
   if(done.kind==='train')diagnosticSteps=[];
   rememberStep(done.kind,done.groups);
   if(done.kind==='train'&&done.moved?.length)rememberStep('move',done.moved);
   model=done.kind==='train'?fitCalibration(done.groups,{moved:done.moved||[],lids:$('lid-input').checked}):done.kind==='refine'?fitRefinement(done.groups,model):done.kind==='offset'?fitOffset(done.groups[0].samples,model):fitAlignment(done.groups,model,{eyeOnly:done.eyeOnly});
   if(['adjust','refine'].includes(done.kind)&&done.previousCheck)model.repairComparison.previousCheck=done.previousCheck;
   if(!positionSession?.pending)await saveModel();if(revision!==uiRevision)return;beginCapture('check',false,true);if(capture&&done.before)capture.afterRepair=done.before;return;
  }
  validation=validateCalibration(done.groups,model,innerWidth,innerHeight,done.bankCheck?{predictor:f=>estimateHeadPositions(f,headPositions)}:{});
  if(cameraStats)validation.camera={...cameraStats};
  if(done.seated)validation.seat={...done.seated};
  rememberStep('check',done.groups,validation);
  if(positionSession?.pending){await finishHeadPosition();return;}
  // A repair (refinement, realignment, one-point correction) that does not check out is not kept
  // in place of the map it started from. Both maps are read on the frames of this same check.
  // (21 Nov: a refinement made after sitting back slightly differently found only that everything
  // read 125 px low at that moment, corrected that, and twenty seconds later checked at 103 px,
  // where the map before it read 108 px. The refined map, marked "alignment needed", replaced a
  // calibration that had passed at 77 px, and took that position out of the saved head positions.)
  // The repair goes when it gains nothing on these frames, or when it fails the check, the map
  // before it had passed, and it is not at least a fifth better here.
  let repairNote='';
  if(done.afterRepair&&!done.bankCheck){
   const was=done.afterRepair;let same=null;try{same=validateCalibration(done.groups,was.model,innerWidth,innerHeight);}catch{}
   if(same&&Number.isFinite(same.mean)&&Number.isFinite(validation.mean)&&(same.mean<=validation.mean||was.validation?.passed===true&&!validation.passed&&validation.mean>.8*same.mean)){
    repairNote=`The ${was.kind==='refine'?'refinement':was.kind==='offset'?'one-point correction':'realignment'} was not kept: on this check it read ${validation.meanPixels} px on average and the map from before ${same.meanPixels} px. Your map from before is unchanged.`;
    const step=diagnosticSteps[diagnosticSteps.length-1];if(step)step.repair={kept:false,kind:was.kind,repaired:validation.meanPixels,before:same.meanPixels};
    model=was.model;validation=was.validation||same;
   }
  }
  // When the checks all sit to the same side of their dots by a similar
  // amount, the map is sound and everything has shifted together since
  // calibration. That is corrected. After a failed check the correction is
  // measured with a fresh check, which itself corrects nothing: the checks
  // that revealed a shift cannot also confirm its correction. After a passed
  // check it is simply applied (one session read 43 px low on six of seven
  // dots and passed, and its keys then had to be looked at along their tops).
  let shiftNote='';
  if(!done.bankCheck&&!done.measureOnly&&!repairNote){
   const corrected=applyCheckOffset(model,validation,innerWidth,innerHeight,{repeat:true});
   if(corrected){
    model=corrected;await saveModel();if(revision!==uiRevision)return;
    if(!validation.passed){
     report(`Every check read about ${shiftText(corrected.checkOffset.pixels)} from its dot. Correcting that and checking again…`);
     await new Promise(resolve=>setTimeout(resolve,2200));if(revision!==uiRevision)return;
     seatWaived=!!done.seated&&!done.seated.matched;
     beginCapture('check',false,true,true);return;
    }
    shiftNote=` Every check read about ${shiftText(corrected.checkOffset.pixels)} from its dot: corrected.`;
    // Buttons are sized by how far estimates reach from the gaze: measure that with the shift taken out.
    try{const after=validateCalibration(done.groups,model,innerWidth,innerHeight);if(Number.isFinite(after.radiusX)&&Number.isFinite(after.radiusY))validation.afterShift={radiusX:after.radiusX,radiusY:after.radiusY};}catch{}
   }
  }
  $('result-dialog').style.setProperty('--result-target-height','115px');
  $('result-title').textContent=validation.passed?'Ready':'Alignment needed';
  const errorText=Number.isFinite(validation.meanPixels)?`Average mapping error: ${validation.meanPixels} pixels; 90% within ${validation.p90Pixels} pixels; largest ${validation.worstPixels} pixels. This includes estimates outside the screen and estimates rejected for head position.`:'No finite gaze positions were available to measure error.';
  const mappingText=done.bankCheck?'Combined saved-position map. These independent checks did not change any saved calibration.':model.checkOffset?`Mapping with one correction for a shift shared by the previous accuracy checks (each read about ${shiftText(model.checkOffset.pixels)} from its dot; before the correction: average ${model.checkOffset.previousCheck.meanPixels} pixels, 90% within ${model.checkOffset.previousCheck.p90Pixels} pixels).`:model.offset?'Mapping with a fresh one-point offset correction.':model.refinement?'Mapping with regional error correction.':model.alignment?.rebuilt?`Eye-only map rebuilt from ${model.repairComparison?.anchorCount||5} fresh reference points.`:model.version===4?'Separate-eye mapping'+(model.featureIndices.some(i=>i>=4)?' with head-position features.':'.'):model.headTerms?'Mapping that also uses head position'+(model.headStep?.withMovement?', measured in the head-movement step.':'.'):model.poseCorrection?'Mapping with learned head-motion correction.':'Combined-eye mapping selected by held-out target accuracy.';
  const signalText=model.signalComparison?` Iris reading: ${readsIrisPixels(model)?'camera pixels':'eye model'} (held-out error ${Math.round(model.signalComparison.detail*1000)/10}% of the screen from camera pixels, ${Math.round(model.signalComparison.plain*1000)/10}% from the eye model).`:readsIrisPixels(model)?' Iris reading: camera pixels.':'';
  const lightReport=cameraStats?.light?.some(Boolean)?`Eye lighting (white of the eye, 0-255): ${cameraStats.light.map(l=>l?l.white:'?').join(' / ')}; reflection over the iris: ${cameraStats.light.map(l=>l?Math.round(l.glare*100)+'%':'?').join(' / ')}. ${darkEyes(cameraStats.light)?'The eyes are dark in the picture (130 or more works best): add light in front of you, or use Picture in Set camera / preview. ':''}`:'';
  const driftText=model.centerRepeatCount>1?` ${model.repairComparison?'Previous full-calibration center drift':'Repeated-center drift'}: ${Math.round(Math.hypot((model.centerDriftX||0)*innerWidth,(model.centerDriftY||0)*innerHeight))} pixels.`:'';
  const before=model.repairComparison?.previousCheck;
  const comparisonText=before&&Number.isFinite(before.meanPixels)&&Number.isFinite(before.p90Pixels)?` Before this repair: average ${before.meanPixels} pixels; 90% within ${before.p90Pixels} pixels. `:'';
  $('result-copy').textContent=`${repairNote?repairNote+' What follows is that map’s own last check. ':''}${errorText} ${Math.round(validation.estimatedFraction*100)}% of frames produced an estimate; ${Math.round(validation.validFraction*100)}% were usable for control. ${mappingText}${model.headTerms?'':headNote()}${lidNote()}${seatNote()}${signalText}${driftText} ${cameraStats?`Camera: ${lensInUse()?lensInUse()+', ':''}${cameraStats.width} × ${cameraStats.height}, ${cameraStats.fps} tracking fps, ${cameraStats.processingMs} ms processing${cameraStats.eyePixels?.length?', eye width '+cameraStats.eyePixels.join(' / ')+' px':''}.${framingNote()}${reflectionNote()} `:''}${lightReport}${validation.passed?'The accuracy check passed.':'Your calibration is saved. Adjust alignment compares a correction of this map with a simpler eye-only repair using five new reference points, then runs a fresh accuracy check. Refine accuracy uses nine new anchors to compare regional corrections, then a fresh check. You can also test the pointer. No clicks are enabled yet.'}`;
  $('result-copy').textContent+=comparisonText+(!validation.passed&&model.poseCorrection?' Try eye-only repair to compare a new five-point map without head-motion correction.':'');
  resultReport=$('result-copy').textContent;
  $('result-copy').textContent=(repairNote?repairNote+' Its own last check: ':'')+(Number.isFinite(validation.meanPixels)?`${repairNote?'average':'Average'} ${validation.meanPixels} px · 90% within ${validation.p90Pixels} px`:'Gaze could not be measured.')+(lensInUse()?' · '+lensInUse():'')+(framingNote()?' ·'+framingNote():'')+(reflectionNote()?' ·'+reflectionNote():'');
  const sides=validation.horizontalSummary;$('result-sides').textContent=sides?`Left / right · average per-target 90% error: ${sides.left.p90Pixels??'unavailable'} / ${sides.right.p90Pixels??'unavailable'} px · usable ${sides.left.usable}% / ${sides.right.usable}%.`:'';
  $('result-details').replaceChildren(...validation.perTarget.map((p,i)=>{
   const li=document.createElement('li'),reasons=Object.entries(p.rejected).map(([k,n])=>`${n} ${REJECTION[k]||k}`).join(', '),loss=Object.entries(p.trackingLoss).map(([k,n])=>`${n} ${(QUALITY[k]||k).replace(/[.]+$/,'')}`).join(', '),head=Object.entries(p.headRejections||{}).map(([k,n])=>`${n} ${HEAD_REASON[k]||k}`).join(', ');
   li.textContent=`Check ${i+1}: ${Number.isFinite(p.p90Pixels)?p.p90Pixels+' px':'unavailable'} (90% mapping error), ${Math.round(p.validFraction*100)}% usable. ${Number.isFinite(p.jitterPixels)?`Scatter: ${p.jitterPixels} px. `:''}${Number.isFinite(p.offsetX)&&Number.isFinite(p.offsetY)?`Median: ${Math.abs(p.offsetX)} px ${p.offsetX<0?'left':'right'}, ${Math.abs(p.offsetY)} px ${p.offsetY<0?'up':'down'}. `:''}${reasons?`Rejected: ${reasons}. `:''}${head?`Head limits exceeded: ${head}. `:''}${Number.isFinite(p.headCorrectionP90Pixels)?`Head correction changed the estimate by up to ${p.headCorrectionP90Pixels} px for 90% of estimated frames (contribution, not error). `:''}${loss?`Camera: ${loss}.`:''}`;return li;
  }));
  if(!done.bankCheck)await saveModel();if(revision!==uiRevision)return;
  // A passed check opens no window, so its numbers go to the bottom bar.
  if(validation.passed){$('save-status').textContent=`${repairNote?repairNote+' Its own last check: average':'Check passed: average'} ${validation.meanPixels} px · 90% within ${validation.p90Pixels} px${lensInUse()?' · '+lensInUse():''}.${shiftNote}${headNote()}${lidNote()}${seatNote()}${framingNote()}${reflectionNote()}`;await run(activate);if(active)report('Eye control is on. '+saveNotice);return;}
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
 pointRetry=capture;capture=null;stage='point-help';$('cal-dot').hidden=true;$('seat-guide').hidden=true;moveLabel('');$('skip-move').hidden=true;$('retry-point').hidden=false;
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
 if(capture){collect(f,now,head);return;}
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
 // What re-centring has learned belongs to one map: another map starts it afresh.
 if(model!==recentreFor){recentre.reset();recentreFor=model;gazeTrail=[];recentreTold={x:0,y:0};}
 if(recentreOn()&&recentre.active)prediction=shiftPrediction(prediction,recentre.shift);
 if(prediction.point&&prediction.raw){gazeTrail.push({at:now,x:prediction.raw.x,y:prediction.raw.y});if(gazeTrail.length>90)gazeTrail.shift();}
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
  // For diagnostics: why the frames between two selections gave no estimate.
  {const why=view.recovering?'settling':prediction.reason==='eyes-unavailable'?lastFrameReason||'eyes-unavailable':prediction.reason||'unknown';(lockFrames.why??={})[why]=(lockFrames.why[why]||0)+1;}
  selectionDwell(null,false,view,now);$('progress').value=dwell.progress;desktop?.heartbeat(false);
  if(active||stage==='preview'){
   const moved=prediction.reason==='head-position'&&prediction.headReasons?.length?` (${prediction.headReasons.map(k=>HEAD_REASON[k]||k).join(', ')})`:'';
   report(view.recovering?'Tracking settling…':`Selection paused · ${REJECTION[prediction.reason]||lastQuality}${moved}`);
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
 if(fired!==null){noteSelection(button,target<items.length,now);if(target<items.length)run(action.action);else button.click();}
}
// A button selected by looking at it says where the eyes were. See Recentre.
function noteSelection(button,tile,now){
 if(!recentreOn()||!button)return;
 const r=button.getBoundingClientRect(),trail=gazeTrail.filter(g=>now-g.at<=dwell.ms),label=button.textContent.trim();
 const undo=['cancel','draft-delete','draft-undo'].includes(button.id)||/^Back\b/.test(label);
 // A square of the zoom grid, or of the screen being viewed, is looked at
 // wherever the thing to click lies in it, not at its middle.
 const use=trail.length>=5&&!(tile&&($('tiles').classList.contains('grid')||$('tiles').classList.contains('view')));
 const gaze=trail.length?{x:median(trail.map(g=>g.x)),y:median(trail.map(g=>g.y))}:null;
 const result=recentre.observe({gaze,rect:{x0:r.left/innerWidth,y0:r.top/innerHeight,x1:r.right/innerWidth,y1:r.bottom/innerHeight},at:now,undo,use});
 const pixels=v=>v?{x:Math.round(v[0]*innerWidth),y:Math.round(v[1]*innerHeight)}:null;
 recentreLog.push({at:Math.round(now),button:label.slice(0,24),size:[Math.round(r.width),Math.round(r.height)],off:pixels(result.residual),undo,used:use,moved:pixels(result.applied),total:pixels(recentre.shift),frames:lockFrames});
 lockFrames=freshLock();lockTarget=null;
 if(recentreLog.length>600)recentreLog.splice(0,recentreLog.length-600);
 // Every selection that stands moves the pointer a little (see Recentre). It is said only when
 // it has added up to something a person could notice.
 if(result.applied){
  gazeTrail=[];const total=pixels(recentre.shift);
  if(Math.hypot(total.x-recentreTold.x,total.y-recentreTold.y)>=20){recentreTold=total;$('save-status').textContent=total.x||total.y?`Pointer re-centred from your selections: ${shiftText(total)} in all`:'Pointer back where the calibration put it';}
 }
}
function selectionDwell(target,steady,view,now,nearCurrent=false){
 const selection=intent.update(target,now,{valid:view.usable,nearCurrent});
 // For diagnostics: what the frames between two selections were spent on.
 // held: the dwell advanced. unsteady: on the button, the gaze not judged
 // steady. other: on a different button than the one being held. none: on no
 // button. rejected: no usable estimate.
 lockFrames[!view.usable?'rejected':target===null?'none':!selection.confirmed?'other':steady||selection.confident?'held':'unsteady']++;
 if(selection.target!==null&&selection.target!==lockTarget)lockFrames.switches++;
 lockTarget=selection.target;
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
 return {version:'0.4.41',filter:{movementConfirmationMs:120,maximumInTargetPauseMs:300,medianWindowMs:150,selectionHoldMs:600,intentWindowMs:240},headEstimate,activePositionId:positionId,savedHeadPositions:headPositions.length,mapId:(hash>>>0).toString(16),camera:cameraStats,viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},
  note:'Local session diagnostics. Movement between frames includes intentional eye movement; these are not target accuracy results. These are pointer stability measurements, not identified microsaccades or proof of gaze accuracy. No images, typed text, profile name, or raw eye features included.',
  runs:Object.fromEntries([...trackingRuns].map(([mode,rows])=>{
   const r=rows.filter(x=>performance.now()-x.at<=120000),rejected={};for(const x of r)if(!x.usable){const k=x.recovering?'recovering':x.reason;rejected[k]=(rejected[k]||0)+1;}
   const steps=r.slice(1).flatMap((x,i)=>x.raw&&r[i].raw&&x.at-r[i].at<250?[Math.hypot((x.raw.x-r[i].raw.x)*innerWidth,(x.raw.y-r[i].raw.y)*innerHeight)]:[]);
   const displayed=r.slice(1).flatMap((x,i)=>x.usable&&r[i].usable&&x.display&&r[i].display&&x.at-r[i].at<250?[Math.hypot((x.display.x-r[i].display.x)*innerWidth,(x.display.y-r[i].display.y)*innerHeight)]:[]);
   return [mode,{samples:r.length,trackingFps:r.length>1?Math.round((r.length-1)*1000/(r.at(-1).at-r[0].at)):0,usablePercent:r.length?Math.round(r.filter(x=>x.usable).length/r.length*100):null,rejected,rawStepP90Pixels:steps.length?Math.round(quantile(steps,.9)):null,displayStepP90Pixels:displayed.length?Math.round(quantile(displayed,.9)):null,fixationHoldPercent:r.length?Math.round(r.filter(x=>x.usable&&x.fixating).length/r.length*100):null,briefExcursionHoldFrames:r.filter(x=>x.excursionHeld).length,confirmedRelocations:r.filter(x=>x.relocated).length,rawStepRmsPixels:steps.length?Math.round(Math.sqrt(steps.reduce((s,v)=>s+v*v,0)/steps.length)*10)/10:null,displayStepRmsPixels:displayed.length?Math.round(Math.sqrt(displayed.reduce((s,v)=>s+v*v,0)/displayed.length)*10)/10:null}];
  }))};
}
async function copyTrackingReport(){try{await navigator.clipboard.writeText(JSON.stringify(trackingReport(),null,2));report('Tracking report copied. No images or typed text are included.');}catch{report('Could not copy the tracking report.');}}
function clearPageTargets(){focusTargets=[];coveredTargets=[];pageGroup=null;focusScope=null;focusAt=0;focusRevision++;$('focus-target').hidden=true;}
async function refreshPageTargets(){
 if(stage!=='browse'||reading||!active||busy||focusQuery)return;
 focusQuery=true;const revision=focusRevision;
 try{
  let result;
  if(desktop?.focusTargets){result=await desktop.focusTargets(focusRebind);focusRebind=false;}
  else if(!desktop){
   if(site)result={scope:'site',targets:site.targets()};
   else result={scope:'practice',targets:[...document.querySelectorAll('[data-practice-action]')].map(b=>({id:b.dataset.practiceAction,label:b.getAttribute('aria-label')||b.textContent,kind:b.tagName==='INPUT'?'Edit':'Button',rect:b.getBoundingClientRect(),enabled:!b.disabled}))};
  }else result={scope:null,targets:[]};
  if(stage!=='browse'||reading||revision!==focusRevision)return;
  const dock=$('tiles').getBoundingClientRect(),top=document.querySelector('.statusbar').getBoundingClientRect().bottom+8;
  // A control at least half clear of Hands Free's bars can be looked at. The
  // rest lie under the bars and are listed by 'Top & bottom controls'.
  const bars={top,bottom:innerHeight-dock.top+8,showing:.5};
  focusTargets=visibleFocusTargets(result.targets||[],innerWidth,innerHeight,bars);coveredTargets=coveredFocusTargets(result.targets||[],innerWidth,innerHeight,bars);focusScope=result.scope;focusAt=performance.now();showCovered();
  if(performance.now()>=hintHold)$('hint').textContent=focusTargets.length?BROWSE_HINT:coveredTargets.length?'No controls in view. Use Top & bottom controls, region click, or another app.':'No shared controls. Use region click, or choose another app.';
 }catch{
  if(revision===focusRevision){focusTargets=[];coveredTargets=[];pageGroup=null;focusAt=0;showCovered();$('focus-target').hidden=true;$('hint').textContent='App controls unavailable. Use region click, or choose another app.';}
 }finally{focusQuery=false;}
}
const BROWSE_HINT='Look near a link, button or text box and hold its highlight. A highlight around several opens a list of them.';
function selectPageTarget(raw,p,steady,view,now){
 const margin=selectionMargin(layoutValidation(),innerWidth,innerHeight);
 const holding=typeof intent.target==='string'&&/^pages?:/.test(intent.target)?intent.target:null,offered=!!pageGroup&&holding===pageGroup.key;
 const choice=now-focusAt<=2600?focusChoice(raw,p,focusTargets,innerWidth,innerHeight,{radiusX:Math.max(40,Math.min(110,margin.x)),radiusY:Math.max(32,Math.min(82,margin.y)),held:holding?.startsWith('page:')?holding.slice(5):null,offered}):null;
 const found=choice?.target||null;let key=found?'page:'+found.id:null;
 if(choice?.several){
  // The group on offer stays the same group while the nearest control is one
  // of its own. It only gains members, so its outline does not flicker.
  if(pageGroup&&pageGroup.list.some(t=>t.id===choice.several[0].id)){
   pageGroup.list=pageGroup.list.map(t=>focusTargets.find(v=>v.id===t.id)).filter(Boolean);
   for(const t of choice.several)if(pageGroup.list.length<CHOICES&&!pageGroup.list.some(v=>v.id===t.id))pageGroup.list.push(t);
  }else pageGroup={key:'pages:'+(++pageGroups),list:[...choice.several]};
  key=pageGroup.key;
 }else if(!offered)pageGroup=null;
 const group=key&&key===pageGroup?.key?pageGroup:null;
 const area=list=>list.reduce((a,t)=>({left:Math.min(a.left,t.rect.left),top:Math.min(a.top,t.rect.top),right:Math.max(a.right,t.rect.right),bottom:Math.max(a.bottom,t.rect.bottom)}),{left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity});
 const prior=holding===null?null:offered?(pageGroup.list.length?area(pageGroup.list):null):focusTargets.find(t=>'page:'+t.id===holding)?.rect;
 const near=!!prior&&nearTarget(raw,{...prior,width:prior.right-prior.left,height:prior.bottom-prior.top},innerWidth,innerHeight);
 const fired=selectionDwell(key,steady,view,now,near);$('progress').value=dwell.progress;
 document.querySelectorAll('.gaze-active').forEach(b=>b.classList.remove('gaze-active'));
 const left=Math.max(0,(1-dwell.progress)*dwell.ms/1000).toFixed(1)+' s';
 if(found||group){
  const box=$('focus-target'),r=found?found.rect:area(group.list),x=Math.max(0,r.left),y=Math.max(0,r.top);
  box.hidden=false;box.classList.toggle('several',!found);box.style.left=x+'px';box.style.top=y+'px';box.style.width=(Math.min(innerWidth,r.right)-x)+'px';box.style.height=(Math.min(innerHeight,r.bottom)-y)+'px';
  const count=found?0:group.list.length,name=found?found.label||found.kind:count===1?(group.list[0].label||group.list[0].kind)+' · hold to confirm':count+' controls here · hold to choose';
  box.querySelector('span').textContent=name;report(name+' · '+left);
 }else{$('focus-target').hidden=true;report(focusTargets.length?'Look near a link or button':coveredTargets.length?'No controls in view':'Looking for app controls…');}
 // The list shows them in the order they lie on the screen.
 if(group&&fired===key){const list=readingOrder(group.list),outline=area(list);run(()=>listControls(list,list.length===1?'Open this?':'Which one?',0,outline));return;}
 if(fired===key&&found)run(async()=>{
  try{
   let result;
   if(desktop)result=await desktop.activateTarget(focusScope,found.id,found.rect);
   else result=site?site.activate(found):practiceActivate(found);
   if(!result)return;
   if(result.choices){clearPageTargets();siteChoices(result);return;}
   // Hold the acquisition area, including a near miss in adjacent blank
   // space, until a deliberate look away. A changed page must not chain-click.
   const x=raw.x*innerWidth,y=raw.y*innerHeight;
   wakeRelease={left:x-36,right:x+36,top:y-28,bottom:y+28,width:72,height:56};wakeReleaseAt=null;
   clearPageTargets();if(result.edit)compose('app');else{blockedUntil=performance.now()+300;setTimeout(refreshPageTargets,350);}
  }catch{clearPageTargets();blockedUntil=performance.now()+300;report('That control changed. Look again.');setTimeout(refreshPageTargets,350);}
 });
}
function practiceActivate(target){
 const element=[...document.querySelectorAll('[data-practice-action]')].find(b=>b.dataset.practiceAction===target.id);
 if(!element)return null;element.focus();if(target.kind!=='Edit'){element.click();$('practice-selection').textContent='Opened '+target.label;}
 return {edit:target.kind==='Edit'};
}
// A list of another program's controls as large named buttons: the ones a look
// could not tell apart (their outline stays on the screen meanwhile), or the
// ones under Hands Free's bars. Six to a page.
const LIST_PAGE=6;
// The button just held, as an area the eyes must leave before anything else can
// be selected: what appears under them next must not be chain-clicked.
function heldTile(index){const b=$('tiles').children[index]?.getBoundingClientRect();return b?{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}:null;}
function listControls(list,title,page=0,outline=null){
 // A control named like one of Hands Free's own buttons says whose it is.
 const names=controlNames(list).map(n=>/^(back|pause|more controls)$/i.test(n)?n+' (in the app)':n),pages=Math.max(1,Math.ceil(list.length/LIST_PAGE)),from=(page%pages)*LIST_PAGE,shown=list.slice(from,from+LIST_PAGE);
 stage='choose';pageGroup=null;
 tiles(title,[...shown.map((t,i)=>entry(names[from+i],()=>openListed(t,i))),...(pages>1?[entry(`More · page ${page%pages+1} of ${pages}`,()=>{const held=heldTile(shown.length);listControls(list,title,page+1,outline);wakeRelease=held;wakeReleaseAt=null;})]:[])]);
 $('practice-scene').hidden=!!desktop;
 if(outline){
  const box=$('list-outline'),x=Math.max(0,outline.left),y=Math.max(0,outline.top);
  box.hidden=false;box.style.left=x+'px';box.style.top=y+'px';box.style.width=(Math.min(innerWidth,outline.right)-x)+'px';box.style.height=(Math.min(innerHeight,outline.bottom)-y)+'px';
  box.querySelector('span').textContent=list.length===1?names[0]:'These '+list.length;
 }
 $('hint').textContent='Hold the one you want. The Back button at the bottom right returns without opening anything.';
}
async function openListed(target,index){
 const release=heldTile(index);
 try{
  let result;
  if(desktop){
   // The list may have been open for a while, and the companion acts only on
   // a control it has just seen in the same place: read the controls again.
   const fresh=await desktop.focusTargets(false),current=(fresh.targets||[]).find(t=>t.id===target.id);
   if(!current)throw Error('That control is no longer there.');
   result=await desktop.activateTarget(fresh.scope,current.id,current.rect);
  }else result=site?site.activate(target):practiceActivate(target);
  if(!result)throw Error('That control is no longer there.');
  if(result.choices){siteChoices(result);return;}
  if(result.edit)compose('app');else browse();
  wakeRelease=release;wakeReleaseAt=null;blockedUntil=performance.now()+300;
 }catch{browse();wakeRelease=release;wakeReleaseAt=null;report('That control changed. Look again.');}
}
// The other program's controls under Hands Free's top and bottom bars (in a
// browser: its tabs, address bar and toolbar). They cannot be looked at, so a
// tile in the dock lists them. The tile says how many there are.
function coveredLabel(){return 'Top & bottom controls'+(focusAt?` (${coveredTargets.length||'none'})`:'');}
function showCovered(){
 const i=stage==='browse'?items.indexOf(coveredEntry):-1,tile=i<0?null:$('tiles').children[i]?.firstChild;
 if(tile){coveredEntry.label=coveredLabel();tile.textContent=coveredEntry.label;}
}
function coveredControls(){
 if(!coveredTargets.length){$('hint').textContent=focusAt?'Nothing is hidden behind the top or bottom bar.':'Still looking for app controls…';hintHold=performance.now()+4000;return;}
 listControls([...coveredTargets],'Top & bottom controls');
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
 const top=parseFloat($('workspace').style.getPropertyValue('--control-top'))||90,gap=8,padding=24;
 // Buttons sized for how far the estimates reach from the gaze (see menuGrid).
 const g=menuGrid(count,innerWidth,innerHeight-top-82,reach(),{row:innerHeight<=550?56:64,gap,padding});
 $('tiles').style.setProperty('--menu-height',g.height+'px');
 $('tiles').style.setProperty('--menu-width',(g.columns*g.columnWidth+(g.columns-1)*gap+padding)+'px');
 return {columns:g.columns,rows:g.rows,capacity:g.capacity};
}
function tiles(label,entries,grid=false,page=0,options={}){
 const locked=dwell.locked;intent.reset();dwell.reset();dwell.locked=locked;blockedUntil=performance.now()+200;
 if(!grid&&label!=='Viewing screen'&&$('composer').hidden)$('practice-scene').hidden=true;
 const groupedKeys=!$('composer').hidden&&['keyboard','letters','symbols'].includes(stage);
 const compactMenu=!grid&&!options.kind&&!groupedKeys;
 $('tiles').classList.toggle('keyboard',options.kind==='keyboard');$('tiles').classList.toggle('navigation',options.kind==='navigation');$('tiles').classList.toggle('compact-menu',compactMenu);
 // Typing uses a bottom dock; task panels keep the existing screen layout.
 if(compactMenu)document.body.classList.toggle('viewing',$('composer').hidden&&stage!=='paused');
 $('focus-target').hidden=true;$('list-outline').hidden=true;
 fixation.reset();sizeControls();layout=controlLayout();updateTestNotice();
 if(!grid&&(!$('composer').hidden||entries.length<=4))layout={columns:2,rows:2,capacity:4};
 if(options.columns&&options.rows)layout={columns:options.columns,rows:options.rows,capacity:options.columns*options.rows};
 if(compactMenu)layout=$('composer').hidden?compactMenuLayout(entries.length):{columns:innerWidth<700?2:3,rows:Math.ceil(entries.length/(innerWidth<700?2:3)),capacity:entries.length};
 $('more-controls').hidden=['train','move','check','adjust','refine','paused'].includes(stage);
 $('tiles').style.gridTemplateColumns=`repeat(${layout.columns},1fr)`;$('tiles').style.gridTemplateRows=`repeat(${layout.rows},1fr)`;
 const navigationSlots=layout.capacity>2?2:1,pageSize=Math.max(1,layout.capacity-navigationSlots);
 const pages=entries.length>layout.capacity?Math.ceil(entries.length/pageSize):1;
 if(!grid&&pages>1){const all=entries;entries=[...all.slice(page*pageSize,(page+1)*pageSize),...(navigationSlots===2?[entry('Previous page',()=>tiles(label,all,false,(page+pages-1)%pages,options))]:[]),entry('Next page',()=>tiles(label,all,false,(page+1)%pages,options))];}
 $('pause').textContent=active?'Pause':'Setup';items=entries;$('tiles').replaceChildren();$('tiles').hidden=false;$('tiles').classList.remove('view');$('tiles').classList.toggle('grid',grid);$('mode-label').textContent=label;
 for(const item of entries){const b=document.createElement('button'),s=document.createElement('span');s.textContent=item.label;b.append(s);b.onclick=()=>run(item.action);$('tiles').append(b);}
 $('tiles').style.setProperty('--typing-rows',layout.rows);$('tiles').style.setProperty('--typing-key-height',(layout.rows*typing.row+Math.max(0,layout.rows-1)*6)+'px');
 if(!$('composer').hidden)requestAnimationFrame(syncTypingRegion);
 $('cancel').textContent='Back';$('typed').textContent='';$('hint').textContent=grid?`Choose the area containing the ${clickPurpose==='field'?'text box':'video or button'}. Zoom ${depth+1}. Back undoes one zoom.`:`${pages>1?'Page '+(page+1)+' of '+pages+' · ':''}Hold for 0.6 seconds. Look away after selection.`;
}
function entry(label,action,description=''){return {label,action,description};}
async function run(action){if(busy)return;busy=true;try{await action();}catch(e){await pause();report(e.message);}finally{busy=false;}}
async function command(payload){if(desktop)await desktop.command(payload);else if(site){const said=site.command(payload);if(said)report(said);}else{
 if(payload.type==='text')$('practice-text').value+=payload.text;
 if(payload.type==='key'&&payload.key==='backspace')$('practice-text').value=$('practice-text').value.slice(0,-1);
 report('Practice only: '+(payload.type==='key'?payload.key:payload.type));
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
  entry(site?'Use this website':'Browse & scroll',()=>browse(),site?'Devices and Set up a device, with your eyes':'See your open app, scroll, or click a video'),
  entry('Use saved devices',()=>devicesMenu(),'Send the buttons of your fan, TV and other devices'),
  entry('Set up a device',()=>deviceSetup(),'Add a device or a button and record it from its remote')]);
}
function browse(){hideComposer();stage='browse';document.body.classList.add('viewing');snapshot=null;$('snapshot').hidden=true;$('practice-scene').hidden=!!desktop;if(site){site.show('/');requestAnimationFrame(layoutSite);}
 const columns=innerWidth<700?3:6,rows=Math.ceil(6/columns);
 tiles(site?'This website':'Browse & scroll',[
 entry('Scroll down',()=>command({type:'scroll',amount:-3})),entry('Scroll up',()=>command({type:'scroll',amount:3})),
 entry('Click a video or button',()=>startGrid()),entry('Type text',()=>compose('app')),
 coveredEntry=entry(coveredLabel(),()=>coveredControls()),
 entry('Apps & keys',()=>appsMenu())],false,0,{kind:'navigation',columns,rows});
 $('tiles').classList.add('view');$('tiles').style.setProperty('--view-height',(rows*60+(rows-1)*10)+'px');$('practice-scene').hidden=!!desktop;
 $('hint').textContent=BROWSE_HINT;hintHold=0;
 clearPageTargets();refreshPageTargets();}
// Two more pages of the dock: other apps, and the keys that move between the parts of one. Each
// is one row like the first, so the app behind stays in view and a button is never chosen by
// height alone (up and down is the less exact direction).
//   Next app: Alt+Esc, which brings the open windows forward one after another.
//   Last app: Alt+Tab, back to the window used before this one.
//   Open an app: the name is written here, then typed into Windows' own search and opened.
//   Notifications: Windows' notification list (Win+N, or Win+A before Windows 11).
// After any of them the list of controls to look at is read again from the app now in front.
function appsMenu(page='apps'){hideComposer();stage='apps';document.body.classList.add('viewing');snapshot=null;$('snapshot').hidden=true;$('practice-scene').hidden=!!desktop;clearPageTargets();
 const columns=innerWidth<700?3:6,press=(label,key,after)=>entry(label,async()=>{await command({type:'key',key});focusRebind=true;if(after)after();else{blockedUntil=performance.now()+500;report(label+': sent.');}});
 const all=page==='keys'?[press('Next field (Tab)','tab'),press('Previous field','shifttab'),press('Press Enter','enter'),press('Escape','escape'),entry('Use the app in front',()=>{focusRebind=true;browse();}),entry('Back',()=>appsMenu())]
  :[press('Next app','nextapp'),press('Last app','lastapp'),entry('Open an app',()=>compose('launch')),press('Notifications','notifications',()=>{browse();report('Notifications opened. Look at one to open it. To close the list: Apps & keys, Keys, Escape.');}),entry('Keys',()=>appsMenu('keys')),entry('Back',()=>browse())],rows=Math.ceil(all.length/columns);
 tiles(page==='keys'?'Keys':'Apps & keys',all,false,0,{kind:'navigation',columns,rows});
 $('tiles').classList.add('view');$('tiles').style.setProperty('--view-height',(rows*60+(rows-1)*10)+'px');
 $('hint').textContent=page==='keys'?'Tab moves to the next box or button of the app, as on a keyboard. Hold a button for 0.6 seconds.':'Next app goes through your open windows one at a time. Hold a button for 0.6 seconds.';
}
async function openSite(site){if(desktop)await desktop.openSite(site,'');else report('Practice only. Use the Windows companion to open other apps.');browse();}
// ---- This website's pages under the eye pointer (browser only) -----------------------------------
// A drop-down list on the page, as large buttons.
function siteChoices(result){stage='choose';pageGroup=null;tiles(result.label,[...result.choices.map(c=>entry(c.label,()=>{c.choose();browse();})),entry('Back',()=>browse())]);$('practice-scene').hidden=false;}
// The frame sits between the bar at the top and whatever is docked at the bottom (the row of
// buttons, or the keyboard), so the page is never under either.
function layoutSite(){
 if(!site||$('practice-scene').hidden)return;
 const top=document.querySelector('.statusbar').getBoundingClientRect().bottom,dock=$('typing-dock').hidden?$('tiles').getBoundingClientRect().top:$('typing-dock').getBoundingClientRect().top;
 site.layout(top+6,(dock>top+150?dock:document.querySelector('.controlbar').getBoundingClientRect().top)-6);
}
if(!desktop)fetch('/api/hub').then(async answer=>{
 if(!answer.ok)return;
 const {createSite}=await import('/screen-site.mjs');
 site=createSite($('site-frame'));$('practice-scene').classList.add('site');$('site-frame').hidden=false;
 setInterval(layoutSite,400);
}).catch(()=>{});
// ---- Devices (fan, TV, ...) ----------------------------------------------------------------------
// "Use saved devices" sends the buttons of the devices that were set up. "Set up a device" adds a
// device, then a button: its name is written with the keyboard, and the next signal the receiver
// board hears is stored under that name.
// The devices are kept by the website. In a browser this page asks its own site; in the Windows
// app the main process asks, with the key the app was given when it was linked there. Either
// way an answer is {ok, message, ...}.
async function siteCall(route,method='GET',body){
 try{const r=await fetch(route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});let data={};try{data=await r.json();}catch{}return {...data,ok:r.ok,status:r.status};}
 catch(e){return {ok:false,status:0,message:e.name==='TimeoutError'?'No answer from the website. If a command was on its way, check the device before trying again.':'The website could not be reached.'};}
}
const requestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const deviceHub=desktop?(desktop.devices?(action,payload)=>desktop.devices(action,payload).catch(()=>({ok:false,status:0,message:'The app could not ask the website.'})):null)
 :(action,p)=>action==='get'?siteCall('/api/hub'):action==='send'?siteCall('/api/send','POST',{button_id:p.button_id,request_id:requestId(),created_at:Date.now(),...(p.confirm?{confirm:true}:{})}):action==='add'?siteCall('/api/appliances','POST',p):action==='learn'?siteCall('/api/learn','POST',p):action==='stop'?siteCall('/api/learn','DELETE'):Promise.resolve({ok:false,status:0,message:'Not available here.'});
function askText(options){ask=options;drafts.ask=options.value||'';compose('ask');}
function deviceScreen(next){hideComposer();stage=next;document.body.classList.remove('viewing');snapshot=null;$('snapshot').hidden=true;waitingFor=null;linkingApp=false;}
async function loadDevices(again){
 if(!deviceHub){tiles('Devices',[entry('Back to tasks',()=>menu())]);report('Devices need a newer version of the Windows app.');return null;}
 const state=await deviceHub('get');
 if(state.ok&&Array.isArray(state.appliances)){linkWait=null;return state;}
 if(state.unlinked){await linkApp(again);return null;}
 tiles('Devices',[entry('Try again',again),entry('Back to tasks',()=>menu())]);report(state.message||'The website could not be reached.');return null;
}
const senderNote=state=>!state.transmitter.linked?'The transmitter board is not linked yet: nothing can be sent.':!state.transmitter.online?'The transmitter board is offline: nothing is sent until it reconnects.':state.transmitter.practice?'The transmitter is in practice mode: no infrared is sent.':'';
async function devicesMenu(){
 deviceScreen('devices');const state=await loadDevices(()=>devicesMenu());if(!state)return;
 const ready=state.appliances.filter(a=>a.buttons.length);
 tiles('Use saved devices',[...ready.map(a=>entry(a.name,()=>deviceButtons(a.id))),...(ready.length?[]:[entry('Set up a device',()=>deviceSetup())]),entry('Back to tasks',()=>menu())]);
 report(ready.length?senderNote(state)||'Choose a device.':'No device has a button yet. Choose Set up a device.');
}
async function deviceButtons(id,note=''){
 deviceScreen('device');const state=await loadDevices(()=>deviceButtons(id));if(!state)return;
 const a=state.appliances.find(x=>x.id===id);if(!a){await devicesMenu();return;}
 tiles(a.name,[...a.buttons.map(b=>entry(b.label,()=>pressDevice(a,b))),entry('Back',()=>devicesMenu())]);
 report(note||senderNote(state)||'Hold a button for 0.6 seconds to send it.');
}
async function pressDevice(a,b,confirmed=false){
 // A device that asks first (a heater): "No" comes first, so a stray look does not send.
 if(a.careful&&!confirmed){stage='device-confirm';tiles('Send '+a.name+' · '+b.label+'?',[entry('No, go back',()=>deviceButtons(a.id,'Nothing was sent.')),entry('Yes, send '+b.label,()=>pressDevice(a,b,true))]);report('Choose Yes to send '+b.label+', or No.');return;}
 report('Sending '+a.name+' · '+b.label+'…');
 const result=await deviceHub('send',{button_id:b.id,confirm:confirmed});
 const said=a.name+' · '+b.label+': '+(result.message||(result.ok?'Sent.':'No answer. Check the device before trying again.'));
 if(confirmed||stage!=='device'){await deviceButtons(a.id,said);return;}
 blockedUntil=performance.now()+600;report(said);
}
async function deviceSetup(note=''){
 deviceScreen('device-setup');const state=await loadDevices(()=>deviceSetup());if(!state)return;
 tiles('Set up a device',[entry('Add a device',()=>chooseDeviceKind()),...state.appliances.map(a=>entry(a.name,()=>deviceEdit(a.id))),entry('Back to tasks',()=>menu())]);
 report(note||(!state.receiver?.linked?'The receiver board is not linked yet. Link it on the website, under Setup.':!state.receiver.online?'The receiver board is offline. Power it on to record buttons.':'Add a device, or choose one to add a button to it.'));
}
function chooseDeviceKind(){
 deviceScreen('device-kind');
 tiles('What kind of device?',[...[['Fan','fan'],['TV','tv'],['Heater','heater'],['Light','light'],['Other','other']].map(([label,kind])=>entry(label,()=>askText({label:'Name of the device',title:'Write the device name',submit:'Add this device',value:kind==='other'?'':label,max:32,cancel:()=>run(()=>deviceSetup()),
  done:async name=>{const result=await deviceHub('add',{name,kind});if(!result.ok){await deviceSetup(result.message);return;}await deviceEdit(result.appliance.id,name+' was added. Now add its first button.');}}))),entry('Back',()=>deviceSetup())]);
 report('Choose the kind of device. Its name comes next.');
}
async function deviceEdit(id,note=''){
 deviceScreen('device-edit');const state=await loadDevices(()=>deviceEdit(id));if(!state)return;
 const a=state.appliances.find(x=>x.id===id);if(!a){await deviceSetup();return;}
 tiles(a.name,[entry('Add a button',()=>nameDeviceButton(a)),...(a.buttons.length?[entry('Use '+a.name,()=>deviceButtons(a.id))]:[]),entry('Back',()=>deviceSetup())]);
 report(note||(a.buttons.length?a.name+' has '+a.buttons.length+(a.buttons.length===1?' button: ':' buttons: ')+a.buttons.map(b=>b.label).join(', ')+'.':a.name+' has no buttons yet. Choose Add a button.'));
}
function nameDeviceButton(a){
 askText({label:'Name of the button for '+a.name+', for example On/off',title:'Write the button name',submit:'Record this button',value:'',max:24,cancel:()=>run(()=>deviceEdit(a.id)),
  done:async name=>{
   const result=await deviceHub('learn',{applianceId:a.id,label:name});if(!result.ok){await deviceEdit(a.id,result.message);return;}
   deviceScreen('device-wait');waitingFor={id:a.id,name,device:a.name,busy:false};
   tiles('Press "'+name+'" on the remote',[entry('Stop waiting',()=>stopWaiting())]);report('Point the remote at the receiver and press '+name+' once.');
  }});
}
async function stopWaiting(){const w=waitingFor;waitingFor=null;await deviceHub('stop');if(w)await deviceEdit(w.id,'Stopped. Nothing was recorded.');else await deviceSetup();}
// While a button is being recorded, ask every second whether the receiver has heard it.
setInterval(async()=>{
 const w=waitingFor;if(!w||w.busy||busy||stage!=='device-wait')return;
 w.busy=true;const state=await deviceHub('get');w.busy=false;
 if(waitingFor!==w||stage!=='device-wait'||busy||!state.ok)return;
 if(state.learned&&state.learned.applianceId===w.id&&state.learned.label===w.name){
  const saved=state.learned.buttonId;deviceScreen('device-saved');
  tiles('Saved: '+w.name,[entry('Add another button',()=>nameDeviceButton({id:w.id,name:w.device})),entry('Try '+w.name,async()=>{const now=await deviceHub('get'),a=now.appliances?.find(x=>x.id===w.id),b=a?.buttons.find(x=>x.id===saved);if(a&&b)await pressDevice(a,b);}),entry('Done',()=>deviceEdit(w.id))]);
  report('"'+w.name+'" was recorded and saved for '+w.device+'.');
 }else if(!state.learning){waitingFor=null;run(()=>deviceEdit(w.id,'No signal arrived in time. Nothing was recorded.'));}
 else $('hint').textContent='Waiting for the receiver · '+state.learning.secondsLeft+' seconds left';
},1000);
// The Windows app is linked to the website once, by a code typed there. The code stays the same
// until it is used, and the app goes on asking whether it has been typed whatever is on screen:
// typing it means leaving this screen (pausing, or looking at the browser), and until 0.4.41
// that was when the app stopped asking, and the next look at the devices made another code.
// linkWait: {code, site, again}, from the moment a code is showing until the app is linked.
let linkWait=null;
const linkLine=()=>linkWait?'Link code '+linkWait.code+': type it at '+linkWait.site+', under Setup, Link code.':'';
async function linkApp(again){
 deviceScreen('device-link');
 const started=await deviceHub('link');
 if(started.linked){linkWait=null;await again();return;}
 if(!started.ok){tiles('Link this app',[entry('Try again',()=>linkApp(again)),entry('Back to tasks',()=>menu())]);report(started.message||'The website could not be reached.');return;}
 const code=started.code.slice(0,3)+' '+started.code.slice(3),how='Sign in at '+started.site+', open Setup and type '+code+' under Link code. The code stays the same until it is used.';
 linkWait={code,site:started.site,again,busy:false};linkingApp=true;
 tiles('Link code '+code,[
  entry('Open the website to link',()=>openLinkPage(),'Opens Setup in your browser with the code filled in. Press Link there.'),
  entry('Code '+code,()=>report(how),'Or type it yourself at '+started.site+', under Setup'),
  entry('I have linked it',()=>linkApp(again),'Check again now'),
  entry('Back to tasks',()=>menu())]);
 report('This app is not linked to your devices yet. '+how);
}
// The Setup page in the person's browser, with the code filled in. The app then shows the screen
// behind it, so Link can be pressed there by eye (Click a video or button) or by hand.
async function openLinkPage(){
 const opened=await deviceHub('open-link');
 if(opened.linked){const again=linkWait?.again;linkWait=null;if(again)await again();else menu();return;}
 if(!opened.ok){report(opened.message||'The browser could not be opened. Type the code at the website instead.');return;}
 browse();report('Setup is open in your browser with the code filled in. Press Link there. '+linkLine());
}
setInterval(async()=>{
 const l=linkWait;if(!l||l.busy)return;
 l.busy=true;const result=await deviceHub('link-status');l.busy=false;
 if(linkWait!==l)return;
 if(result.linked){
  linkWait=null;
  // On the code's own screen the devices open by themselves; anywhere else a line says so.
  if(stage==='device-link'&&!busy)run(async()=>{await l.again();report('This app is now linked to your devices.');});
  else report('This app is now linked to your devices. Choose Use saved devices.');
 }
 else if(result.expired){linkWait=null;if(stage==='device-link'&&!busy)run(()=>linkApp(l.again));}
},3000);
function syncTypingRegion(){
 const top=!$('composer').hidden&&![...document.querySelectorAll('dialog')].some(d=>d.open)?Math.floor($('typing-dock').getBoundingClientRect().top):null;
 if(top===typingRegion)return;typingRegion=top;desktop?.typingRegion?.(top)?.catch(()=>{});
}
function hideComposer(){if(!$('composer').hidden)drafts[destination]=text;$('composer').hidden=true;$('typing-dock').hidden=true;document.body.classList.remove('typing-docked','typing-direct');$('workspace').classList.remove('composing');$('workspace').insertBefore($('tiles'),$('gaze'));syncTypingRegion();}
function refreshWords(){
 const field=$('draft-text');if(!field)return;const previous=wordChoices.map(c=>c.word).join('|');wordChoices=wordEngine.suggest(text,field.selectionStart);
 if(previous!==wordChoices.map(c=>c.word).join('|')){const locked=dwell.locked;intent.reset();dwell.reset();dwell.locked=locked;blockedUntil=performance.now()+200;}
 for(let i=0;i<3;i++){const choice=wordChoices[i],button=$('word-'+i);button.textContent=choice?.word||'—';button.disabled=!choice;button.setAttribute('aria-label',choice?'Use word '+choice.word:'No word suggestion');}
 $('draft-undo').disabled=!typingUndo;
 // The row of word suggestions takes a row of the screen: it is there only while it has something to offer.
 const empty=!wordChoices.length&&!typingUndo,row=$('word-0').parentElement;
 if(row.classList.contains('empty')!==empty){row.classList.toggle('empty',empty);requestAnimationFrame(syncTypingRegion);}
}
function setDraft(value,caret=value.length,undo=null){
 text=value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1000);drafts[destination]=text;typingUndo=undo;
 $('draft-text').value=text;$('draft-text').setSelectionRange(Math.min(caret,text.length),Math.min(caret,text.length));$('draft-submit').disabled=!text.trim();$('draft-enter').disabled=!text.trim();$('draft-delete').disabled=!text;refreshWords();
 const locked=dwell.locked;intent.reset();dwell.reset();dwell.locked=locked;blockedUntil=performance.now()+200;
}
// Typing into another app is direct: every key goes to that app at once, and the panel is the
// keyboard and nothing else, so the app stays in view above it. (Until 0.4.33 the text was written
// into a draft here first, and the panel with its draft, word row and buttons covered most of the
// screen.) Searches and the name of an app to open are still written here first: they are sent
// as a whole.
const directTyping=()=>destination==='app';
let directEcho='';
function compose(target){hideComposer();destination=target;text=drafts[target]??'';letterGroup=null;keyboardPage='letters';directEcho='';document.body.classList.add('viewing','typing-docked');document.body.classList.toggle('typing-direct',target==='app');$('snapshot').hidden=true;$('composer').hidden=false;$('typing-dock').hidden=false;$('typing-dock').append($('tiles'));$('workspace').classList.add('composing');$('practice-scene').hidden=!!desktop;
 $('draft-label').textContent=target==='ask'?ask.label:target==='app'?'Text to type into the selected box':target==='launch'?'Name of the app to open (Windows searches for it and opens the first result)':target==='youtube'?'Your YouTube search':'Your Google search';
 $('draft-help').textContent='';
 $('draft-submit').textContent=target==='ask'?ask.submit:target==='app'?'Type only':target==='launch'?'Open this app':target==='youtube'?'Search YouTube':'Search Google';$('draft-submit').classList.toggle('primary',target!=='app');$('draft-enter').hidden=target!=='app';setDraft(text);keyboard();
}
function keyboard(){stage='keyboard';letterGroup=null;keyboardPage='letters';$('snapshot').hidden=true;
 // Rows and columns for the measured accuracy. All letters at once only when
 // keys large enough for it fit; otherwise letters are chosen by groups.
 const grid=typingLayout(),title=keyboardTitle();
 if(directTyping()){directKeyboard(grid);return;}
 $('draft-compact').hidden=keyboardLayout==='compact';
 if(keyboardLayout==='compact'&&grid.capacity>=30){flatKeyboard();return;}
 if(grid.fine){tiles(title,[
 ...['ABCDEFGHI','JKLMNOPQR','STUVWXYZ'].map(g=>entry(g[0]+' – '+g.at(-1),()=>letters(g),g.split('').join(' '))),entry('Numbers & symbols',()=>symbols(),'0–9, punctuation and other characters')]);return;}
 tiles(title,[...letterGroups(grid.capacity).map(g=>entry(g.length>6?g[0]+' – '+g.at(-1):g.split('').join(' '),()=>letters(g))),entry('1 2 3 . , ?',()=>symbols())],false,0,{kind:'keyboard',columns:grid.columns,rows:grid.keyRows});}
const keyboardTitle=()=>destination==='ask'?ask.title:destination==='app'?'Write your text':destination==='launch'?'Write the name of the app':destination==='youtube'?'Write a YouTube search':'Write a Google search';
// One key press sent straight to the other app. What was sent is echoed in the bar below the
// keys, because the box being typed into may lie behind them.
async function typeDirect(payload){
 await command(payload);
 if(payload.type==='text')directEcho=(directEcho+payload.text).slice(-40);else if(payload.key==='backspace')directEcho=Array.from(directEcho).slice(0,-1).join('');else directEcho='';
 $('typed').textContent=directEcho?'Typed: '+directEcho:'';focusRebind=true;
}
const directControls=()=>({space:entry('Space',()=>typeDirect({type:'text',text:' '})),del:entry('Delete',()=>typeDirect({type:'key',key:'backspace'})),enter:entry('Enter',()=>typeDirect({type:'key',key:'enter'}))});
// The keyboard for typing into another app: letters and the three keys every text needs, in
// three rows when the keys fit that way, otherwise letters by groups as before.
function directKeyboard(grid){
 const c=directControls(),key=ch=>entry(uppercase?ch:ch.toLowerCase(),()=>append(uppercase?ch:ch.toLowerCase()));
 const columns=grid.fine?Math.max(5,Math.min(10,Math.floor((innerWidth-32)/48))):grid.columns;
 if(columns>=10&&(grid.fine||grid.capacity>=30)){
  stage=keyboardPage==='letters'?'keyboard':'symbols';letterGroup=null;
  const again=()=>directKeyboard(typingLayout()),swap=entry(keyboardPage==='letters'?'123':'ABC',()=>{keyboardPage=keyboardPage==='letters'?'symbols':'letters';again();}),caps=entry('Aa',()=>{uppercase=!uppercase;again();});
  const keys=keyboardPage==='letters'?[...[...'QWERTYUIOP'].map(key),...[...'ASDFGHJKL'].map(key),c.del,...[...'ZXCVBNM'].map(key),c.space,c.enter,swap]:[...[...'1234567890'].map(key),...[...'.,?!@/:_-+'].map(key),...[...`'"()&`].map(key),caps,swap,c.space,c.del,c.enter];
  tiles(keyboardTitle(),keys,false,0,{kind:'keyboard',columns:10,rows:3});
 }else{
  const entries=[...letterGroups(grid.capacity).map(g=>entry(g.length>6?g[0]+' – '+g.at(-1):g.split('').join(' '),()=>letters(g))),entry('1 2 3 . , ?',()=>symbols()),c.space,c.del,c.enter];
  tiles(keyboardTitle(),entries,false,0,{kind:'keyboard',columns,rows:Math.ceil(entries.length/columns)});
 }
 $('typed').textContent=directEcho?'Typed: '+directEcho:'';$('hint').textContent='';
}
function setKeyboardLayout(value){keyboardLayout=value;try{localStorage.setItem('hands-free.keyboard-layout',value);}catch{}rememberOptions();keyboard();}
function flatKeyboard(){
 stage=keyboardPage==='letters'?'keyboard':'symbols';letterGroup=null;
 const characters=keyboardPage==='letters'?'QWERTYUIOPASDFGHJKL.ZXCVBNM?':'1234567890@/:_-+?!,.;()\'"&=%#';
 const keys=[...characters].map(c=>entry(uppercase?c:c.toLowerCase(),()=>append(uppercase?c:c.toLowerCase())));
 keys.push(entry(keyboardPage==='letters'?'123':'ABC',()=>{keyboardPage=keyboardPage==='letters'?'symbols':'letters';flatKeyboard();}),entry('Aa',()=>{uppercase=!uppercase;flatKeyboard();}));
 const columns=typing.fine?Math.max(5,Math.min(10,Math.floor((innerWidth-32)/48))):typing.columns;
 tiles(keyboardTitle(),keys,false,0,{kind:'keyboard',columns,rows:Math.ceil(keys.length/columns)});
 $('tiles').style.gridTemplateRows=`repeat(${Math.ceil(keys.length/columns)},minmax(44px,86px))`;
}
function letters(group){stage='letters';letterGroup=group;
 // The letters of a group at once when they fit one page beside Back; otherwise smaller groups first.
 const groups=group.length>(typing.fine?4:Math.max(4,typing.capacity-1))?Array.from({length:Math.ceil(group.length/3)},(_,i)=>group.slice(i*3,i*3+3)):null;
 const entries=groups?groups.map(g=>entry(g.split('').join(' '),()=>letters(g))):Array.from(group,c=>entry(uppercase?c:c.toLowerCase(),()=>append(uppercase?c:c.toLowerCase())));
 if(typing.fine){tiles(groups?'Choose a smaller group':'Choose a letter',entries);return;}
 // A wrong group is left by Back, a key as large as the others.
 tiles(groups?'Choose a smaller group':'Choose a letter',[...entries,entry('Back',()=>keyboard())],false,0,{kind:'keyboard',columns:typing.columns,rows:typing.keyRows});
}
function symbols(){if(keyboardLayout==='compact'&&!directTyping()){keyboardPage='symbols';flatKeyboard();return;}stage='symbols';letterGroup=null;const choices=[entry('0 1 2 3 4',()=>letters('01234')),entry('5 6 7 8 9',()=>letters('56789')),entry('. , ? !',()=>letters('.,?!')),entry('@ / : _ − +',()=>letters('@/:_-+'))];
 if(typing.fine)tiles('Numbers & symbols',choices);else tiles('Numbers & symbols',[...choices,entry('Back',()=>keyboard())],false,0,{kind:'keyboard',columns:typing.columns,rows:typing.keyRows});}
async function append(c){
 if(directTyping()){await typeDirect({type:'text',text:c});if(stage==='letters'||!$('tiles').classList.contains('keyboard'))keyboard();return;}
 const field=$('draft-text'),result=insertText(text,field.selectionStart,field.selectionEnd,c,wordEngine,autocorrect);setDraft(result.text,result.caret,result.undo);if(result.corrected)report('Corrected to '+result.corrected+' · Undo is available');if(stage==='letters'||!$('tiles').classList.contains('keyboard'))keyboard();}
function typeHelp(){hideComposer();stage='type-help';document.body.classList.remove('viewing');$('snapshot').hidden=true;tiles('Choose where to type',[
 entry('Find a text box',()=>browse(),'Look near the text box to select it'),
 entry('Text box already selected',()=>compose('app'),'Write into the box that already has the cursor'),
 entry('Press Enter',async()=>{await command({type:'key',key:'enter'});browse();},'Submit text already in the other app'),entry('Back to tasks',()=>menu())]);}
async function submitDraft(enter=false){
 if(!text.trim()){report('Choose some letters before sending your text.');return;}
 const value=text;
 if(destination==='ask'){const done=ask.done,name=value.trim().slice(0,ask.max);setDraft('');hideComposer();await done(name);return;}
 const launched=destination==='launch';
 if(destination==='app')await command({type:'text',text:value,...(enter?{submit:true}:{})});
 else if(launched)await command({type:'launch',text:value.trim().slice(0,60)});
 else if(desktop)await desktop.openSite(destination,value.trim());else $('practice-text').value=value.trim();
 setDraft('');focusRebind=true;browse();report(launched?`Asked Windows to open "${value.trim().slice(0,60)}". If something else opened, choose Apps & keys.`:desktop?(destination==='app'?(enter?'Text typed and Enter pressed.':'Text typed.'):'Search results opened. Look near a link to select it.'):'Practice search shown here.');
}
function textMenu(){stage='text-options';tiles('Text options',[
 entry('Keep writing',()=>keyboard()),entry(uppercase?'Use lowercase':'Use uppercase',()=>{uppercase=!uppercase;keyboard();}),
 entry('Clear this draft',()=>{setDraft('');keyboard();}),
 destination==='ask'?entry('Cancel',()=>ask.cancel()):destination==='app'?entry('Type + Enter',()=>submitDraft(true),'Type this draft and submit it in one action'):destination==='launch'?entry('Back to Apps & keys',()=>appsMenu()):entry(destination==='youtube'?'Open YouTube home':'Open Google home',()=>openSite(destination),'Open the website without searching'),
 entry(keyboardLayout==='compact'?'Larger keys':'Compact keyboard',()=>setKeyboardLayout(keyboardLayout==='compact'?'large':'compact')),
 entry('Autocorrect: '+(autocorrect?'on':'off'),()=>{autocorrect=!autocorrect;try{localStorage.setItem('hands-free.autocorrect',autocorrect?'on':'off');}catch{}rememberOptions();textMenu();})],false,0,{columns:3,rows:2});}
function keyMenu(){hideComposer();stage='keys';document.body.classList.remove('viewing');tiles('More controls',[
 ...[['Next field (Tab)','tab'],['Previous field','shifttab'],['Address bar','address'],['Browser back','back']].map(([label,key])=>entry(label,async()=>{await command({type:'key',key});browse();})),
 ...(stream&&validModel(model)?[entry('Quick alignment · 1 dot',()=>beginCapture('offset'),'Correct a steady offset, then measure seven fresh checks')]:[]),
 entry('Press Enter',async()=>{await command({type:'key',key:'enter'});browse();},'Submit text already in the other app'),
 entry('Other keys & settings',()=>settingsMenu()),entry('Back to tasks',()=>menu())]);}
function settingsMenu(){stage='settings';tiles('Keys & settings',[
 ...[['Next field (Tab)','tab'],['Previous field','shifttab'],['Address bar','address'],['Browser back','back']].map(([label,key])=>entry(label,async()=>{await command({type:'key',key});browse();})),
 entry(active?'Check accuracy':canControl()?'Resume eye control':'Set up eye control',()=>active?beginCapture('check'):canControl()?activate():backToSetup()),...(stream&&validModel(model)?[entry('Saved head positions',()=>openHeadPositions(),'Add nearby positions once; estimate the positions between them'),entry('Test gaze pointer',()=>previewGaze()),entry('Reading button position',()=>readingPositionMenu()),entry('Refine accuracy · 9 points',()=>beginCapture('refine')),diagnosticsEntry(settingsMenu)]:[]),entry('Device controls',()=>openSite('home')),entry('Back to tasks',()=>menu())]);}
function readingPositionMenu(){stage='reading-position';tiles('Reading button position',[
 ...['top-left','top-right','bottom-left','bottom-right'].map(dock=>entry(dock.replace('-',' '),()=>{
  readingDock=dock;try{localStorage.setItem('hands-free.reading-dock',dock);}catch{}rememberOptions();
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
 // Sent here by the Devices page to use the website with the eyes: open it, once.
 if(arrivedForSite&&site){arrivedForSite=false;browse();report('Eye control is on. Look at a button on the page and hold. '+saveNotice);}
}
async function pause(show=true){
 resetReturnGuide();
 resetReading();
 if(show&&(capture||pointRetry)){if(capture)showPointHelp('Setup paused.');await desktop?.pause();return;}
 const revision=++uiRevision;
 active=false;selectionsPaused=false;updateSelectionMode();capture=null;$('seat-guide').hidden=true;moveLabel('');pointer.reset();fixation.reset();intent.reset();dwell.reset();$('gaze').hidden=true;clearHighlight();document.body.classList.remove('active','viewing');updateTestNotice();
 if(desktop)pauseTask=Promise.resolve(desktop.pause()).catch(()=>{});
 await pauseTask;
 if(revision!==uiRevision)return;
 if(show){
  hideComposer();
  $('result-dialog').close();$('snapshot').hidden=true;$('cal-dot').hidden=true;
  if(canControl()){stage='paused';active=true;tiles('Paused',[entry('Resume',()=>activate()),entry('Check accuracy',()=>beginCapture('check')),entry('Back to setup',()=>backToSetup()),...(desktop?[entry('Close companion',()=>desktop.quit())]:[])]);report('Input is paused. Look at Resume for 0.6 seconds to continue.'+(linkWait?' '+linkLine():''));}
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
function backToSetup(){hideComposer();pause(false);clearTestMode();stopCamera();$('result-dialog').close();$('workspace').hidden=true;$('welcome').hidden=false;refreshProfile();stage='welcome';$('welcome-status').textContent='';$('welcome-status').classList.remove('alert');}
function fail(message){hideComposer();pause(false);clearTestMode();capture=null;$('cal-dot').hidden=true;stopCamera();$('result-dialog').close();$('welcome').hidden=false;$('workspace').hidden=true;refreshProfile();report(message);stage='welcome';
 // Why a start did not happen must not be missable: without it the button seems to do nothing.
 $('welcome-status').classList.add('alert');$('welcome-status').scrollIntoView?.({block:'nearest'});}
$('retry-point').onclick=()=>{if(!pointRetry)return;capture=pointRetry;pointRetry=null;stage=capture.kind;$('retry-point').hidden=true;$('cal-message').hidden=true;$('cal-dot').hidden=false;setCameraPreview(false);$('tracking-info').hidden=true;if(capture.seat){capture.seat.started=performance.now();capture.seat.since=null;capture.seat.shown=false;$('cal-dot').hidden=true;}
 // The head-movement step starts its current dot again (or its explanation, if no dot had appeared yet).
 else if(capture.kind==='move'){$('skip-move').hidden=false;if(capture.index<0){capture.started=performance.now();$('cal-dot').hidden=true;$('cal-message').textContent=MOVE_INTRO;$('cal-message').hidden=false;}else{capture.index--;moveDot(performance.now());}}
 else nextPoint(true);};
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
// ---- Diagnostics ------------------------------------------------------------
// Nothing here leaves the app unless Save diagnostics is pressed. It keeps, in
// memory only, the numbers each calibration or check step measured: per frame
// the two iris readings and the head position, never an image.
let diagnosticSteps=[],diagnosticFrames=[];
// Re-centring from use: what each selection said about where the pointer was.
const recentreLog=[];
const freshLock=()=>({held:0,unsteady:0,other:0,none:0,rejected:0,switches:0});
let lockFrames=freshLock(),lockTarget=null;
// What was asked of the camera's picture adjustments and what came of it.
const pictureLog=[];
const FRAME_FIELDS=['h','v','lh','lv','rh','rv','x','y','scale','roll','yaw','pitch','lo','ro'],ALT_FIELDS=['h','v','lh','lv','rh','rv'];
const rounded=v=>Number.isFinite(v)?Math.round(v*1e5)/1e5:null;
function compactFeature(f){
 if(!f)return null;
 const out={};for(const k of FRAME_FIELDS)if(Number.isFinite(f[k]))out[k]=rounded(f[k]);
 if(f.alt)out.alt=ALT_FIELDS.map(k=>rounded(f.alt[k]));
 return out;
}
function rememberStep(kind,groups,result=null){
 // Something new to save: the bottom-bar button appears, or offers saving again.
 diagnosticsSaved='';$('diagnostics-bar').hidden=false;$('diagnostics-bar').textContent='Save diagnostics';
 diagnosticSteps.push({kind,at:Date.now(),groups:groups.map(g=>({target:g.target,samples:g.samples.map(compactFeature)})),...(result?{validation:result}:{}),...(model&&kind==='check'?{model}:{})});
 if(diagnosticSteps.length>12)diagnosticSteps.splice(1,diagnosticSteps.length-12);
}
function rememberFrame(data,reason){
 const f=data.feature,h=data.head||f;
 diagnosticFrames.push([Math.round(data.timestamp),capture.seat?'seat':capture.kind,capture.seat?-1:capture.index,reason,...FRAME_FIELDS.map(k=>rounded(f?.[k]??(['x','y','scale','roll','yaw','pitch'].includes(k)?h?.[k]:null))),...ALT_FIELDS.map(k=>rounded(f?.alt?.[k])),...[0,1].map(i=>{const l=data.quality?.light?.[i];return l?Math.round(l.white):null;}),
  // For each eye, the share of the iris under a reflection and the share under the lid, and the eye that was
  // not read in this frame, if one was not: what a recording made with glasses has to show.
  ...[0,1].map(i=>data.quality?.light?.[i]?.glare??null),...[0,1].map(i=>data.quality?.light?.[i]?.covered??null),data.quality?.oneEye||null]);
 if(diagnosticFrames.length>9000)diagnosticFrames.splice(0,diagnosticFrames.length-9000);
}
// Where the checks' estimates lay relative to their dots, in words.
function shiftText(p){
 const parts=[];if(p.x)parts.push(`${Math.abs(p.x)} px ${p.x>0?'right':'left'}`);if(p.y)parts.push(`${Math.abs(p.y)} px ${p.y>0?'down':'up'}`);
 return parts.join(' and ');
}
// Writes the diagnostics file and says where it went. Reachable from the result
// window (shown when a check fails) and from the Paused and settings menus, so
// that a session whose check passed can be saved too.
async function saveDiagnosticsFile(){
 const text=JSON.stringify({format:'hands-free-diagnostics',formatVersion:1,app:'0.4.41',savedAt:new Date().toISOString(),screen:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},trackingMode:$('tracking-mode').value,setup:sessionSetup||null,camera:cameraStats||null,model:model||null,validation:validation||null,picture:stream?.getVideoTracks()[0]?pictureControls(stream.getVideoTracks()[0]):null,pictureLog,pictureProbe,lensChoice,lens:{inUse:lensControl(stream?.getVideoTracks()[0]).lens,byHand:handLens(),log:lensLog},faceEdges:edgeTally,reflections:reflections.bands,settings:{headMove:$('head-move').checked,lidInput:$('lid-input').checked,darkCalibration:$('dim-capture').checked,calibration:$('calibration-mode').value},recentre:{on:recentreOn(),shift:[Math.round(recentre.shift[0]*innerWidth),Math.round(recentre.shift[1]*innerHeight)],looking:recentre.looking.map(v=>Math.round(v*100)/100),log:recentreLog},light:lastLight,steps:diagnosticSteps,frameColumns:['time','step','point','status',...FRAME_FIELDS,...ALT_FIELDS.map(k=>'pixels_'+k),'eye_white_1','eye_white_2','eye_glare_1','eye_glare_2','eye_lid_1','eye_lid_2','eye_not_read'],frames:diagnosticFrames});
 try{
  if(desktop?.saveDiagnostics){const where=await desktop.saveDiagnostics(text);return {saved:true,file:String(where).split(/[\\/]/).pop(),message:`Diagnostics saved to ${where}. Numbers only: eye and head readings for each dot, the map and the check results. No images and no name.`};}
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));link.download='hands-free-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),10000);
  return {saved:true,file:link.download,message:'Diagnostics downloaded. Numbers only: no images and no name.'};
 }catch(e){return {saved:false,message:'Diagnostics could not be saved: '+(e.message||e)};}
}
$('save-diagnostics').onclick=async()=>{$('diagnostics-status').textContent=(await saveDiagnosticsFile()).message;};
// The same, as a menu tile: the outcome goes to the status line.
// The outcome stays in the bottom bar: the status line is rewritten many times
// a second while tracking runs.
let diagnosticsSaved='';
async function saveDiagnosticsNow(){
 const result=await saveDiagnosticsFile();diagnosticsSaved=result.saved?result.file:'';
 $('save-status').textContent=result.saved?`Diagnostics saved: ${result.file} (numbers only)`:result.message;
 $('diagnostics-bar').textContent=diagnosticsSaved?'Diagnostics saved':'Save diagnostics';
}
// A small button in the bottom bar, for the mouse: it is not a gaze target.
$('diagnostics-bar').onclick=saveDiagnosticsNow;
// The same as a tile in Keys & settings, for saving by gaze.
function diagnosticsEntry(again){return entry(diagnosticsSaved?'Diagnostics saved':'Save diagnostics',async()=>{await saveDiagnosticsNow();again();});}
$('copy-report').onclick=async()=>{
 const content=['Screen control 0.4.41',$('result-title').textContent,resultReport||$('result-copy').textContent,$('result-sides').textContent,...[...$('result-details').children].map(n=>n.textContent)].join('\n\n');
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
$('pause').onclick=()=>stage==='preview'?run(()=>activate(previewUnverified||validation?.passed!==true)):active||capture?pause():backToSetup();$('cancel').onclick=()=>{if(stage==='preview')backToSetup();else if(capture)backToSetup();
 // Back while the camera is still being set up (the camera check, before any dot) goes back to setup.
 // It used to fall through to the task menu: tiles over the desktop that answered neither eyes nor reason.
 else if(['align','starting','camera-preview'].includes(stage))backToSetup();
 else if(stage==='grid'&&zoomHistory.length){rect=zoomHistory.pop();depth--;grid();}else if(['letters','symbols','text-options'].includes(stage))keyboard();else if(stage==='keyboard'&&directTyping()||stage==='apps'||stage==='choose')browse();else if(stage==='keyboard'&&destination==='launch')appsMenu();else if(stage==='keyboard'&&destination==='ask')ask.cancel();else if(stage==='device'||stage==='device-confirm')run(()=>devicesMenu());else if(stage==='device-wait')run(()=>stopWaiting());else if(['device-kind','device-edit','device-saved'].includes(stage))run(()=>deviceSetup());else if(stage==='paused')backToSetup();else if(stage!=='welcome')menu();else backToSetup();};
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
$('draft-hide').onclick=()=>destination==='ask'?ask.cancel():browse();$('draft-pause').onclick=()=>pause();
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
setInterval(()=>{if(returnGuide.visible&&performance.now()-lastSample>250)renderReturnGuide(returnGuide.update(null,headPositions,performance.now(),{...returnOptions(),reason:'eyes-unavailable'}),null);if((active||stage==='preview')&&performance.now()-lastSample>500){intent.reset();dwell.update(null,performance.now());pointer.reset();$('gaze').hidden=true;$('wake-progress').value=0;drawEyes(null);clearHighlight();desktop?.heartbeat(false);report('Waiting for fresh eye tracking. No action will be sent.');}if(capture&&lastReceived&&performance.now()-lastReceived>5000)showPointHelp('Camera frames stopped arriving.');if(capture&&!capture.seat&&performance.now()-capture.started>20000)showPointHelp(lastQuality);},100);
// ?go=site: "Start eye control" on the Devices page of the website. With a calibration saved for
// the profile the camera starts at once, and the website opens when eye control is on. Without
// one, the setup panel says what to do first.
arrivedForSite=!desktop&&new URLSearchParams(location.search).get('go')==='site';
if(arrivedForSite){
 const saved=loadSaved(),ready=saved&&validModel(saved.model)&&saved.setup?.cameraVersion&&!cameraChoiceDirty&&$('person').value.trim();
 if(ready)startCamera('resume');
 else report(!$('person').value.trim()?'To use this website with your eyes: enter your profile name, check the camera, then start.':(cameraNote?cameraNote+' ':'')+'To use this website with your eyes, this profile needs a calibration with this camera first. Check the camera above, then start. The website opens when eye control is on.');
}
