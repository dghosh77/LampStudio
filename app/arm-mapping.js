export const RIGHT_ARM=[12,14,16];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function armObservation(poses,aspect=4/3){
 if(poses.length!==1)return null;
 const p=poses[0],ids=[11,12,16];
 if(ids.some(i=>!p[i]||!Number.isFinite(p[i].x)||!Number.isFinite(p[i].y)||(p[i].visibility??0)<.5||p[i].x<0||p[i].x>1||p[i].y<0||p[i].y>1))return null;
 const shoulder=p[12],wrist=p[16];
 const width=Math.hypot((p[11].x-shoulder.x)*aspect,p[11].y-shoulder.y);
 if(width<.06||width>.8)return null;
 return {x:(shoulder.x-wrist.x)*aspect/width,y:(shoulder.y-wrist.y)/width,confidence:Math.min(...ids.map(i=>p[i].visibility)),points:p};
}
export class ArmMapper{
 constructor(){this.reset();}
 reset(){this.center=null;this.filtered=null;}
 calibrate(observation){this.center={x:observation.x,y:observation.y};this.filtered=[1500,1500];}
 map(observation,{range=300,invertPan=false,invertTilt=false}={}){
  if(!this.center||!observation)return null;
  range=clamp(range,0,450);
  const delta=[(observation.y-this.center.y)*(invertTilt?-1:1),(observation.x-this.center.x)*(invertPan?-1:1)];
  const targets=delta.map(v=>1500+(Math.abs(v)<.025?0:clamp(v/.45,-1,1))*range);
  this.filtered=targets.map((v,i)=>this.filtered[i]+.75*(v-this.filtered[i]));
  return this.filtered.map(v=>Math.round(clamp(v,1500-range,1500+range)));
 }
}
