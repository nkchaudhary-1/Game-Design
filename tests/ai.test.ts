import { beforeAll, describe, expect, it } from 'vitest';
import { AI_PARAMS, matchup } from '../src/ai/AIStates';
import { buildBlade } from '../src/blades/BladeFactory';
import { initPhysics } from '../src/core/Physics';
import { playMatch } from '../src/sim/headless';

beforeAll(async () => { await initPhysics(); });

describe('CPU opponent', () => {
  it('Easy reacts slower and aims worse than Hard', () => {
    expect(AI_PARAMS.EASY.period).toBeGreaterThan(AI_PARAMS.NORMAL.period);
    expect(AI_PARAMS.NORMAL.period).toBeGreaterThan(AI_PARAMS.HARD.period);
    expect(AI_PARAMS.EASY.noise).toBeGreaterThan(AI_PARAMS.HARD.noise);
    expect(AI_PARAMS.EASY.skill).toBeLessThan(AI_PARAMS.HARD.skill);
  });

  it('knows the class triangle', () => {
    expect(matchup('ATTACK', 'STAMINA')).toBe('ADVANTAGE');
    expect(matchup('STAMINA', 'ATTACK')).toBe('DISADVANTAGE');
    expect(matchup('DEFENSE', 'DEFENSE')).toBe('EVEN');
  });

  it('Hard beats Easy in a Stamina mirror (seats swapped)', async () => {
    let hardWins = 0, decisive = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const hardSeat = seed % 2;
      const diff: ['EASY' | 'HARD', 'EASY' | 'HARD'] = hardSeat === 0 ? ['HARD', 'EASY'] : ['EASY', 'HARD'];
      const { result } = await playMatch([buildBlade('phantom', { level: 3 }), buildBlade('phantom', { level: 3 })], { seed, difficulty: diff });
      if (result.winner >= 0) { decisive++; if (result.winner === hardSeat) hardWins++; }
    }
    // measured ≈ 80% over 60 matches; a mirror is used because class matchups would drown out the skill signal, and
    // Stamina because Attack mirrors are decided by the first clash within ~10 s, before skill can show
    expect(hardWins / decisive).toBeGreaterThan(0.62);
  }, 90000);
});
