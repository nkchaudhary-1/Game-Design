// One silhouette per blade. The roster used to be three stacks (spiral fins / plate wheel / crescent fins) with
// the colour and count changed, so every blade in a class looked the same. Each blade now has its own builder,
// keyed by `profile.look`, so it reads differently from above, from the side and in motion:
//
//   ATTACK   Ravok hooked blades · Blazefang flame tongues · Riftclaw triple claw · Volt Reaper saw ring
//            Titan Breaker axe heads · Inferno X flame pinwheel · Stormfang long/short fangs
//   DEFENSE  Gravion armour wheel · Iron Warden thorn plates · Bastion X castle octagon · Stonecore boulders
//            Aegiron shield arcs · Guardian Prime cross · Gravity Rex orbiting discs
//   STAMINA  Phantom crescents + orbs · Voidrunner daggers · Nightveil leaf tiers · Spectra petals
//            Ghost Viper S-curves · Chrono clock · Nebula Drift spiral arms with stars
//
// Every builder fills the same material layers (main / mid / dark / steel / accent / gold / glow) and returns the
// height the core cap sits at and how many times the pattern repeats (the renderer caps the turn per frame by it).

import * as THREE from 'three';
import { TAU } from '../core/types';
import { armourPlate, bandProfile, bladeOutline, finGlow, lathe, polar, prism, radialSegs, ringSector, spike, sweptFin, torusSegs, type FinSpec } from './partGeometry';

export interface Layers {
  main: THREE.BufferGeometry[]; mid: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[]; steel: THREE.BufferGeometry[];
  accent: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[]; gold: THREE.BufferGeometry[];
}
export const layers = (): Layers => ({ main: [], mid: [], dark: [], steel: [], accent: [], glow: [], gold: [] });

export interface Ctx { R: number; n: number; reach: number; k: number; L: Layers }
export interface Built { top: number; sym: number }

const fin = (a0: number, rin: number, rout: number, sweep: number, halfW: number, y0: number, h: number, notch = 0.35, curl = 1.4): FinSpec =>
  ({ a0, rin, rout, sweep, halfW, height: h, under: h * 0.35, y0, notch, curl });

/** Dark armoured hub ring every blade sits on. */
const hub = (R: number, L: Layers, r = 0.5, h = 0.14): void => { L.dark.push(lathe(bandProfile(R * r, R * h), radialSegs()).translate(0, -R * 0.04, 0)); };
/** A flat closed ring (annulus) standing on y. */
const ring = (ri: number, ro: number, h: number, y: number, segs = radialSegs()): THREE.BufferGeometry =>
  lathe([[ri, 0], [ro, 0], [ro, h], [ri, h], [ri, 0]], segs).translate(0, y, 0);
const orb = (r: number, a: number, rad: number, y: number): THREE.BufferGeometry => {
  const [x, z] = polar(r, a);
  return new THREE.SphereGeometry(rad, 14, 10).translate(x, y, z);
};
/** Deterministic 0..1 noise so irregular shapes (boulders) are the same every time. */
const noise = (i: number, j: number): number => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };

// ======================================================================================================= ATTACK
/** Ravok: five big hooked blades with barbs between them (the reference render's red/black turbine). */
function ravok({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    L.dark.push(sweptFin(fin(a + 0.5 * step, R * 0.3, Ro * 0.92, 0.9 * step, R * 0.3, 0, R * 0.1 * k, 0.5, 1.2)));
    const top = fin(a, R * 0.36, Ro * 1.06, 1.0 * step, R * 0.27, R * 0.1 * k, R * 0.16 * k, 0.6, 1.1);
    L.main.push(sweptFin(top));
    L.glow.push(finGlow(top, 0.6, 0.15, 0.9));
    L.steel.push(spike(Ro * 0.58, a + 0.62 * step, R * 0.34, R * 0.07, R * 0.12 * k));
  }
  hub(R, L, 0.7, 0.18);
  return { top: R * 0.26 * k, sym: n };
}

