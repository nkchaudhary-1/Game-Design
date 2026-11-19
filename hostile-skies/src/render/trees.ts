// Trees. Low flight over woodland needs something to fly over, so conifers are scattered on the forested ground in a
// disc around the camera: dense close up, thinning with distance, regenerated when the camera has moved far enough.
// They are a few dozen triangles each in one instanced mesh, so thousands cost very little. Above about a kilometre
// they would be sub-pixel and are switched off. Placement follows the same forest rule as the ground colour, so the
// trees stand exactly where the terrain is painted dark green.

import {
  BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, InstancedMesh, MeshLambertMaterial,
  Object3D, Quaternion, Scene, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITY_SITES, forestAmount, groundNoise, groundPatches, terrainHeight } from '../sim/terrain';
import { GFX } from './quality';

const MAX = 7000;
const CELL = 38;

function coloured(g: BufferGeometry, r: number, gr: number, b: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; }
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  return g.index ? g.toNonIndexed() : g;
}

function conifer(): BufferGeometry {
  const trunk = coloured(new CylinderGeometry(0.45, 0.7, 3, 5).translate(0, 1.5, 0), 0.07, 0.045, 0.03);
  const low = coloured(new ConeGeometry(3.6, 8, 7).translate(0, 6.2, 0), 0.03, 0.075, 0.025);
  const mid = coloured(new ConeGeometry(2.8, 7, 7).translate(0, 10.2, 0), 0.036, 0.085, 0.03);
  const top = coloured(new ConeGeometry(1.8, 6, 7).translate(0, 14.0, 0), 0.042, 0.095, 0.034);
  return mergeGeometries([trunk, low, mid, top], false)!;
}

const hash = (a: number, b: number): number => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class Trees {
  readonly mesh: InstancedMesh;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private dummy = new Object3D();
  private q = new Quaternion();
  private tint = new Color();

  constructor(scene: Scene) {
    this.mesh = new InstancedMesh(conifer(), new MeshLambertMaterial({ vertexColors: true }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(35048);
    scene.add(this.mesh);
  }

  /** Call every frame with the camera position. */
  update(px: number, py: number, pz: number): void {
    const ground = Math.max(0, terrainHeight(px, pz));
    if (py - ground > 1150) { this.mesh.count = 0; this.lastX = Number.NaN; return; }
    if (Math.hypot(px - this.lastX, pz - this.lastZ) < 110) return;
    this.lastX = px; this.lastZ = pz;
    const R = GFX.tier === 'high' ? 2600 : GFX.tier === 'medium' ? 1900 : 1100;
    const gx0 = Math.floor((px - R) / CELL), gx1 = Math.floor((px + R) / CELL), gz0 = Math.floor((pz - R) / CELL), gz1 = Math.floor((pz + R) / CELL);
    let n = 0;
    for (let gz = gz0; gz <= gz1 && n < MAX; gz++) for (let gx = gx0; gx <= gx1 && n < MAX; gx++) {
      const wx = (gx + hash(gx, gz)) * CELL, wz = (gz + hash(gz + 91, gx - 17)) * CELL;
      const d = Math.hypot(wx - px, wz - pz);
      if (d > R) continue;
      // thin out with distance: dense underneath, sparse at the edge
      if (hash(gx * 7 + 3, gz * 13 + 5) > 1.15 - (d / R) * 1.05) continue;
      const h = terrainHeight(wx, wz);
      if (h < 28 || h > 840) continue;
      const wood = forestAmount(h, groundNoise(wx, wz), groundPatches(wx, wz));
      if (wood < 0.45 || hash(gx + 5, gz + 11) > wood * 1.1) continue;
      if (Math.abs(terrainHeight(wx + 9, wz) - h) > 6 || Math.abs(terrainHeight(wx, wz + 9) - h) > 6) continue; // too steep
      let inCity = false;
      for (const c of CITY_SITES) if (Math.hypot(wx - c.x, wz - c.z) < c.radius * 2.3) { inCity = true; break; }
      if (inCity) continue;
      const s = 0.75 + hash(gx + 19, gz + 23) * 0.95;
      this.dummy.position.set(wx, h - 0.6, wz);
      this.q.setFromAxisAngle(Y, hash(gx - 7, gz + 3) * Math.PI * 2);
      this.dummy.quaternion.copy(this.q);
      this.dummy.scale.set(s, s * (0.9 + hash(gx, gz + 31) * 0.3), s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      const v = 0.8 + hash(gx + 41, gz - 9) * 0.45;
      this.mesh.setColorAt(n, this.tint.setRGB(v, v * (0.96 + hash(gx, gz) * 0.1), v * 0.92));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  reset(): void { this.lastX = Number.NaN; this.mesh.count = 0; }
}

const Y = new Vector3(0, 1, 0);
