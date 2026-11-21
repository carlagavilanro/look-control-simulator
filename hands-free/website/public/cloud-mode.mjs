// The Devices page as the website serves it: the appliances and buttons come from the site's own
// setup (see /setup), and commands go through the site to the transmitter board.
globalThis.handsFreeCloud=true;
import {screenSummary,summaryText} from './screen-profile.mjs';
const $=id=>document.getElementById(id);
// Eye control of this page is Screen control's pointer: the profile's camera and calibration,
// looked at any button here. "Start eye control" opens it on this page; the line under the
// buttons says what the profile has saved for it. (The page's own look-left-or-right control
// stays in the camera card, and uses the same camera.)
const embedded=window.top!==window.self;
const pointerStatus=document.createElement('p'),profileLine=document.createElement('p');
pointerStatus.id='pointer-status';pointerStatus.className='pointer-status';pointerStatus.setAttribute('role','status');
profileLine.id='profile-screen-status';profileLine.className='setup-hint';
globalThis.handsFreeProfileChanged=profile=>{
 let storage=null;try{storage=window.localStorage;}catch{}
 const summary=profile&&storage?screenSummary(storage,profile.name):null;
 pointerStatus.textContent=!summary?'Eye control: choose a profile first. It keeps your camera, calibration and options.':'Eye control for '+profile.name+' · '+summaryText(summary)+(summary.calibrated?'':'. The first start calibrates the pointer.');
 profileLine.textContent=summary?'Screen control · '+summaryText(summary):'';
};
await import('./app.mjs');
const panel=document.querySelector('#connection-panel'),details=panel.querySelector('.details-content');
panel.querySelector('summary>span').lastChild.textContent=' Boards and buttons';
details.replaceChildren();
const message=document.createElement('p');message.className='setup-hint';message.textContent='Link the receiver and transmitter boards, record remote buttons and name them in Setup.';
const open=document.createElement('a');open.className='secondary-button';open.href='/setup';open.textContent='Open setup →';open.style.display='inline-block';
details.append(message,open);
// The two things this page is for, side by side: use what is set up, or set up something new.
const choices=$('screen-launch').parentElement;choices.className='device-choices';
const use=document.createElement('button');use.type='button';use.className='primary-button';use.textContent='Use saved devices';use.setAttribute('aria-pressed','true');use.onclick=()=>$('controls').scrollIntoView({block:'center',behavior:'smooth'});
const add=document.createElement('a');add.className='secondary-button';add.href='/setup';add.textContent='Set up a device';
choices.prepend(use,add);
const start=$('screen-launch');start.textContent='Start eye control →';start.href='/screen?go=site';start.setAttribute('aria-describedby','pointer-status');
if(!embedded){choices.after(pointerStatus);$('profile-settings').append(profileLine);}
const rail=document.createElement('a');rail.href='/setup';rail.setAttribute('aria-label','Setup');rail.innerHTML='<svg><use href="#i-mode"/></svg><span>Setup</span>';
$('profile-rail').before(rail);
document.querySelector('.local-badge').lastChild.textContent=' Camera stays on your device';
document.querySelector('.profile-privacy').textContent='Calibration stays on this device.';
const form=document.createElement('form');form.action='/logout';form.method='post';
const logout=document.createElement('button');logout.className='text-button';logout.type='submit';logout.textContent='Sign out';form.append(logout);document.querySelector('.top-actions').append(form);
