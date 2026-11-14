import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudServer} from '../cloud-server.mjs';

const credentials={username:'test-user',password:'test-only-password-32-characters-long'};
test('cloud mode refuses to start without a strong login password',()=>{
 assert.throws(()=>createCloudServer({username:'test',password:''}),/SITE_PASSWORD/);
});
test('cloud sign-in protects the app and model, rejects commands, and supports logout',async t=>{
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
 assert.equal((await get('/vendor/profile-store.mjs',{headers})).status,200);
 assert.equal((await get('/vendor/face_landmarker.task',{headers})).status,200);
 const state=await (await get('/api/status',{headers})).json();assert.equal(state.online,false);
 const command=await get('/api/command',{method:'POST',headers,body:'{}'});assert.equal(command.status,503);assert.match((await command.json()).message,/No command was sent/);
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
