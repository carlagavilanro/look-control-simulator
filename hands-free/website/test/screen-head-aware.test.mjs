import test from 'node:test';
import assert from 'node:assert/strict';
import {screenFeature,withOpenings,calibrationTargets,CHECK_TARGETS,ALIGN_TARGETS,MOVE_TARGETS,MOVED_ENOUGH,fitCalibration,fitHeadAware,fitAlignment,validateCalibration,validModel,predictDetailed,summarize,movedRows,headRange} from '../public/screen-gaze.mjs';

import {person} from './support/moving-head.mjs';
const drifted={x:.01,y:0,scale:0,roll:.03,yaw:.02,pitch:-.01};
const leaves=value=>value&&typeof value==='object'?Object.values(value).flatMap(leaves):[value];

test('head-movement frames make the map use head position, and it then holds up when the posture drifts',()=>{
 const p=person(3),train=calibrationTargets(true).map(t=>p.held(t)),moved=MOVE_TARGETS.map(t=>p.moving(t));
 const plain=fitCalibration(train),aware=fitCalibration(train,{moved});
 assert.equal(plain.headTerms,undefined);
 assert.ok(aware.headTerms);assert.ok(validModel(aware));
 assert.equal(aware.headStep.used,true);assert.equal(aware.headStep.withMovement,true);assert.equal(aware.headStep.dots,3);
 // Judged on frames it was not fitted to: clearly better while the head moves, not worse with the head still.
 assert.ok(aware.headStep.movingMoved<=aware.headStep.plainMoved*.85);
 assert.ok(aware.headStep.movingScore<=aware.headStep.plainScore*1.03+.001);
 const check=CHECK_TARGETS.map(t=>p.held(t,drifted));
 const before=validateCalibration(check,plain,1920,1032),after=validateCalibration(check,aware,1920,1032);
 assert.ok(after.meanPixels<before.meanPixels*.6,`${before.meanPixels} px -> ${after.meanPixels} px`);
 assert.ok(after.passed);
});

test('without head-movement frames the map does not use head position',()=>{
 const p=person(4),train=calibrationTargets(true).map(t=>p.held(t));
 for(const m of [fitCalibration(train),fitCalibration(train,{moved:[]}),fitCalibration(train,{moved:[p.moving(MOVE_TARGETS[0])]})]){
  assert.equal(m.headTerms,undefined);assert.equal(m.headStep.used,false);assert.equal(m.headStep.dots,0);assert.ok(validModel(m));
 }
});

test('a head that stayed still during the step leaves no usable dots',()=>{
 const p=person(5),still=MOVE_TARGETS.map(t=>p.moving(t,{size:0})),moved=MOVE_TARGETS.map(t=>p.moving(t));
 assert.ok(Math.max(...headRange(still[0].samples))<MOVED_ENOUGH);
 assert.ok(Math.max(...headRange(moved[0].samples))>MOVED_ENOUGH);
 assert.equal(movedRows(still).length,0);assert.equal(movedRows(moved).length,3);
 // Too few clear frames, or frames without all head readings, do not count either.
 assert.equal(movedRows([{target:[.5,.4],samples:moved[0].samples.slice(0,30)}]).length,0);
 assert.equal(movedRows([{target:[.5,.4],samples:moved[0].samples.map(({yaw,...f})=>f)}]).length,0);
 const m=fitCalibration(calibrationTargets(true).map(t=>p.held(t)),{moved:still});
 assert.equal(m.headTerms,undefined);assert.equal(m.headStep.dots,0);
});

test('eyes that leave the dot during the step make its frames unusable, and the plain map stays',()=>{
 const p=person(6),train=calibrationTargets(true).map(t=>p.held(t)),moved=MOVE_TARGETS.map(t=>p.moving(t,{wander:.25}));
 const m=fitCalibration(train,{moved});
 assert.equal(m.headStep.dots,3);assert.equal(m.headStep.unclear,true);assert.equal(m.headStep.used,false);assert.equal(m.headTerms,undefined);
});

test('the head part reads each head reading only within the span it was fitted on',()=>{
 const p=person(7),train=calibrationTargets(true).map(t=>p.held(t)),moved=MOVE_TARGETS.map(t=>p.moving(t));
 const m=fitCalibration(train,{moved}),t=m.headTerms,scale=t.indices.indexOf(2),f=train[0].samples[0];
 assert.ok(t.limits.every(([lo,hi])=>lo<hi));
 const at=value=>predictDetailed({...f,scale:value},m).raw;
 const edge=at(t.limits[scale][1]),beyond=at(t.limits[scale][1]*1.5),inside=at((t.limits[scale][0]+t.limits[scale][1])/2);
 assert.deepEqual(beyond,edge);
 assert.ok(Math.hypot(edge.x-inside.x,edge.y-inside.y)>0);
});

