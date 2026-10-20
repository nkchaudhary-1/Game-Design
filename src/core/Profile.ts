// The player's saved profile: mode, cores, record, blade levels, builds, Supers, cosmetic variants, Circuit progress and
// settings. Stored in localStorage (the store is injectable, so the rules are tested without a browser).
//
// Two modes share the same profile:
//   · SANDBOX — everything unlocked, level is a free dial. For trying things out. Battles still count towards your record.
//   · CAREER  — blades and arenas unlock with rank, levels are bought with cores.

import type { Build } from './types';
import {
  CIRCUIT, MAX_BLADE_LEVEL, MAX_RANK, RANK_REWARDS, coresFor, rankForWins, rankOfArena, rankOfBlade, upgradeCost, variantUnlocked,
  type Difficulty, type Outcome, type Variant,
} from './Progression';

export type GameMode = 'sandbox' | 'career';
export type QualitySetting = 'auto' | 'high' | 'medium' | 'low';

export interface Settings {
  quality: QualitySetting;
  reducedMotion: boolean;
  muted: boolean;
  /** Gamepad stick dead-zone, 0.05–0.4. */
  deadzone: number;
}

export interface ProfileData {
  v: 1;
  mode: GameMode;
  cores: number;
  wins: number;
  losses: number;
  draws: number;
  /** Career levels (blades not listed are Level 1). */
  levels: Record<string, number>;
  builds: Record<string, Build>;
  supers: Record<string, string>;
  variants: Record<string, Variant>;
  /** Circuit stages already won. */
  circuit: string[];
  settings: Settings;
}

export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }

export const PROFILE_KEY = 'spinblade.profile.v1';

export const defaultSettings = (): Settings => ({ quality: 'auto', reducedMotion: false, muted: false, deadzone: 0.15 });
export const defaultData = (): ProfileData => ({
  v: 1, mode: 'sandbox', cores: 0, wins: 0, losses: 0, draws: 0, levels: {}, builds: {}, supers: {}, variants: {}, circuit: [], settings: defaultSettings(),
});

/** What a finished battle changed, for the result sheet. */
export interface BattleReward {
  outcome: Outcome;
  cores: number;
  rankBefore: number;
  rankAfter: number;
  newBlades: string[];
  newArena: string | null;
  /** Set when the battle was a Circuit stage that was won for the first time. */
  stage: { id: string; bonus: number } | null;
}

