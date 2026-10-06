// Headless match runner: the exact simulation the game uses, driven by two CPU brains, with no rendering.
// Used by the balance harness (tools/balance.ts) and the tests.

import { AIController } from '../ai/AIController';
import type { AIDifficulty } from '../ai/AIStates';
import { getArena } from '../arenas/arenaData';
import type { BuiltBlade } from '../blades/BladeFactory';
import { TUNING } from '../core/Balance';
import { applyControllerMsg, type ControllerMsg } from '../core/InputBus';
import { initPhysics } from '../core/Physics';
import { makeRng } from '../core/Rng';
import { Match } from '../combat/Match';
import type { MatchResult, SimEvent } from '../combat/events';

export interface PlayOptions {
  seed: number;
  difficulty?: [AIDifficulty, AIDifficulty];
  arenaId?: string;
  /** Hard cap on simulated seconds (the match itself times out at TUNING.TIMEOUT). */
  maxSeconds?: number;
  onEvent?: (e: SimEvent, match: Match) => void;
  /** Called every step after the CPUs have acted; lets a test inject input. */
  onStep?: (match: Match) => void;
  /** Slots that should NOT be driven by a CPU (a test drives them by hand). */
  manual?: number[];
}

export async function playMatch(blades: BuiltBlade[], opt: PlayOptions): Promise<{ result: MatchResult; match: Match; duration: number }> {
  await initPhysics();
  const rng = makeRng(opt.seed);
  const match = new Match(getArena(opt.arenaId ?? 'core-pit'), blades.map((built, i) => ({ built, control: opt.manual?.includes(i) ? 'human' : 'ai' })), rng);
  const diff = opt.difficulty ?? ['NORMAL', 'NORMAL'];
  const send = (m: ControllerMsg) => applyControllerMsg(match, m);
  const brains = blades.map((_, i) => (opt.manual?.includes(i) ? null : new AIController(i, diff[i], send, makeRng(opt.seed * 7919 + i * 104729 + 13))));
  brains.forEach((b, i) => { if (b) { const l = b.launch(match); match.launch(i, l.angle, l.power); } });

  const limit = Math.ceil((opt.maxSeconds ?? TUNING.TIMEOUT + 5) / TUNING.DT);
  for (let i = 0; i < limit && match.phase !== 'over'; i++) {
    for (const b of brains) b?.update(match, TUNING.DT);
    opt.onStep?.(match);
    match.step();
    for (const e of match.takeEvents()) opt.onEvent?.(e, match);
  }
  // let any final events out
  for (const e of match.takeEvents()) opt.onEvent?.(e, match);
  const result = match.result;
  if (!result) throw new Error('match did not finish');
  return { result, match, duration: match.t };
}
