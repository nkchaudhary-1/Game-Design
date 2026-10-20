// The animated half of each arena: the parts that move or change while a match is on. The floor art (arenaFloors.ts)
// is static; this layer draws the magnet's flowing rings, the crystals, the turning plates, the wind lanes, the lava and
// the gravity zones from the same hazard objects the simulation uses, so what you see is exactly what acts on the blades.

import * as THREE from 'three';
import { clamp, lerp, TAU } from '../core/types';
import { makeRng } from '../core/Rng';
import type { Match } from '../combat/Match';
import type { SimEvent } from '../combat/events';
import { fbm } from '../render/procTex';
import { GFX } from '../render/quality';
import { hdr } from '../render/materials';
import type { ImpactFX } from '../vfx/ImpactFX';
import type { Arena } from './Arena';
import {
  CRYSTAL_INFO, CrystalHazard, GRAVITY_ZONES, LavaHazard, MagnetHazard, ShiftHazard, WindHazard, type Crystal,
} from './hazards';

export type ArenaEvent = Extract<SimEvent, { type: 'arena' }>;

/** What a visual may ask of the scene when the arena does something. */
export interface HazardCtx { fx: ImpactFX; y: (x: number, z: number) => number; shake: (k: number) => void }

export interface HazardVisual {
  readonly root: THREE.Group;
  update(m: Match, dt: number): void;
  onEvent(e: ArenaEvent, ctx: HazardCtx): void;
  dispose(): void;
}

// ------------------------------------------------------------------------------------------------ helpers
abstract class Base implements HazardVisual {
  readonly root = new THREE.Group();
  protected readonly owned: Array<{ dispose(): void }> = [];
  protected time = 0;
  constructor(protected readonly arena: Arena) {}
  protected own<T extends { dispose(): void }>(o: T): T { this.owned.push(o); return o; }
  abstract update(m: Match, dt: number): void;
  onEvent(_e: ArenaEvent, _ctx: HazardCtx): void { /* nothing by default */ }
  dispose(): void { this.owned.forEach((o) => o.dispose()); }
}

/** A flat annulus/disc whose vertices sit on the arena surface, UV-mapped in world units (so painted art lines up). */
function surfaceDisc(arena: Arena, r0: number, r1: number, lift: number, uvR: number, rings = 20, segs = 72): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const r = lerp(r0, r1, i / rings);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos.push(x, arena.surfaceY(x, z) + lift, z);
      uv.push(x / (2 * uvR) + 0.5, 0.5 - z / (2 * uvR));
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Paint in world units (1 unit = 1 m, +z up the page) onto a square canvas covering the arena. */
function worldCanvas(size: number, radius: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2); g.scale(size / (2 * radius), -size / (2 * radius));
  paint(g);
  return c;
}

const glowTex = (inner = 'rgba(255,255,255,1)'): THREE.CanvasTexture => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
};

const additive = (map: THREE.Texture | null, color: string | number = '#ffffff', opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });

const ringMesh = (arena: Arena, r: number, w: number, y: number, mat: THREE.Material): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - w / 2, r + w / 2, 64).rotateX(-Math.PI / 2), mat);
  m.position.y = y; void arena;
  return m;
};

