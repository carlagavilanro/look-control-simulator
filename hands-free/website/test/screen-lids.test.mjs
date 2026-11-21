// The eyelid input: how far the eyes are open, read beside the two iris readings (0.4.30).
import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrationTargets,CHECK_TARGETS,ALIGN_TARGETS,REFINE_TARGETS,MOVE_TARGETS,fitCalibration,fitJoint,fitAlignment,fitRefinement,validateCalibration,validModel,predictDetailed,lidOpening,withOpenings,summarize,movedRows,LID_SPAN,LID_ADVANTAGE,LID_PAIRS} from '../public/screen-gaze.mjs';
import {person} from './support/moving-head.mjs';

// As in the recorded sessions: the iris reading of up and down scatters by about a tenth of what it
// changes over the height of the screen; the lid opening changes more than twice as much.
const weak={lids:true,irisNoise:.005};
const leaves=value=>value&&typeof value==='object'?Object.values(value).flatMap(leaves):[value];
const rowsOf=groups=>groups.map(g=>({target:g.target,feature:summarize(g.samples),samples:g.samples}));
const without=g=>({...g,samples:g.samples.map(({lo,ro,...rest})=>rest)});

test('the lid opening is the average of both eyes, and missing when either is',()=>{
 assert.ok(Math.abs(lidOpening({lo:.3,ro:.32})-.31)<1e-12);
 for(const f of [null,{},{lo:.3},{lo:.3,ro:NaN},{lo:0,ro:.3},{lo:'x',ro:.3}])assert.ok(Number.isNaN(lidOpening(f)));
});

test('with a weak up/down iris reading the map takes the lid opening in, and reads up and down better',()=>{
 const p=person(11,weak),train=calibrationTargets(true).map(t=>p.held(t));
 const plain=fitCalibration(train.map(without)),lids=fitCalibration(train);
 assert.equal(plain.lidTerms,undefined);assert.equal(plain.lidStep.unavailable,true);assert.equal(plain.lidStep.used,false);
 assert.ok(lids.lidTerms,'used');assert.ok(validModel(lids));
 assert.equal(lids.lidStep.used,true);assert.ok(lids.lidStep.score<=lids.lidStep.withoutScore*LID_ADVANTAGE);assert.ok(lids.lidStep.better>=.55);
 // Looking down closes the lids: a wider opening moves the estimate up.
 assert.ok(lids.lidTerms.weights[1]<0);
 const check=CHECK_TARGETS.map(t=>p.held(t));
 const before=validateCalibration(check.map(without),plain,1920,1032),after=validateCalibration(check,lids,1920,1032);
 assert.ok(after.meanPixels<before.meanPixels*.8,`${before.meanPixels} px -> ${after.meanPixels} px`);
 assert.ok(after.radiusY<before.radiusY*.75,`up/down reach ${Math.round(before.radiusY*1032)} px -> ${Math.round(after.radiusY*1032)} px`);
 assert.ok(after.jitterY<before.jitterY,'steadier while a dot is held, too');
});

test('lids that do not follow the gaze are not used',()=>{
 // They scatter but do not move with the eye: the opening hardly differs between the dots.
 const still=person(12,{...weak,lidFollows:false}),a=fitCalibration(calibrationTargets(true).map(t=>still.held(t)));
 assert.equal(a.lidTerms,undefined);assert.equal(a.lidStep.used,false);
 assert.throws(()=>fitJoint(rowsOf(calibrationTargets(true).map(t=>still.held(t))),2,.5,.02,{lid:{lambda:.02}}),/hardly move/);
 // An iris reading that is already exact gains nothing from them, and the simpler map stays.
 const exact=person(13,{lids:true,irisNoise:.0003,lidNoise:.02}),b=fitCalibration(calibrationTargets(true).map(t=>exact.held(t)));
 assert.equal(b.lidTerms,undefined);assert.equal(b.lidStep.used,false);assert.ok(Number.isFinite(b.lidStep.score));
});

