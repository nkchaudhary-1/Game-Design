// Spin: the blade's health, stamina and armour in one number (0–100).
// It decays continuously, is spent by moves, lost to hits, and gained by some Supers.

import { TUNING, lowSpinFactor } from '../core/Balance';
import type { BladeRuntime } from '../blades/Blade';
import type { Match } from './Match';

/** Passive loss for one fixed step: decay + floor friction + the price of steering. */
export function tickSpin(m: Match, b: BladeRuntime, dt: number): void {
  if (!b.launched || b.out === 'ring' || b.spin <= 0) return;
  const c = b.built.combat;
  // Passive decay runs at the slow match pace. A Super that speeds decay up (Rage Mode) or slows it down changes it by a
  // fixed share of the *unscaled* rate, so its price stays real instead of shrinking with the pace.
  const base = c.spinDecay * b.decayMul;
  const decay = Math.max(0, base * TUNING.PACE + base * (b.mod('spinDecay') - 1) * TUNING.SUPER_DECAY);
  const moves = TUNING.MOVE_COST * b.speed + TUNING.STEER_COST * b.steerMag;
  const total = (decay + moves) * dt;
  b.spin -= total;
  b.stats.lostToDecay += decay * dt;
  b.stats.lostToMoves += moves * dt;
  if (!b.lowSpinWarned && b.spin > 0 && b.spin < TUNING.WOBBLE_BELOW) {
    b.lowSpinWarned = true;
    m.emit({ type: 'spinLow', slot: b.slot });
  }
}

/** Spend spin on a move. Never lethal: a blade can't spin itself out with a button. */
export function spendSpin(b: BladeRuntime, raw: number): void {
  const amount = raw * TUNING.ECON;
  b.spin = Math.max(Math.min(b.spin, 2), b.spin - amount);
  b.stats.lostToMoves += amount;
}

export function gainSpin(b: BladeRuntime, amount: number): number {
  const before = b.spin;
  b.spin = Math.min(100, b.spin + amount);
  if (b.spin > TUNING.WOBBLE_BELOW) b.lowSpinWarned = false;
  return b.spin - before;
}

export interface HurtOptions {
  /** Raw spin damage before the victim's own modifiers. */
  amount: number;
  attacker: BladeRuntime | null;
  /** Skip the victim's defense (zones/drain use their own numbers). */
  ignoreShield?: boolean;
  /** Prevent reflected damage from reflecting forever. */
  reflected?: boolean;
}

/** Apply spin damage to `victim` with every modifier. Returns the spin actually lost. */
export function hurt(m: Match, victim: BladeRuntime, o: HurtOptions): number {
  if (!victim.alive || victim.fallen || o.amount <= 0) return 0;
  if (victim.hasFlag('invuln')) return 0;
  if (victim.shield && !o.ignoreShield && victim.shield.hits > 0) {
    victim.shield.hits -= 1;
    m.emit({ type: 'fx', kind: victim.shield.hits > 0 ? 'shieldHit' : 'shieldBreak', slot: victim.slot, x: victim.x, z: victim.z });
    if (victim.shield.hits <= 0) victim.shield = null;
    return 0;
  }
  const c = victim.built.combat;
  const vuln = 1 + TUNING.LOW_SPIN_VULN * (1 - lowSpinFactor(victim.spin));
  let dmg = o.amount * TUNING.ECON * victim.mod('dmgTaken') * c.spinLossTaken * vuln;
  dmg = Math.min(dmg, 40);
  const lost = Math.min(dmg, Math.max(0, victim.spin));
  victim.spin -= dmg;
  victim.stats.lostToHits += lost;
  victim.lastHurtAt = m.t;
  if (o.attacker) o.attacker.stats.damageDealt += lost;
  if (!victim.lowSpinWarned && victim.spin > 0 && victim.spin < TUNING.WOBBLE_BELOW) {
    victim.lowSpinWarned = true;
    m.emit({ type: 'spinLow', slot: victim.slot });
  }
  if (!o.reflected && o.attacker && victim.hasFlag('reflectDamage')) {
    hurt(m, o.attacker, { amount: o.amount * 0.8, attacker: victim, reflected: true });
  }
  return lost;
}
