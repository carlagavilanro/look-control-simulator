import test from 'node:test';
import assert from 'node:assert/strict';
import {LensChooser,FaceEdges,FACE_EDGE_ADVICE,ReflectionTally} from '../public/screen-camera.mjs';

const face=(width,height=width*1.2,cx=.5,cy=.5)=>({x0:cx-width/2,y0:cy-height/2,x1:cx+width/2,y1:cy+height/2});
// Runs frames 33 ms apart; `picture(lens,i)` gives the face in the tracker's picture. Returns the lens changes asked for.
function run(chooser,picture,{frames=400,start='wide',zoom=1,obey=true}={}){
 let lens=start,now=1000;const asked=[];
 for(let i=0;i<frames;i++){
  const change=chooser.frame(lens,picture(lens,i),now,zoom);
  if(change){asked.push(change);if(obey)lens=change;}
  now+=33;
 }
 return {asked,lens};
}

test('the telephoto lens is tried once and kept when the whole face fits in it',()=>{
 const c=new LensChooser();
 const r=run(c,lens=>lens==='wide'?face(.2):face(.34));
 assert.deepEqual(r.asked,['telephoto']);assert.equal(r.lens,'telephoto');
 assert.equal(c.state,'done');assert.equal(c.kept,true);assert.equal(c.reason,'whole face fits');
 assert.equal(c.frame('telephoto',face(.34),99999),null,'nothing more is asked once it has chosen');
});

test('the wide lens comes back when the face is cut off or lost in the telephoto picture',()=>{
 for(const tele of [()=>face(.5,.6,.8,.5),()=>null,(l,i)=>i%2?face(.34):null]){
  const c=new LensChooser();
  const r=run(c,(lens,i)=>lens==='wide'?face(.2):tele(lens,i));
  assert.deepEqual(r.asked,['telephoto','wide']);assert.equal(r.lens,'wide');assert.equal(c.kept,false);
 }
});

test('it waits for a steadily followed face and for the lens to settle',()=>{
 const c=new LensChooser();let now=0;
 for(let i=0;i<19;i++)assert.equal(c.frame('wide',face(.2),now+=33),null);
 assert.equal(c.frame('wide',null,now+=33),null,'a lost face starts the count again');
 for(let i=0;i<19;i++)assert.equal(c.frame('wide',face(.2),now+=33),null);
 assert.equal(c.frame('wide',face(.2),now+=33),'telephoto');
 assert.equal(c.frame('wide',face(.2),now+=33),null,'still wide: the camera has not switched yet');
 assert.equal(c.frame('telephoto',null,now+=33),null);assert.equal(c.state,'watching');
 // During the first second and a half the picture is not judged: a cut-off face then does not count against it.
 for(let t=0;t<1400;t+=33)assert.equal(c.frame('telephoto',face(.5,.6,.9,.5),now+=33),null);
 for(let t=0;t<2700&&c.state!=='done';t+=33)c.frame('telephoto',face(.34),now+=33);
 assert.equal(c.kept,true);
});

test('a face that would not fit is never tried, and the app\'s own crop is taken into account',()=>{
 const close=new LensChooser();
 assert.deepEqual(run(close,()=>face(.5)).asked,[]);assert.equal(close.state,'done');assert.equal(close.reason,'face too large for the telephoto picture');
 // The same share of a picture the app has already cropped 1.5 times is a smaller share of the camera's picture.
 const cropped=new LensChooser();
 assert.deepEqual(run(cropped,lens=>lens==='wide'?face(.5):face(.4),{zoom:1.5}).asked,['telephoto']);
});

test('a lens already chosen, a choice by hand or a failed change ends it',()=>{
 const tele=new LensChooser();assert.deepEqual(run(tele,()=>face(.3),{start:'telephoto'}).asked,[]);assert.equal(tele.reason,'already on telephoto');
 const hand=new LensChooser();hand.cancel();assert.deepEqual(run(hand,()=>face(.2)).asked,[]);
 const failed=new LensChooser();let now=0,asked=null;for(let i=0;i<40&&!asked;i++)asked=failed.frame('wide',face(.2),now+=33);
 assert.equal(asked,'telephoto');failed.failed();assert.equal(failed.frame('wide',face(.2),now+=33),null);assert.equal(failed.kept,false);
 // A camera that never confirms the change is never judged and never asked twice.
 const stuck=new LensChooser();assert.deepEqual(run(stuck,()=>face(.2),{obey:false}).asked,['telephoto']);
 const again=new LensChooser();run(again,lens=>lens==='wide'?face(.2):face(.34));again.reset();assert.equal(again.state,'idle');
});

