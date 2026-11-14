import test from 'node:test';import assert from 'node:assert/strict';
import {checkCommand,siteUrl,InputGate} from '../input-policy.mjs';
test('only bounded input commands and known key combinations are accepted',()=>{
 for(const p of [{type:'click',x:NaN,y:0},{type:'click',x:2,y:0},{type:'scroll',amount:100},{type:'key',key:'win+r'},{type:'text',text:'a\nb'},{type:'exec',cmd:'bad'}])assert.throws(()=>checkCommand(p));
 assert.deepEqual(checkCommand({type:'click',x:.2,y:.3,extra:'ignored'}),{type:'click',x:.2,y:.3});assert.equal(checkCommand({type:'text',text:'café 🌻'}).text,'café 🌻');
});
test('website launcher cannot accept arbitrary URLs or protocols',()=>{
 assert.equal(siteUrl('google','a & b'),'https://www.google.com/search?q=a%20%26%20b');assert.match(siteUrl('youtube','cats'),/^https:\/\/www.youtube.com/);assert.throws(()=>siteUrl('file:///test'));
});
test('typing and Enter can be one explicit command without permitting arbitrary keys',()=>{
 assert.deepEqual(checkCommand({type:'text',text:'video title',submit:true}),{type:'text',text:'video title',submit:true});
 assert.deepEqual(checkCommand({type:'text',text:'draft',submit:false}),{type:'text',text:'draft'});
 assert.throws(()=>checkCommand({type:'text',text:'draft',submit:'enter'}));
 assert.throws(()=>checkCommand({type:'text',text:'draft\n',submit:true}));
 assert.equal(siteUrl('youtube','cats & dogs / café'),'https://www.youtube.com/results?search_query=cats%20%26%20dogs%20%2F%20caf%C3%A9');
});
test('input requires explicit arming and fresh valid eyes; pause cancels a pending action',()=>{
 let now=1000;const g=new InputGate(()=>now);assert.throws(()=>g.begin());g.arm();assert.throws(()=>g.begin());g.heartbeat(true);const epoch=g.begin();assert.throws(()=>g.begin());g.pause();assert.throws(()=>g.recheck(epoch));g.finish();assert.throws(()=>g.begin());
 g.arm();g.heartbeat(true);now+=700;assert.throws(()=>g.begin());g.heartbeat(false);assert.throws(()=>g.begin());
});
test('rate limit and operation epoch prevent replay after disarm/rearm',()=>{
 let now=1000;const g=new InputGate(()=>now);g.arm();g.heartbeat(true);const e=g.begin();g.finish();assert.throws(()=>g.begin());now+=400;g.heartbeat(true);g.pause();g.arm();g.heartbeat(true);assert.throws(()=>g.recheck(e));
});
