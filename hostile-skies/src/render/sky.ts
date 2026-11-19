// The sky: a late-afternoon dome (blue overhead, warm haze at the horizon, a hard sun with an aureole, a pale moon).
// One palette is shared by the dome, the fog, the sea and the clouds so the horizon always matches. The fog colour is
// re-derived each frame from where the camera is looking, so land and sea fade into the sky behind them whichever way
// you turn: warm towards the sun, cool away from it.

import { BackSide, Color, Group, Mesh, PerspectiveCamera, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

export const PALETTE = {
  zenith: new Color('#2a60a6'),
  mid: new Color('#6f9fd0'),
  horizon: new Color('#f0d2b0'),
  horizonCool: new Color('#b6cde6'),
  sun: new Color('#fff0d8'),
  glow: new Color('#ffbd7e'),
  /** Fog and far-water colour. Overwritten every frame by `updateHaze`. */
  fog: new Color('#c9c6c0'),
};

/** Direction towards the sun: a little over 15 degrees up, in the north-north-west, so the pilot starts flying towards it. */
export const SUN_DIR = new Vector3(-0.5, 0.27, -0.82).normalize();
export const MOON_DIR = new Vector3(0.62, 0.46, -0.25).normalize();

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
varying vec3 vDir;
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
  col += sunCol * smoothstep(0.99975, 0.99992, s) * 6.0;
  float m = smoothstep(0.99986, 0.99994, dot(d, moonDir));
  col = mix(col, vec3(0.80, 0.85, 0.92) * 0.8, m * 0.55 * (1.0 - smoothstep(0.0, 0.5, h) * 0.0));
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
