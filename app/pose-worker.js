// Classic worker: MediaPipe WASM loader uses importScripts.
let detector;
onmessage=async({data})=>{
 if(data.type==='init'){
  try{
   const {FilesetResolver,PoseLandmarker}=await import('./vendor/mediapipe/vision_bundle.mjs');
   const files=await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm/',self.location.href).href);
   detector=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/mediapipe/pose_landmarker_lite.task',self.location.href).href,delegate:'CPU'},runningMode:'VIDEO',numPoses:2,minPoseDetectionConfidence:.65,minPosePresenceConfidence:.65,minTrackingConfidence:.65});
   postMessage({type:'ready'});
  }catch(error){postMessage({type:'error',message:error.message});}
 }else if(data.type==='frame'){
  try{const result=detector.detectForVideo(data.bitmap,data.timestamp);postMessage({type:'pose',poses:result.landmarks,timestamp:data.timestamp});}
  catch(error){postMessage({type:'error',message:error.message});}
  finally{data.bitmap.close();}
 }
};
