import { beforeAll, describe, expect, it } from 'vitest';
import { buildBlade } from '../src/blades/BladeFactory';
import { TUNING } from '../src/core/Balance';
import { initPhysics } from '../src/core/Physics';
import { makeRng } from '../src/core/Rng';
import { Match } from '../src/combat/Match';
import { getArena } from '../src/arenas/arenaData';
import { MAX_TURN_PER_FRAME, frameTurn } from '../src/vfx/motion';

describe('rotation never strobes', () => {
  it('turns less than half a fin spacing per frame at any speed or frame rate', () => {
    for (const sym of [4, 6, 8, 10, 12]) {
      const spacing = (2 * Math.PI) / sym;
      for (const omega of [1, 6, 13, 26, 60]) {
        for (const fps of [20, 30, 60, 144, 240]) {
          const turn = frameTurn(omega, 1 / fps, sym);
          expect(turn).toBeLessThanOrEqual(MAX_TURN_PER_FRAME * spacing + 1e-9);
          expect(turn).toBeLessThan(0.5 * spacing);
        }
      }
    }
  });
  it('keeps the true speed whenever it is already safe', () => {
    expect(frameTurn(6, 1 / 60, 10)).toBeCloseTo(0.1, 5);
  });
});

describe('steering eases in and out', () => {
  beforeAll(async () => { await initPhysics(); });
  const make = (): Match => {
    const m = new Match(getArena('core-pit'), [{ built: buildBlade('ravok', { level: 3 }), control: 'human' }, { built: buildBlade('phantom', { level: 3 }), control: 'ai' }], makeRng(5));
    m.launch(0, -Math.PI / 2, 0.5); m.launch(1, Math.PI / 2, 0.5);
    return m;
  };
  it('ramps the applied steering instead of stepping', () => {
    const m = make();
    m.setSteer(0, 1, 0);
    m.step();
    const first = m.blades[0].smX;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);
    for (let i = 0; i < Math.round(0.5 / TUNING.DT); i++) m.step();
    expect(m.blades[0].smX).toBeGreaterThan(0.95);
    m.setSteer(0, 0, 0);
    m.step();
    expect(m.blades[0].smX).toBeGreaterThan(0.8); // released: it eases out, it does not snap to zero
    for (let i = 0; i < Math.round(0.5 / TUNING.DT); i++) m.step();
    expect(m.blades[0].smX).toBeLessThan(0.05);
    m.dispose();
  });
});
