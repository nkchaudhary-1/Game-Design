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
import { boltRing, capProfile, discProfile, lathe, merge, radialSegs, tipLathe, torusSegs } from './partGeometry';
import { bladeModel, MODEL, type BladeParts } from './models';
import { LOOKS, layers } from './shapes';
import type { BuiltBlade } from './BladeFactory';
import type { PartVisual } from './parts';
import { getPart } from './parts';
import { crownColor, type VisualProfile } from './bladeData';

export interface BladeVisualSpec {
  /** Blade id: picks its Blender model. */
  id: string;
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
    id: b.def.id,
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

// ----------------------------------------------------------------------------------------------- view
/** Greyscale smear of soft arcs: what a fast-spinning blade looks like when the eye can't resolve the fins. */
let blurTex: THREE.CanvasTexture | null = null;
function blurTexture(): THREE.CanvasTexture {
  if (blurTex) return blurTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rnd = (() => { let s = 11; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  g.translate(128, 128);
  for (let i = 0; i < 90; i++) {
    const r = 58 + rnd() * 66, a0 = rnd() * TAU, span = 0.35 + rnd() * 1.1;
    g.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.12})`;
    g.lineWidth = 2 + rnd() * 9;
    g.beginPath(); g.arc(0, 0, r, a0, a0 + span); g.stroke();
  }
  // fade towards the hub and the outer edge so the smear sits on the fins, not beyond them
  const mask = g.createRadialGradient(0, 0, 40, 0, 0, 128);
  mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(0.3, 'rgba(0,0,0,0.2)'); mask.addColorStop(0.55, 'rgba(0,0,0,0)'); mask.addColorStop(0.88, 'rgba(0,0,0,0)'); mask.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = mask; g.fillRect(-128, -128, 256, 256);
  blurTex = new THREE.CanvasTexture(c);
  blurTex.colorSpace = THREE.SRGBColorSpace;
  return blurTex;
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
  /** 0–1 spin blur: a translucent smear over the fins that grows with rotation speed (default 0). */
  blur?: number;
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
  private blurMesh: THREE.Mesh | null = null;
  private blurMat: THREE.MeshBasicMaterial | null = null;
  private fadeMats: THREE.Material[] = [];
  private ownedGeo: THREE.BufferGeometry[] = [];
  private spec: BladeVisualSpec;
  private time = 0;
  /** Height of the model's centre above its floor contact, for shadow/halo placement. */
  private halfH = 0.17;
  /** How many times the fin pattern repeats round the blade: the rotation per frame is capped against it (no wagon-wheel strobing). */
  symmetry = 8;

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

  /** Where a tip of this shape ends, below its own origin, in wheel radii (so the lowest point can be put on the floor). */
  private static tipDepth(shape: string | undefined): number {
    switch (shape) { case 'pin': return 0.36; case 'ball': return 0.17; case 'flat': return 0.1; case 'stub': return 0.2; default: return 0.3; }
  }

  private build(): void {
    const parts = bladeModel(this.spec.id);
    if (parts) this.buildFromModel(parts);
    else this.buildProcedural();
  }

  /** The Blender models: a stack of named parts painted by role, with the swappable parts (weight disc, tip, emblem cap) added here. */
  private buildFromModel(parts: BladeParts): void {
    const s = this.spec;
    const cc = CLASS_COLORS[s.cls];
    const p = s.profile;
    const R = s.radius * (s.ring.scale ?? 1);
    const thick = s.ring.thickness ?? 1;
    const sy = R * (1 + (thick - 1) * 0.5);                  // ring thickness stretches the stack a little, never the footprint
    const wScale = s.weight.scale ?? 1;
    const tint = s.core.tint ?? cc.light;
    const metal = brushedMetal();
    const light = crownColor(p);
    const darken = (c: string, k: number): string => new THREE.Color(c).multiplyScalar(k).getStyle();

    const paint = (color: string, rough = 0.28, metalness = 0.12): THREE.MeshPhysicalMaterial => this.own(new THREE.MeshPhysicalMaterial({
      color, metalness, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.0, bumpMap: metal.bump, bumpScale: 0.1,
    }));
    const steel = (color: string, m = 0.9): THREE.MeshPhysicalMaterial => this.own(new THREE.MeshPhysicalMaterial({
      color, metalness: m, roughness: 1, roughnessMap: metal.rough, envMapIntensity: 1.25, bumpMap: metal.bump, bumpScale: 0.4,
    }));
    const M: Record<string, THREE.Material> = {
      base: steel(darken(p.mid, 1.4), 0.75),
      blades: paint(p.main),
      crown: paint(light, 0.26),
      inlay: this.own(new THREE.MeshPhysicalMaterial({ color: p.accent2, emissive: p.accent2, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.3, clearcoat: 0.8 })),
      plates_a: paint(light, 0.3),
      plates_b: paint(p.main, 0.3),
      bezel: steel(darken(p.trim, 0.55), 0.85),
      ticks: this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(light).multiplyScalar(1.3), toneMapped: false })),
      rim: steel(light, 0.8),
    };

    // the modelled stack: wheel radius 1 -> R, tip at the floor
    const stack = new THREE.Group();
    stack.scale.set(R, sy, R);
    for (const [name, geo] of parts) {
      const mesh = new THREE.Mesh(geo, M[name] ?? M.base);
      mesh.castShadow = GFX.shadows;
      stack.add(mesh);
    }
    this.spinGroup.add(stack);

    // ---- weight disc under the base plate, a short spin track, and the tip
    const baseY = MODEL.baseZ * sy;
    const discR = R * 0.6 * wScale, discH = R * 0.07 * wScale;
    this.addAt(lathe(discProfile(discR, discH)), steel(darken(p.trim, 0.9), 0.85), baseY - discH);
    this.addAt(new THREE.TorusGeometry(discR * 0.985, R * 0.008, 6, torusSegs()).rotateX(Math.PI / 2), M.ticks, baseY - discH * 0.45);
    const depth = BladeView.tipDepth(s.tip.shape) * R;
    const tipMat = steel('#b4bccc', 1);
    const tipGeo = tipLathe(s.tip.shape, R);
    this.addAt(tipGeo, tipMat, depth);
    const trackTop = baseY - discH;
    if (trackTop - depth > 0.01 * R) {
      this.addAt(new THREE.CylinderGeometry(R * 0.13, R * 0.17, trackTop - depth + 0.02 * R, Math.max(14, radialSegs() / 2)), steel(darken(p.trim, 0.8), 0.7), depth - 0.01 * R + (trackTop - depth + 0.02 * R) / 2);
    }

    // ---- the emblem cap sits in the bezel; the core part decides its shape and tint
    const capR = R * 0.272, capH = R * 0.17;
    const capY = (MODEL.baseTop + 0.07) * sy;
    this.addAt(lathe(capProfile(capR, capH, s.core.shape)), this.own(new THREE.MeshPhysicalMaterial({ color: '#0b0d11', metalness: 0.9, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 1.2 })), capY);
    const dome = s.core.shape === 'orb' ? 0.22 : s.core.shape === 'gem' ? 0.14 : 0.04;
    const topY = capY + capH * (0.95 + dome);
    this.addAt(new THREE.TorusGeometry(capR * 0.9, R * 0.013, 6, torusSegs()).rotateX(Math.PI / 2), this.own(hdr(tint, 2.2)), capY + capH * 0.74);
    const emb = new THREE.Mesh(
      new THREE.CircleGeometry(capR * 0.84, Math.max(24, radialSegs() / 2)).rotateX(-Math.PI / 2),
      this.own(new THREE.MeshBasicMaterial({ map: emblemTexture(tint), toneMapped: false })),
    );
    this.ownedGeo.push(emb.geometry);
    emb.position.y = topY + 0.002;
    this.spinGroup.add(emb);

    this.finishBuild(R, sy);
  }

  /** Add an owned geometry at height y (models are floor-based, so there is no extra offset). `mat` must already be owned. */
  private addAt(geo: THREE.BufferGeometry, mat: THREE.Material, y: number): void {
    this.ownedGeo.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = GFX.shadows;
    this.spinGroup.add(m);
  }

  /** Spin blur, shadow, halo and shield: sized to the blade that was just built. */
  private finishBuild(R: number, sy: number): void {
    if (!this.blurMesh) {
      this.blurMat = new THREE.MeshBasicMaterial({ map: blurTexture(), transparent: true, depthWrite: false, opacity: 0, color: '#ffffff', toneMapped: false });
      this.blurMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), this.blurMat);
      this.blurMesh.renderOrder = 2;
      this.blurMesh.visible = false;
      this.lean.add(this.blurMesh);
    }
    this.blurMat!.color.set(this.spec.profile.accent2);
    this.blurMesh.scale.setScalar(R * 1.02);
    this.blurMesh.position.y = (MODEL.baseTop + 0.2) * sy;
    this.layoutAround(R, sy);
  }

  private layoutAround(R: number, sy: number): void {
    // the blade stands on its tip: pivot at the floor, so leaning and wobbling swing the top, as a real top does
    this.lean.position.y = -this.halfH;
    const shadowR = R * 1.18;
    this.shadow.scale.setScalar(shadowR);
    this.halo.scale.setScalar(R);
    this.shadow.position.y = -this.halfH + 0.012;
    this.halo.position.y = -this.halfH + 0.02;
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
    this.shieldMesh.position.y = 0.34 * sy;
  }

  private buildProcedural(): void {
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
      main: paint(s.profile.main),
      mid: paint(s.profile.mid, 0.36),
      dark: steelMat(dark, 0.85),
      steel: s.profile.alt ? paint(s.profile.alt, 0.3) : steelMat('#d6dae2', 1),
      accent: new THREE.MeshPhysicalMaterial({ color: glowCol, metalness: 0.4, roughness: 0.3, clearcoat: 0.8, emissive: glowCol, emissiveIntensity: s.cls === 'STAMINA' ? 0.5 : 0.25, envMapIntensity: 1 }),
      gold: steelMat('#e2b552', 1),
      cap: new THREE.MeshPhysicalMaterial({ color: '#0b0d11', metalness: 0.9, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 1.2 }),
      seam: hdr(glowCol, s.cls === 'STAMINA' ? 1.6 : 2.3),
      rim: hdr(tint, 2.2),
    };

    // ---- the fin / plate stack (class silhouette)
    const L = layers();
    const built = (LOOKS[s.profile.look] ?? LOOKS.ravok)({ R, n, reach, k: thick, L });
    const top = built.top;
    this.symmetry = built.sym;

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

    // spin blur: a flat translucent smear just above the fins
    if (!this.blurMesh) {
      this.blurMat = new THREE.MeshBasicMaterial({ map: blurTexture(), transparent: true, depthWrite: false, opacity: 0, color: '#ffffff', toneMapped: false });
      this.blurMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), this.blurMat);
      this.blurMesh.renderOrder = 2;
      this.blurMesh.visible = false;
      this.lean.add(this.blurMesh);
    }
    this.blurMat!.color.set(glowCol);
    this.blurMesh.scale.setScalar(R * 1.02);
    this.blurMesh.position.y = y0 + top * 0.92;

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
    if (this.blurMesh && this.blurMat) {
      const k = s.blur ?? 0;
      this.blurMesh.visible = k > 0.02;
      this.blurMat.opacity = 0.42 * k * s.alpha;
      this.blurMesh.rotation.y = s.spinAngle * 0.4;
    }
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
    this.blurMesh?.geometry.dispose();
    this.blurMat?.dispose();
  }
}