function browserStore(): Store | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export class Profile {
  data: ProfileData;
  private listeners = new Set<() => void>();

  constructor(private readonly store: Store | null = browserStore()) {
    this.data = this.load();
  }

  // ------------------------------------------------------------------------------------------ storage
  private load(): ProfileData {
    try {
      const raw = this.store?.getItem(PROFILE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<ProfileData>;
        if (p && p.v === 1) {
          const d = defaultData();
          return { ...d, ...p, settings: { ...d.settings, ...(p.settings ?? {}) } } as ProfileData;
        }
      }
    } catch { /* a corrupt save starts fresh rather than blocking the game */ }
    return defaultData();
  }

  save(): void {
    try { this.store?.setItem(PROFILE_KEY, JSON.stringify(this.data)); } catch { /* storage full or blocked: play on without saving */ }
    this.listeners.forEach((f) => f());
  }

  onChange(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  reset(): void { this.data = defaultData(); this.save(); }

  // ------------------------------------------------------------------------------------------ state
  get mode(): GameMode { return this.data.mode; }
  get sandbox(): boolean { return this.data.mode === 'sandbox'; }
  get cores(): number { return this.data.cores; }
  get wins(): number { return this.data.wins; }
  get rank(): number { return rankForWins(this.data.wins); }
  get settings(): Settings { return this.data.settings; }

  setMode(m: GameMode): void { this.data.mode = m; this.save(); }

  isBladeUnlocked(id: string): boolean { return this.sandbox || rankOfBlade(id) <= this.rank; }
  isArenaUnlocked(id: string): boolean { return this.sandbox || rankOfArena(id) <= this.rank; }

  /** Rank at which something unlocks, for "unlocks at rank N" labels. */
  unlockRank(kind: 'blade' | 'arena', id: string): number { return kind === 'blade' ? rankOfBlade(id) : rankOfArena(id); }

  /** The blade's career level. (Sandbox levels are a session dial; see Session.) */
  levelOf(id: string): number { return Math.max(1, Math.min(MAX_BLADE_LEVEL, this.data.levels[id] ?? 1)); }

  /** Buy the next level. Only in Career: the sandbox dial is free. */
  upgrade(id: string): { ok: boolean; reason?: string; level: number; cost: number } {
    const level = this.levelOf(id), cost = upgradeCost(level);
    if (this.sandbox) return { ok: false, reason: 'Sandbox levels are free: use the level dial.', level, cost };
    if (!this.isBladeUnlocked(id)) return { ok: false, reason: `Unlocks at rank ${rankOfBlade(id)}`, level, cost };
    if (level >= MAX_BLADE_LEVEL) return { ok: false, reason: 'Already at the top level', level, cost };
    if (this.data.cores < cost) return { ok: false, reason: `Needs ${cost - this.data.cores} more cores`, level, cost };
    this.data.cores -= cost;
    this.data.levels[id] = level + 1;
    this.save();
    return { ok: true, level: level + 1, cost };
  }

  // ------------------------------------------------------------------------------------------ battles
  /** Record a finished battle: record, cores, rank-ups, and the Circuit stage if there was one. */
  recordBattle(outcome: Outcome, difficulty: Difficulty, stageId: string | null = null): BattleReward {
    const rankBefore = this.rank;
    let cores = coresFor(outcome, difficulty);
    let stage: BattleReward['stage'] = null;
    if (outcome === 'win') this.data.wins++; else if (outcome === 'loss') this.data.losses++; else this.data.draws++;
    if (stageId && outcome === 'win' && !this.data.circuit.includes(stageId)) {
      const st = CIRCUIT.find((s) => s.id === stageId);
      if (st) { this.data.circuit.push(stageId); cores += st.reward; stage = { id: stageId, bonus: st.reward }; }
    }
    this.data.cores += cores;
    const rankAfter = this.rank;
    const newBlades: string[] = [], reach = Math.min(MAX_RANK, rankAfter);
    for (let r = rankBefore + 1; r <= reach; r++) newBlades.push(...RANK_REWARDS[r - 1].blades);
    const newArena = rankAfter > rankBefore ? RANK_REWARDS[rankAfter - 1].arena : null;
    this.save();
    return { outcome, cores, rankBefore, rankAfter, newBlades, newArena, stage };
  }

  // ------------------------------------------------------------------------------------------ circuit
  stageCleared(id: string): boolean { return this.data.circuit.includes(id); }

  /** Career: a stage opens when the one before it is won and its arena is unlocked. Sandbox: all open. */
  stageOpen(index: number): boolean {
    const st = CIRCUIT[index];
    if (!st) return false;
    if (this.sandbox) return true;
    return this.isArenaUnlocked(st.arena) && (index === 0 || this.stageCleared(CIRCUIT[index - 1].id));
  }

  // ------------------------------------------------------------------------------------------ blade setup
  getBuild(id: string): Build | undefined { return this.data.builds[id]; }
  setBuild(id: string, b: Build): void { this.data.builds[id] = { ...b }; this.save(); }
  getSuper(id: string): string | undefined { return this.data.supers[id]; }
  setSuper(id: string, superId: string): void { this.data.supers[id] = superId; this.save(); }

  variantOf(id: string, level: number): Variant {
    const v = this.data.variants[id] ?? 'default';
    return variantUnlocked(v, level) ? v : 'default';
  }
  setVariant(id: string, v: Variant): void { this.data.variants[id] = v; this.save(); }

  // ------------------------------------------------------------------------------------------ settings
  setSettings(patch: Partial<Settings>): void { this.data.settings = { ...this.data.settings, ...patch }; this.save(); }
}
