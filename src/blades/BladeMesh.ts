// Procedural low-poly blades. Silhouette over detail: every blade is a ring + core + weight disc + tip, and the
// ring is drawn in its class's visual language (build spec §14–15):
//   ATTACK  — sharp hooked spikes, red/orange
//   DEFENSE — thick shield plates, blue
//   STAMINA — thin ring with curved fins, purple/cyan
// Each blade also carries its own secondary palette. Parts change the model (ring scale/spikes, core shape,
// disc size, tip shape), so customization is visible from the top and from the side.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLASS_COLORS, TAU, type BladeClass } from '../core/types';
import { blobTexture, glow, toon } from '../render/materials';
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
const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

/** Extrude a flat shape (in XY) so it lies on the XZ plane, centred vertically. */
function flat(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0);
  return g;
}

function spikeRing(R: number, n: number, thick: number, spikeScale: number): THREE.BufferGeometry {
  return cached(`spikes|${R.toFixed(3)}|${n}|${thick.toFixed(3)}|${spikeScale}`, () => {
    const step = TAU / n;
    const valley = R * 0.58;
    const tip = R * Math.min(1.14, 1.0 + 0.05 * spikeScale);
    const shape = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a0 = i * step;
      const v = new THREE.Vector2(Math.cos(a0) * valley, Math.sin(a0) * valley);
      const t = new THREE.Vector2(Math.cos(a0 + step * 0.78) * tip, Math.sin(a0 + step * 0.78) * tip);
      if (i === 0) shape.moveTo(v.x, v.y); else shape.lineTo(v.x, v.y);
      shape.lineTo(t.x, t.y);
    }
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, R * 0.36, 0, TAU, true);
    shape.holes.push(hole);
    return flat(shape, thick);
  });
}

function plateRing(R: number, n: number, thick: number): THREE.BufferGeometry {
  return cached(`plates|${R.toFixed(3)}|${n}|${thick.toFixed(3)}`, () => {
    const step = TAU / n;
    const w = step / 2 - 0.07;
    const ri = R * 0.58, ro = R;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * step;
      const s = new THREE.Shape();
      s.moveTo(Math.cos(a - w) * ri, Math.sin(a - w) * ri);
      s.lineTo(Math.cos(a - w * 0.82) * ro, Math.sin(a - w * 0.82) * ro);
      s.lineTo(Math.cos(a + w * 0.82) * ro, Math.sin(a + w * 0.82) * ro);
      s.lineTo(Math.cos(a + w) * ri, Math.sin(a + w) * ri);
      s.closePath();
      parts.push(flat(s, thick));
    }
    return mergeGeometries(parts, false)!;
  });
}

