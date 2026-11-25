// Boards and Wi-Fi: put the program on a board and give it its Wi-Fi, over the USB cable, from
// the browser (Web Serial: Chrome and Edge on a computer). Nobody needs Arduino IDE for this.
//
//   1. Connect   the browser asks which USB device; the page then asks the board what it is.
//   2. Program   the compiled program for that board (built and published with each version of
//                the site) is written with esptool-js, the open-source flashing tool of the
//                company that makes the chip. Only the program is written: the board's Wi-Fi,
//                its link key and the receiver's recordings are kept.
//   3. Wi-Fi     the name and password go to the board as one line over the cable. They are
//                never sent to the website and never stored by this page.
//   4. Link      the board shows a link code once it is on Wi-Fi; one press approves it.
import {HELLO,FORGET,BOARDS,wifiProblem,wifiRequest,lineReader,boardAnswer,olderProgram,validPrograms,compare,md5} from './board-usb.mjs';
const $=id=>document.getElementById(id);
// The tests stand in for the USB side and for the flashing tool. In ordinary use there is neither.
const standIn=globalThis.handsFreeBoardTest||{};
const serial=standIn.serial||navigator.serial;
const loadFlasher=standIn.flasher||(()=>import('./vendor/esptool/index.js'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const encoder=new TextEncoder();

// port: the USB device chosen. board: its last answer to "hello" (null until it answers).
// older: 'receiver' | 'transmitter' when a program from before "hello" was recognised.
let port=null,reader=null,reading=null,board=null,older='',answeredAt=0,programs=null,busy=false,waiters=[],joiningSince=0,linkedAs='';

function note(text,kind=''){const box=$('notice');box.hidden=!text;box.textContent=text;box.className='notice'+(kind?' '+kind:'');}
function progress(text,percent){$('progress').hidden=false;$('progress-line').textContent=text+(percent?' · '+percent+'%':'');$('progress-bar').value=percent;}

// ---- the USB line -------------------------------------------------------------------------------
function onLine(line){
 const answer=boardAnswer(line);
 if(answer){
  board=answer;answeredAt=Date.now();older='';
  const still=[];for(const waiter of waiters)if(!waiter(answer))still.push(waiter);waiters=still;
  render();return;
 }
 if(!board){const kind=olderProgram(line);if(kind&&kind!==older){older=kind;render();}}
}
// The next answer from the board that passes `wanted`, or null after `ms`.
function nextAnswer(ms,wanted=()=>true){
 return new Promise(resolve=>{
  const waiter=answer=>{if(!wanted(answer))return false;clearTimeout(timer);resolve(answer);return true;};
  const timer=setTimeout(()=>{waiters=waiters.filter(w=>w!==waiter);resolve(null);},ms);
  waiters.push(waiter);
 });
}
async function send(text){
 if(!port?.writable||!reader)throw Error('The board is not connected.');
 const writer=port.writable.getWriter();
 try{await writer.write(encoder.encode(text));}finally{writer.releaseLock();}
}
async function ask(ms=1200){const waiting=nextAnswer(ms);try{await send(HELLO);}catch{return null;}return waiting;}
async function openLine(){
 await port.open({baudRate:115200});
 // Both control lines released, so the board runs (they are what puts a board in install mode).
 try{await port.setSignals({dataTerminalReady:false,requestToSend:false});}catch{}
 const feed=lineReader(onLine),mine=port.readable.getReader();reader=mine;
 reading=(async()=>{try{for(;;){const {value,done}=await mine.read();if(done)break;if(value)feed(value);}}catch{}finally{try{mine.releaseLock();}catch{}}})();
}
async function closeLine(){
 const mine=reader;reader=null;
 if(mine){try{await mine.cancel();}catch{}}
 if(reading){await reading;reading=null;}
 try{await port?.close();}catch{}
}
// Ask a few times: a board that was just plugged in, or just restarted, needs a moment.
async function greet(waits){for(const wait of waits){if(board)return;await pause(wait);await ask(900);}}

async function connect(){
 if(busy)return;busy=true;note('');render();
 try{
  const chosen=await serial.requestPort();
  await closeLine();
  port=chosen;board=null;older='';linkedAs='';joiningSince=0;
  await openLine();render();
  await greet([300,900,1500]);
 }catch(error){
  if(error?.name==='NotFoundError'){/* the list was closed without a choice */}
  else{port=reader?port:null;note(/open|in use|NetworkError|InvalidState/i.test(String(error?.name)+error?.message)?'The board could not be opened. Another program may be using it (Arduino\'s Serial Monitor, for one). Close that program and press Connect again.':'The board could not be reached. Unplug it, plug it back in and press Connect.','problem');}
 }finally{busy=false;render();}
}
async function disconnect(){if(busy)return;await closeLine();port=null;board=null;older='';note('');render();}

// ---- the program ----------------------------------------------------------------------------------
const chosenKind=()=>board?.kind||document.querySelector('input[name=kind]:checked')?.value||'';
async function install(){
 if(busy||!port)return;
 const kind=chosenKind();
 if(!kind){note('Choose which board this is first.','problem');return;}
 const offered=programs?.boards[kind];
 if(!offered){note('The program for this board could not be fetched from the website. Try again in a minute.','problem');return;}
 busy=true;note('');progress('Getting the program',0);render();
 let transport=null,written=false;
 try{
  const files=[];
  for(const part of offered.parts){
   const got=await fetch('/firmware/'+part.file);
   if(!got.ok)throw Object.assign(Error('fetch'),{step:'fetch'});
   const data=new Uint8Array(await got.arrayBuffer());
   // What arrived is what the build published, byte for byte.
   if(data.length!==part.size||md5(data)!==part.md5)throw Object.assign(Error('damaged'),{step:'fetch'});
   files.push({data,address:part.offset});
  }
  await closeLine();
  progress('Putting the board in install mode',0);
  const {ESPLoader,Transport}=await loadFlasher();
  transport=new Transport(port,false);
  const loader=new ESPLoader({transport,baudrate:460800,romBaudrate:115200,terminal:{clean(){},writeLine(){},write(){}}});
  try{await loader.main();}catch(error){throw Object.assign(error instanceof Error?error:Error(String(error)),{step:'start'});}
  if(loader.chip?.CHIP_NAME!=='ESP32')throw Object.assign(Error('chip'),{step:'chip',chip:String(loader.chip?.CHIP_NAME||'another chip')});
  const total=files.reduce((sum,file)=>sum+file.data.length,0),before=files.map((file,index)=>files.slice(0,index).reduce((sum,earlier)=>sum+earlier.data.length,0));
  await loader.writeFlash({fileArray:files,flashMode:'keep',flashFreq:'keep',flashSize:'keep',eraseAll:false,compress:true,
   reportProgress:(index,done,size)=>progress('Writing the program',Math.min(99,Math.round(100*(before[index]+files[index].data.length*(size?done/size:1))/total))),
   // The board reports the MD5 of what it now holds; the tool compares it with this.
   calculateMD5Hash:image=>md5(image)});
  written=true;progress('Restarting the board',100);
  await loader.after('hard_reset');
  await transport.disconnect();transport=null;
  await pause(1200);
  board=null;older='';
  await openLine();
  await greet([600,1000,1500,2000,2500]);
  if(board)note('The program is on the board. Next: its Wi-Fi.');
  else note('The program was written, but the board has not answered yet. Unplug it, plug it back in and press Connect.','warning');
 }catch(error){
  try{await transport?.disconnect();}catch{}
  if(!reader){try{await openLine();}catch{port=null;}}
  note(written?'The program was written, but the board could not be restarted from here. Unplug it, plug it back in and press Connect.'
   :error.step==='fetch'?'The program could not be fetched from the website. Nothing was written to the board. Try again in a minute.'
   :error.step==='chip'?'This page installs on ESP32 boards. This board is '+error.chip+'. Nothing was written to it.'
   :error.step==='start'?'The board did not go into install mode. Hold the button marked BOOT on the board, press Install again, and let go when the bar starts to move. If the browser\'s list had more than one device, the wrong one may have been picked.'
   :'Installing stopped before it was finished. Leave the board plugged in and press Install again; a board with half a program does nothing until it is installed fully.','problem');
 }finally{busy=false;$('progress').hidden=true;render();}
}

// ---- Wi-Fi ----------------------------------------------------------------------------------------
async function saveWifi(event){
 event.preventDefault();if(busy)return;
 const name=$('wifi-name').value,password=$('wifi-password').value,problem=wifiProblem(name,password);
 if(problem){note(problem,'problem');return;}
 // Only to a board that has answered "hello": an older program would read the digits in a
 // password as fan test keys.
 if(!board){note('Connect a board that has the current program first.','problem');return;}
 busy=true;render();
 try{
  const waiting=nextAnswer(4000,answer=>answer.saved!==null);
  await send(wifiRequest(name,password));
  $('wifi-password').value='';$('wifi-password').type='password';$('wifi-show').checked=false;
  const answer=await waiting;
  if(!answer)note('The board did not answer. Press Connect and try again.','problem');
  else if(!answer.saved)note(answer.message||'The board did not accept that Wi-Fi.','problem');
  else{joiningSince=Date.now();note('Saved on the board. It is joining "'+name+'" now.');}
 }catch{note('The board could not be reached. Press Connect and try again.','problem');}
 finally{busy=false;render();}
}
async function forgetWifi(){
 if(busy||!board)return;
 if($('wifi-forget').dataset.armed!=='1'){$('wifi-forget').dataset.armed='1';$('wifi-forget').textContent='Press again to forget the Wi-Fi';setTimeout(()=>{$('wifi-forget').dataset.armed='';$('wifi-forget').textContent='Forget the Wi-Fi on this board';},5000);return;}
 $('wifi-forget').dataset.armed='';$('wifi-forget').textContent='Forget the Wi-Fi on this board';
 busy=true;render();
 try{const waiting=nextAnswer(4000,answer=>answer.saved!==null);await send(FORGET);const answer=await waiting;note(answer?.saved?'The board has forgotten its Wi-Fi.':'The board did not answer.',answer?.saved?'':'problem');}
 catch{note('The board could not be reached.','problem');}
 finally{busy=false;render();}
}

// ---- link -------------------------------------------------------------------------------------------
async function link(){
 const code=board?.link.code;if(busy||!code)return;
 busy=true;render();
 try{
  const sent=await fetch('/api/pair/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})}),body=await sent.json().catch(()=>({}));
  if(sent.ok){linkedAs=body.device?.name||BOARDS[board.kind];note('Linked as '+linkedAs+'. The board takes a few seconds to say so.');}
  else note(body.message||'The website did not accept the code. Wait for the board to show a new one.','problem');
 }catch{note('The website could not be reached. Check this computer\'s internet and try again.','problem');}
 finally{busy=false;render();}
}

// ---- what the page shows ----------------------------------------------------------------------------
function render(){
 const supported=!!serial,open=!!port&&!!reader,offered=board?programs?.boards[board.kind]:null,state=board?compare(board.firmware,offered?.firmware):'unknown';
 $('unsupported').hidden=supported;$('connect').disabled=!supported||busy;$('connect').textContent=port?'Connect another board':'Connect a board';
 $('disconnect').hidden=!port;$('disconnect').disabled=busy;
 $('board-chip').dataset.state=busy?'busy':board?'online':open?'offline':'idle';
 $('board-line').textContent=!port?'No board connected':board?BOARDS[board.kind]+' connected':older?BOARDS[older]+' connected, with an older program':'A board is connected, but no Hands Free program answered';
 $('board-detail').textContent=!port?'Plug one board in, then press Connect and pick it in the list the browser shows.'
  :board?'Program '+board.firmware+(board.wifi.connected?' · on Wi-Fi "'+board.wifi.name+'"':board.wifi.set?' · joining "'+board.wifi.name+'"':' · no Wi-Fi yet')+(board.link.linked?' · linked':'')
  :older?'It was set up before Wi-Fi could be changed from this page. Update its program in step 2.':'It may be new, or hold another program. Install the program in step 2.';
 // 2. program
 $('program-block').hidden=!port;$('program-block').dataset.done=String(!!board&&state==='same');
 $('kind-choice').hidden=!!board;
 if(older&&!document.querySelector('input[name=kind]:checked'))document.querySelector('input[name=kind][value='+older+']').checked=true;
 $('program-line').textContent=!programs?'The board programs could not be fetched from the website just now. Reload the page in a minute.'
  :board?(state==='same'?'This board has the current program.':'A newer program is ready for this board.')
  :older?'Update this board\'s program to set its Wi-Fi from here.':'Choose the board, then install its program.';
 $('install').textContent=board?(state==='same'?'Install it again':'Update the program'):older?'Update the program':'Install the program';
 $('install').className=board&&state==='same'?'secondary-button':'primary-button';$('install').disabled=busy||!programs;
 // 3. Wi-Fi
 $('wifi-block').hidden=!board;$('wifi-block').dataset.done=String(!!board?.wifi.connected);
 if(board){
  const slow=joiningSince&&Date.now()-joiningSince>25000;
  $('wifi-line').textContent=board.wifi.connected?'On Wi-Fi "'+board.wifi.name+'". To move the board to another Wi-Fi, type the new name and password below.'
   :board.wifi.set?(slow?'Still not on "'+board.wifi.name+'". Check the name and the password (capital letters matter), that the Wi-Fi is switched on and in reach, and that it is a 2.4 GHz network. Then save again.':'Joining "'+board.wifi.name+'"…')
   :'This board has no Wi-Fi yet. Type the name and password of your Wi-Fi.';
  if(board.wifi.connected)joiningSince=0;
  if(!$('wifi-name').value&&document.activeElement!==$('wifi-name'))$('wifi-name').value=board.wifi.name;
  $('wifi-forget').hidden=!board.wifi.set;
 }
 for(const control of $('wifi-form').querySelectorAll('button'))control.disabled=busy;
 // 4. link
 $('link-block').hidden=!board;$('link-block').dataset.done=String(!!board?.link.linked);
 if(board){
  const elsewhere=board.site&&board.site!==location.host;
  $('link-line').textContent=board.link.linked?'Linked to your devices'+(linkedAs?' as '+linkedAs:'')+'. It is in the list on the Setup page.'
   :elsewhere?'This board\'s program talks to '+board.site+', not to this website, so it cannot be linked here.'
   :board.link.code?'The board is ready to link. Its code is '+board.link.code.slice(0,3)+' '+board.link.code.slice(3)+'.'
   :board.wifi.connected?'The board is asking the website for a link code. This takes a few seconds.':'The board links once it is on Wi-Fi (step 3).';
  $('link').hidden=board.link.linked||elsewhere||!board.link.code;$('link').disabled=busy;$('done').hidden=!board.link.linked;
 }
}

$('connect').onclick=connect;$('disconnect').onclick=disconnect;$('install').onclick=install;$('wifi-form').onsubmit=saveWifi;$('wifi-forget').onclick=forgetWifi;$('link').onclick=link;
$('wifi-show').onchange=()=>{$('wifi-password').type=$('wifi-show').checked?'text':'password';};
for(const choice of document.querySelectorAll('input[name=kind]'))choice.onchange=render;
serial?.addEventListener?.('disconnect',async event=>{if(port&&(event.target===port||event.port===port)&&!busy){await closeLine();port=null;board=null;older='';note('The board was unplugged.');render();}});
// The board is asked how it is doing every two seconds. One that stops answering is shown as such.
setInterval(()=>{
 if(busy||!reader)return;
 if(board&&Date.now()-answeredAt>9000){board=null;render();}
 send(HELLO).catch(()=>{});
},2000);
try{const got=await fetch('/firmware/board-programs.json');programs=got.ok?validPrograms(await got.json()):null;}catch{programs=null;}
render();
