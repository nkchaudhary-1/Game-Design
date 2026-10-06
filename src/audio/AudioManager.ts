// Event-based audio, synthesised with Web Audio (no files, no network), so every sound is a placeholder that
// can be swapped for a recorded asset by event name later. The context is created on the first user gesture
// (browser autoplay rules), so every sound fires from a tap or key.
//
// Events (build spec §28): blade_collision, heavy_collision, super_activate, super_end, super_ready,
// ring_out, spin_low, arena_hazard, button_click, upgrade, victory, defeat — plus launch / charge / ability.

import type { BladeClass } from '../core/types';
import { clamp } from '../core/types';

export type AudioEvent =
  | 'blade_collision' | 'heavy_collision' | 'super_activate' | 'super_end' | 'super_ready' | 'ring_out'
  | 'spin_low' | 'spin_out' | 'arena_hazard' | 'button_click' | 'upgrade' | 'victory' | 'defeat' | 'draw' | 'launch' | 'ability';

export class AudioManager {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hum: { o: OscillatorNode; g: GainNode } | null = null;
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
      this.noise = this.ac.createBuffer(1, Math.floor(this.ac.sampleRate * 0.8), this.ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.master && this.ac) this.master.gain.setTargetAtTime(m ? 0 : this.LEVEL, this.ac.currentTime, 0.02);
    if (m) { this.humStop(); this.chargeStop(); }
  }

  suspend(): void { if (this.ac?.state === 'running') void this.ac.suspend(); }
  resume(): void { if (this.ac?.state === 'suspended') void this.ac.resume(); }

  private tone(o: { type?: OscillatorType; f0: number; f1?: number; dur?: number; gain?: number; delay?: number; attack?: number }): void {
    if (!this.ac || !this.master || this._muted) return;
    const t0 = this.ac.currentTime + (o.delay ?? 0), dur = o.dur ?? 0.15;
    const osc = this.ac.createOscillator(), g = this.ac.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.15, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  private hiss(o: { type?: BiquadFilterType; f0: number; f1?: number; q?: number; dur?: number; gain?: number; delay?: number }): void {
    if (!this.ac || !this.master || !this.noise || this._muted) return;
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
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 0.2); src.stop(t0 + dur + 0.03);
  }

  /** Play a named game event. `p` is an optional 0–1 intensity. */
  play(ev: AudioEvent, p = 0.5, cls?: BladeClass): void {
    if (!this.ac) return;
    switch (ev) {
      case 'blade_collision': {
        this.hiss({ type: 'highpass', f0: 2600, dur: 0.06, gain: 0.05 + 0.2 * p });
        const base = (330 + Math.random() * 140) * (1.25 - 0.45 * p);
        this.tone({ type: 'triangle', f0: base, f1: base * 0.6, dur: 0.16 + 0.1 * p, gain: 0.07 + 0.15 * p });
        this.tone({ type: 'square', f0: base * 1.51, f1: base * 1.2, dur: 0.09, gain: 0.02 + 0.05 * p });
        break;
      }
      case 'heavy_collision':
        this.tone({ type: 'sine', f0: 120, f1: 42, dur: 0.22, gain: 0.3 });
        this.hiss({ f0: 900, f1: 120, q: 0.7, dur: 0.18, gain: 0.16 });
        break;
      case 'super_activate': {
        const base = cls === 'ATTACK' ? 220 : cls === 'DEFENSE' ? 160 : 330;
        this.tone({ type: cls === 'STAMINA' ? 'sine' : 'sawtooth', f0: base, f1: base * 3.2, dur: 0.5, gain: 0.12 });
        this.hiss({ f0: 400, f1: 3200, q: 1, dur: 0.45, gain: 0.12 });
        this.tone({ type: 'triangle', f0: base * 2, f1: base * 4, dur: 0.35, gain: 0.07, delay: 0.1 });
        break;
      }
      case 'super_end':
        this.tone({ type: 'sine', f0: 520, f1: 180, dur: 0.35, gain: 0.1 });
        break;
      case 'super_ready':
        this.tone({ type: 'triangle', f0: 740, dur: 0.12, gain: 0.1 });
        this.tone({ type: 'triangle', f0: 1110, dur: 0.2, gain: 0.1, delay: 0.1 });
        break;
      case 'ring_out':
        this.tone({ type: 'sine', f0: 880, f1: 90, dur: 0.75, gain: 0.2 });
        this.hiss({ f0: 1800, f1: 160, q: 0.8, dur: 0.65, gain: 0.14 });
        break;
      case 'spin_low':
        this.tone({ type: 'sine', f0: 150, f1: 110, dur: 0.4, gain: 0.12 });
        this.tone({ type: 'sine', f0: 150, f1: 110, dur: 0.4, gain: 0.1, delay: 0.5 });
        break;
      case 'spin_out':
        this.tone({ type: 'sawtooth', f0: 240, f1: 38, dur: 1.1, gain: 0.1 });
        this.tone({ type: 'sawtooth', f0: 247, f1: 41, dur: 1.1, gain: 0.08 });
        break;
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
        this.hiss({ f0: 260, f1: 1100 + 2200 * p, q: 1.4, dur: 0.3, gain: 0.16 + 0.12 * p });
        this.tone({ type: 'sawtooth', f0: 130, f1: 240 + 260 * p, dur: 0.28, gain: 0.05 });
        break;
      case 'ability':
        this.hiss({ f0: 500, f1: 2400, q: 1.2, dur: 0.18, gain: 0.08 + 0.08 * p });
        break;
    }
  }

  // rising tone while a move is charging (PRD: "haptic buzz as it fills")
  chargeStart(): void {
    if (!this.ac || !this.master || this._muted || this.chargeNode) return;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = 120; g.gain.value = 0.0001;
    o.connect(g); g.connect(this.master); o.start();
    g.gain.exponentialRampToValueAtTime(0.05, this.ac.currentTime + 0.1);
    this.chargeNode = { o, g };
  }
  chargeSet(f: number): void { if (this.chargeNode && this.ac) this.chargeNode.o.frequency.setTargetAtTime(120 + 420 * clamp(f, 0, 1), this.ac.currentTime, 0.04); }
  chargeStop(): void {
    if (!this.chargeNode || !this.ac) return;
    const n = this.chargeNode; this.chargeNode = null;
    n.g.gain.setTargetAtTime(0.0001, this.ac.currentTime, 0.04); n.o.stop(this.ac.currentTime + 0.3);
  }

  // a low hum whose pitch tracks the average spin: you can hear the battle running down
  humStart(): void {
    if (!this.ac || !this.master || this._muted || this.hum) return;
    const o = this.ac.createOscillator(), f = this.ac.createBiquadFilter(), g = this.ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = 180; f.type = 'lowpass'; f.frequency.value = 520; g.gain.value = 0.0001;
    o.connect(f); f.connect(g); g.connect(this.master); o.start();
    g.gain.exponentialRampToValueAtTime(0.026, this.ac.currentTime + 0.3);
    this.hum = { o, g };
  }
  humSet(spin01: number): void { if (this.hum && this.ac) this.hum.o.frequency.setTargetAtTime(70 + 190 * clamp(spin01, 0, 1), this.ac.currentTime, 0.1); }
  humStop(): void {
    if (!this.hum || !this.ac) return;
    const h = this.hum; this.hum = null;
    h.g.gain.setTargetAtTime(0.0001, this.ac.currentTime, 0.12); h.o.stop(this.ac.currentTime + 0.6);
  }
}
