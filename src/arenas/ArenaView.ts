// ArenaView v2: Core Pit as the reference diorama. A grey concrete stadium with painted ring grooves, plate
// seams, yellow hazard patches and the chevron emblem; a dark rim lip; and a ring of slate blocks and accent
// crates round the outside. The pit itself is one textured mesh (painted once on a canvas), the clutter is
// merged into a handful of draw calls. Physics is flat: the dish is visual only.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TAU } from '../core/types';
import { makeRng } from '../core/Rng';
import { drawEmblem } from '../render/emblem';
import { facet } from '../render/materials';
import type { Arena } from './Arena';
import type { ArenaDef } from './arenaData';

const RINGS = 16;
const SEGS = 64;
const SLATE = ['#262a3d', '#2f3348', '#383c54', '#222538', '#42475f'];
const ACCENTS: Array<{ color: string; mark: string }> = [
  { color: '#e0323d', mark: '#fff1ee' }, { color: '#e0323d', mark: '#fff1ee' }, { color: '#e8a93a', mark: '#2a1d08' }, { color: '#2f6bff', mark: '#eaf1ff' },
];

function paintFloor(): THREE.CanvasTexture {
  const S = 1024, C = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = makeRng(7);
  // base concrete, slightly lighter towards the middle
  const base = g.createRadialGradient(C, C, 40, C, C, C);
  base.addColorStop(0, '#8e909f'); base.addColorStop(0.7, '#7b7e8f'); base.addColorStop(1, '#62657a');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  // painterly blotches
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S, w = 8 + rnd() * 50, h = 6 + rnd() * 34;
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(10,12,30,0.06)';
    g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI); g.fillRect(-w / 2, -h / 2, w, h); g.restore();
  }
  const R = C * 0.97;
  // alternating plate tone between the grooves
  const bands = [0.22, 0.46, 0.7, 0.9];
  const sect = 24;
  for (let b = 0; b < bands.length; b++) {
    const r0 = b === 0 ? 0 : bands[b - 1], r1 = bands[b];
    for (let j = 0; j < sect; j++) {
      if ((j + b) % 2) continue;
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.beginPath(); g.arc(C, C, r1 * R, (j * TAU) / sect, ((j + 1) * TAU) / sect); g.arc(C, C, r0 * R, ((j + 1) * TAU) / sect, (j * TAU) / sect, true); g.fill();
    }
  }
  // grooves: dark line with a light edge
  bands.forEach((f, i) => {
    g.strokeStyle = 'rgba(30,33,52,0.65)'; g.lineWidth = i === 1 ? 9 : 6;
    g.beginPath(); g.arc(C, C, f * R, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
    g.beginPath(); g.arc(C, C, f * R + 6, 0, TAU); g.stroke();
  });
  // radial seams on the outer bands
  g.strokeStyle = 'rgba(30,33,52,0.5)'; g.lineWidth = 3;
  for (let j = 0; j < sect; j++) {
    const a = (j * TAU) / sect;
    for (const [r0, r1] of [[0.46, 0.7], [0.7, 0.9], [0.9, 0.97]]) {
      g.beginPath(); g.moveTo(C + Math.cos(a) * r0 * R, C + Math.sin(a) * r0 * R); g.lineTo(C + Math.cos(a) * r1 * R, C + Math.sin(a) * r1 * R); g.stroke();
    }
  }
  // hazard patches on the outer band
  const hz = '#f2b33d';
  for (const deg of [-52, 38, 128, 218]) {
    const a0 = ((deg - 9) * Math.PI) / 180, a1 = ((deg + 9) * Math.PI) / 180;
    g.fillStyle = hz;
    g.beginPath(); g.arc(C, C, 0.965 * R, a0, a1); g.arc(C, C, 0.9 * R, a1, a0, true); g.closePath(); g.fill();
    g.save(); g.clip(); g.strokeStyle = 'rgba(40,28,6,0.55)'; g.lineWidth = 5;
    for (let k = -20; k < 20; k++) { g.beginPath(); g.moveTo(C + k * 12, C - R); g.lineTo(C + k * 12 + 60, C + R); g.stroke(); }
    g.restore();
  }
  // centre: emblem in a ring, as a faint stencil
  g.strokeStyle = 'rgba(30,33,52,0.35)'; g.lineWidth = 8;
  g.beginPath(); g.arc(C, C, 0.19 * R, 0, TAU); g.stroke();
  g.globalAlpha = 0.2;
  drawEmblem(g, S, '#262a45', 0.27);
  g.globalAlpha = 1;
  // scuffs
  for (let i = 0; i < 160; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * R, x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
    g.fillStyle = 'rgba(25,27,44,0.28)'; g.fillRect(x, y, 2 + rnd() * 9, 1 + rnd() * 2);
  }
  // darken the very edge so the rim lip reads
  const edge = g.createRadialGradient(C, C, R * 0.9, C, C, C);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(8,10,24,0.55)');
  g.fillStyle = edge; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function crateTexture(color: string, mark: string, text: string | null): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = color; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, 256, 18);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 238, 256, 18);
  if (text) {
    g.fillStyle = mark; g.font = '800 86px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 132);
  } else drawEmblem(g, 256, mark, 0.5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ArenaView {
  readonly root = new THREE.Group();
  private readonly danger: THREE.Mesh[] = [];
  private readonly arena: Arena;
  private readonly def: ArenaDef;
  private readonly owned: Array<{ dispose(): void }> = [];

  constructor(def: ArenaDef, arena: Arena) {
    this.def = def;
    this.arena = arena;
    this.buildFloor();
    this.buildRim();
    this.buildSurround();
    this.buildPads();
    this.buildDanger();
    this.buildGround();
  }

  /** Visual floor height at radius r (the dish). */
  dishY(r: number): number { return -this.arena.dishDepth(r); }

  private track<T extends { dispose(): void }>(o: T): T { this.owned.push(o); return o; }

  private buildFloor(): void {
    const R = this.def.radius;
    const pos: number[] = [], uv: number[] = [];
    const pt = (i: number, j: number): [number, number, number, number, number] => {
      const r = (R * i) / RINGS, a = (j * TAU) / SEGS;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      return [x, this.dishY(r), z, x / (2 * R) + 0.5, 0.5 - z / (2 * R)];
    };
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = pt(i, j), b = pt(i, j + 1), d = pt(i + 1, j), e = pt(i + 1, j + 1);
        for (const v of [a, b, d, b, e, d]) { pos.push(v[0], v[1], v[2]); uv.push(v[3], v[4]); }
      }
    }
    const g = this.track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const tex = this.track(paintFloor());
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, color: 0xb9bccb, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.35 }));
    this.root.add(new THREE.Mesh(g, mat));
  }

  /** Dark concrete lip round the pit, with a few yellow inserts. */
  private buildRim(): void {
    const R = this.def.radius;
    const n = 48;
    const blockW = ((TAU * R) / n) * 0.92;
    const geo = this.track(new THREE.BoxGeometry(blockW, 0.46, 0.9));
    const dark = this.track(facet('#3d4158', { metal: 0.1, rough: 0.8 }));
    const gold = this.track(facet('#e8a93a', { metal: 0.1, rough: 0.7 }));
    for (let j = 0; j < n; j++) {
      const a = (j * TAU) / n + TAU / n / 2;
      const m = new THREE.Mesh(geo, j % 6 === 3 ? gold : dark);
      m.position.set(Math.cos(a) * (R + 0.5), 0.0, Math.sin(a) * (R + 0.5));
      m.rotation.y = -a + Math.PI / 2;
      this.root.add(m);
    }
  }

  /** The ring of slate blocks and accent crates: merged per colour so it stays a few draw calls. */
  private buildSurround(): void {
    const R = this.def.radius;
    const rnd = makeRng(11);
    const groups = new Map<string, THREE.BufferGeometry[]>();
    const push = (key: string, g: THREE.BufferGeometry) => { (groups.get(key) ?? groups.set(key, []).get(key)!).push(g); };
    const decals: THREE.Mesh[] = [];
    const N = 78;
    for (let k = 0; k < N; k++) {
      const a = ((k + (rnd() - 0.5) * 0.7) / N) * TAU;
      const r = R + 1.7 + Math.pow(rnd(), 1.4) * 8.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = 1.5 + rnd() * 2.4, d = 1.5 + rnd() * 2.4;
      let h = 1.1 + rnd() * 3.2 + (r - R) * 0.32;
      // nothing tall between the camera (south, +z) and the pit
      if (z > R * 0.2) h = Math.min(h, 0.7 + rnd() * 0.7);
      const accent = rnd() < 0.2 && r < R + 6.5;
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.rotateY(rnd() * Math.PI);
      geo.translate(x, h / 2 - 1.1, z);
      if (accent) {
        const spec = ACCENTS[Math.floor(rnd() * ACCENTS.length)];
        push(spec.color, geo);
        // emblem decal on the face that looks towards the pit
        const dec = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, d) * 0.62, Math.min(w, d) * 0.62), new THREE.MeshBasicMaterial({ map: this.track(crateTexture(spec.color, spec.mark, null)), toneMapped: true }));
        dec.position.set(x - Math.cos(a) * (Math.min(w, d) * 0.5 + 0.02), Math.min(h, 1.6) * 0.55 + (h > 1.6 ? 0 : 0) - 1.1 + Math.min(h, 1.6) * 0.2, z - Math.sin(a) * (Math.min(w, d) * 0.5 + 0.02));
        dec.lookAt(0, dec.position.y + 2, 0);
        decals.push(dec);
        this.track(dec.geometry); this.track(dec.material as THREE.Material);
      } else {
        push(SLATE[Math.floor(rnd() * SLATE.length)], geo);
      }
    }
    // the big signage crate, front right, low enough not to block the view
    const sx = R * 0.78, sz = R * 0.7;
    const sign = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(3.6, 1.9, 2.6)),
      [0, 1, 2, 3, 4, 5].map((i) => (i === 4 ? this.track(new THREE.MeshStandardMaterial({ map: this.track(crateTexture('#e0323d', '#fff1ee', 'SPIN')), roughness: 0.6, metalness: 0.1 })) : this.track(facet('#e0323d', { metal: 0.1, rough: 0.6 })))),
    );
    sign.position.set(sx + 3.4, -0.2, sz + 3.2);
    sign.rotation.y = -0.9;
    this.root.add(sign);

    for (const [key, geos] of groups) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      this.track(merged);
      const mat = this.track(facet(key, { metal: 0.12, rough: 0.72 }));
      this.root.add(new THREE.Mesh(merged, mat));
    }
    decals.forEach((d) => this.root.add(d));
  }

  /** Dark ground far below so there is never a hole in the world, with a soft glow under the pit. */
  private buildGround(): void {
    const R = this.def.radius;
    const g = this.track(new THREE.CircleGeometry(R + 40, 40).rotateX(-Math.PI / 2));
    const m = new THREE.Mesh(g, this.track(new THREE.MeshBasicMaterial({ color: '#0a0e16' })));
    m.position.y = -4.2;
    this.root.add(m);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const grd = x.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, 'rgba(120,150,255,0.22)'); grd.addColorStop(0.5, 'rgba(70,90,200,0.08)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
    const halo = new THREE.Mesh(
      this.track(new THREE.CircleGeometry(R + 12, 40).rotateX(-Math.PI / 2)),
      this.track(new THREE.MeshBasicMaterial({ map: this.track(new THREE.CanvasTexture(c)), transparent: true, depthWrite: false })),
    );
    halo.position.y = -3.9;
    this.root.add(halo);
  }

  /** Dashed launch pads at the spawn points. */
  private buildPads(): void {
    const mat = this.track(new THREE.MeshBasicMaterial({ color: '#f4f1ea', transparent: true, opacity: 0.55, depthWrite: false }));
    for (let s = 0; s < 2; s++) {
      const p = this.arena.spawn(s, 2);
      for (let k = 0; k < 10; k++) {
        const arc = new THREE.Mesh(this.track(new THREE.RingGeometry(1.95, 2.07, 6, 1, (k * TAU) / 10, (TAU / 10) * 0.55).rotateX(-Math.PI / 2)), mat);
        arc.position.set(p.x, this.dishY(Math.hypot(p.x, p.z)) + 0.03, p.z);
        this.root.add(arc);
      }
    }
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

  dispose(): void { this.owned.forEach((o) => o.dispose()); }
}
