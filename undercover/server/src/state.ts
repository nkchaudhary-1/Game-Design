import type { GodNightBreakdown, Mode, NightStep, Phase, PlayerColor, Role, RoomSettings, Winner } from '@undercover/shared';

export interface PlayerState {
  id: string;
  name: string;
  color: PlayerColor;
  secret: string;
  joinedAt: number;
  connected: boolean;
  disconnectedAt: number | null;
  alive: boolean;
  role: Role | null;
}

export interface PickState {
  targetId: string | null;
  confirmed: boolean;
  submittedAt: number;
}

export interface TimerState {
  kind: 'roleReveal' | 'narrator' | 'night' | 'dayReveal' | 'discussion' | 'voting' | 'voteResult';
  endsAt: number;
  totalMs: number;
}

export interface NightState {
  step: NightStep;
  picks: Record<string, PickState>;
  seq: number;
}

export interface RoomState {
  code: string;
  createdAt: number;
  updatedAt: number;
  settings: RoomSettings;
  mode: Mode;
  hostId: string;
  godId: string | null;
  phase: Phase;
  day: number;
  players: PlayerState[];
  timer: TimerState | null;
  acks: string[];
  night: NightState | null;
  lastNight: GodNightBreakdown | null;
  votes: Record<string, string>;
  announcement: string | null;
  pendingAnnouncement: string | null;
  lastVoteResult: { eliminatedId: string | null; role: Role | null; tied: boolean } | null;
  policeFindings: { day: number; targetId: string; isTraitor: boolean }[];
  log: string[];
  winner: Winner | null;
  /** Ids of traitors revealed to each other on night 1 (so the view stays stable after reconnects). */
  traitorsRevealed: boolean;
}

export function gamePlayers(room: RoomState): PlayerState[] {
  return room.players.filter((p) => p.id !== room.godId);
}

export function alivePlayers(room: RoomState): PlayerState[] {
  return gamePlayers(room).filter((p) => p.alive);
}

export function findPlayer(room: RoomState, id: string): PlayerState | undefined {
  return room.players.find((p) => p.id === id);
}

export function rolesOf(room: RoomState): Record<string, Role> {
  const out: Record<string, Role> = {};
  for (const p of gamePlayers(room)) if (p.role) out[p.id] = p.role;
  return out;
}

export function playerName(room: RoomState, id: string | null): string {
  if (!id) return 'nobody';
  return findPlayer(room, id)?.name ?? 'someone';
}
