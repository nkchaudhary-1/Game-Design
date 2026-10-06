// Impact feedback, kept deliberately small and pooled: flat sparks that streak along the floor, expanding
// shock rings, and impact lines along the contact normal. Class-coloured (Attack: sparks and red/orange
// bursts; Defense: blue rings that absorb; Stamina: cool purple/cyan streaks). Under reduced motion the
// sparks are skipped and rings become a quick fade in place.

import * as THREE from 'three';
import { CLASS_COLORS, clamp, TAU, type BladeClass } from '../core/types';

const MAX_SPARKS = 140;
const MAX_RINGS = 14;

interface Spark { x: number; z: number; vx: number; vz: number; life: number; max: number; len: number; w: number; r: number; g: number; b: number }
interface Ring { mesh: THREE.Mesh; t: number; max: number; r0: number; r1: number }

export class ImpactFX {
  readonly root = new THREE.Group();
  private readonly sparks: Spark[] = [];
  private readonly inst: THREE.InstancedMesh;
  private readonly rings: Ring[] = [];
  private readonly free: THREE.Mesh[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  /** 1 = full; lowered automatically if frames run long. */
  level = 1;
  reduced = false;

  constructor() {
    this.inst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
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

  /** A collision: sparks along the contact tangent, a shock ring, and impact lines along the normal. */
  hit(x: number, y: number, z: number, nx: number, nz: number, strength: number, clsA: BladeClass, clsB: BladeClass): void {
    const ca = CLASS_COLORS[clsA].main, cb = CLASS_COLORS[clsB].main;
    this.ring(x, y, z, 0.3, 1.2 + 2.4 * strength, 0.28 + 0.14 * strength, '#ffffff', 0.85);
    if (clsA === 'DEFENSE' || clsB === 'DEFENSE') this.ring(x, y, z, 0.2, 1.4 + 2 * strength, 0.42, CLASS_COLORS.DEFENSE.light, 0.6);
    if (this.reduced) return;
    const n = Math.round((6 + 22 * strength) * this.level);
    const base = Math.atan2(nz, nx);
    for (let i = 0; i < n && this.sparks.length < MAX_SPARKS; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      // mostly along the tangent, plus a few along the normal ("impact lines")
      const along = Math.random() < 0.22;
      const ang = base + (along ? (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.3 : side * (Math.PI / 2 + (Math.random() - 0.5) * 1.1));
      const sp = 3 + Math.random() * (7 + 9 * strength);
      const life = 0.14 + Math.random() * 0.3;
      const c = Math.random() < 0.4 ? new THREE.Color('#fff4c4') : this.colorFor(Math.random() < 0.5 ? clsA : clsB, Math.random());
      void ca; void cb;
      this.sparks.push({ x, z, vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp, life, max: life, len: along ? 1.4 : 0.8 + Math.random() * 0.7, w: 0.07 + Math.random() * 0.06, r: c.r, g: c.g, b: c.b });
    }
  }

  burst(x: number, y: number, z: number, color: string, count: number, speed: number): void {
    if (this.reduced) return;
    const c = this.color.set(color);
    for (let i = 0; i < Math.round(count * this.level) && this.sparks.length < MAX_SPARKS; i++) {
      const a = Math.random() * TAU, sp = speed * (0.4 + Math.random() * 0.8), life = 0.2 + Math.random() * 0.35;
      this.sparks.push({ x, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, life, max: life, len: 0.9, w: 0.08, r: c.r, g: c.g, b: c.b });
    }
    void y;
  }

  update(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { this.sparks[i] = this.sparks[this.sparks.length - 1]; this.sparks.pop(); continue; }
      const k = Math.exp(-3.4 * dt);
      s.vx *= k; s.vz *= k; s.x += s.vx * dt; s.z += s.vz * dt;
    }
    this.inst.count = this.sparks.length;
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      const f = s.life / s.max;
      this.dummy.position.set(s.x, 0.25, s.z);
      this.dummy.rotation.set(0, -Math.atan2(s.vz, s.vx), 0);
      this.dummy.scale.set(s.len * (0.4 + f), 1, s.w);
      this.dummy.updateMatrix();
      this.inst.setMatrixAt(i, this.dummy.matrix);
      this.color.setRGB(s.r * f * 1.6, s.g * f * 1.6, s.b * f * 1.6);
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
  }

  clear(): void {
    this.sparks.length = 0;
    this.inst.count = 0;
    for (const r of this.rings) { r.mesh.visible = false; this.free.push(r.mesh); }
    this.rings.length = 0;
  }

  dispose(): void {
    this.inst.geometry.dispose();
    (this.inst.material as THREE.Material).dispose();
    for (const m of [...this.free, ...this.rings.map((r) => r.mesh)]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }
}
