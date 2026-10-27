// The demo reel: three short scenes flown by a scripted pilot on the real engine (real aliens, real weapons, real
// effects). The demo pilot places the aircraft directly (smooth, never loses the plot) and the world gives it strong
// cannon aim assist and extra damage, so fights are short and every scene lands. It backs the title screen's
// "Watch demo" and the recorded video.
//
//   1. Scramble   wave one: run down a harvester and fight off its drones
//   2. Harvest    a harvester is burning a city; take it out
//   3. Leviathan  the mothership: shield nodes, then the core, then the break-up

import { Matrix4, Quaternion, Vector3 } from 'three';
import { JET } from './aircraft';
import { isTargetable, makeAlien, MOTHERSHIP_CENTER, MOTHERSHIP_HULL, type Alien } from './aliens';
import { newControls, type Controls } from './controls';
import { TUNING } from './difficulty';
import { ARENA_RADIUS, surfaceHeight } from './terrain';
import { clamp, damp, makeRng } from './util';
import { CANNON, World } from './world';

const UP = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _m = new Matrix4(), _q = new Quaternion(), _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _prev = new Vector3();
const ZERO = new Vector3();

type Mode = 'attack' | 'break';

/** Flies the player's aircraft directly: steered like an alien ship, drawn like the jet. */
export class DemoFlight {
  readonly dir = new Vector3(0, 0, -1);
  speed = 210;
  bank = 0;
  private mode: Mode = 'attack';
  private modeT = 0;
  private side = 1;
  private pickT = 0;
  private want = new Vector3();
  private rng = makeRng(77);

  constructor(private w: World) {
    this.dir.set(0, 0, -1).applyQuaternion(w.ac.q);
    this.speed = Math.max(150, w.ac.speed);
    w.pilotHook = (_w, dt) => this.fly(dt);
  }

  /** Pick the next target: the nearest thing in front, with harvesters and the Leviathan's parts preferred. */
  private pick(dt: number): Alien | null {
    const w = this.w, ac = w.ac;
    this.pickT -= dt;
    const cur = w.target && isTargetable(w.target) && !(w.target.kind === 'core' && w.target.shielded) ? w.target : null;
    if (cur && this.pickT > 0) return cur;
    this.pickT = 3;
    let best: Alien | null = null, bs = Infinity;
    // while the Leviathan is up its nodes and core are the mission; the drones are a distraction
    const bossUp = w.aliens.some((a) => (a.kind === 'pod' || (a.kind === 'core' && !a.shielded)) && a.dying <= 0);
    for (const a of w.aliens) {
      if (!isTargetable(a) || (a.kind === 'core' && a.shielded)) continue;
      if (bossUp && a.kind !== 'pod' && a.kind !== 'core') continue;
      _a.copy(a.pos).sub(ac.pos);
      const d = _a.length();
      const off = Math.acos(clamp(this.dir.dot(_a.multiplyScalar(1 / Math.max(d, 1))), -1, 1));
      const bias = a.kind === 'harvester' ? -0.7 : a.kind === 'pod' || a.kind === 'core' ? -0.5 : a.kind === 'wisp' ? 0.25 : 0;
      const s = off * 1.1 + d / 2600 + bias;
      if (s < bs) { bs = s; best = a; }
    }
    if (best && best !== w.target) { w.target = best; w.lock = 0; }
    return best;
  }

  controls(): Controls {
    const c = newControls();
    const w = this.w, t = w.target;
    c.throttleSet = 0.8;
    if (this.mode === 'attack' && t && isTargetable(t)) {
      _a.copy(t.pos).sub(w.ac.pos);
      const range = _a.length();
      const off = Math.acos(clamp(this.dir.dot(_a.multiplyScalar(1 / Math.max(range, 1))), -1, 1));
      c.fire = range < 950 && off < 0.12;
      c.missile = w.lock >= 1;
    }
    return c;
  }

