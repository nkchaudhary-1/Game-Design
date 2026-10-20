// ArenaView v3: Core Pit as a realistic, high-poly diorama. A 2K PBR concrete stadium (carved grooves, plate seams,
// cracks, worn hazard paint, engraved emblem), a ring of bevelled stone rim slabs, a surround of displaced rocks and
// painted steel crates, glowing pylons, drifting dust, real shadows. Physics is flat: the dish is visual only.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { merge, ringSector } from '../blades/partGeometry';
import { makeRng } from '../core/Rng';
import { TAU } from '../core/types';
import { hdr } from '../render/materials';
import { brushedMetal, fbm, normalCanvas, tex } from '../render/procTex';
import { GFX } from '../render/quality';
import type { Arena } from './Arena';
import type { ArenaDef } from './arenaData';
import { crateCanvas, paintFloorMaps } from './arenaTextures';
import { floorMetal, paintArenaFloor } from './arenaFloors';
import { CRYSTAL_INFO, type CrystalKind } from './hazards';
import { createHazardVisual, type ArenaEvent, type HazardCtx, type HazardVisual } from './HazardView';
import type { Match } from '../combat/Match';

const RINGS = 24;
const SEGS = 96;
const SLATE = ['#262a3d', '#2f3348', '#383c54', '#222538', '#42475f'];
const ACCENTS: Array<{ color: string; mark: string }> = [
  { color: '#d92d3a', mark: '#fff1ee' }, { color: '#d92d3a', mark: '#fff1ee' }, { color: '#e3a336', mark: '#2a1d08' }, { color: '#2a63e8', mark: '#eaf1ff' },
];

/** Dressing round each pit: rock tones, crate paint, rim stone, pylon glow, the two accent lights, floating dust. */
interface Theme {
  rocks: string[]; crates: Array<{ color: string; mark: string }>; stone: string; stripe: [string, string]; cap: string;
  lights: [string, string]; dust: string; spires?: { color: string; glow: string; count: number; short?: boolean }; fans?: boolean;
}
const CORE_THEME: Theme = { rocks: SLATE, crates: ACCENTS, stone: '#4d5166', stripe: ['#e3a336', '#1c1405'], cap: '#9fd2ff', lights: ['#ff5a4a', '#4f86ff'], dust: '#b8c6e8' };
const THEMES: Record<string, Theme> = {
  'core-pit': CORE_THEME,
  'elevation-ring': {
    rocks: ['#4a3a3a', '#5a463e', '#6a5246', '#3a2e32', '#7a6050'], crates: [{ color: '#c9692c', mark: '#fff0e0' }, { color: '#e3a336', mark: '#2a1d08' }, { color: '#7a4a3a', mark: '#ffe9d6' }],
    stone: '#6a5a58', stripe: ['#ff8a3a', '#2a1406'], cap: '#ffb070', lights: ['#ff8a3a', '#6a8bff'], dust: '#e8cfb8',
  },
  'magnetic-core': {
    rocks: ['#26323f', '#2e3b4a', '#1f2a36', '#38485a', '#2a3a4c'], crates: [{ color: '#2f6fe0', mark: '#eaf3ff' }, { color: '#4a5a70', mark: '#e8f1ff' }, { color: '#d92d3a', mark: '#fff1ee' }],
    stone: '#46566a', stripe: ['#2f86ff', '#07162c'], cap: '#6ab8ff', lights: ['#2f86ff', '#8ad0ff'], dust: '#a8c8ee',
  },
  'crystal-arena': {
    rocks: ['#2a2145', '#33285a', '#3d2f6a', '#241c3c', '#4a3a7a'], crates: [{ color: '#6a3fd0', mark: '#f0e6ff' }, { color: '#1fb8d4', mark: '#06222a' }],
    stone: '#4e4272', stripe: ['#27e0ff', '#0b1c2a'], cap: '#9be8ff', lights: ['#27e0ff', '#b06bff'], dust: '#cdb8ff',
    spires: { color: '#6a4fd8', glow: '#27e0ff', count: 26 },
  },
  'shift-floor': {
    rocks: ['#1f2f35', '#27404a', '#182428', '#33505c', '#22363e'], crates: [{ color: '#238f80', mark: '#e6fffa' }, { color: '#3a4c56', mark: '#e3f6f2' }, { color: '#e3a336', mark: '#2a1d08' }],
    stone: '#3c5560', stripe: ['#38d6b8', '#031a16'], cap: '#6ff0d6', lights: ['#38d6b8', '#2f86ff'], dust: '#a8e6da',
  },
  'wind-tunnel': {
    rocks: ['#5a6e82', '#6a8096', '#4a5c70', '#7a90a6', '#3e4e60'], crates: [{ color: '#e8f2fa', mark: '#2a4560' }, { color: '#2a82c8', mark: '#e6f4ff' }, { color: '#d92d3a', mark: '#fff1ee' }],
    stone: '#7088a0', stripe: ['#6fe0ff', '#06202c'], cap: '#bff0ff', lights: ['#6fe0ff', '#ffffff'], dust: '#d8ecff', fans: true,
  },
  'lava-ring': {
    rocks: ['#1c1416', '#241a1c', '#2e2024', '#161012', '#3a2a2a'], crates: [{ color: '#3a2a2a', mark: '#ffb070' }, { color: '#8a2a16', mark: '#ffe3cf' }],
    stone: '#3a2c2e', stripe: ['#ff5a36', '#1a0806'], cap: '#ff9a50', lights: ['#ff5a36', '#ffb050'], dust: '#ffb48a',
    spires: { color: '#1e1517', glow: '#ff5a1a', count: 18, short: true },
  },
  'gravity-well': {
    rocks: ['#241f48', '#2e2860', '#1a1636', '#3a3278', '#2a2458'], crates: [{ color: '#6a3fd0', mark: '#f0e6ff' }, { color: '#2a2a5a', mark: '#c8c0ff' }],
    stone: '#463f78', stripe: ['#a05cff', '#120a26'], cap: '#c8a0ff', lights: ['#a05cff', '#4f86ff'], dust: '#d0c4ff',
  },
};

