import type { PlayerRec, StoreApi } from './types';

/** Non-cryptographic id for the in-page demo (the real server uses SHA-256). cyrb53. */
export function hashToken(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0').slice(0, 10);
}

export interface Storage1 { get(): string | null; set(v: string): void }

/** In-memory persistence with optional best-effort mirroring to a single storage slot (e.g. localStorage). */
export class MemoryStore implements StoreApi {
  private players: Record<string, PlayerRec> = {};
  private doors: number[] = [];
  private sw: number[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private storage?: Storage1) {
    try {
      const raw = storage?.get();
      if (raw) { const d = JSON.parse(raw); this.players = d.players ?? {}; this.doors = d.doors ?? []; this.sw = d.sw ?? []; }
    } catch { /* corrupt or unavailable: start clean */ }
  }
  player(id: string) { return this.players[id]; }
  setPlayer(id: string, rec: PlayerRec) { this.players[id] = rec; this.dirty(); }
  get world() { return { doors: this.doors, sw: this.sw }; }
  setWorld(doors: number[], sw: number[]) { this.doors = doors; this.sw = sw; this.dirty(); }
  private dirty() {
    if (!this.storage || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.storage!.set(JSON.stringify({ players: this.players, doors: this.doors, sw: this.sw })); } catch { /* quota / blocked */ }
    }, 2000);
  }
}
