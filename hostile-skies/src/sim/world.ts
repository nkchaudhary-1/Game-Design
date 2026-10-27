// The mission: player, aliens, projectiles, cities, waves and win/lose. Pure simulation: no rendering, no audio.
// Everything the outside world needs to react to (explosions, shots, kills, messages) is pushed onto `events`, which
// the renderer, HUD and audio drain once per frame.

import { Quaternion, Vector3 } from 'three';
import {
  forwardOf, JET, newAircraft, stepAircraft, type Aircraft,
} from './aircraft';
import {
  ALIEN_SPEC, CORE_DROP, isTargetable, makeAlien, MOTHERSHIP_CENTER, MOTHERSHIP_HULL, updateAlien,
  type AiHost, type Alien, type AlienKind,
} from './aliens';
import type { Controls } from './controls';
import { newControls } from './controls';
import { TUNING, type Difficulty, type Tuning } from './difficulty';
import {
  ARENA_HARD_LIMIT, ARENA_RADIUS, CITY_SITES, SPAWN, surfaceHeight, timeToImpact, type CitySite,
} from './terrain';
import { clamp, DEG, G, makeRng, rr, type Rng } from './util';

export type SimEvent =
  | { type: 'explode'; pos: Vector3; size: number; kind: 'alien' | 'player' | 'ground' | 'missile' | 'boss' | 'city' }
  | { type: 'fire'; who: 'player' | 'alien'; pos: Vector3; kind: 'cannon' | 'missile' | 'bolt' | 'orb' }
  | { type: 'hit'; target: 'player' | 'alien' | 'hull' | 'shield' | 'city'; pos: Vector3; amount: number; broke?: boolean }
  | { type: 'kill'; kind: AlienKind; pos: Vector3; score: number; combo: number }
  | { type: 'warp'; pos: Vector3 }
  | { type: 'wave'; n: number; total: number; phase: 'start' | 'clear'; title: string }
  | { type: 'msg'; text: string; tone: 'info' | 'warn' | 'good' | 'bad' }
  | { type: 'win' }
  | { type: 'lose'; reason: string };

export interface Bullet { pos: Vector3; prev: Vector3; vel: Vector3; life: number }
export interface Bolt {
  pos: Vector3; prev: Vector3; vel: Vector3; life: number; dmg: number; kind: 'bolt' | 'orb'; radius: number; owner: number;
}
export interface Missile {
  id: number; pos: Vector3; prev: Vector3; dir: Vector3; speed: number; life: number; age: number; target: Alien | null;
}
export interface City {
  site: CitySite; hp: number; maxHp: number; alive: boolean;
  /** Seconds since last damaged (drives the "under attack" state). */
  hurtT: number;
  warnT: number;
}

export interface WaveDef { title: string; wisps: number; lancers: number; harvesters: number; boss?: boolean }
export const WAVES: readonly WaveDef[] = [
  { title: 'FIRST CONTACT', wisps: 5, lancers: 0, harvesters: 1 },
  { title: 'HARVEST', wisps: 4, lancers: 2, harvesters: 2 },
  { title: 'SWARM', wisps: 7, lancers: 3, harvesters: 2 },
  { title: 'ARMADA', wisps: 8, lancers: 4, harvesters: 3 },
  { title: 'LEVIATHAN', wisps: 4, lancers: 0, harvesters: 0, boss: true },
];

export interface Stats {
  kills: Record<AlienKind, number>;
  shots: number;
  hits: number;
  missilesFired: number;
  damageTaken: number;
  maxCombo: number;
  time: number;
}

interface Spawn { t: number; kind: AlienKind }

export interface WorldOptions {
  seed?: number;
  difficulty?: Difficulty;
  assist?: boolean;
  /** Jump straight to this wave (1-based). Test and QA aid. */
  startWave?: number;
  /** Take no damage. QA aid. */
  god?: boolean;
}

export const CANNON = { rate: 18, speed: 1050, life: 1.4, damage: 9, heatPerShot: 1.15, cool: 26 } as const;
export const MISSILE = { speed: 470, turn: 3.6, life: 7, damage: 170, blast: 80, max: 8, regen: 11 } as const;
export const LOCK = { cone: 14 * DEG, minRange: 150, maxRange: 5200, time: 1 } as const;

const _f = new Vector3(), _r = new Vector3(), _u = new Vector3(), _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

/** Parameter along p0->p1 (0..1) of the closest approach to c, or -1 if it stays outside r. */
function segSphere(p0: Vector3, p1: Vector3, c: Vector3, r: number): number {
  _a.subVectors(p1, p0);
  const len2 = _a.lengthSq();
  const t = len2 < 1e-9 ? 0 : clamp(-_b.subVectors(p0, c).dot(_a) / len2, 0, 1);
  _c.copy(p0).addScaledVector(_a, t);
  return _c.distanceToSquared(c) <= r * r ? t : -1;
}