  private fly(dt: number): void {
    const w = this.w, ac = w.ac;
    const tgt = this.pick(dt);
    const want = this.want;
    let maxTurn = 1.15;
    let range = 0;

    if (this.mode === 'break') {
      this.modeT -= dt;
      _c.crossVectors(this.dir, UP).normalize().multiplyScalar(this.side);
      want.copy(this.dir).addScaledVector(_c, 1.1).addScaledVector(UP, this.w.bossAlive ? -0.1 : 0.4).normalize();
      maxTurn = 1.6;
      if (this.modeT <= 0) this.mode = 'attack';
    } else if (tgt) {
      // lead the target: where it will be when a round (or the aircraft) gets there
      _a.copy(tgt.pos).sub(ac.pos);
      range = _a.length();
      const t = range < 1500 ? range / (CANNON.speed + 100) : 0;
      _b.copy(tgt.pos).addScaledVector(_c.copy(tgt.vel).sub(ac.vel), t).sub(ac.pos);
      want.copy(_b).normalize();
      const closing = this.dir.dot(_a.normalize());
      if (range < 170 || (range < 600 && closing < 0.2)) { this.mode = 'break'; this.modeT = 1.7; this.side = this.rng() < 0.5 ? -1 : 1; }
    } else {
      want.set(-ac.pos.x, 1300 - ac.pos.y, -ac.pos.z).normalize();
    }

    // working under the Leviathan: its nodes and core hang below the hull, so attack runs stay beneath it
    const boss0 = w.aliens.find((a) => a.kind === 'mothership' && a.dying <= 0);
    if (boss0 && tgt && (tgt.kind === 'pod' || tgt.kind === 'core') && Math.hypot(ac.pos.x - boss0.pos.x, ac.pos.z - boss0.pos.z) < 1900) {
      // the bias fades out on the final approach so the aim is exact
      const wantY = boss0.pos.y - 190;
      const fade = clamp((tgt.pos.distanceTo(ac.pos) - 300) / 700, 0, 1);
      want.y += clamp((wantY - ac.pos.y) / 220, -1.4, 0.7) * fade;
      want.normalize();
    }

    // stay off the ground, out of the Leviathan's hull and inside the arena
    const look = this.speed * 2.2;
    const ahead = Math.max(surfaceHeight(ac.pos.x + this.dir.x * look, ac.pos.z + this.dir.z * look), surfaceHeight(ac.pos.x, ac.pos.z));
    const floor = ahead + 230;
    const deficit = floor - Math.min(ac.pos.y + this.dir.y * look, ac.pos.y);
    if (deficit > 0) { want.y = Math.max(want.y, 0) + clamp(deficit / 90, 0.35, 3); want.normalize(); }
    const boss = w.aliens.find((a) => a.kind === 'mothership' && a.dying <= 0);
    if (boss) {
      // keep clear of the real hull (plus a margin) but not of the nodes that hang just beneath it
      const { rx, ry, rz } = MOTHERSHIP_HULL;
      _c.set((ac.pos.x - boss.pos.x) / (rx + 30), (ac.pos.y - boss.pos.y) / (ry + 30), (ac.pos.z - boss.pos.z) / (rz + 30));
      const q = _c.length();
      if (q < 1.25) {
        _b.set(ac.pos.x - boss.pos.x, (ac.pos.y - boss.pos.y) * 3, ac.pos.z - boss.pos.z).normalize();
        want.lerp(_b, clamp((1.25 - q) / 0.3, 0, 1)).normalize();
        maxTurn = 2;
        if (this.mode === 'attack' && q < 1.05) { this.mode = 'break'; this.modeT = 1.2; }
      }
    }
    const r = Math.hypot(ac.pos.x, ac.pos.z);
    if (r > ARENA_RADIUS - 600) { want.addScaledVector(_b.set(-ac.pos.x, 0, -ac.pos.z).normalize(), clamp((r - (ARENA_RADIUS - 600)) / 500, 0, 1.3)).normalize(); }

    // steer, limited by turn rate, and bank into the turn
    _prev.copy(this.dir);
    // the demo pilot is held well inside the real jet's structural limit, so the G readout and the turn it shows are honest
    maxTurn = Math.min(maxTurn, (Math.min(JET.gLimit, 8) * 9.81) / Math.max(this.speed, 60));
    const ang = Math.acos(clamp(this.dir.dot(want), -1, 1));
    const maxA = maxTurn * dt;
    if (ang <= maxA) this.dir.copy(want);
    else {
      _c.crossVectors(this.dir, want);
      if (_c.lengthSq() < 1e-8) _c.crossVectors(this.dir, UP);
      this.dir.applyAxisAngle(_c.normalize(), maxA).normalize();
    }
    const yaw = _c.crossVectors(_prev, this.dir).y / Math.max(dt, 1e-4);
    // a coordinated turn at n g needs a bank of acos(1/n); show most of it
    const nTurn = (Math.abs(yaw) * this.speed) / 9.81;
    this.bank += (Math.sign(-yaw) * Math.min(1.35, Math.atan(nTurn) * 0.92) - this.bank) * damp(4, dt);

    // speed: burn to get there, ease off in the fight
    const far = !!tgt && range > 2600;
    // in the fight it flies near corner speed, where the jet turns hardest: tight passes inside the real g-limit
    const nearBoss = !!boss && Math.hypot(ac.pos.x - boss.pos.x, ac.pos.z - boss.pos.z) < 1900;
    const wantSpeed = far ? 330 : nearBoss ? 135 : range > 0 && range < 1300 ? 160 : 225;
    this.speed += (wantSpeed - this.speed) * damp(1.2, dt);

    // write the aircraft state
    ac.pos.addScaledVector(this.dir, this.speed * dt);
    ac.vel.copy(this.dir).multiplyScalar(this.speed);
    _m.lookAt(ZERO, this.dir, UP);
    ac.q.setFromRotationMatrix(_m).multiply(_q.setFromAxisAngle(Z, -this.bank));
    ac.speed = this.speed;
    ac.aoa = 0.04; ac.beta = 0;
    ac.g = 1 + (Math.abs(yaw) * this.speed) / 9.81;
    ac.stalled = false;
    ac.throttle = 0.7;
    ac.boosting = far;
    ac.thrust += ((far ? 1.3 : 0.75) - ac.thrust) * damp(3, dt);
    ac.pitchRate = ac.rollRate = ac.yawRate = 0;
    ac.boostFuel = 100;
  }
}

