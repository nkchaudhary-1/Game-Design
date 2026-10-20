// How a real spinning top behaves, as small pure functions the renderer drives. None of this touches the
// simulation: it only decides how the blade's model tilts, hops and tumbles, so the balance is unchanged.
//
//   * Gyroscopic precession. A fast top stands upright. As it slows it starts to lean and the lean sweeps round
//     (precesses); the slower the spin, the bigger the lean and the faster it sweeps. Then it topples.
//   * Impact. A hit kicks the model up off the floor and tilts it, and it settles on a damped spring.
//   * Tumble. A blade that leaves the arena pitches over as it falls.

import { clamp } from '../core/types';

/** Spin (%) below which the top starts to lean. */
export const WOBBLE_START = 38;
/** Final lean of a toppled blade resting on its rim, radians (~28°). */
export const TOPPLE_TILT = 0.5;

/** 0 = upright (fast spin) … 1 = about to fall (no spin). */
export function wobbleAmount(spin: number): number {
  return Math.pow(clamp((WOBBLE_START - spin) / WOBBLE_START, 0, 1), 1.4);
}

/** Precession rate, rad/s: gentle at first, then quicker as the spin dies (as a real gyroscope does). */
export function precessionRate(spin: number): number {
  return 1.6 + 8.5 * wobbleAmount(spin);
}

/** Lean angle (radians) from wobble alone, before topple and impacts. */
export function wobbleTilt(spin: number): number {
  return 0.3 * wobbleAmount(spin);
}

export interface Dyn {
  /** Tilt of the top towards +x / +z (radians), and its rate. */
  tx: number; tz: number; vtx: number; vtz: number;
  /** Height above the floor (world units) and its rate. */
  hop: number; vhop: number;
}

export const newDyn = (): Dyn => ({ tx: 0, tz: 0, vtx: 0, vtz: 0, hop: 0, vhop: 0 });

const TILT_K = 85;      // spring stiffness, 1/s²
const TILT_C = 8.5;     // damping, 1/s (under-damped: it rocks once or twice, then settles)
const HOP_G = 30;       // gravity for the hop, units/s²

/** Advance the impact spring and the hop by `dt`. */
export function stepDyn(d: Dyn, dt: number): void {
  d.vtx += (-TILT_K * d.tx - TILT_C * d.vtx) * dt; d.tx += d.vtx * dt;
  d.vtz += (-TILT_K * d.tz - TILT_C * d.vtz) * dt; d.tz += d.vtz * dt;
  d.vhop -= HOP_G * dt; d.hop += d.vhop * dt;
  if (d.hop < 0) { d.hop = 0; d.vhop = d.vhop < -0.8 ? -d.vhop * 0.3 : 0; }  // lands, bounces a little, rests
}

/**
 * A hit from the direction opposite (px, pz) (unit vector: where the blade is pushed to). The base is shoved along it
 * and the top lags behind, so the model tilts back towards the attacker, and it hops. `strength` is 0–1.
 */
export function impact(d: Dyn, px: number, pz: number, strength: number): void {
  const s = clamp(strength, 0, 1);
  d.vtx += -px * (2.2 + 5.5 * s); d.vtz += -pz * (2.2 + 5.5 * s);
  d.vhop += 1.2 + 4 * s;
}

/** Highest the hop can reach for a given launch rate: v² / 2g. Used by the tests. */
export const hopHeight = (v: number): number => (v * v) / (2 * HOP_G);
