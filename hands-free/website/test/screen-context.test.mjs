import test from 'node:test';
import assert from 'node:assert/strict';
import {contextTarget} from '../public/screen-gaze.mjs';

const button=(left,top,width=200,height=100)=>({left,top,right:left+width,bottom:top+height,width,height});
const targets=[button(100,100),button(320,100)];
const at=(x,y)=>({x:x/1000,y:y/800});
const choose=(x,y,rects=targets)=>contextTarget(at(x,y),at(x,y),rects,1000,800);

test('known button bounds support a close miss and leave distant blank space alone',()=>{
 assert.equal(choose(200,150),0);
 assert.equal(choose(304,150),0);
 assert.equal(choose(600,500),-1);
 assert.equal(choose(200,150,[null,targets[1]]),-1);
});

test('a gap between equally plausible controls remains unresolved',()=>{
 assert.equal(choose(310,150),-1);
 assert.equal(choose(312,150,[button(100,100),button(326,100)]),-1);
 assert.equal(contextTarget(at(310,150),at(310,150),targets,1000,800,{x:200,y:200}),-1);
 assert.equal(choose(304,150,[...targets,button(300,135,30,30)]),-1);
});

test('raw and filtered gaze must support the same nearby action',()=>{
 assert.equal(contextTarget(at(200,150),at(420,150),targets,1000,800),-1);
 assert.equal(contextTarget(null,at(200,150),targets,1000,800),-1);
 assert.equal(contextTarget(at(200,150),{x:NaN,y:0},targets,1000,800),-1);
 assert.equal(contextTarget(at(590,500),at(590,500),targets,1000,800,{x:1000,y:1000}),-1);
});
