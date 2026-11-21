// Gaze chooses among visible keyboard-focusable controls, never arbitrary
// paragraph text. Both fresh raw gaze and the displayed estimate must agree.

// Near a screen edge the estimates are least exact: calibration cannot place a
// dot beyond the edge, so nothing pins them down from the far side, and they
// tend to stop short of it. Nothing lies beyond the edge either. So a look that
// lands in the outer band is treated as reaching from where it landed out to
// that edge: a control anywhere along that stretch counts as looked at. Such a
// control is not taken directly; it is offered in a list (see focusChoice).
export const EDGE_BAND=.1;
// A control must lead its nearest rival by this much (in catch radii) to be
// taken directly.
export const CLEAR_LEAD=.18;
// The most controls offered in one list.
export const CHOICES=8;
// While a list is on offer the rules are a little wider, so that it does not
// flicker with a single control when the look sits on the boundary.
const HOLD=1.3;

const usable=(raw,point,width,height)=>!!raw&&!!point&&[raw.x,raw.y,point.x,point.y,width,height].every(Number.isFinite);
// Distance along one axis from a look at `v` to the stretch lo..hi.
function gap(v,lo,hi,size,band){
 if(band>0&&v<size*band)return Math.max(lo-v,0);
 if(band>0&&v>size*(1-band))return Math.max(v-hi,0);
 return Math.max(lo-v,0,v-hi);
}
function rank(raw,point,targets,width,height,radiusX,radiusY,band=0){
 const distance=(p,r)=>Math.hypot(gap(p.x*width,r.left,r.right,width,band)/radiusX,gap(p.y*height,r.top,r.bottom,height,band)/radiusY);
 return targets.filter(t=>t.rect&&t.enabled!==false).map(t=>{
  const a=distance(raw,t.rect),b=distance(point,t.rect),r=t.rect;
  return {target:t,score:Math.max(a,b),area:(r.right-r.left)*(r.bottom-r.top)};
 }).filter(t=>t.score<=1&&t.area>0).sort((a,b)=>a.score-b.score||a.area-b.area);
}

export function focusTarget(raw,point,targets,width,height,{radiusX=70,radiusY=55}={}){
 if(!usable(raw,point,width,height))return null;
 const ranked=rank(raw,point,targets,width,height,radiusX,radiusY);
 if(!ranked.length)return null;
 const [best,second]=ranked;
 // Overlapping nested controls may share geometry. Identical targets are
 // deduplicated by the provider; unresolved neighbors require a clearer look.
 if(second&&second.score-best.score<CLEAR_LEAD)return null;
 return best.target;
}

// Does `t` lie further out than `b`, towards an edge the look is close to? The
// estimate may not be able to travel that far, so `b` being nearest says little.
function outward(t,b,points,band){
 const x=(t.left+t.right)/2,y=(t.top+t.bottom)/2;
 return points.some(p=>p.x<band&&x<b.left||p.x>1-band&&x>b.right||p.y<band&&y<b.top||p.y>1-band&&y>b.bottom);
}

// What a look at another program's controls means.
//   {target}:        one control. It is clearly the nearest within the ordinary
//                    reach (or is the one already held, `held` being its id,
//                    while no rival clearly leads it), and no other control
//                    lies beyond it towards a nearby screen edge.
//   {several, rect}: controls too close together to tell apart, or reached only
//                    by the stretch out to a screen edge. They are to be offered
//                    as a list of large buttons, nearest first; `rect` is the
//                    area they cover. Pass `offered:true` while such a list is
//                    on offer.
//   null:            nothing near.
export function focusChoice(raw,point,targets,width,height,{radiusX=70,radiusY=55,held=null,offered=false}={}){
 if(!usable(raw,point,width,height))return null;
 const band=EDGE_BAND*(offered?HOLD:1),wide=rank(raw,point,targets,width,height,radiusX,radiusY,band);
 if(!wide.length)return null;
 const near=rank(raw,point,targets,width,height,radiusX,radiusY);
 if(near.length){
  const [best,second]=near,kept=held===null?null:near.find(r=>r.target.id===held);
  const pick=kept&&kept.score-best.score<CLEAR_LEAD?kept:!second||second.score-best.score>=CLEAR_LEAD*(offered?HOLD:1)?best:null;
  if(pick&&!wide.some(r=>r.target!==pick.target&&outward(r.target.rect,pick.target.rect,[raw,point],band)))return {target:pick.target};
 }
 // Nearest first; among those the stretch to the edge reaches equally, the one
 // nearest to where the look landed.
 const plain=p=>(r)=>Math.hypot(Math.max(r.left-p.x*width,0,p.x*width-r.right)/radiusX,Math.max(r.top-p.y*height,0,p.y*height-r.bottom)/radiusY);
 const actual=plain(point),several=wide.map(r=>({...r,actual:actual(r.target.rect)})).sort((a,b)=>a.score-b.score||a.actual-b.actual||a.area-b.area).slice(0,CHOICES).map(r=>r.target);
 const rect=several.reduce((a,t)=>({left:Math.min(a.left,t.rect.left),top:Math.min(a.top,t.rect.top),right:Math.max(a.right,t.rect.right),bottom:Math.max(a.bottom,t.rect.bottom)}),{left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity});
 return {several,rect};
}

