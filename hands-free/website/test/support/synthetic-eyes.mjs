// Procedural close-up eye scene for tracker tests. This is a drawing, not a
// person: it checks tracker behaviour (framing, loss, recovery), never accuracy.
// Coordinates are frame pixels; the scene is evaluated only where it is sampled.
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const SKIN=[205,160,135],SCLERA=[235,228,222],IRIS=[90,60,40],PUPIL=[18,14,12],LASH=[45,30,25],BROW=[40,28,20],CARUNCLE=[200,130,120];
export function eyeDefaults(e){return {openUp:.22,openLo:.11,irisDx:0,irisDy:0,irisD:.4,tilt:0,inner:1,visible:true,...e};}
function eyeLayer(color,x,y,eye){
 const e=eyeDefaults(eye),W=e.w,u=(x-e.cx)/W*e.inner,t=u+.5,line=e.cy+e.tilt*W*u,shape=Math.max(0,4*t*(1-t));
 // Socket shading keeps a soft, eye-centred gradient around each eye.
 const socket=Math.hypot((x-e.cx)/(.75*W),(y-e.cy+.1*W)/(.55*W));
 color=color.map(v=>v*(1-.18*Math.exp(-socket*socket)));
 const browY=e.cy-.62*W-.1*W*shape;
 if(t>=-.15&&t<=1.1&&Math.abs(y-browY)<.06*W)color=mix(color,BROW,.65);
 if(!e.visible){ // A closed lid: a lash line with no eyeball texture.
  if(t>=-.02&&t<=1.02&&Math.abs(y-(line+.04*W*shape))<.02*W)color=LASH;
  return color;
 }
 const up=line-e.openUp*W*shape**.8,lo=line+e.openLo*W*shape**.9,inside=t>=0&&t<=1&&y>=up&&y<=lo;
 if(inside){
  color=SCLERA.map(v=>v*(.8+.2*Math.max(0,Math.min(1,1-Math.abs(t-.5)*1.6))));
  if(t>.9)color=CARUNCLE;
  // Iris offsets are in image coordinates: both eyes move together for one gaze.
  const ix=e.cx+e.irisDx*W,iy=e.cy+e.irisDy*W,R=e.irisD*W/2,r=Math.hypot(x-ix,y-iy);
  if(r<=R){const rad=r/R;color=rad>.88?IRIS.map(v=>v*.45):IRIS.map(v=>v*(.75+.5*rad));}
  if(r<=R*.38)color=PUPIL;
  if(Math.hypot(x-(ix-R*.3),y-(iy-R*.3))<=R*.12)color=[250,250,250];
  if(y<up+.03*W)color=color.map(v=>v*.7);
 }
 if(t>=-.02&&t<=1.02){
  if(Math.abs(y-up)<.022*W)color=LASH;
  else if(Math.abs(y-lo)<.01*W)color=color.map(v=>v*.75);
  if(Math.abs(y-(up-.1*W*shape-.03*W))<.008*W)color=color.map(v=>v*.8);
 }
 return color;
}
// eyes: [{cx,cy,w,...}] with inner=+1 when the nose side is at larger x (the
// image-left eye) and inner=-1 for the image-right eye.
export function eyeScene({width,height,eyes,background=SKIN}){
 return {width,height,eyes,colorAt(x,y){
  let color=background.map(v=>v*(.92+.16*(1-y/height)));
  for(const eye of eyes)if(Math.abs(x-eye.cx)<1.6*eye.w&&Math.abs(y-eye.cy)<1.4*eye.w)color=eyeLayer(color,x,y,eye);
  return color;
 }};
}
export function twoEyes({width=1920,height=1080,centerX=.5,centerY=.5,distance=.34,eyeWidth=null,roll=0,...eye}={}){
 const d=distance*width,w=eyeWidth===null?d*.45:eyeWidth*width,cx=centerX*width,cy=centerY*height,dx=Math.cos(roll)*d/2,dy=Math.sin(roll)*d/2;
 return eyeScene({width,height,eyes:[{cx:cx-dx,cy:cy-dy,w,inner:1,...eye},{cx:cx+dx,cy:cy+dy,w,inner:-1,...eye}]});
}
// Deterministic sensor-like noise so repeated runs are identical.
export function noiseSource(seed=1){let s=seed>>>0||1;return ()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296-.5;};}
// Area-averaged crop of a procedural scene into the model's 64 x 64 RGB input.
// Samples outside the frame repeat the nearest edge pixel, like the camera path.
export function sceneSampler({samples=3,noise=0,seed=1}={}){
 const random=noiseSource(seed);
 return (scene,rect,out,offset,flip)=>{
  const step=rect.size/64;
  for(let py=0;py<64;py++)for(let px=0;px<64;px++){
   let r=0,g=0,b=0;
   for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++){
    const x=Math.max(0,Math.min(scene.width-1,rect.x+(px+(sx+.5)/samples)*step)),y=Math.max(0,Math.min(scene.height-1,rect.y+(py+(sy+.5)/samples)*step));
    const c=scene.colorAt(x,y);r+=c[0];g+=c[1];b+=c[2];
   }
   const n=samples*samples,k=offset+(py*64+(flip?63-px:px))*3,e=noise?random()*noise*2:0;
   out[k]=Math.max(0,Math.min(255,r/n+e))/255;out[k+1]=Math.max(0,Math.min(255,g/n+e))/255;out[k+2]=Math.max(0,Math.min(255,b/n+e))/255;
  }
 };
}
// capture(frame,crops,input) for EyeCropTracker, reading a procedural scene.
export function sceneCapture(options){const sample=sceneSampler(options);return (scene,crops,input)=>crops.forEach((crop,i)=>sample(scene,crop,input,i*12288,crop.flip));}
