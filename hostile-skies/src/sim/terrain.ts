// The world's ground: one deterministic height function used by the renderer (to build chunks), the flight model
// (crash checks), and the alien AI (terrain avoidance). x is east, z is south (so north is -z), y is up, metres.

import { lerp, smoothstep } from './util';

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

/** Two smooth noise fields used for ground colour and tree placement: fine variation, and big patches such as fields. */
export const groundNoise = (wx: number, wz: number): number => (Math.sin(wx * 0.013 + Math.sin(wz * 0.009) * 2) + Math.sin(wz * 0.017 - wx * 0.006) + 2) * 0.25;
export const groundPatches = (wx: number, wz: number): number => (Math.sin(wx * 0.0017 + 1.3) + Math.sin(wz * 0.0023 - 0.7) + Math.sin((wx + wz) * 0.0011) + 3) / 6;
/** How wooded the ground is (0..1) from height and the two noise fields. */
export const forestAmount = (h: number, n: number, n2: number): number =>
  smoothstep(30, 120, h) * (1 - smoothstep(820, 1000, h)) * smoothstep(0.38, 0.52, n * 0.6 + n2 * 0.5);

/**
 * Colour of the ground at a point, from height, steepness and two noise values (n: fine variation, n2: big patches
 * such as fields). Returns linear RGB 0..1 for a late-afternoon sun: sand, meadow, dry fields, conifer forest, rock, snow.
 */
export function groundColor(h: number, slope: number, n: number, n2: number, out: [number, number, number]): void {
  const sand: [number, number, number] = [0.5, 0.42, 0.25];
  const wet: [number, number, number] = [0.26, 0.22, 0.14];
  const meadow: [number, number, number] = [0.15, 0.2, 0.05];
  const dry: [number, number, number] = [0.3, 0.26, 0.09];
  const forest: [number, number, number] = [0.028, 0.06, 0.02];
  const alpine: [number, number, number] = [0.15, 0.17, 0.08];
  const rock: [number, number, number] = [0.19, 0.16, 0.13];
  const snow: [number, number, number] = [0.74, 0.76, 0.82];
  const mix = (a: [number, number, number], b: [number, number, number], t: number) => {
    out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t);
  };
  const cur = (): [number, number, number] => [out[0], out[1], out[2]];

  // lowland: fields of meadow and dry crop in patches, wet sand at the waterline, dry sand above it
  const field = smoothstep(0.42, 0.58, n2);
  mix(meadow, dry, field * 0.85);
  if (h < 3) mix(wet, sand, smoothstep(-2, 3, h));
  if (h >= 3 && h < 14) { mix(sand, field > 0.5 ? dry : meadow, smoothstep(3, 14, h)); }
  // forest on the hills, thinning out below 40 m and above the treeline
  const forestAmt = forestAmount(h, n, n2);
  if (h >= 14) mix(cur(), forest, forestAmt);
  // alpine meadow above the trees
  if (h > 760) mix(cur(), alpine, smoothstep(760, 950, h));
  const rocky = smoothstep(0.4, 0.75, slope + (n - 0.5) * 0.25 + smoothstep(700, 1150, h) * 0.25);
  mix(cur(), rock, rocky);
  if (h > 880) mix(cur(), snow, smoothstep(880, 1120, h + (n - 0.5) * 150) * (1 - rocky * 0.55));
  const shade = 0.86 + n * 0.28;
  out[0] *= shade; out[1] *= shade; out[2] *= shade;
}
