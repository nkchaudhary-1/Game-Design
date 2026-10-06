// 3D previews for the menus: the Hangar/Workshop turntable, the menu hero and card thumbnails.
//
// One extra WebGL context renders everything for the UI into an off-screen canvas; each visible preview is a
// plain 2D canvas that receives a copy of the frame. (Keeps us at two GL contexts in total — this and the
// battle renderer — instead of one per card.)

import * as THREE from 'three';
import { BladeView, visualSpecFor } from '../blades/BladeMesh';
import type { BuiltBlade } from '../blades/BladeFactory';
import { CLASS_COLORS, clamp, lerp, TAU } from '../core/types';
import { glow, toon } from '../render/materials';

export class PreviewRenderer {
  readonly canvas = document.createElement('canvas');
  readonly renderer: THREE.WebGLRenderer;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'default' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  /** Render `scene` and copy the result into `target` (a 2D canvas, sized to its CSS box). */
  renderTo(target: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(target.clientWidth * dpr)), hh = Math.max(2, Math.floor(target.clientHeight * dpr));
    if (target.width !== w || target.height !== hh) { target.width = w; target.height = hh; }
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
    this.renderer.render(scene, camera);
    const g = target.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, hh);
    g.drawImage(this.canvas, 0, 0, w, hh);
  }

  /** Render to a PNG data URL (used for card thumbnails). */
  snapshot(scene: THREE.Scene, camera: THREE.PerspectiveCamera, size: number): string {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    this.renderer.render(scene, camera);
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void { this.renderer.dispose(); }
}

function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xdbe6ff, 0x2a3260, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-5, 9, 6);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fb8ff, 0.6);
  rim.position.set(6, 3, -6);
  scene.add(rim);
}

/** A pedestal: a dark disc with a thin class-coloured ring, sitting just under the blade's tip. */
function pedestal(radius: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.55, radius * 1.65, 0.12, 40), toon('#151d3d'));
  disc.position.y = -0.1;
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.38, radius * 1.46, 48).rotateX(-Math.PI / 2), glow(color, 0.9));
  ring.position.y = -0.035;
  const inner = new THREE.Mesh(new THREE.RingGeometry(radius * 0.8, radius * 0.84, 48).rotateX(-Math.PI / 2), glow(color, 0.35));
  inner.position.y = -0.034;
  g.add(disc, ring, inner);
  return g;
}

export type StageView = 'free' | 'top' | 'side';

/** One blade on a turntable. Drag to orbit, wheel / pinch to zoom, presets for top and side. */
export class BladeStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  private view: BladeView | null = null;
  private ped: THREE.Group | null = null;
  private radius = 1.4;
  private yaw = 0.7;
  private pitch = THREE.MathUtils.degToRad(38);
  private zoom = 1;
  private tYaw: number | null = null;
  private tPitch = this.pitch;
  private spin = 0;
  private idle = 0;
  private autoRotate = true;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  reduced = false;

  constructor(private readonly omega = 1.6) {
    addLights(this.scene);
  }

  get currentView(): StageView { return this.mode; }
  private mode: StageView = 'free';

  setBlade(built: BuiltBlade): void {
    const spec = visualSpecFor(built);
    this.radius = spec.radius;
    if (this.view) this.view.rebuild(spec);
    else { this.view = new BladeView(spec, null); this.scene.add(this.view.root); }
    if (this.ped) { this.scene.remove(this.ped); this.ped.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
    this.ped = pedestal(spec.radius, CLASS_COLORS[built.def.class].main);
    this.scene.add(this.ped);
  }

  setView(v: StageView): void {
    this.mode = v;
    this.zoom = 1;
    this.idle = 0;
    if (v === 'top') { this.tPitch = THREE.MathUtils.degToRad(87); this.tYaw = this.yaw; }
    else if (v === 'side') { this.tPitch = THREE.MathUtils.degToRad(7); this.tYaw = this.yaw; }
    else { this.tPitch = THREE.MathUtils.degToRad(38); this.tYaw = null; }
  }

  /** Make the stage draggable. Returns a function that removes the listeners. */
  attach(el: HTMLElement): () => void {
    const down = (e: PointerEvent): void => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.idle = 0; this.autoRotate = false;
      if (this.pointers.size === 2) this.pinch = this.pinchDist();
    };
    const move = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      this.idle = 0;
      if (this.pointers.size === 2) {
        const d = this.pinchDist();
        if (this.pinch > 0) this.zoom = clamp(this.zoom * (this.pinch / d), 0.55, 1.7);
        this.pinch = d;
      } else {
        this.yaw -= dx * 0.011;
        this.tYaw = null;
        this.pitch = clamp(this.pitch + dy * 0.008, THREE.MathUtils.degToRad(4), THREE.MathUtils.degToRad(88));
        this.tPitch = this.pitch;
        this.mode = 'free';
      }
    };
    const up = (e: PointerEvent): void => { this.pointers.delete(e.pointerId); this.pinch = 0; };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * (1 + Math.sign(e.deltaY) * 0.09), 0.55, 1.7);
      this.idle = 0;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }

  private pinchDist(): number {
    const pts = [...this.pointers.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  update(dt: number): void {
    this.idle += dt;
    if (this.idle > 2.5) this.autoRotate = true;
    if (this.autoRotate && !this.reduced && this.mode === 'free') this.yaw += dt * 0.35;
    const k = 1 - Math.exp(-dt * 7);
    this.pitch = lerp(this.pitch, this.tPitch, k);
    if (this.tYaw !== null) this.yaw = lerp(this.yaw, this.tYaw, k);
    this.spin -= this.omega * dt * (this.reduced ? 0.4 : 1);
    this.view?.apply({ x: 0, y: 0.17, z: 0, spinAngle: this.spin % TAU, leanX: 0, leanZ: 0, alpha: 1, wobble: 0, scale: 1, leap: 0, shield: false }, dt);
    this.placeCamera();
  }

  private placeCamera(): void {
    const v = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(v / 2) * Math.max(0.3, this.camera.aspect));
    const half = Math.min(v, hFov) / 2;
    const d = ((this.radius * 1.5) / Math.tan(half)) * this.zoom;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(Math.sin(this.yaw) * cp * d, Math.sin(this.pitch) * d + 0.1, Math.cos(this.yaw) * cp * d);
    this.camera.lookAt(0, 0.05, 0);
  }

  render(pr: PreviewRenderer, target: HTMLCanvasElement): void {
    this.placeCamera();
    pr.renderTo(target, this.scene, this.camera);
  }

  /** Fixed 3/4 shot as a PNG data URL. */
  snapshot(pr: PreviewRenderer, size: number): string {
    this.yaw = 0.62; this.pitch = THREE.MathUtils.degToRad(42); this.zoom = 1.12;
    this.spin = 0.4;
    this.view?.apply({ x: 0, y: 0.17, z: 0, spinAngle: this.spin, leanX: 0, leanZ: 0, alpha: 1, wobble: 0, scale: 1, leap: 0, shield: false }, 0);
    this.placeCamera();
    return pr.snapshot(this.scene, this.camera, size);
  }

  dispose(): void {
    this.view?.dispose();
    this.view = null;
  }
}

