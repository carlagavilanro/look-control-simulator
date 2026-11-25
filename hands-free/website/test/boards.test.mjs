import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createCloudServer} from '../cloud-server.mjs';
import {HELLO,FORGET,wifiProblem,wifiRequest,lineReader,boardAnswer,heardSignal,olderProgram,validPrograms,compare,md5} from '../public/board-usb.mjs';

const hex=data=>createHash('md5').update(data).digest('hex');
test('MD5 here is MD5: the same as the computer\'s own for every length around the block edges',()=>{
 assert.equal(md5(new Uint8Array(0)),'d41d8cd98f00b204e9800998ecf8427e');
 assert.equal(md5(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')),'9e107d9d372bb6826bd81d3542a419d6');
 for(const length of [1,54,55,56,57,63,64,65,119,120,128,1000,4096,70001]){const data=randomBytes(length);assert.equal(md5(new Uint8Array(data)),hex(data),'length '+length);}
});
test('a Wi-Fi name and password are checked before they are sent, and sent as one line',()=>{
 assert.equal(wifiProblem('Home','password1'),'');assert.equal(wifiProblem('Open network',''),'');assert.equal(wifiProblem('Café 2.4','pässwörd'),'');
 assert.match(wifiProblem('','password1'),/Type the Wi-Fi name/);assert.match(wifiProblem('   ','password1'),/Type the Wi-Fi name/);
 assert.match(wifiProblem('x'.repeat(33),'password1'),/at most 32/);assert.match(wifiProblem('é'.repeat(17),'password1'),/at most 32/,'counted in bytes, as the board counts');
 assert.match(wifiProblem('Home','short'),/at least 8/);assert.match(wifiProblem('Home','x'.repeat(64)),/at most 63/);
 assert.match(wifiProblem('Home\n{"hf":"forget-wifi"}','password1'),/line break/);assert.match(wifiProblem('Home','pass\rword1'),/line break/);
 const line=wifiRequest('Home "2.4" \\ net','pa"ss\\word 1');assert.equal(line.endsWith('\n'),true);assert.equal(line.indexOf('\n'),line.length-1);
 assert.deepEqual(JSON.parse(line),{hf:'wifi',ssid:'Home "2.4" \\ net',password:'pa"ss\\word 1'});
 assert.throws(()=>wifiRequest('Home','short'),/at least 8/);
 assert.deepEqual([JSON.parse(HELLO),JSON.parse(FORGET)],[{hf:'hello'},{hf:'forget-wifi'}]);
});
test('what a board says is read line by line, and only a real answer counts as one',()=>{
 const lines=[],feed=lineReader(line=>lines.push(line)),bytes=text=>new TextEncoder().encode(text);
 feed(bytes('Transmitter ready. Rec'));feed(bytes('eiver board is not required.\r\n{"type":"boa'));feed(bytes('rd","kind":"transmitter"}\n\npartial'));
 assert.deepEqual(lines,['Transmitter ready. Receiver board is not required.','{"type":"board","kind":"transmitter"}']);
 const euro=bytes('café\n');feed(euro.slice(0,4));feed(euro.slice(4));assert.equal(lines.at(-1),'partialcafé');
 const full='{"type":"board","saved":true,"kind":"receiver","firmware":"IRCapture-cloud-2","site":"control.carla.codes","wifi":{"set":true,"name":"Home","connected":false},"link":{"linked":false,"code":"123456"}}';
 assert.deepEqual(boardAnswer(full),{kind:'receiver',firmware:'IRCapture-cloud-2',site:'control.carla.codes',wifi:{set:true,name:'Home',connected:false},link:{linked:false,code:'123456'},saved:true,message:''});
 assert.deepEqual(boardAnswer('{"type":"board","kind":"transmitter","link":{"code":"12ab56"},"wifi":{"set":"yes"}}'),{kind:'transmitter',firmware:'',site:'',wifi:{set:false,name:'',connected:false},link:{linked:false,code:''},saved:null,message:''});
 for(const other of ['WEBSITE: Linked to control.carla.codes.','{"type":"cloud","message":"x"}','{"type":"board","kind":"toaster"}','{"type":"board","kind":"__proto__"}','{broken','',null])assert.equal(boardAnswer(other),null,String(other));
 assert.equal(olderProgram('Transmitter ready. Receiver board is not required.'),'transmitter');assert.equal(olderProgram('HANDS FREE - SEVEN FAN COMMAND TEST'),'transmitter');
 assert.equal(olderProgram('{"type":"receiver_status","storage_ready":true}'),'receiver');assert.equal(olderProgram('ets Jul 29 2019 12:21:46'),'');
});
const part=(name,file,offset,size)=>({part:name,file,offset,size,md5:'0'.repeat(32)});
const list=()=>({format:1,version:'0.4.43',commit:'abc',built_at:'2026-11-25T00:00:00.000Z',boards:{receiver:{name:'Receiver',firmware:'IRCapture-cloud-2',chip:'ESP32',parts:[part('bootloader','receiver.bootloader.bin',0x1000,18000),part('partitions','receiver.partitions.bin',0x8000,0xc00),part('boot_app0','boot_app0.bin',0xe000,0x2000),part('app','receiver.app.bin',0x10000,900000)]}}});
// The line the receiver's program prints for every signal it hears (IRCapture.ino). The Boards
// page shows it as "heard a signal", so a receiver that is online but hears nothing can be told
// apart from one whose recordings do not reach the website.
test('a signal the receiver says it heard is read from its USB line, kept or not; nothing else counts as one',()=>{
 const line=(extra={})=>JSON.stringify({type:'capture',schema:1,sequence:4,uptime_ms:91234,protocol:'NEC',decoded_hex:'0x20DF10EF',bits:32,address:4,command:8,receiver_pin:15,leading_gap_us:120000,repeat:false,overflow:false,library:'2.9.0',carrier_khz:null,raw_us:[9000,4500,560,560,560,1690,560],capture_id:12,saved:true,...extra});
 assert.deepEqual(heardSignal(line()),{timings:7,repeat:false,overflow:false,saved:true,reason:''});
 assert.deepEqual(heardSignal(line({repeat:true,saved:false,capture_id:undefined,save_error:'Repeat frame only.'})),{timings:7,repeat:true,overflow:false,saved:false,reason:'Repeat frame only.'});
 assert.equal(heardSignal(line({save_error:'x'.repeat(400),saved:false})).reason.length,160);
 for(const other of ['','ready','{"type":"board","kind":"receiver"}','{"type":"receiver_status","saved":3}','{"type":"capture"','{"type":"capture","raw_us":"9000 4500"}',' {"type":"capture","raw_us":[1,2,3]}',null,42])assert.equal(heardSignal(other),null,String(other));
 // A long signal arrives in pieces and is still one line: an air conditioner's remote has about two thousand timings.
 const long=line({raw_us:Array.from({length:2047},(_,i)=>500+i)}),got=[];assert.ok(long.length>8000,'longer than the reader used to hold');
 const read=lineReader(text=>got.push(text)),bytes=new TextEncoder().encode('{"type":"board","kind":"receiver"}\r\n'+long+'\r\n');
 for(let i=0;i<bytes.length;i+=700)read(bytes.subarray(i,i+700));
 assert.equal(got.length,2);assert.equal(heardSignal(got[1]).timings,2047);
});
test('a list of board programs is used only when every piece goes to one of the four known places',()=>{
 assert.deepEqual(validPrograms(list()),list());
 const changed=change=>{const copy=list();change(copy);return validPrograms(copy);};
 // Where the board keeps its Wi-Fi, link key (0x9000) and recordings is never written.
 assert.equal(changed(l=>{l.boards.receiver.parts[1].offset=0x9000;}),null);
 assert.equal(changed(l=>{l.boards.receiver.parts[0].size=0x7001;}),null,'a bootloader that would run into the partition table');
 assert.equal(changed(l=>{l.boards.receiver.parts[3].size=0x140001;}),null,'a program larger than its place');
 assert.equal(changed(l=>{l.boards.receiver.parts[3].offset=0x20000;}),null);
 assert.equal(changed(l=>{l.boards.receiver.parts[3].file='../cloud-server.mjs';}),null);assert.equal(changed(l=>{l.boards.receiver.parts[3].file='https://example.com/x.bin';}),null);
 assert.equal(changed(l=>{l.boards.receiver.parts[3].md5='xyz';}),null);assert.equal(changed(l=>{l.boards.receiver.parts.pop();}),null);
 assert.equal(changed(l=>{l.boards.receiver.parts[3]=part('bootloader','b.bin',0x1000,100);}),null,'the same place twice');
 assert.equal(changed(l=>{l.boards.receiver.chip='ESP8266';}),null);assert.equal(changed(l=>{l.format=2;}),null);assert.equal(changed(l=>{l.version='latest';}),null);
 assert.equal(changed(l=>{l.boards={toaster:l.boards.receiver};}),null);assert.equal(validPrograms(null),null);
 assert.deepEqual([compare('IRCapture-cloud-2','IRCapture-cloud-2'),compare('IRCapture-cloud-1','IRCapture-cloud-2'),compare('IRCapture-cloud-3','IRCapture-cloud-2'),compare('Something-else','IRCapture-cloud-2'),compare('','IRCapture-cloud-2')],['same','older','same','older','unknown']);
});

const credentials={username:'test-user',password:'test-only-password-32-characters-long'};
test('the site hands on the published board programs, checked, to signed-in pages only',async t=>{
 const app=randomBytes(5000),published=new Map(),asked=[];let time=0;
 const publish=(version,program)=>{const l=list();l.version=version;l.boards.receiver.parts=l.boards.receiver.parts.map(p=>p.part==='app'?{...p,size:program.length,md5:hex(program)}:{...p,size:Math.min(p.size,64),md5:hex(Buffer.alloc(Math.min(p.size,64),p.part.length))});
  published.clear();published.set('board-programs.json',Buffer.from(JSON.stringify(l)));for(const p of l.boards.receiver.parts)published.set(p.file,p.part==='app'?program:Buffer.alloc(p.size,p.part.length));return l;};
 const server=createCloudServer({...credentials,boardPrograms:async name=>{asked.push(name);return published.get(name)||null;},now:()=>time});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`,get=(url,headers={})=>fetch(base+url,{redirect:'manual',headers});
 for(const path of ['/boards','/boards.mjs','/board-usb.mjs','/firmware/board-programs.json','/firmware/receiver.app.bin','/vendor/esptool/index.js'])assert.equal((await get(path)).status,303,path+' needs a sign-in');
 const signed=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:base},body:new URLSearchParams(credentials)}),headers={Cookie:signed.headers.get('set-cookie').split(';')[0]};
 // Nothing published yet.
 assert.equal((await get('/firmware/board-programs.json',headers)).status,503);assert.equal((await get('/firmware/receiver.app.bin',headers)).status,404);
 time+=6*60*1000;const first=publish('0.4.43',app);
 assert.deepEqual(await (await get('/firmware/board-programs.json',headers)).json(),validPrograms(first));
 const got=await get('/firmware/receiver.app.bin',headers);assert.equal(got.status,200);assert.equal(got.headers.get('content-type'),'application/octet-stream');assert.deepEqual(Buffer.from(await got.arrayBuffer()),app);
 // Fetched from the release once, not for every page.
 asked.length=0;await get('/firmware/receiver.app.bin',headers);await get('/firmware/board-programs.json',headers);assert.deepEqual(asked,[]);
 // Only files the list names; nothing else on the release or on the site's own disk.
 for(const name of ['Hands-Free-Screen-Control-Windows.zip','board-programs.json.bin','..%2fcloud-server.mjs','unknown.bin','RECEIVER.APP.BIN'])assert.equal((await get('/firmware/'+name,headers)).status,404,name);
 // A file that is not what the list says is not handed on.
 published.set('receiver.bootloader.bin',Buffer.from('not the bootloader'));assert.equal((await get('/firmware/receiver.bootloader.bin',headers)).status,404);
 // A new version: the list changes after five minutes, and its files are fetched afresh.
 const newer=randomBytes(6000);publish('0.4.44',newer);
 assert.equal((await (await get('/firmware/board-programs.json',headers)).json()).version,'0.4.43');
 time+=6*60*1000;assert.equal((await (await get('/firmware/board-programs.json',headers)).json()).version,'0.4.44');
 assert.deepEqual(Buffer.from(await (await get('/firmware/receiver.app.bin',headers)).arrayBuffer()),newer);
 // The release cannot be reached: the last good list stays on offer.
 published.clear();time+=6*60*1000;assert.equal((await (await get('/firmware/board-programs.json',headers)).json()).version,'0.4.44');
 assert.deepEqual(Buffer.from(await (await get('/firmware/receiver.app.bin',headers)).arrayBuffer()),newer);
 // The page and the flashing tool it uses.
 for(const [path,type] of [['/boards','text/html; charset=utf-8'],['/boards.mjs','text/javascript'],['/boards.css','text/css'],['/board-usb.mjs','text/javascript'],['/vendor/esptool/index.js','text/javascript'],['/vendor/esptool/pako.esm.mjs','text/javascript'],['/vendor/esptool/targets/esp32.js','text/javascript'],['/vendor/esptool/targets/stub_flasher/esp32.json','application/json']]){
  const page=await get(path,headers);assert.equal(page.status,200,path);assert.equal(page.headers.get('content-type'),type,path);
 }
 for(const path of ['/vendor/esptool/../../cloud-server.mjs','/vendor/esptool/%2e%2e/%2e%2e/hub.mjs','/vendor/esptool/a/b/c/d.js','/vendor/esptool/README.txt'])assert.equal((await get(path,headers)).status,404,path);
});
test('the flashing tool kept with the site is whole: every file it imports is there',()=>{
 const root=new URL('../public/vendor/esptool/',import.meta.url);
 const seen=new Set(),queue=['index.js'];
 while(queue.length){
  const name=queue.pop();if(seen.has(name))continue;seen.add(name);
  const text=fs.readFileSync(new URL(name,root),'utf8');if(!name.endsWith('.js'))continue;
  for(const found of text.matchAll(/(?:from\s+|import\s*\(\s*)"([^"]+)"/g)){
   if(found[1]==='w3c-web-serial')continue;   // named in a comment only
   assert.match(found[1],/^\.\.?\//,name+' imports '+found[1]+', which a browser cannot find');
   queue.push(new URL(found[1],new URL(name,'http://x/')).pathname.slice(1));
  }
 }
 assert.ok(seen.has('esploader.js')&&seen.has('pako.esm.mjs')&&seen.has('webserial.js')&&seen.has('targets/stub_flasher/esp32.json'));
 for(const licence of ['LICENSE-esptool-js.txt','LICENSE-pako.txt','README.txt'])assert.ok(fs.statSync(new URL(licence,root)).size>200,licence);
});
