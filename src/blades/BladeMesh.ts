// Procedural blade models, v2. The reference renders show armoured turbines: layered, spiral-swept fins in
// faceted metal, a dark core cap carrying the chevron emblem, and glowing seams between the layers.
// Silhouette follows class (spec §14–15):
//   ATTACK  — many swept, hooked fins (black base layer, class-colour top layer, silver accents)
//   DEFENSE — thick segmented armour plates (class blue / white, gold studs, dark gaps)
//   STAMINA — a thin hub ring with long curved crescent fins
// Parts still change the model: ring scale / thickness / reach, core shape + tint, weight disc, tip.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLASS_COLORS, TAU, type BladeClass } from '../core/types';
import { drawEmblem } from '../render/emblem';
import { blobTexture, facet, hdr } from '../render/materials';
import type { BuiltBlade } from './BladeFactory';
import type { PartVisual } from './parts';
import { getPart } from './parts';
import type { VisualProfile } from './bladeData';

export interface BladeVisualSpec {
  cls: BladeClass;
  profile: VisualProfile;
  /** Physical radius from the Balance; the model is drawn to match it. */
  radius: number;
  ring: PartVisual;
  core: PartVisual;
  weight: PartVisual;
  tip: PartVisual;
}

export function visualSpecFor(b: BuiltBlade): BladeVisualSpec {
  return {
    cls: b.def.class,
    profile: b.def.visualProfile,
    radius: b.combat.radius,
    ring: getPart(b.build.ring).visual,
    core: getPart(b.build.core).visual,
    weight: getPart(b.build.weight).visual,
    tip: getPart(b.build.tip).visual,
  };
}

// ------------------------------------------------------------------------------------------ geometry
type V2 = THREE.Vector2;
const polar = (r: number, a: number): V2 => new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);

/**
 * Extrude a flat outline (drawn in XY) so it lies on the XZ plane and grows upwards from y = 0.
 * A small bevel catches the light on every edge: that is most of the "machined" look.
 */
function slab(pts: V2[], depth: number, hole?: V2[]): THREE.BufferGeometry {
  const s = new THREE.Shape(pts);
  if (hole) s.holes.push(new THREE.Path(hole));
  const bev = Math.min(depth * 0.25, 0.06);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, depth - bev * 2), bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 1, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bev, 0);
  return g;
}

function ringPts(r: number, n = 28, dir = 1): V2[] {
  const p: V2[] = [];
  for (let i = 0; i < n; i++) p.push(polar(r, (dir * i * TAU) / n));
  return p;
}

const lift = (g: THREE.BufferGeometry, y: number): THREE.BufferGeometry => { g.translate(0, y, 0); return g; };
const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null => (parts.length ? mergeGeometries(parts, false) : null);

/** Direction of travel: fins sweep clockwise on screen, the way the blade spins (shape y maps to world −z). */
const FWD = -1;

interface Layers { main: THREE.BufferGeometry[]; mid: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[]; steel: THREE.BufferGeometry[]; accent: THREE.BufferGeometry[] }
const layers = (): Layers => ({ main: [], mid: [], dark: [], steel: [], accent: [] });

function attackFins(R: number, n: number, T: number, reach: number, L: Layers): number {
  const step = TAU / n;
  const Ro = R * reach;
  const fin = (a: number, rin: number, ro: number, u0: number): V2[] => {
    const P = (r: number, u: number) => polar(r, a + FWD * (u0 + u) * step);
    return [P(rin, 0), P(ro * 0.8, 0.55), P(ro, 1.55), P(ro * 0.72, 1.05), P(rin + R * 0.04, 0.95)];
  };
  for (let i = 0; i < n; i++) {
    const a = i * step;
    // three staggered layers: black body, deep-red mid, bright top (every third fin silver)
    L.dark.push(lift(slab(fin(a, R * 0.36, Ro * 0.9, 0.66), T * 1.3), 0));
    L.mid.push(lift(slab(fin(a, R * 0.38, Ro * 0.96, 0.33), T), T * 0.6 + (i % 2) * R * 0.015));
    const top = lift(slab(fin(a, R * 0.42, Ro, 0), T), T * 1.2 + (i % 3) * R * 0.012);
    (i % 3 === 1 ? L.steel : L.main).push(top);
  }
  // a small counter-rotating claw ring round the core
  const m = Math.max(5, Math.round(n * 0.6)), ms = TAU / m;
  for (let i = 0; i < m; i++) {
    const a = i * ms;
    const P = (r: number, u: number) => polar(r, a - FWD * u * ms);
    L.dark.push(lift(slab([P(R * 0.3, 0), P(R * 0.52, 0.5), P(R * 0.56, 1.1), P(R * 0.38, 0.78)], T * 0.9), T * 2.0));
  }
  // heavy skirt so the side view has mass
  L.dark.push(lift(slab(ringPts(R * 0.74, 14), T * 1.3, ringPts(R * 0.3, 14, -1)), -T * 0.9));
  return T * 2.25;
}

