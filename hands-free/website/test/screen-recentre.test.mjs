import test from 'node:test';
import assert from 'node:assert/strict';
import {Recentre,shiftPrediction,shiftedModel,screenPoint,fitCalibration,predictDetailed,validModel,calibrationTargets} from '../public/screen-gaze.mjs';

// A 1708 x 1020 screen. Buttons as fractions of it: a 2 x 2 menu and 6 x 3 keys.
const W=1708,H=1020;
const grid=(columns,rows)=>{const out=[];for(let r=0;r<rows;r++)for(let c=0;c<columns;c++)out.push({x0:c/columns+.004,x1:(c+1)/columns-.004,y0:.08+r*(.84/rows)+.004,y1:.08+(r+1)*(.84/rows)-.004});return out;};
const MENU=grid(2,2),KEYS=grid(6,3),BACK={x0:.92,x1:.99,y0:.93,y1:.99};
function source(seed){let state=seed;const random=()=>{state=(state*1103515245+12345)%2147483648;return state/2147483648;};return {random,bell:()=>(random()+random()+random()+random()-2)*1.732};}
// A person selecting buttons. `spread` is how widely they look about on a
// button (share of its size), `shift` how far the tracker reads from the truth
// (pixels). The app selects the button under its estimate; a wrong one is
// taken back three times out of four.
function session(buttons,{shift=[0,0],drift=[0,0],spread=.1,uniform=false,selections=200,seed=7,options}={}){
 const {random,bell}=source(seed),re=new Recentre(options),truth=[shift[0]/W,shift[1]/H],noise=[40/W,35/H];
 let corrections=0,first=null,largest=0;const errors=[];
 const reads=eye=>({x:eye[0]+bell()*noise[0]+truth[0]+re.shift[0],y:eye[1]+bell()*noise[1]+truth[1]+re.shift[1]});
 for(let i=0;i<selections;i++){
  truth[0]+=drift[0]/W;truth[1]+=drift[1]/H;
  const want=buttons[Math.floor(random()*buttons.length)];
  const eye=uniform?[want.x0+random()*(want.x1-want.x0),want.y0+random()*(want.y1-want.y0)]:[(want.x0+want.x1)/2+bell()*spread*(want.x1-want.x0),(want.y0+want.y1)/2+bell()*spread*(want.y1-want.y0)];
  const gaze=reads(eye),got=buttons.find(b=>gaze.x>=b.x0&&gaze.x<=b.x1&&gaze.y>=b.y0&&gaze.y<=b.y1)||[...buttons].sort((a,b)=>Math.hypot((a.x0+a.x1)/2-gaze.x,(a.y0+a.y1)/2-gaze.y)-Math.hypot((b.x0+b.x1)/2-gaze.x,(b.y0+b.y1)/2-gaze.y))[0];
  const result=re.observe({gaze,rect:got,at:i*4000});
  if(got!==want&&random()<.75)re.observe({gaze:reads([.955+bell()*.01,.96+bell()*.01]),rect:BACK,at:i*4000+2000,undo:true});
  if(result.applied){corrections++;first??=i+1;largest=Math.max(largest,Math.abs(result.applied[0]),Math.abs(result.applied[1]));}
  errors.push(Math.hypot((truth[0]+re.shift[0])*W,(truth[1]+re.shift[1])*H));
 }
 const late=errors.slice(-Math.ceil(selections/3)),early=errors.slice(0,20);
 return {re,corrections,first,largest,left:late.reduce((a,b)=>a+b,0)/late.length,all:errors.reduce((a,b)=>a+b,0)/errors.length,early:early.reduce((a,b)=>a+b,0)/early.length,worst:Math.max(...errors)};
}
// The keys of the keyboard that types into another app: ten across, three down, in the bottom of the screen.
const FLAT=(()=>{const out=[];for(let r=0;r<3;r++)for(let c=0;c<10;c++)out.push({x0:c/10+.002,x1:(c+1)/10-.002,y0:.62+r*.12+.003,y1:.62+(r+1)*.12-.003});return out;})();

