import test from 'node:test';
import assert from 'node:assert/strict';
import {DwellSelector} from '../public/eye-selection.mjs';

function feed(s,start,end,center=true){const events=[];for(let t=start;t<=end;t+=50){const e=s.update(center,t);if(e!==null)events.push(e);}return events;}
test('exactly five seconds selects once, with no repeat or unarmed selection',()=>{
 const s=new DwellSelector();assert.deepEqual(feed(s,0,6000),[]);
 s.arm('fan');assert.deepEqual(feed(s,0,4950),[]);assert.equal(s.update(true,5000),'fan');
 assert.deepEqual(feed(s,5050,12000),[]);
});
test('looking away restarts the entire five-second hold',()=>{
 const s=new DwellSelector();s.arm('fan');feed(s,0,4500);s.update(false,4550);
 assert.equal(s.progress,0);assert.deepEqual(feed(s,4600,9550),[]);assert.equal(s.update(true,9600),'fan');
});
test('stalled frames cannot complete a hold',()=>{
 const s=new DwellSelector();s.arm('fan');feed(s,0,4900);assert.equal(s.update(true,5500),null);
 assert.equal(s.progress,0);assert.deepEqual(feed(s,5550,10500),[]);assert.equal(s.update(true,10550),'fan');
});
test('changing targets and losing tracking discard elapsed hold time',()=>{
 const s=new DwellSelector();s.arm('fan');feed(s,0,4900);s.arm('cancel');
 assert.deepEqual(feed(s,4950,9900),[]);assert.equal(s.update(true,9950),'cancel');
 s.arm('send');feed(s,10000,14500);s.clear();assert.deepEqual(feed(s,14550,20500),[]);
});

test('brief blink pauses near-complete hold and excludes every missing interval',()=>{
 const s=new DwellSelector();s.arm('send');feed(s,0,4900);
 for(let t=4950;t<=5200;t+=50)assert.equal(s.update(null,t),null);
 assert.equal(s.progress,.98);assert.equal(s.paused,true);
 assert.equal(s.update(true,5250),null);assert.equal(s.progress,.98);
 assert.equal(s.update(true,5300),null);assert.equal(s.update(true,5350),'send');
});

test('long tracking loss preserves target but requires a full new hold',()=>{
 const s=new DwellSelector();s.arm('send');feed(s,0,4900);
 for(let t=4950;t<=7000;t+=50)assert.equal(s.update(null,t),null);
 assert.equal(s.target,'send');assert.equal(s.progress,0);
 assert.deepEqual(feed(s,7050,12000),[]);assert.equal(s.update(true,12050),'send');
});

test('brief loss cannot accumulate time while eyes stay unavailable',()=>{
 const s=new DwellSelector();s.arm('send');feed(s,0,1000);
 for(let t=1050;t<=10000;t+=50)assert.equal(s.update(null,t),null);
 assert.equal(s.progress,0);assert.equal(s.target,'send');
});
