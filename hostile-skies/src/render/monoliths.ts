// Rock spires on the skyline for the alien look: tall, stepped, leaning columns in loose clusters out past the edge of
// the combat area (so there is nothing to hit, and they read as distant landmarks under the haze). One instanced mesh.

import {
  BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, InstancedMesh, MeshLambertMaterial, Object3D, Scene,
} from 'three';
import { terrainHeight } from '../sim/terrain';
import { makeRng } from '../sim/util';

function spireGeometry(): BufferGeometry {
  const g = new CylinderGeometry(0.34, 1, 1, 7, 8, false).translate(0, 0.5, 0).toNonIndexed();
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const h = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // ledges: the radius steps in four bands, with a little per-vertex wobble
    const ledge = 0.88 + 0.12 * ((Math.floor(y * 4.0) % 2) ? 1 : 0.55);
    const w = 1 + (h(Math.round(p.getX(i) * 50), Math.round(y * 40)) - 0.5) * 0.22;
    p.setX(i, p.getX(i) * ledge * w + 0.22 * y * y);
    p.setZ(i, p.getZ(i) * ledge * w);
    // dark and violet at the foot, warm where the low sun reaches the top
    const t = Math.min(1, Math.max(0, y));
    col[i * 3] = 0.16 + 0.8 * t * t; col[i * 3 + 1] = 0.05 + 0.34 * t * t; col[i * 3 + 2] = 0.2 + 0.1 * t - 0.1 * t * t;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class Monoliths {
  readonly mesh: InstancedMesh;

  constructor(scene: Scene) {
    const rng = makeRng(11);
    const clusters = 11;
    const items: { x: number; z: number; r: number; h: number; ry: number }[] = [];
    for (let c = 0; c < clusters; c++) {
      const az = (c / clusters) * Math.PI * 2 + (rng() - 0.5) * 0.35;
      const dist = 9600 + rng() * 3800;
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const a = az + (rng() - 0.5) * 0.06, d = dist + (rng() - 0.5) * 900;
        items.push({ x: Math.sin(a) * d, z: -Math.cos(a) * d, r: 200 + rng() * 260, h: (k === 0 ? 1900 : 900) + rng() * 1200, ry: rng() * 6.28 });
      }
    }
    this.mesh = new InstancedMesh(
      spireGeometry(), new MeshLambertMaterial({ vertexColors: true, flatShading: true }), items.length,
    );
    const o = new Object3D(), tint = new Color();
    items.forEach((it, i) => {
      o.position.set(it.x, Math.max(0, terrainHeight(it.x, it.z)) - 120, it.z);
      o.rotation.set(0, it.ry, 0);
      o.scale.set(it.r, it.h, it.r);
      o.updateMatrix();
      this.mesh.setMatrixAt(i, o.matrix);
      const v = 0.8 + rng() * 0.4;
      this.mesh.setColorAt(i, tint.setRGB(v, v * (0.85 + rng() * 0.3), v));
    });
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
}
