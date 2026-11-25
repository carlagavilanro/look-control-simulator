// Names and pictures for devices and their buttons, shared by the Setup page and Screen control
// (in the browser and in the Windows app), so a device looks the same and is set up with the same
// suggestions wherever it is done.
// [button name, picture]. The pictures are the website's own (hub.mjs: ICONS).
export const SUGGESTIONS={
 fan:[['On/off','power'],['Speed up','plus'],['Speed down','minus'],['Mode','mode'],['Turn','turn'],['Timer','timer'],['Silence','silence']],
 tv:[['On/off','power'],['Volume up','plus'],['Volume down','minus'],['Mute','silence'],['Channel up','up'],['Channel down','down'],['Input','input'],['OK','ok'],['Up','up'],['Down','down'],['Left','left'],['Right','right'],['Back','left'],['Home','dot']],
 heater:[['On/off','power'],['Warmer','plus'],['Cooler','minus'],['Mode','mode'],['Timer','timer'],['Turn','turn']],
 light:[['On','light'],['Off','power'],['Brighter','plus'],['Dimmer','minus']],
 other:[['On/off','power'],['On','power'],['Off','power'],['Up','up'],['Down','down'],['Mode','mode']]};
export const KINDS=[['Fan','fan'],['TV','tv'],['Heater','heater'],['Light','light'],['Other','other']];
export const KIND_ICON={fan:'fan',tv:'tv',heater:'heat',light:'light',other:'dot'};
const PICTURES=['power','minus','plus','up','down','left','right','ok','mode','silence','turn','timer','input','light','heat','fan','tv','dot'];
export const picture=name=>PICTURES.includes(name)?name:'dot';
// The picture for a button from its name: a suggested name has its own; otherwise a guess.
export function buttonIcon(label,kind){
 const text=String(label||'').trim().toLowerCase(),all=[...(Object.hasOwn(SUGGESTIONS,kind)?SUGGESTIONS[kind]:[]),...Object.values(SUGGESTIONS).flat()];
 return all.find(([name])=>name.toLowerCase()===text)?.[1]||(/(^|\W)(on|off|power)(\W|$)/.test(text)?'power':/up|\+|more|warm|bright|loud/.test(text)?'plus':/down|-|less|cool|dim|quiet/.test(text)?'minus':/mute|silen/.test(text)?'silence':/time/.test(text)?'timer':'dot');
}
// Suggested names the device does not have yet.
export function missingButtons(appliance,most=8){
 const have=new Set((appliance.buttons||[]).map(b=>b.label.toLowerCase()));
 return (Object.hasOwn(SUGGESTIONS,appliance.kind)?SUGGESTIONS[appliance.kind]:SUGGESTIONS.other).filter(([name])=>!have.has(name.toLowerCase())).slice(0,most);
}
// What to say when a recorded button may not be right: only part of the signal was caught (told
// from the device's other buttons), the same signal was already arriving by itself before Record
// was pressed (a sensor light, another remote in the room), or it is the signal of a button the
// device already has.
export function learnedWarning(learned){
 if(!learned)return '';
 if(learned.partial)return 'Careful: this looks like only part of the signal ('+learned.partial.timings+' timings, '+(learned.partial.protocol?'and not recognised as '+learned.partial.protocol+' like this device\'s other buttons':'shorter than this device\'s other buttons')+'). Try the button. If the device does not react, record it again: hold the remote still and close to the sensor, press once, and leave a second or two after any earlier press.';
 if(learned.heardBefore>0)return 'Careful: this same signal reached the receiver '+(learned.heardBefore===1?'once':learned.heardBefore+' times')+' in the two minutes before Record was pressed, so it may come from something else in the room and not from the remote. Try the button. If the device does not react, cover the receiver from other light, hold the remote close, and record it again.';
 if(learned.sameAs?.length)return 'This is the same signal as '+learned.sameAs.join(', ')+'. If the wrong button was pressed, record it again.';
 return '';
}

