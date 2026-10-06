// Ribbon trails behind blades (afterimages for Stamina, speed streaks for dashes). One dynamic mesh per
// blade, additive and fading to nothing, so it costs almost nothing and never hides the blade.

import * as THREE from 'three';

const POINTS = 22;

export class Trail {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly hist: Array<{ x: number; y: number; z: number }> = [];
  private acc = 0;
  private readonly rgb = new THREE.Color();

  constructor(color: string, private width: number) {
    this.rgb.set(color);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(POINTS * 2 * 3);
    this.col = new Float32Array(POINTS * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < POINTS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  setColor(color: string): void { this.rgb.set(color); }

  /** `intensity` 0–1 scales brightness (0 hides it); sampled at ~60 Hz regardless of frame rate. */
  update(dt: number, x: number, y: number, z: number, intensity: number): void {
    this.acc += dt;
    if (this.acc >= 1 / 60 || this.hist.length === 0) {
      this.acc = 0;
      this.hist.unshift({ x, y, z });
      if (this.hist.length > POINTS) this.hist.pop();
    } else {
      this.hist[0] = { x, y, z };
    }
    const n = this.hist.length;
    for (let i = 0; i < POINTS; i++) {
      const h = this.hist[Math.min(i, n - 1)];
      const f = i < n ? 1 - i / POINTS : 0;
      const p = this.hist[Math.min(i + 1, n - 1)];
      let dx = h.x - p.x, dz = h.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const w = this.width * f;
      // perpendicular on the floor plane
      const px = -dz * w, pz = dx * w;
      this.pos.set([h.x + px, h.y, h.z + pz, h.x - px, h.y, h.z - pz], i * 6);
      const k = intensity * f * f;
      this.col.set([this.rgb.r * k, this.rgb.g * k, this.rgb.b * k, this.rgb.r * k, this.rgb.g * k, this.rgb.b * k], i * 6);
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  reset(): void { this.hist.length = 0; }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
