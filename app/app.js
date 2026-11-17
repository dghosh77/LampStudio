import {ArmVision} from './vision.js';
import {requestBluetoothPort} from './bluetooth.js';
import {Lamp3D} from './lamp3d.js';
import {loadTracks, saveTrack, deleteTrack} from './library.js';
import {clamp, clock, bandLevels, musicColor, CalmColor, BeatDetector, manualFrame, OutputEngine} from './core.js';
import {LampSerial} from './serial.js';
const $ = id => document.getElementById(id);
const serial = new LampSerial({requestPort:()=> $('transport').value==='ble'?requestBluetoothPort():navigator.serial?.requestPort()||Promise.reject(new Error('Use Chrome or Edge for USB.')),addEventListener(){}});
let cameraAutoCalibrate=false;
let cameraFollowing=false, cameraTargets=[1500,1500];
const vision=new ArmVision({video:$('cameraVideo'),canvas:$('cameraOverlay'),status:text=>$('cameraStatus').textContent=text,onLoss:()=>haltCamera('Tracking lost. Recenter.')});
const model=new Lamp3D($('lampModel'));
$('resetView').onclick=()=>model.reset();
const audio = new Audio(); audio.preload = 'metadata';
let context, analyser, volumeNode, frequencies;
let current = 0, mode = 'music', motors = false, stopped = true, connecting = false;
let busyLoading = false, loadVersion = 0, noticeTimer, beatFlash = 0, lastFrame = 0;
let wave = new Float32Array(220), levels = [0, 0, 0];
const detector = new BeatDetector();
const calmColor=new CalmColor();
const engine = new OutputEngine();
let telemetry = null, telemetryTime = 0, hardwareProfile='';
const config = () => ({brightness:value("brightness"),sensitivity:value("sensitivity"),hold:value("holdTime"),slew:value("slewRate"),gap:value("beatGap"),amount:value("motionAmount")});
function syncConfig(){const c=config();transmit(`CONFIG,${c.brightness},${c.sensitivity},${c.hold},${c.slew},${c.gap}`);}
const tracks = [{name: 'Studio pulse', detail: 'An original 24-second loop / 100 BPM', duration: 24, builtin: true, url: null, wave: null}];
const value = id => Number($(id).value);
function notify(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 6500); }
function transmit(line, frame = false) { if (serial.connected) serial.send(line, frame).catch(error => notify(`Connection issue: ${error.message}`)); }
function setMotion(on) {
  motors = Boolean(on && serial.connected); $('motionToggle').setAttribute('aria-checked', String(motors));
  $('motionHelp').textContent = motors ? 'On · external 5 V' : serial.connected ? 'Off' : 'Connect to enable';
  transmit(`MOTION,${Number(motors)},${value('motionAmount')}`);
}
function connectionUI() {
  const connected = serial.connected;
  $('connectionBadge').innerHTML = `${connected ? 'Connected' : 'Preview'}`;
  $('connectionBadge').classList.toggle('connected', connected);
  $('connect').textContent = connected ? 'Disconnect' : 'Connect';
  $('transport').disabled=connected||connecting;
  $('motionToggle').disabled = !connected||mode==='camera';
  $('outputMode').textContent = connected ? 'BOARD OUTPUT' : 'LOCAL PREVIEW';
  $('controlNote').textContent = connected ? `${$('transport').value==='ble'?'Bluetooth':'USB'} connected. Showing commanded outputs.` : 'Preview works without a lamp. Connect by USB or Bluetooth for physical output.';
  $('footerStatus').textContent = connected ? `ESP32-S3 / ${$('transport').value==='ble'?'Bluetooth LE':'USB'} / ${hardwareProfile||'profile unreported'}` : 'Disconnected';
  setMotion(false);
  if(connected) syncConfig();
}
serial.addEventListener('status', event => { connectionUI(); if (!serial.connected) { stopAll(false); notify(event.detail); } });
serial.addEventListener('error', event => notify(event.detail));
serial.addEventListener('line', event => {
  if(event.detail.startsWith('PROFILE,')){hardwareProfile=event.detail.split(',')[1];$('footerStatus').textContent=`ESP32-S3 / ${hardwareProfile}`;}
  if(event.detail.startsWith('STATE,')) {
    const v=event.detail.split(',').slice(1).map(Number);
    if(v.length===8&&v.every(Number.isFinite)) { telemetry={rgb:v.slice(0,3),servos:v.slice(3,5),strength:v[5],enabled:!!v[6],active:!!v[7]};telemetryTime=performance.now(); }
  }
  if (event.detail.startsWith('ERROR')) { stopAll(); notify(event.detail); }
  if (event.detail.startsWith('SERIAL TIMEOUT')) { stopAll(); notify('Lamp timed out. Outputs are off; press play to resume.'); }
});
$('connect').onclick = async () => {
  if (connecting) return;
  if (serial.connected) { stopAll(); await serial.disconnect(); hardwareProfile=''; return; }
  hardwareProfile='';connecting = true; $('transport').disabled=true; $('connect').disabled = true; $('connect').textContent = 'Connecting…';
  try { stopAll(); await serial.connect(); notify('Connected. Motor motion stays off until you enable it.'); }
  catch (error) { if (error.name !== 'NotFoundError') notify(error.message); }
  finally { connecting = false; $('connect').disabled = false; connectionUI(); }
};
function ensureAudio() {
  if (!context) {
    context = new AudioContext(); analyser = context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = .65;
    frequencies = new Float32Array(analyser.frequencyBinCount);
    const source = context.createMediaElementSource(audio); volumeNode = context.createGain();
    source.connect(analyser); analyser.connect(volumeNode); volumeNode.connect(context.destination);
    volumeNode.gain.value = value('volume') / 100;
  }
  return context;
}
// Original generated audio: a soft bass pulse and two alternating upper tones.
function demoWav() {
  const sr = 22050, samples = sr * 24, data = new ArrayBuffer(44 + samples * 2), view = new DataView(data);
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / sr, phase = t % .6, step = Math.floor(t / .6);
    const envelope = Math.exp(-phase * 13) * Math.min(phase / .008, 1);
    const bass = Math.sin(2 * Math.PI * (65 * phase + 1.2 * (1 - Math.exp(-phase * 25))));
    const note = Math.sin(2 * Math.PI * [220, 261.63, 329.63, 293.66][step % 4] * t) * Math.exp(-phase * 7);
    const highPhase = t % .3;
    const high = Math.sin(2 * Math.PI * 3300 * t) * Math.exp(-highPhase * 90) * Math.min(highPhase / .002, 1);
    const fade = Math.min(1, t * 10, (24 - t) * 10);
    view.setInt16(44 + i * 2, clamp((bass * envelope * .55 + note * .13 + high * .04) * fade, -1, 1) * 32767, true);
  }
  return new Blob([data], {type: 'audio/wav'});
}
async function decodeTrack(track) {
  if (track.wave) return;
  const bytes = track.file ? await track.file.arrayBuffer() : await track.blob.arrayBuffer();
  const buffer = await ensureAudio().decodeAudioData(bytes);
  track.duration = buffer.duration;
  const samples = buffer.getChannelData(0), peaks = new Float32Array(220), stride = Math.max(1, Math.floor(samples.length / peaks.length));
  for (let i = 0; i < peaks.length; i++) {
    let sum = 0, count = 0;
    for (let j = i * stride; j < Math.min((i + 1) * stride, samples.length); j += 8) { sum += samples[j] ** 2; count++; }
    peaks[i] = Math.sqrt(sum / Math.max(1, count));
  }
  const max = Math.max(.001, ...peaks); track.wave = peaks.map(v => v / max);
}
async function selectTrack(index, autoplay = false) {
  const version = ++loadVersion; busyLoading = true;
  audio.pause(); if(mode==='camera')stopCameraMotion(); transmit('STOP'); detector.reset();calmColor.reset(); levels = [0, 0, 0];
  current = clamp(index, 0, tracks.length - 1); const track = tracks[current];
  if (track.builtin && !track.url) { track.blob = demoWav(); track.url = URL.createObjectURL(track.blob); }
  audio.src = track.url; audio.load();
  $('trackTitle').textContent = track.name; $('trackSubtitle').textContent = track.detail;
  $('trackType').textContent = track.builtin ? 'BUILT-IN SOUND CHECK' : 'YOUR LOCAL AUDIO';
  $('duration').textContent = clock(track.duration); $('seek').value = 0; $('elapsed').textContent = '0:00';
  wave = new Float32Array(220); renderQueue(); updatePlayback();
  try { await decodeTrack(track); if (version !== loadVersion) return; wave = track.wave; $('duration').textContent = clock(track.duration); renderQueue(); }
  catch { if (version === loadVersion) notify('Waveform unavailable for this file. Playback may still work if your browser supports it.'); }
  finally { if (version === loadVersion) busyLoading = false; }
  if (version === loadVersion && autoplay) await playAudio();
}
async function playAudio() {
  try {
    if (busyLoading) { notify('Preparing your track. Try play in a moment.'); return; }
    if (!audio.src) await selectTrack(current);
    await ensureAudio().resume();
    stopped = false; await audio.play();
    transmit(`MOTION,${Number(motors)},${value('motionAmount')}`); updatePlayback();
  } catch (error) { stopped = true; notify(`Could not play this track: ${error.message}`); }
}
function stopAll(send = true) {
  cameraFollowing=false; $('followArm').textContent='Enable motors'; $('followStatus').textContent='Motors off';
  stopped = true; audio.pause(); levels = [0, 0, 0]; detector.reset();calmColor.reset(); engine.reset();
  if (send) transmit('STOP');
  // STOP releases motor torque; re-enabling is always explicit.
  setMotion(false); updatePlayback();
}
function updatePlayback() {
  const playing = !audio.paused;
  $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('sessionState').textContent = playing ? (serial.connected ? 'Sound → light → motion' : 'Playing / audio preview') : 'Paused';
  $('waveHint').hidden = playing || audio.currentTime > 0;
}
function renderQueue() {
  $('queue').replaceChildren(); $('queueCount').textContent = `${String(tracks.length).padStart(2, '0')} ${tracks.length === 1 ? 'TRACK' : 'TRACKS'}`;
  tracks.forEach((track, i) => {
    const row = document.createElement('div'); row.className = `queue-row${i === current ? ' selected' : ''}`;
    const select = document.createElement('button'); select.className = 'queue-select'; select.setAttribute('aria-label', `Select ${track.name}`);
    const number = document.createElement('span'); number.className = 'queue-number'; number.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span'); name.className = 'queue-name'; name.textContent = track.name;
    const duration = document.createElement('span'); duration.className = 'queue-duration'; duration.textContent = track.duration ? clock(track.duration) : 'LOCAL FILE';
    select.append(number, name, duration); select.onclick = () => selectTrack(i, !audio.paused); row.append(select);
    if (!track.builtin) { const remove = document.createElement('button'); remove.className = 'icon-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${track.name}`); remove.onclick = async () => {
      try { await deleteTrack(track.id); } catch { notify('Could not remove the saved file. Please try again.'); return; }
      const index = tracks.indexOf(track); if(index < 0) return;
      const wasCurrent = index === current; if (wasCurrent) stopAll(); URL.revokeObjectURL(track.url); tracks.splice(index, 1);
      if (index < current) current--; if (wasCurrent) selectTrack(Math.min(current, tracks.length - 1)); else renderQueue();
    }; row.append(remove); }
    $('queue').append(row);
  });
}
function storedTrack(record) {
  return {id:record.id, name:record.name, detail:`${record.file.name.split('.').pop().toUpperCase()} / ${(record.file.size/1048576).toFixed(1)} MB / saved`, file:record.file, url:URL.createObjectURL(record.file), duration:0};
}
let libraryReady;
async function restoreLibrary() {
  try {
    const records=await loadTracks();
    if(!localStorage.getItem('lamp-clarity-imported')) {
      if(!records.some(record=>record.file.name.toLowerCase()==='clarity.wav')) {
        const response=await fetch('./audio/clarity.wav');
        if(!response.ok)throw new Error('Bundled Clarity unavailable');
        const file=new File([await response.blob()],'clarity.wav',{type:'audio/wav',lastModified:0});
        const record={id:'bundled-clarity',name:'Clarity',file,created:Date.now()};
        await saveTrack(record);records.push(record);
      }
      localStorage.setItem('lamp-clarity-imported','1');
    }
    records.sort((a,b)=>a.created-b.created).forEach(record=>tracks.push(storedTrack(record)));
    renderQueue(); $('libraryStatus').textContent='Saved locally';
    const clarity=tracks.findIndex(track=>track.file?.name.toLowerCase()==='clarity.wav');
    if(clarity>=0&&!audio.currentTime&&audio.paused)selectTrack(clarity);
  } catch { $('libraryStatus').textContent='Browser storage unavailable. Audio cannot be saved here.'; }
}
async function addFiles(files) {
  const incoming=Array.from(files); await libraryReady;
  let firstAdded=null;
  for (const file of incoming) {
    if (!(file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac|opus)$/i.test(file.name))) { notify(`Skipped ${file.name}: choose an audio file.`); continue; }
    if (file.size > 150 * 1024 * 1024) { notify(`Skipped ${file.name}: please use a file under 150 MB.`); continue; }
    const id=`${file.name}:${file.size}:${file.lastModified}`;
    if(tracks.some(track=>track.id===id)){notify(`${file.name} is already in your library.`);continue;}
    const record={id,name:file.name.replace(/\.[^.]+$/, ''),file,created:Date.now()};
    try { await saveTrack(record); }
    catch { notify(`Could not save ${file.name}. Browser storage may be full or unavailable.`); continue; }
    if(tracks.some(track=>track.id===id))continue;
    const track=storedTrack(record);tracks.push(track); if(!firstAdded)firstAdded=track;
  }
  renderQueue();
  if(firstAdded){selectTrack(tracks.indexOf(firstAdded),false);$('libraryStatus').textContent='Saved locally';}
}
$('addMusic').onclick = () => $('fileInput').click();
$('fileInput').onchange = event => { addFiles(event.target.files); event.target.value = ''; };
let dragDepth = 0;
document.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) document.body.classList.remove('dragging'); });
document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); addFiles(event.dataTransfer.files); });
$('play').onclick = () => {if(audio.paused){playAudio();}else if(mode==='camera'){audio.pause();levels=[0,0,0];detector.reset();calmColor.reset();updatePlayback();}else{stopAll();}};
$('previous').onclick = () => selectTrack((current - 1 + tracks.length) % tracks.length, !audio.paused);
$('next').onclick = () => selectTrack((current + 1) % tracks.length, !audio.paused);
$('repeat').onclick = () => { audio.loop = !audio.loop; $('repeat').setAttribute('aria-pressed', String(audio.loop)); };
audio.onended = () => { if (current + 1 < tracks.length) selectTrack(current + 1, true); else stopAll(); };
audio.onpause = updatePlayback; audio.onplay = updatePlayback;
audio.onerror = () => { stopAll(); notify('This audio file could not be played. Try a WAV or MP3 file.'); };
$('seek').oninput = () => { if (Number.isFinite(audio.duration)) { audio.currentTime = value('seek') / 1000 * audio.duration; detector.reset();calmColor.reset(); } };
$('volume').oninput = () => { if (volumeNode) volumeNode.gain.value = value('volume') / 100; };
function setMode(next) {
  const keepSong=(mode==='music'||mode==='camera')&&(next==='music'||next==='camera');
  if(keepSong){stopCameraMotion();}else{stopAll();}
  if(mode==='camera'&&next!=='camera')vision.stop(); mode = next;
  $('cameraMode').setAttribute('aria-pressed',String(mode==='camera'));
  $('cameraPanel').hidden=mode!=='camera';document.querySelector('.player').hidden=false;document.querySelector('.workspace-grid').classList.toggle('camera-layout',mode==='camera');
  $('motionToggle').disabled=!serial.connected||mode==='camera';
  $('play').disabled=false;
  $('previewMotion').closest('label').hidden=mode==='camera';
  for(const id of ['holdTime','beatGap']){$(id).hidden=mode==='camera';$(id).previousElementSibling.hidden=mode==='camera';}
  if(mode==='camera'){$('motionHelp').textContent='Use Enable motors.';if(!vision.running)$('cameraStatus').textContent='Camera off';}
  $('musicMode').setAttribute('aria-pressed', String(mode === 'music')); $('manualMode').setAttribute('aria-pressed', String(mode === 'manual'));
  $('musicControls').hidden = mode !== 'music'; $('manualLights').hidden = mode === 'music'; $('positions').hidden = mode !== 'manual';
  if (mode === 'manual') { stopped = false; notify('Manual mode: sliders control light levels. Enable servo motion separately to move motors.'); }
}
$('cameraMode').onclick=()=>setMode('camera');
$('musicMode').onclick = () => setMode('music'); $('manualMode').onclick = () => setMode('manual');
$('motionToggle').onclick = () => { setMotion(!motors); if (mode === 'manual' && motors) stopped = false; if (motors) notify('Motion enabled. Use external motor power and keep the linkage clear.'); };
$('motionAmount').oninput = () => {
  const amount = value('motionAmount'); $('motionAmountOut').textContent = `±${amount/10}° (${amount/5}° total)`;
  for (const id of ['servo1', 'servo2']) { $(id).min = 1500 - amount; $(id).max = 1500 + amount; $(id).value = clamp(value(id), 1500 - amount, 1500 + amount); $(id + 'Out').textContent = `${value(id)} µs`; }
  transmit(`MOTION,${Number(motors)},${amount}`);
};
for (const id of ['brightness', 'sensitivity']) $(id).oninput = () => { $(id + 'Out').textContent = `${value(id)}%`; syncConfig(); if (mode === 'manual') stopped = false; };
for (const id of ['servo1', 'servo2', 'red', 'green', 'blue']) $(id).oninput = () => { if ($(id + 'Out')) $(id + 'Out').textContent = `${value(id)} µs`; if (mode === 'manual') stopped = false; };
$('center').onclick = () => { for (const id of ['servo1', 'servo2']) { $(id).value = 1500; $(id + 'Out').textContent = '1500 µs'; } if (mode === 'manual') stopped = false; };
for(const [id,unit] of [['holdTime','ms'],['slewRate','µs/s'],['beatGap','ms']]) $(id).oninput=()=>{$(id+'Out').textContent=`${value(id)} ${unit}`;syncConfig();};
$('stop').onclick = () => { stopAll(); vision.stop();$('cameraStatus').textContent='Camera off'; notify('All outputs stopped. Servo holding torque is released.'); };
document.addEventListener('visibilitychange', () => { if (document.hidden) {stopAll();vision.stop();$('cameraStatus').textContent='Camera stopped while the tab was hidden.';} });
window.addEventListener('pagehide', () => { stopAll(); vision.stop(); serial.disconnect(); });
document.addEventListener('keydown', event => { if (event.code === 'Space' && !['INPUT', 'BUTTON', 'TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); $('play').click(); } });
function canvasContext(id) {
  const canvas = $(id), ratio = Math.min(devicePixelRatio || 1, 2), rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * ratio), h = Math.round(rect.height * ratio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h); return {ctx, w, h};
}
function stopCameraMotion(){
 cameraFollowing=false;$('followArm').textContent='Enable motors';setMotion(false);transmit('STOP');
}
function haltCamera(message){
 stopCameraMotion();vision.mapper.reset();$('followStatus').textContent=message;
}
$('startCamera').onclick=async()=>{
 haltCamera('Motors off');$('startCamera').disabled=true;
 try{await vision.start();cameraAutoCalibrate=true;}catch(error){if(error.name!=='AbortError')notify(error.message);}
 finally{$('startCamera').disabled=false;}
};
$('stopCamera').onclick=()=>{haltCamera('Camera off');vision.stop();$('cameraStatus').textContent='Camera off';};
$('calibrateArm').onclick=()=>{
 stopCameraMotion();if(vision.calibrate())$('followStatus').textContent='Centered';
};
$('followArm').onclick=()=>{
 if(cameraFollowing){stopCameraMotion();return;}
 if(!vision.fresh()||!vision.mapper.center)return;
 if(serial.connected&&!['PCB_3_2','BREADBOARD'].includes(hardwareProfile)){notify('Upload the updated firmware with a reported hardware profile first.');return;}
 cameraFollowing=true;stopped=false;setMotion(serial.connected);
 $('followArm').textContent='Disable motors';$('followStatus').textContent=serial.connected?'Motors on':'Preview';
};
for(const id of ['invertArmPan','invertArmTilt'])$(id).onchange=()=>haltCamera('Recenter to continue.');
function draw(now) {
  if (now - lastFrame >= 40) {
    lastFrame = now;
    if(mode==='camera'){
      if(cameraAutoCalibrate&&vision.fresh(now)){vision.calibrate();cameraAutoCalibrate=false;$('followStatus').textContent='Preview ready';}
      const freshPose=vision.fresh(now);
      if(vision.running&&now-vision.timestamp>=750)$('cameraStatus').textContent='Waiting for camera…';
      $('calibrateArm').disabled=!freshPose;
      $('followArm').disabled=!freshPose||!vision.mapper.center||(serial.connected&&!['PCB_3_2','BREADBOARD'].includes(hardwareProfile));
      
      if(cameraFollowing&&!freshPose)haltCamera('Arm lost. Recenter.');
      if(freshPose&&vision.mapper.center){cameraTargets=vision.targets({range:value('motionAmount'),invertPan:$('invertArmPan').checked,invertTilt:$('invertArmTilt').checked})||cameraTargets;}
    }
    if (analyser && !audio.paused) { analyser.getFloatFrequencyData(frequencies); }
    const playing = !audio.paused && !stopped;
    const raw = playing ? bandLevels(frequencies, context.sampleRate, analyser.fftSize) : [0, 0, 0];
    const vivid=playing?calmColor.step(musicColor(frequencies,context.sampleRate,analyser.fftSize,raw),now):[0,0,0];
    let beat = playing ? detector.update(raw[0], now, value('sensitivity')) : 0;
    if (beat) beatFlash = now;
    if (mode === 'music') {
      levels = raw.map(n => Math.round(n * value('brightness') / 100));
      if (playing) transmit(`AUDIO,${raw.join(',')},${vivid.join(',')}`, true);
    } else if(mode==='camera'){
      if(playing||cameraFollowing)transmit(manualFrame(playing?vivid:['red','green','blue'].map(value),1,cameraTargets),true);
    } else {
      levels = stopped ? [0, 0, 0] : ['red', 'green', 'blue'].map(id => Math.round(value(id) * value('brightness') / 100));
      if (!stopped) transmit(manualFrame(['red', 'green', 'blue'].map(value), 1, ['servo1', 'servo2'].map(value)), true);
    }
    const input=mode==='camera'&&playing?vivid:mode!=='music'?['red','green','blue'].map(value):raw;
    const simulated=engine.step(input,now,config(),mode!=='music',mode==='camera'?cameraTargets:['servo1','servo2'].map(value),motors||(!serial.connected&&(mode==='camera'?cameraFollowing:$('previewMotion').checked)),mode==='music'?vivid:input);
    const fresh=serial.connected&&telemetry&&now-telemetryTime<500;
    const output=serial.connected?(fresh?telemetry:{rgb:[0,0,0],servos:[0,0],strength:0}):stopped?{rgb:[0,0,0],servos:[0,0],strength:0}:simulated;
    levels=output.rgb;
    ['bassValue','midValue','trebleValue'].forEach((id,i)=>$(id).textContent=String(levels[i]).padStart(3,'0'));
    $('previewSource').textContent=serial.connected?(fresh?'Connected':'Waiting…'):'Preview';
    $('beatLabel').textContent=mode==='camera'?(playing?'Music + arm':'Arm'):mode==='manual'?'Manual':`Beat ${output.strength}%`;
    const color=`rgb(${levels.join(',')})`, intensity=Math.max(...levels)/255;
    $('colorSwatch').style.backgroundColor=color;
    $('colorHex').textContent='#'+levels.map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();
    $('colorRGB').textContent=`RGB ${levels.join(' / ')}`;
    $('colorSource').textContent=serial.connected?(fresh?'ESP32 OUTPUT COLOR':'OUTPUT UNAVAILABLE'):'CALCULATED COLOR';
    const previewOnly=mode==='camera'&&!cameraFollowing&&vision.fresh(now)&&vision.mapper.center;
    const pose=model.draw(previewOnly?cameraTargets:output.servos,levels);
    if(previewOnly)$('previewSource').textContent='Preview · motors off';
    if(mode==='camera'&&vision.fresh(now)&&vision.mapper.center)$('followStatus').textContent=`${cameraFollowing&&serial.connected?'Motors on':'Preview'} / tilt ${((cameraTargets[0]-1500)/10).toFixed(0)}° / pan ${((cameraTargets[1]-1500)/10).toFixed(0)}°`;
    $('tiltAngle').textContent=`Tilt ${pose.tilt.toFixed(1)}°`;
    $('panAngle').textContent=`Pan ${pose.pan.toFixed(1)}°`;
    $('elapsed').textContent = clock(audio.currentTime); if (Number.isFinite(audio.duration)) $('seek').value = String(audio.currentTime / audio.duration * 1000);
    const {ctx, w, h} = canvasContext('waveform'), progress = Number.isFinite(audio.duration) ? audio.currentTime / audio.duration : 0;
    const barWidth = w / wave.length;
    for (let i = 0; i < wave.length; i++) {
      const height = Math.max(2, wave[i] * h * .83); ctx.fillStyle = i / wave.length < progress ? '#eee' : '#666';
      ctx.fillRect(i * barWidth, (h - height) / 2, Math.max(1, barWidth - 2), height);
    }
    const spec = canvasContext('spectrum');
    for (let i = 0; i < 40; i++) {
      const bin = Math.min(frequencies?.length - 1 || 0, Math.floor(2 ** (i / 39 * 9)));
      const amount = playing ? clamp(((frequencies?.[bin] ?? -100) + 85) / 75, 0, 1) : 0;
      spec.ctx.fillStyle = `rgb(${Math.round(95 + amount * 145)},${Math.round(95 + amount * 145)},${Math.round(95 + amount * 145)})`;
      const height = Math.max(2, amount * spec.h); spec.ctx.fillRect(i * spec.w / 40, spec.h - height, Math.max(1, spec.w / 40 - 3), height);
    }
  }
  requestAnimationFrame(draw);
}
renderQueue(); connectionUI(); selectTrack(0); libraryReady=restoreLibrary(); requestAnimationFrame(draw);
if (!navigator.serial&&!navigator.bluetooth) $('footerStatus').textContent = 'Preview available / open in desktop Chrome or Edge to connect USB.';
