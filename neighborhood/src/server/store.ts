import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PlayerRec, StoreApi } from './types';

export type { PlayerRec };
interface Data { v: 1; players: Record<string, PlayerRec>; doors: number[]; sw: number[]; houses?: unknown }

/** Public id derived from the login token. Only this hash is stored — never the token. */
export const idFromToken = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 10);

/**
 * Tiny JSON-file persistence (atomic write, debounced). The interface is deliberately the shape of a
 * Postgres/Supabase repository so it can be swapped without touching the game code.
 */
export class Store implements StoreApi {
  private data: Data = { v: 1, players: {}, doors: [], sw: [] };
  private timer: NodeJS.Timeout | null = null;
  constructor(private path: string | null) {
    if (path && existsSync(path)) {
      try { this.data = { ...this.data, ...JSON.parse(readFileSync(path, 'utf8')) }; } catch { /* corrupt file: start clean */ }
    }
  }
  player(id: string): PlayerRec | undefined { return this.data.players[id]; }
  setPlayer(id: string, rec: PlayerRec) { this.data.players[id] = rec; this.dirty(); }
  get world() { return { doors: this.data.doors, sw: this.data.sw }; }
  get houses() { return this.data.houses; }
  setHouses(h: unknown) { this.data.houses = h; this.dirty(); }
  setWorld(doors: number[], sw: number[]) { this.data.doors = doors; this.data.sw = sw; this.dirty(); }
  private dirty() { if (!this.path || this.timer) return; this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 3000); }
  flush() {
    if (!this.path) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
}
