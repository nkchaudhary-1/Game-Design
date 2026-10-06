// CPU brain, part 1: the states and the (deterministic) rules for moving between them.
// No machine learning, no hidden information: the CPU sees what a player sees and sends the same
// controller messages a phone would.

import type { BladeClass } from '../core/types';
import { CLASS_BEATS } from '../core/types';

export type AIState = 'SEARCH' | 'CHASE' | 'ATTACK' | 'EVADE' | 'RECOVER' | 'USE_SUPER' | 'EDGE_AVOID' | 'LOW_SPIN';
export type Matchup = 'ADVANTAGE' | 'EVEN' | 'DISADVANTAGE';
export type AIDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface AIParams {
  /** How often the CPU re-decides (its reaction time), seconds. */
  period: number;
  /** Steering error, radians. */
  noise: number;
  /** Chance per decision that it actually takes an optional action. */
  skill: number;
  /** Seconds it will wait before it uses a ready Super. */
  superDelay: number;
  /** How long it holds a charge before releasing, as a fraction of the move's max charge. */
  chargeFrac: number;
}

export const AI_PARAMS: Record<AIDifficulty, AIParams> = {
  EASY: { period: 0.34, noise: 0.42, skill: 0.4, superDelay: 3.5, chargeFrac: 0.35 },
  NORMAL: { period: 0.18, noise: 0.18, skill: 0.75, superDelay: 1.2, chargeFrac: 0.6 },
  HARD: { period: 0.1, noise: 0.07, skill: 1, superDelay: 0.2, chargeFrac: 0.85 },
};

export interface AIContext {
  cls: BladeClass;
  oppCls: BladeClass;
  dist: number;
  myD: number;
  /** Radial speed: positive when heading for the wall. */
  outward: number;
  /** How fast the opponent is closing in on me. */
  closing: number;
  mySpin: number;
  oppSpin: number;
  superReady: boolean;
  wantsSuper: boolean;
  /** Seconds since I last took a hit. */
  sinceHurt: number;
  radius: number;
  /** Nobody has landed a hit for a while: stand-offs get broken by whoever is willing to commit. */
  stalled: boolean;
  /** A hazard the CPU should stay clear of is nearby (no hazards in Core Pit; hook for later arenas). */
  hazardNear: boolean;
}

export function matchup(me: BladeClass, opp: BladeClass): Matchup {
  if (CLASS_BEATS[me] === opp) return 'ADVANTAGE';
  if (CLASS_BEATS[opp] === me) return 'DISADVANTAGE';
  return 'EVEN';
}

/** Tunable distances, as fractions of the arena radius. */
export const AI_RANGE = {
  edge: 0.8,
  attack: 0.5,
  evade: 0.5,
  zone: 0.6,
};

export function chooseState(ctx: AIContext, aggressive: boolean): AIState {
  const edge = ctx.radius * AI_RANGE.edge;
  if (ctx.hazardNear || ctx.myD > edge || (ctx.myD > edge * 0.88 && ctx.outward > 1.5)) return 'EDGE_AVOID';
  if (ctx.mySpin < 22) return 'LOW_SPIN';
  if (ctx.sinceHurt < 0.45 && ctx.dist < ctx.radius * 0.35) return 'RECOVER';
  if (ctx.superReady && ctx.wantsSuper) return 'USE_SUPER';
  if (ctx.stalled && ctx.cls !== 'ATTACK') return ctx.dist < ctx.radius * 0.28 ? 'ATTACK' : 'CHASE';

  const range = ctx.radius * AI_RANGE.attack;
  const m = matchup(ctx.cls, ctx.oppCls);
  switch (ctx.cls) {
    case 'ATTACK':
      if (ctx.dist < range * 0.55 && aggressive) return 'ATTACK';
      return aggressive ? 'CHASE' : 'EVADE';
    case 'DEFENSE':
      if (ctx.dist < ctx.radius * 0.28) return 'ATTACK';
      if (ctx.dist < ctx.radius * AI_RANGE.zone && (aggressive || m === 'ADVANTAGE')) return 'CHASE';
      return 'SEARCH';
    case 'STAMINA':
      if (m === 'ADVANTAGE' && ctx.dist < range * 0.6) return 'ATTACK';
      if (ctx.mySpin + 6 < ctx.oppSpin && aggressive) return 'CHASE';
      if (ctx.dist < ctx.radius * AI_RANGE.evade) return 'EVADE';
      return 'SEARCH';
  }
}
