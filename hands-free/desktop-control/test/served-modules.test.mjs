import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),publicDir=path.resolve(here,'../../website/public');
// The companion serves only the page files its allow-list names, and packages
// only the files its build script lists. A module added to the page but not to
// both would load in tests and fail in the installed app.
test('every module the screen page and its worker import is served and packaged',()=>{
 const main=fs.readFileSync(path.resolve(here,'../main.mjs'),'utf8'),source=main.match(/const allowed=\/(.+)\/;/)?.[1];
 assert.ok(source,'allow-list found in main.mjs');
 const allowed=new RegExp(source),packaged=fs.readFileSync(path.resolve(here,'../package.mjs'),'utf8');
 const seen=new Set(),queue=['screen-app.mjs','screen-worker.mjs'];
 while(queue.length){
  const file=queue.pop();if(seen.has(file))continue;seen.add(file);
  assert.ok(allowed.test('/'+file),`${file} is not served by the companion`);
  if(!file.startsWith('vendor/'))assert.ok(packaged.includes(`'${file}'`),`${file} is not copied into the packaged app`);
  if(file.startsWith('vendor/'))continue;
  for(const m of fs.readFileSync(path.join(publicDir,file),'utf8').matchAll(/(?:from|import)\s*\(?\s*'\.\/([^']+)'/g))queue.push(m[1]);
 }
 assert.ok(seen.has('screen-iris-detail.mjs')&&seen.has('screen-face-detail.mjs')&&seen.has('screen-eye-crop.mjs'));
});
