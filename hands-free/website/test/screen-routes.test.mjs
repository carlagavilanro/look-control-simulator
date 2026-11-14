import test from 'node:test';import assert from 'node:assert/strict';import {createCloudServer} from '../cloud-server.mjs';
test('screen control, model and companion download remain behind the existing cloud login',async t=>{
 const credentials={username:'route-test',password:'route-test-password-over-24-characters'};
 const s=createCloudServer(credentials);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close();});
 const base=`http://127.0.0.1:${s.address().port}`,get=(p,options={})=>fetch(base+p,{redirect:'manual',...options});
 const paths=['/screen','/screen-app.mjs','/screen-camera.mjs','/screen-eye-crop.mjs','/screen-typing.mjs','/vendor/english-words.json','/screen-gaze.mjs','/screen-positions.mjs','/screen-targets.mjs','/screen-worker.mjs','/screen.css','/downloads/Hands-Free-Screen-Control-Windows.zip'];
 for(const p of paths)assert.equal((await get(p)).status,303);
 const login=await get('/login',{method:'POST',headers:{Origin:base},body:new URLSearchParams(credentials)}),headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
 for(const p of paths){const r=await get(p,{headers,method:'HEAD'});assert.equal(r.status,200,p);if(p.endsWith('.zip')){assert.match(r.headers.get('content-type'),/zip/);assert.ok(Number(r.headers.get('content-length'))>1000000);}}
 assert.match(await (await get('/',{headers})).text(),/href="\/screen"/);
 for(const p of ['/desktop-control/native-input.ps1','/config.local.json','/screen/../main.mjs'])assert.equal((await get(p,{headers})).status,404);
});