function defenseBlocks(R: number, n: number, T: number, reach: number, L: Layers, studs: boolean): number {
  const step = TAU / n;
  const Ro = R * reach;
  // dark base annulus so the gaps read as depth, not holes
  L.dark.push(slab(ringPts(R * 0.98, 32), T * 0.7, ringPts(R * 0.4, 32, -1)));
  for (let i = 0; i < n; i++) {
    const a = i * step, w = step * 0.4, ri = R * 0.5;
    const pts = [polar(ri, a - w * 0.92), polar(Ro * 0.95, a - w), polar(Ro, a - w * 0.7), polar(Ro, a + w * 0.7), polar(Ro * 0.95, a + w), polar(ri, a + w * 0.92)];
    const blk = lift(slab(pts, T * 1.5), T * 0.65);
    (i % 2 === 0 ? L.main : L.steel).push(blk);
    if (studs && i % 2 === 0) {
      const sp = [polar(Ro * 0.72, a - w * 0.22), polar(Ro * 0.9, a - w * 0.22), polar(Ro * 0.9, a + w * 0.22), polar(Ro * 0.72, a + w * 0.22)];
      L.accent.push(lift(slab(sp, T * 0.45), T * 2.12));
    }
  }
  // inner studded ring, offset half a step
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * step, w = step * 0.36;
    const pts = [polar(R * 0.32, a - w * 0.8), polar(R * 0.5, a - w), polar(R * 0.5, a + w), polar(R * 0.32, a + w * 0.8)];
    L.dark.push(lift(slab(pts, T * 1.1), T * 0.65));
  }
  return T * 2.15;
}

function staminaFins(R: number, n: number, T: number, reach: number, L: Layers): number {
  const step = TAU / n;
  const Ro = R * reach;
  L.dark.push(slab(ringPts(R * 0.8, 36), T * 0.9, ringPts(R * 0.62, 36, -1)));
  L.dark.push(slab(ringPts(R * 0.46, 24), T * 1.3));
  const S = 9;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const lead: V2[] = [], trail: V2[] = [];
    for (let k = 0; k <= S; k++) {
      const t = k / S;
      const r = R * 0.5 + (Ro - R * 0.5) * Math.pow(t, 0.75);
      const u = 1.9 * Math.pow(t, 0.9);
      const wdt = 0.35 * (1 - t) + 0.7 * Math.pow(Math.sin(Math.PI * t), 0.9);
      lead.push(polar(r, a + FWD * u * step));
      trail.push(polar(r, a + FWD * (u - wdt) * step));
    }
    const pts = [...lead, ...trail.reverse().slice(1)];
    const f = lift(slab(pts, T * 0.9), T * 0.8 + (i % 3) * R * 0.02);
    (i % 2 === 0 ? L.main : L.accent).push(f);
  }
  return T * 1.9;
}

function capGeometry(shape: PartVisual['shape'], r: number, h: number): THREE.BufferGeometry {
  switch (shape) {
    case 'orb': return new THREE.SphereGeometry(r, 14, 6, 0, TAU, 0, Math.PI / 2).scale(1, h / r * 1.4, 1);
    case 'hex': return new THREE.CylinderGeometry(r * 0.9, r, h, 6);
    case 'gem': return new THREE.CylinderGeometry(r * 0.7, r, h * 1.2, 8);
    case 'star': return new THREE.CylinderGeometry(r * 0.85, r, h * 1.1, 5);
    case 'disc':
    default: return new THREE.CylinderGeometry(r * 0.92, r, h, 14);
  }
}

function tipGeometry(shape: PartVisual['shape'], R: number): THREE.BufferGeometry {
  switch (shape) {
    case 'pin': return new THREE.ConeGeometry(R * 0.1, R * 0.36, 6).rotateX(Math.PI);
    case 'ball': return new THREE.SphereGeometry(R * 0.17, 8, 6);
    case 'flat': return new THREE.CylinderGeometry(R * 0.2, R * 0.26, R * 0.1, 8);
    case 'stub': return new THREE.CylinderGeometry(R * 0.12, R * 0.17, R * 0.2, 8);
    case 'cone':
    default: return new THREE.ConeGeometry(R * 0.17, R * 0.3, 8).rotateX(Math.PI);
  }
}

const emblemCache = new Map<string, THREE.CanvasTexture>();
function emblemTexture(color: string): THREE.CanvasTexture {
  let t = emblemCache.get(color);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0b0e13';
    g.beginPath(); g.arc(128, 128, 126, 0, TAU); g.fill();
    g.strokeStyle = color; g.globalAlpha = 0.35; g.lineWidth = 6;
    g.beginPath(); g.arc(128, 128, 112, 0, TAU); g.stroke();
    g.globalAlpha = 1;
    drawEmblem(g, 256, color, 0.6);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    emblemCache.set(color, t);
  }
  return t;
}

