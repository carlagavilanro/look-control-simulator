import test from 'node:test';
import assert from 'node:assert/strict';
import {typingGrid,letterGroups,menuGrid} from '../public/screen-gaze.mjs';

const keyWidth=(width,g)=>(width-24-(g.columns-1)*6)/g.columns;
// Text field, label, padding and bottom bar (138 px), two rows of suggestions and actions, the key rows, the gaps.
const panelHeight=(g,keyRows=g.keyRows)=>138+(keyRows+2)*g.row+(keyRows+1)*6;

test('the 44 px keyboard is kept only for a reach it can serve',()=>{
 for(const reach of [null,{x:0,y:0},{x:30,y:20},{x:80,y:25}]){
  const g=typingGrid(1708,1020,reach);
  assert.deepEqual(g,{fine:true,row:44,keyRows:3,columns:10,capacity:30});
 }
 assert.equal(typingGrid(1708,1020,{x:30,y:26}).fine,false,'a key under twice the reach down');
 assert.equal(typingGrid(1708,1020,{x:90,y:20}).fine,false,'a key under twice the reach across');
 assert.equal(typingGrid(500,800,null).columns,9,'a narrow window keeps its narrower keyboard');
});

test('recorded sessions get keys of at least twice their reach',()=>{
 // Reach across and down measured by the checks of three recorded sessions on a 1708 x 1020 screen.
 const passed=typingGrid(1708,1020,{x:81,y:70});
 assert.equal(passed.capacity>=30,true,'all letters at once after the calibration that passed');
 assert.deepEqual([passed.columns,passed.row],[10,140]);
 for(const reach of [{x:111,y:116},{x:151,y:102}]){
  const g=typingGrid(1708,1020,reach);
  assert.equal(g.fine,false);assert.equal(g.capacity<30,true,'letters by groups');
  assert.equal(g.capacity>=8,true,'six groups and the symbols fit one page');
  assert.equal(keyWidth(1708,g)>=2.5*reach.x,true,`keys ${keyWidth(1708,g)} px wide for a reach of ${reach.x}`);
  assert.equal(g.row>=1.85*reach.y,true,`rows ${g.row} px for a reach of ${reach.y}: as tall as four rows allow`);
 }
});

test('the typing panel always fits the window and always has room for the letters',()=>{
 let state=7;const random=()=>{state=(state*1103515245+12345)%2147483648;return state/2147483648;};
 for(let i=0;i<4000;i++){
  const width=600+Math.round(random()*3000),height=500+Math.round(random()*1700),reach={x:random()*.4*width,y:random()*.4*height};
  const g=typingGrid(width,height,reach);
  assert.equal(g.columns>=2&&g.columns<=10&&g.keyRows>=2&&g.keyRows<=4&&g.capacity===g.columns*g.keyRows,true);
  if(g.fine)continue;
  assert.equal(g.row>=44,true);
  // All letters at once need three rows of ten; groups need the rows the grid says.
  const rows=g.capacity>=30?Math.ceil(30/g.columns):g.keyRows;
  if(g.row>44)assert.equal(panelHeight(g,rows)<=height,true,`${width}x${height} reach ${Math.round(reach.x)}x${Math.round(reach.y)}: ${JSON.stringify(g)}`);
  // Every page the keyboard shows has to fit: the groups and the symbols key, then a group's letters and Back.
  const groups=letterGroups(g.capacity);
  assert.equal(groups.join(''),'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  if(g.capacity<30){
   assert.equal(groups.length+1<=Math.max(4,g.capacity),true);
   for(const group of groups)if(group.length<=Math.max(4,g.capacity-1))assert.equal(group.length+1<=Math.max(5,g.capacity),true);
  }
 }
});

test('letters are two looks away when eight keys fit a page, three otherwise',()=>{
 assert.deepEqual(letterGroups(8),['ABCDE','FGHIJ','KLMN','OPQR','STUV','WXYZ']);
 assert.deepEqual(letterGroups(12),letterGroups(8));
 assert.deepEqual(letterGroups(4),['ABCDEFGHI','JKLMNOPQR','STUVWXYZ']);
 assert.equal(Math.max(...letterGroups(8).map(g=>g.length))+1<=8,true,'a group and Back fit the page');
});

test('menus keep their size without a measurement and grow with the reach',()=>{
 assert.deepEqual(menuGrid(4,1708,848,null),{columns:2,rows:2,capacity:4,rowHeight:64,columnWidth:210,height:160});
 const nine=menuGrid(9,1708,848,null);assert.deepEqual([nine.columns,nine.rows,nine.rowHeight,nine.columnWidth],[4,3,64,210]);
 assert.deepEqual(menuGrid(4,1708,848,{x:30,y:20}),menuGrid(4,1708,848,null),'a small reach changes nothing');
 // Enlarged, four buttons lie side by side along the bottom and leave the middle of the screen free.
 const strip=menuGrid(4,1708,848,{x:151,y:102});
 assert.deepEqual([strip.columns,strip.rows],[4,1]);
 assert.equal(strip.rowHeight,255);assert.equal(strip.columnWidth>=2.4*151,true);
 assert.equal(strip.height<=.3*1020,true);
 const two=menuGrid(2,1708,848,{x:151,y:102});assert.deepEqual([two.columns,two.rows],[2,1]);
});

test('a menu never leaves the window',()=>{
 let state=11;const random=()=>{state=(state*1103515245+12345)%2147483648;return state/2147483648;};
 for(let i=0;i<4000;i++){
  const width=600+Math.round(random()*3000),available=300+Math.round(random()*1500),count=1+Math.floor(random()*12),reach=random()<.1?null:{x:random()*.4*width,y:random()*.5*available};
  const g=menuGrid(count,width,available,reach),total=g.columns*g.columnWidth+(g.columns-1)*8+24;
  assert.equal(total<=width-32,true,`${count} buttons, ${width} wide: ${JSON.stringify(g)}`);
  assert.equal(g.height<=available||g.rows===1,true,`${count} buttons, ${available} high: ${JSON.stringify(g)}`);
  assert.equal(g.rows>=1&&g.columns>=2&&g.capacity>=Math.min(count,2),true);
  assert.equal(g.rowHeight>=64&&g.columnWidth>=Math.min(210,Math.floor((width-32-24-(g.columns-1)*8)/g.columns)),true);
 }
});
