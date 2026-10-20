// Impact feedback, pooled: hot metal sparks (real 3D streaks that fly up, fall, bounce on the floor and cool from
// white-hot through orange to dull red), grinding sparks for sustained contact, shock rings, and dust puffs.
// Class colour tints the sparks a little; the heat does the rest. Under reduced motion the sparks and puffs are
// skipped and rings become a quick fade in place.

import * as THREE from 'three';
import { CLASS_COLORS, clamp, TAU, type BladeClass } from '../core/types';

const MAX_SPARKS = 220;
const MAX_RINGS = 14;
const MAX_PUFFS = 12;
const GRAVITY = 24;

interface Spark {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; len: number; w: number; r: number; g: number; b: number; bounced: number;
}
interface Ring { mesh: THREE.Mesh; t: number; max: number; r0: number; r1: number }
interface Puff { mesh: THREE.Mesh; t: number; max: number; size: number; vx: number; vz: number }

let puffTexture: THREE.CanvasTexture | null = null;
function softDisc(): THREE.CanvasTexture {
  if (puffTexture) return puffTexture;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  puffTexture = new THREE.CanvasTexture(c);
  puffTexture.colorSpace = THREE.SRGBColorSpace;
  return puffTexture;
}

/** White-hot → orange → dull red as a spark cools. `f` is 1 when new, 0 when spent. */
export function heatColor(f: number, out: { r: number; g: number; b: number }): void {
  const k = clamp(f, 0, 1);
  if (k > 0.6) { const t = (k - 0.6) / 0.4; out.r = 1; out.g = 0.6 + 0.37 * t; out.b = 0.2 + 0.62 * t; }
  else if (k > 0.25) { const t = (k - 0.25) / 0.35; out.r = 0.78 + 0.22 * t; out.g = 0.16 + 0.44 * t; out.b = 0.04 + 0.16 * t; }
  else { const t = k / 0.25; out.r = 0.78 * t + 0.12; out.g = 0.16 * t; out.b = 0.04 * t; }
}

