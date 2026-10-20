import { beforeAll, describe, expect, it } from 'vitest';
import { buildBlade } from '../src/blades/BladeFactory';
import { BLADES, PLAYABLE_BLADES } from '../src/blades/bladeData';
import { getAbility } from '../src/blades/abilities';
import { getSuper } from '../src/blades/supers';
import { getArena } from '../src/arenas/arenaData';
import { Match } from '../src/combat/Match';
import { initPhysics } from '../src/core/Physics';
import { makeRng } from '../src/core/Rng';
import { applyEffect } from '../src/combat/EffectSystem';
import { hurt } from '../src/combat/SpinSystem';

const make = (a = 'ravok', b = 'gravion'): Match => {
  const m = new Match(getArena('core-pit'), [{ built: buildBlade(a, { level: 7 }), control: 'ai' }, { built: buildBlade(b, { level: 7 }), control: 'ai' }], makeRng(4));
  m.launch(0, 0, 0.1); m.launch(1, Math.PI, 0.1);
  for (let i = 0; i < 30; i++) m.step();
  return m;
};
const ctx = { charge: 1, strength: 1, source: 'super' as const };

describe('the full roster is real content, not skins', () => {
  it('every blade has three moves of its own, with the slots the controller expects', () => {
    for (const id of PLAYABLE_BLADES) {
      const b = BLADES[id];
      const moves = b.basicMoves.map(getAbility);
      expect(moves[0].charge, `${id} move 1 charges`).toBeTruthy();
      expect(moves[0].type).toBe('ATTACK');
      expect(['DEFENSE', 'MOVEMENT', 'CONTROL', 'BUFF'], `${id} move 2`).toContain(moves[1].type);
      expect(['MOVEMENT', 'BUFF', 'DEFENSE'], `${id} move 3`).toContain(moves[2].type);
      expect(moves.every((mv) => mv.id.startsWith(id + '.')), id).toBe(true);
    }
  });
  it('no two blades share a move, and two blades only share a Super timeline when the spec gives them the same Super', () => {
    const seen = new Map<string, string>();
    for (const id of PLAYABLE_BLADES) for (const mid of BLADES[id].basicMoves) { expect(seen.has(mid), mid).toBe(false); seen.set(mid, id); }
    const sig = new Map<string, string>();
    for (const id of PLAYABLE_BLADES) for (const sid of BLADES[id].superPool) {
      const s = getSuper(sid);
      const k = JSON.stringify([s.effects, s.duration]);
      const other = sig.get(k);
      if (other) expect(getSuper(other).name, `${sid} is a copy of ${other} under another name`).toBe(s.name);
      sig.set(k, sid);
    }
  });
  it('every Super has a real description and the spec names', () => {
    for (const id of PLAYABLE_BLADES) for (const sid of BLADES[id].superPool) expect(getSuper(sid).description.length, sid).toBeGreaterThan(25);
  });
});

describe('new effect primitives', () => {
  beforeAll(async () => { await initPhysics(); });
  it('stacking mods add up to the cap and refresh', () => {
    const m = make();
    const b = m.blades[0];
    const fx = { kind: 'mod' as const, duration: 3, mods: { dmgDealt: 1.1 }, tag: 'combo', stack: 3 };
    for (let i = 0; i < 5; i++) applyEffect(m, b, fx, ctx);
    expect(b.mods.filter((a) => a.tag === 'combo').length).toBe(1);
    expect(b.mod('dmgDealt')).toBeCloseTo(1.3, 5);   // capped at 3 stacks: 1 + 0.1 × 3
    m.dispose();
  });
  it('rewind puts the blade back where it was and returns some of the spin', () => {
    const m = make('chrono', 'ravok');
    const b = m.blades[0];
    for (let i = 0; i < 120; i++) m.step();            // let history build
    const then = b.history.find((h) => h.t >= m.t - 2.5)!;
    b.spin = Math.max(5, then.spin - 20);
    for (let i = 0; i < 240; i++) m.step();
    const before = b.spin;
    applyEffect(m, b, { kind: 'rewind', seconds: 2.5, spin: 0.7 }, ctx);
    expect(b.spin).toBeGreaterThan(before);
    expect(Math.hypot(b.x - then.x, b.z - then.z)).toBeLessThan(4.5);
    expect(b.hasFlag('invuln')).toBe(true);
    m.dispose();
  });
  it('absorb turns damage taken into spin', () => {
    const m = make();
    const a = m.blades[0], v = m.blades[1];
    v.mods.push({ id: 99, source: 'super', until: m.t + 5, mods: {}, flags: ['absorb'] });
    const before = v.spin;
    hurt(m, v, { amount: 10, attacker: a });
    const plain = make();
    const v2 = plain.blades[1];
    const b2 = v2.spin;
    hurt(plain, v2, { amount: 10, attacker: plain.blades[0] });
    expect(before - v.spin).toBeLessThan(b2 - v2.spin);
    m.dispose(); plain.dispose();
  });
  it('a repel zone pushes a blade away, an orbit zone swings it sideways, a slow zone brakes it', () => {
    const run = (zone: 'repel' | 'orbit' | 'slow'): { dr: number; dt: number; v: number } => {
      const m = make('ravok', 'phantom');
      const o = m.blades[0], t = m.blades[1];
      t.bb.body.setTranslation({ x: 3, y: t.bb.y, z: 0 }, true); t.bb.body.setLinvel({ x: 2, y: 0, z: 0 }, true);
      o.bb.body.setTranslation({ x: 0, y: o.bb.y, z: 0 }, true); o.bb.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      applyEffect(m, o, { kind: 'zone', zone, radius: 7, duration: 3, strength: 9, damage: 0, at: 'self' }, ctx);
      const r0 = Math.hypot(t.x - o.x, t.z - o.z);
      for (let i = 0; i < 90; i++) m.step();
      const out = { dr: Math.hypot(t.x - o.x, t.z - o.z) - r0, dt: Math.abs(t.z), v: Math.hypot(t.vx, t.vz) };
      m.dispose();
      return out;
    };
    expect(run('repel').dr).toBeGreaterThan(0.2);
    expect(run('orbit').dt).toBeGreaterThan(0.1);
    expect(run('slow').v).toBeLessThan(1.6);
  });
});
