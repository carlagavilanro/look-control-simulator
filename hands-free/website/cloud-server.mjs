import {createReadStream,readFileSync} from 'node:fs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createHub} from './hub.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const digest=value=>createHash('sha256').update(value).digest();
const equal=(a,b)=>timingSafeEqual(digest(a),digest(b));
const lifetime=12*60*60*1000;
const mime={'.html':'text/html; charset=utf-8','.json':'application/json','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.task':'application/octet-stream','.ttf':'font/ttf','.txt':'text/plain'};
const files={'/screen-eye-crop.mjs':'screen-eye-crop.mjs','/screen-iris-detail.mjs':'screen-iris-detail.mjs','/screen-face-detail.mjs':'screen-face-detail.mjs','/screen-typing.mjs':'screen-typing.mjs','/screen-camera.mjs':'screen-camera.mjs','/screen':'screen.html','/screen.html':'screen.html','/screen.css':'screen.css','/screen-app.mjs':'screen-app.mjs','/screen-positions.mjs':'screen-positions.mjs','/screen-targets.mjs':'screen-targets.mjs','/screen-gaze.mjs':'screen-gaze.mjs','/screen-worker.mjs':'screen-worker.mjs','/screen-eye-overlay.mjs':'screen-eye-overlay.mjs','/':'index.html','/app.mjs':'app.mjs','/cloud-mode.mjs':'cloud-mode.mjs','/eye-selection.mjs':'eye-selection.mjs','/vision-worker.mjs':'vision-worker.mjs','/style.css':'style.css','/setup':'setup.html','/setup.html':'setup.html','/setup.mjs':'setup.mjs','/setup.css':'setup.css','/screen-site.mjs':'screen-site.mjs','/screen-profile.mjs':'screen-profile.mjs'};
// The fan buttons a new site starts with: the seven recordings the transmitter already carries.
function fanSeed(){try{return JSON.parse(readFileSync(path.join(root,'fan-signals.json'),'utf8'));}catch{return null;}}
const login=error=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Hands Free</title><link rel="stylesheet" href="/style.css"><style>body{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}.login{width:440px;max-width:100%;margin:0;padding:36px;border:1px solid var(--border);border-radius:24px;background:white}.login h1{font-size:36px;letter-spacing:-1.4px;margin:20px 0 12px}.login p{line-height:1.65;color:var(--muted)}.login label{margin-top:20px}.login button{width:100%;margin-top:24px}.login .error{color:#a12d43;font-weight:700}</style></head><body><main class="login"><a class="wordmark" href="/">Hands Free</a><h1>Sign in</h1><p>Enter your username and password.</p>${error?'<p class="error" role="alert">Incorrect username or password. Please try again.</p>':''}<form action="/login" method="post"><label for="username">Username</label><input id="username" name="username" autocomplete="username" maxlength="100" required autofocus><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required><button class="primary-button" type="submit">Sign in →</button></form><p>Your camera stays on your device. No video is uploaded or stored.</p></main></body></html>`;

// Built from the repository, the site holds no copy of the Windows app (it is far too large to commit).
// The repository's build publishes it as a release, and the download link is sent there.
const releaseDownload='https://github.com/carlagavilanro/look-control-simulator/releases/latest/download/Hands-Free-Screen-Control-Windows.zip';
export function createCloudServer({username,password,secureCookies=true,downloadUrl=releaseDownload,dataDir=null,persistent=false,hub=createHub({dataDir,persistent,seed:fanSeed()})}){
 if(!username||username.length>100||!password||password.length<24)throw Error('Set SITE_USERNAME and a random SITE_PASSWORD of at least 24 characters before cloud startup.');
 const sessions=new Map(),attempts=new Map();
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 const redirect=(res,to)=>{res.writeHead(303,{Location:to});res.end();};
 const cookie=(value,age)=>`look_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies?'; Secure':''}`;
 const peerOf=req=>{const peer=req.socket.remoteAddress||'unknown';return process.env.RAILWAY_ENVIRONMENT_ID?(req.headers['x-forwarded-for']||peer).split(',').at(-1).trim():peer;};
 async function read(req,limit){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>limit)throw Object.assign(Error('large'),{status:413});}try{const data=JSON.parse(body||'{}');if(!data||typeof data!=='object'||Array.isArray(data))throw 0;return data;}catch{throw Object.assign(Error('json'),{status:400});}}
 const answer=(res,result)=>result.status===204?(res.writeHead(204),res.end()):json(res,result.status,result.body);
 const sameOrigin=req=>{try{return !!req.headers.origin&&new URL(req.headers.origin).host===req.headers.host&&req.headers['sec-fetch-site']!=='cross-site';}catch{return false;}};
 // Boards and the Windows app: no cookie, a key of their own (made when they were linked).
 async function deviceApi(req,res,url){
  const route=req.method+' '+url.pathname;
  if(route==='POST /api/pair/start'){const body=await read(req,1024);return answer(res,hub.pairStart({kind:body.kind,name:body.name,firmware:body.firmware,from:peerOf(req)}));}
  if(route==='POST /api/pair/claim'){const body=await read(req,1024);return answer(res,hub.pairClaim(body.secret));}
  const device=hub.authDevice(req.headers.authorization);
  if(!device)return json(res,401,{message:'This board or app is not linked to the website (or was removed). Link it again.'});
  if(route==='GET /api/device/hello')return json(res,200,{kind:device.kind,name:device.name});
  if(route==='POST /api/device/recordings'){const age=Number(req.headers['x-capture-age-ms']);return answer(res,await hub.addRecording(device,await read(req,32768),req.headers['x-capture-age-ms']===undefined?null:age));}
  if(route==='GET /api/device/next'){
   const wait=Number(url.searchParams.get('wait')),pending=hub.nextCommand(device,Number.isFinite(wait)?wait*1000:undefined,req.headers['x-practice']==='1');
   res.on('close',()=>pending.cancel?.());return answer(res,await pending);
  }
  if(route==='POST /api/device/done')return answer(res,hub.commandDone(device,await read(req,1024)));
  return json(res,404,{message:'Not found.'});
 }
 // The pages (signed in) and a linked Windows app. The app may use the devices and set one up.
 async function userApi(req,res,url,signedIn){
  const route=req.method+' '+url.pathname,part=url.pathname.split('/');
  if(route==='GET /api/hub')return json(res,200,hub.view({full:signedIn}));
  if(route==='POST /api/send')return answer(res,await hub.send(await read(req,1024)));
  // Setting up a device: add it, then record its buttons one by one. Open to the app as well,
  // so it can be done by eye. Renaming, removing and linking stay with the signed-in website.
  if(route==='POST /api/appliances')return answer(res,await hub.addAppliance(await read(req,1024)));
  if(route==='POST /api/learn')return answer(res,hub.startLearning(await read(req,1024)));
  if(route==='DELETE /api/learn')return answer(res,hub.stopLearning());
  if(!signedIn)return json(res,403,{message:'Sign in on the website to change this.'});
  if(route==='POST /api/pair/approve'){const body=await read(req,1024);return answer(res,await hub.pairApprove(body.code,body.name));}
  if(part.length===4&&part[3]){
   const target=decodeURIComponent(part[3]);
   if(part[2]==='appliances'&&req.method==='PATCH')return answer(res,await hub.changeAppliance(target,await read(req,1024)));
   if(part[2]==='appliances'&&req.method==='DELETE')return answer(res,await hub.removeAppliance(target));
   if(part[2]==='buttons'&&req.method==='PATCH')return answer(res,await hub.changeButton(target,await read(req,1024)));
   if(part[2]==='buttons'&&req.method==='DELETE')return answer(res,await hub.removeButton(target));
   if(part[2]==='recordings'&&req.method==='DELETE')return answer(res,await hub.removeRecording(target));
   if(part[2]==='devices'&&req.method==='PATCH')return answer(res,await hub.renameDevice(target,(await read(req,1024)).name));
   if(part[2]==='devices'&&req.method==='DELETE')return answer(res,await hub.removeDevice(target));
  }
  if(part.length===5&&part[2]==='appliances'&&part[4]==='buttons'&&req.method==='POST'){const body=await read(req,1024);return answer(res,await hub.addButton(decodeURIComponent(part[3]),{label:body.label,icon:body.icon,carrier_khz:body.carrier_khz,recordingId:body.recording_id}));}
  return json(res,404,{message:'Not found.'});
 }
 function session(req){const token=/(?:^|;\s*)look_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];return token&&sessions.get(token)>Date.now()?token:null;}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  // The site's pages may be shown inside its own Screen control (to be used by eye), nowhere else.
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(self), microphone=()');
  if(secureCookies)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/healthz'&&req.method==='GET')return json(res,200,{ok:true});
   await hub.ready;
   if(url.pathname.startsWith('/api/device/')||url.pathname==='/api/pair/start'||url.pathname==='/api/pair/claim')return await deviceApi(req,res,url);
   const now=Date.now();
   for(const [key,expires]of sessions)if(expires<=now)sessions.delete(key);
   for(const [key,value]of attempts)if(value.until<=now)attempts.delete(key);
   if(url.pathname==='/login'&&req.method==='GET'){
    res.writeHead(200,{'Content-Type':mime['.html']});return res.end(login(false));
   }
   if((url.pathname==='/login'||url.pathname==='/logout')&&req.method==='POST'){
    // Browser form submissions must come from this same HTTPS origin.
    if(!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{message:'Please submit from this website.'});
    if(url.pathname==='/logout'){
     sessions.delete(session(req));res.setHeader('Set-Cookie',cookie('',0));return redirect(res,'/login');
    }
    const key=peerOf(req);
    const entry=attempts.get(key)||{count:0,until:now+15*60*1000};
    if(entry.count>=10){res.setHeader('Retry-After',String(Math.ceil((entry.until-now)/1000)));return json(res,429,{message:'Too many sign-in attempts. Please try again later.'});}
    if(attempts.size>=10000&&!attempts.has(key))return json(res,429,{message:'Sign-in is busy. Please try again later.'});
    entry.count++;attempts.set(key,entry);
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return json(res,413,{message:'Request too large.'});}
    const data=new URLSearchParams(body);
    const userOK=equal(data.get('username')||'',username),passOK=equal(data.get('password')||'',password);
    if(!userOK||!passOK){res.writeHead(401,{'Content-Type':mime['.html']});return res.end(login(true));}
    if(sessions.size>=1000)return json(res,503,{message:'Sign-in is busy. Please try again later.'});
    const token=randomBytes(32).toString('hex');sessions.set(token,now+lifetime);attempts.delete(key);
    res.setHeader('Set-Cookie',cookie(token,lifetime/1000));return redirect(res,'/');
   }
   // Only login styling/fonts and liveness are public; the app/model require a session.
   const loginAsset=url.pathname==='/style.css'||/^\/vendor\/manrope-\d+\.ttf$/.test(url.pathname);
   const signedIn=!!session(req);
   if(!loginAsset&&!signedIn){
    // A linked Windows app may use the devices and set one up; see userApi.
    if(url.pathname.startsWith('/api/')&&req.headers.authorization){
     if(hub.authDevice(req.headers.authorization)?.kind!=='app')return json(res,401,{message:'This app is not linked to the website (or was removed). Link it again.'});
     return await userApi(req,res,url,false);
    }
    if(url.pathname.startsWith('/api/'))return json(res,401,{message:'Please sign in again.'});
    return redirect(res,'/login');
   }
   if(url.pathname.startsWith('/api/')){
    // Changes made with the sign-in cookie must come from this website's own pages.
    if(req.method!=='GET'&&!sameOrigin(req))return json(res,403,{message:'Please use this website\'s own pages.'});
    return await userApi(req,res,url,true);
   }
   if(url.pathname==='/downloads/Hands-Free-Screen-Control-Windows.zip'&&['GET','HEAD'].includes(req.method)){
    const zip=path.join(root,'public','downloads','Hands-Free-Screen-Control-Windows.zip');
    const stat=await fs.stat(zip).catch(()=>null);
    if(!stat){res.writeHead(302,{Location:downloadUrl});return res.end();}
    res.writeHead(200,{'Content-Type':'application/zip','Content-Length':stat.size,'Content-Disposition':'attachment; filename="Hands-Free-Screen-Control-Windows.zip"'});
    if(req.method==='HEAD')res.end();else{const stream=createReadStream(zip);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}return;
   }
   let file=files[url.pathname];
   if(!file&&/^\/vendor\/[a-zA-Z0-9_.-]+$/.test(url.pathname))file=url.pathname.slice(1);
   if(!file||!['GET','HEAD'].includes(req.method))return json(res,404,{message:'Not found.'});
   let content=await fs.readFile(path.join(root,'public',file));
   if(file==='index.html')content=Buffer.from(content.toString().replace('src="/app.mjs"','src="/cloud-mode.mjs"'));
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});
   res.end(req.method==='HEAD'?undefined:content);
  }catch(error){if(res.headersSent)return res.destroy();json(res,error.status===413?413:error.code==='ENOENT'?404:400,{message:error.status===413?'Request too large.':error.code==='ENOENT'?'Not found.':'Request could not be completed.'});}
 });
 server.on('close',()=>hub.close());
 server.hub=hub;
 return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createCloudServer({username:process.env.SITE_USERNAME,password:process.env.SITE_PASSWORD,...(/^https:\/\//.test(process.env.DOWNLOAD_URL||'')?{downloadUrl:process.env.DOWNLOAD_URL}:{}),
  // Railway names the folder of an attached volume. Without one the setup is kept only until the next restart, and the Setup page says so.
  dataDir:process.env.DATA_DIR||process.env.RAILWAY_VOLUME_MOUNT_PATH||path.join(root,'data'),persistent:!!(process.env.DATA_DIR||process.env.RAILWAY_VOLUME_MOUNT_PATH)});
 server.listen(Number(process.env.PORT||8787),process.env.HOST||'0.0.0.0',()=>console.log('Hands Free website ready. Boards and the app connect to it; it stores no video.'));
 process.on('SIGTERM',()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),10000).unref();});
}
