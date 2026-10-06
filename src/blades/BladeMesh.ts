// Procedural blade models, v3 (high-poly). The reference renders show armoured turbines: layered, spiral-swept
// fins, a dark core cap carrying the chevron emblem, and glowing seams. Here the fins are lofted surfaces (smooth
// and curved, ~30 slices each), the hubs are lathed, plates are bevelled and domed, and the paint is a clear-coated
// physical material over brushed gunmetal, so the studio environment gives long, sharp highlights.
// Silhouette follows class (spec §14–15):
//   ATTACK  — many swept, hooked fins (black base layer, class-colour top layer, silver accents)
//   DEFENSE — thick segmented armour plates (class blue / white, gold studs, dark gaps)
//   STAMINA — a thin hub ring with long curved crescent fins
// Parts still change the model: ring scale / thickness / reach, core shape + tint, weight disc, tip.

import * as THREE from 'three';
import { CLASS_COLORS, TAU, type BladeClass } from '../core/types';
import { drawEmblem } from '../render/emblem';
import { blobTexture, hdr } from '../render/materials';
import { brushedMetal } from '../render/procTex';
import { GFX } from '../render/quality';
import { armourPlate, bandProfile, boltRing, capProfile, discProfile, finGlow, lathe, merge, radialSegs, ringSector, sweptFin, tipLathe, torusSegs, type FinSpec } from './partGeometry';
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

// ----------------------------------------------------------------------------------------------- build
const emblemCache = new Map<string, THREE.CanvasTexture>();
function emblemTexture(color: string): THREE.CanvasTexture {
  let t = emblemCache.get(color);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#080a0e';
    g.beginPath(); g.arc(256, 256, 252, 0, TAU); g.fill();
    g.strokeStyle = color; g.globalAlpha = 0.4; g.lineWidth = 8;
    g.beginPath(); g.arc(256, 256, 226, 0, TAU); g.stroke();
    g.globalAlpha = 0.18; g.lineWidth = 3;
    for (const r of [200, 176]) { g.beginPath(); g.arc(256, 256, r, 0, TAU); g.stroke(); }
    g.globalAlpha = 1;
    drawEmblem(g, 512, color, 0.6);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    emblemCache.set(color, t);
  }
  return t;
}

interface Layers { main: THREE.BufferGeometry[]; mid: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[]; steel: THREE.BufferGeometry[]; accent: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[]; gold: THREE.BufferGeometry[] }
const layers = (): Layers => ({ main: [], mid: [], dark: [], steel: [], accent: [], glow: [], gold: [] });
const fin = (a0: number, rin: number, rout: number, sweep: number, halfW: number, y0: number, h: number, notch = 0.35, curl = 1.4): FinSpec =>
  ({ a0, rin, rout, sweep, halfW, height: h, under: h * 0.35, y0, notch, curl });

function attackStack(R: number, n: number, reach: number, thick: number, L: Layers): number {
  const step = TAU / n, Ro = R * reach, k = thick;
  for (let i = 0; i < n; i++) {
    const a = i * step;
    L.dark.push(sweptFin(fin(a + 0.66 * step, R * 0.34, Ro * 0.9, 1.5 * step, R * 0.23, 0, R * 0.1 * k)));
    L.mid.push(sweptFin(fin(a + 0.33 * step, R * 0.36, Ro * 0.96, 1.55 * step, R * 0.2, R * 0.05 * k, R * 0.11 * k)));
    const top = fin(a, R * 0.4, Ro, 1.6 * step, R * 0.17, R * 0.11 * k, R * 0.12 * k);
    (i % 3 === 1 ? L.steel : L.main).push(sweptFin(top));
    L.glow.push(finGlow(top));
  }
  // a small counter-rotating claw ring round the core
  const m = Math.max(5, Math.round(n * 0.6)), ms = TAU / m;
  for (let i = 0; i < m; i++) L.dark.push(sweptFin(fin(i * ms, R * 0.24, R * 0.52, -1.1 * ms, R * 0.12, R * 0.2 * k, R * 0.07 * k, 0.2, 1.2)));
  L.dark.push(lathe(bandProfile(R * 0.78, R * 0.2), radialSegs()).translate(0, -R * 0.08, 0));
  return R * 0.25 * k;
}

