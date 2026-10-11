import { describe, expect, it } from 'vitest';
import {
  assignRoles,
  checkWin,
  discussionTimerMs,
  nightTimerMs,
  resolveNight,
  resolveTraitorTarget,
  roleCounts,
  seededRng,
  tallyVotes,
  type NightActions,
} from '../src/engine.js';
import type { Role } from '../src/types.js';
import { cleanName, isValidRoomCode, makeRoomCode, uniqueName } from '../src/names.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('roleCounts', () => {
  it.each([
    [5, false, { traitor: 1, doctor: 1, police: 0, bodyguard: 0, innocent: 3 }],
    [6, false, { traitor: 1, doctor: 1, police: 0, bodyguard: 0, innocent: 4 }],
    [7, false, { traitor: 2, doctor: 1, police: 1, bodyguard: 0, innocent: 3 }],
    [7, true, { traitor: 2, doctor: 1, police: 1, bodyguard: 1, innocent: 2 }],
    [9, false, { traitor: 2, doctor: 1, police: 1, bodyguard: 0, innocent: 5 }],
    [9, true, { traitor: 2, doctor: 1, police: 1, bodyguard: 1, innocent: 4 }],
    [10, false, { traitor: 3, doctor: 1, police: 1, bodyguard: 0, innocent: 5 }],
    [10, true, { traitor: 3, doctor: 1, police: 1, bodyguard: 1, innocent: 4 }],
    [11, true, { traitor: 3, doctor: 1, police: 1, bodyguard: 1, innocent: 5 }],
  ])('%i players, bodyguard=%s', (n, bg, expected) => {
    const c = roleCounts(n, bg);
    expect(c).toEqual(expected);
    expect(c.traitor + c.doctor + c.police + c.bodyguard + c.innocent).toBe(n);
  });

  it('never assigns a Bodyguard below 7 even when enabled', () => {
    expect(roleCounts(5, true).bodyguard).toBe(0);
    expect(roleCounts(6, true).bodyguard).toBe(0);
    for (let seed = 0; seed < 50; seed++) {
      const roles = assignRoles(ids(6), true, seededRng(seed));
      expect(Object.values(roles)).not.toContain('bodyguard');
    }
  });

  it('rejects out-of-range counts', () => {
    expect(() => roleCounts(4, false)).toThrow();
    expect(() => roleCounts(12, false)).toThrow();
  });
});

