export const KEYS=new Set(['enter','tab','shifttab','backspace','escape','pageup','pagedown','home','end','back','forward','address']);
export function checkCommand(p){
 if(!p||typeof p!=='object')throw Error('Invalid input');
 if(p.type==='click'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)return {type:'click',x:p.x,y:p.y};
 if(p.type==='scroll'&&Number.isInteger(p.amount)&&Math.abs(p.amount)<=5&&p.amount!==0)return {type:'scroll',amount:p.amount};
 if(p.type==='text'&&typeof p.text==='string'&&p.text.length<=1000&&!/[\u0000-\u001f\u007f]/.test(p.text)&&(p.submit===undefined||typeof p.submit==='boolean'))return {type:'text',text:p.text,...(p.submit===true?{submit:true}:{})};
 if(p.type==='key'&&KEYS.has(p.key))return {type:'key',key:p.key};
 throw Error('Input is outside the supported controls');
}
export function siteUrl(site,query=''){
 if(typeof query!=='string'||query.length>1000)throw Error('Search text is too long');
 if(site==='google')return query?'https://www.google.com/search?q='+encodeURIComponent(query):'https://www.google.com/';
 if(site==='youtube')return query?'https://www.youtube.com/results?search_query='+encodeURIComponent(query):'https://www.youtube.com/';
 if(site==='home'&&!query)return 'https://control.carla.codes/';
 throw Error('Unknown website');
}
export class InputGate{
 constructor(now=()=>Date.now()){this.now=now;this.armed=false;this.lastValid=0;this.lastAction=-Infinity;this.busy=false;this.epoch=0;}
 arm(){this.armed=true;this.lastValid=0;this.epoch++;}
 pause(){this.armed=false;this.lastValid=0;this.epoch++;}
 heartbeat(valid){this.lastValid=valid&&this.armed?this.now():0;}
 check(){if(!this.armed||!this.lastValid||this.now()-this.lastValid>600)throw Error('Eye tracking is paused or stale.');}
 begin(){this.check();if(this.busy||this.now()-this.lastAction<350)throw Error('Please wait for the previous action.');this.busy=true;this.lastAction=this.now();return this.epoch;}
 recheck(epoch){this.check();if(epoch!==this.epoch)throw Error('Input was canceled.');}
 finish(){this.busy=false;}
}