/** Blazefang: four broad flame tongues, each with a smaller tongue licking behind it, and an ember ring. */
function blazefang({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const big = fin(a, R * 0.34, Ro * 1.04, 0.7 * step, R * 0.34, R * 0.08 * k, R * 0.16 * k, 0.15, 0.85);
    L.main.push(sweptFin(big));
    L.glow.push(finGlow(big, 0.2, 0.1, 0.85));
    L.mid.push(sweptFin(fin(a + 0.5 * step, R * 0.34, Ro * 0.76, 1.1 * step, R * 0.2, 0, R * 0.1 * k, 0.2, 1.1)));
    L.accent.push(spike(Ro * 0.5, a + 0.2 * step, R * 0.2, R * 0.05, R * 0.2 * k));
  }
  for (let i = 0; i < n * 2; i++) L.dark.push(spike(R * 0.46, (i * TAU) / (n * 2), R * 0.2, R * 0.06, R * 0.06));
  hub(R, L, 0.62, 0.16);
  return { top: R * 0.24 * k, sym: n };
}

/** Riftclaw: three huge curved claws with open gaps between them, over a dark triangular plate. */
function riftclaw({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    L.main.push(prism(bladeOutline(a, R * 0.22, Ro * 1.02, 0.62 * step, 1.5, (t) => R * (0.36 * Math.pow(Math.max(0, 1 - Math.pow(t, 1.5)), 0.65) + 0.015), 0.55, 14), R * 0.14 * k, R * 0.1 * k));
    L.mid.push(prism(bladeOutline(a + 0.45 * step, R * 0.22, Ro * 0.86, 0.55 * step, 1.4, (t) => R * (0.22 * Math.pow(Math.max(0, 1 - Math.pow(t, 1.4)), 0.7) + 0.015), 0.3, 12), R * 0.1 * k, 0));
    L.accent.push(spike(Ro * 0.88, a + 0.5 * step, R * 0.3, R * 0.05, R * 0.18 * k));
  }
  const tri: Array<[number, number]> = [0, 1, 2].map((i) => polar(R * 0.58, (i * TAU) / 3));
  L.dark.push(prism(tri, R * 0.12, R * 0.02));
  hub(R, L, 0.45, 0.14);
  return { top: R * 0.24 * k, sym: n };
}

/** Volt Reaper: a sawblade. Outer ring of hooked teeth, zig-zag spokes. */
function voltReaper({ R, n, reach, k, L }: Ctx): Built {
  const Ro = R * reach, teeth = n * 3, stepT = TAU / teeth;
  L.dark.push(ring(Ro * 0.84, Ro * 0.96, R * 0.13 * k, 0));
  for (let i = 0; i < teeth; i++) {
    const a = i * stepT;
    L.main.push(prism([polar(Ro * 0.93, a), polar(Ro * 1.06, a + stepT * 0.9), polar(Ro * 0.93, a + stepT * 0.98)], R * 0.12 * k, R * 0.01));
  }
  const step = TAU / n;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const f = fin(a, R * 0.3, Ro * 0.9, 0.35 * step, R * 0.11, R * 0.06 * k, R * 0.1 * k, 0, 1.0);
    L.main.push(sweptFin(f)); L.glow.push(finGlow(f, 0.1, 0.12, 0.92));
    L.accent.push(sweptFin(fin(a + 0.5 * step, R * 0.3, Ro * 0.8, -0.3 * step, R * 0.07, 0, R * 0.07 * k, 0, 1.0)));
  }
  hub(R, L, 0.62, 0.16);
  return { top: R * 0.22 * k, sym: teeth };
}

