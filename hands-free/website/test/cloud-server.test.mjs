import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCloudServer} from '../cloud-server.mjs';

const credentials={username:'test-user',password:'test-only-password-32-characters-long'};
test('cloud mode refuses to start without a strong login password',()=>{
 assert.throws(()=>createCloudServer({username:'test',password:''}),/SITE_PASSWORD/);
});
test('cloud sign-in protects the app and model, sends nothing without a transmitter, and supports logout',async t=>{
 const server=createCloudServer(credentials);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const get=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
 assert.equal((await get('/healthz')).status,200);
 for(const path of ['/','/app.mjs','/vendor/face_landmarker.task']){
  const response=await get(path);assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/login');
 }
 assert.equal((await get('/api/status')).status,401);
 const body=new URLSearchParams(credentials);
 assert.equal((await get('/login',{method:'POST',body,headers:{Origin:'https://foreign.example'}})).status,403);
 assert.equal((await get('/login',{method:'POST',body:new URLSearchParams({...credentials,password:'wrong'}),headers:{Origin:base}})).status,401);
 const signed=await get('/login',{method:'POST',body,headers:{Origin:base}});
 assert.equal(signed.status,303);const setCookie=signed.headers.get('set-cookie');
 for(const attr of ['HttpOnly','Secure','SameSite=Strict'])assert.ok(setCookie.includes(attr));
 const headers={Cookie:setCookie.split(';')[0]};
 const page=await get('/',{headers});assert.equal(page.status,200);assert.match(await page.text(),/cloud-mode.mjs/);
 // The site's pages may be framed by the site itself (Screen control shows them to be used by eye), by nobody else.
 assert.equal(page.headers.get('x-frame-options'),'SAMEORIGIN');assert.equal((await get('/screen-site.mjs')).status,303);assert.equal((await get('/screen-site.mjs',{headers})).status,200);
 assert.equal((await get('/vendor/profile-store.mjs',{headers})).status,200);
 assert.equal((await get('/vendor/face_landmarker.task',{headers})).status,200);
 const state=await (await get('/api/hub',{headers})).json();assert.equal(state.transmitter.linked,false);assert.equal(state.transmitter.online,false);
 assert.deepEqual(state.appliances.map(a=>[a.name,a.buttons.length]),[['Fan',7]]);
 const send=body=>get('/api/send',{method:'POST',headers:{...headers,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const command=await send({button_id:state.appliances[0].buttons[0].id,request_id:'0123456789abcdef0123456789abcdef',created_at:Date.now()});
 assert.equal(command.status,503);assert.match((await command.json()).message,/No transmitter board is linked yet\. No command was sent/);
 assert.equal((await send({})).status,400);
 for(const old of ['/api/status','/api/command'])assert.equal((await get(old,{headers})).status,404);
 assert.equal((await get('/config.local.json',{headers})).status,404);
 assert.equal((await get('/logout',{method:'POST',headers:{...headers,Origin:base}})).status,303);
 assert.equal((await get('/api/status',{headers})).status,401);
});
test('repeated invalid sign-ins are rate limited',async t=>{
 const server=createCloudServer(credentials);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 for(let i=0;i<10;i++)assert.equal((await fetch(base+'/login',{method:'POST',headers:{Origin:base},body:'username=wrong&password=wrong'})).status,401);
 assert.equal((await fetch(base+'/login',{method:'POST',headers:{Origin:base},body:'username=wrong&password=wrong'})).status,429);
});

// Every update of the website restarts it. Sign-ins used to live in memory only, so each update
// signed everybody out (four times on the afternoon the first boards were set up).
test('with storage attached a sign-in survives a restart; the file holds no cookie; signing out ends it for good',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'hands-free-sessions-'));
 const start=async()=>{const server=createCloudServer({...credentials,dataDir,persistent:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,base:`http://127.0.0.1:${server.address().port}`};};
 const stop=server=>{server.closeAllConnections();return new Promise(r=>server.close(r));};
 const hub=(base,cookie)=>fetch(base+'/api/hub',{headers:{Cookie:cookie}}).then(r=>r.status);
 let {server,base}=await start();
 const signed=await fetch(base+'/login',{method:'POST',redirect:'manual',body:new URLSearchParams(credentials),headers:{Origin:base}});assert.equal(signed.status,303);
 const cookie=signed.headers.get('set-cookie').split(';')[0],value=cookie.split('=')[1];
 assert.equal(await hub(base,cookie),200);
 const file=path.join(dataDir,'sessions.json'),kept=fs.readFileSync(file,'utf8'),hash=Object.keys(JSON.parse(kept))[0];
 assert.equal(Object.keys(JSON.parse(kept)).length,1);assert.equal(kept.includes(value),false,'the cookie itself is not written');assert.match(hash,/^[a-f0-9]{64}$/);
 if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);
 await stop(server);({server,base}=await start());
 assert.equal(await hub(base,cookie),200,'still signed in after the restart');
 assert.equal(await hub(base,'look_session='+hash),401,'what is in the file is not a way in');
 assert.equal(await hub(base,'look_session='+'0'.repeat(64)),401);
 assert.equal((await fetch(base+'/logout',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:base}})).status,303);
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{});
 await stop(server);({server,base}=await start());t.after(()=>stop(server));
 assert.equal(await hub(base,cookie),401,'signed out stays signed out');
});
test('sign-ins: nothing is written without storage, and a stale or damaged file is ignored',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'hands-free-sessions-'));
 const servers=[];t.after(()=>{for(const server of servers){server.closeAllConnections();server.close();}});
 const start=async options=>{const server=createCloudServer({...credentials,...options});servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;};
 const signIn=async base=>(await fetch(base+'/login',{method:'POST',redirect:'manual',body:new URLSearchParams(credentials),headers:{Origin:base}})).headers.get('set-cookie').split(';')[0];
 // Storage not attached (a folder is given, but it does not last): memory only.
 let base=await start({dataDir,persistent:false});const cookie=await signIn(base);
 assert.equal((await fetch(base+'/api/hub',{headers:{Cookie:cookie}})).status,200);assert.equal(fs.existsSync(path.join(dataDir,'sessions.json')),false);
 // An ended sign-in, a made-up key and a value that is not a time are all left out; a damaged file starts empty.
 const ended='a'.repeat(64),live='b'.repeat(64);
 fs.writeFileSync(path.join(dataDir,'sessions.json'),JSON.stringify({[ended]:Date.now()-1000,'not-a-hash':Date.now()+60000,[live]:'tomorrow'}));
 base=await start({dataDir,persistent:true});
 for(const value of [ended,live])assert.equal((await fetch(base+'/api/hub',{headers:{Cookie:'look_session='+value}})).status,401);
 const fresh=await signIn(base);assert.equal((await fetch(base+'/api/hub',{headers:{Cookie:fresh}})).status,200);
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dataDir,'sessions.json'),'utf8'))).length,1,'only the live sign-in is kept');
 fs.writeFileSync(path.join(dataDir,'sessions.json'),'{not json');
 base=await start({dataDir,persistent:true});assert.equal((await fetch(base+'/api/hub',{headers:{Cookie:fresh}})).status,401);
 assert.equal((await fetch(base+'/api/hub',{headers:{Cookie:await signIn(base)}})).status,200);
});
