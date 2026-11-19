import * as THREE from 'three';
import { TAG_CAB, TAG_GLASS, TAG_NOCAM, type CollisionWorld, type Solid } from '../shared/collision';
import { clamp, damp, lerp } from '../shared/math';

/** Third-person rig: behind and slightly above, collides with walls, never snaps. */
export class CameraRig {
  yaw = 0; pitch = 0.32; dist = 4.6;
  private cur = 4.6;
  private target = new THREE.Vector3();
  private fov = 62;
  private cabBlend = 0;
  private effPitch = 0.32;
  /** Skip solids hidden by the cut-away. */
  isHidden: (group: number) => boolean = () => false;

  constructor(private cam: THREE.PerspectiveCamera, private world: CollisionWorld) {}

  zoom(delta: number) { this.dist = clamp(this.dist + delta * 0.004, 2.2, 8.5); }
  rotate(dyaw: number, dpitch: number) {
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -0.28, 1.25);
  }

  /** `focus` = point the camera orbits (head height). */
  update(dt: number, focus: THREE.Vector3, sprinting: boolean, snap = false, inCab = false) {
    this.target.copy(focus);
    // In the 2 m cab there is no room behind the player: lift the camera above and look down into the cab instead.
    this.cabBlend = snap ? (inCab ? 1 : 0) : damp(this.cabBlend, inCab ? 1 : 0, 4, dt);
    const basePitch = lerp(this.pitch, Math.max(this.pitch, 1.05), this.cabBlend);
    const dist = lerp(this.dist, Math.min(this.dist, 2.7), this.cabBlend);
    const skipCab = this.cabBlend > 0.5;
    const skip = (s: Solid) => (s.tag & (TAG_GLASS | TAG_NOCAM)) !== 0 || (skipCab && (s.tag & TAG_CAB) !== 0) || this.isHidden(s.group);
    const probe = (pitch: number) => {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const dx = -Math.sin(this.yaw) * cp, dy = sp, dz = -Math.cos(this.yaw) * cp;
      const hit = this.world.raycast(focus.x, focus.y, focus.z, dx, dy, dz, dist + 0.3, 0.22, skip);
      return { dx, dy, dz, free: clamp(hit - 0.15, 0.55, dist) };
    };
    // Boxed in (corridor, room corner)? Swing up and over — the cut-away has already hidden the ceiling.
    let chosen = basePitch, free = probe(basePitch).free;
    if (free < dist * 0.9) {
      for (const add of [0.28, 0.56, 0.84]) {
        const p = Math.min(1.32, basePitch + add), f = probe(p).free;
        if (f > free) { free = f; chosen = p; }
        if (f >= dist * 0.9) break;
      }
    }
    this.effPitch = snap ? chosen : damp(this.effPitch, chosen, chosen > this.effPitch ? 7 : 3, dt);
    const r = probe(this.effPitch);
    this.cur = snap ? r.free : r.free < this.cur ? damp(this.cur, r.free, 40, dt) : damp(this.cur, r.free, 2.6, dt);
    this.cam.position.set(focus.x + r.dx * this.cur, focus.y + r.dy * this.cur, focus.z + r.dz * this.cur);
    if (this.cam.position.y < 0.2) this.cam.position.y = 0.2;
    this.cam.lookAt(focus.x, focus.y + 0.1, focus.z);
    this.fov = damp(this.fov, sprinting ? 67 : 62, 5, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
  get distance() { return this.cur; }
}
