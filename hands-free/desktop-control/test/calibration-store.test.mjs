import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CalibrationStore} from '../calibration-store.mjs';
import {TRAIN_TARGETS,ALIGN_TARGETS,fitCalibration,fitAlignment,validModel} from '../../website/public/screen-gaze.mjs';
const model=fitCalibration(TRAIN_TARGETS.map(target=>({target,samples:Array.from({length:30},()=>({h:.25+.4*target[0],v:-.075+.15*target[1],x:.5,y:.45,scale:.3,roll:0}))})));
const record={model,setup:{deviceId:'camera',width:1280,height:720,screenWidth:1440,screenHeight:960,pixelRatio:1},validation:null};

test('direct-eye and face modes retain separate maps and numerical crop settings across restart',async t=>{
 const {file,store}=await fixture(t);
 const face={...record,setup:{...record.setup,cameraVersion:1,cameraLabel:'EMEET',cameraMode:'4k',frameRate:30,lens:'telephoto',externalZoom:null,controls:{zoom:400}},savedAt:1};
 const eyes={...face,setup:{...face.setup,trackingMode:'eyes',eyeRegions:[{x:.3,y:.5,size:.4},{x:.7,y:.5,size:.4}]},savedAt:2};
 await store.change('Two modes',{...eyes,lensCalibrations:[face,eyes],cameraPresets:[face.setup,eyes.setup]});
 const saved=(await new CalibrationStore(file,validModel).read()).profiles[0].record;
 assert.equal(saved.lensCalibrations.length,2);assert.equal(saved.cameraPresets.length,2);assert.equal(saved.setup.trackingMode,'eyes');assert.deepEqual(saved.setup.eyeRegions,eyes.setup.eyeRegions);assert.equal(saved.lensCalibrations[0].setup.trackingMode,undefined);
 await assert.rejects(store.change('Two modes',{...eyes,setup:{...eyes.setup,eyeRegions:[]}}),/eye tracking/);
 assert.equal((await store.read()).profiles[0].record.lensCalibrations.length,2);
});