export class World implements AiHost {
  time = 0;
  rng: Rng;
  tuning: Tuning;
  difficulty: Difficulty;
  assist: boolean;
  god: boolean;

  // ---- player ----
  ac: Aircraft = newAircraft(SPAWN.x, SPAWN.y, SPAWN.z);
  playerAlive = true;
  hull = 100;
  shield = 100;
  shieldDelay = 0;
  heat = 0;
  overheated = false;
  missiles = 6;
  target: Alien | null = null;
  lock = 0;
  /** Seconds until impact along the current path (Infinity when clear). */
  tti = Infinity;
  /** Seconds spent outside the combat area. */
  oobT = 0;
  damageFlash = 0;
  deathCause = '';
  /** Which gun fired last and how long ago (renderer muzzle flashes). */
  muzzleT = 0;

  // ---- world ----
  aliens: Alien[] = [];
  bullets: Bullet[] = [];
  bolts: Bolt[] = [];
  shots: Missile[] = [];
  cities: City[];
  events: SimEvent[] = [];
  state: 'play' | 'won' | 'lost' = 'play';
  endReason = '';

  // ---- progress ----
  wave = 0;
  waveState: 'pre' | 'active' | 'clear' | 'done' = 'pre';
  waveT = 4;
  score = 0;
  combo = 0;
  comboT = 0;
  stats: Stats = {
    kills: { wisp: 0, lancer: 0, harvester: 0, mothership: 0, pod: 0, core: 0 },
    shots: 0, hits: 0, missilesFired: 0, damageTaken: 0, maxCombo: 0, time: 0,
  };

  private nextId = 1;
  private queue: Spawn[] = [];
  private fireCd = 0;
  private missileCd = 0;
  private missileRegen = 0;
  private heatDelay = 0;
  private prevMissile = false;
  private prevCycle = false;
  private endT = 0;
  private boss: Alien | null = null;
  private lancerWarned = false;
  private muzzleSide = 1;

  constructor(opts: WorldOptions = {}) {
    this.rng = makeRng(opts.seed ?? 1);
    this.difficulty = opts.difficulty ?? 'pilot';
    this.tuning = TUNING[this.difficulty];
    this.assist = opts.assist ?? true;
    this.god = opts.god ?? false;
    this.cities = CITY_SITES.map((site) => ({ site, hp: site.hp, maxHp: site.hp, alive: true, hurtT: 99, warnT: 0 }));
    if (opts.startWave && opts.startWave > 1) {
      this.wave = Math.min(opts.startWave, WAVES.length) - 1;
      this.waveT = 0.5;
    }
    this.msg('Command: Hostiles on approach. Defend the cities.', 'info');
  }

  // ---- AiHost ----------------------------------------------------------------------------------------------------

  fire(from: Alien, origin: Vector3, dir: Vector3, kind: 'bolt' | 'orb', speed: number): void {
    const dmgBase = from.kind === 'wisp' ? 6 : from.kind === 'lancer' ? 9 : from.kind === 'harvester' ? 17 : 22;
    const pos = origin.clone().addScaledVector(dir, from.radius * 0.8);
    this.bolts.push({
      pos, prev: pos.clone(), vel: dir.clone().multiplyScalar(speed), life: kind === 'orb' ? 9 : 4.5,
      dmg: dmgBase * this.tuning.damage, kind, radius: kind === 'orb' ? 9 : 3.5, owner: from.id,
    });
    this.events.push({ type: 'fire', who: 'alien', pos: pos.clone(), kind });
  }

  damageCity(id: number, amount: number, _from: Alien): void {
    const c = this.cities[id];
    if (!c || !c.alive) return;
    c.hp = Math.max(0, c.hp - amount);
    c.hurtT = 0;
    if (c.hp <= 0) {
      c.alive = false;
      this.events.push({ type: 'explode', pos: new Vector3(c.site.x, c.site.level + 40, c.site.z), size: 420, kind: 'city' });
      this.msg(`${c.site.name} HAS FALLEN`, 'bad');
      if (this.cities.every((k) => !k.alive)) this.lose('ALL CITIES LOST');
    }
  }

  spawnWisp(pos: Vector3): void {
    const a = makeAlien(this.nextId++, 'wisp', pos, this.tuning, this.rng, _a.copy(this.ac.pos).sub(pos).normalize());
    this.aliens.push(a);
    this.events.push({ type: 'warp', pos: pos.clone() });
  }

