// The invaders. Five ship classes plus the Leviathan's two destructible parts. Aliens are kinematic (they steer a
// heading at a speed, they don't obey the player's aerodynamics): that keeps them readable and cheap, and lets each
// class have a distinct, learnable behaviour.
//
//   Wisp        small, fast swarm drone. Makes strafing passes, weak bolts.
//   Lancer      alien fighter. Hunts the player, fires bursts, jinks when you line it up.
//   Harvester   slow saucer. Parks over a city and burns it down with a beam. The thing you are defending against.
//   Leviathan   mothership. Hull is invulnerable; kill its three shield nodes, then the core.

import { Vector3 } from 'three';
import type { Aircraft } from './aircraft';
import type { Tuning } from './difficulty';
import { ARENA_RADIUS, surfaceHeight, type CitySite } from './terrain';
import { clamp, damp, rr, type Rng } from './util';

export type AlienKind = 'wisp' | 'lancer' | 'harvester' | 'mothership' | 'pod' | 'core';

export interface AlienSpec {
  label: string;
  hp: number;
  radius: number;
  speed: number;
  turn: number;
  score: number;
  /** Minimum height above ground the AI tries to keep. */
  minAgl: number;
}

export const ALIEN_SPEC: Record<AlienKind, AlienSpec> = {
  wisp: { label: 'WISP', hp: 16, radius: 10, speed: 190, turn: 2.9, score: 100, minAgl: 60 },
  lancer: { label: 'LANCER', hp: 95, radius: 17, speed: 215, turn: 1.3, score: 300, minAgl: 140 },
  harvester: { label: 'HARVESTER', hp: 190, radius: 44, speed: 72, turn: 0.7, score: 450, minAgl: 220 },
  mothership: { label: 'LEVIATHAN', hp: 1, radius: 400, speed: 26, turn: 0.1, score: 0, minAgl: 900 },
  pod: { label: 'SHIELD NODE', hp: 360, radius: 38, speed: 0, turn: 0, score: 700, minAgl: 0 },
  core: { label: 'LEVIATHAN CORE', hp: 900, radius: 64, speed: 0, turn: 0, score: 6000, minAgl: 0 },
};

export const MOTHERSHIP_HULL = { rx: 410, ry: 62, rz: 410 } as const;
/** Pods hang on the hull rim; the core sits under the belly. */
export const POD_ORBIT = 285;
export const POD_DROP = -78;
export const CORE_DROP = -128;

export interface Alien {
  id: number;
  kind: AlienKind;
  pos: Vector3;
  vel: Vector3;
  /** Unit forward vector. */
  dir: Vector3;
  speed: number;
  hp: number;
  maxHp: number;
  radius: number;
  bank: number;
  age: number;
  state: string;
  stateT: number;
  /** Weapon cooldown, seconds. */
  cd: number;
  burst: number;
  seed: number;
  /** > 0 while the wreck is falling or exploding; the ship can no longer be hit. */
  dying: number;
  dyingMax: number;
  hitFlash: number;
  // harvester / mothership beams
  beam: boolean;
  beamCharge: number;
  beamCity: number;
  // mothership parts
  parent: Alien | null;
  slot: number;
  shielded: boolean;
  spin: number;
  /** Free counters for behaviours. */
  a: number;
  b: number;
  /** Set when the wreck is done and the world should drop it. */
  gone: boolean;
}

/** What the AI needs from the world. World implements this. */
export interface AiHost {
  time: number;
  rng: Rng;
  tuning: Tuning;
  wave: number;
  player: Aircraft;
  playerAlive: boolean;
  cities: { site: CitySite; hp: number; alive: boolean }[];
  aliens: Alien[];
  fire(from: Alien, origin: Vector3, dir: Vector3, kind: 'bolt' | 'orb', speed: number): void;
  damageCity(id: number, amount: number, from: Alien): void;
  msg(text: string, tone: 'info' | 'warn' | 'good' | 'bad'): void;
  spawnWisp(pos: Vector3): void;
}

