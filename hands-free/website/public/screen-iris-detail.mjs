// Iris position from the camera's own pixels.
//
// Both eye models look at a small copy of each eye (64 x 64 for close-up
// tracking, about 256 x 256 for a whole face), so most of a 1080p or 4K frame's
// detail never reaches them. This module goes back to the frame: it starts from
// the model's iris estimate and finds the edge between the iris and the white
// of the eye to a fraction of a camera pixel. Reflections (glasses, lamps, the
// screen itself) are measured and kept out of that edge search.
//
// Everything here works on a plain luminance array, so it can be tested without
// a camera or a browser.
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const median=values=>{if(!values.length)return NaN;const s=[...values].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

// Luminance of an RGBA pixel buffer (ImageData.data) as one float per pixel.
export function luminance(rgba,width,height,out=new Float32Array(width*height)){
 for(let i=0,p=0;i<width*height;i++,p+=4)out[i]=.299*rgba[p]+.587*rgba[p+1]+.114*rgba[p+2];
 return out;
}
function sampler(gray,width,height){
 return (x,y)=>{
  if(!(x>=0&&y>=0&&x<=width-1&&y<=height-1))return NaN;
  const x0=Math.min(width-2,Math.floor(x)),y0=Math.min(height-2,Math.floor(y)),fx=x-x0,fy=y-y0,i=y0*width+x0;
  return (gray[i]*(1-fx)+gray[i+1]*fx)*(1-fy)+(gray[i+width]*(1-fx)+gray[i+width+1]*fx)*fy;
 };
}
// How the eye is lit: used to tune the camera picture and to report glare.
// `bright` is the level above which a pixel counts as a reflection rather than
// part of the eye: clearly brighter than the white of the eye around the iris.
export function eyeLight(gray,width,height,iris){
 const inside=[],around=[];let clipped=0,n=0;
 const x0=Math.max(0,Math.floor(iris.x-2.2*iris.r)),x1=Math.min(width-1,Math.ceil(iris.x+2.2*iris.r)),y0=Math.max(0,Math.floor(iris.y-1.3*iris.r)),y1=Math.min(height-1,Math.ceil(iris.y+1.3*iris.r));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const g=gray[y*width+x],d=Math.hypot(x-iris.x,y-iris.y);n++;if(g>=250)clipped++;
  if(d<=.85*iris.r)inside.push(g);else if(d>=1.2*iris.r&&d<=2.1*iris.r&&Math.abs(y-iris.y)<=.5*iris.r)around.push(g);
 }
 if(inside.length<12||around.length<8)return null;
 // The iris level is taken low in its range, so an iris that a reflection
 // partly covers still reads as dark; the reflection level depends only on
 // the white of the eye, so a reflection over the whole iris is still seen.
 inside.sort((a,b)=>a-b);
 const dark=inside[Math.floor(inside.length*.25)],white=median(around),bright=Math.max(white+.35*(255-white),white+18);
 let glare=0;for(const g of inside)if(g>=bright)glare++;
 return {dark,white,contrast:white-dark,bright,glare:glare/inside.length,clipped:clipped/n,mean:(inside.reduce((a,b)=>a+b,0)+around.reduce((a,b)=>a+b,0))/(inside.length+around.length)};
}
// Least-squares circle through weighted points (centre and radius).
function fitCircle(points,weights,start,prior=null){
 let {x,y,r}=start;
 for(let pass=0;pass<8;pass++){
  let a11=0,a12=0,a13=0,a22=0,a23=0,a33=0,b1=0,b2=0,b3=0;
  for(let i=0;i<points.length;i++){
   const w=weights[i];if(!w)continue;
   const dx=points[i].x-x,dy=points[i].y-y,d=Math.hypot(dx,dy)||1e-9,jx=-dx/d,jy=-dy/d,e=d-r;
   a11+=w*jx*jx;a12+=w*jx*jy;a13-=w*jx;a22+=w*jy*jy;a23-=w*jy;a33+=w;b1-=w*jx*e;b2-=w*jy*e;b3+=w*e;
  }
  // A known iris size pulls the radius toward it, which keeps a short or
  // one-sided arc from trading radius against position.
  if(prior){a33+=prior.weight;b3+=prior.weight*(prior.radius-r);}
  // Solve the 3 x 3 normal equations; a small ridge keeps a one-sided arc stable.
  a11+=1e-9;a22+=1e-9;a33+=1e-9;
  const det=a11*(a22*a33-a23*a23)-a12*(a12*a33-a23*a13)+a13*(a12*a23-a22*a13);
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
  const sx=(b1*(a22*a33-a23*a23)-a12*(b2*a33-a23*b3)+a13*(b2*a23-a22*b3))/det;
  const sy=(a11*(b2*a33-a23*b3)-b1*(a12*a33-a23*a13)+a13*(a12*b3-b2*a13))/det;
  const sr=(a11*(a22*b3-b2*a23)-a12*(a12*b3-b2*a13)+b1*(a12*a23-a22*a13))/det;
  x+=sx;y+=sy;r+=sr;
  if(Math.abs(sx)+Math.abs(sy)+Math.abs(sr)<1e-4)break;
 }
 return Number.isFinite(x+y+r)&&r>0?{x,y,r}:null;
}
// Height of an eyelid line at a given x. `line` is a list of {x,y} points
// along the lid, as the eye model reports it.
function lidAt(line,x){
 if(x<=line[0].x)return line[0].y;
 for(let i=1;i<line.length;i++)if(x<=line[i].x){const a=line[i-1],b=line[i],t=b.x>a.x?(x-a.x)/(b.x-a.x):0;return a.y+t*(b.y-a.y);}
 return line[line.length-1].y;
}
// Whether a point lies in the open part of the eye, clear of both lids.
// lids {upper,lower} are the two lid lines; without them every point counts.
function openEye(lids,margin){
 if(!lids)return ()=>true;
 const sort=line=>[...line].sort((a,b)=>a.x-b.x),upper=sort(lids.upper),lower=sort(lids.lower);
 return (x,y)=>y>=lidAt(upper,x)+margin&&y<=lidAt(lower,x)-margin;
}
// Finds the edge between the iris and the white of the eye and fits a circle to
// it. `guess` {x,y,r} comes from the eye model, in pixels of this luminance
// patch. Returns the refined circle with a quality report, or null when the
// edge is not clear enough to trust.
//
// First a coarse search over nearby circles finds the one with the strongest
// dark-inside, bright-outside step along the sides of the iris, where the lids
// do not cover it. Then rays from that centre locate the step to a fraction of
// a pixel, and a circle is fitted with outliers (lashes, a lid, a stray
// reflection) weighted out. Steps next to a reflection are never used.
export function refineIris(gray,width,height,guess,{axis=0,up=null,down=null,rays=17,minimumStep=5,lids=null,radius=null}={}){
 if(!guess||!(guess.r>=3)||![guess.x,guess.y,axis].every(Number.isFinite))return null;
 const at=sampler(gray,width,height),light=eyeLight(gray,width,height,guess);
 if(!light||light.contrast<8)return null;
 const valid=lids&&[lids.upper,lids.lower].every(line=>Array.isArray(line)&&line.length>=2&&line.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)));
 // With lid lines the search may use a wide arc, because points on a lid are
 // excluded one by one. Without them it keeps to the sides of the iris.
 const bright=light.bright,arc={up:up??(valid?60:30),down:down??(valid?70:40)},open=openEye(valid?lids:null,.1*guess.r);
 const angles=[];
 for(const side of [0,Math.PI])for(let i=0;i<rays;i++)angles.push({side:side?1:0,angle:axis+side+(side?-1:1)*((-arc.up+(arc.up+arc.down)*i/(rays-1))*Math.PI/180)});
 const directions=angles.map(a=>({...a,cx:Math.cos(a.angle),cy:Math.sin(a.angle)}));
 // Coarse search: which nearby circle has the clearest edge all the way round?
 let circle={...guess},bestScore=-Infinity;
 // `radius` is this person's iris radius in these pixels, once it is known
 // from earlier frames. It narrows the search and steadies short arcs.
 const known=Number.isFinite(radius)&&radius>=.7*guess.r&&radius<=1.4*guess.r?radius:null,base=known??guess.r;
 const reach=.5*guess.r,grid=Math.max(1,guess.r/8),delta=Math.max(1,.12*guess.r),level=v=>clamp(v,light.dark,light.white);
 for(const scale of known?[.94,1,1.06]:[.8,.9,1,1.1,1.22])for(let y=guess.y-reach;y<=guess.y+reach+1e-6;y+=grid)for(let x=guess.x-reach;x<=guess.x+reach+1e-6;x+=grid){
  const r=base*scale;let score=0,used=0;
  for(const d of directions){
   const outer=at(x+(r+delta)*d.cx,y+(r+delta)*d.cy),inner=at(x+(r-delta)*d.cx,y+(r-delta)*d.cy);
   if(!Number.isFinite(outer+inner)||outer>=bright||inner>=bright||!open(x+(r+delta)*d.cx,y+(r+delta)*d.cy))continue;
   // Count only a step from iris-dark to white-of-eye-bright. The pupil edge
   // (dark to dark) and skin beside a lash line then add almost nothing.
   score+=level(outer)-level(inner);used++;
  }
  // Enough of the edge must show on each candidate: a blink or a squint hides it.
  if(used>=Math.max(10,directions.length*.35)&&score/used>bestScore){bestScore=score/used;circle={x,y,r};}
 }
 if(!(bestScore>=Math.max(minimumStep,.25*light.contrast)))return null;
 let result=null;
 for(let pass=0;pass<4;pass++){
  const step=.5,from=.6*circle.r,count=Math.max(8,Math.round(.85*circle.r/step)),span=2,reachSamples=clamp(Math.round(circle.r/5),4,10),points=[];
  let skipped=0;
  for(const {side,cx,cy} of directions){
   const profile=new Float32Array(count+1);let usable=true,glare=false;
   for(let k=0;k<=count;k++){const v=at(circle.x+(from+k*step)*cx,circle.y+(from+k*step)*cy);if(!Number.isFinite(v)){usable=false;break;}profile[k]=v;}
   if(!usable)continue;
   let best=-1,bestValue=minimumStep;const steps=new Float32Array(count+1);
   for(let k=span;k<=count-span;k++){
    // Difference of two short averages: a smoothed outward brightness step.
    let inner=0,outer=0,peak=profile[k];
    for(let j=1;j<=span;j++){inner+=profile[k-j];outer+=profile[k+j];peak=Math.max(peak,profile[k-j],profile[k+j]);}
    const value=(outer-inner)/span;steps[k]=value;
    // The far side of the step must reach toward the white of the eye; the
    // pupil's own edge stays dark on both sides.
    if(outer/span<light.dark+.4*light.contrast)continue;
    // A reflection has a dark-to-bright edge of its own; never take that one.
    if(peak>=bright){glare=true;continue;}
    // Prefer steps near the expected radius: the pupil edge and the lid lie elsewhere.
    const expected=(from+k*step-circle.r)/(.18*circle.r),score=value*Math.exp(-.5*expected*expected);
    if(score>bestValue){bestValue=score;best=k;}
   }
   if(glare)skipped++;
   if(best<0)continue;
   // Sub-sample position: the centre of the brightness rise around that step.
   // This stays accurate for a crisp edge and for a soft, out-of-focus one.
   let rise=0,moment=0;
   for(let k=Math.max(1,best-reachSamples);k<=Math.min(count-1,best+reachSamples);k++){const g=Math.max(0,profile[k+1]-profile[k-1]);rise+=g;moment+=g*k;}
   if(!(rise>0))continue;
   const rho=from+moment/rise*step,point={x:circle.x+rho*cx,y:circle.y+rho*cy,side,strength:steps[best]};
   if(open(point.x+2*cx,point.y+2*cy))points.push(point);
  }
  if(points.length<8||!known&&[0,1].some(side=>points.filter(p=>p.side===side).length<3))return null;
  // Robust fit: start from all points, then down-weight what lies off the circle.
  let weights=points.map(()=>1),fitted=circle,scale=1;
  for(let round=0;round<5;round++){
   const next=fitCircle(points,weights,fitted,known?{radius:known,weight:.6*points.length}:null);if(!next)return null;fitted=next;
   const residuals=points.map(p=>Math.hypot(p.x-fitted.x,p.y-fitted.y)-fitted.r);
   scale=Math.max(.35,1.4826*median(residuals.map(Math.abs)));
   weights=residuals.map(e=>{const u=e/(3*scale);return Math.abs(u)<1?(1-u*u)**2:0;});
  }
  const kept=points.filter((_,i)=>weights[i]>.1),sides=[0,1].map(side=>kept.filter(p=>p.side===side).length);
  const rms=Math.sqrt(kept.reduce((s,p)=>s+(Math.hypot(p.x-fitted.x,p.y-fitted.y)-fitted.r)**2,0)/Math.max(1,kept.length));
  result={x:fitted.x,y:fitted.y,r:fitted.r,rms,points:kept.length,sides,step:median(kept.map(p=>p.strength)),skipped:skipped/angles.length,light};
  const moved=Math.hypot(fitted.x-circle.x,fitted.y-circle.y);circle=fitted;
  if(moved<.02)break;
 }
 // Trust the fit only when both sides of the iris agree on one circle that is
 // close to what the model saw. With a known iris size, a clear edge on one
 // side is enough (the other may be hidden in the corner of the eye).
 const enough=known?result.points>=8&&Math.max(...result.sides)>=6:result.points>=10&&Math.min(...result.sides)>=4;
 if(!result||!enough||result.rms>Math.max(.7,.07*result.r)||result.r<.8*base||result.r>1.3*base||Math.hypot(result.x-guess.x,result.y-guess.y)>.7*guess.r)return null;
 return result;
}
// The square of camera pixels to read around one iris, and the size to read it
// at. Small irises are read pixel for pixel; a very large one is reduced so the
// work per frame stays bounded (it still has far more detail than it needs).
export function irisPatch(iris,frameWidth,frameHeight,limit=112){
 if(!iris||!(iris.r>=2)||![iris.x,iris.y].every(Number.isFinite))return null;
 const side=Math.ceil(5*iris.r)+4,x=Math.round(iris.x-side/2),y=Math.round(iris.y-side/2);
 const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(frameWidth,x+side),bottom=Math.min(frameHeight,y+side);
 if(right-left<3.2*iris.r||bottom-top<2.4*iris.r)return null;
 const scale=Math.min(1,limit/Math.max(right-left,bottom-top));
 return {x:left,y:top,width:right-left,height:bottom-top,scale,outWidth:Math.max(8,Math.round((right-left)*scale)),outHeight:Math.max(8,Math.round((bottom-top)*scale))};
}
// Reads iris patches from a camera frame. createSurface is replaceable so the
// geometry can be tested without a browser.
export function patchReader(createSurface=(width,height)=>new OffscreenCanvas(width,height)){
 let canvas=null,ctx=null;
 return (frame,patch)=>{
  if(!canvas||canvas.width<patch.outWidth||canvas.height<patch.outHeight){canvas=createSurface(Math.max(128,patch.outWidth),Math.max(128,patch.outHeight));ctx=canvas.getContext('2d',{willReadFrequently:true});}
  ctx.drawImage(frame,patch.x,patch.y,patch.width,patch.height,0,0,patch.outWidth,patch.outHeight);
  return luminance(ctx.getImageData(0,0,patch.outWidth,patch.outHeight).data,patch.outWidth,patch.outHeight);
 };
}
// Refines one iris in a camera frame. `iris` {x,y,r} is in frame pixels and so
// is the result. read(frame,patch) returns the luminance of that patch.
export function refineInFrame(frame,iris,read,options){
 const patch=irisPatch(iris,frame.width,frame.height);if(!patch)return null;
 const gray=read(frame,patch),k=patch.scale;
 // A canvas pixel covers [i,i+1) of the frame, so its value sits at i+.5.
 const local={x:(iris.x-patch.x)*k-.5,y:(iris.y-patch.y)*k-.5,r:iris.r*k},line=points=>points.map(p=>({x:(p.x-patch.x)*k-.5,y:(p.y-patch.y)*k-.5}));
 const lids=options?.lids?{upper:line(options.lids.upper),lower:line(options.lids.lower)}:null;
 const fitted=refineIris(gray,patch.outWidth,patch.outHeight,local,{...options,lids,radius:Number.isFinite(options?.radius)?options.radius*k:null});
 const light=fitted?.light||eyeLight(gray,patch.outWidth,patch.outHeight,local);
 if(!fitted)return {iris:null,light};
 return {iris:{x:patch.x+(fitted.x+.5)/k,y:patch.y+(fitted.y+.5)/k,r:fitted.r/k,rms:fitted.rms/k,points:fitted.points,skipped:fitted.skipped},light};
}

