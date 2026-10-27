// All sound is synthesised with Web Audio: no files. A continuous layer (engine, wind, afterburner, alien hum, a dusk
// drone with a combat pulse and cockpit alarms) follows the sim state each frame, and one-shots (cannon, missiles,
// blasts, alien fire, hits, chimes) are triggered from sim events with distance attenuation and stereo panning.
// Nothing happens until the first user gesture (browsers gate audio on it).

import type { Vector3 } from 'three';
import type { SimEvent, World } from '../sim/world';
import { clamp, smoothstep } from '../sim/util';

export interface Listener { pos: Vector3; right: Vector3 }

type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private noise!: AudioBuffer;
  muted = false;
  private voices = 0;
  private last: Record<string, number> = {};

  // continuous voices
  private engine!: { saw: OscillatorNode; tri: OscillatorNode; lp: BiquadFilterNode; g: GainNode; rumble: GainNode; rumbleF: BiquadFilterNode; wind: GainNode; windF: BiquadFilterNode; ab: GainNode };
  private hum!: { osc: OscillatorNode; g: GainNode; lp: BiquadFilterNode };
  private drone!: { g: GainNode; lp: BiquadFilterNode };
  private nextStep = 0;
  private step = 0;
  private alarmT = 0;
  private alarmPhase = 0;
  private lockT = 0;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    // browsers refuse to start audio before a user gesture; don't even try
    if (!this.ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.init(new AC());
  }

  /**
   * Render sound into a buffer instead of the speakers (used to record the demo video). Drive it with
   * `setClock(t)` once per simulated frame, then call `startRendering()` on the context.
   */
  attachOffline(ctx: OfflineAudioContext): void {
    this.offline = true;
    this.virtual = 0;
    this.init(ctx);
  }
  setClock(t: number): void { this.virtual = t; }
  private offline = false;
  private virtual = 0;
  private now(): number { return this.offline ? this.virtual : this.ctx!.currentTime; }

  private init(ctx: AudioContext | OfflineAudioContext): void {
    this.ctx = ctx as AudioContext;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.bus = ctx.createGain();
    this.bus.connect(comp); comp.connect(this.master); this.master.connect(ctx.destination);

    // one second of white noise, looped and sampled by everything that needs it
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.buildContinuous(ctx as AudioContext);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.now(), 0.05);
  }

  private loopNoise(ctx: AudioContext): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  private buildContinuous(ctx: AudioContext): void {
    // engine
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 60;
    const tri = ctx.createOscillator(); tri.type = 'triangle'; tri.frequency.value = 31;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    saw.connect(lp); tri.connect(lp); lp.connect(g); g.connect(this.bus);
    const rumbleF = ctx.createBiquadFilter(); rumbleF.type = 'bandpass'; rumbleF.frequency.value = 400; rumbleF.Q.value = 0.8;
    const rumble = ctx.createGain(); rumble.gain.value = 0;
    this.loopNoise(ctx).connect(rumbleF); rumbleF.connect(rumble); rumble.connect(this.bus);
    const windF = ctx.createBiquadFilter(); windF.type = 'highpass'; windF.frequency.value = 1200;
    const wind = ctx.createGain(); wind.gain.value = 0;
    this.loopNoise(ctx).connect(windF); windF.connect(wind); wind.connect(this.bus);
    const abF = ctx.createBiquadFilter(); abF.type = 'lowpass'; abF.frequency.value = 900;
    const ab = ctx.createGain(); ab.gain.value = 0;
    this.loopNoise(ctx).connect(abF); abF.connect(ab); ab.connect(this.bus);
    saw.start(); tri.start();
    this.engine = { saw, tri, lp, g, rumble, rumbleF, wind, windF, ab };

    // alien beam hum
    const ho = ctx.createOscillator(); ho.type = 'sawtooth'; ho.frequency.value = 58;
    const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 260;
    const hg = ctx.createGain(); hg.gain.value = 0;
    ho.connect(hl); hl.connect(hg); hg.connect(this.bus); ho.start();
    this.hum = { osc: ho, g: hg, lp: hl };

    // dusk drone: two detuned saws under a slow filter
    const dg = ctx.createGain(); dg.gain.value = 0.0;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 340; dl.Q.value = 0.7;
    for (const [f, det] of [[55, 0], [55, 7], [82.4, -5], [110, 4]] as const) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = f > 100 ? 0.25 : 0.5;
      o.connect(og); og.connect(dl); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 110;
    lfo.connect(lfoG); lfoG.connect(dl.frequency); lfo.start();
    dl.connect(dg); dg.connect(this.bus);
    this.drone = { g: dg, lp: dl };
  }

  // ---- one-shot building blocks ----------------------------------------------------------------------------------

  private out(listener: Listener | null, pos: Vector3 | null, ref: number, base: number): { node: AudioNode; gain: number } | null {
    const ctx = this.ctx!;
    if (!this.offline && this.voices > 46) return null;
    let gain = base, pan = 0;
    if (pos && listener) {
      const dx = pos.x - listener.pos.x, dy = pos.y - listener.pos.y, dz = pos.z - listener.pos.z;
      const d = Math.hypot(dx, dy, dz);
      gain = base / (1 + Math.pow(d / ref, 1.3));
      if (gain < 0.004) return null;
      pan = clamp((dx * listener.right.x + dy * listener.right.y + dz * listener.right.z) / Math.max(d, 1), -1, 1) * 0.85;
    }
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.bus);
    return { node: p, gain };
  }

  private noiseHit(o: { node: AudioNode; gain: number }, dur: number, type: FilterType, f0: number, f1: number, q: number, delay = 0, attack = 0.004): void {
    const ctx = this.ctx!, t = this.now() + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(o.node);
    s.start(t, Math.random() * 1.5, dur + 0.05);
    this.voices++;
    s.onended = () => { this.voices--; g.disconnect(); };
  }

  private tone(o: { node: AudioNode; gain: number }, type: OscillatorType, f0: number, f1: number, dur: number, delay = 0, attack = 0.004): void {
    const ctx = this.ctx!, t = this.now() + delay;
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.node);
    osc.start(t); osc.stop(t + dur + 0.03);
    this.voices++;
    osc.onended = () => { this.voices--; g.disconnect(); };
  }

  /** Rate limiter for chatty effects. */
  private ok(key: string, every: number): boolean {
    const now = this.now();
    if (now - (this.last[key] ?? -9) < every) return false;
    this.last[key] = now;
    return true;
  }

  // ---- events ----------------------------------------------------------------------------------------------------

  consume(events: readonly SimEvent[], l: Listener): void {
    if (!this.ctx || this.muted) return;
    for (const e of events) {
      switch (e.type) {
        case 'fire': this.fire(e, l); break;
        case 'explode': this.explosion(e, l); break;
        case 'hit': this.hit(e, l); break;
        case 'kill': this.kill(e.score); break;
        case 'warp': { const o = this.out(l, e.pos, 1800, 0.16); if (o) { this.tone(o, 'sawtooth', 120, 1200, 0.5, 0, 0.05); this.noiseHit(o, 0.5, 'bandpass', 400, 4000, 1.5, 0, 0.1); } break; }
        case 'wave': e.phase === 'start' ? this.waveStart() : this.waveClear(); break;
        case 'win': this.fanfare(true); break;
        case 'lose': this.fanfare(false); break;
        default: break;
      }
    }
  }

  private fire(e: Extract<SimEvent, { type: 'fire' }>, l: Listener): void {
    if (e.who === 'player') {
      if (e.kind === 'cannon') {
        if (!this.ok('cannon', 0.04)) return;
        const o = this.out(null, null, 1, 0.1)!;
        this.tone(o, 'square', 190, 60, 0.07);
        this.noiseHit({ node: o.node, gain: 0.11 }, 0.05, 'highpass', 2400, 1200, 0.7);
      } else {
        const o = this.out(null, null, 1, 0.2);
        if (o) { this.noiseHit(o, 1.1, 'lowpass', 600, 3800, 0.8, 0, 0.05); this.tone(o, 'sawtooth', 340, 90, 0.5); }
      }
    } else if (e.kind === 'bolt') {
      if (!this.ok('bolt', 0.05)) return;
      const o = this.out(l, e.pos, 700, 0.13);
      if (o) this.tone(o, 'sawtooth', 1500, 380, 0.13);
    } else {
      const o = this.out(l, e.pos, 1100, 0.2);
      if (o) { this.tone(o, 'sine', 220, 70, 0.5, 0, 0.02); this.tone(o, 'triangle', 660, 180, 0.4); }
    }
  }

  private explosion(e: Extract<SimEvent, { type: 'explode' }>, l: Listener): void {
    const big = e.size > 120;
    const o = this.out(l, e.pos, big ? 1800 : 700, clamp(0.18 + e.size / 700, 0.18, 0.7));
    if (!o) return;
    const dist = e.pos.distanceTo(l.pos);
    const delay = Math.min(1.2, dist / 1800); // the speed of sound, softened
    const dur = clamp(0.5 + e.size / 220, 0.5, 2.6);
    this.noiseHit(o, dur, 'lowpass', big ? 1800 : 3000, big ? 60 : 160, 0.8, delay, 0.006);
    this.tone(o, 'sine', big ? 90 : 120, 28, dur, delay, 0.006);
    if (e.kind === 'alien') this.tone(o, 'sawtooth', 900, 120, 0.22, delay);
    if (e.kind === 'missile') this.noiseHit(o, 0.5, 'bandpass', 1800, 300, 1, delay);
  }

  private hit(e: Extract<SimEvent, { type: 'hit' }>, l: Listener): void {
    if (e.target === 'player') {
      const o = this.out(null, null, 1, clamp(0.2 + e.amount / 40, 0.2, 0.5))!;
      this.noiseHit(o, 0.25, 'lowpass', 1400, 120, 1, 0, 0.003);
      this.tone(o, 'square', 240, 70, 0.18);
      if (e.broke) { const b = this.out(null, null, 1, 0.22)!; this.tone(b, 'sawtooth', 900, 120, 0.7, 0.05, 0.02); }
    } else if (e.target === 'alien') {
      if (!this.ok('tick', 0.035)) return;
      const o = this.out(l, e.pos, 600, 0.09);
      if (o) this.tone(o, 'triangle', 1700 + Math.random() * 500, 700, 0.05);
    } else if (e.target === 'hull') {
      if (!this.ok('ping', 0.05)) return;
      const o = this.out(l, e.pos, 600, 0.08);
      if (o) this.tone(o, 'triangle', 2400, 1800, 0.06);
    } else if (e.target === 'shield') {
      if (!this.ok('ping', 0.05)) return;
      const o = this.out(l, e.pos, 700, 0.1);
      if (o) { this.tone(o, 'sine', 1300, 2400, 0.12); }
    }
  }

  private kill(score: number): void {
    const o = this.out(null, null, 1, clamp(0.06 + score / 6000, 0.06, 0.14))!;
    this.tone(o, 'triangle', 880, 880, 0.12);
    this.tone(o, 'triangle', 1318, 1318, 0.2, 0.07);
  }

  private waveStart(): void {
    const o = this.out(null, null, 1, 0.18)!;
    this.tone(o, 'sawtooth', 110, 110, 0.9, 0, 0.12);
    this.tone(o, 'sawtooth', 165, 165, 0.9, 0.05, 0.12);
    this.noiseHit({ node: o.node, gain: 0.05 }, 0.8, 'bandpass', 300, 900, 1.2, 0, 0.2);
  }

  private waveClear(): void {
    const o = this.out(null, null, 1, 0.13)!;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(o, 'triangle', f, f, 0.45, i * 0.1, 0.01));
  }

  private fanfare(win: boolean): void {
    const o = this.out(null, null, 1, 0.16)!;
    if (win) [392, 523, 659, 784, 1046].forEach((f, i) => { this.tone(o, 'triangle', f, f, 0.8, i * 0.14, 0.01); this.tone(o, 'sine', f / 2, f / 2, 0.8, i * 0.14); });
    else { this.tone(o, 'sawtooth', 220, 40, 2.2, 0, 0.05); this.noiseHit({ node: o.node, gain: 0.1 }, 1.6, 'lowpass', 900, 60, 0.8); }
  }

  // ---- continuous layer ------------------------------------------------------------------------------------------

  /** `incoming`: alien fire is about to pass close. `lock`: 0 none, 1 acquiring, 2 locked. */
  update(w: World, dt: number, l: Listener, flags: { incoming: boolean; lock: 0 | 1 | 2; playing: boolean }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = this.now();
    const ac = w.ac;
    const alive = w.playerAlive && flags.playing;
    const E = this.engine;
    const th = alive ? ac.thrust : 0;
    const speedK = clamp(ac.speed / 360, 0, 1);

    E.saw.frequency.setTargetAtTime(52 + th * 70 + speedK * 20, now, 0.1);
    E.tri.frequency.setTargetAtTime(26 + th * 36, now, 0.1);
    E.lp.frequency.setTargetAtTime(260 + th * 1300, now, 0.15);
    E.g.gain.setTargetAtTime(alive ? 0.05 + th * 0.06 : 0, now, 0.2);
    E.rumbleF.frequency.setTargetAtTime(250 + th * 600, now, 0.15);
    E.rumble.gain.setTargetAtTime(alive ? 0.07 + th * 0.12 : 0, now, 0.2);
    E.windF.frequency.setTargetAtTime(900 + speedK * 3200, now, 0.2);
    E.wind.gain.setTargetAtTime(alive ? smoothstep(0.1, 1, speedK) * 0.16 + Math.max(0, ac.g - 3) * 0.008 : 0, now, 0.2);
    E.ab.gain.setTargetAtTime(alive ? Math.max(0, th - 1) / 0.3 * 0.26 : 0, now, 0.12);

    // hum from the nearest active beam
    let nearest = Infinity, boss = false;
    for (const a of w.aliens) {
      if (a.kind === 'mothership') boss = true;
      if (a.beam || a.beamCharge > 0) nearest = Math.min(nearest, a.pos.distanceTo(l.pos));
    }
    this.hum.g.gain.setTargetAtTime(nearest < 5000 ? 0.07 * (1 - nearest / 5000) : 0, now, 0.3);
    this.hum.osc.frequency.setTargetAtTime(boss ? 44 : 58, now, 0.4);

    // threat: how many hostiles are close
    let threat = 0;
    for (const a of w.aliens) {
      if (a.dying > 0 || a.kind === 'mothership') continue;
      const d = a.pos.distanceTo(ac.pos);
      threat += d < 3000 ? 1 - d / 3000 : 0;
    }
    threat = clamp(threat / 3 + (boss ? 0.4 : 0), 0, 1);
    this.drone.g.gain.setTargetAtTime(flags.playing ? 0.05 + threat * 0.03 : 0.07, now, 0.6);
    this.drone.lp.Q.value = 0.7 + threat * 2;
    if (flags.playing && threat > 0.12 && !this.muted) this.pulse(now, threat);

    if (alive && !this.muted) this.alarms(w, dt, flags);
  }

  /** Combat pulse: a short bass line on eighth notes, louder and busier as the threat builds. */
  private pulse(now: number, threat: number): void {
    const ctx = this.ctx!;
    if (this.nextStep < now) this.nextStep = now + 0.05;
    const spb = 0.3; // seconds per step
    while (this.nextStep < now + 0.25) {
      const seq = [55, 55, 65.4, 55, 82.4, 55, 73.4, 49];
      const f = seq[this.step % seq.length]!;
      const accent = this.step % 4 === 0;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(220 + threat * 900, this.nextStep); lp.frequency.exponentialRampToValueAtTime(90, this.nextStep + 0.22);
      const g = ctx.createGain();
      const peak = (accent ? 0.11 : 0.07) * (0.35 + threat * 0.9);
      g.gain.setValueAtTime(0.0001, this.nextStep); g.gain.exponentialRampToValueAtTime(peak, this.nextStep + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, this.nextStep + 0.26);
      o.connect(lp); lp.connect(g); g.connect(this.bus);
      o.start(this.nextStep); o.stop(this.nextStep + 0.3);
      if (threat > 0.55 && this.step % 2 === 1) {
        const h = ctx.createOscillator(); h.type = 'square'; h.frequency.value = f * 8;
        const hg = ctx.createGain(); hg.gain.setValueAtTime(0.0001, this.nextStep); hg.gain.exponentialRampToValueAtTime(0.012 * threat, this.nextStep + 0.005); hg.gain.exponentialRampToValueAtTime(0.0001, this.nextStep + 0.08);
        h.connect(hg); hg.connect(this.bus); h.start(this.nextStep); h.stop(this.nextStep + 0.1);
      }
      this.step++;
      this.nextStep += spb;
    }
  }

  private alarms(w: World, dt: number, flags: { incoming: boolean; lock: 0 | 1 | 2 }): void {
    const beep = (type: OscillatorType, f0: number, f1: number, dur: number, gain = 0.07) => this.tone(this.out(null, null, 1, gain)!, type, f0, f1, dur, 0, 0.005);
    this.alarmT -= dt;
    this.lockT -= dt;
    if (w.tti < 3.2 && w.ac.speed > 60) {
      if (this.alarmT <= 0) { this.alarmT = 0.2; this.alarmPhase ^= 1; const f = this.alarmPhase ? 880 : 640; beep('square', f, f, 0.14); }
    } else if (flags.incoming) {
      if (this.alarmT <= 0) { this.alarmT = 0.11; beep('square', 1250, 1250, 0.07); }
    } else if (w.ac.stalled && w.ac.speed < 90) {
      if (this.alarmT <= 0) { this.alarmT = 0.5; beep('triangle', 440, 440, 0.25); }
    } else if (w.hull < 30) {
      if (this.alarmT <= 0) { this.alarmT = 1.0; beep('sine', 300, 260, 0.3); }
    } else if (w.oobT > 0) {
      if (this.alarmT <= 0) { this.alarmT = 0.6; beep('triangle', 520, 520, 0.2); }
    }
    if (flags.lock === 1) {
      if (this.lockT <= 0) { this.lockT = 0.3 - w.lock * 0.2; beep('sine', 1400, 1400, 0.06); }
    } else if (flags.lock === 2) {
      if (this.lockT <= 0) { this.lockT = 0.05; beep('sine', 1900, 1900, 0.07, 0.045); }
    }
  }
}
