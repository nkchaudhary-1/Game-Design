// Arena hazards. Every arena has ONE mechanic (build spec §11); Core Pit has none. Each mechanic is a Hazard: it
// pushes blades, hurts them or hands out buffs from inside the fixed step, tells the AI what to stay clear of and
// what is worth a detour, and exposes the state the renderer draws (phase, angle, crystals…). Pure TypeScript, so the
// exact same code runs in the browser and in the headless balance harness.

import { TUNING } from '../core/Balance';
import { clamp, TAU } from '../core/types';
import type { Rng } from '../core/Rng';
import type { BladeRuntime } from '../blades/Blade';
import type { ModFlag, ModSet } from '../blades/effects';
import { addVelocity, knock } from '../combat/EffectSystem';
import { gainSpin } from '../combat/SpinSystem';
import type { ArenaEventKind } from '../combat/events';
import type { Match } from '../combat/Match';

export interface Pickup { x: number; z: number; value: number }

export interface Hazard {
  readonly id: string;
  /** Called every fixed step before physics. May push blades, drain spin, hand out buffs. */
  update(match: Match, dt: number): void;
  /** Floor height this mechanic adds at a point (Elevation Ring). */
  heightAt?(x: number, z: number): number;
  /** 0–1: how much a blade should avoid standing here right now. */
  danger?(x: number, z: number, match: Match): number;
  /** Things worth a detour (Crystal Arena). */
  pickups?(match: Match): Pickup[];
}

