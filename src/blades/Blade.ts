// BladeRuntime: the live, simulated state of one blade in a match. Plain data + a few accessors.
// All behaviour lives in the combat systems; blades have no bespoke code.

import { lerp } from '../core/types';
import type { BuiltBlade } from './BladeFactory';
import type { ModFlag, ModKey, ModSet, SpinLossScale } from './effects';
import type { BladeBody } from '../core/Physics';
import type { BladeStats } from '../combat/events';

export interface ActiveMod {
  id: number;
  source: 'ability' | 'super' | 'zone';
  /** Which Super this came from, so it can be cleared when the Super ends (the 8 s cap). */
  superId?: string;
  tag?: string;
  until: number;
  mods: ModSet;
  flags: ModFlag[];
  spinLoss?: SpinLossScale;
}

export type InputAction = { k: 'down' | 'up'; i: 0 | 1 | 2 } | { k: 'super' };
export type SuperState = 'READY' | 'ACTIVE' | 'RECHARGING';

export interface SlamState { t: number; total: number; tx: number; tz: number; radius: number; impulse: number; damage: number }
export interface Shield { hits: number; until: number }

export class BladeRuntime {
  readonly slot: number;
  readonly built: BuiltBlade;
  readonly control: 'human' | 'ai';
  readonly bb: BladeBody;

  spin = 100;
  prevSpin = 100;
  readonly decayMul: number;

  launched = false;
  out: 'ring' | 'spin' | null = null;
  /** Fully off the arena (stops colliding). */
  fallen = false;

  // interpolation for rendering
  prevX = 0;
  prevZ = 0;

  // controller input
  steerX = 0;
  steerZ = 0;
  /** Steering as applied: eased towards steerX/Z so a key press or a stick flick isn't a step change. */
  smX = 0;
  smZ = 0;
  readonly queue: InputAction[] = [];
  /** Unit heading: steer direction, else velocity direction. */
  headX = 0;
  headZ = -1;
  steerMag = 0;

  // runtime state
  mods: ActiveMod[] = [];
  cooldown: [number, number, number] = [0, 0, 0];
  cooldownMax: [number, number, number] = [1, 1, 1];
  charge = { index: -1, t: 0, maxed: false };
  superState: SuperState = 'READY';
  superT = 0;
  superElapsed = 0;
  superId: string | null;
  superEveryNext: number[] = [];
  superHitCd: number[] = [];
  shield: Shield | null = null;
  slam: SlamState | null = null;
  /** 0..1 height of a leap (Meteor Crash), purely for the renderer. */
  leap = 0;
  appliedMass: number;
  ghostApplied = false;
  lowSpinWarned = false;
  lastHurtAt = -99;

  stats: BladeStats = { hits: 0, lostToHits: 0, lostToDecay: 0, lostToMoves: 0, damageDealt: 0, abilitiesUsed: 0, supersUsed: 0 };

  constructor(slot: number, built: BuiltBlade, control: 'human' | 'ai', bb: BladeBody, decayMul: number) {
    this.slot = slot;
    this.built = built;
    this.control = control;
    this.bb = bb;
    this.decayMul = decayMul;
    this.superId = built.equippedSuper;
    this.appliedMass = built.combat.mass;
  }

  get x(): number { return this.bb.body.translation().x; }
  get z(): number { return this.bb.body.translation().z; }
  get vx(): number { return this.bb.body.linvel().x; }
  get vz(): number { return this.bb.body.linvel().z; }
  get speed(): number { const v = this.bb.body.linvel(); return Math.hypot(v.x, v.z); }
  get alive(): boolean { return this.out === null; }
  get radius(): number { return this.built.combat.radius; }

  /** Product of every active multiplier for `key`, including spin-loss scaling (Rage Mode, Last Stand). */
  mod(key: ModKey): number {
    let m = 1;
    const lost = 1 - Math.max(0, Math.min(100, this.spin)) / 100;
    for (const a of this.mods) {
      const v = a.mods[key];
      if (v !== undefined) m *= v;
      if (a.spinLoss && (key === 'dmgDealt' || key === 'kbDealt' || key === 'dmgTaken' || key === 'spinDecay')) {
        const s = a.spinLoss[key];
        if (s !== undefined) m *= lerp(1, s, lost);
      }
    }
    return m;
  }

  hasFlag(f: ModFlag): boolean {
    for (const a of this.mods) if (a.flags.includes(f)) return true;
    return false;
  }

  removeFlag(f: ModFlag): void {
    for (const a of this.mods) a.flags = a.flags.filter((x) => x !== f);
  }
}
