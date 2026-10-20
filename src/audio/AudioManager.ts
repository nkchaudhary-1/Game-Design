// Event-based audio, synthesised with Web Audio (no files, no network), so every sound is a placeholder that
// can be swapped for a recorded asset by event name later. The context is created on the first user gesture
// (browser autoplay rules), so every sound fires from a tap or key.
//
// What makes it read as metal on concrete rather than beeps:
//   * a collision is a struck plate: a handful of inharmonic partials (ratios 1 : 2.76 : 5.4 : 8.9) that ring and
//     die at different rates, over a short noise click and a bright sizzle; heavier hits ring lower and longer
//   * contact that keeps going is a grinding loop (filtered noise, bright and fast when the rub is hard)
//   * each blade has its own whirr whose pitch follows its spin; when the spin dies it wobbles (tremolo), then the
//     blade topples and rattles to rest on the floor, the ticks speeding up as it settles
//   * everything is panned by where it happens in the arena and sent through a short arena reverb
//
// Events (build spec §28): blade_collision, heavy_collision, super_activate, super_end, super_ready,
// ring_out, spin_low, arena_hazard, button_click, upgrade, victory, defeat — plus launch / charge / ability.

import type { BladeClass } from '../core/types';
import type { ArenaEventKind } from '../combat/events';
import { clamp } from '../core/types';

export type AudioEvent =
  | 'blade_collision' | 'heavy_collision' | 'super_activate' | 'super_end' | 'super_ready' | 'ring_out'
  | 'spin_low' | 'spin_out' | 'arena_hazard' | 'button_click' | 'upgrade' | 'victory' | 'defeat' | 'draw' | 'launch' | 'ability';

/** Frequency ratios of a struck metal plate's modes, with how loud and how long each one rings. */
const PLATE_MODES: Array<{ ratio: number; gain: number; ring: number }> = [
  { ratio: 1, gain: 1, ring: 0.34 }, { ratio: 2.76, gain: 0.55, ring: 0.22 }, { ratio: 5.4, gain: 0.3, ring: 0.13 }, { ratio: 8.93, gain: 0.16, ring: 0.08 },
];

interface Whirr { o: OscillatorNode; g: GainNode; lfo: OscillatorNode; lfoG: GainNode; pan: StereoPannerNode }
interface Grind { src: AudioBufferSourceNode; bp: BiquadFilterNode; g: GainNode; pan: StereoPannerNode }

export class AudioManager {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private whirrs: Whirr[] = [];
  private grind: Grind | null = null;
  private chargeNode: { o: OscillatorNode; g: GainNode } | null = null;
  private _muted = false;
  private readonly LEVEL = 0.7;

  get muted(): boolean { return this._muted; }

