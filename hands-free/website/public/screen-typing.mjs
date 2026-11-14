// Local word completion. No typed text, learned history or requests leave this
// module. Frequency data is separately attributed in vendor/english-words-NOTICE.txt.
const COMMON_TYPOS={teh:'the',hte:'the',adn:'and',thsi:'this',taht:'that',wiht:'with',woudl:'would',shoudl:'should',coudl:'could',recieve:'receive',reciever:'receiver',transciever:'transceiver',thier:'their',becuase:'because',beacuse:'because',definately:'definitely',seperate:'separate',calibaration:'calibration',accomodate:'accommodate',youtub:'youtube'};
const EXTRA=['youtube','google','calibration','camera','keyboard','receiver','transmitter','transceiver','handsfree'];
const WORD=/[a-zA-Z]+(?:['’][a-zA-Z]*)?/g;
const normalize=s=>s.toLowerCase().replaceAll('’',"'");
function casing(word,original){return original===original.toUpperCase()?word.toUpperCase():/^[A-Z]/.test(original)?word[0].toUpperCase()+word.slice(1):word;}
export function wordAt(text,caret=text.length){
 if(!Number.isInteger(caret)||caret<0||caret>text.length)return null;
 for(const m of text.matchAll(WORD)){
  const start=m.index,end=start+m[0].length;
  if(caret>start&&caret<=end){
   const token=text.slice(0,caret).split(/\s/).at(-1)+text.slice(caret).split(/\s/)[0];
   // Leave addresses, handles, file paths, numbers and URLs literal.
   if(/[\d@/\\:_#=]/.test(token)||/\.[a-z]{2,}(?:\b|$)/i.test(token)||text[start-1]==='.')return null;
   return {start,end,word:m[0],prefix:text.slice(start,caret)};
  }
 }
 return null;
}
export function editDistance(a,b,max=2){
 if(Math.abs(a.length-b.length)>max)return max+1;
 let previous=Array.from({length:b.length+1},(_,i)=>i),older=null;
 for(let i=1;i<=a.length;i++){
  const row=[i];let minimum=i;
  for(let j=1;j<=b.length;j++){
   row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
   if(older&&i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])row[j]=Math.min(row[j],older[j-2]+1);
   minimum=Math.min(minimum,row[j]);
  }
  if(minimum>max)return max+1;
  older=previous;previous=row;
 }
 return previous[b.length];
}
export class WordSuggestions{
 constructor(entries=[]){
  this.words=new Map(entries.filter(([word,count])=>/^[a-z]+(?:'[a-z]+)?$/.test(word)&&Number.isFinite(count)&&count>0));
  for(const word of EXTRA)if(!this.words.has(word))this.words.set(word,50000);
 }
 suggest(text,caret=text.length){
  const at=wordAt(text,caret);if(!at||at.prefix.length<2||at.prefix.length>24)return [];
  const prefix=normalize(at.prefix),candidates=[],known=this.words.has(prefix);
  const typo=COMMON_TYPOS[prefix];
  for(const [word,count] of this.words){
   if(word===prefix)continue;
   if(word.startsWith(prefix))candidates.push({word,kind:'complete',score:20+Math.log2(count)-.15*(word.length-prefix.length)});
   else if(prefix.length>=3&&!known&&Math.abs(word.length-prefix.length)<=2){
    const distance=editDistance(prefix,word,prefix.length>=6?2:1);
    if(distance<=(prefix.length>=6?2:1))candidates.push({word,kind:'correct',score:Math.log2(count)-distance*7+(word[0]===prefix[0]?1:0)});
   }
  }
  if(typo)candidates.push({word:typo,kind:'correct',score:100});
  return [...new Map(candidates.sort((a,b)=>b.score-a.score||a.word.localeCompare(b.word)).map(c=>[c.word,c])).values()].slice(0,3).map(c=>({...c,word:casing(c.word,at.prefix)}));
 }
 correct(text,caret=text.length){
  const at=wordAt(text,caret);if(!at||caret!==at.end)return null;
  const word=normalize(at.word),replacement=COMMON_TYPOS[word];
  // Automatic changes are limited to common, explicit typos. Ambiguous
  // spellings and names remain suggestions until the user selects one.
  return replacement?{...at,replacement:casing(replacement,at.word)}:null;
 }
}
export function insertText(text,start,end,insert,engine,autocorrect=true){
 start=Math.max(0,Math.min(text.length,start));end=Math.max(start,Math.min(text.length,end));
 const literal=text.slice(0,start)+insert+text.slice(end),caret=start+insert.length;
 const correction=autocorrect&&insert===' '&&start===end?engine?.correct(text,start):null;
 if(!correction)return {text:literal,caret,undo:null};
 const value=text.slice(0,correction.start)+correction.replacement+' '+text.slice(end);
 return {text:value,caret:correction.start+correction.replacement.length+1,undo:{text:literal,caret},corrected:correction.replacement};
}
export function completeWord(text,caret,suggestion){
 const at=wordAt(text,caret);if(!at||!/^[a-z]+(?:'[a-z]+)?$/i.test(suggestion))return null;
 const space=/^\s/.test(text.slice(at.end))?'':' ',value=text.slice(0,at.start)+suggestion+space+text.slice(at.end);
 return {text:value,caret:at.start+suggestion.length+1,undo:{text,caret}};
}
