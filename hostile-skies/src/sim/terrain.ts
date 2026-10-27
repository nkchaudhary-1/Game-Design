// The world's ground: one deterministic height function used by the renderer (to build chunks), the flight model
// (crash checks), and the alien AI (terrain avoidance). x is east, z is south (so north is -z), y is up, metres.

import { clamp, lerp, smoothstep } from './util';

export const SEA_LEVEL = 0;
/** Combat area. Past this the pilot is told to turn back. */
export const ARENA_RADIUS = 9000;
export const ARENA_HARD_LIMIT = 10500;

export interface CitySite {
  id: number;
  name: string;
  x: number;
  z: number;
  /** Radius of the built-up area. */
  radius: number;
  /** Ground height the city is flattened to. */
  level: number;
  /** Hit points of the whole city. */
  hp: number;
}

export const CITY_SITES: readonly CitySite[] = [
  { id: 0, name: 'HARBOR', x: -2900, z: -700, radius: 520, level: 11, hp: 1500 },
  { id: 1, name: 'RIDGE', x: 2500, z: -2600, radius: 440, level: 96, hp: 1500 },
  { id: 2, name: 'DELTA', x: 600, z: 2700, radius: 480, level: 14, hp: 1500 },
];

/** Where the pilot starts, and which way they face (north). */
export const SPAWN = { x: -150, y: 1250, z: 3400 } as const;

// ---- noise -------------------------------------------------------------------------------------------------------

function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function fbm(x: number, z: number, oct: number): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f + i * 17.3, z * f - i * 9.1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Ridged noise: sharp crests, for mountains. 0..1 */
function ridged(x: number, z: number, oct: number): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x * f + i * 31.7, z * f + i * 5.3) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

// ---- height ------------------------------------------------------------------------------------------------------

/** Ground height at (x, z), in metres above sea level. Negative values are sea floor (hidden under the water). */
export function terrainHeight(x: number, z: number): number {
  // A continent leaning north-east: ocean to the west and south, mountains to the north and east.
  const dx = x - 1400, dz = z + 900;
  const d = Math.hypot(dx * 0.92, dz * 1.1);
  const warp = (fbm(x * 0.00022, z * 0.00022, 3) - 0.5) * 2600;
  const land = smoothstep(7600, 3900, d + warp);

  const rolling = fbm(x * 0.00055, z * 0.00055, 5);
  const hills = (rolling - 0.4) * 260;
  const mount = ridged(x * 0.00028 + 11, z * 0.00028 - 4, 5);
  const mountMask = smoothstep(-2200, 1800, x * 0.55 - z * 0.75 - 700) * land;
  const peaks = Math.pow(mount, 1.55) * 1150 * mountMask;

  let h = land * (34 + hills) + peaks - (1 - land) * 70;

  // Coastal beach: pull the shore towards a gentle slope so sand reads as sand.
  if (h > -6 && h < 14) h = lerp(h, h * 0.55, 0.35);

  for (const c of CITY_SITES) {
    const cd = Math.hypot(x - c.x, z - c.z);
    const w = smoothstep(c.radius * 2.1, c.radius * 1.05, cd);
    if (w > 0) h = lerp(h, c.level + (fbm(x * 0.01, z * 0.01, 2) - 0.5) * 2, w);
  }
  return h;
}

/** Height of whatever you would hit: ground, or the sea surface. */
export const surfaceHeight = (x: number, z: number): number => Math.max(SEA_LEVEL, terrainHeight(x, z));

/**
 * Looks ahead along a velocity vector and returns seconds until the surface would be hit (Infinity if clear within
 * `horizon`). Used for the PULL UP warning and for alien terrain avoidance.
 */
export function timeToImpact(
  px: number, py: number, pz: number, vx: number, vy: number, vz: number, margin = 25, horizon = 5,
): number {
  const step = 0.25;
  for (let t = step; t <= horizon; t += step) {
    // include a pull-up arc: a pilot reacting needs room, so assume sag of 3 m/s^2 over the look-ahead
    const y = py + vy * t - 1.5 * 3 * t * t * 0.25;
    if (y < surfaceHeight(px + vx * t, pz + vz * t) + margin) return t;
  }
  return Infinity;
}

/** Colour of the ground at a point, from height and steepness. Returns linear-ish RGB 0..1 (dusk-tinted). */
export function groundColor(h: number, slope: number, n: number, out: [number, number, number]): void {
  // palette (already toned for a dusk sky): sand, grass, forest, rock, snow
  const sand: [number, number, number] = [0.42, 0.36, 0.27];
  const grass: [number, number, number] = [0.16, 0.32, 0.14];
  const forest: [number, number, number] = [0.07, 0.19, 0.1];
  const rock: [number, number, number] = [0.31, 0.29, 0.3];
  const snow: [number, number, number] = [0.78, 0.8, 0.9];
  const mix = (a: [number, number, number], b: [number, number, number], t: number) => {
    out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t);
  };
  out[0] = grass[0]; out[1] = grass[1]; out[2] = grass[2];
  if (h < 9) mix(sand, grass, smoothstep(2, 9, h));
  else if (h < 260) mix(grass, forest, clamp(0.35 + n * 0.8, 0, 1) * smoothstep(40, 130, h));
  else mix(forest, rock, smoothstep(260, 520, h));
  const rocky = smoothstep(0.42, 0.78, slope + (n - 0.5) * 0.25);
  mix([out[0], out[1], out[2]], rock, rocky);
  if (h > 780) mix([out[0], out[1], out[2]], snow, smoothstep(780, 1050, h + (n - 0.5) * 140) * (1 - rocky * 0.5));
  const shade = 0.88 + n * 0.24;
  out[0] *= shade; out[1] *= shade; out[2] *= shade;
}
