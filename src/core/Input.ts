// Keyboard → controller messages. The keyboard is just another controller: it only ever sends ControllerMsgs
// through the bus (WASD/arrows steer, 1/2/3 are the basic moves with hold-to-charge on move 1, Space is
// Super — or the launch during the aiming phase).

import type { ControllerMsg, Transport, DisplayMsg } from './InputBus';

export interface KeyboardOptions {
  slot: number;
  send: Transport<ControllerMsg, DisplayMsg>['send'];
  /** Current match phase, so Space/arrows mean "launch" while aiming and "Super"/"steer" while live. */
  phase: () => 'ready' | 'live' | 'over' | 'idle';
  onAim?: (angle: number, power: number) => void;
  onAnyKey?: () => void;
}

const STEER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);

export class KeyboardController {
  private down = new Set<string>();
  private aimAngle = -Math.PI / 2;
  private aimPower = 0.7;
  private aimUsed = false;
  private lastSteer = { x: 0, z: 0 };
  private enabled = true;

  constructor(private readonly o: KeyboardOptions) {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.releaseAll);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.releaseAll();
  }

  /** Reset aim state for a new battle. */
  reset(): void {
    this.aimAngle = -Math.PI / 2; this.aimPower = 0.7; this.aimUsed = false;
    this.releaseAll();
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  private onDown = (e: KeyboardEvent): void => {
    if (!this.enabled || e.metaKey || e.ctrlKey || e.altKey || this.isTyping(e)) return;
    const phase = this.o.phase();
    if (phase === 'idle') return;
    this.o.onAnyKey?.();
    if (STEER_KEYS.has(e.code)) { e.preventDefault(); this.down.add(e.code); this.sendSteer(); return; }
    if (e.repeat) return;
    if (phase === 'ready' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      this.o.send({ t: 'launch', slot: this.o.slot, angle: this.aimAngle, power: this.aimPower });
      return;
    }
    if (phase !== 'live') return;
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      e.preventDefault();
      this.o.send({ t: 'move', slot: this.o.slot, index: (Number(e.code.slice(5)) - 1) as 0 | 1 | 2, phase: 'down' });
    } else if (e.code === 'Space') {
      e.preventDefault();
      this.o.send({ t: 'super', slot: this.o.slot });
    }
  };

  private onUp = (e: KeyboardEvent): void => {
    if (STEER_KEYS.has(e.code)) { this.down.delete(e.code); this.sendSteer(); return; }
    if (this.o.phase() === 'live' && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
      this.o.send({ t: 'move', slot: this.o.slot, index: (Number(e.code.slice(5)) - 1) as 0 | 1 | 2, phase: 'up' });
    }
  };

  private sendSteer(): void {
    const k = this.down;
    if (this.o.phase() === 'ready') this.aimUsed = true;
    let x = 0, z = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) z -= 1;
    if (k.has('ArrowDown') || k.has('KeyS')) z += 1;
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    if (this.o.phase() === 'live' && (x !== this.lastSteer.x || z !== this.lastSteer.z)) {
      this.lastSteer = { x, z };
      this.o.send({ t: 'steer', slot: this.o.slot, x, z });
    }
  }

  /** Per-frame: while aiming, arrows rotate the aim and change power. */
  tick(dt: number): void {
    if (!this.enabled || this.o.phase() !== 'ready') return;
    const k = this.down;
    let moved = false;
    if (k.has('ArrowLeft') || k.has('KeyA')) { this.aimAngle -= 1.7 * dt; moved = true; }
    if (k.has('ArrowRight') || k.has('KeyD')) { this.aimAngle += 1.7 * dt; moved = true; }
    if (k.has('ArrowUp') || k.has('KeyW')) { this.aimPower = Math.min(1, this.aimPower + 0.8 * dt); moved = true; }
    if (k.has('ArrowDown') || k.has('KeyS')) { this.aimPower = Math.max(0.05, this.aimPower - 0.8 * dt); moved = true; }
    this.aimAngle = Math.max(-Math.PI + 0.12, Math.min(-0.12, this.aimAngle));
    if (moved || this.aimUsed) this.o.onAim?.(this.aimAngle, this.aimPower);
  }

  private releaseAll = (): void => {
    this.down.clear();
    this.lastSteer = { x: 0, z: 0 };
    if (this.o.phase() === 'live') {
      this.o.send({ t: 'steer', slot: this.o.slot, x: 0, z: 0 });
      for (const i of [0, 1, 2] as const) this.o.send({ t: 'move', slot: this.o.slot, index: i, phase: 'up' });
    }
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.releaseAll);
  }
}
