import { BODYGUARD_MIN_PLAYERS, type Role, type Winner } from './types.js';

/** Random number generator in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;

export interface RoleCounts {
  traitor: number;
  doctor: number;
  police: number;
  bodyguard: number;
  innocent: number;
}

/**
 * Role distribution by player count.
 *  <= 6 : 1 traitor, 1 doctor, 0 police, no bodyguard
 *  7-9  : 2 traitors, 1 doctor, 1 police, optional bodyguard
 *  10+  : 3 traitors, 1 doctor, 1 police, optional bodyguard
 */
export function roleCounts(playerCount: number, bodyguardEnabled: boolean): RoleCounts {
  if (playerCount < 5) throw new Error('Undercover needs at least 5 players');
  if (playerCount > 11) throw new Error('Undercover supports at most 11 players');
  const traitor = playerCount <= 6 ? 1 : playerCount <= 9 ? 2 : 3;
  const doctor = 1;
  const police = playerCount <= 6 ? 0 : 1;
  const bodyguard = bodyguardEnabled && playerCount >= BODYGUARD_MIN_PLAYERS ? 1 : 0;
  const innocent = playerCount - traitor - doctor - police - bodyguard;
  return { traitor, doctor, police, bodyguard, innocent };
}

/** Fisher-Yates shuffle, returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Randomly assign roles to the given player ids. */
export function assignRoles(
  playerIds: readonly string[],
  bodyguardEnabled: boolean,
  rng: Rng,
): Record<string, Role> {
  const counts = roleCounts(playerIds.length, bodyguardEnabled);
  const deck: Role[] = [];
  (Object.keys(counts) as Role[]).forEach((role) => {
    for (let i = 0; i < counts[role]; i++) deck.push(role);
  });
  const shuffled = shuffle(deck, rng);
  const result: Record<string, Role> = {};
  playerIds.forEach((id, i) => {
    result[id] = shuffled[i];
  });
  return result;
}

/** Traitor kill timer in ms by player count. */
export function nightTimerMs(playerCount: number): number {
  return (playerCount <= 6 ? 30 : playerCount <= 9 ? 45 : 60) * 1000;
}

/** Discussion timer in ms by player count, or the host's custom override. */
export function discussionTimerMs(playerCount: number, customMinutes: number | null): number {
  if (customMinutes && customMinutes > 0) return Math.round(customMinutes * 60 * 1000);
  return (playerCount <= 6 ? 3 : playerCount <= 9 ? 5 : 7) * 60 * 1000;
}

export const VOTING_TIMER_MS = 60 * 1000;
export const ROLE_REVEAL_TIMER_MS = 20 * 1000;
export const NARRATOR_TIMER_MS = 20 * 1000;
export const REVEAL_PAUSE_MS = 10 * 1000;

export interface TraitorPick {
  traitorId: string;
  targetId: string | null;
  /** Monotonic order of the latest submission for tie-breaking. */
  submittedAt: number;
}

/**
 * Pick the traitor team's final target.
 * Most votes wins; ties go to the earliest-submitted pick among the tied targets;
 * if nobody picked, a random legal target.
 */
export function resolveTraitorTarget(
  picks: readonly TraitorPick[],
  legalTargets: readonly string[],
  rng: Rng,
): string | null {
  const votes = new Map<string, { count: number; earliest: number }>();
  for (const p of picks) {
    if (!p.targetId || !legalTargets.includes(p.targetId)) continue;
    const cur = votes.get(p.targetId);
    if (cur) {
      cur.count += 1;
      cur.earliest = Math.min(cur.earliest, p.submittedAt);
    } else {
      votes.set(p.targetId, { count: 1, earliest: p.submittedAt });
    }
  }
  if (votes.size === 0) {
    if (legalTargets.length === 0) return null;
    return legalTargets[Math.floor(rng() * legalTargets.length)];
  }
  let best: string | null = null;
  let bestCount = -1;
  let bestEarliest = Infinity;
  for (const [target, v] of votes) {
    if (v.count > bestCount || (v.count === bestCount && v.earliest < bestEarliest)) {
      best = target;
      bestCount = v.count;
      bestEarliest = v.earliest;
    }
  }
  return best;
}

export interface NightActions {
  /** Final traitor team target (null if none). */
  traitorTarget: string | null;
  doctorProtect: string | null;
  bodyguardId: string | null;
  bodyguardGuard: string | null;
  policeId: string | null;
  policeInvestigate: string | null;
}

export interface NightOutcome {
  /** Player who died tonight, if any. */
  killedId: string | null;
  /** How the death (or save) came about. Private; never sent to ordinary players. */
  reason: 'none' | 'killed' | 'doctorSaved' | 'bodyguardDied' | 'noTarget';
  /** Private result for the Police. */
  policeResult: { targetId: string; isTraitor: boolean } | null;
}

/**
 * Night resolution priority:
 * 1. Doctor protected the target -> nobody dies (even if a Bodyguard guarded them).
 * 2. Bodyguard guarded the target -> the Bodyguard dies, the target lives.
 * 3. Otherwise the target dies.
 */
export function resolveNight(actions: NightActions, roles: Record<string, Role>): NightOutcome {
  const policeResult =
    actions.policeId && actions.policeInvestigate
      ? { targetId: actions.policeInvestigate, isTraitor: roles[actions.policeInvestigate] === 'traitor' }
      : null;

  const target = actions.traitorTarget;
  if (!target) return { killedId: null, reason: 'noTarget', policeResult };
  if (actions.doctorProtect === target) return { killedId: null, reason: 'doctorSaved', policeResult };
  if (actions.bodyguardId && actions.bodyguardGuard === target && actions.bodyguardId !== target) {
    return { killedId: actions.bodyguardId, reason: 'bodyguardDied', policeResult };
  }
  return { killedId: target, reason: 'killed', policeResult };
}

export interface VoteTally {
  counts: Record<string, number>;
  cast: number;
  /** Eliminated player or null on a tie / no votes. */
  eliminatedId: string | null;
  tied: boolean;
}

/** Plurality eliminates; a tie (or no votes) eliminates no one. */
export function tallyVotes(votes: Readonly<Record<string, string>>): VoteTally {
  const counts: Record<string, number> = {};
  let cast = 0;
  for (const target of Object.values(votes)) {
    if (!target) continue;
    cast += 1;
    counts[target] = (counts[target] ?? 0) + 1;
  }
  let top = 0;
  let leaders: string[] = [];
  for (const [id, n] of Object.entries(counts)) {
    if (n > top) {
      top = n;
      leaders = [id];
    } else if (n === top) {
      leaders.push(id);
    }
  }
  if (leaders.length === 1) return { counts, cast, eliminatedId: leaders[0], tied: false };
  return { counts, cast, eliminatedId: null, tied: leaders.length > 1 };
}

/**
 * Traitors win when alive traitors >= alive non-traitors.
 * Town wins when zero traitors remain.
 */
export function checkWin(roles: Record<string, Role>, alive: ReadonlySet<string> | readonly string[]): Winner | null {
  const aliveSet = alive instanceof Set ? alive : new Set(alive);
  let traitors = 0;
  let others = 0;
  for (const [id, role] of Object.entries(roles)) {
    if (!aliveSet.has(id)) continue;
    if (role === 'traitor') traitors += 1;
    else others += 1;
  }
  if (traitors === 0) return 'town';
  if (traitors >= others) return 'traitors';
  return null;
}

/** Deterministic seeded RNG (mulberry32) for tests and simulations. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
