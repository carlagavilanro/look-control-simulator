// Talking to a Hands Free board over the USB cable, and checking its program before it is
// installed. No page and no USB in here, so it runs in a browser and in the tests alike.
//
// A board with program "cloud-2" or later answers one line of JSON for each of these (see
// CloudLink.h in the board's own code):
//   {"hf":"hello"}                                  what are you, and how far along?
//   {"hf":"wifi","ssid":"...","password":"..."}     use this Wi-Fi from now on
//   {"hf":"forget-wifi"}                            forget the Wi-Fi
// The Wi-Fi password goes from the page to the board over the cable and nowhere else.
export const HELLO='{"hf":"hello"}\n',FORGET='{"hf":"forget-wifi"}\n';
export const BOARDS={receiver:'Receiver',transmitter:'Transmitter'};
const encoder=new TextEncoder();

// What is wrong with a Wi-Fi name and password, or '' when they can be sent. The same limits as
// the board's own: a name of 1 to 32 bytes, a password of 8 to 63 characters or none.
export function wifiProblem(name,password){
 const bytes=encoder.encode(name).length;
 if(!name.trim())return 'Type the Wi-Fi name.';
 if(bytes>32)return 'A Wi-Fi name is at most 32 characters.';
 if(/[\r\n]/.test(name+password))return 'The name and password cannot contain a line break.';
 if(password.length>0&&password.length<8)return 'A Wi-Fi password has at least 8 characters. Leave it empty only for a network with no password.';
 if(encoder.encode(password).length>63)return 'A Wi-Fi password is at most 63 characters.';
 return '';
}
export function wifiRequest(name,password){
 if(wifiProblem(name,password))throw Error(wifiProblem(name,password));
 return JSON.stringify({hf:'wifi',ssid:name,password})+'\n';
}
// Bytes from the board, a piece at a time, handed on as whole lines.
export function lineReader(onLine){
 const decoder=new TextDecoder();let rest='';
 return chunk=>{
  rest+=decoder.decode(chunk,{stream:true});let end;
  while((end=rest.indexOf('\n'))>=0){const line=rest.slice(0,end).replace(/\r$/,'');rest=rest.slice(end+1);if(line)onLine(line);}
  // A receiver prints every signal it hears as one line, timings included: a long one (an air
  // conditioner's remote) runs to some 15,000 characters.
  if(rest.length>40000)rest='';
 };
}
const text=(value,most)=>typeof value==='string'?value.slice(0,most):'';
// A board's answer to "hello" (or to a Wi-Fi request), checked. null for any other line.
export function boardAnswer(line){
 if(typeof line!=='string'||line[0]!=='{')return null;
 let data;try{data=JSON.parse(line);}catch{return null;}
 if(!data||data.type!=='board'||!Object.hasOwn(BOARDS,data.kind))return null;
 const code=text(data.link?.code,6);
 return {kind:data.kind,firmware:text(data.firmware,40),site:text(data.site,80),
  wifi:{set:data.wifi?.set===true,name:text(data.wifi?.name,32),connected:data.wifi?.connected===true},
  link:{linked:data.link?.linked===true,code:/^\d{6}$/.test(code)?code:''},
  saved:typeof data.saved==='boolean'?data.saved:null,message:text(data.message,160)};
}
// A signal the receiver's program just heard: it prints each one on the USB line as it happens
// (the line capture.ps1 reads). null for any other line. `saved` false with a `reason` when the
// board heard it but did not keep it (a held key's repeat, a signal too long, storage full).
export function heardSignal(line){
 if(typeof line!=='string'||!line.startsWith('{"type":"capture"'))return null;
 let data;try{data=JSON.parse(line);}catch{return null;}
 if(!data||data.type!=='capture'||!Array.isArray(data.raw_us))return null;
 return {timings:data.raw_us.length,repeat:data.repeat===true,overflow:data.overflow===true,saved:data.saved===true,reason:text(data.save_error,160)};
}
// A board with an older Hands Free program does not answer "hello", but what it prints when it
// starts says which board it is.
export function olderProgram(line){
 if(/Transmitter ready|SEVEN FAN COMMAND TEST/.test(line))return 'transmitter';
 if(/"type":"receiver_status"/.test(line))return 'receiver';
 return '';
}