// Scratch vectors. Each helper owns its own so a helper can never clobber a caller's working vector:
//   _a/_b/_c  free for the per-class updaters      _toP/_want  the updaters' main working vectors
//   _s steer  _h shape  _p perturb  _q separate  _o offBore  _m aimPoint
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _toP = new Vector3(), _want = new Vector3();
const _s1 = new Vector3(), _s2 = new Vector3(), _s3 = new Vector3(), _h = new Vector3(), _p = new Vector3(), _q = new Vector3(), _o = new Vector3();
const UP = new Vector3(0, 1, 0);

export function makeAlien(id: number, kind: AlienKind, pos: Vector3, tuning: Tuning, rng: Rng, dir?: Vector3): Alien {
  const spec = ALIEN_SPEC[kind];
  const hp = Math.round(spec.hp * (kind === 'mothership' ? 1 : tuning.hp));
  return {
    id, kind, pos: pos.clone(), vel: new Vector3(), dir: dir ? dir.clone().normalize() : new Vector3(0, 0, -1),
    speed: spec.speed, hp, maxHp: hp, radius: spec.radius, bank: 0, age: 0,
    state: kind === 'harvester' ? 'transit' : kind === 'mothership' ? 'shielded' : kind === 'core' ? 'core' : 'approach',
    stateT: 0, cd: rr(rng, 0.6, 2.4), burst: 0, seed: rng() * 100, dying: 0, dyingMax: 0, hitFlash: 0,
    beam: false, beamCharge: 0, beamCity: -1, parent: null, slot: 0, shielded: false, spin: 0, a: 0, b: 0, gone: false,
  };
}

export const isTargetable = (a: Alien): boolean => a.dying <= 0 && a.kind !== 'mothership';

// ---- steering helpers --------------------------------------------------------------------------------------------

/** Rotate a.dir towards `want` (unit) by at most turn*dt, and bank into the turn. */
function steer(a: Alien, want: Vector3, dt: number, turn: number): void {
  _s1.copy(a.dir);
  const d = clamp(a.dir.dot(want), -1, 1);
  const ang = Math.acos(d);
  const maxA = turn * dt;
  if (ang <= maxA) a.dir.copy(want);
  else {
    _s2.crossVectors(a.dir, want);
    if (_s2.lengthSq() < 1e-8) _s2.crossVectors(a.dir, UP);
    _s2.normalize();
    a.dir.applyAxisAngle(_s2, maxA).normalize();
  }
  const yaw = _s3.crossVectors(_s1, a.dir).y / Math.max(dt, 1e-4);
  a.bank += (clamp(-yaw * 0.75, -1.2, 1.2) - a.bank) * damp(5, dt);
}

/** Bend a desired heading up if the ground is coming, and in if the ship is leaving the arena. */
function shape(a: Alien, want: Vector3, minAgl: number): void {
  const look = Math.max(a.speed, 60) * 2.2;
  const ahead = surfaceHeight(a.pos.x + a.dir.x * look, a.pos.z + a.dir.z * look);
  const here = surfaceHeight(a.pos.x, a.pos.z);
  const floor = Math.max(ahead, here) + minAgl;
  const predY = a.pos.y + a.dir.y * look;
  const deficit = floor - Math.min(predY, a.pos.y);
  if (deficit > 0) {
    // the closer the ground, the more the heading is bent skyward
    want.y = Math.max(want.y, 0) + clamp(deficit / 90, 0.35, 3);
    want.normalize();
  }
  const r = Math.hypot(a.pos.x, a.pos.z);
  if (r > ARENA_RADIUS - 500) {
    want.addScaledVector(_h.set(-a.pos.x, 0, -a.pos.z).normalize(), clamp((r - (ARENA_RADIUS - 500)) / 500, 0, 1.2));
    want.normalize();
  }
}

function advance(a: Alien, dt: number): void {
  a.vel.copy(a.dir).multiplyScalar(a.speed);
  a.pos.addScaledVector(a.vel, dt);
  // last line of defence: never let a living ship tunnel into the ground
  const floor = surfaceHeight(a.pos.x, a.pos.z) + 12;
  if (a.pos.y < floor) { a.pos.y = floor; if (a.dir.y < 0) { a.dir.y = 0; a.dir.normalize(); } }
}

