import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createHub,validTimings,firstBurst,sameSignal,LIMITS} from '../hub.mjs';
import {createCloudServer} from '../cloud-server.mjs';

const seed=JSON.parse(fs.readFileSync(new URL('../fan-signals.json',import.meta.url),'utf8'));
const quick={collect:150,confirm:150,poll:200,gap:30,learn:400,online:400};
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hands-free-hub-'));
const request=()=>({request_id:randomBytes(16).toString('hex'),created_at:Date.now()});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const capture=(raw,extra={})=>({type:'capture',schema:1,sequence:1,uptime_ms:1000,protocol:'UNKNOWN',decoded_hex:'0x1',bits:12,repeat:false,overflow:false,carrier_khz:null,raw_us:raw,capture_id:1,saved:true,...extra});
async function link(hub,kind){const started=hub.pairStart({kind,from:kind+Math.random()}).body;assert.equal((await hub.pairApprove(started.code)).status,200);const claimed=hub.pairClaim(started.secret);assert.equal(claimed.status,200);return {token:claimed.body.token,device:hub.authDevice('Bearer '+claimed.body.token)};}
// A made-up remote button: a header, then twelve bits, repeated three times with a long gap.
function press(bits,repeats=3,jitter=0){const out=[];for(let r=0;r<repeats;r++){out.push(9000+jitter,4500-jitter);for(const bit of bits)out.push(560+jitter,bit?1690-jitter:560+jitter);out.push(560,r===repeats-1?560:40000);}return out.slice(0,-1);}