// ---- the programs the website offers (board-programs.json, made by the build) --------------------
// Checked before anything is written to a board: only the four known places in the flash, sizes
// that fit there, and nothing where the board keeps its Wi-Fi, link key and recordings.
const PLACES={bootloader:[0x1000,0x7000],partitions:[0x8000,0xc00],boot_app0:[0xe000,0x2000],app:[0x10000,0x140000]};
export function validPrograms(manifest){
 if(!manifest||manifest.format!==1||!/^\d+\.\d+\.\d+$/.test(manifest.version||'')||!manifest.boards||typeof manifest.boards!=='object')return null;
 const boards={};
 for(const kind of Object.keys(BOARDS)){
  const board=manifest.boards[kind];if(!board)continue;
  if(!/^[A-Za-z0-9._-]{1,40}$/.test(board.firmware||'')||board.chip!=='ESP32'||!Array.isArray(board.parts)||board.parts.length!==4)return null;
  const parts=[];
  for(const part of board.parts){
   const place=Object.hasOwn(PLACES,part?.part)?PLACES[part.part]:null;
   if(!place||part.offset!==place[0]||!Number.isInteger(part.size)||part.size<1||part.size>place[1]||!/^[a-z0-9_.]{1,60}\.bin$/.test(part.file||'')||!/^[0-9a-f]{32}$/.test(part.md5||''))return null;
   parts.push({part:part.part,file:part.file,offset:part.offset,size:part.size,md5:part.md5});
  }
  if(new Set(parts.map(p=>p.part)).size!==4)return null;
  boards[kind]={name:BOARDS[kind],firmware:board.firmware,chip:'ESP32',parts};
 }
 if(!Object.keys(boards).length)return null;
 return {format:1,version:manifest.version,commit:text(manifest.commit,40),built_at:text(manifest.built_at,30),boards};
}
// Is the board's program the one the website offers?  'same' | 'older' | 'unknown'
export function compare(firmware,offered){
 if(!firmware||!offered)return 'unknown';
 if(firmware===offered)return 'same';
 const number=name=>{const found=/^(.*)-(\d+)$/.exec(name);return found?[found[1],Number(found[2])]:null;},a=number(firmware),b=number(offered);
 return a&&b&&a[0]===b[0]&&a[1]>b[1]?'same':'older';
}

// MD5 of some bytes, as hex. The board reports the MD5 of what was written to it; this is what
// it is compared with. (MD5 here checks for damage on the way, nothing more.)
const SHIFT=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
const SINE=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*2**32)>>>0);
export function md5(bytes){
 const length=bytes.length,padded=new Uint8Array((((length+8)>>>6)+1)*64);
 padded.set(bytes);padded[length]=0x80;
 const view=new DataView(padded.buffer);
 view.setUint32(padded.length-8,(length*8)>>>0,true);view.setUint32(padded.length-4,Math.floor(length/2**29),true);
 let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;const word=new Uint32Array(16);
 for(let offset=0;offset<padded.length;offset+=64){
  for(let i=0;i<16;i++)word[i]=view.getUint32(offset+i*4,true);
  let a=a0,b=b0,c=c0,d=d0;
  for(let i=0;i<64;i++){
   let f,g;
   if(i<16){f=(b&c)|(~b&d);g=i;}else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;}else if(i<48){f=b^c^d;g=(3*i+5)%16;}else{f=c^(b|~d);g=(7*i)%16;}
   f=(f+a+SINE[i]+word[g])>>>0;a=d;d=c;c=b;b=(b+((f<<SHIFT[i])|(f>>>(32-SHIFT[i]))))>>>0;
  }
  a0=(a0+a)>>>0;b0=(b0+b)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0;
 }
 const out=new DataView(new ArrayBuffer(16));[a0,b0,c0,d0].forEach((value,i)=>out.setUint32(i*4,value,true));
 return Array.from(new Uint8Array(out.buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
}
