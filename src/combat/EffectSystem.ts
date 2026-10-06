// EffectSystem: executes the reusable effect primitives (see blades/effects.ts) and runs the persistent
// bits they create (zones, pulls, drains, decoys, slams). Basic moves and Supers both come through here,
// so no blade has bespoke ability code.

import { lowSpinFactor, TUNING } from '../core/Balance';
import { clamp, lerp } from '../core/types';
import type { ActiveMod, BladeRuntime } from '../blades/Blade';
import type { EffectDef, ModSet, SpinLossScale } from '../blades/effects';
import { gainSpin, hurt } from './SpinSystem';
import type { Match } from './Match';

export interface EffectCtx {
  /** 0–1 charge of a hold-to-charge move (1 for everything else). */
  charge: number;
  /** Strength multiplier (Super strength × level boost). */
  strength: number;
  source: 'ability' | 'super';
  superId?: string;
  /** Effects spawned by a Super must not outlive it (the 8 s cap). */
  capUntil?: number;
}

export function addVelocity(b: BladeRuntime, dx: number, dz: number): void {
  const v = b.bb.body.linvel();
  b.bb.body.setLinvel({ x: v.x + dx, y: 0, z: v.z + dz }, true);
}

const norm = (x: number, z: number, fx = 0, fz = -1): [number, number] => {
  const l = Math.hypot(x, z);
  return l < 1e-6 ? [fx, fz] : [x / l, z / l];
};

/** Direction from `src` towards its opponent (falls back to its heading). */
function toTarget(m: Match, src: BladeRuntime): [number, number] {
  const o = m.opponentOf(src.slot);
  if (!o) return [src.headX, src.headZ];
  return norm(o.x - src.x, o.z - src.z, src.headX, src.headZ);
}

function dashDir(m: Match, src: BladeRuntime, dir: 'heading' | 'target' | 'perp' | 'away'): [number, number] {
  switch (dir) {
    case 'heading': {
      const speed = src.speed;
      if (src.steerMag > 0.25) return norm(src.steerX, src.steerZ);
      if (speed > 0.8) return norm(src.vx, src.vz);
      return norm(src.headX, src.headZ);
    }
    case 'target': return toTarget(m, src);
    case 'away': { const [x, z] = toTarget(m, src); return [-x, -z]; }
    case 'perp': {
      const [tx, tz] = toTarget(m, src);
      const px = -tz, pz = tx;
      // side that heads towards the centre, i.e. away from the rim
      const side = px * -src.x + pz * -src.z >= 0 ? 1 : -1;
      // the player's steering wins if they are pushing sideways
      const steer = src.steerMag > 0.35 ? (src.steerX * px + src.steerZ * pz >= 0 ? 1 : -1) : side;
      return [px * steer, pz * steer];
    }
  }
}

const scaleMods = (mods: ModSet, k: number): ModSet => {
  const out: ModSet = {};
  for (const key of Object.keys(mods) as Array<keyof ModSet>) out[key] = 1 + (mods[key]! - 1) * k;
  return out;
};
const scaleSpinLoss = (s: SpinLossScale, k: number): SpinLossScale => {
  const out: SpinLossScale = {};
  for (const key of Object.keys(s) as Array<keyof SpinLossScale>) out[key] = 1 + (s[key]! - 1) * k;
  return out;
};

/** Push `victim` along (nx, nz). Heavier, more stable, better-defended blades move less. */
export function knock(m: Match, victim: BladeRuntime, nx: number, nz: number, impulse: number, attacker: BladeRuntime | null): number {
  if (!victim.alive || victim.fallen || victim.hasFlag('invuln')) return 0;
  const massEff = victim.built.combat.mass * victim.mod('mass');
  const dv = (impulse * victim.mod('kbTaken')) / Math.sqrt(massEff / 1.6) / Math.pow(victim.built.combat.defMul / 0.8, 0.25);
  addVelocity(victim, nx * dv, nz * dv);
  if (attacker && victim.hasFlag('reflectKnockback')) addVelocity(attacker, -nx * dv * 0.8, -nz * dv * 0.8);
  void m;
  return dv;
}

