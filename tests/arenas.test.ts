// Arena mechanics: each of the eight arenas has its one mechanic, and every mechanic does what its card says.

import { beforeAll, describe, expect, it } from 'vitest';
import { ARENA_ORDER, ARENAS, getArena } from '../src/arenas/arenaData';
import { CrystalHazard, ElevationHazard, GravityHazard, LavaHazard, MagnetHazard, ShiftHazard, WindHazard } from '../src/arenas/hazards';
import { buildBlade } from '../src/blades/BladeFactory';
import { Match } from '../src/combat/Match';
import { TUNING } from '../src/core/Balance';
import { initPhysics } from '../src/core/Physics';
import { makeRng } from '../src/core/Rng';
import { playMatch } from '../src/sim/headless';

beforeAll(async () => { await initPhysics(); });

/** A live match with two parked blades (no steering): enough to watch a hazard act. */
function park(arenaId: string, seed = 5, ids: [string, string] = ['gravion', 'gravion']): Match {
  const m = new Match(getArena(arenaId), ids.map((id) => ({ built: buildBlade(id, { level: 3 }), control: 'human' as const })), makeRng(seed));
  m.launch(0, 0, 0); m.launch(1, 0, 0);
  return m;
}
const place = (m: Match, slot: number, x: number, z: number): void => {
  m.blades[slot].bb.body.setTranslation({ x, y: m.blades[slot].bb.body.translation().y, z }, true);
  m.blades[slot].bb.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
};
const run = (m: Match, seconds: number, each?: () => void): void => { for (let i = 0; i < seconds / TUNING.DT; i++) { each?.(); m.step(); } };
const hz = <T>(m: Match, id: string): T => m.arena.hazards.find((h) => h.id === id) as unknown as T;

describe('arena data', () => {
  it('all eight arenas are playable and only Core Pit is hazard-free', () => {
    expect(ARENA_ORDER).toHaveLength(8);
    for (const id of ARENA_ORDER) {
      expect(ARENAS[id].implemented, id).toBe(true);
      const m = park(id);
      expect(m.arena.hazards.length, id).toBe(id === 'core-pit' ? 0 : 1);
      m.dispose();
    }
  });

  it('every arena plays a full AI match to a coherent result', async () => {
    for (const id of ARENA_ORDER) {
      const { result, duration } = await playMatch([buildBlade('ravok', { level: 3 }), buildBlade('phantom', { level: 3 })], { seed: 11, arenaId: id });
      expect([-1, 0, 1], id).toContain(result.winner);
      expect(duration, id).toBeLessThanOrEqual(TUNING.TIMEOUT + 1);
      for (const s of result.spins) expect(Number.isFinite(s), id).toBe(true);
    }
  }, 120000);

  it('is deterministic in a hazard arena', async () => {
    const mk = () => [buildBlade('blazefang', { level: 4 }), buildBlade('aegiron', { level: 4 })];
    const a = await playMatch(mk(), { seed: 99, arenaId: 'lava-ring' });
    const b = await playMatch(mk(), { seed: 99, arenaId: 'lava-ring' });
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
  }, 60000);
});

describe('Elevation Ring', () => {
  const e = new ElevationHazard();
  it('has a low centre, raised platforms on the diagonals and ramps between them', () => {
    expect(e.heightAt(0, 0)).toBe(0);
    expect(e.heightAt(0, 6)).toBe(0);                                  // the spawn points are on low ground
    const p = e.heightAt(Math.cos(Math.PI / 4) * 9, Math.sin(Math.PI / 4) * 9);
    expect(p).toBeGreaterThan(0.9);
    expect(p).toBeLessThanOrEqual(ElevationHazard.H);
    expect(e.heightAt(0, 9)).toBeLessThan(0.05);                       // the valley between platforms is a ramp lane
    const mid = e.heightAt(Math.cos(Math.PI / 4) * 6.1, Math.sin(Math.PI / 4) * 6.1);
    expect(mid).toBeGreaterThan(0.05); expect(mid).toBeLessThan(p);    // the slope up
  });

  it('slows a blade climbing a platform and speeds it going down; a drop at speed earns a hit bonus', () => {
    const m = park('elevation-ring');
    const a = Math.PI / 4;
    place(m, 0, Math.cos(a) * 8.6, Math.sin(a) * 8.6);                 // on top
    place(m, 1, -8, 0);
    m.blades[0].bb.body.setLinvel({ x: -Math.cos(a) * 6, y: 0, z: -Math.sin(a) * 6 }, true);   // rolling off towards the centre
    run(m, 1.2);
    expect(m.blades[0].mods.some((x) => x.tag === 'drop')).toBe(true);
    m.dispose();
  });
});

