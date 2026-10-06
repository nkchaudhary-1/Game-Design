// The on-page controller pad (PRD v2 Phase 1). It is a *controller*, not part of the game: it only emits
// ControllerMsgs and reads PadFeedback, exactly what a phone would do in Phase 2.
//
//   ready phase  — slingshot: press, pull back, release. The big screen draws the real arrow.
//   live phase   — floating joystick for continuous steering; Move 1 is hold-to-charge / release-to-fire
//                  (charging drains spin: the pad shows the cost); Super button with READY/ACTIVE/RECHARGING.

import type { BuiltBlade } from '../blades/BladeFactory';
import type { ControllerMsg, PadFeedback } from '../core/InputBus';
import { clamp, CLASS_COLORS } from '../core/types';
import { abilityIcon, h, icon } from './dom';

export interface PadOptions {
  slot: number;
  built: BuiltBlade;
  send: (m: ControllerMsg) => void;
}

const FORWARD_MIN = -Math.PI + 0.12;
const FORWARD_MAX = -0.12;
const STICK_R = 48;
const DEADZONE = 0.14;

interface Drag { id: number; sx: number; sy: number; x: number; y: number }

export class ControllerPad {
  readonly el: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly label: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly sling: SVGSVGElement;
  private readonly band: SVGLineElement;
  private readonly aimLine: SVGLineElement;
  private readonly anchor: SVGCircleElement;
  private readonly tip: HTMLElement;
  private readonly spinBar: HTMLElement;
  private readonly spinTxt: HTMLElement;
  private readonly mbtns: HTMLButtonElement[] = [];
  private readonly sbtn: HTMLButtonElement;
  private readonly sRing: HTMLElement;
  private readonly sState: HTMLElement;

  private drag: Drag | null = null;
  private launched = false;
  private over = false;
  private enabled = true;
  private held = [false, false, false];
  private lastSteer = { x: 0, z: 0 };
  private lastFb: PadFeedback | null = null;

  constructor(private readonly o: PadOptions) {
    const { built } = o;
    const cls = built.def.class;

    // ---- top row
    this.tip = h('div.tip');
    this.spinTxt = h('b', null, '100');
    this.spinBar = h('i');
    const spin = h('div.row', { style: 'gap:10px' },
      h('span.eyebrow', null, 'Spin'),
      h('div.bar', { style: 'flex:1;height:10px' }, this.spinBar),
      this.spinTxt,
    );
    spin.style.setProperty('--accent', CLASS_COLORS[cls].light);
    const top = h('div.pad-top', null,
      h('div.row', null,
        h('span.nm', null, built.def.name),
        h('span.chip', { 'data-class': cls }, CLASS_COLORS[cls].label),
        this.tip,
      ),
      spin,
    );

    // ---- surface
    this.label = h('div.label');
    this.base = h('div.base');
    this.knob = h('div.knob');
    this.sling = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.sling.classList.add('sling');
    this.band = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.aimLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.anchor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.band.setAttribute('stroke', '#ffffff'); this.band.setAttribute('stroke-width', '5'); this.band.setAttribute('stroke-linecap', 'round'); this.band.setAttribute('opacity', '.85');
    this.aimLine.setAttribute('stroke', '#ffe14a'); this.aimLine.setAttribute('stroke-width', '4'); this.aimLine.setAttribute('stroke-dasharray', '2 10'); this.aimLine.setAttribute('stroke-linecap', 'round');
    this.anchor.setAttribute('r', '9'); this.anchor.setAttribute('fill', 'none'); this.anchor.setAttribute('stroke', '#ffffff'); this.anchor.setAttribute('stroke-width', '3'); this.anchor.setAttribute('opacity', '.8');
    this.sling.append(this.aimLine, this.band, this.anchor);
    this.sling.style.display = 'none';
    this.surface = h('div.pad-surface', { role: 'application', 'aria-label': 'Controller pad: pull back and release to launch, then drag to steer' }, this.label, this.sling, this.base, this.knob);

    // ---- actions
    const actions = h('div.pad-actions');
    built.moves.forEach((mv, i) => {
      const b = h('button.mbtn', { type: 'button', title: `${mv.name}: ${mv.description}`, 'aria-label': `Move ${i + 1}: ${mv.name}` },
        h('span.key', null, mv.charge ? `${i + 1} · HOLD` : String(i + 1)),
        icon(abilityIcon(mv.type)),
        h('span.nm', null, mv.name),
        h('span.cd'),
        mv.charge ? h('span.ch', null, h('i')) : null,
      ) as HTMLButtonElement;
      this.bindMove(b, i as 0 | 1 | 2);
      this.mbtns.push(b);
      actions.append(b);
    });
    const sup = built.supers.find((s) => s.def.id === built.equippedSuper)?.def;
    this.sRing = h('div.ring', null, icon('super'));
    this.sState = h('div.st', null, 'Ready');
    this.sbtn = h('button.sbtn', { type: 'button', 'data-state': 'READY', 'aria-label': `Super: ${sup?.name ?? 'none'}` },
      this.sRing,
      h('div', null, h('div.nm', null, sup?.name ?? 'No Super'), this.sState),
      h('span.key', null, 'SPACE'),
    ) as HTMLButtonElement;
    if (!sup) this.sbtn.disabled = true;
    this.sbtn.addEventListener('pointerdown', (e) => {
      if (!this.live() || !this.enabled) return;
      e.preventDefault();
      this.o.send({ t: 'super', slot: this.o.slot });
    });
    actions.append(this.sbtn);

    const foot = h('div.pad-foot', null, 'Keyboard: WASD steer · 1 2 3 moves · Space Super');
    this.el = h('div.pad', { 'data-class': cls }, top, this.surface, actions, foot);

    this.bindSurface();
    this.refreshLabels();
  }

