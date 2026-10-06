// One WebGL renderer for the battle. Owns the canvas, the pixel ratio (capped for phones) and the post stack:
// scene → bloom (only HDR things glow: seams, sparks, Supers) → tone map. If the stack cannot be built, or the
// device is struggling, it falls back to a plain render.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { lit } from './env';
import { GFX } from './quality';

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private w = 1;
  private h = 1;
  private composer: EffectComposer | null = null;
  private pass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private postFailed = false;
  /** Lowered automatically when frames run long (a 1.0 scale is device pixel ratio up to 2). */
  quality = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    // ?shot keeps the drawing buffer so headless screenshots of the canvas are reliable (costs a little speed)
    const keep = new URLSearchParams(location.search).has('shot');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: keep });
    this.renderer.setClearColor(0x0b1018, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = GFX.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600);
  }

  get aspect(): number { return this.w / this.h; }
  get size(): { w: number; h: number } { return { w: this.w, h: this.h }; }

  setSize(w: number, h: number): void {
    this.w = Math.max(2, Math.floor(w));
    this.h = Math.max(2, Math.floor(h));
    const dpr = Math.min(window.devicePixelRatio || 1, GFX.maxDpr) * this.quality;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(this.w, this.h);
    this.bloom?.setSize(this.w * dpr, this.h * dpr);
  }

  /** After the graphics tier changed mid-session: follow it (shadows) without rebuilding the scene. */
  applyTier(scene: THREE.Scene): void {
    this.renderer.shadowMap.enabled = GFX.shadows;
    scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; }); });
  }

  setQuality(q: number): void {
    if (q === this.quality) return;
    this.quality = q;
    this.setSize(this.w, this.h);
  }

  private buildPost(scene: THREE.Scene, camera: THREE.Camera): void {
    try {
      const dpr = Math.min(window.devicePixelRatio || 1, GFX.maxDpr) * this.quality;
      const c = new EffectComposer(this.renderer);
      c.setPixelRatio(dpr);
      c.setSize(this.w, this.h);
      this.pass = new RenderPass(scene, camera);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.w * dpr, this.h * dpr), 0.62, 0.55, 0.92);
      c.addPass(this.pass);
      c.addPass(this.bloom);
      c.addPass(new OutputPass());
      this.composer = c;
    } catch (err) {
      console.warn('post-processing unavailable, rendering plain', err);
      this.postFailed = true;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    lit(scene, this.renderer, 0.7);
    if (!this.composer && !this.postFailed) this.buildPost(scene, camera);
    // below ~0.8 render scale the device is struggling: drop bloom first
    if (this.composer && this.pass && this.bloom) {
      this.pass.scene = scene;
      this.pass.camera = camera;
      this.bloom.enabled = GFX.bloom && this.quality >= 0.8;
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }

  dispose(): void { this.composer?.dispose(); this.renderer.dispose(); }
}
