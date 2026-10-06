// BattleView: draws one Match. It reads simulation state (never writes it) and turns sim events into
// feedback: sparks, rings, camera micro-shake, hit-stop. It also owns the aim arrow for the launch phase.

import * as THREE from 'three';
import { ArenaView } from '../arenas/ArenaView';
import { BladeView, visualSpecFor } from '../blades/BladeMesh';
import { TUNING } from '../core/Balance';
import { CLASS_COLORS, clamp, lerp, TAU } from '../core/types';
import type { Match } from '../combat/Match';
import type { SimEvent } from '../combat/events';
import { CameraRig } from '../vfx/CameraRig';
import { frameTurn } from '../vfx/motion';
import { ImpactFX } from '../vfx/ImpactFX';
import { SuperFX } from '../vfx/SuperFX';
import { Trail } from '../vfx/Trails';
import { glow } from './materials';
import { GFX } from './quality';

export const TEAM_COLORS = ['#f2f6ff', '#ffe14a'];

export interface ViewReaction {
  /** Seconds to freeze the simulation (hit-stop = weight). */
  hitStop: number;
  /** Ask the game to run in slow motion for a moment (a knockout). */
  slowMo: number;
}

export class BattleView {
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly arena: ArenaView;
  readonly fx = new ImpactFX();
  private readonly superFx: SuperFX;
  private readonly views: BladeView[] = [];
  private readonly trails: Trail[] = [];
  private readonly angles: number[] = [];
  private readonly omegas: number[] = [];
  private readonly boost: number[] = [];
  private readonly leanXs: number[] = [];
  private readonly leanZs: number[] = [];
  private lastHitStop = -9;
  private readonly aim: THREE.Group;
  private readonly aimMat: THREE.MeshBasicMaterial;
  private readonly aimShaft: THREE.Mesh;
  private readonly aimHead: THREE.Mesh;
  private reduced = false;
  private time = 0;

