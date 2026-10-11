import type { Mode, NightStep, Phase, PlayerColor, PlayerCount, Role, RoomSettings, Winner } from './types.js';

// ---------------------------------------------------------------------------
// Client -> Server intents. The server validates everything.
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'createRoom'; name: string; color: PlayerColor; settings: RoomSettings }
  | { type: 'joinRoom'; code: string; name: string; color: PlayerColor }
  | { type: 'rejoin'; code: string; playerId: string; secret: string }
  | { type: 'leaveRoom' }
  | { type: 'startGame' }
  | { type: 'ackReveal' }
  | { type: 'ackNarrator' }
  | { type: 'nightAction'; targetId: string | null; confirm: boolean }
  | { type: 'castVote'; targetId: string }
  | { type: 'advancePhase' }
  | { type: 'publishAnnouncement'; text: string }
  | { type: 'ping' };

export type ClientMessageType = ClientMessage['type'];

// ---------------------------------------------------------------------------
// Server -> Client. Every roomState is personalised through viewFor().
// ---------------------------------------------------------------------------

export interface PublicPlayer {
  id: string;
  name: string;
  color: PlayerColor;
  alive: boolean;
  connected: boolean;
  isHost: boolean;
  /** Seat number (join order among players), used for the portrait art. */
  avatar: number;
  /** Only present once this player's role has been deliberately revealed (eliminated / game end). */
  role?: Role;
  /** Night: whether this player has finished acting. Only meaningful for the viewer themselves or God. */
  hasVoted?: boolean;
}

export interface TeamPickView {
  traitorId: string;
  targetId: string | null;
  confirmed: boolean;
}

export interface NightView {
  step: NightStep;
  /** Whether the viewer has acknowledged the narrator step. */
  narratorAcked: boolean;
  /** Fellow traitors (ids), only for traitors on night 1. */
  teammates?: string[];
  /** Whether the viewer has a night power this night. */
  canAct: boolean;
  /** The viewer's own current pick. */
  yourPick?: { targetId: string | null; confirmed: boolean };
  /** Legal target ids for the viewer's power. */
  legalTargets?: string[];
  /** Traitor team picks, live. Traitors only. */
  teamPicks?: TeamPickView[];
}

export interface VoteTallyView {
  cast: number;
  total: number;
  counts: Record<string, number>;
  yourVote: string | null;
  /** Ids of players who have voted (counts only, never who voted for whom). */
  voted: string[];
}

export interface GodNightBreakdown {
  traitors: string[];
  traitorTarget: string | null;
  doctorId: string | null;
  doctorProtect: string | null;
  bodyguardId: string | null;
  bodyguardGuard: string | null;
  policeId: string | null;
  policeInvestigate: string | null;
  policeResult: boolean | null;
  outcome: string;
}

export interface GodView {
  roles: Record<string, Role>;
  /** Live per-player night status: picked target (or null) and whether confirmed. */
  nightStatus?: Record<string, { targetId: string | null; confirmed: boolean }>;
  lastNight?: GodNightBreakdown;
  /** Default text God may edit before publishing. Present while an announcement is pending. */
  pendingAnnouncement?: string;
  /** Who voted for whom (God only). */
  votes?: Record<string, string>;
}

export interface RoomView {
  code: string;
  phase: Phase;
  day: number;
  mode: Mode;
  settings: RoomSettings;
  hostId: string;
  /** The God player's id in god mode. */
  godId: string | null;
  youId: string;
  isGod: boolean;
  isHost: boolean;
  players: PublicPlayer[];
  timerEndsAt: number | null;
  timerTotalMs: number | null;
  you: { role: Role | null; alive: boolean };
  /** Private police findings so far, visible only to the Police. */
  policeFindings?: { day: number; targetId: string; isTraitor: boolean }[];
  night?: NightView;
  /** Public announcement for dayReveal / voteResult, null while God is still writing it. */
  announcement: string | null;
  voteTally?: VoteTallyView;
  voteResult?: { eliminatedId: string | null; role: Role | null; tied: boolean };
  ended?: { winner: Winner; roles: Record<string, Role> };
  god?: GodView;
  /** Public event log (newest last). */
  log: string[];
  /** True when the viewer has already acked the current step. */
  acked: boolean;
  /** Server time when this view was produced, so clients can offset their clocks. */
  serverNow: number;
}

export type ServerMessage =
  | { type: 'joined'; code: string; playerId: string; secret: string }
  | { type: 'roomState'; view: RoomView }
  | { type: 'voteTally'; tally: VoteTallyView }
  | { type: 'error'; code: ErrorCode; message: string; ref?: ClientMessageType }
  | { type: 'left' }
  | { type: 'pong'; serverNow: number };

export type ErrorCode =
  | 'badMessage'
  | 'roomNotFound'
  | 'roomFull'
  | 'gameStarted'
  | 'notInRoom'
  | 'notHost'
  | 'wrongPhase'
  | 'wrongRole'
  | 'notAlive'
  | 'illegalTarget'
  | 'alreadyActed'
  | 'tooFewPlayers'
  | 'rateLimited'
  | 'badSecret'
  | 'nameTaken';

export const PLAYER_COUNT_VALUES: PlayerCount[] = [5, 7, 9, 11];
export const PHASES: Phase[] = ['waiting', 'roleReveal', 'night', 'dayReveal', 'discussion', 'voting', 'voteResult', 'ended'];
