/**
 * Headless WebSocket client that plays Undercover legally from the server's
 * personalised view alone. Used by `npm run simulate`, the chaos run, the
 * restart test and the security test.
 */
import WebSocket from 'ws';
import type { ClientMessage, PlayerColor, RoomSettings, RoomView, ServerMessage } from '@undercover/shared';
import { PLAYER_COLORS } from '@undercover/shared';
import { BotBrain } from './botBrain.js';

export interface BotOptions {
  name: string;
  /** Never act, never ack, never vote. Exercises every timeout path. */
  lazy?: boolean;
  /** Record every inbound message (for the security scan). */
  record?: boolean;
  rng?: () => number;
  /** Advance phases quickly when this bot is host/God (discussion etc.). */
  impatient?: boolean;
  log?: (line: string) => void;
}

export class Bot {
  ws: WebSocket | null = null;
  view: RoomView | null = null;
  code: string | null = null;
  playerId: string | null = null;
  secret: string | null = null;
  messages: ServerMessage[] = [];
  errors: Extract<ServerMessage, { type: 'error' }>[] = [];
  private brain: BotBrain;
  private waiters: { pred: (v: RoomView) => boolean; resolve: (v: RoomView) => void }[] = [];
  private rng: () => number;
  private closedByUs = false;

  constructor(
    private url: string,
    public opts: BotOptions,
  ) {
    this.rng = opts.rng ?? Math.random;
    this.brain = new BotBrain({ rng: this.rng, impatient: opts.impatient });
  }

  get name(): string {
    return this.opts.name;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url.replace(/^http/, 'ws') + '/ws');
      this.ws = ws;
      this.closedByUs = false;
      ws.once('open', () => resolve());
      ws.once('error', (e) => reject(e));
      ws.on('message', (data) => this.onMessage(JSON.parse(data.toString()) as ServerMessage));
    });
  }

  /** Drop the socket without leaving the room (simulates a lost connection). */
  drop(): void {
    this.closedByUs = true;
    this.ws?.terminate();
    this.ws = null;
  }

  async reconnect(): Promise<void> {
    await this.connect();
    if (this.code && this.playerId && this.secret) {
      this.send({ type: 'rejoin', code: this.code, playerId: this.playerId, secret: this.secret });
    }
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  create(settings: RoomSettings, color: PlayerColor = PLAYER_COLORS[0]): void {
    this.send({ type: 'createRoom', name: this.name, color, settings });
  }

  join(code: string, color: PlayerColor = PLAYER_COLORS[1]): void {
    this.send({ type: 'joinRoom', code, name: this.name, color });
  }

  waitFor(pred: (v: RoomView) => boolean, timeoutMs = 20_000, label = 'condition'): Promise<RoomView> {
    if (this.view && pred(this.view)) return Promise.resolve(this.view);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new Error(`${this.name}: timed out waiting for ${label} (phase=${this.view?.phase ?? 'none'})`));
      }, timeoutMs);
      const wrapped = (v: RoomView) => {
        clearTimeout(timer);
        resolve(v);
      };
      this.waiters.push({ pred, resolve: wrapped });
    });
  }

  waitForPhase(phase: RoomView['phase'], timeoutMs = 20_000): Promise<RoomView> {
    return this.waitFor((v) => v.phase === phase, timeoutMs, `phase ${phase}`);
  }

  private onMessage(msg: ServerMessage): void {
    if (this.opts.record) this.messages.push(msg);
    switch (msg.type) {
      case 'joined':
        this.code = msg.code;
        this.playerId = msg.playerId;
        this.secret = msg.secret;
        break;
      case 'roomState':
        this.view = msg.view;
        this.wake(msg.view);
        if (!this.opts.lazy) this.act(msg.view);
        break;
      case 'error':
        this.errors.push(msg);
        this.opts.log?.(`${this.name} error ${msg.code}: ${msg.message} (${msg.ref})`);
        break;
      default:
        break;
    }
  }

  private wake(view: RoomView): void {
    const ready = this.waiters.filter((w) => w.pred(view));
    this.waiters = this.waiters.filter((w) => !w.pred(view));
    for (const w of ready) w.resolve(view);
  }

  private act(view: RoomView): void {
    for (const msg of this.brain.act(view)) {
      if (msg.type === 'advancePhase') setTimeout(() => this.send(msg), 30);
      else this.send(msg);
    }
  }
}
