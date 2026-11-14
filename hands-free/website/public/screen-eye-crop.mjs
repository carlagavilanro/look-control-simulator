// Direct MediaPipe Iris inference on selected eye crops. No full-face detector.
export const DEFAULT_EYE_REGIONS=[{x:.3,y:.5,size:.38},{x:.7,y:.5,size:.38}];
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
export function validEyeRegions(regions){return Array.isArray(regions)&&regions.length===2&&regions.every(r=>finite(r)&&r.x>=0&&r.x<=1&&r.y>=0&&r.y<=1&&Number.isFinite(r.size)&&r.size>=.06&&r.size<=.8)&&Math.hypot(regions[0].x-regions[1].x,regions[0].y-regions[1].y)>=.06;}
export function eyeRegionRect(r,width,height){
 const size=Math.min(Math.round(r.size*width),width,height);
 return {x:Math.round(Math.max(0,Math.min(width-size,r.x*width-size/2))),y:Math.round(Math.max(0,Math.min(height-size,r.y*height-size/2))),size};
}
export function previewEyePoint(x,y,rect,width,height){
 const scale=Math.min(rect.width/width,rect.height/height),w=width*scale,h=height*scale;
 const u=(x-rect.left-(rect.width-w)/2)/w,v=(y-rect.top-(rect.height-h)/2)/h;
 return u>=0&&u<=1&&v>=0&&v<=1?{x:1-u,y:v}:null;
}
export function eyeCropMeasurement(points,width,height){
 if(!Array.isArray(points)||points.length!==76||!points.every(finite))return null;
 let a=points[0],b=points[8];if(a.x>b.x)[a,b]=[b,a];
 const dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,d=dx*dx+dy*dy,w=Math.sqrt(d),c=points[71],top=points[12],bottom=points[4];
 const h=((c.x-a.x)*width*dx+(c.y-a.y)*height*dy)/d;
 const v=(-(c.x-(a.x+b.x)/2)*width*dy+(c.y-(a.y+b.y)/2)*height*dx)/d;
 const opening=Math.hypot((top.x-bottom.x)*width,(top.y-bottom.y)*height)/w;
 const ring=points.slice(72),radii=ring.map(p=>Math.hypot((p.x-c.x)*width,(p.y-c.y)*height)),diameter=2*radii.reduce((a,b)=>a+b,0)/4;
 const mx=ring.reduce((s,p)=>s+p.x,0)/4,my=ring.reduce((s,p)=>s+p.y,0)/4;
 if(w<18||!Number.isFinite(h+v+opening)||opening<.12||opening>.8||h<.04||h>.96||Math.abs(v)>.35||diameter/w<.09||diameter/w>.65||Math.hypot((mx-c.x)*width,(my-c.y)*height)/w>.09)return null;
 return {h,v,width:w,opening,center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},a,b,iris:{center:c,ring},outline:[...points.slice(0,9),...points.slice(9,16).reverse()]};
}
export function eyeFrameFeature(measurements,width,height){
 if(measurements.length!==2||measurements.some(m=>!m))return null;
 const [a,b]=measurements.sort((a,b)=>a.center.x-b.center.x);
 if(Math.abs(a.h-b.h)>.20||Math.abs(a.v-b.v)>.12)return null;
 const dx=(b.center.x-a.center.x)*width/height,dy=b.center.y-a.center.y,scale=Math.hypot(dx,dy);
 if(scale<.03)return null;
 return {h:(a.h+b.h)/2,v:(a.v+b.v)/2,lh:a.h,lv:a.v,rh:b.h,rv:b.v,x:(a.center.x+b.center.x)/2,y:(a.center.y+b.center.y)/2,scale,roll:Math.atan2(dy,dx)};
}
export function eyeImageEvidence(image,points){
 if(!points?.[71])return false;
 const {data,width,height}=image,c=points[71],ring=points.slice(72),radius=ring.reduce((s,p)=>s+Math.hypot(p.x-c.x,p.y-c.y),0)/4;
 let sum=0,square=0,n=0,inside=0,insideN=0,outside=0,outsideN=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,g=.299*data[i]+.587*data[i+1]+.114*data[i+2];sum+=g;square+=g*g;n++;
  const distance=Math.hypot(x-c.x,y-c.y);
  if(distance<radius*.55){inside+=g;insideN++;}else if(distance>radius*1.15&&distance<radius*1.8){outside+=g;outsideN++;}
 }
 return n>0&&Math.sqrt(Math.max(0,square/n-(sum/n)**2))>=10&&insideN>=2&&outsideN>=4&&outside/outsideN-inside/insideN>=3;
}
export class EyeCropTracker{
 constructor(regions){this.setRegions(regions);this.canvases=[new OffscreenCanvas(64,64),new OffscreenCanvas(64,64)];}
 setRegions(regions){if(!validEyeRegions(regions))throw Error('Mark both eyes in camera preview.');this.regions=regions.map(r=>({...r})).sort((a,b)=>a.x-b.x);this.revision=(this.revision||0)+1;}
 async init(){
  await import('./vendor/tf.min.js');await import('./vendor/tf-backend-wasm.min.js');
  this.tf=globalThis.tf;this.tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT',false);this.tf.wasm.setWasmPaths(new URL('./vendor/',import.meta.url).href);
  await this.tf.setBackend('wasm');await this.tf.ready();this.model=await this.tf.loadGraphModel(new URL('./vendor/iris.json',import.meta.url).href);
  const warm=this.tf.zeros([2,64,64,3]);const out=this.model.predict(warm);await out.data();out.dispose();warm.dispose();
 }
 async detect(bitmap){
  const width=bitmap.width,height=bitmap.height,revision=this.revision,rects=this.regions.map(r=>eyeRegionRect(r,width,height)),patches=[];
  const input=new Float32Array(2*64*64*3);
  for(let i=0;i<2;i++){
   const ctx=this.canvases[i].getContext('2d',{willReadFrequently:true}),r=rects[i];ctx.setTransform(i===1?-1:1,0,0,1,i===1?64:0,0);ctx.drawImage(bitmap,r.x,r.y,r.size,r.size,0,0,64,64);ctx.resetTransform();
   const patch=ctx.getImageData(0,0,64,64);patches.push(patch);for(let p=0;p<4096;p++)for(let c=0;c<3;c++)input[i*12288+p*3+c]=patch.data[p*4+c]/255;
  }
  const tensor=this.tf.tensor4d(input,[2,64,64,3]);let output;
  try{
   output=this.model.predict(tensor);const data=await output.data(),measurements=[],quality={reason:'eye-crop-unavailable',eyePixels:[],openings:[]};
   for(let i=0;i<2;i++){
    const local=Array.from({length:76},(_,j)=>({x:data[i*228+j*3],y:data[i*228+j*3+1]})),r=rects[i];
    if(!eyeImageEvidence(patches[i],local))return {feature:null,head:null,eyes:null,quality};
    const points=local.map(p=>({x:(r.x+(i===1?64-p.x:p.x)*r.size/64)/width,y:(r.y+p.y*r.size/64)/height}));
    const m=eyeCropMeasurement(points,width,height);if(!m)return {feature:null,head:null,eyes:null,quality};measurements.push(m);quality.eyePixels.push(Math.round(m.width));quality.openings.push(m.opening);
   }
   const feature=eyeFrameFeature(measurements,width,height);if(!feature)return {feature:null,head:null,eyes:null,quality:{...quality,reason:'disagreement'}};
   // Follow eye corners, never iris position, and update only after both eyes
   // pass image and geometry checks. Blinks/loss leave the search boxes alone.
   if(revision===this.revision)this.regions=this.regions.map((r,i)=>{const m=measurements[i],size=Math.max(r.size*.92,Math.min(r.size*1.08,m.width*2.3/width));return {x:r.x*.8+m.center.x*.2,y:r.y*.8+m.center.y*.2,size:r.size*.8+size*.2};});
   return {feature,head:{x:feature.x,y:feature.y,scale:feature.scale,roll:feature.roll},eyes:{outlines:measurements.map(m=>m.outline),irises:measurements.map(m=>m.iris)},quality:{...quality,reason:'usable'}};
  }finally{output?.dispose();tensor.dispose();}
 }
}
