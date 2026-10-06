// Central balance: the ONE place where 1–10 design ratings become physics. No blade gets bespoke
// gameplay code; if a blade feels wrong, change a rating or a curve here.
//
// World scale: the arena rim is RIM = 12 world units. Tunables were proven in the 2D prototype
// (v1-solo) at RIM = 100 and are carried over here scaled by L = 0.12.

import type { StatRatings } from './types';
import { clamp, lerp } from './types';

const L = 0.12;

/** Global, mutable on purpose: tools/balance.ts overrides these to sweep values. */
export const TUNING = {
  RIM: 12,
  DT: 1 / 120,
  // -- the pit
  BOWL: 13.6 * L,          // inward pull, grows linearly with distance from the centre
  LIP: 64 * L,             // extra inward pull that ramps up steeply at the rim…
  GRIP_MIN: 0.1,           // …scaled by spin: at zero spin the wall barely holds. Spin is armour.
  SWIRL: 28 * L,           // tangential push so blades orbit instead of grinding in the centre
  // -- collisions
  RESTITUTION: 0.69,
  FRICTION: 0.05,
  KB_EXP: 0.58,            // knockback scales with (attack ÷ defense)^KB_EXP
  DEF_EXP: 1.85,           // spin damage divides by defense^DEF_EXP
  SPIN_DMG: 0.058 / L,     // spin lost per unit of closing speed, × attack ÷ defense^DEF_EXP
  ATTACK_EDGE: 0.35,       // whoever was closing faster takes less spin damage and deals more
  HIT_MIN: 14 * L,         // closing speed below this is a touch, not a hit
  HIT_CAP: 17,             // max spin lost to a single hit
  CLASH_KICK: 19 * L,      // contact kicks blades apart (scaled by their spin)…
  CLASH_TAN: 0.27,         // …and partly sideways: spinning surfaces deflect instead of just bouncing
  DAMAGE_JITTER: 0.15,     // contact-angle variance
  // -- spin
  PACE: 0.247,             // multiplier on passive spin decay: sets how long a blade left alone keeps spinning (Phantom, Stamina 10 ≈ 3:00; see spinSeconds)
  SUPER_DECAY: 0.6,        // how much of a Super's decay change (×1.8 Rage Mode, ×0.5 Spin Burst…) is applied on the unscaled rate
  ECON: 1,                 // multiplier on spin gained/lost to hits, moves, Supers and drains: how fast hits decide a fight
  DECAY_BASE: 3.0,         // passive spin lost per second at Stamina 5 (before PACE)…
  DECAY_PER_STAMINA: 0.15, // …less this much per point of Stamina above 5: Stamina is how long you spin
  MOVE_COST: 0.005 / L,    // spin/s lost per unit of speed (floor friction)
  STEER_SMOOTH: 0.075,     // seconds for steering input to ease in/out: no step changes in the push on the blade
  STEER_COST: 0.36,        // spin/s lost at full steering — the price of agency
  WOBBLE_BELOW: 22,        // spin % under which a blade wobbles…
  WOBBLE_ACCEL: 34 * L,    // …and gets pushed around
  LOW_SPIN_FLOOR: 0.55,    // movement/impact multiplier reached at zero spin
  LOW_SPIN_VULN: 0.4,      // extra damage taken at zero spin
  // -- defense curve: defMul = DEF_BASE + DEF_PER × Defense (damage and knockback taken are divided by it)
  DEF_BASE: 0.4,
  DEF_PER: 0.12,
  // -- mass curve: weight and stability
  MASS_BASE: 0.55,
  MASS_PER_WEIGHT: 0.13,
  STAB_BASE: 0.6,
  STAB_PER: 0.12,
  // -- launch & match
  LAUNCH_MIN: 2.6,
  LAUNCH_MAX: 5.6,         // a full-power shot straight out must never ring itself out
  SPAWN_R: 50 * L,
  MAX_SPEED: 230 * L,
  TIMEOUT: 180,            // [PRD open item → proposed default] 3:00, then higher spin wins
  SIMUL_WINDOW: 0.1,       // after a ring-out, a second KO inside this window is a double KO
  DECAY_JITTER: 0.22,      // per-match variance in how long a blade spins (±22%): without it a small, steady edge wins every time
  // -- ability scale: dash speeds and radial impulses in the data are written in "design units"
  DASH_SCALE: 0.5,
  IMPULSE_SCALE: 0.5,
  // -- charge & moves (PRD DL-6: charging costs spin; the cooldown self-limits spam)
  CHARGE_DRAIN_SCALE: 1,
};