/** Point to shoot at so a bolt of `speed` meets the player, blended by how well this difficulty leads. */
function aimPoint(host: AiHost, from: Vector3, speed: number, out: Vector3): Vector3 {
  const p = host.player;
  const t = from.distanceTo(p.pos) / speed;
  return out.copy(p.pos).addScaledVector(p.vel, t * host.tuning.lead);
}

function perturb(host: AiHost, dir: Vector3, err: number): void {
  _p.set(host.rng() - 0.5, host.rng() - 0.5, host.rng() - 0.5);
  _p.addScaledVector(dir, -_p.dot(dir));
  if (_p.lengthSq() < 1e-6) return;
  _p.normalize();
  dir.addScaledVector(_p, Math.tan(err * host.rng())).normalize();
}

const _m = new Vector3(), _n = new Vector3();
function shoot(host: AiHost, a: Alien, kind: 'bolt' | 'orb', speed: number, err: number, origin?: Vector3): void {
  aimPoint(host, origin ?? a.pos, speed, _m);
  _n.copy(_m).sub(origin ?? a.pos).normalize();
  perturb(host, _n, err);
  host.fire(a, origin ?? a.pos, _n, kind, speed);
}

/** Angle between an alien's facing and the line to a point. */
const offBore = (a: Alien, to: Vector3): number => Math.acos(clamp(a.dir.dot(_o.copy(to).sub(a.pos).normalize()), -1, 1));

// ---- per-class behaviour -----------------------------------------------------------------------------------------

function updateWisp(host: AiHost, a: Alien, dt: number): void {
  const spec = ALIEN_SPEC.wisp;
  const p = host.player.pos;
  const toP = _toP.copy(p).sub(a.pos);
  const dist = toP.length();
  toP.multiplyScalar(1 / Math.max(dist, 1));
  const want = _want.copy(toP);
  // drones are the pursuit threat: they run down a pilot who tries to leave them behind
  a.speed += ((spec.speed * (1 + 0.05 * (host.wave - 1)) * (dist > 1400 ? 1.35 : 1)) - a.speed) * damp(2, dt);

  switch (a.state) {
    case 'approach': {
      // weave while closing so a swarm never flies a straight line at you
      _b.crossVectors(toP, UP).normalize();
      want.addScaledVector(_b, Math.sin(a.age * 2.4 + a.seed) * 0.35).addScaledVector(UP, Math.sin(a.age * 1.7 + a.seed * 2) * 0.18).normalize();
      if (dist < 950 && host.playerAlive) { a.state = 'strafe'; a.stateT = 0; }
      break;
    }
    case 'strafe': {
      aimPoint(host, a.pos, 430, _a);
      want.copy(_a).sub(a.pos).normalize();
      a.cd -= dt;
      if (a.cd <= 0 && dist < 1100 && dist > 160 && offBore(a, _a) < 0.2 && host.playerAlive) {
        shoot(host, a, 'bolt', 430, host.tuning.aimErr * 1.6);
        a.cd = rr(host.rng, 0.45, 0.9) / host.tuning.fireRate;
      }
      if (dist < 170 || a.stateT > 4 || a.dir.dot(toP) < 0.1) {
        a.state = 'break'; a.stateT = 0;
        a.a = host.rng() < 0.5 ? -1 : 1;
      }
      break;
    }
    default: { // break away, then come round again
      _b.crossVectors(a.dir, UP).normalize().multiplyScalar(a.a);
      want.copy(a.dir).addScaledVector(_b, 0.9).addScaledVector(UP, 0.35 * a.a).normalize();
      if (a.stateT > 1.7) { a.state = 'approach'; a.stateT = 0; }
    }
  }
  separate(host, a, want);
  shape(a, want, spec.minAgl);
  steer(a, want, dt, spec.turn);
  advance(a, dt);
}

/** Keep swarm-mates from stacking on one point. */
function separate(host: AiHost, a: Alien, want: Vector3): void {
  for (const o of host.aliens) {
    if (o === a || o.kind !== a.kind || o.dying > 0) continue;
    const d = a.pos.distanceTo(o.pos);
    if (d < 90 && d > 0.1) want.addScaledVector(_q.copy(a.pos).sub(o.pos).multiplyScalar(1 / d), (90 - d) / 90 * 0.9);
  }
  want.normalize();
}

