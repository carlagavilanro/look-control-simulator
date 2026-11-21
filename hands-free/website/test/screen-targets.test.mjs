import test from 'node:test';import assert from 'node:assert/strict';
import {focusTarget,visibleFocusTargets} from '../public/screen-targets.mjs';
const target=(id,left,top,right,bottom)=>({id,label:id,rect:{left,top,right,bottom}});
const a=target('link',200,200,300,230),b=target('button',400,200,500,230);
test('a modest miss in blank space resolves to one nearby interactive item',()=>{
 assert.equal(focusTarget({x:.18,y:.215},{x:.19,y:.215},[a,b],1000,1000)?.id,'link');
 assert.equal(focusTarget({x:.05,y:.215},{x:.06,y:.215},[a,b],1000,1000),null);
});
test('ambiguous neighboring items, disabled controls and raw/display disagreement do not select',()=>{
 assert.equal(focusTarget({x:.35,y:.215},{x:.35,y:.215},[a,b],1000,1000),null);
 assert.equal(focusTarget({x:.25,y:.215},{x:.45,y:.215},[a,b],1000,1000),null);
 assert.equal(focusTarget({x:.25,y:.215},{x:.25,y:.215},[{...a,enabled:false}],1000,1000),null);
});
test('the page target set excludes controls hidden behind the companion and oversized containers',()=>{
 const all=[a,target('header',10,10,100,50),target('dock',10,900,100,950),target('container',0,100,1000,800),target('offscreen',-30,200,30,240)];
 assert.deepEqual(visibleFocusTargets(all,1000,1000).map(t=>t.id),['link']);
});
test('invalid and overlapping geometries cannot produce a target',()=>{
 assert.equal(focusTarget(null,{x:.2,y:.2},[a],1000,1000),null);
 assert.equal(focusTarget({x:.25,y:.215},{x:.25,y:.215},[a,{...a,id:'nested'}],1000,1000),null);
});

