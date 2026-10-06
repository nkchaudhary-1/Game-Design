// Everything the simulation reports to the outside world (renderer, HUD, audio, controller feedback).
// The simulation never touches the DOM or Three.js; it only emits these.

export type KoCause = 'ring' | 'spin';

export interface MatchResult {
  /** Winning slot, or -1 for a draw. */
  winner: number;
  doubleKO: boolean;
  timeout: boolean;
  /** Per slot: how that blade went out (null if it didn't). */
  causes: Array<KoCause | null>;
  /** Final spin per slot. */
  spins: number[];
  /** When two blades ran dry on the same tick: the spin each had going into it. */
  tieSpins: number[] | null;
  stats: BladeStats[];
  duration: number;
}

export interface BladeStats {
  hits: number;
  lostToHits: number;
  lostToDecay: number;
  lostToMoves: number;
  damageDealt: number;
  abilitiesUsed: number;
  supersUsed: number;
}

export type FxKind =
  | 'radial' | 'zoneStart' | 'zoneEnd' | 'teleport' | 'slamStart' | 'slam' | 'shield' | 'shieldHit' | 'shieldBreak'
  | 'decoy' | 'decoyPop' | 'dash' | 'spinGain' | 'drain' | 'pull' | 'ambush' | 'guard';

export type SimEvent =
  | { type: 'launch'; slot: number; power: number; x: number; z: number }
  | { type: 'hit'; x: number; z: number; nx: number; nz: number; strength: number; a: number; b: number; dmgA: number; dmgB: number; heavy: boolean }
  | { type: 'ko'; slot: number; cause: KoCause }
  | { type: 'end'; result: MatchResult }
  | { type: 'ability'; slot: number; index: number; id: string; charge: number }
  | { type: 'charge'; slot: number; index: number; state: 'start' | 'cancel' | 'max' }
  | { type: 'super'; slot: number; superId: string; state: 'activate' | 'end' | 'ready' }
  | { type: 'fx'; kind: FxKind; slot: number; x: number; z: number; radius?: number; power?: number }
  | { type: 'spinLow'; slot: number };
