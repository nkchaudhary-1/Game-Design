// Endless chunked terrain built from the sim's height function, plus the sea.
// Chunks stream in around the player a couple per frame; fog hides the edge of the loaded ring.
//
// Realism comes from three places: natural ground colours (sim/terrain.ts), per-pixel detail noise that sharpens as you
// drop towards the ground, and a baked map of where mountains throw their shadows at this sun angle (the sun is low,
// so the shadows are long). A second baked map holds sea depth, which the water shader turns into turquoise shallows,
// deep blue, and surf along the coast.

import {
  BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, DataTexture, DoubleSide, Float32BufferAttribute, LinearFilter,
  Mesh, MeshLambertMaterial, PlaneGeometry, RedFormat, Scene, ShaderMaterial, Sphere, UnsignedByteType, Vector3,
} from 'three';
import { groundColor, groundNoise, groundPatches, terrainHeight } from '../sim/terrain';
import { GFX } from './quality';
import { PALETTE, SUN_DIR } from './sky';
import { ALIEN, alienGround } from './look';

export const CHUNK = 1024;
/** The distant ring: big coarse chunks out to the horizon, with holes cut where the detailed chunks already cover. */
const FAR = 4096;
const FAR_SEGS = 24;

// ---- baked field maps (sun shadow, sea depth) ---------------------------------------------------------------------

const MAP_N = 160;
/** The maps cover [-MAP_R, MAP_R] on both axes: the whole arena and a margin. */
export const MAP_R = 13000;

class FieldMaps {
  readonly shadow = new DataTexture(new Uint8Array(MAP_N * MAP_N).fill(255), MAP_N, MAP_N, RedFormat, UnsignedByteType);
  readonly bathy = new DataTexture(new Uint8Array(MAP_N * MAP_N), MAP_N, MAP_N, RedFormat, UnsignedByteType);
  private built = false;

  constructor() {
    for (const t of [this.shadow, this.bathy]) {
      t.magFilter = LinearFilter; t.minFilter = LinearFilter; t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false; t.needsUpdate = true;
    }
  }

  /** About 0.7 s of CPU, done once while the loading screen is up. */
  build(): void {
    if (this.built) return;
    this.built = true;
    const hl = Math.hypot(SUN_DIR.x, SUN_DIR.z);
    const dx = SUN_DIR.x / hl, dz = SUN_DIR.z / hl, slope = SUN_DIR.y / hl;
    const sh = this.shadow.image.data as Uint8Array, bt = this.bathy.image.data as Uint8Array;
    for (let j = 0; j < MAP_N; j++) for (let i = 0; i < MAP_N; i++) {
      const wx = -MAP_R + ((i + 0.5) / MAP_N) * 2 * MAP_R, wz = -MAP_R + ((j + 0.5) / MAP_N) * 2 * MAP_R;
      const h0 = terrainHeight(wx, wz);
      bt[j * MAP_N + i] = h0 < 0 ? Math.round(Math.min(1, -h0 / 90) * 255) : 0;
      if (h0 < 0) { sh[j * MAP_N + i] = 255; continue; }
      let worst = 0;
      for (let s = 25; s < 6500; s *= 1.13) {
        const over = terrainHeight(wx + dx * s, wz + dz * s) - (h0 + slope * s) - 14; // small bumps don't cast shadows
        if (over > 0) worst = Math.max(worst, Math.min(1, over / (30 + s * 0.06)));
      }
      sh[j * MAP_N + i] = Math.round((1 - worst * 0.82) * 255);
    }
    this.shadow.needsUpdate = true;
    this.bathy.needsUpdate = true;
  }
}

export const FIELDS = new FieldMaps();

// ---- terrain ------------------------------------------------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

function terrainMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShadow = { value: FIELDS.shadow };
    shader.uniforms.uMapR = { value: MAP_R };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; uniform sampler2D uShadow; uniform float uMapR;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // fine detail that sharpens as the ground gets closer: grain, tufts, strata
          float d = distance(vWPos, cameraPosition);
          float w = 1.0 - smoothstep(500.0, 4200.0, d);
          float f1 = vn(vWPos.xz * 0.9), f2 = vn(vWPos.xz * 3.7), f3 = vn(vWPos.xz * 0.11), f4 = vn(vWPos.xz * 0.023);
          float det = 0.74 + 0.30 * f1 + 0.2 * f2 + 0.34 * (f3 - 0.5) + 0.3 * (f4 - 0.5);
          diffuseColor.rgb *= mix(1.0, det, w);
        }`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
        {
          // mountains shadow the low sun
          float sunVis = texture2D(uShadow, (vWPos.xz + uMapR) / (2.0 * uMapR)).r;
          reflectedLight.directDiffuse *= sunVis;
        }`);
  };
  return mat;
}

export class TerrainView {
  private chunks = new Map<string, Mesh>();
  private mat: MeshLambertMaterial = terrainMaterial();
  private index: BufferAttribute | null = null;
  private segs = 0;
  private cx = Number.NaN;
  private cz = Number.NaN;
  private queue: { ix: number; iz: number; d: number }[] = [];
  private far = new Map<string, Mesh>();
  private farQueue: { ix: number; iz: number; d: number }[] = [];
  private fcx = Number.NaN;
  private fcz = Number.NaN;

  constructor(private scene: Scene) {}

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
    const col = new Float32Array(verts * verts * 3);
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
      groundColor(h, slope, groundNoise(wx, wz), groundPatches(wx, wz), rgb);
      if (ALIEN) alienGround(rgb);
      col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(this.indices());
    g.boundingSphere = new Sphere(new Vector3(CHUNK / 2, (lo + hi) / 2, CHUNK / 2), Math.hypot(CHUNK / 2, CHUNK / 2, (hi - lo) / 2) + 2);
    const m = new Mesh(g, this.mat);
    m.position.set(ox, 0, oz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }

  // ---- the distant ring --------------------------------------------------------------------------------------

  /** Is this point inside the area the detailed chunks cover (or are about to)? */
  private nearCovered(wx: number, wz: number): boolean {
    return Math.hypot(Math.floor(wx / CHUNK) - this.cx, Math.floor(wz / CHUNK) - this.cz) <= GFX.chunkRadius + 0.5;
  }

