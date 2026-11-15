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
// Luminance of part of a procedural scene at camera resolution, as a camera
// would deliver it: each pixel averages the scene over its own area, then lens
// blur and sensor noise are added. Pixel i covers [x+i, x+i+1) of the frame.
// overlay(color,x,y) can paint over the scene, for example a reflection.
export function sceneLuminance(scene,rect,{samples=3,blur=1,noise=0,seed=1,overlay=null}={}){
 const {x:x0,y:y0,width:w,height:h}=rect,sharp=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let sum=0;
  for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++){const px=x0+x+(sx+.5)/samples,py=y0+y+(sy+.5)/samples;let c=scene.colorAt(px,py);if(overlay)c=overlay(c,px,py);sum+=.299*c[0]+.587*c[1]+.114*c[2];}
  sharp[y*w+x]=sum/(samples*samples);
 }
 let out=sharp;
 if(blur>0){
  const reach=Math.ceil(3*blur),kernel=[];let total=0;
  for(let i=-reach;i<=reach;i++){const v=Math.exp(-.5*i*i/(blur*blur));kernel.push(v);total+=v;}
  const rows=new Float32Array(w*h);out=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let i=-reach;i<=reach;i++)s+=kernel[i+reach]*sharp[y*w+Math.max(0,Math.min(w-1,x+i))];rows[y*w+x]=s/total;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let i=-reach;i<=reach;i++)s+=kernel[i+reach]*rows[Math.max(0,Math.min(h-1,y+i))*w+x];out[y*w+x]=s/total;}
 }
 if(noise){const random=noiseSource(seed);for(let i=0;i<out.length;i++)out[i]=Math.max(0,Math.min(255,out[i]+noise*1.732*(random()+random()+random()+random())));}
 return out;
}
// read(frame,patch) for the iris-detail reader, taking camera pixels from a scene.
export function sceneReader(options={}){
 let seed=options.seed||1;
 return (scene,patch)=>{
  const native=sceneLuminance(scene,{x:patch.x,y:patch.y,width:patch.width,height:patch.height},{...options,seed:seed++});
  if(patch.outWidth===patch.width&&patch.outHeight===patch.height)return native;
  const out=new Float32Array(patch.outWidth*patch.outHeight);
  for(let y=0;y<patch.outHeight;y++)for(let x=0;x<patch.outWidth;x++)out[y*patch.outWidth+x]=native[Math.min(patch.height-1,Math.floor((y+.5)/patch.scale))*patch.width+Math.min(patch.width-1,Math.floor((x+.5)/patch.scale))];
  return out;
 };
}
// The two lid lines of a drawn eye, nine points each, as an eye model reports them.
export function lidLines(eye){
 const e=eyeDefaults(eye),line=(sign,open,power)=>Array.from({length:9},(_,k)=>{const t=k/8,shape=Math.max(0,4*t*(1-t));return {x:e.cx+(t-.5)*e.w,y:e.cy+sign*open*e.w*shape**power};});
 return {upper:line(-1,e.openUp,.8),lower:line(1,e.openLo,.9)};
}