function updateLancer(host: AiHost, a: Alien, dt: number): void {
  const spec = ALIEN_SPEC.lancer;
  const pl = host.player;
  const toP = _toP.copy(pl.pos).sub(a.pos);
  const dist = toP.length();
  toP.multiplyScalar(1 / Math.max(dist, 1));
  const want = _want.copy(toP);
  a.speed += ((spec.speed * (1 + 0.04 * (host.wave - 1)) * (dist > 2000 ? 1.25 : 1)) - a.speed) * damp(1.6, dt);
  a.b -= dt; // jink cooldown

  // is the player lining this ship up?
  _a.set(0, 0, -1).applyQuaternion(pl.q);
  const lined = host.playerAlive && _a.dot(_c.copy(a.pos).sub(pl.pos).normalize()) > 0.992 && dist < 1300;

  switch (a.state) {
    case 'approach': { // hunt
      aimPoint(host, a.pos, 600, _a);
      want.copy(_a).sub(a.pos).normalize();
      _b.crossVectors(want, UP).normalize();
      want.addScaledVector(_b, Math.sin(a.age * 1.3 + a.seed) * 0.12).normalize();
      if (dist < 1150 && offBore(a, pl.pos) < 0.45 && host.playerAlive) { a.state = 'attack'; a.stateT = 0; a.cd = 0.3; }
      break;
    }
    case 'attack': {
      aimPoint(host, a.pos, 560, _a);
      want.copy(_a).sub(a.pos).normalize();
      a.cd -= dt;
      if (a.burst > 0) {
        if (a.cd <= 0) {
          if (host.playerAlive) shoot(host, a, 'bolt', 560, host.tuning.aimErr);
          a.burst--;
          a.cd = 0.1;
          if (a.burst === 0) a.cd = rr(host.rng, 1.1, 1.8) / host.tuning.fireRate;
        }
      } else if (a.cd <= 0 && dist < 1050 && offBore(a, _a) < 0.12 && host.playerAlive) {
        a.burst = 3;
      }
      if (dist < 240 || a.stateT > 3.4 || a.dir.dot(toP) < 0.0) { a.state = 'break'; a.stateT = 0; a.a = host.rng() < 0.5 ? -1 : 1; }
      break;
    }
    case 'break': {
      _b.crossVectors(a.dir, UP).normalize().multiplyScalar(a.a);
      want.copy(a.dir).addScaledVector(_b, 1.4).addScaledVector(UP, a.a * -0.3).normalize();
      if (a.stateT > 1.9) { a.state = 'extend'; a.stateT = 0; }
      break;
    }
    default: { // extend away, climb a little, then turn back in
      want.copy(toP).multiplyScalar(-1).addScaledVector(UP, 0.18).normalize();
      if (a.stateT > 2.3 || dist > 1900) { a.state = 'approach'; a.stateT = 0; }
    }
  }
  // jink when the player lines the ship up (rate-limited so it still gets its own shots in)
  if ((a.state === 'approach' || a.state === 'attack') && lined && a.b <= 0) {
    a.state = 'break'; a.stateT = 0; a.a = host.rng() < 0.5 ? -1 : 1; a.b = 3.5; a.burst = 0;
  }
  shape(a, want, spec.minAgl);
  steer(a, want, dt, spec.turn);
  advance(a, dt);
}

function pickCity(host: AiHost, a: Alien): number {
  let best = -1, bestScore = Infinity;
  for (const c of host.cities) {
    if (!c.alive) continue;
    let crowd = 0;
    for (const o of host.aliens) if (o.kind === 'harvester' && o !== a && o.beamCity === c.site.id && o.dying <= 0) crowd++;
    const d = Math.hypot(c.site.x - a.pos.x, c.site.z - a.pos.z);
    const score = d + crowd * 1800;
    if (score < bestScore) { bestScore = score; best = c.site.id; }
  }
  return best;
}