  constructor(private readonly match: Match, reduced: boolean) {
    this.reduced = reduced;
    this.fx.reduced = reduced;
    this.arena = new ArenaView(match.arena.def, match.arena);
    this.scene.add(this.arena.root);
    this.scene.background = new THREE.Color('#0b1018');
    this.scene.fog = new THREE.Fog('#0b1018', 36, 92);
    this.scene.add(new THREE.HemisphereLight(0xa9bbe8, 0x1a2033, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
    sun.position.set(-11, 22, 12);
    if (GFX.shadows) {
      const R = match.arena.radius + 4;
      sun.castShadow = true;
      sun.shadow.mapSize.set(GFX.shadowSize, GFX.shadowSize);
      Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 4, far: 70 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      sun.shadow.radius = 3;
    }
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6f9bff, 0.85);
    rim.position.set(10, 7, -12);
    this.scene.add(rim);
    this.rig = new CameraRig(match.arena.radius);

    match.blades.forEach((b, i) => {
      const v = new BladeView(visualSpecFor(b.built), TEAM_COLORS[i] ?? '#ffffff');
      this.scene.add(v.root);
      this.views.push(v);
      const cc = CLASS_COLORS[b.built.def.class];
      const t = new Trail(cc.light, b.radius * 0.55);
      this.scene.add(t.mesh);
      this.trails.push(t);
      this.angles.push(Math.random() * TAU);
      this.omegas.push(8);
      this.boost.push(0);
      this.leanXs.push(0);
      this.leanZs.push(0);
    });
    this.superFx = new SuperFX(this.fx, (slot) => match.blades[slot].built.def.class, match.blades.length);
    this.scene.add(this.superFx.root);
    this.scene.add(this.fx.root);

    // launch arrow
    this.aim = new THREE.Group();
    this.aimMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
    this.aimShaft = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.aimMat);
    this.aimHead = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), this.aimMat);
    this.aim.add(this.aimShaft, this.aimHead);
    this.aim.visible = false;
    this.scene.add(this.aim);

    this.rig.snap(this.focus());
  }

  setReduced(r: boolean): void { this.reduced = r; this.fx.reduced = r; }

  private yAt = (x: number, z: number): number => this.arena.dishY(Math.min(Math.hypot(x, z), this.match.arena.radius));

  private focus(): Array<{ x: number; z: number }> {
    const alive = this.match.blades.filter((b) => b.alive && !b.fallen);
    return (alive.length ? alive : this.match.blades).map((b) => ({ x: b.x, z: b.z }));
  }

  resize(aspect: number): void { this.rig.setAspect(aspect); }

  /** Show the launch arrow for `slot` (or hide it with power < 0). */
  setAim(slot: number, angle: number, power: number, color = '#ffffff', opacity = 0.9): void {
    if (power < 0) { this.aim.visible = false; return; }
    const b = this.match.blades[slot];
    const len = 1.8 + 5.2 * power;
    const x0 = b.x + Math.cos(angle) * (b.radius + 0.8), z0 = b.z + Math.sin(angle) * (b.radius + 0.8);
    this.aim.visible = true;
    this.aimMat.color.set(color);
    this.aimMat.opacity = opacity;
    this.aim.position.set(x0, this.yAt(b.x, b.z) + 0.3, z0);
    this.aim.rotation.y = -angle;
    this.aimShaft.scale.set(len, 1, 0.22 + 0.2 * power);
    this.aimShaft.position.set(len / 2, 0, 0);
    this.aimHead.scale.set(1.0 + power * 0.4, 1, 1.0 + power * 0.4);
    this.aimHead.position.set(len + 0.35, 0, 0);
  }

  /** React to simulation events. Returns what the game loop should do about time. */
  handleEvents(events: SimEvent[]): ViewReaction {
    const r: ViewReaction = { hitStop: 0, slowMo: 0 };
    for (const e of events) {
      this.superFx.onEvent(e, this.match, this.yAt);
      if (e.type === 'hit') {
        const a = this.match.blades[e.a], b = this.match.blades[e.b];
        this.fx.hit(e.x, this.yAt(e.x, e.z), e.z, e.nx, e.nz, e.strength, a.built.def.class, b.built.def.class);
        this.rig.shake(e.strength);
        // hit-stop is for the big hits only, and never back-to-back: a clash that keeps re-contacting must not stutter the whole fight
        if (!this.reduced && e.strength > 0.6 && this.time - this.lastHitStop > 0.45) {
          r.hitStop = Math.max(r.hitStop, 0.014 + 0.03 * e.strength);
          this.lastHitStop = this.time;
        }
      } else if (e.type === 'super' && e.state === 'activate') {
        this.rig.zoomPunch(0.06);
        this.rig.shake(0.35);
        this.boost[e.slot] = 1;
      } else if (e.type === 'fx' && (e.kind === 'dash' || e.kind === 'slam')) {
        this.boost[e.slot] = 1;
        if (e.kind === 'slam') this.rig.shake(1);
      } else if (e.type === 'ko') {
        const b = this.match.blades[e.slot];
        if (e.cause === 'ring') {
          const a = Math.atan2(b.z, b.x);
          this.fx.ring(Math.cos(a) * this.match.arena.radius, 0, Math.sin(a) * this.match.arena.radius, 0.6, 4.2, 0.9, '#ff5a36', 1);
          this.fx.burst(Math.cos(a) * this.match.arena.radius, 0, Math.sin(a) * this.match.arena.radius, '#ff9a4d', 28, 10);
        } else {
          this.fx.ring(b.x, this.yAt(b.x, b.z), b.z, 0.8, 3.4, 0.9, CLASS_COLORS.STAMINA.light, 0.9);
        }
        r.slowMo = 0.9;
        this.rig.shake(0.6);
      }
    }
    return r;
  }

  /** Draw-state sync. `alpha` interpolates between the previous and current physics step. */
  update(dt: number, alpha: number): void {
    this.time += dt;
    const arena = this.match.arena;
    this.match.blades.forEach((b, i) => {
      const v = this.views[i];
      const x = lerp(b.prevX, b.x, alpha), z = lerp(b.prevZ, b.z, alpha);
      const r = Math.min(Math.hypot(x, z), arena.radius);
      const ty = b.bb.body.translation().y;
      const y = ty + this.arena.dishY(r);

      // spin: rotation rate follows spin; a spun-out blade coasts to a stop.
      const target = b.out === 'spin' ? 0 : lerp(1.4, 13, Math.pow(clamp(b.spin / 100, 0, 1), 0.7));
      const idle = this.match.phase === 'ready' ? 10 : target;
      this.omegas[i] += (idle - this.omegas[i]) * (1 - Math.exp(-dt * (b.out === 'spin' ? 1.8 : 4)));
      this.angles[i] -= frameTurn(this.omegas[i], dt, v.symmetry); // capped per frame: no wagon-wheel strobing

      // lean into the motion, and tilt with the dish slope
      const vx = b.vx, vz = b.vz;
      const slope = Math.atan(((0.9 * 2) / arena.radius) * (r / arena.radius));
      const inv = r > 0.01 ? 1 / r : 0;
      const k = 0.022;
      // the lean eases (collisions change velocity in one step; the tilt must not snap with it)
      const ease = 1 - Math.exp(-dt * 8);
      this.leanXs[i] += (clamp(vx * k, -0.2, 0.2) - this.leanXs[i]) * ease;
      this.leanZs[i] += (clamp(vz * k, -0.2, 0.2) - this.leanZs[i]) * ease;
      const leanX = this.leanXs[i] + -x * inv * slope;
      const leanZ = this.leanZs[i] + -z * inv * slope;
      const lowSpin = b.out === 'spin' ? 1 : clamp(1 - b.spin / TUNING.WOBBLE_BELOW, 0, 1) * (b.out ? 0 : 1);

      const stealth = b.hasFlag('stealth') ? 0.35 : 1;
      const ghost = b.hasFlag('ghost') ? 0.3 : 1;
      v.apply({ x, y, z, spinAngle: this.angles[i], leanX, leanZ, alpha: Math.min(stealth, ghost), wobble: lowSpin, scale: 1, leap: b.leap, shield: !!b.shield && b.shield.hits > 0 }, dt);

      // trails: Stamina keeps afterimages; others streak when dashing or while a Super is active
      this.boost[i] = Math.max(0, this.boost[i] - dt * 1.6);
      const cls = b.built.def.class;
      const speed = Math.hypot(vx, vz);
      let intensity = 0;
      if (this.match.phase !== 'ready' && !b.fallen) {
        const base = cls === 'STAMINA' ? 0.5 : 0.16;
        intensity = clamp(speed / 5, 0, 1) * base + this.boost[i] * 0.7 + (b.superState === 'ACTIVE' ? 0.22 : 0);
      }
      this.trails[i].update(dt, x, y + 0.05, z, this.reduced ? intensity * 0.6 : intensity);
    });

    this.arena.update(this.match.blades.filter((b) => b.alive).map((b) => ({ x: b.x, z: b.z })));
    this.arena.tick(dt);
    this.superFx.update(this.match, dt, this.yAt, this.views);
    this.fx.update(dt);
    this.rig.update(dt, this.focus(), this.reduced);
  }

  /** Where a blade is on screen, for HUD anchors. */
  bladeWorld(slot: number): THREE.Vector3 {
    const v = this.views[slot].root.position;
    return v.clone();
  }

  dispose(): void {
    this.views.forEach((v) => v.dispose());
    this.trails.forEach((t) => t.dispose());
    this.superFx.dispose();
    this.fx.dispose();
    this.arena.dispose();
    this.scene.traverse((o) => { if (o instanceof THREE.Light) o.dispose(); });
    void glow;
  }
}
