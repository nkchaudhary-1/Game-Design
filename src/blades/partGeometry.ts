// High-poly part builders for the blades: swept lofted fins (smooth aerodynamic surfaces, not flat slabs),
// lathed hubs / discs / tips, bevelled armour plates with a domed top, and bolts. Everything is plain
// BufferGeometry built in world XZ (y up); polar angle φ increases clockwise on screen, the way blades spin.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GFX } from '../render/quality';

const D = () => GFX.detail;
export const radialSegs = (): number => [24, 44, 80][D()];
export const torusSegs = (): number => [36, 72, 128][D()];

// ------------------------------------------------------------------------------------------ swept fin
export interface FinSpec {
  /** Root angle φ (radians). */
  a0: number;
  rin: number; rout: number;
  /** How far the tip runs ahead of the root, in radians (+ = forward, the direction of spin). */
  sweep: number;
  /** Max half-width of the planform, world units. */
  halfW: number;
  /** Crown height above y0, and underside depth below it. */
  height: number; under: number; y0: number;
  /** Leading-edge notch depth 0..1 (gives the hooked look). */
  notch?: number;
  /** Power of the centre-line curve (higher = more curve at the tip). */
  curl?: number;
}

const bump = (t: number, c: number, w: number): number => Math.exp(-Math.pow((t - c) / w, 2));

/** Point on a fin: t = 0 root … 1 tip, s = −1 trailing … +1 leading, `top` picks the upper or lower skin. */
function finPoint(f: FinSpec, t: number, s: number, top: boolean): THREE.Vector3 {
  const curl = f.curl ?? 1.35;
  const at = (tt: number): [number, number] => {
    const r = f.rin + (f.rout - f.rin) * Math.pow(tt, 0.85);
    const phi = f.a0 + f.sweep * Math.pow(tt, curl);
    return [Math.cos(phi) * r, Math.sin(phi) * r];
  };
  const [cx, cz] = at(t);
  const [bx, bz] = at(Math.min(1, t + 0.002));
  const [ax, az] = at(Math.max(0, t - 0.002));
  let tx = bx - ax, tz = bz - az;
  const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  // +n points the way φ increases (towards the leading edge)
  const nx = -tz, nz = tx;
  const base = Math.pow(Math.max(0, 1 - Math.pow(t, 1.8)), 0.75) * (0.65 + 0.35 * (1 - t));
  const notch = f.notch ?? 0.3;
  const hw = f.halfW * base * (s > 0 ? 1 - notch * bump(t, 0.66, 0.1) : 1);
  const off = s * hw;
  const crown = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 4)), 0.45);
  const H = f.height * (1 - 0.5 * Math.pow(t, 1.2));
  const y = top
    ? f.y0 + H * crown + H * 0.12 * (1 - Math.abs(s)) * (1 - t)
    : f.y0 - f.under * Math.sqrt(Math.max(0, 1 - s * s)) * (1 - 0.4 * t);
  return new THREE.Vector3(cx + nx * off, y, cz + nz * off);
}