const smooth = (x: number, a: number, b: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const live = (m: Match): BladeRuntime[] => m.blades.filter((b) => b.launched && b.alive && !b.fallen);
/** How much the arena's pushes move this blade: stable, heavy blades resist them, but nothing ignores them. */
const ext = (b: BladeRuntime): number => 0.45 + 0.55 * clamp(b.built.combat.external * b.mod('external'), 0, 1.4);
const emit = (m: Match, kind: ArenaEventKind, x: number, z: number, slot = -1, power = 0): void => m.emit({ type: 'arena', kind, x, z, slot, power });

/** A timed buff from the arena (Crystal Arena, Elevation drops). Re-granting a tag refreshes it. */
export function grantMod(m: Match, b: BladeRuntime, tag: string, duration: number, mods: ModSet, kind: string, flags: ModFlag[] = []): void {
  b.mods = b.mods.filter((a) => a.tag !== tag);
  b.mods.push({ id: m.newId(), source: 'arena', tag, kind, until: m.t + duration, mods, flags });
}

/** Spin lost to the arena itself (lava, gaps): ignores shields, respects invulnerability and the blade's damage taken. */
function burn(b: BladeRuntime, amount: number): void {
  if (b.hasFlag('invuln') || amount <= 0) return;
  const lost = Math.min(Math.max(0, b.spin), amount * TUNING.ECON * b.mod('dmgTaken'));
  b.spin -= lost;
  b.stats.lostToHits += lost;
}

// ------------------------------------------------------------------------------------------ Elevation Ring
/** Four raised platforms on the diagonals, a low centre, and ramps (the valleys) between the platforms. */
export class ElevationHazard implements Hazard {
  readonly id = 'elevation-ring';
  static readonly H = 1.15;
  static readonly SLOPE_G = 11;
  private readonly trail = new Map<number, Array<{ t: number; h: number }>>();
  private readonly cd = new Map<number, number>();

  heightAt(x: number, z: number): number {
    const r = Math.hypot(x, z);
    if (r < 5.2) return 0;
    let u = Math.atan2(z, x) - Math.PI / 4;
    u = ((((u + Math.PI / 4) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) - Math.PI / 4;
    const mask = 1 - smooth(Math.abs(u), 0.3, 0.52);
    const top = ElevationHazard.H * (1 - 0.45 * smooth(r, 10, 12));
    return top * mask * smooth(r, 5.2, 7);
  }

  update(m: Match, dt: number): void {
    const e = 0.2;
    for (const b of live(m)) {
      const x = b.x, z = b.z;
      // slope: climbing costs speed, rolling down gives it back
      const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
      const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
      const k = ElevationHazard.SLOPE_G * ext(b) * dt;
      addVelocity(b, -gx * k, -gz * k);

      // drop attack: coming off the high ground at speed
      const h = this.heightAt(x, z);
      const tr = this.trail.get(b.slot) ?? [];
      tr.push({ t: m.t, h });
      while (tr.length && m.t - tr[0].t > 0.7) tr.shift();
      this.trail.set(b.slot, tr);
      const high = tr.reduce((s, p) => Math.max(s, p.h), 0);
      if (high - h > 0.55 && b.speed > 3 && (this.cd.get(b.slot) ?? 0) <= m.t) {
        this.cd.set(b.slot, m.t + 3);
        grantMod(m, b, 'drop', 2.2, { dmgDealt: 1.35, kbDealt: 1.25 }, 'drop');
        emit(m, 'drop', x, z, b.slot, high - h);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------ Magnetic Core
export type MagnetPhase = 'pull' | 'push' | 'calm';

/** A central magnet. Ten-second cycle: pull 5 s, calm 1 s, push 3 s, calm 1 s. */
export class MagnetHazard implements Hazard {
  readonly id = 'magnetic-core';
  static readonly CYCLE = 10;
  phase: MagnetPhase = 'calm';
  /** 0–1 field strength right now. */
  strength = 0;
  /** Seconds until the next phase starts (drives the warning flicker). */
  untilNext = 0;
  angle = 0;
  private lastPhase: MagnetPhase = 'calm';

  static phaseAt(t: number): { phase: MagnetPhase; env: number; untilNext: number } {
    const c = (t + 9) % MagnetHazard.CYCLE;
    const edge = (a: number, b: number) => Math.min(smooth(c, a, a + 0.5), 1 - smooth(c, b - 0.5, b));
    if (c < 5) return { phase: 'pull', env: edge(0, 5), untilNext: 5 - c };
    if (c < 6) return { phase: 'calm', env: 0, untilNext: 6 - c };
    if (c < 9) return { phase: 'push', env: edge(6, 9), untilNext: 9 - c };
    return { phase: 'calm', env: 0, untilNext: 10 - c };
  }

  update(m: Match, dt: number): void {
    const p = MagnetHazard.phaseAt(m.t);
    this.phase = p.phase; this.strength = p.env; this.untilNext = p.untilNext;
    this.angle += dt * (p.phase === 'push' ? -4 : 1.6 + 3 * p.env);
    if (p.phase !== this.lastPhase) {
      this.lastPhase = p.phase;
      // each calm is the warning before the next field; the fields announce themselves when they start
      emit(m, p.phase === 'calm' ? 'magnetWarn' : p.phase, 0, 0, -1, 1);
    }
    if (p.env <= 0) return;
    const R = m.arena.radius;
    for (const b of live(m)) {
      const x = b.x, z = b.z, d = Math.hypot(x, z);
      if (d < 0.05) continue;
      const nx = x / d, nz = z / d;
      const f = Math.pow(clamp(1 - d / (R * 0.88), 0, 1), 0.7) * p.env * ext(b);
      if (p.phase === 'pull') {
        addVelocity(b, (-nx * 8.6 - nz * 2.2) * f * dt, (-nz * 8.6 + nx * 2.2) * f * dt);
        if (d < 1.7) { const k = Math.exp(-2.6 * dt * p.env); const v = b.bb.body.linvel(); b.bb.body.setLinvel({ x: v.x * k, y: 0, z: v.z * k }, true); }
      } else {
        addVelocity(b, nx * 7 * f * dt, nz * 7 * f * dt);
      }
    }
  }

  danger(x: number, z: number): number {
    // the push throws blades at the wall; the core itself is a place to hold, not to flee
    const d = Math.hypot(x, z);
    return this.phase === 'push' ? this.strength * 0.7 * smooth(d, 6.5, 9.5) : 0;
  }
}

// ------------------------------------------------------------------------------------------ Crystal Arena
export type CrystalKind = 'overdrive' | 'aegis' | 'surge' | 'haste';
export const CRYSTAL_KINDS: CrystalKind[] = ['overdrive', 'aegis', 'surge', 'haste'];
export const CRYSTAL_INFO: Record<CrystalKind, { name: string; color: string; text: string }> = {
  overdrive: { name: 'Overdrive', color: '#ff8a3a', text: 'Hits harder and shoves further for 7 s.' },
  aegis: { name: 'Aegis', color: '#27e0ff', text: 'Takes less damage and knockback for 7 s.' },
  surge: { name: 'Surge', color: '#5dff8a', text: 'Wins back 12 spin at once.' },
  haste: { name: 'Haste', color: '#ffe14a', text: 'Quicker and grippier steering for 6 s.' },
};

export interface Crystal { id: number; x: number; z: number; kind: CrystalKind; alive: boolean; respawnAt: number; bornAt: number }

/** Four crystals on the diagonals (opposite ones match, so neither seat is favoured). Touch one to break it. */
export class CrystalHazard implements Hazard {
  readonly id = 'crystal-arena';
  static readonly RESPAWN = 9;
  readonly crystals: Crystal[] = [];

  constructor(rng: Rng) {
    const kinds: CrystalKind[] = [CRYSTAL_KINDS[Math.floor(rng() * 4)], CRYSTAL_KINDS[Math.floor(rng() * 4)]];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      this.crystals.push({ id: i, x: Math.cos(a) * 7.2, z: Math.sin(a) * 7.2, kind: kinds[i % 2], alive: true, respawnAt: 0, bornAt: 0 });
    }
  }

  update(m: Match): void {
    for (const c of this.crystals) {
      if (!c.alive) {
        if (m.t >= c.respawnAt) {
          c.alive = true; c.bornAt = m.t; c.kind = CRYSTAL_KINDS[Math.floor(m.rng() * 4)];
          emit(m, 'crystalSpawn', c.x, c.z, -1, CRYSTAL_KINDS.indexOf(c.kind));
        }
        continue;
      }
      let taker: BladeRuntime | null = null, best = Infinity;
      for (const b of live(m)) {
        const d = Math.hypot(b.x - c.x, b.z - c.z);
        if (d < 0.95 + b.radius * 0.8 && d < best) { best = d; taker = b; }
      }
      if (!taker) continue;
      c.alive = false; c.respawnAt = m.t + CrystalHazard.RESPAWN;
      this.grant(m, taker, c.kind);
      emit(m, 'crystalBreak', c.x, c.z, taker.slot, CRYSTAL_KINDS.indexOf(c.kind));
    }
  }

  private grant(m: Match, b: BladeRuntime, kind: CrystalKind): void {
    switch (kind) {
      case 'overdrive': grantMod(m, b, 'crystal', 7, { dmgDealt: 1.3, kbDealt: 1.2, accel: 1.08 }, kind); break;
      case 'aegis': grantMod(m, b, 'crystal', 7, { dmgTaken: 0.72, kbTaken: 0.75 }, kind); break;
      case 'haste': grantMod(m, b, 'crystal', 6, { accel: 1.3, grip: 1.15 }, kind); break;
      case 'surge': gainSpin(b, 12); break;
    }
  }

  pickups(): Pickup[] {
    return this.crystals.filter((c) => c.alive).map((c) => ({ x: c.x, z: c.z, value: c.kind === 'surge' ? 1.2 : 1 }));
  }
}

// ------------------------------------------------------------------------------------------ Shift Floor
export interface Ring { r0: number; r1: number; n: number; omega: number; angle: number }
export interface Gap { ring: number; sector: number; openAt: number; closeAt: number; warnAt: number }

/**
 * Eight floor plates on three rings (1 + 3 + 4) turning at different speeds: blades standing on a plate are carried
 * with it. Every ten seconds one plate of the two outer rings sinks for a few seconds; whoever is on it stumbles.
 */
export class ShiftHazard implements Hazard {
  readonly id = 'shift-floor';
  static readonly WARN = 1.5;
  static readonly OPEN = 3;
  static readonly PERIOD = 10;
  readonly rings: Ring[] = [
    { r0: 0, r1: 4.1, n: 1, omega: 0.3, angle: 0 },
    { r0: 4.1, r1: 8.2, n: 3, omega: -0.38, angle: 0 },
    { r0: 8.2, r1: 13, n: 4, omega: 0.26, angle: 0 },
  ];
  gap: Gap | null = null;
  private nextGapAt = 8;
  private readonly stumbleCd = new Map<number, number>();

  ringAt(r: number): number { return r < this.rings[0].r1 ? 0 : r < this.rings[1].r1 ? 1 : 2; }

  sectorAt(x: number, z: number): { ring: number; sector: number } {
    const ring = this.ringAt(Math.hypot(x, z));
    const R = this.rings[ring];
    const a = (((Math.atan2(z, x) - R.angle) % TAU) + TAU) % TAU;
    return { ring, sector: Math.min(R.n - 1, Math.floor((a / TAU) * R.n)) };
  }

  /** 0 closed · 0–1 warning (flicker) · 1 open. */
  gapState(t: number): { phase: 'none' | 'warn' | 'open'; depth: number } {
    const g = this.gap;
    if (!g) return { phase: 'none', depth: 0 };
    if (t < g.openAt) return { phase: 'warn', depth: clamp((t - g.warnAt) / (g.openAt - g.warnAt), 0, 1) * 0.35 };
    if (t < g.closeAt) return { phase: 'open', depth: Math.min(1, 0.35 + (t - g.openAt) * 3, (g.closeAt - t) * 3) };
    return { phase: 'none', depth: 0 };
  }

  update(m: Match, dt: number): void {
    for (const r of this.rings) r.angle = (r.angle + r.omega * dt) % TAU;
    if (m.phase === 'live') {
      if (!this.gap && m.t >= this.nextGapAt) {
        const ring = 1 + Math.floor(m.rng() * 2);
        const sector = Math.floor(m.rng() * this.rings[ring].n);
        this.gap = { ring, sector, warnAt: m.t, openAt: m.t + ShiftHazard.WARN, closeAt: m.t + ShiftHazard.WARN + ShiftHazard.OPEN };
        const mid = this.sectorCentre(this.gap, m.t);
        emit(m, 'gapWarn', mid.x, mid.z);
      } else if (this.gap) {
        const g = this.gap;
        if (m.t >= g.openAt && m.t - dt < g.openAt) { const mid = this.sectorCentre(g, m.t); emit(m, 'gapOpen', mid.x, mid.z); }
        if (m.t >= g.closeAt) { const mid = this.sectorCentre(g, m.t); emit(m, 'gapClose', mid.x, mid.z); this.gap = null; this.nextGapAt = g.warnAt + ShiftHazard.PERIOD; }
      }
    }
    const open = this.gapState(m.t).phase === 'open';
    for (const b of live(m)) {
      const x = b.x, z = b.z, r = Math.hypot(x, z);
      if (r < 0.05) continue;
      const { ring, sector } = this.sectorAt(x, z);
      const R = this.rings[ring];
      // carried along with the plate: drift towards its tangential speed
      const tx = -z / r, tz = x / r;
      const v = b.bb.body.linvel();
      const along = v.x * tx + v.z * tz;
      const dv = (R.omega * r - along) * (1 - Math.exp(-1.4 * dt)) * ext(b);
      addVelocity(b, tx * dv, tz * dv);
      // stumbling on a sunk plate
      if (open && this.gap && this.gap.ring === ring && this.gap.sector === sector) {
        const k = Math.exp(-4 * dt);
        const w = b.bb.body.linvel();
        b.bb.body.setLinvel({ x: w.x * k, y: 0, z: w.z * k }, true);
        burn(b, 3.2 * dt);
        if ((this.stumbleCd.get(b.slot) ?? 0) <= m.t) { this.stumbleCd.set(b.slot, m.t + 0.9); emit(m, 'stumble', x, z, b.slot, 1); }
      }
    }
  }

  /** Middle of a plate right now (the rings turn). */
  sectorCentre(g: Gap, _t: number): { x: number; z: number } {
    const R = this.rings[g.ring];
    const a = R.angle + ((g.sector + 0.5) / R.n) * TAU;
    const r = (R.r0 + Math.min(R.r1, 12)) / 2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  danger(x: number, z: number, m: Match): number {
    const g = this.gap;
    if (!g) return 0;
    const s = this.gapState(m.t);
    if (s.phase === 'none') return 0;
    const at = this.sectorAt(x, z);
    return at.ring === g.ring && at.sector === g.sector ? (s.phase === 'open' ? 1 : 0.7) : 0;
  }
}

// ------------------------------------------------------------------------------------------ Wind Tunnel
export interface Lane { z: number; hw: number; dir: 1 | -1; power: number }

/**
 * Four airflow lanes along the arena, two each way (rotating the arena half a turn swaps seats and keeps the layout, so
 * both seats see the same arena). Every seven seconds a gust doubles the wind for a moment.
 */
export class WindHazard implements Hazard {
  readonly id = 'wind-tunnel';
  static readonly CYCLE = 7;
  readonly lanes: Lane[] = [
    { z: -8.2, hw: 1.7, dir: 1, power: 7 },
    { z: -3.0, hw: 1.9, dir: -1, power: 8.5 },
    { z: 3.0, hw: 1.9, dir: 1, power: 8.5 },
    { z: 8.2, hw: 1.7, dir: -1, power: 7 },
  ];
  /** 1 normally, up to 1.8 in a gust. */
  gust = 1;
  warn = 0;
  private lastGust = 1;

  static gustAt(t: number): { gust: number; warn: number } {
    const c = t % WindHazard.CYCLE;
    const g = c >= 5.5 ? Math.min(smooth(c, 5.5, 5.8), 1 - smooth(c, 6.7, 7)) : 0;
    const w = c >= 4.5 && c < 5.5 ? Math.sin(((c - 4.5) / 1) * Math.PI) : 0;
    return { gust: 1 + 0.8 * g, warn: w };
  }

  laneAt(x: number, z: number): Lane | null {
    for (const l of this.lanes) if (Math.abs(z - l.z) < l.hw && Math.abs(x) < 12.2) return l;
    return null;
  }

  update(m: Match, dt: number): void {
    const prevWarn = this.warn;
    const g = WindHazard.gustAt(m.t);
    this.gust = g.gust; this.warn = g.warn;
    if (m.phase === 'live' && prevWarn <= 0 && g.warn > 0) emit(m, 'gustWarn', 0, 0);
    if (m.phase === 'live' && g.gust > 1.02 && this.lastGust <= 1.02) emit(m, 'gust', 0, 0, -1, g.gust);
    this.lastGust = g.gust;
    for (const b of live(m)) {
      const l = this.laneAt(b.x, b.z);
      if (!l) continue;
      const centre = 1 - Math.abs(b.z - l.z) / l.hw;
      addVelocity(b, l.dir * l.power * (0.55 + 0.45 * centre) * this.gust * ext(b) * dt, 0);
    }
  }

  danger(x: number, z: number): number {
    // an outer lane's downwind end is the rim
    const l = this.laneAt(x, z);
    if (!l || Math.abs(l.z) < 5) return 0;
    return clamp((x * l.dir - 3.5) / 5, 0, 1) * 0.8;
  }
}

// ------------------------------------------------------------------------------------------ Lava Ring
export interface Vent { x: number; z: number; angle: number; group: 0 | 1; erupting: number; warn: number; firedCycle: number }

/**
 * A lava channel round a safe centre. Standing in it burns spin. Four vents on the channel erupt in pairs every eight
 * seconds and throw whoever is over them; the glow builds for a second and a half first.
 */
export class LavaHazard implements Hazard {
  readonly id = 'lava-ring';
  static readonly R0 = 7.4;
  static readonly R1 = 9.0;
  static readonly CYCLE = 8;
  static readonly WARN = 1.5;
  static readonly VENT_R = 2;
  readonly vents: Vent[] = [];
  private readonly burnCd = new Map<number, number>();

  constructor() {
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const r = (LavaHazard.R0 + LavaHazard.R1) / 2;
      this.vents.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, angle: a, group: (k % 2) as 0 | 1, erupting: 0, warn: 0, firedCycle: -1 });
    }
  }

  inChannel(x: number, z: number, pad = 0): boolean { const r = Math.hypot(x, z); return r > LavaHazard.R0 - pad && r < LavaHazard.R1 + pad; }

  update(m: Match, dt: number): void {
    // group 0 erupts at 4 s into each cycle, group 1 at 8 s (so one pair, then the other, then a pause)
    const cycle = Math.floor(m.t / LavaHazard.CYCLE);
    const c = m.t - cycle * LavaHazard.CYCLE;
    for (const v of this.vents) {
      const at = v.group === 0 ? 3.5 : 7.5;
      const was = v.warn;
      v.warn = c < at && c >= at - LavaHazard.WARN ? (c - (at - LavaHazard.WARN)) / LavaHazard.WARN : 0;
      v.erupting = Math.max(0, v.erupting - dt * 2.2);
      if (was === 0 && v.warn > 0) emit(m, 'lavaWarn', v.x, v.z);
      if (c >= at && v.firedCycle !== cycle) {
        v.firedCycle = cycle;
        v.erupting = 1;
        emit(m, 'lavaBurst', v.x, v.z, -1, 1);
        for (const b of live(m)) {
          const dx = b.x - v.x, dz = b.z - v.z, d = Math.hypot(dx, dz);
          if (d > LavaHazard.VENT_R + b.radius) continue;
          const f = 1 - clamp(d / (LavaHazard.VENT_R + b.radius), 0, 1) * 0.5;
          const nx = d < 1e-3 ? Math.cos(v.angle) : dx / d, nz = d < 1e-3 ? Math.sin(v.angle) : dz / d;
          knock(m, b, nx, nz, 12 * TUNING.IMPULSE_SCALE * f, null);
          burn(b, 5 * f);
        }
      }
    }
    for (const b of live(m)) {
      if (!this.inChannel(b.x, b.z)) continue;
      burn(b, 5.2 * dt);
      if ((this.burnCd.get(b.slot) ?? 0) <= m.t) { this.burnCd.set(b.slot, m.t + 0.45); emit(m, 'lavaBurn', b.x, b.z, b.slot, 1); }
    }
  }

  danger(x: number, z: number): number {
    if (this.inChannel(x, z, 0.5)) return 1;
    let d = 0;
    for (const v of this.vents) if (v.warn > 0 && Math.hypot(x - v.x, z - v.z) < LavaHazard.VENT_R + 0.8) d = Math.max(d, 0.6 + 0.4 * v.warn);
    return d;
  }
}

// ------------------------------------------------------------------------------------------ Gravity Well
export const GRAVITY_ZONES = { highOuter: 4.2, lowInner: 8.2 } as const;

/**
 * Three gravity zones. A heavy core (r < 4): sluggish steering, more mass, collisions land harder. A middle ring that
 * curves everything round the well. A light outer ring (r > 8): floaty, quick, and easy to knock off the floor.
 */
export class GravityHazard implements Hazard {
  readonly id = 'gravity-well';

  zoneAt(r: number): { high: number; low: number; orbit: number } {
    const high = 1 - smooth(r, GRAVITY_ZONES.highOuter - 0.9, GRAVITY_ZONES.highOuter);
    const low = smooth(r, GRAVITY_ZONES.lowInner, GRAVITY_ZONES.lowInner + 0.9);
    return { high, low, orbit: Math.max(0, 1 - high - low) };
  }

  update(m: Match, dt: number): void {
    for (const b of m.blades) {
      if (!b.launched || !b.alive || b.fallen) { b.env = {}; continue; }
      const x = b.x, z = b.z, r = Math.hypot(x, z);
      const { high, low, orbit } = this.zoneAt(r);
      b.env = {
        accel: (1 - 0.28 * high) * (1 + 0.22 * low),
        mass: 1 + 0.4 * high,
        dmgDealt: 1 + 0.18 * high,
        dmgTaken: 1 + 0.12 * high,
        kbTaken: 1 - 0.15 * high + 0.3 * low,
        drag: 1 + 0.5 * high - 0.4 * low,
        grip: 1 - 0.25 * orbit,
      };
      if (r < 0.05) continue;
      const nx = x / r, nz = z / r, e = ext(b);
      // orbit: swing round the well, a little inwards; high zone: drawn in
      const sw = 5.4 * Math.sin(Math.PI * clamp((r - GRAVITY_ZONES.highOuter) / (GRAVITY_ZONES.lowInner - GRAVITY_ZONES.highOuter), 0, 1)) * orbit;
      addVelocity(b, (-nz * sw - nx * (1.4 * orbit + 3 * high)) * e * dt, (nx * sw - nz * (1.4 * orbit + 3 * high)) * e * dt);
    }
  }
}

// ------------------------------------------------------------------------------------------ factory
export function createHazards(arenaId: string, rng: Rng): Hazard[] {
  switch (arenaId) {
    case 'elevation-ring': return [new ElevationHazard()];
    case 'magnetic-core': return [new MagnetHazard()];
    case 'crystal-arena': return [new CrystalHazard(rng)];
    case 'shift-floor': return [new ShiftHazard()];
    case 'wind-tunnel': return [new WindHazard()];
    case 'lava-ring': return [new LavaHazard()];
    case 'gravity-well': return [new GravityHazard()];
    default: return [];
  }
}

