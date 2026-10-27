// Turns keyboard, mouse, gamepad and touch into one Controls object per frame, plus discrete "commands"
// (pause, camera, mute...) delivered as callbacks. The sim never sees a device.

import { newControls, type Controls } from '../sim/controls';
import { clamp } from '../sim/util';

export type Command = 'pause' | 'camera' | 'mute' | 'assist' | 'mouse' | 'invert' | 'help' | 'confirm';

export interface InputSettings {
  /** Flight-stick pitch: S / Down pulls up (default). When false, W / Up climbs ("arcade"). */
  flightStick: boolean;
  mouseSteer: boolean;
}

const KEY_COMMANDS: Record<string, Command> = {
  Escape: 'pause', KeyP: 'pause', KeyC: 'camera', KeyM: 'mute', KeyH: 'assist', KeyV: 'mouse', KeyY: 'invert', F1: 'help', Slash: 'help',
  Enter: 'confirm',
};

const GAME_KEYS = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyX', 'KeyG', 'KeyT', 'Space', 'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab',
]);

export class Input {
  settings: InputSettings = { flightStick: true, mouseSteer: false };
  /** Called for discrete commands; the game decides what they mean in the current screen. */
  onCommand: (c: Command) => void = () => undefined;
  /** First user gesture (browsers gate audio on it). */
  onGesture: () => void = () => undefined;
  /** Any key press or pointer press, with its code ('Pointer' for a press). Used to leave the demo. */
  onAnyKey: (code: string) => void = () => undefined;
  /** When false the keyboard/mouse/pad do not drive the aircraft (menus, paused). */
  get active(): boolean { return this._active; }
  set active(v: boolean) {
    // keys already held when control is handed over (the Enter that launched the mission) stay ignored until released
    if (v && !this._active) this.suppressed = new Set(this.keys);
    this._active = v;
  }
  private _active = false;
  private suppressed = new Set<string>();
  touchMode = false;

  private keys = new Set<string>();
  private axis = { pitch: 0, roll: 0, yaw: 0 };
  private mouse = { x: 0, y: 0, inside: false, left: false, right: false };
  private wheel = 0;
  private padPrev = new Set<number>();
  private touchStick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private touchBtn = { fire: false, missile: false, boost: false, brake: false };
  private touchEdge = { cycle: false };
  private touchThrottle = 0.7;
  private cycleHeld = false;

