import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WordSuggestions,wordAt,editDistance,insertText,completeWord} from '../public/screen-typing.mjs';
const words=JSON.parse(fs.readFileSync(new URL('../public/vendor/english-words.json',import.meta.url),'utf8'));
const engine=new WordSuggestions(words);
test('offline dictionary completes short prefixes and suggests corrections without requests',()=>{
 assert.equal(words.length,20000);
 for(const [prefix,expected] of [['yout','youtube'],['goog','google'],['calibr','calibration'],['reciev','receive']])assert.ok(engine.suggest(prefix).some(s=>s.word===expected),JSON.stringify(engine.suggest(prefix)));
 assert.equal(engine.suggest('teh')[0].word,'the');assert.equal(engine.suggest('Teh')[0].word,'The');assert.equal(engine.suggest('TEH')[0].word,'THE');
 assert.deepEqual(engine.suggest('a'),[]);assert.deepEqual(engine.suggest('hello '),[]);
});
test('typing a space corrects explicit typos and Undo preserves the original plus space',()=>{
 const result=insertText('find teh',8,8,' ',engine);assert.equal(result.text,'find the ');assert.equal(result.caret,9);assert.deepEqual(result.undo,{text:'find teh ',caret:9});
 assert.equal(insertText('teh',3,3,' ',engine,false).text,'teh ');
 assert.equal(insertText('Teh',3,3,' ',engine).text,'The ');
});
test('names, ambiguous words, numbers, handles, email, paths and URLs remain literal',()=>{
 for(const text of ['Carla','Jovan','hellp','hello','https://teh','person@teh','file_teh','C:\\teh','v2teh','hello.com','@teh','#teh'])assert.equal(insertText(text,text.length,text.length,' ',engine).text,text+' ',text);
 assert.equal(engine.correct('the'),null);
 for(const text of ['https://you','person@you','file_you','v2you'])assert.deepEqual(engine.suggest(text),[]);
});
test('completion replaces only the word under the caret, adds or reuses space, and can be undone',()=>{
 assert.deepEqual(completeWord('play yout',9,'youtube'),{text:'play youtube ',caret:13,undo:{text:'play yout',caret:9}});
 const middle=completeWord('play yout today',9,'youtube');assert.equal(middle.text,'play youtube today');assert.equal(middle.caret,13);
 const insertion=insertText(middle.text,middle.caret,middle.caret,'a',engine);assert.equal(insertion.text,'play youtube atoday');
 assert.equal(completeWord('go https://you',13,'youtube'),null);
 assert.equal(completeWord('you',3,'<script>'),null);
 assert.equal(wordAt('try camera today',7).word,'camera');
});
test('selection replacement, insertion and Unicode text do not destroy surrounding text',()=>{
 assert.equal(insertText('hello world',6,11,'camera',engine).text,'hello camera');
 assert.equal(insertText('hello world',5,5,',',engine).text,'hello, world');
 assert.equal(insertText('café ☀',6,6,'!',engine).text,'café ☀!');
});
test('spelling distance supports a transposition and bounds unrelated words',()=>{
 assert.equal(editDistance('teh','the',1),1);assert.equal(editDistance('recieve','receive',2),1);
 assert.ok(editDistance('bird','keyboard',2)>2);assert.equal(editDistance('hello','hello'),0);
});
test('normal words are not changed automatically and prediction work stays bounded',()=>{
 const start=performance.now();
 for(const word of ['hello','camera','this','computer','youtube','keyboard','word','the'])assert.equal(engine.correct(word),null);
 for(const word of ['vid','comput','keyb','hellp','recieve','goog','yout','th'])assert.ok(engine.suggest(word).length<=3);
 assert.ok(performance.now()-start<1000,'Local suggestions must finish promptly without blocking tracking for seconds');
});
