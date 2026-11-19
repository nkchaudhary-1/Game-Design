// Sun lens flare, drawn on its own 2D canvas between the 3D view and the HUD (so the HUD's dark outline never touches
// it). Visible only when the sun is in front of the camera and not hidden behind a mountain. A soft core, a wide halo, a
// horizontal streak, and a few ghosts strung along the line through the middle of the frame.

import { PerspectiveCamera, Vector3 } from 'three';
import { terrainHeight } from '../sim/terrain';
import { SUN_DIR } from './sky';

const _p = new Vector3(), _d = new Vector3();

export class SunFlare {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private level = 0;
  private w = 1;
  private h = 1;

  constructor(before: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'flare';
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;display:block';
    before.after(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Fraction of the sun ray that is free of terrain (0..1). */
  private clear(cam: Vector3): number {
    let free = 0, n = 0;
    for (let s = 250; s < 9000; s *= 1.35) { n++; if (cam.y + SUN_DIR.y * s > terrainHeight(cam.x + SUN_DIR.x * s, cam.z + SUN_DIR.z * s)) free++; }
    return free / n;
  }

  update(camera: PerspectiveCamera, dt: number): void {
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    camera.getWorldDirection(_d);
    const facing = _d.dot(SUN_DIR);
    let target = 0, sx = 0, sy = 0;
    if (facing > 0.25) {
      _p.copy(camera.position).addScaledVector(SUN_DIR, 10000).project(camera);
      sx = (_p.x * 0.5 + 0.5) * this.w; sy = (-_p.y * 0.5 + 0.5) * this.h;
      const edge = Math.max(Math.abs(_p.x), Math.abs(_p.y));
      target = (1 - Math.min(1, Math.max(0, (edge - 0.55) / 0.7))) * this.clear(camera.position);
    }
    this.level += (target - this.level) * Math.min(1, dt * 8);
    const I = this.level;
    if (I < 0.01) return;
    const m = Math.min(this.w, this.h), cx = this.w / 2, cy = this.h / 2;
    g.globalCompositeOperation = 'lighter';
    const glow = (x: number, y: number, r: number, c0: string, c1: string) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    glow(sx, sy, m * 0.45, `rgba(255,214,160,${0.16 * I})`, 'rgba(255,214,160,0)');
    glow(sx, sy, m * 0.12, `rgba(255,244,225,${0.5 * I})`, 'rgba(255,230,190,0)');
    // anamorphic streak
    const sg = g.createLinearGradient(sx - this.w * 0.45, 0, sx + this.w * 0.45, 0);
    sg.addColorStop(0, 'rgba(255,220,170,0)'); sg.addColorStop(0.5, `rgba(255,235,205,${0.28 * I})`); sg.addColorStop(1, 'rgba(255,220,170,0)');
    g.fillStyle = sg; g.fillRect(sx - this.w * 0.45, sy - 1.5, this.w * 0.9, 3);
    // ghosts along the line through the frame centre
    const dx = cx - sx, dy = cy - sy;
    for (const [k, r, a, c] of [[0.35, 0.05, 0.10, '180,210,255'], [0.7, 0.09, 0.07, '255,200,150'], [1.25, 0.06, 0.09, '160,255,200'], [1.8, 0.14, 0.05, '255,170,200']] as const) {
      glow(sx + dx * k, sy + dy * k, m * r, `rgba(${c},${a * I})`, `rgba(${c},0)`);
    }
    g.globalCompositeOperation = 'source-over';
  }
}