  // ---- bookkeeping -----------------------------------------------------------------------------------------------

  get hostiles(): number {
    let n = 0;
    for (const a of this.aliens) if (a.dying <= 0 && a.kind !== 'mothership' && a.kind !== 'pod' && a.kind !== 'core') n++;
    return n + this.queue.length;
  }

  get bossAlive(): boolean { return !!this.boss && !this.boss.gone; }

  /** Boss health for the HUD: each node plus the core. */
  bossHealth(): { nodes: number[]; core: number; coreExposed: boolean; total: number } | null {
    const m = this.boss;
    if (!m || m.gone) return null;
    const nodes = this.aliens.filter((a) => a.kind === 'pod' && a.parent === m).map((a) => Math.max(0, a.hp / a.maxHp));
    const core = this.aliens.find((a) => a.kind === 'core' && a.parent === m);
    const coreFrac = core ? Math.max(0, core.hp / core.maxHp) : 0;
    const total = (nodes.reduce((s, n) => s + n, 0) + coreFrac * 2) / (nodes.length + 2 || 1);
    return { nodes, core: coreFrac, coreExposed: !!core && !core.shielded, total };
  }

  msg(text: string, tone: 'info' | 'warn' | 'good' | 'bad' = 'info'): void { this.events.push({ type: 'msg', text, tone }); }

  private explode(pos: Vector3, size: number, kind: 'alien' | 'player' | 'ground' | 'missile' | 'boss' | 'city'): void {
    this.events.push({ type: 'explode', pos: pos.clone(), size, kind });
  }

  private addScore(base: number): number {
    const mult = 1 + Math.min(this.combo, 10) * 0.1;
    const pts = Math.round(base * mult);
    this.score += pts;
    this.combo++;
    this.comboT = 5;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    return pts;
  }

  private lose(reason: string): void {
    if (this.state !== 'play') return;
    this.state = 'lost';
    this.endReason = reason;
    this.endT = 2.4;
    this.events.push({ type: 'lose', reason });
  }

  // ---- player damage ---------------------------------------------------------------------------------------------

  damagePlayer(amount: number, pos: Vector3, cause: string): void {
    if (!this.playerAlive || this.god || amount <= 0) return;
    this.stats.damageTaken += amount;
    const wasShield = this.shield > 0;
    const soak = Math.min(this.shield, amount);
    this.shield -= soak;
    this.hull -= amount - soak;
    this.shieldDelay = 5;
    this.damageFlash = 1;
    this.events.push({ type: 'hit', target: 'player', pos: pos.clone(), amount, broke: wasShield && this.shield <= 0 });
    if (wasShield && this.shield <= 0) this.msg('SHIELD DOWN', 'warn');
    if (this.hull <= 0) this.killPlayer(cause);
  }

  killPlayer(cause: string): void {
    if (!this.playerAlive || this.god) return;
    this.playerAlive = false;
    this.hull = 0;
    this.deathCause = cause;
    this.combo = 0;
    this.explode(this.ac.pos, 160, cause === 'CRASHED' ? 'ground' : 'player');
    this.msg(cause === 'CRASHED' ? 'Command: Interceptor down.' : 'Command: We lost the interceptor.', 'bad');
    this.lose(cause);
  }

  // ---- alien damage ----------------------------------------------------------------------------------------------

  damageAlien(a: Alien, amount: number, pos: Vector3): void {
    if (a.dying > 0 || a.gone) return;
    if (a.kind === 'core' && a.shielded) {
      this.events.push({ type: 'hit', target: 'shield', pos: pos.clone(), amount: 0 });
      return;
    }
    a.hp -= amount;
    a.hitFlash = 1;
    this.events.push({ type: 'hit', target: 'alien', pos: pos.clone(), amount });
    if (a.hp <= 0) this.killAlien(a, true);
  }