// ----------------------------------------------------------------------------------------------- view
export interface BladeViewState {
  x: number; y: number; z: number;
  spinAngle: number;
  /** Lean towards the direction of motion (radians-ish, small). */
  leanX: number; leanZ: number;
  alpha: number;
  /** 0–1 wobble amount (low spin). */
  wobble: number;
  scale: number;
  /** 0–1 leap height (Meteor Crash). */
  leap: number;
  shield: boolean;
}

/** One blade's 3D model. Owns its materials so each instance can fade independently (ghost, stealth). */
export class BladeView {
  readonly root = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly spinGroup = new THREE.Group();
  private readonly halo: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private shieldMesh: THREE.Mesh | null = null;
  private fadeMats: THREE.Material[] = [];
  private ownedGeo: THREE.BufferGeometry[] = [];
  private spec: BladeVisualSpec;
  private time = 0;
  /** Height of the model's centre above its floor contact, for shadow/halo placement. */
  private halfH = 0.17;

  constructor(spec: BladeVisualSpec, teamColor: string | null) {
    this.spec = spec;
    this.root.add(this.lean);
    this.lean.add(this.spinGroup);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.renderOrder = -2;
    this.root.add(this.shadow);

    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.2, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: teamColor ?? '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.halo.visible = teamColor !== null;
    this.halo.renderOrder = -1;
    this.root.add(this.halo);

    this.build();
  }

  setTeamColor(color: string | null): void {
    this.halo.visible = color !== null;
    if (color) (this.halo.material as THREE.MeshBasicMaterial).color.set(color);
  }

  /** Rebuild the model (used by the customization preview when a part changes). */
  rebuild(spec: BladeVisualSpec): void {
    this.spec = spec;
    this.clear();
    this.build();
  }

  private clear(): void {
    this.spinGroup.clear();
    this.fadeMats.forEach((m) => m.dispose());
    this.fadeMats = [];
    this.ownedGeo.forEach((g) => g.dispose());
    this.ownedGeo = [];
  }

  private own<T extends THREE.Material>(m: T): T { this.fadeMats.push(m); return m; }

  private add(geo: THREE.BufferGeometry | null, mat: THREE.Material, y = 0): THREE.Mesh | null {
    if (!geo) return null;
    this.ownedGeo.push(geo);
    const m = new THREE.Mesh(geo, this.own(mat));
    m.position.y = y;
    this.spinGroup.add(m);
    return m;
  }