test('with nothing wrong, the pointer stays close however a person looks about on the buttons',()=>{
 // Every selection moves it a little, so it wanders: by about a tenth of a key, and no single step is large.
 // Buttons of half the screen never move it: there only the small Back button after a wrong one does.
 for(const [name,buttons,average,worst] of [['menu',MENU,16,40],['keys',KEYS,26,80],['flat',FLAT,20,70]])for(const look of [{spread:.1},{spread:.2},{uniform:true}]){
  const run=session(buttons,{...look,selections:3000,seed:11});
  assert.ok(run.all<=average,`${name} ${JSON.stringify(look)}: ${run.all} px off on average`);
  assert.ok(run.worst<=worst,`${name} ${JSON.stringify(look)}: ${run.worst} px off at worst`);
  assert.ok(run.largest<=.035,`${name} ${JSON.stringify(look)}: one step of ${run.largest}`);
 }
});

test('a pointer that reads to one side is moved back within a few selections',()=>{
 // 211 px: what one real session showed between a calibration and its first check.
 for(const [name,buttons,shift] of [['keys',KEYS,[150,0]],['keys',KEYS,[211,0]],['keys',KEYS,[-150,90]],['keys',KEYS,[0,-80]],['keys',KEYS,[90,50]],['keys',KEYS,[40,0]],['flat',FLAT,[60,-40]],['flat',FLAT,[100,0]],['flat',FLAT,[0,70]]])for(const seed of [3,5,8]){
  const run=session(buttons,{shift,selections:150,seed});
  assert.ok(run.first!==null&&run.first<=5,`${name} ${shift}: first correction after ${run.first}`);
  assert.ok(run.left<=30,`${name} ${shift}: ${Math.round(run.left)} px left`);
  assert.ok(run.left<Math.hypot(...shift)*.45,`${name} ${shift}: ${Math.round(run.left)} px left`);
  // On keys most of it is gone within the first twenty selections, not only in the end.
  assert.ok(run.early<Math.hypot(...shift)*.6,`${name} ${shift}: ${Math.round(run.early)} px off over the first twenty`);
 }
 // Buttons of half the screen leave it where it is: the keys that follow deal with it.
 const menu=session(MENU,{shift:[211,0],selections:150,seed:3});assert.deepEqual(menu.re.shift,[0,0]);assert.equal(menu.corrections,0);
 // A tile that is narrow and tall is believed across, not up and down.
 const tall={x0:.4,x1:.59,y0:.3,y1:.7},re=new Recentre();
 for(let i=0;i<8;i++)re.observe({gaze:{x:.495+.03+re.shift[0],y:.5+.05+re.shift[1]},rect:tall,at:i*3000});
 assert.ok(re.shift[0]<-.01);assert.equal(re.shift[1],0);
});

test('it acts on what a rule that waits for proof lets pass: a small offset, a slow drift, a few selections',()=>{
 // 30 px to one side of keys 190 px wide never becomes beyond doubt. It is still worth halving.
 for(const seed of [3,5,8]){const run=session(FLAT,{shift:[30,0],selections:150,seed});assert.ok(run.left<=18,`30 px: ${Math.round(run.left)} px left`);}
 // The reading creeps 2 px a selection, 120 px over 60: it is followed, about 20 px behind.
 for(const seed of [3,5,8]){const run=session(FLAT,{drift:[2,0],selections:60,seed});assert.ok(run.all<=32&&run.left<=40,`drift: ${Math.round(run.all)} on average, ${Math.round(run.left)} in the end`);}
 // Six selections that all lie 90 px to the right of the middle of their keys: more than a third is taken off by the last.
 const re=new Recentre(),seen=[];
 for(let i=0;i<7;i++){const key=FLAT[(i*7)%30],at={x:(key.x0+key.x1)/2+90/1920+re.shift[0],y:(key.y0+key.y1)/2+re.shift[1]};seen.push(re.observe({gaze:at,rect:key,at:i*3000}));}
 assert.ok(seen.slice(1).every(r=>r.counted&&r.applied&&r.applied[0]<0&&r.applied[1]===0));
 assert.ok(-re.shift[0]*1920>60&&-re.shift[0]*1920<=90,`moved ${Math.round(-re.shift[0]*1920)} px of 90`);
 // The first believes the selection by about a third, later ones by less.
 const steps=seen.slice(1).map(r=>-r.applied[0]*1920);assert.ok(steps[0]>20&&steps[0]<36,`first step ${steps[0]}`);assert.ok(steps.every((v,i)=>!i||v<steps[i-1]),`steps ${steps.map(Math.round)}`);
});