  /** Index buffer for a far chunk: every cell with a corner outside the detailed area (so there is overlap, never a gap). */
  private farIndex(ix: number, iz: number): BufferAttribute {
    const n = FAR_SEGS, verts = n + 1, step = FAR / n, ox = ix * FAR, oz = iz * FAR;
    const covered = new Uint8Array(verts * verts);
    for (let z = 0; z < verts; z++) for (let x = 0; x < verts; x++) covered[z * verts + x] = this.nearCovered(ox + x * step, oz + z * step) ? 1 : 0;
    const idx: number[] = [];
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const a = z * verts + x, b = a + 1, c = a + verts, d = c + 1;
      if (covered[a] && covered[b] && covered[c] && covered[d]) continue;
      if ((x + z) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    return new BufferAttribute(new Uint16Array(idx), 1);
  }

  private buildFar(ix: number, iz: number): Mesh {
    const n = FAR_SEGS, verts = n + 1, step = FAR / n, ox = ix * FAR, oz = iz * FAR;
    const hs = verts + 2;
    const H = new Float32Array(hs * hs);
    for (let z = 0; z < hs; z++) for (let x = 0; x < hs; x++) H[z * hs + x] = terrainHeight(ox + (x - 1) * step, oz + (z - 1) * step);
    const pos = new Float32Array(verts * verts * 3), nor = new Float32Array(verts * verts * 3), col = new Float32Array(verts * verts * 3);
    const rgb: [number, number, number] = [0, 0, 0];
    let lo = Infinity, hi = -Infinity;
    for (let z = 0; z < verts; z++) for (let x = 0; x < verts; x++) {
      const h = H[(z + 1) * hs + (x + 1)]!, i = z * verts + x;
      // sunk a little so the detailed chunks always win where the two overlap
      pos[i * 3] = x * step; pos[i * 3 + 1] = h - 9; pos[i * 3 + 2] = z * step;
      const dx = (H[(z + 1) * hs + (x + 2)]! - H[(z + 1) * hs + x]!) / (2 * step);
      const dz = (H[(z + 2) * hs + (x + 1)]! - H[z * hs + (x + 1)]!) / (2 * step);
      const il = 1 / Math.hypot(dx, 1, dz);
      nor[i * 3] = -dx * il; nor[i * 3 + 1] = il; nor[i * 3 + 2] = -dz * il;
      const wx = ox + x * step, wz = oz + z * step;
      groundColor(h, Math.hypot(dx, dz), groundNoise(wx, wz), groundPatches(wx, wz), rgb);
      if (ALIEN) alienGround(rgb);
      col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(this.farIndex(ix, iz));
    g.boundingSphere = new Sphere(new Vector3(FAR / 2, (lo + hi) / 2, FAR / 2), Math.hypot(FAR / 2, FAR / 2, (hi - lo) / 2) + 2);
    const m = new Mesh(g, this.mat);
    m.position.set(ox, 0, oz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }

  private updateFar(px: number, pz: number, budget: number, force: boolean): void {
    const R = GFX.tier === 'low' ? 3 : 4;
    const fx = Math.floor(px / FAR), fz = Math.floor(pz / FAR);
    if (fx !== this.fcx || fz !== this.fcz) {
      this.fcx = fx; this.fcz = fz;
      this.farQueue.length = 0;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        if (!this.far.has(`${fx + dx},${fz + dz}`)) this.farQueue.push({ ix: fx + dx, iz: fz + dz, d: Math.hypot(dx, dz) });
      }
      this.farQueue.sort((a, b) => a.d - b.d);
      for (const [key, mesh] of this.far) {
        const [kx, kz] = key.split(',').map(Number) as [number, number];
        if (Math.max(Math.abs(kx - fx), Math.abs(kz - fz)) > R + 1) { this.scene.remove(mesh); mesh.geometry.dispose(); this.far.delete(key); }
      }
    }
    if (force) for (const [key, mesh] of this.far) { const [kx, kz] = key.split(',').map(Number) as [number, number]; mesh.geometry.setIndex(this.farIndex(kx, kz)); }
    for (let i = 0; i < budget && this.farQueue.length; i++) {
      const q = this.farQueue.shift()!;
      const key = `${q.ix},${q.iz}`;
      if (this.far.has(key)) continue;
      const m = this.buildFar(q.ix, q.iz);
      this.far.set(key, m);
      this.scene.add(m);
    }
  }

  /** Stream chunks around (px, pz). `budget` = how many to build this call. */
  update(px: number, pz: number, budget = 2): void {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    const R = GFX.chunkRadius;
    let nearMoved = false;
    if (cx !== this.cx || cz !== this.cz) {
      nearMoved = true;
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
    this.updateFar(px, pz, budget === Infinity ? Infinity : 1, nearMoved);
  }

  /** Build everything near the player up front (used at mission start so there is no pop-in). */
  prime(px: number, pz: number): void {
    FIELDS.build();
    this.update(px, pz, Infinity);
  }

  /** Rebuild after a graphics tier change. */
  reset(): void {
    for (const m of this.chunks.values()) { this.scene.remove(m); m.geometry.dispose(); }
    this.chunks.clear();
    this.queue.length = 0;
    this.index = null;
    this.cx = this.cz = Number.NaN;
    for (const m of this.far.values()) { this.scene.remove(m); m.geometry.dispose(); }
    this.far.clear();
    this.farQueue.length = 0;
    this.fcx = this.fcz = Number.NaN;
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
uniform float time; uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 horizonCool; uniform vec3 mid; uniform vec3 zenith;
uniform vec3 fogCol; uniform float fogDensity; uniform vec3 deep; uniform vec3 shallow; uniform vec3 sunCol;
uniform sampler2D bathy; uniform float mapR;
varying vec3 vWorld;
${NOISE_GLSL}

vec3 skyAt(vec3 d) {
  float h = max(d.y, 0.0);
  float az = dot(normalize(d.xz + vec2(1e-5)), normalize(sunDir.xz));
  vec3 hz = mix(horizonCool, horizon, smoothstep(0.0, 1.0, (az + 0.6) / 1.5));
  vec3 c = mix(hz, mid, smoothstep(0.0, 0.30, h));
  c = mix(c, zenith, smoothstep(0.16, 0.95, h));
  float s = max(dot(d, sunDir), 0.0);
  c += vec3(1.0, 0.74, 0.5) * (pow(s, 3.0) * 0.16 + pow(s, 18.0) * 0.45);
  return c;
}

void main() {
  vec3 V = cameraPosition - vWorld;
  float dist = length(V);
  V /= dist;
  vec2 p = vWorld.xz;
  float t = time;
  // swell plus wind chop; the slope fades with distance so the far sea does not shimmer
  vec2 g = vec2(0.0);
  g += vec2(0.55, 0.30) * cos(dot(p, vec2(0.021, 0.013)) + t * 0.9) * 0.9;
  g += vec2(-0.35, 0.62) * cos(dot(p, vec2(-0.017, 0.026)) + t * 1.1) * 0.7;
  g += vec2(0.80, -0.20) * cos(dot(p, vec2(0.061, -0.017)) - t * 1.6) * 0.38;
  g += vec2(-0.25, -0.75) * cos(dot(p, vec2(-0.043, -0.071)) + t * 1.9) * 0.3;
  g += vec2(0.5, 0.5) * cos(dot(p, vec2(0.17, 0.19)) + t * 3.1) * 0.12;
  g += (vec2(vn(p * 0.45 + t * 0.4), vn(p * 0.45 + 17.0 - t * 0.35)) - 0.5) * 0.35;
  g *= 0.075 / (1.0 + dist * 0.00045);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

  float depth = texture2D(bathy, (p + mapR) / (2.0 * mapR)).r * 90.0;   // metres below the surface, coarse
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  vec3 refl = skyAt(normalize(R));
  float cs = max(dot(R, sunDir), 0.0);
  float spec = pow(cs, 700.0) * 2.4 + pow(cs, 70.0) * 0.18;
  // body colour: clear turquoise over the shallows, deep blue-green offshore
  vec3 body = mix(shallow, deep, smoothstep(2.0, 60.0, depth));
  body *= 0.85 + 0.25 * n.x;
  vec3 col = mix(body, refl, fres) + sunCol * spec;
  // surf: broken white water along the coast, drifting with the swell
  float surfZone = 1.0 - smoothstep(0.5, 7.0, depth);
  float breakers = smoothstep(0.55, 0.9, vn(p * 0.09 + vec2(t * 0.35, 0.0)) * 0.6 + vn(p * 0.41 - vec2(0.0, t * 0.5)) * 0.4 + sin(depth * 0.9 - t * 1.6) * 0.18);
  col = mix(col, vec3(0.95, 0.97, 1.0), clamp(surfZone * breakers, 0.0, 0.9) * 0.85);

  float f = 1.0 - exp(-pow(fogDensity * dist, 2.0));
  col = mix(col, fogCol, clamp(f, 0.0, 1.0));
  float alpha = mix(0.55, 0.97, smoothstep(0.0, 9.0, depth));   // you can see the sand through the shallows
  gl_FragColor = vec4(col, alpha);
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
        time: { value: 0 }, sunDir: { value: SUN_DIR }, horizon: { value: PALETTE.horizon }, horizonCool: { value: PALETTE.horizonCool },
        mid: { value: PALETTE.mid }, zenith: { value: PALETTE.zenith }, fogCol: { value: PALETTE.fog }, fogDensity: { value: fogDensity },
        deep: { value: new Color(ALIEN ? '#2b1166' : '#0a3552') }, shallow: { value: new Color(ALIEN ? '#f0607e' : '#2c9a98') }, sunCol: { value: PALETTE.sun },
        bathy: { value: FIELDS.bathy }, mapR: { value: MAP_R },
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
