import test from 'node:test';import assert from 'node:assert/strict';import {EyeSelector} from '../public/eye-selection.mjs';
const feature=value=>({value,x:0.5,y:0.5,scale:0.3});
function ready(){const s=new EyeSelector();s.calibrate({center:Array.from({length:25},()=>feature(.5)),left:Array.from({length:25},()=>feature(.3)),right:Array.from({length:25},()=>feature(.7))});return s;}
function feed(s,value,start,end){const events=[];for(let t=start;t<=end;t+=50){const e=s.update(value===null?null:feature(value),t);if(e)events.push(e);}return events;}
test('no selection before calibration or neutral rearming',()=>{assert.equal(new EyeSelector().update(feature(.7),0),null);assert.deepEqual(feed(ready(),.7,0,1500),[]);});
test('held glance triggers once; center required before repeat',()=>{const s=ready();feed(s,.5,0,500);assert.deepEqual(feed(s,.7,550,2500),['right']);feed(s,.5,2550,3100);assert.deepEqual(feed(s,.3,3150,4000),['left']);});
test('eye loss cancels pending gesture',()=>{const s=ready();feed(s,.5,0,500);feed(s,.3,550,900);s.update(null,950);assert.deepEqual(feed(s,.3,1000,2000),[]);});
test('stale frames and head shift disarm',()=>{const s=ready();feed(s,.5,0,500);assert.equal(s.update(feature(.7),1000),null);assert.deepEqual(feed(s,.7,1050,2000),[]);feed(s,.5,2050,2600);s.update({...feature(.7),x:.8},2650);assert.deepEqual(feed(s,.7,2700,3600),[]);});
test('indistinguishable calibration rejected',()=>{assert.throws(()=>new EyeSelector().calibrate({center:Array(25).fill(feature(.5)),left:Array(25).fill(feature(.51)),right:Array(25).fill(feature(.49))}));});
