// Set up a device: add a device, add a button, record it with the receiver board, name it.
// Also: link the boards and the Windows app, and look after the list of recordings.
import {SUGGESTIONS,buttonIcon,learnedWarning} from './screen-devices.mjs';
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
// Shown inside Screen control (to be used with the eye pointer): the side bar and sign-out are left out.
if(window.top!==window.self)document.documentElement.classList.add('embedded');
const kindNames={fan:'Fan',tv:'TV',heater:'Heater',light:'Light',other:'Other'},kindIcon={fan:'fan',tv:'tv',heater:'heat',light:'light',other:'dot'};
// Button names offered for each kind of device, with the picture that goes with each.
const suggestions=SUGGESTIONS,iconFor=buttonIcon;
let state=null,signature='',busy=false,drafts={},noticeTimer=0,editing=null;

function h(tag,props={},...children){
 const e=document.createElement(tag);
 for(const [key,value]of Object.entries(props)){if(key==='class')e.className=value;else if(key==='text')e.textContent=value;else if(key.startsWith('on'))e[key]=value;else if(value===true)e.setAttribute(key,'');else if(value!==false&&value!=null)e.setAttribute(key,value);}
 e.append(...children.flat().filter(child=>child!=null&&child!==false));return e;
}
function picture(name){const svg=document.createElementNS(NS,'svg'),use=document.createElementNS(NS,'use');use.setAttribute('href','#i-'+name);svg.setAttribute('aria-hidden','true');svg.append(use);return svg;}
function requestId(){const a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(n=>n.toString(16).padStart(2,'0')).join('');}
const since=s=>s==null?'never':s<8?'just now':s<90?s+' seconds ago':s<5400?Math.round(s/60)+' minutes ago':s<172800?Math.round(s/3600)+' hours ago':Math.round(s/86400)+' days ago';
function notice(text,problem=false){const box=$('notice');box.textContent=text;box.hidden=!text;box.classList.toggle('problem',problem);clearTimeout(noticeTimer);if(text&&!problem)noticeTimer=setTimeout(()=>{box.hidden=true;},12000);}
async function call(route,method='GET',body){
 let response;
 try{response=await fetch(route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});}
 catch(error){return {ok:false,message:error.name==='TimeoutError'?'No answer from the website. If a command was on its way, check the device before trying again.':'The website could not be reached. Check the connection.'};}
 if(response.status===401){location.href='/login';return {ok:false,message:'Please sign in again.'};}
 let data={};try{data=await response.json();}catch{}
 return {ok:response.ok,status:response.status,...data};
}
// One action at a time; the answer is shown, then the page is brought up to date.
async function act(work,done){
 if(busy)return;busy=true;document.body.classList.add('working');
 try{const result=await work();if(result?.message||done)notice(result.ok?(done?.(result)||result.message):result.message,!result.ok);return result;}
 finally{busy=false;document.body.classList.remove('working');await refresh(true);}
}
// "Remove" asks once more in place: the first press arms the button for four seconds.
function removeButton(text,action){
 const b=h('button',{class:'danger',type:'button',text});
 b.onclick=()=>{if(b.classList.contains('armed')){action();return;}b.classList.add('armed');b.textContent='Press again to remove';setTimeout(()=>{b.classList.remove('armed');b.textContent=text;},4000);};
 return b;
}
function edit(title,label,value,max,save){editing=save;$('edit-title').textContent=title;$('edit-label').textContent=label;$('edit-value').maxLength=max;$('edit-value').value=value;$('edit-dialog').showModal();$('edit-value').select();}
$('edit-cancel').onclick=()=>$('edit-dialog').close();
$('edit-form').onsubmit=event=>{event.preventDefault();const value=$('edit-value').value.trim(),save=editing;$('edit-dialog').close();if(save&&value)save(value);};
const send=(target,label,confirm=false)=>act(()=>call('/api/send','POST',{...target,request_id:requestId(),created_at:Date.now(),...(confirm?{confirm:true}:{})}),result=>label+': '+result.message);