  // ------------------------------------------------------------------------------------------ state
  private live(): boolean { return this.launched && !this.over; }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.el.style.opacity = on ? '' : '0.55';
    this.el.style.pointerEvents = on ? '' : 'none';
    if (!on) this.cancelInput();
  }

  private refreshLabels(): void {
    const ready = !this.launched && !this.over;
    this.tip.textContent = this.over ? 'Match over' : ready ? 'Pull back · release' : 'Drag to steer';
    this.label.replaceChildren();
    if (this.over) {
      this.label.append(h('b', null, 'Match over'));
    } else if (ready) {
      this.label.append(h('b', null, 'Slingshot'), h('span', null, 'Pull back and release to launch'), h('span', { style: 'font-weight:600;letter-spacing:.1em;color:var(--faint)' }, 'Keys: A/D aim · W/S power · Space'));
    } else {
      this.label.append(h('b', null, 'Steer'), h('span', null, 'Drag anywhere'));
    }
    this.surface.style.cursor = ready ? 'crosshair' : 'grab';
  }

  // -------------------------------------------------------------------------------------- feedback
  feedback(fb: PadFeedback): void {
    if (fb.slot !== this.o.slot) return;
    this.lastFb = fb;
    // the display started a new round while this pad stayed open (two-tab mode)
    if (fb.phase === 'ready' && (this.launched || this.over)) { this.launched = false; this.over = false; this.cancelInput(); this.refreshLabels(); }
    // another controller (the keyboard) launched: follow along
    if (fb.phase === 'live' && !this.launched) { this.launched = true; this.cancelInput(); this.refreshLabels(); }
    if (fb.phase === 'over' && !this.over) { this.over = true; this.cancelInput(); this.refreshLabels(); }

    const spin = Math.round(fb.spin);
    this.spinBar.style.width = `${clamp(fb.spin, 0, 100)}%`;
    this.spinTxt.textContent = String(spin);
    this.spinBar.parentElement!.parentElement!.classList.toggle('low', fb.spin < 22);

    const live = fb.phase === 'live';
    this.mbtns.forEach((b, i) => {
      const cdMax = Math.max(0.001, fb.cooldownMax[i]);
      b.style.setProperty('--cd', live ? clamp(fb.cooldowns[i] / cdMax, 0, 1).toFixed(3) : '1');
      const charging = fb.chargeIndex === i;
      b.classList.toggle('charging', charging);
      b.style.setProperty('--ch', charging ? clamp(fb.charge, 0, 1).toFixed(3) : '0');
      b.classList.toggle('maxed', charging && fb.charge >= 0.999);
      b.setAttribute('aria-disabled', String(!live || (fb.cooldowns[i] > 0.01 && !charging)));
    });

    if (this.sbtn.disabled) return;
    this.sbtn.dataset.state = fb.superState;
    let p = 1, text = 'Ready';
    if (fb.superState === 'ACTIVE') { p = clamp(fb.superT / Math.max(0.01, fb.superMax), 0, 1); text = `Active · ${fb.superT.toFixed(1)}s`; }
    else if (fb.superState === 'RECHARGING') { p = clamp(1 - fb.superT / Math.max(0.01, fb.superMax), 0, 1); text = `Recharging · ${Math.ceil(fb.superT)}s`; }
    this.sRing.style.setProperty('--p', p.toFixed(3));
    this.sState.textContent = text;
  }

  // ------------------------------------------------------------------------------------- move buttons
  private bindMove(b: HTMLButtonElement, i: 0 | 1 | 2): void {
    const release = (): void => {
      if (!this.held[i]) return;
      this.held[i] = false;
      b.classList.remove('down');
      this.o.send({ t: 'move', slot: this.o.slot, index: i, phase: 'up' });
    };
    b.addEventListener('pointerdown', (e) => {
      if (!this.live() || !this.enabled) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      this.held[i] = true;
      b.classList.add('down');
      this.o.send({ t: 'move', slot: this.o.slot, index: i, phase: 'down' });
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ----------------------------------------------------------------------------------------- surface
  private bindSurface(): void {
    const s = this.surface;
    const local = (e: PointerEvent): { x: number; y: number } => {
      const r = s.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    s.addEventListener('pointerdown', (e) => {
      if (this.drag || !this.enabled || this.over) return;
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      const p = local(e);
      this.drag = { id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y };
      this.label.style.opacity = '0';
      this.paint();
    });
    s.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const p = local(e);
      this.drag.x = p.x; this.drag.y = p.y;
      this.paint();
      if (this.live()) this.sendSteer(); else this.sendAim();
    });
    const end = (e: PointerEvent): void => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const wasLive = this.live();
      if (!wasLive && e.type === 'pointerup') this.fire();
      else if (!wasLive) this.o.send({ t: 'aim', slot: this.o.slot, angle: 0, power: -1 });
      this.drag = null;
      if (wasLive) this.setSteer(0, 0);
      this.paint();
      this.label.style.opacity = '';
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Slingshot geometry: pull back (down on screen) = launch forward (up). */
  private pull(): { angle: number; power: number } {
    const d = this.drag!;
    const dx = d.x - d.sx, dy = d.y - d.sy;
    const maxPull = Math.max(70, Math.min(this.surface.clientWidth, this.surface.clientHeight) * 0.45);
    const len = Math.hypot(dx, dy);
    if (dy < 6 || len < 8) return { angle: -Math.PI / 2, power: 0 };
    const angle = clamp(Math.atan2(-dy, -dx), FORWARD_MIN, FORWARD_MAX);
    return { angle, power: clamp(len / maxPull, 0, 1) };
  }

  private sendAim(): void {
    const { angle, power } = this.pull();
    this.o.send({ t: 'aim', slot: this.o.slot, angle, power: power > 0 ? Math.max(0.05, power) : -1 });
  }

  private fire(): void {
    const { angle, power } = this.pull();
    if (power < 0.12) { this.o.send({ t: 'aim', slot: this.o.slot, angle: 0, power: -1 }); return; }
    this.launched = true;
    this.o.send({ t: 'launch', slot: this.o.slot, angle, power });
    this.refreshLabels();
  }

  private sendSteer(): void {
    const d = this.drag!;
    let dx = d.x - d.sx, dy = d.y - d.sy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) { this.setSteer(0, 0); return; }
    const mag = clamp(len / STICK_R, 0, 1);
    const eff = mag < DEADZONE ? 0 : (mag - DEADZONE) / (1 - DEADZONE);
    dx = (dx / len) * eff; dy = (dy / len) * eff;
    this.setSteer(dx, dy);
  }

  private setSteer(x: number, z: number): void {
    if (Math.abs(x - this.lastSteer.x) < 0.01 && Math.abs(z - this.lastSteer.z) < 0.01) return;
    this.lastSteer = { x, z };
    this.o.send({ t: 'steer', slot: this.o.slot, x, z });
  }

  private paint(): void {
    const d = this.drag;
    if (!d) { this.base.style.display = 'none'; this.knob.style.display = 'none'; this.sling.style.display = 'none'; return; }
    if (this.live()) {
      const dx = d.x - d.sx, dy = d.y - d.sy;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, STICK_R / len);
      this.base.style.display = 'block'; this.knob.style.display = 'block'; this.sling.style.display = 'none';
      this.base.style.left = `${d.sx}px`; this.base.style.top = `${d.sy}px`;
      this.knob.style.left = `${d.sx + dx * k}px`; this.knob.style.top = `${d.sy + dy * k}px`;
    } else {
      const { angle, power } = this.pull();
      this.base.style.display = 'none'; this.knob.style.display = 'none'; this.sling.style.display = 'block';
      this.anchor.setAttribute('cx', String(d.sx)); this.anchor.setAttribute('cy', String(d.sy));
      this.band.setAttribute('x1', String(d.sx)); this.band.setAttribute('y1', String(d.sy));
      this.band.setAttribute('x2', String(d.x)); this.band.setAttribute('y2', String(d.y));
      const L = 40 + 150 * power;
      this.aimLine.setAttribute('x1', String(d.sx)); this.aimLine.setAttribute('y1', String(d.sy));
      this.aimLine.setAttribute('x2', String(d.sx + Math.cos(angle) * L)); this.aimLine.setAttribute('y2', String(d.sy + Math.sin(angle) * L));
      this.aimLine.setAttribute('opacity', power > 0 ? '1' : '0');
    }
  }

  /** Drop any press in progress (match ended, screen hidden, pad disabled). */
  cancelInput(): void {
    if (this.drag) { this.drag = null; this.paint(); this.label.style.opacity = ''; }
    this.setSteer(0, 0);
    this.held.forEach((was, i) => {
      if (!was) return;
      this.held[i] = false;
      this.mbtns[i].classList.remove('down');
      if (!this.over) this.o.send({ t: 'move', slot: this.o.slot, index: i as 0 | 1 | 2, phase: 'up' });
    });
  }

  dispose(): void {
    this.cancelInput();
    this.el.remove();
    void this.lastFb;
  }
}
