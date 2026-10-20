// Wear on the arena floor: bright scratches and a faint dark smudge left where blades hit and where they grind
// along the lip. A fixed pool of thin quads, fading out over half a minute, so a long fight leaves a trail of
// where it happened without ever costing more than the pool.

import * as THREE from 'three';
import { clamp } from '../core/types';

const POOL = 56;
const LIFE = 32;

let scratch: THREE.CanvasTexture | null = null;
function scratchTexture(): THREE.CanvasTexture {
  if (scratch) return scratch;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  // a dark smudge under the scratches
  const sm = g.createRadialGradient(128, 32, 4, 128, 32, 110);
  sm.addColorStop(0, 'rgba(0,0,0,0.38)'); sm.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.scale(1, 0.34); g.translate(0, 64 * (1 / 0.34 - 1) / 2); g.fillStyle = sm; g.fillRect(0, 0, 256, 64 / 0.34); g.restore();
  // bright scratches, thin and slightly off-parallel, fading at both ends
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  for (let i = 0; i < 7; i++) {
    const y0 = 20 + rnd() * 24, drift = (rnd() - 0.5) * 7, x0 = 18 + rnd() * 70, x1 = 150 + rnd() * 90;
    const grad = g.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, 'rgba(210,220,240,0)'); grad.addColorStop(0.3, `rgba(220,228,244,${0.45 + rnd() * 0.4})`); grad.addColorStop(0.8, 'rgba(210,220,240,0.35)'); grad.addColorStop(1, 'rgba(210,220,240,0)');
    g.strokeStyle = grad; g.lineWidth = 0.7 + rnd() * 1.3;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0 + drift); g.stroke();
  }
  scratch = new THREE.CanvasTexture(c);
  scratch.colorSpace = THREE.SRGBColorSpace;
  scratch.anisotropy = 4;
  return scratch;
}

interface Mark { mesh: THREE.Mesh; age: number }

export class Scuffs {
  readonly root = new THREE.Group();
  private readonly live: Mark[] = [];
  private readonly free: THREE.Mesh[] = [];

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: scratchTexture(), transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }));
      m.visible = false;
      m.renderOrder = 1;
      this.root.add(m);
      this.free.push(m);
    }
  }

  /** A scratch `len` long centred on (x, z), lying along direction (dx, dz), on a floor at height `y`. */
  add(x: number, y: number, z: number, dx: number, dz: number, len: number, strength = 1): void {
    const m = this.free.pop() ?? this.live.shift()?.mesh;
    if (!m) return;
    m.visible = true;
    m.position.set(x, y + 0.025, z);
    m.rotation.y = -Math.atan2(dz, dx);
    m.scale.set(len, 1, len * 0.28);
    (m.material as THREE.MeshBasicMaterial).opacity = clamp(0.5 + 0.4 * strength, 0, 0.95);
    m.userData.base = clamp(0.5 + 0.4 * strength, 0, 0.95);
    this.live.push({ mesh: m, age: 0 });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const k = this.live[i];
      k.age += dt;
      const f = k.age / LIFE;
      (k.mesh.material as THREE.MeshBasicMaterial).opacity = (k.mesh.userData.base as number) * (f < 0.55 ? 1 : clamp(1 - (f - 0.55) / 0.45, 0, 1));
      if (f >= 1) { k.mesh.visible = false; this.free.push(k.mesh); this.live.splice(i, 1); }
    }
  }

  clear(): void {
    for (const k of this.live) { k.mesh.visible = false; this.free.push(k.mesh); }
    this.live.length = 0;
  }

  dispose(): void {
    const geo = this.root.children[0] && (this.root.children[0] as THREE.Mesh).geometry;
    geo?.dispose();
    for (const c of this.root.children) (c as THREE.Mesh).material instanceof THREE.Material && ((c as THREE.Mesh).material as THREE.Material).dispose();
  }
}
