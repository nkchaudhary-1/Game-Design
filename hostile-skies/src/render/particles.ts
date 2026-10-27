// A single pooled particle system (soft round sprites). Two layers share the code: additive (fire, sparks, energy) and
// alpha-blended (smoke, vapour). Particles are plain typed arrays updated on the CPU; a ring buffer recycles the oldest.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial,
} from 'three';

const VERT = /* glsl */ `
attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(size * scale / max(-mv.z, 0.1), 0.0, 420.0);
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = 1.0 - d; a *= a;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Layer {
  readonly points: Points;
  private n: number;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private size: Float32Array;
  private grow: Float32Array; private life: Float32Array; private age: Float32Array; private drag: Float32Array;
  private grav: Float32Array; private a0: Float32Array; private s0: Float32Array;
  private geo = new BufferGeometry();
  private next = 0;
  private mat: ShaderMaterial;

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n); this.grow = new Float32Array(n); this.life = new Float32Array(n);
    this.age = new Float32Array(n).fill(1e9); this.drag = new Float32Array(n); this.grav = new Float32Array(n);
    this.a0 = new Float32Array(n); this.s0 = new Float32Array(n);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(35048));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 4).setUsage(35048));
    this.geo.setAttribute('size', new BufferAttribute(this.size, 1).setUsage(35048));
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
      blending: additive ? AdditiveBlending : NormalBlending, uniforms: { scale: { value: 800 } },
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  set scale(v: number) { this.mat.uniforms.scale!.value = v; }

  emit(
    x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number,
    r: number, g: number, b: number, a: number, drag: number, grav: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.a0[i] = a; this.s0[i] = size;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.age[i] = 0; this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i]! + dt;
      if (age >= this.life[i]!) {
        if (this.size[i] !== 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; }
        this.age[i] = 1e9;
        continue;
      }
      this.age[i] = age;
      const k = 1 - Math.min(1, this.drag[i]! * dt);
      const i3 = i * 3;
      this.vel[i3] = this.vel[i3]! * k;
      this.vel[i3 + 1] = this.vel[i3 + 1]! * k - this.grav[i]! * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2]! * k;
      this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt;
      this.pos[i3 + 1] = this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt;
      this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;
      const t = age / this.life[i]!;
      this.size[i] = this.s0[i]! + this.grow[i]! * age;
      // quick fade-in, long fade-out
      this.col[i * 4 + 3] = this.a0[i]! * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
    this.geo.attributes.size!.needsUpdate = true;
  }

  clear(): void { this.age.fill(1e9); this.size.fill(0); this.col.fill(0); }
}

export class Particles {
  readonly add: Layer;
  readonly smoke: Layer;

  constructor(total: number) {
    this.add = new Layer(Math.round(total * 0.6), true);
    this.smoke = new Layer(Math.round(total * 0.4), false);
  }

  /** Pixels per world unit at distance 1, for the current viewport and vertical FOV (radians). */
  setScale(heightPx: number, fovRad: number): void {
    const s = heightPx / (2 * Math.tan(fovRad / 2));
    this.add.scale = s; this.smoke.scale = s;
  }

  update(dt: number): void { this.add.update(dt); this.smoke.update(dt); }
  clear(): void { this.add.clear(); this.smoke.clear(); }
}
