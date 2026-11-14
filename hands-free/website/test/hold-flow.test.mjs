import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ProfileStore} from '../public/vendor/profile-store.mjs';
import {webcrypto} from 'node:crypto';
import {EyeSelector,DwellSelector} from '../public/eye-selection.mjs';

function app(){
 const elements=new Map(),requests=[];
 const element=()=>({textContent:'',value:'',children:[],dataset:{},style:{setProperty(){}},classList:{add(){},remove(){}},setAttribute(){},querySelector(){return null;},focus(){},prepend(...children){this.children.unshift(...children);},scrollIntoView(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}});
 const document={body:element(),querySelector(selector){return this.getElementById(selector);},getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,querySelectorAll(){return [...elements.values()].flatMap(e=>e.children).filter(e=>e.className==='selected');},addEventListener(){}};
 const ctx=vm.createContext({EyeSelector,DwellSelector,ProfileStore,document,performance:{now:()=>0},window:{addEventListener(){},localStorage:{getItem(){return null;},setItem(){}}},crypto:webcrypto,AbortSignal,fetch:async(route,options)=>{requests.push({route,body:JSON.parse(options.body)});return {ok:true,json:async()=>({message:'Test acknowledgement'})};}});
 const source=fs.readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'');
 vm.runInContext(source,ctx);
 const run=code=>vm.runInContext(code,ctx);
 const hold=(start,end)=>run(`for(let t=${start};t<=${end};t+=50){const target=dwell.update(true,t);showHold();if(target!==null)holdSelection(target);}`);
 run("connected=true;$('profile-dialog').close();paint();");return {run,hold,requests,elements};
}


test('one 600 ms center hold sends directly exactly once',async()=>{
 const {run,hold,requests,elements}=app();
 run("gesture('left')");assert.equal(run('index'),8);
 run("gesture('right');gesture('right')");assert.equal(run('index'),1);
 hold(0,550);assert.equal(requests.length,0);
 hold(600,600);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,1);assert.equal(requests[0].body.command,'captured_level_down');
 assert.match(elements.get('result').textContent,/Test acknowledgement/);
 assert.equal(elements.has('confirm'),false);
 hold(650,12000);assert.equal(requests.length,1);
});

test('pausing before hold completion cancels the hold without a command',()=>{
 const {run,hold,requests}=app();run("gesture('right')");hold(0,500);
 run("$('pause').onclick()");assert.equal(run('dwell.target'),null);
 hold(4550,11000);assert.equal(requests.length,0);
});

test('tracking loss keeps Power toggle selected and requires a fresh 600 ms hold after prolonged loss',async()=>{
 const {run,hold,requests,elements}=app();run("gesture('right');gesture('left')");hold(0,500);
 run('for(let t=4550;t<=6000;t+=50)trackingUnavailable(t);');
 assert.equal(run('index'),0);assert.equal(run('dwell.target'),'control:0');assert.equal(run('dwell.progress'),0);
 assert.match(elements.get('hold-status').textContent,/stays selected/);assert.equal(requests.length,0);
 hold(6050,6600);assert.equal(requests.length,0);
 hold(6650,6650);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,1);assert.equal(requests[0].body.command,'captured_power');
});

test('mouse or touch activation sends once with no confirmation screen',async()=>{
 const {requests,elements}=app();elements.get('controls').children[0].onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,1);assert.equal(requests[0].body.command,'captured_power');
 assert.equal(elements.has('confirm'),false);
});

test('profile calibration restores into the tracker without arming a command',()=>{
 const {run,hold,requests}=app();
 run("profiles.create('Alex','a');stream={getVideoTracks:()=>[{getSettings:()=>({deviceId:'front',width:640,height:480})}]};selector.calibration={center:.5,left:.3,right:.7,x:.5,y:.5,scale:.3};saveCalibration();selector.calibration=null;restoreCalibration();");
 assert.equal(run('selector.calibration.center'),.5);
 assert.equal(run('dwell.target'),null);hold(0,7000);assert.equal(requests.length,0);
 run("stream={getVideoTracks:()=>[{getSettings:()=>({deviceId:'different',width:640,height:480})}]};selector.calibration=null;restoreCalibration();");
 assert.equal(run('selector.calibration'),null);
});

test('opening profile picker cancels a partial hold and blocks gesture commands',()=>{
 const {run,hold,requests}=app();run("gesture('right')");hold(0,500);run('openProfiles();');
 assert.equal(run('dwell.target'),null);run("gesture('right')");hold(4550,11000);assert.equal(requests.length,0);
});

test('new profile opens camera setup directly and interrupted setup resumes',()=>{
 const {run,elements}=app();run("$('profile-name').value='Alex';$('profile-form').onsubmit({preventDefault(){}})");
 assert.equal(run('setupStep'),'camera');assert.equal(elements.get('setup-dialog').open,true);
 run('closeSetup();resumeSetup();');assert.equal(elements.get('setup-dialog').open,true);
});

