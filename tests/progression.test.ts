// Progression: ranks, unlocks, upgrades, rewards, the Arena Circuit and the saved profile.

import { describe, expect, it } from 'vitest';
import { ARENA_ORDER } from '../src/arenas/arenaData';
import { BLADE_ORDER, BLADES, MVP_BLADES } from '../src/blades/bladeData';
import { CIRCUIT, MAX_BLADE_LEVEL, MAX_RANK, RANK_REWARDS, RANK_WINS, coresFor, rankForWins, rankProgress, upgradeCost, variantUnlocked } from '../src/core/Progression';
import { PROFILE_KEY, Profile, type Store } from '../src/core/Profile';

const memory = (): Store & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
};
const career = (store = memory()): Profile => { const p = new Profile(store); p.setMode('career'); return p; };

describe('ranks and unlocks', () => {
  it('every blade and every arena unlocks at exactly one rank, and the starters are the MVP trio and Core Pit', () => {
    const all = RANK_REWARDS.flatMap((r) => [...r.blades]);
    expect(all.length).toBe(21);
    expect(new Set(all).size).toBe(21);
    expect([...all].sort()).toEqual([...BLADE_ORDER].sort());
    expect([...RANK_REWARDS[0].blades].sort()).toEqual([...MVP_BLADES].sort());
    expect(RANK_REWARDS.map((r) => r.arena)).toEqual(ARENA_ORDER);
    expect(RANK_REWARDS).toHaveLength(MAX_RANK);
  });

  it('every rank tier offers a choice of classes where it can (one of each class in the 3-blade tiers)', () => {
    for (const r of RANK_REWARDS.filter((x) => x.blades.length === 3)) {
      expect(new Set(r.blades.map((id) => BLADES[id].class)).size, r.blades.join()).toBe(3);
    }
  });

  it('rank follows wins and tops out', () => {
    expect(rankForWins(0)).toBe(1);
    expect(rankForWins(RANK_WINS[1] - 1)).toBe(1);
    expect(rankForWins(RANK_WINS[1])).toBe(2);
    expect(rankForWins(10_000)).toBe(MAX_RANK);
    expect(rankProgress(1)).toMatchObject({ rank: 1, into: 1, span: 2, next: 2 });
    expect(rankProgress(999).next).toBeNull();
  });

  it('level costs rise and the top level cannot be bought', () => {
    for (let l = 1; l < MAX_BLADE_LEVEL - 1; l++) expect(upgradeCost(l + 1)).toBeGreaterThan(upgradeCost(l));
    expect(upgradeCost(MAX_BLADE_LEVEL)).toBe(Infinity);
  });

  it('battles pay more for wins and for harder CPUs, and a loss still pays', () => {
    expect(coresFor('win', 'NORMAL')).toBeGreaterThan(coresFor('draw', 'NORMAL'));
    expect(coresFor('draw', 'NORMAL')).toBeGreaterThan(0);
    expect(coresFor('loss', 'NORMAL')).toBeGreaterThan(0);
    expect(coresFor('win', 'HARD')).toBeGreaterThan(coresFor('win', 'EASY'));
  });
});

describe('the Arena Circuit', () => {
  it('has one stage per arena, in arena order, against valid blades, getting harder', () => {
    expect(CIRCUIT.map((s) => s.arena)).toEqual(ARENA_ORDER);
    for (const s of CIRCUIT) { expect(BLADES[s.opponent], s.id).toBeTruthy(); expect(s.level).toBeGreaterThanOrEqual(1); expect(s.level).toBeLessThanOrEqual(MAX_BLADE_LEVEL); }
    for (let i = 1; i < CIRCUIT.length; i++) { expect(CIRCUIT[i].level).toBeGreaterThanOrEqual(CIRCUIT[i - 1].level); expect(CIRCUIT[i].reward).toBeGreaterThan(CIRCUIT[i - 1].reward); }
  });
});

