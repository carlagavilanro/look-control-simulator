import {FaceLandmarker,FilesetResolver} from './vendor/vision_bundle.mjs';
import {screenFeature,screenHeadFeature} from './screen-gaze.mjs';
import {eyeOverlay} from './screen-eye-overlay.mjs';
import {EyeCropTracker} from './screen-eye-crop.mjs';
let model,eyeTracker;
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   if(data.trackingMode==='eyes'){eyeTracker=new EyeCropTracker(data.eyeRegions);await eyeTracker.init();self.postMessage({type:'ready'});return;}
   const files=await FilesetResolver.forVisionTasks(new URL('/vendor',self.location.href).href,true);
   model=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('/vendor/face_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.75,minFacePresenceConfidence:.75,minTrackingConfidence:.75});
   self.postMessage({type:'ready'});return;
  }
  if(data.type==='regions'){eyeTracker?.setRegions(data.eyeRegions);return;}
  if(data.type==='frame'){
   try{
    if(eyeTracker){const result=await eyeTracker.detect(data.bitmap);self.postMessage({type:'sample',...result,width:data.bitmap.width,height:data.bitmap.height,timestamp:data.timestamp});return;}
    const result=model.detectForVideo(data.bitmap,data.timestamp),points=result.faceLandmarks?.[0];
    const eyes=eyeOverlay(points);
    const quality={};const feature=screenFeature(points,data.bitmap.width/data.bitmap.height,data.bitmap.height,quality);
    const head=screenHeadFeature(points,data.bitmap.width/data.bitmap.height);
    self.postMessage({type:'sample',feature,head,quality,eyes,width:data.bitmap.width,height:data.bitmap.height,timestamp:data.timestamp});
   }finally{data.bitmap.close();}
  }
 }catch(e){self.postMessage({type:'error',message:String(e.message||e)});}
};
