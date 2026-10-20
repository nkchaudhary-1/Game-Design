// BattleView: draws one Match. It reads simulation state (never writes it) and turns sim events into
// feedback: sparks, rings, camera micro-shake, hit-stop. It also owns the aim arrow for the launch phase.

import * as THREE from 'three';
import { ArenaView } from '../arenas/ArenaView';
import { BladeView, visualSpecFor } from '../blades/BladeMesh';
import { CLASS_COLORS, clamp, lerp, TAU } from '../core/types';
import type { Match } from '../combat/Match';
import type { SimEvent } from '../combat/events';
import { CameraRig } from '../vfx/CameraRig';
import { frameTurn } from '../vfx/motion';
import { impact, newDyn, precessionRate, stepDyn, TOPPLE_TILT, wobbleTilt, type Dyn } from '../vfx/bladeDynamics';
import { contactState, type ContactState } from '../vfx/contact';
import { Scuffs } from '../vfx/Scuffs';
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
  private readonly dyn: Dyn[] = [];
  private readonly prec: number[] = [];
  private readonly topple: number[] = [];
  private readonly toppleDir: number[] = [];
  private readonly outFor: number[] = [];
  private readonly scuffs = new Scuffs();
  private readonly flashes: THREE.PointLight[] = [];
  private grindAcc = 0;
  private scuffIn = 0;
  /** Who is rubbing against what this frame (the audio reads it too). */
  contacts: ContactState = { pairs: [], walls: [], level: 0, pan: 0 };
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
      this.dyn.push(newDyn());
      this.prec.push(Math.random() * TAU);
      this.topple.push(0);
      this.toppleDir.push(0);
      this.outFor.push(0);
    });
    this.superFx = new SuperFX(this.fx, (slot) => match.blades[slot].built.def.class, match.blades.length);
    this.scene.add(this.superFx.root);
    this.scene.add(this.fx.root);
    this.fx.ground = (x, z) => this.yAt(x, z);
    this.scene.add(this.scuffs.root);
    // two warm lights that flash on hard hits (always present, at zero, so no shader ever recompiles)
    if (GFX.tier === 'high') {
      for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffd9a6, 0, 14, 2); this.scene.add(l); this.flashes.push(l); }
    }

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

  private yAt = (x: number, z: number): number => this.match.arena.surfaceY(x, z);

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
        this.onHit(e.a, e.b, e.x, e.z, e.nx, e.nz, e.strength);
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
      } else if (e.type === 'arena') {
        this.arena.onEvent(e, { fx: this.fx, y: this.yAt, shake: (k) => this.rig.shake(k) });
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
      const ty = b.bb.body.translation().y;
      const y = ty + arena.surfaceY(x, z);

      // spin: rotation rate follows spin; a spun-out blade coasts to a stop.
      const target = b.out === 'spin' ? 0 : lerp(1.4, 13, Math.pow(clamp(b.spin / 100, 0, 1), 0.7));
      const idle = this.match.phase === 'ready' ? 10 : target;
      this.omegas[i] += (idle - this.omegas[i]) * (1 - Math.exp(-dt * (b.out === 'spin' ? 1.8 : 4)));
      this.angles[i] -= frameTurn(this.omegas[i], dt, v.symmetry); // capped per frame: no wagon-wheel strobing

      const vx = b.vx, vz = b.vz;
      // lean into the motion, and tilt with the floor (the dish, and the Elevation Ring's ramps)
      const gx = (arena.surfaceY(x + 0.3, z) - arena.surfaceY(x - 0.3, z)) / 0.6, gz = (arena.surfaceY(x, z + 0.3) - arena.surfaceY(x, z - 0.3)) / 0.6;
      const k = 0.022;
      // the lean eases (collisions change velocity in one step; the tilt must not snap with it)
      const ease = 1 - Math.exp(-dt * 8);
      this.leanXs[i] += (clamp(vx * k, -0.2, 0.2) - this.leanXs[i]) * ease;
      this.leanZs[i] += (clamp(vz * k, -0.2, 0.2) - this.leanZs[i]) * ease;

      // how a real top behaves: it stands upright while it spins fast, then leans and the lean sweeps round
      // (precession), faster and wider as the spin dies; a spun-out blade topples onto its rim. Hits kick it
      // up off the floor and tilt it on a damped spring; a blade that leaves the arena pitches over as it falls.
      const spin = Math.max(0, b.spin);
      const d = this.dyn[i];
      stepDyn(d, dt);
      this.prec[i] -= precessionRate(spin) * dt;
      let dirA = this.prec[i];
      if (b.out === 'spin') {
        if (this.topple[i] === 0) this.toppleDir[i] = this.prec[i];
        this.topple[i] = Math.min(1, this.topple[i] + dt / 1.1);
        dirA = this.toppleDir[i];
      }
      const tp = this.topple[i], tpE = tp * tp * (3 - 2 * tp);
      const mag = lerp(b.out === 'ring' ? 0 : wobbleTilt(spin) * (0.6 + 0.4 * Math.sin(this.time * 9 + i)), TOPPLE_TILT, tpE);
      let tiltX = Math.cos(dirA) * mag + d.tx, tiltZ = Math.sin(dirA) * mag + d.tz;
      let fall = 0;
      if (b.out === 'ring') {
        this.outFor[i] += dt;
        fall = Math.min(1.4, this.outFor[i] * 2.6);
        const sv = Math.hypot(vx, vz) || 1;
        tiltX += (vx / sv) * fall; tiltZ += (vz / sv) * fall;
      }
      const leanX = this.leanXs[i] - Math.atan(gx) + tiltX;
      const leanZ = this.leanZs[i] - Math.atan(gz) + tiltZ;
      // keep the rim above the floor when the model leans over, and add the hop
      const lift = fall > 0 ? 0 : b.radius * Math.sin(Math.min(0.6, Math.hypot(tiltX, tiltZ))) * 0.85;
      const yy = y + d.hop + lift;
      const blur = b.out ? 0 : Math.pow(clamp(this.omegas[i] / 13, 0, 1), 1.3);

      const stealth = b.hasFlag('stealth') ? 0.35 : 1;
      const ghost = b.hasFlag('ghost') ? 0.3 : 1;
      v.apply({ x, y: yy, z, spinAngle: this.angles[i], leanX, leanZ, alpha: Math.min(stealth, ghost), wobble: 0, blur, scale: 1, leap: b.leap, shield: !!b.shield && b.shield.hits > 0 }, dt);

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

    this.updateContacts(dt);
    for (const l of this.flashes) l.intensity *= Math.exp(-dt * 13);
    this.scuffs.update(dt);
    this.arena.update(this.match.blades.filter((b) => b.alive).map((b) => ({ x: b.x, z: b.z })));
    this.arena.tick(dt, this.match);
    this.superFx.update(this.match, dt, this.yAt, this.views);
    this.fx.update(dt);
    this.rig.update(dt, this.focus(), this.reduced);
  }

  /** A hit: both blades are shoved apart, hop and tilt; the floor is scratched; hard hits flash a light. */
  private onHit(a: number, b: number, x: number, z: number, nx: number, nz: number, strength: number): void {
    const A = this.match.blades[a], B = this.match.blades[b];
    const dx = A.x - B.x, dz = A.z - B.z, l = Math.hypot(dx, dz) || 1;
    impact(this.dyn[a], dx / l, dz / l, strength);
    impact(this.dyn[b], -dx / l, -dz / l, strength);
    if (!this.reduced) this.scuffs.add(x, this.yAt(x, z), z, -nz, nx, 0.9 + 1.5 * strength, strength);
    if (strength > 0.3 && this.flashes.length) {
      const f = this.flashes[0].intensity <= this.flashes[1].intensity ? this.flashes[0] : this.flashes[1];
      f.position.set(x, this.yAt(x, z) + 1.6, z);
      f.intensity = Math.max(f.intensity, 1.5 + 5 * strength);
    }
  }

  /** Sustained contact: grinding sparks and scratches where blades rub together or ride the lip of the pit. */
  private updateContacts(dt: number): void {
    const cs = this.contacts = contactState(this.match);
    if (this.reduced || cs.level < 0.06) return;
    const list: Array<{ x: number; z: number; tx: number; tz: number; level: number; slot: number }> = [
      ...cs.pairs.map((p) => ({ x: p.x, z: p.z, tx: -p.nz, tz: p.nx, level: p.level, slot: p.a })),
      ...cs.walls.map((w) => ({ x: w.x, z: w.z, tx: w.tx, tz: w.tz, level: w.level, slot: w.slot })),
    ];
    const total = list.reduce((s, c) => s + c.level, 0);
    if (total <= 0) return;
    this.grindAcc += Math.min(1, total) * dt * 60;
    while (this.grindAcc >= 1) {
      this.grindAcc -= 1;
      let pick = Math.random() * total, c = list[0];
      for (const it of list) { pick -= it.level; if (pick <= 0) { c = it; break; } }
      this.fx.grind(c.x, this.yAt(c.x, c.z), c.z, c.tx, c.tz, c.level, this.match.blades[c.slot].built.def.class);
    }
    this.scuffIn -= dt;
    if (this.scuffIn <= 0 && cs.level > 0.25) {
      this.scuffIn = 0.16;
      const c = list[Math.floor(Math.random() * list.length)];
      this.scuffs.add(c.x, this.yAt(c.x, c.z), c.z, c.tx, c.tz, 0.8 + Math.random() * 0.9, c.level);
    }
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
    this.scuffs.dispose();
    this.arena.dispose();
    this.scene.traverse((o) => { if (o instanceof THREE.Light) o.dispose(); });
    void glow;
  }
}
