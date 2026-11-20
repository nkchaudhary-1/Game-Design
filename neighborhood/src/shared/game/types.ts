import type { ItemInst } from './items';
import type { Device, Security } from './rules';

export type OwnerKind = 'npc' | 'player' | 'vacant';
export interface HouseState {
  id: number; ownerKind: OwnerKind; ownerId: string; ownerName: string;
  tier: number; lock: number; devices: Device[]; nextDev: number; slots: (ItemInst | null)[];
  open: boolean; raidable: boolean;
  robbedUntil: number; protectedUntil: number; lastBurglary: number; restockAt: number;
}
export interface LogEntry { t: number; kind: 'burglar' | 'thwart' | 'heist' | 'info'; text: string }
export interface PlayerGame {
  cash: number; rep: number; inv: ItemInst[]; tools: Record<string, number>; home: number;
  stats: { heists: number; arrests: number; thwarted: number; deliveries: number; stolen: number };
  log: LogEntry[]; seenLog: number; cooldownUntil: number;
  job: { house: number; until: number; pay: number } | null; jobReadyAt: number;
}
export const newPlayerGame = (cash: number): PlayerGame => ({
  cash, rep: 0, inv: [], tools: {}, home: -1, stats: { heists: 0, arrests: 0, thwarted: 0, deliveries: 0, stolen: 0 },
  log: [], seenLog: 0, cooldownUntil: 0, job: null, jobReadyAt: 0,
});

// ── wire DTOs ──
export interface HomePub { id: number; owner: 'npc' | 'player' | 'vacant'; ownerName: string; tier: number; price: number; open: boolean; raidable: boolean; robbed: boolean; mine: boolean }
export interface ScoutInfo { sec: Security; items: number; best: number; wealth: string; until: number }
export interface HouseView { id: number; slots: (ItemInst | null)[]; lock: number; devices: Device[]; tier: number; mine: boolean }
export interface HeistDto {
  house: number; phase: 'approach' | 'inside'; alert: number; threshold: number; alarm: number; left: number;
  carrying: ItemInst[]; jam: number; dogAsleep: number; wanted: boolean; spotted: boolean;
  channel: { kind: string; p: number; label: string } | null; clear: number;
}
export interface MeDto {
  cash: number; rep: number; title: string; inv: ItemInst[]; tools: Record<string, number>; home: number;
  job: { house: number; left: number; pay: number } | null;
  stats: PlayerGame['stats']; cooldown: number; newbie: number; log: LogEntry[]; unseen: number;
}
export interface GameDto {
  me: MeDto; homes: HomePub[]; view: HouseView | null; scout: Record<number, ScoutInfo>;
  heist: HeistDto | null; market: { stock: { def: string; price: number }[]; resetIn: number };
  notes: { kind: 'ok' | 'bad' | 'info'; text: string }[];
}
