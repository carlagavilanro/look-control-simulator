// Loads the bundled TensorFlow.js runtime and MediaPipe Iris model in Node so
// tracker tests exercise the same model file the Windows companion ships.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const vendor=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../public/vendor')+path.sep;
let loading=null;
export function irisModel(){
 loading??=(async()=>{
  const require=createRequire(import.meta.url),load=(file,resolve)=>{const module={exports:{}};new Function('exports','module','require','__dirname','__filename',fs.readFileSync(vendor+file,'utf8'))(module.exports,module,resolve,vendor,vendor+file);return module.exports;};
  const {log,warn}=console;console.log=console.warn=()=>{};
  try{
   const tf=load('tf.min.js',require),wasm=load('tf-backend-wasm.min.js',name=>name==='@tensorflow/tfjs-core'?tf:require(name));
   tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT',false);wasm.setWasmPaths(vendor);
   if(!await tf.setBackend('wasm'))await tf.setBackend('cpu');await tf.ready();
   const graph=JSON.parse(fs.readFileSync(vendor+'iris.json','utf8')),weights=fs.readFileSync(vendor+'iris.bin');
   const model=await tf.loadGraphModel(tf.io.fromMemory({modelTopology:graph.modelTopology,weightSpecs:graph.weightsManifest.flatMap(g=>g.weights),weightData:weights.buffer.slice(weights.byteOffset,weights.byteOffset+weights.byteLength)}));
   // Same contract as the worker: N x 64 x 64 x 3 floats in, N x 228 floats out.
   const infer=async(input,count)=>{const tensor=tf.tensor4d(input,[count,64,64,3]),output=model.predict(tensor);try{return await output.data();}finally{output.dispose();tensor.dispose();}};
   // 'wasm' is the runtime the companion uses. The plain JavaScript fallback is
   // correct but about thirty times slower; callers can decide to skip on it.
   infer.backend=tf.getBackend();
   return infer;
  }finally{console.log=log;console.warn=warn;}
 })();
 return loading;
}
