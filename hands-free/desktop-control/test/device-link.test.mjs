import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDeviceLink} from '../device-link.mjs';
import {createCloudServer} from '../../website/cloud-server.mjs';
import {createHub} from '../../website/hub.mjs';

const seed=JSON.parse(fs.readFileSync(new URL('../../website/fan-signals.json',import.meta.url),'utf8'));
const credentials={username:'link-test',password:'link-test-password-of-32-characters'};
async function site(t){
 const hub=createHub({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'hands-free-link-')),seed,timing:{collect:150,confirm:150,poll:400,gap:30,learn:400,online:400}}),server=createCloudServer({...credentials,hub});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const signed=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:base},body:new URLSearchParams(credentials)}),cookie=signed.headers.get('set-cookie').split(';')[0];
 const page=(route,method='GET',body)=>fetch(base+route,{method,headers:{Cookie:cookie,Origin:base,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {base,page,server};
}
function memory(initial=null){let value=initial;const writes=[];return {read:async()=>value,write:async v=>{value=v;writes.push(v);},writes,get value(){return value;}};}

test('the app refuses a website address that is not https',()=>{
 assert.throws(()=>createDeviceLink({site:'http://example.com',fetch,store:memory()}),/https/);
 assert.doesNotThrow(()=>createDeviceLink({site:'https://control.example',fetch,store:memory()}));
});
test('an app that is not linked says so and asks nothing of the website',async()=>{
 let asked=0;const link=createDeviceLink({site:'https://control.example',fetch:async()=>{asked++;throw Error('no');},store:memory()});
 const result=await link.call('get');assert.equal(result.unlinked,true);assert.equal(result.ok,false);assert.equal(asked,0);
 assert.equal((await link.call('format-disk')).ok,false);assert.equal((await link.call('constructor')).ok,false);
 const unreachable=await link.call('link');assert.equal(unreachable.ok,false);assert.match(unreachable.message,/could not be reached/);
});
test('linked by code, the app lists the devices, sends a button and sets up a device',async t=>{
 const {base,page}=await site(t),store=memory(),link=createDeviceLink({site:base,fetch,store,hostname:'Bedroom-PC'});
 assert.equal((await link.call('link-status')).expired,true);
 const started=await link.call('link');assert.equal(started.ok,true);assert.match(started.code,/^\d{6}$/);assert.equal('secret' in started,false,'the page never sees the pairing secret');
 assert.deepEqual(await link.call('link-status'),{ok:true,linked:false});
 assert.equal((await page('/api/pair/approve','POST',{code:started.code})).status,200);
 const done=await link.call('link-status');assert.equal(done.linked,true);assert.equal(done.name,'Bedroom-PC');assert.equal('token' in done,false,'or the key');
 assert.equal(store.value.length,43);
 const state=await link.call('get');assert.equal(state.ok,true);assert.equal(state.appliances[0].name,'Fan');assert.equal(state.transmitter.linked,false);
 const nothing=await link.call('send',{button_id:state.appliances[0].buttons[0].id});assert.equal(nothing.status,503);assert.match(nothing.message,/No command was sent/);
 const added=await link.call('add',{name:'Lamp',kind:'light'});assert.equal(added.ok,true);
 assert.equal((await link.call('learn',{applianceId:added.appliance.id,label:'On'})).status,409,'recording needs the receiver board');
 assert.equal((await link.call('stop')).ok,true);
 // A new start of the app finds its key again.
 const again=createDeviceLink({site:base,fetch,store});assert.equal((await again.call('get')).appliances.length,2);
 // Removed on the website: the key is dropped and the app says it is not linked.
 const view=await (await page('/api/hub')).json();await page('/api/devices/'+view.devices[0].id,'DELETE');
 const refused=await again.call('get');assert.equal(refused.unlinked,true);assert.equal(store.value,null);
});
test('what the page passes on is cut to size, and the key goes only to the site it came from',async()=>{
 const seen=[],store=memory('k'.repeat(43));
 const link=createDeviceLink({site:'https://control.example',store,fetch:async(url,options)=>{seen.push({url,options});return {ok:true,status:200,json:async()=>({message:'ok'})};}});
 await link.call('add',{name:'x'.repeat(500),kind:{bad:true}});await link.call('send',{button_id:'b_1',confirm:'yes',extra:'ignored'});
 const add=JSON.parse(seen[0].options.body);assert.equal(add.name.length,32);assert.equal(add.kind,'');
 const send=JSON.parse(seen[1].options.body);assert.deepEqual(Object.keys(send).sort(),['button_id','created_at','request_id']);assert.match(send.request_id,/^[a-f0-9]{32}$/);
 // A held button: `hold` is passed on only as true, beside a confirmation only as true.
 await link.call('send',{button_id:'b_1',hold:true});await link.call('send',{button_id:'b_1',hold:'yes',confirm:true});
 assert.deepEqual(Object.keys(JSON.parse(seen[2].options.body)).sort(),['button_id','created_at','hold','request_id']);assert.equal(JSON.parse(seen[2].options.body).hold,true);
 assert.deepEqual(Object.keys(JSON.parse(seen[3].options.body)).sort(),['button_id','confirm','created_at','request_id']);
 for(const request of seen){assert.ok(request.url.startsWith('https://control.example/'));assert.equal(request.options.headers.Authorization,'Bearer '+'k'.repeat(43));}
 // A saved value that is not a key is ignored.
 const odd=createDeviceLink({site:'https://control.example',store:memory('not a key'),fetch:async()=>{throw Error('unused');}});assert.equal((await odd.call('get')).unlinked,true);
});
// 0.4.41. The first try at linking the real app failed: every look at the devices made a new code
// and dropped the one before, and the app only waited for a code while its screen was showing.
test('the link code stays the same until it is used, and a code typed while the app looked elsewhere is taken up',async t=>{
 const {base,page}=await site(t),store=memory(),link=createDeviceLink({site:base,fetch,store});
 const first=await link.call('link'),second=await link.call('link');
 assert.equal(second.code,first.code,'the same code on a second visit');assert.equal(first.page,base+'/setup#link='+first.code);
 assert.equal((await link.call('get')).unlinked,true,'not linked yet');
 // Typed on the website while the app shows something else. The next thing asked finds the key.
 assert.equal((await page('/api/pair/approve','POST',{code:first.code})).status,200);
 const state=await link.call('get');assert.equal(state.ok,true);assert.equal(state.appliances[0].name,'Fan');assert.equal(store.value.length,43);
 // Asked for a code again, a linked app says it is linked and makes none.
 const after=await link.call('link');assert.equal(after.linked,true);assert.equal('code' in after,false);
 assert.equal((await link.call('link-status')).linked,true);
});
test('two questions at once about the code do not lose the key',async t=>{
 const {base,page}=await site(t),store=memory(),link=createDeviceLink({site:base,fetch,store});
 const started=await link.call('link');await page('/api/pair/approve','POST',{code:started.code});
 const answers=await Promise.all([link.call('link-status'),link.call('link-status'),link.call('link'),link.call('get')]);
 assert.equal(answers[0].linked,true);assert.equal(answers[1].linked,true);assert.equal(answers[2].linked,true);assert.equal(answers[3].ok,true);
 assert.equal(store.writes.length,1);
});
test('a code that has ended is replaced, and one that is running survives a website that cannot be reached',async()=>{
 let time=1000,calls=0,down=false;
 const fetchStub=async(url,options)=>{
  if(down)throw Error('offline');
  if(url.endsWith('/api/pair/start')){calls++;return {ok:true,status:200,json:async()=>({code:String(100000+calls),secret:'s'+calls,expires_in:600})};}
  return {ok:false,status:202,json:async()=>({status:'waiting'})};
 };
 const link=createDeviceLink({site:'https://control.example',fetch:fetchStub,store:memory(),now:()=>time});
 assert.equal((await link.call('link')).code,'100001');
 time+=5*60*1000;assert.equal((await link.call('link')).code,'100001','still the same after five minutes');
 time+=4.5*60*1000;assert.equal((await link.call('link')).code,'100002','a new one when under a minute is left');
 down=true;time+=60*1000;
 const kept=await link.call('link');assert.equal(kept.code,'100002');
 assert.equal((await link.call('link-status')).ok,false);assert.equal((await link.call('link')).code,'100002','an unreachable website does not end the code');
 time+=11*60*1000;assert.equal((await link.call('link')).ok,false);assert.equal((await link.call('link-status')).expired,true);
});
// 0.4.43: the app may do what the Setup page does for a device and its buttons.
test('a linked app renames, re-records and removes a device\'s buttons and the device, and nothing else',async t=>{
 const {base,page,server}=await site(t),link=createDeviceLink({site:base,fetch,store:memory()});
 const started=await link.call('link');await page('/api/pair/approve','POST',{code:started.code});
 const added=await link.call('add',{name:'Lamp',kind:'light'});assert.equal(added.ok,true);const id=added.appliance.id;
 assert.equal((await link.call('rename-device',{id,name:'Desk lamp'})).ok,true);assert.equal((await link.call('careful',{id,careful:true})).ok,true);
 let lamp=(await link.call('get')).appliances.find(a=>a.id===id);assert.deepEqual([lamp.name,lamp.careful],['Desk lamp',true]);
 const fan=(await link.call('get')).appliances[0],power=fan.buttons[0];
 assert.equal((await link.call('rename-button',{id:power.id,label:'On and off'})).ok,true);
 assert.equal((await link.call('get')).appliances[0].buttons[0].label,'On and off');
 // Recording again names the button to replace; with no receiver linked the website says so.
 const again=await link.call('learn',{applianceId:fan.id,label:'On and off',icon:'power',replace:power.id});assert.equal(again.ok,false);assert.match(again.message,/Link the receiver board first/);
 assert.equal((await link.call('remove-button',{id:power.id})).ok,true);assert.equal((await link.call('get')).appliances[0].buttons.length,6);
 assert.equal((await link.call('remove-device',{id})).ok,true);assert.equal((await link.call('get')).appliances.length,1);
 // An id is part of the address the app asks for: anything that does not look like one is not sent.
 for(const bad of ['../devices/d_000000000000','a_123','d_0123456789ab','a_0123456789ab/../../pair/approve','',null,undefined]){
  const refused=await link.call('remove-device',{id:bad});assert.equal(refused.ok,false,String(bad));assert.equal(refused.status,0);
 }
 assert.equal((await link.call('remove-button',{id:'b_ffffffffffff'})).status,404);
 // Ready-made buttons for a TV whose remote cannot be recorded: all of them with one request.
 const made=await link.call('add',{name:'TV',kind:'tv'});assert.equal(made.ok,true);
 assert.deepEqual((await link.call('get')).ready,[{id:'samsung-tv',name:'Samsung TV',kind:'tv',buttons:18}]);
 const ready=await link.call('ready',{id:made.appliance.id,set:'samsung-tv'});
 assert.equal(ready.ok,true);assert.equal(ready.added.length,18);assert.match(ready.message,/^18 buttons for a Samsung TV were added to TV\./);
 assert.equal((await link.call('get')).appliances.find(a=>a.id===made.appliance.id).buttons.length,18);
 assert.equal((await link.call('ready',{id:made.appliance.id,set:'toaster'})).status,400);
 for(const bad of ['a_123','../a_0123456789ab',undefined])assert.equal((await link.call('ready',{id:bad,set:'samsung-tv'})).status,0,String(bad));
 assert.equal(server.hub.view().devices.length,1,'the app itself is still linked');
});
