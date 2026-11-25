import {ProfileStore} from './vendor/profile-store.mjs';
import {EyeSelector,DwellSelector} from './eye-selection.mjs';
import {screenSummary,chooseCamera} from './screen-profile.mjs';
import {keepSending,heldMessage,pressAndHold} from './screen-devices.mjs';
const $=id=>document.getElementById(id),selector=new EyeSelector(),dwell=new DwellSelector(600,{pauseMs:300});
const fanItems=[['captured_power','Power toggle'],['captured_level_down','Speed down'],['captured_level_up','Speed up'],['captured_mode','Change mode'],['captured_silence','Silence'],['captured_turn','Turn'],['captured_timer','Timer'],['pause','Pause eye controls'],['switch-device','Switch to TV']];
let token='',connected=false,index=0,sending=false,paused=false,stream,worker,ready=false,inFlight=false,lastFrame=0,lastFeature=0,lastVideoTime=-1,frameLoop=0,calibrating=null,calStart=0,cameraGeneration=0,setupStep='welcome';
const samples={};
let profiles;try{profiles=new ProfileStore(window.localStorage);}catch{profiles=new ProfileStore(null);}
const tvItems=[['tv_power','Power toggle'],['tv_volume_down','Volume down'],['tv_volume_up','Volume up'],['tv_mute','Mute'],['tv_channel_down','Channel down'],['tv_channel_up','Channel up'],['tv_input','Input'],['pause','Pause eye controls'],['switch-device','Switch to fan']];
let activeDevice='fan',items=fanItems,availableCommands=new Set(fanItems.filter(x=>x[0].startsWith('captured_')).map(x=>x[0]));
let iconNames=['power','minus','plus','mode','silence','turn','timer','pause','tv'];
// On the website (cloud mode) the devices and their buttons are the ones set up on the site, not
// the two fixed lists above, and a command goes to the transmitter board through the site.
// embedded: this page is shown inside Screen control, to be used with its eye pointer. Its own
// camera, profiles and look-left-or-right controls are then left out.
const cloud=globalThis.handsFreeCloud===true,embedded=cloud&&window.top!==window.self,kindIcon={fan:'fan',tv:'tv',heater:'heat',light:'light',other:'dot'};
// holdIds: the buttons of the device in view that keep sending while they are held down (the
// website marks volume, channel and arrow buttons `hold`). holding: the one being held now.
let appliances=[],confirming=null,hubSignature='',holdIds=new Set(),holding=null;
function cloudItems(){
 const device=appliances.find(a=>a.id===activeDevice)||appliances[0];
 holdIds=new Set(!device||device.careful?[]:device.buttons.filter(b=>b.hold===true).map(b=>b.id));
 if(!device){items=[['pause','Pause eye controls']];iconNames=['pause'];return;}
 activeDevice=device.id;
 // An appliance that asks first (a heater) shows two choices, with "No" in focus.
 if(confirming){items=[['confirm','Yes, send '+confirming[1]],['cancel','No, go back']];iconNames=['check','pause'];return;}
 const more=appliances.length>1,next=appliances[(appliances.indexOf(device)+1)%appliances.length];
 const pause=embedded?[]:[['pause','Pause eye controls']];
 items=[...device.buttons.map(b=>[b.id,b.label]),...pause,...(more?[['switch-device','Next: '+next.name]]:[])];
 iconNames=[...device.buttons.map(b=>b.icon),...pause.map(()=>'pause'),...(more?[kindIcon[next.kind]||'dot']:[])];
}
function paintDevices(){
 const holder=document.querySelector('.device-switcher');if(!cloud||!holder)return;
 const device=appliances.find(a=>a.id===activeDevice),since=s=>s<90?'just now':s<5400?Math.round(s/60)+' min ago':Math.round(s/3600)+' h ago';
 holder.replaceChildren();
 for(const a of appliances){
  const b=document.createElement('button'),name=document.createElement('div'),note=document.createElement('span');
  b.type='button';b.className='device'+(a===device?' active':'');b.setAttribute('aria-pressed',String(a===device));b.innerHTML=icon(kindIcon[a.kind]||'dot');
  name.textContent=a.name;note.textContent=a.lastSent?a.lastSent.label+' sent '+since(a.lastSent.secondsAgo):a.buttons.length+(a.buttons.length===1?' button':' buttons');
  name.append(note);b.append(name);b.setAttribute('aria-label',a.name+', '+note.textContent);b.onclick=()=>selectDevice(a.id);holder.append(b);
 }
 $('remote-name').textContent=device?device.name:'No appliances yet';$('remote-section').setAttribute('aria-label',(device?device.name:'Appliance')+' controls');
}
async function refreshHub(){
 if(!cloud)return;
 try{
  const state=await api('/api/hub'),sender=state.transmitter;
  const signature=JSON.stringify(state.appliances.map(a=>[a.id,a.name,a.kind,a.careful,a.buttons.map(b=>[b.id,b.label,b.icon,b.hold===true])]));
  appliances=state.appliances;connected=sender.linked;document.body.dataset.connected=String(sender.online);
  $('mode').textContent=!sender.linked?'No transmitter board is linked yet. Open Setup to link it.':!sender.online?'Transmitter offline · nothing is sent until it reconnects':sender.practice?'Transmitter online · practice mode: no infrared is sent':'Transmitter online';
  if(signature!==hubSignature&&!sending){hubSignature=signature;confirming=null;cloudItems();index=Math.min(index,items.length-1);cancel();}
  paintDevices();
 }catch(e){$('mode').textContent=e.message;}
}
function available(command){return cloud||command==='pause'||command==='switch-device'||availableCommands.has(command);}
function selectDevice(device){
 if(sending||modalOpen())return;
 if(cloud){activeDevice=device;confirming=null;cloudItems();index=0;cancel();paintDevices();$('result').textContent='';return;}
 activeDevice=device;items=device==='tv'?tvItems:fanItems;
 iconNames=device==='tv'?['power','minus','plus','silence','minus','plus','mode','pause','fan']:['power','minus','plus','mode','silence','turn','timer','pause','tv'];
 index=0;cancel();
 $('device-fan').className='device'+(device==='fan'?' active':'');$('device-tv').className='device'+(device==='tv'?' active':'');
 $('device-fan').setAttribute('aria-pressed',String(device==='fan'));$('device-tv').setAttribute('aria-pressed',String(device==='tv'));
 $('remote-name').textContent=device==='tv'?'TV':'Fan';$('remote-section').setAttribute('aria-label',(device==='tv'?'TV':'Fan')+' controls');
 $('result').textContent='';
}
$('device-fan').onclick=()=>selectDevice('fan');$('device-tv').onclick=()=>selectDevice('tv');
function icon(name){return '<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';}
function cameraStamp(){const settings=stream?.getVideoTracks()[0]?.getSettings()||{};return {deviceId:settings.deviceId||'',width:settings.width||$('video').videoWidth,height:settings.height||$('video').videoHeight};}
function updateProfileUI(){
 const profile=profiles.active;
 $('profile-label').textContent=profile?profile.name:'Profile';
 $('avatar').textContent=profile?profile.name.slice(0,1).toUpperCase():'+';
 $('greeting').textContent=profile?'PROFILE: '+profile.name.toUpperCase():'HANDS FREE';
 $('saved-status').textContent=profile?(profile.calibration?'Calibration saved for '+profile.name+'.':'Complete calibration to save it for '+profile.name+'.'):'Create a profile to save calibration.';
 $('profile-forget').hidden=!profile;
 $('profile-settings').hidden=!profile;
 $('setup-nudge').hidden=!!profile?.calibration&&(!stream||!!selector.calibration);
 $('profile-calibration-status').textContent=profile?.calibration?'Calibration saved':'Calibration needed';
 $('profile-calibrate').textContent=profile?.calibration?'Edit calibration':'Continue setup';
 $('profile-list').replaceChildren();
 for(const saved of profiles.data.profiles){
  const button=document.createElement('button');button.className='profile-option'+(saved.id===profile?.id?' active':'');
  const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=saved.name.slice(0,1).toUpperCase();
  const copy=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=saved.name;detail.textContent=(saved.id===profile?.id?'Current profile · ':'')+(saved.calibration?'Calibration saved on this device':'Calibration needed');copy.append(name,detail);button.append(avatar,copy);
  button.onclick=()=>{try{stop();profiles.select(saved.id);updateProfileUI();$('profile-dialog').close();$('calibration').textContent='Start the camera.';resumeSetup();}catch(e){$('profile-message').textContent=e.message;}};
  $('profile-list').append(button);
 }
 globalThis.handsFreeProfileChanged?.(profile);
}
function openProfiles(){if($('setup-dialog').open)$('setup-dialog').close();cancel();updateProfileUI();$('profile-message').textContent=profiles.error;$('profile-dialog').showModal();}
function saveCalibration(){
 if(!profiles.active){$('saved-status').textContent='Calibration is ready. Create a profile to save it.';openProfiles();return;}
 try{profiles.save(selector.calibration,cameraStamp());updateProfileUI();$('calibration').textContent='Calibration saved for '+profiles.active.name+'.';return true;}
 catch(e){$('setup-error').textContent=e.message;return false;}
}
function restoreCalibration(){
 const restored=profiles.restore(cameraStamp());
 if(restored){selector.calibration=restored;selector.reset();resetHold();$('calibration').textContent='Calibration loaded';for(const key of ['center','left','right'])$(key).dataset.complete='true';}
 else if(profiles.active?.calibration){$('tracking').textContent='Camera changed · realign in Profile';$('setup-nudge').hidden=false;}
 updateProfileUI();
}
$('profile-open').onclick=openProfiles;$('profile-rail').onclick=openProfiles;
$('profile-close').onclick=()=>{$('profile-dialog').close();cancel();};
$('profile-guest').onclick=()=>{$('profile-dialog').close();cancel();};
$('profile-dialog').addEventListener('close',()=>cancel());
$('profile-form').onsubmit=e=>{e.preventDefault();try{
 const unsaved=!profiles.active&&selector.calibration?{...selector.calibration}:null;const camera=cameraStamp();
 profiles.create($('profile-name').value,id());
 if(unsaved)profiles.save(unsaved,camera);else if(selector.calibration)stop();
 updateProfileUI();$('profile-name').value='';$('profile-dialog').close();cancel();
 if(unsaved){profiles.completeOnboarding();}else openSetup('camera');
 }catch(error){$('profile-message').textContent=error.message;}};
