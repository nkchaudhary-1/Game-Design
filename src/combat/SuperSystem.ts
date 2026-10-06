// SuperSystem: the Super cycle, independent of any blade.
//
//   READY → ACTIVATE → 6–8 s ACTIVE → 10 s RECHARGING → READY
//
// A Super is a timeline of reusable effects (start / every N s / on hit / end). Anything it creates is
// capped to the Super's own duration, so nothing can outlast the 8-second limit.

import { SUPER_MAX_DURATION, type TimedEffect } from '../blades/effects';
import { getSuper } from '../blades/supers';
import type { BladeRuntime } from '../blades/Blade';
import { applyEffect, type EffectCtx } from './EffectSystem';
import type { Match } from './Match';

function ctxFor(m: Match, b: BladeRuntime, id: string, strength: number, duration: number): EffectCtx {
  return { charge: 1, strength, source: 'super', superId: id, capUntil: m.t + Math.max(0, duration - b.superElapsed) };
}

export function canActivateSuper(m: Match, b: BladeRuntime): boolean {
  if (!b.superId || b.superState !== 'READY') return false;
  if (m.phase !== 'live' || !b.launched || !b.alive || b.slam) return false;
  return getSuper(b.superId).implemented;
}

export function activateSuper(m: Match, b: BladeRuntime): boolean {
  if (!canActivateSuper(m, b)) return false;
  const def = getSuper(b.superId!);
  const duration = Math.min(def.duration, SUPER_MAX_DURATION);
  b.superState = 'ACTIVE';
  b.superElapsed = 0;
  b.superT = duration;
  b.superEveryNext = def.effects.map((e) => (e.at === 'every' ? e.interval ?? 1 : Infinity));
  b.superHitCd = def.effects.map(() => 0);
  b.stats.supersUsed++;
  m.emit({ type: 'super', slot: b.slot, superId: def.id, state: 'activate' });
  const strength = def.strength * b.built.levelBoost;
  for (const e of def.effects) if (e.at === 'start') applyEffect(m, b, e.effect, ctxFor(m, b, def.id, strength, duration));
  return true;
}

function endSuper(m: Match, b: BladeRuntime): void {
  const def = getSuper(b.superId!);
  const strength = def.strength * b.built.levelBoost;
  for (const e of def.effects) if (e.at === 'end') applyEffect(m, b, e.effect, ctxFor(m, b, def.id, strength, def.duration));
  b.mods = b.mods.filter((a) => a.superId !== def.id);
  if (b.shield) b.shield = null;
  b.superState = 'RECHARGING';
  b.superT = def.recharge;
  b.superElapsed = 0;
  m.emit({ type: 'super', slot: b.slot, superId: def.id, state: 'end' });
}

export function updateSuper(m: Match, b: BladeRuntime, dt: number): void {
  if (!b.superId) return;
  const def = getSuper(b.superId);
  const duration = Math.min(def.duration, SUPER_MAX_DURATION);

  if (b.superState === 'ACTIVE') {
    if (!b.alive) { endSuper(m, b); return; }
    b.superElapsed += dt;
    b.superT = Math.max(0, duration - b.superElapsed);
    const strength = def.strength * b.built.levelBoost;
    def.effects.forEach((te: TimedEffect, i: number) => {
      if (te.at === 'every' && b.superElapsed >= b.superEveryNext[i]) {
        b.superEveryNext[i] += te.interval ?? 1;
        applyEffect(m, b, te.effect, ctxFor(m, b, def.id, strength, duration));
      }
    });
    if (b.superElapsed >= duration) endSuper(m, b);
  } else if (b.superState === 'RECHARGING') {
    b.superT -= dt;
    if (b.superT <= 0) {
      b.superState = 'READY';
      b.superT = 0;
      m.emit({ type: 'super', slot: b.slot, superId: def.id, state: 'ready' });
    }
  }
}

/** A hit landed: `attacker` dealt it, `victim` took it. Runs 'onHit' / 'onHurt' Super effects. */
export function onSuperHit(m: Match, attacker: BladeRuntime, victim: BladeRuntime): void {
  for (const [b, kind] of [[attacker, 'onHit'], [victim, 'onHurt']] as const) {
    if (b.superState !== 'ACTIVE' || !b.superId) continue;
    const def = getSuper(b.superId);
    const duration = Math.min(def.duration, SUPER_MAX_DURATION);
    const strength = def.strength * b.built.levelBoost;
    def.effects.forEach((te, i) => {
      if (te.at !== kind || b.superHitCd[i] > m.t) return;
      b.superHitCd[i] = m.t + (te.interval ?? 0);
      applyEffect(m, b, te.effect, ctxFor(m, b, def.id, strength, duration));
    });
  }
}
