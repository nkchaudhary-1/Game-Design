// Visual rotation helpers. A spinning blade is sampled once per frame; if it turns more than half the spacing
// between two fins in one frame the eye reads it as spinning backwards (the wagon-wheel effect), which looks like
// stutter. So the turn per frame is capped at a third of the fin spacing, whatever the spin speed or frame rate:
// a slow frame makes the blade look slightly slower, never jerky.

import { TAU } from '../core/types';

/** Largest turn per frame, as a fraction of the gap between two fins. Must stay below 0.5. */
export const MAX_TURN_PER_FRAME = 0.33;

/** Angle (radians) to advance this frame for a blade spinning at `omega` rad/s with `symmetry` repeating fins. */
export function frameTurn(omega: number, dt: number, symmetry: number): number {
  const cap = (MAX_TURN_PER_FRAME * TAU) / Math.max(1, symmetry);
  return Math.min(Math.max(0, omega) * dt, cap);
}
