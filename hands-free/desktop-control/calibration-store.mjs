import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
const {cameraSetupFields}=await import(existsSync(new URL('./public/screen-camera.mjs',import.meta.url))?'./public/screen-camera.mjs':'../website/public/screen-camera.mjs');

// Only numerical calibration, device settings and a local name may reach disk.
function numbers(value, depth=0) {
 if(depth>8)throw Error('Invalid calibration data');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(Array.isArray(value))return value.map(v=>numbers(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,numbers(v,depth+1)]));
 throw Error('Only numerical calibration data can be saved');
}
export function calibrationRecord(value, validModel, allowLensBank=true) {
 if(!value||!validModel(value.model))throw Error('Invalid calibration model');
 const s=value.setup;
 if(!s||typeof s.deviceId!=='string'||s.deviceId.length>1024||!['width','height','screenWidth','screenHeight','pixelRatio'].every(k=>Number.isFinite(s[k])&&s[k]>0))throw Error('Invalid camera or screen settings');
 const record={model:numbers(value.model),setup:{...cameraSetupFields(s),deviceId:s.deviceId,...Object.fromEntries(['width','height','screenWidth','screenHeight','pixelRatio'].map(k=>[k,s[k]]))},validation:value.validation?numbers(value.validation):null,savedAt:Date.now()};
 if(value.cameraPresets!==undefined){
  if(!Array.isArray(value.cameraPresets)||value.cameraPresets.length>6||new Set(value.cameraPresets.map(s=>s?.deviceId+'|'+s?.lens+'|'+(s?.trackingMode||'face'))).size!==value.cameraPresets.length)throw Error('Invalid lens presets');
  record.cameraPresets=value.cameraPresets.map(s=>{
   if(s?.cameraVersion!==1||typeof s.deviceId!=='string'||s.deviceId.length>1024||!['width','height','screenWidth','screenHeight','pixelRatio'].every(k=>Number.isFinite(s[k])&&s[k]>0))throw Error('Invalid lens settings');
   return {...cameraSetupFields(s),deviceId:s.deviceId,...Object.fromEntries(['width','height','screenWidth','screenHeight','pixelRatio'].map(k=>[k,s[k]]))};
  });
 }
 if(value.headPositions!==undefined){
  const entries=value.headPositions;
  if(!Array.isArray(entries)||entries.length<1||entries.length>15||new Set(entries.map(e=>e?.id)).size!==entries.length||!entries.every(e=>Number.isInteger(e?.id)&&e.id>0&&validModel(e.model)))throw Error('Invalid saved head positions');
  if(!entries.some(e=>e.id===value.activePositionId))throw Error('Invalid active head position');
  record.headPositions=entries.map(e=>({id:e.id,model:numbers(e.model),validation:e.validation?numbers(e.validation):null,savedAt:Number.isFinite(e.savedAt)?e.savedAt:Date.now()}));
  record.activePositionId=value.activePositionId;
 }
 if(value.lensCalibrations!==undefined){
  const entries=value.lensCalibrations;
  if(!allowLensBank||!Array.isArray(entries)||entries.length>6||new Set(entries.map(e=>e?.setup?.deviceId+'|'+e?.setup?.lens+'|'+(e?.setup?.trackingMode||'face'))).size!==entries.length)throw Error('Invalid lens calibration bank');
  record.lensCalibrations=entries.map(e=>{
   if(e?.setup?.cameraVersion!==1||e.cameraPresets!==undefined)throw Error('Invalid lens calibration entry');
   const entry=calibrationRecord(e,validModel,false);entry.savedAt=Number.isFinite(e.savedAt)?e.savedAt:Date.now();return entry;
  });
 }
 if(JSON.stringify(record).length>786432)throw Error('Calibration data is too large');
 return record;
}
export class CalibrationStore {
 constructor(file,validModel){this.file=file;this.validModel=validModel;this.queue=Promise.resolve();}
 async read(){
  for(const file of [this.file,this.file+'.bak'])try{
   const data=JSON.parse(await fs.readFile(file,'utf8'));
   if(data.version!==1||!Array.isArray(data.profiles))continue;
   return {version:1,lastName:typeof data.lastName==='string'?data.lastName:'',profiles:data.profiles.filter(p=>typeof p.name==='string'&&p.name.trim()&&p.name.length<=40&&this.validModel(p.record?.model))};
  }catch{}
  return {version:1,lastName:'',profiles:[]};
 }
 change(name,value){
  const task=this.queue.then(async()=>{
   if(typeof name!=='string'||!name.trim()||name.trim().length>40)throw Error('Enter a profile name');
   name=name.trim();const key=name.toLocaleLowerCase(),record=value===null?null:calibrationRecord(value,this.validModel),data=await this.read();
   data.profiles=data.profiles.filter(p=>p.name.toLocaleLowerCase()!==key);
   if(record)data.profiles.push({name,record});
   if(data.profiles.length>100)throw Error('Too many saved profiles');
   data.lastName=record?name:(data.lastName.toLocaleLowerCase()===key?'':data.lastName);
   await fs.mkdir(path.dirname(this.file),{recursive:true});
   const payload=JSON.stringify(data,null,2);
   await fs.writeFile(this.file+'.tmp',payload,'utf8');
   await fs.rename(this.file+'.tmp',this.file);
   // Recovery copy also reflects deletions; deleted profiles cannot reappear.
   await fs.writeFile(this.file+'.bak',payload,'utf8');
   return record;
  });
  this.queue=task.catch(()=>{});return task;
 }
}