test('one correction and their total are limited, and a far larger drift is left for a check',()=>{
 const run=session(KEYS,{shift:[500,0],selections:200,seed:4});
 assert.ok(run.largest<=.06+1e-9);assert.ok(Math.abs(run.re.shift[0])<=.18+1e-9);assert.ok(run.left>150);
 // It pulled the right way as far as it may.
 assert.ok(run.re.shift[0]<-.1);
});

test('a selection that is taken back does not count, and a zoom square never does',()=>{
 const re=new Recentre(),rect=KEYS[7],off={x:(rect.x0+rect.x1)/2+.05,y:(rect.y0+rect.y1)/2};
 // Each wrong key is followed by Back: the key is never counted. The look at
 // Back itself is one (it was on Back's middle), and that says nothing is wrong.
 for(let i=0;i<30;i++){re.observe({gaze:off,rect,at:i*4000});assert.equal(re.observe({gaze:{x:.955,y:.96},rect:BACK,at:i*4000+1500,undo:true}).counted,false);}
 assert.ok(re.window.length>0&&re.window.every(o=>Math.hypot(...o.residual)<1e-9));assert.ok(Math.hypot(...re.shift)<1e-9);
 re.reset();
 // The same looks without being taken back are believed.
 for(let i=0;i<12;i++)re.observe({gaze:{x:off.x+re.shift[0],y:off.y+re.shift[1]},rect,at:200000+i*4000});
 assert.ok(re.shift[0]<-.03,`shift ${re.shift}`);assert.equal(re.shift[1],0);
 // A zoom square says nothing, and does not take back the selection before it either.
 const quiet=new Recentre();quiet.observe({gaze:off,rect,at:0});assert.deepEqual(quiet.shift,[0,0],'not before the next selection lets it stand');
 const zoom=quiet.observe({gaze:{x:.2,y:.2},rect:MENU[0],at:4000,use:false});
 assert.equal(zoom.residual,null);assert.equal(zoom.counted,true);assert.equal(quiet.window.length,1);
 // The one selection that stood moved the pointer a part of the way: less than a third.
 assert.ok(quiet.shift[0]<-.004&&quiet.shift[0]>-.05/3,`shift ${quiet.shift}`);assert.equal(quiet.shift[1],0);
 const stood=[...quiet.shift];
 for(let i=0;i<40;i++)quiet.observe({gaze:{x:.9,y:.9},rect:MENU[0],at:8000+i*4000,use:false});
 assert.deepEqual(quiet.shift,stood);
 // Unusable input is ignored; reset forgets everything.
 assert.equal(quiet.observe({gaze:null,rect,at:1}).residual,null);assert.equal(quiet.observe({gaze:off,rect:{x0:1,x1:0,y0:0,y1:1},at:2}).residual,null);
 re.reset();assert.deepEqual(re.shift,[0,0]);assert.equal(re.active,false);assert.equal(re.window.length,0);
});

