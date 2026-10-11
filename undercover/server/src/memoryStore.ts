import type { RoomState } from './state.js';
import type { RoomStore } from './store.js';
import { ttlFor } from './ttl.js';

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