  private build(): void {
    const s = this.spec;
    const cc = CLASS_COLORS[s.cls];
    const R = s.radius * (s.ring.scale ?? 1);
    const reach = Math.min(1.12, 0.98 + 0.03 * (s.ring.spikes ?? 1));
    const n = Math.max(3, Math.min(8, s.profile.count));
    const wScale = s.weight.scale ?? 1;
    const glowCol = s.profile.accent2;
    const tint = s.core.tint ?? cc.light;

    // ---- materials (class colours + the blade's own secondary palette)
    const dark = new THREE.Color(s.profile.trim).multiplyScalar(0.5).getStyle();
    const M = {
      main: facet(cc.main, { metal: 0.18, rough: 0.42, env: 0.55 }),
      mid: facet(cc.dark, { metal: 0.45, rough: 0.34 }),
      dark: facet(dark, { metal: 0.6, rough: 0.36 }),
      steel: facet(s.cls === 'DEFENSE' ? '#e6e9f0' : '#cfd4dc', { metal: 0.7, rough: 0.26 }),
      accent: facet(s.cls === 'DEFENSE' ? '#e8b64a' : glowCol, { metal: 0.45, rough: 0.3, emissive: glowCol, glowK: s.cls === 'STAMINA' ? 0.35 : 0.2 }),
      cap: facet('#0e1116', { metal: 0.65, rough: 0.3 }),
      seam: hdr(glowCol, s.cls === 'STAMINA' ? 1.5 : 2.2),
      rim: hdr(tint, 2.1),
    };

    // ---- the fin / plate stack (class silhouette)
    const L = layers();
    const base = R * 0.115 * (s.ring.thickness ?? 1);
    let top: number;
    if (s.profile.ringStyle === 'spikes') top = attackFins(R, n * 2, base, reach, L);
    else if (s.profile.ringStyle === 'plates') top = defenseBlocks(R, n + 3, base * 1.9, reach, L, true);
    else top = staminaFins(R, n + 1, base * 0.8, reach, L);

    const y0 = -0.02 * R;
    this.add(merge(L.dark), M.dark, y0);
    this.add(merge(L.mid), M.mid, y0);
    this.add(merge(L.main), M.main, y0);
    this.add(merge(L.steel), M.steel, y0);
    this.add(merge(L.accent), M.accent, y0);

    // ---- glowing seams between the layers (they peek out through the gaps)
    const seamR = [0.5, 0.72].map((k) => R * k);
    seamR.forEach((r, i) => {
      const t = new THREE.TorusGeometry(r, R * 0.012, 4, 48).rotateX(Math.PI / 2);
      this.add(t, M.seam, y0 + base * (0.9 + i * 0.6));
    });

    // ---- weight disc (underneath) with its own glow edge
    const discR = R * 0.62 * wScale, discH = R * 0.13 * wScale;
    const discY = y0 - discH * 0.5 - 0.005;
    this.add(new THREE.CylinderGeometry(discR, discR * 0.94, discH, 18), M.dark, discY);
    this.add(new THREE.TorusGeometry(discR * 0.99, R * 0.01, 4, 40).rotateX(Math.PI / 2), M.seam, discY + discH * 0.5);

    // ---- core cap with the emblem
    const capR = R * 0.3, capH = R * 0.17;
    const capY = y0 + top + capH * 0.5;
    this.add(capGeometry(s.core.shape, capR, capH), M.cap, capY);
    this.add(new THREE.TorusGeometry(capR * 0.98, R * 0.014, 4, 40).rotateX(Math.PI / 2), M.rim, capY + capH * 0.48);
    const emb = new THREE.Mesh(
      new THREE.CircleGeometry(capR * 0.86, 28).rotateX(-Math.PI / 2),
      this.own(new THREE.MeshBasicMaterial({ map: emblemTexture(tint), toneMapped: false })),
    );
    this.ownedGeo.push(emb.geometry);
    emb.position.y = capY + capH * (s.core.shape === 'gem' ? 0.62 : s.core.shape === 'orb' ? 0.55 : 0.505);
    this.spinGroup.add(emb);
    // collar between cap and fins
    this.add(new THREE.CylinderGeometry(capR * 1.25, capR * 1.4, R * 0.05, 14), M.dark, y0 + top - R * 0.01);

    // ---- tip (visible from the side)
    const tipH = s.tip.shape === 'pin' ? R * 0.36 : s.tip.shape === 'flat' ? R * 0.1 : s.tip.shape === 'stub' ? R * 0.2 : s.tip.shape === 'ball' ? R * 0.34 : R * 0.3;
    this.add(tipGeometry(s.tip.shape, R), facet('#aab2c2', { metal: 0.85, rough: 0.25 }), discY - discH * 0.5 - tipH * 0.5);

    this.halfH = 0.17;
    const shadowR = R * 1.18;
    this.shadow.scale.setScalar(shadowR);
    this.halo.scale.setScalar(R);
    this.shadow.position.y = -this.halfH + 0.012;
    this.halo.position.y = -this.halfH + 0.02;

    // shield dome (Iron Dome / Fortress feedback), hidden until needed
    if (!this.shieldMesh) {
      const sh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 12),
        new THREE.MeshBasicMaterial({ color: CLASS_COLORS.DEFENSE.light, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
      );
      sh.visible = false;
      this.lean.add(sh);
      this.shieldMesh = sh;
    }
    this.shieldMesh.scale.setScalar(R * 1.35);
  }

  setAlpha(a: number): void {
    const transparent = a < 0.999;
    for (const m of this.fadeMats) {
      if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
      m.opacity = a;
      m.depthWrite = !transparent;
    }
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = a;
  }

  apply(s: BladeViewState, dt: number): void {
    this.time += dt;
    this.root.position.set(s.x, s.y + s.leap * 5.2, s.z);
    this.root.scale.setScalar(s.scale);
    const wob = s.wobble;
    this.lean.rotation.set(
      s.leanZ + Math.sin(this.time * 17) * 0.11 * wob,
      0,
      -s.leanX + Math.cos(this.time * 13) * 0.11 * wob,
    );
    this.spinGroup.rotation.y = s.spinAngle;
    this.setAlpha(s.alpha);
    if (this.shieldMesh) {
      this.shieldMesh.visible = s.shield;
      if (s.shield) (this.shieldMesh.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.08 * Math.sin(this.time * 6);
    }
    // the shadow and halo stay on the floor even while the blade leaps
    const lift = s.leap * 5.2;
    this.shadow.position.y = -this.halfH + 0.012 - lift;
    this.halo.position.y = -this.halfH + 0.02 - lift;
    const sc = 1 - Math.min(0.5, s.leap * 0.5);
    this.shadow.scale.setScalar(this.spec.radius * 1.18 * sc);
  }

  dispose(): void {
    this.clear();
    this.shadow.geometry.dispose();
    this.halo.geometry.dispose();
  }
}