// ------------------------------------------------------------------------------------------------ Magnetic Core
class MagnetVisual extends Base {
  private readonly h: MagnetHazard;
  private readonly core = new THREE.Group();
  private readonly field: THREE.Mesh;
  private readonly fieldMat: THREE.MeshBasicMaterial;
  private readonly waves: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; p: number }> = [];
  private readonly light = new THREE.PointLight('#2f86ff', 0, 16, 2);
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly lensMat: THREE.MeshBasicMaterial;

  constructor(arena: Arena) {
    super(arena);
    this.h = arena.hazards[0] as MagnetHazard;
    const y0 = arena.surfaceY(0, 0);
    // iron-filing field lines painted on a disc that turns with the magnet
    const tex = this.own(new THREE.CanvasTexture(worldCanvas(1024, arena.radius, (g) => {
      g.strokeStyle = '#ffffff'; g.lineCap = 'round';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        g.lineWidth = 0.05 + (i % 2) * 0.03; g.globalAlpha = 0.85 - (i % 2) * 0.3;
        g.beginPath();
        for (let s = 0; s <= 1; s += 0.03) { const r = 1.9 + s * 9, aa = a + s * 1.0; const x = Math.cos(aa) * r, z = Math.sin(aa) * r; if (s === 0) g.moveTo(x, z); else g.lineTo(x, z); }
        g.stroke();
      }
    })));
    this.fieldMat = this.own(additive(tex, '#2f86ff', 0));
    this.field = new THREE.Mesh(this.own(surfaceDisc(arena, 1.7, arena.radius - 0.2, 0.05, arena.radius)), this.fieldMat);
    this.field.renderOrder = 3;
    this.root.add(this.field);

    // the magnet: a dark housing with a bright lens, two poles
    const housing = new THREE.Mesh(this.own(new THREE.CylinderGeometry(1.55, 1.7, 0.5, 40)), this.own(new THREE.MeshStandardMaterial({ color: '#1a2736', metalness: 0.85, roughness: 0.32 })));
    housing.position.y = 0.2;
    const lip = new THREE.Mesh(this.own(new THREE.TorusGeometry(1.5, 0.12, 12, 48).rotateX(Math.PI / 2)), this.own(new THREE.MeshStandardMaterial({ color: '#9bb7d4', metalness: 0.95, roughness: 0.22 })));
    lip.position.y = 0.46;
    this.lensMat = this.own(hdr('#2f86ff', 2.4));
    const lens = new THREE.Mesh(this.own(new THREE.CircleGeometry(1.2, 40).rotateX(-Math.PI / 2)), this.lensMat);
    lens.position.y = 0.47;
    this.coreMat = this.own(hdr('#bfe0ff', 3));
    const nub = new THREE.Mesh(this.own(new THREE.SphereGeometry(0.34, 20, 14)), this.coreMat);
    nub.position.y = 0.62;
    this.core.add(housing, lip, lens, nub);
    this.core.position.y = y0;
    this.root.add(this.core);
    this.light.position.set(0, y0 + 1.6, 0);
    this.root.add(this.light);

    // rings that flow in (pull) or out (push)
    for (let i = 0; i < 4; i++) {
      const mat = this.own(additive(null, '#2f86ff', 0));
      const mesh = ringMesh(arena, 1, 0.16, y0 + 0.06, mat);
      mesh.visible = false; mesh.renderOrder = 3;
      this.own(mesh.geometry);
      this.root.add(mesh);
      this.waves.push({ mesh, mat, p: i / 4 });
    }
  }

  override update(m: Match, dt: number): void {
    this.time += dt;
    const h = this.h;
    const pull = h.phase === 'pull', push = h.phase === 'push';
    const col = pull ? '#35a0ff' : push ? '#ff7a3a' : '#7fa9d6';
    const warn = h.phase === 'calm' && h.untilNext < 1 && m.phase === 'live';
    const flick = warn ? 0.5 + 0.5 * Math.sin(this.time * 26) : 0;
    this.fieldMat.color.set(col);
    this.fieldMat.opacity = clamp(0.06 + h.strength * 0.5 + flick * 0.18, 0, 0.7);
    this.field.rotation.y = -h.angle * 0.5;
    this.lensMat.color.set(col).multiplyScalar(2.2 + h.strength * 1.6 + flick * 2);
    this.coreMat.color.set(pull ? '#d8f0ff' : push ? '#ffe0c0' : '#bfe0ff').multiplyScalar(2.4 + h.strength * 2);
    this.core.rotation.y = h.angle * 0.2;
    this.light.color.set(col);
    this.light.intensity = 3 + h.strength * 14 + flick * 8;
    for (const w of this.waves) {
      w.mat.color.set(col);
      if (!pull && !push) { w.mesh.visible = false; continue; }
      w.p = (w.p + dt * (pull ? 0.26 : 0.34)) % 1;
      const q = pull ? 1 - w.p : w.p;
      const r = lerp(2, 10.6, q);
      w.mesh.visible = true;
      w.mesh.scale.setScalar(r);
      w.mesh.position.y = this.arena.surfaceY(r, 0) + 0.07;
      w.mat.opacity = Math.sin(Math.PI * w.p) * h.strength * 0.85;
    }
  }

  override onEvent(e: ArenaEvent, c: HazardCtx): void {
    if (e.kind === 'pull' || e.kind === 'push') { c.fx.ring(0, c.y(0, 0), 0, e.kind === 'pull' ? 9 : 2, e.kind === 'pull' ? 2 : 10, 0.7, e.kind === 'pull' ? '#35a0ff' : '#ff7a3a', 0.8); c.shake(0.3); }
  }
}

// ------------------------------------------------------------------------------------------------ Crystal Arena
const KIND_ORDER = ['overdrive', 'aegis', 'surge', 'haste'] as const;

class CrystalVisual extends Base {
  private readonly h: CrystalHazard;
  private readonly stands: Array<{ g: THREE.Group; mats: THREE.MeshStandardMaterial[]; glow: THREE.MeshBasicMaterial; pad: THREE.MeshBasicMaterial; scale: number; kind: string }> = [];

