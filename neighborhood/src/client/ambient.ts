import * as THREE from 'three';
import type { MapDef } from '../shared/map';

const VERT = `
attribute float aLife;
uniform float uSize;
uniform float uScale;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (0.55 + aLife * 1.3) * (uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * uOpacity * (1.0 - vLife);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Emitter { x: number; y: number; z: number }

/** A small CPU particle set drawn as soft round points. Used for fountain spray and chimney smoke. */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private age: Float32Array; private life: Float32Array; private aLife: Float32Array;
  private mat: THREE.ShaderMaterial;
  constructor(private emitters: Emitter[], perEmitter: number, private spawn: (i: number, e: Emitter, p: Float32Array, v: Float32Array, rnd: () => number) => number,
              private step: (i: number, p: Float32Array, v: Float32Array, dt: number, t: number) => boolean,
              opts: { size: number; opacity: number; color: number }) {
    const n = emitters.length * perEmitter;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.age = new Float32Array(n); this.life = new Float32Array(n).fill(1); this.aLife = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.aLife, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: opts.size }, uScale: { value: 500 }, uColor: { value: new THREE.Color(opts.color) }, uOpacity: { value: opts.opacity } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < n; i++) { this.age[i] = Math.random() * 3; this.life[i] = -1; }   // staggered start
    this.perEmitter = perEmitter;
  }
  private perEmitter: number;
  set tint(c: THREE.Color) { this.mat.uniforms.uColor.value.copy(c); }
  set scale(s: number) { this.mat.uniforms.uScale.value = s; }
  update(dt: number, t: number) {
    const n = this.age.length;
    for (let i = 0; i < n; i++) {
      if (this.life[i] < 0) { this.life[i] = this.spawn(i, this.emitters[Math.floor(i / this.perEmitter)], this.pos, this.vel, Math.random) ; this.age[i] = 0; continue; }
      this.age[i] += dt;
      const dead = this.age[i] >= this.life[i] || !this.step(i, this.pos, this.vel, dt, t);
      if (dead) { this.life[i] = -1; this.aLife[i] = 1; continue; }
      this.aLife[i] = this.age[i] / this.life[i];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate = true;
  }
}

const WATER_Y = 0.64;

/** Life around the block: fountain spray, chimney smoke, birds. Cheap, deterministic enough, and only simulated near the viewer. */
export class Ambient {
  readonly group = new THREE.Group();
  private fountain: Particles; private smoke: Particles;
  private birds: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; cx: number; cz: number; rad: number; y: number; sp: number; ph: number }[] = [];
  private t = 0;
  private tintA = new THREE.Color(); private tintB = new THREE.Color();

  constructor(map: MapDef) {
    // fountain: a few arcs of droplets from the top bowl
    this.fountain = new Particles([{ x: 26, y: 1.95, z: -26 }], 110,
      (i, e, p, v, rnd) => { const a = rnd() * 6.283, h = 0.6 + rnd() * 1.1; p[i * 3] = e.x; p[i * 3 + 1] = e.y; p[i * 3 + 2] = e.z; v[i * 3] = Math.cos(a) * h; v[i * 3 + 1] = 2.4 + rnd() * 1.6; v[i * 3 + 2] = Math.sin(a) * h; return 1.2 + rnd() * 0.8; },
      (i, p, v, dt) => { v[i * 3 + 1] -= 9.8 * dt; p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt; return p[i * 3 + 1] > WATER_Y; },
      { size: 0.17, opacity: 0.85, color: 0xd5ecf7 });
    this.smoke = new Particles(map.chimneys, 9,
      (i, e, p, v, rnd) => { p[i * 3] = e.x + (rnd() - 0.5) * 0.2; p[i * 3 + 1] = e.y; p[i * 3 + 2] = e.z + (rnd() - 0.5) * 0.2; v[i * 3] = 0.3 + rnd() * 0.25; v[i * 3 + 1] = 0.55 + rnd() * 0.3; v[i * 3 + 2] = 0.08 + (rnd() - 0.5) * 0.2; return 5.5 + rnd() * 2.5; },
      (i, p, v, dt, t) => { p[i * 3] += (v[i * 3] + Math.sin(t * 0.7 + i) * 0.08) * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt; return true; },
      { size: 0.7, opacity: 0.38, color: 0xe6e3dc });
    this.group.add(this.fountain.points, this.smoke.points);

    // birds
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.16, 0, 0, -0.16, 0.95, 0, 0.02], 3));
    wingGeo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x353a40, side: THREE.DoubleSide, fog: true });
    const body = new THREE.BoxGeometry(0.16, 0.14, 0.5);
    const centres: [number, number, number, number][] = [[26, -26, 16, 26], [26, -26, 24, 30], [-30, 0, 22, 24], [-30, 0, 30, 31], [20, 20, 18, 28], [48, -20, 20, 27], [-45, -30, 17, 25]];
    centres.forEach(([cx, cz, rad, y], k) => {
      const g = new THREE.Group();
      const r = new THREE.Mesh(wingGeo, mat), l = new THREE.Mesh(wingGeo, mat);
      l.scale.x = -1;
      g.add(new THREE.Mesh(body, mat), r, l);
      this.group.add(g);
      this.birds.push({ g, l, r, cx, cz, rad, y, sp: (0.16 + (k % 3) * 0.05) * (k % 2 ? 1 : -1), ph: k * 1.7 });
    });
  }

  /** `night` 0..1; `viewer` is the camera position (simulation is skipped when far away). */
  update(dt: number, night: number, viewer: THREE.Vector3, renderer: THREE.WebGLRenderer) {
    this.t += dt;
    const scale = renderer.domElement.clientHeight * renderer.getPixelRatio() * 0.5;
    const dark = 1 - 0.72 * night;
    const nearFountain = Math.hypot(viewer.x - 26, viewer.z + 26) < 55;
    this.fountain.points.visible = nearFountain;
    if (nearFountain) { this.fountain.scale = scale; this.fountain.tint = this.tintA.setHex(0xd5ecf7).multiplyScalar(dark + 0.15); this.fountain.update(dt, this.t); }
    this.smoke.scale = scale; this.smoke.tint = this.tintB.setHex(0xe6e3dc).multiplyScalar(dark);
    this.smoke.update(dt, this.t);
    const day = night < 0.7;
    for (const b of this.birds) {
      b.g.visible = day;
      if (!day) continue;
      const a = b.ph + this.t * b.sp;
      const x = b.cx + Math.cos(a) * b.rad, z = b.cz + Math.sin(a) * b.rad;
      b.g.position.set(x, b.y + Math.sin(this.t * 0.5 + b.ph) * 1.2, z);
      b.g.rotation.y = Math.atan2(-Math.sin(a) * Math.sign(b.sp), Math.cos(a) * Math.sign(b.sp));
      const flap = Math.sin(this.t * 9 + b.ph * 3) * 0.75 - 0.1;
      b.r.rotation.z = flap; b.l.rotation.z = -flap;
    }
  }
}
