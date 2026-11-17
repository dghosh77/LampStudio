import {armObservation,ArmMapper,RIGHT_ARM} from './arm-mapping.js';
export class ArmVision{
 constructor({video,canvas,status,onLoss}){
  Object.assign(this,{video,canvas,status,onLoss});this.mapper=new ArmMapper();this.observation=null;this.timestamp=0;this.running=false;this.generation=0;this.busy=false;
 }
 async start(){
  await this.stop();const generation=++this.generation;this.status('Loading camera…');
  try{
   this.worker=new Worker(new URL('./pose-worker.js',import.meta.url));
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Pose model load timed out')),30000);
    this.cancelLoading=()=>{clearTimeout(timer);reject(new DOMException('Camera start cancelled','AbortError'));};
    this.worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message||'Pose worker failed'));};
    this.worker.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(timer);this.cancelLoading=null;resolve();}else if(data.type==='error'){clearTimeout(timer);reject(new Error(data.message));}};
    this.worker.postMessage({type:'init'});
   });
   if(generation!==this.generation)return;
   this.status('Allow camera access.');
   const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}});
   if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;this.video.srcObject=stream;await this.video.play();
   this.worker.onmessage=({data})=>{
    this.busy=false;
    if(data.type==='error'){this.status(data.message);this.onLoss();this.stop();return;}
    if(data.type!=='pose')return;
    this.observation=armObservation(data.poses,this.video.videoWidth/this.video.videoHeight);
    this.timestamp=data.timestamp;
    this.draw(data.poses);
    this.status(this.observation?`Tracking ${Math.round(this.observation.confidence*100)}% confidence`:data.poses.length>1?'One person at a time.':'Keep your right arm in view.');
   };
   this.worker.onerror=()=>{this.status('Tracking stopped: worker error.');this.onLoss();this.stop();};
   stream.getVideoTracks()[0].addEventListener('ended',()=>{this.onLoss();this.stop();this.status('Camera disconnected.');});
   this.running=true;this.busy=false;let lastVideo=-1;
   this.timer=setInterval(async()=>{
    if(!this.running||this.busy||this.video.readyState<2||this.video.currentTime===lastVideo)return;
    lastVideo=this.video.currentTime;this.busy=true;const timestamp=performance.now();
    try{const bitmap=await createImageBitmap(this.video);if(!this.running||generation!==this.generation){bitmap.close();return;}this.worker.postMessage({type:'frame',bitmap,timestamp},[bitmap]);}
    catch{this.busy=false;this.onLoss();this.stop();this.status('Camera frame unavailable.');}
   },66);
  }catch(error){if(generation===this.generation){await this.stop();this.status(`Camera unavailable: ${error.message}`);}throw error;}
 }
 fresh(now=performance.now()){return this.running&&this.observation&&now-this.timestamp<750;}
 calibrate(){if(!this.fresh())return false;this.mapper.calibrate(this.observation);return true;}
 targets(options){return this.fresh()?this.mapper.map(this.observation,options):null;}
 async stop(){
  this.generation++;const cancel=this.cancelLoading;this.cancelLoading=null;cancel?.();this.running=false;clearInterval(this.timer);this.worker?.terminate();this.worker=null;
  this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;
  this.observation=null;this.mapper.reset();this.timestamp=0;this.busy=false;
  this.canvas.getContext('2d').clearRect(0,0,this.canvas.width,this.canvas.height);
 }
 draw(poses){
  const canvas=this.canvas,w=this.video.videoWidth,h=this.video.videoHeight;canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
  if(poses.length!==1)return;
  const points=poses[0],visible=points.filter(p=>p.visibility>=.65);
  if(visible.length){const xs=visible.map(p=>(1-p.x)*w),ys=visible.map(p=>p.y*h);const x=Math.max(0,Math.min(...xs)-18),y=Math.max(0,Math.min(...ys)-18);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(x,y,Math.min(w-x,Math.max(...xs)-x+18),Math.min(h-y,Math.max(...ys)-y+18));}
  const arm=RIGHT_ARM.map(i=>points[i]);if(arm.some(p=>!p||p.visibility<.65))return;
  ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.beginPath();arm.forEach((p,i)=>{i?ctx.lineTo((1-p.x)*w,p.y*h):ctx.moveTo((1-p.x)*w,p.y*h);});ctx.stroke();
  for(const p of arm){ctx.beginPath();ctx.arc((1-p.x)*w,p.y*h,7,0,Math.PI*2);ctx.fillStyle='#111';ctx.fill();ctx.stroke();}
 }
}
