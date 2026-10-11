import type { ClientMessage, RoomView, ServerMessage } from '@undercover/shared';

export type Status = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface Session {
  roomCode: string;
  playerId: string;
  secret: string;
}

export interface GameError {
  code: string;
  message: string;
  ref?: string;
  at: number;
}

export interface ClientState {
  status: Status;
  view: RoomView | null;
  session: Session | null;
  error: GameError | null;
  /** serverNow - clientNow, so countdowns follow the server's clock. */
  clockOffset: number;
  /** True once a rejoin attempt on load has resolved one way or the other. */
  resolved: boolean;
}

const SESSION_KEY = 'undercover.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (s && s.roomCode && s.playerId && s.secret) return s;
  } catch {
    /* ignore */
  }
  return null;
}

function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

type Listener = (s: ClientState) => void;

/** The subset of WebSocket the client relies on, so a local in-browser transport can stand in. */
export interface SocketLike {
  readonly OPEN: number;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export class GameClient {
  state: ClientState = {
    status: 'idle',
    view: null,
    session: null,
    error: null,
    clockOffset: 0,
    resolved: false,
  };
  private socketFactory: () => SocketLike = () => new WebSocket(this.url) as unknown as SocketLike;
  private persist = true;
  private ws: SocketLike | null = null;
  private listeners = new Set<Listener>();
  private attempts = 0;
  private retryTimer: number | null = null;
  private everOpened = false;
  private closedByUs = false;
  private pendingRejoin = false;

  constructor(private url: string = defaultUrl()) {
    this.state.session = loadSession();
  }

  /** Swap the transport (used by the solo demo) and optionally stop touching localStorage. */
  configure(opts: { socketFactory?: () => SocketLike; persist?: boolean }): void {
    if (opts.socketFactory) this.socketFactory = opts.socketFactory;
    if (opts.persist !== undefined) {
      this.persist = opts.persist;
      if (!opts.persist) this.state = { ...this.state, session: null };
    }
  }

  private save(s: Session | null): void {
    if (this.persist) saveSession(s);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === this.ws.OPEN || this.ws.readyState === 0)) return;
    this.closedByUs = false;
    this.set({ status: this.everOpened ? 'reconnecting' : 'connecting' });
    const ws = this.socketFactory();
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.everOpened = true;
      this.set({ status: 'open' });
      if (this.state.session) {
        this.pendingRejoin = true;
        this.raw({ type: 'rejoin', code: this.state.session.roomCode, playerId: this.state.session.playerId, secret: this.state.session.secret });
      } else {
        this.set({ resolved: true });
      }
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data) as ServerMessage);
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.closedByUs) return;
      this.set({ status: 'reconnecting' });
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.attempts, 5)) + Math.random() * 250;
    this.attempts += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** Called when the tab becomes visible again or the network returns. */
  nudge(): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) return;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.connect();
  }

  private raw(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  send(msg: ClientMessage): void {
    this.set({ error: null });
    if (!this.raw(msg)) {
      this.set({ error: { code: 'offline', message: 'You are offline. Reconnecting...', ref: msg.type, at: Date.now() } });
      this.nudge();
    }
  }

  clearError(): void {
    if (this.state.error) this.set({ error: null });
  }

  /** Forget the room and start fresh. */
  leave(): void {
    this.raw({ type: 'leaveRoom' });
    this.save(null);
    this.set({ session: null, view: null, error: null, resolved: true });
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'joined': {
        const session = { roomCode: msg.code, playerId: msg.playerId, secret: msg.secret };
        this.save(session);
        this.pendingRejoin = false;
        this.set({ session, resolved: true });
        break;
      }
      case 'roomState':
        this.set({ view: msg.view, clockOffset: msg.view.serverNow - Date.now(), resolved: true });
        break;
      case 'voteTally':
        if (this.state.view) this.set({ view: { ...this.state.view, voteTally: msg.tally } });
        break;
      case 'error':
        if (this.pendingRejoin && msg.ref === 'rejoin') {
          // Stale session: the room is gone or the secret is wrong. Start over quietly.
          this.pendingRejoin = false;
          this.save(null);
          this.set({ session: null, view: null, resolved: true });
          break;
        }
        this.set({ error: { code: msg.code, message: msg.message, ref: msg.ref, at: Date.now() } });
        break;
      case 'left':
        this.save(null);
        this.set({ session: null, view: null, resolved: true });
        break;
      case 'pong':
        this.set({ clockOffset: msg.serverNow - Date.now() });
        break;
    }
  }
}

function defaultUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export const client = new GameClient();