/** Titan Breaker: four heavy axe heads with steel cutting edges and gold bolts. */
function titanBreaker({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const head = (w: number, r0: number, r1: number, sw: number): Array<[number, number]> => bladeOutline(a, r0, r1, sw * step, 1, (t) => R * (0.15 + w * Math.pow(t, 0.75)) * (1 - 0.1 * Math.pow(t, 8)), 0.2, 10);
    L.steel.push(prism(head(0.36, R * 0.34, Ro * 0.98, 0.28), R * 0.2 * k, R * 0.04));
    L.main.push(prism(head(0.24, R * 0.42, Ro * 0.8, 0.26), R * 0.05 * k, R * 0.04 + R * 0.2 * k - R * 0.01));
    const [x, z] = polar(Ro * 0.52, a + 0.06 * step);
    L.gold.push(new THREE.CylinderGeometry(R * 0.06, R * 0.06, R * 0.05, 14).translate(x, R * 0.26 * k + R * 0.04, z));
  }
  L.dark.push(prism(Array.from({ length: n }, (_, i) => polar(R * 0.62, (i + 0.5) * step)), R * 0.18, 0));
  hub(R, L, 0.62, 0.2);
  return { top: R * 0.3 * k, sym: n };
}

/** Inferno X: six long, thin flame blades in a pinwheel, with glowing outer arcs. */
function infernoX({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const f = fin(a, R * 0.3, Ro * 1.05, 1.9 * step, R * 0.15, R * 0.08 * k, R * 0.11 * k, 0.3, 1.5);
    L.main.push(sweptFin(f)); L.glow.push(finGlow(f, 0.3, 0.1, 0.95));
    L.mid.push(sweptFin(fin(a + 0.5 * step, R * 0.3, Ro * 0.8, 1.5 * step, R * 0.1, 0, R * 0.08 * k, 0.2, 1.4)));
    L.accent.push(ringSector(Ro * 0.98, Ro * 1.06, a + 0.1 * step, a + 0.55 * step, R * 0.05, R * 0.02));
  }
  hub(R, L, 0.55, 0.15);
  return { top: R * 0.2 * k, sym: n };
}

/** Stormfang: long and short fangs alternating round the hub, like a crown of teeth. */
function stormfang({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step, long = i % 2 === 0;
    const f = fin(a, R * 0.3, Ro * (long ? 1.04 : 0.8), 0.3 * step, R * (long ? 0.2 : 0.17), R * 0.08 * k, R * 0.14 * k, 0.5, 1.0);
    (long ? L.main : L.steel).push(sweptFin(f));
    if (long) L.glow.push(finGlow(f, 0.5, 0.1, 0.9));
    L.steel.push(spike(Ro * (long ? 0.98 : 0.72), a + 0.14 * step, R * 0.26, R * 0.05, R * 0.15 * k));
  }
  L.dark.push(ring(R * 0.6, R * 0.74, R * 0.1 * k, 0));
  hub(R, L, 0.55, 0.15);
  return { top: R * 0.24 * k, sym: n };
}

// ====================================================================================================== DEFENSE
/** Gravion: an armour wheel. Six broad plates (teal / white) in an unbroken rim, gold studs. */
function gravion({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach, T = R * 0.22 * k;
  L.dark.push(ring(Ro * 0.9, Ro * 1.0, T * 0.9, R * 0.02));
  hub(R, L, 0.9, 0.24);
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const p = armourPlate({ phi: a, ri: R * 0.48, ro: Ro * 0.97, wIn: R * 0.48 * step * 0.44, wOut: Ro * step * 0.46, depth: T, dome: R * 0.06, y0: R * 0.04 });
    (i % 2 === 0 ? L.main : L.steel).push(p);
    const [x, z] = polar(Ro * 0.78, a);
    L.gold.push(new THREE.CylinderGeometry(R * 0.05, R * 0.055, R * 0.04, 20).translate(x, R * 0.04 + T + R * 0.03, z));
  }
  L.gold.push(new THREE.TorusGeometry(R * 0.5, R * 0.016, 10, torusSegs()).rotateX(Math.PI / 2).translate(0, R * 0.04 + T * 0.92, 0));
  return { top: R * 0.04 + T + R * 0.04, sym: n };
}