test('physical lens calibration maps and their head banks remain separate across restart',async t=>{
 const {file,store}=await fixture(t);
 const setup={...record.setup,cameraVersion:1,cameraLabel:'EMEET SmartCam C60E 4K Dual',cameraMode:'4k',frameRate:30,lens:'wide',externalZoom:null,controls:{zoom:0}};
 const wide={...record,setup,headPositions:[{id:1,model,validation:{passed:true},savedAt:1}],activePositionId:1,savedAt:2};
 const tele={...record,setup:{...setup,lens:'telephoto',controls:{zoom:400}},model:{...model,head:{...model.head,x:.6}},validation:{passed:false},savedAt:3};
 await store.change('Lenses',{...tele,lensCalibrations:[wide,tele]});
 const saved=(await new CalibrationStore(file,validModel).read()).profiles[0].record;
 assert.equal(saved.lensCalibrations.length,2);assert.deepEqual(saved.lensCalibrations[0].headPositions,wide.headPositions);
 assert.equal(saved.lensCalibrations[0].setup.controls.zoom,0);assert.equal(saved.lensCalibrations[1].setup.controls.zoom,400);
 assert.equal(saved.lensCalibrations[1].validation.passed,false);assert.equal(saved.lensCalibrations[1].model.head.x,.6);
 await assert.rejects(store.change('Lenses',{...tele,lensCalibrations:[wide,wide]}),/lens calibration bank/);
 await assert.rejects(store.change('Lenses',{...tele,lensCalibrations:[{...wide,lensCalibrations:[tele]}]}),/lens calibration bank/);
 await assert.rejects(store.change('Lenses',{...tele,lensCalibrations:[{...wide,model:{...model,hidden:'video'}}]}),/numerical/);
 assert.equal((await store.read()).profiles[0].record.lensCalibrations.length,2);
});
test('wide and telephoto framing presets retain independent zoom and crop across restart',async t=>{
 const {file,store}=await fixture(t);
 const common={...record.setup,cameraVersion:1,cameraLabel:'EMEET',cameraMode:'4k',frameRate:30,externalZoom:null};
 const cameraPresets=[{...common,lens:'wide',controls:{zoom:80},crop:{zoom:1,x:.5,y:.5}},{...common,lens:'telephoto',controls:{zoom:330},crop:{zoom:1.5,x:.4,y:.6}}];
 await store.change('Two lenses',{...record,cameraPresets});const saved=await new CalibrationStore(file,validModel).read();
 assert.deepEqual(saved.profiles[0].record.cameraPresets,cameraPresets);
 await assert.rejects(store.change('Two lenses',{...record,cameraPresets:[cameraPresets[0],cameraPresets[0]]}),/lens presets/);
});
test('4K camera, zoom and lens settings survive the native store and a restart',async t=>{
 const {file,store}=await fixture(t);
 const setup={...record.setup,width:3840,height:2160,cameraVersion:1,cameraLabel:'EMEET C60E Dual',cameraMode:'4k',frameRate:30,lens:'telephoto',externalZoom:3,controls:{zoom:200,pan:0,tilt:0,focusMode:'continuous',saturation:50}};
 await store.change('Camera test',{...record,setup});
 const saved=await new CalibrationStore(file,validModel).read();assert.deepEqual(saved.profiles[0].record.setup,setup);
 await assert.rejects(store.change('Camera test',{...record,setup:{...setup,controls:{zoom:'invalid'}}}),/camera control/);
});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'calibration-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'calibrations.json');return {file,store:new CalibrationStore(file,validModel)};}
test('unfinished accuracy check survives a new app instance without video or raw samples',async t=>{
 const {file,store}=await fixture(t);await store.change(' Test ',{...record,images:'do not store',samples:[1,2,3]});
 const saved=await new CalibrationStore(file,validModel).read();assert.equal(saved.lastName,'Test');assert.equal(saved.profiles[0].record.validation,null);assert.ok(validModel(saved.profiles[0].record.model));
 const text=await fs.readFile(file,'utf8');assert.ok(!text.includes('do not store'));assert.ok(!text.includes('samples'));
});
test('success is preserved, profiles are separate and concurrent saves do not overwrite each other',async t=>{
 const {store}=await fixture(t);await Promise.all([store.change('One',{...record,validation:{passed:true,mean:.03}}),store.change('Two',record)]);
 const result=await store.read();assert.equal(result.profiles.length,2);assert.equal(result.profiles[0].record.validation.passed,true);
 await store.change('one',record);assert.equal((await store.read()).profiles.length,2);
});
test('recovery copy survives a corrupt main file and honors deletion',async t=>{
 const {file,store}=await fixture(t);await store.change('One',record);await fs.writeFile(file,'broken');assert.equal((await store.read()).profiles.length,1);
 await store.change('One',null);await fs.writeFile(file,'broken');assert.equal((await store.read()).profiles.length,0);
});
test('rejects malformed models, text hidden in coefficients and invalid screen settings',async t=>{
 const {store}=await fixture(t);await assert.rejects(store.change('One',{...record,model:{}}),/model/);
 await assert.rejects(store.change('One',{...record,model:{...model,extra:'image'}}),/numerical/);
 await assert.rejects(store.change('One',{...record,setup:{...record.setup,width:0}}),/settings/);
 assert.equal((await store.read()).profiles.length,0);
});

test('head-corrected mapping persists and restores its numerical coefficients',async t=>{
 const m={...model,version:3,poseCorrection:{indices:[0,1,2,3],reference:[.5,.45,.3,0],weights:[[.01,.002,0,0],[.001,.02,0,0]]}};
 assert.ok(validModel(m));const {store}=await fixture(t);await store.change('Head correction',{...record,model:m});
 const restored=(await store.read()).profiles[0].record.model;assert.deepEqual(restored.poseCorrection,m.poseCorrection);assert.ok(validModel(restored));
 await assert.rejects(store.change('Bad correction',{...record,model:{...m,poseCorrection:{...m.poseCorrection,indices:[0,0,0,0]}}}),/model/);
});

