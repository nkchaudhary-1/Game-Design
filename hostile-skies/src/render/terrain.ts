// Endless chunked terrain built from the sim's height function, plus the sea.
// Chunks stream in around the player a couple per frame; fog hides the edge of the loaded ring.

import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, LinearMipmapLinearFilter,
  Mesh, MeshLambertMaterial, PlaneGeometry, RepeatWrapping, Scene, ShaderMaterial, SRGBColorSpace, Sphere, Vector3,
} from 'three';
import { groundColor, terrainHeight } from '../sim/terrain';
import { makeRng } from '../sim/util';
import { GFX } from './quality';
import { PALETTE, SUN_DIR } from './sky';

export const CHUNK = 1024;
const DETAIL_SCALE = 1 / 150;

/** A tileable greyscale grain that breaks up vertex colours and gives low flight a sense of speed. */
function detailTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const rng = makeRng(5);
  // value noise on a wrapping lattice, three octaves
  const lat: number[][] = [];
  const cells = [4, 8, 16];
  for (const n of cells) { const l: number[] = []; for (let i = 0; i < n * n; i++) l.push(rng()); lat.push(l); }
  const sample = (l: number[], n: number, u: number, v: number) => {
    const x = u * n, y = v * n, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => l[((b % n) + n) % n * n + ((a % n) + n) % n]!;
    const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx, bot = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const n = sample(lat[0]!, cells[0]!, u, v) * 0.5 + sample(lat[1]!, cells[1]!, u, v) * 0.3 + sample(lat[2]!, cells[2]!, u, v) * 0.2;
    const k = Math.round(255 * (0.74 + n * 0.3));
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = k; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}

export class TerrainView {
  private chunks = new Map<string, Mesh>();
  private mat: MeshLambertMaterial;
  private index: BufferAttribute | null = null;
  private segs = 0;
  private cx = Number.NaN;
  private cz = Number.NaN;
  private queue: { ix: number; iz: number; d: number }[] = [];

  constructor(private scene: Scene) {
    this.mat = new MeshLambertMaterial({ vertexColors: true, map: detailTexture() });
  }