export function sweptFin(f: FinSpec): THREE.BufferGeometry {
  const nt = [10, 18, 30][D()], ns = [6, 10, 16][D()];
  const row = ns + 1, stride = row * 2;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nt; i++) {
    const t = i / nt;
    for (const top of [true, false]) {
      for (let j = 0; j <= ns; j++) {
        const s = -1 + (2 * j) / ns;
        const p = finPoint(f, t, s, top);
        pos.push(p.x, p.y, p.z);
        uv.push(t * 3, (s * 0.5 + 0.5) * 1.4);
      }
    }
  }
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  };
  // decide the winding from the first top triangle so it is correct whatever the sweep direction
  const v = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const a = v(0), b = v(1), c = v(stride);
  const upward = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).y > 0;
  for (let i = 0; i < nt; i++) {
    for (let j = 0; j < ns; j++) {
      const t0 = i * stride + j, t1 = (i + 1) * stride + j;
      quad(t0, t0 + 1, t1, t1 + 1, !upward);            // top skin
      const b0 = i * stride + row + j, b1 = (i + 1) * stride + row + j;
      quad(b0, b0 + 1, b1, b1 + 1, upward);             // underside, opposite winding
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A thin glowing line along the top of a fin, offset towards the leading edge. */
export function finGlow(f: FinSpec, s0 = 0.55, t0 = 0.12, t1 = 0.92): THREE.BufferGeometry {
  const n = [8, 14, 22][D()];
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const w = 0.05 * (1 - 0.5 * t);
    for (const s of [s0 - w, s0 + w]) { const p = finPoint(f, t, s, true); pos.push(p.x, p.y + 0.006, p.z); }
  }
  for (let i = 0; i < n; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2, k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((n + 1) * 4).fill(0), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------------------------------ lathed parts
/** Revolve a profile of (radius, height) pairs, listed from the axis outwards. */
export function lathe(profile: Array<[number, number]>, segs = radialSegs()): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  g.computeVertexNormals();
  return g;
}

/** The core cap: stepped body, chamfers, a raised collar and a recessed emblem pad. `s` scales radius & height. */
export function capProfile(r: number, h: number, shape: string | undefined): Array<[number, number]> {
  const dome = shape === 'orb' ? 0.22 : shape === 'gem' ? 0.14 : 0.04;
  return [
    [0.001, h * 0.02], [r * 0.96, h * 0.02], [r * 1.03, h * 0.1], [r * 1.03, h * 0.46], [r * 0.97, h * 0.56],
    [r * 0.97, h * 0.66], [r * 0.9, h * 0.74], [r * 0.9, h * 0.8], [r * 0.82, h * (0.86 + dome * 0.3)], [r * 0.5, h * (0.92 + dome)],
    [r * 0.001, h * (0.95 + dome)],
  ];
}

/** Weight disc: chamfered rim, a groove, a stepped underside. */
export function discProfile(r: number, h: number): Array<[number, number]> {
  return [
    [0.001, 0], [r * 0.55, 0], [r * 0.6, h * 0.12], [r * 0.9, h * 0.12], [r * 0.98, h * 0.3], [r, h * 0.45], [r, h * 0.8],
    [r * 0.95, h * 0.92], [r * 0.9, h * 0.92], [r * 0.9, h * 0.8], [r * 0.82, h * 0.78], [r * 0.82, h], [r * 0.001, h],
  ];
}

/** Heavy armour band that gives the side view its mass. */
export function bandProfile(r: number, h: number): Array<[number, number]> {
  return [
    [r * 0.3, 0], [r * 0.9, 0], [r * 0.97, h * 0.18], [r, h * 0.3], [r, h * 0.7], [r * 0.97, h * 0.82], [r * 0.9, h], [r * 0.3, h],
  ];
}

export function tipLathe(shape: string | undefined, R: number): THREE.BufferGeometry {
  const s = radialSegs();
  switch (shape) {
    case 'pin': return lathe([[0.001, -R * 0.36], [R * 0.012, -R * 0.35], [R * 0.05, -R * 0.2], [R * 0.11, 0], [0.001, 0]], s);
    case 'ball': return new THREE.SphereGeometry(R * 0.17, Math.max(10, s / 2), 12);
    case 'flat': return lathe([[0.001, -R * 0.1], [R * 0.18, -R * 0.1], [R * 0.24, -R * 0.04], [R * 0.26, 0], [0.001, 0]], s);
    case 'stub': return lathe([[0.001, -R * 0.2], [R * 0.1, -R * 0.19], [R * 0.15, -R * 0.08], [R * 0.17, 0], [0.001, 0]], s);
    case 'cone':
    default: return lathe([[0.001, -R * 0.3], [R * 0.02, -R * 0.29], [R * 0.09, -R * 0.14], [R * 0.17, 0], [0.001, 0]], s);
  }
}

// ----------------------------------------------------------------------------------------- armour plates
const sub = (g: THREE.BufferGeometry): THREE.BufferGeometry => { g.deleteAttribute('normal'); g.deleteAttribute('uv'); return g; };

/** A bevelled trapezoid plate pointing along +x, then rotated to angle φ. Domed top, smooth normals. */
export function armourPlate(o: { phi: number; ri: number; ro: number; wIn: number; wOut: number; depth: number; dome: number; y0: number }): THREE.BufferGeometry {
  const bs = [2, 4, 6][D()];
  const sh = new THREE.Shape();
  const cr = Math.min(o.wOut, o.wIn) * 0.22;
  sh.moveTo(o.ri, -o.wIn + cr * 0.4);
  sh.lineTo(o.ri, o.wIn - cr * 0.4);
  sh.lineTo(o.ro - cr, o.wOut);
  sh.quadraticCurveTo(o.ro, o.wOut, o.ro, o.wOut - cr);
  sh.lineTo(o.ro, -o.wOut + cr);
  sh.quadraticCurveTo(o.ro, -o.wOut, o.ro - cr, -o.wOut);
  sh.closePath();
  const bevel = Math.min(o.depth * 0.3, 0.07);
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(sh, { depth: o.depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: bs, curveSegments: [3, 6, 10][D()] });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  // dome the top: raise the upper vertices towards the plate centre
  const p = g.attributes.position as THREE.BufferAttribute;
  const xc = (o.ri + o.ro) / 2, xr = (o.ro - o.ri) / 2 + bevel, zr = Math.max(o.wIn, o.wOut) + bevel;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > o.depth * 0.55) {
      const u = (p.getX(i) - xc) / xr, w = p.getZ(i) / zr;
      p.setY(i, p.getY(i) + o.dome * Math.max(0, 1 - u * u) * Math.max(0, 1 - w * w));
    }
  }
  g = mergeVertices(sub(g), 1e-4);
  g.computeVertexNormals();
  g.rotateY(-o.phi);
  g.translate(0, o.y0, 0);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2).map((_, i) => ((i % 2 === 0 ? g.attributes.position.getX(i >> 1) : g.attributes.position.getZ(i >> 1)) * 0.6)), 2));
  return g;
}

