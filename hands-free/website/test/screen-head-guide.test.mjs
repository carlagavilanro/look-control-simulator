import test from 'node:test';
import assert from 'node:assert/strict';
import {nextHeadPosition,headGuideFeedback} from '../public/screen-positions.mjs';

const reference={x:.5,y:.45,scale:.3,roll:0,yaw:.5,pitch:.3};
const entry=(id,head)=>({id,model:{head}});

test('head guide plans from the saved reference and responds to real saved coverage',()=>{
 assert.equal(nextHeadPosition([]),null);
 const entries=[entry(1,reference)],before=JSON.stringify(entries),first=nextHeadPosition(entries);
 assert.equal(first.id,'left');assert.ok(first.target.x>reference.x);
 assert.equal(headGuideFeedback(reference,first).ready,false);
 assert.equal(headGuideFeedback(first.target,first).ready,true);
 assert.equal(headGuideFeedback(null,first).ready,false);
 const second=nextHeadPosition([...entries,entry(2,first.target)]);
 assert.notEqual(second.id,first.id);
 assert.equal(JSON.stringify(entries),before);
});

test('fifteen guided samples cover translation, depth and both signs of all three rotations',()=>{
 const entries=[entry(1,reference)],plans=[];
 for(let i=2;i<=15;i++){
  const plan=nextHeadPosition(entries);assert.ok(plan);plans.push(plan);
  entries.push(entry(i,plan.target));
 }
 for(const axis of ['x','y','scale','roll','yaw','pitch']){
  assert.ok(plans.some(p=>p.target[axis]>reference[axis]));
  assert.ok(plans.some(p=>p.target[axis]<reference[axis]));
 }
 assert.ok(plans.every(p=>p.target.scale>0&&Math.abs(p.target.roll-reference.roll)<.12));
});

test('comfort controls skip suggestions and reduce movement without inventing absolute head angles',()=>{
 const entries=[entry(1,reference)],first=nextHeadPosition(entries);
 assert.notEqual(nextHeadPosition(entries,{skip:[first.id]}).id,first.id);
 const small=nextHeadPosition(entries,{span:.4});
 assert.ok(Math.abs(small.target.x-reference.x)<Math.abs(first.target.x-reference.x));
 const legacy=nextHeadPosition([entry(1,{x:.5,y:.45,scale:.3,roll:0})]);
 assert.ok(legacy);assert.equal(legacy.fields.includes('yaw'),false);
 assert.equal(headGuideFeedback({...legacy.target,scale:NaN},legacy).ready,false);
});