// ---- scenes ---------------------------------------------------------------------------------------------------------

export interface Shot {
  t0: number;
  t1: number;
  mode: 'chase' | 'cockpit' | 'orbit';
  /** For orbit shots: distance, and azimuth/elevation at the start and end (radians, around the jet's own heading). */
  dist?: number;
  az0?: number;
  az1?: number;
  el?: number;
}

export interface DemoScene {
  name: string;
  caption: string;
  world: World;
  flight: DemoFlight;
  /** Longest the scene may run, seconds. */
  duration: number;
  shots: Shot[];
  /** True when the scene has played out (or run out of time). */
  done(): boolean;
}

function placeJet(w: World, pos: Vector3, look: Vector3, speed = 210): void {
  w.ac.pos.copy(pos);
  const d = look.clone().sub(pos).normalize();
  _m.lookAt(ZERO, d, UP);
  w.ac.q.setFromRotationMatrix(_m);
  w.ac.vel.copy(d).multiplyScalar(speed);
  w.ac.speed = speed;
}

export const DEMO_SCENES = 3;

export function createScene(index: number, seed = 0): DemoScene {
  switch (index % DEMO_SCENES) {
    case 0: {
      const world = new World({ seed: 21 + seed, demo: true, startWave: 1, difficulty: 'pilot' });
      world.waveT = 1.5;
      const flight = new DemoFlight(world);
      return {
        name: 'Scramble', caption: 'Wave 1: run down the harvester, shake the drones', world, flight, duration: 22,
        shots: [{ t0: 0, t1: 7, mode: 'chase' }, { t0: 7, t1: 12, mode: 'orbit', dist: 62, az0: -0.9, az1: 0.8, el: 0.16 }, { t0: 12, t1: 99, mode: 'chase' }],
        done() { return world.time >= this.duration; },
      };
    }
    case 1: {
      const world = new World({ seed: 5 + seed, demo: true, startWave: 1, difficulty: 'pilot' });
      world.waveT = 1e9;
      const city = world.cities[0]!;
      city.hp = city.maxHp * 0.62;
      const h = makeAlien(700, 'harvester', new Vector3(city.site.x + 60, city.site.level + 360, city.site.z - 40), TUNING.pilot, makeRng(3));
      h.state = 'beam'; h.beamCity = 0; h.cd = 6;
      world.aliens.push(h);
      for (let i = 0; i < 3; i++) world.spawnWisp(new Vector3(city.site.x + 900 + i * 120, city.site.level + 700 + i * 60, city.site.z + 900));
      placeJet(world, new Vector3(city.site.x + 1500, city.site.level + 900, city.site.z + 1800), h.pos, 215);
      const flight = new DemoFlight(world);
      return {
        name: 'Harvest', caption: 'A harvester is burning Harbor. Stop it.', world, flight, duration: 10,
        shots: [{ t0: 0, t1: 5, mode: 'cockpit' }, { t0: 5, t1: 99, mode: 'chase' }],
        done() { return world.time >= this.duration; },
      };
    }
    default: {
      const world = new World({ seed: 9 + seed, demo: true, startWave: 5, difficulty: 'pilot' });
      world.waveT = 0.1;
      world.step(0.2); // let the director spawn the Leviathan, then give the reel a shorter fight
      world.events.length = 0;
      for (const a of world.aliens) {
        if (a.kind === 'pod') a.hp = a.maxHp = 200;
        if (a.kind === 'core') a.hp = a.maxHp = 320;
      }
      const c = MOTHERSHIP_CENTER;
      placeJet(world, new Vector3(c.x + 1900, c.y - 320, c.z + 1500), new Vector3(c.x, c.y - 100, c.z), 230);
      const flight = new DemoFlight(world);
      return {
        name: 'Leviathan', caption: 'The mothership: nodes first, then the core', world, flight, duration: 42,
        shots: [
          { t0: 0, t1: 11, mode: 'chase' }, { t0: 11, t1: 17, mode: 'orbit', dist: 70, az0: 0.7, az1: -0.9, el: 0.1 },
          { t0: 17, t1: 26, mode: 'chase' }, { t0: 26, t1: 99, mode: 'orbit', dist: 150, az0: 0.5, az1: -0.7, el: 0.12 },
        ],
        done() { return world.finished || world.time >= this.duration; },
      };
    }
  }
}
