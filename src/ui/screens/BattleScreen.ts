// Battle: the arena (display) and the controller pad side by side — PRD v2 Phase 1. The pad and the keyboard
// are controllers; the Battle consumes their messages. Round flow: launch → live → round over → result
// sheet → rematch, with a running session score.

import type { BuiltBlade } from '../../blades/BladeFactory';
import { Battle } from '../../core/Battle';
import { ChannelBus } from '../../core/InputBus';
import { KeyboardController } from '../../core/Input';
import type { MatchResult } from '../../combat/events';
import { ControllerPad } from '../ControllerPad';
import { controllerUrl } from '../ControllerPage';
import { HUD } from '../HUD';
import { h, icon } from '../dom';
import { muteButton } from '../common';
import { explainResult, matchupInfo, resultRows } from '../text';
import type { Ctx, Screen } from './types';

export class BattleScreen implements Screen {
  readonly el: HTMLElement;
  readonly battle: Battle;
  private readonly pad: ControllerPad;
  private readonly hud: HUD;
  private readonly kb: KeyboardController;
  private readonly wrap: HTMLElement;
  private readonly ro: ResizeObserver;
  private readonly offFeedback: () => void;
  private overlay: HTMLElement | null = null;
  private channel: { bus: ChannelBus; off: () => void } | null = null;
  private paused = false;
  private resultShown = false;
  private slow = 0;
  private acc = 0;

