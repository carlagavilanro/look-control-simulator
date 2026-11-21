// This website's own pages under the eye pointer (browser only; the Windows app has the whole
// screen instead).
//
// In a browser, eye control cannot reach outside its own page. So the pages that hold the
// controls (Devices, Set up a device) are shown in a frame inside Screen control, and their
// buttons, links and boxes are offered to the pointer exactly as another program's controls are
// in the Windows app: look near one and hold. A text box takes what is written with the eye
// keyboard; a drop-down list is offered as large buttons.
export function createSite(frame){
 const elements=new Map();let field=null;
 const page=()=>{try{return frame.contentDocument;}catch{return null;}};
 const name=el=>(el.getAttribute('aria-label')||el.labels?.[0]?.textContent||el.textContent||el.placeholder||el.value||el.title||'').replace(/\s+/g,' ').trim().slice(0,60);
 const isEdit=el=>el.tagName==='TEXTAREA'||el.tagName==='INPUT'&&!['checkbox','radio','button','submit','reset','file','range','color'].includes(el.type);
 function show(path='/'){if(!frame.getAttribute('src'))frame.src=path;}
 // Between the bar at the top and the buttons at the bottom.
 function layout(top,bottom){frame.style.top=Math.round(top)+'px';frame.style.height=Math.max(120,Math.round(bottom-top))+'px';}
 // Everything on the shown part of the page that can be pressed or written in.
 function targets(){
  const doc=page(),box=frame.getBoundingClientRect();elements.clear();
  if(!doc?.body||frame.hidden||box.width<50)return [];
  const view=doc.defaultView,open=[...doc.querySelectorAll('dialog[open]')].at(-1),found=[];
  // While one of the page's own dialogs is open, only what is inside it can be used.
  for(const el of (open||doc).querySelectorAll('button,a[href],input,select,textarea,summary')){
   if(el.disabled||el.type==='hidden'||el.closest('[hidden],[inert]'))continue;
   // A link back to Screen control would put this page inside itself.
   if(el.tagName==='A'&&new URL(el.href,doc.baseURI).pathname.startsWith('/screen'))continue;
   const style=view.getComputedStyle(el);if(style.visibility==='hidden'||style.display==='none'||style.pointerEvents==='none')continue;
   const r=el.getBoundingClientRect(),left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(box.width,r.right),bottom=Math.min(box.height,r.bottom);
   // At least half of it must be showing.
   if(r.width<8||r.height<8||right-left<r.width/2||bottom-top<r.height/2)continue;
   const id='site-'+found.length;elements.set(id,el);
   found.push({id,label:name(el)||'Control',kind:isEdit(el)?'Edit':'Button',enabled:true,rect:{left:box.left+left,top:box.top+top,right:box.left+right,bottom:box.top+bottom,width:right-left,height:bottom-top}});
  }
  return found;
 }
 // Press it. A text box is made ready for writing; a drop-down list comes back as choices.
 function activate(target){
  const el=elements.get(target.id);if(!el?.isConnected)return null;
  const view=el.ownerDocument.defaultView;
  if(el.tagName==='SELECT')return {edit:false,label:name(el)||'Choose one',choices:[...el.options].filter(o=>!o.disabled).map(o=>({label:o.textContent.trim(),choose(){el.value=o.value;el.dispatchEvent(new view.Event('change',{bubbles:true}));}}))};
  el.focus({preventScroll:false});
  if(isEdit(el)){field=el;return {edit:true};}
  field=null;el.click();return {edit:false};
 }
 function write(value){
  const view=field.ownerDocument.defaultView,kind=field.tagName==='TEXTAREA'?view.HTMLTextAreaElement:view.HTMLInputElement;
  const limit=field.maxLength>0?field.maxLength:Infinity;
  Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(field,Array.from(value).slice(0,limit).join(''));
  field.dispatchEvent(new view.Event('input',{bubbles:true}));
 }
 function enter(){
  const view=field.ownerDocument.defaultView;
  if(field.form)field.form.requestSubmit();else field.dispatchEvent(new view.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 }
 // What the keyboard and the scroll buttons send. Returns what to say, or '' for nothing.
 function command(payload){
  const view=frame.contentWindow;
  if(payload.type==='scroll'){view?.scrollBy({top:-payload.amount*140,behavior:'smooth'});return '';}
  if(!field?.isConnected){field=null;return 'Look at a text box on the page first.';}
  if(payload.type==='text'){write(field.value+payload.text);if(payload.submit)enter();return '';}
  if(payload.type==='key'&&payload.key==='backspace'){write(Array.from(field.value).slice(0,-1).join(''));return '';}
  if(payload.type==='key'&&payload.key==='enter'){enter();return '';}
  return 'That key is for other apps. It does nothing on this page.';
 }
 return {show,layout,targets,activate,command,get writing(){return field?.isConnected?name(field)||'the text box':'';}};
}
