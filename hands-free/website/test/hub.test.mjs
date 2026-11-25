import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createHub,validTimings,firstBurst,sameSignal,cutShort,samsungTimings,READY,ICONS,iconFor,LIMITS} from '../hub.mjs';
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
test('a button gets a fitting picture from its name when none is chosen',()=>{
 for(const [label,icon]of [['On/off','power'],['Power','power'],['Volume up','plus'],['Speed down','minus'],['Mute','silence'],['Timer','timer'],['Channel up','up'],['Input','input'],['OK','ok'],['Left','left'],['Zebra','dot'],['',  'dot']])assert.equal(iconFor(label),icon,label);
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
test('a recorded button that may not be the remote\'s is marked: a signal already arriving by itself, or one the device has',async()=>{
 let time=1_000_000;const hub=createHub({seed,now:()=>time});await hub.ready;
 const lamp=(await hub.addAppliance({name:'Lamp',kind:'light'})).body.appliance,receiver=(await link(hub,'receiver')).device;
 const stray=press([1,0,1,0,1,0,1,0,1,0,1,0]),on=press([1,1,1,0,0,0,1,1,1,0,0,0]);let n=0;
 const hear=(raw,ago=0)=>hub.addRecording(receiver,capture(raw,{capture_id:++n}),ago);
 // A quiet room: nothing to say.
 let started=hub.startLearning({applianceId:lamp.id,label:'On'});assert.equal(started.body.noise,0);assert.match(started.body.message,/^Point the remote at the receiver/);
 time+=3000;await hear(on);assert.deepEqual([hub.view().learned.heardBefore,hub.view().learned.sameAs],[0,[]]);
 // Something in the room sends the same signal every half minute, with nobody recording.
 for(let i=0;i<3;i++){time+=30000;await hear(stray);}
 assert.equal(hub.view().recordings.length,3);
 time+=5000;started=hub.startLearning({applianceId:lamp.id,label:'Off'});
 assert.equal(started.body.noise,2,'two of them in the last minute');assert.match(started.body.message,/heard 2 signals in the last minute.*Cover the receiver/);
 time+=4000;await hear(stray);   // it arrives again before the remote is pressed, and is taken for the button
 let learned=hub.view().learned;assert.equal(learned.label,'Off');assert.equal(learned.heardBefore,3,'the same signal, three times in the two minutes before');assert.deepEqual(learned.sameAs,[]);
 // Recorded again with the real button: nothing to warn about, and the same button is replaced.
 const off=hub.view().appliances[1].buttons.find(b=>b.label==='Off');
 time+=200000;hub.startLearning({applianceId:lamp.id,label:'Off',replace:off.id});time+=2000;await hear(press([0,0,1,1,0,0,1,1,0,0,1,1]));
 learned=hub.view().learned;assert.deepEqual([learned.heardBefore,learned.sameAs,learned.buttonId],[0,[],off.id]);
 // The wrong button pressed: it is the signal "On" already has.
 time+=200000;hub.startLearning({applianceId:lamp.id,label:'Brighter'});time+=2000;await hear(on);
 assert.deepEqual(hub.view().learned.sameAs,['On']);
 // The linked app sees the same marks.
 assert.deepEqual(Object.keys(hub.view({full:false}).learned).sort(),['afterPartial','applianceId','at','buttonId','heardBefore','label','milliseconds','partial','sameAs','timings']);
});
// The first real remote (a Samsung TV's): one key was saved whole (SAMSUNG, 32 bits, 135 timings:
// the code twice) and one as 58 timings with no protocol, nine short of one code. The TV ignored
// the second. A whole Samsung code is a header and 32 bits: 67 timings.
function samsung(code,frames=2){const out=[];for(let f=0;f<frames;f++){out.push(4500,4500);for(let bit=31;bit>=0;bit--)out.push(560,(code>>>bit)&1?1690:560);out.push(560,f===frames-1?560:46000);}return out.slice(0,-1);}
test('a recording that is only part of a signal is told from the device\'s other buttons',()=>{
 const whole=code=>({protocol:'SAMSUNG',raw_us:samsung(code)}),part={protocol:'UNKNOWN',raw_us:samsung(0xE0E0E01F,1).slice(9)};
 assert.equal(samsung(0xE0E06798).length,135);assert.equal(part.raw_us.length,58);
 assert.equal(cutShort([],part),null,'nothing to compare the first button with');
 assert.deepEqual(cutShort([whole(0xE0E06798)],part),{protocol:'SAMSUNG',timings:58});
 assert.equal(cutShort([whole(0xE0E06798)],whole(0xE0E0E01F)),null);
 assert.equal(cutShort([whole(0xE0E06798),part],whole(0xE0E0E01F)),null,'an earlier bad take does not make a good one doubtful');
 assert.deepEqual(cutShort([whole(0xE0E06798),whole(0xE0E0E01F)],part),{protocol:'SAMSUNG',timings:58});
 // Buttons saved before the protocol was kept say it in their description.
 assert.deepEqual(cutShort([{origin:'SAMSUNG · 32 bits · 0xE0E06798',raw_us:samsung(0xE0E06798)}],{origin:'29 bits · 0x72F243B1',raw_us:part.raw_us}),{protocol:'SAMSUNG',timings:58});
 assert.equal(cutShort([{origin:'29 bits · 0x72F243B1',raw_us:part.raw_us}],{origin:'SAMSUNG · 32 bits · 0xE0E06798',raw_us:samsung(0xE0E06798)}),null);
 // Keys of two remotes on one device: it is still part of a code of one of them.
 assert.deepEqual(cutShort([whole(0xE0E06798),{protocol:'NEC',raw_us:press([1,0,1,1,0,0,1,0,1,0,0,1])}],part),{protocol:'SAMSUNG',timings:58});
 assert.deepEqual(cutShort([{protocol:'NEC',raw_us:press([1,0,1,1,0,0,1,0,1,0,0,1])},whole(0xE0E06798)],part),{protocol:'SAMSUNG',timings:58});
 // A key from another remote, added to the same device, is not doubted: recognised as another
 // protocol, or not recognised but made of other pulses (here a shorter code with 900 and 1800).
 assert.equal(cutShort([whole(0xE0E06798)],{protocol:'NEC',raw_us:press([1,0,1,1,0,0,1,0,1,0,0,1])}),null);
 assert.equal(cutShort([whole(0xE0E06798)],{protocol:'UNKNOWN',raw_us:Array.from({length:27},(_,i)=>i%4===1?1800:900)}),null);
 // The end lost instead of the beginning (the remote turned away): the header and 28 bits.
 assert.deepEqual(cutShort([whole(0xE0E06798)],{protocol:'UNKNOWN',raw_us:samsung(0xE0E0E01F,1).slice(0,58)}),{protocol:'SAMSUNG',timings:58});
 // A remote the receiver has no name for (the fan): its codes are one length; a shorter one is doubted, a repeat count is not.
 const fan=[press([1,0,1,1,0,0,1,0,1,0,0,1],3),press([0,1,1,0,1,0,0,1,1,0,1,0],5)].map(raw_us=>({protocol:'UNKNOWN',raw_us}));
 assert.equal(cutShort(fan,{protocol:'UNKNOWN',raw_us:press([1,1,1,0,0,0,1,1,0,0,1,0],1)}),null);
 assert.deepEqual(cutShort(fan,{protocol:'UNKNOWN',raw_us:press([1,1,1,0,0,0,1,1,0,0,1,0],1).slice(8)}),{protocol:'',timings:19});
 assert.deepEqual(cutShort(fan.slice(0,1),{protocol:'UNKNOWN',raw_us:press([1,1,1,0],1)}),{protocol:'',timings:11},'one other button is enough when the pulses are its own');
 assert.equal(cutShort(fan.slice(0,1),fan[1]),null);
 for(const a of seed.commands)assert.equal(cutShort(seed.commands.filter(b=>b!==a).map(b=>({origin:'The fan recordings that came with the project',raw_us:b.raw_us})),{origin:'The fan recordings that came with the project',raw_us:a.raw_us}),null,a.name);
});
// Reception was unreliable on the first real receiver: a key recorded as 58 timings, then one as 9.
// Both were saved as buttons, and the TV ignored them. Record now waits for a whole key.
test('"Record a button" does not take part of a signal for the button: it goes on waiting, says so, and takes the whole one',async()=>{
 let time=5_000_000;const lines=[],hub=createHub({seed,now:()=>time,log:line=>lines.push(line)});await hub.ready;const receiver=await link(hub,'receiver');
 const tv=(await hub.addAppliance({name:'TV',kind:'tv'})).body.appliance;let n=0;
 const hear=(raw,protocol)=>hub.addRecording(receiver.device,capture(raw,{protocol,capture_id:++n,decoded_hex:'0x'+n,bits:protocol==='SAMSUNG'?32:Math.floor(raw.length/2)}),20);
 const buttons=()=>hub.view().appliances.find(a=>a.id===tv.id).buttons;
 // The first button of a device: nothing to compare it with, but nine timings are no key.
 assert.equal(hub.startLearning({applianceId:tv.id,label:'Power'}).status,200);
 time+=4000;assert.equal((await hear(samsung(0xE0E040BF,1).slice(58),'UNKNOWN')).status,200);
 assert.equal(samsung(0xE0E040BF,1).slice(58).length,9);
 let view=hub.view();assert.equal(view.learned,null);assert.equal(buttons().length,0,'the scrap is not a button');
 assert.deepEqual([view.learning.label,view.learning.partial,view.learning.partialTimings],['Power',1,9]);
 assert.equal(view.learning.secondsLeft,86,'the first 90 seconds still run');
 assert.equal(view.recordings.length,1,'it is kept in the list');
 // Late in the wait: another scrap gives 45 more seconds to press again.
 time+=80000;await hear(samsung(0xE0E040BF,1).slice(60),'UNKNOWN');view=hub.view();assert.deepEqual([view.learning.partial,view.learning.partialTimings,view.learning.secondsLeft],[2,7,45]);
 time+=3000;await hear(samsung(0xE0E040BF),'SAMSUNG');view=hub.view();
 assert.equal(view.learning,null);assert.deepEqual([view.learned.label,view.learned.timings,view.learned.partial,view.learned.afterPartial],['Power',135,null,2]);
 assert.deepEqual(buttons().map(b=>[b.label,b.timings,b.doubt===true]),[['Power',135,false]]);
 // With a whole button to go by: 58 of the 67 timings of one code are not taken either.
 hub.startLearning({applianceId:tv.id,label:'Volume up'});time+=3000;await hear(samsung(0xE0E0E01F,1).slice(9),'UNKNOWN');
 view=hub.view();assert.deepEqual([view.learned,view.learning.partial,view.learning.partialTimings,buttons().length],[null,1,58,1]);
 time+=3000;await hear(samsung(0xE0E0E01F),'SAMSUNG');assert.deepEqual(buttons().map(b=>b.label),['Power','Volume up']);
 // A key of another remote is taken as before (another protocol; or other pulses).
 hub.startLearning({applianceId:tv.id,label:'Sound bar on'});time+=3000;await hear(press([1,0,1,1,0,0,1,0,1,0,0,1]),'NEC');assert.equal(hub.view().learned.label,'Sound bar on');
 // Recording a button again: part of a signal does not replace what it had.
 const power=buttons()[0];hub.startLearning({applianceId:tv.id,label:'Power',replace:power.id});time+=3000;await hear(samsung(0xE0E040BF,1).slice(9),'UNKNOWN');
 assert.equal(buttons()[0].timings,135);assert.equal(hub.view().learning.partial,1);hub.stopLearning();
 // Named by hand from the list, a part is a button, and it is marked as doubtful for the pages and the app.
 const part=hub.view().recordings.find(r=>r.timings===58);assert.equal((await hub.addButton(tv.id,{label:'Mute',recordingId:part.id})).status,200);
 assert.deepEqual(buttons().map(b=>[b.label,b.doubt===true]),[['Power',false],['Volume up',false],['Sound bar on',false],['Mute',true]]);
 assert.deepEqual(hub.view({full:false}).appliances.find(a=>a.id===tv.id).buttons.map(b=>b.doubt===true),[false,false,false,true]);
 assert.equal(hub.view().appliances[0].buttons.some(b=>b.doubt),false,'the fan that came with the project is not doubted');
 // The website's log says what each recording was, and not whose.
 assert.deepEqual(lines.slice(0,3),['recording: 4 bits, 9 timings, 0.0 s old -> only part of a signal, still waiting for the button (1)','recording: 3 bits, 7 timings, 0.0 s old -> only part of a signal, still waiting for the button (2)','recording: SAMSUNG 32 bits, 135 timings, 0.0 s old -> taken for the button being recorded']);
 assert.equal(lines.some(line=>/TV|Power|Receiver/.test(line)),false);
});
// The first real TV remote was Samsung's smart remote: infrared for its power key only, Bluetooth
// for the rest, so nothing but power could be recorded. The TV still takes Samsung's standard
// infrared codes, so its buttons are offered ready-made.
test('ready-made Samsung TV buttons are whole Samsung codes: 32 bits, the code and its complement, sent twice',()=>{
 const read=raw=>{let code=0;for(let i=2;i<66;i+=2){assert.equal(raw[i],560);code=code*2+(raw[i+1]>1000?1:0);}return code;};
 const set=READY['samsung-tv'];assert.equal(set.kind,'tv');assert.equal(set.buttons.length,18);
 assert.equal(new Set(set.buttons.map(b=>b[0].toLowerCase())).size,18);assert.equal(new Set(set.buttons.map(b=>b[2])).size,18);
 for(const [label,icon,code]of set.buttons){
  assert.ok(ICONS.includes(icon),label);assert.ok(label.length<=LIMITS.label);
  assert.equal(code>>>16,0xE0E0,label);assert.equal(((code>>>8)&255)^(code&255),255,label+': the command and its complement');
  const raw=samsungTimings(code);assert.ok(validTimings(raw));assert.equal(raw.length,135);
  assert.deepEqual(raw.slice(0,2),[4480,4480]);assert.equal(raw[66],560);assert.deepEqual(raw.slice(68),raw.slice(0,67),'the same code again');
  assert.equal(raw.slice(0,68).reduce((a,b)=>a+b,0),108080,'108 ms from start to start');
  assert.equal(read(raw),code,label);assert.equal(firstBurst(raw).length,67);
 }
 assert.equal(read(samsungTimings(0xE0E040BF)),0xE0E040BF);assert.equal(samsungTimings(0xE0E040BF,1).length,67);
 // The receiver's own recording of a Samsung key (other header and gap lengths, within what a receiver measures) is the same signal.
 assert.ok(sameSignal(samsung(0xE0E0E01F),samsungTimings(0xE0E0E01F)));assert.equal(sameSignal(samsung(0xE0E0E01F),samsungTimings(0xE0E0D02F)),false);
});
test('ready-made buttons are added to a device; what was recorded whole stays, parts of signals are replaced',async()=>{
 const dataDir=folder();let hub=createHub({dataDir,seed,timing:quick});await hub.ready;const receiver=await link(hub,'receiver');
 assert.deepEqual(hub.view().ready,[{id:'samsung-tv',name:'Samsung TV',kind:'tv',buttons:18}]);assert.deepEqual(hub.view({full:false}).ready,hub.view().ready);
 const tv=(await hub.addAppliance({name:'TV',kind:'tv'})).body.appliance;let n=0;
 const add=async(label,raw,protocol)=>{await hub.addRecording(receiver.device,capture(raw,{protocol,capture_id:++n,decoded_hex:'0x'+n}));const made=await hub.addButton(tv.id,{label,recordingId:hub.view().recordings.at(-1).id});assert.equal(made.status,200,label);};
 // As on the first real TV: the smart remote's own power key (whole), and three takes that caught scraps.
 await add('On/off',samsung(0xE0E06798),'SAMSUNG');await add('Volume up',samsung(0xE0E0E01F,1).slice(9),'UNKNOWN');await add('Mute',samsung(0xE0E0F00F,1).slice(58),'UNKNOWN');
 await add('Louder',samsung(0xE0E0D02F),'SAMSUNG');   // "Volume down", recorded whole under a name of her own
 const buttons=()=>hub.view().appliances.find(a=>a.id===tv.id).buttons;
 assert.deepEqual(buttons().map(b=>[b.label,b.doubt===true]),[['On/off',false],['Volume up',true],['Mute',true],['Louder',false]]);
 const ids=buttons().map(b=>b.id);
 const done=await hub.addReady(tv.id,'samsung-tv');assert.equal(done.status,200);
 assert.deepEqual(done.body.kept,['On/off','Volume down']);assert.deepEqual(done.body.replaced,['Volume up','Mute']);assert.equal(done.body.added.length,14);
 assert.equal(done.body.message,'16 buttons for a Samsung TV were added to TV (Volume up, Mute replaced: they were only part of a signal). Try one: if the TV reacts, they all work.');
 const now=buttons();assert.equal(now.length,18);assert.equal(now.some(b=>b.doubt),false);
 assert.deepEqual(now.slice(0,4).map(b=>[b.label,b.id,b.timings,b.origin]),[['On/off',ids[0],135,'SAMSUNG · 12 bits · 0x1'],['Volume up',ids[1],135,'SAMSUNG · 32 bits · 0xE0E0E01F · ready-made'],['Mute',ids[2],135,'SAMSUNG · 32 bits · 0xE0E0F00F · ready-made'],['Louder',ids[3],135,'SAMSUNG · 12 bits · 0x4']]);
 assert.deepEqual(now.find(b=>b.label==='OK'),{id:now.find(b=>b.label==='OK').id,label:'OK',icon:'ok',carrier_khz:38,origin:'SAMSUNG · 32 bits · 0xE0E016E9 · ready-made',timings:135,milliseconds:169});
 // Again: nothing changes. And it is all kept across a restart.
 const again=await hub.addReady(tv.id,'samsung-tv');assert.deepEqual([again.body.added,again.body.replaced,again.body.message],[[],[],'TV already has these buttons.']);
 hub=createHub({dataDir,seed,timing:quick});await hub.ready;assert.equal(hub.view().appliances.find(a=>a.id===tv.id).buttons.length,18);
 // What is asked for has to exist.
 assert.equal((await hub.addReady(tv.id,'toaster')).status,400);assert.equal((await hub.addReady(tv.id,'constructor')).status,400);assert.equal((await hub.addReady('a_000000000000','samsung-tv')).status,404);
 // A sent ready-made button goes to the transmitter with its timings.
 const transmitter=await link(hub,'transmitter'),waiting=hub.nextCommand(transmitter.device,200);
 const ok=hub.view().appliances.find(a=>a.id===tv.id).buttons.find(b=>b.label==='OK'),sending=hub.send({button_id:ok.id,...request()});
 const handed=await waiting;assert.equal(handed.status,200);assert.deepEqual(handed.body.commands[0].raw_us,samsungTimings(0xE0E016E9));assert.equal(handed.body.commands[0].carrier_khz,38);
 hub.commandDone(transmitter.device,{id:handed.body.id,ok:true});assert.equal((await sending).body.sent,true);
});
test('ready-made buttons stop at the most buttons a device may have, and say so',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;const receiver=await link(hub,'receiver');
 const box=(await hub.addAppliance({name:'Box',kind:'other'})).body.appliance;
 for(let i=0;i<LIMITS.buttons-3;i++){await hub.addRecording(receiver.device,capture(press([...i.toString(2).padStart(12,'0')].map(Number)),{capture_id:i+1}));assert.equal((await hub.addButton(box.id,{label:'Key '+i,recordingId:hub.view().recordings.at(-1).id})).status,200);}
 const done=await hub.addReady(box.id,'samsung-tv');
 assert.deepEqual(done.body.added,['On/off','Volume up','Volume down']);assert.match(done.body.message,/^3 buttons for a Samsung TV were added to Box\. Try one: if the TV reacts, they all work\. There was no room for the rest\.$/);
 assert.equal(hub.view().appliances.find(a=>a.id===box.id).buttons.length,LIMITS.buttons);
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
// What happened on the first real boards: a board that had been linked as the transmitter got the
// receiver's program from the Boards and Wi-Fi page. Installing keeps the board's key, so the board
// said "linked", while the website still listed a transmitter, refused its recordings with 403 and
// told the pages that no receiver was linked.
test('a linked board that now runs the other program is that other board: its entry follows the program',async()=>{
 const dataDir=folder();let hub=createHub({dataDir,seed,timing:quick});await hub.ready;
 const board=await link(hub,'transmitter');
 assert.equal(hub.view().transmitter.linked,true);assert.equal(hub.view().receiver.linked,false);
 assert.equal((await hub.addRecording(board.device,capture(press([1,0,1,1,0,0,1,0,1,0,0,1])),20)).status,403,'as a transmitter its recordings are refused');
 // The same key, now with the receiver's program.
 const now=hub.authDevice('Bearer '+board.token,'IRCapture-cloud-2');
 assert.equal(now.id,board.device.id);assert.equal(now.kind,'receiver');assert.equal(now.name,'Receiver');assert.equal(now.firmware,'IRCapture-cloud-2');
 let view=hub.view();
 assert.equal(view.receiver.linked,true);assert.equal(view.receiver.online,true);assert.equal(view.transmitter.linked,false);
 assert.deepEqual(view.devices.map(d=>[d.kind,d.name]),[['receiver','Receiver']]);
 assert.equal((await hub.addRecording(now,capture(press([1,0,1,1,0,0,1,0,1,0,0,1])),20)).status,200,'and its recordings are taken');
 assert.equal((await hub.nextCommand(now,0)).status,403,'it no longer collects commands');
 assert.equal((await hub.startLearning({applianceId:hub.view().appliances[0].id,label:'Swing'})).status,200,'a button can be recorded with it');
 // It is kept: after a restart of the website the board is still the receiver.
 await hub.addRecording(now,capture(press([0,0,1,1,0,0,1,0,1,0,0,1]),{capture_id:2}),20);
 hub=createHub({dataDir,seed,timing:quick});await hub.ready;
 const again=hub.authDevice('Bearer '+board.token,'IRCapture-cloud-2');assert.equal(again.kind,'receiver');
 // Back to the transmitter's program: a transmitter again, without linking again.
 assert.equal(hub.authDevice('Bearer '+board.token,'IRTransmitter-cloud-2').kind,'transmitter');
 assert.deepEqual(hub.view().devices.map(d=>[d.kind,d.name,d.firmware]),[['transmitter','Transmitter','IRTransmitter-cloud-2']]);
});
test('following the program: a typed name stays, a taken name gets a number, and nothing else changes kind',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 const first=await link(hub,'receiver'),second=await link(hub,'transmitter'),app=await link(hub,'app');
 await hub.renameDevice(second.device.id,'Board by the window');
 // A newer version of the same program: the entry notes it and stays what it is.
 assert.equal(hub.authDevice('Bearer '+first.token,'IRCapture-cloud-3').kind,'receiver');
 assert.equal(hub.view().devices.find(d=>d.id===first.device.id).firmware,'IRCapture-cloud-3');
 // No program named, a program this website does not know, a name that only begins alike: nothing changes.
 for(const name of [undefined,'','SomethingElse-1','IRCaptureX-1','IRTransmitters','<b>IRTransmitter</b>'])assert.equal(hub.authDevice('Bearer '+first.token,name).kind,'receiver',String(name));
 // The Windows app's key never becomes a board's, whatever it says.
 assert.equal(hub.authDevice('Bearer '+app.token,'IRCapture-cloud-2').kind,'app');
 // The second board gets the receiver's program: "Receiver" is taken, and its typed name stays anyway.
 const changed=hub.authDevice('Bearer '+second.token,'IRCapture-cloud-2');
 assert.equal(changed.kind,'receiver');assert.equal(changed.name,'Board by the window');
 // And a board with a name the website chose gets the next free one.
 const third=await link(hub,'transmitter');
 assert.equal(hub.authDevice('Bearer '+third.token,'IRCapture-cloud-2').name,'Receiver 2');
 assert.deepEqual(hub.view().devices.map(d=>d.kind).sort(),['app','receiver','receiver','receiver']);
});
test('following the program: a transmitter that was waiting for a command is let go when it becomes the receiver',async()=>{
 const hub=createHub({seed,timing:quick});await hub.ready;
 const board=await link(hub,'transmitter');
 const waiting=hub.nextCommand(board.device,200);
 hub.authDevice('Bearer '+board.token,'IRCapture-cloud-2');
 assert.equal((await waiting).status,204);
 const sent=await hub.send({button_id:hub.view().appliances[0].buttons[0].id,...request()});
 assert.notEqual(sent.status,200,'with no transmitter left nothing is sent');assert.match(sent.body.message,/transmitter/i);
});
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
 // A board says which program it runs with every request. One linked as the transmitter that now
 // runs the receiver's program is taken as the receiver, and its recordings are accepted.
 const other=await linked('transmitter');
 assert.equal((await device(other,'/api/device/recordings','POST',capture(seed.commands[3].raw_us,{capture_id:7}),{'X-Capture-Age-Ms':'25'})).status,403);
 assert.equal((await device(other,'/api/device/recordings','POST',capture(seed.commands[3].raw_us,{capture_id:7}),{'X-Capture-Age-Ms':'25','X-Firmware':'IRCapture-cloud-2'})).status,200);
 assert.deepEqual(await (await device(other,'/api/device/hello','GET',undefined,{'X-Firmware':'IRCapture-cloud-2'})).json(),{kind:'receiver',name:'Receiver 2'});
 const after=await (await page('/api/hub')).json();
 assert.deepEqual(after.devices.map(d=>[d.kind,d.name]),[['receiver','Receiver'],['receiver','Receiver 2']]);assert.equal(after.transmitter.linked,false);
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
 assert.deepEqual(Object.keys(seenByApp).sort(),['appliances','learned','learning','ready','receiver','transmitter']);assert.deepEqual(Object.keys(seenByApp.appliances[0].buttons[0]).sort(),['icon','id','label']);
 assert.deepEqual(seenByApp.receiver,{linked:false,online:false});
 const waiting=device(board,'/api/device/next?wait=5');await pause(60);
 const pressed=device(app,'/api/send','POST',{button_id:seenByApp.appliances[0].buttons[0].id,...request()});
 const handed=await (await waiting).json();await device(board,'/api/device/done','POST',{id:handed.id,ok:true});
 assert.equal((await pressed).status,200);
 assert.equal((await device(app,'/api/pair/approve','POST',{code:'123456'})).status,403);
 // Set up by eye in the app: add a device, then record a button for it.
 const added=await device(app,'/api/appliances','POST',{name:'TV',kind:'tv'});assert.equal(added.status,200);const tv=await added.json();
 // Since 0.4.43 the app may also rename a device and set "ask before sending", as the Setup page can.
 assert.equal((await device(app,'/api/appliances/'+tv.appliance.id,'PATCH',{name:'Bedroom TV'})).status,200);
 assert.equal((await device(app,'/api/appliances/'+tv.appliance.id,'PATCH',{careful:true})).status,200);
 const receiver=await linked('receiver');
 assert.equal((await device(app,'/api/learn','POST',{applianceId:tv.appliance.id,label:'Mute',icon:'silence'})).status,200);
 assert.equal((await (await device(app,'/api/hub')).json()).learning.label,'Mute');
 await device(receiver,'/api/device/recordings','POST',capture(press([1,1,0,1,0,0,1,0,1,1,0,1])),{'X-Capture-Age-Ms':'30'});
 let view=await (await page('/api/hub')).json();
 assert.deepEqual(view.appliances[1].buttons.map(b=>b.label),['Mute']);assert.equal(view.learned.label,'Mute');
 assert.deepEqual([view.appliances[1].name,view.appliances[1].careful],['Bedroom TV',true]);
 // Ready-made buttons are part of setting a device up: the app may add them, a board may not.
 assert.equal((await device(receiver,'/api/appliances/'+tv.appliance.id+'/ready','POST',{set:'samsung-tv'})).status,401);
 assert.equal((await device(app,'/api/appliances/'+tv.appliance.id+'/ready','POST',{set:'toaster'})).status,400);
 const ready=await device(app,'/api/appliances/'+tv.appliance.id+'/ready','POST',{set:'samsung-tv'});assert.equal(ready.status,200);
 const readied=await ready.json();assert.equal(readied.added.length,17);assert.deepEqual(readied.kept,['Mute']);
 view=await (await page('/api/hub')).json();assert.equal(view.appliances[1].buttons.length,18);assert.equal(view.appliances[1].buttons[0].label,'Mute');
 for(const b of view.appliances[1].buttons.slice(1))assert.equal((await page('/api/buttons/'+b.id,'DELETE')).status,200);
 view=await (await page('/api/hub')).json();
 const mute=view.appliances[1].buttons[0];
 // The app renames a button, records it again in place, and removes it; then the device.
 assert.equal((await device(app,'/api/buttons/'+mute.id,'PATCH',{label:'Mute sound'})).status,200);
 assert.equal((await device(app,'/api/learn','POST',{applianceId:tv.appliance.id,label:'Mute sound',replace:mute.id})).status,200);
 await device(receiver,'/api/device/recordings','POST',capture(press([0,1,0,0,1,1,0,1,0,0,1,1])),{'X-Capture-Age-Ms':'20'});
 view=await (await page('/api/hub')).json();
 assert.deepEqual(view.appliances[1].buttons.map(b=>[b.id,b.label,b.icon]),[[mute.id,'Mute sound','silence']],'the same button, with the new signal');
 assert.equal((await device(app,'/api/buttons/'+mute.id,'DELETE')).status,200);
 assert.equal((await device(app,'/api/appliances/'+tv.appliance.id,'DELETE')).status,200);
 assert.equal((await device(app,'/api/appliances/'+tv.appliance.id,'DELETE')).status,404);
 // What stays with the signed-in website: boards and apps, the recordings list, linking.
 const appDevice=view.devices.find(d=>d.kind==='app');
 for(const [route,method,body] of [['/api/devices/'+appDevice.id,'PATCH',{name:'Mine'}],['/api/devices/'+appDevice.id,'DELETE'],['/api/recordings/all','DELETE'],['/api/appliances/'+view.appliances[0].id+'/buttons','POST',{label:'X',recording_id:'r_none'}],['/api/pair/approve','POST',{code:'123456'}]])
  assert.equal((await device(app,route,method,body)).status,403,method+' '+route);
 assert.equal((await page('/api/devices/'+appDevice.id,'PATCH',{name:'Bedroom PC'})).status,200);
 assert.equal((await page('/api/devices/'+appDevice.id,'DELETE')).status,200);
 assert.equal((await device(app,'/api/hub')).status,401,'a removed app is refused');
 view=await (await page('/api/hub')).json();assert.deepEqual(view.devices.map(d=>d.kind).sort(),['receiver','transmitter']);
});
