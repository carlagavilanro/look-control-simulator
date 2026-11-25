// The appliance hub: what the website keeps between the receiver board, the transmitter board,
// the Windows app and the pages.
//
//   receiver board  --recordings-->  hub  <--buttons, send--  pages / Windows app
//   transmitter     <--commands----  hub
//
// A board at home cannot be reached from the internet, so each board connects OUT to the site:
// the receiver posts what it recorded, the transmitter asks "anything to send?" and waits for
// the answer. Nothing here opens a connection to a board.
//
// Rules that protect the person using it:
//   - A command is handed to the transmitter only within a few seconds of being asked for. It is
//     never delivered late (a heater must not come on minutes after the request).
//   - One command at a time, with a short gap, and the same request is never sent twice.
//   - The page is told which of three things happened: sent and confirmed, taken but not
//     confirmed, or never collected (nothing sent).
//   - Boards and the app are linked by a short code typed on the signed-in website. Their keys
//     are made here, shown to nobody, and only a hash is stored.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes,randomInt} from 'node:crypto';

export const LIMITS=Object.freeze({appliances:24,buttons:32,recordings:300,devices:12,timings:2048,recordBytes:32768,label:24,name:32,pending:30});
export const KINDS=Object.freeze(['fan','tv','heater','light','other']);
export const ICONS=Object.freeze(['power','minus','plus','up','down','left','right','ok','mode','silence','turn','timer','input','light','heat','fan','tv','dot']);
const DEVICE_KINDS=['receiver','transmitter','app'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const id=prefix=>prefix+'_'+randomBytes(6).toString('hex');
// A picture for a button from its name, when none was chosen.
export function iconFor(label){
 const text=String(label||'').toLowerCase();
 for(const [pattern,icon]of [[/mute|silen|quiet/,'silence'],[/timer|sleep/,'timer'],[/turn|swing|oscillat|rotat/,'turn'],[/mode/,'mode'],[/input|source/,'input'],[/\bok\b|select|enter/,'ok'],[/\bon\b|\boff\b|power/,'power'],[/\bleft\b|back/,'left'],[/\bright\b/,'right'],
  [/volume up|speed up|warmer|brighter|faster|louder|more|\+/,'plus'],[/volume down|speed down|cooler|dimmer|slower|less/,'minus'],[/\bup\b/,'up'],[/\bdown\b/,'down'],[/light|lamp/,'light'],[/heat/,'heat'],[/fan/,'fan']])if(pattern.test(text))return icon;
 return 'dot';
}
const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';

// The same checks the boards make (SignalStore.h / CaptureStore.h): 3 to 2048 positive whole
// microsecond timings that add up to at most one second.
export function validTimings(raw){
 if(!Array.isArray(raw)||raw.length<3||raw.length>LIMITS.timings)return false;
 let total=0;for(const value of raw){if(!Number.isInteger(value)||value<1||value>1000000)return false;total+=value;if(total>1000000)return false;}
 return true;
}
// One press of a remote usually repeats the same burst for as long as the button is held, so two
// recordings of one button differ in length. The first burst (up to the first long gap) is what
// identifies the button.
export function firstBurst(raw){const end=raw.findIndex((value,index)=>index%2===1&&value>=5000);return end<0?raw:raw.slice(0,end);}
export function sameSignal(a,b){
 const x=firstBurst(a),y=firstBurst(b);if(x.length<3||x.length!==y.length)return false;
 return x.every((value,index)=>Math.abs(value-y[index])<=Math.max(160,.22*Math.max(value,y[index])));
}

export function createHub({dataDir,seed=null,persistent=false,now=Date.now,timing={}}={}){
 const t={collect:6000,confirm:8000,poll:20000,learn:90000,gap:800,pair:10*60*1000,online:38000,...timing};
 const file=dataDir?path.join(dataDir,'hub.json'):null;
 let data={schema:1,devices:[],appliances:[],recordings:[]};
 const tokens=new Map(),live=new Map(),pending=new Map(),starts=new Map(),seen=new Map();
 let learning=null,learned=null,inFlight=null,lastSent=0,writing=Promise.resolve(),storageError='';

 const state=device=>{let s=live.get(device.id);if(!s){s={lastSeen:0,waiter:null,queued:null,practice:false};live.set(device.id,s);}return s;};
 const online=device=>{const s=state(device);return !!s.waiter||now()-s.lastSeen<t.online;};
 function index(){tokens.clear();for(const device of data.devices)tokens.set(device.tokenHash,device);}
 function save(){
  if(!file)return writing;
  const text=JSON.stringify(data);
  writing=writing.then(async()=>{await fs.mkdir(dataDir,{recursive:true});const temporary=file+'.'+randomBytes(4).toString('hex')+'.tmp';await fs.writeFile(temporary,text,{mode:0o600});await fs.rename(temporary,file);storageError='';}).catch(error=>{storageError=error.code||'write failed';});
  return writing;
 }
 function seedFan(){
  if(!seed?.commands?.length)return;
  const labels={captured_power:['Power','power'],captured_level_down:['Speed down','minus'],captured_level_up:['Speed up','plus'],captured_mode:['Mode','mode'],captured_silence:['Silence','silence'],captured_turn:['Turn','turn'],captured_timer:['Timer','timer']};
  const buttons=seed.commands.filter(c=>labels[c.name]&&validTimings(c.raw_us)).map(c=>({id:id('b'),label:labels[c.name][0],icon:labels[c.name][1],carrier_khz:c.carrier_khz,raw_us:c.raw_us,addedAt:now(),origin:'The fan recordings that came with the project'}));
  if(buttons.length)data.appliances.push({id:id('a'),name:'Fan',kind:'fan',careful:false,buttons,lastSent:null});
 }
 const ready=(async()=>{
  let loaded=null;
  if(file)try{loaded=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT'){storageError=error.code||'unreadable';
    // An unreadable file is kept under another name instead of being overwritten.
    try{await fs.rename(file,file+'.unreadable-'+now());}catch{}}}
  if(loaded?.schema===1&&Array.isArray(loaded.devices)&&Array.isArray(loaded.appliances)&&Array.isArray(loaded.recordings))data=loaded;
  else{seedFan();await save();}
  index();
 })();

 // ---- linking a board or the app -------------------------------------------------------------
 function expire(){const time=now();for(const [secret,p]of pending)if(p.until<=time)pending.delete(secret);for(const [key,entry]of starts)if(entry.until<=time)starts.delete(key);for(const [key,until]of seen)if(until<=time)seen.delete(key);}
 function pairStart({kind,name,firmware,from='unknown'}){
  expire();
  if(!DEVICE_KINDS.includes(kind))return {status:400,body:{message:'Unknown kind of device.'}};
  const entry=starts.get(from)||{count:0,until:now()+t.pair};
  if(entry.count>=8||pending.size>=LIMITS.pending)return {status:429,body:{message:'Too many link requests. Try again in a few minutes.'}};
  entry.count++;starts.set(from,entry);
  let code;do code=String(randomInt(0,1000000)).padStart(6,'0');while([...pending.values()].some(p=>p.code===code));
  const secret=randomBytes(32).toString('base64url');
  pending.set(sha(secret),{code,kind,name:clean(name,LIMITS.name),firmware:clean(firmware,48),until:now()+t.pair,token:null,device:null});
  return {status:200,body:{code,secret,expires_in:Math.round(t.pair/1000),interval:3}};
 }
 function pairClaim(secret){
  expire();
  const key=typeof secret==='string'?sha(secret):'',p=pending.get(key);
  if(!p)return {status:404,body:{status:'expired',message:'This link request has ended. Start again.'}};
  if(!p.token)return {status:202,body:{status:'waiting'}};
  pending.delete(key);
  return {status:200,body:{status:'linked',token:p.token,name:p.device.name,device_id:p.device.id}};
 }
 async function pairApprove(code,name){
  expire();
  const digits=String(code||'').replace(/\D/g,''),p=[...pending.values()].find(x=>x.code===digits&&!x.token);
  if(!p)return {status:404,body:{message:'No board or app is showing that code right now. Check the six digits; a code lasts ten minutes.'}};
  if(data.devices.length>=LIMITS.devices)return {status:409,body:{message:'Remove a linked board or app before adding another.'}};
  const token=randomBytes(32).toString('base64url');
  const fallback={receiver:'Receiver',transmitter:'Transmitter',app:'Windows app'}[p.kind],taken=new Set(data.devices.map(d=>d.name));
  let chosen=clean(name,LIMITS.name)||p.name||fallback;for(let n=2;taken.has(chosen);n++)chosen=(clean(name,LIMITS.name)||p.name||fallback)+' '+n;
  const device={id:id('d'),kind:p.kind,name:chosen,firmware:p.firmware,tokenHash:sha(token),createdAt:now()};
  data.devices.push(device);index();await save();
  p.token=token;p.device=device;p.until=now()+2*60*1000;
  return {status:200,body:{device:{id:device.id,kind:device.kind,name:device.name}}};
 }
 function authDevice(header){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(header||'');const device=match&&tokens.get(sha(match[1]));if(device)state(device).lastSeen=now();return device||null;}
 async function removeDevice(deviceId){
  const device=data.devices.find(d=>d.id===deviceId);if(!device)return {status:404,body:{message:'Not found.'}};
  const s=state(device);s.waiter?.finish(null);live.delete(device.id);
  data.devices=data.devices.filter(d=>d!==device);index();await save();
  return {status:200,body:{message:device.name+' was removed. It will ask for a new code.'}};
 }
 async function renameDevice(deviceId,name){
  const device=data.devices.find(d=>d.id===deviceId),chosen=clean(name,LIMITS.name);
  if(!device)return {status:404,body:{message:'Not found.'}};
  if(!chosen)return {status:400,body:{message:'Give it a name.'}};
  device.name=chosen;await save();return {status:200,body:{message:'Renamed.'}};
 }

 // ---- recordings from the receiver ------------------------------------------------------------
 function describe(raw){return {timings:raw.length,milliseconds:Math.round(raw.reduce((a,b)=>a+b,0)/1000)};}
 function matches(raw){const found=[];for(const appliance of data.appliances)for(const button of appliance.buttons)if(sameSignal(raw,button.raw_us))found.push(appliance.name+' · '+button.label);return found.slice(0,3);}
 async function addRecording(device,capture,ageMs=null){
  if(device.kind!=='receiver')return {status:403,body:{message:'Only a receiver board sends recordings.'}};
  if(!capture||capture.type!=='capture'||capture.schema!==1||capture.repeat===true||capture.overflow===true||!validTimings(capture.raw_us))return {status:422,body:{message:'Not a usable recording.'}};
  const fingerprint=sha(JSON.stringify([device.id,capture.capture_id??null,capture.raw_us]));
  if(data.recordings.some(r=>r.fingerprint===fingerprint)||data.appliances.some(a=>a.buttons.some(b=>b.fingerprint===fingerprint)))return {status:200,body:{ok:true,duplicate:true}};
  const age=Number.isFinite(ageMs)&&ageMs>=0&&ageMs<24*60*60*1000?ageMs:null,at=now()-(age??0);
  const recording={id:id('r'),deviceId:device.id,at,fresh:age!==null,fingerprint,raw_us:capture.raw_us,
   protocol:clean(String(capture.protocol??''),24),bits:Number.isInteger(capture.bits)?capture.bits:0,code:clean(String(capture.decoded_hex??''),40),capture_id:Number.isInteger(capture.capture_id)?capture.capture_id:null};
  // A recording made after "Record a button" was pressed becomes that button. Older ones the
  // board had saved (sent later, in a batch) go to the list instead.
  if(learning&&learning.until>now()&&recording.fresh&&at>=learning.startedAt-750){
   // The next signal is taken for the button, whoever sent it. Two things are noted so the
   // pages can say when it may not be the remote: the same signal was already arriving by itself
   // in the two minutes before Record was pressed, or the device has it under another name.
   const heardBefore=data.recordings.filter(r=>r.fresh&&r.at<learning.startedAt-750&&r.at>=learning.startedAt-120000&&sameSignal(r.raw_us,recording.raw_us)).length;
   const sameAs=(appliance(learning.applianceId)?.buttons||[]).filter(b=>b.id!==learning.replace&&b.label.toLowerCase()!==learning.label.toLowerCase()&&sameSignal(b.raw_us,recording.raw_us)).map(b=>b.label);
   const made=await addButton(learning.applianceId,{label:learning.label,icon:learning.icon,replace:learning.replace},recording);
   if(made.status===200){learned={applianceId:learning.applianceId,buttonId:made.body.button.id,label:learning.label,at:now(),heardBefore,sameAs,...describe(recording.raw_us)};learning=null;return {status:200,body:{ok:true,button:learned.label}};}
  }
  data.recordings.push(recording);
  if(data.recordings.length>LIMITS.recordings)data.recordings.splice(0,data.recordings.length-LIMITS.recordings);
  await save();
  return {status:200,body:{ok:true,id:recording.id}};
 }
 async function removeRecording(recordingId){
  const before=data.recordings.length;data.recordings=recordingId==='all'?[]:data.recordings.filter(r=>r.id!==recordingId);
  if(data.recordings.length===before)return {status:404,body:{message:'Not found.'}};
  await save();return {status:200,body:{message:'Removed.'}};
 }

 // ---- appliances and their buttons ------------------------------------------------------------
 const appliance=applianceId=>data.appliances.find(a=>a.id===applianceId);
 function locate(buttonId){for(const a of data.appliances){const b=a.buttons.find(x=>x.id===buttonId);if(b)return {appliance:a,button:b};}return null;}
 async function addAppliance({name,kind}){
  const chosen=clean(name,LIMITS.name);
  if(!chosen)return {status:400,body:{message:'Give the device a name.'}};
  if(!KINDS.includes(kind))return {status:400,body:{message:'Choose what kind of device it is.'}};
  if(data.appliances.length>=LIMITS.appliances)return {status:409,body:{message:'Remove a device before adding another.'}};
  if(data.appliances.some(a=>a.name.toLowerCase()===chosen.toLowerCase()))return {status:409,body:{message:'There is already a device with that name.'}};
  // A heater asks before every command. That can be changed per appliance, never silently.
  const made={id:id('a'),name:chosen,kind,careful:kind==='heater',buttons:[],lastSent:null};
  data.appliances.push(made);await save();return {status:200,body:{appliance:{id:made.id,name:made.name}}};
 }
 async function changeAppliance(applianceId,{name,kind,careful}){
  const a=appliance(applianceId);if(!a)return {status:404,body:{message:'Not found.'}};
  if(name!==undefined){const chosen=clean(name,LIMITS.name);if(!chosen)return {status:400,body:{message:'Give the device a name.'}};if(data.appliances.some(x=>x!==a&&x.name.toLowerCase()===chosen.toLowerCase()))return {status:409,body:{message:'There is already a device with that name.'}};a.name=chosen;}
  if(kind!==undefined){if(!KINDS.includes(kind))return {status:400,body:{message:'Choose what kind of device it is.'}};a.kind=kind;}
  if(careful!==undefined)a.careful=careful===true;
  await save();return {status:200,body:{message:'Saved.'}};
 }
 async function removeAppliance(applianceId){
  const a=appliance(applianceId);if(!a)return {status:404,body:{message:'Not found.'}};
  data.appliances=data.appliances.filter(x=>x!==a);if(learning?.applianceId===applianceId)learning=null;
  await save();return {status:200,body:{message:a.name+' and its buttons were removed.'}};
 }
 async function addButton(applianceId,{label,icon,carrier_khz,replace},recording){
  const a=appliance(applianceId),chosen=clean(label,LIMITS.label);
  if(!a)return {status:404,body:{message:'That device no longer exists.'}};
  if(!chosen)return {status:400,body:{message:'Give the button a name.'}};
  if(!recording||!validTimings(recording.raw_us))return {status:404,body:{message:'That recording no longer exists.'}};
  const carrier=carrier_khz===undefined?38:carrier_khz;
  if(!Number.isInteger(carrier)||carrier<20||carrier>60)return {status:400,body:{message:'The carrier must be 20 to 60 kHz.'}};
  const existing=replace?a.buttons.find(b=>b.id===replace):a.buttons.find(b=>b.label.toLowerCase()===chosen.toLowerCase());
  if(!existing&&a.buttons.length>=LIMITS.buttons)return {status:409,body:{message:'Remove a button before adding another.'}};
  const button={id:existing?.id||id('b'),label:chosen,icon:ICONS.includes(icon)?icon:existing?.icon||iconFor(chosen),carrier_khz:carrier,raw_us:recording.raw_us,addedAt:now(),fingerprint:recording.fingerprint,
   origin:[recording.protocol&&recording.protocol!=='UNKNOWN'?recording.protocol:'',recording.bits?recording.bits+' bits':'',recording.code].filter(Boolean).join(' · ')};
  if(existing)a.buttons[a.buttons.indexOf(existing)]=button;else a.buttons.push(button);
  data.recordings=data.recordings.filter(r=>r.id!==recording.id);
  await save();return {status:200,body:{button:{id:button.id,label:button.label},replaced:!!existing}};
 }
 async function changeButton(buttonId,{label,icon,carrier_khz}){
  const found=locate(buttonId);if(!found)return {status:404,body:{message:'Not found.'}};
  const {appliance:a,button:b}=found;
  if(label!==undefined){const chosen=clean(label,LIMITS.label);if(!chosen)return {status:400,body:{message:'Give the button a name.'}};if(a.buttons.some(x=>x!==b&&x.label.toLowerCase()===chosen.toLowerCase()))return {status:409,body:{message:'That device already has a button with that name.'}};b.label=chosen;}
  if(icon!==undefined){if(!ICONS.includes(icon))return {status:400,body:{message:'Unknown picture.'}};b.icon=icon;}
  if(carrier_khz!==undefined){if(!Number.isInteger(carrier_khz)||carrier_khz<20||carrier_khz>60)return {status:400,body:{message:'The carrier must be 20 to 60 kHz.'}};b.carrier_khz=carrier_khz;}
  await save();return {status:200,body:{message:'Saved.'}};
 }
 async function removeButton(buttonId){
  const found=locate(buttonId);if(!found)return {status:404,body:{message:'Not found.'}};
  found.appliance.buttons=found.appliance.buttons.filter(b=>b!==found.button);
  await save();return {status:200,body:{message:found.button.label+' was removed.'}};
 }
 function startLearning({applianceId,label,icon,replace}){
  const a=appliance(applianceId),chosen=clean(label,LIMITS.label);
  if(!a)return {status:404,body:{message:'That device no longer exists.'}};
  if(!chosen)return {status:400,body:{message:'Choose or type a name for the button first.'}};
  const receiver=data.devices.find(d=>d.kind==='receiver');
  if(!receiver)return {status:409,body:{message:'Link the receiver board first.'}};
  learning={applianceId,label:chosen,icon:ICONS.includes(icon)?icon:iconFor(chosen),replace:typeof replace==='string'?replace:null,startedAt:now(),until:now()+t.learn};learned=null;
  // Signals that arrived in the last minute with nothing being recorded: with two or more,
  // something in the room is sending infrared by itself, and it could be taken for the button.
  const noise=data.recordings.filter(r=>r.fresh&&now()-r.at<60000).length;
  return {status:200,body:{message:noise>=2?'The receiver heard '+noise+' signals in the last minute with no button being recorded, so something nearby is sending infrared by itself. Cover the receiver from it, hold the remote close, then press the button once.':'Point the remote at the receiver and press the button once.',seconds:Math.round(t.learn/1000),noise}};
 }
 function stopLearning(){learning=null;return {status:200,body:{message:'Stopped.'}};}

 // ---- sending through the transmitter ----------------------------------------------------------
 function transmitter(){const all=data.devices.filter(d=>d.kind==='transmitter');return all.find(online)||all[0]||null;}
 function hand(s,command){
  // The transmitter has the command from this moment. From here "nothing was sent" is no longer certain.
  command.taken=true;clearTimeout(command.timer);
  command.timer=setTimeout(()=>finish(command,{status:502,body:{message:'The transmitter took the command but did not confirm it. Check the device before trying again.'}}),t.confirm);
  return {id:command.id,label:command.label,schema:1,units:'microseconds',commands:[{name:command.name,carrier_khz:command.carrier,raw_us:command.raw}]};
 }
 function finish(command,result){
  if(command.done)return;command.done=true;clearTimeout(command.timer);
  if(inFlight===command)inFlight=null;
  for(const s of live.values())if(s.queued===command)s.queued=null;
  command.resolve(result);
 }
 function nextCommand(device,waitMs,practice=false){
  if(device.kind!=='transmitter')return Promise.resolve({status:403,body:{message:'Only a transmitter board collects commands.'}});
  const s=state(device);s.practice=practice===true;s.waiter?.finish(null);
  if(s.queued&&!s.queued.done){const command=s.queued;s.queued=null;return Promise.resolve({status:200,body:hand(s,command)});}
  const wait=Math.max(0,Math.min(t.poll,Number.isFinite(waitMs)?waitMs:t.poll));
  let cancel=()=>{};
  const promise=new Promise(resolve=>{
   const timer=setTimeout(()=>waiter.finish(null),wait);
   const waiter={finish(command){if(s.waiter===waiter)s.waiter=null;clearTimeout(timer);s.lastSeen=now();resolve(command?{status:200,body:hand(s,command)}:{status:204,body:null});}};
   s.waiter=waiter;cancel=()=>waiter.finish(null);
  });
  promise.cancel=()=>cancel();
  return promise;
 }
 function commandDone(device,{id:commandId,ok,practice,message}={}){
  if(device.kind!=='transmitter')return {status:403,body:{message:'Only a transmitter board reports commands.'}};
  const command=inFlight;
  if(!command||command.id!==commandId||command.deviceId!==device.id)return {status:404,body:{message:'No such command is waiting.'}};
  const about=command.about;
  if(ok===true&&practice===true)finish(command,{status:200,body:{sent:false,practice:true,message:'The transmitter is in practice mode: it received '+command.label+' and sent no infrared.'}});
  else if(ok===true){if(about?.appliance)about.appliance.lastSent={label:about.label,at:now()};save();finish(command,{status:200,body:{sent:true,message:'Sent. The device\'s response is not confirmed.'}});}
  else finish(command,{status:502,body:{sent:false,message:'The transmitter could not send it'+(clean(message,80)?': '+clean(message,80):'.')+' Nothing was sent.'}});
  return {status:200,body:{ok:true}};
 }
 function send({button_id,recording_id,request_id,created_at,confirm}={}){
  expire();
  if(!/^[a-f0-9]{32}$/.test(request_id||'')||!Number.isFinite(created_at)||Math.abs(now()-created_at)>10000)return Promise.resolve({status:400,body:{message:'Malformed or expired request. No command was sent.'}});
  let label,raw,carrier,name,about=null;
  if(typeof button_id==='string'){
   const found=locate(button_id);if(!found)return Promise.resolve({status:404,body:{message:'That button no longer exists. No command was sent.'}});
   if(found.appliance.careful&&confirm!==true)return Promise.resolve({status:409,body:{confirm:true,message:'Confirm before sending '+found.appliance.name+' · '+found.button.label+'. No command was sent.'}});
   label=found.appliance.name+' · '+found.button.label;raw=found.button.raw_us;carrier=found.button.carrier_khz;name=found.button.id;about={appliance:found.appliance,label:found.button.label};
  }else if(typeof recording_id==='string'){
   const recording=data.recordings.find(r=>r.id===recording_id);if(!recording)return Promise.resolve({status:404,body:{message:'That recording no longer exists. No command was sent.'}});
   label='Recording';raw=recording.raw_us;carrier=38;name=recording.id;
  }else return Promise.resolve({status:400,body:{message:'Nothing to send. No command was sent.'}});
  const device=transmitter();
  if(!device)return Promise.resolve({status:503,body:{message:'No transmitter board is linked yet. No command was sent.'}});
  if(!online(device))return Promise.resolve({status:503,body:{message:'The transmitter board is offline. No command was sent.'}});
  if(seen.has(request_id))return Promise.resolve({status:409,body:{message:'Duplicate request rejected. No command was sent.'}});
  if(inFlight||now()-lastSent<t.gap)return Promise.resolve({status:429,body:{message:'Wait a moment before the next command. No command was sent.'}});
  seen.set(request_id,now()+60000);lastSent=now();
  return new Promise(resolve=>{
   const command={id:randomBytes(8).toString('hex'),deviceId:device.id,label,name,raw,carrier,about,resolve,done:false,taken:false,timer:null};
   inFlight=command;
   const s=state(device);
   if(s.waiter)s.waiter.finish(command);
   else{s.queued=command;command.timer=setTimeout(()=>finish(command,{status:504,body:{sent:false,message:'The transmitter did not collect the command in time. Nothing was sent.'}}),t.collect);}
  });
 }

 // ---- what the pages are shown -----------------------------------------------------------------
 function view({full=true}={}){
  const time=now(),ago=at=>at?Math.max(0,Math.round((time-at)/1000)):null;
  const devices=data.devices.map(d=>{const s=state(d);return {id:d.id,kind:d.kind,name:d.name,firmware:d.firmware||'',online:d.kind==='app'?null:online(d),seenSecondsAgo:ago(s.lastSeen),practice:d.kind==='transmitter'?s.practice:undefined};});
  const sender=transmitter(),senderView=sender?devices.find(d=>d.id===sender.id):null;
  const appliances=data.appliances.map(a=>({id:a.id,name:a.name,kind:a.kind,careful:a.careful===true,lastSent:a.lastSent?{label:a.lastSent.label,secondsAgo:ago(a.lastSent.at)}:null,
   buttons:a.buttons.map(b=>({id:b.id,label:b.label,icon:b.icon,...(full?{carrier_khz:b.carrier_khz,origin:b.origin||'',...describe(b.raw_us)}:{})}))}));
  const receiver=data.devices.find(d=>d.kind==='receiver'&&online(d))||data.devices.find(d=>d.kind==='receiver');
  const base={transmitter:senderView?{linked:true,online:senderView.online,practice:senderView.practice===true,name:senderView.name}:{linked:false,online:false,practice:false,name:''},
   receiver:{linked:!!receiver,online:!!receiver&&online(receiver)},appliances,
   learning:learning&&learning.until>time?{applianceId:learning.applianceId,label:learning.label,secondsLeft:Math.ceil((learning.until-time)/1000)}:null,
   learned:learned&&time-learned.at<120000?learned:null};
  if(!full)return base;
  const names=new Map(data.devices.map(d=>[d.id,d.name]));
  return {...base,devices,storage:{persistent,error:storageError},kinds:KINDS,icons:ICONS,limits:LIMITS,
   recordings:data.recordings.slice().reverse().map(r=>({id:r.id,secondsAgo:ago(r.at),fresh:r.fresh===true,from:names.get(r.deviceId)||'A removed board',protocol:r.protocol,bits:r.bits,code:r.code,looksLike:matches(r.raw_us),...describe(r.raw_us)}))};
 }
 function close(){for(const s of live.values()){s.waiter?.finish(null);}if(inFlight)finish(inFlight,{status:503,body:{message:'The website is restarting. Check the device before trying again.'}});return writing;}
 return {ready,pairStart,pairClaim,pairApprove,authDevice,removeDevice,renameDevice,addRecording,removeRecording,addAppliance,changeAppliance,removeAppliance,
  addButton:(applianceId,options)=>addButton(applianceId,options,data.recordings.find(r=>r.id===options?.recordingId)),
  changeButton,removeButton,startLearning,stopLearning,nextCommand,commandDone,send,view,close,get saved(){return writing;}};
}