function renderBoards(){
 const chip=(title,device,missing)=>h('div',{class:'status-chip','data-state':!device?'none':device.online?'online':'offline'},h('span',{class:'lamp'}),h('div',{},title,h('small',{text:!device?missing:device.online?(device.practice?'Online · practice mode: no infrared is sent':'Online'):'Offline · last heard '+since(device.seenSecondsAgo)})));
 const receiver=state.devices.find(d=>d.kind==='receiver'&&d.online)||state.devices.find(d=>d.kind==='receiver'),sender=state.devices.find(d=>d.kind==='transmitter'&&d.online)||state.devices.find(d=>d.kind==='transmitter');
 $('board-status').replaceChildren(chip('Receiver board',receiver,'Not linked yet'),chip('Transmitter board',sender,'Not linked yet'));
 const names={receiver:'Receiver board',transmitter:'Transmitter board',app:'Windows app'};
 $('device-list').replaceChildren(...(state.devices.length?state.devices.map(d=>h('li',{},
  h('div',{class:'row-main'},h('div',{},d.name,h('small',{text:names[d.kind]+(d.firmware?' · '+d.firmware:'')+(d.kind==='app'?' · last used '+since(d.seenSecondsAgo):d.online?' · online':' · last heard '+since(d.seenSecondsAgo))}))),
  h('div',{class:'row-actions'},h('button',{type:'button',text:'Rename',onclick:()=>edit('Rename','Name',d.name,32,name=>act(()=>call('/api/devices/'+d.id,'PATCH',{name})))}),
   removeButton('Remove',()=>act(()=>call('/api/devices/'+d.id,'DELETE')))))):[h('li',{class:'empty',text:'Nothing is linked yet. Power a board, open its Serial Monitor and type its code above.'})]));
 const warn=$('storage-warning');warn.hidden=state.storage.persistent&&!state.storage.error;
 warn.textContent=state.storage.error?'The setup could not be saved to storage ('+state.storage.error+'). It is kept only until the website restarts.':'Storage is not attached to the website yet: devices, buttons and links are kept only until it restarts.';
}
function renderRecord(a){
 const learning=state.learning?.applianceId===a.id?state.learning:null,learned=state.learned?.applianceId===a.id?state.learned:null;
 if(learning)return h('div',{class:'record'},h('div',{class:'waiting'},h('span',{class:'pulse'}),h('div',{},'Waiting for "'+learning.label+'". Point the remote at the receiver and press that button once.',h('small',{id:'learn-seconds',text:learning.secondsLeft+' seconds left'})),h('button',{type:'button',text:'Stop',onclick:()=>act(()=>call('/api/learn','DELETE'))})));
 const draft=drafts[a.id]??'',input=h('input',{maxlength:24,placeholder:'Button name, for example On/off',autocomplete:'off',value:draft,'aria-label':'Name of the new button for '+a.name});
 input.oninput=()=>{drafts[a.id]=input.value;};
 const record=label=>{const name=(label??input.value).trim();if(!name){notice('Type a name for the button first, or choose one of the suggestions.',true);input.focus();return;}drafts[a.id]='';act(()=>call('/api/learn','POST',{applianceId:a.id,label:name,icon:iconFor(name,a.kind)}));};
 const missing=(suggestions[a.kind]||[]).filter(([name])=>!a.buttons.some(b=>b.label.toLowerCase()===name.toLowerCase())).slice(0,8);
 return h('form',{class:'record',onsubmit:event=>{event.preventDefault();record();}},
  learned&&h('p',{class:'notice',text:'"'+learned.label+'" was recorded and saved ('+learned.timings+' timings). Use Send below to try it.'}),
  learned&&learnedWarning(learned)&&h('p',{class:'notice warning',text:learnedWarning(learned)}),
  h('label',{text:'Add a button'}),
  missing.length>0&&h('div',{class:'chips',role:'group','aria-label':'Suggested button names'},missing.map(([name])=>h('button',{type:'button',text:name,onclick:()=>record(name)}))),
  h('div',{class:'link-row'},input,h('button',{class:'primary-button',type:'submit',text:'Record this button'})),
  h('p',{class:'hint',text:'After you press Record, the next button pressed on the remote in front of the receiver is saved under this name.'}));
}
function renderAppliances(){
 $('appliance-list').replaceChildren(...(state.appliances.length?state.appliances.map(a=>h('article',{class:'appliance','aria-label':a.name},
  h('div',{class:'appliance-head'},h('h3',{},picture(kindIcon[a.kind]||'dot'),a.name),
   h('div',{class:'row-actions'},h('button',{type:'button',text:'Rename',onclick:()=>edit('Rename the device','Name',a.name,32,name=>act(()=>call('/api/appliances/'+a.id,'PATCH',{name})))}),
    removeButton('Remove device',()=>act(()=>call('/api/appliances/'+a.id,'DELETE'))))),
  h('label',{class:'check'},(()=>{const box=h('input',{type:'checkbox'});box.checked=a.careful;box.onchange=()=>act(()=>call('/api/appliances/'+a.id,'PATCH',{careful:box.checked}),()=>box.checked?a.name+' now asks "Yes or No" before every command.':a.name+' now sends without asking.');return box;})(),'Ask "Yes or No" before every command'+(a.kind==='heater'?' (recommended for a heater)':'')),
  h('ul',{class:'rows'},a.buttons.length?a.buttons.map(b=>h('li',{},
   h('div',{class:'row-main'},picture(b.icon),h('div',{},b.label,h('small',{text:[b.origin,b.timings+' timings',b.carrier_khz+' kHz'].filter(Boolean).join(' · ')}))),
   h('div',{class:'row-actions'},h('button',{type:'button',text:'Send',onclick:()=>send({button_id:b.id},a.name+' · '+b.label,a.careful)}),
    h('button',{type:'button',text:'Rename',onclick:()=>edit('Rename the button','Name',b.label,24,label=>act(()=>call('/api/buttons/'+b.id,'PATCH',{label,icon:b.icon==='dot'?iconFor(label,a.kind):b.icon})))}),
    h('button',{type:'button',text:'Record again',onclick:()=>act(()=>call('/api/learn','POST',{applianceId:a.id,label:b.label,icon:b.icon,replace:b.id}))}),
    removeButton('Remove',()=>act(()=>call('/api/buttons/'+b.id,'DELETE')))))):h('li',{class:'empty',text:'No buttons yet. Add the first one below.'})),
  renderRecord(a))):[h('p',{class:'hint',text:'No devices yet. Add one below, for example "Fan".'})]));
}
function renderRecordings(){
 const choices=()=>state.appliances.map(a=>h('option',{value:a.id,text:a.name}));
 $('recording-list').replaceChildren(...(state.recordings.length?[...state.recordings.slice(0,40).map(r=>{
  const key='r:'+r.id,name=h('input',{maxlength:24,placeholder:'Button name',autocomplete:'off',value:drafts[key]??'','aria-label':'Name for this recording'}),where=h('select',{'aria-label':'Device for this recording'},choices());
  name.oninput=()=>{drafts[key]=name.value;};
  return h('li',{},h('div',{class:'row-main'},h('div',{},'Recorded '+since(r.secondsAgo),h('small',{text:[r.timings+' timings · '+(r.milliseconds/1000).toFixed(2)+' s','from '+r.from,r.protocol&&r.protocol!=='UNKNOWN'?r.protocol+(r.bits?' '+r.bits+' bits':''):'',r.looksLike.length?'same signal as '+r.looksLike.join(', '):''].filter(Boolean).join(' · ')}))),
   h('div',{class:'row-actions'},h('button',{type:'button',text:'Send',onclick:()=>send({recording_id:r.id},'Recording')}),
    state.appliances.length>0&&[where,name,h('button',{type:'button',text:'Make a button',onclick:()=>{const label=name.value.trim(),a=state.appliances.find(x=>x.id===where.value);if(!label){notice('Type a name for the button first.',true);name.focus();return;}delete drafts[key];act(()=>call('/api/appliances/'+where.value+'/buttons','POST',{label,icon:iconFor(label,a?.kind),recording_id:r.id}),()=>'"'+label+'" was added to '+(a?.name||'the device')+'.');}})],
    removeButton('Delete',()=>act(()=>call('/api/recordings/'+r.id,'DELETE')))));}),
  state.recordings.length>1&&h('li',{class:'empty'},(state.recordings.length>40?'Showing the newest 40 of '+state.recordings.length+'. ':''),removeButton('Delete all recordings',()=>act(()=>call('/api/recordings/all','DELETE'))))]
  :[h('li',{class:'empty',text:state.devices.some(d=>d.kind==='receiver')?'No recordings waiting. Signals the receiver saves will appear here.':'Link the receiver board to see its recordings here.'})]));
}
async function refresh(force=false){
 const fresh=await call('/api/hub');if(!fresh.ok){if(fresh.message)notice(fresh.message,true);return;}
 state=fresh;
 const seconds=$('learn-seconds');if(seconds&&state.learning)seconds.textContent=state.learning.secondsLeft+' seconds left';
 // Redraw only when something changed, and never under someone's typing.
 const now=JSON.stringify([state.devices.map(d=>[d.id,d.name,d.online,d.practice,Math.floor((d.seenSecondsAgo??0)/60)]),state.appliances.map(a=>[a.id,a.name,a.careful,a.buttons.map(b=>[b.id,b.label,b.icon,b.timings,b.carrier_khz])]),state.recordings.map(r=>r.id),state.learning?.applianceId,state.learning?.label,state.learned?.at,state.storage]);
 const typing=document.activeElement?.matches?.('#appliance-list input,#recording-list input,#recording-list select');
 if(now===signature||!force&&typing)return;
 signature=now;renderBoards();renderAppliances();renderRecordings();
}
$('link-form').onsubmit=event=>{event.preventDefault();const code=$('link-code').value.replace(/\D/g,'');if(code.length!==6){notice('A link code has six digits.',true);return;}act(()=>call('/api/pair/approve','POST',{code}),result=>{$('link-code').value='';return result.device.name+' is linked.';});};
$('appliance-form').onsubmit=event=>{event.preventDefault();const name=$('appliance-name').value.trim()||kindNames[$('appliance-kind').value];act(()=>call('/api/appliances','POST',{name,kind:$('appliance-kind').value}),result=>{$('appliance-name').value='';return result.appliance.name+' was added. Now add its first button.';});};
// Choosing a kind with the name still empty fills in the usual name.
$('appliance-kind').onchange=()=>{if(!$('appliance-name').value.trim()||Object.values(kindNames).includes($('appliance-name').value.trim()))$('appliance-name').value=$('appliance-kind').value==='other'?'':kindNames[$('appliance-kind').value];};
await refresh(true);
setInterval(()=>{if(!document.hidden&&!busy&&!$('edit-dialog').open)refresh();},2000);
// Opened by the Windows app with its link code after the # (which browsers do not send to the
// website): the code is filled in and the Link button is left to the person. The code is then
// taken out of the address so it is not kept in the browser's history or shared with the page.
function codeFromAddress(){
 const match=/^#link=(\d{6})$/.exec(location.hash);if(!match)return;
 history.replaceState(null,'',location.pathname);
 $('link-code').value=match[1].slice(0,3)+' '+match[1].slice(3);
 $('link-form').scrollIntoView({block:'center'});$('link-form').querySelector('button').focus();
 notice('The Windows app\'s code '+$('link-code').value+' is filled in below. Press Link to let the app use your devices.');
}
codeFromAddress();addEventListener('hashchange',codeFromAddress);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
