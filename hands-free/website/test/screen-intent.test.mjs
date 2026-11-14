import test from 'node:test';
import assert from 'node:assert/strict';
import {TargetIntent,TargetDwell,nearTarget} from '../public/screen-gaze.mjs';

function selector(){
 const intent=new TargetIntent(),dwell=new TargetDwell(600,{pauseMs:300,releaseMs:200});
 const tick=(candidate,at,options={})=>{
  const next=intent.update(candidate,at,options);
  const fired=next.target===null?dwell.update(null,at):next.confirmed&&next.confident?dwell.update(next.target,at):dwell.suspend(next.target,at);
  return {next,fired,progress:dwell.progress};
 };
 return {intent,dwell,tick};
}

test('consistent button occupancy selects after 600 ms of evidence following onset',()=>{
 const {tick}=selector();
 for(let at=0;at<750;at+=50)assert.equal(tick('A',at).fired,null);
 assert.equal(tick('A',750).fired,'A');
 for(let at=800;at<=2000;at+=50)assert.equal(tick('A',at).fired,null);
});

test('boundary jitter preserves progress, contributes no time, and cannot trigger during the excursion',()=>{
 const {tick,dwell}=selector();
 for(let at=0;at<=550;at+=50)tick('A',at);
 const before=dwell.progress;assert.ok(before>.6);
 for(const at of [600,650]){
  assert.equal(tick(null,at,{nearCurrent:true}).fired,null);
  assert.equal(dwell.progress,before);
 }
 assert.equal(tick('A',700).fired,null);assert.equal(dwell.progress,before);
 let fired=null;for(let at=750;at<=1200;at+=50){fired=tick('A',at).fired;if(fired)break;}
 assert.equal(fired,'A');
});

test('a brief neighboring-button excursion pauses interest and a sustained change starts fresh',()=>{
 const a=selector();for(let at=0;at<=550;at+=50)a.tick('A',at);
 const before=a.dwell.progress;
 assert.equal(a.tick('B',600).next.target,'A');
 assert.equal(a.tick('B',650).fired,null);assert.equal(a.dwell.progress,before);
 assert.equal(a.tick('A',700).next.target,'A');
 const b=selector();for(let at=0;at<=550;at+=50)b.tick('A',at);
 for(let at=600;at<1350;at+=50)assert.equal(b.tick('B',at).fired,null);
 assert.equal(b.tick('B',1350).fired,'B');
});

test('brief invalid frames freeze progress and prolonged loss or a clear departure resets it',()=>{
 for(const mode of ['loss','far','gap']){
  const {tick,dwell}=selector();for(let at=0;at<=550;at+=50)tick('A',at);
  const before=dwell.progress;
  if(mode==='loss'){
   assert.equal(tick(null,600,{valid:false}).fired,null);assert.equal(dwell.progress,before);
   for(let at=650;at<=950;at+=50)assert.equal(tick(null,at,{valid:false}).fired,null);
  }else if(mode==='far')tick(null,600,{valid:true,nearCurrent:false});
  else tick('A',1000);
  assert.equal(dwell.progress,0,mode);
 }
});

test('repeated jitter at ordinary webcam frame rates still selects the same button',()=>{
 for(const fps of [15,28,60]){
  const {tick}=selector();let fired=[];
  for(let i=0;i<fps*3;i++){
   const at=i*1000/fps,excursion=at>250&&at%400<40;
   const result=tick(excursion?null:'A',at,{nearCurrent:true});
   if(result.fired)fired.push({at,target:result.fired});
  }
  assert.equal(fired.length,1,`${fps} fps`);assert.equal(fired[0].target,'A');assert.ok(fired[0].at<1400,`${fps} fps: ${fired[0].at}`);
 }
});

test('interest history resets for stale clocks and geometry only admits a small edge allowance',()=>{
 const {tick,intent}=selector();for(let at=0;at<=300;at+=50)tick('A',at);
 assert.equal(tick('A',-1).next.confident,false);
 assert.equal(intent.update('A',NaN).target,null);
 const rect={left:100,right:300,top:100,bottom:200,width:200,height:100};
 assert.equal(nearTarget({x:.305,y:.15},rect,1000,1000),true);
 assert.equal(nearTarget({x:.35,y:.15},rect,1000,1000),false);
});