  private indices(): BufferAttribute {
    const n = GFX.chunkSegs;
    if (this.index && this.segs === n) return this.index;
    const verts = n + 1;
    const idx = new Uint16Array(n * n * 6);
    let k = 0;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const a = z * verts + x, b = a + 1, c = a + verts, d = c + 1;
      // alternate the diagonal so slopes don't show a grain
      if ((x + z) & 1) { idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
      else { idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    }
    this.index = new BufferAttribute(idx, 1);
    this.segs = n;
    return this.index;
  }

  private build(ix: number, iz: number): Mesh {
    const n = GFX.chunkSegs, verts = n + 1, step = CHUNK / n;
    const ox = ix * CHUNK, oz = iz * CHUNK;
    // heights with a one-sample border so normals match across chunk seams
    const hs = verts + 2;
    const H = new Float32Array(hs * hs);
    for (let z = 0; z < hs; z++) for (let x = 0; x < hs; x++) H[z * hs + x] = terrainHeight(ox + (x - 1) * step, oz + (z - 1) * step);

    const pos = new Float32Array(verts * verts * 3), nor = new Float32Array(verts * verts * 3);
    const col = new Float32Array(verts * verts * 3), uv = new Float32Array(verts * verts * 2);
    const rgb: [number, number, number] = [0, 0, 0];
    let lo = Infinity, hi = -Infinity;
    for (let z = 0; z < verts; z++) for (let x = 0; x < verts; x++) {
      const h = H[(z + 1) * hs + (x + 1)]!;
      const i = z * verts + x;
      pos[i * 3] = x * step; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z * step;
      const dx = (H[(z + 1) * hs + (x + 2)]! - H[(z + 1) * hs + x]!) / (2 * step);
      const dz = (H[(z + 2) * hs + (x + 1)]! - H[z * hs + (x + 1)]!) / (2 * step);
      const il = 1 / Math.hypot(dx, 1, dz);
      nor[i * 3] = -dx * il; nor[i * 3 + 1] = il; nor[i * 3 + 2] = -dz * il;
      const wx = ox + x * step, wz = oz + z * step;
      const slope = Math.hypot(dx, dz);
      const n01 = (Math.sin(wx * 0.013 + Math.sin(wz * 0.009) * 2) + Math.sin(wz * 0.017 - wx * 0.006) + 2) * 0.25;
      groundColor(h, slope, n01, rgb);
      col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
      uv[i * 2] = wx * DETAIL_SCALE; uv[i * 2 + 1] = wz * DETAIL_SCALE;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(this.indices());
    g.boundingSphere = new Sphere(new Vector3(CHUNK / 2, (lo + hi) / 2, CHUNK / 2), Math.hypot(CHUNK / 2, CHUNK / 2, (hi - lo) / 2) + 2);
    const m = new Mesh(g, this.mat);
    m.position.set(ox, 0, oz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }

  /** Stream chunks around (px, pz). `budget` = how many to build this call. */
  update(px: number, pz: number, budget = 2): void {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    const R = GFX.chunkRadius;
    if (cx !== this.cx || cz !== this.cz) {
      this.cx = cx; this.cz = cz;
      this.queue.length = 0;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > R + 0.5) continue;
        if (!this.chunks.has(`${cx + dx},${cz + dz}`)) this.queue.push({ ix: cx + dx, iz: cz + dz, d });
      }
      this.queue.sort((a, b) => a.d - b.d);
      for (const [key, mesh] of this.chunks) {
        const [kx, kz] = key.split(',').map(Number) as [number, number];
        if (Math.hypot(kx - cx, kz - cz) > R + 1.5) { this.scene.remove(mesh); mesh.geometry.dispose(); this.chunks.delete(key); }
      }
    }
    for (let i = 0; i < budget && this.queue.length; i++) {
      const q = this.queue.shift()!;
      const key = `${q.ix},${q.iz}`;
      if (this.chunks.has(key)) continue;
      const m = this.build(q.ix, q.iz);
      this.chunks.set(key, m);
      this.scene.add(m);
    }
  }

  /** Build everything near the player up front (used at mission start so there is no pop-in). */
  prime(px: number, pz: number): void { this.update(px, pz, Infinity); }

  /** Rebuild after a graphics tier change. */
  reset(): void {
    for (const m of this.chunks.values()) { this.scene.remove(m); m.geometry.dispose(); }
    this.chunks.clear();
    this.queue.length = 0;
    this.index = null;
    this.cx = this.cz = Number.NaN;
  }
}

// ---- the sea -----------------------------------------------------------------------------------------------------

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FRAG = /* glsl */ `
uniform float time; uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 mid; uniform vec3 zenith; uniform vec3 fogCol; uniform float fogDensity;
uniform vec3 deep; uniform vec3 shallow; uniform vec3 sunCol;
varying vec3 vWorld;

vec3 skyAt(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
  c = mix(c, zenith, smoothstep(0.12, 0.85, h));
  float s = max(dot(d, sunDir), 0.0);
  c += vec3(1.0, 0.6, 0.35) * (pow(s, 5.0) * 0.34 + pow(s, 36.0) * 0.55);
  return c;
}

void main() {
  vec3 V = cameraPosition - vWorld;
  float dist = length(V);
  V /= dist;
  // gentle travelling swell; the slope fades with distance so the far sea doesn't shimmer
  vec2 p = vWorld.xz;
  float t = time;
  vec2 g = vec2(0.0);
  g += vec2(0.55, 0.30) * cos(dot(p, vec2(0.021, 0.013)) + t * 0.9) * 0.9;
  g += vec2(-0.35, 0.62) * cos(dot(p, vec2(-0.017, 0.026)) + t * 1.1) * 0.7;
  g += vec2(0.80, -0.20) * cos(dot(p, vec2(0.061, -0.017)) - t * 1.6) * 0.38;
  g += vec2(-0.25, -0.75) * cos(dot(p, vec2(-0.043, -0.071)) + t * 1.9) * 0.3;
  g += vec2(0.5, 0.5) * cos(dot(p, vec2(0.17, 0.19)) + t * 3.1) * 0.12;
  g *= 0.075 / (1.0 + dist * 0.00045);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  vec3 refl = skyAt(normalize(R));
  float spec = pow(max(dot(R, sunDir), 0.0), 380.0) * 14.0 + pow(max(dot(R, sunDir), 0.0), 40.0) * 0.45;
  vec3 col = mix(deep, shallow, 0.25 + 0.2 * n.x) * 0.9;
  col = mix(col, refl, fres) + sunCol * spec;
  float f = 1.0 - exp(-pow(fogDensity * dist, 2.0));
  col = mix(col, fogCol, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 0.93);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sea {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;

  constructor(fogDensity: number) {
    this.mat = new ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, side: DoubleSide, fog: false,
      uniforms: {
        time: { value: 0 }, sunDir: { value: SUN_DIR }, horizon: { value: PALETTE.horizon }, mid: { value: PALETTE.mid },
        zenith: { value: PALETTE.zenith }, fogCol: { value: PALETTE.fog }, fogDensity: { value: fogDensity },
        deep: { value: new Color('#06222e') }, shallow: { value: new Color('#14566a') }, sunCol: { value: PALETTE.sun },
      },
    });
    this.mesh = new Mesh(new PlaneGeometry(60000, 60000, 1, 1).rotateX(-Math.PI / 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  update(time: number, px: number, pz: number): void {
    this.mat.uniforms.time!.value = time;
    this.mesh.position.set(px, 0, pz);
  }
}
