// BladeFactory: blade definition + chosen parts + level → everything the game needs about one build.
// Pure functions, no DOM: used by the UI (stat bars, Super list) and by the headless simulation.

import type { Build, PartSlot, StatKey, StatRatings } from '../core/types';
import { PART_SLOTS, STAT_KEYS, STAT_LABELS, clamp } from '../core/types';
import { deriveCombat, type CombatParams } from '../core/Balance';
import { getBlade, type BladeDef } from './bladeData';
import { getAbility } from './abilities';
import type { AbilityDef, SuperDef } from './effects';
import { getPart, NEUTRAL_BUILD, partsForSlot, type PartDef } from './parts';
import { getSuper } from './supers';

export const MAX_LEVEL = 7;

export interface SuperStatus {
  def: SuperDef;
  unlocked: boolean;
  /** Human-readable reason when locked: level, a missing stat, or not yet implemented. */
  reason: string | null;
}

export interface BuiltBlade {
  def: BladeDef;
  level: number;
  build: Build;
  baseStats: StatRatings;
  /** Final ratings after parts, clamped to 1–10. */
  stats: StatRatings;
  deltas: Partial<Record<StatKey, number>>;
  combat: CombatParams;
  moves: [AbilityDef, AbilityDef, AbilityDef];
  supers: SuperStatus[];
  equippedSuper: string | null;
  /** Strength multiplier applied to Super effects: grows a little with level (never past the 8 s cap). */
  levelBoost: number;
  description: BuildDescription;
}

export interface BuildDescription {
  headline: string;
  /** e.g. "+2 Weight, +1 Knockback, −1 Agility" */
  changes: string[];
  summary: string;
}

export interface BuildInput {
  level?: number;
  build?: Partial<Build>;
  equippedSuper?: string | null;
}

export const defaultBuild = (): Build => ({ ...NEUTRAL_BUILD });

/** Parts this blade can equip right now: class-compatible and unlocked at `level`. */
export function availableParts(bladeId: string, slot: PartSlot, level: number): PartDef[] {
  const b = getBlade(bladeId);
  return partsForSlot(slot).filter((p) => p.classes.includes(b.class) && p.unlockLevel <= level);
}
export function partLockReason(bladeId: string, part: PartDef, level: number): string | null {
  const b = getBlade(bladeId);
  if (!part.classes.includes(b.class)) return `${part.classes.map((c) => c[0] + c.slice(1).toLowerCase()).join('/')} blades only`;
  if (part.unlockLevel > level) return `Unlocks at Level ${part.unlockLevel}`;
  return null;
}

/** Coerce any part that is incompatible or locked back to the stock part for its slot. */
export function sanitizeBuild(bladeId: string, build: Partial<Build>, level: number): Build {
  const out = defaultBuild();
  for (const slot of PART_SLOTS) {
    const id = build[slot];
    if (!id) continue;
    const p = getPart(id);
    if (p.slot === slot && partLockReason(bladeId, p, level) === null) out[slot] = id;
  }
  return out;
}

export function applyParts(base: StatRatings, build: Build): { stats: StatRatings; deltas: Partial<Record<StatKey, number>> } {
  const stats = { ...base };
  const deltas: Partial<Record<StatKey, number>> = {};
  for (const slot of PART_SLOTS) {
    const p = getPart(build[slot]);
    for (const k of STAT_KEYS) {
      const d = p.mods[k];
      if (d) deltas[k] = (deltas[k] ?? 0) + d;
    }
  }
  for (const k of STAT_KEYS) stats[k] = clamp(base[k] + (deltas[k] ?? 0), 1, 10);
  // report the delta that actually landed after clamping
  for (const k of STAT_KEYS) {
    const eff = stats[k] - base[k];
    if (eff === 0) delete deltas[k]; else deltas[k] = eff;
  }
  return { stats, deltas };
}

export function superStatus(def: SuperDef, stats: StatRatings, level: number): SuperStatus {
  if (!def.implemented) return { def, unlocked: false, reason: 'Coming soon' };
  if (def.unlockLevel > level) return { def, unlocked: false, reason: `Unlocks at Level ${def.unlockLevel}` };
  if (def.requiredStats) {
    for (const k of STAT_KEYS) {
      const need = def.requiredStats[k];
      if (need !== undefined && stats[k] < need) return { def, unlocked: false, reason: `Needs ${STAT_LABELS[k]} ${need}+ (currently ${stats[k]})` };
    }
  }
  return { def, unlocked: true, reason: null };
}

export function describeBuild(def: BladeDef, stats: StatRatings, deltas: Partial<Record<StatKey, number>>, build: Build): BuildDescription {
  const changes = STAT_KEYS.filter((k) => deltas[k]).map((k) => `${deltas[k]! > 0 ? '+' : '−'}${Math.abs(deltas[k]!)} ${STAT_LABELS[k]}`);
  const rank = (Object.keys(stats) as StatKey[]).sort((a, b) => stats[b] - stats[a]);
  const top = rank.filter((k) => stats[k] >= 8).slice(0, 2).map((k) => STAT_LABELS[k].toLowerCase());
  const low = rank.filter((k) => stats[k] <= 3).slice(-2).map((k) => STAT_LABELS[k].toLowerCase());
  const custom = PART_SLOTS.filter((s) => build[s] !== NEUTRAL_BUILD[s]).map((s) => getPart(build[s]).name);
  const parts = custom.length ? `Fitted with ${custom.join(', ')}. ` : 'Stock build. ';
  const strengths = top.length ? `Strong in ${top.join(' and ')}` : 'Well rounded';
  const weaknesses = low.length ? `; weak in ${low.join(' and ')}.` : '.';
  return { headline: `${def.role}`, changes, summary: `${parts}${strengths}${weaknesses}` };
}

export function buildBlade(bladeId: string, input: BuildInput = {}): BuiltBlade {
  const def = getBlade(bladeId);
  const level = clamp(Math.round(input.level ?? 1), 1, MAX_LEVEL);
  const build = sanitizeBuild(bladeId, input.build ?? {}, level);
  const { stats, deltas } = applyParts(def.stats, build);
  const supers = def.superPool.map((id) => superStatus(getSuper(id), stats, level));
  let equipped = input.equippedSuper ?? null;
  if (!equipped || !supers.some((s) => s.def.id === equipped && s.unlocked)) {
    equipped = supers.find((s) => s.unlocked)?.def.id ?? null;
  }
  return {
    def, level, build, baseStats: def.stats, stats, deltas,
    combat: deriveCombat(stats),
    moves: def.basicMoves.map(getAbility) as [AbilityDef, AbilityDef, AbilityDef],
    supers, equippedSuper: equipped,
    levelBoost: 1 + 0.04 * (level - 1),
    description: describeBuild(def, stats, deltas, build),
  };
}

/** The blade's recommended build (from the spec's customization profile), limited to what `level` allows. */
export function recommendedBuild(bladeId: string, level: number): Build {
  return sanitizeBuild(bladeId, getBlade(bladeId).customizationProfile.recommended, level);
}
