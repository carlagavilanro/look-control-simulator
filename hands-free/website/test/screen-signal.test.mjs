import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAIN_TARGETS,CHECK_TARGETS,ALIGN_TARGETS,fitCalibration,fitAlignment,validateCalibration,validModel,predict,signalFeature,detailFeature,screenFeature,DETAIL_ADVANTAGE} from '../public/screen-gaze.mjs';
import {BinocularAgreement} from '../public/screen-eye-crop.mjs';
import {noiseSource} from './support/synthetic-eyes.mjs';
// One frame with both iris readings of the same gaze. `plain` and `detail` are
// each reading's frame-to-frame noise; the camera-pixel reading may also sit at
// a different scale and offset, as it does in practice.
function frames(target,random,{plain=.004,detail=.0005,count=30,missing=0,stuck=false}={}){
 return {target,samples:Array.from({length:count},(_,i)=>{
  const h=.3+.3*target[0],v=-.06+.12*target[1],n=()=>random()*2,p=[n()*plain,n()*plain*.5,n()*plain,n()*plain*.5],d=[n()*detail,n()*detail*.5,n()*detail,n()*detail*.5];
  // stuck: the eye model's reading does not follow the gaze at all.
  const mh=stuck?.45:h,mv=stuck?0:v,f={lh:mh+.03+p[0],lv:mv+p[1],rh:mh-.03+p[2],rv:mv+p[3],x:.5,y:.45,scale:.3,roll:0};f.h=(f.lh+f.rh)/2;f.v=(f.lv+f.rv)/2;
  if(i>=missing){const a={lh:1.2*h+.05+d[0],lv:1.3*v+.01+d[1],rh:1.2*h-.02+d[2],rv:1.3*v+.01+d[3]};f.alt={...a,h:(a.lh+a.rh)/2,v:(a.lv+a.rv)/2};}
  return f;
 })};
}
const groups=(options,targets=TRAIN_TARGETS,seed=5)=>{const random=noiseSource(seed);return targets.map(t=>frames(t,random,options));};

test('calibration keeps the camera-pixel iris reading when it predicts held-out points better',()=>{
 const m=fitCalibration(groups({plain:.004,detail:.0005}));
 assert.equal(m.signal,'detail');assert.ok(validModel(m));
 assert.ok(m.signalComparison.detail<=m.signalComparison.plain*DETAIL_ADVANTAGE);
 // The saved map then reads that signal from every later frame.
 const check=groups({plain:.004,detail:.0005},CHECK_TARGETS,9).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,m))}));
 const v=validateCalibration(check,m,1920,1080);assert.ok(v.passed);
 const plainOnly=fitCalibration(groups({plain:.004,detail:.0005}),{signal:'plain'});
 const plainCheck=validateCalibration(groups({plain:.004,detail:.0005},CHECK_TARGETS,9).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,plainOnly))})),plainOnly,1920,1080);
 assert.ok(v.meanPixels<plainCheck.meanPixels*.6,`${v.meanPixels} vs ${plainCheck.meanPixels}`);
});

test('calibration keeps the eye model reading when the camera-pixel one is no better or incomplete',()=>{
 const noisy=fitCalibration(groups({plain:.0008,detail:.004}));assert.equal(noisy.signal,undefined);assert.ok(noisy.signalComparison.detail>noisy.signalComparison.plain);
 // The camera-pixel reading moves 1.2 to 1.3 times as far for the same gaze,
 // so this much noise makes the two about equally good: the simpler one stays.
 const equal=fitCalibration(groups({plain:.001,detail:.00125}));assert.equal(equal.signal,undefined);
 // Too many frames without a camera-pixel reading: it is not considered at all.
 const sparse=fitCalibration(groups({plain:.002,detail:.0002,missing:6}));assert.equal(sparse.signal,undefined);assert.equal(sparse.signalComparison,undefined);
 assert.throws(()=>fitCalibration(groups({missing:6}),{signal:'detail'}),/iris edge was not clear/);
 // Frames without the second reading at all behave exactly as before.
 const old=groups({}).map(g=>({...g,samples:g.samples.map(({alt,...f})=>f)}));
 assert.equal(fitCalibration(old).signal,undefined);
});

test('a map that could not be fitted from the eye model reading can still be fitted from camera pixels',()=>{
 assert.throws(()=>fitCalibration(groups({stuck:true}),{signal:'plain'}),/not distinct enough/);
 const m=fitCalibration(groups({stuck:true}));
 assert.equal(m.signal,'detail');assert.equal(m.signalComparison,undefined);assert.ok(validModel(m));
 // With neither reading usable, the eye model's error is the one reported.
 const neither=groups({stuck:true}).map(g=>({...g,samples:g.samples.map(({alt,...f})=>f)}));
 assert.throws(()=>fitCalibration(neither),/not distinct enough/);
});

test('each frame gives a map the reading it was fitted to, or nothing',()=>{
 const f=frames([.5,.5],noiseSource(3)).samples[0];
 const d=signalFeature(f,{signal:'detail'});assert.equal(d.lh,f.alt.lh);assert.equal(d.h,f.alt.h);assert.equal(d.x,f.x);assert.equal(d.alt,undefined);
 const p=signalFeature(f,{});assert.equal(p.lh,f.lh);assert.equal(p.alt,undefined);
 const {alt,...bare}=f;assert.equal(signalFeature(bare,{signal:'detail'}),null);assert.equal(signalFeature(bare,null),bare);
 assert.equal(signalFeature(null,{signal:'detail'}),null);assert.equal(detailFeature({...f,alt:{...f.alt,lv:NaN}}),null);
 assert.equal(validModel({...fitCalibration(groups({})),signal:'other'}),false);
});

test('realigning a camera-pixel map keeps reading camera pixels',()=>{
 const m=fitCalibration(groups({plain:.004,detail:.0005}));
 const align=groups({plain:.004,detail:.0005},ALIGN_TARGETS,11).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,m))}));
 for(const eyeOnly of [false,true]){const repaired=fitAlignment(align,m,{eyeOnly});assert.equal(repaired.signal,'detail');assert.ok(validModel(repaired));}
 const plain=fitCalibration(groups({plain:.0008,detail:.004}));
 const plainAlign=groups({plain:.0008,detail:.004},ALIGN_TARGETS,11).map(g=>({...g,samples:g.samples.map(f=>signalFeature(f,plain))}));
 assert.equal(fitAlignment(plainAlign,plain,{eyeOnly:true}).signal,undefined);
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
 // Without the usual difference, or with both eyes covered, there is no reading.
 const fresh={};assert.equal(screenFeature(face(),16/9,1080,fresh,new BinocularAgreement(),[true,false]),null);assert.equal(fresh.reason,'glare');
 const both={};assert.equal(screenFeature(face(),16/9,1080,both,agreement,[false,false]),null);assert.equal(both.reason,'glare');
 // Unchanged when both eyes are trusted.
 assert.deepEqual(screenFeature(face(),16/9,1080,{},new BinocularAgreement()),screenFeature(face(),16/9,1080,{},new BinocularAgreement(),[true,true]));
});