  private killAlien(a: Alien, award: boolean): void {
    if (a.dying > 0 || a.gone) return;
    a.hp = 0;
    a.beam = false;
    const spec = ALIEN_SPEC[a.kind];
    if (award) {
      this.stats.kills[a.kind]++;
      const pts = this.addScore(spec.score);
      this.events.push({ type: 'kill', kind: a.kind, pos: a.pos.clone(), score: pts, combo: this.combo });
    }
    switch (a.kind) {
      case 'wisp':
        this.explode(a.pos, 55, 'alien'); a.gone = true; break;
      case 'pod':
        this.explode(a.pos, 150, 'boss'); a.gone = true;
        this.msg('Shield node destroyed', 'good');
        if (!this.aliens.some((o) => o.kind === 'pod' && o.parent === a.parent && o !== a && !o.gone && o.dying <= 0)) {
          this.msg('Command: Leviathan core exposed — hit it now!', 'good');
        }
        break;
      case 'lancer':
        a.dying = a.dyingMax = 1.6; a.vel.copy(a.dir).multiplyScalar(a.speed * 0.8); a.a = this.rng() < 0.5 ? -1 : 1; break;
      case 'harvester':
        a.dying = a.dyingMax = 1.2; a.vel.set(0, -35, 0); a.a = this.rng() < 0.5 ? -1 : 1;
        this.msg('Harvester down', 'good');
        break;
      case 'core': {
        a.dying = a.dyingMax = 5.5;
        const m = a.parent;
        if (m) { m.dying = m.dyingMax = 5.5; m.beam = false; m.beamCharge = 0; }
        this.msg('Command: Leviathan is breaking up!', 'good');
        // the rest of the fleet loses its link and falls out of the sky
        for (const o of this.aliens) {
          if (o === a || o === m || o.dying > 0 || o.gone) continue;
          if (o.kind === 'pod') continue;
          o.hp = 0; o.dying = o.dyingMax = rr(this.rng, 0.4, 3); o.beam = false;
          o.vel.copy(o.dir).multiplyScalar(o.speed * 0.6); o.a = this.rng() < 0.5 ? -1 : 1;
        }
        this.queue.length = 0;
        break;
      }
      default: break;
    }
  }

  private updateDying(a: Alien, dt: number): void {
    a.dying -= dt;
    a.age += dt;
    const m = a.kind === 'core' ? a.parent : null;
    if (a.kind === 'core' || a.kind === 'mothership') {
      // chain of blasts across the breaking hull
      a.cd -= dt;
      if (a.cd <= 0) {
        a.cd = 0.16;
        const base = (m ?? a).pos;
        _a.set(rr(this.rng, -300, 300), rr(this.rng, -120, 20), rr(this.rng, -300, 300));
        this.explode(_b.copy(base).add(_a), rr(this.rng, 70, 160), 'boss');
      }
    } else {
      a.vel.y -= 28 * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.cd -= dt;
      if (a.cd <= 0) { a.cd = 0.22; this.explode(a.pos, a.kind === 'harvester' ? 70 : 26, 'alien'); }
      const ground = surfaceHeight(a.pos.x, a.pos.z);
      if (a.pos.y < ground + 4) { a.dying = Math.min(a.dying, 0); }
    }
    if (a.dying <= 0) {
      if (a.kind === 'core') {
        this.explode(a.pos, 520, 'boss');
        a.gone = true;
        if (a.parent) { a.parent.gone = true; this.explode(a.parent.pos, 700, 'boss'); }
        this.finishWave();
      } else if (a.kind !== 'mothership') {
        this.explode(a.pos, a.kind === 'harvester' ? 220 : a.kind === 'lancer' ? 110 : 55, a.pos.y < surfaceHeight(a.pos.x, a.pos.z) + 8 ? 'ground' : 'alien');
        a.gone = true;
      }
    }
  }

  // ---- waves -----------------------------------------------------------------------------------------------------

  private startWave(): void {
    const def = WAVES[this.wave]!;
    this.wave++;
    this.waveState = 'active';
    this.lancerWarned = false;
    const k = this.tuning.count;
    const n = (v: number) => (v === 0 ? 0 : Math.max(1, Math.round(v * k)));
    this.queue = [];
    let t = 0;
    for (let i = 0; i < n(def.harvesters); i++) { this.queue.push({ t, kind: 'harvester' }); t += 3; }
    for (let i = 0; i < n(def.wisps); i++) { this.queue.push({ t: 1 + i * 0.5, kind: 'wisp' }); }
    for (let i = 0; i < n(def.lancers); i++) { this.queue.push({ t: 7 + i * 2.5, kind: 'lancer' }); }
    this.queue.sort((a, b) => a.t - b.t);
    this.waveT = 0;
    if (def.boss) this.spawnBoss();
    this.events.push({ type: 'wave', n: this.wave, total: WAVES.length, phase: 'start', title: def.title });
    this.msg(def.boss ? 'Command: Massive contact. Leviathan has dropped out of warp.' : `Wave ${this.wave}: ${def.title}`, def.boss ? 'bad' : 'info');
    if (this.wave === 1) this.msg('Harvesters burn cities. Stop them first.', 'info');
  }

