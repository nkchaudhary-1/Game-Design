// GameView: owns the WebGL scene and turns a World (pure sim state) into pictures. It builds and updates models,
// projectiles and effects from the world every frame, reacts to sim events (explosions, hits, warp-ins), drives the
// camera rig, and renders through bloom. It never changes the world.

import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, Color, DirectionalLight, FogExp2, Group, HalfFloatType, HemisphereLight,
  IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PMREMGenerator, Quaternion, Scene,
  ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Alien } from '../sim/aliens';
import { pitchAngle } from '../sim/aircraft';
import { surfaceHeight } from '../sim/terrain';
import type { SimEvent, World } from '../sim/world';
import { CityView } from './cities';
import { Effects } from './effects';
import { beamTime, buildAlien, buildJet, buildMissile, disposeModel, type AlienModel, type JetModel } from './models';
import { GFX } from './quality';
import { PALETTE, Sky, SUN_DIR } from './sky';
import { Sea, TerrainView } from './terrain';

export type CamMode = 'chase' | 'cockpit';

const FOG_DENSITY = 0.00026;
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const ZERO = new Vector3();
const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();

interface AlienView { model: AlienModel; kind: Alien['kind']; trailT: number }

/** Instanced streaks and orbs for cannon rounds and alien fire. */
class ProjectileView {
  readonly bullets: InstancedMesh;
  readonly bolts: InstancedMesh;
  readonly orbs: InstancedMesh;

  constructor(scene: Scene) {
    const mk = (geo: BoxGeometry | IcosahedronGeometry, c: Color, n: number) => {
      const m = new InstancedMesh(geo, new MeshBasicMaterial({ color: c, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false }), n);
      m.frustumCulled = false; m.count = 0; m.renderOrder = 6;
      scene.add(m);
      return m;
    };
    this.bullets = mk(new BoxGeometry(0.5, 0.5, 20).translate(0, 0, -8), new Color(1.3, 2.7, 3.4), 400);
    this.bolts = mk(new BoxGeometry(1.5, 1.5, 15).translate(0, 0, -5), new Color(1.5, 3.2, 0.5), 300);
    this.orbs = mk(new IcosahedronGeometry(1, 1), new Color(2.4, 3.4, 1.4), 80);
  }

  update(w: World, fx: Effects): void {
    let n = 0;
    for (const b of w.bullets) {
      if (n >= 400) break;
      _v.copy(b.vel).normalize();
      _m.lookAt(ZERO, _v, Y).setPosition(b.pos);
      this.bullets.setMatrixAt(n++, _m);
    }
    this.bullets.count = n;
    this.bullets.instanceMatrix.needsUpdate = true;

    let nb = 0, no = 0;
    for (const b of w.bolts) {
      if (b.kind === 'orb') {
        if (no >= 80) continue;
        _m.makeScale(b.radius, b.radius, b.radius).setPosition(b.pos);
        this.orbs.setMatrixAt(no++, _m);
        fx.glow(b.pos, 70, 0.07, 1.1, 1.8, 0.5);
      } else {
        if (nb >= 300) continue;
        _v.copy(b.vel).normalize();
        _m.lookAt(ZERO, _v, Y).setPosition(b.pos);
        this.bolts.setMatrixAt(nb++, _m);
        fx.glow(b.pos, 16, 0.05, 0.8, 1.6, 0.3);
      }
    }
    this.bolts.count = nb; this.orbs.count = no;
    this.bolts.instanceMatrix.needsUpdate = true; this.orbs.instanceMatrix.needsUpdate = true;
  }
}

export interface ViewState {
  mode: CamMode | 'orbit';
  /** For 'orbit': distance, azimuth (rad), elevation (rad) around the player aircraft. */
  orbit?: { dist: number; az: number; el: number };
  showJet?: boolean;
}