test('the site copy of the fan recordings is exactly the transmitter\'s library',()=>{
 assert.deepEqual(seed,JSON.parse(fs.readFileSync(new URL('../../hardware/signals/signals.json',import.meta.url),'utf8')));
});
test('timings are held to the limits the boards themselves use',()=>{
 assert.ok(validTimings([500,500,500]));
 for(const bad of [[500,500],[500,0,500],[500,-1,500],[500,1.5,500],[600000,600000,3],Array(LIMITS.timings+1).fill(100),'x',null])assert.equal(validTimings(bad),false);
});
test('two presses of one button are recognised whatever their length; another button is not',()=>{
 const power=[1,0,1,1,0,0,1,0,1,0,0,1],other=[1,0,1,1,0,0,1,0,1,0,1,0];
 assert.equal(firstBurst(press(power)).length,2+24+1);
 assert.ok(sameSignal(press(power,3),press(power,7,40)));
 assert.equal(sameSignal(press(power),press(other)),false);
 assert.ok(sameSignal(seed.commands[0].raw_us,seed.commands[0].raw_us));
 for(const a of seed.commands)for(const b of seed.commands)assert.equal(sameSignal(a.raw_us,b.raw_us),a===b,a.name+' / '+b.name);
});
test('a new site starts with the seven fan buttons and keeps everything across a restart',async()=>{
 const dataDir=folder();let hub=createHub({dataDir,seed,timing:quick});await hub.ready;
 const fan=hub.view().appliances;assert.equal(fan.length,1);assert.equal(fan[0].name,'Fan');assert.equal(fan[0].careful,false);
 assert.deepEqual(fan[0].buttons.map(b=>b.label),['Power','Speed down','Speed up','Mode','Silence','Turn','Timer']);
 const {token}=await link(hub,'transmitter');await hub.addAppliance({name:'Lamp',kind:'light'});await hub.saved;
 const stored=fs.readFileSync(path.join(dataDir,'hub.json'),'utf8');
 assert.equal(stored.includes(token),false,'only a hash of a board key is stored');
 hub=createHub({dataDir,seed,timing:quick});await hub.ready;
 assert.deepEqual(hub.view().appliances.map(a=>a.name),['Fan','Lamp']);
 assert.equal(hub.authDevice('Bearer '+token)?.kind,'transmitter');
 assert.equal(hub.view().appliances[0].buttons.length,7,'the fan is not added a second time');
});
test('a board is linked by the code typed on the website, and gets its key once',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 assert.equal(hub.pairStart({kind:'toaster'}).status,400);
 const started=hub.pairStart({kind:'receiver',firmware:'IRCapture-cloud-1'}).body;
 assert.match(started.code,/^\d{6}$/);assert.equal(started.secret.length,43);
 assert.equal(hub.pairClaim(started.secret).status,202);
 assert.equal((await hub.pairApprove(started.code==='000000'?'111111':'000000')).status,404);
 const approved=await hub.pairApprove(started.code.slice(0,3)+' '+started.code.slice(3));assert.equal(approved.status,200);assert.equal(approved.body.device.name,'Receiver');
 assert.equal((await hub.pairApprove(started.code)).status,404,'a code works once');
 const claimed=hub.pairClaim(started.secret);assert.equal(claimed.status,200);assert.equal(claimed.body.token.length,43);
 assert.equal(hub.pairClaim(started.secret).status,404,'the key is handed over once');
 assert.equal(hub.authDevice('Bearer '+claimed.body.token).kind,'receiver');
 assert.equal(hub.authDevice('Bearer '+'x'.repeat(43)),null);assert.equal(hub.authDevice(''),null);
 const device=hub.view().devices[0];assert.equal((await hub.removeDevice(device.id)).status,200);
 assert.equal(hub.authDevice('Bearer '+claimed.body.token),null,'a removed board is refused');
 for(let i=0;i<8;i++)assert.equal(hub.pairStart({kind:'app',from:'one-address'}).status,200);
 assert.equal(hub.pairStart({kind:'app',from:'one-address'}).status,429);
});
test('recordings from the receiver are listed, recognised and never taken twice',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 const receiver=(await link(hub,'receiver')).device,sender=(await link(hub,'transmitter')).device;
 const raw=press([1,1,0,0,1,0,1,0,1,1,0,0]);
 assert.equal((await hub.addRecording(sender,capture(raw))).status,403);
 for(const bad of [capture(raw,{repeat:true}),capture(raw,{overflow:true}),capture([1,2]),{...capture(raw),type:'status'},null])assert.equal((await hub.addRecording(receiver,bad)).status,422);
 assert.deepEqual((await hub.addRecording(receiver,capture(raw))).body.duplicate,undefined);
 assert.equal((await hub.addRecording(receiver,capture(raw))).body.duplicate,true);
 await hub.addRecording(receiver,capture(seed.commands[0].raw_us,{capture_id:2}));
 const listed=hub.view().recordings;assert.equal(listed.length,2);
 assert.deepEqual(listed[0].looksLike,['Fan · Power']);assert.deepEqual(listed[1].looksLike,[]);
 assert.equal(listed[1].timings,raw.length);assert.equal(listed[1].from,'Receiver');assert.equal('raw_us' in listed[1],false);
 const lamp=(await hub.addAppliance({name:'Lamp',kind:'light'})).body.appliance;
 assert.equal((await hub.addButton(lamp.id,{label:'On',icon:'light',recordingId:listed[1].id})).status,200);
 assert.equal(hub.view().recordings.length,1,'a recording that became a button leaves the list');
 assert.equal((await hub.addRecording(receiver,capture(raw))).body.duplicate,true,'and is not listed again when the board sends it again');
 assert.equal((await hub.addButton(lamp.id,{label:'On',recordingId:'r_missing'})).status,404);
 assert.equal((await hub.addButton(lamp.id,{label:'',recordingId:listed[0].id})).status,400);
 assert.equal((await hub.addButton(lamp.id,{label:'Dim',recordingId:listed[0].id,carrier_khz:90})).status,400);
});
test('"Record a button" takes the next fresh recording and leaves the board\'s older ones in the list',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 const lampless=hub.startLearning({applianceId:'a_none',label:'On'});assert.equal(lampless.status,404);
 const lamp=(await hub.addAppliance({name:'Lamp',kind:'light'})).body.appliance;
 assert.equal(hub.startLearning({applianceId:lamp.id,label:'On'}).status,409,'needs a receiver');
 const receiver=(await link(hub,'receiver')).device;
 assert.equal(hub.startLearning({applianceId:lamp.id,label:'  '}).status,400);
 assert.equal(hub.startLearning({applianceId:lamp.id,label:'On',icon:'light'}).status,200);
 assert.equal(hub.view().learning.label,'On');
 // An old recording the board had saved (no age given), and one made well before the button was pressed.
 await hub.addRecording(receiver,capture(press([0,0,0,0,1,1,1,1,0,0,0,0]),{capture_id:1}));
 await hub.addRecording(receiver,capture(press([0,1,0,1,0,1,0,1,0,1,0,1]),{capture_id:2}),60000);
 assert.equal(hub.view().appliances[1].buttons.length,0);assert.equal(hub.view().recordings.length,2);
 const made=await hub.addRecording(receiver,capture(press([1,1,1,0,0,0,1,1,1,0,0,0]),{capture_id:3}),40);
 assert.equal(made.body.button,'On');
 const view=hub.view();assert.deepEqual(view.appliances[1].buttons.map(b=>[b.label,b.icon]),[['On','light']]);
 assert.equal(view.learning,null);assert.equal(view.learned.label,'On');assert.equal(view.recordings.length,2);
 hub.startLearning({applianceId:lamp.id,label:'Off'});await pause(450);
 assert.equal(hub.view().learning,null,'waiting for a button ends by itself');
 await hub.addRecording(receiver,capture(press([1,0,0,0,0,0,0,0,0,0,0,1]),{capture_id:4}),10);
 assert.equal(hub.view().appliances[1].buttons.length,1);
});
test('a command reaches a waiting transmitter at once and the page hears what happened',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 const power=hub.view().appliances[0].buttons[0];
 assert.match((await hub.send({button_id:power.id,...request()})).body.message,/No transmitter board is linked/);
 const board=(await link(hub,'transmitter')).device;
 let waiting=hub.nextCommand(board,5000);
 const asked=hub.send({button_id:power.id,...request()});
 const handed=await waiting;assert.equal(handed.status,200);
 assert.equal(handed.body.label,'Fan · Power');assert.equal(handed.body.schema,1);assert.equal(handed.body.units,'microseconds');
 assert.match(handed.body.commands[0].name,/^[a-z0-9_]{1,48}$/,'a name the transmitter\'s own check accepts');
 assert.deepEqual(handed.body.commands[0].raw_us,seed.commands[0].raw_us);assert.equal(handed.body.commands[0].carrier_khz,38);
 assert.equal((await hub.send({button_id:power.id,...request()})).status,429,'one command at a time');
 assert.equal(hub.commandDone(board,{id:'wrong',ok:true}).status,404);
 assert.equal(hub.commandDone(board,{id:handed.body.id,ok:true}).status,200);
 const result=await asked;assert.equal(result.status,200);assert.equal(result.body.sent,true);
 assert.equal(hub.view().appliances[0].lastSent.label,'Power');
 await pause(40);
 // Practice mode on the board is reported as what it is.
 waiting=hub.nextCommand(board,5000,true);const practice=hub.send({button_id:power.id,...request()});
 hub.commandDone(board,{id:(await waiting).body.id,ok:true,practice:true});
 assert.deepEqual([(await practice).body.sent,(await practice).body.practice],[false,true]);assert.equal(hub.view().transmitter.practice,true);
 await pause(40);
 waiting=hub.nextCommand(board,5000);const failed=hub.send({button_id:power.id,...request()});
 hub.commandDone(board,{id:(await waiting).body.id,ok:false,message:'Wait a moment'});
 assert.equal((await failed).status,502);assert.match((await failed).body.message,/Nothing was sent/);
});
test('a command is never delivered late, and an unconfirmed one is reported as unconfirmed',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 const power=hub.view().appliances[0].buttons[0],board=(await link(hub,'transmitter')).device;
 // Between two of the board's requests the command waits a moment for the next one.
 const soon=hub.send({button_id:power.id,...request()});await pause(40);
 const collected=await hub.nextCommand(board,5000);assert.equal(collected.status,200);
 hub.commandDone(board,{id:collected.body.id,ok:true});assert.equal((await soon).status,200);
 await pause(40);
 // Not collected in time: dropped, and the board's next request gets nothing.
 const dropped=await hub.send({button_id:power.id,...request()});
 assert.equal(dropped.status,504);assert.match(dropped.body.message,/Nothing was sent/);
 assert.equal((await hub.nextCommand(board,20)).status,204,'the dropped command is not handed over afterwards');
 // Taken but never confirmed.
 const waiting=hub.nextCommand(board,5000),silent=hub.send({button_id:power.id,...request()});
 assert.equal((await waiting).status,200);
 const unconfirmed=await silent;assert.equal(unconfirmed.status,502);assert.match(unconfirmed.body.message,/did not confirm/);assert.doesNotMatch(unconfirmed.body.message,/Nothing was sent/);
 // Offline: the board has not asked for a while.
 await pause(450);
 assert.match((await hub.send({button_id:power.id,...request()})).body.message,/offline\. No command was sent/);
 // A waiting request that ends hands over nothing.
 const idle=hub.nextCommand(board,60);assert.equal((await idle).status,204);
});
test('requests are checked: fresh, not repeated, known, and confirmed for a heater',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 const power=hub.view().appliances[0].buttons[0],board=(await link(hub,'transmitter')).device,receiver=(await link(hub,'receiver')).device;
 assert.equal((await hub.send({button_id:power.id,request_id:'short',created_at:Date.now()})).status,400);
 assert.equal((await hub.send({button_id:power.id,request_id:randomBytes(16).toString('hex'),created_at:Date.now()-60000})).status,400);
 assert.equal((await hub.send({button_id:'b_gone',...request()})).status,404);
 assert.equal((await hub.send({...request()})).status,400);
 const once=request();let waiting=hub.nextCommand(board,5000);const first=hub.send({button_id:power.id,...once});
 hub.commandDone(board,{id:(await waiting).body.id,ok:true});await first;await pause(40);
 waiting=hub.nextCommand(board,5000);
 assert.equal((await hub.send({button_id:power.id,...once})).status,409,'the same request is not sent twice');
 const heater=(await hub.addAppliance({name:'Heater',kind:'heater'})).body.appliance;
 assert.equal(hub.view().appliances[1].careful,true);
 await hub.addRecording(receiver,capture(press([1,0,1,0,1,0,1,0,1,0,1,0])));
 const heat=(await hub.addButton(heater.id,{label:'Power',icon:'power',recordingId:hub.view().recordings[0].id})).body.button;
 const unconfirmed=await hub.send({button_id:heat.id,...request()});
 assert.equal(unconfirmed.status,409);assert.equal(unconfirmed.body.confirm,true);assert.match(unconfirmed.body.message,/No command was sent/);
 const confirmed=hub.send({button_id:heat.id,confirm:true,...request()});
 const handed=await waiting;assert.equal(handed.body.label,'Heater · Power');hub.commandDone(board,{id:handed.body.id,ok:true});assert.equal((await confirmed).status,200);
 assert.equal((await hub.changeAppliance(heater.id,{careful:false})).status,200);assert.equal(hub.view().appliances[1].careful,false);
});
test('appliances and buttons can be named, changed and removed within limits',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 assert.equal((await hub.addAppliance({name:'',kind:'tv'})).status,400);
 assert.equal((await hub.addAppliance({name:'TV',kind:'spaceship'})).status,400);
 assert.equal((await hub.addAppliance({name:'fan',kind:'fan'})).status,409);
 const tv=(await hub.addAppliance({name:' Living <room> TV ',kind:'tv'})).body.appliance;assert.equal(tv.name,'Living room TV');
 assert.equal((await hub.changeAppliance(tv.id,{name:'TV'})).status,200);
 const fan=hub.view().appliances[0];
 assert.equal((await hub.changeButton(fan.buttons[0].id,{label:'Speed up'})).status,409);
 assert.equal((await hub.changeButton(fan.buttons[0].id,{label:'On / off',icon:'power',carrier_khz:36})).status,200);
 assert.equal((await hub.changeButton(fan.buttons[0].id,{icon:'rocket'})).status,400);
 assert.deepEqual([hub.view().appliances[0].buttons[0].label,hub.view().appliances[0].buttons[0].carrier_khz],['On / off',36]);
 assert.equal((await hub.removeButton(fan.buttons[1].id)).status,200);assert.equal(hub.view().appliances[0].buttons.length,6);
 assert.equal((await hub.removeAppliance(tv.id)).status,200);assert.equal((await hub.removeAppliance(tv.id)).status,404);
 for(let i=1;i<LIMITS.appliances;i++)assert.equal((await hub.addAppliance({name:'Thing '+i,kind:'other'})).status,200);
 assert.equal((await hub.addAppliance({name:'One too many',kind:'other'})).status,409);
});

