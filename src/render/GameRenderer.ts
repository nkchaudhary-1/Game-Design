// One WebGL renderer for the whole game. Screens ask it to draw a scene with a camera; it owns the canvas,
// the pixel ratio (capped for phones) and the resize logic.

import * as THREE from 'three';

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private w = 1;
  private h = 1;
  /** Lowered automatically when frames run long (a 1.0 scale is device pixel ratio up to 2). */
  quality = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x070b18, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600);
  }

  get aspect(): number { return this.w / this.h; }
  get size(): { w: number; h: number } { return { w: this.w, h: this.h }; }

  setSize(w: number, h: number): void {
    this.w = Math.max(2, Math.floor(w));
    this.h = Math.max(2, Math.floor(h));
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
  }

  setQuality(q: number): void {
    if (q === this.quality) return;
    this.quality = q;
    this.setSize(this.w, this.h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  dispose(): void { this.renderer.dispose(); }
}
