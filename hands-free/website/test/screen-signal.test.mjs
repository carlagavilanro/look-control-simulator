import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAIN_TARGETS,CHECK_TARGETS,ALIGN_TARGETS,fitCalibration,fitAlignment,validateCalibration,validModel,predict,signalFeature,readsIrisPixels,detailFeature,screenFeature,DETAIL_ADVANTAGE,checkOffset,applyCheckOffset,withOpenings} from '../public/screen-gaze.mjs';
import {BinocularAgreement} from '../public/screen-eye-crop.mjs';
import {noiseSource} from './support/synthetic-eyes.mjs';
// One frame with both iris readings of the same gaze. `plain` and `detail` are
// each reading's frame-to-frame noise; the camera-pixel reading may also sit at
// a different scale and offset, as it does in practice.
function frames(target,random,{plain=.004,detail=.0005,count=30,missing=0,stuck=false,moved=[0,0]}={}){
 return {target,samples:Array.from({length:count},(_,i)=>{
  // moved: every reading has shifted since calibration (posture, glasses).
  const h=.3+.3*target[0]+moved[0],v=-.06+.12*target[1]+moved[1],n=()=>random()*2,p=[n()*plain,n()*plain*.5,n()*plain,n()*plain*.5],d=[n()*detail,n()*detail*.5,n()*detail,n()*detail*.5];
  // stuck: the eye model's reading does not follow the gaze at all.
  const mh=stuck?.45:h,mv=stuck?0:v,f={lh:mh+.03+p[0],lv:mv+p[1],rh:mh-.03+p[2],rv:mv+p[3],x:.5,y:.45,scale:.3,roll:0};f.h=(f.lh+f.rh)/2;f.v=(f.lv+f.rv)/2;
  if(i>=missing){const a={lh:1.2*h+.05+d[0],lv:1.3*v+.01+d[1],rh:1.2*h-.02+d[2],rv:1.3*v+.01+d[3]};f.alt={...a,h:(a.lh+a.rh)/2,v:(a.lv+a.rv)/2};}
  return f;
 })};
}
const groups=(options,targets=TRAIN_TARGETS,seed=5)=>{const random=noiseSource(seed);return targets.map(t=>frames(t,random,options));};

test('calibration keeps the camera-pixel iris reading when it predicts held-out points better',()=>{
 const m=fitCalibration(groups({plain:.004,detail:.0005}));
 assert.equal(m.irisPixels,true);assert.ok(validModel(m));
 assert.ok(m.signalComparison.detail<=m.signalComparison.plain*DETAIL_ADVANTAGE);
 // The saved map then reads that signal from every later frame.
 const check=groups({plain:.004,detail:.0005},CHECK_TARGETS,9).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,m))}));
 const v=validateCalibration(check,m,1920,1080);assert.ok(v.passed);
 const plainOnly=fitCalibration(groups({plain:.004,detail:.0005}),{signal:'plain'});
 const plainCheck=validateCalibration(groups({plain:.004,detail:.0005},CHECK_TARGETS,9).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,plainOnly))})),plainOnly,1920,1080);
 assert.ok(v.meanPixels<plainCheck.meanPixels*.6,`${v.meanPixels} vs ${plainCheck.meanPixels}`);
});

test('calibration keeps the eye model reading when the camera-pixel one is no better or incomplete',()=>{
 const noisy=fitCalibration(groups({plain:.0008,detail:.004}));assert.equal(noisy.irisPixels,undefined);assert.ok(noisy.signalComparison.detail>noisy.signalComparison.plain);
 // The camera-pixel reading moves 1.2 to 1.3 times as far for the same gaze,
 // so this much noise makes the two about equally good: the simpler one stays.
 const equal=fitCalibration(groups({plain:.001,detail:.00125}));assert.equal(equal.irisPixels,undefined);
 // Too many frames without a camera-pixel reading: it is not considered at all.
 const sparse=fitCalibration(groups({plain:.002,detail:.0002,missing:6}));assert.equal(sparse.irisPixels,undefined);assert.equal(sparse.signalComparison,undefined);
 assert.throws(()=>fitCalibration(groups({missing:6}),{signal:'detail'}),/iris edge was not clear/);
 // Frames without the second reading at all behave exactly as before.
 const old=groups({}).map(g=>({...g,samples:g.samples.map(({alt,...f})=>f)}));
 assert.equal(fitCalibration(old).signal,undefined);
});