describe('Magnetic Core', () => {
  it('cycles pull → calm → push → calm every ten seconds', () => {
    expect(MagnetHazard.phaseAt(0).phase).toBe('calm');
    expect(MagnetHazard.phaseAt(2).phase).toBe('pull');
    expect(MagnetHazard.phaseAt(6.2).phase).toBe('calm');
    expect(MagnetHazard.phaseAt(8).phase).toBe('push');
    expect(MagnetHazard.phaseAt(10.4).phase).toBe('calm');
    expect(MagnetHazard.phaseAt(12).phase).toBe('pull');
  });

  it('pulls blades in during the pull and throws them out during the push', () => {
    const m = park('magnetic-core', 3, ['phantom', 'phantom']);
    place(m, 0, 6, 0); place(m, 1, -6, 0);
    const d0 = Math.hypot(m.blades[0].x, m.blades[0].z);
    run(m, 2.2);                                                        // t≈0.1…2.3 s: pulling
    const pulled = Math.hypot(m.blades[0].x, m.blades[0].z);
    expect(pulled).toBeLessThan(d0 - 0.4);
    // advance to the push phase and watch the field point outwards
    run(m, 5.3);
    expect(hz<MagnetHazard>(m, 'magnetic-core').phase).toBe('push');
    place(m, 0, 5, 0);
    run(m, 0.6);
    expect(m.blades[0].vx).toBeGreaterThan(0);
    m.dispose();
  });
});

describe('Crystal Arena', () => {
  it('a blade that touches a crystal breaks it, gets its buff, and the crystal comes back', () => {
    const m = park('crystal-arena');
    const h = hz<CrystalHazard>(m, 'crystal-arena');
    expect(h.crystals).toHaveLength(4);
    expect(h.crystals[0].kind).toBe(h.crystals[2].kind);                 // opposite crystals match: no seat is favoured
    const c = h.crystals[0];
    const spin0 = 80;
    m.blades[0].spin = spin0;
    place(m, 0, c.x, c.z); place(m, 1, -c.x, -c.z * 0.2);
    m.step();
    expect(c.alive).toBe(false);
    const got = m.blades[0].mods.some((x) => x.tag === 'crystal') || m.blades[0].spin > spin0 - 1;
    expect(got).toBe(true);
    expect(m.arena.pickups(m).length).toBeLessThan(4);
    run(m, CrystalHazard.RESPAWN + 0.5);
    expect(c.alive).toBe(true);
    m.dispose();
  });
});

describe('Shift Floor', () => {
  it('has eight plates on three rings turning different ways', () => {
    const h = new ShiftHazard();
    expect(h.rings.reduce((s, r) => s + r.n, 0)).toBe(8);
    expect(Math.sign(h.rings[0].omega)).not.toBe(Math.sign(h.rings[1].omega));
  });

  it('carries a resting blade round with its plate, and opens a gap that hurts whoever stands on it', () => {
    const m = park('shift-floor', 9, ['gravion', 'gravion']);
    const h = hz<ShiftHazard>(m, 'shift-floor');
    place(m, 0, 6, 0); place(m, 1, -2, 0);
    run(m, 2.5);
    expect(Math.hypot(m.blades[0].vx, m.blades[0].vz)).toBeGreaterThan(0.4);   // dragged along by the turning plate
    // wait for the first gap to be announced, then for it to open
    for (let i = 0; i < 14 / TUNING.DT && !h.gap; i++) m.step();
    expect(h.gap).not.toBeNull();
    const g = h.gap!;
    run(m, ShiftHazard.WARN + 0.1);
    expect(h.gapState(m.t).phase).toBe('open');
    const mid = h.sectorCentre(g, m.t);
    expect(m.arena.danger(mid.x, mid.z, m)).toBe(1);
    place(m, 0, mid.x, mid.z);
    const s0 = m.blades[0].spin;
    run(m, 1);
    expect(s0 - m.blades[0].spin).toBeGreaterThan(2.4 + TUNING.PACE * 0.5);   // the stumble costs spin on top of normal decay
    m.dispose();
  });
});

