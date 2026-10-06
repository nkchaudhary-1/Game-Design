// CombatSystem: the fixed-step loop that ties everything together.
//
//   1. timers, abilities, Supers            (what the blades *decide*)
//   2. world effects, forces                (what acts on them)
//   3. Rapier step                          (physics)
//   4. collision game layer                 (what the contact means)
//   5. spin, KO, result                     (consequences)

import { TUNING, lowSpinFactor, spinOmega } from '../core/Balance';
import type { BladeRuntime } from '../blades/Blade';
import { GHOST_GROUPS } from '../core/Physics';
import { updateAbilities } from './AbilitySystem';
import { handleCollision, type PreVel } from './CollisionSystem';
import { updateWorldEffects } from './EffectSystem';
import { tickSpin } from './SpinSystem';
import { updateSuper } from './SuperSystem';
import type { Match } from './Match';
import type { KoCause, MatchResult } from './events';

export function stepMatch(m: Match): void {
  const dt = TUNING.DT;

  if (m.phase === 'ready') {
    // blades idle on their launch pads, spinning
    for (const b of m.blades) {
      b.prevX = b.x; b.prevZ = b.z;
      b.bb.body.setAngvel({ x: 0, y: -spinOmega(100), z: 0 }, true);
    }
    m.physics.step();
    return;
  }

  m.t += dt;

  // 1. decide
  for (const b of m.blades) {
    b.prevX = b.x; b.prevZ = b.z;
    b.prevSpin = b.spin;
    expireMods(m, b);
    updateAbilities(m, b, dt);
    updateSuper(m, b, dt);
    syncBodyFlags(m, b);
  }

  // 2. act
  if (m.phase === 'live') updateWorldEffects(m, dt);
  for (const h of m.arena.hazards) h.update(m, dt);
  for (const b of m.blades) applyForces(m, b, dt);

  // 3. physics
  const pre: PreVel = new Map();
  for (const b of m.blades) pre.set(b.slot, { vx: b.vx, vz: b.vz });
  const contacts = m.physics.step();

  // 4. collisions
  if (m.phase === 'live') {
    const seen = new Set<string>();
    for (const [a, c] of contacts) {
      const key = a < c ? `${a}:${c}` : `${c}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      handleCollision(m, m.blades[Math.min(a, c)], m.blades[Math.max(a, c)], pre);
    }
  }

  // 5. consequences
  for (const b of m.blades) tickSpin(m, b, dt);
  if (m.phase === 'live') checkKnockouts(m);
}

function expireMods(m: Match, b: BladeRuntime): void {
  if (b.mods.length) b.mods = b.mods.filter((a) => a.until > m.t);
  if (b.shield && b.shield.until <= m.t) { b.shield = null; }
}

/** Keep the physics body in step with modifiers: effective mass, ghosting, damping. */
function syncBodyFlags(m: Match, b: BladeRuntime): void {
  const c = b.built.combat;
  const mass = c.mass * b.mod('mass');
  if (Math.abs(mass - b.appliedMass) / b.appliedMass > 0.01) {
    b.bb.collider.setMass(mass);
    b.appliedMass = mass;
  }
  const ghost = b.hasFlag('ghost');
  if (ghost !== b.ghostApplied && !b.fallen) {
    m.physics.setGhost(b.bb, ghost);
    b.ghostApplied = ghost;
  }
  b.bb.body.setLinearDamping(c.linearDamping * b.mod('drag'));
}

function applyForces(m: Match, b: BladeRuntime, dt: number): void {
  const body = b.bb.body;
  if (!b.launched) return;
  if (b.out === 'ring') return; // falling: gravity only

  const c = b.built.combat;
  const pos = body.translation();
  const v = body.linvel();
  let vx = v.x, vz = v.z;

  if (b.slam) { body.setAngvel({ x: 0, y: -spinOmega(b.spin) * 1.6, z: 0 }, true); return; }

  // pit + swirl. The wall is not stability-dependent; swirl and every other external force is.
  const ext = c.external * b.mod('external');
  const pit = m.arena.pit(pos.x, pos.z, b.spin);
  const sw = m.arena.swirl(pos.x, pos.z);
  let ax = pit.ax + sw.ax * ext, az = pit.az + sw.az * ext;

  // steering: momentum-based, with turning authority from agility
  let sMag = 0;
  const ease = 1 - Math.exp(-dt / TUNING.STEER_SMOOTH);
  b.smX += (b.steerX - b.smX) * ease; b.smZ += (b.steerZ - b.smZ) * ease;
  if (b.spin > 0) {
    sMag = Math.min(1, Math.hypot(b.steerX, b.steerZ));
    const sl = Math.hypot(b.smX, b.smZ), push = Math.min(1, sl);
    if (sl > 0.001) {
      const dx = b.smX / sl, dz = b.smZ / sl;
      const accel = c.accel * b.mod('accel') * lowSpinFactor(b.spin) * push;
      ax += dx * accel; az += dz * accel;
      const along = vx * dx + vz * dz;
      const px = vx - along * dx, pz = vz - along * dz;
      const k = 1 - Math.exp(-c.lateralGrip * b.mod('grip') * push * dt);
      vx -= px * k; vz -= pz * k;
    }
  }
  b.steerMag = sMag;

  // low spin: wobble
  if (b.spin < TUNING.WOBBLE_BELOW && b.spin > 0) {
    const f = 1 - b.spin / TUNING.WOBBLE_BELOW;
    const a = m.t * (5 + 8 * f) + b.slot * 2.1;
    ax += Math.cos(a) * TUNING.WOBBLE_ACCEL * f * ext; az += Math.sin(a * 1.3) * TUNING.WOBBLE_ACCEL * f * ext;
  }

  vx += ax * dt; vz += az * dt;
  const sp = Math.hypot(vx, vz);
  if (sp > TUNING.MAX_SPEED) { vx *= TUNING.MAX_SPEED / sp; vz *= TUNING.MAX_SPEED / sp; }

  // heading follows steering, else motion
  if (sMag > 0.25) { b.headX = b.steerX / Math.max(1e-6, Math.hypot(b.steerX, b.steerZ)); b.headZ = b.steerZ / Math.max(1e-6, Math.hypot(b.steerX, b.steerZ)); }
  else if (sp > 1) { b.headX = vx / sp; b.headZ = vz / sp; }

  body.setLinvel({ x: vx, y: 0, z: vz }, true);
  // spin rate drives surface friction in contacts (clockwise from above = negative about +Y)
  body.setAngvel({ x: 0, y: -spinOmega(b.spin), z: 0 }, true);
}

function checkKnockouts(m: Match): void {
  for (const b of m.blades) {
    if (b.out) continue;
    const p = b.bb.body.translation();
    if (m.arena.isOut(p.x, p.z)) {
      b.out = 'ring';
      m.physics.releaseToFall(b.bb);
      b.bb.collider.setCollisionGroups(GHOST_GROUPS);
      b.ghostApplied = true;
      m.emit({ type: 'ko', slot: b.slot, cause: 'ring' });
    } else if (b.spin <= 0) {
      b.spin = 0;
      b.out = 'spin';
      m.emit({ type: 'ko', slot: b.slot, cause: 'spin' });
    }
    if (b.out && m.koAt < 0) { m.koAt = m.t; m.koCause = b.out; }
  }
  // blades that have left the floor stop colliding
  for (const b of m.blades) if (b.out === 'ring' && !b.fallen && Math.hypot(b.x, b.z) > m.arena.radius + 1.6) b.fallen = true;

  if (m.koAt >= 0 && (m.koCause === 'spin' || m.t - m.koAt >= TUNING.SIMUL_WINDOW)) finish(m, false);
  else if (m.koAt < 0 && m.t >= TUNING.TIMEOUT) finish(m, true);
}

function finish(m: Match, timeout: boolean): void {
  const alive = m.blades.filter((b) => !b.out);
  const causes: Array<KoCause | null> = m.blades.map((b) => b.out);
  const out = m.blades.filter((b) => b.out);
  const both = out.length >= m.blades.length - (alive.length === 1 ? 1 : 0) && out.length > 1 && alive.length === 0;
  // two blades running dry on the very same tick: compare the spin each had going into it
  const sameTick = out.length > 1 && out.every((b) => b.out === 'spin');
  const score = (b: BladeRuntime) => (sameTick ? b.prevSpin : b.spin);

  let winner = -1;
  if (alive.length === 1) winner = alive[0].slot;
  else {
    const pool = alive.length ? alive : m.blades;
    const sorted = [...pool].sort((a, b) => score(b) - score(a));
    winner = sorted.length > 1 && Math.abs(score(sorted[0]) - score(sorted[1])) < 0.25 ? -1 : sorted[0].slot;
  }

  m.phase = 'over';
  const result: MatchResult = {
    winner, doubleKO: both, timeout, causes,
    spins: m.blades.map((b) => Math.max(0, b.spin)),
    tieSpins: sameTick ? m.blades.map((b) => Math.max(0, b.prevSpin)) : null,
    stats: m.blades.map((b) => ({ ...b.stats })),
    duration: m.t,
  };
  m.result = result;
  m.emit({ type: 'end', result });
}