  constructor(arena: Arena) {
    super(arena);
    this.h = arena.hazards[0] as CrystalHazard;
    const spec: Array<[number, number, number, number, number]> = [   // x, z, height, radius, lean
      [0, 0, 3.0, 0.62, 0], [0.62, 0.3, 2.1, 0.44, 0.32], [-0.58, 0.4, 1.7, 0.4, -0.4], [0.14, -0.64, 1.45, 0.38, 0.5],
    ];
    const padTex = this.own(glowTex('rgba(255,255,255,0.9)'));
    for (const c of this.h.crystals) {
      const g = new THREE.Group();
      const mats: THREE.MeshStandardMaterial[] = [];
      for (const [x, z, hgt, rad, lean] of spec) {
        const mat = this.own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.85, roughness: 0.12, metalness: 0.15, flatShading: true, transparent: true, opacity: 0.93 }));
        mats.push(mat);
        const geo = this.own(new THREE.ConeGeometry(rad, hgt, 6, 1));
        const body = new THREE.Mesh(geo, mat);
        body.position.set(x, hgt / 2, z);
        body.rotation.set(lean * 0.5, 0, -lean * 0.4);
        g.add(body);
      }
      const glow = this.own(hdr('#ffffff', 2.2)); glow.transparent = true; glow.opacity = 0.9;
      const core = new THREE.Mesh(this.own(new THREE.OctahedronGeometry(0.24)), glow);
      core.position.y = 1.4;
      g.add(core);
      const pad = this.own(additive(padTex, '#ffffff', 0.6));
      const padMesh = new THREE.Mesh(this.own(new THREE.PlaneGeometry(4.2, 4.2).rotateX(-Math.PI / 2)), pad);
      padMesh.position.y = 0.05; padMesh.renderOrder = 3;
      g.add(padMesh);
      g.position.set(c.x, arena.surfaceY(c.x, c.z), c.z);
      this.root.add(g);
      this.stands.push({ g, mats, glow, pad, scale: 1, kind: '' });
    }
  }

  override update(m: Match, dt: number): void {
    this.time += dt;
    this.h.crystals.forEach((c: Crystal, i) => {
      const s = this.stands[i];
      if (s.kind !== c.kind) {
        s.kind = c.kind;
        const col = CRYSTAL_INFO[c.kind].color;
        s.mats.forEach((mt) => { mt.color.set(col); mt.emissive.set(col); });
        s.glow.color.set(col).multiplyScalar(2.2); s.pad.color.set(col);
      }
      const goal = c.alive ? clamp((m.t - c.bornAt) * 2.4 + 0.15, 0, 1) : 0;
      s.scale += (goal - s.scale) * (1 - Math.exp(-dt * (c.alive ? 8 : 24)));
      s.g.visible = s.scale > 0.01;
      s.g.scale.setScalar(Math.max(0.001, s.scale));
      s.g.rotation.y += dt * 0.45;
      const bob = Math.sin(this.time * 2 + i * 1.7) * 0.07;
      s.g.children.forEach((ch, k) => { if (k < 4) ch.position.y = ((ch as THREE.Mesh).geometry as THREE.ConeGeometry).parameters.height / 2 + bob; });
      s.pad.opacity = 0.35 + 0.25 * Math.sin(this.time * 3 + i);
      s.glow.opacity = 0.7 + 0.3 * Math.sin(this.time * 5 + i);
    });
  }

  override onEvent(e: ArenaEvent, c: HazardCtx): void {
    const kind = KIND_ORDER[Math.max(0, Math.min(3, Math.round(e.power)))] ?? 'surge';
    const col = CRYSTAL_INFO[kind].color;
    const y = c.y(e.x, e.z);
    if (e.kind === 'crystalBreak') {
      c.fx.burst(e.x, y + 0.6, e.z, col, 46, 9);
      c.fx.ring(e.x, y, e.z, 0.4, 3.4, 0.5, col, 0.9);
      c.fx.ring(e.x, y, e.z, 0.2, 1.8, 0.35, '#ffffff', 0.7);
      c.shake(0.25);
    } else if (e.kind === 'crystalSpawn') {
      c.fx.ring(e.x, y, e.z, 2.6, 0.5, 0.5, col, 0.6);
    }
  }
}

// ------------------------------------------------------------------------------------------------ Shift Floor
const PLATE_MARGIN = 0.06;

