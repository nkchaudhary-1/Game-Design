import { SIM_DT } from '../shared/consts';
import type { C2S, S2C } from '../shared/protocol';
import { addNeighbours } from '../server/bots';
import { GameWorld, type SPlayer } from '../server/game';
import { hashToken, MemoryStore, type Storage1 } from '../server/memstore';
import type { NetLike } from './net';

function slot(key: string): Storage1 | undefined {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return undefined;
    return { get: () => { try { return ls.getItem(key); } catch { return null; } }, set: (v) => { try { ls.setItem(key, v); } catch { /* blocked */ } } };
  } catch { return undefined; }
}

/**
 * The whole authoritative game server, running inside the page. Same GameWorld, same rules, no network:
 * messages are delivered synchronously. Three simulated neighbours share the street with you.
 */
export class LocalHost implements NetLike {
  rtt = 0;
  onMessage: (m: S2C) => void = () => {};
  onClose: () => void = () => {};
  readonly world: GameWorld;
  private player: SPlayer | null = null;
  private timer: ReturnType<typeof setInterval>;

  constructor(withNeighbours = true) {
    this.world = new GameWorld(new MemoryStore(slot('nb.demo.world')), hashToken);
    const bots = withNeighbours ? addNeighbours(this.world) : null;
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000); last = now;
      while (acc >= SIM_DT) { bots?.tick(SIM_DT); this.world.step(); acc -= SIM_DT; }
    }, 8);
  }

  connect() { return Promise.resolve(); }
  send(m: C2S) {
    if (!this.player) {
      if (m.t === 'hello') this.player = this.world.join({ send: (msg) => this.onMessage(msg), close: () => {} }, m.token, m.name, m.look);
      return;
    }
    this.world.onMessage(this.player, m);
  }
  close() { if (this.player) this.world.leave(this.player); this.player = null; }
  dispose() { clearInterval(this.timer); this.close(); }
}