export class GameView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(64, 1, 1.5, 30000);
  readonly fx: Effects;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private sky = new Sky();
  private terrain: TerrainView;
  private sea: Sea;
  private cities = new CityView();
  private proj: ProjectileView;
  private jet: JetModel = buildJet();
  private aliens = new Map<number, AlienView>();
  private missiles = new Map<number, Group>();
  private camQ = new Quaternion();
  private camInit = false;
  private t = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private rt: WebGLRenderTarget | null = null;
  private trailT = 0;
  /** Consumed by the HUD for hit-flash style feedback. */
  reducedMotion = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas, antialias: GFX.msaa === 0 && !GFX.bloom, powerPreference: 'high-performance',
      preserveDrawingBuffer: new URLSearchParams(location.search).has('shot'),
    });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = PALETTE.fog.clone();
    this.scene.fog = new FogExp2(PALETTE.fog.clone(), FOG_DENSITY);

    const hemi = new HemisphereLight(new Color('#7f78b8'), new Color('#2c2a3a'), 0.9);
    const sun = new DirectionalLight(new Color('#ffbd8a'), 1.9);
    sun.position.copy(SUN_DIR).multiplyScalar(1000);
    this.scene.add(hemi, sun, this.sky.group);

    // image-based lighting from the dusk sky so the hulls pick up its colours
    const pm = new PMREMGenerator(this.renderer);
    const envScene = new Scene();
    envScene.add(new Mesh(this.sky.env.geometry, this.sky.env.material));
    this.scene.environment = pm.fromScene(envScene, 0, 0.1, 100).texture;
    this.scene.environmentIntensity = 0.7;
    pm.dispose();

    this.terrain = new TerrainView(this.scene);
    this.sea = new Sea(FOG_DENSITY);
    this.scene.add(this.sea.mesh, this.cities.group);
    this.fx = new Effects(this.scene, GFX.particles);
    this.proj = new ProjectileView(this.scene);
    this.scene.add(this.jet.root);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.applyTier();
  }

  /** (Re)build the parts that depend on the graphics tier. */
  applyTier(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, GFX.maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.rt?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (GFX.bloom) {
      this.rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: GFX.msaa });
      this.composer = new EffectComposer(this.renderer, this.rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.62, 0.7, 0.95);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.terrain.reset();
    this.resize(this.w, this.h);
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(this.w, this.h);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  /** Build the terrain around a point immediately, so the first frame has no pop-in. */
  prime(x: number, z: number): void { this.terrain.prime(x, z); }

  /** Drop every model and effect (new mission). */
  reset(): void {
    for (const v of this.aliens.values()) {
      this.scene.remove(v.model.root);
      disposeModel(v.model.root);
      if (v.model.beam) { this.scene.remove(v.model.beam); disposeModel(v.model.beam); }
    }
    this.aliens.clear();
    for (const g of this.missiles.values()) { this.scene.remove(g); disposeModel(g); }
    this.missiles.clear();
    this.fx.clear();
    this.camInit = false;
  }

  /** World -> CSS pixel coordinates. `z` > 1 means behind the camera. */
  project(p: Vector3, out: { x: number; y: number; behind: boolean }): void {
    _v3.copy(p).project(this.camera);
    out.behind = _v3.z > 1 || _v3.z < -1 || (_v.copy(p).sub(this.camera.position).dot(this.camera.getWorldDirection(_v2)) < 0);
    out.x = (_v3.x * 0.5 + 0.5) * this.w;
    out.y = (-_v3.y * 0.5 + 0.5) * this.h;
  }

  get pixelHeight(): number { return this.h * this.dpr; }

  // ---- events --------------------------------------------------------------------------------------------------

  consume(events: readonly SimEvent[]): void {
    const camPos = this.camera.position;
    for (const e of events) {
      switch (e.type) {
        case 'explode': {
          const d = e.pos.distanceTo(camPos);
          const kick = Math.min(1.1, (e.size / 160) * (900 / (d + 250)));
          if (kick > 0.04) this.fx.addShake(kick * (this.reducedMotion ? 0.25 : 1));
          if (e.kind === 'alien') this.fx.alienBurst(e.pos, e.size);
          else if (e.kind === 'missile') this.fx.missileBlast(e.pos, e.size);
          else if (e.kind === 'boss' || e.kind === 'city') this.fx.bigBlast(e.pos, e.size);
          else if (e.kind === 'ground') this.fx.fireball(e.pos, e.size, true);
          else this.fx.fireball(e.pos, e.size);
          break;
        }
        case 'fire':
          if (e.who === 'player' && e.kind === 'cannon') this.fx.muzzle(e.pos);
          break;
        case 'hit':
          if (e.target === 'alien') this.fx.sparks(e.pos, 1.2, 2.6, 1.0, 5, 70);
          else if (e.target === 'hull') this.fx.sparks(e.pos, 1.8, 1.6, 1.2, 4, 45);
          else if (e.target === 'shield') this.fx.shieldSpark(e.pos);
          else if (e.target === 'player') this.fx.addShake((this.reducedMotion ? 0.12 : 0.45) + Math.min(0.4, e.amount / 60));
          break;
        case 'warp': this.fx.warp(e.pos); break;
        default: break;
      }
    }
  }

  // ---- per-frame -----------------------------------------------------------------------------------------------

  render(w: World, dt: number, state: ViewState): void {
    this.t += dt;
    beamTime.value = this.t;

    this.syncJet(w, state);
    this.syncAliens(w, dt);
    this.syncMissiles(w);
    this.proj.update(w, this.fx);
    this.cities.update(w.cities, this.t, dt, this.fx);

    this.updateCamera(w, dt, state);
    this.terrain.update(this.camera.position.x, this.camera.position.z, 2);
    this.sea.update(this.t, this.camera.position.x, this.camera.position.z);
    this.sky.update(this.camera, this.dpr);
    this.fx.particles.setScale(this.h * this.dpr, (this.camera.fov * Math.PI) / 180);
    this.fx.update(dt, this.camera);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private syncJet(w: World, state: ViewState): void {
    const ac = w.ac, j = this.jet;
    const show = w.playerAlive && state.mode !== 'cockpit' && state.showJet !== false;
    j.root.visible = show;
    if (!show) return;
    j.root.position.copy(ac.pos);
    j.root.quaternion.copy(ac.q);
    const th = ac.thrust;
    const flick = 0.9 + Math.random() * 0.2;
    j.flame.visible = th > 0.18;
    j.flame.scale.set(0.5 + th * 0.45, 0.5 + th * 0.45, (0.6 + th * 3.6) * flick);
    j.glow.scale.setScalar((4 + th * 5) * flick);
    j.strobe.visible = this.t % 1.3 < 0.09;
    // contrail / engine heat shimmer and wingtip vapour in hard turns
    this.trailT -= 0.016;
    if (this.trailT <= 0 && ac.speed > 40) {
      this.trailT = 0.03;
      const vap = Math.max(0, ac.g - 4.2) / 6;
      if (vap > 0) {
        for (const s of [-1, 1]) {
          _v.set(6.05 * s, 0.1, 5).applyQuaternion(ac.q).add(ac.pos);
          this.fx.smokeTrail(_v, 2.2 + vap * 2, false);
        }
      }
      if (ac.thrust > 1.05) {
        _v.set(0, 0, 10).applyQuaternion(ac.q).add(ac.pos);
        this.fx.fireTrail(_v, 2.4);
      }
    }
  }

  private syncAliens(w: World, dt: number): void {
    const seen = new Set<number>();
    for (const a of w.aliens) {
      seen.add(a.id);
      let v = this.aliens.get(a.id);
      if (!v) {
        const model = buildAlien(a.kind);
        v = { model, kind: a.kind, trailT: 0 };
        this.scene.add(model.root);
        if (model.beam) {
          // beams live in world space so they don't inherit the ship's tilt
          model.beam.removeFromParent();
          this.scene.add(model.beam);
        }
        this.aliens.set(a.id, v);
      }
      const m = v.model, r = m.root;
      r.position.copy(a.pos);
      if (a.kind === 'mothership') {
        r.quaternion.identity();
      } else if (a.kind === 'pod' || a.kind === 'core') {
        r.quaternion.identity();
      } else {
        _m.lookAt(ZERO, a.dir, Y);
        r.quaternion.setFromRotationMatrix(_m);
        _q2.setFromAxisAngle(Z, -a.bank);
        r.quaternion.multiply(_q2);
        if (a.dying > 0) {
          const k = 1 - a.dying / Math.max(a.dyingMax, 0.01);
          _q2.setFromAxisAngle(Z, a.a * (k * 14 + 1));
          r.quaternion.multiply(_q2);
          _q2.setFromAxisAngle(new Vector3(1, 0, 0), k * 1.4);
          r.quaternion.multiply(_q2);
        }
      }
      // warp-in: ships swell out of their flash
      const born = a.kind === 'mothership' ? 1 : Math.min(1, 0.2 + a.age * 2.2);
      r.scale.setScalar(born);
      m.animate(a, this.t, dt);
      if (m.flash) {
        const mat = m.flash.material as MeshBasicMaterial;
        mat.opacity = a.hitFlash * 0.6;
        m.flash.visible = a.hitFlash > 0.01;
      }
      this.updateAlienBeam(w, a, v);
      // wrecks burn
      if (a.dying > 0 && a.kind !== 'mothership' && a.kind !== 'core') {
        v.trailT -= dt;
        if (v.trailT <= 0) {
          v.trailT = 0.04;
          const s = a.kind === 'harvester' ? 22 : a.kind === 'lancer' ? 9 : 5;
          this.fx.fireTrail(a.pos, s);
          this.fx.smokeTrail(a.pos, s * 1.4, true);
        }
      }
    }
    for (const [id, v] of this.aliens) {
      if (seen.has(id)) continue;
      this.scene.remove(v.model.root);
      disposeModel(v.model.root);
      if (v.model.beam) { this.scene.remove(v.model.beam); disposeModel(v.model.beam); }
      this.aliens.delete(id);
    }
  }

  private updateAlienBeam(w: World, a: Alien, v: AlienView): void {
    const beam = v.model.beam;
    if (!beam) return;
    if (a.kind === 'harvester') {
      const on = a.beam && a.dying <= 0;
      beam.visible = on;
      if (!on) return;
      const c = w.cities[a.beamCity];
      if (!c) { beam.visible = false; return; }
      _v.copy(a.pos); _v.y -= 17;
      _v2.set(c.site.x, c.site.level + 10, c.site.z).sub(_v);
      const len = _v2.length();
      beam.position.copy(_v);
      beam.quaternion.setFromUnitVectors(_v3.set(0, -1, 0), _v2.normalize());
      beam.scale.set(1, len, 1);
      if (Math.random() < 0.5) this.fx.fireTrail(_v.set(c.site.x + (Math.random() - 0.5) * 160, c.site.level + 14, c.site.z + (Math.random() - 0.5) * 160), 24);
    } else if (a.kind === 'mothership') {
      const charging = a.beamCharge > 0, firing = a.beam;
      beam.visible = (charging || firing) && a.dying <= 0;
      if (!beam.visible) return;
      const c = w.cities[a.beamCity];
      if (!c) { beam.visible = false; return; }
      _v.set(a.pos.x, a.pos.y - 120, a.pos.z);
      _v2.set(c.site.x, c.site.level, c.site.z).sub(_v);
      const len = _v2.length();
      beam.position.copy(_v);
      beam.quaternion.setFromUnitVectors(_v3.set(0, -1, 0), _v2.normalize());
      const radius = firing ? 60 + Math.sin(this.t * 40) * 6 : 5 + Math.sin(this.t * 25) * 2;
      beam.scale.set(radius, len, radius);
      (beam.material as ShaderMaterial).uniforms.intensity!.value = firing ? 1.3 : 0.6;
      if (firing) this.fx.fireTrail(_v.set(c.site.x + (Math.random() - 0.5) * 300, c.site.level + 20, c.site.z + (Math.random() - 0.5) * 300), 50);
    }
  }

  private syncMissiles(w: World): void {
    const seen = new Set<number>();
    for (const m of w.shots) {
      seen.add(m.id);
      let g = this.missiles.get(m.id);
      if (!g) { g = buildMissile(); this.scene.add(g); this.missiles.set(m.id, g); }
      g.position.copy(m.pos);
      _m.lookAt(ZERO, m.dir, Y);
      g.quaternion.setFromRotationMatrix(_m);
      _v.copy(m.pos).addScaledVector(m.dir, -2.4);
      this.fx.smokeTrail(_v, 1.8, false);
      this.fx.fireTrail(_v, 2.4);
    }
    for (const [id, g] of this.missiles) if (!seen.has(id)) { this.scene.remove(g); disposeModel(g); this.missiles.delete(id); }
  }

  private updateCamera(w: World, dt: number, state: ViewState): void {
    const ac = w.ac, cam = this.camera;
    if (!this.camInit) { this.camQ.copy(ac.q); this.camInit = true; }
    const speedK = Math.min(1, ac.speed / 360);
    let fov = 62 + speedK * 7 + (ac.thrust > 1.05 ? 5 : 0);

    // baseline shake: afterburner rumble, heavy G, stalls
    const base = (ac.thrust > 1.05 ? 0.06 : 0) + (ac.g > 8 ? 0.12 : 0) + (ac.stalled && w.playerAlive ? 0.08 : 0);
    const shake = Math.min(1.6, this.fx.shake + base) * (this.reducedMotion ? 0.3 : 1);

    if (state.mode === 'orbit' || !w.playerAlive) {
      const o = state.orbit ?? { dist: 70, az: this.t * 0.35, el: 0.18 };
      const dist = w.playerAlive ? o.dist : 130;
      const az = w.playerAlive ? o.az : this.t * 0.45;
      const el = w.playerAlive ? o.el : 0.35;
      // orbit relative to the aircraft's heading so the jet stays the hero of the shot
      _q.copy(ac.q);
      _v.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
      if (w.playerAlive) _v.applyQuaternion(_q);
      cam.position.copy(ac.pos).add(_v);
      cam.lookAt(_v2.copy(ac.pos).addScaledVector(_v3.set(0, 0, -1).applyQuaternion(ac.q), w.playerAlive ? 12 : 0));
      fov = 52;
    } else if (state.mode === 'cockpit') {
      this.camQ.copy(ac.q);
      cam.position.copy(ac.pos).add(_v.set(0, 0.95, -3.6).applyQuaternion(ac.q));
      cam.quaternion.copy(ac.q);
      fov += 10;
    } else {
      this.camQ.slerp(ac.q, 1 - Math.exp(-9 * dt));
      const back = 22.5 + speedK * 3 + (ac.thrust > 1.05 ? 2.5 : 0);
      cam.position.copy(ac.pos).add(_v.set(0, 5.4, back).applyQuaternion(this.camQ));
      cam.quaternion.copy(this.camQ);
      // dip a touch so the horizon sits well in the frame when climbing hard
      const lift = Math.max(-0.25, Math.min(0.25, pitchAngle(ac) * -0.05));
      cam.quaternion.multiply(_q2.setFromAxisAngle(_v3.set(1, 0, 0), lift));
    }
    if (shake > 0.01) {
      cam.position.add(_v.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(shake * 0.9));
      cam.quaternion.multiply(_q2.setFromAxisAngle(Z, (Math.random() - 0.5) * shake * 0.03));
    }
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * (1 - Math.exp(-4 * dt)); cam.updateProjectionMatrix(); }
    // keep the camera out of the ground
    const floor = surfaceHeight(cam.position.x, cam.position.z) + 4;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.updateMatrixWorld();
  }

  get bloomEnabled(): boolean { return !!this.bloom; }
}