/** A plate: the top follows the arena surface (it is a dished floor), with thick sides. */
function plateGeometry(arena: Arena, r0: number, r1: number, a0: number, a1: number, thick: number): THREE.BufferGeometry {
  const full = a1 - a0 >= TAU - 1e-4;
  const m = full ? 0 : PLATE_MARGIN;
  const ri = r0 + (r0 > 0 ? PLATE_MARGIN : 0), ro = Math.min(r1, arena.radius) - 0.02;
  const aa0 = a0 + (full ? 0 : m / Math.max(ri, 1)), aa1 = a1 - (full ? 0 : m / Math.max(ri, 1));
  const nr = Math.max(3, Math.ceil((ro - ri) / 0.7)), na = Math.max(2, Math.ceil(((aa1 - aa0) * Math.max(ri, 2)) / 0.9));
  const pos: number[] = [], idx: number[] = [];
  const top = (r: number, a: number): [number, number, number] => { const x = Math.cos(a) * r, z = Math.sin(a) * r; return [x, arena.surfaceY(x, z) + 0.02, z]; };
  const base = pos.length / 3;
  for (let i = 0; i <= nr; i++) for (let j = 0; j <= na; j++) pos.push(...top(lerp(ri, ro, i / nr), lerp(aa0, aa1, j / na)));
  for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++) {
    const a = base + i * (na + 1) + j, b = a + na + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const wall = (pts: Array<[number, number, number]>, flip: boolean): void => {
    const s = pos.length / 3;
    for (const p of pts) { pos.push(p[0], p[1], p[2]); pos.push(p[0], p[1] - thick, p[2]); }
    for (let k = 0; k < pts.length - 1; k++) {
      const a = s + k * 2, b = a + 2;
      if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  };
  const arcPts = (r: number): Array<[number, number, number]> => Array.from({ length: na + 1 }, (_, j) => top(r, lerp(aa0, aa1, j / na)));
  const radPts = (a: number): Array<[number, number, number]> => Array.from({ length: nr + 1 }, (_, i) => top(lerp(ri, ro, i / nr), a));
  wall(arcPts(ro), true);
  if (ri > 0) wall(arcPts(ri), false);
  if (!full) { wall(radPts(aa0), false); wall(radPts(aa1), true); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] * 0.22, pos[i + 2] * 0.22);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

class ShiftVisual extends Base {
  private readonly h: ShiftHazard;
  private readonly rings: THREE.Group[] = [];
  private readonly plates: Array<{ ring: number; sector: number; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; edge: THREE.LineBasicMaterial; base: THREE.Color }> = [];
  private readonly under = new THREE.PointLight('#ff4a3a', 0, 9, 2);

  constructor(arena: Arena) {
    super(arena);
    this.h = arena.hazards[0] as ShiftHazard;
    const tones = ['#3f6e7a', '#35606c', '#2d5260'];
    const accent = arena.def.palette.accent;
    // brushed-steel panel with rivets, shared by every plate
    const pc = document.createElement('canvas'); pc.width = pc.height = 256;
    const pg = pc.getContext('2d')!;
    pg.fillStyle = '#9aa8b0'; pg.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) { pg.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},${0.03 + (i % 7) * 0.008})`; pg.fillRect((i * 97) % 256, (i * 53) % 256, 40 + (i % 5) * 30, 1); }
    pg.strokeStyle = 'rgba(0,0,0,0.45)'; pg.lineWidth = 4; pg.strokeRect(6, 6, 244, 244); pg.strokeRect(128, 6, 0, 244);
    for (const [x, y] of [[20, 20], [236, 20], [20, 236], [236, 236]]) { pg.fillStyle = 'rgba(0,0,0,0.5)'; pg.beginPath(); pg.arc(x + 1, y + 1, 6, 0, TAU); pg.fill(); pg.fillStyle = 'rgba(255,255,255,0.55)'; pg.beginPath(); pg.arc(x, y, 5, 0, TAU); pg.fill(); }
    const panel = this.own(new THREE.CanvasTexture(pc)); panel.wrapS = panel.wrapT = THREE.RepeatWrapping; panel.colorSpace = THREE.SRGBColorSpace; panel.anisotropy = 4;
    const arrowMat = this.own(hdr(accent, 2.2));
    const arrowGeo = this.own(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0.7, 0), new THREE.Vector2(-0.4, 0.55), new THREE.Vector2(-0.12, 0), new THREE.Vector2(-0.4, -0.55)])).rotateX(-Math.PI / 2));
    this.h.rings.forEach((R, ri) => {
      const grp = new THREE.Group();
      for (let s = 0; s < R.n; s++) {
        const a0 = (s / R.n) * TAU, a1 = ((s + 1) / R.n) * TAU;
        const geo = this.own(plateGeometry(arena, R.r0, R.r1, a0, a1, 0.5));
        const mat = this.own(new THREE.MeshStandardMaterial({ color: tones[ri], map: panel, bumpMap: panel, bumpScale: 0.6, metalness: 0.5, roughness: 0.5, envMapIntensity: 0.9 }));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true; mesh.castShadow = GFX.shadows;
        grp.add(mesh);
        // an arrow on each plate points the way it is turning
        const am = (a0 + a1) / 2, rm = (Math.max(R.r0, 0) + Math.min(R.r1, 12)) / 2;
        if (R.n > 1) {
          const arrow = new THREE.Mesh(arrowGeo, arrowMat);
          const dir = Math.sign(R.omega) || 1;
          const tx = -Math.sin(am) * dir, tz = Math.cos(am) * dir;
          const x = Math.cos(am) * rm, z = Math.sin(am) * rm;
          arrow.position.set(x, arena.surfaceY(x, z) + 0.06, z);
          arrow.rotation.y = Math.atan2(-tz, tx);
          arrow.scale.setScalar(0.9);
          mesh.add(arrow);
        }
        const edge = this.own(new THREE.LineBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(1.8), transparent: true, opacity: 0.9, toneMapped: false }));
        const line = new THREE.LineSegments(this.own(new THREE.EdgesGeometry(geo, 35)), edge);
        mesh.add(line);
        this.plates.push({ ring: ri, sector: s, mesh, mat, edge, base: new THREE.Color(tones[ri]) });
      }
      this.rings.push(grp);
      this.root.add(grp);
    });
    this.under.position.set(0, -0.2, 0);
    this.root.add(this.under);
  }

  override update(m: Match, dt: number): void {
    this.time += dt;
    this.h.rings.forEach((R, i) => { this.rings[i].rotation.y = -R.angle; });
    const g = this.h.gap, st = this.h.gapState(m.t);
    for (const p of this.plates) {
      const isGap = !!g && g.ring === p.ring && g.sector === p.sector && st.phase !== 'none';
      let sink = 0, glow = 0;
      if (isGap) {
        sink = st.phase === 'open' ? st.depth * 0.95 : 0.1 * st.depth;
        glow = st.phase === 'warn' ? 0.5 + 0.5 * Math.sin(this.time * 22) : 0.6;
      }
      p.mesh.position.y += (-sink - p.mesh.position.y) * (1 - Math.exp(-dt * 14));
      p.mat.color.copy(p.base).lerp(new THREE.Color(st.phase === 'open' ? '#3a1210' : '#5a3a14'), isGap ? clamp(glow, 0, 1) * 0.7 : 0);
      p.mat.emissive.set(isGap ? (st.phase === 'warn' ? '#ff9a2a' : '#ff3a24') : '#000000');
      p.mat.emissiveIntensity = glow * 0.9;
      p.edge.opacity = isGap ? 1 : 0.55;
    }
    // red under-light shining up through the hole
    if (g && st.phase !== 'none') {
      const mid = this.h.sectorCentre(g, m.t);
      this.under.position.set(mid.x, this.arena.surfaceY(mid.x, mid.z) - 0.1, mid.z);
      this.under.intensity = st.phase === 'open' ? 9 : 3 * st.depth * 3;
    } else this.under.intensity = 0;
  }

  override onEvent(e: ArenaEvent, c: HazardCtx): void {
    const y = c.y(e.x, e.z);
    if (e.kind === 'gapOpen') { c.fx.puff(e.x, y, e.z, 3.2); c.fx.ring(e.x, y, e.z, 0.6, 3.6, 0.5, '#ff5a3a', 0.7); c.shake(0.35); }
    else if (e.kind === 'gapClose') { c.fx.puff(e.x, y, e.z, 2.6); c.shake(0.15); }
    else if (e.kind === 'stumble') { c.fx.burst(e.x, y, e.z, '#ff7a3a', 8, 3); }
  }
}

// ------------------------------------------------------------------------------------------------ Wind Tunnel
class WindVisual extends Base {
  private readonly h: WindHazard;
  private readonly lanes: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; tex: THREE.CanvasTexture; dir: number; power: number }> = [];
  private readonly streaks: THREE.Points;
  private readonly sp: Float32Array;
  private readonly lane: Uint8Array;

  constructor(arena: Arena) {
    super(arena);
    this.h = arena.hazards[0] as WindHazard;
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#ffffff'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const x of [30, 158]) { g.beginPath(); g.moveTo(x - 22, 22); g.lineTo(x + 14, 64); g.lineTo(x - 22, 106); g.stroke(); }
    const chevrons = this.own(new THREE.CanvasTexture(c));
    chevrons.wrapS = THREE.RepeatWrapping; chevrons.wrapT = THREE.ClampToEdgeWrapping;
    for (const l of this.h.lanes) {
      const len = 2 * Math.sqrt(Math.max(0, 12.2 * 12.2 - l.z * l.z)) - 0.4;
      const geo = this.own(new THREE.PlaneGeometry(len, l.hw * 2 - 0.3, 48, 2).rotateX(-Math.PI / 2));
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setY(i, arena.surfaceY(p.getX(i), l.z + p.getZ(i)) + 0.05);
      geo.translate(0, 0, l.z);
      const tex = chevrons.clone(); tex.needsUpdate = true; tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set((len / 2.4) * l.dir, 1);
      this.own(tex);
      const mat = this.own(additive(tex, arena.def.palette.accent, 0.5));
      const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 3;
      mesh.position.z = 0;
      geo.translate(0, 0, 0);
      this.root.add(mesh);
      this.lanes.push({ mesh, mat, tex, dir: l.dir, power: l.power });
    }
    // streaks of air
    const n = GFX.tier === 'low' ? 0 : 90;
    const rnd = makeRng(77);
    const pos = new Float32Array(n * 3);
    this.sp = new Float32Array(n); this.lane = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const li = i % this.h.lanes.length, l = this.h.lanes[li];
      this.lane[i] = li; this.sp[i] = 0.7 + rnd() * 0.6;
      pos[i * 3] = (rnd() - 0.5) * 22; pos[i * 3 + 1] = 0.25 + rnd() * 0.6; pos[i * 3 + 2] = l.z + (rnd() - 0.5) * l.hw * 1.7;
    }
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.streaks = new THREE.Points(geo, this.own(new THREE.PointsMaterial({ size: 0.22, map: this.own(glowTex()), color: '#d8f3ff', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })));
    this.root.add(this.streaks);
  }

  override update(m: Match, dt: number): void {
    this.time += dt;
    const gust = this.h.gust, warn = this.h.warn;
    for (const l of this.lanes) {
      l.tex.offset.x -= dt * (0.9 + 0.35 * l.power / 8.5 * gust) * Math.sign(l.dir) * Math.sign(l.tex.repeat.x);
      l.mat.opacity = 0.42 + 0.35 * (gust - 1) / 0.8 + warn * 0.25 * (0.5 + 0.5 * Math.sin(this.time * 24));
    }
    const p = this.streaks.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const l = this.h.lanes[this.lane[i]];
      let x = p.getX(i) + l.dir * (5 + l.power * 0.7) * this.sp[i] * gust * dt;
      if (x > 11.5) x = -11.5; else if (x < -11.5) x = 11.5;
      p.setX(i, x);
      p.setY(i, this.arena.surfaceY(x, l.z) + 0.3 + 0.2 * Math.sin(this.time * 3 + i));
    }
    p.needsUpdate = true;
    void m;
  }

  override onEvent(e: ArenaEvent, c: HazardCtx): void {
    if (e.kind === 'gust') c.shake(0.18);
  }
}

// ------------------------------------------------------------------------------------------------ Lava Ring
const lavaCanvas = (radius: number, seed: number, size: number): HTMLCanvasElement => {
  const n = 256, f = fbm(n, seed, 5, 7), f2 = fbm(n, seed + 9, 4, 14);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  const small = document.createElement('canvas'); small.width = small.height = n;
  const sg = small.getContext('2d')!; const img = sg.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const wx = ((x + 0.5) / n - 0.5) * 2 * radius, wz = (0.5 - (y + 0.5) / n) * 2 * radius, r = Math.hypot(wx, wz);
    const i = (y * n + x) * 4;
    if (r < LavaHazard.R0 - 0.15 || r > LavaHazard.R1 + 0.15) { img.data[i + 3] = 0; continue; }
    const v = clamp(f[y * n + x] * 0.7 + f2[y * n + x] * 0.45, 0, 1);
    const hot = Math.pow(clamp((v - 0.32) * 2.6, 0, 1), 1.4);
    img.data[i] = 255; img.data[i + 1] = Math.round(40 + 190 * hot); img.data[i + 2] = Math.round(10 + 80 * hot * hot);
    const edge = clamp(Math.min(r - (LavaHazard.R0 - 0.15), LavaHazard.R1 + 0.15 - r) / 0.18, 0, 1);
    img.data[i + 3] = Math.round(255 * edge);
  }
  sg.putImageData(img, 0, 0);
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, size, size);
  return c;
};

class LavaVisual extends Base {
  private readonly h: LavaHazard;
  private readonly layers: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; speed: number }> = [];
  private readonly vents: Array<{ plume: THREE.Mesh; plumeMat: THREE.MeshBasicMaterial; glow: THREE.MeshBasicMaterial; light: THREE.PointLight }> = [];
  private embers: THREE.Points | null = null;
  private ev: Float32Array = new Float32Array(0);

  constructor(arena: Arena) {
    super(arena);
    this.h = arena.hazards[0] as LavaHazard;
    const size = GFX.tier === 'low' ? 512 : 1024;
    [[11, '#ffffff', 0.025, 1.0], [23, '#ffd9a0', -0.04, 0.55]].forEach(([seed, color, speed, op]) => {
      const tex = this.own(new THREE.CanvasTexture(lavaCanvas(arena.radius, seed as number, size)));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = this.own(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color as string).multiplyScalar(0.85), transparent: true, opacity: op as number, depthWrite: false, toneMapped: false, blending: (op as number) < 1 ? THREE.AdditiveBlending : THREE.NormalBlending }));
      const mesh = new THREE.Mesh(this.own(surfaceDisc(arena, LavaHazard.R0 - 0.2, LavaHazard.R1 + 0.2, 0.035 + (op as number < 1 ? 0.01 : 0), arena.radius, 8, 96)), mat);
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.layers.push({ mesh, mat, speed: speed as number });
    });
    const glowT = this.own(glowTex('rgba(255,210,150,1)'));
    for (const v of this.h.vents) {
      const y = arena.surfaceY(v.x, v.z);
      const glow = this.own(additive(glowT, '#ff6a2a', 0));
      const pad = new THREE.Mesh(this.own(new THREE.PlaneGeometry(LavaHazard.VENT_R * 2.6, LavaHazard.VENT_R * 2.6).rotateX(-Math.PI / 2)), glow);
      pad.position.set(v.x, y + 0.07, v.z); pad.renderOrder = 4;
      const plumeMat = this.own(additive(null, '#ff8a3a', 0));
      const plume = new THREE.Mesh(this.own(new THREE.ConeGeometry(1.1, 1, 16, 1, true).translate(0, 0.5, 0)), plumeMat);
      plume.position.set(v.x, y, v.z); plume.scale.set(1, 0.001, 1); plume.visible = false;
      const light = new THREE.PointLight('#ff6a2a', 0, 11, 2);
      light.position.set(v.x, y + 1.2, v.z);
      this.root.add(pad, plume, light);
      this.vents.push({ plume, plumeMat, glow, light });
    }
    if (GFX.tier !== 'low') {
      const n = 110, rnd = makeRng(91), pos = new Float32Array(n * 3);
      this.ev = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, r = LavaHazard.R0 + rnd() * (LavaHazard.R1 - LavaHazard.R0);
        pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = rnd() * 3; pos[i * 3 + 2] = Math.sin(a) * r;
        this.ev[i] = 0.4 + rnd() * 0.9;
      }
      const geo = this.own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, this.own(new THREE.PointsMaterial({ size: 0.16, map: glowT, color: '#ff9a4a', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })));
      this.embers = pts;
      this.root.add(pts);
    }
  }

  override update(m: Match, dt: number): void {
    this.time += dt;
    this.layers.forEach((l, i) => {
      l.mesh.rotation.y += l.speed * dt;
      l.mat.color.set(i === 0 ? '#ffffff' : '#ffd9a0').multiplyScalar(0.8 + 0.18 * Math.sin(this.time * 1.7 + i * 2));
    });
    this.h.vents.forEach((v, i) => {
      const vt = this.vents[i];
      const warm = Math.max(v.warn * (0.6 + 0.4 * Math.sin(this.time * (14 + v.warn * 20))), v.erupting);
      vt.glow.opacity = warm * 0.95;
      vt.light.intensity = warm * 16;
      vt.plume.visible = v.erupting > 0.02;
      vt.plume.scale.set(0.6 + (1 - v.erupting) * 1.1, 0.4 + v.erupting * 4.2, 0.6 + (1 - v.erupting) * 1.1);
      vt.plumeMat.opacity = v.erupting * 0.75;
    });
    if (this.embers) {
      const p = this.embers.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + this.ev[i] * dt * 0.9;
        if (y > 3.2) y = 0;
        p.setY(i, y);
        p.setX(i, p.getX(i) + Math.sin(this.time * 0.9 + i) * dt * 0.1);
      }
      p.needsUpdate = true;
    }
    void m;
  }

  override onEvent(e: ArenaEvent, c: HazardCtx): void {
    const y = c.y(e.x, e.z);
    if (e.kind === 'lavaBurst') {
      c.fx.burst(e.x, y + 0.4, e.z, '#ff8a3a', 60, 9);
      c.fx.burst(e.x, y + 0.4, e.z, '#ffd27a', 24, 6);
      c.fx.ring(e.x, y, e.z, 0.4, LavaHazard.VENT_R * 1.5, 0.45, '#ff6a2a', 0.9);
      c.shake(0.5);
    } else if (e.kind === 'lavaBurn') {
      c.fx.burst(e.x, y, e.z, '#ff7a30', 7, 3.4);
    }
  }
}

// ------------------------------------------------------------------------------------------------ Gravity Well
class GravityVisual extends Base {
  private readonly orbit: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly waves: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; p: number }> = [];
  private motes: THREE.Points | null = null;
  private readonly accretion: THREE.Mesh;
  private readonly light = new THREE.PointLight('#a05cff', 7, 16, 2);

  constructor(arena: Arena) {
    super(arena);
    const { highOuter, lowInner } = GRAVITY_ZONES;
    const accent = arena.def.palette.accent;
    const orbitTex = this.own(new THREE.CanvasTexture(worldCanvas(1024, arena.radius, (g) => {
      g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineCap = 'round';
      const rr = (highOuter + lowInner) / 2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU, r = rr + (i % 2 ? 0.7 : -0.7);
        g.lineWidth = 0.1; g.globalAlpha = 0.8;
        g.beginPath(); g.arc(0, 0, r, a, a + 0.42); g.stroke();
        const aa = a + 0.42, ax = Math.cos(aa) * r, az = Math.sin(aa) * r, tx = -Math.sin(aa), tz = Math.cos(aa), nx = Math.cos(aa), nz = Math.sin(aa);
        g.beginPath(); g.moveTo(ax + tx * 0.4, az + tz * 0.4); g.lineTo(ax + nx * 0.24, az + nz * 0.24); g.lineTo(ax - nx * 0.24, az - nz * 0.24); g.closePath(); g.fill();
      }
    })));
    this.orbit = new THREE.Mesh(this.own(surfaceDisc(arena, highOuter, lowInner, 0.05, arena.radius, 8, 96)), this.own(additive(orbitTex, accent, 0.7)));
    this.orbit.renderOrder = 3;
    this.root.add(this.orbit);

    const inner = this.own(new THREE.CanvasTexture(worldCanvas(512, arena.radius, (g) => {
      g.strokeStyle = '#ffffff';
      for (let r = 1.2; r < highOuter - 0.2; r += 0.5) { g.lineWidth = 0.06; g.globalAlpha = 0.25 + 0.5 * (1 - r / highOuter); g.beginPath(); g.arc(r * 0.0, 0, r, 0.1, TAU - 0.5 - (r * 0.3) % 1); g.stroke(); }
    })));
    this.disc = new THREE.Mesh(this.own(surfaceDisc(arena, 0.9, highOuter, 0.05, arena.radius, 8, 64)), this.own(additive(inner, accent, 0.8)));
    this.disc.renderOrder = 3;
    this.root.add(this.disc);

    const y0 = arena.surfaceY(0, 0);
    const hole = new THREE.Mesh(this.own(new THREE.CircleGeometry(0.95, 40).rotateX(-Math.PI / 2)), this.own(new THREE.MeshBasicMaterial({ color: '#000000' })));
    hole.position.y = y0 + 0.06;
    this.accretion = new THREE.Mesh(this.own(new THREE.RingGeometry(0.95, 1.3, 48).rotateX(-Math.PI / 2)), this.own(hdr(accent, 2.6)));
    this.accretion.position.y = y0 + 0.07;
    this.root.add(hole, this.accretion);
    this.light.position.set(0, y0 + 1.4, 0);
    this.root.add(this.light);

    for (let i = 0; i < 3; i++) {
      const mat = this.own(additive(null, accent, 0));
      const mesh = ringMesh(arena, 1, 0.14, y0 + 0.08, mat);
      this.own(mesh.geometry); mesh.renderOrder = 3;
      this.root.add(mesh);
      this.waves.push({ mesh, mat, p: i / 3 });
    }
    if (GFX.tier !== 'low') {
      const n = 80, rnd = makeRng(33), pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, r = lowInner + 0.5 + rnd() * 3.4; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = rnd() * 5; pos[i * 3 + 2] = Math.sin(a) * r; }
      const geo = this.own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, this.own(new THREE.PointsMaterial({ size: 0.14, map: this.own(glowTex()), color: '#e4dcff', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })));
      this.motes = pts;
      this.root.add(pts);
    }
  }

  override update(m: Match, dt: number): void {
    this.time += dt;
    this.orbit.rotation.y -= dt * 0.42;                         // the way the blades are swept: increasing angle
    this.disc.rotation.y += dt * 0.15;
    this.accretion.rotation.y += dt * 1.8;
    this.light.intensity = 6 + 2 * Math.sin(this.time * 2.2);
    for (const w of this.waves) {
      w.p = (w.p + dt * 0.28) % 1;
      const r = lerp(GRAVITY_ZONES.highOuter, 1.1, w.p);
      w.mesh.scale.setScalar(r);
      w.mesh.position.y = this.arena.surfaceY(r, 0) + 0.08;
      w.mat.opacity = Math.sin(Math.PI * w.p) * 0.55;
    }
    if (this.motes) {
      const p = this.motes.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { let y = p.getY(i) + dt * (0.18 + (i % 4) * 0.05); if (y > 5.2) y = 0.2; p.setY(i, y); }
      p.needsUpdate = true;
    }
    void m;
  }
}

// ------------------------------------------------------------------------------------------------ Elevation Ring
class ElevationVisual extends Base {
  private readonly caps: THREE.MeshBasicMaterial[] = [];
  constructor(arena: Arena) {
    super(arena);
    const body = this.own(new THREE.MeshStandardMaterial({ color: '#2a2433', metalness: 0.85, roughness: 0.4 }));
    const bodyGeo = this.own(new THREE.CylinderGeometry(0.2, 0.26, 1.6, 10));
    const capGeo = this.own(new THREE.CylinderGeometry(0.28, 0.2, 0.3, 10));
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, x = Math.cos(a) * 10.9, z = Math.sin(a) * 10.9;
      const y = arena.surfaceY(x, z);
      const b = new THREE.Mesh(bodyGeo, body); b.position.set(x, y + 0.8, z); b.castShadow = GFX.shadows;
      const cm = this.own(hdr(arena.def.palette.accent, 2.6)); this.caps.push(cm);
      const c = new THREE.Mesh(capGeo, cm); c.position.set(x, y + 1.7, z);
      this.root.add(b, c);
    }
  }
  override update(m: Match, dt: number): void {
    this.time += dt;
    this.caps.forEach((c, i) => c.color.set(this.arena.def.palette.accent).multiplyScalar(2 + 0.6 * Math.sin(this.time * 2.4 + i)));
    void m;
  }
  override onEvent(e: ArenaEvent, c: HazardCtx): void {
    if (e.kind === 'drop') {
      const y = c.y(e.x, e.z);
      c.fx.ring(e.x, y, e.z, 0.4, 2.6, 0.4, this.arena.def.palette.accent, 0.9);
      c.fx.puff(e.x, y, e.z, 2.2);
      c.shake(0.18);
    }
  }
}

export function createHazardVisual(arena: Arena): HazardVisual | null {
  switch (arena.def.id) {
    case 'elevation-ring': return new ElevationVisual(arena);
    case 'magnetic-core': return new MagnetVisual(arena);
    case 'crystal-arena': return new CrystalVisual(arena);
    case 'shift-floor': return new ShiftVisual(arena);
    case 'wind-tunnel': return new WindVisual(arena);
    case 'lava-ring': return new LavaVisual(arena);
    case 'gravity-well': return new GravityVisual(arena);
    default: return null;
  }
}
