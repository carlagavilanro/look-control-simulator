// Geometry between the face model's landmarks and the camera frame. Kept apart
// from the worker so it can be tested without the model.
const UPPER=[[33,246,161,160,159,158,157,173,133],[362,398,384,385,386,387,388,466,263]];
const LOWER=[[33,7,163,144,145,153,154,155,133],[362,382,381,380,374,373,390,249,263]];
const CORNERS=[[33,133],[362,263]],IRIS=[468,473];
const median=values=>{const s=[...values].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
// Landmarks of the part of the frame the model was given (`view`, in frame
// pixels) expressed as shares of the whole frame.
export function framePoints(local,view){
 if(!local)return local;
 const sx=view.width/view.frameWidth,sy=view.height/view.frameHeight,ox=view.x/view.frameWidth,oy=view.y/view.frameHeight;
 return local.map(p=>({x:ox+p.x*sx,y:oy+p.y*sy,z:p.z*sx}));
}
// Extent of the face as shares of the frame, or null without a face.
export function faceExtent(points){
 if(!points?.length)return null;
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const p of points){if(p.x<x0)x0=p.x;if(p.x>x1)x1=p.x;if(p.y<y0)y0=p.y;if(p.y>y1)y1=p.y;}
 return [x0,y0,x1,y1].every(Number.isFinite)?{x0,y0,x1,y1}:null;
}
// Both eyes in pixels of the image the model was given, in the order the gaze
// features use: corners, the model's iris circle and the two lid lines.
export function faceEyes(local,width,height){
 const px=i=>({x:local[i].x*width,y:local[i].y*height});
 return [0,1].map(e=>{
  const c=px(IRIS[e]),ring=[1,2,3,4].map(k=>px(IRIS[e]+k));
  return {a:px(CORNERS[e][0]),b:px(CORNERS[e][1]),iris:{...c,r:median(ring.map(q=>Math.hypot(q.x-c.x,q.y-c.y)))},upper:UPPER[e].map(px),lower:LOWER[e].map(px)};
 });
}
