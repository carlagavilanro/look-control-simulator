import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gather,firmwareName,OFFSETS} from '../tools/board-programs.mjs';

const hardware=new URL('..',import.meta.url).pathname;
// Stand-ins for what arduino-cli leaves in a build folder: right first bytes, made-up contents.
function build(folder,ino,{app=200000}={}){
 fs.mkdirSync(folder,{recursive:true});
 const image=size=>{const data=Buffer.alloc(size,0x5a);data[0]=0xe9;return data;};
 fs.writeFileSync(path.join(folder,ino+'.bootloader.bin'),image(18000));
 const table=Buffer.alloc(0xc00,0xff);table[0]=0xaa;table[1]=0x50;fs.writeFileSync(path.join(folder,ino+'.partitions.bin'),table);
 fs.writeFileSync(path.join(folder,ino+'.bin'),image(app));
}
test('the board programs are gathered with a manifest that says where each piece goes',()=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'hf-programs-')),out=path.join(work,'out');
 build(path.join(work,'r'),'IRCapture.ino');build(path.join(work,'t'),'IRTransmitter.ino',{app:900000});
 fs.writeFileSync(path.join(work,'boot_app0.bin'),Buffer.alloc(0x2000,0xff));
 const manifest=gather({out,version:'1.2.3',commit:'abc123',bootApp0:path.join(work,'boot_app0.bin'),builds:{receiver:path.join(work,'r'),transmitter:path.join(work,'t')},hardware,now:new Date('2026-11-25T00:00:00Z')});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'board-programs.json'),'utf8')),manifest);
 assert.deepEqual([manifest.format,manifest.version,manifest.commit,manifest.built_at],[1,'1.2.3','abc123','2026-11-25T00:00:00.000Z']);
 assert.deepEqual(Object.keys(manifest.boards),['receiver','transmitter']);
 assert.equal(manifest.boards.receiver.firmware,firmwareName(hardware,'receiver'));assert.match(manifest.boards.transmitter.firmware,/^IRTransmitter-cloud-\d+$/);
 for(const board of Object.values(manifest.boards)){
  assert.deepEqual(board.parts.map(p=>[p.part,p.offset]),[['bootloader',0x1000],['partitions',0x8000],['boot_app0',0xe000],['app',0x10000]]);
  for(const part of board.parts){
   const data=fs.readFileSync(path.join(out,part.file));
   assert.equal(data.length,part.size);assert.equal(createHash('md5').update(data).digest('hex'),part.md5);assert.match(part.file,/^[a-z0-9_.]+\.bin$/);
  }
  // No piece runs into the next one, and nothing is written where Wi-Fi and the link key are kept (0x9000 to 0xDFFF).
  const sorted=[...board.parts].sort((a,b)=>a.offset-b.offset);
  for(let i=1;i<sorted.length;i++)assert.ok(sorted[i-1].offset+sorted[i-1].size<=sorted[i].offset,sorted[i-1].part+' overlaps '+sorted[i].part);
  for(const part of board.parts)assert.ok(part.offset+part.size<=0x9000||part.offset>=0xe000,part.part+' would overwrite the board\'s saved settings');
 }
 assert.deepEqual(OFFSETS,{bootloader:0x1000,partitions:0x8000,boot_app0:0xe000,app:0x10000});
});
test('a file that is not what it should be stops the build',()=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'hf-programs-')),boot=path.join(work,'boot_app0.bin');fs.writeFileSync(boot,Buffer.alloc(0x2000,0xff));
 const go=()=>gather({out:path.join(work,'out'),version:'1.2.3',commit:'',bootApp0:boot,builds:{receiver:path.join(work,'r')},hardware});
 build(path.join(work,'r'),'IRCapture.ino',{app:0x140001});assert.throws(go,/too large for the standard layout/);
 build(path.join(work,'r'),'IRCapture.ino');fs.writeFileSync(path.join(work,'r','IRCapture.ino.bin'),Buffer.alloc(5000,1));assert.throws(go,/not an ESP32 image/);
 build(path.join(work,'r'),'IRCapture.ino');fs.writeFileSync(path.join(work,'r','IRCapture.ino.partitions.bin'),Buffer.alloc(0xc00,0));assert.throws(go,/Not a partition table/);
 assert.throws(()=>gather({out:path.join(work,'out'),version:'latest',commit:'',bootApp0:boot,builds:{},hardware}),/Version must look like/);
});