function defenseStack(R: number, n: number, reach: number, thick: number, L: Layers): number {
  const step = TAU / n, Ro = R * reach, T = R * 0.2 * thick;
  L.dark.push(lathe(bandProfile(R * 0.9, R * 0.24), radialSegs()).translate(0, -R * 0.1, 0));
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const p = armourPlate({ phi: a, ri: R * 0.5, ro: Ro, wIn: R * 0.5 * step * 0.4, wOut: Ro * step * 0.4, depth: T, dome: R * 0.05, y0: R * 0.04 });
    (i % 2 === 0 ? L.main : L.steel).push(p);
    if (i % 2 === 0) {
      const stud = new THREE.CylinderGeometry(R * 0.045, R * 0.05, R * 0.04, 20);
      stud.translate(Math.cos(a) * Ro * 0.8, R * 0.04 + T + R * 0.05, Math.sin(a) * Ro * 0.8);
      L.gold.push(stud);
      const cap = new THREE.SphereGeometry(R * 0.04, 14, 6, 0, TAU, 0, Math.PI / 2);
      cap.translate(Math.cos(a) * Ro * 0.8, R * 0.04 + T + R * 0.07, Math.sin(a) * Ro * 0.8);
      L.gold.push(cap);
    }
    // inner dark block, offset half a step
    const b = (i + 0.5) * step;
    L.dark.push(armourPlate({ phi: b, ri: R * 0.3, ro: R * 0.5, wIn: R * 0.3 * step * 0.38, wOut: R * 0.5 * step * 0.38, depth: T * 0.8, dome: R * 0.02, y0: R * 0.1 }));
    L.dark.push(ringSector(Ro * 0.95, Ro * 1.0, a - step * 0.45, a + step * 0.45, R * 0.05, R * 0.0));
  }
  L.gold.push(new THREE.TorusGeometry(R * 0.52, R * 0.016, 10, torusSegs()).rotateX(Math.PI / 2).translate(0, R * 0.04 + T * 0.92, 0));
  return R * 0.04 + T + R * 0.04;
}

function staminaStack(R: number, n: number, reach: number, thick: number, L: Layers): number {
  const step = TAU / n, Ro = R * reach, k = thick;
  L.dark.push(lathe([[R * 0.62, 0], [R * 0.82, 0], [R * 0.82, R * 0.06 * k], [R * 0.62, R * 0.06 * k], [R * 0.62, 0]], radialSegs()).translate(0, R * 0.02, 0));
  L.dark.push(lathe(bandProfile(R * 0.5, R * 0.14), radialSegs()).translate(0, -R * 0.04, 0));
  for (let i = 0; i < n; i++) {
    const f = fin(i * step, R * 0.5, Ro, 2.1 * step, R * 0.15, R * 0.06 * k + (i % 3) * R * 0.018, R * 0.06 * k, 0.15, 1.5);
    (i % 2 === 0 ? L.main : L.accent).push(sweptFin(f));
    L.glow.push(finGlow(f, 0.4, 0.15, 0.95));
  }
  return R * 0.17 * k;
}