// ------------------------------------------------------------------------------------------ 3D noise for rocks
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
const fbm3 = (x: number, y: number, z: number): number => noise3(x, y, z) * 0.55 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.15;

function rockGeometry(seed: number): THREE.BufferGeometry {
  const rnd = makeRng(seed);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, [3, 5, 8][GFX.detail]);
  const sx = 1.0 + rnd() * 0.9, sy = 0.65 + rnd() * 0.9, sz = 1.0 + rnd() * 0.9, off = rnd() * 90;
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const base = fbm3(v.x * 1.5 + off, v.y * 1.5 + off, v.z * 1.5 + off);
    const ridge = 1 - Math.abs(2 * noise3(v.x * 3.2 + off * 2, v.y * 3.2, v.z * 3.2 + off) - 1);
    const r = 0.62 + 0.62 * base + 0.2 * ridge;
    p.setXYZ(i, v.x * r * sx, Math.max(-0.35, v.y * r * sy), v.z * r * sz);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const q = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(q.count * 2);
  for (let i = 0; i < q.count; i++) { uv[i * 2] = q.getX(i) * 0.5 + q.getZ(i) * 0.25; uv[i * 2 + 1] = q.getY(i) * 0.5 + q.getZ(i) * 0.25; }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export class ArenaView {
  readonly root = new THREE.Group();
  private readonly danger: THREE.Mesh[] = [];
  private readonly arena: Arena;
  private readonly def: ArenaDef;
  private readonly owned: Array<{ dispose(): void }> = [];
  private dust: THREE.Points | null = null;
  private time = 0;
  private rockNormal: THREE.CanvasTexture | null = null;
  private readonly theme: Theme;
  private readonly hz: HazardVisual | null;
  private readonly fans: THREE.Group[] = [];
  private readonly auras: THREE.Mesh[] = [];
  private auraTex: THREE.CanvasTexture | null = null;

  constructor(def: ArenaDef, arena: Arena) {
    this.def = def;
    this.arena = arena;
    this.theme = THEMES[def.id] ?? CORE_THEME;
    this.buildFloor();
    this.buildRim();
    this.buildSurround();
    this.buildSpires();
    this.buildFans();
    this.buildPylons();
    this.buildDust();
    this.buildDanger();
    this.buildGround();
    // coloured accent lights from the pit's edge: one colour each side
    const red = new THREE.PointLight(this.theme.lights[0], 28, 36, 2); red.position.set(-def.radius * 0.95, 3.2, -def.radius * 0.5);
    const blue = new THREE.PointLight(this.theme.lights[1], 28, 36, 2); blue.position.set(def.radius * 0.95, 3.2, def.radius * 0.45);
    this.root.add(red, blue);
    // the arena's own mechanic: animated parts drawn from the same hazard objects the simulation runs
    this.hz = createHazardVisual(arena);
    if (this.hz) this.root.add(this.hz.root);
  }

  /** Visual floor height at radius r (the dish). */
  dishY(r: number): number { return -this.arena.dishDepth(r); }

  private track<T extends { dispose(): void }>(o: T): T { this.owned.push(o); return o; }

  private shared(): THREE.CanvasTexture {
    if (!this.rockNormal) {
      const S = 512;
      const h = fbm(S, 17, 6, 6);
      this.rockNormal = this.track(tex(normalCanvas(h, S, 5), { repeat: 2 }));
    }
    return this.rockNormal;
  }

  private buildFloor(): void {
    const R = this.def.radius;
    const pos: number[] = [], uv: number[] = [];
    // the Elevation Ring's platforms and ramps are real geometry, so it gets a finer mesh
    const fine = this.def.id === 'elevation-ring';
    const rings = fine ? RINGS * 2 : RINGS, segs = fine ? SEGS * 2 : SEGS;
    const pt = (i: number, j: number): [number, number, number, number, number] => {
      const r = (R * i) / rings, a = (j * TAU) / segs;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      return [x, this.arena.surfaceY(x, z), z, x / (2 * R) + 0.5, 0.5 - z / (2 * R)];
    };
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = pt(i, j), b = pt(i, j + 1), d = pt(i + 1, j), e = pt(i + 1, j + 1);
        for (const v of [a, b, d, b, e, d]) { pos.push(v[0], v[1], v[2]); uv.push(v[3], v[4]); }
      }
    }
    const g = this.track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const spawns = [0, 1].map((s) => this.arena.spawn(s, 2));
    const maps = this.def.id === 'core-pit' ? paintFloorMaps(spawns, R) : paintArenaFloor(this.def, spawns);
    const mat = this.track(new THREE.MeshStandardMaterial({
      map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughnessMap: maps.roughnessMap, roughness: 1,
      metalness: floorMetal(this.def.id), envMapIntensity: this.def.id === 'core-pit' ? 0.25 : 0.45,
    }));
    const floor = new THREE.Mesh(g, mat);
    floor.receiveShadow = true;
    this.root.add(floor);
  }

  /** A ring of bevelled stone slabs round the pit; eight hazard-striped ones. */
  private buildRim(): void {
    const R = this.def.radius;
    const n = 64, step = TAU / n;
    const stone: THREE.BufferGeometry[] = [], yellow: THREE.BufferGeometry[] = [];
    for (let j = 0; j < n; j++) {
      const slab = ringSector(R + 0.02, R + 1.0, j * step + step * 0.02, (j + 1) * step - step * 0.02, 0.62, -0.42);
      (j % 8 === 3 ? yellow : stone).push(slab);
    }
    const nm = this.shared();
    const stoneMat = this.track(new THREE.MeshStandardMaterial({ color: this.theme.stone, roughness: 0.82, metalness: 0.05, normalMap: nm, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.5 }));
    const hz = document.createElement('canvas'); hz.width = hz.height = 128;
    const hg = hz.getContext('2d')!;
    hg.fillStyle = this.theme.stripe[0]; hg.fillRect(0, 0, 128, 128); hg.fillStyle = this.theme.stripe[1];
    for (let k = -4; k < 8; k++) { hg.beginPath(); hg.moveTo(k * 32, 0); hg.lineTo(k * 32 + 16, 0); hg.lineTo(k * 32 + 16 + 128, 128); hg.lineTo(k * 32 + 128, 128); hg.fill(); }
    const hazTex = this.track(tex(hz, { srgb: true, repeat: 1 }));
    const yellowMat = this.track(new THREE.MeshStandardMaterial({ map: hazTex, roughness: 0.6, metalness: 0.1, normalMap: nm, normalScale: new THREE.Vector2(0.5, 0.5) }));
    for (const [geos, mat] of [[stone, stoneMat], [yellow, yellowMat]] as const) {
      const m = merge(geos);
      if (!m) continue;
      this.track(m);
      const mesh = new THREE.Mesh(m, mat);
      mesh.castShadow = GFX.shadows; mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  /** Displaced rocks and painted crates in a ring round the pit; low on the camera's side. */
  private buildSurround(): void {
    const R = this.def.radius;
    const rnd = makeRng(11);
    const nm = this.shared();
    const bumpMetal = brushedMetal().bump;
    const rocks = new Map<number, THREE.BufferGeometry[]>();
    const N = GFX.rocks;
    for (let k = 0; k < N; k++) {
      const a = ((k + (rnd() - 0.5) * 0.8) / N) * TAU;
      const r = R + 3.6 + Math.pow(rnd(), 1.3) * 8.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const scale = 0.9 + rnd() * 1.5 + (r - R) * 0.1;
      const g = rockGeometry(100 + k * 7);
      const front = z > R * 0.2;
      g.scale(scale, front ? scale * 0.55 : scale * (0.9 + rnd() * 0.6), scale);
      g.rotateY(rnd() * TAU);
      g.translate(x, -0.55 + (front ? -0.2 : 0), z);
      const v = Math.floor(rnd() * this.theme.rocks.length);
      (rocks.get(v) ?? rocks.set(v, []).get(v)!).push(g);
    }
    for (const [v, geos] of rocks) {
      const m = merge(geos);
      if (!m) continue;
      this.track(m);
      const mat = this.track(new THREE.MeshStandardMaterial({ color: this.theme.rocks[v], roughness: 0.82, metalness: 0.08, normalMap: nm, normalScale: new THREE.Vector2(1.2, 1.2), envMapIntensity: 0.55 }));
      const mesh = new THREE.Mesh(m, mat);
      mesh.castShadow = GFX.shadows; mesh.receiveShadow = true;
      this.root.add(mesh);
    }

    // painted steel crates, grouped by colour so each colour is one draw call
    const byColour = new Map<string, THREE.BufferGeometry[]>();
    const crates = Math.round(10 + GFX.detail * 3);
    for (let k = 0; k < crates; k++) {
      const a = ((k + 0.5 + (rnd() - 0.5) * 0.5) / crates) * TAU;
      const r = R + 2.4 + rnd() * 4.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = 1.5 + rnd() * 1.2, d = 1.5 + rnd() * 1.2;
      const h = z > R * 0.2 ? 0.9 + rnd() * 0.5 : 1.3 + rnd() * 1.3;
      const spec = this.theme.crates[k % this.theme.crates.length];
      const geo = new RoundedBoxGeometry(w, h, d, [2, 3, 5][GFX.detail], 0.1);
      geo.rotateY(a + (rnd() - 0.5) * 0.5);
      geo.translate(x, h / 2 - 0.9, z);
      (byColour.get(spec.color + '|' + spec.mark) ?? byColour.set(spec.color + '|' + spec.mark, []).get(spec.color + '|' + spec.mark)!).push(geo);
    }
    for (const [key, geos] of byColour) {
      const [color, mark] = key.split('|');
      const m = merge(geos);
      if (!m) continue;
      this.track(m);
      const map = this.track(tex(crateCanvas(color, mark, null), { srgb: true }));
      const mat = this.track(new THREE.MeshPhysicalMaterial({ map, metalness: 0.3, roughness: 0.46, clearcoat: 0.3, clearcoatRoughness: 0.35, bumpMap: bumpMetal, bumpScale: 0.3, envMapIntensity: 0.8 }));
      const mesh = new THREE.Mesh(m, mat);
      mesh.castShadow = GFX.shadows; mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    // the big signage crate, front right, low enough not to block the view
    const sign = new THREE.Mesh(
      this.track(new RoundedBoxGeometry(3.8, 2.0, 2.6, 4, 0.12)),
      [0, 1, 2, 3, 4, 5].map((i) => this.track(new THREE.MeshPhysicalMaterial({
        map: this.track(tex(crateCanvas('#d92d3a', '#fff1ee', i === 4 ? 'SPIN' : null), { srgb: true })), metalness: 0.3, roughness: 0.45, clearcoat: 0.3, bumpMap: bumpMetal, bumpScale: 0.3,
      }))),
    );
    sign.position.set(R * 0.8 + 3.2, -0.1, R * 0.7 + 3.0);
    sign.rotation.y = -0.9;
    sign.castShadow = GFX.shadows; sign.receiveShadow = true;
    this.root.add(sign);
  }

  /** Crystal Arena's amethyst spires and the Lava Ring's basalt cones: faceted, tipped with glow. */
  private buildSpires(): void {
    const sp = this.theme.spires;
    if (!sp) return;
    const R = this.def.radius, rnd = makeRng(29);
    const body = this.track(new THREE.MeshStandardMaterial({ color: sp.color, roughness: sp.short ? 0.85 : 0.18, metalness: sp.short ? 0.1 : 0.2, flatShading: true, emissive: sp.glow, emissiveIntensity: sp.short ? 0.05 : 0.35, envMapIntensity: 0.8 }));
    const tip = this.track(hdr(sp.glow, sp.short ? 2.2 : 1.8));
    const n = Math.round(sp.count * (GFX.detail === 0 ? 0.6 : 1));
    for (let k = 0; k < n; k++) {
      const a = ((k + rnd() * 0.8) / n) * TAU, r = R + 2.6 + rnd() * 6.2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const front = z > R * 0.2;
      const h = (sp.short ? 1.4 : 2.2) + rnd() * (sp.short ? 1.8 : 3.6), w = 0.5 + rnd() * 0.7;
      const g = this.track(new THREE.ConeGeometry(w, front ? h * 0.55 : h, sp.short ? 7 : 6, 1));
      const m = new THREE.Mesh(g, body);
      const hh = front ? h * 0.55 : h;
      m.position.set(x, hh / 2 - 0.9, z); m.rotation.set((rnd() - 0.5) * 0.35, rnd() * TAU, (rnd() - 0.5) * 0.35);
      m.castShadow = GFX.shadows; m.receiveShadow = true;
      this.root.add(m);
      const t = new THREE.Mesh(this.track(new THREE.ConeGeometry(w * 0.3, hh * 0.22, sp.short ? 7 : 6, 1)), tip);
      t.position.set(x, hh - 0.9 - hh * 0.08, z); t.rotation.copy(m.rotation);
      this.root.add(t);
    }
  }

  /** Wind Tunnel: big turbines round the rim, turning towards the pit. */
  private buildFans(): void {
    if (!this.theme.fans) return;
    const R = this.def.radius;
    const frame = this.track(new THREE.MeshStandardMaterial({ color: '#3a4a5c', metalness: 0.85, roughness: 0.35 }));
    const blade = this.track(new THREE.MeshStandardMaterial({ color: '#c9dcee', metalness: 0.5, roughness: 0.4 }));
    const ringGeo = this.track(new THREE.TorusGeometry(1.9, 0.18, 10, 36));
    const bladeGeo = this.track(new THREE.BoxGeometry(0.34, 1.7, 0.08));
    const hubGeo = this.track(new THREE.CylinderGeometry(0.32, 0.32, 0.4, 14).rotateX(Math.PI / 2));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.52, r = R + 3.6;
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(ringGeo, frame));
      const rotor = new THREE.Group();
      for (let b = 0; b < 3; b++) { const m = new THREE.Mesh(bladeGeo, blade); m.position.y = 0.95; const holder = new THREE.Group(); holder.rotation.z = (b / 3) * TAU; holder.add(m); m.rotation.z = 0.35; rotor.add(holder); }
      rotor.add(new THREE.Mesh(hubGeo, frame));
      grp.add(rotor);
      grp.position.set(Math.cos(a) * r, 1.4, Math.sin(a) * r);
      grp.lookAt(0, 1.2, 0);
      grp.userData.rotor = rotor;
      this.root.add(grp);
      this.fans.push(grp);
    }
  }

  /** Slim steel pylons round the rim with glowing tops: they catch the bloom and light the rocks. */
  private buildPylons(): void {
    const R = this.def.radius;
    const bodyGeo = this.track(new THREE.CylinderGeometry(0.2, 0.26, 3.4, 10));
    const capGeo = this.track(new THREE.CylinderGeometry(0.28, 0.2, 0.34, 10));
    const body = this.track(new THREE.MeshStandardMaterial({ color: '#1a1e29', metalness: 0.85, roughness: 0.4 }));
    const cap = this.track(hdr(this.theme.cap, 2.6));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26, r = R + 2.6;
      const b = new THREE.Mesh(bodyGeo, body); b.position.set(Math.cos(a) * r, 0.75, Math.sin(a) * r); b.castShadow = GFX.shadows;
      const c = new THREE.Mesh(capGeo, cap); c.position.set(Math.cos(a) * r, 2.6, Math.sin(a) * r);
      this.root.add(b, c);
    }
  }

  /** Drifting dust motes in the light. */
  private buildDust(): void {
    if (GFX.dust <= 0) return;
    const R = this.def.radius, rnd = makeRng(3);
    const n = GFX.dust;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * (R + 4);
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 0.4 + rnd() * 8; pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = this.track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d')!; const grd = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 32, 32);
    const mat = this.track(new THREE.PointsMaterial({ size: 0.11, map: this.track(new THREE.CanvasTexture(c)), color: this.theme.dust, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.dust = new THREE.Points(g, mat);
    this.root.add(this.dust);
  }

  /** Dark ground far below so there is never a hole in the world, with a soft glow under the pit. */
  private buildGround(): void {
    const R = this.def.radius;
    const m = new THREE.Mesh(this.track(new THREE.CircleGeometry(R + 44, 48).rotateX(-Math.PI / 2)), this.track(new THREE.MeshBasicMaterial({ color: '#090d15' })));
    m.position.y = -4.2;
    this.root.add(m);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const grd = x.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, 'rgba(120,150,255,0.2)'); grd.addColorStop(0.5, 'rgba(70,90,200,0.07)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
    const halo = new THREE.Mesh(
      this.track(new THREE.CircleGeometry(R + 12, 40).rotateX(-Math.PI / 2)),
      this.track(new THREE.MeshBasicMaterial({ map: this.track(new THREE.CanvasTexture(c)), transparent: true, depthWrite: false })),
    );
    halo.position.y = -3.9;
    this.root.add(halo);
  }

  private buildDanger(): void {
    const R = this.def.radius;
    for (let j = 0; j < SEGS; j++) {
      const a0 = (j * TAU) / SEGS;
      const mat = this.track(new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      const m = new THREE.Mesh(this.track(new THREE.RingGeometry(R - 0.55, R + 0.04, 4, 1, a0, TAU / SEGS).rotateX(-Math.PI / 2)), mat);
      m.position.y = 0.05;
      this.root.add(m);
      this.danger.push(m);
    }
  }

  /** Per-frame: drift the dust, turn the fans, drive the arena's own animated parts. */
  tick(dt: number, match?: Match): void {
    this.time += dt;
    for (const f of this.fans) (f.userData.rotor as THREE.Group).rotation.z -= dt * 5.5;
    if (match && this.hz) this.hz.update(match, dt);
    if (match) this.updateAuras(match);
    if (!this.dust) return;
    const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + dt * (0.12 + (i % 5) * 0.03);
      if (y > 8.4) y = 0.4;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(this.time * 0.4 + i) * dt * 0.08);
    }
    p.needsUpdate = true;
  }

  /** Light the rim next to blades that are close to it. `blades` are world positions. */
  update(blades: Array<{ x: number; z: number }>): void {
    const R = this.def.radius;
    for (let j = 0; j < SEGS; j++) {
      const a = ((j + 0.5) * TAU) / SEGS;
      let best = 0;
      for (const b of blades) {
        const d = Math.hypot(b.x, b.z);
        const u = (d / R - 0.7) / 0.3;
        if (u <= 0) continue;
        let da = Math.abs(Math.atan2(b.z, b.x) - a);
        if (da > Math.PI) da = TAU - da;
        const k = Math.max(0, 1 - da / 0.5) * Math.min(1, u);
        if (k > best) best = k;
      }
      (this.danger[j].material as THREE.MeshBasicMaterial).opacity = best * 0.8;
    }
  }

  /** The arena did something (a magnet flipped, a crystal broke, a vent erupted): flash it. */
  onEvent(e: ArenaEvent, ctx: HazardCtx): void { this.hz?.onEvent(e, ctx); }

  /** A ring round any blade that is carrying an arena buff (crystal, drop attack). */
  private updateAuras(match: Match): void {
    if (!this.auraTex) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d')!; const grd = g.createRadialGradient(64, 64, 34, 64, 64, 62);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      this.auraTex = this.track(new THREE.CanvasTexture(c));
    }
    match.blades.forEach((b, i) => {
      let aura = this.auras[i];
      const buff = b.alive && !b.fallen ? b.mods.find((m) => m.source === 'arena' && m.kind) : undefined;
      if (!buff && !aura) return;
      if (!aura) {
        aura = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), this.track(new THREE.MeshBasicMaterial({ map: this.auraTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
        aura.renderOrder = 4; this.auras[i] = aura; this.root.add(aura);
      }
      aura.visible = !!buff;
      if (!buff) return;
      const info = CRYSTAL_INFO[buff.kind as CrystalKind];
      (aura.material as THREE.MeshBasicMaterial).color.set(info ? info.color : this.def.palette.accent).multiplyScalar(1.8);
      const pulse = 1 + 0.08 * Math.sin(this.time * 7 + i);
      aura.scale.setScalar(b.radius * 3.4 * pulse);
      aura.position.set(b.x, this.arena.surfaceY(b.x, b.z) + 0.08, b.z);
    });
  }

  dispose(): void { this.owned.forEach((o) => o.dispose()); this.hz?.dispose(); }
}
