import { beforeAll, describe, expect, it } from 'vitest';
import { buildBlade } from '../src/blades/BladeFactory';
import { getArena } from '../src/arenas/arenaData';
import { Match } from '../src/combat/Match';
import { initPhysics } from '../src/core/Physics';
import { makeRng } from '../src/core/Rng';
import { contactState } from '../src/vfx/contact';
import { heatColor } from '../src/vfx/ImpactFX';
import { hopHeight, impact, newDyn, precessionRate, stepDyn, WOBBLE_START, wobbleAmount, wobbleTilt } from '../src/vfx/bladeDynamics';

describe('a top wobbles as it runs down', () => {
  it('stands upright while it spins fast and leans more and more as the spin dies', () => {
    expect(wobbleAmount(100)).toBe(0);
    expect(wobbleAmount(WOBBLE_START)).toBe(0);
    expect(wobbleAmount(0)).toBeCloseTo(1, 5);
    for (let s = 1; s <= WOBBLE_START; s++) expect(wobbleAmount(s - 1)).toBeGreaterThanOrEqual(wobbleAmount(s));
    expect(wobbleTilt(5)).toBeGreaterThan(wobbleTilt(30));
  });
  it('precesses faster as the spin falls, like a real gyroscope', () => {
    expect(precessionRate(10)).toBeGreaterThan(precessionRate(30));
    expect(precessionRate(30)).toBeGreaterThan(precessionRate(90));
  });
});

describe('impact response', () => {
  it('a hit kicks the model up, tilts it back towards the attacker, and it settles', () => {
    const d = newDyn();
    impact(d, 1, 0, 1);                           // pushed along +x
    let peak = 0, tiltedBack = false;
    for (let i = 0; i < 12; i++) { stepDyn(d, 1 / 60); peak = Math.max(peak, d.hop); if (d.tx < -0.01) tiltedBack = true; }
    expect(peak).toBeGreaterThan(0.05);
    expect(tiltedBack).toBe(true);
    for (let i = 0; i < 90; i++) stepDyn(d, 1 / 60);
    expect(d.hop).toBe(0);
    expect(Math.abs(d.tx)).toBeLessThan(0.02);
    expect(Math.abs(d.vtx)).toBeLessThan(0.1);
  });
  it('the hop never goes higher than physics allows for the kick it was given', () => {
    const d = newDyn();
    impact(d, 0, 1, 1);
    const v0 = d.vhop;
    let peak = 0;
    for (let i = 0; i < 120; i++) { stepDyn(d, 1 / 240); peak = Math.max(peak, d.hop); }
    expect(peak).toBeLessThan(hopHeight(v0) * 1.05);
  });
  it('a stronger hit hops higher', () => {
    const run = (s: number): number => { const d = newDyn(); impact(d, 1, 0, s); let p = 0; for (let i = 0; i < 120; i++) { stepDyn(d, 1 / 120); p = Math.max(p, d.hop); } return p; };
    expect(run(1)).toBeGreaterThan(run(0.2));
  });
});

describe('sparks cool as they fly', () => {
  it('white-hot when new, orange in the middle, dull red at the end', () => {
    const a = { r: 0, g: 0, b: 0 }, m = { r: 0, g: 0, b: 0 }, z = { r: 0, g: 0, b: 0 };
    heatColor(1, a); heatColor(0.4, m); heatColor(0, z);
    expect(a.b).toBeGreaterThan(0.7);                 // white-hot has blue in it
    expect(m.r).toBeGreaterThan(m.g); expect(m.g).toBeGreaterThan(m.b); // orange
    expect(z.r).toBeLessThan(m.r); expect(z.g).toBeLessThan(0.05);      // dark red
  });
});

describe('contact detection', () => {
  beforeAll(async () => { await initPhysics(); });
  const live = (): Match => {
    const m = new Match(getArena('core-pit'), [{ built: buildBlade('ravok', { level: 3 }), control: 'ai' }, { built: buildBlade('gravion', { level: 3 }), control: 'ai' }], makeRng(2));
    m.launch(0, 0, 0.1); m.launch(1, Math.PI, 0.1);
    m.step();
    return m;
  };
  const place = (m: Match, slot: number, x: number, z: number, vx = 0, vz = 0): void => {
    const b = m.blades[slot];
    b.bb.body.setTranslation({ x, y: b.bb.body.translation().y, z }, true);
    b.bb.body.setLinvel({ x: vx, y: 0, z: vz }, true);
  };
  it('blades that touch grind; blades that are apart do not', () => {
    const m = live();
    const r = m.blades[0].radius + m.blades[1].radius;
    place(m, 0, 0, 0); place(m, 1, r + 0.02, 0, -3, 0);
    expect(contactState(m).pairs.length).toBe(1);
    expect(contactState(m).level).toBeGreaterThan(0.2);
    place(m, 1, r + 3, 0);
    expect(contactState(m).pairs.length).toBe(0);
    m.dispose();
  });
  it('a fast blade on the lip grinds the wall, a slow one in the middle does not', () => {
    const m = live();
    const R = m.arena.radius;
    place(m, 0, R * 0.95, 0, 0, 8); place(m, 1, -4, 0, 0, 0);
    expect(contactState(m).walls.length).toBe(1);
    place(m, 0, 1, 1, 0, 8);
    expect(contactState(m).walls.length).toBe(0);
    m.dispose();
  });
  it('pans towards the side where the rubbing is', () => {
    const m = live();
    const R = m.arena.radius;
    place(m, 0, -R * 0.95, 0, 0, 8); place(m, 1, 4, 0, 0, 0);
    expect(contactState(m).pan).toBeLessThan(-0.3);
    m.dispose();
  });
  it('reports nothing before the round is live', () => {
    const m = new Match(getArena('core-pit'), [{ built: buildBlade('ravok', { level: 3 }), control: 'ai' }, { built: buildBlade('gravion', { level: 3 }), control: 'ai' }], makeRng(2));
    expect(contactState(m).level).toBe(0);
    m.dispose();
  });
});
