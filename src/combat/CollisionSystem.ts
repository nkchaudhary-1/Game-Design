// CollisionSystem: what a collision *means* in game terms.
//
// Rapier resolves the physical contact (overlap, mass exchange, restitution, spin friction). On top of that
// we apply the game layer, exactly as the 2D prototype proved out:
//   - knockback each blade takes is scaled by (attacker's attack × knockback) ÷ (victim's defense)
//   - spin damage scales with closing speed × attack ÷ defense^DEF_EXP; the blade that was closing faster
//     takes less and deals more
//   - contact kicks blades apart (stronger while both are spinning fast), partly sideways
// Invulnerable, shielded and ghosted blades are respected.

import { TUNING, lowSpinFactor } from '../core/Balance';
import { clamp } from '../core/types';
import type { BladeRuntime } from '../blades/Blade';
import { onSuperHit } from './SuperSystem';
import { hurt } from './SpinSystem';
import type { Match } from './Match';

export type PreVel = Map<number, { vx: number; vz: number }>;

export function handleCollision(m: Match, A: BladeRuntime, B: BladeRuntime, pre: PreVel): void {
  if (A.fallen || B.fallen || A.hasFlag('ghost') || B.hasFlag('ghost')) return;
  const dx = B.x - A.x, dz = B.z - A.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return;
  const nx = dx / dist, nz = dz / dist;
  const pa = pre.get(A.slot)!, pb = pre.get(B.slot)!;

  // how fast each blade was moving into the other, measured before the solver changed anything
  const vAn = pa.vx * nx + pa.vz * nz;
  const vBn = -(pb.vx * nx + pb.vz * nz);
  const rvn = vAn + vBn;
  if (rvn <= 0) return;

  const cA = A.built.combat, cB = B.built.combat;
  const lowA = lowSpinFactor(A.spin), lowB = lowSpinFactor(B.spin);
  const shielded = (b: BladeRuntime) => !!b.shield && b.shield.hits > 0;

  // -- knockback: scale the solver's velocity change per blade
  const kbPowA = cA.atkMul * cA.kbDealt * A.mod('kbDealt') * lowA;
  const kbPowB = cB.atkMul * cB.kbDealt * B.mod('kbDealt') * lowB;
  let kA = clamp(Math.pow(kbPowB / cA.defMul, TUNING.KB_EXP), 0.6, 1.7) * A.mod('kbTaken');
  let kB = clamp(Math.pow(kbPowA / cB.defMul, TUNING.KB_EXP), 0.6, 1.7) * B.mod('kbTaken');
  if (A.hasFlag('invuln')) kA *= 0.15; else if (shielded(A)) kA *= 0.3;
  if (B.hasFlag('invuln')) kB *= 0.15; else if (shielded(B)) kB *= 0.3;

  const post = { a: A.bb.body.linvel(), b: B.bb.body.linvel() };
  let vax = pa.vx + (post.a.x - pa.vx) * kA, vaz = pa.vz + (post.a.z - pa.vz) * kA;
  let vbx = pb.vx + (post.b.x - pb.vx) * kB, vbz = pb.vz + (post.b.z - pb.vz) * kB;

  // -- clash kick: contact always throws the blades apart, harder while both are spinning fast
  const kick = TUNING.CLASH_KICK * clamp((A.spin + B.spin) / 200, 0, 1);
  const ks = kick * TUNING.CLASH_TAN;
  const iA = 1 / A.appliedMass, iB = 1 / B.appliedMass;
  const wA = iA / (iA + iB), wB = iB / (iA + iB);
  const tx = -nz, tz = nx;
  vax += (-nx * kick + tx * ks) * wA; vaz += (-nz * kick + tz * ks) * wA;
  vbx += (nx * kick - tx * ks) * wB; vbz += (nz * kick - tz * ks) * wB;

  // knockback reflection (Rebound)
  const dA = Math.hypot(vax - pa.vx, vaz - pa.vz), dB = Math.hypot(vbx - pb.vx, vbz - pb.vz);
  if (A.hasFlag('reflectKnockback')) { vbx += nx * dA * 0.7; vbz += nz * dA * 0.7; }
  if (B.hasFlag('reflectKnockback')) { vax -= nx * dB * 0.7; vaz -= nz * dB * 0.7; }

  A.bb.body.setLinvel({ x: vax, y: 0, z: vaz }, true);
  B.bb.body.setLinvel({ x: vbx, y: 0, z: vbz }, true);

  if (rvn < TUNING.HIT_MIN) return;

  // -- spin damage
  const atkA = cA.atkMul * A.mod('dmgDealt') * lowA;
  const atkB = cB.atkMul * B.mod('dmgDealt') * lowB;
  const shareA = clamp(vAn / Math.max(1e-6, vAn + vBn), 0, 1);
  const base = TUNING.SPIN_DMG * rvn;
  const jit = () => 1 + (m.rng() * 2 - 1) * TUNING.DAMAGE_JITTER;
  let toA = Math.min(TUNING.HIT_CAP, (base * atkB) / Math.pow(cA.defMul, TUNING.DEF_EXP) * (1 + TUNING.ATTACK_EDGE * (1 - 2 * shareA))) * jit();
  let toB = Math.min(TUNING.HIT_CAP, (base * atkA) / Math.pow(cB.defMul, TUNING.DEF_EXP) * (1 - TUNING.ATTACK_EDGE * (1 - 2 * shareA))) * jit();

  // ambush (Hide & Seek): the first hit out of stealth is a big one
  if (B.hasFlag('ambush')) { toA *= 1.7; B.removeFlag('ambush'); B.removeFlag('stealth'); }
  if (A.hasFlag('ambush')) { toB *= 1.7; A.removeFlag('ambush'); A.removeFlag('stealth'); }

  const lostA = hurt(m, A, { amount: toA, attacker: B });
  const lostB = hurt(m, B, { amount: toB, attacker: A });
  A.stats.hits++; B.stats.hits++;
  m.lastHit = m.t;

  const strength = clamp(rvn / 14.4, 0.08, 1);
  m.emit({
    type: 'hit', x: A.x + nx * A.radius, z: A.z + nz * A.radius, nx, nz, strength, a: A.slot, b: B.slot,
    dmgA: lostA, dmgB: lostB, heavy: strength > 0.55,
  });

  onSuperHit(m, A, B);
  onSuperHit(m, B, A);
}
