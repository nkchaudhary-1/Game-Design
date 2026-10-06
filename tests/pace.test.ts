import { describe, expect, it } from 'vitest';
import { TUNING, deriveCombat, spinSeconds } from '../src/core/Balance';
import { buildBlade } from '../src/blades/BladeFactory';

describe('match pace: spin lasts up to three minutes', () => {
  it('a Stamina-10 blade left alone spins for about 3:00 and the clock stops the match there', () => {
    expect(spinSeconds(10)).toBeGreaterThan(170);
    expect(spinSeconds(10)).toBeLessThan(190);
    expect(TUNING.TIMEOUT).toBe(180);
  });
  it('every blade lasts at least two minutes left alone, and more Stamina always lasts longer', () => {
    for (const s of [1, 3, 5, 7, 9]) expect(spinSeconds(s)).toBeGreaterThan(100);
    for (const id of ['ravok', 'gravion']) expect(spinSeconds(buildBlade(id, { level: 3 }).stats.stamina)).toBeGreaterThan(120);
    for (let s = 2; s <= 10; s++) expect(spinSeconds(s)).toBeGreaterThan(spinSeconds(s - 1));
  });
  it('spinSeconds agrees with the decay the simulation actually applies', () => {
    const st = buildBlade('phantom', { level: 3 }).stats;
    expect(100 / (deriveCombat(st).spinDecay * TUNING.PACE)).toBeCloseTo(spinSeconds(st.stamina), 5);
  });
});
