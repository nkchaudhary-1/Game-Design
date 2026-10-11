/**
 * Browser-only transport: the real room server runs inside the tab.
 * Used by both local modes (pass & play on one phone, solo against bots).
 */
import type { ServerMessage } from '@undercover/shared';
import { RoomManager, type Conn } from '../../../server/src/manager.js';
import { MemoryStore } from '../../../server/src/memoryStore.js';
import type { Clock } from '../../../server/src/game.js';

let seq = 0;

export function makeManager(clock: Clock): RoomManager {
  return new RoomManager({ store: new MemoryStore(), clock, rateLimits: false, graceMs: 5000 });
}

export function makeConn(label: string, onMessage: (msg: ServerMessage) => void): Conn {
  return {
    id: `${label}${++seq}`,
    ip: label,
    playerId: null,
    code: null,
    send: onMessage,
  };
}