$('profile-forget').onclick=()=>{try{const profile=profiles.active;if(!profile)return;profiles.remove(profile.id);stop();updateProfileUI();$('profile-message').textContent='Profile removed from this browser.';}catch(e){$('profile-message').textContent=e.message;}};

function showEyes(eyes,valid){
 const canvas=$('eyes'),video=$('video'),box=video.getBoundingClientRect();
 const dpr=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.round(box.width*dpr));canvas.height=Math.max(1,Math.round(box.height*dpr));
 const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,box.width,box.height);
 if(!eyes||!video.videoWidth||!video.videoHeight)return;
 const scale=Math.min(box.width/video.videoWidth,box.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale,ox=(box.width-w)/2,oy=(box.height-h)/2;
 ctx.strokeStyle=valid?'#78ffe0':'#ffcf70';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;
 for(const outline of eyes.outlines){ctx.beginPath();outline.forEach((p,i)=>i?ctx.lineTo(ox+p.x*w,oy+p.y*h):ctx.moveTo(ox+p.x*w,oy+p.y*h));ctx.closePath();ctx.stroke();}
 for(const p of eyes.pupils){const x=ox+p.x*w,y=oy+p.y*h;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();}
}
function showDirection(f){const direction=selector.direction(f);$('direction').dataset.direction=direction;$('direction').textContent=!selector.calibration?'Eye direction: calibration needed':({left:'← Looking left · previous',right:'Looking right → · next',center:'Looking center · hold to select',uncertain:'Eye direction uncertain · no selection'}[direction]);}
function showHold(){
 const label=paused?'Resume eye controls':items[index][1];
 $('hold-progress').value=dwell.progress;
 $('hold-status').textContent=dwell.target===null?'Left / right to move · center to select':dwell.paused?'Tracking paused · '+label+' stays selected. Look center to '+(dwell.progress>0?'continue.':'restart the selection hold.'):dwell.progress>0?'Hold center · '+((1-dwell.progress)*dwell.ms/1000).toFixed(1)+' seconds · '+label:'Look center and hold for 0.6 seconds · '+label;
 document.querySelectorAll('.grid button.selected').forEach(b=>{b.style.setProperty('--hold-progress',(dwell.progress*100)+'%');const focus=b.querySelector('.focus-label');if(focus)focus.textContent=dwell.paused?'Paused':dwell.progress>0?((1-dwell.progress)*dwell.ms/1000).toFixed(1)+' sec':'In focus';});
}
function resetHold(){dwell.clear();showHold();}
function trackingUnavailable(now){
 selector.update(null,now);dwell.update(null,now);showHold();
 $('tracking').textContent='Eye tracking paused.';
}
function paint(){
 $('controls').replaceChildren();items.forEach(([id,label],i)=>{const b=document.createElement('button');b.innerHTML='<span class="control-icon">'+icon(iconNames[i])+'</span><span class="focus-label">In focus</span><span class="control-label">'+label+'</span>';b.setAttribute('aria-label',label);b.className=i===index?'selected':'';b.disabled=!connected||(sending&&holding!==id)||!available(id);if(!available(id))b.setAttribute('aria-label',label+' — capture required');
  // A button that can be held: a short press sends it once, a press kept down keeps sending it.
  const press=()=>{index=i;activate();};
  if(cloud&&!confirming&&holdIds.has(id)){let down=false;b.title='Hold down to keep sending';if(holding===id)b.classList.add('holding');pressAndHold(b,{press,start:()=>{down=true;holdSend(i,()=>down,b);},stop:()=>{down=false;}});}
  else b.onclick=press;
  $('controls').append(b);});
 $('pause').textContent=paused?'Resume eye controls':'Pause eye controls';showHold();
}
function cancel(){selector.reset();dwell.clear();paint();}
function modalOpen(){return $('profile-dialog').open||$('setup-dialog').open;}
function activate(){if(!connected||sending||modalOpen()||!available(items[index][0]))return;if(items[index][0]==='switch-device'){selectDevice(cloud?appliances[(appliances.findIndex(a=>a.id===activeDevice)+1)%appliances.length].id:activeDevice==='fan'?'tv':'fan');return;}if(items[index][0]==='pause'){paused=true;cancel();$('tracking').textContent='Eye controls paused.';return;}
 if(cloud&&items[index][0]==='cancel'){confirming=null;cloudItems();index=0;cancel();$('result').textContent='Nothing was sent.';return;}
 if(cloud&&items[index][0]==='confirm'){const action=confirming;confirming=null;cloudItems();index=0;send(action,true);return;}
 if(cloud&&appliances.find(a=>a.id===activeDevice)?.careful){confirming=items[index];cloudItems();index=1;cancel();$('result').textContent='Send '+confirming[1]+'? Choose Yes or No.';return;}
 send(items[index]);}
