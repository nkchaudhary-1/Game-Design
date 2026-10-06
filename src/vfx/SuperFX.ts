// Super and ability visuals: larger, class-specific versions of the impact language. Defense reads as
// blue rings, shields and barriers; Attack as red/orange bursts; Stamina as ghosts, trails and cyan/purple
// distortion. Persistent things (zones, decoys, auras, drain/pull beams) are synced from match state each frame.

import * as THREE from 'three';
import { BladeView, visualSpecFor } from '../blades/BladeMesh';
import { CLASS_COLORS, TAU, type BladeClass } from '../core/types';
import type { Match } from '../combat/Match';
import type { SimEvent } from '../combat/events';
import { ImpactFX } from './ImpactFX';

interface ZoneVisual { group: THREE.Group; inner: THREE.Mesh; ring: THREE.Mesh; kind: string }

export class SuperFX {
  readonly root = new THREE.Group();
  private readonly zones = new Map<number, ZoneVisual>();
  private readonly auras: THREE.Mesh[] = [];
  private readonly decoys = new Map<number, BladeView>();
  private readonly beams: THREE.Line[] = [];
  private time = 0;

  constructor(private readonly fx: ImpactFX, private readonly clsOf: (slot: number) => BladeClass, slots: number) {
    for (let i = 0; i < slots; i++) {
      const a = new THREE.Mesh(
        new THREE.RingGeometry(1.0, 1.22, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      a.visible = false;
      a.renderOrder = 3;
      this.root.add(a);
      this.auras.push(a);
    }
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }),
      );
      l.visible = false;
      l.frustumCulled = false;
      this.root.add(l);
      this.beams.push(l);
    }
  }

  private col(slot: number): string { return CLASS_COLORS[this.clsOf(slot)].main; }
  private light(slot: number): string { return CLASS_COLORS[this.clsOf(slot)].light; }

  onEvent(e: SimEvent, match: Match, yAt: (x: number, z: number) => number): void {
    if (e.type === 'super' && e.state === 'activate') {
      const b = match.blades[e.slot];
      const y = yAt(b.x, b.z);
      this.fx.ring(b.x, y, b.z, 0.8, 7.5, 0.7, this.light(e.slot), 0.9);
      this.fx.ring(b.x, y, b.z, 0.5, 4.4, 0.5, '#ffffff', 0.7);
      this.fx.burst(b.x, y, b.z, this.col(e.slot), 26, 11);
    } else if (e.type === 'super' && e.state === 'end') {
      const b = match.blades[e.slot];
      this.fx.ring(b.x, yAt(b.x, b.z), b.z, 3.2, 1.0, 0.4, this.light(e.slot), 0.5);
    } else if (e.type === 'fx') {
      const y = yAt(e.x, e.z);
      switch (e.kind) {
        case 'radial': this.fx.ring(e.x, y, e.z, 0.5, e.radius ?? 4, 0.42, this.col(e.slot), 0.9); this.fx.burst(e.x, y, e.z, this.col(e.slot), 14, 9); break;
        case 'slamStart': this.fx.ring(e.x, y, e.z, 1, 3, 0.5, '#ffffff', 0.5); break;
        case 'slam': this.fx.ring(e.x, y, e.z, 0.6, (e.radius ?? 5) * 1.1, 0.7, this.col(e.slot), 1); this.fx.ring(e.x, y, e.z, 0.4, (e.radius ?? 5) * 0.7, 0.5, '#ffe9a8', 0.9); this.fx.burst(e.x, y, e.z, '#ffb870', 34, 14); break;
        case 'teleport': this.fx.ring(e.x, y, e.z, 0.4, 3.2, 0.45, this.light(e.slot), 0.9); this.fx.burst(e.x, y, e.z, this.light(e.slot), 16, 7); break;
        case 'shield': this.fx.ring(e.x, y, e.z, 0.8, 4, 0.5, CLASS_COLORS.DEFENSE.light, 0.9); break;
        case 'shieldHit': this.fx.ring(e.x, y, e.z, 1.3, 3.6, 0.35, CLASS_COLORS.DEFENSE.light, 0.9); break;
        case 'shieldBreak': this.fx.ring(e.x, y, e.z, 1, 5, 0.6, CLASS_COLORS.DEFENSE.light, 1); this.fx.burst(e.x, y, e.z, CLASS_COLORS.DEFENSE.light, 22, 10); break;
        case 'decoy': this.fx.ring(e.x, y, e.z, 0.4, 2.6, 0.4, this.light(e.slot), 0.7); break;
        case 'decoyPop': this.fx.ring(e.x, y, e.z, 0.4, 3, 0.4, this.light(e.slot), 0.9); this.fx.burst(e.x, y, e.z, this.light(e.slot), 14, 7); break;
        case 'spinGain': this.fx.ring(e.x, y, e.z, 2.4, 0.6, 0.4, '#ffffff', 0.7); break;
        case 'guard': this.fx.ring(e.x, y, e.z, 2.6, 1.3, 0.35, CLASS_COLORS.DEFENSE.light, 0.8); break;
        case 'ambush': this.fx.ring(e.x, y, e.z, 1.2, 2.8, 0.3, this.light(e.slot), 0.6); break;
        case 'zoneStart': this.fx.ring(e.x, y, e.z, 0.5, (e.radius ?? 3), 0.5, this.col(e.slot), 0.7); break;
        case 'dash': this.fx.burst(e.x, y, e.z, this.light(e.slot), 6, 6); break;
        default: break;
      }
    }
  }

  /** Sync persistent visuals from the match. `yAt` gives the floor height; `views` are the blade models. */
  update(match: Match, dt: number, yAt: (x: number, z: number) => number, views: BladeView[]): void {
    this.time += dt;

    // zones
    const live = new Set<number>();
    for (const z of match.zones) {
      live.add(z.id);
      let v = this.zones.get(z.id);
      if (!v) {
        const group = new THREE.Group();
        const color = z.kind === 'blackhole' ? '#a05cff' : z.kind === 'well' ? CLASS_COLORS.DEFENSE.light : CLASS_COLORS[this.clsOf(z.owner)].main;
        const inner = new THREE.Mesh(
          new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: z.kind === 'blackhole' ? '#12062a' : color, transparent: true, opacity: z.kind === 'blackhole' ? 0.7 : 0.16, depthWrite: false }),
        );
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.94, 1, 40).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        group.add(inner, ring);
        this.root.add(group);
        v = { group, inner, ring, kind: z.kind };
        this.zones.set(z.id, v);
      }
      v.group.position.set(z.x, yAt(z.x, z.z) + 0.07, z.z);
      v.group.scale.setScalar(z.radius);
      const left = z.until - match.t;
      const fade = Math.min(1, left / 0.6);
      if (v.kind === 'trap') { v.ring.rotation.y = this.time * 1.5; (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(this.time * 8); }
      else { const s = 1 - ((this.time * 0.9) % 1) * 0.85; v.ring.scale.setScalar(s); (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * fade * (0.4 + s * 0.6); }
      (v.inner.material as THREE.MeshBasicMaterial).opacity *= 1;
    }
    for (const [id, v] of this.zones) {
      if (!live.has(id)) {
        this.root.remove(v.group);
        v.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
        this.zones.delete(id);
      }
    }

    // decoys: translucent copies of the owner's blade
    const liveD = new Set<number>();
    for (const d of match.decoys) {
      liveD.add(d.owner);
      let v = this.decoys.get(d.owner);
      if (!v) {
        v = new BladeView(visualSpecFor(match.blades[d.owner].built), null);
        this.root.add(v.root);
        this.decoys.set(d.owner, v);
      }
      v.apply({ x: d.x, y: yAt(d.x, d.z) + 0.2, z: d.z, spinAngle: this.time * -9, leanX: 0, leanZ: 0, alpha: 0.38 + 0.1 * Math.sin(this.time * 9), wobble: 0, scale: 1, leap: 0, shield: false }, dt);
    }
    for (const [slot, v] of this.decoys) {
      if (!liveD.has(slot)) { this.root.remove(v.root); v.dispose(); this.decoys.delete(slot); }
    }

    // auras for active Supers
    match.blades.forEach((b, i) => {
      const a = this.auras[i];
      const on = b.superState === 'ACTIVE' && b.alive;
      a.visible = on;
      if (!on) return;
      const mat = a.material as THREE.MeshBasicMaterial;
      mat.color.set(this.light(i));
      mat.opacity = 0.45 + 0.25 * Math.sin(this.time * 7 + i);
      const r = b.radius * (1.55 + 0.08 * Math.sin(this.time * 6));
      a.position.set(views[i].root.position.x, yAt(b.x, b.z) + 0.06, views[i].root.position.z);
      a.scale.setScalar(r);
      a.rotation.y = this.time * 1.4;
    });

    // pull / drain beams between owner and target
    let bi = 0;
    const beam = (ax: number, az: number, bx: number, bz: number, color: string) => {
      const l = this.beams[bi++];
      if (!l) return;
      l.visible = true;
      (l.material as THREE.LineBasicMaterial).color.set(color);
      const p = l.geometry.attributes.position as THREE.BufferAttribute;
      p.setXYZ(0, ax, yAt(ax, az) + 0.3, az); p.setXYZ(1, bx, yAt(bx, bz) + 0.3, bz);
      p.needsUpdate = true;
    };
    for (const d of match.drains) {
      const o = match.blades[d.owner], t = match.opponentOf(d.owner);
      if (o && t && Math.hypot(o.x - t.x, o.z - t.z) < d.radius + t.radius) beam(o.x, o.z, t.x, t.z, '#b78cff');
    }
    for (const p of match.pulls) {
      const o = match.blades[p.owner], t = match.opponentOf(p.owner);
      if (o && t && Math.hypot(o.x - t.x, o.z - t.z) < p.radius) beam(o.x, o.z, t.x, t.z, '#ffb870');
    }
    for (let i = bi; i < this.beams.length; i++) this.beams[i].visible = false;
    void TAU;
  }

  clear(): void {
    for (const v of this.zones.values()) this.root.remove(v.group);
    this.zones.clear();
    for (const v of this.decoys.values()) { this.root.remove(v.root); v.dispose(); }
    this.decoys.clear();
    this.auras.forEach((a) => { a.visible = false; });
    this.beams.forEach((b) => { b.visible = false; });
  }

  dispose(): void { this.clear(); }
}