test('setup blocks every appliance activation path',()=>{
 const {run,hold,requests}=app();run("profiles.create('Alex','a');gesture('right');openSetup('camera');gesture('left');holdSelection('control:1');activate();send(items[0]);");
 hold(0,7000);assert.equal(requests.length,0);assert.equal(run('dwell.target'),null);
});

function prepareCalibration(run){run("profiles.create('Alex','a');stream={getVideoTracks:()=>[{getSettings:()=>({deviceId:'front',width:640,height:480})}]};ready=true;openSetup('camera');nextSetup();");}
function collect(run,value){run(`for(let t=2500;t<5000;t+=80)captureCalibration({value:${value},x:.5,y:.5,scale:.3},t);captureCalibration(null,5000);`);}

test('guided samples persist calibration and return directly to controls without sending',()=>{
 const {run,elements,requests}=app();prepareCalibration(run);
 collect(run,.5);assert.equal(run('setupStep'),'left');collect(run,.3);assert.equal(run('setupStep'),'right');collect(run,.7);
 assert.ok(run('profiles.active.calibration'));assert.equal(elements.get('setup-nudge').hidden,true);
 assert.equal(elements.get('setup-dialog').open,false);assert.equal(run('profiles.active.onboardingComplete'),true);
 run('resumeSetup();');assert.equal(elements.get('setup-dialog').open,false);assert.equal(requests.length,0);
});

test('insufficient frames retry the same direction without saving',()=>{
 const {run}=app();prepareCalibration(run);run('captureCalibration(null,5000)');
 assert.equal(run('setupStep'),'retry');assert.equal(run('profiles.active.calibration'),null);
 run('nextSetup();');assert.equal(run('calibrating'),'center');
});

test('invalid direction samples never replace saved calibration; cancellation restores it',()=>{
 const {run}=app();prepareCalibration(run);
 run("selector.calibration={center:.5,left:.3,right:.7,x:.5,y:.5,scale:.3};profiles.save(selector.calibration,cameraStamp());");
 collect(run,.5);collect(run,.5);collect(run,.5);assert.equal(run('setupStep'),'retry');
 run('closeSetup();');assert.equal(run('selector.calibration.left'),.3);assert.equal(run('profiles.active.calibration.values.left'),.3);
});

test('storage failure is visible and does not falsely mark calibration saved',()=>{
 const {run,elements}=app();prepareCalibration(run);run("profiles.storage={setItem(){throw Error('full')}}");
 collect(run,.5);collect(run,.3);collect(run,.7);
 assert.equal(run('setupStep'),'save-failed');assert.equal(run('profiles.active.calibration'),null);assert.match(elements.get('setup-error').textContent,/could not save/);
 run('profiles.storage={setItem(){}};nextSetup();');assert.ok(run('profiles.active.calibration'));assert.equal(elements.get('setup-dialog').open,false);
});

test('saved calibration skips extra setup screens and a changed camera shows the setup prompt',()=>{
 const {run,elements}=app();prepareCalibration(run);collect(run,.5);collect(run,.3);collect(run,.7);
 run('closeSetup();resumeSetup();');assert.equal(elements.get('setup-dialog').open,false);
 run("closeSetup();selector.calibration=null;stream={getVideoTracks:()=>[{getSettings:()=>({deviceId:'other',width:640,height:480})}]};restoreCalibration();");
 assert.equal(elements.get('setup-nudge').hidden,false);
});

test('TV starts unavailable and a forged UI activation sends nothing',async()=>{
 const {run,requests,elements}=app();run("selectDevice('tv');activate();send(items[0]);");
 await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,0);assert.equal(elements.get('controls').children[0].disabled,true);
 run("gesture('right')");assert.equal(run('items[index][0]'),'pause');
});
test('loaded TV volume uses the same single 600 ms hold',async()=>{
 const {run,hold,requests}=app();run("availableCommands.add('tv_volume_up');selectDevice('tv');gesture('right');");
 assert.equal(run('items[index][0]'),'tv_volume_up');hold(0,550);assert.equal(requests.length,0);
 hold(600,600);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,1);assert.equal(requests[0].body.command,'tv_volume_up');
 hold(650,12000);assert.equal(requests.length,1);
});
test('device switching cancels the hold and does not send or arm the new device',()=>{
 const {run,hold,requests}=app();run("gesture('right')");hold(0,500);run("selectDevice('tv')");
 assert.equal(run('dwell.target'),null);hold(4550,12000);assert.equal(requests.length,0);
});
test('eye selection can switch devices without an appliance command',()=>{
 const {run,hold,requests}=app();run("gesture('left')");assert.equal(run('items[index][0]'),'switch-device');hold(0,5000);
 assert.equal(run('activeDevice'),'tv');assert.equal(run('dwell.target'),null);assert.equal(requests.length,0);
});
