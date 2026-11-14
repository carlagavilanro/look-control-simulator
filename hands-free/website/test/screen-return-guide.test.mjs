import test from 'node:test';
import assert from 'node:assert/strict';
import {screenHeadFeature,screenFeature,TRAIN_TARGETS,fitCalibration} from '../public/screen-gaze.mjs';
import {savedPositionReturnPlan,savedPositionFeedback,HeadReturnGuide} from '../public/screen-positions.mjs';
const head={x:.5,y:.45,scale:.3,roll:0,yaw:.5,pitch:.2};
const model=fitCalibration(TRAIN_TARGETS.map(target=>({target,samples:Array.from({length:32},()=>({...head,h:.25+.4*target[0],v:-.075+.15*target[1]}))})));
const entry=(id,x,passed=true)=>({id,model:{...model,head:{...head,x}},validation:{passed},savedAt:1});
const bank=[entry(1,.5),entry(2,.58),entry(3,.75,false)];
test('head location remains available when iris or eyelid measurements fail',()=>{
 const p=Array.from({length:478},()=>({x:.5,y:.5}));p[33]={x:.35,y:.4};p[263]={x:.65,y:.4};p[1]={x:.5,y:.48};
 assert.equal(screenFeature(p),null);
 const f=screenHeadFeature(p,4/3);assert.ok(f);assert.equal(f.x,.5);assert.equal(f.y,.48);assert.ok(Math.abs(f.scale-.4)<1e-12);
 assert.equal(screenHeadFeature(null),null);assert.equal(screenHeadFeature(p,NaN),null);p[263]=p[33];assert.equal(screenHeadFeature(p),null);
});
test('return targets exclude failed checks by default and never mutate saved maps',()=>{
 const before=JSON.stringify(bank),f={...head,x:.75};
 assert.equal(savedPositionReturnPlan(bank,{feature:f}).entry.id,2);
 assert.equal(savedPositionReturnPlan(bank,{feature:f,allowUnverified:true}).entry.id,3);
 assert.equal(savedPositionReturnPlan([bank[2]]),null);
 assert.equal(savedPositionReturnPlan(bank,{preferredId:2}).entry.id,2);
 assert.equal(JSON.stringify(bank),before);
});
test('brief glances do not open a guide, but leaving and returning offers a pinned measured pose',()=>{
 const g=new HeadReturnGuide();
 for(let t=0;t<=800;t+=100)assert.equal(g.update(null,bank,t,{reason:'eyes-unavailable'}).visible,false);
 assert.equal(g.update(head,bank,900,{reason:'usable',eyesReady:true,supported:true}).visible,false);
 let r;for(let t=1000;t<=2300;t+=100)r=g.update({...head,x:.72},bank,t,{reason:'head-position'});
 assert.equal(r.visible,true);assert.equal(r.plan.entry.id,2);
 r=g.update({...head,x:.48},bank,2400,{reason:'head-position'});assert.equal(r.plan.entry.id,2);
 assert.equal(r.complete,false);
});
test('matching requires fresh eyes, supported tracking and a sustained hold',()=>{
 const g=new HeadReturnGuide();g.update(head,bank,0,{force:true});
 for(let t=50;t<=1000;t+=50)assert.equal(g.update(head,bank,t,{eyesReady:false,supported:true}).complete,false);
 for(let t=1050;t<=2000;t+=50)assert.equal(g.update(head,bank,t,{eyesReady:true,supported:false}).complete,false);
 for(let t=2050;t<2800;t+=50)assert.equal(g.update(head,bank,t,{eyesReady:true,supported:true}).complete,false);
 assert.equal(g.update(head,bank,2800,{eyesReady:true,supported:true}).complete,true);
});
test('a stale camera gap cannot finish a partial return hold',()=>{
 const g=new HeadReturnGuide();g.update(head,bank,0,{force:true,eyesReady:true,supported:true});
 for(let t=50;t<=600;t+=50)g.update(head,bank,t,{eyesReady:true,supported:true});
 assert.equal(g.update(head,bank,1700,{eyesReady:true,supported:true}).complete,false);
 assert.equal(g.update(null,bank,1750,{reason:'eyes-unavailable'}).ready,false);
});
test('return guidance covers direction, distance and rotation without relaxing the saved maps',()=>{
 const plan=savedPositionReturnPlan(bank,{targetId:1});
 for(const [field,value,hint] of [['x',.3,/left/],['y',.3,/lower/],['scale',.2,/closer/],['yaw',.3,/left/],['pitch',0,/Lower your chin/],['roll',-.2,/left/]]){
  const f={...head,[field]:value},feedback=savedPositionFeedback(f,plan);assert.equal(feedback.ready,false);assert.match(feedback.message,hint);
 }
 assert.equal(savedPositionFeedback(head,plan).ready,true);
 assert.equal(savedPositionFeedback({...head,scale:NaN},plan).ready,false);
});
test('another-position choice and dismissal preserve validation and avoid immediate reopening',()=>{
 const g=new HeadReturnGuide(),before=JSON.stringify(bank);g.update(head,bank,0,{force:true});
 assert.equal(g.next(bank,head,100).entry.id,2);assert.equal(g.next(bank,head,200).entry.id,1);
 g.dismiss(300);assert.equal(g.update({...head,x:.9},bank,500,{reason:'head-position'}).visible,false);
 assert.equal(g.update(head,bank,600,{force:true}).visible,true);
 assert.equal(JSON.stringify(bank),before);
});
