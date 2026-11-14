import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReceiverExport,addSavedCapture,validateArchive} from '../tools/signal-tool.mjs';
const capture={type:'capture',schema:1,capture_id:5,saved:true,overflow:false,repeat:false,protocol:'UNKNOWN',decoded_hex:'0x1234',raw_us:[9000,4500,560]};
const begin={type:'export_begin',schema:1,count:1};
const end={type:'export_end',count:1,errors:0};
const stream=(rows)=>rows.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n');

test('receiver export retains raw timings and ignores live messages outside the export',()=>{
 const archive=parseReceiverExport(stream(['boot message',{...capture,capture_id:4},begin,capture,end,{...capture,capture_id:6}]));
 assert.deepEqual(archive.captures,[capture]);
});
test('incomplete, corrupted and mismatched exports are rejected',()=>{
 for(const rows of [[begin,capture],[begin,capture,{...end,errors:1}],[begin,end],[begin,'broken',end],[begin,capture,{...end,count:2}],[begin,begin,capture,end]])assert.throws(()=>parseReceiverExport(stream(rows)));
});
test('only unique valid saved captures enter an archive',()=>{
 const archive={type:'receiver_archive',schema:1,captures:[capture]};
 for(const changes of [{saved:false},{capture_id:0},{capture_id:0xffffffff},{repeat:true},{overflow:true},{raw_us:[1,0,2]}])assert.throws(()=>validateArchive({...archive,captures:[{...capture,...changes}]}));
 assert.throws(()=>validateArchive({...archive,captures:[capture,capture]}));
 assert.deepEqual(parseReceiverExport(stream([{...begin,count:0},{...end,count:0}])).captures,[]);
});
test('saved capture requires an explicit command name and preserves existing signals',()=>{
 const archive={type:'receiver_archive',schema:1,captures:[capture]};
 const first=addSavedCapture(null,archive,5,'tv_power',38);
 assert.equal(first.commands[0].source.capture_id,5);
 assert.deepEqual(first.commands[0].raw_us,capture.raw_us);
 assert.throws(()=>addSavedCapture(first,archive,5,'tv_power',38),/already exists/);
 assert.throws(()=>addSavedCapture(first,archive,7,'tv_mute',38),/does not exist/);
 const updated=addSavedCapture(first,archive,5,'tv_mute',38);
 assert.deepEqual(updated.commands[0],first.commands[0]);
 assert.equal(updated.commands.length,2);
});
