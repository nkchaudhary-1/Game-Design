import type { RoomState } from './state.js';

export const IDLE_TTL_MS = 3 * 60 * 60 * 1000;
export const ENDED_TTL_MS = 15 * 60 * 1000;

export function ttlFor(room: RoomState): number {
  return room.phase === 'ended' ? ENDED_TTL_MS : IDLE_TTL_MS;
}
