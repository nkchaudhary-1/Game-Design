// Match: one battle's simulation. Owns the Rapier world, the arena and the blades. Pure logic — no DOM,
// no Three.js — so the exact same code runs in the browser and in the headless balance harness.
//
// "Build to N, ship 2": everything here accepts up to four blades; the MVP plays two.

import { TUNING, deriveCombat } from '../core/Balance';
import { PhysicsWorld } from '../core/Physics';
import type { Rng } from '../core/Rng';
import { Arena } from '../arenas/Arena';
import type { ArenaDef } from '../arenas/arenaData';
import { BladeRuntime, type InputAction } from '../blades/Blade';
import type { BuiltBlade } from '../blades/BladeFactory';
import type { ZoneKind } from '../blades/effects';
import { stepMatch } from './CombatSystem';
import type { MatchResult, SimEvent } from './events';

export interface MatchEntry { built: BuiltBlade; control: 'human' | 'ai' }

export interface Zone {
  id: number; kind: ZoneKind; owner: number; x: number; z: number; radius: number; until: number;
  strength: number; damage: number; follow: boolean; hitCd: Record<number, number>;
}
export interface Pull { owner: number; radius: number; strength: number; until: number }
export interface Drain { owner: number; radius: number; rate: number; until: number }
export interface Decoy { owner: number; x: number; z: number; vx: number; vz: number; until: number; radius: number }

export type MatchPhase = 'ready' | 'live' | 'over';

export class Match {
  readonly physics: PhysicsWorld;
  readonly arena: Arena;
  readonly blades: BladeRuntime[] = [];
  readonly rng: Rng;

  t = 0;
  phase: MatchPhase = 'ready';
  events: SimEvent[] = [];
  result: MatchResult | null = null;
  koAt = -1;
  koCause: 'ring' | 'spin' | null = null;
  lastHit = 0;

  zones: Zone[] = [];
  pulls: Pull[] = [];
  drains: Drain[] = [];
  decoys: Decoy[] = [];
  private idCounter = 1;

  constructor(arenaDef: ArenaDef, entries: MatchEntry[], rng: Rng) {
    this.rng = rng;
    this.arena = new Arena(arenaDef);
    this.physics = new PhysicsWorld(TUNING.DT);
    this.physics.addGround(this.arena.radius);
    entries.forEach((e, slot) => {
      const sp = this.arena.spawn(slot, entries.length);
      const c = e.built.combat ?? deriveCombat(e.built.stats);
      const bb = this.physics.createBlade(slot, {
        x: sp.x, z: sp.z, radius: c.radius, height: c.height, mass: c.mass,
        restitution: c.restitution, friction: c.friction, linearDamping: c.linearDamping,
      });
      const decayMul = 1 + (rng() - 0.5) * 2 * TUNING.DECAY_JITTER;
      const b = new BladeRuntime(slot, e.built, e.control, bb, decayMul);
      b.prevX = sp.x; b.prevZ = sp.z;
      // spawn facing the middle
      b.headX = -Math.cos(sp.angle); b.headZ = -Math.sin(sp.angle);
      this.blades.push(b);
    });
  }

  newId(): number { return this.idCounter++; }
  emit(e: SimEvent): void { this.events.push(e); }
  /** Drain and return the events emitted since the last call. */
  takeEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }

  /** Launch `slot`: direction `angle` (radians on the floor plane) and `power` 0–1. */
  launch(slot: number, angle: number, power: number): void {
    const b = this.blades[slot];
    if (!b || b.launched || this.phase === 'over') return;
    const p = Math.max(0, Math.min(1, power));
    const sp = Math.min(TUNING.LAUNCH_MAX, TUNING.LAUNCH_MIN + (TUNING.LAUNCH_MAX - TUNING.LAUNCH_MIN) * p);
    b.bb.body.setLinvel({ x: Math.cos(angle) * sp, y: 0, z: Math.sin(angle) * sp }, true);
    b.headX = Math.cos(angle); b.headZ = Math.sin(angle);
    b.launched = true;
    this.emit({ type: 'launch', slot, power: p, x: b.x, z: b.z });
    if (this.blades.every((x) => x.launched)) this.phase = 'live';
  }

  setSteer(slot: number, x: number, z: number): void {
    const b = this.blades[slot];
    if (!b) return;
    const l = Math.hypot(x, z);
    const k = l > 1 ? 1 / l : 1;
    b.steerX = x * k; b.steerZ = z * k;
  }

  pushAction(slot: number, a: InputAction): void {
    const b = this.blades[slot];
    if (b && b.queue.length < 16) b.queue.push(a);
  }

  /** Nearest living blade that isn't `slot`. */
  opponentOf(slot: number): BladeRuntime | null {
    const me = this.blades[slot];
    let best: BladeRuntime | null = null;
    let bd = Infinity;
    for (const o of this.blades) {
      if (o.slot === slot || !o.alive || o.fallen) continue;
      const d = (o.x - me.x) ** 2 + (o.z - me.z) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  step(): void { stepMatch(this); }

  dispose(): void { this.physics.dispose(); }
}
