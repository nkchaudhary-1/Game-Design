// Clouds. A broken field of cumulus (flat grey bases, sunlit domes) over the arena, plus a thin high deck. Each puff
// is a camera-facing quad that samples one of four procedurally generated cloud textures (alpha = density, red = how
// brightly lit it is). The texture is rotated per puff so its lit side always faces the sun on screen, bases are darkened,
// and puffs facing into the sun get a bright rim. Quads are re-sorted far to near a few times a second so they blend
// correctly, fade out as the aircraft gets close (so you can fly through them) and drift slowly with the wind.

import {
  DataTexture, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, Mesh, PerspectiveCamera,
  PlaneGeometry, RGBAFormat, ShaderMaterial, UnsignedByteType, Vector3,
} from 'three';
import { makeRng, smoothstep } from '../sim/util';
import { PALETTE, SUN_DIR } from './sky';

// ---- noise for the textures and the coverage map ------------------------------------------------------------------

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, seed: number, oct = 5): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, y * f, seed + i * 13) * a; n += a; a *= 0.5; f *= 2.07; }
  return s / n;
}

/** Four 256px cloud puffs in a 2x2 atlas. Light is baked from the upper left; the shader rotates it to the sun. */
function puffAtlas(): DataTexture {
  const T = 256, W = T * 2;
  const data = new Uint8Array(W * W * 4);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * T, oy = Math.floor(v / 2) * T;
    const dens = (x: number, y: number): number => {
      const dx = (x - 0.5) * 2, dy = (y - 0.5) * 2.1;
      const r = Math.hypot(dx, dy * (v % 2 ? 1.15 : 0.95));
      const base = 1 - Math.pow(Math.min(r, 1.4), 1.5);
      const n = fbm(x * 4.2 + v * 7.3, y * 4.2 - v * 3.1, 11 + v * 5, 5) - 0.45;
      const mask = 1 - smoothstep(0.7, 1.0, Math.hypot((x - 0.5) * 2, (y - 0.5) * 2));
      return Math.max(0, Math.min(1, base * 1.15 + n * 1.25)) * mask;
    };
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const x = (i + 0.5) / T, y = 1 - (j + 0.5) / T; // y up
      const d = dens(x, y);
      const toward = dens(x - 0.05, y + 0.05);          // a step towards the light (up-left)
      const lit = Math.max(0, Math.min(1, 0.58 + (d - toward) * 3.4 - d * 0.28));
      const a = smoothstep(0.12, 0.5, d);
      const o = ((oy + j) * W + ox + i) * 4;
      const L = Math.round(lit * 255);
      data[o] = L; data[o + 1] = L; data[o + 2] = L; data[o + 3] = Math.round(a * 255);
    }
  }
  const tex = new DataTexture(data, W, W, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter; tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
attribute vec4 iPosSize;   // xyz centre, w size
attribute vec4 iData;      // x variant 0..3, y height within its cloud 0..1, z opacity scale, w random
uniform vec3 sunDirW;
varying vec2 vUv; varying vec4 vData; varying float vDist; varying float vRot; varying float vBack;
void main() {
  vec3 c = iPosSize.xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = c + (right * position.x * 1.0 + up * position.y * 0.62) * iPosSize.w;
  vUv = position.xy + 0.5;
  vData = iData;
  vDist = distance(c, cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  // rotate the baked light (up-left) onto the sun's direction on screen
  vec3 sd = normalize(sunDirW);
  vec2 sun2 = vec2(dot(sd, right), dot(sd, up));
  float ang = length(sun2) > 0.05 ? atan(sun2.y, sun2.x) : 1.5708;
  vRot = ang - 2.3562;
  vBack = pow(max(dot(normalize(c - cameraPosition), sd), 0.0), 5.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D atlas; uniform vec3 fogCol; uniform vec3 shadeCol; uniform vec3 sunLit; uniform vec3 rimCol;
varying vec2 vUv; varying vec4 vData; varying float vDist; varying float vRot; varying float vBack;
void main() {
  vec2 p = vUv - 0.5;
  float cs = cos(-vRot), sn = sin(-vRot);
  p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
  float variant = floor(vData.x + 0.5);
  vec2 cell = vec2(mod(variant, 2.0), floor(variant / 2.0));
  vec4 t = texture2D(atlas, (cell + clamp(p, 0.004, 0.996)) * 0.5);
  float L = t.r;
  vec3 col = mix(shadeCol, sunLit, L);
  col *= mix(0.52, 1.0, smoothstep(0.0, 0.5, vData.y));          // flat, grey underside
  col += rimCol * vBack * (1.0 - t.a * 0.6) * 0.5;               // sun behind the cloud: bright edges
  float a = t.a * vData.z;
  a *= smoothstep(140.0, 650.0, vDist);                          // dissolve as the aircraft closes in
  a *= 1.0 - smoothstep(18000.0, 27000.0, vDist);
  float f = 1.0 - exp(-pow(vDist * 0.000055, 2.0));
  col = mix(col, fogCol, clamp(f, 0.0, 0.85));
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Puff { x: number; y: number; z: number; size: number; variant: number; h: number; alpha: number; rnd: number }

export class Clouds {
  readonly mesh: Mesh;
  private puffs: Puff[] = [];
  private geo = new InstancedBufferGeometry();
  private posSize: InstancedBufferAttribute;
  private data: InstancedBufferAttribute;
  private order: number[] = [];
  private mat: ShaderMaterial;
  private t = 0;
  private sortT = 0;
  private wind = new Vector3(7, 0, 3);

  constructor() {
    const rng = makeRng(31);
    // cumulus: clusters where a coverage noise map says the sky is broken
    const R = 16000;
    let placed = 0;
    for (let tries = 0; tries < 900 && placed < 70; tries++) {
      const cx = (rng() * 2 - 1) * R, cz = (rng() * 2 - 1) * R;
      if (Math.hypot(cx, cz) > R) continue;
      if (fbm(cx * 0.00016 + 5, cz * 0.00016 - 3, 3, 3) < 0.5) continue;
      placed++;
      const base = 1750 + rng() * 260;
      const W = 900 + rng() * 1500;
      const H = 380 + rng() * 520;
      const n = 8 + Math.floor(rng() * 6);
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2, rad = Math.pow(rng(), 0.7) * W * 0.5;
        const edge = rad / (W * 0.5);
        const size = (0.55 + 0.7 * (1 - edge)) * W * 0.55 * (0.8 + rng() * 0.45);
        const hf = Math.pow(rng(), 1.4) * (1 - edge * edge);
        this.puffs.push({
          x: cx + Math.cos(ang) * rad, z: cz + Math.sin(ang) * rad, y: base + size * 0.3 + hf * H,
          size, variant: Math.floor(rng() * 4), h: Math.min(1, hf + 0.08), alpha: 0.92, rnd: rng(),
        });
      }
    }
    // a thin, high deck
    for (let i = 0; i < 46; i++) {
      const ang = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * R * 1.2;
      this.puffs.push({
        x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, y: 5200 + rng() * 500, size: 3200 + rng() * 3800,
        variant: Math.floor(rng() * 4), h: 1, alpha: 0.28 + rng() * 0.1, rnd: rng(),
      });
    }

    const n = this.puffs.length;
    const quad = new PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.posSize = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.data = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.posSize.setUsage(35048); this.data.setUsage(35048);
    this.geo.setAttribute('iPosSize', this.posSize);
    this.geo.setAttribute('iData', this.data);
    this.geo.instanceCount = n;
    this.order = Array.from({ length: n }, (_, i) => i);

    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        atlas: { value: puffAtlas() }, sunDirW: { value: SUN_DIR },
        fogCol: { value: PALETTE.fog },
        shadeCol: { value: PALETTE.mid.clone().multiplyScalar(0.55).lerp(PALETTE.horizonCool, 0.3) },
        sunLit: { value: PALETTE.sun.clone().multiplyScalar(1.12) },
        rimCol: { value: PALETTE.glow.clone() },
      },
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.write(new Vector3(0, 1000, 0));
  }

  private write(cam: Vector3): void {
    const dx = this.wind.x * this.t, dz = this.wind.z * this.t;
    const P = this.puffs;
    this.order.sort((a, b) => {
      const pa = P[a]!, pb = P[b]!;
      const da = (pa.x + dx - cam.x) ** 2 + (pa.y - cam.y) ** 2 + (pa.z + dz - cam.z) ** 2;
      const db = (pb.x + dx - cam.x) ** 2 + (pb.y - cam.y) ** 2 + (pb.z + dz - cam.z) ** 2;
      return db - da; // far first
    });
    const ps = this.posSize.array as Float32Array, d = this.data.array as Float32Array;
    for (let k = 0; k < this.order.length; k++) {
      const p = P[this.order[k]!]!;
      ps[k * 4] = p.x + dx; ps[k * 4 + 1] = p.y; ps[k * 4 + 2] = p.z + dz; ps[k * 4 + 3] = p.size;
      d[k * 4] = p.variant; d[k * 4 + 1] = p.h; d[k * 4 + 2] = p.alpha; d[k * 4 + 3] = p.rnd;
    }
    this.posSize.needsUpdate = true; this.data.needsUpdate = true;
  }

  update(dt: number, camera: PerspectiveCamera): void {
    this.t += dt;
    this.sortT -= dt;
    if (this.sortT <= 0) { this.sortT = 0.3; this.write(camera.position); }
  }
}

