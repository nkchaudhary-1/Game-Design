// Battle: the DISPLAY side of a match. It owns the simulation, the 3D view and the CPU, runs the fixed-step
// loop (with hit-stop and slow-mo), and is the only thing that consumes controller messages. Controllers
// (the on-page pad, the keyboard, the CPU) never touch the match directly: they send messages over the bus.

import { AIController } from '../ai/AIController';
import type { AIDifficulty } from '../ai/AIStates';
import { getArena } from '../arenas/arenaData';
import type { BuiltBlade } from '../blades/BladeFactory';
import { Match } from '../combat/Match';
import type { MatchResult, SimEvent } from '../combat/events';
import { AudioManager } from '../audio/AudioManager';
import { BattleView, TEAM_COLORS } from '../render/BattleView';
import type { GameRenderer } from '../render/GameRenderer';
import { TUNING } from './Balance';
import { applyControllerMsg, feedbackFor, LocalBus, type ControllerMsg } from './InputBus';
import { makeRng, randomSeed } from './Rng';

export interface BattleOptions {
  rr: GameRenderer;
  player: BuiltBlade;
  cpu: BuiltBlade;
  difficulty: AIDifficulty;
  arenaId: string;
  reduced: boolean;
  audio: AudioManager;
  onResult: (r: MatchResult) => void;
  /** The arena did something (a magnet flipped, a vent is about to erupt…): the screen may announce it. */
  onArena?: (e: Extract<SimEvent, { type: 'arena' }>) => void;
  /** A blade used a move or Super (either side). */
  onPower?: (e: Extract<SimEvent, { type: 'ability' | 'super' }>) => void;
  /** Practice: the CPU stands still and uses nothing. */
  practice?: boolean;
  seed?: number;
}

export type BattlePhase = 'ready' | 'live' | 'ending' | 'done';

const ENDING_SECONDS = 1.9;

export class Battle {
  readonly match: Match;
  readonly view: BattleView;
  readonly bus = new LocalBus();
  readonly ai: AIController;
  /** Debug/test: multiplies simulation speed. */
  speed = 1;
  phase: BattlePhase = 'ready';

  private acc = 0;
  private timeScale = 1;
  private slowLeft = 0;
  private freeze = 0;
  private endClock = 0;
  private feedbackIn = 0;
  private readonly unsub: () => void;
  private aim = { angle: -Math.PI / 2, power: -1, at: -9 };
  private clock = 0;
  private result: MatchResult | null = null;
  private disposed = false;
  private chargingAudio = false;

  constructor(private readonly o: BattleOptions) {
    const seed = o.seed ?? randomSeed();
    const rng = makeRng(seed);
    this.match = new Match(getArena(o.arenaId), [{ built: o.player, control: 'human' }, { built: o.cpu, control: 'ai' }], rng);
    this.view = new BattleView(this.match, o.reduced);
    this.ai = new AIController(1, o.difficulty, (m) => this.bus.controller.send(m), makeRng(seed ^ 0x9e3779b9));
    this.ai.idle = !!o.practice;
    this.unsub = this.bus.display.subscribe((m) => this.consume(m));
    this.view.resize(o.rr.aspect);
  }

  get currentPhase(): 'ready' | 'live' | 'over' { return this.match.phase; }

  /** Everything a controller can say lands here. */
  private consume(msg: ControllerMsg): void {
    if (this.disposed) return;
    if (msg.t === 'aim') { this.aim = { angle: msg.angle, power: msg.power, at: this.clock }; return; }
    if (msg.t === 'launch' && this.match.phase === 'ready' && msg.slot === 0) {
      applyControllerMsg(this.match, msg);
      // the CPU launches the moment you do
      const l = this.ai.launch(this.match);
      applyControllerMsg(this.match, { t: 'launch', slot: 1, angle: l.angle, power: l.power });
      this.view.setAim(0, 0, -1);
      this.o.audio.play('launch', msg.power);
      this.o.audio.humStart();
      this.phase = 'live';
      return;
    }
    applyControllerMsg(this.match, msg);
  }

  resize(): void { this.view.resize(this.o.rr.aspect); }

  update(dtReal: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.05, dtReal);
    this.clock += dt;

    if (this.slowLeft > 0) { this.slowLeft -= dt; if (this.slowLeft <= 0) this.timeScale = 1; }

