import { describe, expect, it } from 'vitest';
import { buildBlade } from '../src/blades/BladeFactory';
import type { MatchResult } from '../src/combat/events';
import { explainResult, matchupInfo, resultRows } from '../src/ui/text';

const stats = (o: Partial<MatchResult['stats'][0]> = {}) => ({ hits: 4, lostToHits: 30, lostToDecay: 50, lostToMoves: 20, damageDealt: 30, abilitiesUsed: 2, supersUsed: 1, ...o });
const res = (o: Partial<MatchResult>): MatchResult => ({
  winner: 0, doubleKO: false, timeout: false, causes: [null, 'ring'], spins: [60, 40], tieSpins: null, stats: [stats(), stats()], duration: 20, ...o,
});
const you = buildBlade('ravok', { level: 3 }), cpu = buildBlade('phantom', { level: 3 }), gv = buildBlade('gravion', { level: 3 });

describe('matchup copy follows the class triangle', () => {
  it('Attack beats Stamina, Stamina beats Defense, Defense beats Attack', () => {
    expect(matchupInfo('ATTACK', 'STAMINA').tag).toBe('adv');
    expect(matchupInfo('STAMINA', 'DEFENSE').tag).toBe('adv');
    expect(matchupInfo('DEFENSE', 'ATTACK').tag).toBe('adv');
    expect(matchupInfo('STAMINA', 'ATTACK').tag).toBe('dis');
    expect(matchupInfo('ATTACK', 'DEFENSE').tag).toBe('dis');
    expect(matchupInfo('DEFENSE', 'STAMINA').tag).toBe('dis');
    expect(matchupInfo('ATTACK', 'ATTACK').tag).toBe('even');
  });
});

describe('result explanations: a player can say why they won or lost', () => {
  it('ring-out win names the cause and the loser', () => {
    const t = explainResult(res({ winner: 0, causes: [null, 'ring'], spins: [70, 80] }), you, cpu);
    expect(t.title).toBe('Victory');
    expect(t.cause.label).toBe('Ring-out');
    expect(t.line).toMatch(/Phantom/);
    expect(t.why.join(' ')).toMatch(/whatever the spin/);
  });
  it('ring-out of a spent blade points at low grip', () => {
    const t = explainResult(res({ winner: 0, causes: [null, 'ring'], spins: [70, 12] }), you, cpu);
    expect(t.why.join(' ')).toMatch(/grip/);
  });
  it('spin-out loss breaks down where the spin went', () => {
    const t = explainResult(res({ winner: 1, causes: ['spin', null], spins: [0, 30] }), you, cpu);
    expect(t.title).toBe('Defeat');
    expect(t.cause.label).toBe('Spin-out');
    expect(t.why[0]).toMatch(/to natural decay/);
  });
  it('time-out gives both spins and the rule', () => {
    const t = explainResult(res({ winner: 0, timeout: true, causes: [null, null], spins: [44, 31] }), you, cpu);
    expect(t.cause.label).toBe('Time-out');
    expect(t.why[0]).toMatch(/44%.*31%/);
  });
  it('double KO is a draw with its own cause', () => {
    const t = explainResult(res({ winner: -1, doubleKO: true, causes: ['ring', 'ring'] }), you, cpu);
    expect(t.title).toBe('Draw');
    expect(t.cause.label).toBe('Double KO');
  });
  it('mentions the triangle when it applies, and calls out upsets', () => {
    const adv = explainResult(res({ winner: 0, causes: [null, 'spin'] }), you, cpu);
    expect(adv.why.join(' ')).toMatch(/Attack beats Stamina/);
    const upset = explainResult(res({ winner: 0, causes: [null, 'spin'] }), you, gv);
    expect(upset.why.join(' ')).toMatch(/upset/i);
  });
  it('result rows cover both blades', () => {
    const rows = resultRows(res({}));
    expect(rows.map((r) => r.label)).toContain('Final spin');
    expect(rows.every((r) => r.you !== undefined && r.cpu !== undefined)).toBe(true);
  });
});
