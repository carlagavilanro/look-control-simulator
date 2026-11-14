import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {validateLibrary,addCapture,packRaw,writeLibrary,uploadLibrary} from '../tools/signal-tool.mjs';
const original=JSON.parse(fs.readFileSync(new URL('../signals/signals.json',import.meta.url),'utf8'));
const record={type:'capture',schema:1,overflow:false,repeat:false,protocol:'UNKNOWN',decoded_hex:'0x1234',bits:32,raw_us:[9000,4500,560]};

test('existing fan file preserves every captured timing from the previous firmware',()=>{
 validateLibrary(original);
 const hashes=JSON.parse(fs.readFileSync(new URL('./original-fan-fingerprints.json',import.meta.url),'utf8'));
 assert.equal(original.commands.length,7);assert.deepEqual(original.commands.map(c=>createHash('sha256').update(JSON.stringify(c.raw_us)).digest('hex')),hashes);
});
test('capture updates only named command, requires deliberate replacement, preserves raw unknown protocols',()=>{
 assert.throws(()=>addCapture(original,record,'captured_power',38),/already exists/);
 const updated=addCapture(original,record,'captured_power',38,true);
 assert.deepEqual(updated.commands.find(c=>c.name==='captured_power').raw_us,record.raw_us);
 assert.deepEqual(updated.commands.filter(c=>c.name!=='captured_power'),original.commands.filter(c=>c.name!=='captured_power'));
});
test('rejects overflow, repeat-only captures, malformed and excessive timing data',()=>{
 for(const r of [{...record,overflow:true},{...record,repeat:true},{...record,raw_us:[0,1,2]},{...record,raw_us:[500000,500000,1]},{...record,raw_us:[1.5,1,2]}])assert.throws(()=>addCapture(null,r,'test',38));
 assert.throws(()=>addCapture(null,record,'bad/name',38));assert.throws(()=>addCapture(null,record,'test',0));
 assert.throws(()=>validateLibrary({...original,commands:[original.commands[0],original.commands[0]]}));
});
test('long intervals are packed without losing duration or pulse polarity',()=>{
 const packed=packRaw([9000,150000,560]);assert.deepEqual(packed,[9000,65535,0,65535,0,18930,560]);
 assert.equal(packed.reduce((a,b)=>a+b,0),159560);assert.equal(packed.length%2,1);
});
test('disk update leaves an exact previous backup',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ir-file-test-'));try{
 const file=path.join(folder,'signals.json');writeLibrary(file,original);const updated=addCapture(original,record,'captured_power',38,true);writeLibrary(file,updated);
 assert.deepEqual(JSON.parse(fs.readFileSync(file)),updated);assert.deepEqual(JSON.parse(fs.readFileSync(file+'.bak')),original);
 }finally{for(const name of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,name));fs.rmdirSync(folder);}
});
test('upload verifies read-back and never sends an appliance command',async()=>{
 let stored='',commands=0;const token='test-token-at-least-24-characters';
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');
 if(req.url==='/api/status'){res.end(JSON.stringify({signalFileApi:1}));return;}
 if(req.url==='/api/command'){commands++;res.end('{}');return;}
 assert.equal(req.headers['x-control-token'],token);
 if(req.method==='PUT'){for await(const part of req)stored+=part;res.end(JSON.stringify({message:'Saved'}));}else res.end(stored);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const result=await uploadLibrary(new URL('../signals/signals.json',import.meta.url),{espUrl:'http://127.0.0.1:'+server.address().port,espToken:token});assert.match(result,/verified/);assert.equal(commands,0);assert.deepEqual(JSON.parse(stored),original);}
 finally{await new Promise(resolve=>server.close(resolve));}
});

// A failed read-back must never trigger another upload or an IR command.
test('read-back mismatch reports failure without automatic retry',async()=>{
 let puts=0;const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');
 if(req.url==='/api/status'){res.end('{"signalFileApi":1}');return;}
 if(req.method==='PUT'){puts++;for await(const part of req){}res.end('{"message":"Saved"}');return;}
 res.end('{}');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(uploadLibrary(new URL('../signals/signals.json',import.meta.url),{espUrl:'http://127.0.0.1:'+server.address().port,espToken:'test-token-at-least-24-characters'}),/does not match/);assert.equal(puts,1);}
 finally{await new Promise(resolve=>server.close(resolve));}
});
test('legacy firmware is detected before any file upload',async()=>{
 let writes=0;const server=http.createServer((req,res)=>{if(req.method!=='GET')writes++;res.setHeader('Content-Type','application/json');res.end('{"practice":true}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(uploadLibrary(new URL('../signals/signals.json',import.meta.url),{espUrl:'http://127.0.0.1:'+server.address().port,espToken:'test-token-at-least-24-characters'}),/firmware first/);assert.equal(writes,0);}
 finally{await new Promise(resolve=>server.close(resolve));}
});