test('a selection left standing for minutes is too old to count, and large buttons are believed less than small ones',()=>{
 // Looks 60 px right of a small key's middle, each followed by nothing for more than five minutes:
 // where the eyes were that long ago says nothing about where the pointer reads now.
 const slow=new Recentre(),key=KEYS[7];for(let i=0;i<30;i++)slow.observe({gaze:{x:(key.x0+key.x1)/2+60/W,y:(key.y0+key.y1)/2},rect:key,at:i*400000});
 assert.deepEqual(slow.shift,[0,0]);
 // The same looks a few seconds apart do count.
 const quick=new Recentre();for(let i=0;i<30;i++)quick.observe({gaze:{x:(key.x0+key.x1)/2+60/W+quick.shift[0],y:(key.y0+key.y1)/2},rect:key,at:i*4000});
 assert.ok(quick.shift[0]*W<-45&&quick.shift[0]*W>=-60,`moved ${quick.shift[0]*W} px`);
 // 100 px to one side of the middle, ten times: most of it is taken off on keys, nothing on quarter-screen buttons.
 const run=buttons=>{const {bell}=source(21),re=new Recentre();for(let i=0;i<10;i++){const b=buttons[i%buttons.length];re.observe({gaze:{x:(b.x0+b.x1)/2+100/W+bell()*.004+re.shift[0],y:(b.y0+b.y1)/2+bell()*.004},rect:b,at:i*4000});}return re.shift[0]*W;};
 const keys=run(KEYS),menu=run(MENU);
 assert.ok(keys<-60&&keys>=-100,`keys ${keys}`);assert.equal(menu,0);
});

test('a moved estimate is judged again for being on the screen; other rejections stay',()=>{
 const usable={point:{x:.98,y:.5},raw:{x:.98,y:.5},reason:'usable'};
 assert.equal(shiftPrediction(usable,[0,0]),usable);assert.equal(shiftPrediction(usable,null),usable);
 const moved=shiftPrediction(usable,[-.1,.02]);assert.deepEqual(moved.raw,{x:.88,y:.52});assert.deepEqual(moved.point,{x:.88,y:.52});assert.equal(moved.reason,'usable');
 const out=shiftPrediction(usable,[.1,0]);assert.equal(out.point,null);assert.equal(out.reason,'outside-screen');assert.ok(Math.abs(out.raw.x-1.08)<1e-12);
 const back=shiftPrediction({point:null,raw:{x:1.08,y:.5},reason:'outside-screen'},[-.1,0]);assert.equal(back.reason,'usable');assert.deepEqual(back.point,screenPoint(back.raw));
 const head={point:null,raw:{x:.5,y:.5},reason:'head-position',headReasons:['yaw']};assert.equal(shiftPrediction(head,[.1,0]),head);
 const lost={point:null,raw:null,reason:'eyes-unavailable'};assert.equal(shiftPrediction(lost,[.1,0]),lost);
 // An estimate from saved head positions carries no reason: it moves too, and keeps its other fields.
 const bank=shiftPrediction({point:{x:.5,y:.5},raw:{x:.5,y:.5},weights:[1]},[.05,0]);assert.ok(Math.abs(bank.point.x-.55)<1e-12);assert.deepEqual(bank.weights,[1]);assert.equal('reason' in bank,false);
});

test('what was learned can be made part of the map, within what a map may hold',()=>{
 const feature=(x,y,j=0)=>({h:.25+.4*x+j,v:-.075+.15*y+j*.2,x:.5,y:.45,scale:.3,roll:0});
 const model=fitCalibration(calibrationTargets(true).map(target=>({target,samples:Array.from({length:36},(_,i)=>feature(...target,.0001*Math.sin(i*1.7)))})));
 const moved=shiftedModel(model,[.05,-.03]);assert.ok(validModel(moved));assert.notEqual(moved,model);assert.equal(model.offset,undefined);
 const a=predictDetailed(feature(.4,.6),model).raw,b=predictDetailed(feature(.4,.6),moved).raw;
 assert.ok(Math.abs(b.x-a.x-.05)<1e-12&&Math.abs(b.y-a.y+.03)<1e-12);
 // A second time adds up; beyond 30% of the screen it is refused, as is nonsense.
 assert.deepEqual(shiftedModel(moved,[.05,0]).offset.map(v=>Math.round(v*100)/100),[.1,-.03]);
 assert.equal(shiftedModel(moved,[.3,0]),null);assert.equal(shiftedModel(model,[NaN,0]),null);assert.equal(shiftedModel(null,[0,0]),null);assert.equal(shiftedModel(model,[.1]),null);
 assert.equal(shiftedModel({...model,anchors:[]},[.01,0]),null,'an invalid map is not moved');
});
