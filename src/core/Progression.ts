// Progression rules, as data: what each rank unlocks, what an upgrade costs, what a battle pays, and the eight-stage
// Arena Circuit. No state here (Profile.ts keeps that) and no DOM, so the rules are unit-tested and tuned in one place.
//
// The loop from the build spec: COLLECT → CUSTOMIZE → UPGRADE → BATTLE → WIN → UNLOCK → CUSTOMIZE AGAIN.
//   · Wins raise your RANK; each rank unlocks blades (collect) and an arena.
//   · Battles pay CORES; cores buy blade LEVELS (upgrade), and levels unlock parts, Supers and cosmetic variants.
//   · The Arena Circuit is the story mode: one stage per arena, tougher each time.
// Nothing here can be bought with money, and a higher level only widens a blade's options, so it stays fair: the CPU
// always fights at the level you are at (or the stage's level on the Circuit).

export const MAX_BLADE_LEVEL = 7;
export const MAX_RANK = 8;

/** Wins needed to reach rank 1…8. */
export const RANK_WINS = [0, 2, 5, 9, 14, 20, 27, 35] as const;

/** Everything a rank unlocks. Each tier is one blade of every class where it can be, so a new rank is always a choice. */
export const RANK_REWARDS: ReadonlyArray<{ blades: readonly string[]; arena: string }> = [
  { blades: ['ravok', 'gravion', 'phantom'], arena: 'core-pit' },
  { blades: ['blazefang', 'guardian-prime', 'voidrunner'], arena: 'elevation-ring' },
  { blades: ['riftclaw', 'iron-warden', 'nightveil'], arena: 'magnetic-core' },
  { blades: ['volt-reaper', 'aegiron', 'ghost-viper'], arena: 'crystal-arena' },
  { blades: ['inferno-x', 'bastion-x'], arena: 'shift-floor' },
  { blades: ['stormfang', 'stonecore', 'spectra'], arena: 'wind-tunnel' },
  { blades: ['titan-breaker', 'gravity-rex', 'chrono'], arena: 'lava-ring' },
  { blades: ['nebula-drift'], arena: 'gravity-well' },
];

export function rankForWins(wins: number): number {
  let rank = 1;
  RANK_WINS.forEach((need, i) => { if (wins >= need) rank = i + 1; });
  return rank;
}

/** Progress inside the current rank: wins so far this rank, wins the rank needs, and the next rank (null at the top). */
export function rankProgress(wins: number): { rank: number; into: number; span: number; next: number | null } {
  const rank = rankForWins(wins);
  if (rank >= MAX_RANK) return { rank, into: 1, span: 1, next: null };
  return { rank, into: wins - RANK_WINS[rank - 1], span: RANK_WINS[rank] - RANK_WINS[rank - 1], next: rank + 1 };
}

export function rankOfBlade(id: string): number {
  const i = RANK_REWARDS.findIndex((r) => r.blades.includes(id));
  return i < 0 ? MAX_RANK : i + 1;
}
export function rankOfArena(id: string): number {
  const i = RANK_REWARDS.findIndex((r) => r.arena === id);
  return i < 0 ? MAX_RANK : i + 1;
}

/** Cores to raise a blade from `level` to `level + 1`; Infinity at the top. */
export function upgradeCost(level: number): number {
  return [0, 40, 70, 110, 160, 220, 300][level] ?? Infinity;
}

export type Outcome = 'win' | 'draw' | 'loss';
export type Difficulty = 'EASY' | 'NORMAL' | 'HARD';

const PAY: Record<Outcome, number> = { win: 40, draw: 15, loss: 12 };
const PAY_MUL: Record<Difficulty, number> = { EASY: 0.65, NORMAL: 1, HARD: 1.5 };

/** Cores for one battle. A loss still pays a little: you learned something, and the next upgrade is that much closer. */
export function coresFor(outcome: Outcome, difficulty: Difficulty): number {
  return Math.round(PAY[outcome] * PAY_MUL[difficulty]);
}

export interface CircuitStage {
  id: string;
  arena: string;
  opponent: string;
  level: number;
  difficulty: Difficulty;
  /** One-off bonus for the first win. */
  reward: number;
  title: string;
  note: string;
}

/** The Arena Circuit: eight stages, one per arena, each against a blade that uses the arena well. */
export const CIRCUIT: readonly CircuitStage[] = [
  { id: 's1', arena: 'core-pit', opponent: 'gravion', level: 1, difficulty: 'EASY', reward: 60, title: 'Warm-up', note: 'No tricks. A heavy Defense blade to learn the pit on.' },
  { id: 's2', arena: 'elevation-ring', opponent: 'blazefang', level: 2, difficulty: 'EASY', reward: 80, title: 'High ground', note: 'It drops from the platforms. Stay low or take the ramp first.' },
  { id: 's3', arena: 'magnetic-core', opponent: 'guardian-prime', level: 2, difficulty: 'NORMAL', reward: 100, title: 'Pull and push', note: 'It holds the middle. Slip past when the magnet pushes.' },
  { id: 's4', arena: 'crystal-arena', opponent: 'nightveil', level: 3, difficulty: 'NORMAL', reward: 130, title: 'Crystal hunt', note: 'It goes for the crystals first. Break them before it does.' },
  { id: 's5', arena: 'shift-floor', opponent: 'ghost-viper', level: 4, difficulty: 'NORMAL', reward: 160, title: 'Moving ground', note: 'It lets you hit it, then bites back. Keep off the sinking plate.' },
  { id: 's6', arena: 'wind-tunnel', opponent: 'stormfang', level: 5, difficulty: 'HARD', reward: 200, title: 'Slipstream', note: 'It rides the lanes for a running start. Cross the wind.' },
  { id: 's7', arena: 'lava-ring', opponent: 'titan-breaker', level: 6, difficulty: 'HARD', reward: 250, title: 'Fire and weight', note: 'It wants you in the lava. Stay in the middle and let it come.' },
  { id: 's8', arena: 'gravity-well', opponent: 'nebula-drift', level: 7, difficulty: 'HARD', reward: 400, title: 'The well', note: 'The last stage. It gets stronger the longer the fight goes.' },
];

/** Cosmetic variants a blade can wear. They change paint only, never stats. */
export type Variant = 'default' | 'alt' | 'elite';
export const VARIANTS: ReadonlyArray<{ id: Variant; name: string; level: number; text: string }> = [
  { id: 'default', name: 'Factory', level: 1, text: 'The paint it left the factory in.' },
  { id: 'alt', name: 'Night shift', level: 4, text: 'Swapped plates and a cooler glow. Level 4.' },
  { id: 'elite', name: 'Elite', level: 7, text: 'Gunmetal and gold with a hot core. Level 7.' },
];
export const variantUnlocked = (v: Variant, level: number): boolean => level >= (VARIANTS.find((x) => x.id === v)?.level ?? 1);