  private spawnBoss(): void {
    const m = makeAlien(this.nextId++, 'mothership', MOTHERSHIP_CENTER, this.tuning, this.rng);
    m.seed = 0.4;
    m.cd = 8;
    m.b = 18;
    this.boss = m;
    this.aliens.push(m);
    for (let i = 0; i < 3; i++) {
      const p = makeAlien(this.nextId++, 'pod', m.pos, this.tuning, this.rng);
      p.parent = m; p.slot = i; p.cd = 3 + i * 1.3;
      this.aliens.push(p);
    }
    const core = makeAlien(this.nextId++, 'core', m.pos, this.tuning, this.rng);
    core.parent = m; core.shielded = true; core.pos.y += CORE_DROP;
    this.aliens.push(core);
    this.events.push({ type: 'warp', pos: m.pos.clone() });
  }

  private spawnPosition(kind: AlienKind, out: Vector3): Vector3 {
    const rng = this.rng;
    if (kind === 'harvester') {
      const ang = rng() * Math.PI * 2;
      const r = ARENA_RADIUS - 900;
      return out.set(Math.cos(ang) * r, 0, Math.sin(ang) * r).setY(Math.max(700, surfaceHeight(Math.cos(ang) * r, Math.sin(ang) * r) + 500) + rng() * 300);
    }
    forwardOf(this.ac, _f);
    const base = Math.atan2(_f.x, _f.z);
    const ang = base + rr(rng, -1.7, 1.7);
    const dist = rr(rng, 3600, 5200);
    let x = this.ac.pos.x + Math.sin(ang) * dist;
    let z = this.ac.pos.z + Math.cos(ang) * dist;
    const r = Math.hypot(x, z);
    if (r > ARENA_RADIUS - 800) { const s = (ARENA_RADIUS - 800) / r; x *= s; z *= s; }
    const y = Math.max(surfaceHeight(x, z) + 260, clamp(this.ac.pos.y + rr(rng, -300, 300), 450, 1500));
    return out.set(x, y, z);
  }

  private updateDirector(dt: number): void {
    if (this.state !== 'play' || !this.playerAlive) return;
    if (this.waveState === 'pre' || this.waveState === 'clear') {
      this.waveT -= dt;
      if (this.waveT <= 0) {
        if (this.wave >= WAVES.length) { this.waveState = 'done'; return; }
        this.startWave();
      }
      return;
    }
    if (this.waveState !== 'active') return;
    this.waveT += dt;
    while (this.queue.length && this.queue[0]!.t <= this.waveT) {
      const s = this.queue.shift()!;
      const pos = this.spawnPosition(s.kind, new Vector3());
      const a = makeAlien(this.nextId++, s.kind, pos, this.tuning, this.rng, _a.copy(s.kind === 'harvester' ? _b.set(0, pos.y, 0) : this.ac.pos).sub(pos).normalize());
      this.aliens.push(a);
      this.events.push({ type: 'warp', pos: pos.clone() });
      if (s.kind === 'lancer' && !this.lancerWarned) { this.lancerWarned = true; this.msg('Command: Lancer fighters inbound', 'warn'); }
    }
    if (this.hostiles === 0 && !WAVES[this.wave - 1]?.boss) this.finishWave();
  }

  private finishWave(): void {
    if (this.waveState === 'clear' || this.waveState === 'done') return;
    const def = WAVES[this.wave - 1];
    if (def?.boss) {
      this.waveState = 'done';
      const saved = this.cities.filter((c) => c.alive).length;
      this.score += 1500 * saved;
      this.state = 'won';
      this.endT = 3;
      this.endReason = 'LEVIATHAN DESTROYED';
      this.msg('Command: The Leviathan is down. Outstanding flying.', 'good');
      this.events.push({ type: 'win' });
      return;
    }
    this.waveState = 'clear';
    this.waveT = 8 * this.tuning.breather;
    const cityBonus = this.cities.filter((c) => c.alive).reduce((s, c) => s + Math.round((c.hp / c.maxHp) * 300), 0);
    const bonus = 500 * this.wave + cityBonus;
    this.score += bonus;
    this.hull = Math.min(100, this.hull + 35);
    this.shield = 100;
    this.missiles = Math.min(MISSILE.max, this.missiles + 3);
    this.events.push({ type: 'wave', n: this.wave, total: WAVES.length, phase: 'clear', title: `+${bonus}` });
    this.msg('Wave clear. Hull patched, missiles resupplied.', 'good');
  }

  // ---- player weapons --------------------------------------------------------------------------------------------

