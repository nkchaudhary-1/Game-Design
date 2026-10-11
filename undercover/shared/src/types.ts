export type Role = 'traitor' | 'doctor' | 'police' | 'bodyguard' | 'innocent';
export const ROLES: Role[] = ['traitor', 'doctor', 'police', 'bodyguard', 'innocent'];

export type Phase =
  | 'waiting'
  | 'roleReveal'
  | 'night'
  | 'dayReveal'
  | 'discussion'
  | 'voting'
  | 'voteResult'
  | 'ended';

export type Mode = 'player' | 'god';
export type Winner = 'traitors' | 'town';
export type NightStep = 'narrator' | 'action';

export type PlayerCount = 5 | 7 | 9 | 11;
export const PLAYER_COUNTS: PlayerCount[] = [5, 7, 9, 11];
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 11;
export const BODYGUARD_MIN_PLAYERS = 7;

export const ROLE_NAMES: Record<Role, string> = {
  traitor: 'Traitor',
  doctor: 'Doctor',
  police: 'Police',
  bodyguard: 'Bodyguard',
  innocent: 'Innocent',
};

export const ROLE_FLAVOR: Record<Role, string> = {
  traitor: 'The city sleeps. You do not.',
  doctor: 'Nobody dies on your watch. Not tonight.',
  police: 'Every face hides a story. Find the one that lies.',
  bodyguard: 'You stand between them and the dark.',
  innocent: 'You know nothing. Trust no one.',
};

export const ROLE_POWER: Record<Role, string> = {
  traitor:
    'Each night, you and your fellow Traitors choose one person to kill. You win when the Traitors are at least half of everyone left alive.',
  doctor:
    'Each night, protect one living player (yourself included). If the Traitors attack them, the attack fails.',
  police:
    'Each night, investigate one other living player. You privately learn whether they are a Traitor. Share it, or lie about it.',
  bodyguard:
    'Each night, guard one living player (yourself included). If the Traitors attack them, you die in their place.',
  innocent:
    'You have no night power. Listen, argue, and vote out every Traitor before they outnumber you.',
};

export const PLAYER_COLORS = [
  'moon', 'silver', 'steel', 'fog', 'ash', 'graphite', 'smoke', 'bone', 'pewter', 'slate', 'chrome',
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export interface RoomSettings {
  mode: Mode;
  targetCount: PlayerCount;
  bodyguard: boolean;
  discussionMinutes: number | null;
}
