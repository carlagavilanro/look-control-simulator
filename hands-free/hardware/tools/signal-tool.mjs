import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const MAX_BYTES=32768;
export function validateLibrary(library){
 if(!library||library.schema!==1||library.units!=='microseconds'||!Array.isArray(library.commands)||library.commands.length<1||library.commands.length>32)throw Error('Expected schema 1, microseconds and 1–32 commands.');
 const names=new Set();
 for(const entry of library.commands){
  if(!entry||typeof entry.name!=='string'||!/^[a-z0-9_]{1,48}$/.test(entry.name)||names.has(entry.name))throw Error('Invalid or duplicate command name.');names.add(entry.name);
  if(!Number.isInteger(entry.carrier_khz)||entry.carrier_khz<20||entry.carrier_khz>60)throw Error('Carrier must be an integer from 20 to 60 kHz.');
  if(!Array.isArray(entry.raw_us)||entry.raw_us.length<3||entry.raw_us.length>2048||entry.raw_us.some(n=>!Number.isInteger(n)||n<=0||n>1000000)||entry.raw_us.reduce((a,b)=>a+b,0)>1000000)throw Error('Use 3–2048 positive microsecond timings totaling no more than one second.');
 }
 if(Buffer.byteLength(JSON.stringify(library,null,2)+'\n')>MAX_BYTES)throw Error('Formatted library exceeds the 32 KB transmitter limit.');
 return library;
}
export function packRaw(raw){const packed=[];for(let n of raw){while(n>65535){packed.push(65535,0);n-=65535;}packed.push(n);}return packed;}
export function addCapture(library,record,name,carrier,replace=false){
 if(record?.type!=='capture'||record.schema!==1)throw Error('Not a capture record.');
 if(record.overflow!==false)throw Error('Capture buffer overflowed or overflow status is missing; capture again.');
 if(record.repeat!==false)throw Error('Repeat-only capture; release the remote and press its button once.');
 const current=library??{schema:1,units:'microseconds',commands:[]};
 if(library)validateLibrary(library);
 if(current.commands.some(c=>c.name===name)&&!replace)throw Error('That command already exists. Use -Replace / --replace to deliberately update it.');
 const command={name,carrier_khz:carrier,raw_us:record.raw_us,source:{protocol:record.protocol,decoded_hex:record.decoded_hex,bits:record.bits,address:record.address,command:record.command,library:record.library,leading_gap_us:record.leading_gap_us,sequence:record.sequence,uptime_ms:record.uptime_ms,capture_id:record.capture_id,recorded_at:new Date().toISOString(),carrier_source:'operator supplied; receiver does not measure carrier'}};
 command.source=Object.fromEntries(Object.entries(command.source).filter(([,v])=>v!==undefined));
 const updated={schema:1,units:'microseconds',commands:[...current.commands.filter(c=>c.name!==name),command]};return validateLibrary(updated);
}
export function writeLibrary(file,library){
 validateLibrary(library);writeJSON(file,library);
}
function writeJSON(file,value){
 const target=path.resolve(file);fs.mkdirSync(path.dirname(target),{recursive:true});
 const temporary=target+'.tmp-'+randomUUID();const bytes=JSON.stringify(value,null,2)+'\n';
 fs.writeFileSync(temporary,bytes,{encoding:'utf8',flag:'wx'});
 if(fs.existsSync(target))fs.copyFileSync(target,target+'.bak');
 fs.renameSync(temporary,target);
}
export function validateArchive(archive){
 if(archive?.type!=='receiver_archive'||archive.schema!==1||!Array.isArray(archive.captures)||archive.captures.length>256)throw Error('Expected receiver archive schema 1 with at most 256 captures.');
 const ids=new Set();
 for(const record of archive.captures){
  if(record.saved!==true||!Number.isInteger(record.capture_id)||record.capture_id<1||record.capture_id>=0xffffffff||ids.has(record.capture_id))throw Error('Invalid, unsaved or duplicate capture ID in archive.');
  ids.add(record.capture_id);addCapture(null,record,'archive_validation',38);
 }
 return archive;
}
export function parseReceiverExport(text){
 let begin=null,end=null;const captures=[];
 for(const line of text.split(/\r?\n/)){
  if(!line.trim())continue;
  let record;try{record=JSON.parse(line);}catch{if(begin&&!end)throw Error('Malformed line inside receiver export. Keep the receiver files and download again.');continue;}
  if(!begin){if(record.type==='export_begin'){if(record.schema!==1||!Number.isInteger(record.count)||record.count<0||record.count>256)throw Error('Invalid export header.');begin=record;}continue;}
  if(end)continue;
  if(record.type==='capture')captures.push(record);
  else if(record.type==='export_end')end=record;
  else throw Error('Unexpected record inside receiver export.');
 }
 if(!begin||!end||end.errors!==0||end.count!==begin.count||captures.length!==begin.count)throw Error('Incomplete or damaged receiver export. Nothing was cleared on the receiver.');
 return validateArchive({type:'receiver_archive',schema:1,downloaded_at:new Date().toISOString(),captures});
}
export function addSavedCapture(library,archive,id,name,carrier,replace=false){
 validateArchive(archive);
 const record=archive.captures.find(item=>item.capture_id===id);
 if(!record)throw Error('That capture ID does not exist in this archive.');
 return addCapture(library,record,name,carrier,replace);
}
function readJSON(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
export async function uploadLibrary(file,config){
 const body=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');validateLibrary(JSON.parse(body));if(Buffer.byteLength(body)>MAX_BYTES)throw Error('File exceeds 32 KB.');
 if(!config?.espToken||config.espToken.startsWith('REPLACE')||config.espToken.length<24)throw Error('Configure espToken in your private website config file.');
 const base=new URL(config.espUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Use the transmitter HTTP/HTTPS address.');
 const status=await fetch(new URL('/api/status',base),{signal:AbortSignal.timeout(5000)});
 if(!status.ok||(await status.json()).signalFileApi!==1)throw Error('This board does not advertise signal-file support. Upload the new IRTransmitter firmware first.');
 const response=await fetch(new URL('/api/signals',base),{method:'PUT',headers:{'X-Control-Token':config.espToken,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(15000)});
 const result=await response.json();if(!response.ok)throw Error(result.message||'Upload failed.');
 const check=await fetch(new URL('/api/signals',base),{headers:{'X-Control-Token':config.espToken},signal:AbortSignal.timeout(10000)});
 if(!check.ok)throw Error('Uploaded but could not read back the file. Check it before retrying.');
 const stored=await check.text();const hash=s=>createHash('sha256').update(s).digest('hex');if(hash(stored)!==hash(body))throw Error('Read-back does not match the uploaded file. No retry was sent.');
 return 'File saved and read-back verified. No IR command was sent. The receiver can be powered off.';
}
async function main(){
 const [action,...args]=process.argv.slice(2);const options={};
 for(let i=0;i<args.length;i++){if(args[i]==='--replace'){options.replace=true;continue;}if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --option value.');options[args[i].slice(2)]=args[++i];}
 if(action==='validate'){validateLibrary(readJSON(options.file));console.log('Signal library is valid.');}
 else if(action==='archive'){
  const archive=parseReceiverExport(fs.readFileSync(options.log,'utf8'));writeJSON(options.file,archive);
  console.log('Downloaded '+archive.captures.length+' saved captures to '+options.file+'. Nothing was deleted from the receiver.');
  for(const r of archive.captures)console.log('ID '+r.capture_id+'   '+r.protocol+'   '+r.decoded_hex+'   '+r.raw_us.length+' timings');
 }
 else if(action==='add-saved'){
  const library=fs.existsSync(options.file)?readJSON(options.file):null;
  writeLibrary(options.file,addSavedCapture(library,readJSON(options.archive),Number(options.id),options.name,Number(options.carrier||38),!!options.replace));
  console.log('Saved capture '+options.id+' as '+options.name+' in '+options.file+'.');
 }
 else if(action==='add'){const library=fs.existsSync(options.file)?readJSON(options.file):null;writeLibrary(options.file,addCapture(library,readJSON(options.record),options.name,Number(options.carrier||38),!!options.replace));console.log('Saved '+options.name+' in '+options.file+'.');}
 else if(action==='upload')console.log(await uploadLibrary(options.file,readJSON(options.config)));
 else throw Error('Use validate --file signals.json | add --record capture.json --name captured_power --file signals.json --carrier 38 [--replace] | archive --log receiver-export.jsonl --file receiver-captures.json | add-saved --archive receiver-captures.json --id 1 --name tv_power --file signals.json --carrier 38 [--replace] | upload --file signals.json --config ../website/config.local.json');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