test('whatever the pictures show, it asks for at most one try and one return',()=>{
 let state=5;const random=()=>{state=(state*1103515245+12345)%2147483648;return state/2147483648;};
 for(let n=0;n<600;n++){
  const c=new LensChooser(),wideSize=.1+random()*.5,teleSize=.1+random()*.9,lost=random();
  const r=run(c,(lens)=>random()<lost*.6?null:lens==='wide'?face(wideSize,wideSize*1.2,.3+random()*.4,.3+random()*.4):face(teleSize,teleSize*1.2,.3+random()*.4,.3+random()*.4),{frames:600});
  assert.equal(r.asked.length<=2,true);assert.equal(r.asked[0]===undefined||r.asked[0]==='telephoto',true);assert.equal(r.asked[1]===undefined||r.asked[1]==='wide',true);
  if(r.asked.length===2)assert.equal(c.kept,false);
  if(c.kept)assert.equal(r.lens,'telephoto');
 }
});

test('a saved framing that cuts the face off gets a second look at the whole telephoto picture', () => {
  const chooser = new LensChooser();
  const small = { x0: .4, y0: .38, x1: .6, y1: .62 }, cut = { x0: .7, y0: .3, x1: 1, y1: .74 }, whole = { x0: .33, y0: .3, x1: .67, y1: .7 };
  let now = 0, change = null;
  for (let i = 0; i < 20 && !change; i++) change = chooser.frame('wide', small, now += 40);
  assert.equal(change, 'telephoto');
  chooser.frame('telephoto', cut, now += 40);
  for (let i = 0; i < 200 && chooser.state !== 'done'; i++) change = chooser.frame('telephoto', cut, now += 40);
  assert.equal(change, 'wide');
  // The app widens its own crop instead of giving the lens up, and asks for another look.
  chooser.again(now);
  assert.equal(chooser.state, 'watching');
  for (let i = 0; i < 200 && chooser.state !== 'done'; i++) change = chooser.frame('telephoto', whole, now += 40);
  assert.equal(chooser.kept, true);
  assert.equal(change, null);
});

test('sitting too close is decided sooner when the setting says so', () => {
  const chooser = new LensChooser();
  chooser.close = 20;
  const large = { x0: .2, y0: .1, x1: .8, y1: .9 };
  let now = 0;
  for (let i = 0; i < 19; i++) assert.equal(chooser.frame('wide', large, now += 40), null);
  assert.equal(chooser.state, 'idle');
  chooser.frame('wide', large, now += 40);
  assert.equal(chooser.state, 'done');
  assert.equal(chooser.kept, null);
});

// 0.4.31. On 20 Nov the face sat low in the telephoto picture: nose 77% of the way down, chin at
// the bottom edge. The telephoto lens was given up without saying that the camera only had to
// point a little lower.
test('a face that would fit but is cut off at one edge is told apart from one that is too large',()=>{
 const cases=[[()=>face(.34,.6,.5,.75),'bottom'],[()=>face(.34,.6,.5,.22),'top'],[()=>face(.34,.6,.86,.5),'side'],[()=>face(.34,.6,.12,.5),'side']];
 for(const [tele,edge] of cases){
  const c=new LensChooser(),r=run(c,lens=>lens==='wide'?face(.2):tele());
  assert.deepEqual(r.asked,['telephoto','wide']);assert.equal(c.kept,false);assert.equal(c.edge,edge);assert.equal(c.reason,'face cut off at the '+edge);
 }
 // Too large for the picture, lost, or cut off now here and now there: no single edge to name.
 for(const tele of [()=>face(.7,.97,.5,.5),()=>null,(l,i)=>i%2?face(.34,.6,.5,.78):face(.34,.6,.5,.2)]){
  const c=new LensChooser(),r=run(c,(lens,i)=>lens==='wide'?face(.2):tele(lens,i));
  assert.deepEqual(r.asked,['telephoto','wide']);assert.equal(c.edge,null);assert.equal(c.reason,'face does not fit');
 }
 // Kept: nothing to say. And a second look starts clean.
 const kept=new LensChooser();run(kept,lens=>lens==='wide'?face(.2):face(.34));assert.equal(kept.edge,null);
 const again=new LensChooser();run(again,lens=>lens==='wide'?face(.2):face(.34,.6,.5,.75));assert.equal(again.edge,'bottom');
 again.again(50000);assert.equal(again.edge,null);assert.deepEqual(again.past,{top:0,bottom:0,side:0});
});

