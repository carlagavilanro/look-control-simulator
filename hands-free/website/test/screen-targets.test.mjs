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