describe('assignRoles', () => {
  it('assigns exactly the right counts, deterministically with a seeded rng', () => {
    const a = assignRoles(ids(9), true, seededRng(42));
    const b = assignRoles(ids(9), true, seededRng(42));
    expect(a).toEqual(b);
    const tally: Record<string, number> = {};
    for (const r of Object.values(a)) tally[r] = (tally[r] ?? 0) + 1;
    expect(tally).toEqual({ traitor: 2, doctor: 1, police: 1, bodyguard: 1, innocent: 4 });
  });

  it('varies with the rng', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 20; s++) seen.add(JSON.stringify(assignRoles(ids(7), false, seededRng(s))));
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('timers', () => {
  it('night timers scale with player count', () => {
    expect(nightTimerMs(5)).toBe(30_000);
    expect(nightTimerMs(6)).toBe(30_000);
    expect(nightTimerMs(7)).toBe(45_000);
    expect(nightTimerMs(9)).toBe(45_000);
    expect(nightTimerMs(10)).toBe(60_000);
    expect(nightTimerMs(11)).toBe(60_000);
  });
  it('discussion timers scale with player count or use the custom override', () => {
    expect(discussionTimerMs(5, null)).toBe(3 * 60_000);
    expect(discussionTimerMs(9, null)).toBe(5 * 60_000);
    expect(discussionTimerMs(11, null)).toBe(7 * 60_000);
    expect(discussionTimerMs(11, 2)).toBe(2 * 60_000);
    expect(discussionTimerMs(5, 0)).toBe(3 * 60_000);
  });
});

describe('resolveTraitorTarget', () => {
  const legal = ['a', 'b', 'c', 'd'];
  it('picks the target with the most traitor votes', () => {
    const t = resolveTraitorTarget(
      [
        { traitorId: 't1', targetId: 'a', submittedAt: 1 },
        { traitorId: 't2', targetId: 'b', submittedAt: 2 },
        { traitorId: 't3', targetId: 'b', submittedAt: 3 },
      ],
      legal,
      seededRng(1),
    );
    expect(t).toBe('b');
  });
  it('breaks ties by earliest submission among the tied targets', () => {
    const t = resolveTraitorTarget(
      [
        { traitorId: 't1', targetId: 'c', submittedAt: 5 },
        { traitorId: 't2', targetId: 'a', submittedAt: 2 },
      ],
      legal,
      seededRng(1),
    );
    expect(t).toBe('a');
  });
  it('falls back to a random legal target when nobody picked', () => {
    for (let s = 0; s < 20; s++) {
      const t = resolveTraitorTarget([{ traitorId: 't1', targetId: null, submittedAt: 1 }], legal, seededRng(s));
      expect(legal).toContain(t);
    }
    expect(resolveTraitorTarget([], legal, seededRng(3))).not.toBeNull();
  });
  it('ignores illegal picks (a traitor) and returns null with no legal targets', () => {
    expect(resolveTraitorTarget([{ traitorId: 't1', targetId: 't2', submittedAt: 1 }], ['x'], seededRng(1))).toBe('x');
    expect(resolveTraitorTarget([], [], seededRng(1))).toBeNull();
  });
});

describe('resolveNight', () => {
  const roles: Record<string, Role> = { t: 'traitor', d: 'doctor', b: 'bodyguard', p: 'police', i1: 'innocent', i2: 'innocent' };
  const base: NightActions = {
    traitorTarget: 'i1',
    doctorProtect: null,
    bodyguardId: 'b',
    bodyguardGuard: null,
    policeId: 'p',
    policeInvestigate: null,
  };

  it('kills the target when nobody intervenes', () => {
    expect(resolveNight(base, roles)).toMatchObject({ killedId: 'i1', reason: 'killed' });
  });
  it('Doctor save beats Bodyguard on the same target: nobody dies', () => {
    const out = resolveNight({ ...base, doctorProtect: 'i1', bodyguardGuard: 'i1' }, roles);
    expect(out.killedId).toBeNull();
    expect(out.reason).toBe('doctorSaved');
  });
  it('Bodyguard dies instead of the guarded target', () => {
    const out = resolveNight({ ...base, bodyguardGuard: 'i1' }, roles);
    expect(out).toMatchObject({ killedId: 'b', reason: 'bodyguardDied' });
  });
  it('Bodyguard guarding themselves while targeted simply dies', () => {
    const out = resolveNight({ ...base, traitorTarget: 'b', bodyguardGuard: 'b' }, roles);
    expect(out).toMatchObject({ killedId: 'b', reason: 'killed' });
  });
  it('Doctor protecting themselves while targeted survives', () => {
    const out = resolveNight({ ...base, traitorTarget: 'd', doctorProtect: 'd' }, roles);
    expect(out.killedId).toBeNull();
  });
  it('no target means nobody dies', () => {
    expect(resolveNight({ ...base, traitorTarget: null }, roles)).toMatchObject({ killedId: null, reason: 'noTarget' });
  });
  it('Police learns the truth privately', () => {
    expect(resolveNight({ ...base, policeInvestigate: 't' }, roles).policeResult).toEqual({ targetId: 't', isTraitor: true });
    expect(resolveNight({ ...base, policeInvestigate: 'd' }, roles).policeResult).toEqual({ targetId: 'd', isTraitor: false });
    expect(resolveNight({ ...base, policeId: null }, roles).policeResult).toBeNull();
  });
});

describe('tallyVotes', () => {
  it('plurality eliminates', () => {
    const t = tallyVotes({ a: 'c', b: 'c', c: 'a', d: 'b' });
    expect(t.eliminatedId).toBe('c');
    expect(t.cast).toBe(4);
    expect(t.counts).toEqual({ c: 2, a: 1, b: 1 });
    expect(t.tied).toBe(false);
  });
  it('a tie eliminates no one', () => {
    const t = tallyVotes({ a: 'b', b: 'a', c: 'd' });
    expect(t.eliminatedId).toBeNull();
    expect(t.tied).toBe(true);
  });
  it('no votes eliminates no one', () => {
    const t = tallyVotes({});
    expect(t.eliminatedId).toBeNull();
    expect(t.cast).toBe(0);
    expect(t.tied).toBe(false);
  });
  it('abstentions do not count', () => {
    const t = tallyVotes({ a: 'b', b: '', c: 'b' });
    expect(t.cast).toBe(2);
    expect(t.eliminatedId).toBe('b');
  });
});

describe('checkWin', () => {
  const roles: Record<string, Role> = { t1: 'traitor', t2: 'traitor', d: 'doctor', i1: 'innocent', i2: 'innocent', i3: 'innocent' };
  it('nobody wins while traitors are outnumbered', () => {
    expect(checkWin(roles, ['t1', 't2', 'd', 'i1', 'i2'])).toBeNull();
    expect(checkWin(roles, ['t1', 'd', 'i1'])).toBeNull();
  });
  it('Traitors win at parity: 2 traitors vs 2 others', () => {
    expect(checkWin(roles, ['t1', 't2', 'd', 'i1'])).toBe('traitors');
  });
  it('Traitors win when 1 traitor vs 1 other', () => {
    expect(checkWin(roles, ['t1', 'i1'])).toBe('traitors');
  });
  it('Traitors win when they outnumber', () => {
    expect(checkWin(roles, ['t1', 't2', 'd'])).toBe('traitors');
  });
  it('Town wins when zero traitors remain', () => {
    expect(checkWin(roles, ['d', 'i1'])).toBe('town');
    expect(checkWin(roles, new Set(['i3']))).toBe('town');
  });
  it('Town wins if everyone else is dead too (no traitors alive)', () => {
    expect(checkWin(roles, [])).toBe('town');
  });
});

describe('names and codes', () => {
  it('cleans names', () => {
    expect(cleanName('  Sly   Doyle\n ')).toBe('Sly Doyle');
    expect(cleanName('x'.repeat(50)).length).toBe(20);
    expect(cleanName('a\u0007b')).toBe('ab');
  });
  it('de-duplicates names case-insensitively', () => {
    expect(uniqueName('Sly', ['sly'])).toBe('Sly 2');
    expect(uniqueName('Sly', ['Sly', 'Sly 2'])).toBe('Sly 3');
    expect(uniqueName('Sly', [])).toBe('Sly');
  });
  it('room codes use the restricted alphabet', () => {
    for (let s = 0; s < 50; s++) {
      const code = makeRoomCode(seededRng(s));
      expect(isValidRoomCode(code)).toBe(true);
      expect(code).not.toMatch(/[IO01]/);
    }
    expect(isValidRoomCode('ABCDE')).toBe(false);
    expect(isValidRoomCode('ABCDE0')).toBe(false);
  });
});