test('the edge the face runs past is named once it does so in half of the recent frames',()=>{
 const e=new FaceEdges();assert.equal(e.edge,null);
 for(let i=0;i<19;i++)e.add(face(.3,.5,.5,.8));assert.equal(e.edge,null,'too few frames to say');
 e.add(face(.3,.5,.5,.8));assert.equal(e.edge,'bottom');
 // Inside the picture, however close to its edge, is inside.
 const near=new FaceEdges();for(let i=0;i<60;i++)near.add(face(.3,.5,.5,.74));assert.equal(near.edge,null);
 const top=new FaceEdges();for(let i=0;i<60;i++)top.add(face(.3,.5,.5,.2));assert.equal(top.edge,'top');
 const side=new FaceEdges();for(let i=0;i<60;i++)side.add(face(.3,.5,.9,.5));assert.equal(side.edge,'side');
 // It follows the person: after moving into the picture the advice goes; frames without a face do not count.
 for(let i=0;i<40;i++){top.add(face(.3,.5,.5,.5));top.add(null);top.add({x0:NaN,y0:0,x1:1,y1:1});}assert.equal(top.edge,null);assert.ok(top.frames.length<=60);
 top.reset();assert.equal(top.edge,null);
 // A nod now and then past the edge is not worth a remark.
 const nod=new FaceEdges();for(let i=0;i<60;i++)nod.add(face(.3,.5,.5,i%4?.6:.8));assert.equal(nod.edge,null);
 for(const k of ['bottom','top','side'])assert.match(FACE_EDGE_ADVICE[k],/camera/);
});

// 0.4.32. On 20 Nov (23:22) reflections hid both eyes in a third of the frames at the bottom row
// of dots and in a few per cent elsewhere; one dot waited for over ten seconds.
test('reflections are counted by band of the screen, and the band they cost most in is named',()=>{
 const t=new ReflectionTally();assert.equal(t.worst,null);
 const fill=(tally,y,frames,hidden,oneEye=0)=>{for(let i=0;i<frames;i++)tally.add(y,i<hidden?'glare':i%7===0?'closed-eye':'usable',i>=hidden&&i<hidden+oneEye);};
 // As recorded: top 3%, middle 5%, bottom 21% hidden and 15% with one eye.
 fill(t,.04,500,13,10);fill(t,.27,470,13,9);fill(t,.5,670,33,16);fill(t,.73,400,26,11);fill(t,.96,716,204,161);
 const w=t.worst;assert.equal(w.band,'bottom');assert.ok(Math.abs(w.hidden-.206)<.01&&Math.abs(w.oneEye-.154)<.01&&Math.abs(w.elsewhere-.036)<.01,JSON.stringify(w));
 assert.deepEqual(Object.keys(t.bands),['top','middle','bottom']);assert.equal(t.bands.top.frames,970);
 // An ordinary session (a few per cent everywhere, a little more at the bottom): nothing to say.
 const usual=new ReflectionTally();fill(usual,.04,1100,40);fill(usual,.5,850,58);fill(usual,.96,1000,79);assert.equal(usual.worst,null);
 // One eye hidden most of the time counts too, at half weight when ranking the bands.
 const one=new ReflectionTally();fill(one,.1,400,8,150);fill(one,.5,400,8);fill(one,.9,400,30,20);assert.equal(one.worst.band,'top');assert.ok(one.worst.oneEye>.35);
 // Too few frames in a band say nothing; other statuses are not reflections; nonsense heights are ignored.
 const few=new ReflectionTally();fill(few,.9,100,60);assert.equal(few.worst,null);
 const closed=new ReflectionTally();for(let i=0;i<300;i++)closed.add(.9,'closed-eye');closed.add(NaN,'glare');closed.add(undefined,'glare');assert.equal(closed.worst,null);assert.equal(closed.bands.bottom.frames,300);
 t.reset();assert.equal(t.worst,null);assert.equal(t.bands.bottom.frames,0);
});