function updateHarvester(host: AiHost, a: Alien, dt: number): void {
  const spec = ALIEN_SPEC.harvester;
  const city = a.beamCity >= 0 ? host.cities[a.beamCity] : undefined;
  if (!city || !city.alive) {
    a.beamCity = pickCity(host, a);
    a.beam = false;
    if (a.beamCity >= 0) host.msg(`Command: Harvester heading for ${host.cities[a.beamCity]!.site.name}`, 'warn');
    if (a.state === 'beam') { a.state = 'transit'; a.stateT = 0; }
  }
  const c = a.beamCity >= 0 ? host.cities[a.beamCity]! : undefined;
  const want = _want.copy(a.dir);
  if (c) {
    const hover = c.site.level + 360;
    const orbit = a.stateT * 0.14 + a.seed;
    const tx = c.site.x + (a.state === 'beam' ? Math.cos(orbit) * 110 : 0);
    const tz = c.site.z + (a.state === 'beam' ? Math.sin(orbit) * 110 : 0);
    _toP.set(tx - a.pos.x, hover - a.pos.y, tz - a.pos.z);
    const dist = _toP.length();
    if (a.state === 'transit') {
      want.copy(_toP).normalize();
      // a fast run-in from the edge of the arena, braking as it arrives, so the pilot has a window to intercept
      const run = Math.hypot(c.site.x - a.pos.x, c.site.z - a.pos.z);
      a.speed += (spec.speed * (run > 1500 ? 2.5 : run > 600 ? 1.4 : 1) - a.speed) * damp(1, dt);
      if (run < 260) { a.state = 'beam'; a.stateT = 0; }
    } else {
      // hold station over the target, drifting in a slow orbit
      a.speed += (clamp(dist * 0.6, 0, 40) - a.speed) * damp(1.5, dt);
      if (dist > 8) want.copy(_toP).normalize();
      a.beam = true;
      host.damageCity(c.site.id, 26 * host.tuning.damage * dt, a);
    }
  }
  // defend itself with a slow orb when the player is close
  a.cd -= dt;
  if (a.cd <= 0 && host.playerAlive && a.pos.distanceTo(host.player.pos) < 2300) {
    _b.copy(a.pos).y -= 14;
    shoot(host, a, 'orb', 300, host.tuning.aimErr * 2.2, _b);
    a.cd = rr(host.rng, 4.5, 7) / host.tuning.fireRate;
  }
  if (want.lengthSq() < 1e-6) want.copy(a.dir);
  want.normalize();
  steer(a, want, dt, spec.turn);
  advance(a, dt);
  // keep hovering saucers level in the render: they only tilt when travelling
  a.bank *= 0.9;
}

// ---- Leviathan ---------------------------------------------------------------------------------------------------

export const MOTHERSHIP_CENTER = new Vector3(-300, 2350, -2400);
const PATH_R = 1500;

export function podPosition(parent: Alien, slot: number, spin: number, out: Vector3): Vector3 {
  const ang = spin + (slot * Math.PI * 2) / 3;
  return out.set(parent.pos.x + Math.cos(ang) * POD_ORBIT, parent.pos.y + POD_DROP, parent.pos.z + Math.sin(ang) * POD_ORBIT);
}