  constructor(target: Window, canvas: HTMLElement) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });
    canvas.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    canvas.addEventListener('mousedown', (e) => {
      this.onGesture();
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    target.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { if (this.active) { e.preventDefault(); this.wheel += clamp(-e.deltaY / 400, -1, 1); } }, { passive: false });
    target.addEventListener('pointerdown', () => this.onGesture(), { once: true });
    target.addEventListener('pointerdown', () => this.onAnyKey('Pointer'));
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    this.onGesture();
    if (GAME_KEYS.has(e.code) && this.active) e.preventDefault();
    if (e.repeat) return;
    if (!['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) this.onAnyKey(e.code);
    this.keys.add(e.code);
    const cmd = KEY_COMMANDS[e.code];
    if (cmd) this.onCommand(cmd);
  };

  private onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); this.suppressed.delete(e.code); };

  private down = (...codes: string[]): boolean => codes.some((c) => this.keys.has(c) && !this.suppressed.has(c));

  // ---- touch ---------------------------------------------------------------------------------------------------

  /** Wire on-screen controls. `root` is the #touch container. */
  mountTouch(root: HTMLElement): void {
    root.innerHTML = `
      <div class="t-stick" data-zone></div>
      <div class="t-btns">
        <button class="t-btn t-fire" data-k="fire">FIRE</button>
        <button class="t-btn t-msl" data-k="missile">MSL</button>
        <button class="t-btn t-boost" data-k="boost">BOOST</button>
        <button class="t-btn t-brake" data-k="brake">BRAKE</button>
        <button class="t-btn t-sm t-tgt" data-k="cycle">TGT</button>
        <button class="t-btn t-sm t-cam" data-k="camera">CAM</button>
        <button class="t-btn t-sm t-pause" data-k="pause">II</button>
      </div>`;
    const zone = root.querySelector<HTMLElement>('[data-zone]')!;
    const knob = document.createElement('div');
    knob.className = 't-knob';
    zone.appendChild(knob);
    const S = this.touchStick;
    const R = 62;
    zone.addEventListener('pointerdown', (e) => {
      this.onGesture();
      this.touchMode = true;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      S.id = e.pointerId; S.ox = e.clientX; S.oy = e.clientY; S.x = S.y = 0;
      knob.style.transform = `translate(${S.ox - r.left - 40}px, ${S.oy - r.top - 40}px)`;
      knob.classList.add('on');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== S.id) return;
      let dx = e.clientX - S.ox, dy = e.clientY - S.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      S.x = dx / R; S.y = dy / R;
      const r = zone.getBoundingClientRect();
      knob.style.transform = `translate(${S.ox + dx - r.left - 40}px, ${S.oy + dy - r.top - 40}px)`;
    });
    const end = (e: PointerEvent) => { if (e.pointerId === S.id) { S.id = -1; S.x = S.y = 0; knob.classList.remove('on'); } };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    root.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => {
      const k = b.dataset.k!;
      const set = (v: boolean) => {
        if (k === 'fire' || k === 'missile' || k === 'boost' || k === 'brake') this.touchBtn[k] = v;
        else if (k === 'cycle' && v) this.touchEdge.cycle = true;
        else if (k === 'camera' && v) this.onCommand('camera');
        else if (k === 'pause' && v) this.onCommand('pause');
        b.classList.toggle('on', v);
      };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onGesture(); this.touchMode = true; b.setPointerCapture(e.pointerId); set(true); });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
    });
  }

  // ---- per-frame -----------------------------------------------------------------------------------------------

  /** Read all devices into a Controls object. `size` = viewport (for mouse steering). */
  poll(dt: number, size: { w: number; h: number }): Controls {
    const c = newControls();
    if (!this.active) { this.axis.pitch = this.axis.roll = this.axis.yaw = 0; return c; }
    const S = this.settings;
    const stick = S.flightStick ? 1 : -1;

    // keyboard axes ramp in and out so a tap is a nudge, not a full-rate snap
    const climb = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0);
    const kPitch = climb * stick;
    const kRoll = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const kYaw = (this.down('KeyE') ? 1 : 0) - (this.down('KeyQ') ? 1 : 0);
    const ramp = (v: number, target: number) => v + (target - v) * Math.min(1, dt * (target === 0 ? 10 : target * v < 0 ? 16 : 7));
    this.axis.pitch = ramp(this.axis.pitch, kPitch);
    this.axis.roll = ramp(this.axis.roll, kRoll);
    this.axis.yaw = ramp(this.axis.yaw, kYaw);
    c.pitch = this.axis.pitch; c.roll = this.axis.roll; c.yaw = this.axis.yaw;

    // virtual stick: the cursor's offset from screen centre is the stick deflection
    if (S.mouseSteer && this.mouse.inside) {
      const R = Math.min(size.w, size.h) * 0.34;
      const dx = (this.mouse.x - size.w / 2) / R, dy = (this.mouse.y - size.h / 2) / R;
      const shape = (v: number) => { const a = Math.abs(v); return a < 0.05 ? 0 : Math.sign(v) * Math.min(1, ((a - 0.05) / 0.95) ** 1.35); };
      c.roll = clamp(c.roll + shape(dx), -1, 1);
      c.pitch = clamp(c.pitch + shape(-dy), -1, 1);
    }

    c.throttleDelta = (this.down('KeyR') ? 1 : 0) - (this.down('KeyF') ? 1 : 0) + this.wheel * 6;
    this.wheel = 0;
    c.boost = this.down('ShiftLeft', 'ShiftRight');
    c.brake = this.down('KeyX');
    c.fire = this.down('Space') || this.mouse.left;
    c.missile = this.down('Enter', 'KeyG') || this.mouse.right;
    c.cycleTarget = this.down('KeyT', 'Tab');

    this.pad(c, stick);
    this.touch(c, stick);

    // a hair of deadzone for floating-point noise
    for (const k of ['pitch', 'roll', 'yaw'] as const) c[k] = clamp(Math.abs(c[k]) < 0.01 ? 0 : c[k], -1, 1);
    return c;
  }

  private pad(c: Controls, stick: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const p = Array.from(pads).find((g) => g && g.connected);
    if (!p) return;
    const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : Math.sign(v) * (Math.abs(v) - 0.12) / 0.88);
    const b = (i: number) => !!p.buttons[i]?.pressed;
    const axisRoll = dz(p.axes[0] ?? 0), axisPitch = dz(p.axes[1] ?? 0), axisYaw = dz(p.axes[2] ?? 0);
    if (axisRoll || axisPitch || axisYaw) {
      c.roll = clamp(c.roll + axisRoll, -1, 1);
      c.pitch = clamp(c.pitch + axisPitch * stick, -1, 1); // stick pulled back (+y) climbs in flight-stick mode
      c.yaw = clamp(c.yaw + axisYaw, -1, 1);
    }
    c.fire ||= b(7) || (p.buttons[7]?.value ?? 0) > 0.4;
    c.missile ||= b(5);
    c.boost ||= b(0) || b(4);
    c.brake ||= b(1) || b(6);
    c.cycleTarget ||= b(2);
    c.throttleDelta += (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
    const now = new Set<number>();
    for (const i of [3, 9]) if (b(i)) now.add(i);
    if (now.has(3) && !this.padPrev.has(3)) this.onCommand('camera');
    if (now.has(9) && !this.padPrev.has(9)) this.onCommand('pause');
    this.padPrev = now;
  }

  private touch(c: Controls, stick: number): void {
    if (!this.touchMode) return;
    const S = this.touchStick;
    c.roll = clamp(c.roll + S.x * 1.15, -1, 1);
    c.pitch = clamp(c.pitch + S.y * 1.15 * stick, -1, 1);
    c.fire ||= this.touchBtn.fire;
    c.missile ||= this.touchBtn.missile;
    c.boost ||= this.touchBtn.boost;
    c.brake ||= this.touchBtn.brake;
    if (this.touchEdge.cycle) { c.cycleTarget = true; this.touchEdge.cycle = false; this.cycleHeld = true; }
    else if (this.cycleHeld) this.cycleHeld = false;
    if (c.throttleSet === null && !this.down('KeyR', 'KeyF')) c.throttleSet = this.touchBtn.brake ? 0.2 : this.touchThrottle;
  }
}
