import test from 'node:test';
import assert from 'node:assert/strict';
import {HOLD,keepSending,heldMessage,pressAndHold} from '../public/screen-devices.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// A clock and a wait that pass no real time.
function clock(){let at=0;return {now:()=>at,wait:async ms=>{at+=ms;},pass:ms=>{at+=ms;}};}

test('a held button is asked for again after every answer, until it is let go',async()=>{
 const time=clock(),asked=[],seen=[];let held=true;
 const done=await keepSending({now:time.now,wait:time.wait,still:()=>held,each:(bursts,answer)=>seen.push([bursts,answer.milliseconds]),
  send:async()=>{asked.push(time.now());time.pass(1200);if(asked.length===3)held=false;return {ok:true,status:200,held:true,milliseconds:926};}});
 assert.deepEqual(asked,[0,1200,2400]);assert.deepEqual(seen,[[1,926],[2,926],[3,926]]);
 assert.deepEqual({bursts:done.bursts,ms:done.ms,reason:done.reason},{bursts:3,ms:3600,reason:'released'});
 assert.equal(heldMessage(done),'Held for 3.6 seconds. The device\'s response is not confirmed.');
});
test('nothing is sent when it was let go before the first request',async()=>{
 let asked=0;const done=await keepSending({still:()=>false,send:async()=>{asked++;return {ok:true};}});
 assert.equal(asked,0);assert.equal(done.reason,'released');assert.equal(heldMessage(done),'Nothing was sent.');
});
test('a hold ends by itself after twelve seconds',async()=>{
 const time=clock();let asked=0;
 const done=await keepSending({now:time.now,wait:time.wait,still:()=>true,send:async()=>{asked++;time.pass(1250);return {ok:true,status:200,held:true};}});
 assert.equal(HOLD.most,12000);assert.equal(asked,10);assert.equal(done.reason,'limit');assert.equal(done.ms,12500);
 assert.equal(heldMessage(done),'Stopped after 13 seconds. Press again to go on. The device\'s response is not confirmed.');
 assert.equal(heldMessage(done,'Look away, then look at it again to go on.'),'Stopped after 13 seconds. Look away, then look at it again to go on. The device\'s response is not confirmed.');
});
test('a request refused as too soon is asked again shortly; any other failure ends the hold',async()=>{
 const time=clock(),answers=[{ok:false,status:429,message:'Wait a moment'},{ok:false,status:429},{ok:true,status:200},{ok:false,status:503,message:'The transmitter board is offline. No command was sent.'}];
 const asked=[];const done=await keepSending({now:time.now,wait:time.wait,still:()=>true,send:async()=>{asked.push(time.now());return answers[asked.length-1];}});
 assert.deepEqual(asked,[0,150,300,300]);assert.equal(done.reason,'failed');assert.equal(done.bursts,1);
 assert.equal(heldMessage(done),'Stopped. The transmitter board is offline. No command was sent.');
 // Refused every time: it gives up, and says what the website said.
 let count=0;const stuck=await keepSending({now:time.now,wait:time.wait,still:()=>true,send:async()=>{count++;return {ok:false,status:429,message:'Wait a moment before the next command. No command was sent.'};}});
 assert.equal(count,HOLD.retries+1);assert.equal(stuck.reason,'failed');assert.equal(heldMessage(stuck),'Wait a moment before the next command. No command was sent.');
 assert.equal(heldMessage({bursts:0,reason:'failed',result:null}),'No answer. Check the device before trying again.');
 assert.equal(heldMessage({bursts:2,ms:2100,reason:'released',result:{ok:true,practice:true}}),'Held for 2.1 seconds. The transmitter is in practice mode: no infrared was sent.');
});

// A button and a window that take and give events as a page's do.
function page(){
 const button=new EventTarget(),view=new EventTarget();view.document=new EventTarget();
 const log=[],classes=new Set();button.classList={add:name=>classes.add(name)};
 const fire=(target,type,extra={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,extra);target.dispatchEvent(event);return event;};
 const release=pressAndHold(button,{view,after:30,press:()=>log.push('press'),start:()=>log.push('start'),stop:()=>log.push('stop')});
 return {button,view,log,classes,fire,release};
}
test('a short press is a press; a press kept down is a hold, and never also a press',async()=>{
 const {button,view,log,classes,fire}=page();
 assert.ok(classes.has('can-hold'));
 fire(button,'pointerdown');await pause(10);fire(view,'pointerup');fire(button,'click');
 assert.deepEqual(log,['press']);
 fire(button,'pointerdown');await pause(60);assert.deepEqual(log,['press','start']);
 fire(view,'pointerup');fire(button,'click');assert.deepEqual(log,['press','start','stop']);
 // The next click is a press again, however it is made.
 fire(button,'click');assert.deepEqual(log,['press','start','stop','press']);
});
test('a hold ends when the pointer leaves the button, is cancelled, or the page is left',async()=>{
 for(const end of [p=>p.fire(p.button,'pointerleave'),p=>p.fire(p.view,'pointercancel'),p=>p.fire(p.view,'blur'),p=>p.fire(p.view.document,'visibilitychange'),p=>p.release()]){
  const p=page();p.fire(p.button,'pointerdown');await pause(60);end(p);assert.deepEqual(p.log,['start','stop']);
  // Ended once: a second release changes nothing.
  p.fire(p.view,'pointerup');assert.deepEqual(p.log,['start','stop']);
 }
 // Leaving before it became a hold: neither a hold nor, without a click, a press.
 const p=page();p.fire(p.button,'pointerdown');await pause(10);p.fire(p.button,'pointerleave');await pause(60);assert.deepEqual(p.log,[]);
});
test('a hold that ended away from the button does not swallow a later press',async()=>{
 const p=page();p.fire(p.button,'pointerdown');await pause(60);p.fire(p.view,'pointerup');   // no click: released elsewhere
 await pause(200);p.fire(p.button,'click');assert.deepEqual(p.log,['start','stop','press']);
});
test('the right mouse button and a second finger do not hold; a long press asks for no menu',async()=>{
 const p=page();p.fire(p.button,'pointerdown',{button:2});await pause(60);assert.deepEqual(p.log,[]);
 p.fire(p.button,'pointerdown',{isPrimary:false});await pause(60);assert.deepEqual(p.log,[]);
 assert.equal(p.fire(p.button,'contextmenu').defaultPrevented,false);
 p.fire(p.button,'pointerdown');assert.equal(p.fire(p.button,'contextmenu').defaultPrevented,true);await pause(60);
 assert.equal(p.fire(p.button,'contextmenu').defaultPrevented,true);p.fire(p.view,'pointerup');
});