function updateMothership(host: AiHost, a: Alien, dt: number): void {
  a.spin += 0.11 * dt;
  // drift around a wide ellipse over the sea and coast
  const ang = a.age * 0.0155 + a.seed;
  const nx = MOTHERSHIP_CENTER.x + Math.cos(ang) * PATH_R;
  const nz = MOTHERSHIP_CENTER.z + Math.sin(ang) * PATH_R * 0.8;
  const ny = MOTHERSHIP_CENTER.y + Math.sin(a.age * 0.05) * 60;
  _a.set(nx - a.pos.x, ny - a.pos.y, nz - a.pos.z);
  if (a.age < 0.05) a.pos.set(nx, ny, nz);
  else a.pos.lerp(_b.set(nx, ny, nz), clamp(dt * 1.2, 0, 1));
  _a.set(-Math.sin(ang), 0, Math.cos(ang) * 0.8).normalize();
  a.dir.copy(_a);
  a.vel.copy(_a).multiplyScalar(PATH_R * 0.0155);

  const pods = host.aliens.filter((o) => o.kind === 'pod' && o.parent === a && o.dying <= 0).length;
  const exposed = pods === 0;
  a.state = exposed ? 'exposed' : 'shielded';

  // spawn drones from the underside
  a.cd -= dt;
  if (a.cd <= 0) {
    const live = host.aliens.filter((o) => o.kind === 'wisp' && o.dying <= 0).length;
    if (live < 7 + host.wave) {
      for (let i = 0; i < 2; i++) {
        _b.set(a.pos.x + rr(host.rng, -120, 120), a.pos.y - 90, a.pos.z + rr(host.rng, -120, 120));
        host.spawnWisp(_b);
      }
    }
    a.cd = (exposed ? 9 : 13) / host.tuning.fireRate;
  }

  // city-killer beam, only once the core is exposed
  if (exposed) {
    a.b -= dt;
    if (a.beamCharge <= 0 && a.b <= 0 && !a.beam) {
      let best = -1, bd = Infinity;
      for (const c of host.cities) if (c.alive) {
        const d = Math.hypot(c.site.x - a.pos.x, c.site.z - a.pos.z) + host.rng() * 800;
        if (d < bd) { bd = d; best = c.site.id; }
      }
      if (best >= 0) { a.beamCity = best; a.beamCharge = 5; a.a = 0; }
      a.b = 26;
    }
    if (a.beamCharge > 0) {
      a.beamCharge -= dt;
      if (a.beamCharge <= 0) { a.beam = true; a.a = 3.2; }
    } else if (a.beam) {
      a.a -= dt;
      const c = host.cities[a.beamCity];
      if (c && c.alive) host.damageCity(a.beamCity, 330 * host.tuning.damage * dt, a);
      if (a.a <= 0) a.beam = false;
    }
  }
}

function updatePod(host: AiHost, a: Alien, dt: number): void {
  const m = a.parent;
  if (!m || m.dying > 0) return;
  podPosition(m, a.slot, m.spin, a.pos);
  a.dir.set(Math.cos(m.spin + a.slot * 2.09), 0, Math.sin(m.spin + a.slot * 2.09));
  a.cd -= dt;
  if (a.cd <= 0 && host.playerAlive && a.pos.distanceTo(host.player.pos) < 3400) {
    _b.copy(a.pos).y -= 20;
    shoot(host, a, 'orb', 250, host.tuning.aimErr * 1.8, _b);
    a.cd = rr(host.rng, 3.2, 4.8) / host.tuning.fireRate;
  }
}

function updateCore(host: AiHost, a: Alien, dt: number): void {
  const m = a.parent;
  if (!m || m.dying > 0) return;
  a.pos.set(m.pos.x, m.pos.y + CORE_DROP, m.pos.z);
  a.shielded = host.aliens.some((o) => o.kind === 'pod' && o.parent === m && o.dying <= 0);
  a.cd -= dt;
  if (!a.shielded && a.cd <= 0 && host.playerAlive && a.pos.distanceTo(host.player.pos) < 2600) {
    // exposed core lashes out with a triple orb volley
    for (let i = -1; i <= 1; i++) {
      _b.copy(a.pos).y -= 30;
      shoot(host, a, 'orb', 270, host.tuning.aimErr * 2.6 + Math.abs(i) * 0.05, _b);
    }
    a.cd = rr(host.rng, 4.5, 6) / host.tuning.fireRate;
  }
}

/** Advance one living alien by dt. Dying ships are handled by the world. */
export function updateAlien(host: AiHost, a: Alien, dt: number): void {
  a.age += dt;
  a.stateT += dt;
  if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt * 5);
  switch (a.kind) {
    case 'wisp': updateWisp(host, a, dt); break;
    case 'lancer': updateLancer(host, a, dt); break;
    case 'harvester': updateHarvester(host, a, dt); break;
    case 'mothership': updateMothership(host, a, dt); break;
    case 'pod': updatePod(host, a, dt); break;
    case 'core': updateCore(host, a, dt); break;
  }
}
