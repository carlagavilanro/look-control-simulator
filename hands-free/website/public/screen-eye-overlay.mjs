// Display landmarks from the same frame used by the tracker. These drawings
// do not change the measurements used to fit or validate the gaze map.
const EYES = [
  [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
  [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398],
];
export function eyeOverlay(points){
  if(!points || points.length<478)return null;
  const xy=i=>({x:points[i].x,y:points[i].y});
  const eyes={outlines:EYES.map(ids=>ids.map(xy)),irises:[468,473].map(i=>({center:xy(i),ring:[1,2,3,4].map(j=>xy(i+j))}))};
  const all=[...eyes.outlines.flat(),...eyes.irises.flatMap(i=>[i.center,...i.ring])];
  return all.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))?eyes:null;
}
// view {x,y,size} is the square of the picture the face tracker is reading, in
// frame pixels. Drawing it shows that the tracker follows the face even though
// the camera picture itself stays as it is.
export function drawEyeOverlay(canvas,eyes,width,height,view=null){
  if(!(width>0&&height>0))return;
  if(canvas.width!==width)canvas.width=width;
  if(canvas.height!==height)canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);
  if(view&&view.size>0&&view.size<Math.min(width,height)){
    ctx.save();ctx.strokeStyle='#ffd166';ctx.lineWidth=Math.max(2,width/640);ctx.setLineDash([6*ctx.lineWidth,4*ctx.lineWidth]);
    ctx.strokeRect(view.x,view.y,view.size,view.size);ctx.restore();
  }
  if(!eyes)return;
  ctx.strokeStyle='#39b9ff';ctx.fillStyle='#39b9ff';ctx.lineWidth=Math.max(2,width/640);
  for(const poly of eyes.outlines){
    ctx.beginPath();poly.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x*width,p.y*height));ctx.closePath();ctx.stroke();
  }
  for(const {center,ring} of eyes.irises){
    const dx=(ring[0].x-ring[2].x)*width,dy=(ring[0].y-ring[2].y)*height;
    const rx=Math.hypot(dx,dy)/2,ry=Math.hypot((ring[1].x-ring[3].x)*width,(ring[1].y-ring[3].y)*height)/2;
    ctx.beginPath();ctx.ellipse(center.x*width,center.y*height,rx,ry,Math.atan2(dy,dx),0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.arc(center.x*width,center.y*height,ctx.lineWidth*.65,0,Math.PI*2);ctx.fill();
  }
}