/** Menu hero: the three playable blades side by side on a slow turntable. */
export class HeroStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  private readonly views: BladeView[] = [];
  private readonly slots: Array<{ x: number; z: number; r: number; phase: number }> = [];
  private t = 0;
  private spin = [0, 0, 0];
  reduced = false;

  constructor(blades: BuiltBlade[]) {
    addLights(this.scene);
    const xs = [-3.4, 0, 3.4];
    blades.slice(0, 3).forEach((b, i) => {
      const spec = visualSpecFor(b);
      const v = new BladeView(spec, null);
      this.scene.add(v.root);
      this.views.push(v);
      this.slots.push({ x: xs[i], z: i === 1 ? 0.6 : -0.4, r: spec.radius, phase: i * 1.7 });
      const p = pedestal(spec.radius * 0.9, CLASS_COLORS[b.def.class].main);
      p.position.set(xs[i], 0, i === 1 ? 0.6 : -0.4);
      this.scene.add(p);
    });
  }

  update(dt: number): void {
    this.t += dt;
    this.views.forEach((v, i) => {
      const s = this.slots[i];
      this.spin[i] -= (2.4 + i * 0.5) * dt * (this.reduced ? 0.4 : 1);
      const bob = this.reduced ? 0 : Math.sin(this.t * 1.3 + s.phase) * 0.06;
      v.apply({ x: s.x, y: 0.2 + bob, z: s.z, spinAngle: this.spin[i], leanX: 0.08, leanZ: 0.05, alpha: 1, wobble: 0, scale: 1.12, leap: 0, shield: false }, dt);
    });
    const sway = this.reduced ? 0 : Math.sin(this.t * 0.25) * 0.22;
    const a = Math.max(0.3, this.camera.aspect);
    const th = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const d = Math.max(7.4 / (th * a), 4.6 / th);
    this.camera.position.set(Math.sin(sway) * d, d * 0.52, Math.cos(sway) * d);
    this.camera.lookAt(0, 0, 0.2);
  }

  render(pr: PreviewRenderer, target: HTMLCanvasElement): void { pr.renderTo(target, this.scene, this.camera); }

  dispose(): void { this.views.forEach((v) => v.dispose()); }
}

/** Card thumbnails, rendered lazily and cached by blade + build. */
export class Thumbs {
  private readonly cache = new Map<string, string>();
  private stage: BladeStage | null = null;

  constructor(private readonly pr: PreviewRenderer) {}

  get(built: BuiltBlade): string {
    const key = `${built.def.id}|${Object.values(built.build).join(',')}`;
    let url = this.cache.get(key);
    if (!url) {
      this.stage ??= new BladeStage(0);
      this.stage.setBlade(built);
      url = this.stage.snapshot(this.pr, 256);
      this.cache.set(key, url);
    }
    return url;
  }
}
