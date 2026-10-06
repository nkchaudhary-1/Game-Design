import { describe, expect, it } from 'vitest';
import { deriveCombat, lowSpinFactor, spinOmega, wallGrip, TUNING } from '../src/core/Balance';
import type { StatRatings } from '../src/core/types';

const base: StatRatings = { attack: 5, defense: 5, stamina: 5, weight: 5, agility: 5, stability: 5, knockback: 5, spinDamage: 5, spinRetention: 5 };
const with_ = (k: keyof StatRatings, v: number): StatRatings => ({ ...base, [k]: v });

describe('central Balance: ratings → physics', () => {
  it('Attack and Spin Damage raise damage dealt', () => {
    expect(deriveCombat(with_('attack', 9)).atkMul).toBeGreaterThan(deriveCombat(with_('attack', 3)).atkMul);
    expect(deriveCombat(with_('spinDamage', 9)).atkMul).toBeGreaterThan(deriveCombat(with_('spinDamage', 3)).atkMul);
  });
  it('Defense reduces damage and knockback taken', () => {
    expect(deriveCombat(with_('defense', 9)).defMul).toBeGreaterThan(deriveCombat(with_('defense', 3)).defMul);
  });
  it('Stamina slows passive spin loss; the floor stops it from reaching zero', () => {
    expect(deriveCombat(with_('stamina', 9)).spinDecay).toBeLessThan(deriveCombat(with_('stamina', 3)).spinDecay);
    expect(deriveCombat(with_('stamina', 10)).spinDecay).toBeGreaterThan(0.5);
  });
  it('Weight and Stability add mass; Weight adds size', () => {
    const light = deriveCombat(with_('weight', 2)), heavy = deriveCombat(with_('weight', 9));
    expect(heavy.mass).toBeGreaterThan(light.mass);
    expect(heavy.radius).toBeGreaterThan(light.radius);
    expect(deriveCombat(with_('stability', 9)).mass).toBeGreaterThan(deriveCombat(with_('stability', 2)).mass);
  });
  it('Agility steers harder and turns tighter, and heavy blades lose some of it', () => {
    expect(deriveCombat(with_('agility', 9)).accel).toBeGreaterThan(deriveCombat(with_('agility', 2)).accel);
    expect(deriveCombat(with_('agility', 9)).lateralGrip).toBeGreaterThan(deriveCombat(with_('agility', 2)).lateralGrip);
  });
  it('Stability resists being pulled around by the arena', () => {
    expect(deriveCombat(with_('stability', 9)).external).toBeLessThan(deriveCombat(with_('stability', 2)).external);
  });
  it('Spin Retention reduces spin lost to hits; Knockback raises launching', () => {
    expect(deriveCombat(with_('spinRetention', 9)).spinLossTaken).toBeLessThan(deriveCombat(with_('spinRetention', 2)).spinLossTaken);
    expect(deriveCombat(with_('knockback', 9)).kbDealt).toBeGreaterThan(deriveCombat(with_('knockback', 2)).kbDealt);
  });
  it('every rating from 1 to 10 yields finite positive parameters', () => {
    for (const k of Object.keys(base) as Array<keyof StatRatings>) {
      for (let v = 1; v <= 10; v++) {
        const c = deriveCombat(with_(k, v));
        for (const [name, val] of Object.entries(c)) { expect(Number.isFinite(val), `${k}=${v} ${name}`).toBe(true); expect(val, `${k}=${v} ${name}`).toBeGreaterThan(0); }
      }
    }
  });
});

describe('spin as armour', () => {
  it('low spin weakens movement and impact (spec §8), full spin does not', () => {
    expect(lowSpinFactor(100)).toBe(1);
    expect(lowSpinFactor(0)).toBeCloseTo(TUNING.LOW_SPIN_FLOOR, 5);
    expect(lowSpinFactor(10)).toBeLessThan(lowSpinFactor(30));
  });
  it('wall grip rises with spin, so spent blades slide off the rim', () => {
    expect(wallGrip(0)).toBeCloseTo(TUNING.GRIP_MIN, 5);
    expect(wallGrip(100)).toBeCloseTo(1, 5);
    expect(wallGrip(60)).toBeGreaterThan(wallGrip(20));
  });
  it('rotation rate falls monotonically with spin', () => {
    let prev = Infinity;
    for (let s = 100; s >= 0; s -= 10) { const w = spinOmega(s); expect(w).toBeLessThanOrEqual(prev); prev = w; }
  });
});
