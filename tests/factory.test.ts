import { describe, expect, it } from 'vitest';
import { applyParts, availableParts, buildBlade, defaultBuild, partLockReason, recommendedBuild, sanitizeBuild, superStatus } from '../src/blades/BladeFactory';
import { BLADES } from '../src/blades/bladeData';
import { getPart } from '../src/blades/parts';
import { getSuper } from '../src/blades/supers';
import { STAT_KEYS } from '../src/core/types';

describe('building a blade', () => {
  it('stock build equals the design ratings', () => {
    const b = buildBlade('ravok', { level: 1 });
    expect(b.stats).toEqual(BLADES.ravok.stats);
    expect(b.deltas).toEqual({});
    expect(b.description.summary).toMatch(/Stock build/);
  });

  it('parts change the ratings and the description', () => {
    const b = buildBlade('ravok', { level: 3, build: { weight: 'weight.heavy' } });
    expect(b.stats.weight).toBeGreaterThan(BLADES.ravok.stats.weight - 1);
    expect(b.deltas.weight).toBeGreaterThan(0);
    expect(b.description.summary).toMatch(/Heavy Weight/);
    expect(b.description.changes.join(' ')).toMatch(/Weight/);
  });

  it('ratings stay inside 1–10 whatever is fitted', () => {
    for (const id of Object.keys(BLADES)) {
      const b = buildBlade(id, { level: 7, build: recommendedBuild(id, 7) });
      for (const k of STAT_KEYS) { expect(b.stats[k]).toBeGreaterThanOrEqual(1); expect(b.stats[k]).toBeLessThanOrEqual(10); }
    }
  });

  it('parts feed the physics: heavier weight means a heavier body', () => {
    const stock = buildBlade('ravok', { level: 4 });
    const heavy = buildBlade('ravok', { level: 4, build: { weight: 'weight.heavy' } });
    expect(heavy.combat.mass).toBeGreaterThan(stock.combat.mass);
  });
});

describe('locks and compatibility', () => {
  it('locked or incompatible parts fall back to stock', () => {
    const s = sanitizeBuild('ravok', { weight: 'weight.maximum', core: 'core.max-stamina' }, 1);
    expect(s).toEqual(defaultBuild());
  });
  it('reports why a part is unavailable', () => {
    expect(partLockReason('ravok', getPart('weight.maximum'), 1)).toMatch(/Level 4/);
    expect(partLockReason('gravion', getPart('tip.aggressive'), 7)).toMatch(/blades only/i);
    expect(partLockReason('ravok', getPart('weight.heavy'), 7)).toBeNull();
  });
  it('more parts unlock as level rises', () => {
    const l1 = availableParts('ravok', 'weight', 1).length, l7 = availableParts('ravok', 'weight', 7).length;
    expect(l7).toBeGreaterThan(l1);
  });
  it('lowering the level cannot leave locked parts equipped', () => {
    const b = buildBlade('ravok', { level: 1, build: { weight: 'weight.maximum' } });
    expect(b.build.weight).toBe('weight.balanced');
  });
});

describe('Super availability', () => {
  it('Supers unlock by level', () => {
    expect(buildBlade('ravok', { level: 1 }).supers.filter((s) => s.unlocked).map((s) => s.def.id)).toEqual(['ravok.dash-strike']);
    expect(buildBlade('ravok', { level: 7 }).supers.some((s) => s.def.id === 'ravok.meteor-crash')).toBe(true);
  });
  it('stat requirements gate Supers, and parts can open (or close) them', () => {
    const def = getSuper('ravok.rage-mode'); // requires Attack 8+
    const stats = { ...BLADES.ravok.stats };
    expect(superStatus(def, stats, 7).unlocked).toBe(true);
    expect(superStatus(def, { ...stats, attack: 6 }, 7)).toMatchObject({ unlocked: false, reason: expect.stringMatching(/Attack 8\+/) });
    expect(superStatus(def, stats, 1).reason).toMatch(/Level 4/);
  });
  it('unimplemented Supers are listed but locked as coming soon', () => {
    const b = buildBlade('blazefang', { level: 7 });
    expect(b.supers.length).toBeGreaterThan(0);
    expect(b.supers.every((s) => !s.unlocked && /soon/i.test(s.reason ?? ''))).toBe(true);
    expect(b.equippedSuper).toBeNull();
  });
  it('the equipped Super falls back when it becomes locked', () => {
    const b = buildBlade('ravok', { level: 1, equippedSuper: 'ravok.meteor-crash' });
    expect(b.equippedSuper).toBe('ravok.dash-strike');
  });
  it('parts report landed deltas after clamping', () => {
    const { stats, deltas } = applyParts({ ...BLADES.ravok.stats, weight: 9 }, { ...defaultBuild(), weight: 'weight.heavy' });
    expect(stats.weight).toBe(10);
    expect(deltas.weight).toBe(1);
  });
});
