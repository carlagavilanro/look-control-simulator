// A made-up person. The gaze is eyes-in-head plus head: when the head turns, the eyes turn less to
// reach the same dot. The head follows the dots a little, as people's heads do, and two of the
// "head" readings also shift with the eyelids. Numbers are of the size seen in recorded sessions.
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// Options: `lids` adds how far each eye is open (it follows the eye up and down, with its own
// scatter `lidNoise`; `lidFollows:false` makes it scatter only); `irisNoise` is the frame-to-frame
// scatter of the up/down iris reading (.0012 by default; recorded sessions show about .005).
export function person(seed=1,{lids=false,lidFollows=true,lidNoise=.006,irisNoise=.0012}={}){
 const r=rng(seed),gauss=()=>Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r()),follow=.03;
 const base={x:.46,y:.62,scale:.31,roll:.02,yaw:.55,pitch:.49},zero={x:0,y:0,scale:0,roll:0,yaw:0,pitch:0};
 function frame(t,d,bias){
  const head={x:base.x+d.x,y:base.y+d.y,scale:base.scale*(1+d.scale),roll:base.roll+d.roll,yaw:base.yaw+follow*(t[0]-.5)+d.yaw,pitch:base.pitch-follow*(t[1]-.5)+d.pitch};
  const up=.055*(t[1]-.5)+.42*(head.pitch-base.pitch)-.25*(head.y-base.y); // the eye's turn up or down in the head
  const h=.47+.19*(t[0]-.5)-.83*(head.yaw-base.yaw)-.37*(head.x-base.x)+bias[0]+.002*gauss(),v=.02+up+bias[1]+irisNoise*gauss();
  const f={lh:h+.01+.0008*gauss(),lv:v+.0005*gauss(),rh:h-.01+.0008*gauss(),rv:v+.0005*gauss(),x:head.x+.0005*gauss(),y:head.y+.0005*gauss(),scale:head.scale-.004*(t[1]-.5)+.0006*gauss(),roll:head.roll+.001*gauss(),yaw:head.yaw+.0012*gauss(),pitch:head.pitch-.0032*(t[1]-.5)+.0012*gauss()};
  f.h=(f.lh+f.rh)/2;f.v=(f.lv+f.rv)/2;
  if(lids){const open=.29-(lidFollows?.12/.055*up:0);f.lo=open+lidNoise*gauss();f.ro=open+.012+lidNoise*gauss();}
  return f;
 }
 const bias=()=>[.003*gauss(),.0015*gauss()];
 // A dot held with the head as it happens to sit; `drift` moves the whole posture.
 const held=(t,drift=zero,frames=45)=>{const look=Object.fromEntries(Object.keys(zero).map(k=>[k,drift[k]+(k==='scale'?.003:k==='x'||k==='y'?.002:.004)*gauss()])),b=bias();return {target:t,samples:Array.from({length:frames},()=>frame(t,look,b))};};
 // A dot held while the head moves on purpose (size 0: the head stays still; wander: the eyes leave the dot).
 const moving=(t,{size=1,wander=0,frames=140}={})=>{const b=bias(),phase=6.28*r();return {target:t,samples:Array.from({length:frames},(_,i)=>{const a=phase+i/frames*4*Math.PI,look=[t[0]+wander*Math.sin(i/9),t[1]+wander*Math.cos(i/7)];
  return frame(look,{x:.012*size*Math.sin(a),y:.008*size*Math.cos(a),yaw:.03*size*Math.sin(a+.4),pitch:.025*size*Math.cos(a+.2),roll:.05*size*Math.sin(a/2),scale:.03*size*Math.sin(a*.75)},b);})};};
 return {held,moving,zero};
}