// ---- 0.4.28: crowded controls, screen edges, controls under the bars --------
import {focusChoice,coveredFocusTargets,controlNames,readingOrder,EDGE_BAND,CHOICES} from '../public/screen-targets.mjs';
const W=1920,H=1080,at=(x,y)=>({x:x/W,y:y/H}),ids=c=>c?.several?.map(t=>t.id);
// YouTube's top left corner in a maximised browser: menu button, logo, and the
// first entries of the side bar underneath.
const menu=target('menu',16,96,56,136),logo=target('logo',60,96,180,136),home=target('home',12,160,228,200),shorts=target('shorts',12,204,228,244),search=target('search',700,96,1200,136);
const corner=[menu,logo,home,shorts,search];
test('one control that is clearly the nearest is taken directly, anywhere on the screen',()=>{
 assert.equal(focusChoice(at(900,116),at(905,118),corner,W,H).target.id,'search');
 assert.equal(focusChoice(at(640,116),at(650,116),corner,W,H).target.id,'search','a modest miss in blank space');
 assert.equal(focusChoice(at(900,500),at(900,500),corner,W,H),null,'nothing near');
 assert.equal(focusChoice(null,at(900,116),corner,W,H),null);
});
test('controls too close together to tell apart are offered as a list, nearest first, instead of refused',()=>{
 const left=target('left',800,500,860,540),right=target('right',868,500,928,540),look=at(862,520);
 assert.equal(focusTarget(look,look,[left,right],W,H),null,'the direct rule still refuses');
 const c=focusChoice(at(866,520),at(866,520),[left,right],W,H);
 assert.deepEqual(ids(c),['right','left']);assert.deepEqual(c.rect,{left:800,top:500,right:928,bottom:540});
 assert.equal(focusChoice(at(900,520),at(900,520),[left,right],W,H).target.id,'right','a look well inside one of them still takes it');
});
test('a control being held gives way only to a rival that clearly leads it',()=>{
 const left=target('left',800,500,860,540),right=target('right',868,500,928,540),drift=at(866,520);
 assert.equal(focusChoice(drift,drift,[left,right],W,H,{held:'left'}).target.id,'left');
 assert.equal(focusChoice(at(900,520),at(900,520),[left,right],W,H,{held:'left'}).target.id,'right');
 assert.equal(focusChoice(drift,drift,[left,right],W,H,{held:'gone'}).several.length,2);
});
test('near a screen edge, a control further out than the nearest one is offered too',()=>{
 // The estimate stops short of the edge: looking at the menu button lands on the logo.
 const c=focusChoice(at(120,116),at(125,118),corner,W,H);
 assert.deepEqual(ids(c),['logo','menu','home'],'both, the one under the look first, then what else is near');
 // The same pair looked at from outside the edge band: the logo is simply the nearest.
 const wide=[target('menu',216,96,256,136),target('logo',260,96,380,136)];
 assert.equal(focusChoice(at(320,116),at(325,118),wide,W,H).target.id,'logo');
 assert.ok(320/W>EDGE_BAND);
});
test('a control reached only by the stretch out to the edge is listed, never opened directly',()=>{
 // Looking at a lone button in the corner, the estimate lands 130 px short of it.
 const lone=[target('account',1860,96,1900,136),search],c=focusChoice(at(1730,116),at(1735,120),lone,W,H);
 assert.equal(focusTarget(at(1730,116),at(1735,120),lone,W,H),null,'beyond the ordinary reach');
 assert.deepEqual(ids(c),['account']);assert.equal(c.target,undefined);
 // Outside the band the same miss catches nothing.
 assert.equal(focusChoice(at(1600,116),at(1600,120),lone,W,H),null);
 // And only along the line of sight to the edge: not a control far above or below.
 assert.equal(focusChoice(at(1730,400),at(1735,400),lone,W,H),null);
});
test('rows stacked along an edge are still taken directly',()=>{
 assert.equal(focusChoice(at(120,180),at(118,182),corner,W,H).target.id,'home');
 assert.equal(focusChoice(at(60,224),at(64,226),corner,W,H).target.id,'shorts');
});
test('in a corner the stretch runs to both edges',()=>{
 const tab=target('tab',8,90,200,126),below=[tab,target('back',16,130,56,170),target('reload',104,130,144,170)];
 // Estimate pulled towards the middle of the screen from the top left corner.
 const c=focusChoice(at(150,100),at(160,104),below,W,H);
 assert.equal(c.target.id,'tab','directly on the tab, nothing further out');
 const d=focusChoice(at(120,150),at(124,152),below,W,H);
 assert.deepEqual(ids(d).slice(0,2).sort(),['back','reload'],'between two buttons: a list');
 assert.ok(ids(d).includes('tab'),'the tab above them, towards the top edge, is offered too');
});
test('raw and displayed gaze must still agree, disabled controls are never listed, and a list has a limit',()=>{
 assert.equal(focusChoice(at(900,116),at(120,116),corner,W,H),null);
 const left=target('left',800,500,860,540),right={...target('right',868,500,928,540),enabled:false};
 assert.equal(focusChoice(at(866,520),at(866,520),[left,right],W,H).target.id,'left');
 const many=Array.from({length:14},(_,i)=>target('icon'+i,400+i*14,500,412+i*14,512)),c=focusChoice(at(490,506),at(490,506),many,W,H);
 assert.equal(c.several.length,CHOICES);assert.ok(ids(c).includes('icon6'));
});
test('a list on offer does not flicker with a single control at the boundary',()=>{
 const left=target('left',800,500,860,540),right=target('right',868,500,928,540);
 // Just clear enough for the right one to be taken on its own...
 const look=at(876,520);
 assert.equal(focusChoice(look,look,[left,right],W,H).target?.id,'right');
 // ...but not while the pair is already on offer.
 assert.equal(focusChoice(look,look,[left,right],W,H,{offered:true}).several?.length,2);
 assert.equal(focusChoice(at(905,520),at(905,520),[left,right],W,H,{offered:true}).target?.id,'right');
});
test('controls under the bars are kept apart from the ones that can be looked at',()=>{
 const bars={top:86,bottom:164,showing:.5};
 const all=[target('tab-2',300,8,500,40),target('reload',82,48,114,78),target('tab-1',90,8,290,40),target('new-tab',504,12,530,38),target('address',200,46,1500,80),target('peeking',240,60,400,100),target('mostly',40,60,200,150),
  menu,search,target('footer',20,1000,300,1040),target('page',0,90,1920,1000),target('off',-40,300,20,340),target('flush',-1,300,60,340)];
 assert.deepEqual(visibleFocusTargets(all,W,H,bars).map(t=>t.id),['mostly','menu','search','flush']);
 assert.deepEqual(coveredFocusTargets(all,W,H,bars).map(t=>t.id),['tab-1','tab-2','new-tab','reload','address','peeking','footer'],'top strip first, row by row, each row from left to right');
 // Without the option a control must be wholly clear of the bars, as before.
 assert.deepEqual(visibleFocusTargets(all,W,H,{top:86,bottom:164}).map(t=>t.id),['menu','search','flush']);
});
test('listed controls get names that tell them apart',()=>{
 assert.deepEqual(controlNames([{label:'Guide',kind:'Button'},{label:'',kind:'Button'},{label:'Search',kind:'Edit'},{label:'Comment',kind:'Edit'},{label:'',kind:'Edit'},{label:'More actions',kind:'Button'},{label:'More actions',kind:'Button'},{label:'  A   very long name that goes on and on and on  ',kind:'Hyperlink'},{kind:'TabItem'}]),
  ['Guide','Button','Search','Comment (text box)','Text box','More actions (1)','More actions (2)','A very long name that goes on and…','TabItem']);
});
test('a list is laid out as its controls lie on the screen',()=>{
 assert.deepEqual(readingOrder([home,logo,shorts,menu]).map(t=>t.id),['menu','logo','home','shorts']);
 // Tops a few pixels apart are one row; the input is left as it was.
 const uneven=[target('c',300,104,340,130),target('a',20,98,60,138),target('b',100,100,200,136)];
 assert.deepEqual(readingOrder(uneven).map(t=>t.id),['a','b','c']);assert.equal(uneven[0].id,'c');
});