export class ImpactFX {
  readonly root = new THREE.Group();
  private readonly sparks: Spark[] = [];
  private readonly inst: THREE.InstancedMesh;
  private readonly rings: Ring[] = [];
  private readonly free: THREE.Mesh[] = [];
  private readonly puffs: Puff[] = [];
  private readonly freePuffs: THREE.Mesh[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly heat = { r: 1, g: 1, b: 1 };
  /** 1 = full; lowered automatically if frames run long. */
  level = 1;
  reduced = false;
  /** Height of the floor at (x, z): the dish is visual, so the renderer supplies it. */
  ground: (x: number, z: number) => number = () => 0;

  constructor() {
    this.inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      MAX_SPARKS,
    );
    this.inst.frustumCulled = false;
    this.inst.count = 0;
    this.inst.renderOrder = 5;
    this.root.add(this.inst);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.visible = false;
      m.renderOrder = 4;
      this.root.add(m);
      this.free.push(m);
    }
    for (let i = 0; i < MAX_PUFFS; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: softDisc(), color: '#b8b2a6', transparent: true, depthWrite: false, opacity: 0 }),
      );
      m.visible = false;
      m.renderOrder = 2;
      this.root.add(m);
      this.freePuffs.push(m);
    }
  }

  private colorFor(cls: BladeClass, k: number): THREE.Color {
    const c = CLASS_COLORS[cls];
    return new THREE.Color(k < 0.5 ? c.main : c.light);
  }

  ring(x: number, y: number, z: number, r0: number, r1: number, life: number, color: string | THREE.Color, opacity = 0.9): void {
    const m = this.free.pop() ?? this.rings.shift()?.mesh;
    if (!m) return;
    m.visible = true;
    m.position.set(x, y + 0.06, z);
    (m.material as THREE.MeshBasicMaterial).color.set(color);
    (m.material as THREE.MeshBasicMaterial).opacity = opacity;
    m.userData.opacity = opacity;
    const rr0 = this.reduced ? r1 * 0.8 : r0;
    m.scale.setScalar(Math.max(0.01, rr0));
    this.rings.push({ mesh: m, t: 0, max: this.reduced ? Math.min(life, 0.3) : life, r0: rr0, r1 });
  }

  private emit(x: number, y: number, z: number, ang: number, speed: number, up: number, life: number, len: number, w: number, tint: THREE.Color): void {
    if (this.sparks.length >= MAX_SPARKS) return;
    this.sparks.push({
      x, y, z, vx: Math.cos(ang) * speed, vy: up, vz: Math.sin(ang) * speed, life, max: life, len, w,
      r: tint.r, g: tint.g, b: tint.b, bounced: 0,
    });
  }

  /** A collision: a fan of hot sparks mostly along the contact tangent, a shock ring, and a puff of floor dust. */
  hit(x: number, y: number, z: number, nx: number, nz: number, strength: number, clsA: BladeClass, clsB: BladeClass): void {
    this.ring(x, y, z, 0.3, 1.2 + 2.4 * strength, 0.28 + 0.14 * strength, '#ffffff', 0.5);
    if (clsA === 'DEFENSE' || clsB === 'DEFENSE') this.ring(x, y, z, 0.2, 1.4 + 2 * strength, 0.42, CLASS_COLORS.DEFENSE.light, 0.6);
    if (this.reduced) return;
    const n = Math.round((8 + 30 * strength) * this.level);
    const base = Math.atan2(nz, nx);
    const gy = Math.max(y, this.ground(x, z)) + 0.28;
    for (let i = 0; i < n; i++) {
      const along = Math.random() < 0.18;
      const side = Math.random() < 0.5 ? -1 : 1;
      const ang = base + (along ? (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.4 : side * (Math.PI / 2 + (Math.random() - 0.5) * 1.3));
      const sp = 2.5 + Math.random() * (6 + 9 * strength);
      const tint = this.colorFor(Math.random() < 0.5 ? clsA : clsB, Math.random());
      this.emit(x + (Math.random() - 0.5) * 0.5, gy + Math.random() * 0.15, z + (Math.random() - 0.5) * 0.5, ang, sp, 1.5 + Math.random() * (4 + 5 * strength), 0.35 + Math.random() * 0.55, 0.9 + Math.random() * 1.2 + strength * 0.8, 0.07 + Math.random() * 0.07, tint);
    }
    if (strength > 0.35) this.puff(x, this.ground(x, z), z, 1.4 + 1.8 * strength, nx * 0.6, nz * 0.6);
  }

  /** Sustained grinding: a few sparks thrown off along the contact tangent. Call each frame with a rate. */
  grind(x: number, y: number, z: number, tx: number, tz: number, level: number, tint: BladeClass): void {
    if (this.reduced) return;
    const base = Math.atan2(tz, tx), gy = Math.max(y, this.ground(x, z)) + 0.22;
    const c = this.colorFor(tint, Math.random());
    const dir = Math.random() < 0.5 ? 0 : Math.PI;
    this.emit(x, gy, z, base + dir + (Math.random() - 0.5) * 0.9, 2.5 + Math.random() * (3 + 4 * level), 0.8 + Math.random() * 2.2, 0.22 + Math.random() * 0.3, 0.6 + Math.random() * 0.6, 0.06, c);
  }

  /** A soft puff of floor dust that swells and fades. */
  puff(x: number, y: number, z: number, size: number, vx = 0, vz = 0): void {
    if (this.reduced) return;
    const m = this.freePuffs.pop() ?? this.puffs.shift()?.mesh;
    if (!m) return;
    m.visible = true;
    m.position.set(x, y + 0.08, z);
    m.scale.setScalar(size * 0.4);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.34;
    this.puffs.push({ mesh: m, t: 0, max: 0.75, size, vx, vz });
  }

  burst(x: number, y: number, z: number, color: string, count: number, speed: number): void {
    if (this.reduced) return;
    const c = new THREE.Color(color);
    const gy = Math.max(y, this.ground(x, z)) + 0.3;
    for (let i = 0; i < Math.round(count * this.level); i++) {
      const a = Math.random() * TAU, sp = speed * (0.4 + Math.random() * 0.8);
      this.emit(x, gy, z, a, sp, 2 + Math.random() * 5, 0.3 + Math.random() * 0.5, 0.9 + Math.random() * 0.6, 0.08, c);
    }
  }

  update(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { this.sparks[i] = this.sparks[this.sparks.length - 1]; this.sparks.pop(); continue; }
      const drag = Math.exp(-1.5 * dt);
      s.vx *= drag; s.vz *= drag;
      s.vy -= GRAVITY * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const floor = this.ground(s.x, s.z) + 0.04;
      if (s.y < floor) {
        // skitters across the floor: loses most of its bounce and some speed each time, dies after a few
        s.y = floor;
        s.vy = Math.abs(s.vy) * 0.38; s.vx *= 0.7; s.vz *= 0.7;
        if (++s.bounced > 3) s.life = Math.min(s.life, 0.06);
      }
    }
    this.inst.count = this.sparks.length;
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      const f = s.life / s.max;
      this.dummy.position.set(s.x, s.y, s.z);
      this.dummy.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
      const speed = Math.hypot(s.vx, s.vy, s.vz);
      // a streak: longer the faster it moves, thinning as it cools
      this.dummy.scale.set(s.w * (0.5 + f), s.w * (0.5 + f), Math.max(0.08, s.len * clamp(speed / 9, 0.25, 1.3) * (0.35 + 0.65 * f)));
      this.dummy.updateMatrix();
      this.inst.setMatrixAt(i, this.dummy.matrix);
      heatColor(f, this.heat);
      const k = 1.25 * Math.pow(f, 0.6);
      this.color.setRGB((this.heat.r * 0.8 + s.r * 0.2) * k, (this.heat.g * 0.8 + s.g * 0.2) * k, (this.heat.b * 0.8 + s.b * 0.2) * k);
      this.inst.setColorAt(i, this.color);
    }
    this.inst.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const f = clamp(r.t / r.max, 0, 1);
      const e = 1 - (1 - f) * (1 - f);
      r.mesh.scale.setScalar(Math.max(0.01, r.r0 + (r.r1 - r.r0) * e));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (r.mesh.userData.opacity as number) * (1 - f);
      if (r.t >= r.max) { r.mesh.visible = false; this.free.push(r.mesh); this.rings.splice(i, 1); }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      const f = clamp(p.t / p.max, 0, 1);
      p.mesh.position.x += p.vx * dt * (1 - f); p.mesh.position.z += p.vz * dt * (1 - f);
      p.mesh.scale.setScalar(p.size * (0.4 + 0.6 * (1 - (1 - f) * (1 - f))));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.34 * (1 - f) * (1 - f);
      if (p.t >= p.max) { p.mesh.visible = false; this.freePuffs.push(p.mesh); this.puffs.splice(i, 1); }
    }
  }

  clear(): void {
    this.sparks.length = 0;
    this.inst.count = 0;
    for (const r of this.rings) { r.mesh.visible = false; this.free.push(r.mesh); }
    this.rings.length = 0;
    for (const p of this.puffs) { p.mesh.visible = false; this.freePuffs.push(p.mesh); }
    this.puffs.length = 0;
  }

  dispose(): void {
    this.inst.geometry.dispose();
    (this.inst.material as THREE.Material).dispose();
    for (const m of [...this.free, ...this.rings.map((r) => r.mesh), ...this.freePuffs, ...this.puffs.map((p) => p.mesh)]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }
}
