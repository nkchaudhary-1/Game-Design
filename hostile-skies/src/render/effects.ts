// Visual effects built from the particle pools: explosions, sparks, shockwaves, smoke and vapour trails.
// Pure presentation; nothing here is seen by the simulation (so it can use Math.random freely).

import { AdditiveBlending, Camera, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, Scene, Vector3 } from 'three';
import { Particles } from './particles';

interface RingFx { mesh: Mesh; mat: MeshBasicMaterial; age: number; life: number; size: number; on: boolean }

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const _d = new Vector3();

/** Random unit vector, optionally squashed vertically. */
function sphereDir(out: Vector3, flatten = 1): Vector3 {
  out.set(Math.random() * 2 - 1, (Math.random() * 2 - 1) * flatten, Math.random() * 2 - 1);
  const l = out.length();
  return l < 1e-3 ? out.set(0, 1, 0) : out.multiplyScalar(1 / l);
}

export class Effects {
  readonly particles: Particles;
  private rings: RingFx[] = [];
  /** Camera shake energy, decays on its own. Read by the camera rig. */
  shake = 0;

  constructor(scene: Scene, particleBudget: number) {
    this.particles = new Particles(particleBudget);
    scene.add(this.particles.smoke.points, this.particles.add.points);
    const geo = new RingGeometry(0.88, 1, 56);
    for (let i = 0; i < 8; i++) {
      const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 7;
      scene.add(mesh);
      this.rings.push({ mesh, mat, age: 0, life: 1, size: 1, on: false });
    }
  }

  ring(pos: Vector3, size: number, life: number, r: number, g: number, b: number): void {
    const fx = this.rings.find((x) => !x.on) ?? this.rings.reduce((a, c) => (c.age / c.life > a.age / a.life ? c : a));
    fx.on = true; fx.age = 0; fx.life = life; fx.size = size;
    fx.mat.color.setRGB(r, g, b);
    fx.mesh.position.copy(pos);
    fx.mesh.visible = true;
  }

  // ---- explosions --------------------------------------------------------------------------------------------

  /** Energy burst for alien ships: lime-white core, teal and acid-green sparks, a puff of dark smoke. */
  alienBurst(pos: Vector3, size: number): void {
    const P = this.particles;
    P.add.emit(pos.x, pos.y, pos.z, 0, 0, 0, size * 2.4, size * 4, 0.22, 2.6, 3.2, 1.4, 1, 0, 0);
    const n = Math.min(26, 8 + Math.round(size / 5));
    for (let i = 0; i < n; i++) {
      sphereDir(_d).multiplyScalar(rnd(0.6, 2.6) * size);
      const warm = Math.random() < 0.35;
      P.add.emit(pos.x, pos.y, pos.z, _d.x, _d.y, _d.z, size * rnd(0.12, 0.3), -size * 0.1, rnd(0.35, 0.9),
        warm ? 3 : 1.4, warm ? 1.6 : 3, warm ? 0.4 : 0.5, 1, 2.2, 6);
    }
    for (let i = 0; i < 5; i++) {
      sphereDir(_d).multiplyScalar(size * rnd(0.1, 0.6));
      P.smoke.emit(pos.x, pos.y, pos.z, _d.x, _d.y + size * 0.3, _d.z, size * 0.5, size * 0.5, rnd(1.2, 2.2), 0.06, 0.06, 0.07, 0.6, 0.9, -2);
    }
    this.ring(pos, size * 1.3, 0.4, 0.8, 2, 0.5);
  }

  /** Orange fireball with rising smoke, sparks and a shockwave. */
  fireball(pos: Vector3, size: number, ground = false): void {
    const P = this.particles;
    P.add.emit(pos.x, pos.y, pos.z, 0, 0, 0, size * 2.6, size * 3, 0.3, 3.4, 2.8, 1.8, 1, 0, 0);
    const n = Math.min(46, 14 + Math.round(size / 6));
    for (let i = 0; i < n; i++) {
      sphereDir(_d, ground ? 0.5 : 1).multiplyScalar(rnd(0.2, 1.5) * size);
      P.add.emit(pos.x, pos.y, pos.z, _d.x, _d.y + (ground ? size * 0.5 : 0), _d.z, size * rnd(0.45, 0.85), size * 0.5, rnd(0.5, 1.15),
        rnd(2.2, 3.4), rnd(0.9, 1.7), rnd(0.15, 0.4), 0.85, 1.6, 0);
    }
    for (let i = 0; i < Math.min(26, 8 + Math.round(size / 8)); i++) {
      sphereDir(_d).multiplyScalar(rnd(0.3, 1.2) * size);
      P.smoke.emit(pos.x + _d.x * 0.3, pos.y + _d.y * 0.3, pos.z + _d.z * 0.3, _d.x * 0.4, _d.y * 0.4 + size * 0.35, _d.z * 0.4,
        size * rnd(0.5, 0.9), size * 0.55, rnd(2.2, 4.2), 0.05, 0.045, 0.05, 0.75, 0.7, -1.4);
    }
    for (let i = 0; i < Math.min(40, 10 + Math.round(size / 5)); i++) {
      sphereDir(_d).multiplyScalar(rnd(1.2, 3.4) * size);
      P.add.emit(pos.x, pos.y, pos.z, _d.x, _d.y, _d.z, Math.max(1.4, size * 0.04), 0, rnd(0.6, 1.6), 3, 2.2, 0.8, 1, 0.8, 55);
    }
    this.ring(pos, size * 2.2, 0.7, 2, 1.2, 0.5);
  }

