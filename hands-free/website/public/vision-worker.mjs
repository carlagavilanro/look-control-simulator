import {FaceLandmarker,FilesetResolver} from './vendor/vision_bundle.mjs';
import {eyeFeature} from './eye-selection.mjs';
let model;
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   const files=await FilesetResolver.forVisionTasks(new URL('/vendor',self.location.href).href,true);
   model=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('/vendor/face_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:0.7,minFacePresenceConfidence:0.7,minTrackingConfidence:0.7});
   self.postMessage({type:'ready'});return;
  }
  if(data.type==='frame'){
   try{const r=model.detectForVideo(data.bitmap,data.timestamp);const points=r.faceLandmarks?.[0];const eyes=points?.length>=478?{outlines:[[33,160,158,133,153,144],[362,385,387,263,373,380]].map(ids=>ids.map(i=>({x:points[i].x,y:points[i].y}))),pupils:[468,473].map(i=>({x:points[i].x,y:points[i].y}))}:null;self.postMessage({type:'feature',feature:eyeFeature(points),eyes,timestamp:data.timestamp});}finally{data.bitmap.close();}
  }
 }catch(error){self.postMessage({type:'error',message:String(error.message||error)});}
};