test('a map that could not be fitted from the eye model reading can still be fitted from camera pixels',()=>{
 assert.throws(()=>fitCalibration(groups({stuck:true}),{signal:'plain'}),/not distinct enough/);
 const m=fitCalibration(groups({stuck:true}));
 assert.equal(m.irisPixels,true);assert.equal(m.signalComparison,undefined);assert.ok(validModel(m));
 // With neither reading usable, the eye model's error is the one reported.
 const neither=groups({stuck:true}).map(g=>({...g,samples:g.samples.map(({alt,...f})=>f)}));
 assert.throws(()=>fitCalibration(neither),/not distinct enough/);
});

test('each frame gives a map the reading it was fitted to, or nothing',()=>{
 const f=frames([.5,.5],noiseSource(3)).samples[0];
 const d=signalFeature(f,{irisPixels:true});assert.equal(d.lh,f.alt.lh);assert.equal(d.h,f.alt.h);assert.equal(d.x,f.x);assert.equal(d.alt,undefined);
 const p=signalFeature(f,{});assert.equal(p.lh,f.lh);assert.equal(p.alt,undefined);
 const {alt,...bare}=f;assert.equal(signalFeature(bare,{signal:'detail'}),null);assert.equal(signalFeature(bare,null),bare);
 assert.equal(signalFeature(null,{signal:'detail'}),null);assert.equal(detailFeature({...f,alt:{...f.alt,lv:NaN}}),null);
 assert.equal(validModel({...fitCalibration(groups({})),signal:'other'}),false);
 // A saved map holds numbers and true/false only, so the choice is a flag.
 // The text form 0.4.18 wrote is still read.
 const chosen=fitCalibration(groups({plain:.004,detail:.0005}));
 assert.equal(chosen.irisPixels,true);assert.equal(chosen.signal,undefined);assert.ok(readsIrisPixels(chosen));
 const walk=v=>v===null||['number','boolean'].includes(typeof v)||(typeof v==='object'&&Object.values(v).every(walk));assert.ok(walk(chosen),'numbers and true/false only');
 const legacy={...chosen,signal:'detail'};delete legacy.irisPixels;
 assert.ok(validModel(legacy)&&readsIrisPixels(legacy));assert.equal(signalFeature(f,legacy).h,f.alt.h);
 assert.equal(readsIrisPixels(fitCalibration(groups({plain:.0008,detail:.004}))),false);assert.equal(validModel({...chosen,irisPixels:'yes'}),false);
});

test('realigning a camera-pixel map keeps reading camera pixels',()=>{
 const m=fitCalibration(groups({plain:.004,detail:.0005}));
 const align=groups({plain:.004,detail:.0005},ALIGN_TARGETS,11).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,m))}));
 for(const eyeOnly of [false,true]){const repaired=fitAlignment(align,m,{eyeOnly});assert.equal(repaired.irisPixels,true);assert.equal(repaired.signal,undefined);assert.ok(validModel(repaired));}
 const plain=fitCalibration(groups({plain:.0008,detail:.004}));
 const plainAlign=groups({plain:.0008,detail:.004},ALIGN_TARGETS,11).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,plain))}));
 assert.equal(fitAlignment(plainAlign,plain,{eyeOnly:true}).irisPixels,undefined);
});

