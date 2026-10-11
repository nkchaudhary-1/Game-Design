/**
 * Headless WebSocket client that plays Undercover legally from the server's
 * personalised view alone. Used by `npm run simulate`, the chaos run, the
 * restart test and the security test.
 */
import WebSocket from 'ws';
import type { ClientMessage, PlayerColor, RoomSettings, RoomView, ServerMessage } from '@undercover/shared';
import { PLAYER_COLORS } from '@undercover/shared';

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
  private lastActionKey = '';
  private waiters: { pred: (v: RoomView) => boolean; resolve: (v: RoomView) => void }[] = [];
  private rng: () => number;
  private closedByUs = false;

  constructor(
    private url: string,
    public opts: BotOptions,
  ) {
    this.rng = opts.rng ?? Math.random;
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

  private pick<T>(items: T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  /** Decide what to do with the latest view. Only legal moves, exactly once per step. */
  private act(view: RoomView): void {
    const me = view.players.find((p) => p.id === view.youId);
    if (!me) return;
    const controller = view.isHost || view.isGod;
    const stepKey = `${view.phase}:${view.day}:${view.night?.step ?? ''}:${view.announcement === null ? 'pending' : 'pub'}`;

    switch (view.phase) {
      case 'waiting':
        return; // the simulation driver starts the game
      case 'roleReveal':
        if (!view.acked && !view.isGod && this.once(stepKey)) this.send({ type: 'ackReveal' });
        return;
      case 'night': {
        const night = view.night;
        if (!night) return;
        if (night.step === 'narrator') {
          if (!night.narratorAcked && !view.isGod && this.once(stepKey)) this.send({ type: 'ackNarrator' });
          return;
        }
        if (night.canAct && night.yourPick && !night.yourPick.confirmed && night.legalTargets?.length) {
          if (this.once(stepKey)) {
            const target = this.pick(night.legalTargets);
            // Traitors first mark, then confirm, so the live team-picks path is exercised.
            if (view.you.role === 'traitor') this.send({ type: 'nightAction', targetId: target, confirm: false });
            this.send({ type: 'nightAction', targetId: target, confirm: true });
          }
        }
        return;
      }
      case 'dayReveal':
      case 'voteResult': {
        if (!controller) return;
        if (view.god?.pendingAnnouncement !== undefined && view.announcement === null) {
          if (this.once(stepKey + ':publish')) {
            this.send({ type: 'publishAnnouncement', text: view.god.pendingAnnouncement + ' (The narrator nods.)' });
          }
          return;
        }
        if (view.isGod || this.opts.impatient) {
          if (this.once(stepKey + ':advance')) setTimeout(() => this.send({ type: 'advancePhase' }), 30);
        }
        return;
      }
      case 'discussion':
        if (controller && this.opts.impatient !== false && this.once(stepKey)) {
          setTimeout(() => this.send({ type: 'advancePhase' }), 30);
        }
        return;
      case 'voting': {
        if (view.isGod || !me.alive || view.voteTally?.yourVote) return;
        const targets = view.players.filter((p) => p.alive && p.id !== view.youId && p.id !== view.godId);
        if (targets.length && this.once(stepKey)) this.send({ type: 'castVote', targetId: this.pick(targets).id });
        return;
      }
      default:
        return;
    }
  }

  private once(key: string): boolean {
    if (this.lastActionKey === key) return false;
    this.lastActionKey = key;
    return true;
  }
}