/** A flat bevelled sector (annulus piece) for rings, armour backing and inner blocks. */
export function ringSector(ri: number, ro: number, a0: number, a1: number, depth: number, y0: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const n = 8;
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; const x = Math.cos(a) * ro, z = Math.sin(a) * ro; if (i === 0) sh.moveTo(x, -z); else sh.lineTo(x, -z); }
  for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; sh.lineTo(Math.cos(a) * ri, -Math.sin(a) * ri); }
  sh.closePath();
  const bevel = Math.min(depth * 0.3, 0.05);
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(sh, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: [1, 3, 4][D()], curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  g = mergeVertices(sub(g), 1e-4);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2).map((_, i) => ((i % 2 === 0 ? g.attributes.position.getX(i >> 1) : g.attributes.position.getZ(i >> 1)) * 0.6)), 2));
  return g;
}

// ------------------------------------------------------------------------------------------------ bolts
/** A ring of hex-head bolts (merged into one geometry). */
export function boltRing(count: number, radius: number, y: number, size: number, phase = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i * Math.PI * 2) / count;
    const head = new THREE.CylinderGeometry(size, size * 1.05, size * 0.7, 6);
    head.translate(Math.cos(a) * radius, y + size * 0.35, Math.sin(a) * radius);
    parts.push(head);
    const dome = new THREE.SphereGeometry(size * 0.55, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(Math.cos(a) * radius, y + size * 0.7, Math.sin(a) * radius);
    parts.push(dome);
  }
  return merge(parts)!;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  // normalise: non-indexed, same attribute set
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  const m = mergeGeometries(flat, false);
  flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
  parts.forEach((g) => g.dispose());
  return m;
}

// ---------------------------------------------------------------------------------------------- planforms
/** (x, z) of polar (radius, angle φ). φ increases clockwise on screen, the way blades spin. */
export const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

/**
 * Extrude any flat outline, given as (x, z) points, into a bevelled slab standing on `y0`. This is the workhorse
 * for the angular shapes (axe heads, teeth, castle blocks, boulders, claws) that the lofted fins can't make.
 */
export function prism(pts: Array<[number, number]>, depth: number, y0: number, bevelK = 0.28): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? sh.lineTo(x, -z) : sh.moveTo(x, -z)));
  sh.closePath();
  const bevel = Math.min(depth * bevelK, 0.06);
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.002, depth - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: [1, 2, 3][D()], curveSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  g = mergeVertices(sub(g), 1e-4);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2).map((_, i) => ((i % 2 === 0 ? g.attributes.position.getX(i >> 1) : g.attributes.position.getZ(i >> 1)) * 0.6)), 2));
  return g;
}

/**
 * Outline of a curved blade: root at r0, tip at r1, the centre line sweeping `sweep` radians ahead of `a`.
 * `w(t)` is the half-width (world units) at t = 0 (root) … 1 (tip); `lead` > 0 pushes the leading edge out (a hook).
 */
export function bladeOutline(a: number, r0: number, r1: number, sweep: number, curl: number, w: (t: number) => number, lead = 0, n = 12): Array<[number, number]> {
  const centre = (t: number): { r: number; phi: number } => ({ r: r0 + (r1 - r0) * t, phi: a + sweep * Math.pow(t, curl) });
  const edge = (t: number, side: 1 | -1): [number, number] => {
    const c = centre(t);
    const eps = 0.01;
    const c2 = centre(Math.min(1, t + eps)), c1 = centre(Math.max(0, t - eps));
    const [x2, z2] = polar(c2.r, c2.phi), [x1, z1] = polar(c1.r, c1.phi);
    const l = Math.hypot(x2 - x1, z2 - z1) || 1;
    const nx = -(z2 - z1) / l, nz = (x2 - x1) / l;
    const [cx, cz] = polar(c.r, c.phi);
    const off = w(t) * (side > 0 ? 1 + lead * Math.sin(Math.PI * Math.min(1, t * 1.15)) : 1);
    return [cx + nx * off * side, cz + nz * off * side];
  };
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) pts.push(edge(i / n, 1));
  for (let i = n; i >= 0; i--) pts.push(edge(i / n, -1));
  return pts;
}

/** A cone (spike) standing at radius r, angle a, pointing out along the radius. */
export function spike(r: number, a: number, len: number, rad: number, y: number, up = 0): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(rad, len, 10, 1).rotateZ(-Math.PI / 2 + up).translate(len / 2, 0, 0);
  g.rotateY(-a);
  const [x, z] = polar(r, a);
  g.translate(x, y, z);
  return g;
}