  /** Create/resume the context. Call from any user gesture. */
  unlock(): void {
    if (!this.ac) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      const comp = this.ac.createDynamicsCompressor();
      this.master = this.ac.createGain();
      this.master.gain.value = this._muted ? 0 : this.LEVEL;
      this.master.connect(comp);
      comp.connect(this.ac.destination);
      // every sound goes to the bus: dry to the master, and a little through a short arena reverb
      this.bus = this.ac.createGain();
      this.bus.connect(this.master);
      try {
        const verb = this.ac.createConvolver();
        verb.buffer = this.impulse(1.3, 3.4);
        const wet = this.ac.createGain();
        wet.gain.value = 0.17;
        this.bus.connect(verb); verb.connect(wet); wet.connect(this.master);
      } catch { /* no reverb: still fine */ }
      this.noise = this.ac.createBuffer(1, Math.floor(this.ac.sampleRate * 0.8), this.ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
  }

  /** A short decaying-noise impulse response: the arena's echo. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ac = this.ac!;
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += (Math.random() * 2 - 1 - lp) * 0.55;          // darker than white noise: concrete, not glass
        d[i] = lp * Math.pow(1 - i / n, decay) * (i < 90 ? i / 90 : 1);
      }
    }
    return buf;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.master && this.ac) this.master.gain.setTargetAtTime(m ? 0 : this.LEVEL, this.ac.currentTime, 0.02);
    if (m) { this.humStop(); this.chargeStop(); }
  }

  suspend(): void { if (this.ac?.state === 'running') void this.ac.suspend(); }
  resume(): void { if (this.ac?.state === 'suspended') void this.ac.resume(); }

  /** Where a source plugs in: the bus, or a stereo panner in front of it. */
  private dest(pan: number): AudioNode {
    if (!this.ac || !this.bus) throw new Error('audio not ready');
    if (Math.abs(pan) < 0.02 || !this.ac.createStereoPanner) return this.bus;
    const p = this.ac.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(this.bus);
    return p;
  }

  private tone(o: { type?: OscillatorType; f0: number; f1?: number; dur?: number; gain?: number; delay?: number; attack?: number; pan?: number }): void {
    if (!this.ac || !this.bus || this._muted) return;
    const t0 = this.ac.currentTime + (o.delay ?? 0), dur = o.dur ?? 0.15;
    const osc = this.ac.createOscillator(), g = this.ac.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.15, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.dest(o.pan ?? 0));
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  private hiss(o: { type?: BiquadFilterType; f0: number; f1?: number; q?: number; dur?: number; gain?: number; delay?: number; pan?: number }): void {
    if (!this.ac || !this.bus || !this.noise || this._muted) return;
    const t0 = this.ac.currentTime + (o.delay ?? 0), dur = o.dur ?? 0.1;
    const src = this.ac.createBufferSource();
    src.buffer = this.noise;
    const f = this.ac.createBiquadFilter();
    f.type = o.type ?? 'bandpass'; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + dur);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.15, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.dest(o.pan ?? 0));
    src.start(t0, Math.random() * 0.2); src.stop(t0 + dur + 0.03);
  }

  /** A struck metal plate. `p` 0–1 is how hard; harder rings lower and longer. */
  private clang(p: number, pan: number, delay = 0, level = 1): void {
    const base = (300 + Math.random() * 220) * (1.3 - 0.55 * p);
    for (const m of PLATE_MODES) {
      const f = base * m.ratio * (1 + (Math.random() - 0.5) * 0.012);
      this.tone({ type: 'sine', f0: f, f1: f * 0.985, dur: m.ring * (0.55 + 0.9 * p), gain: m.gain * (0.075 + 0.22 * p) * level, attack: 0.002, delay, pan });
    }
    this.hiss({ type: 'bandpass', f0: 3200 + Math.random() * 1500, q: 0.9, dur: 0.035, gain: (0.09 + 0.26 * p) * level, delay, pan });
    this.hiss({ type: 'highpass', f0: 5200, dur: 0.1, gain: (0.04 + 0.12 * p) * level, delay, pan });
  }

  /** One tick of a blade rattling on the floor as it settles. */
  private rattle(delay: number, level: number, pan: number): void {
    this.hiss({ type: 'bandpass', f0: 1300 + Math.random() * 1100, q: 2.2, dur: 0.018, gain: 0.1 * level, delay, pan });
    this.tone({ type: 'sine', f0: 210 + Math.random() * 60, f1: 120, dur: 0.05, gain: 0.07 * level, delay, pan });
  }

  /** Play a named game event. `p` is an optional 0–1 intensity; `pan` places it in the stereo field (−1…1). */
  play(ev: AudioEvent, p = 0.5, cls?: BladeClass, pan = 0): void {
    if (!this.ac) return;
    switch (ev) {
      case 'blade_collision':
        this.clang(p, pan);
        break;
      case 'heavy_collision':
        this.tone({ type: 'sine', f0: 118, f1: 40, dur: 0.26, gain: 0.3, pan });
        this.hiss({ type: 'lowpass', f0: 900, f1: 120, q: 0.7, dur: 0.2, gain: 0.16, pan });
        break;
      case 'super_activate': {
        const base = cls === 'ATTACK' ? 220 : cls === 'DEFENSE' ? 160 : 330;
        this.tone({ type: cls === 'STAMINA' ? 'sine' : 'sawtooth', f0: base, f1: base * 3.2, dur: 0.5, gain: 0.12, pan });
        this.hiss({ f0: 400, f1: 3200, q: 1, dur: 0.45, gain: 0.12, pan });
        this.tone({ type: 'triangle', f0: base * 2, f1: base * 4, dur: 0.35, gain: 0.07, delay: 0.1, pan });
        break;
      }
      case 'super_end':
        this.tone({ type: 'sine', f0: 520, f1: 180, dur: 0.35, gain: 0.1, pan });
        break;
      case 'super_ready':
        this.tone({ type: 'triangle', f0: 740, dur: 0.12, gain: 0.1 });
        this.tone({ type: 'triangle', f0: 1110, dur: 0.2, gain: 0.1, delay: 0.1 });
        break;
      case 'ring_out':
        // the whoosh of the fall, then the blade clattering on the concrete outside the arena
        this.tone({ type: 'sine', f0: 880, f1: 90, dur: 0.75, gain: 0.16, pan });
        this.hiss({ f0: 1800, f1: 160, q: 0.8, dur: 0.65, gain: 0.12, pan });
        this.clang(0.7, pan, 0.72, 1.2);
        this.clang(0.4, pan, 0.98, 0.8);
        this.clang(0.2, pan, 1.16, 0.5);
        break;
      case 'spin_low':
        this.tone({ type: 'sine', f0: 150, f1: 110, dur: 0.4, gain: 0.12, pan });
        this.tone({ type: 'sine', f0: 150, f1: 110, dur: 0.4, gain: 0.1, delay: 0.5, pan });
        break;
      case 'spin_out': {
        // the whine dies, the blade topples and rattles on its rim; the ticks speed up as it settles
        this.tone({ type: 'sine', f0: 300, f1: 70, dur: 1.2, gain: 0.07, pan });
        let t = 0.1, gap = 0.24, level = 1;
        for (let k = 0; k < 24 && gap > 0.026; k++) { t += gap; this.rattle(t, level, pan); gap *= 0.8; level *= 0.93; }
        this.tone({ type: 'sine', f0: 90, f1: 50, dur: 0.18, gain: 0.12, delay: t + 0.05, pan });
        break;
      }
      case 'arena_hazard':
        this.tone({ type: 'sawtooth', f0: 90, f1: 60, dur: 0.4, gain: 0.1 });
        break;
      case 'button_click':
        this.tone({ type: 'triangle', f0: 760, f1: 1240, dur: 0.07, gain: 0.07 });
        break;
      case 'upgrade':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.16, gain: 0.06, delay: i * 0.07 }));
        break;
      case 'victory':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.22, gain: 0.07, delay: 0.5 + i * 0.09 }));
        break;
      case 'defeat':
        [392, 311.13, 233.08].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.3, gain: 0.13, delay: 0.5 + i * 0.16 }));
        break;
      case 'draw':
        [440, 440].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.25, gain: 0.12, delay: 0.5 + i * 0.2 }));
        break;
      case 'launch':
        // the cord rips, the blade drops onto the floor with a metal tick and starts to sing
        this.hiss({ f0: 260, f1: 1100 + 2200 * p, q: 1.4, dur: 0.3, gain: 0.16 + 0.12 * p, pan });
        this.tone({ type: 'sawtooth', f0: 130, f1: 240 + 260 * p, dur: 0.28, gain: 0.05, pan });
        this.clang(0.15, pan, 0.3, 0.5);
        break;
      case 'ability':
        this.hiss({ f0: 500, f1: 2400, q: 1.2, dur: 0.18, gain: 0.08 + 0.08 * p, pan });
        break;
    }
  }

  /** What the arena itself does: each mechanic has its own voice (the spec's arena_hazard, one per hazard). */
  arena(kind: ArenaEventKind, pan = 0, p = 0): void {
    if (!this.ac) return;
    switch (kind) {
      case 'pull':
        this.tone({ type: 'sine', f0: 90, f1: 300, dur: 0.9, gain: 0.12, pan });
        this.hiss({ type: 'lowpass', f0: 300, f1: 1400, q: 0.8, dur: 0.9, gain: 0.08, pan });
        break;
      case 'push':
        this.tone({ type: 'sine', f0: 320, f1: 70, dur: 0.7, gain: 0.13, pan });
        this.hiss({ type: 'lowpass', f0: 1500, f1: 200, q: 0.8, dur: 0.7, gain: 0.09, pan });
        break;
      case 'magnetWarn':
        [0, 0.16].forEach((d) => this.tone({ type: 'square', f0: 480, dur: 0.07, gain: 0.04, delay: d, pan }));
        break;
      case 'crystalBreak': {
        const base = [523, 660, 784, 988][Math.max(0, Math.min(3, Math.round(p)))];
        [1, 1.5, 2, 3.01].forEach((r, i) => this.tone({ type: 'sine', f0: base * r, f1: base * r * 0.99, dur: 0.5 - i * 0.08, gain: 0.1 / (1 + i * 0.5), delay: i * 0.012, pan }));
        this.hiss({ type: 'highpass', f0: 3200, q: 0.8, dur: 0.18, gain: 0.1, pan });
        break;
      }
      case 'crystalSpawn':
        this.tone({ type: 'sine', f0: 1480, f1: 1900, dur: 0.25, gain: 0.04, pan });
        break;
      case 'gapWarn':
        [0, 0.2, 0.4].forEach((d) => this.tone({ type: 'square', f0: 190, dur: 0.06, gain: 0.05, delay: d, pan }));
        break;
      case 'gapOpen':
        this.tone({ type: 'sine', f0: 80, f1: 38, dur: 0.4, gain: 0.2, pan });
        this.clang(0.5, pan, 0.55, 0.8);
        break;
      case 'gapClose':
        this.tone({ type: 'sine', f0: 70, f1: 45, dur: 0.25, gain: 0.14, pan });
        this.clang(0.35, pan, 0.7, 0.5);
        break;
      case 'stumble':
        this.tone({ type: 'sine', f0: 150, f1: 70, dur: 0.12, gain: 0.08, pan });
        break;
      case 'gustWarn':
        this.hiss({ type: 'bandpass', f0: 400, f1: 1500, q: 1.1, dur: 0.9, gain: 0.05, pan });
        break;
      case 'gust':
        this.hiss({ type: 'bandpass', f0: 500, f1: 900, q: 0.9, dur: 1.5, gain: 0.14, pan });
        break;
      case 'lavaWarn':
        this.tone({ type: 'sawtooth', f0: 52, f1: 70, dur: 1.2, gain: 0.07, pan });
        break;
      case 'lavaBurst':
        this.hiss({ type: 'lowpass', f0: 2200, f1: 180, q: 0.7, dur: 0.7, gain: 0.2, pan });
        this.tone({ type: 'sine', f0: 100, f1: 34, dur: 0.5, gain: 0.22, pan });
        break;
      case 'lavaBurn':
        this.hiss({ type: 'highpass', f0: 3600, q: 0.7, dur: 0.14, gain: 0.04, pan });
        break;
      case 'drop':
        this.tone({ type: 'sine', f0: 120, f1: 48, dur: 0.18, gain: 0.14, pan });
        break;
    }
  }

  // rising tone while a move is charging (PRD: "haptic buzz as it fills")
  chargeStart(): void {
    if (!this.ac || !this.bus || this._muted || this.chargeNode) return;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = 120; g.gain.value = 0.0001;
    o.connect(g); g.connect(this.bus); o.start();
    g.gain.exponentialRampToValueAtTime(0.05, this.ac.currentTime + 0.1);
    this.chargeNode = { o, g };
  }
  chargeSet(f: number): void { if (this.chargeNode && this.ac) this.chargeNode.o.frequency.setTargetAtTime(120 + 420 * clamp(f, 0, 1), this.ac.currentTime, 0.04); }
  chargeStop(): void {
    if (!this.chargeNode || !this.ac) return;
    const n = this.chargeNode; this.chargeNode = null;
    n.g.gain.setTargetAtTime(0.0001, this.ac.currentTime, 0.04); n.o.stop(this.ac.currentTime + 0.3);
  }

  // ------------------------------------------------------------------------------------- spin and grind loops
  /** Start the per-blade whirrs and the grind loop. Call when the round goes live. */
  humStart(): void {
    if (!this.ac || !this.bus || !this.noise || this._muted || this.whirrs.length) return;
    const ac = this.ac, t = ac.currentTime;
    for (let slot = 0; slot < 2; slot++) {
      const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(), pan = ac.createStereoPanner();
      o.type = 'sawtooth'; o.frequency.value = slot === 0 ? 110 : 150;
      f.type = 'lowpass'; f.frequency.value = 640;
      g.gain.value = 0.0001;
      // a tremolo that only opens up when the spin is low: the wobble you hear as a top runs down
      const lfo = ac.createOscillator(), lfoG = ac.createGain();
      lfo.frequency.value = 5; lfoG.gain.value = 0;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      o.connect(f); f.connect(g); g.connect(pan); pan.connect(this.bus);
      o.start(); lfo.start();
      g.gain.exponentialRampToValueAtTime(0.017, t + 0.4);
      this.whirrs.push({ o, g, lfo, lfoG, pan });
    }
    const src = ac.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.2; bp.frequency.value = 2200;
    const g = ac.createGain(); g.gain.value = 0;
    const pan = ac.createStereoPanner();
    src.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.bus);
    src.start();
    this.grind = { src, bp, g, pan };
  }

  /** Pitch, loudness and wobble of one blade's whirr from its spin (0–1) and where it is (−1…1). */
  whirrSet(slot: number, spin01: number, pan: number, alive = true): void {
    const w = this.whirrs[slot];
    if (!w || !this.ac) return;
    const t = this.ac.currentTime, s = clamp(spin01, 0, 1);
    const base = slot === 0 ? 62 : 84;
    w.o.frequency.setTargetAtTime(base + 230 * Math.pow(s, 0.8), t, 0.08);
    const level = alive ? 0.008 + 0.012 * s : 0.0001;
    w.g.gain.setTargetAtTime(level, t, 0.15);
    const low = clamp((0.4 - s) / 0.4, 0, 1);
    w.lfo.frequency.setTargetAtTime(4 + 9 * low, t, 0.2);
    w.lfoG.gain.setTargetAtTime(alive ? level * 0.85 * low : 0, t, 0.2);
    w.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
  }

  /** The grinding loop: `level` 0–1 is how hard blades rub (each other or the wall). */
  grindSet(level: number, pan: number): void {
    if (!this.grind || !this.ac) return;
    const t = this.ac.currentTime, l = clamp(level, 0, 1);
    this.grind.g.gain.setTargetAtTime(l < 0.04 ? 0 : 0.03 + 0.1 * l, t, 0.03);
    this.grind.bp.frequency.setTargetAtTime(1500 + 2800 * l, t, 0.04);
    this.grind.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
  }

  humStop(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    for (const w of this.whirrs) {
      w.g.gain.cancelScheduledValues(t); w.g.gain.setTargetAtTime(0.0001, t, 0.1);
      w.lfoG.gain.setTargetAtTime(0, t, 0.05);
      w.o.stop(t + 0.7); w.lfo.stop(t + 0.7);
    }
    this.whirrs = [];
    if (this.grind) { this.grind.g.gain.setTargetAtTime(0, t, 0.04); this.grind.src.stop(t + 0.3); this.grind = null; }
  }
}