function finRing(R: number, n: number, thick: number): THREE.BufferGeometry {
  return cached(`fins|${R.toFixed(3)}|${n}|${thick.toFixed(3)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const base = new THREE.Shape();
    base.absarc(0, 0, R * 0.74, 0, TAU, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, R * 0.56, 0, TAU, true);
    base.holes.push(hole);
    parts.push(flat(base, thick));
    const step = TAU / n;
    for (let i = 0; i < n; i++) {
      const a = i * step;
      const p = (r: number, da: number) => new THREE.Vector2(Math.cos(a + da) * r, Math.sin(a + da) * r);
      const s = new THREE.Shape();
      const b0 = p(R * 0.7, 0), tip = p(R * 1.02, step * 0.6), b1 = p(R * 0.7, step * 0.2);
      s.moveTo(b0.x, b0.y);
      const c0 = p(R * 1.0, step * 0.12);
      s.quadraticCurveTo(c0.x, c0.y, tip.x, tip.y);
      const c1 = p(R * 0.9, step * 0.42);
      s.quadraticCurveTo(c1.x, c1.y, b1.x, b1.y);
      s.closePath();
      parts.push(flat(s, thick * 1.1));
    }
    return mergeGeometries(parts, false)!;
  });
}

function starShape(r: number, n: number, depth: number): THREE.BufferGeometry {
  return cached(`star|${r.toFixed(3)}|${n}|${depth.toFixed(3)}`, () => {
    const s = new THREE.Shape();
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n;
      const rr = i % 2 === 0 ? r : r * 0.5;
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    s.closePath();
    return flat(s, depth);
  });
}

function coreGeometry(shape: PartVisual['shape'], r: number): THREE.BufferGeometry {
  switch (shape) {
    case 'orb': return cached(`ico|${r.toFixed(3)}`, () => new THREE.IcosahedronGeometry(r, 0));
    case 'disc': return cached(`cyl8|${r.toFixed(3)}`, () => new THREE.CylinderGeometry(r, r, r * 0.6, 8));
    case 'hex': return cached(`cyl6|${r.toFixed(3)}`, () => new THREE.CylinderGeometry(r * 1.05, r * 1.05, r * 0.7, 6));
    case 'star': return starShape(r * 1.15, 5, r * 0.7);
    case 'gem':
    default: return cached(`oct|${r.toFixed(3)}`, () => new THREE.OctahedronGeometry(r * 1.1, 0));
  }
}

function tipGeometry(shape: PartVisual['shape'], R: number): THREE.BufferGeometry {
  switch (shape) {
    case 'pin': return cached(`pin|${R.toFixed(3)}`, () => new THREE.ConeGeometry(R * 0.1, R * 0.36, 6).rotateX(Math.PI));
    case 'ball': return cached(`ball|${R.toFixed(3)}`, () => new THREE.SphereGeometry(R * 0.17, 8, 6));
    case 'flat': return cached(`flat|${R.toFixed(3)}`, () => new THREE.CylinderGeometry(R * 0.2, R * 0.26, R * 0.1, 8));
    case 'stub': return cached(`stub|${R.toFixed(3)}`, () => new THREE.CylinderGeometry(R * 0.12, R * 0.17, R * 0.2, 8));
    case 'cone':
    default: return cached(`cone|${R.toFixed(3)}`, () => new THREE.ConeGeometry(R * 0.17, R * 0.3, 8).rotateX(Math.PI));
  }
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
      new THREE.RingGeometry(1.1, 1.26, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: teamColor ?? '#ffffff', transparent: true, opacity: 0.95, depthWrite: false }),
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
    this.spinGroup.traverse((o) => { if (o instanceof THREE.Mesh && !geoCache.has('')) { /* geometry is cached/shared */ } });
    this.spinGroup.clear();
    this.fadeMats.forEach((m) => m.dispose());
    this.fadeMats = [];
  }

  private own<T extends THREE.Material>(m: T): T {
    const c = m.clone() as T;
    this.fadeMats.push(c);
    return c;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, outlineThickness = 0.045): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.own(mat));
    if (outlineThickness > 0) {
      const o = new THREE.Mesh(geo, this.own(new THREE.MeshBasicMaterial({ color: 0x070a16, side: THREE.BackSide })));
      o.scale.setScalar(1 + outlineThickness);
      m.add(o);
    }
    return m;
  }

  private build(): void {
    const s = this.spec;
    const cc = CLASS_COLORS[s.cls];
    const R = s.radius * (s.ring.scale ?? 1);
    const thick = R * 0.17 * (s.ring.thickness ?? 1) * (s.cls === 'DEFENSE' ? 1.35 : s.cls === 'STAMINA' ? 0.6 : 1);
    const n = Math.max(3, Math.min(8, s.profile.count));
    const wScale = s.weight.scale ?? 1;

    // vertical layout (local, centre at 0): tip below, weight disc, ring on top
    const discH = R * 0.13 * wScale;
    const discY = -discH / 2 - 0.02;
    const ringY = discY + discH / 2 + 0.005;

    // weight disc
    const disc = this.mesh(
      new THREE.CylinderGeometry(R * 0.6 * wScale, R * 0.62 * wScale, discH, 18),
      toon(s.profile.trim), 0.04,
    );
    disc.position.y = discY;
    this.spinGroup.add(disc);

    // accent stripe on the disc (secondary palette)
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(R * 0.6 * wScale, discH * 0.14, 4, 28).rotateX(Math.PI / 2), this.own(glow(s.profile.accent2)));
    stripe.position.y = discY + discH * 0.1;
    this.spinGroup.add(stripe);

    // ring in the class's visual language
    let ringGeo: THREE.BufferGeometry;
    if (s.profile.ringStyle === 'spikes') ringGeo = spikeRing(R, n, thick, s.ring.spikes ?? 1);
    else if (s.profile.ringStyle === 'plates') ringGeo = plateRing(R, n, thick);
    else ringGeo = finRing(R, n, thick);
    const ring = this.mesh(ringGeo, toon(cc.main, cc.dark, 0.18), 0.04);
    ring.position.y = ringY;
    this.spinGroup.add(ring);

    // alternating accent tips on spikes / plates in the secondary palette
    if (s.profile.ringStyle !== 'fins') {
      const cap = this.mesh(
        s.profile.ringStyle === 'spikes' ? new THREE.TorusGeometry(R * 0.5, thick * 0.35, 4, 24).rotateX(Math.PI / 2) : new THREE.TorusGeometry(R * 0.57, thick * 0.3, 4, 24).rotateX(Math.PI / 2),
        toon(s.profile.accent2, s.profile.accent2, 0.45), 0,
      );
      cap.position.y = ringY + thick * 0.9;
      this.spinGroup.add(cap);
    }

    // core
    const coreR = R * 0.26;
    const core = this.mesh(coreGeometry(s.core.shape, coreR), toon(s.core.tint ?? s.profile.accent2, s.core.tint ?? s.profile.accent2, 0.7), 0.05);
    core.position.y = ringY + thick + coreR * 0.5;
    this.spinGroup.add(core);

    // tip (visible from the side)
    const tip = this.mesh(tipGeometry(s.tip.shape, R), toon('#cfd6ea'), 0.05);
    const tipH = s.tip.shape === 'pin' ? R * 0.36 : s.tip.shape === 'flat' ? R * 0.1 : s.tip.shape === 'stub' ? R * 0.2 : s.tip.shape === 'ball' ? R * 0.34 : R * 0.3;
    tip.position.y = discY - discH / 2 - tipH / 2;
    this.spinGroup.add(tip);

    this.halfH = 0.17;
    const shadowR = R * 1.15;
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
    this.shadow.scale.setScalar(this.spec.radius * 1.15 * sc);
  }

  dispose(): void {
    this.fadeMats.forEach((m) => m.dispose());
    this.root.traverse((o) => { if (o instanceof THREE.Mesh && !Array.from(geoCache.values()).includes(o.geometry)) o.geometry.dispose(); });
  }
}
