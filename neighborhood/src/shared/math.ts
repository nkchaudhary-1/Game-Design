export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}
export const angleDiff = (from: number, to: number) => wrapAngle(to - from);
export function approachAngle(cur: number, target: number, maxStep: number): number {
  const d = angleDiff(cur, target);
  return Math.abs(d) <= maxStep ? target : wrapAngle(cur + Math.sign(d) * maxStep);
}
export const round3 = (v: number) => Math.round(v * 1000) / 1000;
