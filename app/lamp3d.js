const add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,s)=>a.map(v=>v*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
export function lampPose(tiltUs=1500,panUs=1500){
 tiltUs=Math.max(1050,Math.min(1950,tiltUs));panUs=Math.max(1050,Math.min(1950,panUs));
 const pan=(panUs-1500)*.1*Math.PI/180,tilt=(tiltUs-1500)*.1*Math.PI/180;
 const rotate=p=>[p[0]*Math.cos(pan)+p[2]*Math.sin(pan),p[1],-p[0]*Math.sin(pan)+p[2]*Math.cos(pan)];
 const base=[0,20,0],elbow=rotate([-80,190,0]);
 const head=add(elbow,rotate([150*Math.cos(.28+tilt),150*Math.sin(.28+tilt),0]));
 return {base,elbow,head,normal:rotate([Math.sin(tilt+.2),-Math.cos(tilt+.2),0]),pan:(panUs-1500)*.1,tilt:(tiltUs-1500)*.1};
}
export class Lamp3D{
 constructor(canvas){this.canvas=canvas;this.yaw=-Math.PI/2;this.pitch=0;this.last=[1500,1500];let drag=null;
  canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(drag){this.yaw+=(e.clientX-drag[0])*.009;this.pitch=Math.max(-.1,Math.min(.8,this.pitch+(e.clientY-drag[1])*.006));drag=[e.clientX,e.clientY];}});
  for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>drag=null);
  canvas.addEventListener('keydown',e=>{if(e.key.startsWith('Arrow')){e.preventDefault();this.yaw+=e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0;this.pitch=Math.max(-.1,Math.min(.8,this.pitch+(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0)));}});
 }
 reset(){this.yaw=-Math.PI/2;this.pitch=0;}
 draw(servos,rgb){
  servos.forEach((v,i)=>{if(v)this.last[i]=v;});const pose=lampPose(...this.last),cv=this.canvas;
  const r=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);if(cv.width!==r.width*dpr||cv.height!==r.height*dpr){cv.width=r.width*dpr;cv.height=r.height*dpr;}
  const w=cv.width,h=cv.height,scale=Math.min(w/440,h/330),ctx=cv.getContext('2d');ctx.clearRect(0,0,w,h);
  const camera=p=>{const x=p[0]*Math.cos(this.yaw)+p[2]*Math.sin(this.yaw),z=-p[0]*Math.sin(this.yaw)+p[2]*Math.cos(this.yaw);return [x,(p[1]-130)*Math.cos(this.pitch)-z*Math.sin(this.pitch),(p[1]-130)*Math.sin(this.pitch)+z*Math.cos(this.pitch)];};
  const project=p=>{const q=camera(p);return [w/2+q[0]*scale,h*.48-q[1]*scale,q[2]];};
  const faces=[];
  const poly=(points,color)=>faces.push({points,color,z:points.reduce((a,p)=>a+camera(p)[2],0)/points.length});
  const cylinder=(a,b,ra,rb,baseColor=[115,118,121],n=24)=>{
   const axis=unit(add(b,mul(a,-1))),u=unit(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0])),v=cross(axis,u);
   const ring=(p,rad,i)=>add(p,add(mul(u,Math.cos(i/n*Math.PI*2)*rad),mul(v,Math.sin(i/n*Math.PI*2)*rad)));
   for(let i=0;i<n;i++){const light=.55+.4*Math.max(0,Math.cos(i/n*Math.PI*2-.8));poly([ring(a,ra,i),ring(a,ra,i+1),ring(b,rb,i+1),ring(b,rb,i)],baseColor.map(c=>Math.round(c*light)));}
   poly(Array.from({length:n},(_,i)=>ring(b,rb,i)),baseColor);poly(Array.from({length:n},(_,i)=>ring(a,ra,i)),baseColor.map(c=>c*.5));
  };
  // Ground grid, solid base, hinges and paired arm rails in model-space units.
  ctx.strokeStyle='#303030';ctx.lineWidth=1;
  for(let i=-240;i<=240;i+=40){for(const ends of [[[-240,0,i],[240,0,i]],[[i,0,-240],[i,0,240]]]){const [a,b]=ends.map(project);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();}}
  const pool=project([pose.head[0]+pose.normal[0]*pose.head[1],1,pose.head[2]]),intensity=Math.max(...rgb)/255;
  ctx.save();ctx.translate(pool[0],pool[1]);ctx.scale(1,.35);const glow=ctx.createRadialGradient(0,0,0,0,0,100*scale);glow.addColorStop(0,`rgba(${rgb.join(',')},${intensity*.65})`);glow.addColorStop(1,'transparent');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(0,0,100*scale,0,Math.PI*2);ctx.fill();ctx.restore();
  cylinder([0,3,0],[0,17,0],66,62,[110,113,117]);cylinder([0,17,0],pose.base,20,18);
  for(const z of [-9,9]){cylinder(add(pose.base,[0,0,z]),add(pose.elbow,[0,0,z]),5,5);cylinder(add(pose.elbow,[0,0,z]),add(pose.head,[0,0,z]),4,4);}
  for(const p of [pose.base,pose.elbow,pose.head])cylinder(add(p,[0,0,-17]),add(p,[0,0,17]),13,13,[150,153,156]);
  const rim=add(pose.head,mul(pose.normal,34));cylinder(pose.head,rim,20,43,[130,133,136]);cylinder(rim,add(rim,mul(pose.normal,2)),40,40,rgb);
  faces.sort((a,b)=>a.z-b.z).forEach(f=>{ctx.beginPath();f.points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.closePath();ctx.fillStyle=`rgb(${f.color.join(',')})`;ctx.fill();ctx.strokeStyle='#0002';ctx.lineWidth=.5;ctx.stroke();});
  return pose;
 }
}
