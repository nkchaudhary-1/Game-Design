// The controller ⇄ display boundary (PRD v2: "controller emits input events, display consumes them —
// even in one page — so Phase 2 swaps only the transport").
//
// Controllers (the on-page pad, the keyboard adapter, the CPU) only ever SEND `ControllerMsg`.
// The display (the match) only ever CONSUMES them and replies with light `DisplayMsg` feedback so a
// controller's meters stay honest. Today the transport is in-memory; Phase 2 swaps it for a WebSocket
// relay without touching either side. A BroadcastChannel transport is included as the PRD's stretch goal
// (two browser tabs standing in for the relay).

import type { Match } from '../combat/Match';

export type ControllerMsg =
  /** Continuous steering, unit disk. Screen-right = +x, screen-down = +z (the camera looks north-up). */
  | { t: 'steer'; slot: number; x: number; z: number }
  /** Slingshot release: `angle` on the floor plane (radians), `power` 0–1. */
  | { t: 'launch'; slot: number; angle: number; power: number }
  /** Basic move button: down/up so hold-to-charge works. */
  | { t: 'move'; slot: number; index: 0 | 1 | 2; phase: 'down' | 'up' }
  | { t: 'super'; slot: number }
  /** Launch-phase aim preview so the big screen can draw the real arrow. `power` < 0 clears it. */
  | { t: 'aim'; slot: number; angle: number; power: number };

export type MatchPhaseName = 'ready' | 'live' | 'over';

export interface PadFeedback {
  t: 'feedback';
  slot: number;
  phase: MatchPhaseName;
  spin: number;
  superState: 'READY' | 'ACTIVE' | 'RECHARGING';
  /** Seconds left in the current Super state. */
  superT: number;
  /** Full length of the current Super state (duration when ACTIVE, recharge when RECHARGING). */
  superMax: number;
  cooldowns: [number, number, number];
  cooldownMax: [number, number, number];
  chargeIndex: number;
  /** 0–1 */
  charge: number;
}

export type DisplayMsg = PadFeedback | { t: 'hit'; slot: number; strength: number };

export interface Transport<TOut, TIn> {
  send(msg: TOut): void;
  subscribe(cb: (msg: TIn) => void): () => void;
}

/** In-process, synchronous pairing of one controller side and one display side. */
export class LocalBus {
  private controllerSubs = new Set<(m: ControllerMsg) => void>();
  private displaySubs = new Set<(m: DisplayMsg) => void>();
  /** Artificial latency (ms) for feel-testing; 0 = immediate. Not used by default. */
  latencyMs = 0;

  /** Controller side: what a phone sees. */
  readonly controller: Transport<ControllerMsg, DisplayMsg> = {
    send: (m) => this.deliver(() => this.controllerSubs.forEach((cb) => cb(m))),
    subscribe: (cb) => { this.displaySubs.add(cb); return () => this.displaySubs.delete(cb); },
  };
  /** Display side: what the arena host sees. */
  readonly display: Transport<DisplayMsg, ControllerMsg> = {
    send: (m) => this.displaySubs.forEach((cb) => cb(m)),
    subscribe: (cb) => { this.controllerSubs.add(cb); return () => this.controllerSubs.delete(cb); },
  };

  private deliver(fn: () => void): void {
    if (this.latencyMs > 0) setTimeout(fn, this.latencyMs); else fn();
  }
}

/** Stretch goal: pair two tabs on one machine through BroadcastChannel (stands in for the relay). */
export class ChannelBus {
  private ch: BroadcastChannel;
  constructor(name = 'spinblade-arena') { this.ch = new BroadcastChannel(name); }
  private make<TOut, TIn>(kindOut: string, kindIn: string): Transport<TOut, TIn> {
    return {
      send: (m) => this.ch.postMessage({ k: kindOut, m }),
      subscribe: (cb) => {
        const h = (ev: MessageEvent) => { if (ev.data?.k === kindIn) cb(ev.data.m as TIn); };
        this.ch.addEventListener('message', h);
        return () => this.ch.removeEventListener('message', h);
      },
    };
  }
  controllerSide(): Transport<ControllerMsg, DisplayMsg> { return this.make('c', 'd'); }
  displaySide(): Transport<DisplayMsg, ControllerMsg> { return this.make('d', 'c'); }
  close(): void { this.ch.close(); }
}

/** Display side: turn one controller message into match input. */
export function applyControllerMsg(match: Match, msg: ControllerMsg): void {
  switch (msg.t) {
    case 'steer': match.setSteer(msg.slot, msg.x, msg.z); break;
    case 'launch': match.launch(msg.slot, msg.angle, msg.power); break;
    case 'move': match.pushAction(msg.slot, { k: msg.phase, i: msg.index }); break;
    case 'super': match.pushAction(msg.slot, { k: 'super' }); break;
    case 'aim': break; // purely visual: the display's Battle draws it
  }
}

/** Display side: the light feedback a controller needs to keep its meters honest. */
export function feedbackFor(match: Match, slot: number): PadFeedback {
  const b = match.blades[slot];
  const ab = b.charge.index >= 0 ? b.built.moves[b.charge.index] : null;
  return {
    t: 'feedback', slot, phase: match.phase, spin: Math.max(0, b.spin),
    superState: b.superState, superT: b.superT,
    superMax: b.superState === 'ACTIVE' ? b.superT + b.superElapsed : b.superState === 'RECHARGING' ? 10 : 0,
    cooldowns: [...b.cooldown] as [number, number, number],
    cooldownMax: [...b.cooldownMax] as [number, number, number],
    chargeIndex: b.charge.index,
    charge: ab?.charge ? b.charge.t / ab.charge.maxTime : 0,
  };
}