describe('profile', () => {
  it('sandbox unlocks everything; career starts with the trio and Core Pit', () => {
    const p = new Profile(memory());
    expect(p.sandbox).toBe(true);
    for (const id of BLADE_ORDER) expect(p.isBladeUnlocked(id)).toBe(true);
    for (const id of ARENA_ORDER) expect(p.isArenaUnlocked(id)).toBe(true);
    p.setMode('career');
    expect(BLADE_ORDER.filter((id) => p.isBladeUnlocked(id)).sort()).toEqual([...MVP_BLADES].sort());
    expect(ARENA_ORDER.filter((id) => p.isArenaUnlocked(id))).toEqual(['core-pit']);
  });

  it('two wins reach rank 2 and report what unlocked', () => {
    const p = career();
    const a = p.recordBattle('win', 'NORMAL');
    expect(a.rankAfter).toBe(1); expect(a.newBlades).toEqual([]);
    const b = p.recordBattle('win', 'NORMAL');
    expect(b.rankBefore).toBe(1); expect(b.rankAfter).toBe(2);
    expect(b.newBlades.sort()).toEqual([...RANK_REWARDS[1].blades].sort());
    expect(b.newArena).toBe(RANK_REWARDS[1].arena);
    expect(p.isBladeUnlocked('blazefang')).toBe(true);
    expect(p.isArenaUnlocked('elevation-ring')).toBe(true);
    expect(p.isBladeUnlocked('titan-breaker')).toBe(false);
  });

  it('winning your way to the top unlocks every blade and arena exactly once', () => {
    const p = career();
    const blades: string[] = [], arenas: string[] = [];
    for (let i = 0; i < RANK_WINS[MAX_RANK - 1]; i++) {
      const r = p.recordBattle('win', 'EASY');
      blades.push(...r.newBlades);
      if (r.newArena) arenas.push(r.newArena);
    }
    expect(p.rank).toBe(MAX_RANK);
    expect([...blades, ...MVP_BLADES].sort()).toEqual([...BLADE_ORDER].sort());
    expect(arenas).toEqual(ARENA_ORDER.slice(1));
  });

  it('upgrades cost cores, one level at a time, and explain why not', () => {
    const p = career();
    expect(p.levelOf('ravok')).toBe(1);
    expect(p.upgrade('ravok')).toMatchObject({ ok: false });
    expect(p.upgrade('ravok').reason).toMatch(/more cores/);
    p.data.cores = upgradeCost(1) + upgradeCost(2);
    expect(p.upgrade('ravok')).toMatchObject({ ok: true, level: 2 });
    expect(p.upgrade('ravok')).toMatchObject({ ok: true, level: 3 });
    expect(p.cores).toBe(0);
    expect(p.upgrade('titan-breaker').reason).toMatch(/rank/i);
    p.data.cores = 99999; p.data.levels.ravok = MAX_BLADE_LEVEL;
    expect(p.upgrade('ravok').ok).toBe(false);
    expect(new Profile(memory()).upgrade('ravok').ok).toBe(false);     // sandbox: the dial is free
  });

  it('Circuit stages open one after another in Career, with a one-off first-clear bonus', () => {
    const p = career();
    expect(p.stageOpen(0)).toBe(true);
    expect(p.stageOpen(1)).toBe(false);                                  // stage 2 needs stage 1 and the arena
    const first = p.recordBattle('win', 'EASY', CIRCUIT[0].id);
    expect(first.stage).toEqual({ id: CIRCUIT[0].id, bonus: CIRCUIT[0].reward });
    expect(first.cores).toBe(coresFor('win', 'EASY') + CIRCUIT[0].reward);
    expect(p.stageCleared(CIRCUIT[0].id)).toBe(true);
    expect(p.stageOpen(1)).toBe(false);                                  // still needs rank 2
    p.recordBattle('win', 'EASY');
    expect(p.stageOpen(1)).toBe(true);
    expect(p.recordBattle('win', 'EASY', CIRCUIT[0].id).stage).toBeNull();   // no second bonus
    expect(p.recordBattle('loss', 'EASY', CIRCUIT[1].id).stage).toBeNull();  // losing clears nothing
    expect(new Profile(memory()).stageOpen(7)).toBe(true);               // sandbox: all open
  });

  it('saves and restores everything, and survives a corrupt or foreign save', () => {
    const store = memory();
    const p = career(store);
    p.recordBattle('win', 'HARD');
    p.setBuild('ravok', { ring: 'a', core: 'b', weight: 'c', tip: 'd' });
    p.setSuper('ravok', 'ravok.x');
    p.setVariant('ravok', 'elite');
    p.setSettings({ quality: 'low', reducedMotion: true });
    const q = new Profile(store);
    expect(q.mode).toBe('career');
    expect(q.cores).toBe(p.cores);
    expect(q.wins).toBe(1);
    expect(q.getBuild('ravok')?.tip).toBe('d');
    expect(q.getSuper('ravok')).toBe('ravok.x');
    expect(q.variantOf('ravok', 7)).toBe('elite');
    expect(q.variantOf('ravok', 3)).toBe('default');                     // a variant needs its level
    expect(q.settings).toMatchObject({ quality: 'low', reducedMotion: true, deadzone: 0.15 });
    store.map.set(PROFILE_KEY, '{not json');
    expect(new Profile(store).wins).toBe(0);
    store.map.set(PROFILE_KEY, JSON.stringify({ v: 99, wins: 5 }));
    expect(new Profile(store).wins).toBe(0);
    expect(new Profile(null).wins).toBe(0);                              // no storage at all: still plays
  });

  it('variants unlock by level', () => {
    expect(variantUnlocked('default', 1)).toBe(true);
    expect(variantUnlocked('alt', 3)).toBe(false);
    expect(variantUnlocked('alt', 4)).toBe(true);
    expect(variantUnlocked('elite', 6)).toBe(false);
    expect(variantUnlocked('elite', 7)).toBe(true);
  });
});