// ---- over HTTP, as the boards, the app and the pages use it ------------------------------------
const credentials={username:'hub-test',password:'hub-test-password-of-32-characters'};
async function site(t){
 const hub=createHub({dataDir:folder(),seed,timing:{...quick,poll:400}}),server=createCloudServer({...credentials,hub});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const signed=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:base},body:new URLSearchParams(credentials)});
 const cookie=signed.headers.get('set-cookie').split(';')[0];
 const page=(route,method='GET',body)=>fetch(base+route,{method,headers:{Cookie:cookie,Origin:base,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const device=(token,route,method='GET',body,headers={})=>fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
 async function linked(kind){const started=await (await device(null,'/api/pair/start','POST',{kind})).json();assert.equal((await page('/api/pair/approve','POST',{code:started.code})).status,200);return (await (await device(null,'/api/pair/claim','POST',{secret:started.secret})).json()).token;}
 return {base,cookie,page,device,linked};
}
test('over HTTP: boards link without signing in, and nothing else is open to them',async t=>{
 const {base,page,device,linked}=await site(t);
 assert.equal((await fetch(base+'/api/hub')).status,401);
 assert.equal((await device('x'.repeat(43),'/api/device/next?wait=0')).status,401);
 assert.equal((await device(null,'/api/pair/approve','POST',{code:'123456'})).status,401,'only the signed-in website approves a code');
 const receiver=await linked('receiver');
 assert.deepEqual(await (await device(receiver,'/api/device/hello')).json(),{kind:'receiver',name:'Receiver'});
 assert.equal((await device(receiver,'/api/hub')).status,401,'a board cannot read the setup');
 assert.equal((await device(receiver,'/api/send','POST',{})).status,401,'or send commands');
 assert.equal((await device(receiver,'/api/device/next?wait=0')).status,403);
 assert.equal((await device(receiver,'/api/device/recordings','POST',capture(seed.commands[2].raw_us),{'X-Capture-Age-Ms':'25'})).status,200);
 assert.equal((await device(receiver,'/api/device/recordings','POST',{type:'capture',schema:1,raw_us:[1]})).status,422);
 const big=await fetch(base+'/api/device/recordings',{method:'POST',headers:{Authorization:'Bearer '+receiver},body:'{"x":"'+'y'.repeat(40000)+'"}'});assert.equal(big.status,413);
 const view=await (await page('/api/hub')).json();
 assert.deepEqual(view.recordings[0].looksLike,['Fan · Speed up']);assert.equal(view.recordings[0].fresh,true);
 assert.equal(view.storage.persistent,false);assert.equal(view.devices.length,1);
});
test('over HTTP: a button pressed on the page is collected by the transmitter and confirmed',async t=>{
 const {base,cookie,page,device,linked}=await site(t);
 const board=await linked('transmitter'),view=await (await page('/api/hub')).json(),timer=view.appliances[0].buttons[6];
 assert.equal((await device(board,'/api/device/next?wait=0')).status,204);
 const waiting=device(board,'/api/device/next?wait=5',undefined,undefined,{'X-Practice':'0'});await pause(60);
 const pressed=page('/api/send','POST',{button_id:timer.id,...request()});
 const handed=await (await waiting).json();assert.equal(handed.label,'Fan · Timer');assert.deepEqual(handed.commands[0].raw_us,seed.commands[6].raw_us);
 assert.equal((await device(board,'/api/device/done','POST',{id:handed.id,ok:true,practice:false})).status,200);
 const result=await pressed;assert.equal(result.status,200);assert.match((await result.json()).message,/^Sent\./);
 assert.equal((await (await page('/api/hub')).json()).transmitter.online,true);
 // Changes with the sign-in cookie must come from the site's own pages.
 assert.equal((await fetch(base+'/api/send',{method:'POST',headers:{Cookie:cookie},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/appliances',{method:'POST',headers:{Cookie:cookie,Origin:'https://elsewhere.example'},body:'{}'})).status,403);
});
test('over HTTP: the Windows app may use the devices and set one up; the pages manage the rest',async t=>{
 const {page,device,linked}=await site(t);
 const app=await linked('app'),board=await linked('transmitter');
 const seenByApp=await (await device(app,'/api/hub')).json();
 assert.deepEqual(Object.keys(seenByApp).sort(),['appliances','learned','learning','receiver','transmitter']);assert.deepEqual(Object.keys(seenByApp.appliances[0].buttons[0]).sort(),['icon','id','label']);
 assert.deepEqual(seenByApp.receiver,{linked:false,online:false});
 const waiting=device(board,'/api/device/next?wait=5');await pause(60);
 const pressed=device(app,'/api/send','POST',{button_id:seenByApp.appliances[0].buttons[0].id,...request()});
 const handed=await (await waiting).json();await device(board,'/api/device/done','POST',{id:handed.id,ok:true});
 assert.equal((await pressed).status,200);
 assert.equal((await device(app,'/api/pair/approve','POST',{code:'123456'})).status,403);
 // Set up by eye in the app: add a device, then record a button for it.
 const added=await device(app,'/api/appliances','POST',{name:'TV',kind:'tv'});assert.equal(added.status,200);const tv=await added.json();
 assert.equal((await device(app,'/api/appliances/'+tv.appliance.id,'PATCH',{name:'Mine'})).status,403);
 assert.equal((await device(app,'/api/appliances/'+tv.appliance.id,'DELETE')).status,403);
 assert.equal((await page('/api/appliances/'+tv.appliance.id,'PATCH',{name:'Bedroom TV'})).status,200);
 const receiver=await linked('receiver');
 assert.equal((await device(app,'/api/learn','POST',{applianceId:tv.appliance.id,label:'Mute',icon:'silence'})).status,200);
 assert.equal((await (await device(app,'/api/hub')).json()).learning.label,'Mute');
 await device(receiver,'/api/device/recordings','POST',capture(press([1,1,0,1,0,0,1,0,1,1,0,1])),{'X-Capture-Age-Ms':'30'});
 let view=await (await page('/api/hub')).json();
 assert.deepEqual(view.appliances[1].buttons.map(b=>b.label),['Mute']);assert.equal(view.learned.label,'Mute');
 const mute=view.appliances[1].buttons[0];
 assert.equal((await page('/api/buttons/'+mute.id,'PATCH',{label:'Mute sound'})).status,200);
 assert.equal((await page('/api/buttons/'+mute.id,'DELETE')).status,200);
 assert.equal((await page('/api/appliances/'+tv.appliance.id,'DELETE')).status,200);
 const appDevice=view.devices.find(d=>d.kind==='app');
 assert.equal((await page('/api/devices/'+appDevice.id,'PATCH',{name:'Bedroom PC'})).status,200);
 assert.equal((await page('/api/devices/'+appDevice.id,'DELETE')).status,200);
 assert.equal((await device(app,'/api/hub')).status,401,'a removed app is refused');
 view=await (await page('/api/hub')).json();assert.deepEqual(view.devices.map(d=>d.kind).sort(),['receiver','transmitter']);
});