/** Iron Warden: narrow plates, each with a thorn pointing out. */
function ironWarden({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach, T = R * 0.18 * k;
  hub(R, L, 0.8, 0.2);
  for (let i = 0; i < n; i++) {
    const a = i * step;
    L.main.push(armourPlate({ phi: a, ri: R * 0.42, ro: Ro * 0.86, wIn: R * 0.42 * step * 0.3, wOut: Ro * step * 0.27, depth: T, dome: R * 0.05, y0: R * 0.04 }));
    L.steel.push(spike(Ro * 0.8, a, R * 0.42, R * 0.1, R * 0.04 + T * 0.55));
    L.mid.push(armourPlate({ phi: a + 0.5 * step, ri: R * 0.3, ro: Ro * 0.62, wIn: R * 0.2 * step, wOut: Ro * step * 0.1, depth: T * 0.7, dome: R * 0.02, y0: R * 0.08 }));
    L.gold.push(spike(Ro * 0.45, a, R * 0.2, R * 0.045, R * 0.04 + T * 1.0, 0.5));
  }
  return { top: R * 0.04 + T + R * 0.05, sym: n };
}

/** Bastion X: an octagonal fortress with crenellations. */
function bastionX({ R, n, reach, k, L }: Ctx): Built {
  const Ro = R * reach, T = R * 0.2 * k, step = TAU / n;
  L.main.push(lathe([[R * 0.3, 0], [Ro * 0.96, 0], [Ro * 0.98, T * 0.5], [Ro * 0.9, T], [R * 0.3, T]], 8).translate(0, R * 0.02, 0));
  L.dark.push(lathe([[Ro * 0.56, 0], [Ro * 0.66, 0], [Ro * 0.66, T * 1.3], [Ro * 0.56, T * 1.3]], 8).translate(0, R * 0.04, 0));
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * step, w = Ro * step * 0.17, r0 = Ro * 0.68, r1 = Ro * 0.94;
    const c = Math.cos(a), s = Math.sin(a), tx = -s, tz = c;
    const pts: Array<[number, number]> = [[c * r0 - tx * w, s * r0 - tz * w], [c * r1 - tx * w, s * r1 - tz * w], [c * r1 + tx * w, s * r1 + tz * w], [c * r0 + tx * w, s * r0 + tz * w]];
    L.mid.push(prism(pts, R * 0.2 * k, T + R * 0.02));
    const [x, z] = polar(Ro * 0.81, a);
    L.gold.push(new THREE.CylinderGeometry(R * 0.04, R * 0.04, R * 0.03, 12).translate(x, T + R * 0.02 + R * 0.2 * k + R * 0.015, z));
  }
  return { top: T + R * 0.1, sym: n };
}

/** Stonecore: five irregular boulders round a dark core, with glowing cracks between them. */
function stonecore({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  hub(R, L, 0.82, 0.16);
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * step, c = polar(Ro * 0.66, a), size = R * (0.34 + 0.08 * noise(i, 1));
    const pts: Array<[number, number]> = [];
    const m = 8;
    for (let j = 0; j < m; j++) { const ang = (j * TAU) / m, rr = size * (0.82 + 0.3 * noise(i, j + 2)); pts.push([c[0] + Math.cos(ang) * rr, c[1] + Math.sin(ang) * rr * 0.92]); }
    L.main.push(prism(pts, R * (0.2 + 0.1 * noise(i, 9)) * k, R * 0.04, 0.4));
    const inner = pts.map(([x, z]) => [c[0] + (x - c[0]) * 0.55, c[1] + (z - c[1]) * 0.55] as [number, number]);
    L.mid.push(prism(inner, R * (0.34 + 0.1 * noise(i, 9)) * k, R * 0.04, 0.4));
    L.accent.push(orb(Ro * 0.66, a + 0.5 * step, R * 0.045, R * 0.2 * k));
  }
  return { top: R * 0.36 * k, sym: n };
}

