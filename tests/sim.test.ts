// Simulation tests: the exact code the browser runs, headless. Slower than the data tests (real physics).

import { beforeAll, describe, expect, it } from 'vitest';
import { buildBlade, recommendedBuild } from '../src/blades/BladeFactory';
import { MVP_BLADES } from '../src/blades/bladeData';
import { SUPERS } from '../src/blades/supers';
import { SUPER_MAX_DURATION, SUPER_RECHARGE } from '../src/blades/effects';
import { TUNING } from '../src/core/Balance';
import { initPhysics } from '../src/core/Physics';
import { playMatch } from '../src/sim/headless';

beforeAll(async () => { await initPhysics(); });

describe('match rules', () => {
  it('is deterministic: the same seed gives the same match', async () => {
    const mk = () => [buildBlade('ravok', { level: 4 }), buildBlade('gravion', { level: 4 })];
    const a = await playMatch(mk(), { seed: 42 });
    const b = await playMatch(mk(), { seed: 42 });
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
  });

  it('every pairing of the MVP blades finishes with a coherent result', async () => {
    for (const x of MVP_BLADES) {
      for (const y of MVP_BLADES) {
        const { result, duration } = await playMatch([buildBlade(x, { level: 3 }), buildBlade(y, { level: 3 })], { seed: 7 });
        expect([-1, 0, 1]).toContain(result.winner);
        expect(duration).toBeLessThanOrEqual(TUNING.TIMEOUT + 1);
        if (result.doubleKO) expect(result.winner).toBe(-1);
        if (result.timeout) expect(duration).toBeGreaterThanOrEqual(TUNING.TIMEOUT - 0.5);
        if (result.winner >= 0 && !result.timeout) {
          const loser = 1 - result.winner;
          expect(['ring', 'spin']).toContain(result.causes[loser]);
        }
        expect(result.stats).toHaveLength(2);
      }
    }
  }, 60000);

  it('both win conditions occur', async () => {
    const causes = new Set<string>();
    // an Attack mirror produces both endings; a Defense mirror almost always ends on spin (see README balance notes)
    for (let seed = 1; seed <= 24 && causes.size < 2; seed++) {
      const { result } = await playMatch([buildBlade('ravok', { level: 3 }), buildBlade('ravok', { level: 3 })], { seed });
      if (result.winner >= 0 && !result.timeout) causes.add(result.causes[1 - result.winner] as string);
    }
    expect(causes.has('ring')).toBe(true);
    expect(causes.has('spin')).toBe(true);
  }, 60000);

  it('the class triangle shows up in aggregate (Attack > Stamina > Defense > Attack)', async () => {
    const wins = async (a: string, b: string): Promise<number> => {
      let w = 0, n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        // swap seats every other match so seat bias cannot hide in the average
        const swap = seed % 2 === 0;
        const bl = swap ? [buildBlade(b, { level: 3 }), buildBlade(a, { level: 3 })] : [buildBlade(a, { level: 3 }), buildBlade(b, { level: 3 })];
        const { result } = await playMatch(bl, { seed });
        const aSlot = swap ? 1 : 0;
        if (result.winner === aSlot) w++;
        if (result.winner >= 0) n++;
      }
      return w / Math.max(1, n);
    };
    // seeds are fixed, so this is deterministic; 40 battles per pair keeps it from hanging on one lucky seed
    expect(await wins('ravok', 'phantom')).toBeGreaterThan(0.6);   // Attack > Stamina
    expect(await wins('phantom', 'gravion')).toBeGreaterThan(0.6); // Stamina > Defense
    expect(await wins('gravion', 'ravok')).toBeGreaterThan(0.6);   // Defense > Attack
  }, 240000);
});

describe('Super cycle: READY → 6–8 s ACTIVE → 10 s RECHARGING → READY', () => {
  const live = Object.values(SUPERS).filter((s) => s.implemented);

  for (const def of live) {
    it(`${def.id} runs, ends on time and recharges`, async () => {
      const me = buildBlade(def.bladeId, { level: 7, build: recommendedBuild(def.bladeId, 7) });
      me.equippedSuper = def.id; // test the Super itself, whatever the stat gate says
      const foe = buildBlade(def.bladeId === 'gravion' ? 'ravok' : 'gravion', { level: 7 });
      let activeAt = -1, endAt = -1, readyAt = -1, prev = 'READY', done = false;
      const { match } = await playMatch([me, foe], {
        seed: 11, manual: [0, 1], maxSeconds: 40,
        onStep: (m) => {
          if (m.phase === 'ready') { m.launch(0, -Math.PI / 2, 0.15); m.launch(1, Math.PI / 2, 0.15); return; }
          const b = m.blades[0];
          if (m.phase === 'live' && b.superState === 'READY' && activeAt < 0 && m.t > 0.6) m.pushAction(0, { k: 'super' });
          if (b.superState !== prev) {
            if (b.superState === 'ACTIVE') activeAt = m.t;
            else if (b.superState === 'RECHARGING') endAt = m.t;
            else if (b.superState === 'READY' && endAt > 0) { readyAt = m.t; done = true; }
            prev = b.superState;
          }
          if (done && m.phase === 'live') m.pushAction(0, { k: 'up', i: 0 });
        },
      }).catch(() => ({ match: null }));
      void match;
      expect(activeAt, 'Super activated').toBeGreaterThan(0);
      // if the round ended mid-Super (a KO), the Super is cut short and that is fine — but it can never run long
      expect(endAt - activeAt).toBeLessThanOrEqual(SUPER_MAX_DURATION + 0.05);
      if (done) {
        expect(endAt - activeAt).toBeGreaterThanOrEqual(def.duration - 0.05);
        expect(readyAt - endAt).toBeGreaterThanOrEqual(SUPER_RECHARGE - 0.05);
        expect(readyAt - endAt).toBeLessThanOrEqual(SUPER_RECHARGE + 0.1);
      }
    }, 30000);
  }
});