// ----------------------------------------------------------------------------------------------- view
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
    m.castShadow = GFX.shadows;
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
    const thick = s.ring.thickness ?? 1;
    const metal = brushedMetal();

    // ---- materials: clear-coated paint over brushed gunmetal, steel, gold, HDR glow
    const paint = (color: string, rough = 0.34): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({
      color, metalness: 0.5, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.05, bumpMap: metal.bump, bumpScale: 0.12,
    });
    const steelMat = (color: string, m = 0.95): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({
      color, metalness: m, roughness: 1, roughnessMap: metal.rough, envMapIntensity: 1.25, bumpMap: metal.bump, bumpScale: 0.5,
    });
    const dark = new THREE.Color(s.profile.trim).multiplyScalar(0.42).getStyle();
    const M = {
      main: paint(cc.main),
      mid: paint('#14171d', 0.36),
      dark: steelMat(dark, 0.85),
      steel: s.cls === 'DEFENSE' ? paint('#e9ecf2', 0.3) : steelMat('#d6dae2', 1),
      accent: new THREE.MeshPhysicalMaterial({ color: glowCol, metalness: 0.4, roughness: 0.3, clearcoat: 0.8, emissive: glowCol, emissiveIntensity: s.cls === 'STAMINA' ? 0.5 : 0.25, envMapIntensity: 1 }),
      gold: steelMat('#e2b552', 1),
      cap: new THREE.MeshPhysicalMaterial({ color: '#0b0d11', metalness: 0.9, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 1.2 }),
      seam: hdr(glowCol, s.cls === 'STAMINA' ? 1.6 : 2.3),
      rim: hdr(tint, 2.2),
    };

    // ---- the fin / plate stack (class silhouette)
    const L = layers();
    let top: number;
    if (s.profile.ringStyle === 'spikes') top = attackStack(R, n * 2, reach, thick, L);
    else if (s.profile.ringStyle === 'plates') top = defenseStack(R, n + 3, reach, thick, L);
    else top = staminaStack(R, n + 1, reach, thick, L);

    const y0 = -0.08 * R;
    this.add(merge(L.dark), M.dark, y0);
    this.add(merge(L.mid), M.mid, y0);
    this.add(merge(L.main), M.main, y0);
    this.add(merge(L.steel), M.steel, y0);
    this.add(merge(L.accent), M.accent, y0);
    this.add(merge(L.gold), M.gold, y0);
    this.add(merge(L.glow), M.seam, y0);

    // ---- glowing seams between the layers (they peek out through the gaps)
    [0.5, 0.72].forEach((k, i) => this.add(new THREE.TorusGeometry(R * k, R * 0.011, 6, torusSegs()).rotateX(Math.PI / 2), M.seam, y0 + top * (0.5 + i * 0.25)));

    // ---- weight disc (underneath) with its own glow edge and a ring of bolts
    const discR = R * 0.64 * wScale, discH = R * 0.14 * wScale;
    this.add(lathe(discProfile(discR, discH)), M.dark, y0 - discH);
    this.add(new THREE.TorusGeometry(discR * 0.985, R * 0.008, 6, torusSegs()).rotateX(Math.PI / 2), M.seam, y0 - discH * 0.45);
    this.add(boltRing(12, discR * 0.7, y0 - discH * 0.2, R * 0.022), M.gold, 0);

    // ---- core cap with the emblem
    const capR = R * 0.3, capH = R * 0.2;
    const capY = y0 + top;
    this.add(lathe(capProfile(capR, capH, s.core.shape)), M.cap, capY);
    const dome = s.core.shape === 'orb' ? 0.22 : s.core.shape === 'gem' ? 0.14 : 0.04;
    const topY = capY + capH * (0.95 + dome);
    this.add(new THREE.TorusGeometry(capR * 0.9, R * 0.013, 6, torusSegs()).rotateX(Math.PI / 2), M.rim, capY + capH * 0.74);
    const emb = new THREE.Mesh(
      new THREE.CircleGeometry(capR * 0.5, Math.max(24, radialSegs() / 2)).rotateX(-Math.PI / 2),
      this.own(new THREE.MeshBasicMaterial({ map: emblemTexture(tint), toneMapped: false })),
    );
    this.ownedGeo.push(emb.geometry);
    emb.position.y = topY + 0.002;
    this.spinGroup.add(emb);
    this.add(boltRing(8, capR * 1.18, capY - capH * 0.02, R * 0.02), M.steel, 0);
    // collar between cap and fins
    this.add(lathe([[capR * 1.1, 0], [capR * 1.45, 0], [capR * 1.45, R * 0.04], [capR * 1.1, R * 0.07]]), M.dark, y0 + top - R * 0.05);

    // ---- tip (visible from the side)
    const tip = tipLathe(s.tip.shape, R);
    this.add(tip, steelMat('#b4bccc', 1), y0 - discH);

    this.halfH = 0.17;
    const shadowR = R * 1.18;
    this.shadow.scale.setScalar(shadowR);
    this.halo.scale.setScalar(R);
    this.shadow.position.y = -this.halfH + 0.012;
    this.halo.position.y = -this.halfH + 0.02;

    // shield dome (Iron Dome / Fortress feedback), hidden until needed
    if (!this.shieldMesh) {
      const sh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 14),
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
