import { clamp } from '../shared/math';

export interface Settings { sens: number; invertY: boolean; volume: number; muted: boolean; quality: 'high' | 'low'; zoom: number }
export const DEFAULT_SETTINGS: Settings = { sens: 1, invertY: false, volume: 0.7, muted: false, quality: 'high', zoom: 4.6 };

/** Keyboard + mouse (pointer lock, with drag-to-look fallback). `inject` lets tests drive the same pipeline. */
export class Input {
  keys = new Set<string>();
  dx = 0; dy = 0;
  locked = false;
  enabled = true;               // false while typing, in menus, in the lift panel
  wheel = 0;
  inject: { mx: number; mz: number; jump: boolean; sprint: boolean } | null = null;
  onInteract: () => void = () => {};
  onKey: (code: string) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  private dragging = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onKey(e.code);
      if (e.code === 'KeyE' && this.enabled) this.onInteract();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.dragging = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      if (!this.locked && e.button === 0) canvas.requestPointerLock?.();
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.dragging) { this.dx += e.movementX; this.dy += e.movementY; }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange(this.locked);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  lock() { this.canvas.requestPointerLock?.(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Movement in world space for a camera yaw. */
  move(camYaw: number) {
    if (this.inject) return { ...this.inject };
    if (!this.enabled) return { mx: 0, mz: 0, jump: false, sprint: false };
    const k = this.keys;
    const fw = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const rt = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
    let mx = sy * fw - cy * rt, mz = cy * fw + sy * rt;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    return { mx, mz, jump: k.has('Space'), sprint: k.has('ShiftLeft') || k.has('ShiftRight') };
  }
  /** Consume accumulated look deltas. */
  look(sens: number, invertY: boolean) {
    const s = 0.0022 * sens;
    const r = { yaw: -this.dx * s, pitch: this.dy * s * (invertY ? -1 : 1) };
    this.dx = 0; this.dy = 0;
    return r;
  }
  takeWheel() { const w = this.wheel; this.wheel = 0; return clamp(w, -400, 400); }
}
