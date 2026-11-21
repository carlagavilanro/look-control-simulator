import {FaceLandmarker,FilesetResolver} from './vendor/vision_bundle.mjs';
import {screenFeature,withOpenings,screenHeadFeature} from './screen-gaze.mjs';
import {eyeOverlay} from './screen-eye-overlay.mjs';
import {EyeCropTracker,BinocularAgreement} from './screen-eye-crop.mjs';
import {IrisDetail,lightSummary,GLARE_LIMIT} from './screen-iris-detail.mjs';
import {faceEyes,faceExtent,framePoints} from './screen-face-detail.mjs';
let model,eyeTracker,agreement,detail,lastView='',settle=0;
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   if(data.trackingMode==='eyes'){eyeTracker=new EyeCropTracker(data.eyeRegions);await eyeTracker.init();self.postMessage({type:'ready'});return;}
   const files=await FilesetResolver.forVisionTasks(new URL('/vendor',self.location.href).href,true);
   model=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('/vendor/face_landmarker.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.75,minFacePresenceConfidence:.75,minTrackingConfidence:.75});
   agreement=new BinocularAgreement();detail=new IrisDetail();
   self.postMessage({type:'ready'});return;
  }
  if(data.type==='regions'){eyeTracker?.setRegions(data.eyeRegions);return;}
  if(data.type==='find'){eyeTracker?.find();return;}
  if(data.type==='frame'){
   try{
    if(eyeTracker){const result=await eyeTracker.detect(data.bitmap,data.timestamp);self.postMessage({type:'sample',...result,width:data.bitmap.width,height:data.bitmap.height,timestamp:data.timestamp});return;}
    // The bitmap is the part of the camera frame around the face (data.view),
    // at the camera's own resolution where that fits. Everything reported back
    // is in whole-frame coordinates, so the rest of the app is unchanged.
    const bitmap=data.bitmap,view=data.view||{x:0,y:0,width:bitmap.width,height:bitmap.height,frameWidth:bitmap.width,frameHeight:bitmap.height};
    const key=[view.x,view.y,view.width,view.height].join();
    // The model follows the face from one frame to the next. After the view
    // moves, its first looks are at the wrong place: do not use them.
    if(key!==lastView){if(lastView)settle=2;lastView=key;}
    const result=model.detectForVideo(bitmap,data.timestamp),local=result.faceLandmarks?.[0],points=framePoints(local,view);
    const width=view.frameWidth,height=view.frameHeight,quality={},face=faceExtent(points);
    let trust=[true,true],readings=null;
    if(local?.length>=478){
     // Second reading of both irises, from the camera's own pixels, and how
     // each eye is lit. A reflection over an iris makes that eye untrusted.
     readings=detail.refine(bitmap,faceEyes(local,bitmap.width,bitmap.height));
     quality.light=readings.map(r=>lightSummary(r.light));
     trust=readings.map(r=>!(r.light&&r.light.glare>GLARE_LIMIT));
    }
    let feature=null;
    if(settle>0&&points){settle--;quality.reason='framing';}
    else{
     feature=screenFeature(points,width/height,height,quality,agreement,trust);
     withOpenings(feature,quality);
     if(feature&&readings&&trust.every(Boolean)&&readings.every(r=>Number.isFinite(r.h)))feature.alt={h:(readings[0].h+readings[1].h)/2,v:(readings[0].v+readings[1].v)/2,lh:readings[0].h,lv:readings[0].v,rh:readings[1].h,rv:readings[1].v};
    }
    const head=screenHeadFeature(points,width/height);
    self.postMessage({type:'sample',feature,head,quality,eyes:eyeOverlay(points),face,width,height,timestamp:data.timestamp});
   }finally{data.bitmap.close();}
  }
 }catch(e){self.postMessage({type:'error',message:String(e.message||e)});}
};
