import test from 'node:test';
import assert from 'node:assert/strict';
import {DwellSelector} from '../public/eye-selection.mjs';

function feed(s,start,end,center=true){const events=[];for(let t=start;t<=end;t+=50){const e=s.update(center,t);if(e!==null)events.push(e);}return events;}
test('exactly one second selects once, with no repeat or unarmed selection',()=>{
 const s=new DwellSelector();assert.deepEqual(feed(s,0,6000),[]);
 s.arm('fan');assert.deepEqual(feed(s,0,950),[]);assert.equal(s.update(true,1000),'fan');
 assert.deepEqual(feed(s,1050,12000),[]);
});
test('looking away restarts the entire one-second hold',()=>{
 const s=new DwellSelector();s.arm('fan');feed(s,0,500);s.update(false,4550);
 assert.equal(s.progress,0);assert.deepEqual(feed(s,4600,5550),[]);assert.equal(s.update(true,5600),'fan');
});
test('stalled frames cannot complete a hold',()=>{
 const s=new DwellSelector();s.arm('fan');feed(s,0,900);assert.equal(s.update(true,5500),null);
 assert.equal(s.progress,0);assert.deepEqual(feed(s,5550,6500),[]);assert.equal(s.update(true,6550),'fan');
});
test('changing targets and losing tracking discard elapsed hold time',()=>{
 const s=new DwellSelector();s.arm('fan');feed(s,0,900);s.arm('cancel');
 assert.deepEqual(feed(s,4950,5900),[]);assert.equal(s.update(true,5950),'cancel');
 s.arm('send');feed(s,10000,10500);s.clear();assert.deepEqual(feed(s,14550,20500),[]);
});

test('brief blink pauses near-complete hold and excludes every missing interval',()=>{
 const s=new DwellSelector();s.arm('send');feed(s,0,900);
 for(let t=950;t<=1200;t+=50)assert.equal(s.update(null,t),null);
 assert.equal(s.progress,.9);assert.equal(s.paused,true);
 assert.equal(s.update(true,1250),null);assert.equal(s.progress,.9);
 assert.equal(s.update(true,1300),null);assert.equal(s.update(true,1350),'send');
});

test('long tracking loss preserves target but requires a full new hold',()=>{
 const s=new DwellSelector();s.arm('send');feed(s,0,900);
 for(let t=4950;t<=7000;t+=50)assert.equal(s.update(null,t),null);
 assert.equal(s.target,'send');assert.equal(s.progress,0);
 assert.deepEqual(feed(s,7050,8000),[]);assert.equal(s.update(true,8050),'send');
});

test('brief loss cannot accumulate time while eyes stay unavailable',()=>{
 const s=new DwellSelector();s.arm('send');feed(s,0,500);
 for(let t=1050;t<=10000;t+=50)assert.equal(s.update(null,t),null);
 assert.equal(s.progress,0);assert.equal(s.target,'send');
});
