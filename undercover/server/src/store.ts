import type { RoomState } from './state.js';

export const IDLE_TTL_MS = 3 * 60 * 60 * 1000;
export const ENDED_TTL_MS = 15 * 60 * 1000;

export function ttlFor(room: RoomState): number {
  return room.phase === 'ended' ? ENDED_TTL_MS : IDLE_TTL_MS;
}

export interface RoomStore {
  get(code: string): Promise<RoomState | null>;
  set(room: RoomState): Promise<void>;
  delete(code: string): Promise<void>;
  /** All rooms, used to re-arm timers on boot. */
  list(): Promise<RoomState[]>;
  /** Remove expired rooms. Returns the codes removed. */
  sweep(now: number): Promise<string[]>;
  close(): Promise<void>;
}

export class MemoryStore implements RoomStore {
  private rooms = new Map<string, RoomState>();

  async get(code: string): Promise<RoomState | null> {
    return this.rooms.get(code) ?? null;
  }
  async set(room: RoomState): Promise<void> {
    this.rooms.set(room.code, room);
  }
  async delete(code: string): Promise<void> {
    this.rooms.delete(code);
  }
  async list(): Promise<RoomState[]> {
    return [...this.rooms.values()];
  }
  async sweep(now: number): Promise<string[]> {
    const gone: string[] = [];
    for (const room of this.rooms.values()) {
      if (now - room.updatedAt > ttlFor(room)) {
        this.rooms.delete(room.code);
        gone.push(room.code);
      }
    }
    return gone;
  }
  async close(): Promise<void> {
    this.rooms.clear();
  }
}

/** Redis-backed store. Rooms are JSON under `uc:room:{code}`; `uc:rooms` indexes the codes. */
export class RedisStore implements RoomStore {
  private redis: import('ioredis').Redis;
  private prefix: string;

  constructor(redis: import('ioredis').Redis, prefix = 'uc') {
    this.redis = redis;
    this.prefix = prefix;
  }

  static async connect(url: string, prefix = 'uc'): Promise<RedisStore> {
    const { Redis } = await import('ioredis');
    const redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
    await redis.connect();
    return new RedisStore(redis, prefix);
  }

  private key(code: string): string {
    return `${this.prefix}:room:${code}`;
  }
  private get index(): string {
    return `${this.prefix}:rooms`;
  }

  async get(code: string): Promise<RoomState | null> {
    const raw = await this.redis.get(this.key(code));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }
  async set(room: RoomState): Promise<void> {
    const ttlSec = Math.max(1, Math.ceil(ttlFor(room) / 1000));
    await this.redis
      .multi()
      .set(this.key(room.code), JSON.stringify(room), 'EX', ttlSec)
      .sadd(this.index, room.code)
      .exec();
  }
  async delete(code: string): Promise<void> {
    await this.redis.multi().del(this.key(code)).srem(this.index, code).exec();
  }
  async list(): Promise<RoomState[]> {
    const codes = await this.redis.smembers(this.index);
    if (codes.length === 0) return [];
    const raws = await this.redis.mget(codes.map((c) => this.key(c)));
    const rooms: RoomState[] = [];
    const stale: string[] = [];
    raws.forEach((raw, i) => {
      if (raw) rooms.push(JSON.parse(raw) as RoomState);
      else stale.push(codes[i]);
    });
    if (stale.length) await this.redis.srem(this.index, ...stale);
    return rooms;
  }
  async sweep(now: number): Promise<string[]> {
    // Redis expires keys itself; this only trims the index and rooms past TTL whose key outlived it.
    const rooms = await this.list();
    const gone: string[] = [];
    for (const room of rooms) {
      if (now - room.updatedAt > ttlFor(room)) {
        await this.delete(room.code);
        gone.push(room.code);
      }
    }
    return gone;
  }
  /** Seconds until the room key expires (tests). */
  async ttl(code: string): Promise<number> {
    return this.redis.ttl(this.key(code));
  }
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
