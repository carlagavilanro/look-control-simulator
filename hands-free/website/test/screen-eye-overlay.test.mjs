import test from 'node:test';
import assert from 'node:assert/strict';
import {eyeOverlay,drawEyeOverlay} from '../public/screen-eye-overlay.mjs';

function landmarks(width,height){
 const points=Array.from({length:478},()=>({x:.5,y:.5}));
 for(const [index,x] of [[468,.3],[473,.7]]){
  points[index]={x,y:.35};
  for(let j=0;j<4;j++){const a=j*Math.PI/2;points[index+j+1]={x:x+.02*Math.cos(a),y:.35+.02*width/height*Math.sin(a)};}
 }
 return points;
}
test('eye drawing uses complete eyelid contours and preserves the supplied landmarks',()=>{
 const points=landmarks(1920,1080),copy=structuredClone(points),result=eyeOverlay(points);
 assert.deepEqual(result.outlines.map(p=>p.length),[16,16]);
 assert.deepEqual(result.irises.map(i=>i.center),[points[468],points[473]]);
 assert.deepEqual(points,copy);
 assert.equal(eyeOverlay(null),null);assert.equal(eyeOverlay(points.slice(0,468)),null);
 points[470].x=NaN;assert.equal(eyeOverlay(points),null);
});
test('iris rings are round at both 16:9 resolutions and 4:3; drawings clear on loss',()=>{
 for(const [width,height] of [[1920,1080],[1280,720],[640,480]]){
  const ellipses=[],clears=[];
  const ctx={clearRect:(...v)=>clears.push(v),beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},arc(){},fill(){},ellipse:(...v)=>ellipses.push(v)};
  const canvas={width:0,height:0,getContext:()=>ctx};
  drawEyeOverlay(canvas,eyeOverlay(landmarks(width,height)),width,height);
  assert.equal(canvas.width,width);assert.equal(canvas.height,height);assert.equal(ellipses.length,2);
  for(let i=0;i<2;i++){
   const [x,y,rx,ry]=ellipses[i];assert.ok(Math.abs(x-[.3,.7][i]*width)<.001);assert.ok(Math.abs(y-.35*height)<.001);
   assert.ok(Math.abs(rx-.02*width)<.001);assert.ok(Math.abs(rx-ry)<.001);
  }
  drawEyeOverlay(canvas,null,width,height);assert.equal(clears.length,2);assert.equal(ellipses.length,2);
 }
});