    if (this.freeze > 0) this.freeze -= dt;
    else if (this.phase !== 'done') {
      this.acc += dt * this.timeScale * this.speed;
      let n = 0;
      while (this.acc >= TUNING.DT) {
        if (this.match.phase === 'live') this.ai.update(this.match, TUNING.DT);
        this.match.step();
        this.acc -= TUNING.DT;
        const events = this.match.takeEvents();
        if (events.length) this.process(events);
        if (++n > 14) { this.acc = 0; break; }
        if (this.freeze > 0) break;
      }
    }

    if (this.phase === 'ending') {
      this.endClock += dt;
      if (this.endClock >= ENDING_SECONDS && this.result) { this.phase = 'done'; const r = this.result; this.o.onResult(r); }
    }

    // launch arrow: real while the player aims, a faint hint otherwise
    if (this.match.phase === 'ready') {
      const b = this.match.blades[0], opp = this.match.blades[1];
      if (this.aim.power >= 0 && this.clock - this.aim.at < 0.6) this.view.setAim(0, this.aim.angle, this.aim.power, TEAM_COLORS[0], 0.95);
      else {
        const a = Math.atan2(opp.z - b.z, opp.x - b.x);
        this.view.setAim(0, a, 0.55, TEAM_COLORS[0], 0.22 + 0.12 * Math.sin(this.clock * 3));
      }
    }

    this.view.update(dt, clamp01(this.acc / TUNING.DT));

    // keep the controller's meters honest, ~30 Hz
    this.feedbackIn -= dt;
    if (this.feedbackIn <= 0) {
      this.feedbackIn = 1 / 30;
      this.bus.display.send(feedbackFor(this.match, 0));
    }

    // audio that tracks state
    const me = this.match.blades[0];
    if (this.match.phase === 'live') {
      // each blade sings at its own pitch from its own spin, panned to where it is; blades that rub, grind
      const R = this.match.arena.radius;
      this.match.blades.forEach((b, i) => this.o.audio.whirrSet(i, Math.max(0, b.spin) / 100, clamp01((b.x / R + 1) / 2) * 1.6 - 0.8, !b.out));
      this.o.audio.grindSet(this.view.contacts.level, this.view.contacts.pan * 0.8);
      if (me.charge.index >= 0) {
        const ch = me.built.moves[me.charge.index].charge!;
        if (!this.chargingAudio) { this.chargingAudio = true; this.o.audio.chargeStart(); }
        this.o.audio.chargeSet(me.charge.t / ch.maxTime);
      } else if (this.chargingAudio) { this.chargingAudio = false; this.o.audio.chargeStop(); }
    }
  }

  private process(events: SimEvent[]): void {
    const reaction = this.view.handleEvents(events);
    if (reaction.hitStop > 0) this.freeze = Math.max(this.freeze, reaction.hitStop);
    if (reaction.slowMo > 0 && this.phase !== 'ending') { this.timeScale = 0.35; this.slowLeft = reaction.slowMo; }
    const a = this.o.audio;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const pan = this.panAt(e.x);
          a.play('blade_collision', e.strength, undefined, pan);
          if (e.heavy) a.play('heavy_collision', 0.5, undefined, pan);
          break;
        }
        case 'ko':
          a.humStop();
          a.play(e.cause === 'ring' ? 'ring_out' : 'spin_out', 0.5, undefined, this.panAt(this.match.blades[e.slot].x));
          break;
        case 'super':
          if (e.state === 'activate') { a.play('super_activate', 0.5, this.match.blades[e.slot].built.def.class); this.o.onPower?.(e); }
          else if (e.state === 'end') a.play('super_end');
          else if (e.slot === 0) a.play('super_ready');
          break;
        case 'spinLow': if (e.slot === 0) a.play('spin_low'); break;
        case 'arena': a.arena(e.kind, this.panAt(e.x), e.power); this.o.onArena?.(e); break;
        case 'ability': if (e.slot === 0) a.play('ability', e.charge); this.o.onPower?.(e); break;
        case 'end': {
          this.result = e.result;
          this.phase = 'ending';
          this.endClock = 0;
          this.o.audio.chargeStop();
          if (e.result.winner === 0) a.play('victory'); else if (e.result.winner === 1) a.play('defeat'); else a.play('draw');
          break;
        }
        default: break;
      }
    }
  }

  /** Stereo position (−0.8…0.8) of a point on the arena floor. */
  private panAt(x: number): number { return clamp01((x / this.match.arena.radius + 1) / 2) * 1.6 - 0.8; }

  render(): void {
    this.o.rr.render(this.view.scene, this.view.rig.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.unsub();
    this.o.audio.humStop();
    this.o.audio.chargeStop();
    this.view.dispose();
    this.match.dispose();
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
