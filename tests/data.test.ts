import { describe, expect, it } from 'vitest';
import { BLADE_ORDER, BLADES, MVP_BLADES, bladesByClass } from '../src/blades/bladeData';
import { getAbility } from '../src/blades/abilities';
import { SUPERS } from '../src/blades/supers';
import { SUPER_MAX_DURATION, SUPER_MIN_DURATION, SUPER_RECHARGE } from '../src/blades/effects';
import { NEUTRAL_BUILD, PARTS, partsForSlot } from '../src/blades/parts';
import { ARENAS, ARENA_ORDER } from '../src/arenas/arenaData';
import { CLASS_BEATS, PART_SLOTS, STAT_KEYS } from '../src/core/types';

describe('roster (build spec §5)', () => {
  it('has 21 blades, 7 per class, with unique ids', () => {
    expect(BLADE_ORDER).toHaveLength(21);
    expect(new Set(BLADE_ORDER).size).toBe(21);
    for (const c of ['ATTACK', 'DEFENSE', 'STAMINA'] as const) expect(bladesByClass(c)).toHaveLength(7);
  });

  it('every blade has nine 1–10 ratings, three basic moves, a Super pool and a visual profile', () => {
    for (const id of BLADE_ORDER) {
      const b = BLADES[id];
      for (const k of STAT_KEYS) {
        expect(b.stats[k], `${id}.${k}`).toBeGreaterThanOrEqual(1);
        expect(b.stats[k], `${id}.${k}`).toBeLessThanOrEqual(10);
      }
      expect(b.basicMoves).toHaveLength(3);
      b.basicMoves.forEach((m) => expect(() => getAbility(m), `${id} move ${m}`).not.toThrow());
      expect(b.superPool.length, id).toBeGreaterThanOrEqual(5);
      expect(b.visualProfile.count).toBeGreaterThanOrEqual(3);
    }
  });

  it('class identity shows up in the ratings: Attack hits hardest, Defense holds, Stamina outlasts', () => {
    const avg = (c: 'ATTACK' | 'DEFENSE' | 'STAMINA', k: (typeof STAT_KEYS)[number]) =>
      bladesByClass(c).reduce((s, b) => s + b.stats[k], 0) / 7;
    expect(avg('ATTACK', 'attack')).toBeGreaterThan(avg('DEFENSE', 'attack'));
    expect(avg('ATTACK', 'attack')).toBeGreaterThan(avg('STAMINA', 'attack'));
    expect(avg('DEFENSE', 'defense')).toBeGreaterThan(avg('ATTACK', 'defense'));
    expect(avg('DEFENSE', 'defense')).toBeGreaterThan(avg('STAMINA', 'defense'));
    expect(avg('STAMINA', 'stamina')).toBeGreaterThan(avg('ATTACK', 'stamina'));
    expect(avg('STAMINA', 'stamina')).toBeGreaterThan(avg('DEFENSE', 'stamina'));
  });

  it('the MVP set is Ravok, Gravion and Phantom', () => {
    expect([...MVP_BLADES].sort()).toEqual(['gravion', 'phantom', 'ravok']);
  });

  it('the class triangle is a closed loop: Attack > Stamina > Defense > Attack', () => {
    expect(CLASS_BEATS.ATTACK).toBe('STAMINA');
    expect(CLASS_BEATS.STAMINA).toBe('DEFENSE');
    expect(CLASS_BEATS.DEFENSE).toBe('ATTACK');
  });
});

describe('Supers (build spec §10)', () => {
  const all = Object.values(SUPERS);
  const live = all.filter((s) => s.implemented);

  it('ships Supers for the three MVP blades', () => {
    for (const id of MVP_BLADES) expect(live.filter((s) => s.bladeId === id).length, id).toBeGreaterThanOrEqual(7);
  });

  it('every Super lasts 6–8 s (never over 8) and recharges for 10 s', () => {
    for (const s of live) {
      expect(s.duration, s.id).toBeGreaterThanOrEqual(SUPER_MIN_DURATION);
      expect(s.duration, s.id).toBeLessThanOrEqual(SUPER_MAX_DURATION);
      expect(s.recharge, s.id).toBe(SUPER_RECHARGE);
    }
    for (const s of all) expect(s.duration, s.id).toBeLessThanOrEqual(SUPER_MAX_DURATION);
  });

  it('timed effects never schedule past the Super\'s own duration', () => {
    for (const s of live) {
      for (const e of s.effects) {
        const eff = e.effect as { duration?: number };
        if (e.at === 'start' && typeof eff.duration === 'number') expect(eff.duration, s.id).toBeLessThanOrEqual(SUPER_MAX_DURATION);
      }
    }
  });

  it('unlock levels run 1–7 and each blade has an ultimate', () => {
    for (const s of all) { expect(s.unlockLevel).toBeGreaterThanOrEqual(1); expect(s.unlockLevel).toBeLessThanOrEqual(7); }
    for (const id of MVP_BLADES) expect(live.some((s) => s.bladeId === id && s.ultimate), id).toBe(true);
  });
});

describe('parts (build spec §12)', () => {
  it('every slot has a stock part with no trade-offs', () => {
    for (const slot of PART_SLOTS) {
      const stock = PARTS[NEUTRAL_BUILD[slot]];
      expect(stock).toBeDefined();
      expect(Object.values(stock.mods).every((v) => !v)).toBe(true);
    }
  });

  it('there are no universally superior parts: every non-stock part gives something up', () => {
    for (const p of Object.values(PARTS)) {
      if ((Object.values(NEUTRAL_BUILD) as string[]).includes(p.id)) continue;
      const deltas = STAT_KEYS.map((k) => p.mods[k] ?? 0);
      expect(deltas.some((d) => d > 0), `${p.id} gives nothing`).toBe(true);
      expect(deltas.some((d) => d < 0), `${p.id} has no drawback`).toBe(true);
    }
  });

  it('every class can use at least two options in every slot', () => {
    for (const slot of PART_SLOTS) {
      for (const c of ['ATTACK', 'DEFENSE', 'STAMINA'] as const) {
        expect(partsForSlot(slot).filter((p) => p.classes.includes(c)).length, `${slot}/${c}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('recommended builds only name real, class-compatible parts', () => {
    for (const id of BLADE_ORDER) {
      const b = BLADES[id];
      for (const [slot, pid] of Object.entries(b.customizationProfile.recommended)) {
        const p = PARTS[pid as string];
        expect(p, `${id} ${slot} ${pid}`).toBeDefined();
        expect(p.slot).toBe(slot);
        expect(p.classes, `${id} ${pid}`).toContain(b.class);
      }
    }
  });
});

describe('arenas (build spec §11)', () => {
  it('has the eight arenas, with Core Pit playable', () => {
    expect(ARENA_ORDER).toHaveLength(8);
    expect(ARENAS['core-pit'].implemented).toBe(true);
    expect(ARENA_ORDER.filter((id) => ARENAS[id].implemented)).toEqual(['core-pit']);
    for (const id of ARENA_ORDER) {
      const a = ARENAS[id];
      expect(a.mechanic.length).toBeGreaterThan(10);
      expect(a.exploit.length).toBeGreaterThan(5);
      expect(a.counter.length).toBeGreaterThan(5);
    }
  });
});
