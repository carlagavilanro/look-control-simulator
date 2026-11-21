import test from 'node:test';
import assert from 'node:assert/strict';
import {SETTINGS_KEY,CALIBRATION_KEY,readProfile,writeProfile,forgetProfile,chooseCamera,fancyCamera,screenSummary,summaryText} from '../public/screen-profile.mjs';

function storage(initial={}){const kept=new Map(Object.entries(initial));return {getItem:key=>kept.has(key)?kept.get(key):null,setItem:(key,value)=>{kept.set(key,String(value));},kept};}
const laptop={deviceId:'lap',label:'HP TrueVision HD Camera (30c9:0069)'},emeet={deviceId:'eme',label:'EMEET SmartCam C60E 4K Dual (328f:00a5)'};

test('a profile keeps its camera, its setup and its options under its own name',()=>{
 const s=storage();
 assert.deepEqual(readProfile(s,'Carla'),{camera:null,setup:null,controls:null});
 assert.equal(writeProfile(s,' Carla ',{camera:emeet,setup:{mode:'1080p',tracking:'eyes'},controls:{headMove:false,keyboardLayout:'large',dimCapture:true}},100),true);
 assert.deepEqual(readProfile(s,'carla'),{camera:emeet,setup:{mode:'1080p',tracking:'eyes'},controls:{headMove:false,keyboardLayout:'large',dimCapture:true}});
 assert.deepEqual(readProfile(s,'Someone else'),{camera:null,setup:null,controls:null},'another name has nothing');
 // One part written later leaves the others as they were, and options add up.
 writeProfile(s,'Carla',{controls:{autocorrect:false}},200);
 const now=readProfile(s,'Carla');assert.deepEqual(now.camera,emeet);assert.deepEqual(now.controls,{headMove:false,keyboardLayout:'large',dimCapture:true,autocorrect:false});
 // "Default camera" is a choice too.
 writeProfile(s,'Carla',{camera:{deviceId:'',label:''}},300);assert.deepEqual(readProfile(s,'Carla').camera,{deviceId:'',label:''});
 assert.equal(forgetProfile(s,'Carla'),true);assert.deepEqual(readProfile(s,'Carla'),{camera:null,setup:null,controls:null});
});
test('what is saved is cut to what a profile may hold',()=>{
 const s=storage();
 writeProfile(s,'A',{camera:{deviceId:'x'.repeat(999),label:'y'.repeat(999),picture:'data:image/png;base64,AAAA'},setup:{mode:'8k',tracking:'nose'},controls:{headMove:'yes',keyboardLayout:'huge',readingDock:'top-left',landmarks:[1,2,3]}});
 const kept=readProfile(s,'A');
 assert.equal(kept.camera.deviceId.length,256);assert.equal(kept.camera.label.length,120);assert.deepEqual(Object.keys(kept.camera),['deviceId','label']);
 assert.deepEqual(kept.setup,{mode:'auto',tracking:'face'});assert.deepEqual(kept.controls,{readingDock:'top-left'});
 assert.equal(writeProfile(s,'',{camera:emeet}),false,'no name, nothing saved');assert.equal(writeProfile(null,'A',{camera:emeet}),false,'no storage, nothing saved and nothing thrown');
 assert.deepEqual(readProfile(null,'A'),{camera:null,setup:null,controls:null});
 assert.deepEqual(readProfile(storage({[SETTINGS_KEY]:'not json'}),'A'),{camera:null,setup:null,controls:null});
 // A name that is also a property of every object is a name like any other.
 writeProfile(s,'constructor',{camera:laptop});assert.deepEqual(readProfile(s,'constructor').camera,laptop);assert.deepEqual(readProfile(s,'toString').camera,null);
});
test('the camera picked for the profile is used; with none picked, the better camera when it is plugged in',()=>{
 assert.equal(fancyCamera(emeet.label),true);assert.equal(fancyCamera(laptop.label),false);assert.equal(fancyCamera('Logitech BRIO 4K'),true);
 // Nothing picked, nothing calibrated.
 assert.equal(chooseCamera([laptop,emeet]).reason,'fancy');assert.equal(chooseCamera([laptop,emeet]).deviceId,'eme');
 assert.deepEqual(chooseCamera([laptop]),{deviceId:'',label:'',reason:'default',missing:null});
 // A calibration made with the laptop's camera does not hold the better camera back...
 assert.equal(chooseCamera([laptop,emeet],{calibrated:laptop}).deviceId,'eme');
 // ...and one made with the better camera is simply used.
 assert.equal(chooseCamera([laptop,emeet],{calibrated:emeet}).reason,'calibration');
 assert.equal(chooseCamera([laptop],{calibrated:laptop}).reason,'calibration');
 // A pick by hand always wins, the laptop's camera and "Default camera" included.
 assert.deepEqual(chooseCamera([laptop,emeet],{saved:laptop,calibrated:emeet}),{deviceId:'lap',label:laptop.label,reason:'profile',missing:null});
 assert.deepEqual(chooseCamera([laptop,emeet],{saved:{deviceId:'',label:''}}),{deviceId:'',label:'',reason:'profile',missing:null});
 // The browser gave the camera a new id: it is found again by its name.
 assert.equal(chooseCamera([laptop,{...emeet,deviceId:'new'}],{saved:emeet}).deviceId,'new');
 // Before the camera has been allowed, no names are listed: the saved camera is asked for as saved.
 assert.equal(chooseCamera([],{saved:emeet}).deviceId,'eme');assert.equal(chooseCamera([{deviceId:'a',label:''}],{saved:emeet}).deviceId,'eme');
 // Picked, and not plugged in: said so, and the calibration's camera (or the default) is on offer.
 const away=chooseCamera([laptop],{saved:emeet,calibrated:laptop});assert.equal(away.missing,emeet.label);assert.equal(away.reason,'calibration');assert.equal(away.deviceId,'lap');
 assert.equal(chooseCamera([laptop],{saved:emeet}).reason,'default');
});
test('one line says what the profile has saved for Screen control',()=>{
 const s=storage({[CALIBRATION_KEY]:JSON.stringify({carla:{model:{any:1},setup:{deviceId:'eme',cameraLabel:emeet.label},validation:{passed:true},savedAt:5}})});
 assert.equal(summaryText(screenSummary(s,'Nobody')),'Pointer calibration needed');
 assert.equal(summaryText(screenSummary(s,'Carla')),'Camera: '+emeet.label+' · Pointer calibration saved');
 writeProfile(s,'Carla',{camera:laptop,setup:{mode:'1080p',tracking:'face'},controls:{headMove:true}});
 assert.equal(summaryText(screenSummary(s,'Carla')),'Camera: '+laptop.label+' (1080p · Face + eyes) · Pointer calibration saved · Options saved');
 assert.deepEqual(screenSummary(s,'Carla').calibrated,{deviceId:'eme',label:emeet.label,savedAt:5,passed:true});
 assert.equal(screenSummary(storage({[CALIBRATION_KEY]:'{'}),'Carla').calibrated,null);
});
