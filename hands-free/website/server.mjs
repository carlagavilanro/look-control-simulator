import {createReadStream} from 'node:fs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(fs.readFileSync(process.env.CONTROL_CONFIG||path.join(root,'config.local.json'),'utf8'));
if(!config.uiToken||config.uiToken.length<24||!config.espToken||!config.espUrl)throw Error('Provide config.local.json with espUrl, espToken and a unique uiToken of at least 24 characters.');
const commands=new Set(['captured_power','captured_level_down','captured_level_up','captured_mode','captured_silence','captured_turn','captured_timer','tv_power','tv_volume_down','tv_volume_up','tv_mute','tv_channel_down','tv_channel_up','tv_input']);
let sending=false,lastSent=0;
const seen=new Map();
function authorized(req){const a=Buffer.from(req.headers.authorization||''),b=Buffer.from('Bearer '+config.uiToken);return a.length===b.length&&timingSafeEqual(a,b);}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
const publicFiles={'/screen-eye-crop.mjs':'screen-eye-crop.mjs','/screen-iris-detail.mjs':'screen-iris-detail.mjs','/screen-face-detail.mjs':'screen-face-detail.mjs','/screen-typing.mjs':'screen-typing.mjs','/screen-camera.mjs':'screen-camera.mjs','/screen-profile.mjs':'screen-profile.mjs','/screen-devices.mjs':'screen-devices.mjs','/screen':'screen.html','/screen.html':'screen.html','/screen.css':'screen.css','/screen-app.mjs':'screen-app.mjs','/screen-positions.mjs':'screen-positions.mjs','/screen-targets.mjs':'screen-targets.mjs','/screen-gaze.mjs':'screen-gaze.mjs','/screen-worker.mjs':'screen-worker.mjs','/screen-eye-overlay.mjs':'screen-eye-overlay.mjs','/':'index.html','/app.mjs':'app.mjs','/eye-selection.mjs':'eye-selection.mjs','/style.css':'style.css','/vision-worker.mjs':'vision-worker.mjs'};
const mime={'.html':'text/html','.json':'application/json','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.task':'application/octet-stream'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      if(!authorized(req))return send(res,401,{message:'Incorrect access key.'});
      if(url.pathname==='/api/status'&&req.method==='GET'){
        const r=await fetch(new URL('/api/status',config.espUrl),{signal:AbortSignal.timeout(5000)});
        const s=await r.json();return send(res,r.status,{practice:s.practice,online:r.ok,commands:Array.isArray(s.commands)?s.commands.filter(c=>commands.has(c)):[...commands].filter(c=>c.startsWith('captured_'))});
      }
      if(url.pathname!=='/api/command'||req.method!=='POST')return send(res,404,{message:'Not found.'});
      let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return send(res,413,{message:'Request too large.'});}
      let data;try{data=JSON.parse(body);}catch{return send(res,400,{message:'Invalid request.'});}
      if(!commands.has(data.command)||!/^[a-f0-9]{32}$/.test(data.request_id||'')||!Number.isFinite(data.created_at)||Math.abs(Date.now()-data.created_at)>10000)return send(res,400,{message:'Unknown, malformed or expired command.'});
      if(data.command.startsWith('tv_')){
        const status=await fetch(new URL('/api/status',config.espUrl),{signal:AbortSignal.timeout(5000)});
        const loaded=await status.json();
        if(!status.ok||!Array.isArray(loaded.commands)||!loaded.commands.includes(data.command))return send(res,409,{message:'Capture and upload this TV signal before sending it.'});
      }
      for(const [id,time]of seen)if(Date.now()-time>60000)seen.delete(id);
      if(seen.has(data.request_id))return send(res,409,{message:'Duplicate command rejected.'});
      if(sending||Date.now()-lastSent<800)return send(res,429,{message:'Wait before sending another command.'});
      seen.set(data.request_id,Date.now());sending=true;lastSent=Date.now();
      try{
        const r=await fetch(new URL('/api/command',config.espUrl),{method:'POST',headers:{'X-Control-Token':config.espToken},body:new URLSearchParams({command:data.command,request_id:data.request_id}),signal:AbortSignal.timeout(5000)});
        const result=await r.json();send(res,r.status,{message:result.message});
      }finally{sending=false;}
      return;
    }
   if(url.pathname==='/downloads/Hands-Free-Screen-Control-Windows.zip'&&['GET','HEAD'].includes(req.method)){
    const zip=path.join(root,'public','downloads','Hands-Free-Screen-Control-Windows.zip');
    const stat=await fs.promises.stat(zip);
    res.writeHead(200,{'Content-Type':'application/zip','Content-Length':stat.size,'Content-Disposition':'attachment; filename="Hands-Free-Screen-Control-Windows.zip"'});
    if(req.method==='HEAD')res.end();else{const stream=createReadStream(zip);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}return;
   }
    let file=publicFiles[url.pathname];
    if(!file&&/^\/vendor\/[a-zA-Z0-9_.-]+$/.test(url.pathname))file=url.pathname.slice(1);
    if(!file||req.method!=='GET')return send(res,404,{message:'Not found.'});
    const data=await fs.promises.readFile(path.join(root,'public',file));
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Cache-Control':'no-store','Permissions-Policy':'camera=(self), microphone=()'});res.end(data);
  }catch(error){send(res,502,{message:'No controller confirmation. Check the appliance before retrying.'});}
});
server.listen(config.port||8787,config.host||'127.0.0.1',()=>console.log(`Tablet control gateway: http://127.0.0.1:${config.port||8787}. No video is received or stored by this server.`));