  /** Missile detonation: smaller, whiter fireball. */
  missileBlast(pos: Vector3, size: number): void {
    this.fireball(pos, size * 0.75);
    this.particles.add.emit(pos.x, pos.y, pos.z, 0, 0, 0, size * 2.6, size * 4, 0.16, 3.4, 3.4, 3.4, 1, 0, 0);
  }

  /** Giant, slow blast for the Leviathan and the cities: lots of mid-size fireballs spread through a volume. */
  bigBlast(pos: Vector3, size: number): void {
    for (let i = 0; i < 5; i++) {
      sphereDir(_d).multiplyScalar(size * rnd(0.1, 0.5));
      _d.add(pos);
      this.fireball(_d, size * rnd(0.3, 0.55));
    }
    this.ring(pos, size * 2.8, 1, 2, 1.5, 0.8);
    this.ring(pos, size * 1.6, 0.6, 2.2, 2.2, 2.2);
  }

  /** Small impact: sparks and a flash. */
  sparks(pos: Vector3, r = 1, g = 2.2, b = 1.2, n = 6, speed = 60): void {
    const P = this.particles;
    P.add.emit(pos.x, pos.y, pos.z, 0, 0, 0, 7, 0, 0.1, r * 1.5, g * 1.5, b * 1.5, 1, 0, 0);
    for (let i = 0; i < n; i++) {
      sphereDir(_d).multiplyScalar(rnd(0.3, 1) * speed);
      P.add.emit(pos.x, pos.y, pos.z, _d.x, _d.y, _d.z, rnd(0.8, 1.8), 0, rnd(0.2, 0.5), r, g, b, 1, 1.5, 30);
    }
  }

  /** Cyan crackle where shots strike a shield. */
  shieldSpark(pos: Vector3): void { this.sparks(pos, 0.8, 1.6, 3, 8, 90); this.ring(pos, 40, 0.3, 0.5, 1.4, 2.4); }

  /** Dust and debris where rounds hit the ground. */
  dust(pos: Vector3, size: number): void {
    this.particles.smoke.emit(pos.x, pos.y + 2, pos.z, rnd(-3, 3), rnd(4, 10), rnd(-3, 3), size * 0.4, size * 0.6, rnd(0.8, 1.6), 0.28, 0.24, 0.2, 0.5, 1, -1);
  }

  /** A ship warping in. */
  warp(pos: Vector3): void {
    this.particles.add.emit(pos.x, pos.y, pos.z, 0, 0, 0, 160, 360, 0.45, 1.6, 3, 1.2, 1, 0, 0);
    this.ring(pos, 150, 0.55, 0.9, 2.4, 0.6);
    this.ring(pos, 80, 0.4, 0.5, 1.2, 1.8);
  }

  muzzle(pos: Vector3): void {
    this.particles.add.emit(pos.x, pos.y, pos.z, 0, 0, 0, 3.2, 0, 0.05, 3, 2.4, 1.3, 1, 0, 0);
  }

  smokeTrail(pos: Vector3, size: number, dark = true): void {
    const c = dark ? 0.09 : 0.7;
    this.particles.smoke.emit(pos.x, pos.y, pos.z, rnd(-2, 2), rnd(-1, 3), rnd(-2, 2), size, size * 1.2, rnd(1.2, 2), c, c, c * 1.05, dark ? 0.7 : 0.35, 0.6, 0);
  }

  fireTrail(pos: Vector3, size: number): void {
    this.particles.add.emit(pos.x, pos.y, pos.z, rnd(-3, 3), rnd(-3, 3), rnd(-3, 3), size, -size * 0.6, rnd(0.2, 0.4), 3, 1.4, 0.35, 1, 1, 0);
  }

  glow(pos: Vector3, size: number, life: number, r: number, g: number, b: number): void {
    this.particles.add.emit(pos.x, pos.y, pos.z, 0, 0, 0, size, 0, life, r, g, b, 0.7, 0, 0);
  }

  update(dt: number, camera: Camera): void {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.particles.update(dt);
    for (const fx of this.rings) {
      if (!fx.on) continue;
      fx.age += dt;
      const t = fx.age / fx.life;
      if (t >= 1) { fx.on = false; fx.mesh.visible = false; continue; }
      const e = 1 - (1 - t) * (1 - t);
      fx.mesh.scale.setScalar(Math.max(0.01, fx.size * (0.15 + 0.85 * e)));
      fx.mesh.quaternion.copy(camera.quaternion);
      fx.mat.opacity = (1 - t) * (1 - t);
    }
  }

  addShake(amount: number): void { this.shake = Math.min(1.6, this.shake + amount); }

  clear(): void {
    this.particles.clear();
    for (const fx of this.rings) { fx.on = false; fx.mesh.visible = false; }
    this.shake = 0;
  }
}