// Face landmarks with both eyes looking the same way.
function face({lh=.5,rh=.44,lv=0,rv=0}={}){
 const p=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
 const eye=(a,b,iris,top,bottom,x0,x1,h,v)=>{
  const w=x1-x0;Object.assign(p[a],{x:x0,y:.4});Object.assign(p[b],{x:x1,y:.4});Object.assign(p[top],{x:(x0+x1)/2,y:.4-.18*w*16/9});Object.assign(p[bottom],{x:(x0+x1)/2,y:.4+.18*w*16/9});
  const cx=x0+h*w,cy=.4+v*w*16/9,r=.2*w;Object.assign(p[iris],{x:cx,y:cy});
  [[1,0],[0,-1],[-1,0],[0,1]].forEach(([dx,dy],k)=>Object.assign(p[iris+1+k],{x:cx+dx*r,y:cy+dy*r*16/9}));
 };
 eye(33,133,468,159,145,.40,.46,lh,lv);eye(362,263,473,386,374,.54,.60,rh,rv);Object.assign(p[1],{x:.5,y:.47});
 return p;
}
test('with a reflection over one iris, that eye is filled in from the other and the usual difference',()=>{
 const agreement=new BinocularAgreement();
 // Learn this person's usual difference between the eyes: .06 across, none up/down.
 for(let i=0;i<40;i++)assert.ok(screenFeature(face(),16/9,1080,{},agreement));
 const clear=screenFeature(face({lh:.56,rh:.50}),16/9,1080,{},agreement);
 // The right eye's landmarks are nonsense under a reflection; it is not read.
 const quality={},covered=screenFeature(face({lh:.56,rh:.9,rv:.3}),16/9,1080,quality,agreement,[true,false]);
 assert.ok(covered);assert.equal(quality.oneEye,'left');assert.equal(quality.reason,'usable');
 assert.ok(Math.abs(covered.h-clear.h)<.002&&Math.abs(covered.rh-clear.rh)<.004,`${covered.h} vs ${clear.h}`);
 const other={},mirrored=screenFeature(face({lh:.1,lv:-.3,rh:.50}),16/9,1080,other,agreement,[false,true]);
 assert.equal(other.oneEye,'right');assert.ok(Math.abs(mirrored.h-clear.h)<.002);
 // The eye that was read keeps its lid opening (0.4.31); the hidden eye has none.
 withOpenings(covered,quality);assert.ok(covered.lo>.2&&covered.lo<.5);assert.equal(covered.ro,undefined);
 withOpenings(mirrored,other);assert.ok(mirrored.ro>.2&&mirrored.ro<.5);assert.equal(mirrored.lo,undefined);
 const seen={},whole=withOpenings(screenFeature(face({lh:.56,rh:.50}),16/9,1080,seen,agreement),seen);assert.ok(Math.abs(whole.lo-covered.lo)<1e-9&&Math.abs(whole.ro-mirrored.ro)<1e-9);
 // Without the usual difference, or with both eyes covered, there is no reading.
 const fresh={};assert.equal(screenFeature(face(),16/9,1080,fresh,new BinocularAgreement(),[true,false]),null);assert.equal(fresh.reason,'glare');
 const both={};assert.equal(screenFeature(face(),16/9,1080,both,agreement,[false,false]),null);assert.equal(both.reason,'glare');
 // Unchanged when both eyes are trusted.
 assert.deepEqual(screenFeature(face(),16/9,1080,{},new BinocularAgreement()),screenFeature(face(),16/9,1080,{},new BinocularAgreement(),[true,true]));
});