test('a head-aware map holds only numbers and true/false, and malformed head parts are refused',()=>{
 const p=person(8),train=calibrationTargets(true).map(t=>p.held(t)),moved=MOVE_TARGETS.map(t=>p.moving(t));
 const m=fitCalibration(train,{moved});
 // The companion saves numbers and true/false only.
 assert.ok(leaves(m).every(v=>typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'));
 assert.ok(validModel(JSON.parse(JSON.stringify(m))));
 const t=m.headTerms;
 for(const bad of [{...t,indices:[0,0,2,3,4,5]},{...t,weights:[t.weights[0]]},{...t,weights:[t.weights[0],t.weights[1].map(()=>9)]},{...t,reference:t.reference.slice(1)},{...t,limits:t.limits.map(([lo,hi])=>[hi,lo])},{...t,indices:[0,1,2]}])
  assert.equal(validModel({...m,headTerms:bad}),false);
});

test('a five-dot realignment of a head-aware map stays valid and keeps the head part unless the map is rebuilt',()=>{
 const p=person(9),train=calibrationTargets(true).map(t=>p.held(t)),moved=MOVE_TARGETS.map(t=>p.moving(t));
 const m=fitCalibration(train,{moved}),aligned=fitAlignment(ALIGN_TARGETS.map(t=>p.held(t,{...p.zero,x:.006,yaw:.01})),m);
 assert.ok(validModel(aligned));
 if(aligned.alignment.rebuilt)assert.equal(aligned.headTerms,undefined);else assert.deepEqual(aligned.headTerms,m.headTerms);
});

test('head-movement frames in which the eyes were briefly elsewhere are dropped from the fit',()=>{
 const p=person(10),groups=calibrationTargets(true).map(t=>p.held(t)),rows=groups.map(g=>({target:g.target,feature:summarize(g.samples),samples:g.samples}));
 const clean=MOVE_TARGETS.map(t=>p.moving(t));
 // One frame in eight is replaced by a frame in which the person looked a third of the screen away.
 const glances=clean.map(g=>({target:g.target,samples:g.samples.map((f,i)=>i%8===3?p.moving([g.target[0]+.33,g.target[1]-.2],{frames:1}).samples[0]:f)}));
 const a=fitHeadAware(rows,2,.5,.02,.02,movedRows(clean)),b=fitHeadAware(rows,2,.5,.02,.02,movedRows(glances));
 assert.ok(validModel(a));assert.ok(validModel(b));
 const check=CHECK_TARGETS.map(t=>p.held(t,drifted));
 const ea=validateCalibration(check,a,1920,1032).meanPixels,eb=validateCalibration(check,b,1920,1032).meanPixels;
 assert.ok(Math.abs(ea-eb)<=12,`${ea} px with clean frames, ${eb} px with glances away`);
});

test('a reading carries how far each eye is open, for saved diagnostics',()=>{
 const p=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
 function eye(a,b,iris,top,bottom,x,open){p[a]={x:x-.07,y:.4};p[b]={x:x+.07,y:.4};p[iris]={x,y:.4};p[top]={x,y:.4-open/2};p[bottom]={x,y:.4+open/2};for(let i=1;i<=4;i++){const t=(i-1)*Math.PI/2;p[iris+i]={x:x+Math.cos(t)*.018,y:.4+Math.sin(t)*.024};}}
 eye(33,133,468,159,145,.27,.04);eye(362,263,473,386,374,.62,.05);p[1]={x:.45,y:.6};
 const quality={},f=withOpenings(screenFeature(p,4/3,720,quality),quality);
 assert.ok(f);
 // Lid to lid over corner to corner: .04 and .05 of the picture's height over .14 of its width (4:3).
 assert.ok(Math.abs(f.lo-.04/(.14*4/3))<.002);assert.ok(Math.abs(f.ro-.05/(.14*4/3))<.002);
 // One eye not read (a reflection): no openings are attached, and the reading is left as it was.
 const other={openings:[.3]},g={h:.5};assert.equal(withOpenings(g,other),g);assert.equal(g.lo,undefined);
 assert.equal(withOpenings(null,quality),null);
});

// ---- 0.4.29: what counts as head movement, and how far the head is from its calibration pose ----
import {headOffsets,headReach,headRejections,MOVED_AWAY,MOVED_FAR} from '../public/screen-gaze.mjs';
test('head offsets are signed, in units of the pause limits, and agree with the rejections',()=>{
 const head={x:.4,y:.6,scale:.3,roll:0,yaw:.55,pitch:.5},at=(change)=>({h:.5,v:0,lh:.5,lv:0,rh:.5,rv:0,...head,...change});
 const o=headOffsets(at({y:.6+.05*.5,pitch:.5-.07}),head);
 assert.ok(o.y>0&&o.y<1&&Math.abs(o.pitch+1)<1e-9&&o.x===0&&o.roll===0&&o.yaw===0);
 assert.ok(Math.abs(headReach(at({yaw:.55+.035}),head)-.5)<1e-9);
 assert.deepEqual(headRejections(at({pitch:.5-.07}),{head}),['pitch']);assert.deepEqual(headRejections(at({pitch:.5-.06}),{head}),[]);
 assert.ok(Math.abs(headOffsets(at({scale:.3*1.09}),head).scale-.5)<1e-9);
 // A map calibrated without turn and nod readings has no limits for them.
 const plain={x:.4,y:.6,scale:.3,roll:0};assert.deepEqual(Object.keys(headOffsets(at({}),plain)),['x','y','scale','roll']);
 assert.equal(headOffsets(null,head),null);assert.equal(headOffsets(at({scale:0}),head),null);assert.equal(headReach(null,head),Infinity);
});
test('a head held still away from the calibration pose counts as movement; frames far outside it are left out',()=>{
 const head={x:.4,y:.6,scale:.3,roll:0,yaw:.55,pitch:.5};
 const frame=(change,i)=>({h:.5+.0005*Math.sin(i),v:.0003*Math.cos(i),lh:.51,lv:0,rh:.49,rv:0,...head,...Object.fromEntries(Object.entries(change).map(([k,v])=>[k,head[k]+v+.0004*Math.sin(i*1.7)]))});
 const dot=(change,n=60)=>({target:[.5,.4],samples:Array.from({length:n},(_,i)=>frame(change,i))});
 // Held still where the calibration was made: nothing to learn from.
 assert.equal(movedRows([dot({})],head).length,0);
 // Ordinary settling of the posture (a third of a limit) is not movement either.
 assert.equal(movedRows([dot({y:.05*.33,pitch:-.07*.3})],head).length,0);
 // Held still, clearly away: counts, with or without knowing the pose it is away from.
 const held=dot({yaw:.07*1.3,x:.05});assert.equal(movedRows([held]).length,0,'without the pose a still head shows nothing');
 const rows=movedRows([held],head);assert.equal(rows.length,1);assert.ok(rows[0].away>=MOVED_AWAY&&rows[0].far===0);
 // Half of the frames beyond twice the pause limit: those are dropped, the rest kept.
 const mixed={target:[.3,.62],samples:[...dot({yaw:.07*1.2},50).samples,...dot({yaw:.07*(MOVED_FAR+.5)},50).samples]};
 const kept=movedRows([mixed],head)[0];assert.equal(kept.samples.length,50);assert.equal(kept.far,50);
 // Everything out of reach: the dot is not used.
 assert.equal(movedRows([dot({pitch:.07*3})],head).length,0);
});
test('a head held away at each dot, as the first person did the step, is usable; poses far out of reach are not',()=>{
 const p=person(5),train=calibrationTargets(true).map(t=>p.held(t));
 // Three still poses, each about one pause limit from the calibration pose in a different way.
 const poses=[{...p.zero,y:.045,pitch:.06},{...p.zero,x:.04,yaw:.07},{...p.zero,x:-.035,yaw:-.06,roll:.1}];
 const moved=MOVE_TARGETS.map((t,i)=>p.held(t,poses[i],150));
 const aware=fitCalibration(train,{moved});
 assert.equal(aware.headStep.dots,3,'held poses count as head-movement dots');
 assert.ok(aware.headStep.away>=.75);assert.equal(aware.headStep.far,0);
 assert.equal(aware.headStep.used,true);assert.equal(aware.headStep.withMovement,true);
 // The check is made at one of those poses (the head did not come back), as recorded.
 const plain=fitCalibration(train),check=CHECK_TARGETS.map(t=>p.held(t,poses[0]));
 const before=validateCalibration(check,plain,1920,1032),after=validateCalibration(check,aware,1920,1032);
 assert.ok(after.meanPixels<before.meanPixels*.7,`${before.meanPixels} px -> ${after.meanPixels} px`);
 // Three times the pause limit away: nothing of it is used, and the plain map stays.
 const far=fitCalibration(train,{moved:MOVE_TARGETS.map((t,i)=>p.held(t,Object.fromEntries(Object.entries(poses[i]).map(([k,v])=>[k,v*3.2])),150))});
 assert.equal(far.headTerms,undefined);assert.equal(far.headStep.dots,0);
});