test('a frame without a lid reading is still answered, and half-shut lids cannot carry the estimate away',()=>{
 const p=person(14,weak),train=calibrationTargets(true).map(t=>p.held(t)),m=fitCalibration(train);assert.ok(m.lidTerms);
 const f=p.held([.5,.5]).samples[0],at=change=>predictDetailed({...f,...change},m).raw;
 const usual=at({lo:m.lidTerms.reference,ro:m.lidTerms.reference}),none=at({lo:undefined,ro:undefined});
 assert.ok(Math.hypot(usual.x-none.x,usual.y-none.y)<1e-9,'no reading: as if the lids were where they usually are');
 // A blink on its way: the opening falls far below anything seen at the dots.
 const [low,high]=m.lidTerms.limits,edge=at({lo:low,ro:low}),blink=at({lo:.15,ro:.15}),shut=at({lo:.05,ro:.05});
 assert.ok(.15<low&&low<high);
 assert.ok(Math.abs(blink.y-edge.y)<1e-9&&Math.abs(shut.y-edge.y)<1e-9,'held at the lowest opening the map knows');
 assert.ok(edge.y>usual.y&&edge.y-usual.y<.6,'that is a look at the bottom of the screen, not beyond');
 const wide=at({lo:.6,ro:.6}),top=at({lo:high,ro:high});assert.ok(Math.abs(wide.y-top.y)<1e-9);
});

test('blinks during calibration do not bend the map',()=>{
 const p=person(15,weak),clean=calibrationTargets(true).map(t=>p.held(t));
 // In every dot a few frames have the lids half shut (and the iris reading pushed down with them).
 const blinking=clean.map(g=>({...g,samples:g.samples.map((f,i)=>i%11===5?{...f,lo:f.lo-.11,ro:f.ro-.11}:f)}));
 const a=fitJoint(rowsOf(clean),2,.5,.02,{lid:{lambda:.02}}),b=fitJoint(rowsOf(blinking),2,.5,.02,{lid:{lambda:.02}});
 assert.ok(Math.abs(a.lidTerms.weights[1]-b.lidTerms.weights[1])<.03,`${a.lidTerms.weights[1]} against ${b.lidTerms.weights[1]}`);
 const check=CHECK_TARGETS.map(t=>p.held(t));
 assert.ok(validateCalibration(check,b,1920,1032).meanPixels<=validateCalibration(check,a,1920,1032).meanPixels+6);
});