  private updateTargeting(dt: number, cycle: boolean): void {
    const ac = this.ac;
    forwardOf(ac, _f);
    if (this.target && (this.target.dying > 0 || this.target.gone || (this.target.kind === 'core' && this.target.shielded))) this.target = null;

    const cands: { a: Alien; ang: number; d: number }[] = [];
    for (const a of this.aliens) {
      if (!isTargetable(a) || a.gone || (a.kind === 'core' && a.shielded)) continue;
      const d = _a.copy(a.pos).sub(ac.pos).length();
      if (d > 9000) continue;
      cands.push({ a, ang: Math.acos(clamp(_f.dot(_a.multiplyScalar(1 / Math.max(d, 1))), -1, 1)), d });
    }
    if (cycle && cands.length) {
      cands.sort((p, q) => p.ang - q.ang);
      const i = cands.findIndex((c) => c.a === this.target);
      this.target = cands[(i + 1) % cands.length]!.a;
      this.lock = 0;
    } else if (!this.target && cands.length) {
      let best = cands[0]!, bs = Infinity;
      for (const c of cands) { const s = c.ang + c.d / 9000; if (s < bs) { bs = s; best = c; } }
      this.target = best.a;
      this.lock = 0;
    }
    const t = this.target;
    if (t) {
      _a.copy(t.pos).sub(ac.pos);
      const d = _a.length();
      const ang = Math.acos(clamp(_f.dot(_a.multiplyScalar(1 / Math.max(d, 1))), -1, 1));
      if (ang < LOCK.cone && d > LOCK.minRange && d < LOCK.maxRange) this.lock = Math.min(1, this.lock + dt * (ang < LOCK.cone * 0.5 ? 1.6 : 1) / LOCK.time);
      else this.lock = Math.max(0, this.lock - dt * 2);
    } else this.lock = 0;
  }

  private fireCannon(dt: number, firing: boolean): void {
    const ac = this.ac;
    this.fireCd -= dt;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    if (this.overheated && this.heat <= 40) this.overheated = false;
    if (firing && !this.overheated && this.playerAlive) {
      forwardOf(ac, _f);
      _r.set(1, 0, 0).applyQuaternion(ac.q);
      _u.set(0, 1, 0).applyQuaternion(ac.q);
      let guard = 0;
      while (this.fireCd <= 0 && guard++ < 4) {
        this.fireCd += 1 / CANNON.rate;
        this.muzzleSide = -this.muzzleSide;
        const pos = ac.pos.clone().addScaledVector(_f, 7).addScaledVector(_r, 2.2 * this.muzzleSide).addScaledVector(_u, -0.5);
        const dir = _a.copy(_f).addScaledVector(_r, (this.rng() - 0.5) * 0.007).addScaledVector(_u, (this.rng() - 0.5) * 0.007).normalize();
        this.bullets.push({ pos, prev: pos.clone(), vel: dir.clone().multiplyScalar(CANNON.speed).add(ac.vel), life: CANNON.life });
        this.stats.shots++;
        this.heat += CANNON.heatPerShot;
        this.heatDelay = 0.25;
        this.muzzleT = 0.06;
        this.events.push({ type: 'fire', who: 'player', pos: pos.clone(), kind: 'cannon' });
      }
      if (this.heat >= 100) { this.heat = 100; this.overheated = true; this.msg('CANNON OVERHEAT', 'warn'); }
    } else {
      this.fireCd = Math.min(this.fireCd, 0);
      this.heatDelay -= dt;
      if (this.heatDelay <= 0) this.heat = Math.max(0, this.heat - CANNON.cool * dt * (this.overheated ? 0.7 : 1));
    }
  }

  private launchMissile(): void {
    if (!this.playerAlive || this.missiles <= 0 || this.missileCd > 0) return;
    const ac = this.ac;
    forwardOf(ac, _f);
    _r.set(1, 0, 0).applyQuaternion(ac.q);
    const pos = ac.pos.clone().addScaledVector(_f, 3).addScaledVector(_r, 3.2 * -this.muzzleSide).addScaledVector(_u.set(0, 1, 0).applyQuaternion(ac.q), -1.1);
    const locked = this.target && this.lock >= 1 ? this.target : null;
    this.shots.push({
      id: this.nextId++, pos, prev: pos.clone(), dir: _f.clone(), speed: Math.max(ac.speed, 170), life: MISSILE.life, age: 0, target: locked,
    });
    this.missiles--;
    this.missileCd = 0.55;
    this.stats.missilesFired++;
    this.events.push({ type: 'fire', who: 'player', pos: pos.clone(), kind: 'missile' });
    if (locked) this.lock = 0;
  }