// A control flush with a screen edge may be reported a pixel or two beyond it.
const EDGE_SLACK=2;
const sound=(t,width,height)=>typeof t.id==='string'&&t.id.length<=180&&t.rect&&
 [t.rect.left,t.rect.top,t.rect.right,t.rect.bottom].every(Number.isFinite)&&
 t.rect.right>t.rect.left&&t.rect.bottom>t.rect.top&&t.rect.left>=-EDGE_SLACK&&t.rect.right<=width+EDGE_SLACK&&
 (t.rect.right-t.rect.left)*(t.rect.bottom-t.rect.top)<width*height*.45;
// How much of a control's height shows between Hands Free's bars (0 to 1).
const showing=(r,top,bottom)=>Math.max(0,Math.min(r.bottom,bottom)-Math.max(r.top,top))/(r.bottom-r.top);

// Controls of the other program that can be looked at: those inside the
// screen and showing between Hands Free's bars. `top` and `bottom` are the
// heights of the strips the bars cover. A control at least `showing` of whose
// height is clear of the bars counts (1 = wholly clear).
export function visibleFocusTargets(targets,width,height,{top=90,bottom=160,showing:least=1}={}){
 return targets.filter(t=>sound(t,width,height)&&showing(t.rect,top,height-bottom)>=least);
}

// Controls in the order they would be read on the screen: row by row, each row
// from left to right. Controls whose tops lie within 12 px of the first of a
// row belong to that row. `first(t)` may put some controls before all others.
export function readingOrder(targets,first=()=>0){
 const rows=new Map();let row=-1,from=-Infinity,band=null;
 for(const t of [...targets].sort((a,b)=>first(a)-first(b)||a.rect.top-b.rect.top)){if(first(t)!==band||t.rect.top-from>12){row++;from=t.rect.top;band=first(t);}rows.set(t,row);}
 return [...targets].sort((a,b)=>rows.get(a)-rows.get(b)||a.rect.left-b.rect.left);
}

// Controls of the other program that lie under Hands Free's own bars: the strip
// at the top (status bar) and the strip at the bottom (dock and control bar).
// They cannot be seen or looked at, so gaze never offers them; they are listed
// on request in reading order, the top strip first (in a browser: the tabs,
// then the toolbar).
export function coveredFocusTargets(targets,width,height,{top=90,bottom=160,showing:least=1}={}){
 return readingOrder(targets.filter(t=>sound(t,width,height)&&t.rect.top>=-EDGE_SLACK&&t.rect.bottom<=height+EDGE_SLACK&&showing(t.rect,top,height-bottom)<least),t=>t.rect.top<top?0:1);
}

// Names for a list of controls: the control's own name, or its kind when it has
// none; a text box says so; equal names are numbered so they can be told apart.
export function controlNames(targets){
 const base=targets.map(t=>{
  const full=String(t.label||'').replace(/\s+/g,' ').trim(),name=full.length>34?full.slice(0,33).trimEnd()+'…':full,edit=t.kind==='Edit';
  return name?(edit&&!/box|field|search|address/i.test(name)?name+' (text box)':name):edit?'Text box':String(t.kind||'Control');
 });
 const total=base.reduce((m,n)=>m.set(n,(m.get(n)||0)+1),new Map()),seen=new Map();
 return base.map(n=>{if(total.get(n)<2)return n;const i=(seen.get(n)||0)+1;seen.set(n,i);return n+' ('+i+')';});
}
