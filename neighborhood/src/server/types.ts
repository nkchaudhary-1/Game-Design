import type { Look } from '../shared/protocol';

export interface PlayerRec { name: string; look: Look; x: number; y: number; z: number; yaw: number; found: number[]; seen: number }

/** What GameWorld needs from persistence. Implemented by the JSON-file Store (Node) and an in-page store (artifact demo). */
export interface StoreApi {
  player(id: string): PlayerRec | undefined;
  setPlayer(id: string, rec: PlayerRec): void;
  readonly world: { doors: number[]; sw: number[] };
  setWorld(doors: number[], sw: number[]): void;
}
