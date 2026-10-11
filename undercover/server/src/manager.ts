import {
  cleanName,
  isValidRoomCode,
  makeRoomCode,
  uniqueName,
  type ClientMessage,
  type ErrorCode,
  type PlayerColor,
  type Rng,
  type RoomSettings,
  type ServerMessage,
} from '@undercover/shared';
import {
  ackNarrator,
  ackReveal,
  addPlayer,
  advancePhase,
  castVote,
  createRoom,
  GameError,
  nightAction,
  onTimeout,
  publishAnnouncement,
  realClock,
  recheckEarlyEnd,
  removePlayer,
  startGame,
  transferHost,
  viewFor,
  type Clock,
} from './game.js';
import { RateLimiter } from './ratelimit.js';
import { findPlayer, type RoomState } from './state.js';
import { MemoryStore } from './memoryStore.js';
import type { RoomStore } from './store.js';

const webCrypto = globalThis.crypto;
function randomUUID(): string {
  return webCrypto.randomUUID();
}
function randomSecret(): string {
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
const env = (key: string): string | undefined => (typeof process !== 'undefined' && process.env ? process.env[key] : undefined);

export interface Conn {
  id: string;
  ip: string;
  playerId: string | null;
  code: string | null;
  send(msg: ServerMessage): void;
}

export interface ManagerOptions {
  store?: RoomStore;
  clock?: Clock;
  rng?: Rng;
  /** Grace period before a disconnected player loses host status / lobby seat. */
  graceMs?: number;
  log?: (line: string) => void;
  /** Disable per-IP rate limits (simulations and tests only). */
  rateLimits?: boolean;
}

export class RoomManager {
  readonly store: RoomStore;
  readonly clock: Clock;
  private rng: Rng;
  private graceMs: number;
  private log: (line: string) => void;
  private rooms = new Map<string, RoomState>();
  private conns = new Map<string, Map<string, Set<Conn>>>(); // code -> playerId -> conns
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>(); // `${code}:${playerId}`
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private createLimiter = new RateLimiter(6, 6 / 60_000);
  private joinLimiter = new RateLimiter(30, 30 / 60_000);
  private messageLimiter = new RateLimiter(40, 20 / 1000);
  private rateLimits: boolean;

  constructor(opts: ManagerOptions = {}) {
    this.store = opts.store ?? new MemoryStore();
    this.clock = opts.clock ?? realClock;
    this.rng = opts.rng ?? Math.random;
    this.graceMs = opts.graceMs ?? Math.max(1000, Math.round((Number(env('GRACE_MS') ?? '90000') || 90000) * this.clock.scale));
    this.log = opts.log ?? (() => {});
    this.rateLimits = opts.rateLimits ?? true;
  }

  /** Load persisted rooms and re-arm their timers (server restart mid-game). */
  async boot(): Promise<number> {
    const rooms = await this.store.list();
    for (const room of rooms) {
      this.rooms.set(room.code, room);
      for (const p of room.players) {
        if (p.connected) {
          p.connected = false;
          p.disconnectedAt = this.clock.now();
        }
        this.scheduleGrace(room, p.id);
      }
      this.armTimer(room);
    }
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    (this.sweeper as { unref?: () => void }).unref?.();
    this.log(`boot: ${rooms.length} room(s) restored`);
    return rooms.length;
  }

  async close(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.timers.clear();
    this.graceTimers.clear();
    if (this.sweeper) clearInterval(this.sweeper);
    await this.store.close();
  }

  /** Expose a room for tests / simulations. Never send this to a client. */
  getRoom(code: string): RoomState | undefined {
    return this.rooms.get(code);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  async handle(conn: Conn, msg: ClientMessage): Promise<void> {
    if (this.rateLimits && !this.messageLimiter.take(conn.id)) {
      conn.send({ type: 'error', code: 'rateLimited', message: 'Slow down.', ref: msg.type });
      return;
    }
    try {
      switch (msg.type) {
        case 'ping':
          conn.send({ type: 'pong', serverNow: this.clock.now() });
          return;
        case 'createRoom':
          await this.create(conn, msg.name, msg.color, msg.settings);
          return;
        case 'joinRoom':
          await this.join(conn, msg.code, msg.name, msg.color);
          return;
        case 'rejoin':
          await this.rejoin(conn, msg.code, msg.playerId, msg.secret);
          return;
        case 'leaveRoom':
          await this.leave(conn);
          return;
        default:
          await this.gameMessage(conn, msg);
      }
    } catch (err) {
      if (err instanceof GameError) {
        conn.send({ type: 'error', code: err.code, message: err.message, ref: msg.type });
      } else {
        this.log(`error handling ${msg.type}: ${(err as Error).message}`);
        conn.send({ type: 'error', code: 'badMessage', message: 'Something went wrong.', ref: msg.type });
      }
    }
  }

  private async create(conn: Conn, rawName: string, color: PlayerColor, settings: RoomSettings): Promise<void> {
    if (this.rateLimits && !this.createLimiter.take(conn.ip)) throw new GameError('rateLimited', 'Too many rooms created. Try again in a minute.');
    if (conn.code) await this.leave(conn);
    const name = cleanName(rawName) || 'Stranger';
    let code = makeRoomCode(this.rng);
    for (let i = 0; i < 20 && (this.rooms.has(code) || (await this.store.get(code))); i++) code = makeRoomCode(this.rng);
    const host = { id: randomUUID(), name, color, secret: randomSecret() };
    const room = createRoom(code, host, settings, this.clock);
    this.rooms.set(code, room);
    this.bind(conn, room, host.id, host.secret);
    this.log(`room ${code} created (${settings.mode}, ${settings.targetCount})`);
    await this.commit(room);
  }

  private async join(conn: Conn, rawCode: string, rawName: string, color: PlayerColor): Promise<void> {
    if (this.rateLimits && !this.joinLimiter.take(conn.ip)) throw new GameError('rateLimited', 'Too many join attempts. Try again in a minute.');
    const code = rawCode.toUpperCase();
    if (!isValidRoomCode(code)) throw new GameError('roomNotFound', 'That room code does not look right.');
    const room = await this.load(code);
    if (!room) throw new GameError('roomNotFound', 'No room with that code.');
    if (conn.code && conn.code !== code) await this.leave(conn);
    const name = uniqueName(
      cleanName(rawName) || 'Stranger',
      room.players.map((p) => p.name),
    );
    const player = { id: randomUUID(), name, color, secret: randomSecret() };
    addPlayer(room, player, this.clock);
    this.bind(conn, room, player.id, player.secret);
    room.log.push(`${name} joined.`);
    await this.commit(room);
  }

  private async rejoin(conn: Conn, rawCode: string, playerId: string, secret: string): Promise<void> {
    const code = rawCode.toUpperCase();
    const room = await this.load(code);
    if (!room) throw new GameError('roomNotFound', 'That room no longer exists.');
    const player = findPlayer(room, playerId);
    if (!player || player.secret !== secret) throw new GameError('badSecret', 'Could not rejoin this room.');
    this.bind(conn, room, player.id, player.secret);
    await this.commit(room);
  }

  private bind(conn: Conn, room: RoomState, playerId: string, secret: string): void {
    conn.code = room.code;
    conn.playerId = playerId;
    let byPlayer = this.conns.get(room.code);
    if (!byPlayer) {
      byPlayer = new Map();
      this.conns.set(room.code, byPlayer);
    }
    let set = byPlayer.get(playerId);
    if (!set) {
      set = new Set();
      byPlayer.set(playerId, set);
    }
    set.add(conn);
    const player = findPlayer(room, playerId);
    if (player) {
      const wasDisconnected = !player.connected;
      player.connected = true;
      player.disconnectedAt = null;
      this.clearGrace(room.code, playerId);
      if (wasDisconnected && room.phase !== 'waiting') room.log.push(`${player.name} reconnected.`);
    }
    conn.send({ type: 'joined', code: room.code, playerId, secret });
  }

  private async leave(conn: Conn): Promise<void> {
    const { code, playerId } = conn;
    if (!code || !playerId) {
      conn.send({ type: 'left' });
      return;
    }
    this.unbind(conn);
    const room = this.rooms.get(code);
    if (room) {
      const player = findPlayer(room, playerId);
      if (room.phase === 'waiting') {
        removePlayer(room, playerId, this.clock);
        if (player) room.log.push(`${player.name} left.`);
      } else if (player) {
        player.connected = false;
        player.disconnectedAt = this.clock.now();
        this.scheduleGrace(room, playerId);
        recheckEarlyEnd(room, this.rng, this.clock);
      }
      await this.commitOrDelete(room);
    }
    conn.send({ type: 'left' });
  }

  private async gameMessage(conn: Conn, msg: ClientMessage): Promise<void> {
    if (!conn.code || !conn.playerId) throw new GameError('notInRoom', 'Join a room first.');
    const room = this.rooms.get(conn.code);
    if (!room) throw new GameError('roomNotFound', 'That room no longer exists.');
    const pid = conn.playerId;
    switch (msg.type) {
      case 'startGame':
        startGame(room, pid, this.rng, this.clock);
        break;
      case 'ackReveal':
        ackReveal(room, pid, this.clock);
        break;
      case 'ackNarrator':
        ackNarrator(room, pid, this.clock);
        break;
      case 'nightAction':
        nightAction(room, pid, msg.targetId, msg.confirm, this.rng, this.clock);
        break;
      case 'castVote': {
        const resolved = castVote(room, pid, msg.targetId, this.clock);
        if (!resolved) {
          // Live tally after each vote; the full roomState follows from commit() too.
          this.broadcastTally(room);
        }
        break;
      }
      case 'advancePhase':
        advancePhase(room, pid, this.rng, this.clock);
        break;
      case 'publishAnnouncement':
        publishAnnouncement(room, pid, msg.text, this.clock);
        break;
      default:
        throw new GameError('badMessage', 'Unknown message.');
    }
    await this.commit(room);
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  async onDisconnect(conn: Conn): Promise<void> {
    const { code, playerId } = conn;
    this.unbind(conn);
    if (!code || !playerId) return;
    const room = this.rooms.get(code);
    if (!room) return;
    const stillConnected = (this.conns.get(code)?.get(playerId)?.size ?? 0) > 0;
    if (stillConnected) return;
    const player = findPlayer(room, playerId);
    if (!player) return;
    player.connected = false;
    player.disconnectedAt = this.clock.now();
    this.scheduleGrace(room, playerId);
    recheckEarlyEnd(room, this.rng, this.clock);
    await this.commit(room);
  }

  private unbind(conn: Conn): void {
    const { code, playerId } = conn;
    if (code && playerId) {
      const set = this.conns.get(code)?.get(playerId);
      set?.delete(conn);
      if (set && set.size === 0) this.conns.get(code)?.delete(playerId);
    }
    conn.code = null;
    conn.playerId = null;
  }

  private scheduleGrace(room: RoomState, playerId: string): void {
    const key = `${room.code}:${playerId}`;
    this.clearGrace(room.code, playerId);
    const t = setTimeout(() => {
      this.graceTimers.delete(key);
      void this.graceExpired(room.code, playerId);
    }, this.graceMs);
    (t as { unref?: () => void }).unref?.();
    this.graceTimers.set(key, t);
  }

  private clearGrace(code: string, playerId: string): void {
    const key = `${code}:${playerId}`;
    const t = this.graceTimers.get(key);
    if (t) clearTimeout(t);
    this.graceTimers.delete(key);
  }

  private async graceExpired(code: string, playerId: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room) return;
    const player = findPlayer(room, playerId);
    if (!player || player.connected) return;
    if (room.phase === 'waiting') {
      removePlayer(room, playerId, this.clock);
      room.log.push(`${player.name} left.`);
    } else if (room.hostId === playerId && room.phase !== 'ended') {
      transferHost(room, this.clock, `${player.name} is away.`);
      // A pending God announcement must not block the game once God is gone.
      if (room.pendingAnnouncement !== null && room.announcement === null) {
        room.announcement = room.pendingAnnouncement;
        room.pendingAnnouncement = null;
        if (!room.timer) {
          room.updatedAt = this.clock.now();
          // Fall back to the player-mode pause so the game keeps moving.
          room.timer = { kind: room.phase === 'dayReveal' ? 'dayReveal' : 'voteResult', endsAt: this.clock.now() + 10_000 * this.clock.scale, totalMs: 10_000 * this.clock.scale };
        }
      }
    }
    await this.commitOrDelete(room);
  }

  // -------------------------------------------------------------------------
  // Timers, persistence, broadcast
  // -------------------------------------------------------------------------

  private armTimer(room: RoomState): void {
    const existing = this.timers.get(room.code);
    if (existing) clearTimeout(existing);
    this.timers.delete(room.code);
    if (!room.timer) return;
    const delay = Math.max(0, room.timer.endsAt - this.clock.now());
    const t = setTimeout(() => {
      this.timers.delete(room.code);
      void this.fireTimer(room.code);
    }, delay);
    (t as { unref?: () => void }).unref?.();
    this.timers.set(room.code, t);
  }

  private async fireTimer(code: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room || !room.timer) return;
    if (room.timer.endsAt > this.clock.now() + 5) {
      this.armTimer(room);
      return;
    }
    onTimeout(room, this.rng, this.clock);
    await this.commit(room);
  }

  private async commitOrDelete(room: RoomState): Promise<void> {
    if (room.players.length === 0) {
      await this.dropRoom(room.code);
      return;
    }
    await this.commit(room);
  }

  private async dropRoom(code: string): Promise<void> {
    const t = this.timers.get(code);
    if (t) clearTimeout(t);
    this.timers.delete(code);
    this.rooms.delete(code);
    this.conns.delete(code);
    await this.store.delete(code);
    this.log(`room ${code} removed`);
  }

  private async commit(room: RoomState): Promise<void> {
    this.armTimer(room);
    this.broadcast(room);
    try {
      await this.store.set(room);
    } catch (err) {
      this.log(`persist failed for ${room.code}: ${(err as Error).message}`);
    }
  }

  private broadcast(room: RoomState): void {
    const byPlayer = this.conns.get(room.code);
    if (!byPlayer) return;
    for (const [playerId, conns] of byPlayer) {
      if (!findPlayer(room, playerId)) continue;
      const view = viewFor(room, playerId, this.clock);
      const msg: ServerMessage = { type: 'roomState', view };
      for (const c of conns) c.send(msg);
    }
  }

  private broadcastTally(room: RoomState): void {
    const byPlayer = this.conns.get(room.code);
    if (!byPlayer) return;
    for (const [playerId, conns] of byPlayer) {
      const view = viewFor(room, playerId, this.clock);
      if (!view.voteTally) continue;
      for (const c of conns) c.send({ type: 'voteTally', tally: view.voteTally });
    }
  }

  private async load(code: string): Promise<RoomState | null> {
    const cached = this.rooms.get(code);
    if (cached) return cached;
    const stored = await this.store.get(code);
    if (stored) {
      this.rooms.set(code, stored);
      this.armTimer(stored);
    }
    return stored;
  }

  async sweep(): Promise<void> {
    const now = this.clock.now();
    const gone = await this.store.sweep(now);
    for (const code of gone) await this.dropRoom(code);
    for (const room of this.rooms.values()) {
      const ttl = room.phase === 'ended' ? 15 * 60 * 1000 : 3 * 60 * 60 * 1000;
      if (now - room.updatedAt > ttl) await this.dropRoom(room.code);
    }
    this.createLimiter.sweep();
    this.joinLimiter.sweep();
    this.messageLimiter.sweep();
  }

  /** Send an error to a connection (used by the transport for schema failures). */
  sendError(conn: Conn, code: ErrorCode, message: string): void {
    conn.send({ type: 'error', code, message });
  }
}