function id(){const a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function api(route,body){const r=await fetch(route,{method:body?'POST':'GET',headers:{...(cloud?{}:{Authorization:'Bearer '+token}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(cloud?20000:7000)});const data=await r.json();if(!r.ok){const problem=Error(data.message||'Controller unavailable');problem.status=r.status;throw problem;}return data;}
async function send(action,confirmed=false){if(!connected||sending||modalOpen()||!available(action[0]))return;sending=true;resetHold();$('result').textContent='Sending '+action[1]+'…';paint();try{const result=cloud?await api('/api/send',{button_id:action[0],request_id:id(),created_at:Date.now(),...(confirmed?{confirm:true}:{})}):await api('/api/command',{command:action[0],request_id:id(),created_at:Date.now()});$('result').textContent=action[1]+': '+result.message+(cloud&&!confirmed&&result.sent&&holdIds.has(action[0])?' Hold the button down to keep sending.':'');}catch(e){$('result').textContent=e.name==='TimeoutError'?'No answer from the website. Check the appliance before trying again.':e.message+(cloud?'':' No automatic retry.');}finally{sending=false;cancel();if(cloud)refreshHub();}}
// A button kept down with the mouse or a finger: it keeps sending, as a held remote does, until it
// is let go. One request is one signal of under a second, so it stops when the page stops asking.
async function holdSend(i,still,button){
 const action=items[i];
 if(!connected||sending||modalOpen()||!action||!holdIds.has(action[0]))return;
 sending=true;holding=action[0];index=i;resetHold();button.classList.add('holding');$('result').textContent=action[1]+': sending while it is held…';
 try{
  const done=await keepSending({still,send:async()=>{
   try{return {...await api('/api/send',{button_id:action[0],hold:true,request_id:id(),created_at:Date.now()}),ok:true,status:200};}
   catch(e){return {ok:false,status:e.status||0,message:e.name==='TimeoutError'?'No answer from the website. Check the appliance before trying again.':e.message};}
  }});
  $('result').textContent=action[1]+': '+heldMessage(done);
 }finally{sending=false;holding=null;cancel();refreshHub();}
}
function gesture(direction){
 if(sending||calibrating||!connected||modalOpen())return;
 if(paused){dwell.arm('resume');showHold();return;}
 for(let tries=0;tries<items.length;tries++){index=(index+(direction==='left'?-1:1)+items.length)%items.length;if(available(items[index][0]))break;}
 dwell.arm('control:'+index);paint();document.querySelector('#controls button.selected')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
}
function holdSelection(target){
 if(sending||calibrating||!connected||modalOpen())return;
 if(paused){if(target==='resume'){paused=false;cancel();}return;}
 if(target==='control:'+index)activate();
}
$('connect').onclick=async()=>{token=$('key').value;connected=false;document.body.dataset.connected='false';cancel();try{const s=await api('/api/status');if(typeof s.practice!=='boolean')throw Error('Unexpected controller response.');connected=s.online===true;availableCommands=new Set(Array.isArray(s.commands)?s.commands:fanItems.filter(x=>x[0].startsWith('captured_')).map(x=>x[0]));$('tv-status').textContent=s.commands?.some(c=>c.startsWith('tv_'))?'Signals loaded':'Capture required';document.body.dataset.connected=String(connected);$('connection-panel').open=!connected;$('fan-status').textContent=connected?'Connected':'Not connected';$('mode').textContent=s.practice?'Practice mode · commands are simulated':'Controller connected';}catch(e){$('mode').textContent=e.message;}paint();};
$('pause').onclick=()=>{paused=!paused;cancel();$('tracking').textContent=paused?'Eye controls paused.':'Eye controls resumed.';paint();};
function stop(){cameraGeneration++;cancelAnimationFrame(frameLoop);stream?.getTracks().forEach(t=>t.stop());stream=null;worker?.terminate();worker=null;ready=false;inFlight=false;lastVideoTime=-1;calibrating=null;selector.calibration=null;for(const k of Object.keys(samples))delete samples[k];cancel();showEyes(null,false);showDirection(null);$('video').srcObject=null;document.querySelector('.camera-preview').classList.remove('live');$('tracking').textContent='Camera off';$('calibration').textContent=profiles.active?.calibration?'Saved calibration is ready. Start the camera to restore it.':'Start your camera, then complete the three steps.';for(const k of ['center','left','right']){$(k).dataset.active='false';$(k).dataset.complete='false';}updateProfileUI();if($('setup-dialog').open&&['camera','center','left','right','retry'].includes(setupStep))goSetup('camera');}
$('stop').onclick=()=>{stop();if($('setup-dialog').open)goSetup('camera');};
$('start').onclick=async()=>{
 stop();if($('setup-dialog').open)goSetup('camera');const generation=cameraGeneration;
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){$('tracking').textContent='Camera requires HTTPS, or localhost on this computer. Open the secure website address on a tablet.';return;}
 try{$('tracking').textContent='Allow camera access.';const size={width:{ideal:640},height:{ideal:480},frameRate:{ideal:20,max:30}},open=camera=>navigator.mediaDevices.getUserMedia({video:camera?{...size,deviceId:{exact:camera}}:{...size,facingMode:'user'},audio:false});
  // The camera is the profile's own: the one picked for it in Screen control, or, with none
  // picked, the better camera when it is plugged in (see chooseCamera). A browser names no
  // cameras before the camera has been allowed once; then the first one opened may be swapped.
  let wanted=await profileCamera(),acquired;
  try{acquired=await open(wanted.named?wanted.deviceId:'');}catch(e){if(!wanted.named||!wanted.deviceId||e.name==='NotAllowedError')throw e;acquired=await open('');}
  if(!wanted.named){wanted=await profileCamera();if(wanted.named&&wanted.deviceId&&wanted.deviceId!==acquired.getVideoTracks()[0].getSettings().deviceId){try{const better=await open(wanted.deviceId);acquired.getTracks().forEach(t=>t.stop());acquired=better;}catch{}}}
  if(generation!==cameraGeneration){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;$('video').srcObject=stream;await $('video').play();if(generation!==cameraGeneration)return;document.querySelector('.camera-preview').classList.add('live');restoreCalibration();worker=new Worker('/vision-worker.mjs',{type:'module'});$('tracking').textContent='Loading local eye analysis…';worker.onmessage=({data})=>{
  if(data.type==='ready'){ready=true;lastFeature=performance.now();$('tracking').textContent=selector.calibration?'Saved calibration loaded.':'Camera ready · calibration needed';if($('setup-dialog').open)renderSetup();return;}
  if(data.type==='error'){stop();$('tracking').textContent='Eye analysis failed: '+data.message;return;}
  if(data.type==='feature'){
   inFlight=false;lastFeature=performance.now();const fresh=lastFeature-data.timestamp<=300;const f=fresh?data.feature:null;showEyes(fresh?data.eyes:null,!!f);showDirection(f);
   if(calibrating){captureCalibration(f,lastFeature);return;}
   if(!f){trackingUnavailable(lastFeature);return;}
   $('tracking').textContent=paused?'Paused':selector.calibration?'Eyes visible · hold center to select after moving':'Eyes visible · calibration needed';
   if(selector.calibration){const c=selector.calibration;if(Math.abs(f.x-c.x)>.08||Math.abs(f.y-c.y)>.08||Math.abs(f.scale/c.scale-1)>.25)$('tracking').textContent='Position changed · realign in Profile';}
   const event=selector.update(f,lastFeature);if(event)gesture(event);
   const direction=selector.direction(f),canSelect=connected&&!sending&&!modalOpen();
   const center=canSelect?(direction==='center'?true:direction==='uncertain'?null:false):false;
   const selected=dwell.update(center,lastFeature);showHold();if(selected!==null)holdSelection(selected);
  }
 };worker.onerror=()=>{stop();$('tracking').textContent='Eye analysis could not start.';};worker.postMessage({type:'init'});
 function loop(now){frameLoop=requestAnimationFrame(loop);if(document.hidden)return;if(ready&&now-lastFeature>350){showEyes(null,false);showDirection(null);trackingUnavailable(now);$('tracking').textContent='Eye tracking paused.';}if(!ready||inFlight||now-lastFrame<66||$('video').readyState<2||$('video').currentTime===lastVideoTime)return;inFlight=true;lastFrame=now;lastVideoTime=$('video').currentTime;const destination=worker;createImageBitmap($('video')).then(bitmap=>{if(worker===destination&&generation===cameraGeneration)worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);else bitmap.close();}).catch(()=>{inFlight=false;trackingUnavailable(performance.now());});}frameLoop=requestAnimationFrame(loop);
 }catch(e){if(generation===cameraGeneration){stop();$('tracking').textContent='Camera unavailable: '+e.message;}}
};

async function profileCamera(){
 try{
  const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId).map(d=>({deviceId:d.deviceId,label:d.label||''}));
  const saved=screenSummary(window.localStorage,profiles.active?.name||'');
  return {named:list.some(d=>d.label),deviceId:chooseCamera(list,{saved:saved.camera,calibrated:saved.calibrated}).deviceId};
 }catch{return {named:false,deviceId:''};}
}
// Setup blocks device activation and keeps saved calibration until a replacement succeeds.
const directions=['center','left','right'];

const setupPages={
 welcome:['SETUP','Eye control setup','Start the camera, calibrate left, center and right eye positions, then review the controls.','Begin setup →','◎'],
 camera:['CAMERA','Camera position','Start the camera. Keep both eyes visible.','Start calibration →','◎'],
 center:['CALIBRATION','Look straight ahead.','Hold comfortably.','Collecting…','◎'],
 left:['CALIBRATION','Look to your left.','Hold comfortably.','Collecting…','←'],
 right:['CALIBRATION','Look to your right.','Hold comfortably.','Collecting…','→'],
 retry:['RETRY CALIBRATION','Eyes not clearly detected','Adjust the light and try again.','Try again →','◎'],
 'save-failed':['CALIBRATION READY','Calibration could not be saved.','Allow browser storage, then retry.','Retry saving →','◎'],
 saved:['DONE','Calibration saved','Saved on this device.','Done','✓'],
};
const visionCard=document.querySelector('.vision-card');
let retryDirection='center';
function renderSetup(){
 const page=setupPages[setupStep];
 $('setup-dialog').dataset.step=setupStep;
 $('setup-progress').textContent=page[0];$('setup-title').textContent=page[1].replace('{name}',profiles.active?.name||'there');$('setup-copy').textContent=page[2];$('setup-next').textContent=page[3];$('setup-symbol').textContent=page[4];
 const cameraStep=['camera','center','left','right','retry'].includes(setupStep);
 if(cameraStep)$('setup-camera-slot').append(visionCard);else document.querySelector('.setup-column').prepend(visionCard);
 $('setup-camera-slot').hidden=!cameraStep;$('calibration-panel').hidden=!cameraStep||setupStep==='camera';
 $('setup-target').hidden=setupStep==='camera';
 $('setup-target').dataset.direction=setupStep;
 $('setup-target-label').textContent=directions.includes(setupStep)?'Look '+setupStep:'';
 $('setup-next').disabled=!!calibrating||(setupStep==='camera'&&!ready);
 $('setup-back').hidden=setupStep==='welcome'||setupStep==='saved'||setupStep==='save-failed'||setupStep==='camera';
 $('setup-back').disabled=!!calibrating;
 $('setup-note').textContent='';
 for(const key of directions){const active=calibrating===key,done=(samples[key]?.length||0)>=20;$(key).dataset.active=String(active);$(key).dataset.complete=String(done);const status=$(key).querySelector('small');if(status)status.textContent=active?'In progress':done?'Done':'Not started';}
}
function goSetup(step){setupStep=step;$('setup-error').textContent='';renderSetup();$('setup-title').focus();}
function openSetup(step='welcome'){
 if(!profiles.active){openProfiles();return;}
 $('profile-dialog').close();cancel();calibrating=null;
 for(const key of directions)delete samples[key];
 if(!$('setup-dialog').open)$('setup-dialog').showModal();goSetup(step);
}
function resumeSetup(){const p=profiles.active;if(p&&!p.onboardingComplete){if(p.calibration)profiles.completeOnboarding();else openSetup('camera');}}
function cleanupSetup(){
 calibrating=null;document.querySelector('.setup-column').prepend(visionCard);
 if(stream)selector.calibration=profiles.restore(cameraStamp());
 cancel();updateProfileUI();
}
function closeSetup(){cleanupSetup();$('setup-dialog').close();$('profile-open').focus();}
function startSample(direction){
 if(!ready){goSetup('camera');return;}
 cancel();retryDirection=direction;calibrating=direction;samples[direction]=[];calStart=performance.now();goSetup(direction);
 $('calibration').textContent='Get ready to look '+direction+'.';
}
function captureCalibration(feature,now){
 if(!$('setup-dialog').open){calibrating=null;return;}
 const elapsed=now-calStart;
 if(elapsed<2500){$('calibration').textContent='Get ready · '+Math.ceil((2500-elapsed)/1000)+' seconds';return;}
 if(elapsed<5000){if(feature)samples[calibrating].push(feature);$('calibration').textContent='Keep looking '+calibrating+' · '+Math.ceil((5000-elapsed)/1000)+' seconds';return;}
 const finished=calibrating;calibrating=null;
 if(samples[finished].length<20){goSetup('retry');$('setup-error').textContent='Not enough clear eye samples were collected. No new calibration has been saved.';return;}
 const next=directions[directions.indexOf(finished)+1];if(next){startSample(next);return;}
 try{selector.calibrate(samples);}catch{retryDirection='center';for(const key of directions)delete samples[key];goSetup('retry');$('setup-error').textContent='Eye positions were not distinct or steady enough. Repeat the three directions.';return;}
 goSetup('save-failed');if(saveCalibration()){profiles.completeOnboarding();closeSetup();}
}
function nextSetup(){
 if(calibrating)return;
 if(setupStep==='welcome'){goSetup('camera');return;}
 if(setupStep==='camera'){if(ready){for(const key of directions)delete samples[key];startSample('center');}return;}
 if(setupStep==='retry'){startSample(retryDirection);return;}
 if(setupStep==='save-failed'){if(saveCalibration()){profiles.completeOnboarding();closeSetup();}return;}
 if(setupStep==='saved'){profiles.completeOnboarding();closeSetup();return;}
}
// Dialog navigation never shares the appliance dwell target.
$('setup-next').onclick=nextSetup;
$('setup-back').onclick=()=>{if(!calibrating)goSetup('camera');};
$('setup-close').onclick=closeSetup;$('setup-later').onclick=closeSetup;
$('setup-dialog').addEventListener('cancel',e=>{e.preventDefault();closeSetup();});
$('setup-dialog').addEventListener('close',()=>{if(!$('setup-dialog').open)cleanupSetup();});
$('profile-calibrate').onclick=()=>openSetup('camera');
$('setup-launch').onclick=()=>openSetup('camera');

document.addEventListener('visibilitychange',()=>{selector.reset();resetHold();if(document.hidden){paused=true;cancel();if(calibrating){calibrating=null;goSetup('retry');$('setup-error').textContent='Setup paused when you left this page. Try this direction again when you are ready.';}}});
window.addEventListener('pagehide',stop);
if(cloud){cloudItems();refreshHub();setInterval(()=>{if(!document.hidden)refreshHub();},5000);}
paint();updateProfileUI();if(embedded)document.documentElement.classList.add('embedded');else if(!profiles.active)openProfiles();else resumeSetup();
