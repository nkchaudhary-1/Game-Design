export type Surface = 'pave' | 'road' | 'grass' | 'wood' | 'tile' | 'carpet' | 'stone' | 'metal';

/** Tiny WebAudio synth: no asset files. Positional sounds fade with distance from the listener. */
export class Sound {
  private room: BiquadFilterNode | null = null;
  private indoor = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private liftGain: GainNode | null = null;
  private liftOsc: OscillatorNode[] = [];
  volume = 0.7;
  muted = false;
  private nextChirp = 0;
  private stepClock = 0;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.room = this.ctx.createBiquadFilter(); this.room.type = 'lowpass'; this.room.frequency.value = 20000; this.room.Q.value = 0.4;
    this.master.connect(this.room); this.room.connect(this.ctx.destination);
    this.apply();
    // soft room-tone wind
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = last * 3; }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
    const g = this.ctx.createGain(); g.gain.value = 0.16;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
  apply() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }
  setVolume(v: number) { this.volume = v; this.apply(); }
  setMuted(m: boolean) { this.muted = m; this.apply(); }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0, slide = 0) {
    const c = this.ctx; if (!c || vol < 0.003) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, vol: number, freq: number, q = 1, when = 0, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx; if (!c || vol < 0.003) return;
    const t = c.currentTime + when;
    const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  }
  /** 0..1 gain for a source `d` metres away. */
  private att(d: number, range = 28) { const k = Math.max(0, 1 - d / range); return k * k; }

  ding(d: number) { const a = this.att(d, 40); this.tone(1318, 0.9, 0.22 * a, 'sine'); this.tone(1976, 0.7, 0.1 * a, 'sine', 0.01); this.tone(988, 0.9, 0.12 * a, 'sine', 0.35); }
  door(d: number, open: boolean) { const a = this.att(d, 22); this.noise(0.18, 0.35 * a, open ? 700 : 420, 1.2); this.tone(open ? 140 : 95, 0.16, 0.3 * a, 'triangle', open ? 0 : 0.12, -30); }
  knock(d: number) { const a = this.att(d, 24); for (let i = 0; i < 3; i++) { this.tone(190, 0.09, 0.4 * a, 'triangle', i * 0.17, -70); this.noise(0.05, 0.25 * a, 900, 2, i * 0.17); } }
  bell(d: number) { const a = this.att(d, 26); this.tone(784, 1.0, 0.2 * a, 'sine'); this.tone(622, 1.2, 0.2 * a, 'sine', 0.42); }
  click(d: number) { const a = this.att(d, 14); this.tone(1800, 0.04, 0.2 * a, 'square'); }
  ui() { this.tone(900, 0.05, 0.12, 'sine'); }
  found() { [660, 880, 1175, 1568].forEach((f, i) => this.tone(f, 0.5, 0.18, 'sine', i * 0.09)); }
  toast() { this.tone(520, 0.08, 0.1, 'sine'); }
  jump() { this.noise(0.08, 0.12, 700, 0.8); }
  land() { this.noise(0.09, 0.2, 300, 0.8, 0, 'lowpass'); }
  /** Walls take the top off outdoor sound: wind, birds and street noise soften when you step inside. */
  setIndoor(inside: boolean) {
    if (!this.ctx || !this.room || inside === this.indoor) return;
    this.indoor = inside;
    this.room.frequency.setTargetAtTime(inside ? 1400 : 20000, this.ctx.currentTime, 0.12);
  }
  step(dt: number, speed: number, grounded: boolean, surface: () => Surface) {
    if (!this.ctx || !grounded || speed < 0.5) { this.stepClock = 0; return; }
    this.stepClock -= dt * speed;
    if (this.stepClock > 0) return;
    this.stepClock = 1.15;
    const v = 0.1 + Math.min(0.08, speed * 0.012), r = Math.random();
    switch (surface()) {
      case 'pave': this.noise(0.05, v * 1.1, 1900 + r * 400, 1.6); this.tone(180, 0.04, v * 0.5, 'triangle', 0, -60); break;
      case 'road': this.noise(0.06, v, 1100 + r * 200, 1.2); break;
      case 'grass': this.noise(0.1, v * 0.9, 800 + r * 150, 0.5, 0, 'lowpass'); this.noise(0.08, v * 0.35, 3500, 0.6, 0.01, 'highpass'); break;
      case 'wood': this.tone(115 + r * 25, 0.09, v * 1.2, 'triangle', 0, -40); this.noise(0.05, v * 0.6, 700, 1.5); break;
      case 'tile': this.noise(0.04, v * 1.2, 2600 + r * 300, 2.5); this.tone(260, 0.05, v * 0.4, 'sine', 0, -80); break;
      case 'carpet': this.noise(0.07, v * 0.6, 260 + r * 40, 0.7, 0, 'lowpass'); break;
      case 'stone': this.noise(0.05, v * 1.1, 1500, 1.4); this.tone(150, 0.06, v * 0.5, 'triangle', 0, -50); break;
      case 'metal': this.tone(300, 0.1, v * 0.7, 'square', 0, -120); this.noise(0.05, v * 0.8, 1700, 3); break;
    }
  }
  /** Lift motor hum: call every frame while it is moving, with the listener's distance (negative = off). */
  liftHum(dist: number, speed: number) {
    const c = this.ctx; if (!c) return;
    if (dist < 0) { if (this.liftGain) { this.liftGain.gain.setTargetAtTime(0, c.currentTime, 0.2); } return; }
    if (!this.liftGain) {
      this.liftGain = c.createGain(); this.liftGain.gain.value = 0; this.liftGain.connect(this.master);
      for (const f of [58, 87]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; o.connect(lp); lp.connect(this.liftGain); o.start(); this.liftOsc.push(o); }
    }
    this.liftGain.gain.setTargetAtTime(0.1 * this.att(dist, 22) * Math.min(1, speed / 1.2 + 0.3), c.currentTime, 0.15);
    this.liftOsc[0].frequency.setTargetAtTime(52 + speed * 6, c.currentTime, 0.2);
  }
  /** Occasional birdsong outdoors. */
  ambient(dt: number, outdoors: boolean) {
    if (!this.ctx || !outdoors) return;
    this.nextChirp -= dt;
    if (this.nextChirp > 0) return;
    this.nextChirp = 3 + Math.random() * 7;
    const base = 2400 + Math.random() * 1400, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone(base + i * 160, 0.09, 0.05, 'sine', i * 0.12, 600);
  }
}