describe('Wind Tunnel', () => {
  it('pushes blades along their lane and leaves the rest alone; lanes run both ways and are mirror-fair', () => {
    const w = new WindHazard();
    expect(w.lanes.filter((l) => l.dir === 1)).toHaveLength(2);
    for (const l of w.lanes) { const twin = w.lanes.find((x) => Math.abs(x.z + l.z) < 1e-6)!; expect(twin.dir).toBe(-l.dir); expect(twin.power).toBe(l.power); }
    const m = park('wind-tunnel', 5, ['ravok', 'gravion']);
    place(m, 0, 0, 3);        // lane flowing +x
    place(m, 1, 0, 5.8);      // between lanes
    run(m, 0.8);
    expect(m.blades[0].vx).toBeGreaterThan(2.5);
    expect(Math.abs(m.blades[1].vx)).toBeLessThan(0.6);
    m.dispose();
  });

  it('gusts every seven seconds', () => {
    expect(WindHazard.gustAt(1).gust).toBe(1);
    expect(WindHazard.gustAt(6.2).gust).toBeGreaterThan(1.7);
    expect(WindHazard.gustAt(5).warn).toBeGreaterThan(0.5);
    expect(WindHazard.gustAt(7 + 6.2).gust).toBeGreaterThan(1.7);
  });
});

describe('Lava Ring', () => {
  it('burns blades in the channel, not in the centre or on the outer ring', () => {
    const lost = (r: number): number => {
      const m = park('lava-ring', 4);
      place(m, 0, r, 0); place(m, 1, -2, 0);
      const s0 = m.blades[0].spin;
      run(m, 1);
      const d = s0 - m.blades[0].spin;
      m.dispose();
      return d;
    };
    const inLava = lost(8.2), centre = lost(3), outer = lost(10.6);
    expect(inLava).toBeGreaterThan(centre + 3.5);
    expect(inLava).toBeGreaterThan(outer + 3.5);
  });

  it('vents warn, then erupt and throw what is over them', () => {
    const m = park('lava-ring', 4, ['gravion', 'gravion']);
    const h = hz<LavaHazard>(m, 'lava-ring');
    const v = h.vents[0];
    run(m, 2.5);                                                       // group 0 erupts at 3.5 s
    expect(v.warn).toBeGreaterThan(0.3);
    expect(m.arena.danger(v.x, v.z, m)).toBeGreaterThan(0.5);
    place(m, 0, v.x + 0.5, v.z); place(m, 1, -2, 0);
    run(m, 1.6);
    expect(Math.hypot(m.blades[0].x - v.x, m.blades[0].z - v.z)).toBeGreaterThan(1);
    m.dispose();
  });

  it('the CPU keeps out of the lava', async () => {
    let inChannel = 0, steps = 0;
    await playMatch([buildBlade('titan-breaker', { level: 3 }), buildBlade('gravion', { level: 3 })], {
      seed: 21, arenaId: 'lava-ring',
      onStep: (m) => { for (const b of m.blades) { if (!b.alive) continue; steps++; if (Math.hypot(b.x, b.z) > LavaHazard.R0 && Math.hypot(b.x, b.z) < LavaHazard.R1) inChannel++; } },
    });
    expect(inChannel / Math.max(1, steps)).toBeLessThan(0.2);
  }, 60000);
});

describe('Gravity Well', () => {
  it('is heavy at the core, curving in the middle ring and floaty outside', () => {
    const m = park('gravity-well');
    const h = hz<GravityHazard>(m, 'gravity-well');
    place(m, 0, 1.5, 0); place(m, 1, 10.5, 0);
    run(m, 0.05);
    expect(m.blades[0].mod('mass')).toBeGreaterThan(1.3);
    expect(m.blades[0].mod('accel')).toBeLessThan(0.8);
    expect(m.blades[1].mod('accel')).toBeGreaterThan(1.15);
    expect(m.blades[1].mod('kbTaken')).toBeGreaterThan(1.2);
    expect(h.zoneAt(6).orbit).toBeGreaterThan(0.9);
    // orbit zone: a resting blade is carried round, not straight in
    place(m, 0, 6, 0);
    run(m, 0.7);
    expect(Math.abs(m.blades[0].vz)).toBeGreaterThan(0.8);
    m.dispose();
  });
});
