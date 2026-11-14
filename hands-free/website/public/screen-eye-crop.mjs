// Direct MediaPipe Iris inference on eye crops. No full-face detector.
export const DEFAULT_EYE_REGIONS=[{x:.3,y:.5,size:.38},{x:.7,y:.5,size:.38}];
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
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
// The iris model was trained on a square about 2.3 eye-widths across, and its
// own eye-width output drifts toward that framing whatever the real framing is.
// Sizing the box from that output is unstable: a slightly tight box reads as a
// smaller eye, which tightens the box again until tracking stops (0.4.16 did
// this, most visibly when the eyes opened wide). The spacing of the two eyes
// does not depend on the box, so the box is sized from that spacing instead.
export const EYE_BOX_PER_DISTANCE=1.12;
export function eyeBoxSize(a,b,width,height){
 const size=EYE_BOX_PER_DISTANCE*Math.hypot((b.x-a.x)*width,(b.y-a.y)*height)/width;
 return Number.isFinite(size)?clamp(size,.06,.8):NaN;
}
// Two marked eye centres are enough: the box size follows their spacing.
export function markedEyeRegions(regions,width,height){
 const size=eyeBoxSize(regions[0],regions[1],width,height);
 return regions.map(r=>({x:r.x,y:r.y,size:Number.isFinite(size)?size:r.size}));
}
// A box may extend past the frame when the eyes fill it. Shrinking the box to
// fit would change the framing the model expects, so the part outside the frame
// is filled from the nearest edge instead. Returns the visible part of the box
// and where it lands in the model's 64 x 64 input, or null when too little shows.
export function eyeCropPlan(crop,width,height){
 const left=Math.max(0,crop.x),top=Math.max(0,crop.y),right=Math.min(width,crop.x+crop.size),bottom=Math.min(height,crop.y+crop.size);
 if(!(crop.size>=8)||!(right-left>=crop.size*.4)||!(bottom-top>=crop.size*.4))return null;
 const k=64/crop.size;
 return {source:{x:left,y:top,width:right-left,height:bottom-top},target:{x:(left-crop.x)*k,y:(top-crop.y)*k,width:(right-left)*k,height:(bottom-top)*k}};
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
 // Only a nearly closed eye is rejected for its opening. A wide-open eye is a
 // valid reading; the upper bound only excludes impossible landmark output.
 if(w<18||!Number.isFinite(h+v+opening)||opening<.12||opening>1||h<.04||h>.96||Math.abs(v)>.35||diameter/w<.09||diameter/w>.65||Math.hypot((mx-c.x)*width,(my-c.y)*height)/w>.09)return null;
 return {h,v,width:w,opening,center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},a,b,iris:{center:c,ring},outline:[...points.slice(0,9),...points.slice(9,16).reverse()]};
}
// The two eyes never read exactly alike: the iris sits slightly toward the nose
// in each, so their horizontal readings differ by a steady, person-specific
// amount. Comparing them against zero left little room on one side and rejected
// good frames whenever head angle or gaze added to that natural difference.
// This keeps the same tolerance but centres it on the person's usual difference.
export class BinocularAgreement{
 constructor({h=.2,v=.12,settle=30,rate=.03}={}){this.h=h;this.v=v;this.settle=settle;this.rate=rate;this.reset();}
 reset(){this.count=0;this.dh=0;this.dv=0;this.misses=0;}
 check(dh,dv){
  if(!Number.isFinite(dh)||!Number.isFinite(dv))return false;
  const known=this.count>=this.settle;
  // Until the usual difference is known, allow a wider band around zero.
  const ok=known?Math.abs(dh-this.dh)<=this.h&&Math.abs(dv-this.dv)<=this.v:Math.abs(dh)<=this.h+.15&&Math.abs(dv)<=this.v+.08;
  if(ok){
   const rate=known?this.rate:1/(this.count+1);
   this.dh+=rate*(dh-this.dh);this.dv+=rate*(dv-this.dv);this.count++;this.misses=0;
  // A learned difference that keeps rejecting everything was learned from bad
  // frames. Start again rather than stay locked out.
  }else if(++this.misses>=90)this.reset();
  return ok;
 }
}
export function eyeFrameFeature(measurements,width,height,agreement=null){
 if(measurements.length!==2||measurements.some(m=>!m))return null;
 const [a,b]=[...measurements].sort((a,b)=>a.center.x-b.center.x);
 if(agreement?!agreement.check(a.h-b.h,a.v-b.v):Math.abs(a.h-b.h)>.20||Math.abs(a.v-b.v)>.12)return null;
 const dx=(b.center.x-a.center.x)*width/height,dy=b.center.y-a.center.y,scale=Math.hypot(dx,dy);
 if(scale<.03)return null;
 return {h:(a.h+b.h)/2,v:(a.v+b.v)/2,lh:a.h,lv:a.v,rh:b.h,rv:b.v,x:(a.center.x+b.center.x)/2,y:(a.center.y+b.center.y)/2,scale,roll:Math.atan2(dy,dx)};
}
function irisEvidence(luminance,width,height,points){
 if(!points?.[71])return false;
 const c=points[71],ring=points.slice(72),radius=ring.reduce((s,p)=>s+Math.hypot(p.x-c.x,p.y-c.y),0)/4;
 let sum=0,square=0,n=0,inside=0,insideN=0,outside=0,outsideN=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const g=luminance(x,y);sum+=g;square+=g*g;n++;
  const distance=Math.hypot(x-c.x,y-c.y);
  if(distance<radius*.55){inside+=g;insideN++;}else if(distance>radius*1.15&&distance<radius*1.8){outside+=g;outsideN++;}
 }
 return n>0&&Math.sqrt(Math.max(0,square/n-(sum/n)**2))>=10&&insideN>=2&&outsideN>=4&&outside/outsideN-inside/insideN>=3;
}
export function eyeImageEvidence(image,points){
 const {data,width,height}=image;
 return irisEvidence((x,y)=>{const i=(y*width+x)*4;return .299*data[i]+.587*data[i+1]+.114*data[i+2];},width,height,points);
}
function inputEvidence(input,offset,points){
 return irisEvidence((x,y)=>{const k=offset+(y*64+x)*3;return 255*(.299*input[k]+.587*input[k+1]+.114*input[k+2]);},64,64,points);
}
// Each eye is read from several boxes a few percent apart and the landmarks are
// averaged. The model's output shifts slightly with the exact box position; the
// average is steadier, and the amount the reading moves WITH the box tells a
// real eye (which stays put in the frame) from texture the model only imagines
// an eye in (which travels with the box).
const DITHER=.03;
const PATTERNS={4:[[1,1],[-1,-1],[1,-1],[-1,1]],2:[[1,1],[-1,-1]]};
const FOLLOW_LIMIT=.6; // Share of a box shift that the reading may follow.
const SEARCH_AFTER_MS=450,SEARCH_EVERY_MS=500,WIDE_SEARCH_MS=2000,UNUSABLE_SEARCH_MS=2500;
function modelPoints(output,index,crop){
 const base=index*228,k=crop.size/64;
 return Array.from({length:76},(_,j)=>{const x=output[base+j*3];return {x:crop.x+(crop.flip?64-x:x)*k,y:crop.y+output[base+j*3+1]*k};});
}
function localPoints(output,index){const base=index*228;return Array.from({length:76},(_,j)=>({x:output[base+j*3],y:output[base+j*3+1]}));}
// Where the model places the eye as a whole: eye corners and iris centre.
const anchor=p=>({x:(p[0].x+p[8].x+2*p[71].x)/4,y:(p[0].y+p[8].y+2*p[71].y)/4});
const middle=p=>({x:(p[0].x+p[8].x)/2,y:(p[0].y+p[8].y)/2});
// Copies each box from the camera frame into the model's 64 x 64 input. A
// plain resize samples only a few camera pixels per output pixel, which wastes
// a 4K frame and passes sensor noise straight to the model. The box is instead
// read at up to four times the model's resolution and blocks of pixels are
// averaged. createSurface is replaceable so the geometry can be tested.
export function canvasCapture(createSurface=size=>new OffscreenCanvas(size,size)){
 const surfaces=new Map();
 const surface=size=>{
  if(!surfaces.has(size)){const canvas=createSurface(size);surfaces.set(size,{canvas,ctx:canvas.getContext('2d',{willReadFrequently:true})});}
  return surfaces.get(size);
 };
 return (bitmap,crops,input)=>crops.forEach((crop,index)=>{
  const plan=eyeCropPlan(crop,bitmap.width,bitmap.height),offset=index*12288;
  if(!plan){input.fill(.5,offset,offset+12288);return;}
  const block=crop.size>=256?4:crop.size>=128?2:1,n=64*block,{canvas,ctx}=surface(n),{source:s}=plan;
  const t={x:plan.target.x*block,y:plan.target.y*block,width:plan.target.width*block,height:plan.target.height*block};
  ctx.fillStyle='#808080';ctx.fillRect(0,0,n,n);
  ctx.drawImage(bitmap,s.x,s.y,s.width,s.height,t.x,t.y,t.width,t.height);
  // Outside the frame, repeat the nearest row or column that is inside it.
  const x0=Math.ceil(t.x-1e-6),x1=Math.floor(t.x+t.width+1e-6),y0=Math.ceil(t.y-1e-6),y1=Math.floor(t.y+t.height+1e-6);
  if(y0>0)ctx.drawImage(canvas,0,y0,n,1,0,0,n,y0);
  if(y1<n)ctx.drawImage(canvas,0,y1-1,n,1,0,y1,n,n-y1);
  if(x0>0)ctx.drawImage(canvas,x0,0,1,n,0,0,x0,n);
  if(x1<n)ctx.drawImage(canvas,x1-1,0,1,n,x1,0,n-x1,n);
  const pixels=ctx.getImageData(0,0,n,n).data,scale=1/(255*block*block);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
   let r=0,g=0,b=0;
   for(let v=0;v<block;v++)for(let u=0;u<block;u++){const p=((y*block+v)*n+x*block+u)*4;r+=pixels[p];g+=pixels[p+1];b+=pixels[p+2];}
   // The model expects the nose side on the right, so the second eye is mirrored.
   const k=offset+(y*64+(crop.flip?63-x:x))*3;input[k]=r*scale;input[k+1]=g*scale;input[k+2]=b*scale;
  }
 });
}
export class EyeCropTracker{
 // infer(input,count) and capture(frame,crops,input) can be supplied by tests;
 // the worker uses the bundled TensorFlow.js model and an offscreen canvas.
 constructor(regions,{infer=null,capture=null,detail=null}={}){this.infer=infer;this.capture=capture;this.agreement=new BinocularAgreement();this.detail=detail||4;this.adaptive=!detail;this.cost=null;this.setRegions(regions);}
 setRegions(regions){
  if(!validEyeRegions(regions))throw Error('Mark both eyes in camera preview.');
  this.hint=regions.map(r=>({...r})).sort((a,b)=>a.x-b.x);this.revision=(this.revision||0)+1;this.frameSize=null;
 }
 // Forget the current boxes and look for both eyes across the whole frame.
 find(){this.wanted=true;}
 get regions(){
  if(!this.eyes||!this.frameSize)return this.hint.map(r=>({...r}));
  const {width,height}=this.frameSize,size=clamp(this.size/width,.06,.8);
  return this.eyes.map(e=>({x:clamp(e.x/width,0,1),y:clamp(e.y/height,0,1),size}));
 }
 async init(){
  if(!this.infer){
   await import('./vendor/tf.min.js');await import('./vendor/tf-backend-wasm.min.js');
   const tf=globalThis.tf;tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT',false);tf.wasm.setWasmPaths(new URL('./vendor/',import.meta.url).href);
   await tf.setBackend('wasm');await tf.ready();const model=await tf.loadGraphModel(new URL('./vendor/iris.json',import.meta.url).href);
   this.infer=async(input,count)=>{const tensor=tf.tensor4d(input,[count,64,64,3]),output=model.predict(tensor);try{return await output.data();}finally{output.dispose();tensor.dispose();}};
  }
  this.capture??=canvasCapture();
  await this.infer(new Float32Array(2*12288),2);
 }
 start(width,height){
  this.frameSize={width,height};
  this.eyes=this.hint.map(r=>({x:r.x*width,y:r.y*height}));
  this.size=EYE_BOX_PER_DISTANCE*Math.hypot(this.eyes[1].x-this.eyes[0].x,this.eyes[1].y-this.eyes[0].y);
  this.locked=false;this.streak=0;this.lostSince=null;this.unusableSince=null;this.searchAt=-Infinity;this.searchWait=SEARCH_EVERY_MS;this.agreement.reset();
 }
 async run(frame,crops){
  // Every frame reads the same small number of boxes: reuse those buffers.
  // Each batch is copied into a tensor before the next frame overwrites it.
  this.buffers??=new Map();
  if(crops.length<=8&&!this.buffers.has(crops.length))this.buffers.set(crops.length,new Float32Array(crops.length*12288));
  const input=this.buffers.get(crops.length)||new Float32Array(crops.length*12288),outputs=[];this.capture(frame,crops,input);
  // Bounded batches keep one large search from exhausting model memory.
  for(let start=0;start<crops.length;start+=32){const count=Math.min(32,crops.length-start);outputs.push(await this.infer(input.subarray(start*12288,(start+count)*12288),count));}
  const output=new Float32Array(crops.length*228);outputs.forEach((o,i)=>output.set(o,i*32*228));
  return {input,output};
 }
 // Reads both eyes at the given centres and box size. Nothing is updated here.
 async measure(frame,eyes,size,detail=this.detail){
  const pattern=PATTERNS[detail],n=pattern.length,{width,height}=frame;
  const crops=eyes.flatMap((eye,i)=>pattern.map(([dx,dy])=>({x:eye.x+dx*DITHER*size-size/2,y:eye.y+dy*DITHER*size-size/2,size,flip:i===1})));
  if(crops.some(c=>!eyeCropPlan(c,width,height)))return {measurements:[null,null],follow:[1,1],reason:'eye-crop-unavailable'};
  const {input,output}=await this.run(frame,crops);
  const measurements=[],follow=[];
  for(let i=0;i<2;i++){
   const points=pattern.map((_,k)=>modelPoints(output,i*n+k,crops[i*n+k]));
   const evidence=pattern.some((_,k)=>inputEvidence(input,(i*n+k)*12288,localPoints(output,i*n+k)));
   // Compare readings from opposite corners of the pattern: how far did the
   // eye appear to move, as a share of how far the box moved?
   let moved=0;
   for(let k=0;k<n;k+=2){
    const a=anchor(points[k]),b=anchor(points[k+1]),cx=crops[i*n+k].x-crops[i*n+k+1].x,cy=crops[i*n+k].y-crops[i*n+k+1].y;
    moved+=((a.x-b.x)*cx+(a.y-b.y)*cy)/(cx*cx+cy*cy);
   }
   follow.push(moved/(n/2));
   const mean=Array.from({length:76},(_,j)=>({x:points.reduce((s,p)=>s+p[j].x,0)/n/width,y:points.reduce((s,p)=>s+p[j].y,0)/n/height}));
   measurements.push(evidence?eyeCropMeasurement(mean,width,height):null);
  }
  return {measurements,follow,reason:measurements.every(Boolean)?'usable':'eye-crop-unavailable'};
 }
 async detect(frame,now=performance.now()){
  const {width,height}=frame,revision=this.revision;
  if(!this.frameSize||this.frameSize.width!==width||this.frameSize.height!==height)this.start(width,height);
  const quality={reason:'eye-crop-unavailable',eyePixels:[],openings:[]},none=reason=>({feature:null,head:null,eyes:null,quality:{...quality,reason},regions:this.regions});
  if(this.wanted){
   this.wanted=false;
   if(!await this.timedSearch(frame,now,false)||revision!==this.revision)return none('searching');
  }
  const started=performance.now(),{measurements,follow}=await this.measure(frame,this.eyes,this.size);
  this.adapt(performance.now()-started);
  if(revision!==this.revision)return none('eye-crop-unavailable');
  // A clear reading: both eyes measured, and neither reading travels with its box.
  const clear=measurements.every(Boolean)&&follow.every(f=>f<=FOLLOW_LIMIT);
  if(clear){
   // Follow the eye corners, never the iris, and only on clear readings.
   // Blinks and brief loss leave the boxes where they were.
   measurements.forEach((m,i)=>{
    const eye=this.eyes[i],dx=m.center.x*width-eye.x,dy=m.center.y*height-eye.y,step=Math.hypot(dx,dy),limit=.25*this.size,k=.6*(step>limit?limit/step:1);
    eye.x+=k*dx;eye.y+=k*dy;
    quality.eyePixels.push(Math.round(m.width));quality.openings.push(m.opening);
   });
   this.size+=.25*(EYE_BOX_PER_DISTANCE*Math.hypot(this.eyes[1].x-this.eyes[0].x,this.eyes[1].y-this.eyes[0].y)-this.size);
   // One lucky frame on a non-eye surface must not count. Readings are used
   // only after a few clear frames in a row (or a completed search).
   if(++this.streak>=3)this.locked=true;
   this.lostSince=null;
  }else{this.streak=0;this.lostSince??=now;}
  const feature=clear&&this.locked?eyeFrameFeature(measurements,width,height,this.agreement):null;
  if(feature){
   this.unusableSince=null;
   return {feature,head:{x:feature.x,y:feature.y,scale:feature.scale,roll:feature.roll},eyes:{outlines:measurements.map(m=>m.outline),irises:measurements.map(m=>m.iris)},quality:{...quality,reason:'usable'},regions:this.regions};
  }
  this.unusableSince??=now;
  // Blinks end by themselves. After a longer loss, look for the eyes again so
  // the person does not have to re-mark them by hand: near the last position
  // first, then across the whole frame.
  const lostFor=clear?0:now-this.lostSince,unusableFor=now-this.unusableSince;
  if(lostFor>=SEARCH_AFTER_MS)this.locked=false;
  if((lostFor>=SEARCH_AFTER_MS||unusableFor>=UNUSABLE_SEARCH_MS)&&now>=this.searchAt){
   if(await this.timedSearch(frame,now,lostFor<WIDE_SEARCH_MS&&unusableFor<UNUSABLE_SEARCH_MS)&&revision===this.revision){this.lostSince=null;this.unusableSince=null;}
   return none('searching');
  }
  return none(clear&&this.locked?'disagreement':lostFor>=SEARCH_AFTER_MS?'searching':'eye-crop-unavailable');
 }
 // A search takes many model runs. While nobody is in view, repeat it less and
 // less often instead of keeping the computer busy.
 async timedSearch(frame,now,nearby){
  const began=performance.now(),found=await this.search(frame,nearby);
  if(found)this.searchWait=SEARCH_EVERY_MS;else if(!nearby)this.searchWait=Math.min(4000,this.searchWait*2);
  this.searchAt=now+(performance.now()-began)+this.searchWait;
  return found;
 }
 // Use four boxes per eye while the computer keeps up, two when it does not.
 adapt(ms){
  if(!this.adaptive)return;
  this.cost=this.cost===null?ms:this.cost+.1*(ms-this.cost);
  if(this.detail===4&&this.cost>26)this.detail=2;else if(this.detail===2&&this.cost<9)this.detail=4;
 }
 // Looks for both eyes without any marking. A grid of boxes proposes eye
 // positions; each is re-centred, then tested for staying put when its box is
 // moved; the best plausible pair is finally read at the box size its spacing
 // implies before it replaces the current boxes. nearby=true searches only
 // around the last known eyes, which is quicker after a small head movement.
 async search(frame,nearby=false){
  const {width,height}=frame;
  const propose=async(centres,size,found)=>{
   const crops=centres.map(c=>({x:c.x-size/2,y:c.y-size/2,size,flip:false})).filter(c=>eyeCropPlan(c,width,height));
   if(!crops.length)return;
   const {input,output}=await this.run(frame,crops);
   crops.forEach((crop,i)=>{
    const c=middle(modelPoints(output,i,crop));
    // Keep proposals the model places near the middle of its box; elsewhere a
    // neighbouring box sees the same place better.
    if(Math.abs(c.x-crop.x-size/2)<=.2*size&&Math.abs(c.y-crop.y-size/2)<=.2*size&&c.x>=0&&c.x<=width&&c.y>=0&&c.y<=height&&inputEvidence(input,i*12288,localPoints(output,i)))found.push({x:c.x,y:c.y,size,votes:1});
   });
  };
  if(nearby){
   const size=this.size,centres=[],found=[];
   for(const eye of this.eyes)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)centres.push({x:eye.x+x*.25*size,y:eye.y+y*.25*size});
   await propose(centres,size,found);
   return this.choose(frame,found);
  }
  // Large eyes first: a close-up is settled without the many small boxes that
  // a whole face in view needs.
  for(const sizes of [[.62,.31],[.155]]){
   const found=[];
   for(const share of sizes){
    const size=share*width;if(size<64)continue;
    const centres=[],stride=.25*size,x0=Math.min(width/2,.3*size),x1=Math.max(width/2,width-.3*size),y0=Math.min(height/2,.3*size),y1=Math.max(height/2,height-.3*size);
    for(let y=y0;y<=y1+1e-6;y+=stride)for(let x=x0;x<=x1+1e-6;x+=stride)centres.push({x,y});
    await propose(centres,size,found);
   }
   if(await this.choose(frame,found))return true;
  }
  return false;
 }
 // Turns proposals into a verified pair of eyes, or leaves the boxes unchanged.
 async choose(frame,found){
  const {width,height}=frame,inside=p=>p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height;
  // Merge proposals for the same place.
  const groups=[];
  for(const p of found){
   const g=groups.find(g=>g.size===p.size&&Math.hypot(g.x-p.x,g.y-p.y)<=.2*p.size);
   if(g){g.x=(g.x*g.votes+p.x)/(g.votes+1);g.y=(g.y*g.votes+p.y)/(g.votes+1);g.votes++;}else groups.push({...p});
  }
  let candidates=groups.sort((a,b)=>b.votes-a.votes).slice(0,24);
  // Re-centre each candidate on its own reading until it settles.
  for(let pass=0;pass<4&&candidates.length;pass++){
   const crops=candidates.map(c=>({x:c.x-c.size/2,y:c.y-c.size/2,size:c.size,flip:false})),{output}=await this.run(frame,crops);
   candidates.forEach((c,i)=>{const m=middle(modelPoints(output,i,crops[i]));c.moved=Math.hypot(m.x-c.x,m.y-c.y)/c.size;c.x=m.x;c.y=m.y;});
   candidates=candidates.filter(c=>inside(c)&&eyeCropPlan({x:c.x-c.size/2,y:c.y-c.size/2,size:c.size},width,height));
  }
  candidates=candidates.filter(c=>c.moved<=.06);
  if(candidates.length){
   const probe=.08,crops=candidates.flatMap(c=>[1,-1].map(s=>({x:c.x+s*probe*c.size-c.size/2,y:c.y+s*probe*c.size-c.size/2,size:c.size,flip:false}))),{input,output}=await this.run(frame,crops);
   candidates.forEach((c,i)=>{
    const a=anchor(modelPoints(output,2*i,crops[2*i])),b=anchor(modelPoints(output,2*i+1,crops[2*i+1])),shift=2*probe*c.size;
    c.follow=((a.x-b.x)+(a.y-b.y))/(2*shift);
    c.evidence=inputEvidence(input,2*i*12288,localPoints(output,2*i))||inputEvidence(input,(2*i+1)*12288,localPoints(output,2*i+1));
   });
   candidates=candidates.filter(c=>c.evidence&&c.follow<=FOLLOW_LIMIT);
  }
  // Drop duplicates that settled on the same eye, keeping the steadiest.
  const eyes=[];
  for(const c of candidates.sort((a,b)=>a.follow-b.follow))if(eyes.length<6&&!eyes.some(e=>Math.hypot(e.x-c.x,e.y-c.y)<=.2*Math.max(e.size,c.size)))eyes.push(c);
  let best=null;
  for(const a of eyes)for(const b of eyes){
   const dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy),size=EYE_BOX_PER_DISTANCE*distance;
   // Two eyes of one face: side by side, not steeply tilted, far enough apart
   // to be measured, and at a spacing each was plausibly found at.
   if(dx<=0||distance<.06*width||Math.abs(dy)>.6*dx||[a,b].some(e=>size/e.size<.3||size/e.size>3.4))continue;
   const pair=[{x:a.x,y:a.y},{x:b.x,y:b.y}];let reading=null;
   // Read the pair at its own box size, letting the boxes settle on the eyes.
   for(let pass=0;pass<3;pass++){
    reading=await this.measure(frame,pair,size,4);
    if(!reading.measurements.every(Boolean))break;
    reading.measurements.forEach((m,k)=>{pair[k].x=m.center.x*width;pair[k].y=m.center.y*height;});
   }
   if(!reading.measurements.every(Boolean)||reading.follow.some(f=>f>FOLLOW_LIMIT))continue;
   const [l,r]=reading.measurements;
   if(Math.abs(l.h-r.h)>.35||Math.abs(l.v-r.v)>.2)continue;
   const score=reading.follow[0]+reading.follow[1]+.3*Math.abs(dy)/dx;
   if(!best||score<best.score)best={score,pair};
  }
  if(!best)return false;
  this.eyes=best.pair;this.size=EYE_BOX_PER_DISTANCE*Math.hypot(best.pair[1].x-best.pair[0].x,best.pair[1].y-best.pair[0].y);
  this.locked=true;this.streak=0;this.agreement.reset();
  return true;
 }
}
