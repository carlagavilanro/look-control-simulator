// Eye gesture selector. This estimates calibrated horizontal eye position,
// not screen gaze coordinates. No images are persisted. Named calibration storage is handled by ProfileStore.
export function eyeFeature(points) {
  if (!points || points.length < 478) return null;
  const eye=(a,b,iris,top,bottom)=>{
    if(points[a].x>points[b].x)[a,b]=[b,a];
    const p=points[a],q=points[b],r=points[iris];
    const dx=q.x-p.x,dy=q.y-p.y,w=dx*dx+dy*dy;
    if(w<0.00001)return null;
    const opening=Math.hypot(points[top].x-points[bottom].x,points[top].y-points[bottom].y)/Math.sqrt(w);
    if(opening<0.12)return null;
    return ((r.x-p.x)*dx+(r.y-p.y)*dy)/w;
  };
  const left=eye(33,133,468,159,145),right=eye(362,263,473,386,374);
  if(left===null||right===null||Math.abs(left-right)>0.25)return null;
  const value=(left+right)/2;
  if(!Number.isFinite(value)||value<0||value>1)return null;
  return {value,x:points[1].x,y:points[1].y,scale:Math.hypot(points[33].x-points[263].x,points[33].y-points[263].y)};
}
export class EyeSelector {
  constructor(){this.calibration=null;this.reset();}
  reset(){this.lastAt=null;this.neutralAt=null;this.pending=null;this.pendingAt=0;this.armed=false;}
  direction(feature){
    const c=this.calibration;
    if(!feature||!c||Math.abs(feature.x-c.x)>0.08||Math.abs(feature.y-c.y)>0.08||Math.abs(feature.scale/c.scale-1)>0.25)return 'uncertain';
    const d=feature.value-c.center;
    if(d/(c.left-c.center)>0.65)return 'left';
    if(d/(c.right-c.center)>0.65)return 'right';
    if(Math.abs(d)<Math.min(Math.abs(c.left-c.center),Math.abs(c.right-c.center))*0.35)return 'center';
    return 'uncertain';
  }
  calibrate(samples){
    for(const key of ['center','left','right'])if(!samples[key]||samples[key].length<20)throw Error('Collect at least 20 valid frames per direction.');
    const average=key=>samples[key].reduce((s,v)=>s+v.value,0)/samples[key].length;
    const c=average('center'),l=average('left'),r=average('right');
    if((l-c)*(r-c)>=0||Math.abs(l-c)<0.055||Math.abs(r-c)<0.055)throw Error('Eye directions were not distinct enough. Recalibrate with a steady head.');
    for(const key of ['center','left','right']){
      const m=average(key);const spread=Math.sqrt(samples[key].reduce((s,v)=>s+(v.value-m)**2,0)/samples[key].length);
      if(spread>0.065)throw Error('Calibration moved too much. Try again.');
    }
    const center=samples.center;
    this.calibration={center:c,left:l,right:r,x:center.reduce((s,v)=>s+v.x,0)/center.length,y:center.reduce((s,v)=>s+v.y,0)/center.length,scale:center.reduce((s,v)=>s+v.scale,0)/center.length};this.reset();
  }
  update(feature,now){
    const previous=this.lastAt;this.lastAt=now;
    const c=this.calibration;
    if(!feature||!c||!Number.isFinite(now)||(previous!==null&&(now<=previous||now-previous>300))||Math.abs(feature.x-c.x)>0.08||Math.abs(feature.y-c.y)>0.08||Math.abs(feature.scale/c.scale-1)>0.25){this.reset();this.lastAt=now;return null;}
    const delta=feature.value-c.center;
    let gesture='center';
    if(delta/(c.left-c.center)>0.65)gesture='left';
    else if(delta/(c.right-c.center)>0.65)gesture='right';
    const neutral=Math.abs(delta)<Math.min(Math.abs(c.left-c.center),Math.abs(c.right-c.center))*0.35;
    if(neutral){this.pending=null;if(this.neutralAt===null)this.neutralAt=now;if(now-this.neutralAt>=450)this.armed=true;return null;}
    this.neutralAt=null;
    if(gesture==='center'){this.pending=null;return null;}
    if(!this.armed)return null;
    if(this.pending!==gesture){this.pending=gesture;this.pendingAt=now;return null;}
    if(now-this.pendingAt<650)return null;
    this.armed=false;this.pending=null;return gesture;
  }
}

// Count only time between fresh, valid center frames. Brief landmark loss
// pauses a hold for up to 700 ms; longer loss resets time but keeps the target.
// Completing a hold never arms the next screen.
export class DwellSelector {
  constructor(ms=1000,{pauseMs=700}={}){this.ms=ms;this.pauseMs=pauseMs;this.clear();}
  clear(){this.target=null;this.lastAt=null;this.elapsed=0;this.progress=0;this.wasCenter=false;this.missingSince=null;this.paused=false;}
  arm(target){this.clear();this.target=target;}
  update(center,now){
    if(this.target===null)return null;
    const previous=this.lastAt;
    const gap=previous!==null&&(now<=previous||now-previous>300);
    if(!Number.isFinite(now)){const target=this.target;this.arm(target);return null;}
    this.lastAt=now;
    if(gap){this.elapsed=0;this.progress=0;this.wasCenter=false;this.missingSince=null;this.paused=true;return null;}
    if(center===null){
      if(this.missingSince===null)this.missingSince=previous??now;
      if(now-this.missingSince>this.pauseMs){this.elapsed=0;this.progress=0;}
      this.wasCenter=false;this.paused=true;return null;
    }
    if(!center){this.elapsed=0;this.progress=0;this.wasCenter=false;this.missingSince=null;this.paused=false;return null;}
    if(this.missingSince!==null&&now-this.missingSince>this.pauseMs){this.elapsed=0;this.progress=0;}
    this.missingSince=null;this.paused=false;
    if(this.wasCenter&&previous!==null)this.elapsed+=now-previous;
    this.wasCenter=true;
    this.progress=Math.min(1,this.elapsed/this.ms);
    if(this.progress<1)return null;
    const selected=this.target;this.clear();return selected;
  }
}
