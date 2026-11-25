// Gathers the compiled board programs into one folder with a manifest, for the website's
// "Boards and Wi-Fi" page to install over USB. Run by the build workflow after arduino-cli:
//
//   node board-programs.mjs <out folder> <version> <commit> <boot_app0.bin> receiver=<build folder> transmitter=<build folder>
//
// A build folder is arduino-cli's --output-dir for one sketch (IRCapture.ino.bin and the files
// beside it). The manifest says, for each board, which file goes where in the flash and what
// its MD5 is, so the page can check the download and the board can check what was written.
//
// Where the pieces go on an ESP32 with the standard 4 MB layout (what "ESP32 Dev Module" uses):
//   0x1000  bootloader     0x8000  partition table     0xE000  boot_app0     0x10000  the program
// Wi-Fi, the link key and the saved recordings live elsewhere in the flash and are not touched.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const OFFSETS={bootloader:0x1000,partitions:0x8000,boot_app0:0xe000,app:0x10000};
const SKETCH={receiver:{ino:'IRCapture.ino',header:'receiver/IRCapture/CloudReceiver.h',name:'Receiver'},transmitter:{ino:'IRTransmitter.ino',header:'transmitter/IRTransmitter/CloudTransmitter.h',name:'Transmitter'}};
const md5=data=>createHash('md5').update(data).digest('hex');
// The name each sketch reports as its firmware (FIRMWARE_NAME), read from the sketch itself.
export function firmwareName(hardware,board){
 const text=fs.readFileSync(path.join(hardware,SKETCH[board].header),'utf8'),found=/^#define FIRMWARE_NAME "([A-Za-z0-9._-]{1,40})"$/m.exec(text);
 if(!found)throw Error('No FIRMWARE_NAME in '+SKETCH[board].header);
 return found[1];
}
export function gather({out,version,commit,bootApp0,builds,hardware,now=new Date()}){
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Version must look like 1.2.3');
 fs.mkdirSync(out,{recursive:true});
 const shared=fs.readFileSync(bootApp0);
 // An ESP32 image starts with the byte E9. (boot_app0 is not an image: it is 8 KB that says "start the first program".)
 const image=(file,what)=>{const data=fs.readFileSync(file);if(data.length<1024||data[0]!==0xe9)throw Error(what+' is not an ESP32 image: '+file);return data;};
 fs.writeFileSync(path.join(out,'boot_app0.bin'),shared);
 const boards={};
 for(const [board,folder] of Object.entries(builds)){
  if(!SKETCH[board])throw Error('Unknown board '+board);
  const base=path.join(folder,SKETCH[board].ino),parts=[];
  const add=(part,file,data)=>{fs.writeFileSync(path.join(out,file),data);parts.push({part,file,offset:OFFSETS[part],size:data.length,md5:md5(data)});};
  add('bootloader',board+'.bootloader.bin',image(base+'.bootloader.bin','The bootloader'));
  const table=fs.readFileSync(base+'.partitions.bin');if(table.length!==0xc00||table[0]!==0xaa||table[1]!==0x50)throw Error('Not a partition table: '+base+'.partitions.bin');
  add('partitions',board+'.partitions.bin',table);
  parts.push({part:'boot_app0',file:'boot_app0.bin',offset:OFFSETS.boot_app0,size:shared.length,md5:md5(shared)});
  const app=image(base+'.bin','The program');
  // The standard layout gives the program 0x140000 bytes.
  if(app.length>0x140000)throw Error('The '+board+' program is too large for the standard layout: '+app.length+' bytes');
  add('app',board+'.app.bin',app);
  boards[board]={name:SKETCH[board].name,firmware:firmwareName(hardware,board),chip:'ESP32',parts};
 }
 const manifest={format:1,version,commit:String(commit||'').slice(0,40),built_at:now.toISOString(),boards};
 fs.writeFileSync(path.join(out,'board-programs.json'),JSON.stringify(manifest,null,1)+'\n');
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname){
 const [out,version,commit,bootApp0,...rest]=process.argv.slice(2);
 const builds=Object.fromEntries(rest.map(pair=>pair.split('=')));
 const manifest=gather({out,version,commit,bootApp0,builds,hardware:path.resolve(path.dirname(new URL(import.meta.url).pathname),'..')});
 for(const [board,info] of Object.entries(manifest.boards))console.log(board+': '+info.firmware+', program '+info.parts.find(p=>p.part==='app').size+' bytes');
}
