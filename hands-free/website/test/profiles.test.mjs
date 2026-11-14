import test from 'node:test';import assert from 'node:assert/strict';
import {ProfileStore} from '../public/vendor/profile-store.mjs';
const calibration={center:.5,left:.3,right:.7,x:.5,y:.5,scale:.3};
const camera={deviceId:'front-camera',width:640,height:480};
function memory(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}
test('named calibration survives a new session on the same camera',()=>{
 const storage=memory(),first=new ProfileStore(storage);first.create('  Alex  ','a');first.save(calibration,camera);
 const next=new ProfileStore(storage);assert.equal(next.active.name,'Alex');assert.deepEqual(next.restore(camera),calibration);
 const restored=next.restore(camera);restored.center=.1;assert.equal(next.restore(camera).center,.5);
 assert.equal(next.restore({...camera,deviceId:'other'}),null);assert.equal(next.restore({...camera,width:1280}),null);
});
test('switching profiles never reuses another person’s calibration',()=>{
 const storage=memory(),s=new ProfileStore(storage);s.create('Alex','a');s.save(calibration,camera);s.create('Sam','b');assert.equal(s.restore(camera),null);
 s.save({...calibration,center:.52},camera);s.select('a');assert.deepEqual(s.restore(camera),calibration);
 s.remove('a');assert.equal(s.active,null);assert.equal(new ProfileStore(storage).data.profiles.length,1);
});
test('invalid calibration and duplicate or empty names are rejected',()=>{
 const s=new ProfileStore(memory());assert.throws(()=>s.create('  ','a'));s.create('Alex','a');assert.throws(()=>s.create('alex','b'));
 assert.throws(()=>s.save({...calibration,left:.49},camera));assert.throws(()=>s.save({...calibration,scale:NaN},camera));
});
test('corrupt or blocked storage does not falsely report a successful save',()=>{
 const corrupt=new ProfileStore({getItem:()=>'{broken'});assert.equal(corrupt.active,null);assert.ok(corrupt.error);
 const blocked=new ProfileStore({getItem:()=>null,setItem(){throw Error('blocked');}});assert.throws(()=>blocked.create('Alex','a'),/could not save/);assert.equal(blocked.active,null);
});
test('saved data excludes frames, raw landmarks, and access keys',()=>{
 const s=new ProfileStore(memory());s.create('Alex','a');s.save({...calibration,frames:['private'],key:'secret'}, {...camera,key:'secret'});
 assert.equal(JSON.stringify(s.data).includes('secret'),false);assert.equal(JSON.stringify(s.data).includes('frames'),false);
});

test('new profiles retain onboarding progress and legacy calibrated profiles skip forced setup',()=>{
 const storage=memory(),s=new ProfileStore(storage);s.create('Alex','a');s.save(calibration,camera);
 assert.equal(new ProfileStore(storage).active.onboardingComplete,false);
 s.completeOnboarding();assert.equal(new ProfileStore(storage).active.onboardingComplete,true);
 const legacy=JSON.parse(JSON.stringify(s.data));delete legacy.profiles[0].onboardingComplete;
 storage.setItem('look-control.profiles.v1',JSON.stringify(legacy));assert.equal(new ProfileStore(storage).active.onboardingComplete,true);
});
