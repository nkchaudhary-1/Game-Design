// Who is rubbing against what. Blades that stay in contact grind (sparks, a scraping sound), and a fast blade
// riding the lip of the pit grinds against the wall. Pure: reads the match, draws and plays nothing.

import type { Match } from '../combat/Match';
import { clamp } from '../core/types';

export interface PairContact { a: number; b: number; x: number; z: number; nx: number; nz: number; level: number }
export interface WallContact { slot: number; x: number; z: number; tx: number; tz: number; level: number }
export interface ContactState {
  pairs: PairContact[];
  walls: WallContact[];
  /** Loudest grind, 0–1. */
  level: number;
  /** Stereo position of the grind, −1 (left) … 1 (right). */
  pan: number;
}

/** Gap (world units) under which two blades count as touching. */
const TOUCH = 0.14;
/** Fraction of the arena radius where the lip starts to count as wall contact. */
const LIP_START = 0.8;

export function contactState(m: Match): ContactState {
  const out: ContactState = { pairs: [], walls: [], level: 0, pan: 0 };
  if (m.phase !== 'live') return out;
  const R = m.arena.radius;
  const live = m.blades.filter((b) => b.launched && !b.out && !b.fallen);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i], B = live[j];
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz) || 1e-6;
      const gap = d - (A.radius + B.radius);
      if (gap > TOUCH) continue;
      const nx = dx / d, nz = dz / d;
      const rel = Math.hypot(B.vx - A.vx, B.vz - A.vz);
      // two spinning rims always rub; moving against each other rubs harder
      const level = clamp(0.3 + rel / 9, 0, 1) * clamp(1 - gap / TOUCH, 0, 1);
      out.pairs.push({ a: A.slot, b: B.slot, x: A.x + nx * A.radius, z: A.z + nz * A.radius, nx, nz, level });
    }
  }
  for (const b of live) {
    const r = Math.hypot(b.x, b.z);
    if (r < 1e-3 || b.spin < 4) continue;
    const edge = clamp((r - LIP_START * R) / ((1 - LIP_START) * R), 0, 1);
    const level = edge * clamp(Math.hypot(b.vx, b.vz) / 7, 0, 1);
    if (level < 0.05) continue;
    const ux = b.x / r, uz = b.z / r;
    out.walls.push({ slot: b.slot, x: ux * Math.min(r + b.radius * 0.6, R), z: uz * Math.min(r + b.radius * 0.6, R), tx: -uz, tz: ux, level });
  }
  let wsum = 0, w = 0;
  for (const p of out.pairs) { out.level = Math.max(out.level, p.level); wsum += p.x * p.level; w += p.level; }
  for (const p of out.walls) { out.level = Math.max(out.level, p.level * 0.8); wsum += p.x * p.level; w += p.level; }
  out.pan = w > 0 ? clamp(wsum / w / R, -1, 1) : 0;
  return out;
}
