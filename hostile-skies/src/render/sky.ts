// The sky: a late-afternoon dome (blue overhead, warm haze at the horizon, a hard sun with an aureole, a pale moon).
// One palette is shared by the dome, the fog, the sea and the clouds so the horizon always matches. The fog colour is
// re-derived each frame from where the camera is looking, so land and sea fade into the sky behind them whichever way
// you turn: warm towards the sun, cool away from it.

import { BackSide, Color, Group, Mesh, PerspectiveCamera, ShaderMaterial, SphereGeometry, Vector2, Vector3 } from 'three';
import { ALIEN } from './look';

const EARTH = {
  zenith: '#2a60a6', mid: '#6f9fd0', horizon: '#f0d2b0', horizonCool: '#b6cde6', sun: '#fff0d8', glow: '#ffbd7e', fog: '#c9c6c0',
};
const DUSK = {
  zenith: '#120c45', mid: '#552a92', horizon: '#ee8f82', horizonCool: '#9468b6', sun: '#fff2e2', glow: '#ff6fa6', fog: '#a77cb0',
};
const PICK = ALIEN ? DUSK : EARTH;

export const PALETTE = {
  zenith: new Color(PICK.zenith),
  mid: new Color(PICK.mid),
  horizon: new Color(PICK.horizon),
  horizonCool: new Color(PICK.horizonCool),
  sun: new Color(PICK.sun),
  glow: new Color(PICK.glow),
  /** Fog and far-water colour. Overwritten every frame by `updateHaze`. */
  fog: new Color(PICK.fog),
};

/** Direction towards the sun: a little over 15 degrees up, in the north-north-west, so the pilot starts flying towards it. */
export const SUN_DIR = ALIEN ? new Vector3(-0.6, 0.14, -0.79).normalize() : new Vector3(-0.5, 0.27, -0.82).normalize();
export const MOON_DIR = new Vector3(0.62, 0.46, -0.25).normalize();
/** Alien look only: the ringed planet (to the right of the start heading) and two small moons. */
export const PLANET_DIR = new Vector3(0.74, 0.33, -0.58).normalize();
const MOON_A = new Vector3(-0.2, 0.62, -0.75).normalize();
const MOON_B = new Vector3(0.28, 0.78, 0.55).normalize();

const _sx = new Vector3();

/** Horizon haze colour in a given horizontal direction (unit vector, y ignored). */
export function hazeColour(dirX: number, dirZ: number, out: Color): Color {
  const l = Math.hypot(dirX, dirZ) || 1;
  const sl = Math.hypot(SUN_DIR.x, SUN_DIR.z);
  const az = (dirX / l) * (SUN_DIR.x / sl) + (dirZ / l) * (SUN_DIR.z / sl);
  const t = Math.min(1, Math.max(0, (az + 0.6) / 1.5));
  return out.copy(PALETTE.horizonCool).lerp(PALETTE.horizon, t * t * (3 - 2 * t));
}

