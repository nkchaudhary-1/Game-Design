import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { bankAngle, forwardOf, newAircraft, stepAircraft } from '../src/sim/aircraft';
import { autopilot as pilot } from '../src/sim/autopilot';
import { makeAlien } from '../src/sim/aliens';
import { newControls, type Controls } from '../src/sim/controls';
import { TUNING } from '../src/sim/difficulty';
import { CITY_SITES, SEA_LEVEL, SPAWN, surfaceHeight, terrainHeight, timeToImpact } from '../src/sim/terrain';
import { makeRng } from '../src/sim/util';
import { MISSILE, WAVES, World } from '../src/sim/world';

const DT = 1 / 60;

function run(w: World, secs: number, ctl: (w: World, t: number) => Controls | void = () => undefined): void {
  for (let i = 0; i < secs * 60 && w.state === 'play'; i++) {
    const c = ctl(w, i * DT) ?? newControls();
    w.step(DT, c);
    w.events.length = 0;
  }
}

describe('terrain', () => {
  it('is deterministic and finite', () => {
    for (let i = 0; i < 50; i++) {
      const x = (i * 977) % 9000 - 4500, z = (i * 1213) % 9000 - 4500;
      expect(terrainHeight(x, z)).toBe(terrainHeight(x, z));
      expect(Number.isFinite(terrainHeight(x, z))).toBe(true);
    }
  });
  it('flattens each city site and keeps them above water', () => {
    for (const c of CITY_SITES) {
      for (const f of [0, 0.4, 0.75]) {
        const h = terrainHeight(c.x + c.radius * f, c.z);
        expect(Math.abs(h - c.level)).toBeLessThan(4);
      }
      expect(c.level).toBeGreaterThan(SEA_LEVEL + 5);
    }
  });
  it('has ocean and mountains in the combat area', () => {
    let lo = Infinity, hi = -Infinity;
    for (let x = -9000; x <= 9000; x += 300) for (let z = -9000; z <= 9000; z += 300) {
      const h = terrainHeight(x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    expect(lo).toBeLessThan(-20);
    expect(hi).toBeGreaterThan(500);
    expect(hi).toBeLessThan(1800);
    // the spawn point is well clear of the ground
    expect(SPAWN.y).toBeGreaterThan(surfaceHeight(SPAWN.x, SPAWN.z) + 400);
  });
  it('predicts an impact in a dive and not in level flight', () => {
    expect(timeToImpact(0, 300, 0, 0, -120, -200)).toBeLessThan(4);
    expect(timeToImpact(0, 3000, 0, 0, 0, -200)).toBe(Infinity);
  });
});

describe('flight model', () => {
  const fly = (assist: boolean, secs: number, ctl: (t: number, c: Controls) => void, setup?: (a: ReturnType<typeof newAircraft>) => void) => {
    const a = newAircraft(0, 1500, 0, 190);
    setup?.(a);
    const c = newControls();
    let maxG = 0;
    for (let i = 0; i < secs * 60; i++) {
      Object.assign(c, newControls());
      ctl(i * DT, c);
      stepAircraft(a, c, DT, assist);
      maxG = Math.max(maxG, a.g);
      expect(Number.isFinite(a.pos.x + a.pos.y + a.pos.z + a.vel.length())).toBe(true);
    }
    return { a, maxG };
  };

  it('holds level flight hands-off with assist', () => {
    const { a } = fly(true, 10, () => undefined);
    expect(Math.abs(a.pos.y - 1500)).toBeLessThan(25);
    expect(a.speed).toBeGreaterThan(170);
  });
  it('assisted roll commands a bank angle: it holds while the stick is held and levels when released', () => {
    const half = fly(true, 4, (_t, c) => { c.roll = 0.5; }).a;
    expect(bankAngle(half)).toBeGreaterThan(0.6);   // about 40 degrees
    expect(bankAngle(half)).toBeLessThan(0.8);
    const full = fly(true, 4, (_t, c) => { c.roll = 1; }).a;
    expect(bankAngle(full)).toBeGreaterThan(1.3);    // about 80 degrees, and it does not roll on over the top
    expect(bankAngle(full)).toBeLessThan(1.5);
    const released = fly(true, 6, (t, c) => { if (t < 1) c.roll = 1; }).a;
    expect(Math.abs(bankAngle(released))).toBeLessThan(0.08);
  });
  it('manual roll is a roll rate: it keeps rolling, and the wings stay wherever you leave them', () => {
    const rolled = fly(false, 6, (t, c) => { if (t < 0.35) c.roll = 1; }).a;
    expect(Math.abs(bankAngle(rolled))).toBeGreaterThan(0.5);
    const barrel = fly(false, 1.2, (_t, c) => { c.roll = 1; }).a;
    expect(Math.abs(bankAngle(barrel))).toBeGreaterThan(2);
  });
  it('a held assisted bank plus back-stick carves a real turn while holding height', () => {
    const { a } = fly(true, 6, (t, c) => { c.roll = 0.8; if (t > 0.6) c.pitch = 0.45; });
    const hdg = Math.atan2(forwardOf(a, new Vector3()).x, -forwardOf(a, new Vector3()).z);
    expect(Math.abs(hdg)).toBeGreaterThan(0.6);       // heading has swung
    expect(Math.abs(a.pos.y - 1500)).toBeLessThan(500);
    expect(a.speed).toBeGreaterThan(110);
  });
  it('turns the nose onto the flight path with real G, and stays under the structural limit', () => {
    const { a, maxG } = fly(true, 4, (t, c) => { if (t > 0.5) c.pitch = 1; });
    expect(maxG).toBeGreaterThan(7);
    expect(maxG).toBeLessThan(14);
    expect(forwardOf(a, new Vector3()).y).toBeGreaterThan(0.5);
  });
  it('bleeds speed in a hard turn and stalls when slow and nose-high in manual', () => {
    const hard = fly(true, 6, (_t, c) => { c.pitch = 1; c.roll = 1; }).a;
    expect(hard.speed).toBeLessThan(180);
    const slow = fly(false, 14, (_t, c) => { c.pitch = 0.6; c.throttleSet = 0; });
    expect(slow.a.speed).toBeLessThan(150);
  });
  it('afterburner accelerates and then runs dry', () => {
    const { a } = fly(true, 3.5, (_t, c) => { c.boost = true; c.throttleSet = 1; });
    expect(a.speed).toBeGreaterThan(215);
    expect(a.boostFuel).toBeLessThan(30);
  });
  it('stays finite under random abuse', () => {
    const rng = makeRng(7);
    fly(true, 30, (_t, c) => {
      c.pitch = rng() * 2 - 1; c.roll = rng() * 2 - 1; c.yaw = rng() * 2 - 1; c.boost = rng() < 0.3; c.brake = rng() < 0.2;
    });
    fly(false, 30, (_t, c) => {
      c.pitch = rng() * 2 - 1; c.roll = rng() * 2 - 1; c.throttleSet = rng();
    });
  });
});

describe('combat', () => {
  const add = (w: World, kind: Parameters<typeof makeAlien>[1], pos: Vector3, dir = new Vector3(0, 0, -1)) => {
    const a = makeAlien(900 + w.aliens.length, kind, pos, TUNING.pilot, makeRng(3), dir);
    w.aliens.push(a);
    return a;
  };
  const quiet = () => new World({ seed: 1 });
  const stopSpawns = (w: World) => { w.waveT = 1e9; };

  it('cannon rounds kill a drone dead ahead and are counted as hits', () => {
    const w = quiet(); stopSpawns(w);
    // a stationary stand-in (an orphan shield node has no AI) so the shot is deterministic
    const a = add(w, 'pod', new Vector3(SPAWN.x, SPAWN.y, SPAWN.z - 700));
    a.hp = a.maxHp = 16;
    run(w, 1.5, () => ({ ...newControls(), fire: true, throttleSet: 0.55 }));
    expect(a.hp).toBeLessThanOrEqual(0);
    expect(w.stats.kills.pod).toBe(1);
    expect(w.score).toBeGreaterThan(0);
    expect(w.accuracy).toBeGreaterThan(0.05);
  });
  it('the cannon overheats and recovers', () => {
    const w = quiet(); stopSpawns(w);
    run(w, 8, () => ({ ...newControls(), fire: true }));
    expect(w.overheated).toBe(true);
    run(w, 4);
    expect(w.overheated).toBe(false);
  });
  it('a locked missile kills a lancer; an unlocked one flies straight', () => {
    const w = quiet(); stopSpawns(w);
    const l = add(w, 'lancer', new Vector3(SPAWN.x, SPAWN.y, SPAWN.z - 2600));
    run(w, 2.2); // acquire
    expect(w.target).toBe(l);
    expect(w.lock).toBe(1);
    const before = w.missiles;
    run(w, 0.3, (_w, t) => ({ ...newControls(), missile: t < 0.1 }));
    expect(w.missiles).toBe(before - 1);
    run(w, 6);
    expect(l.hp).toBeLessThanOrEqual(0);
    expect(MISSILE.damage).toBeGreaterThan(100);
  });
  it('alien fire drains shield first, then hull, then kills', () => {
    const w = quiet(); stopSpawns(w);
    w.damagePlayer(60, w.ac.pos, 'SHOT DOWN');
    expect(w.shield).toBe(40);
    expect(w.hull).toBe(100);
    w.damagePlayer(80, w.ac.pos, 'SHOT DOWN');
    expect(w.shield).toBe(0);
    expect(w.hull).toBe(60);
    w.damagePlayer(100, w.ac.pos, 'SHOT DOWN');
    expect(w.playerAlive).toBe(false);
    expect(w.state).toBe('lost');
    run(w, 5, () => undefined);
    expect(w.finished).toBe(false); // the loop above stops once not playing; finish by stepping
    for (let i = 0; i < 200; i++) w.step(DT);
    expect(w.finished).toBe(true);
  });
  it('shield recharges after a quiet spell', () => {
    const w = quiet(); stopSpawns(w);
    w.damagePlayer(50, w.ac.pos, 'SHOT DOWN');
    run(w, 4);
    expect(w.shield).toBe(50);
    run(w, 6);
    expect(w.shield).toBeGreaterThan(90);
  });
  it('flying into the ground, the sea, or out of the arena is fatal', () => {
    let w = quiet(); stopSpawns(w);
    w.ac.vel.set(0, -150, -150);
    run(w, 30, () => ({ ...newControls(), pitch: -1, throttleSet: 1 }));
    expect(w.playerAlive).toBe(false);
    expect(w.deathCause).toBe('CRASHED');

    w = quiet(); stopSpawns(w);
    w.ac.pos.set(9500, 1500, 0);
    run(w, 14);
    expect(w.playerAlive).toBe(false);
    expect(w.deathCause).toBe('LEFT THE COMBAT AREA');
  });
  it('god mode shrugs everything off', () => {
    const w = new World({ seed: 1, god: true }); stopSpawns(w);
    w.damagePlayer(500, w.ac.pos, 'SHOT DOWN');
    w.killPlayer('CRASHED');
    expect(w.playerAlive).toBe(true);
  });
  it('a harvester over a city burns it down, and losing every city loses the mission', () => {
    const w = new World({ seed: 1, god: true }); stopSpawns(w);
    const c = CITY_SITES[0]!;
    const h = add(w, 'harvester', new Vector3(c.x, c.level + 360, c.z));
    h.state = 'beam'; h.beamCity = 0; h.cd = 1e9;
    run(w, 120, () => ({ ...newControls(), throttleSet: 0.5 }));
    expect(w.cities[0]!.alive).toBe(false);
    expect(h.beamCity).not.toBe(0);
    for (const k of w.cities) { k.hp = 0; k.alive = false; }
    w.damageCity(0, 1, h);
    w.cities[1]!.alive = true; w.cities[2]!.alive = true; w.cities[1]!.hp = 1; w.cities[2]!.hp = 1;
    w.damageCity(1, 5, h); w.damageCity(2, 5, h);
    expect(w.state).toBe('lost');
    expect(w.endReason).toBe('ALL CITIES LOST');
  });
  it('chains kills into a combo multiplier that decays', () => {
    const w = quiet(); stopSpawns(w);
    const a = add(w, 'wisp', new Vector3(0, 3000, 0)), b = add(w, 'wisp', new Vector3(0, 3100, 0));
    w.damageAlien(a, 999, a.pos);
    const first = w.score;
    w.damageAlien(b, 999, b.pos);
    expect(w.score - first).toBe(110);
    expect(w.combo).toBe(2);
    run(w, 6);
    expect(w.combo).toBe(0);
  });
  it('is deterministic for a given seed and inputs', () => {
    const go = () => {
      const w = new World({ seed: 5, god: true, startWave: 2 });
      run(w, 40, (ww) => pilot(ww));
      return [w.score, w.ac.pos.x.toFixed(3), w.ac.pos.y.toFixed(3), w.aliens.length, w.stats.shots].join('|');
    };
    expect(go()).toBe(go());
  });
});

describe('missions', () => {
  it('a scripted pilot can fight for two minutes without anything going non-finite or unbounded', () => {
    const w = new World({ seed: 11, god: true, difficulty: 'cadet' });
    run(w, 150, (ww) => pilot(ww));
    expect(w.stats.shots).toBeGreaterThan(30);
    expect(w.stats.kills.wisp + w.stats.kills.lancer + w.stats.kills.harvester).toBeGreaterThan(0);
    for (const a of w.aliens) expect(Number.isFinite(a.pos.x + a.pos.y + a.pos.z)).toBe(true);
    expect(w.aliens.length).toBeLessThan(30);
    expect(w.bolts.length).toBeLessThan(400);
    expect(w.bullets.length).toBeLessThan(200);
  });
  it('aliens stay out of the ground and inside the arena', () => {
    const w = new World({ seed: 4, god: true, startWave: 3 });
    for (let i = 0; i < 90 * 60; i++) {
      w.step(DT, pilot(w));
      w.events.length = 0;
      for (const a of w.aliens) {
        if (a.dying > 0 || a.kind === 'mothership' || a.kind === 'pod' || a.kind === 'core') continue;
        expect(a.pos.y).toBeGreaterThan(surfaceHeight(a.pos.x, a.pos.z) - 5);
        expect(Math.hypot(a.pos.x, a.pos.z)).toBeLessThan(11000);
      }
    }
  });
  it('clearing each wave restores hull and missiles and pays a bonus, until the Leviathan arrives', () => {
    const w = new World({ seed: 2, god: true });
    w.hull = 40; w.missiles = 1;
    let sawWave = 0;
    for (let i = 0; i < 60 * 400 && w.wave < WAVES.length; i++) {
      w.step(DT);
      for (const e of w.events) if (e.type === 'wave' && e.phase === 'start') sawWave = e.n;
      w.events.length = 0;
      if (w.waveState === 'active' && i % 30 === 0) for (const a of w.aliens) if (a.kind !== 'mothership') w.damageAlien(a, 9999, a.pos);
    }
    expect(sawWave).toBe(WAVES.length);
    expect(w.hull).toBeGreaterThan(40);
    expect(w.missiles).toBeGreaterThan(1);
    expect(w.score).toBeGreaterThan(2000);
    expect(w.bossAlive).toBe(true);
  });
  it('the Leviathan: nodes first, then the exposed core, then victory', () => {
    const w = new World({ seed: 9, god: true, startWave: WAVES.length });
    run(w, 1);
    const bh = w.bossHealth()!;
    expect(bh.nodes.length).toBe(3);
    const core = w.aliens.find((a) => a.kind === 'core')!;
    const pods = w.aliens.filter((a) => a.kind === 'pod');
    expect(core.shielded).toBe(true);
    w.damageAlien(core, 9999, core.pos);
    expect(core.hp).toBe(core.maxHp); // shield holds
    for (const p of pods) w.damageAlien(p, 9999, p.pos);
    run(w, 0.1);
    expect(w.bossHealth()!.coreExposed).toBe(true);
    w.damageAlien(core, 9999, core.pos);
    for (let i = 0; i < 60 * 12; i++) { w.step(DT); w.events.length = 0; }
    expect(w.state).toBe('won');
    expect(w.finished).toBe(true);
    expect(w.aliens.filter((a) => a.kind !== 'wisp').length).toBe(0);
  });
  it('flying into the Leviathan hull is fatal', () => {
    const w = new World({ seed: 9, startWave: WAVES.length });
    run(w, 1);
    const boss = w.aliens.find((a) => a.kind === 'mothership')!;
    w.ac.pos.copy(boss.pos).add(new Vector3(0, 10, 0));
    run(w, 0.2);
    expect(w.deathCause).toBe('HIT THE LEVIATHAN');
  });
});
