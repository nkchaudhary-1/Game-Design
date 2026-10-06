// AbilitySystem: turns controller input into basic moves. One system for every blade.
//
//  - tap  → instant move (cooldown applies)
//  - hold → chargeable move charges, draining spin (PRD DL-6), release fires it scaled by charge
// Charging drains a little spin and the cooldown self-limits spam, so aggression has a real price.

import { TUNING } from '../core/Balance';
import type { BladeRuntime } from '../blades/Blade';
import { applyEffect } from './EffectSystem';
import { activateSuper } from './SuperSystem';
import { spendSpin } from './SpinSystem';
import type { Match } from './Match';

export function fireAbility(m: Match, b: BladeRuntime, index: 0 | 1 | 2, charge: number): void {
  const ab = b.built.moves[index];
  b.cooldown[index] = ab.cooldown;
  b.cooldownMax[index] = ab.cooldown;
  spendSpin(b, ab.staminaCost);
  b.stats.abilitiesUsed++;
  m.emit({ type: 'ability', slot: b.slot, index, id: ab.id, charge });
  for (const e of ab.effects) applyEffect(m, b, e, { charge, strength: 1, source: 'ability' });
}

function cancelCharge(m: Match, b: BladeRuntime): void {
  if (b.charge.index >= 0) m.emit({ type: 'charge', slot: b.slot, index: b.charge.index, state: 'cancel' });
  b.charge = { index: -1, t: 0, maxed: false };
}

export function updateAbilities(m: Match, b: BladeRuntime, dt: number): void {
  for (let i = 0; i < 3; i++) if (b.cooldown[i] > 0) b.cooldown[i] = Math.max(0, b.cooldown[i] - dt);

  const canAct = m.phase === 'live' && b.launched && b.alive && !b.slam;
  if (!canAct) {
    b.queue.length = 0;
    if (b.charge.index >= 0) cancelCharge(m, b);
    return;
  }

  while (b.queue.length) {
    const a = b.queue.shift()!;
    if (a.k === 'super') { activateSuper(m, b); continue; }
    const i = a.i;
    const ab = b.built.moves[i];
    if (a.k === 'down') {
      if (b.cooldown[i] > 0) continue;
      if (ab.charge) {
        if (b.charge.index < 0) {
          b.charge = { index: i, t: 0, maxed: false };
          m.emit({ type: 'charge', slot: b.slot, index: i, state: 'start' });
        }
      } else fireAbility(m, b, i, 1);
    } else if (b.charge.index === i) {
      const ch = ab.charge!;
      const frac = b.charge.t / ch.maxTime;
      b.charge = { index: -1, t: 0, maxed: false };
      if (frac >= ch.minCharge) fireAbility(m, b, i, frac);
      else m.emit({ type: 'charge', slot: b.slot, index: i, state: 'cancel' });
    }
  }

  if (b.charge.index >= 0) {
    const ab = b.built.moves[b.charge.index];
    const ch = ab.charge!;
    b.charge.t = Math.min(ch.maxTime, b.charge.t + dt);
    spendSpin(b, ch.drainPerSec * TUNING.CHARGE_DRAIN_SCALE * dt);
    if (!b.charge.maxed && b.charge.t >= ch.maxTime) {
      b.charge.maxed = true;
      m.emit({ type: 'charge', slot: b.slot, index: b.charge.index, state: 'max' });
    }
  }
}
