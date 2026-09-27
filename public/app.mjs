import {DwellSelector} from './eye-selection.mjs';
import {applyCommand,commands} from './device.mjs';
const $=s=>document.querySelector(s),buttons=[...document.querySelectorAll('[data-command]')];
const dwell=new DwellSelector();let index=0,holding=false,lost=false,paused=false,state={on:false,speed:1,oscillating:false},sent=0;
function select(i){index=(i+commands.length)%commands.length;holding=false;dwell.arm(commands[index]);buttons.forEach((b,j)=>b.setAttribute('aria-pressed',j===index));$('#status').textContent=`${buttons[index].textContent} selected. Hold for five seconds.`;}
buttons.forEach((b,i)=>b.addEventListener('click',()=>select(i)));
function start(){if(!paused&&dwell.target!==null){holding=true;}}
function stop(){holding=false;dwell.arm(commands[index]);$('#dwell').value=0;}
$('#hold').addEventListener('pointerdown',e=>{e.preventDefault();$('#hold').setPointerCapture(e.pointerId);start();});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('#hold').addEventListener(type,stop);
addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey)return;if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&(e.target.tagName!=='BUTTON'||e.target.id==='hold')){e.preventDefault();if(!e.repeat)start();}if(e.code==='ArrowRight'){e.preventDefault();select(index+1);}if(e.code==='ArrowLeft'){e.preventDefault();select(index-1);}});
addEventListener('keyup',e=>{if(e.code==='Space'&&holding){e.preventDefault();stop();}});
addEventListener('blur',stop);document.addEventListener('visibilitychange',stop);
$('#lost').onclick=()=>{lost=!lost;$('#lost').setAttribute('aria-pressed',lost);$('#lost').textContent=lost?'Restore tracking':'Simulate tracking loss';};
$('#pause').onclick=()=>{paused=!paused;stop();$('#pause').setAttribute('aria-pressed',paused);$('#pause').textContent=paused?'Resume':'Pause';$('#status').textContent=paused?'Paused. No command can be sent.':'Resumed. Hold to select.';};
function render(){const fan=$('#fan');fan.classList.toggle('running',state.on);fan.style.animationDuration=`${1.6/state.speed}s`;$('#device-state').textContent=`${state.on?'On':'Off'} · Speed ${state.speed}`;$('#oscillation').textContent=`Oscillation ${state.oscillating?'on':'off'}`;}
$('#reset').onclick=()=>{state={on:false,speed:1,oscillating:false};sent=0;lost=false;paused=false;$('#lost').textContent='Simulate tracking loss';$('#lost').setAttribute('aria-pressed','false');$('#pause').textContent='Pause';$('#pause').setAttribute('aria-pressed','false');$('#events').innerHTML='<li>No commands sent.</li>';select(0);render();};
function tick(now){if(!paused){const command=dwell.update(lost?null:holding,now);$('#dwell').value=dwell.progress;if(command){state=applyCommand(state,command);render();sent++;if(sent===1)$('#events').textContent='';const li=document.createElement('li');li.textContent=`${sent}. ${buttons[index].textContent} → simulated fan`;$('#events').prepend(li);while($('#events').children.length>6)$('#events').lastChild.remove();$('#status').textContent='Command sent once. Release before another selection.';}else if(holding&&dwell.target!==null){$('#status').textContent=lost?'Tracking lost. Hold is paused.':`Holding ${Math.round(dwell.progress*100)}%`;}}requestAnimationFrame(tick);}
select(0);requestAnimationFrame(tick);