  private detonate(m: Missile): void {
    this.explode(m.pos, 95, 'missile');
    for (const a of this.aliens) {
      if (a.dying > 0 || a.gone || a.kind === 'mothership') continue;
      const d = a.pos.distanceTo(m.pos);
      const reach = MISSILE.blast + a.radius;
      if (d < reach) {
        this.stats.hits++;
        this.damageAlien(a, MISSILE.damage * (1 - 0.55 * (d / reach)), m.pos);
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const hull = this.boss && !this.boss.gone ? this.boss : null;
    // cannon rounds
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      let bestT = 2, who: Alien | null = null;
      for (const a of this.aliens) {
        if (a.dying > 0 || a.gone || a.kind === 'mothership') continue;
        const t = segSphere(b.prev, b.pos, a.pos, a.radius * 1.3 + 3);
        if (t >= 0 && t < bestT) { bestT = t; who = a; }
      }
      let hullT = 2;
      if (hull) {
        // transform to the hull ellipsoid's unit space
        const s = this.segEllipsoid(b.prev, b.pos, hull.pos);
        if (s >= 0) hullT = s;
      }
      if (who && bestT <= hullT) {
        this.stats.hits++;
        _a.copy(b.prev).lerp(b.pos, bestT);
        this.damageAlien(who, CANNON.damage, _a);
        hit = true;
      } else if (hullT < 2) {
        _a.copy(b.prev).lerp(b.pos, hullT);
        this.events.push({ type: 'hit', target: 'hull', pos: _a.clone(), amount: 0 });
        hit = true;
      } else if (b.pos.y < surfaceHeight(b.pos.x, b.pos.z)) {
        this.explode(b.pos, 8, 'ground');
        hit = true;
      }
      if (hit || b.life <= 0) this.bullets.splice(i, 1);
    }

    // alien bolts and orbs
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let gone = b.life <= 0;
      if (!gone && this.playerAlive && segSphere(b.prev, b.pos, this.ac.pos, JET.radius + b.radius) >= 0) {
        this.damagePlayer(b.dmg, b.pos, 'SHOT DOWN');
        this.explode(b.pos, b.kind === 'orb' ? 26 : 10, 'alien');
        gone = true;
      } else if (!gone && b.pos.y < surfaceHeight(b.pos.x, b.pos.z)) gone = true;
      if (gone) this.bolts.splice(i, 1);
    }

    // missiles
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const m = this.shots[i]!;
      m.prev.copy(m.pos);
      m.age += dt;
      m.life -= dt;
      if (m.target && (m.target.dying > 0 || m.target.gone)) m.target = null;
      if (m.age > 0.3) {
        if (m.target) {
          _a.copy(m.target.pos).addScaledVector(m.target.vel, clamp(m.pos.distanceTo(m.target.pos) / m.speed, 0, 3) * 0.9).sub(m.pos).normalize();
          const ang = Math.acos(clamp(m.dir.dot(_a), -1, 1));
          const maxA = MISSILE.turn * dt;
          if (ang <= maxA) m.dir.copy(_a);
          else {
            _b.crossVectors(m.dir, _a);
            if (_b.lengthSq() > 1e-9) m.dir.applyAxisAngle(_b.normalize(), maxA).normalize();
          }
        }
        m.speed += (MISSILE.speed - m.speed) * Math.min(1, dt * 2.2);
      }
      m.pos.addScaledVector(m.dir, m.speed * dt);

      let boom = m.life <= 0;
      if (!boom) {
        for (const a of this.aliens) {
          if (a.dying > 0 || a.gone || a.kind === 'mothership') continue;
          if (segSphere(m.prev, m.pos, a.pos, a.radius + 16) >= 0) { boom = true; break; }
        }
      }
      if (!boom && m.pos.y < surfaceHeight(m.pos.x, m.pos.z) + 2) boom = true;
      if (!boom && hull && this.segEllipsoid(m.prev, m.pos, hull.pos) >= 0) boom = true;
      if (boom) { this.detonate(m); this.shots.splice(i, 1); }
    }
  }

  /** First hit (0..1) of segment p0->p1 with the Leviathan's hull, or -1. */
  private segEllipsoid(p0: Vector3, p1: Vector3, c: Vector3): number {
    const { rx, ry, rz } = MOTHERSHIP_HULL;
    const steps = 6;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = (p0.x + (p1.x - p0.x) * t - c.x) / rx;
      const y = (p0.y + (p1.y - p0.y) * t - c.y) / ry;
      const z = (p0.z + (p1.z - p0.z) * t - c.z) / rz;
      if (x * x + y * y + z * z < 1) return t;
    }
    return -1;
  }

  // ---- main step -------------------------------------------------------------------------------------------------

  step(dt: number, c: Controls = newControls()): void {
    this.time += dt;
    if (this.state === 'play') this.stats.time += dt;
    this.events.length = Math.min(this.events.length, 400);
    const ac = this.ac;

    // ---- player ----
    if (this.playerAlive) {
      stepAircraft(ac, c, dt, this.assist);
      this.tti = timeToImpact(ac.pos.x, ac.pos.y, ac.pos.z, ac.vel.x, ac.vel.y, ac.vel.z, 20, 5);

      const cycle = c.cycleTarget && !this.prevCycle;
      this.prevCycle = c.cycleTarget;
      this.updateTargeting(dt, cycle);
      this.fireCannon(dt, c.fire);

      this.missileCd -= dt;
      if (c.missile && !this.prevMissile) this.launchMissile();
      this.prevMissile = c.missile;
      if (this.missiles < 6) {
        this.missileRegen += dt;
        if (this.missileRegen >= MISSILE.regen) { this.missileRegen = 0; this.missiles++; }
      } else this.missileRegen = 0;

      if (this.shieldDelay > 0) this.shieldDelay -= dt;
      else this.shield = Math.min(100, this.shield + 14 * dt);
      this.damageFlash = Math.max(0, this.damageFlash - dt * 2.4);

      // hazards
      const ground = surfaceHeight(ac.pos.x, ac.pos.z);
      if (ac.pos.y < ground + 3.5) { this.killPlayer('CRASHED'); }
      for (const city of this.cities) {
        const d = Math.hypot(ac.pos.x - city.site.x, ac.pos.z - city.site.z);
        if (city.alive && d < city.site.radius * 0.7 && ac.pos.y < city.site.level + 52) { this.killPlayer('CRASHED INTO THE CITY'); break; }
      }
      const boss = this.boss && !this.boss.gone ? this.boss : null;
      if (boss) {
        const { rx, ry, rz } = MOTHERSHIP_HULL;
        const dx = (ac.pos.x - boss.pos.x) / rx, dy = (ac.pos.y - boss.pos.y) / ry, dz = (ac.pos.z - boss.pos.z) / rz;
        if (dx * dx + dy * dy + dz * dz < 1) this.killPlayer('HIT THE LEVIATHAN');
      }
      const r = Math.hypot(ac.pos.x, ac.pos.z);
      if (r > ARENA_RADIUS) {
        this.oobT += dt;
        if (r > ARENA_HARD_LIMIT || this.oobT > 12) this.killPlayer('LEFT THE COMBAT AREA');
      } else this.oobT = Math.max(0, this.oobT - dt * 2);
    } else {
      // wreck: coast and fall so the camera has something to follow
      ac.vel.y -= G * dt; ac.vel.multiplyScalar(1 - 0.5 * dt);
      ac.pos.addScaledVector(ac.vel, dt);
      ac.speed = ac.vel.length();
      this.target = null;
    }

    // ---- aliens ----
    for (const a of this.aliens) {
      if (a.gone) continue;
      if (a.dying > 0) this.updateDying(a, dt);
      else updateAlien(this, a, dt);
    }
    for (let i = this.aliens.length - 1; i >= 0; i--) if (this.aliens[i]!.gone) this.aliens.splice(i, 1);

    // ramming
    if (this.playerAlive) {
      for (const a of this.aliens) {
        if (a.dying > 0 || a.kind === 'mothership') continue;
        if (a.pos.distanceTo(ac.pos) < a.radius + 8) {
          const big = a.kind === 'harvester' || a.kind === 'pod' || a.kind === 'core';
          this.damagePlayer(big ? 120 : a.kind === 'lancer' ? 45 : 25, a.pos, 'COLLISION');
          if (!big) this.killAlien(a, true);
          else this.damageAlien(a, 150, a.pos);
        }
      }
    }

    this.updateProjectiles(dt);

    // ---- cities ----
    for (const city of this.cities) {
      city.hurtT += dt;
      city.warnT -= dt;
      if (city.alive && city.hurtT < 0.5 && city.warnT <= 0) {
        city.warnT = 14;
        this.msg(`${city.site.name} UNDER ATTACK`, city.hp < city.maxHp * 0.5 ? 'bad' : 'warn');
      }
    }

    // ---- scoring clock, director, end ----
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    this.updateDirector(dt);
    if (this.state !== 'play') this.endT -= dt;
  }

  /** True once the end-of-mission beat has played out and the result screen should appear. */
  get finished(): boolean { return this.state !== 'play' && this.endT <= 0; }

  get player(): Aircraft { return this.ac; }

  get accuracy(): number { return this.stats.shots ? this.stats.hits / this.stats.shots : 0; }

  /** Quaternion of the player's aircraft, for convenience in the renderer. */
  get q(): Quaternion { return this.ac.q; }
}