  constructor(private readonly ctx: Ctx) {
    const s = ctx.session;
    const player = s.built(s.you);
    const cpu = s.cpuBuilt();
    const rr = ctx.battleRenderer();

    this.wrap = h('div.arena-wrap');
    this.wrap.append(rr.canvas);

    this.battle = new Battle({
      rr, player, cpu, difficulty: s.difficulty, arenaId: s.arenaId, reduced: ctx.reduced, audio: ctx.audio,
      onResult: (r) => this.onResult(r, player, cpu),
    });

    this.hud = new HUD({
      match: this.battle.match,
      names: [player.def.name, cpu.def.name],
      score: s.score,
      camera: () => this.battle.view.rig.camera,
      anchor: (slot) => this.battle.view.bladeWorld(slot),
      size: () => ({ w: this.wrap.clientWidth, h: this.wrap.clientHeight }),
      touch: ctx.touch,
    });
    const pauseBtn = h('button.iconbtn', { type: 'button', 'aria-label': 'Pause', title: 'Pause (Esc)', onclick: () => this.togglePause() }, icon('pause'));
    const popBtn = h('button.iconbtn', { type: 'button', 'aria-label': 'Open controller in a new tab', title: 'Open the controller in a second tab (two-tab test)', onclick: () => this.openController(player) }, icon('phone'));
    this.hud.add(h('div.arena-tools', null, popBtn, pauseBtn, muteButton(ctx)));
    this.wrap.append(this.hud.el);

    this.battle.bus.latencyMs = ctx.latencyMs;
    this.pad = new ControllerPad({ slot: 0, built: player, send: (m) => this.battle.bus.controller.send(m) });
    this.offFeedback = this.battle.bus.controller.subscribe((m) => { if (m.t === 'feedback') this.pad.feedback(m); });

    this.kb = new KeyboardController({
      slot: 0,
      send: (m) => this.battle.bus.controller.send(m),
      phase: () => (this.paused ? 'idle' : this.resultShown ? 'over' : this.battle.currentPhase),
      onAim: (angle, power) => this.battle.bus.controller.send({ t: 'aim', slot: 0, angle, power }),
      onAnyKey: () => ctx.audio.unlock(),
    });

    this.el = h('section.battle', null, this.wrap, h('div.pad-wrap', null, this.pad.el));

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
    if (s.remoteController) this.attachChannel();
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVis);
    (window as unknown as { __battle?: Battle }).__battle = this.battle;
  }

  /** Two-tab mode: a controller in another tab drives this match through a BroadcastChannel. */
  private attachChannel(): void {
    if (this.channel) return;
    const bus = new ChannelBus();
    const side = bus.displaySide();
    const offIn = side.subscribe((m) => this.battle.bus.controller.send(m));
    const offFb = this.battle.bus.controller.subscribe((m) => { if (m.t === 'feedback') side.send(m); });
    this.channel = { bus, off: () => { offIn(); offFb(); bus.close(); } };
  }

  private openController(player: BuiltBlade): void {
    this.ctx.session.remoteController = true;
    this.attachChannel();
    window.open(controllerUrl(player.def.id, player.level, player.build, player.equippedSuper), '_blank');
  }

  resize(): void {
    const w = this.wrap.clientWidth, hh = this.wrap.clientHeight;
    if (w < 2 || hh < 2) return;
    this.ctx.battleRenderer().setSize(w, hh);
    this.battle.resize();
  }

  // ------------------------------------------------------------------------------------------ flow
  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Escape') { e.preventDefault(); if (!this.resultShown) this.togglePause(); return; }
    if (this.resultShown && !e.repeat && (e.code === 'KeyR' || e.code === 'Enter') && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      this.ctx.go('battle');
    }
  };

  private onVis = (): void => { if (document.hidden && !this.paused && !this.resultShown && this.battle.currentPhase === 'live') this.togglePause(); };

  private togglePause(): void {
    if (this.resultShown) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.pad.cancelInput();
      this.pad.setEnabled(false);
      this.kb.setEnabled(false);
      this.ctx.audio.suspend();
      this.overlay = this.sheet(
        h('div.head', null, h('h2.draw', null, 'Paused')),
        h('div.btns', null,
          h('button.btn.primary', { type: 'button', onclick: () => this.togglePause() }, icon('play'), 'Resume'),
          h('button.btn.secondary', { type: 'button', onclick: () => this.ctx.go('battle') }, 'Restart round'),
          h('button.btn.ghost', { type: 'button', onclick: () => this.ctx.go('lobby') }, 'Quit to lobby'),
        ),
      );
    } else {
      this.overlay?.remove(); this.overlay = null;
      this.pad.setEnabled(true);
      this.kb.setEnabled(true);
      this.ctx.audio.resume();
    }
  }

  private sheet(...kids: Array<Node>): HTMLElement {
    const el = h('div.result', { role: 'dialog', 'aria-modal': 'false' }, h('div.sheet', null, ...kids));
    this.wrap.append(el);
    return el;
  }

  private onResult(r: MatchResult, player: BuiltBlade, cpu: BuiltBlade): void {
    const s = this.ctx.session;
    s.record(r.winner);
    this.resultShown = true;
    this.pad.cancelInput();
    this.pad.setEnabled(false);
    this.hud.showResult(r, s.score);

    const t = explainResult(r, player, cpu);
    const mu = matchupInfo(player.def.class, cpu.def.class);
    const rows = resultRows(r);
    const stats = h('div.rstats', null,
      h('span.h', null, ''), h('span.h.a', null, 'YOU'), h('span.h.b', null, 'CPU'),
      ...rows.flatMap((row) => [h('span', null, row.label), h('span', null, row.you), h('span', null, row.cpu)]),
    );
    this.overlay = this.sheet(
      h('div.head', null,
        h('h2.' + t.tone, null, t.title),
        h('span.cause.' + t.cause.kind, null, icon(t.cause.icon), t.cause.label),
      ),
      h('div.line', null, t.line),
      ...t.why.map((w) => h('p.why', null, w)),
      h('p.why', null, h('b', null, `Session ${s.score.you}–${s.score.cpu}`), s.score.draws ? ` (${s.score.draws} draw${s.score.draws > 1 ? 's' : ''})` : '', ` · matchup: ${mu.label.toLowerCase()}`),
      stats,
      h('div.btns', null,
        h('button.btn.primary', { type: 'button', onclick: () => this.ctx.go('battle') }, 'Rematch'),
        h('button.btn.secondary', { type: 'button', onclick: () => this.ctx.go('lobby') }, 'Change blade'),
        h('button.btn.ghost', { type: 'button', onclick: () => this.ctx.go('hangar') }, 'Hangar'),
      ),
    );
    this.overlay.querySelector<HTMLElement>('.btn.primary')?.focus({ preventScroll: true });
  }

  // ----------------------------------------------------------------------------------------- frame
  frame(dt: number): void {
    if (!this.paused) {
      this.kb.tick(dt);
      this.battle.update(dt);
    }
    this.hud.update();
    this.battle.render();
    this.watchPerformance(dt);
  }

  /** Lower the render scale if frames run long (never raises it again within a session). */
  private watchPerformance(dt: number): void {
    if (this.paused) return;
    this.acc += dt; this.slow += dt > 0.026 ? 1 : 0;
    if (this.acc < 1.5) return;
    const rr = this.ctx.battleRenderer();
    const frames = Math.max(1, Math.round(this.acc / 0.0167));
    if (this.slow / frames > 0.5 && rr.quality > 0.6) rr.setQuality(Math.max(0.6, rr.quality - 0.2));
    this.acc = 0; this.slow = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    this.ro.disconnect();
    this.offFeedback();
    this.channel?.off();
    this.kb.dispose();
    this.pad.dispose();
    this.hud.dispose();
    this.battle.dispose();
    this.ctx.audio.resume();
    (window as unknown as { __battle?: Battle }).__battle = undefined;
  }
}
