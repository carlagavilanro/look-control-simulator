// The Windows app's link to the devices set up on the website (fan, TV, ...).
//
// The app's page may only talk to its own files, so these requests are made here, in the main
// process. The app is linked once: it asks the website for a six-digit code, the person types
// the code on the signed-in website, and the website gives the app a key of its own. The key
// is kept on this computer (see main.mjs) and is sent only to the website it came from.
// With it the app can list the devices, send their buttons, add a device and record a button.
// Renaming, removing and linking stay on the website.
import {randomBytes} from 'node:crypto';

const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
export function createDeviceLink({site,fetch,store,hostname=''}){
 const base=new URL(site);
 if(base.protocol!=='https:'&&base.hostname!=='127.0.0.1')throw Error('The website address must use https.');
 let key=null,loaded=false,pairing=null;
 const where=base.host;
 async function load(){if(!loaded){loaded=true;try{const saved=await store.read();key=typeof saved==='string'&&/^[A-Za-z0-9_-]{43}$/.test(saved)?saved:null;}catch{key=null;}}return key;}
 async function ask(route,method='GET',body,withKey=true){
  let response;
  try{response=await fetch(new URL(route,base).href,{method,headers:{...(withKey?{Authorization:'Bearer '+key}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});}
  catch(error){return {ok:false,status:0,message:error?.name==='TimeoutError'?'No answer from '+where+'. If a command was on its way, check the device before trying again.':where+' could not be reached. Check the internet connection.'};}
  let data={};try{data=await response.json();}catch{}
  if(!data||typeof data!=='object'||Array.isArray(data))data={};
  return {...data,ok:response.ok,status:response.status};
 }
 // A request that needs the key. A refused key means the app was removed on the website.
 async function linked(route,method,body){
  if(!await load())return {ok:false,status:0,unlinked:true,site:where,message:'This app is not linked to '+where+' yet.'};
  const result=await ask(route,method,body);
  if(result.status===401){key=null;try{await store.write(null);}catch{}return {ok:false,status:401,unlinked:true,site:where,message:'This app is no longer linked to '+where+'.'};}
  return result;
 }
 const actions={
  get:()=>linked('/api/hub'),
  send:p=>linked('/api/send','POST',{button_id:text(p?.button_id,40),request_id:randomBytes(16).toString('hex'),created_at:Date.now(),...(p?.confirm===true?{confirm:true}:{})}),
  add:p=>linked('/api/appliances','POST',{name:text(p?.name,32),kind:text(p?.kind,12)}),
  learn:p=>linked('/api/learn','POST',{applianceId:text(p?.applianceId,40),label:text(p?.label,24),...(p?.icon?{icon:text(p.icon,12)}:{})}),
  stop:()=>linked('/api/learn','DELETE'),
  // Linking: ask for a code, then keep asking whether it has been typed on the website.
  async link(){
   const started=await ask('/api/pair/start','POST',{kind:'app',name:text(hostname,32),firmware:'Hands Free Screen Control'},false);
   if(!started.ok||!/^\d{6}$/.test(started.code||'')||typeof started.secret!=='string'){pairing=null;return {ok:false,status:started.status,message:started.message||'The website did not give a link code. It may not have been updated yet.'};}
   pairing=started.secret;
   return {ok:true,code:started.code,site:where,seconds:Number(started.expires_in)||600};
  },
  async 'link-status'(){
   if(!pairing)return {ok:false,expired:true,message:'The link code has ended. Start again.'};
   const result=await ask('/api/pair/claim','POST',{secret:pairing},false);
   if(result.status===202)return {ok:true,linked:false};
   if(result.status===200&&/^[A-Za-z0-9_-]{43}$/.test(result.token||'')){
    key=result.token;loaded=true;pairing=null;
    try{await store.write(key);}catch{return {ok:true,linked:true,name:text(result.name,32),message:'Linked, but the key could not be saved on this computer: the app will ask to be linked again next time.'};}
    return {ok:true,linked:true,name:text(result.name,32)};
   }
   if(result.status===404){pairing=null;return {ok:false,expired:true,message:'The link code has ended. Start again.'};}
   return {ok:false,message:result.message||where+' could not be reached.'};
  }
 };
 return {site:where,call:(action,payload)=>Object.hasOwn(actions,action)?actions[action](payload):Promise.resolve({ok:false,status:0,message:'Unknown request.'})};
}
