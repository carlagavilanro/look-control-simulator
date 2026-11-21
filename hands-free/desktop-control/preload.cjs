const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktopControl',Object.freeze({
 openCameraSettings:()=>ipcRenderer.invoke('screen:camera-settings'),
 loadCalibrations:()=>ipcRenderer.invoke('screen:profiles'),
 saveCalibration:(name,record)=>ipcRenderer.invoke('screen:save-calibration',name,record),
 deleteCalibration:name=>ipcRenderer.invoke('screen:delete-calibration',name),
 saveDiagnostics:text=>ipcRenderer.invoke('screen:save-diagnostics',text),
 arm:()=>ipcRenderer.invoke('screen:arm'),pause:()=>ipcRenderer.invoke('screen:pause'),quit:()=>ipcRenderer.send('screen:quit'),
 readingMode:enabled=>ipcRenderer.invoke('screen:reading',enabled),
 readingPointer:interactive=>ipcRenderer.send('screen:reading-pointer',interactive),
 typingRegion:top=>ipcRenderer.invoke('screen:typing-region',top),
 heartbeat:valid=>ipcRenderer.send('screen:heartbeat',valid===true),
 command:payload=>ipcRenderer.invoke('screen:command',payload),capture:()=>ipcRenderer.invoke('screen:capture'),
 focusTargets:rebind=>ipcRenderer.invoke('screen:targets',rebind===true),
 activateTarget:(scope,id,rect)=>ipcRenderer.invoke('screen:target',scope,id,rect),
 openSite:(site,query)=>ipcRenderer.invoke('screen:site',site,query),
 onPause:callback=>ipcRenderer.on('screen:paused',()=>callback()),onToggle:callback=>ipcRenderer.on('screen:toggle',()=>callback())
}));
