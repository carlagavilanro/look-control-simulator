import {app,BrowserWindow,ipcMain,protocol,net,screen,desktopCapturer,globalShortcut,shell,session,safeStorage} from 'electron';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {checkCommand,siteUrl,InputGate,SWITCHES} from './input-policy.mjs';
import {CalibrationStore,saveDiagnostics} from './calibration-store.mjs';
import {createDeviceLink} from './device-link.mjs';
// The website whose devices (fan, TV, ...) this app can use, once it has been linked there by code.
const DEVICE_SITE='https://control.carla.codes';
const root=path.dirname(fileURLToPath(import.meta.url));
const assets=fs.existsSync(path.join(root,'public'))?path.join(root,'public'):path.resolve(root,'../website/public');
const gate=new InputGate(),pending=new Map();let win,helper,id=0,closing=false,hiddenForInput=false,typingTop=null;
const dryRun=process.argv.includes('--dry-run');
let accessibilityHelper=null,accessibilityReady=null,accessibleWindow=null,accessibilityAction=false,accessibilityGeneration=0,accessibleScope=null;
const accessibilityPending=new Map();let accessibilityId=0;
function stopAccessibility(){
 accessibilityHelper?.kill();accessibilityHelper=null;accessibilityReady=null;
 for(const p of accessibilityPending.values()){clearTimeout(p.timer);p.reject(Error('App controls are refreshing.'));}accessibilityPending.clear();
}
async function accessible(payload){
 if(!accessibilityHelper){
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'native-accessibility.ps1'),'-OwnerPid',String(process.pid),...(dryRun?['-DryRun']:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  accessibilityHelper=child;accessibilityGeneration++;
  accessibilityReady=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(Error('App controls are unavailable.'));if(accessibilityHelper===child)stopAccessibility();},15000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});child.stderr.on('data',()=>{});
   createInterface({input:child.stdout}).on('line',line=>{try{
    const data=JSON.parse(line);if(data.ready){clearTimeout(timer);resolve();return;}
    const p=accessibilityPending.get(data.id);if(p){clearTimeout(p.timer);accessibilityPending.delete(data.id);data.ok?p.resolve(data):p.reject(Error(data.error||'That control changed. Look again.'));}
   }catch{}});
   child.on('exit',()=>{clearTimeout(timer);reject(Error('App controls are unavailable.'));if(accessibilityHelper===child)stopAccessibility();});
  });
 }
 await accessibilityReady;
 return new Promise((resolve,reject)=>{
  const id=++accessibilityId,timer=setTimeout(()=>{accessibilityPending.delete(id);reject(Error('This app is not sharing its controls.'));stopAccessibility();},2500);
  accessibilityPending.set(id,{resolve,reject,timer});accessibilityHelper.stdin.write(JSON.stringify({...payload,id})+'\n');
 });
}
let readingMode=false;
function readingOverlay(enabled){
 readingMode=enabled;
 if(enabled)win.setIgnoreMouseEvents(true,{forward:true});else win.setIgnoreMouseEvents(false);
 win.setFocusable(!enabled);
}
protocol.registerSchemesAsPrivileged([{scheme:'handsfree',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(win){pause();win.show();win.focus();}});
 app.whenReady().then(start).catch(e=>{console.error(e.message);app.quit();});
}
function native(payload){return new Promise((resolve,reject)=>{
 if(!helper||helper.killed)return reject(Error('Windows input helper is unavailable'));
 const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('Windows input timed out.'));pause();},3000);
 pending.set(n,{resolve,reject,timer});helper.stdin.write(JSON.stringify({...payload,id:n})+'\n');
});}
async function start(){
 if(process.platform!=='win32')throw Error('This companion currently supports Windows only.');
 const {validModel}=await import(pathToFileURL(path.join(assets,'screen-gaze.mjs')).href);
 const calibrations=new CalibrationStore(path.join(app.getPath('userData'),'calibrations.json'),validModel);
 await new Promise((resolve,reject)=>{
  helper=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'native-input.ps1'),'-OwnerPid',String(process.pid),...(dryRun?['-DryRun']:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const timeout=setTimeout(()=>reject(Error('Windows input helper did not start')),15000);
  helper.once('error',reject);helper.stderr.on('data',data=>console.error(String(data).slice(0,400)));
  createInterface({input:helper.stdout}).on('line',line=>{try{const m=JSON.parse(line);if(m.ready){clearTimeout(timeout);resolve();return;}const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.ok?p.resolve(m):p.reject(Error(m.error||'Input failed'));}}catch{}});
  helper.on('exit',()=>{clearTimeout(timeout);gate.pause();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Windows input stopped'));}pending.clear();if(!closing)win?.webContents.send('screen:paused');});
 });
 protocol.handle('handsfree',request=>{
  const u=new URL(request.url);let name;try{name=decodeURIComponent(u.pathname);}catch{return new Response('Invalid path',{status:400});}
  if(u.host!=='control'||name.includes('..')||name.includes('\\'))return new Response('Not found',{status:404});
  const allowed=/^\/(screen(?:-app|-gaze|-worker|-eye-overlay|-positions|-targets|-camera|-typing|-eye-crop|-iris-detail|-face-detail)?\.(?:html|css|mjs)|vendor\/[a-zA-Z0-9_.-]+)$/;
  if(!allowed.test(name))return new Response('Not found',{status:404});
  return net.fetch(pathToFileURL(path.join(assets,name.slice(1))).href);
 });
 session.defaultSession.webRequest.onHeadersReceived((details,cb)=>cb({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':["default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"]}}));
 session.defaultSession.setPermissionRequestHandler((wc,permission,callback,details)=>callback(wc===win?.webContents&&(permission==='media'&&details.mediaTypes?.every(t=>t==='video')||permission==='cameraPanTiltZoom')&&details.requestingUrl?.startsWith('handsfree://control/')));
 session.defaultSession.setPermissionCheckHandler((wc,permission,origin,details)=>wc===win?.webContents&&(permission==='cameraPanTiltZoom'||permission==='media'&&details.mediaType!=='audio')&&['handsfree://control','handsfree://control/'].includes(origin));
 const display=screen.getPrimaryDisplay();
 win=new BrowserWindow({...display.bounds,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,alwaysOnTop:true,show:false,title:'Hands Free Screen Control',webPreferences:{preload:path.join(root,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.setMenuBarVisibility(false);win.setAlwaysOnTop(true,'screen-saver');
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('will-attach-webview',e=>e.preventDefault());
 win.webContents.on('render-process-gone',()=>pause());win.on('unresponsive',()=>pause());
 win.on('closed',()=>app.quit());
 const trusted=e=>{if(e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||!e.senderFrame.url.startsWith('handsfree://control/'))throw Error('Untrusted control request');};
 ipcMain.handle('screen:typing-region',async(e,top)=>{
  trusted(e);const {width,height}=win.getContentBounds();
  if(top!==null&&(!Number.isFinite(top)||top<0||top>height-44))throw Error('Invalid typing region');
  // Clip drawing and hit testing without resizing the calibrated viewport.
  win.setShape(top===null?[]:[{x:0,y:Math.floor(top),width,height:height-Math.floor(top)}]);typingTop=top;return true;
 });
 ipcMain.handle('screen:camera-settings',async e=>{trusted(e);gate.pause();globalShortcut.unregister('Escape');readingOverlay(false);win.minimize();await shell.openExternal('ms-settings:camera');return true;});
 ipcMain.handle('screen:profiles',async e=>{trusted(e);return calibrations.read();});
 ipcMain.handle('screen:save-calibration',async(e,name,record)=>{trusted(e);return calibrations.change(name,record);});
 ipcMain.handle('screen:delete-calibration',async(e,name)=>{trusted(e);await calibrations.change(name,null);return true;});
 // Written only when Save diagnostics is pressed: beside the app when that
 // folder can be written, otherwise with the app's own data.
 ipcMain.handle('screen:save-diagnostics',async(e,text)=>{trusted(e);return saveDiagnostics([...(app.isPackaged?[path.join(path.dirname(process.execPath),'diagnostics')]:[]),path.join(app.getPath('userData'),'diagnostics')],text);});
 ipcMain.on('screen:quit',e=>{trusted(e);app.quit();});
 // Arming selections must not switch the foreground app or alter the camera
 // window. Native actions already hide the overlay before sending input.
 ipcMain.handle('screen:arm',async e=>{trusted(e);readingOverlay(false);gate.arm();globalShortcut.register('Escape',()=>pause());return true;});
 ipcMain.handle('screen:pause',async e=>{trusted(e);gate.pause();if(accessibilityAction)stopAccessibility();readingOverlay(false);globalShortcut.unregister('Escape');await native({type:'remember'}).catch(()=>{});return true;});
 ipcMain.handle('screen:reading',async(e,enabled)=>{
  trusted(e);if(typeof enabled!=='boolean')throw Error('Invalid reading mode');
  gate.pause();globalShortcut.unregister('Escape');readingOverlay(enabled);return true;
 });
 ipcMain.on('screen:reading-pointer',(e,interactive)=>{
  try{trusted(e);if(readingMode&&typeof interactive==='boolean'){if(interactive)win.setIgnoreMouseEvents(false);else win.setIgnoreMouseEvents(true,{forward:true});}}catch{}
 });
 ipcMain.on('screen:heartbeat',(e,valid)=>{try{trusted(e);gate.heartbeat(valid===true);}catch{gate.pause();}});
 ipcMain.handle('screen:targets',async(e,rebind)=>{
  trusted(e);if(typeof rebind!=='boolean')throw Error('Invalid app selection');
  if(!accessibleWindow||rebind){
   if(hiddenForInput||gate.busy)throw Error('Wait for the previous action.');
   hiddenForInput=true;
   try{win.hide();await new Promise(r=>setTimeout(r,100));await native({type:'remember'});accessibleWindow=(await native({type:'target'})).window;}
   finally{hiddenForInput=false;if(!win.isDestroyed())win.showInactive();}
  }
  const result=await accessible({type:'snapshot',window:accessibleWindow}),scale=screen.getPrimaryDisplay().scaleFactor;
  accessibleWindow=result.window;accessibleScope=accessibilityGeneration+':'+result.scope+':'+result.window;
  return {...result,scope:accessibleScope,targets:result.targets.map(t=>({...t,rect:Object.fromEntries(Object.entries(t.rect).map(([k,v])=>[k,v/scale]))}))};
 });
 ipcMain.handle('screen:target',async(e,scope,target,rect)=>{
  trusted(e);
  if(typeof scope!=='string'||scope!==accessibleScope||scope.split(':')[0]!==String(accessibilityGeneration)||scope.split(':')[2]!==accessibleWindow||typeof target!=='string'||target.length>180||!rect||!['left','right','top','bottom'].every(k=>Number.isFinite(rect[k]))||rect.right<=rect.left||rect.bottom<=rect.top)throw Error('Invalid focused control');
  const epoch=gate.begin(),scale=screen.getPrimaryDisplay().scaleFactor;
  try{
   accessibilityAction=true;hiddenForInput=true;win.hide();await new Promise(r=>setTimeout(r,100));gate.recheck(epoch);
   const result=await accessible({type:'activate',scope:Number(scope.split(':')[1]),target,rect:Object.fromEntries(['left','right','top','bottom'].map(k=>[k,rect[k]*scale])),expires:Date.now()+600});
   gate.recheck(epoch);if(result.needsEnter){await native({type:'key',key:'enter'});}await native({type:'remember'});
   return result;
  }finally{accessibilityAction=false;hiddenForInput=false;gate.finish();if(!win.isDestroyed())win.showInactive();}
 });
 ipcMain.handle('screen:command',async(e,p)=>{
  trusted(e);const command=checkCommand(p),epoch=gate.begin();
  // While the typing keyboard is up, this window is cut down to the keyboard and does not hold
  // the keyboard focus. Letters can then go to the app without the keyboard leaving the screen
  // for each one. If the app cannot be given the focus that way, the window is hidden as before.
  const quiet=typingTop!==null&&(command.type==='text'||command.type==='key'&&['backspace','enter','tab','shifttab'].includes(command.key));
  const hide=async()=>{hiddenForInput=true;win.hide();await new Promise(r=>setTimeout(r,100));gate.recheck(epoch);};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  try{
   if(command.type==='key'&&command.key==='escape')globalShortcut.unregister('Escape');
   if(!quiet)await hide();
   await native({type:'remember'});
   if(command.type!=='click'){
    try{await native({type:'restore'});}
    catch(error){if(hiddenForInput)throw error;await hide();await native({type:'remember'});await native({type:'restore'});}
   }
   gate.recheck(epoch);
   if(command.type==='launch'){
    // Windows' own search: the Windows key opens it, the name is typed, Enter opens the first
    // result. Once begun it is finished: stopping half way would leave the search open.
    await native({type:'key',key:'start'});await wait(900);
    await native({type:'text',text:command.text});await wait(1500);
    const opened=await native({type:'key',key:'enter'});accessibleWindow=null;return opened;
   }
   const result=await native(command);
   if(command.type==='key'&&SWITCHES.has(command.key))accessibleWindow=null;
   return result;
  }
  finally{hiddenForInput=false;gate.finish();if(gate.armed)globalShortcut.register('Escape',()=>pause());if(!win.isDestroyed())win.showInactive();}
 });
 ipcMain.handle('screen:capture',async e=>{
  trusted(e);const epoch=gate.begin();
  try{
   hiddenForInput=true;win.hide();await new Promise(r=>setTimeout(r,160));gate.recheck(epoch);
   const d=screen.getPrimaryDisplay(),sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(d.size.width*d.scaleFactor),height:Math.round(d.size.height*d.scaleFactor)}});
   const source=sources.find(s=>s.display_id===String(d.id));if(!source||source.thumbnail.isEmpty())throw Error('The primary screen could not be captured.');
   gate.recheck(epoch);return source.thumbnail.toDataURL();
  }finally{hiddenForInput=false;gate.finish();if(!win.isDestroyed())win.showInactive();}
 });
 // These three fixed websites also work as ordinary mouse-operated shortcuts.
 // Desktop clicks, typing and capture still require armed, fresh gaze tracking.
 // Devices set up on the website. The key the website gave this app is kept in the app's own
 // folder, encrypted for this Windows account; without that protection it is not kept at all.
 const keyFile=path.join(app.getPath('userData'),'device-link.bin');
 const deviceLink=createDeviceLink({site:DEVICE_SITE,fetch:(url,options)=>net.fetch(url,options),store:{
  read:async()=>safeStorage.isEncryptionAvailable()?safeStorage.decryptString(await fs.promises.readFile(keyFile)):null,
  write:async value=>{if(value===null){await fs.promises.rm(keyFile,{force:true});return;}if(!safeStorage.isEncryptionAvailable())throw Error('This computer cannot protect the key.');await fs.promises.writeFile(keyFile,safeStorage.encryptString(value));}}});
 ipcMain.handle('screen:devices',async(e,action,payload)=>{trusted(e);return deviceLink.call(String(action),payload);});
 ipcMain.handle('screen:site',async(e,site,query)=>{trusted(e);const url=siteUrl(site,query);accessibleWindow=null;if(dryRun)return {dryRun:true,url};await shell.openExternal(url);return true;});
 globalShortcut.register('CommandOrControl+Alt+P',()=>{if(gate.armed)pause();else win.webContents.send('screen:toggle');});
 globalShortcut.register('CommandOrControl+Alt+Q',()=>app.quit());
 screen.on('display-metrics-changed',(_e,changed,metrics)=>{if(changed.id===screen.getPrimaryDisplay().id&&metrics.some(m=>['bounds','scaleFactor','rotation'].includes(m))){pause();win.setBounds(screen.getPrimaryDisplay().bounds);}});
 screen.on('display-removed',()=>pause());
 setInterval(()=>{if(gate.armed&&gate.lastValid&&Date.now()-gate.lastValid>900){gate.heartbeat(false);}},200).unref();
 if(!dryRun){
  if(app.isPackaged)app.setAsDefaultProtocolClient('icontrol-eyes');
  else app.setAsDefaultProtocolClient('icontrol-eyes',process.execPath,[root]);
 }
 await win.loadURL('handsfree://control/screen.html');win.show();
}
function pause(){gate.pause();if(accessibilityAction)stopAccessibility();globalShortcut.unregister('Escape');typingTop=null;if(win&&!win.isDestroyed()){win.setShape([]);readingOverlay(false);if(!hiddenForInput)win.showInactive();win.webContents.send('screen:paused');}}
app.on('before-quit',()=>{closing=true;gate.pause();helper?.kill();stopAccessibility();});
app.on('will-quit',()=>globalShortcut.unregisterAll());
app.on('window-all-closed',()=>app.quit());
