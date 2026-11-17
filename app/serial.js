const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class LampSerial extends EventTarget {
  constructor(serial = globalThis.navigator?.serial) {
    super(); this.api = serial; this.port = null; this.writer = null; this.reader = null;
    this.connected = false; this.closing = false; this.queue = []; this.pumping = false;
    this.api?.addEventListener('disconnect', event => {
      if ((event.port || event.target) === this.port) this.disconnect('USB disconnected');
    });
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  async connect() {
    if (!this.api) throw new Error('Use desktop Chrome or Edge for USB connection. Audio preview is available here.');
    if (this.port) return;
    this.port = await this.api.requestPort();
    this.closing = false;
    try {
      await this.port.open({baudRate: 115200});
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.readTask = this.readLoop();
      // A USB serial open can reboot the board. Retry the harmless identity query.
      for (let n = 0; n < 8 && !this.connected; n++) {
        await this.send('HELLO');
        await sleep(650);
      }
      if (!this.connected) throw new Error('No Lamp Studio firmware response. Upload the included sketch, then reconnect.');
      await this.send('STOP');
      await this.send('MOTION,0,200');
      this.emit('status', 'Connected · ESP32-S3');
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }
  async readLoop() {
    let text = ''; const decoder = new TextDecoder();
    try {
      while (!this.closing) {
        const {value, done} = await this.reader.read();
        if (done) break;
        text += decoder.decode(value, {stream: true});
        let newline;
        while ((newline = text.indexOf('\n')) !== -1) {
          const line = text.slice(0, newline).trim(); text = text.slice(newline + 1);
          if (line === 'LAMP/3 READY') this.connected = true;
          this.emit('line', line);
        }
        if (text.length > 4096) text = '';
      }
    } catch (error) { if (!this.closing) this.emit('error', error.message); }
    finally { if (!this.closing) queueMicrotask(() => this.disconnect('Serial stream ended')); }
  }
  send(line, frame = false) {
    if (!this.writer || this.closing) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      // Supersede unsent animation frames. Commands remain ordered.
      if (frame) {
        const old = this.queue.findIndex(item => item.frame);
        if (old >= 0) { this.queue[old].resolve(false); this.queue.splice(old, 1); }
      }
      if (line === 'STOP') {
        this.queue.forEach(item => item.resolve(false)); this.queue = [];
      }
      this.queue.push({line, frame, resolve, reject}); this.pump();
    });
  }
  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && this.writer && !this.closing) {
        const item = this.queue.shift();
        try { await this.writer.write(new TextEncoder().encode(item.line + '\n')); item.resolve(true); }
        catch (error) {
          item.reject(error); this.emit('error', error.message);
          this.queue.forEach(p => p.resolve(false)); this.queue = [];
          queueMicrotask(() => this.disconnect('Serial write failed')); break;
        }
      }
    } finally { this.pumping = false; }
  }
  async disconnect(reason = 'Disconnected') {
    if (this.closing || this.disconnecting) return;
    this.disconnecting = true;
    // Bound cleanup if a USB write is stuck. Firmware watchdog is the fallback.
    if (this.writer) await Promise.race([this.send('STOP').catch(() => {}), sleep(250)]);
    this.closing = true; this.connected = false;
    this.queue.forEach(p => p.resolve(false)); this.queue = [];
    try { await this.reader?.cancel(); } catch {}
    try { await this.readTask; } catch {}
    try { this.reader?.releaseLock(); } catch {}
    try { await this.writer?.abort(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.reader = this.writer = this.port = null;
    this.disconnecting = false;
    this.emit('status', reason);
  }
}
