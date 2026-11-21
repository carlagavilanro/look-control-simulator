// Runs the two sketches (built for this PC by build.sh) against the real website code, and
// checks the whole path: receiver -> website -> transmitter.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const site=new URL('../../website',import.meta.url).pathname;
const {createCloudServer}=await import(site+'/cloud-server.mjs');
const {createHub}=await import(site+'/hub.mjs');
const seed=JSON.parse(fs.readFileSync(site+'/fan-signals.json','utf8'));
const here=path.dirname(new URL(import.meta.url).pathname),port=18811,base='http://127.0.0.1:'+port;
const credentials={username:'pc-check',password:'pc-check-password-of-32-characters'};
const hub=createHub({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'hf-site-')),seed,timing:{poll:2000,online:5000}});
const server=createCloudServer({...credentials,hub});await new Promise(r=>server.listen(port,'127.0.0.1',r));
const signed=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:base},body:new URLSearchParams(credentials)});
const cookie=signed.headers.get('set-cookie').split(';')[0];
const page=async(route,method='GET',body)=>{const r=await fetch(base+route,{method,headers:{Cookie:cookie,Origin:base,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
const request=()=>({request_id:randomBytes(16).toString('hex'),created_at:Date.now()});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let passed=0;const ok=(what)=>{passed++;console.log('  ok  '+what);};

function board(name,state){
 const child=spawn(path.join(here,'bin',name),{env:{...process.env,HF_STATE:state},stdio:['pipe','pipe','inherit']});
 const lines=[];let rest='',waiters=[];
 child.stdout.on('data',chunk=>{rest+=chunk;let i;while((i=rest.indexOf('\n'))>=0){const line=rest.slice(0,i).replace(/\r$/,'');rest=rest.slice(i+1);lines.push(line);waiters=waiters.filter(w=>!w(line));}});
 // Wait for a line (from `from` on) that matches.
 const expect=(pattern,ms=15000,from=0)=>new Promise((resolve,reject)=>{
  const found=lines.slice(from).find(l=>pattern.test(l));if(found)return resolve(found);
  const timer=setTimeout(()=>reject(Error(name+': no line matching '+pattern+' within '+ms+' ms. Last lines:\n'+lines.slice(-8).join('\n'))),ms);
  waiters.push(line=>{if(!pattern.test(line))return false;clearTimeout(timer);resolve(line);return true;});
 });
 return {lines,expect,type:text=>child.stdin.write(text),stop:()=>new Promise(r=>{child.on('exit',r);child.kill();}),mark:()=>lines.length};
}
async function linkBoard(b,from=0){const line=await b.expect(/LINK CODE \d{3} \d{3}/,20000,from);const code=line.match(/LINK CODE (\d{3}) (\d{3})/).slice(1).join('');const approved=await page('/api/pair/approve','POST',{code});assert.equal(approved.status,200);await b.expect(/Linked to 127\.0\.0\.1:18811 as/,15000,from);return approved.body.device;}
const sentTimings=line=>line.split(': ')[1].split(' ').map(Number);

try{
 // ---------------- transmitter ----------------
 console.log('Transmitter sketch');
 const tState=fs.mkdtempSync(path.join(os.tmpdir(),'hf-transmitter-'));
 let t=board('transmitter',tState);
 await t.expect(/Transmitter ready/);await t.expect(/SEVEN FAN COMMAND TEST/);ok('starts as before: its own library and the USB fan test');
 const tDevice=await linkBoard(t);ok('shows a link code and is linked when the code is typed on the site');
 assert.equal(fs.readdirSync(tState).some(f=>f.startsWith('prefs-hf-cloud')),true);
 assert.equal(t.lines.some(l=>/[A-Za-z0-9_-]{43}/.test(l)),false);ok('keeps its key in flash and never prints it');
 let view=(await page('/api/hub')).body;assert.equal(view.transmitter.online,true);assert.equal(view.transmitter.practice,false);
 const fan=view.appliances[0];
 for(const [index,name] of [[0,'captured_power'],[5,'captured_turn']]){
  const mark=t.mark(),pressed=await page('/api/send','POST',{button_id:fan.buttons[index].id,...request()});
  assert.equal(pressed.status,200,JSON.stringify(pressed.body));assert.match(pressed.body.message,/^Sent\./);
  const line=await t.expect(/^IRSEND /,5000,mark);assert.match(line,/^IRSEND 38 /);
  assert.deepEqual(sentTimings(line),seed.commands.find(c=>c.name===name).raw_us);
  await t.expect(new RegExp('IR command from the website: Fan · '+fan.buttons[index].label),2000,mark);await pause(900);
 }
 ok('a button pressed on the site is sent as infrared with exactly the recorded timings');
 let mark=t.mark();t.type('3');const usb=await t.expect(/^IRSEND /,3000,mark);assert.deepEqual(sentTimings(usb),seed.commands.find(c=>c.name==='captured_level_up').raw_us);await t.expect(/SENT: Speed up/,2000,mark);
 ok('the USB fan test still works while linked');
 const tooSoon=await page('/api/send','POST',{button_id:fan.buttons[0].id,...request()});
 assert.equal(tooSoon.status,502);assert.match(tooSoon.body.message,/Please wait before another command.*Nothing was sent/);
 assert.equal(t.lines.slice(mark).filter(l=>l.startsWith('IRSEND')).length,1);ok('a command arriving within 0.8 s of another is refused by the board, and the site says nothing was sent');
 await t.stop();t=board('transmitter',tState);await t.expect(/WEBSITE: Linked to 127\.0\.0\.1:18811\./);await pause(1500);
 assert.equal(t.lines.some(l=>/LINK CODE/.test(l)),false);
 mark=t.mark();assert.equal((await page('/api/send','POST',{button_id:fan.buttons[6].id,...request()})).status,200);await t.expect(/^IRSEND 38 /,3000,mark);
 ok('after a restart it is still linked (no new code) and takes commands');
 fs.writeFileSync(path.join(tState,'wifi-down'),'');await pause(9000);
 const offline=await page('/api/send','POST',{button_id:fan.buttons[0].id,...request()});assert.equal(offline.status,503);assert.match(offline.body.message,/offline\. No command was sent/);
 fs.rmSync(path.join(tState,'wifi-down'));await pause(4000);
 mark=t.mark();assert.equal((await page('/api/send','POST',{button_id:fan.buttons[0].id,...request()})).status,200);await t.expect(/^IRSEND 38 /,3000,mark);
 ok('with Wi-Fi gone the site reports it offline and sends nothing; it carries on when Wi-Fi returns');
 await t.stop();
 const p=board('transmitter-practice',tState);await p.expect(/WEBSITE: Linked/);await pause(2500);
 mark=p.mark();const practised=await page('/api/send','POST',{button_id:fan.buttons[0].id,...request()});
 assert.equal(practised.status,200);assert.equal(practised.body.sent,false);assert.match(practised.body.message,/practice mode/);
 await p.expect(/PRACTICE command from the website: Fan · Power\. No IR signal sent\./,3000,mark);assert.equal(p.lines.some(l=>l.startsWith('IRSEND')),false);
 ok('in practice mode nothing is sent and the site says so');
 await p.stop();

 // ---------------- receiver ----------------
 console.log('Receiver sketch');
 const rState=fs.mkdtempSync(path.join(os.tmpdir(),'hf-receiver-'));fs.writeFileSync(path.join(rState,'wifi-down'),'');
 const ir=path.join(rState,'ir-in.txt');fs.writeFileSync(ir,'');
 const press=(bits,repeats=3)=>{const out=[];for(let r=0;r<repeats;r++){out.push(9000,4500);for(const bit of bits)out.push(560,bit?1690:560);out.push(560,r===repeats-1?560:40000);}return out.slice(0,-1);};
 const shine=raw=>fs.appendFileSync(ir,raw.join(' ')+'\n');
 let r=board('receiver',rState);
 await r.expect(/"type":"receiver_status"/);
 const first=press([1,0,1,1,0,0,1,0,1,0,0,1]),second=press([0,1,1,0,1,0,0,1,1,0,1,0]);
 shine(first);await r.expect(/"capture_id":1/);shine(second);await r.expect(/"capture_id":2/);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(rState,'fs/captures/0000000001.json'),'utf8')).raw_us,first);
 ok('with no network it records and saves exactly as before');
 fs.rmSync(path.join(rState,'wifi-down'));
 const rDevice=await linkBoard(r);await r.expect(/Recording 2 sent to the website/,15000);
 view=(await page('/api/hub')).body;assert.equal(view.recordings.length,2);assert.equal(view.recordings[0].from,'Receiver');
 ok('once online it links by code and sends what it had saved, oldest first');
 const lamp=(await page('/api/appliances','POST',{name:'Lamp',kind:'light'})).body.appliance;
 assert.equal((await page('/api/learn','POST',{applianceId:lamp.id,label:'On',icon:'light'})).status,200);
 const lampOn=press([1,1,1,0,0,0,1,1,0,0,1,0],4);shine(lampOn);await r.expect(/Recording 3 sent to the website/,15000);
 view=(await page('/api/hub')).body;const on=view.appliances.find(a=>a.id===lamp.id).buttons[0];
 assert.equal(on?.label,'On');assert.equal(view.recordings.length,2);assert.equal(view.learned.label,'On');
 ok('"Record a button" on the site takes the button pressed at the receiver');
 for(const line of r.lines)assert.doesNotThrow(()=>JSON.parse(line),line);
 ok('every line it prints is still JSON, so capture.ps1 and download-receiver.ps1 keep working');
 // The whole path: what the receiver heard is what the transmitter sends.
 t=board('transmitter',tState);await t.expect(/WEBSITE: Linked/);await pause(2500);mark=t.mark();
 assert.equal((await page('/api/send','POST',{button_id:on.id,...request()})).status,200);
 assert.deepEqual(sentTimings(await t.expect(/^IRSEND 38 /,3000,mark)),lampOn);
 ok('receiver -> website -> transmitter: the timings sent are the timings recorded');
 mark=r.mark();r.type('STATUS\nCLOUD\nEXPORT\n');await r.expect(/"type":"export_end","count":3/,5000,mark);
 assert.match(await r.expect(/"type":"cloud"/,2000,mark),/Linked to 127\.0\.0\.1:18811\./);
 ok('its USB commands (STATUS, EXPORT) work as before, and CLOUD reports the link');
 await r.stop();r=board('receiver',rState);await r.expect(/"type":"cloud","message":"Linked/);await pause(3000);
 assert.equal(r.lines.some(l=>/sent to the website/.test(l)),false);assert.equal((await page('/api/hub')).body.recordings.length,2);
 ok('after a restart nothing is sent twice');
 mark=r.mark();r.type('ERASE SAVED CAPTURES\n');await r.expect(/"type":"clear_result","remaining":0/,5000,mark);
 await r.stop();fs.writeFileSync(ir,'');r=board('receiver',rState);await r.expect(/"type":"cloud","message":"Linked/);
 const afterErase=press([0,0,1,1,0,0,1,1,0,1,0,1]);shine(afterErase);await r.expect(/"capture_id":1/);await r.expect(/Recording 1 sent to the website/,15000);
 assert.equal((await page('/api/hub')).body.recordings.length,3);
 ok('after the saved recordings are erased, new ones (numbered from 1 again) are still sent');
 // Removed on the site: the board notices and asks for a new code.
 mark=r.mark();assert.equal((await page('/api/devices/'+rDevice.id,'DELETE')).status,200);
 shine(press([1,0,0,1,1,0,0,1,1,0,0,1]));await r.expect(/no longer knows this board/,30000,mark);
 await linkBoard(r,mark);await r.expect(/Recording 2 sent to the website/,15000,mark);
 ok('removed on the Setup page, it asks for a new code; linked again, it sends what it recorded meanwhile');
 await r.stop();await t.stop();
 console.log('\n'+passed+' checks passed');
}catch(error){console.error('\nFAILED: '+error.message);process.exitCode=1;}
finally{server.closeAllConnections();server.close();setTimeout(()=>process.exit(process.exitCode||0),200);}