// ---- holding a button down ---------------------------------------------------------------------
// The buttons the website marks `hold` (volume, channel, arrows) keep sending while they are held:
// with the mouse or a finger, or in Screen control by looking at them. The website sends a held
// button as one signal of under a second, as a held remote sends it, and answers when the board
// has sent it; holding on is asking again. Nothing repeats on its own: when the page stops
// asking - the finger lifts, the eyes move away, the page closes - the sending stops within
// that second.
//   after: a press kept down this long is a hold (a shorter one is a press).
//   look:  in Screen control, how long the eyes stay on a button after it was sent before it is held.
//   most:  one hold ends by itself after this long; holding on needs a new press or a new look.
//   retry, retries: a request refused as too soon after the last command is asked again.
export const HOLD=Object.freeze({after:350,look:1200,most:12000,retry:150,retries:8});
// send(): one request, answered {ok,status,message,...}. still(): whether it is still held.
// each(bursts,answer): after every signal sent. Ends when it is let go ('released'), after
// `most` ms ('limit'), or when a request fails ('failed'). Returns {bursts,ms,result,reason}.
export async function keepSending({send,still,each=()=>{},most=HOLD.most,now=()=>performance.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const started=now();let bursts=0,result=null,refused=0;
 const done=reason=>({bursts,ms:Math.max(0,Math.round(now()-started)),result,reason});
 while(still()){
  if(now()-started>=most)return done('limit');
  result=await send();
  if(result?.status===429&&refused<HOLD.retries){refused++;await wait(HOLD.retry);continue;}
  if(!result?.ok)return done('failed');
  refused=0;bursts++;each(bursts,result);
 }
 return done('released');
}
// What to say when a hold has ended. again: how to go on after the limit.
export function heldMessage(done,again='Press again to go on.'){
 if(done.reason==='failed')return (done.bursts?'Stopped. ':'')+(done.result?.message||'No answer. Check the device before trying again.');
 if(!done.bursts)return 'Nothing was sent.';
 const practice=done.result?.practice===true?' The transmitter is in practice mode: no infrared was sent.':' The device\'s response is not confirmed.';
 return (done.reason==='limit'?'Stopped after '+Math.round(done.ms/1000)+' seconds. '+again:'Held for '+(done.ms/1000).toFixed(1)+' seconds.')+practice;
}
// Press and hold with the mouse or a finger. A press on `button` kept down for `after` ms is a
// hold: start() is called, and stop() when it is let go (anywhere on the page), when the pointer
// leaves the button, or when the page loses the pointer or is hidden. A shorter press is press(),
// as is a click made any other way (the keyboard, a selection by eye). A hold is never also a
// press. The release is listened for on the window, so the page may redraw the button meanwhile.
// Returns a function that ends a hold in progress.
const RELEASES=['pointerup','pointercancel'];
export function pressAndHold(button,{press,start,stop,after=HOLD.after,view=globalThis}){
 let timer=null,held=false,swallow=false,forget=null;
 const release=()=>{
  clearTimeout(timer);timer=null;
  for(const type of RELEASES)view.removeEventListener(type,release,true);
  view.removeEventListener('blur',release);view.document?.removeEventListener('visibilitychange',release);
  if(!held)return;
  held=false;stop();
  // The click that ends this hold comes right after the release; any later click is a press.
  clearTimeout(forget);forget=setTimeout(()=>{swallow=false;},120);
 };
 button.addEventListener('pointerdown',event=>{
  if(event.button>0||event.isPrimary===false)return;   // only the main button, and one finger
  release();clearTimeout(forget);swallow=false;
  for(const type of RELEASES)view.addEventListener(type,release,true);
  // The window's own blur (another window came to the front). Not captured: the press itself moves
  // the focus, and the blur of the button that had it would pass through a capturing listener.
  view.addEventListener('blur',release);view.document?.addEventListener('visibilitychange',release);
  timer=setTimeout(()=>{timer=null;held=true;swallow=true;start();},after);
 });
 button.addEventListener('pointerleave',release);
 button.addEventListener('click',event=>{if(swallow){swallow=false;return;}press(event);});
 // A long press with a finger asks for a menu on some devices.
 button.addEventListener('contextmenu',event=>{if(held||timer!==null)event.preventDefault();});
 button.classList?.add('can-hold');
 return release;
}
