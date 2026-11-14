// Gaze chooses among visible keyboard-focusable controls, never arbitrary
// paragraph text. Both fresh raw gaze and the displayed estimate must agree.
export function focusTarget(raw,point,targets,width,height,{radiusX=70,radiusY=55}={}){
 if(!raw||!point||![raw.x,raw.y,point.x,point.y,width,height].every(Number.isFinite))return null;
 const distance=(p,r)=>Math.hypot(Math.max(r.left-p.x*width,0,p.x*width-r.right)/radiusX,Math.max(r.top-p.y*height,0,p.y*height-r.bottom)/radiusY);
 const ranked=targets.filter(t=>t.rect&&t.enabled!==false).map(t=>{
  const a=distance(raw,t.rect),b=distance(point,t.rect),r=t.rect;
  return {target:t,score:Math.max(a,b),area:(r.right-r.left)*(r.bottom-r.top)};
 }).filter(t=>t.score<=1&&t.area>0).sort((a,b)=>a.score-b.score||a.area-b.area);
 if(!ranked.length)return null;
 const [best,second]=ranked;
 // Overlapping nested controls may share geometry. Identical targets are
 // deduplicated by the provider; unresolved neighbors require a clearer look.
 if(second&&second.score-best.score<.18)return null;
 return best.target;
}

export function visibleFocusTargets(targets,width,height,{top=90,bottom=160}={}){
 return targets.filter(t=>typeof t.id==='string'&&t.id.length<=180&&t.rect&&
  [t.rect.left,t.rect.top,t.rect.right,t.rect.bottom].every(Number.isFinite)&&
  t.rect.right>t.rect.left&&t.rect.bottom>t.rect.top&&t.rect.left>=0&&t.rect.right<=width&&t.rect.top>=top&&t.rect.bottom<=height-bottom&&
  (t.rect.right-t.rect.left)*(t.rect.bottom-t.rect.top)<width*height*.45);
}
