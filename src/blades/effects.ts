// Reusable effect primitives. Basic moves and Supers are *data*: lists of these effects, executed by one
// shared EffectSystem. No blade has bespoke ability code.

import type { StatRatings } from '../core/types';

/** Multipliers on a blade's derived combat values (1 = unchanged). */
export type ModKey =
  | 'accel'     // steering acceleration
  | 'drag'      // linear damping (lower = more slippery)
  | 'mass'      // effective mass in collisions
  | 'kbDealt'   // knockback it gives
  | 'kbTaken'   // knockback it receives
  | 'dmgDealt'  // spin damage it deals
  | 'dmgTaken'  // spin damage it takes
  | 'spinDecay' // passive spin drain
  | 'grip'      // lateral velocity damping while steering (turning authority)
  | 'external'; // response to non-collision forces (pulls, zones, wall, swirl)
export type ModSet = Partial<Record<ModKey, number>>;

export type ModFlag =
  | 'invuln'           // takes no spin damage / knockback
  | 'ghost'            // passes through blades (no collision), drawn translucent
  | 'reflectDamage'    // spin damage taken is also dealt back to the attacker
  | 'reflectKnockback' // knockback taken is also dealt back to the attacker
  | 'stealth'          // opponent's targeting becomes inaccurate; next hit is an ambush
  | 'ambush';          // next hit deals bonus damage, then the flag ends

/** Extra multiplier reached at 0 spin, interpolated by how much spin has been lost. */
export interface SpinLossScale { dmgDealt?: number; kbDealt?: number; dmgTaken?: number; spinDecay?: number }

export type ZoneKind = 'trap' | 'well' | 'blackhole';

export type EffectDef =
  | { kind: 'dash'; dir: 'heading' | 'target' | 'perp' | 'away'; speed: number; scaleByCharge?: boolean }
  | {
      kind: 'mod'; target?: 'self' | 'opponent'; duration: number; mods?: ModSet; flags?: ModFlag[];
      spinLoss?: SpinLossScale; scaleByCharge?: boolean; tag?: string;
    }
  | { kind: 'radial'; radius: number; impulse: number; damage: number }
  | { kind: 'pull'; radius: number; strength: number; duration: number }
  | { kind: 'zone'; zone: ZoneKind; radius: number; duration: number; strength: number; damage: number; at: 'self' | 'target'; follow?: boolean }
  | { kind: 'drain'; radius: number; rate: number; duration: number }
  | { kind: 'teleport'; to: 'behindTarget'; distance: number }
  | { kind: 'spin'; amount: number }
  | { kind: 'shield'; hits: number; duration: number }
  | { kind: 'decoy'; duration: number }
  | { kind: 'slam'; delay: number; radius: number; impulse: number; damage: number };

export type AbilityType = 'ATTACK' | 'DEFENSE' | 'MOVEMENT' | 'CONTROL' | 'BUFF' | 'DEBUFF';

/** Spec §9 ability schema. `charge` is the PRD's hold-to-charge / release-to-fire mechanic. */
export interface AbilityDef {
  id: string;
  name: string;
  type: AbilityType;
  description: string;
  cooldown: number;            // seconds, starts when the move fires
  duration: number;            // length of the move's own active window (informational; effects carry their own)
  force: number;               // headline impulse (informational; effects carry the real numbers)
  damage: number;              // headline spin damage bonus (informational)
  staminaCost: number;         // spin % spent on use (chargeable moves also drain while charging)
  movementModifier: number;    // headline accel multiplier (informational)
  charge?: { maxTime: number; drainPerSec: number; minCharge: number };
  effects: EffectDef[];
}

export type SuperTiming = 'start' | 'every' | 'onHit' | 'onHurt' | 'end';
export interface TimedEffect {
  at: SuperTiming;
  /** for 'every': seconds between triggers; for 'onHit'/'onHurt': minimum seconds between triggers. */
  interval?: number;
  effect: EffectDef;
}

/** Spec §10 super schema (`effect` → `effects`: a Super is a timeline of effects). */
export interface SuperDef {
  id: string;
  name: string;
  bladeId: string;
  description: string;
  duration: number;            // 6–8 s, never above SUPER_MAX_DURATION
  recharge: number;            // 10 s, starts when the Super ends
  strength: number;            // base strength multiplier; levels add to it
  unlockLevel: number;
  requiredStats?: Partial<StatRatings>;
  ultimate?: boolean;
  implemented: boolean;
  fx: 'burst' | 'aura' | 'zone' | 'trail' | 'shield';
  effects: TimedEffect[];
}

export const SUPER_MAX_DURATION = 8;
export const SUPER_MIN_DURATION = 6;
export const SUPER_RECHARGE = 10;