/** Aegiron: three broad shield arcs inside a steel hoop, with energy gems in the gaps. */
function aegiron({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach, T = R * 0.2 * k;
  L.steel.push(new THREE.TorusGeometry(Ro * 0.98, R * 0.055, 12, torusSegs()).rotateX(Math.PI / 2).translate(0, R * 0.1, 0));
  hub(R, L, 0.7, 0.16);
  for (let i = 0; i < n; i++) {
    const a = i * step;
    L.main.push(ringSector(Ro * 0.58, Ro * 0.92, a + 0.08 * step, a + 0.86 * step, T, R * 0.04));
    L.mid.push(ringSector(Ro * 0.38, Ro * 0.54, a + 0.12 * step, a + 0.8 * step, T * 0.8, R * 0.08));
    L.glow.push(ringSector(Ro * 0.915, Ro * 0.95, a + 0.1 * step, a + 0.84 * step, R * 0.03, T + R * 0.05));
    L.accent.push(orb(Ro * 0.75, a + 0.97 * step, R * 0.09, R * 0.18 * k));
  }
  return { top: T + R * 0.08, sym: n };
}

/** Guardian Prime: a broad cross of shield wings with small blocks on the diagonals. */
function guardianPrime({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach, T = R * 0.2 * k;
  hub(R, L, 0.75, 0.18);
  L.steel.push(new THREE.TorusGeometry(Ro * 0.62, R * 0.03, 10, torusSegs()).rotateX(Math.PI / 2).translate(0, R * 0.06 + T * 0.6, 0));
  for (let i = 0; i < n; i++) {
    const a = i * step;
    L.main.push(armourPlate({ phi: a, ri: R * 0.3, ro: Ro * 1.0, wIn: R * 0.28, wOut: Ro * step * 0.34, depth: T, dome: R * 0.06, y0: R * 0.04 }));
    L.mid.push(armourPlate({ phi: a + 0.5 * step, ri: R * 0.5, ro: Ro * 0.74, wIn: R * 0.16, wOut: R * 0.2, depth: T * 0.7, dome: R * 0.03, y0: R * 0.06 }));
    L.accent.push(armourPlate({ phi: a, ri: Ro * 0.5, ro: Ro * 0.86, wIn: R * 0.05, wOut: R * 0.07, depth: T * 0.4, dome: R * 0.02, y0: R * 0.04 + T }));
  }
  return { top: R * 0.04 + T + R * 0.04, sym: n * 2 };
}

/** Gravity Rex: a heavy core with seven discs in orbit. */
function gravityRex({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach, T = R * 0.2 * k;
  L.dark.push(ring(Ro * 0.4, Ro * 0.9, R * 0.06, R * 0.01));
  L.main.push(lathe([[R * 0.3, 0], [Ro * 0.56, 0], [Ro * 0.58, T * 0.6], [Ro * 0.5, T], [R * 0.3, T]], radialSegs()).translate(0, R * 0.04, 0));
  for (let i = 0; i < n; i++) {
    const a = i * step, [x, z] = polar(Ro * 0.78, a);
    L.mid.push(new THREE.CylinderGeometry(R * 0.2, R * 0.22, T * 0.9, 28).translate(x, R * 0.04 + T * 0.45, z));
    L.steel.push(new THREE.TorusGeometry(R * 0.17, R * 0.025, 8, 28).rotateX(Math.PI / 2).translate(x, R * 0.04 + T * 0.9, z));
    L.glow.push(new THREE.TorusGeometry(R * 0.2, R * 0.012, 6, 28).rotateX(Math.PI / 2).translate(x, R * 0.04 + T * 0.45, z));
    L.dark.push(prism([polar(Ro * 0.5, a - 0.03), polar(Ro * 0.62, a - 0.03), polar(Ro * 0.62, a + 0.03), polar(Ro * 0.5, a + 0.03)], R * 0.07, R * 0.04));
  }
  return { top: T + R * 0.06, sym: n };
}

// ====================================================================================================== STAMINA
/** Phantom: three long, thin crescents, a hovering outer arc and three glowing orbs. */
function phantom({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const f = fin(a, R * 0.46, Ro * 1.04, 1.05 * step, R * 0.13, R * 0.07 * k, R * 0.07 * k, 0.1, 1.5);
    L.main.push(sweptFin(f)); L.glow.push(finGlow(f, 0.4, 0.15, 0.95));
    L.mid.push(sweptFin(fin(a + 0.5 * step, R * 0.46, Ro * 0.9, 0.95 * step, R * 0.09, 0, R * 0.06 * k, 0.1, 1.5)));
    L.accent.push(orb(Ro * 1.0, a + 1.05 * step, R * 0.075, R * 0.12 * k));
    L.dark.push(ringSector(Ro * 0.9, Ro * 0.97, a + 0.18 * step, a + 0.78 * step, R * 0.04, R * 0.1));
  }
  L.dark.push(ring(R * 0.4, R * 0.56, R * 0.06 * k, R * 0.02));
  hub(R, L, 0.4, 0.12);
  return { top: R * 0.16 * k, sym: n };
}

/** Voidrunner: four sleek straight daggers, with shorter ones between. */
function voidrunner({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    L.main.push(prism(bladeOutline(a, R * 0.26, Ro * 1.06, 0.22 * step, 1.0, (t) => R * 0.15 * Math.pow(1 - t, 0.55) + 0.01, 0.35, 12), R * 0.07 * k, R * 0.1 * k));
    L.mid.push(prism(bladeOutline(a + 0.5 * step, R * 0.26, Ro * 0.74, 0.2 * step, 1.0, (t) => R * 0.1 * Math.pow(1 - t, 0.55) + 0.01, 0.2, 10), R * 0.06 * k, R * 0.04));
    L.glow.push(prism(bladeOutline(a, Ro * 0.4, Ro * 1.0, 0.22 * step, 1.0, (t) => R * 0.018 * (1 - t) + 0.004, 0, 6), R * 0.02, R * 0.1 * k + R * 0.07 * k - R * 0.002));
  }
  L.dark.push(prism(Array.from({ length: n * 2 }, (_, i) => polar(R * (i % 2 ? 0.34 : 0.56), (i * TAU) / (n * 2))), R * 0.08, R * 0.02));
  hub(R, L, 0.4, 0.12);
  return { top: R * 0.2 * k, sym: n };
}

/** Nightveil: three tiers of broad leaf-shaped wings, each smaller and higher than the last. */
function nightveil({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  const tiers: Array<[number, number, number, number]> = [[1.04, 0.4, 0, 0.05], [0.84, 0.32, 0.34, 0.1], [0.62, 0.24, 0.68, 0.15]];
  for (let i = 0; i < n; i++) {
    tiers.forEach(([len, w, off, y], t) => {
      const f = fin(i * step + off * step, R * 0.3, Ro * len, 0.55 * step, R * w, R * y * k, R * 0.07 * k, 0.1, 1.2);
      (t === 1 ? L.mid : L.main).push(sweptFin(f));
      if (t === 0) L.glow.push(finGlow(f, 0.7, 0.15, 0.9));
    });
    L.accent.push(orb(Ro * 0.98, i * step + 0.55 * step, R * 0.05, R * 0.14 * k));
  }
  hub(R, L, 0.5, 0.14);
  return { top: R * 0.24 * k, sym: n };
}

/** Spectra: a flower. Five wide petals, five smaller petals above them, crystal studs. */
function spectra({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const big = fin(a, R * 0.3, Ro * 0.98, 0.34 * step, R * 0.34, R * 0.04 * k, R * 0.1 * k, 0, 1.2);
    L.main.push(sweptFin(big)); L.glow.push(finGlow(big, 0.1, 0.2, 0.92));
    L.mid.push(sweptFin(fin(a + 0.5 * step, R * 0.3, Ro * 0.66, 0.3 * step, R * 0.22, R * 0.12 * k, R * 0.08 * k, 0, 1.2)));
    L.accent.push(new THREE.OctahedronGeometry(R * 0.07).scale(1, 1.4, 1).translate(...(([x, z]) => [x, R * 0.2 * k, z] as [number, number, number])(polar(Ro * 0.9, a + 0.34 * step))));
  }
  hub(R, L, 0.5, 0.14);
  return { top: R * 0.24 * k, sym: n };
}

/** Ghost Viper: three S-curved bodies, each with a counter-curved tail. */
function ghostViper({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const body = fin(a, R * 0.3, Ro * 1.04, 1.5 * step, R * 0.17, R * 0.07 * k, R * 0.09 * k, 0.3, 0.7);
    L.main.push(sweptFin(body)); L.glow.push(finGlow(body, 0.45, 0.1, 0.95));
    L.mid.push(sweptFin(fin(a + 0.3 * step, R * 0.3, Ro * 0.78, -0.9 * step, R * 0.1, 0, R * 0.07 * k, 0.1, 1.3)));
    L.accent.push(spike(Ro * 0.92, a + 1.4 * step, R * 0.22, R * 0.045, R * 0.12 * k));
  }
  hub(R, L, 0.5, 0.14);
  return { top: R * 0.2 * k, sym: n };
}

/** Chrono: a clock. Thin outer ring with twelve ticks and six hands of different lengths. */
function chrono({ R, n, reach, k, L }: Ctx): Built {
  const Ro = R * reach, ticks = 12;
  L.main.push(ring(Ro * 0.9, Ro * 0.98, R * 0.07 * k, R * 0.02));
  for (let i = 0; i < ticks; i++) {
    const a = (i * TAU) / ticks, big = i % 3 === 0, w = 0.026;
    L.gold.push(prism([polar(Ro * (big ? 0.7 : 0.78), a - w), polar(Ro * 0.9, a - w), polar(Ro * 0.9, a + w), polar(Ro * (big ? 0.7 : 0.78), a + w)], R * 0.06 * k, R * 0.04));
  }
  const step = TAU / n;
  for (let i = 0; i < n; i++) {
    const a = i * step, len = i % 2 ? 0.66 : 0.88;
    L.main.push(prism(bladeOutline(a, R * 0.2, Ro * len, 0.12 * step, 1, (t) => R * (0.06 * (1 - 0.5 * t) + 0.012), 0, 6), R * 0.07 * k, R * 0.08 * k));
    L.glow.push(orb(Ro * len, a + 0.12 * step, R * 0.04, R * 0.16 * k));
  }
  L.mid.push(ring(R * 0.3, R * 0.62, R * 0.08 * k, R * 0.02));
  hub(R, L, 0.45, 0.12);
  return { top: R * 0.2 * k, sym: n * 2 };
}

/** Nebula Drift: four long spiral arms with stars strung along them. */
function nebulaDrift({ R, n, reach, k, L }: Ctx): Built {
  const step = TAU / n, Ro = R * reach;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const f = fin(a, R * 0.3, Ro * 1.05, 1.9 * step, R * 0.1, R * 0.06 * k, R * 0.07 * k, 0.1, 1.6);
    L.main.push(sweptFin(f));
    L.glow.push(finGlow(f, 0.2, 0.1, 0.95));
    L.mid.push(sweptFin(fin(a + 0.5 * step, R * 0.3, Ro * 0.9, 1.7 * step, R * 0.07, 0, R * 0.05 * k, 0.1, 1.6)));
    [0.4, 0.62, 0.84, 1.0].forEach((t, j) => {
      const r = f.rin + (f.rout - f.rin) * Math.pow(t, 0.85), phi = f.a0 + f.sweep * Math.pow(t, f.curl ?? 1.4);
      L.accent.push(orb(r, phi, R * (0.075 - 0.01 * j), R * 0.13 * k));
    });
  }
  hub(R, L, 0.5, 0.14);
  return { top: R * 0.18 * k, sym: n };
}

export const LOOKS: Record<string, (c: Ctx) => Built> = {
  ravok, blazefang, riftclaw, 'volt-reaper': voltReaper, 'titan-breaker': titanBreaker, 'inferno-x': infernoX, stormfang,
  gravion, 'iron-warden': ironWarden, 'bastion-x': bastionX, stonecore, aegiron, 'guardian-prime': guardianPrime, 'gravity-rex': gravityRex,
  phantom, voidrunner, nightveil, spectra, 'ghost-viper': ghostViper, chrono, 'nebula-drift': nebulaDrift,
};
