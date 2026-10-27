// The sky: a dusk gradient dome with a low sun, stars, and a ringed gas giant hanging over the sea. One palette is
// shared by the dome, the fog and the water so the horizon always matches.

import {
  AdditiveBlending, BackSide, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, PerspectiveCamera,
  Points, RingGeometry, ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import { makeRng } from '../sim/util';
import { GFX } from './quality';

export const PALETTE = {
  zenith: new Color('#0a0f2c'),
  mid: new Color('#4a2f7a'),
  horizon: new Color('#e0846c'),
  sun: new Color('#ffd7a0'),
  glow: new Color('#ff9a5a'),
  /** Fog and far-water colour: the horizon, dimmed a touch so distant land reads as haze rather than glare. */
  fog: new Color('#8e6088'),
};

/** Direction towards the sun: low in the north-north-west, so the pilot starts out flying towards the sunset. */
export const SUN_DIR = new Vector3(-0.5, 0.15, -0.85).normalize();

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunCol; uniform vec3 glowCol; uniform vec3 fogCol; uniform vec3 sunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
  col = mix(col, zenith, smoothstep(0.12, 0.85, h));
  float s = max(dot(d, sunDir), 0.0);
  col += glowCol * (pow(s, 5.0) * 0.34 + pow(s, 36.0) * 0.55);
  col += sunCol * smoothstep(0.9991, 0.9997, s) * 3.0;
  col = mix(col, fogCol, smoothstep(0.02, -0.12, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly group = new Group();
  private dome: Mesh;
  private stars: Points;
  private planet: Group;

  constructor() {
    this.dome = new Mesh(
      new SphereGeometry(20000, 32, 16),
      new ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: BackSide, depthWrite: false, fog: false,
        uniforms: {
          zenith: { value: PALETTE.zenith }, mid: { value: PALETTE.mid }, horizon: { value: PALETTE.horizon },
          sunCol: { value: PALETTE.sun }, glowCol: { value: PALETTE.glow }, fogCol: { value: PALETTE.fog }, sunDir: { value: SUN_DIR },
        },
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // stars
    const rng = makeRng(99);
    const n = GFX.stars;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = 0.08 + rng() * 0.92, a = rng() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 19000; pos[i * 3 + 1] = y * 19000; pos[i * 3 + 2] = Math.sin(a) * r * 19000;
      size[i] = 0.8 + Math.pow(rng(), 6) * 2.4;
      const k = rng();
      tint[i * 3] = 0.8 + k * 0.2; tint[i * 3 + 1] = 0.85 + k * 0.1; tint[i * 3 + 2] = 1;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('size', new Float32BufferAttribute(size, 1));
    g.setAttribute('tint', new Float32BufferAttribute(tint, 3));
    this.stars = new Points(g, new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false,
      uniforms: { px: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec3 tint; varying vec3 vTint; varying float vFade; uniform float px;
        void main() {
          vTint = tint; vFade = smoothstep(0.05, 0.5, normalize(position).y);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w;
          gl_PointSize = size * px;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vTint; varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d) * vFade * 0.9;
          gl_FragColor = vec4(vTint * a, a);
        }`,
    }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    // a ringed gas giant: the visible sign that this is not home
    this.planet = new Group();
    const body = new Mesh(
      new SphereGeometry(1, 40, 24),
      new ShaderMaterial({
        fog: false, depthWrite: false,
        uniforms: { sunDir: { value: SUN_DIR } },
        vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vP; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 sunDir; varying vec3 vN; varying vec3 vP; varying vec3 vW;
          void main(){
            float band = sin(vP.y * 11.0 + sin(vP.x * 5.0) * 0.6) * 0.5 + 0.5;
            vec3 base = mix(vec3(0.55, 0.30, 0.52), vec3(0.95, 0.62, 0.50), band);
            base = mix(base, vec3(0.30, 0.22, 0.50), smoothstep(0.55, 1.0, abs(vP.y)));
            vec3 n = normalize(vN);
            float l = clamp(dot(n, sunDir) * 0.8 + 0.28, 0.0, 1.0);
            // back-lit more often than not, so keep a dim ambient and an atmospheric rim
            float rim = pow(1.0 - clamp(dot(n, normalize(cameraPosition - vW)), 0.0, 1.0), 2.5);
            vec3 col = base * (0.2 + l * 0.8) * 0.85 + vec3(1.0, 0.55, 0.4) * rim * 0.55;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    const ring = new Mesh(
      new RingGeometry(1.45, 2.4, 96, 1),
      new ShaderMaterial({
        fog: false, depthWrite: false, transparent: true, side: DoubleSide,
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec3 vP;
          void main(){
            float r = length(vP.xy);
            float t = (r - 1.45) / 0.95;
            float bands = 0.55 + 0.45 * sin(t * 38.0) * sin(t * 11.0 + 1.3);
            float a = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t) * bands * 0.55;
            gl_FragColor = vec4(vec3(0.85, 0.7, 0.62) * (0.5 + bands * 0.4), a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    ring.rotation.x = Math.PI / 2 - 0.42;
    ring.rotation.y = 0.18;
    this.planet.add(ring, body);
    this.planet.scale.setScalar(1500);
    this.planet.position.set(-6200, 8800, -15200);
    // NB: renderOrder on a Group is a group sort key, so set it on the meshes only
    this.planet.traverse((o) => { if (o instanceof Mesh) { o.renderOrder = -8; o.frustumCulled = false; } });
    this.group.add(this.planet);
  }

  /** Keep the sky centred on the camera. */
  update(camera: PerspectiveCamera, pixelRatio: number): void {
    this.group.position.copy(camera.position);
    (this.stars.material as ShaderMaterial).uniforms.px!.value = pixelRatio;
  }

  /** The dome on its own, for building the reflection environment. */
  get env(): Mesh { return this.dome; }
}