export interface CombatParams {
  radius: number;
  height: number;
  /** Base mass fed to Rapier (weight, scaled up by stability: stable blades are harder to push). */
  mass: number;
  /** Steering acceleration, world units/s². */
  accel: number;
  /** Lateral velocity damping while steering, 1/s: turning authority. */
  lateralGrip: number;
  linearDamping: number;
  restitution: number;
  friction: number;
  /** Passive spin lost per second. */
  spinDecay: number;
  /** Multiplier on spin damage dealt (attack + spin damage). */
  atkMul: number;
  /** Divisor on damage and knockback received (defense). */
  defMul: number;
  /** Knockback dealt multiplier (knockback rating). */
  kbDealt: number;
  /** Multiplier on spin lost to hits (spin retention). */
  spinLossTaken: number;
  /** Response to non-collision forces: pulls, zones, wall, swirl (stability). */
  external: number;
}

export function deriveCombat(s: StatRatings): CombatParams {
  const weight = s.weight;
  const agiT = Math.pow(clamp((s.agility - 1) / 9, 0, 1), 0.8);
  return {
    radius: 0.95 + 0.085 * weight,
    height: 0.34,
    mass: (TUNING.MASS_BASE + TUNING.MASS_PER_WEIGHT * weight) * (TUNING.STAB_BASE + TUNING.STAB_PER * s.stability),
    accel: lerp(2.2, 7.4, agiT) * (1.1 - 0.03 * weight),
    lateralGrip: 0.6 + 0.35 * s.agility,
    linearDamping: 1.2,
    restitution: TUNING.RESTITUTION,
    friction: TUNING.FRICTION,
    spinDecay: Math.max(0.9, TUNING.DECAY_BASE - TUNING.DECAY_PER_STAMINA * (s.stamina - 5)), // × TUNING.PACE in tickSpin
    atkMul: 0.3 + 0.13 * (0.6 * s.attack + 0.4 * s.spinDamage),
    defMul: TUNING.DEF_BASE + TUNING.DEF_PER * s.defense,
    kbDealt: 0.55 + 0.09 * s.knockback,
    spinLossTaken: 1.25 - 0.05 * s.spinRetention,
    external: clamp(1.2 - 0.1 * s.stability, 0.15, 1),
  };
}

/** Seconds a blade left alone (no hits, no moves, no steering) keeps spinning, from its Stamina rating. For the UI and the tests. */
export function spinSeconds(stamina: number): number {
  return 100 / (Math.max(0.9, TUNING.DECAY_BASE - TUNING.DECAY_PER_STAMINA * (stamina - 5)) * TUNING.PACE);
}

/** Low spin: weaker movement and impact, more vulnerable (spec §8). 1 at full spin → LOW_SPIN_FLOOR at 0. */
export function lowSpinFactor(spin: number): number {
  const t = clamp(spin / 35, 0, 1);
  return lerp(TUNING.LOW_SPIN_FLOOR, 1, t);
}

/** Wall grip scales with spin: high-spin blades ride the wall, low-spin blades slide off it. */
export function wallGrip(spin: number): number {
  return TUNING.GRIP_MIN + (1 - TUNING.GRIP_MIN) * Math.pow(clamp(spin / 100, 0, 1), 0.7);
}

/** Visual/physical spin rate (rad/s) from spin %, used for friction and for the renderer. */
export function spinOmega(spin: number): number {
  return lerp(1.5, 26, Math.pow(clamp(spin / 100, 0, 1), 0.7));
}