// Iris position along and across the line between the two eye corners, as a
// share of the eye's width: the same reading both eye models produce. a and b
// are the corners and c the iris centre, all in frame pixels.
export function irisReading(a,b,c){
 if(a.x>b.x)[a,b]=[b,a];
 const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;if(!(d>0))return null;
 const h=((c.x-a.x)*dx+(c.y-a.y)*dy)/d,v=(-(c.x-(a.x+b.x)/2)*dy+(c.y-(a.y+b.y)/2)*dx)/d;
 return Number.isFinite(h+v)?{h,v}:null;
}
// Reads both irises from camera pixels, frame after frame. Each eye is given as
// {a,b,iris:{x,y,r},upper,lower}: its corners, the model's iris estimate and its
// lid lines, all in frame pixels. Returns one entry per eye with the refined
// reading {h,v}, the refined iris and how the eye is lit; `h` is absent when
// the iris edge could not be found (the caller then uses the model's reading).
export class IrisDetail{
 constructor(read=null){this.read=read;this.sizes=[[],[]];}
 reset(){this.sizes=[[],[]];}
 refine(frame,eyes){
  this.read??=patchReader();
  const spacing=eyes.length===2?Math.hypot(eyes[1].iris.x-eyes[0].iris.x,eyes[1].iris.y-eyes[0].iris.y):NaN;
  return eyes.map((eye,i)=>{
   // An iris does not change size. Once this eye's size relative to the spacing
   // of the eyes is known, it steadies the fit on frames that show less edge.
   const known=this.sizes[i].length>=20&&spacing>0?median(this.sizes[i])*spacing:null;
   const axis=Math.atan2(eye.b.y-eye.a.y,eye.b.x-eye.a.x),tilt=Math.abs(axis)>Math.PI/2?axis-Math.sign(axis)*Math.PI:axis;
   const found=refineInFrame(frame,eye.iris,this.read,{axis:tilt,lids:eye.upper&&eye.lower?{upper:eye.upper,lower:eye.lower}:null,radius:known});
   if(!found)return {light:null};
   if(!found.iris)return {light:found.light};
   if(spacing>0&&found.iris.points>=14){const sizes=this.sizes[i];sizes.push(found.iris.r/spacing);if(sizes.length>120)sizes.shift();}
   return {...irisReading(eye.a,eye.b,found.iris),iris:found.iris,light:found.light};
  });
 }
}

// A compact, rounded report of how one eye is lit, for the app and its reports.
export function lightSummary(light){
 return light?{white:Math.round(light.white),dark:Math.round(light.dark),contrast:Math.round(light.contrast),glare:Math.round(light.glare*100)/100,clipped:Math.round(light.clipped*1000)/1000}:null;
}
// Share of the iris a reflection may cover before that eye is not trusted.
export const GLARE_LIMIT=.2;
