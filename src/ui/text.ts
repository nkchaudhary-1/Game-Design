// Player-facing explanations. PRD v2 success metric: "a player can say why they won or lost" — so the result
// screen names the cause, shows the numbers behind it and points at the class triangle when it mattered.

import type { BuiltBlade } from '../blades/BladeFactory';
import type { MatchResult } from '../combat/events';
import { CLASS_BEATS, CLASS_COLORS, type BladeClass } from '../core/types';

const label = (c: BladeClass): string => CLASS_COLORS[c].label;

const WHY_BEATS: Record<BladeClass, string> = {
  ATTACK: 'closes the gap and hits hard before a Stamina blade\'s patience pays off',
  STAMINA: 'outlasts a Defense wall: hits barely matter, the clock does',
  DEFENSE: 'soaks up an Attack blade\'s hits and punishes the recovery',
};

export interface MatchupInfo { tag: 'adv' | 'dis' | 'even'; label: string; text: string }

/** Class triangle from the player's point of view. ATTACK > STAMINA > DEFENSE > ATTACK. */
export function matchupInfo(you: BladeClass, cpu: BladeClass): MatchupInfo {
  if (you === cpu) return { tag: 'even', label: 'Even', text: 'Mirror match: positioning and Super timing decide it.' };
  if (CLASS_BEATS[you] === cpu) return { tag: 'adv', label: 'Advantage', text: `${label(you)} beats ${label(cpu)}: it ${WHY_BEATS[you]}.` };
  return { tag: 'dis', label: 'Disadvantage', text: `${label(cpu)} beats ${label(you)}: it ${WHY_BEATS[cpu]}. Use your Super and the terrain.` };
}

export type CauseKind = 'ring' | 'spin' | 'neutral';

export interface ResultText {
  title: string;
  tone: 'win' | 'lose' | 'draw';
  cause: { kind: CauseKind; label: string; icon: 'ring' | 'spin' | 'double' | 'clock' };
  line: string;
  why: string[];
}

const pct = (n: number): string => `${Math.round(n)}%`;

export function explainResult(r: MatchResult, you: BuiltBlade, cpu: BuiltBlade): ResultText {
  const names = [you.def.name, cpu.def.name];
  const classes = [you.def.class, cpu.def.class] as const;
  const w = r.winner;
  const l = w === 0 ? 1 : 0;

  const out: ResultText = {
    title: w === 0 ? 'Victory' : w === 1 ? 'Defeat' : 'Draw',
    tone: w === 0 ? 'win' : w === 1 ? 'lose' : 'draw',
    cause: { kind: 'neutral', label: 'Time-out', icon: 'clock' },
    line: '',
    why: [],
  };

  if (r.doubleKO) {
    out.cause = { kind: 'neutral', label: 'Double KO', icon: 'double' };
    out.line = 'Both blades went out together.';
    out.why.push('Both left the arena within a tenth of a second, so nobody takes it.');
    return out;
  }

  if (r.timeout) {
    out.cause = { kind: 'neutral', label: 'Time-out', icon: 'clock' };
    if (w < 0) { out.line = 'Time ran out with spin dead even.'; return out; }
    out.line = w === 0 ? 'Time ran out — you had more spin.' : 'Time ran out — they had more spin.';
    out.why.push(`Final spin: ${names[0]} ${pct(r.spins[0])}, ${names[1]} ${pct(r.spins[1])}. When the clock ends, higher spin wins.`);
  } else if (w >= 0) {
    const how = r.causes[l];
    const loser = names[l];
    if (how === 'ring') {
      out.cause = { kind: 'ring', label: 'Ring-out', icon: 'ring' };
      out.line = w === 0 ? `You knocked ${loser} out of the arena.` : `${names[0]} was knocked out of the arena.`;
      const left = r.spins[l];
      out.why.push(left >= 50
        ? `A ring-out ends the round whatever the spin — ${loser} still had ${pct(left)}.`
        : `With only ${pct(left)} spin left, the wall couldn't hold ${loser} — low spin means no grip on the rim.`);
    } else {
      out.cause = { kind: 'spin', label: 'Spin-out', icon: 'spin' };
      out.line = w === 0 ? `${loser} ran out of spin.` : 'You ran out of spin.';
      const s = r.stats[l];
      const total = Math.max(1, s.lostToHits + s.lostToDecay + s.lostToMoves);
      const parts: Array<[string, number]> = [['hits', s.lostToHits], ['natural decay', s.lostToDecay], ['moves and steering', s.lostToMoves]];
      parts.sort((a, b) => b[1] - a[1]);
      out.why.push(`${l === 0 ? 'You' : loser} lost ${Math.round(total)} spin: ${parts.map(([n, v]) => `${Math.round(v)} to ${n}`).join(', ')}.`);
      if (r.tieSpins) out.why.push(`Both ran dry on the same tick — the one with more spin going in (${names[w]}) wins.`);
    }
  } else {
    out.line = 'Nobody won the round.';
    return out;
  }

  // class triangle: only when it is a real explanation (classes differ)
  const wc = classes[w], lc = classes[l];
  if (wc !== lc) {
    if (CLASS_BEATS[wc] === lc) out.why.push(`${label(wc)} beats ${label(lc)}: it ${WHY_BEATS[wc]}.`);
    else out.why.push(`An upset: ${label(lc)} normally beats ${label(wc)}.`);
  }
  return out;
}

export interface StatRow { label: string; you: string; cpu: string }

export function resultRows(r: MatchResult): StatRow[] {
  const n = (v: number): string => String(Math.round(v));
  const [a, b] = r.stats;
  return [
    { label: 'Final spin', you: pct(r.spins[0]), cpu: pct(r.spins[1]) },
    { label: 'Hits', you: n(a.hits), cpu: n(b.hits) },
    { label: 'Damage dealt', you: n(a.damageDealt), cpu: n(b.damageDealt) },
    { label: 'Spin lost to hits', you: n(a.lostToHits), cpu: n(b.lostToHits) },
    { label: 'Spin lost to decay', you: n(a.lostToDecay), cpu: n(b.lostToDecay) },
    { label: 'Spin lost to moves', you: n(a.lostToMoves), cpu: n(b.lostToMoves) },
    { label: 'Moves used', you: n(a.abilitiesUsed), cpu: n(b.abilitiesUsed) },
    { label: 'Supers used', you: n(a.supersUsed), cpu: n(b.supersUsed) },
  ];
}
