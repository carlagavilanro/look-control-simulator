import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';

test('real gateway rejects uncaptured TV actions and forwards loaded TV/fan actions once',async()=>{
 let names=['captured_power'],forwarded=[];
 const espToken=randomBytes(24).toString('hex'),uiToken=randomBytes(24).toString('hex');
 const mock=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/status'){res.end(JSON.stringify({practice:true,commands:names}));return;}
  assert.equal(req.headers['x-control-token'],espToken);
  let body='';for await(const c of req)body+=c;
  forwarded.push(Object.fromEntries(new URLSearchParams(body)));res.end('{"message":"Mock IR acknowledgement"}');
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'icontrol-gateway-'));const config=path.join(folder,'config.json');
 fs.writeFileSync(config,JSON.stringify({port,host:'127.0.0.1',espUrl:'http://127.0.0.1:'+mock.address().port,uiToken,espToken}));
 const child=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],{env:{...process.env,CONTROL_CONFIG:config},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Gateway exited before listening');}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Gateway startup timeout')),5000);t.unref();})]);
  const base='http://127.0.0.1:'+port;
  const send=(command,id=randomBytes(16).toString('hex'),token=uiToken)=>fetch(base+'/api/command',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({command,request_id:id,created_at:Date.now()})});
  assert.equal((await send('tv_power')).status,409);assert.equal(forwarded.length,0);
  names.push('tv_power');
  const status=await fetch(base+'/api/status',{headers:{Authorization:'Bearer '+uiToken}});assert.deepEqual((await status.json()).commands,names);
  const id=randomBytes(16).toString('hex');assert.equal((await send('tv_power',id)).status,200);
  assert.equal(forwarded.length,1);assert.equal(forwarded[0].command,'tv_power');
  assert.equal((await send('tv_power',id)).status,409);assert.equal(forwarded.length,1);
  assert.equal((await send('heater_power')).status,400);
  assert.equal((await send('tv_power',undefined,'wrong')).status,401);
  await new Promise(r=>setTimeout(r,820));assert.equal((await send('captured_power')).status,200);assert.equal(forwarded.length,2);
  assert.equal(forwarded[1].command,'captured_power');
 }finally{
  const ended=once(child,'exit');child.kill();await ended;
  await new Promise(r=>mock.close(r));fs.unlinkSync(config);fs.rmdirSync(folder);
 }
});
