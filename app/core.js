export const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
export function clock(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
export function bandLevels(db, sampleRate, fftSize, brightness = 1) {
  return [[20, 250], [250, 2000], [2000, 8000]].map(([lo, hi]) => {
    const start = Math.max(1, Math.ceil(lo * fftSize / sampleRate));
    const end = Math.min(db.length, Math.ceil(hi * fftSize / sampleRate));
    let power = 0;
    for (let i = start; i < end; i++) power += Number.isFinite(db[i]) ? 10 ** (db[i] / 10) : 0;
    const rms = Math.sqrt(power / Math.max(1, end - start));
    return Math.round(clamp(Math.sqrt(rms * 8) * 255, 0, 255) * clamp(brightness, 0, 1));
  });
}
export class BeatDetector {
  constructor() { this.reset(); }
  reset() { this.average = 0; this.last = -1000; this.count = 0; this.previous = 0; }
  update(level, now, sensitivity = 50) {
    const threshold = 1.2 - clamp(sensitivity, 0, 100) / 100 * .3;
    const hit = level > Math.max(22, this.average * threshold) && level > this.previous + Math.max(2,this.average*.025) && now - this.last > 280;
    this.average = this.average * .96 + level * .04;
    this.previous = level;
    if (!hit) return 0;
    this.last = now;
    return (++this.count - 1) % 4 + 1;
  }
}
export function manualFrame(rgb, brightness, positions) {
  const colors = rgb.map(n => Math.round(clamp(n, 0, 255) * clamp(brightness, 0, 1)));
  const servos = positions.map(n => Math.round(clamp(n, 1050, 1950)));
  return `CONTROL,${colors.join(',')},${servos.join(',')}`;
}
// Mirrors firmware control logic for disconnected preview only.
export class OutputEngine {
  constructor() { this.reset(); }
  reset() { this.average=0; this.previous=0; this.lastBeat=-10000; this.count=0; this.pulse=[-10000,-10000]; this.energy=[0,0]; this.direction=1;this.period=500; this.position=[1500,1500]; this.velocity=[0,0]; this.last=0; this.strength=0; }
  step(raw, now, config, manual=false, requested=[1500,1500], motion=false, color=raw) {
    const dt=Math.min(100, Math.max(0, now-this.last)); this.last=now;
    if (!manual) {
      const threshold=1.2-config.sensitivity*.003;
      this.strength=Math.round(clamp(raw[0]/Math.max(22,this.average*threshold)*50,0,100));
      if(raw[0]>Math.max(22,this.average*threshold)&&raw[0]>this.previous+Math.max(2,this.average*.025)&&now-this.lastBeat>=config.gap){if(this.count)this.period=clamp((now-this.lastBeat)*.5+this.period*.5,300,1200);this.direction=this.count++%2===0?1:-1;this.pulse=[now,now];this.energy=[clamp(raw[0]/200,.25,1)*.6,clamp(raw[0]/160,.5,1)];this.lastBeat=now;}
      this.average=this.average*.96+raw[0]*.04;this.previous=raw[0];
    } else this.strength=0;
    for(let i=0;i<2;i++) {
      const target=manual?clamp(requested[i],1500-config.amount,1500+config.amount):now-this.pulse[i]<Math.max(config.hold+100,this.period*1.3)?1500+(i===0?1:this.direction)*config.amount*this.energy[i]:1500;
      if(motion){
        const delta=target-this.position[i],seconds=dt/1000;
        if(manual){this.velocity[i]=0;this.position[i]+=clamp(delta,-config.slew*seconds,config.slew*seconds);}
        else {
          const speed=config.slew,desired=clamp(delta*8,-speed,speed);
          this.velocity[i]+=clamp(desired-this.velocity[i],-6*speed*seconds,6*speed*seconds);
          this.position[i]=clamp(this.position[i]+this.velocity[i]*seconds,1500-config.amount,1500+config.amount);
        }
      }
    }
    return {rgb:color.map(v=>Math.floor((v*config.brightness+50)/100)), servos:motion?[...this.position]:[0,0], strength:this.strength};
  }
}

// Saturated hue from dominant musical pitch; amplitude controls value, not RGB mixing.
export function musicColor(db, sampleRate, fftSize, bands) {
 const peak=Math.max(...bands);
 if(peak<8)return [0,0,0];
 let best=-Infinity, frequency=220;
 for(let i=Math.ceil(150*fftSize/sampleRate);i<Math.min(db.length,Math.floor(4000*fftSize/sampleRate));i++){
  if(db[i]>best){best=db[i];frequency=i*sampleRate/fftSize;}
 }
 if(!Number.isFinite(best))return [0,0,0];
 const energy=clamp((peak-55)/110,0,1);
 const pitch=clamp(Math.log2(frequency/150)/4,0,1);
 const h=(165+120*energy+45*pitch)/60;
 const v=Math.round(255*Math.min(1,Math.pow(peak/160,.45)));
 const x=Math.round(v*(1-Math.abs(h%2-1)));
 return [[v,x,0],[x,v,0],[0,v,x],[0,x,v],[x,0,v],[v,0,x]][Math.floor(h)];
}

// Hold a phrase-level hue, then travel around the color wheel slowly.
export class CalmColor {
 constructor(){this.reset();}
 reset(){this.hue=0;this.target=0;this.value=0;this.last=null;this.window=0;this.votes=Array(12).fill(0);this.initialized=false;}
 step(rgb,now){
  const dt=this.last===null?0:clamp((now-this.last)/1000,0,.1);this.last=now;
  const max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;
  if(max>0&&d>0){
   const i=rgb.indexOf(max);let h=(i===0?(rgb[1]-rgb[2])/d:i===1?2+(rgb[2]-rgb[0])/d:4+(rgb[0]-rgb[1])/d)*60;
   h=(h+360)%360;
   if(!this.initialized){this.hue=this.target=h;this.window=now;this.initialized=true;}
   this.votes[Math.round(h/30)%12]+=max*dt;
  }
  if(now-this.window>=1800){
   if(Math.max(...this.votes)>0)this.target=this.votes.indexOf(Math.max(...this.votes))*30;
   this.votes.fill(0);this.window=now;
  }
  const delta=((this.target-this.hue+540)%360)-180;
  this.hue=(this.hue+clamp(delta,-24*dt,24*dt)+360)%360;
  this.value+=(max-this.value)*(1-Math.exp(-dt/(max>this.value ? .65 : 1.2)));
  const h=this.hue/60,v=this.value,x=v*(1-Math.abs(h%2-1));
  return [[v,x,0],[x,v,0],[0,v,x],[0,x,v],[x,0,v],[v,0,x]][Math.floor(h)%6].map(Math.round);
 }
}
