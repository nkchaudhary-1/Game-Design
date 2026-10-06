// Gameplay camera: top-down 3D with a slight perspective. Follows the middle of the battle, zooms with the
// distance between blades (never so far out that the arena is unreadable, never so close that an opponent
// leaves the frame), and adds only small, short moves: a micro-shake on impact, a subtle punch-in on Supers.

import * as THREE from 'three';
import { clamp } from '../core/types';

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 220);
  private readonly target = new THREE.Vector3();
  private dist = 30;
  private shakeMag = 0;
  private punch = 0;
  private aspect = 1;
  private readonly pitch = THREE.MathUtils.degToRad(63);

  constructor(private readonly arenaRadius: number) {
    this.snap([]);
  }

  setAspect(a: number): void {
    this.aspect = Math.max(0.3, a);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Distance along the view axis that fits a floor circle of radius `r` in the limiting dimension. */
  private fit(r: number): number {
    const v = THREE.MathUtils.degToRad(this.camera.fov);
    const h = 2 * Math.atan(Math.tan(v / 2) * this.aspect);
    const dv = (r * Math.sin(this.pitch)) / Math.tan(v / 2);   // the floor is foreshortened vertically
    const dh = r / Math.tan(h / 2);
    return Math.max(dv, dh) * 1.12;
  }

  private desired(focus: Array<{ x: number; z: number }>): { x: number; z: number; d: number } {
    const R = this.arenaRadius;
    const all = this.fit(R + 2.6);
    if (focus.length === 0) return { x: 0, z: 0, d: all };
    let cx = 0, cz = 0;
    for (const f of focus) { cx += f.x; cz += f.z; }
    cx /= focus.length; cz /= focus.length;
    let spread = 0;
    for (const f of focus) spread = Math.max(spread, Math.hypot(f.x - cx, f.z - cz));
    // follow gently: the arena stays centred-ish so it always reads, with a bias towards the action
    const x = cx * 0.45, z = cz * 0.45;
    const d = clamp(this.fit(spread + 5.4), all * 0.74, all);
    return { x, z, d };
  }

  snap(focus: Array<{ x: number; z: number }>): void {
    const t = this.desired(focus);
    this.target.set(t.x, 0, t.z);
    this.dist = t.d;
    this.place(0);
  }

  update(dt: number, focus: Array<{ x: number; z: number }>, reduced: boolean): void {
    const t = this.desired(focus);
    const k = 1 - Math.exp(-dt * 2.4);
    this.target.x += (t.x - this.target.x) * k;
    this.target.z += (t.z - this.target.z) * k;
    this.dist += (t.d - this.dist) * k;
    this.punch *= Math.exp(-dt * 3.2);
    this.shakeMag *= Math.exp(-dt * 16);
    this.place(reduced ? 0 : this.shakeMag);
  }

  private place(shake: number): void {
    const d = this.dist * (1 - this.punch);
    const sx = shake > 0.001 ? (Math.random() - 0.5) * 2 * shake : 0;
    const sz = shake > 0.001 ? (Math.random() - 0.5) * 2 * shake : 0;
    this.camera.position.set(this.target.x + sx, this.target.y + d * Math.sin(this.pitch), this.target.z + d * Math.cos(this.pitch) + sz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target.x + sx, 0, this.target.z + sz);
  }

  /** Micro-shake. `s` is 0–1. */
  shake(s: number): void { this.shakeMag = Math.max(this.shakeMag, 0.06 + 0.3 * s); }
  /** Subtle zoom-in for Super activation. */
  zoomPunch(p = 0.07): void { this.punch = Math.max(this.punch, p); }
  /** Convert a screen position to the floor (y = 0) for aim UI. */
  screenToFloor(nx: number, ny: number): THREE.Vector3 {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera);
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
    return p;
  }
}
