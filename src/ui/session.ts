// Session state: what the player has picked this visit. Deliberately NOT persisted (PRD v2 Phase 1: no
// persistence, no accounts) — everything resets on reload, which also means a test session always starts
// from a known state.

import type { AIDifficulty } from '../ai/AIStates';
import { BLADE_ORDER, BLADES, MVP_BLADES } from '../blades/bladeData';
import { buildBlade, MAX_LEVEL, sanitizeBuild, type BuiltBlade } from '../blades/BladeFactory';
import type { Build } from '../core/types';
import type { Score } from './HUD';

export const DEFAULT_LEVEL = 3;

export class Session {
  you = 'ravok';
  cpu = 'phantom';
  /** CPU blade is re-rolled each time the pre-battle screen opens. */
  cpuRandom = true;
  level = DEFAULT_LEVEL;
  difficulty: AIDifficulty = 'NORMAL';
  arenaId = 'core-pit';
  muted = false;
  /** Where the workshop's back button goes. */
  returnTo: 'hangar' | 'lobby' = 'hangar';
  /** Two-tab mode switched on: every battle accepts a controller from another tab. */
  remoteController = false;
  readonly score: Score = { you: 0, cpu: 0, draws: 0 };
  private readonly builds = new Map<string, Build>();
  private readonly supers = new Map<string, string>();

  constructor() { this.rollCpu(); }

  /** A fully built blade at the session level, using its saved build and equipped Super. */
  built(bladeId: string, level = this.level): BuiltBlade {
    return buildBlade(bladeId, { level, build: this.builds.get(bladeId), equippedSuper: this.supers.get(bladeId) ?? null });
  }

  /** The CPU always gets its stock build at the same level: fair, and easy to reason about. */
  cpuBuilt(): BuiltBlade { return buildBlade(this.cpu, { level: this.level }); }

  setBuild(bladeId: string, build: Build): void { this.builds.set(bladeId, { ...build }); }
  setSuper(bladeId: string, superId: string): void { this.supers.set(bladeId, superId); }

  setLevel(level: number): void {
    this.level = Math.max(1, Math.min(MAX_LEVEL, level));
    // parts and Supers that are locked at the new level drop back to what is allowed
    for (const [id, b] of this.builds) this.builds.set(id, sanitizeBuild(id, b, this.level));
  }

  rollCpu(): void {
    const pool = MVP_BLADES.filter((id) => id !== this.you || MVP_BLADES.length < 2);
    this.cpu = pool[Math.floor(Math.random() * pool.length)] ?? MVP_BLADES[0];
  }

  selectYou(id: string): void { if (BLADES[id]) this.you = id; }

  /** Record a finished round into the running score. */
  record(winner: number): void {
    if (winner === 0) this.score.you++; else if (winner === 1) this.score.cpu++; else this.score.draws++;
  }

  resetScore(): void { this.score.you = 0; this.score.cpu = 0; this.score.draws = 0; }
  get played(): number { return this.score.you + this.score.cpu + this.score.draws; }
}

export { BLADE_ORDER };
