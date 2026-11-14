// Local named profiles, not authentication. No frames, landmarks, or keys.
const KEY='look-control.profiles.v1';
export function validCalibration(c){
 return !!c&&['center','left','right','x','y','scale'].every(k=>Number.isFinite(c[k]))&&
 ['center','left','right','x','y'].every(k=>c[k]>=0&&c[k]<=1)&&c.scale>0&&c.scale<=1&&
 (c.left-c.center)*(c.right-c.center)<0&&Math.abs(c.left-c.center)>=.055&&Math.abs(c.right-c.center)>=.055;
}
export function cameraMatches(a,b){return !!a&&!!b&&!!a.deviceId&&a.deviceId===b.deviceId&&Number.isFinite(a.width)&&a.width>0&&Number.isFinite(a.height)&&a.height>0&&a.width===b.width&&a.height===b.height;}
export class ProfileStore{
 constructor(storage){this.storage=storage;this.data={version:1,activeId:null,profiles:[]};this.error='';
  try{const raw=storage.getItem(KEY);if(raw){const d=JSON.parse(raw);if(d.version!==1||!Array.isArray(d.profiles))throw Error();
   this.data.profiles=d.profiles.filter(p=>typeof p.id==='string'&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=40).slice(0,20).map(p=>({id:p.id,name:p.name,calibration:validCalibration(p.calibration?.values)?p.calibration:null,onboardingComplete:typeof p.onboardingComplete==='boolean'?p.onboardingComplete:validCalibration(p.calibration?.values)}));
   this.data.activeId=this.data.profiles.some(p=>p.id===d.activeId)?d.activeId:null;
  }}catch{this.error='Saved profiles are unavailable. You can still use the controls for this visit.';}
 }
 get active(){return this.data.profiles.find(p=>p.id===this.data.activeId)||null;}
 commit(next){try{this.storage.setItem(KEY,JSON.stringify(next));}catch{throw Error('This browser could not save your profile. Allow site storage or use this session without saving.');}this.data=next;}
 create(name,id){name=name.trim();if(!name||name.length>40)throw Error('Enter a name between 1 and 40 characters.');if(this.data.profiles.length>=20)throw Error('This device already has 20 profiles. Remove an unused profile first.');
  if(this.data.profiles.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw Error('That name already has a profile. Choose it above.');
  this.commit({...this.data,activeId:id,profiles:[...this.data.profiles,{id,name,calibration:null,onboardingComplete:false}]});return this.active;
 }
 select(id){if(!this.data.profiles.some(p=>p.id===id))throw Error('Choose an existing profile.');this.commit({...this.data,activeId:id});}
 save(values,camera){if(!this.active)throw Error('Create a profile to save calibration.');if(!validCalibration(values))throw Error('Complete calibration before saving.');if(!cameraMatches(camera,camera))throw Error('Camera details are unavailable. Restart the camera before saving.');
  const clean=Object.fromEntries(['center','left','right','x','y','scale'].map(k=>[k,values[k]]));
  const calibration={version:1,values:clean,camera:{deviceId:camera.deviceId,width:camera.width,height:camera.height},savedAt:Date.now()};
  this.commit({...this.data,profiles:this.data.profiles.map(p=>p.id===this.data.activeId?{...p,calibration}:p)});
 }
 remove(id){this.commit({...this.data,activeId:this.data.activeId===id?null:this.data.activeId,profiles:this.data.profiles.filter(p=>p.id!==id)});}
 completeOnboarding(){if(!this.active)return;this.commit({...this.data,profiles:this.data.profiles.map(p=>p.id===this.data.activeId?{...p,onboardingComplete:true}:p)});}
 restore(camera){const saved=this.active?.calibration;return saved?.version===1&&validCalibration(saved.values)&&cameraMatches(saved.camera,camera)?{...saved.values}:null;}
}
