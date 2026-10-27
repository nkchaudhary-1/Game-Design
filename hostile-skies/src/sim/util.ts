// Small shared helpers for the simulation. The sim never touches the DOM or WebGL, only three's math types,
// so it runs unchanged in the browser and in Vitest/node.

/** mulberry32: small, fast, seedable. Every mission uses one so runs are reproducible in tests. */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v < 0 ? -1 : 1);
export const rr = (rng: Rng, a: number, b: number): number => a + (b - a) * rng();
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length]!;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing factor: v += (target - v) * damp(rate, dt). */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a: number): number {
  const t = Math.PI * 2;
  a = (a + Math.PI) % t;
  if (a < 0) a += t;
  return a - Math.PI;
}

export const DEG = Math.PI / 180;
export const G = 9.81;