test('a map with the lid input holds only numbers and true/false, and malformed lid parts are refused',()=>{
 const p=person(16,weak),m=fitCalibration(calibrationTargets(true).map(t=>p.held(t)));assert.ok(m.lidTerms);
 assert.ok(leaves(m).every(v=>typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'),'numbers and true/false only');
 const copy=JSON.parse(JSON.stringify(m));assert.ok(validModel(copy));
 const f=p.held([.3,.7]).samples[3];assert.deepEqual(predictDetailed(f,copy).raw,predictDetailed(f,m).raw);
 for(const bad of [{reference:NaN},{scale:0},{scale:-1},{limits:[.3,.2]},{limits:[.2]},{limits:null},{weights:[1]},{weights:[1,NaN]},{weights:[9,0]},{weights:'x'}])
  assert.equal(validModel({...copy,lidTerms:{...copy.lidTerms,...bad}}),false,JSON.stringify(bad));
 // Maps saved before 0.4.30 have no lid part and stay valid.
 const old={...copy};delete old.lidTerms;delete old.lidStep;delete old.lidLambda;assert.ok(validModel(old));
});

test('a five-dot realignment of such a map stays valid and keeps the lid part unless the map is rebuilt',()=>{
 const p=person(17,weak),m=fitCalibration(calibrationTargets(true).map(t=>p.held(t)));assert.ok(m.lidTerms);
 const moved={...p.zero,x:.01,y:.008},aligned=fitAlignment(ALIGN_TARGETS.map(t=>p.held(t,moved)),m);
 assert.ok(validModel(aligned));
 if(aligned.alignment?.rebuilt)assert.equal(aligned.lidTerms,undefined);else assert.deepEqual(aligned.lidTerms,m.lidTerms);
 // The five dots are summarised before they are compared with the map. The summary must carry the
 // lid openings, or the alignment would be measured against a map without its lid part and then
 // applied to frames that have it (the up/down scale would come out wrong).
 assert.ok(Number.isFinite(summarize(p.held([.5,.5]).samples).lo)&&Number.isFinite(summarize(p.held([.5,.5]).samples).ro));
 const check=CHECK_TARGETS.map(t=>p.held(t,moved)),before=validateCalibration(check,m,1920,1032),after=validateCalibration(check,aligned,1920,1032);
 assert.ok(after.meanPixels<=before.meanPixels+8,`${before.meanPixels} px -> ${after.meanPixels} px after aligning`);
 const rebuilt=fitAlignment(ALIGN_TARGETS.map(t=>p.held(t,moved)),m,{eyeOnly:true});
 assert.ok(validModel(rebuilt));assert.equal(rebuilt.lidTerms,undefined,'a map rebuilt from five dots has no lid part');
});

test('head position and lid opening can be read together',()=>{
 const p=person(18,weak),train=calibrationTargets(true).map(t=>p.held(t)),rows=rowsOf(train);
 const plain=fitJoint(rows,2,.5,.02,{}),extra=movedRows(MOVE_TARGETS.map(t=>p.moving(t)),plain.head);
 assert.equal(extra.length,3);
 const both=fitJoint(rows,2,.5,.02,{head:{lambda:.02,moved:extra},lid:{lambda:.02}});
 assert.ok(both.headTerms&&both.lidTerms);assert.ok(validModel(both));
 // The whole fit decides by itself; whatever it chooses must be a valid map that checks out.
 const chosen=fitCalibration(train,{moved:MOVE_TARGETS.map(t=>p.moving(t))});
 assert.ok(validModel(chosen));
 const drifted={x:.01,y:0,scale:0,roll:.03,yaw:.02,pitch:-.01},check=CHECK_TARGETS.map(t=>p.held(t,drifted));
 const base=validateCalibration(check.map(without),fitCalibration(train.map(without)),1920,1032),now=validateCalibration(check,chosen,1920,1032);
 assert.ok(now.meanPixels<base.meanPixels,`${base.meanPixels} px -> ${now.meanPixels} px`);
});

test('the opening must change between the top and the bottom dots to count',()=>{assert.ok(LID_SPAN>0&&LID_SPAN<.1);});

test('regional refinement of a map with the lid input keeps it and does not make it worse',()=>{
 const p=person(19,weak),m=fitCalibration(calibrationTargets(true).map(t=>p.held(t)));assert.ok(m.lidTerms);
 const refined=fitRefinement(REFINE_TARGETS.map(t=>p.held(t)),m);
 assert.ok(validModel(refined));assert.deepEqual(refined.lidTerms,m.lidTerms);
 const check=CHECK_TARGETS.map(t=>p.held(t)),before=validateCalibration(check,m,1920,1032),after=validateCalibration(check,refined,1920,1032);
 assert.ok(after.meanPixels<=before.meanPixels+8,`${before.meanPixels} px -> ${after.meanPixels} px after refining`);
});

test('the eyelid input can be switched off, and the map then reads the iris alone',()=>{
 const p=person(11,weak),train=calibrationTargets(true).map(t=>p.held(t));
 const on=fitCalibration(train),off=fitCalibration(train,{lids:false});
 assert.ok(on.lidTerms);assert.equal(off.lidTerms,undefined);assert.equal(off.lidStep.off,true);assert.equal(off.lidStep.used,false);
 assert.ok(validModel(off));
 // Off is the same map as for a tracker that reports no openings.
 const none=fitCalibration(train.map(without));assert.deepEqual(off.weights,none.weights);
});

// 0.4.31: a reflection over one eye. Only the other eye is read in such a frame, and until then
// the frame carried no lid reading at all; two dots with many such frames switched the input off.
const oneEyed=(g,share,keep='lo')=>({...g,samples:g.samples.map((f,i)=>{if(i%100>=share*100)return f;const {lo,ro,...rest}=f;return {...rest,[keep]:keep==='lo'?lo:ro};})});

test('with one eye hidden, the other eye\'s opening and the usual difference between the two give the same measure',()=>{
 // first minus second is usually -.02: .30 alone stands for .30 and .32.
 assert.ok(Math.abs(lidOpening({lo:.3},-.02)-.31)<1e-12);
 assert.ok(Math.abs(lidOpening({ro:.32},-.02)-.31)<1e-12);
 assert.ok(Math.abs(lidOpening({lo:.3,ro:.36},-.02)-.33)<1e-12,'both read: the usual difference is not used');
 for(const f of [null,{},{lo:0},{ro:NaN}])assert.ok(Number.isNaN(lidOpening(f,-.02)));
 assert.ok(Number.isNaN(lidOpening({lo:.3})),'not known without the usual difference');
});

test('a frame with one eye read carries that eye\'s opening',()=>{
 const both=withOpenings({h:.5},{openings:[.3,.32]});assert.equal(both.lo,.3);assert.equal(both.ro,.32);
 // `oneEye` names the eye under the reflection; the opening is the other one's.
 const first=withOpenings({h:.5},{openings:[.3],oneEye:'left'});assert.equal(first.lo,.3);assert.equal(first.ro,undefined);
 const second=withOpenings({h:.5},{openings:[.32],oneEye:'right'});assert.equal(second.ro,.32);assert.equal(second.lo,undefined);
 for(const q of [{openings:[.3]},{openings:[]},{openings:[NaN],oneEye:'left'},{}]){const f=withOpenings({h:.5},q);assert.equal(f.lo,undefined);assert.equal(f.ro,undefined);}
});

test('dots with a reflection over one eye in most frames no longer switch the eyelid input off',()=>{
 const p=person(21,weak),train=calibrationTargets(true).map(t=>p.held(t));
 // Two dots of the bottom row, as on 20 Nov: one eye hidden in two thirds of their frames.
 const bottom=train.map((g,i)=>[g,i]).filter(([g])=>g.target[1]>.9).slice(1,3).map(([,i])=>i);assert.equal(bottom.length,2);
 const glare=train.map((g,i)=>bottom.includes(i)?oneEyed(g,.67,i===bottom[0]?'lo':'ro'):g);
 const whole=fitCalibration(train),m=fitCalibration(glare);
 assert.ok(whole.lidTerms&&m.lidTerms,'used in both');assert.equal(m.lidStep.unavailable,undefined);assert.ok(validModel(m));
 // The usual difference is measured at the dots (the made-up person's second eye is .012 wider open).
 assert.ok(Math.abs(m.lidTerms.between+.012)<.003,`between ${m.lidTerms.between}`);
 for(const k of [0,1])assert.ok(Math.abs(m.lidTerms.weights[k]-whole.lidTerms.weights[k])<.03,'much the same map');
 // In use, a frame with one eye read is placed where the same frame with both eyes read is placed.
 const check=CHECK_TARGETS.map(t=>p.held(t)),full=validateCalibration(check,m,1920,1032);
 for(const keep of ['lo','ro']){
  const v=validateCalibration(check.map(g=>oneEyed(g,1,keep)),m,1920,1032);
  assert.ok(Math.abs(v.meanPixels-full.meanPixels)<=Math.max(8,full.meanPixels*.2),`${keep} alone: ${v.meanPixels} px against ${full.meanPixels} px`);
 }
 // Before, such a frame was answered as if the lids were at their usual opening: far off at the edges.
 const f=p.held([.5,.96]).samples[0],{ro,...first}=f,{lo,ro:_,...neither}=f;
 const at=x=>predictDetailed(x,m).raw.y;
 assert.ok(Math.abs(at(first)-at(f))<.04,'one eye: close to both');
 assert.ok(Math.abs(at(neither)-at(f))>.1,'neither: the old answer, well away from it');
});

test('the usual difference between the eyes needs enough frames with both, and a dot still needs its own readings',()=>{
 assert.ok(LID_PAIRS>=20);
 const p=person(22,weak),train=calibrationTargets(true).map(t=>p.held(t)),rows=g=>g.map(x=>({target:x.target,feature:summarize(x.samples),samples:x.samples}));
 // Every frame with one eye only: nothing to measure the difference from, so no lid part.
 assert.throws(()=>fitJoint(rows(train.map(g=>oneEyed(g,1))),2,.5,.02,{lid:{lambda:.02}}),/incomplete/);
 // One dot without any lid reading: still incomplete.
 const bare=train.map((g,i)=>i===3?{...g,samples:g.samples.map(({lo,ro,...rest})=>rest)}:g);
 assert.throws(()=>fitJoint(rows(bare),2,.5,.02,{lid:{lambda:.02}}),/incomplete/);
 assert.equal(fitCalibration(bare).lidStep.unavailable,true);
});

test('a dot\'s summary carries the openings its frames have',()=>{
 const p=person(23,weak),g=p.held([.5,.5]);
 const s=summarize(oneEyed(g,.2,'lo').samples);assert.ok(Number.isFinite(s.lo)&&Number.isFinite(s.ro));
 const half=summarize(oneEyed(g,1,'lo').samples);assert.ok(Number.isFinite(half.lo));assert.equal(half.ro,undefined);
 const none=summarize(g.samples.map(({lo,ro,...rest})=>rest));assert.equal(none.lo,undefined);assert.equal(none.ro,undefined);
});

test('a lid part with or without the usual difference is valid; a nonsensical one is refused',()=>{
 const p=person(24,weak),m=fitCalibration(calibrationTargets(true).map(t=>p.held(t)));assert.ok(m.lidTerms&&Number.isFinite(m.lidTerms.between));
 const {between,...older}=m.lidTerms;assert.ok(validModel({...m,lidTerms:older}),'a map saved by 0.4.30');
 for(const bad of [NaN,'x',.5,null])assert.equal(validModel({...m,lidTerms:{...m.lidTerms,between:bad}}),false,String(bad));
});