test('regional correction persists without raw eye features and remains validated',async t=>{
 const m={...model,refinement:{centers:Array.from({length:9},(_,i)=>[.12+(i%3)*.38,.12+Math.floor(i/3)*.38]),weights:[Array(9).fill(.002),Array(9).fill(-.002)],radius:.35,lambda:.2}};
 const {store}=await fixture(t);await store.change('Regional map',{...record,model:m});
 const restored=(await store.read()).profiles[0].record.model;assert.deepEqual(restored.refinement,m.refinement);assert.ok(validModel(restored));
 await assert.rejects(store.change('Invalid region',{...record,model:{...m,refinement:{...m.refinement,radius:0}}}),/model/);
});

test('separate-eye model and alignment survive a restart without raw eye samples',async t=>{
 const feature=(x,y,j=0)=>({h:.25+.4*x,v:-.075+.15*y,x:.5,y:.45,scale:.3,roll:0,lh:.25+.4*x,lv:-.075+.15*y,rh:.25+.4*x+j,rv:-.075+.15*y+j*.5});
 const groups=TRAIN_TARGETS.map(target=>({target,samples:Array.from({length:40},(_,i)=>feature(...target,Math.sin(i*Math.PI/2)*.025))}));
 const m=fitCalibration(groups);assert.equal(m.version,4);
 const adjusted=fitAlignment(ALIGN_TARGETS.map(target=>({target,samples:Array.from({length:30},()=>feature(target[0]+.08,target[1]-.04))})),m);
 const {file,store}=await fixture(t);await store.change('Separate eyes',{...record,model:adjusted,validation:{passed:false,rejected:{'outside-screen':12},perTarget:[{sampleCount:30,jitterPixels:12}]}});
 const restored=(await new CalibrationStore(file,validModel).read()).profiles[0].record;
 assert.deepEqual(restored.model,adjusted);assert.equal(restored.validation.passed,false);assert.ok(validModel(restored.model));
 const saved=await fs.readFile(file,'utf8');assert.ok(!saved.includes('"samples"'));assert.ok(!saved.includes('"images"'));
});

test('head-position bank keeps independent accuracy results across restarts without raw samples',async t=>{
 const {file,store}=await fixture(t);
 const headPositions=[{id:1,model,validation:{passed:true,p90Pixels:40},savedAt:1},{id:2,model:{...model,head:{...model.head,x:.58}},validation:{passed:false,p90Pixels:180},savedAt:2}];
 await store.change('Positions',{...record,headPositions,activePositionId:1,images:['discard']});
 const saved=(await new CalibrationStore(file,validModel).read()).profiles[0].record;
 assert.deepEqual(saved.headPositions,headPositions);assert.equal(saved.activePositionId,1);assert.equal(saved.headPositions[1].validation.passed,false);
 assert.equal((await fs.readFile(file,'utf8')).includes('images'),false);
 await assert.rejects(store.change('Positions',{...record,headPositions:[headPositions[0],headPositions[0]],activePositionId:1}),/head positions/);
 await assert.rejects(store.change('Positions',{...record,headPositions,activePositionId:3}),/active head/);
 await assert.rejects(store.change('Positions',{...record,headPositions:[...headPositions,...Array.from({length:14},(_,i)=>({...headPositions[0],id:i+3}))],activePositionId:1}),/head positions/);
 await assert.rejects(store.change('Positions',{...record,headPositions:[{...headPositions[0],model:{...model,extra:'image'}}],activePositionId:1}),/numerical/);
 assert.equal((await store.read()).profiles[0].record.headPositions.length,2);
});

test('all fifteen head positions survive a restart and remain independently measured',async t=>{
 const {file,store}=await fixture(t),headPositions=Array.from({length:15},(_,i)=>({id:i+1,model:{...model,head:{...model.head,x:.45+i*.01}},validation:{passed:i%2===0,p90Pixels:40+i},savedAt:i+1}));
 await store.change('Fifteen',{...record,headPositions,activePositionId:15});
 const saved=(await new CalibrationStore(file,validModel).read()).profiles[0].record;
 assert.deepEqual(saved.headPositions,headPositions);assert.equal(saved.activePositionId,15);
});