// The seven checks of one accuracy check, as validateCalibration reports them.
const checks=(offsets,width=1920,height=1080)=>({meanPixels:120,p90Pixels:180,perTarget:offsets.map(([offsetX,offsetY],i)=>({x:CHECK_TARGETS[i][0],y:CHECK_TARGETS[i][1],offsetX,offsetY,estimatedFraction:1}))});
test('a shift shared by the accuracy checks is found per direction, and one odd check does not hide it',()=>{
 // Two real checks from the same person, with and without glasses.
 const glasses=checkOffset(checks([[143,-38],[118,123],[95,-118],[82,-71],[92,-157],[29,-47],[38,-11]]),1920,1080);
 assert.deepEqual(glasses.pixels,{x:92,y:0});assert.ok(Math.abs(glasses.shift[0]+92/1920)<1e-12);assert.equal(glasses.shift[1],0);
 const bare=checkOffset(checks([[-74,-71],[-7,87],[93,-129],[-39,-119],[63,-86],[-24,-89],[23,-43]]),1920,1080);
 assert.deepEqual(bare.pixels,{x:0,y:-86});assert.ok(Math.abs(bare.shift[1]-86/1080)<1e-12);
 // Offsets to both sides, or small ones, are not a shift.
 assert.equal(checkOffset(checks([[60,-50],[-70,40],[30,-60],[-40,70],[55,-35],[-65,45],[10,5]]),1920,1080),null);
 assert.equal(checkOffset(checks([[20,10],[22,12],[18,9],[21,11],[19,10],[20,12],[22,9]]),1920,1080),null);
 // Too few usable checks, or no screen size: no decision.
 const few=checks([[90,0],[92,0],[88,0],[91,0],[89,0],[90,0],[93,0]]);few.perTarget.slice(0,2).forEach(p=>p.estimatedFraction=.2);
 assert.equal(checkOffset(few,1920,1080),null);assert.equal(checkOffset(checks([[90,0]]),0,0),null);assert.equal(checkOffset(null,1920,1080),null);
});

test('a shared shift is corrected once, and a fresh check then measures the result',()=>{
 const m=fitCalibration(groups({plain:.0012,detail:.004}));
 // Since calibration everything reads a little higher and to the right.
 const later=seed=>groups({plain:.0012,detail:.004,moved:[.018,-.009]},CHECK_TARGETS,seed).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,m))}));
 const first=validateCalibration(later(21),m,1920,1080);
 assert.ok(!first.passed);assert.ok(first.perTarget.every(p=>p.offsetX>60&&p.offsetY<-40),'all seven read up and to the right');
 const corrected=applyCheckOffset(m,first,1920,1080);
 assert.ok(corrected&&validModel(corrected));assert.equal(corrected.anchors,undefined);assert.ok(m.anchors,'the original map is untouched');
 assert.ok(corrected.checkOffset.pixels.x>60&&corrected.checkOffset.pixels.y<-40);assert.deepEqual(corrected.checkOffset.previousCheck,{meanPixels:first.meanPixels,p90Pixels:first.p90Pixels});
 // Fresh looks at the same dots, not the ones that revealed the shift.
 const second=validateCalibration(later(22),corrected,1920,1080);
 assert.ok(second.passed,`after: ${second.meanPixels} px`);assert.ok(second.meanPixels<first.meanPixels*.4,`${first.meanPixels} -> ${second.meanPixels}`);
 // Only once per map, never for a sound map, and never as a stand-in for a
 // realignment when the shift is large.
 assert.equal(applyCheckOffset(corrected,second,1920,1080),null);assert.equal(applyCheckOffset(corrected,first,1920,1080),null);
 const sound=validateCalibration(groups({plain:.0012,detail:.004},CHECK_TARGETS,23).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,m))})),m,1920,1080);
 assert.equal(applyCheckOffset(m,sound,1920,1080),null);
 assert.equal(applyCheckOffset(m,checks(Array.from({length:7},()=>[400,0])),1920,1080),null);
 assert.equal(applyCheckOffset({},first,1920,1080),null);
 // An earlier one-point alignment and this correction add up.
 const aligned=applyCheckOffset({...m,offset:[.01,0]},first,1920,1080);assert.ok(Math.abs(aligned.offset[0]-.01-corrected.offset[0])<1e-12);
 // A check a person starts later may correct the same map again; a sound check still changes nothing.
 const again=applyCheckOffset(corrected,first,1920,1080,{repeat:true});
 assert.ok(again&&validModel(again));assert.ok(Math.abs(again.offset[0]-2*corrected.offset[0])<1e-12);assert.equal(applyCheckOffset(corrected,second,1920,1080,{repeat:true}),null);
 // The check of one recorded session: passed at 62 px, six of its seven dots read 29 to 56 px low.
 const recorded=checks([[-25,29],[57,50],[-7,36],[28,43],[17,-40],[-15,47],[-89,56]]);
 assert.deepEqual(checkOffset(recorded,1708,1020).pixels,{x:0,y:43});
 const raised=applyCheckOffset(m,recorded,1708,1020,{repeat:true});assert.ok(validModel(raised));assert.equal(raised.offset[0],0);assert.ok(Math.abs(raised.offset[1]+43/1020)<1e-12);
 // A shift of a fifth of the screen is still taken; beyond that it is a matter for realignment.
 assert.ok(applyCheckOffset(m,checks(Array.from({length:7},()=>[330,0])),1920,1080));
});