export function applyEffect(m: Match, src: BladeRuntime, e: EffectDef, ctx: EffectCtx): void {
  switch (e.kind) {
    case 'dash': {
      const [dx, dz] = dashDir(m, src, e.dir);
      let speed = e.speed * TUNING.DASH_SCALE * ctx.strength * lowSpinFactor(src.spin);
      if (e.scaleByCharge) speed *= lerp(0.3, 1, ctx.charge);
      addVelocity(src, dx * speed, dz * speed);
      src.headX = dx; src.headZ = dz;
      m.emit({ type: 'fx', kind: 'dash', slot: src.slot, x: src.x, z: src.z, power: speed });
      break;
    }
    case 'mod': {
      const target = e.target === 'opponent' ? m.opponentOf(src.slot) : src;
      if (!target) break;
      let k = ctx.strength;
      if (e.scaleByCharge) k *= lerp(0.25, 1, ctx.charge);
      let until = m.t + e.duration;
      if (ctx.capUntil !== undefined) until = Math.min(until, ctx.capUntil);
      if (e.tag) target.mods = target.mods.filter((a) => a.tag !== e.tag);
      const mod: ActiveMod = {
        id: m.newId(), source: ctx.source, superId: ctx.superId, tag: e.tag, until,
        mods: e.mods ? scaleMods(e.mods, k) : {}, flags: e.flags ? [...e.flags] : [],
        spinLoss: e.spinLoss ? scaleSpinLoss(e.spinLoss, k) : undefined,
      };
      target.mods.push(mod);
      if (e.flags?.includes('ambush')) m.emit({ type: 'fx', kind: 'ambush', slot: target.slot, x: target.x, z: target.z });
      if (e.tag === 'guard' || e.tag === 'block') m.emit({ type: 'fx', kind: 'guard', slot: target.slot, x: target.x, z: target.z });
      break;
    }
    case 'radial': {
      m.emit({ type: 'fx', kind: 'radial', slot: src.slot, x: src.x, z: src.z, radius: e.radius, power: e.impulse });
      for (const o of m.blades) {
        if (o === src || !o.alive || o.fallen) continue;
        const dx = o.x - src.x, dz = o.z - src.z;
        const d = Math.hypot(dx, dz);
        const reach = e.radius + o.radius;
        if (d > reach) continue;
        const f = 1 - clamp(d / reach, 0, 1) * 0.6;
        const [nx, nz] = norm(dx, dz);
        knock(m, o, nx, nz, e.impulse * TUNING.IMPULSE_SCALE * ctx.strength * f * src.mod('kbDealt'), src);
        hurt(m, o, { amount: e.damage * ctx.strength * f * src.mod('dmgDealt'), attacker: src });
      }
      break;
    }
    case 'pull': {
      let until = m.t + e.duration;
      if (ctx.capUntil !== undefined) until = Math.min(until, ctx.capUntil);
      m.pulls.push({ owner: src.slot, radius: e.radius, strength: e.strength * ctx.strength, until });
      m.emit({ type: 'fx', kind: 'pull', slot: src.slot, x: src.x, z: src.z, radius: e.radius });
      break;
    }
    case 'zone': {
      const at = e.at === 'target' ? m.opponentOf(src.slot) ?? src : src;
      let until = m.t + e.duration;
      if (ctx.capUntil !== undefined && e.zone !== 'trap') until = Math.min(until, ctx.capUntil);
      m.zones.push({
        id: m.newId(), kind: e.zone, owner: src.slot, x: at.x, z: at.z, radius: e.radius, until,
        strength: e.strength * ctx.strength, damage: e.damage * ctx.strength, follow: !!e.follow, hitCd: {},
      });
      m.emit({ type: 'fx', kind: 'zoneStart', slot: src.slot, x: at.x, z: at.z, radius: e.radius, power: e.zone === 'trap' ? 0 : e.zone === 'well' ? 1 : 2 });
      break;
    }
    case 'drain': {
      let until = m.t + e.duration;
      if (ctx.capUntil !== undefined) until = Math.min(until, ctx.capUntil);
      m.drains.push({ owner: src.slot, radius: e.radius, rate: e.rate * ctx.strength, until });
      break;
    }
    case 'teleport': {
      const o = m.opponentOf(src.slot);
      if (!o) break;
      m.emit({ type: 'fx', kind: 'teleport', slot: src.slot, x: src.x, z: src.z });
      const [hx, hz] = norm(o.vx, o.vz, o.headX, o.headZ);
      let tx = o.x - hx * e.distance, tz = o.z - hz * e.distance;
      const lim = m.arena.radius * 0.88;
      const d = Math.hypot(tx, tz);
      if (d > lim) { tx *= lim / d; tz *= lim / d; }
      src.bb.body.setTranslation({ x: tx, y: src.bb.y, z: tz }, true);
      src.bb.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      src.prevX = tx; src.prevZ = tz;
      m.emit({ type: 'fx', kind: 'teleport', slot: src.slot, x: tx, z: tz, power: 1 });
      break;
    }
    case 'spin': {
      const got = gainSpin(src, e.amount * ctx.strength * TUNING.ECON);
      if (got > 0) m.emit({ type: 'fx', kind: 'spinGain', slot: src.slot, x: src.x, z: src.z, power: got });
      break;
    }
    case 'shield': {
      let until = m.t + e.duration;
      if (ctx.capUntil !== undefined) until = Math.min(until, ctx.capUntil);
      src.shield = { hits: e.hits, until };
      m.emit({ type: 'fx', kind: 'shield', slot: src.slot, x: src.x, z: src.z });
      break;
    }
    case 'decoy': {
      m.decoys = m.decoys.filter((d) => d.owner !== src.slot);
      m.decoys.push({ owner: src.slot, x: src.x, z: src.z, vx: src.vx * 0.6, vz: src.vz * 0.6, until: m.t + e.duration, radius: src.radius });
      m.emit({ type: 'fx', kind: 'decoy', slot: src.slot, x: src.x, z: src.z });
      break;
    }
    case 'slam': {
      const o = m.opponentOf(src.slot);
      const tx = o ? o.x : src.x, tz = o ? o.z : src.z;
      src.slam = { t: e.delay, total: e.delay, tx, tz, radius: e.radius * ctx.strength, impulse: e.impulse * ctx.strength, damage: e.damage * ctx.strength };
      const until = m.t + e.delay + 0.05;
      src.mods.push({ id: m.newId(), source: ctx.source, superId: ctx.superId, tag: 'slam', until, mods: {}, flags: ['invuln', 'ghost'] });
      m.emit({ type: 'fx', kind: 'slamStart', slot: src.slot, x: src.x, z: src.z });
      break;
    }
  }
}