/** Point the fog (and so the far land and sea) at the sky colour the camera sees at the horizon. */
export function updateHaze(camera: PerspectiveCamera): void {
  camera.getWorldDirection(_sx);
  hazeColour(_sx.x, _sx.z, PALETTE.fog);
  PALETTE.fog.multiplyScalar(0.94);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 horizonCool; uniform vec3 sunCol; uniform vec3 glowCol;
uniform vec3 fogCol; uniform vec3 sunDir; uniform vec3 moonDir;
uniform float alien; uniform vec3 planetDir; uniform vec3 moonA; uniform vec3 moonB; uniform vec2 sunDisc;
varying vec3 vDir;

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

// Alien dusk extras: stars, light shafts from the sun, two moons, and a banded ringed planet.
vec3 alienSky(vec3 col, vec3 d, float h, vec3 hz) {
  // stars: one jittered point per cell of a 3D grid laid over the sky
  vec3 sd = d * 95.0, cell = floor(sd), f = fract(sd);
  float hs = hash13(cell);
  vec3 pt = vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) * 0.6 + 0.2;
  float star = (1.0 - smoothstep(0.0, 0.2, length(f - pt))) * step(0.986, hs);
  float vis = smoothstep(0.04, 0.45, h) * (1.0 - clamp(dot(d, sunDir) * 1.2, 0.0, 0.9));
  col += vec3(0.85, 0.85, 1.0) * star * (0.5 + 1.8 * fract(hs * 91.7)) * vis;

  // light shafts fanning out from the sun
  vec3 sr = normalize(cross(sunDir, vec3(0.0, 1.0, 0.0))), su = cross(sr, sunDir);
  float ang = atan(dot(d, su), dot(d, sr));
  float sd0 = max(dot(d, sunDir), 0.0);
  float rays = pow(sd0, 2.2) * (0.5 + 0.5 * sin(ang * 11.0 + sin(ang * 4.0) * 2.4)) * (0.6 + 0.4 * sin(ang * 23.0 + 1.3));
  col += glowCol * rays * 0.16 * smoothstep(-0.04, 0.3, h);

  // moons, each with a darkened side
  for (int i = 0; i < 2; i++) {
    vec3 m = i == 0 ? moonA : moonB;
    float r = i == 0 ? 0.034 : 0.022;
    float c = dot(d, m);
    float disc = smoothstep(cos(r * 1.03), cos(r * 0.97), c);
    vec3 off = normalize(m + cross(m, vec3(0.0, 1.0, 0.0)) * r * 0.55);
    float dark = smoothstep(cos(r * 1.03), cos(r * 0.97), dot(d, off));
    vec3 mc = mix(vec3(0.95, 0.82, 0.86), vec3(1.0, 0.9, 0.8), float(i));
    col = mix(col, mc, disc * 0.95);
    col = mix(col, col * 0.18 + hz * 0.12, disc * dark * 0.9);
  }

  // the planet: banded gas giant, soft terminator, a rim of atmosphere, and a ring that passes in front and behind
  float cp = dot(d, planetDir);
  if (cp > 0.0) {
    vec3 pu = normalize(vec3(0.0, 1.0, 0.0) - planetDir * planetDir.y), pr = cross(planetDir, pu);
    float R = 0.23;
    vec2 q = vec2(dot(d, pr), dot(d, pu)) / R;
    float rr = length(q);
    float disc = 1.0 - smoothstep(0.985, 1.0, rr);
    vec3 nrm = vec3(q, sqrt(max(1.0 - rr * rr, 0.0)));
    vec3 L = normalize(vec3(-0.62, 0.32, 0.55));
    float nl = clamp(dot(nrm, L), 0.0, 1.0);
    float lat = nrm.y * 1.1 + 0.07 * sin(nrm.x * 6.0) + 0.05 * sin(nrm.y * 17.0 + nrm.x * 3.0);
    float bands = 0.5 + 0.5 * sin(lat * 12.0 + 1.8 * sin(lat * 3.1 + nrm.x * 2.2));
    vec3 pc = mix(vec3(1.0, 0.62, 0.24), vec3(0.98, 0.30, 0.46), bands) * (0.10 + 1.25 * smoothstep(0.0, 0.85, nl));
    pc += vec3(1.0, 0.55, 0.8) * pow(1.0 - nrm.z, 3.0) * (0.15 + 0.5 * nl);
    col += vec3(1.0, 0.5, 0.75) * 0.20 * exp(-max(rr - 1.0, 0.0) * 5.0) * step(1.0, rr);
    vec2 qr = vec2(q.x * 0.94 + q.y * 0.34, -q.x * 0.34 + q.y * 0.94);
    float re = length(vec2(qr.x, qr.y / 0.24));
    float ring = smoothstep(1.5, 1.56, re) * (1.0 - smoothstep(2.3, 2.36, re)) * (0.72 + 0.28 * sin(re * 46.0)) * (1.0 - smoothstep(1.9, 2.0, re) * 0.35);
    vec3 ringCol = vec3(1.0, 0.82, 0.72) * (0.55 + 0.6 * smoothstep(-1.0, 1.0, -qr.x));
    float front = step(qr.y, 0.0);
    col = mix(col, pc, disc);
    col = mix(col, ringCol, ring * 0.82 * mix(1.0 - disc, 1.0, front));
  }
  return col;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float az = dot(normalize(d.xz + vec2(1e-5)), normalize(sunDir.xz));
  vec3 hz = mix(horizonCool, horizon, smoothstep(0.0, 1.0, (az + 0.6) / 1.5));
  vec3 col = mix(hz, mid, smoothstep(0.0, 0.30, h));
  col = mix(col, zenith, smoothstep(0.16, 0.95, h));
  col = mix(col, hz * 1.04, exp(-max(h, 0.0) * 8.0) * 0.55);   // thicker, brighter air near the ground
  float s = max(dot(d, sunDir), 0.0);
  col += glowCol * (pow(s, 3.0) * 0.16 + pow(s, 18.0) * 0.45 + pow(s, 220.0) * 0.9);
  col += sunCol * smoothstep(sunDisc.x, sunDisc.y, s) * 6.0;
  float m = smoothstep(0.99986, 0.99994, dot(d, moonDir));
  col = mix(col, vec3(0.80, 0.85, 0.92) * 0.8, m * 0.55 * (1.0 - smoothstep(0.0, 0.5, h) * 0.0));
  if (alien > 0.5) col = alienSky(col, d, h, hz);
  col = mix(col, fogCol, 1.0 - smoothstep(-0.10, 0.02, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly group = new Group();
  private dome: Mesh;

  constructor() {
    this.dome = new Mesh(
      new SphereGeometry(20000, 32, 16),
      new ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: BackSide, depthWrite: false, fog: false,
        uniforms: {
          zenith: { value: PALETTE.zenith }, mid: { value: PALETTE.mid }, horizon: { value: PALETTE.horizon },
          horizonCool: { value: PALETTE.horizonCool }, sunCol: { value: PALETTE.sun }, glowCol: { value: PALETTE.glow },
          fogCol: { value: PALETTE.fog }, sunDir: { value: SUN_DIR }, moonDir: { value: MOON_DIR },
          alien: { value: ALIEN ? 1 : 0 }, planetDir: { value: PLANET_DIR }, moonA: { value: MOON_A }, moonB: { value: MOON_B },
          sunDisc: { value: ALIEN ? new Vector2(0.9988, 0.99935) : new Vector2(0.99975, 0.99992) },
        },
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
  }

  /** Keep the sky centred on the camera. */
  update(camera: PerspectiveCamera): void { this.group.position.copy(camera.position); }

  /** The dome on its own, for building the reflection environment. */
  get env(): Mesh { return this.dome; }
}