// 0.4.34. The difference between the two eyes is not one number: each eye's up/down reading is
// taken against the line through its own corners, which is not level, so as the eyes move across
// the reading rises in one eye and falls in the other. (Recorded: the up/down difference changes
// by about .06 across the screen, more than the up/down reading itself changes from top to bottom.)
const looking=(g,u)=>face({lh:.5+.1*g,rh:.44+.1*g,lv:.02*u+.03*g,rv:.02*u-.03*g});
test('with one eye hidden, the other is filled in from where it is looking, not from one fixed difference',()=>{
 const agreement=new BinocularAgreement(),old=new BinocularAgreement({least:Infinity});
 // The eyes look about the screen, as they do during a calibration.
 for(let i=0;i<400;i++){const g=Math.sin(i*.37),u=Math.cos(i*.23);for(const a of [agreement,old])assert.ok(screenFeature(looking(g,u),16/9,1080,{},a));}
 let worstNew=0,worstOld=0;
 for(const [g,u] of [[-1,-1],[-1,1],[1,-1],[1,1],[0,0],[.5,-.5],[-.8,.3]]){
  // Arrive at the place with both eyes, then lose one: the usual moment a reflection appears...
  const clear=screenFeature(looking(g,u),16/9,1080,{},new BinocularAgreement());
  for(const trust of [[true,false],[false,true]]){
   const q={},now=screenFeature(looking(g,u),16/9,1080,q,agreement,trust),was=screenFeature(looking(g,u),16/9,1080,{},old,trust);
   assert.ok(now&&was);assert.ok(q.oneEye);
   worstNew=Math.max(worstNew,Math.abs(now.v-clear.v),Math.abs(now.h-clear.h));worstOld=Math.max(worstOld,Math.abs(was.v-clear.v));
  }
 }
 // ...and it stays right wherever the seen eye then looks. The fixed difference is off by up to
 // half the change in the difference (.03 here: more than the whole up/down range of the reading).
 assert.ok(worstNew<.004,`by where the eye looks: off by up to ${worstNew}`);
 assert.ok(worstOld>.02,`one fixed difference: off by up to ${worstOld}`);
});
test('an eye that has looked at one place only says nothing about slopes, and nonsense is not learned',()=>{
 const agreement=new BinocularAgreement();
 for(let i=0;i<400;i++)assert.ok(screenFeature(looking(.2,.1),16/9,1080,{},agreement));
 const e=agreement.expected(0,.9,.4);
 // Far from the only place it knows: the answer stays near the usual difference instead of running off along a slope made of noise.
 assert.ok(Math.abs(e.dh-agreement.dh)<.01&&Math.abs(e.dv-agreement.dv)<.01,JSON.stringify(e));
 const fresh=new BinocularAgreement();assert.deepEqual(fresh.expected(0,.5,0),{dh:0,dv:0});
 for(const bad of [[NaN,0],[.5,Infinity],[undefined,0]])assert.deepEqual(agreement.expected(1,...bad),{dh:agreement.dh,dv:agreement.dv});
 assert.deepEqual(agreement.expected(2,.5,0),{dh:agreement.dh,dv:agreement.dv});
 agreement.check(.06,.01,{x:NaN,y:0},{x:.4,y:0});agreement.check(.06,.01);assert.ok(Number.isFinite(agreement.expected(0,.5,0).dv));
 agreement.reset();assert.equal(agreement.eyes[0].n,0);assert.deepEqual(agreement.expected(0,.5,0),{dh:0,dv:0});
});
