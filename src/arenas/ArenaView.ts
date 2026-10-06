// ArenaView: Core Pit as low-poly geometry. Simple circular structure, one mechanic (the pit), strong
// identity: concentric ring segments, a central emblem, a bright rim you can read in two seconds, and a
// danger glow on the rim next to any blade that is close to going out.

import * as THREE from 'three';
import { TAU } from '../core/types';
import { glow, toon } from '../render/materials';
import type { Arena } from './Arena';
import type { ArenaDef } from './arenaData';

const RINGS = 14;
const SEGS = 48;

export class ArenaView {
  readonly root = new THREE.Group();
  private readonly danger: THREE.Mesh[] = [];
  private readonly arena: Arena;
  private readonly def: ArenaDef;

  constructor(def: ArenaDef, arena: Arena) {
    this.def = def;
    this.arena = arena;
    this.buildFloor();
    this.buildRim();
    this.buildEmblem();
    this.buildPads();
    this.buildDanger();
    this.buildVoid();
  }

  /** Visual floor height at radius r (the dish). */
  dishY(r: number): number { return -this.arena.dishDepth(r); }

  private buildFloor(): void {
    const R = this.def.radius;
    const base = new THREE.Color(this.def.palette.floor);
    const alt = new THREE.Color(this.def.palette.segment);
    const warm = new THREE.Color('#ff7a4a');
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const pt = (i: number, j: number): [number, number, number] => {
      const r = (R * i) / RINGS;
      const a = (j * TAU) / SEGS;
      return [Math.cos(a) * r, this.dishY(r), Math.sin(a) * r];
    };
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const sector = Math.floor(j / 4) % 2;
        const band = Math.floor((i * 3) / RINGS);
        c.copy(sector ? alt : base);
        c.multiplyScalar(0.88 + band * 0.1 + ((i + j) % 2) * 0.025);
        if (i === 4 || i === 9) c.multiplyScalar(0.72);          // ring grooves
        if (i >= RINGS - 2) c.lerp(warm, i === RINGS - 1 ? 0.22 : 0.1); // edge zone reads as "danger"
        const a = pt(i, j), b = pt(i, j + 1), d = pt(i + 1, j), e = pt(i + 1, j + 1);
        for (const v of [a, d, b, b, d, e]) { pos.push(...v); col.push(c.r, c.g, c.b); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon('#fff').gradientMap });
    const floor = new THREE.Mesh(g, mat);
    this.root.add(floor);
  }

  private buildRim(): void {
    const R = this.def.radius;
    const blockW = ((TAU * R) / SEGS) * 0.84;
    const geo = new THREE.BoxGeometry(blockW, 0.34, 0.8);
    const lightMat = toon(this.def.palette.rim);
    const darkMat = toon(new THREE.Color(this.def.palette.rim).multiplyScalar(0.8).getStyle());
    for (let j = 0; j < SEGS; j++) {
      const a = (j * TAU) / SEGS + TAU / SEGS / 2;
      const m = new THREE.Mesh(geo, j % 2 ? lightMat : darkMat);
      m.position.set(Math.cos(a) * (R + 0.45), 0.1, Math.sin(a) * (R + 0.45));
      m.rotation.y = -a + Math.PI / 2;
      this.root.add(m);
    }
    // outer skirt: the arena is a floating slab
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.85, R + 0.55, 2.4, SEGS, 1, true),
      toon('#10162b'),
    );
    skirt.position.y = -1.15;
    this.root.add(skirt);
    const under = new THREE.Mesh(new THREE.CircleGeometry(R + 0.55, SEGS).rotateX(Math.PI / 2), toon('#0a0f20'));
    under.position.y = -2.35;
    this.root.add(under);
  }

  private buildEmblem(): void {
    const accent = this.def.palette.accent;
    const star = new THREE.Shape();
    const n = 6;
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n;
      const r = i % 2 === 0 ? 1.7 : 0.85;
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    star.closePath();
    const g = new THREE.ExtrudeGeometry(star, { depth: 0.04, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, glow(accent, 0.9));
    m.position.y = this.dishY(0) + 0.03;
    this.root.add(m);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.45, 36).rotateX(-Math.PI / 2), glow(accent, 0.55));
    ring.position.y = this.dishY(2.4) + 0.03;
    this.root.add(ring);
    for (const f of [0.34, 0.67]) {
      const r = this.def.radius * f;
      const line = new THREE.Mesh(new THREE.RingGeometry(r - 0.04, r + 0.04, 64).rotateX(-Math.PI / 2), glow('#9db3ff', 0.22));
      line.position.y = this.dishY(r) + 0.025;
      this.root.add(line);
    }
  }

  /** Dashed launch pads at the spawn points. */
  private buildPads(): void {
    for (let s = 0; s < 2; s++) {
      const p = this.arena.spawn(s, 2);
      for (let k = 0; k < 10; k++) {
        const arc = new THREE.Mesh(
          new THREE.RingGeometry(1.95, 2.07, 6, 1, (k * TAU) / 10, (TAU / 10) * 0.55).rotateX(-Math.PI / 2),
          glow('#cfe0ff', 0.4),
        );
        arc.position.set(p.x, this.dishY(Math.hypot(p.x, p.z)) + 0.03, p.z);
        this.root.add(arc);
      }
    }
  }

  private buildDanger(): void {
    const R = this.def.radius;
    for (let j = 0; j < SEGS; j++) {
      const a0 = (j * TAU) / SEGS;
      const mat = new THREE.MeshBasicMaterial({ color: '#ff4d2e', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.RingGeometry(R - 0.5, R + 0.04, 4, 1, a0, TAU / SEGS).rotateX(-Math.PI / 2), mat);
      m.position.y = 0.045;
      this.root.add(m);
      this.danger.push(m);
    }
  }

  private buildVoid(): void {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    r.addColorStop(0, 'rgba(120,150,255,0.30)');
    r.addColorStop(0.45, 'rgba(70,90,200,0.10)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(30, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    halo.position.y = -3;
    this.root.add(halo);
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
        const k = Math.max(0, 1 - da / 0.55) * Math.min(1, u);
        if (k > best) best = k;
      }
      (this.danger[j].material as THREE.MeshBasicMaterial).opacity = best * 0.85;
    }
  }

  dispose(): void {
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); } });
  }
}
