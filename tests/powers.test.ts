// Powers: every move and Super has plain-language text that matches the data, taps on charge moves fire, status chips
// name what is on a blade, and the practice dummy really stands still.

import { beforeAll, describe, expect, it } from 'vitest';
import { AIController } from '../src/ai/AIController';
import { getArena } from '../src/arenas/arenaData';
import { BLADES, PLAYABLE_BLADES } from '../src/blades/bladeData';
import { buildBlade } from '../src/blades/BladeFactory';
import { getAbility } from '../src/blades/abilities';
import { chipFor, cpuVoice, describeEffects, moveInfo, superInfo } from '../src/blades/powerText';
import { getSuper } from '../src/blades/supers';
import type { ControllerMsg } from '../src/core/InputBus';
import { Match } from '../src/combat/Match';
import { TUNING } from '../src/core/Balance';
import { initPhysics } from '../src/core/Physics';
import { makeRng } from '../src/core/Rng';

beforeAll(async () => { await initPhysics(); });

describe('power text', () => {
  it('every move and every Super of every blade explains itself, with no placeholder text', () => {
    for (const id of PLAYABLE_BLADES) {
      const b = buildBlade(id, { level: 7 });
      b.moves.forEach((m, i) => {
        const p = moveInfo(m, i + 1);
        expect(p.lines.length, `${id} move ${i + 1}`).toBeGreaterThan(0);
        for (const l of p.lines) expect(l, `${id} ${m.name}`).not.toMatch(/undefined|NaN|\[object|Infinity/);
        expect(p.how).toContain(String(i + 1));
      });
      for (const sid of BLADES[id].superPool) {
        const p = superInfo(getSuper(sid), b.levelBoost);
        expect(p.lines.length, sid).toBeGreaterThan(0);
        for (const l of p.lines) expect(l, sid).not.toMatch(/undefined|NaN|\[object|Infinity/);
      }
    }
  });

  it('says what the numbers really are', () => {
    // Ravok's Guard: 0.55 damage taken and 0.55 knockback taken for 1.1 s
    const guard = moveInfo(getAbility('ravok.guard'), 2).lines.join(' ');
    expect(guard).toMatch(/45% less damage/);
    expect(guard).toMatch(/1\.1 s/);
    // a Super's numbers include its strength and the blade's level
    const d = getSuper('ravok.dash-strike');
    const lv1 = superInfo(d, 1).lines.join(' '), lv7 = superInfo(d, 1.24).lines.join(' ');
    expect(lv1).not.toBe(lv7);
    // the timeline: what happens when, not just what
    expect(superInfo(d, 1).lines.some((l) => /^Every [\d.]+ s/.test(l))).toBe(true);
    expect(describeEffects([{ kind: 'dash', dir: 'target', speed: 9 }])[0]).toMatch(/straight at the opponent/);
    expect(describeEffects([{ kind: 'shield', hits: 2, duration: 5 }])[0]).toMatch(/next 2 hits/);
  });

  it('reads from the CPU’s side for the CPU’s powers', () => {
    const v = cpuVoice('Aegiron');
    // the same data, two points of view: nothing in the CPU's text may tell you "you take less damage"
    for (const id of PLAYABLE_BLADES) {
      const b = buildBlade(id, { level: 7 });
      const cpuText = b.moves.map((m, i) => moveInfo(m, i + 1, v).lines.join(' ')).join(' ');
      const youText = b.moves.map((m, i) => moveInfo(m, i + 1).lines.join(' ')).join(' ');
      // self-targeted lines flip, so the two perspectives differ whenever a move buffs its owner
      if (/\bYou (take|gain|get|move|become)\b/.test(youText)) expect(cpuText).not.toBe(youText);
    }
    const guard = moveInfo(getAbility('ravok.guard'), 2, cpuVoice('Ravok')).lines.join(' ');
    expect(guard).toMatch(/Ravok takes 45% less damage/);
    expect(guard).not.toMatch(/\bYou take\b/);
  });
});

describe('status chips', () => {
  const mod = (mods: Record<string, number>, flags: string[] = []) => ({ id: 1, source: 'ability' as const, until: 5, mods, flags } as unknown as Parameters<typeof chipFor>[0]);
  it('names what is on a blade, good and bad', () => {
    expect(chipFor(mod({ dmgTaken: 0.55, kbTaken: 0.55 }), 4)).toMatchObject({ label: 'Armor', good: true });
    expect(chipFor(mod({}, ['invuln']), 4)).toMatchObject({ label: 'Invulnerable', good: true });
    expect(chipFor(mod({ accel: 0.04, drag: 7 }), 4)).toMatchObject({ label: 'Frozen', good: false });
    expect(chipFor(mod({ accel: 0.5 }), 4)).toMatchObject({ label: 'Slowed', good: false });
    expect(chipFor(mod({ dmgDealt: 1.3 }), 4)).toMatchObject({ label: 'Power up', good: true });
    expect(chipFor(mod({ dmgTaken: 1.3 }), 4)).toMatchObject({ label: 'Vulnerable', good: false });
    expect(chipFor(mod({}), 4)).toBeNull();
    expect(chipFor(mod({ dmgTaken: 0.5 }), 6)?.remaining).toBe(0);
  });
});

describe('taps and practice', () => {
  const duel = (): Match => {
    const m = new Match(getArena('core-pit'), [{ built: buildBlade('ravok', { level: 3 }), control: 'human' }, { built: buildBlade('gravion', { level: 3 }), control: 'ai' }], makeRng(3));
    m.launch(0, 0, 0.1); m.launch(1, Math.PI, 0.1);
    for (let i = 0; i < 20; i++) m.step();
    return m;
  };

  it('a quick tap on a charge move fires it, weakly, instead of doing nothing', () => {
    const m = duel();
    const me = m.blades[0];
    expect(me.built.moves[0].charge).toBeTruthy();
    m.pushAction(0, { k: 'down', i: 0 });
    m.pushAction(0, { k: 'up', i: 0 });
    m.step();
    expect(me.stats.abilitiesUsed).toBe(1);
    expect(me.cooldown[0]).toBeGreaterThan(0);
    const events = m.takeEvents().filter((e) => e.type === 'ability');
    expect(events).toHaveLength(1);
    // and a full charge hits harder than the tap
    const full = duel();
    full.pushAction(0, { k: 'down', i: 0 });
    for (let i = 0; i < 160; i++) full.step();
    full.pushAction(0, { k: 'up', i: 0 });
    const v0 = full.blades[0].speed;
    full.step();
    const tapped = duel(); tapped.pushAction(0, { k: 'down', i: 0 }); tapped.pushAction(0, { k: 'up', i: 0 });
    const t0 = tapped.blades[0].speed;
    tapped.step();
    expect(full.blades[0].speed - v0).toBeGreaterThan(tapped.blades[0].speed - t0);
    for (const x of [m, full, tapped]) x.dispose();
  });

  it('the practice dummy stands still and uses nothing', () => {
    const m = duel();
    const sent: ControllerMsg[] = [];
    const ai = new AIController(1, 'HARD', (msg) => sent.push(msg), makeRng(5));
    ai.idle = true;
    for (let i = 0; i < 10 / TUNING.DT; i++) { ai.update(m, TUNING.DT); m.step(); }
    expect(sent.length).toBeGreaterThan(0);
    for (const msg of sent) {
      expect(msg.t).toBe('steer');
      if (msg.t === 'steer') { expect(msg.x).toBe(0); expect(msg.z).toBe(0); }
    }
    expect(m.blades[1].stats.abilitiesUsed + m.blades[1].stats.supersUsed).toBe(0);
    m.dispose();
  });
});