// ----------------------------------------------------------------------------------------- persistent
/** Advance zones, pulls, drains, decoys and slams. Runs once per fixed step before the physics step. */
export function updateWorldEffects(m: Match, dt: number): void {
  const now = m.t;

  // zones
  for (const z of m.zones) {
    const owner = m.blades[z.owner];
    if (z.follow && owner && owner.alive) { z.x = owner.x; z.z = owner.z; }
    for (const b of m.blades) {
      if (b.slot === z.owner || !b.alive || b.fallen) continue;
      const dx = z.x - b.x, dz = z.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > z.radius + b.radius) continue;
      const ext = b.built.combat.external * b.mod('external');
      if (z.kind === 'trap') {
        if ((z.hitCd[b.slot] ?? 0) > now) continue;
        z.hitCd[b.slot] = now + 1.4;
        const [nx, nz] = norm(-dx, -dz);
        knock(m, b, nx, nz, z.strength * TUNING.IMPULSE_SCALE * (owner?.mod('kbDealt') ?? 1), owner ?? null);
        hurt(m, b, { amount: z.damage * (owner?.mod('dmgDealt') ?? 1), attacker: owner ?? null });
        m.emit({ type: 'fx', kind: 'radial', slot: z.owner, x: b.x, z: b.z, radius: 2.2, power: z.strength });
      } else {
        const [nx, nz] = norm(dx, dz);
        const f = 1 - clamp(d / (z.radius + b.radius), 0, 1) * 0.5;
        const pull = z.strength * f * (z.kind === 'blackhole' ? 1.3 : 1) * ext;
        addVelocity(b, nx * pull * dt, nz * pull * dt);
        if (z.kind === 'well') { const k = Math.exp(-1.1 * dt); const v = b.bb.body.linvel(); b.bb.body.setLinvel({ x: v.x * k, y: 0, z: v.z * k }, true); }
        if (z.kind === 'blackhole' && owner && owner.alive) {
          const amt = Math.min(Math.max(0, b.spin), 4.5 * dt * TUNING.ECON);
          b.spin -= amt; b.stats.lostToHits += amt; gainSpin(owner, amt * 0.7);
        }
      }
    }
  }
  for (const z of m.zones) if (z.until <= now) m.emit({ type: 'fx', kind: 'zoneEnd', slot: z.owner, x: z.x, z: z.z, radius: z.radius });
  m.zones = m.zones.filter((z) => z.until > now);

  // pulls (Magnet Pull)
  for (const p of m.pulls) {
    const owner = m.blades[p.owner];
    if (!owner || !owner.alive) continue;
    for (const b of m.blades) {
      if (b === owner || !b.alive || b.fallen) continue;
      const dx = owner.x - b.x, dz = owner.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > p.radius || d < owner.radius + b.radius) continue;
      const [nx, nz] = norm(dx, dz);
      const a = p.strength * (1 - 0.5 * (d / p.radius)) * b.built.combat.external * b.mod('external');
      addVelocity(b, nx * a * dt, nz * a * dt);
    }
  }
  m.pulls = m.pulls.filter((p) => p.until > now);

  // drains (Spin Drain)
  for (const dr of m.drains) {
    const owner = m.blades[dr.owner];
    if (!owner || !owner.alive) continue;
    for (const b of m.blades) {
      if (b === owner || !b.alive || b.fallen || b.hasFlag('invuln')) continue;
      if (Math.hypot(owner.x - b.x, owner.z - b.z) > dr.radius + b.radius) continue;
      const amt = Math.min(Math.max(0, b.spin), dr.rate * dt * TUNING.ECON);
      b.spin -= amt; b.stats.lostToHits += amt; owner.stats.damageDealt += amt;
      gainSpin(owner, amt * 0.8);
    }
  }
  m.drains = m.drains.filter((d) => d.until > now);

  // decoys: drift, and pop when touched
  for (const d of m.decoys) {
    const k = Math.exp(-1.2 * dt);
    d.vx *= k; d.vz *= k; d.x += d.vx * dt; d.z += d.vz * dt;
    for (const b of m.blades) {
      if (b.slot === d.owner || !b.alive || b.fallen) continue;
      if (Math.hypot(b.x - d.x, b.z - d.z) < d.radius + b.radius) { d.until = 0; m.emit({ type: 'fx', kind: 'decoyPop', slot: d.owner, x: d.x, z: d.z }); }
    }
  }
  m.decoys = m.decoys.filter((d) => d.until > now);

  // slams (Meteor Crash): a short ghosted leap, then the impact
  for (const b of m.blades) {
    const s = b.slam;
    if (!s) continue;
    s.t -= dt;
    b.leap = Math.sin(Math.PI * clamp(1 - s.t / s.total, 0, 1));
    const dx = s.tx - b.x, dz = s.tz - b.z;
    const k = 1 / Math.max(s.t, dt * 2);
    b.bb.body.setLinvel({ x: clamp(dx * k, -26, 26), y: 0, z: clamp(dz * k, -26, 26) }, true);
    if (s.t <= 0) {
      b.slam = null; b.leap = 0;
      m.emit({ type: 'fx', kind: 'slam', slot: b.slot, x: b.x, z: b.z, radius: s.radius, power: s.impulse });
      applyEffect(m, b, { kind: 'radial', radius: s.radius, impulse: s.impulse, damage: s.damage }, { charge: 1, strength: 1, source: 'ability' });
    }
  }
}
