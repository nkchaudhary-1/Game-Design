// Headless balance check. Runs the real simulation CPU-vs-CPU over every MVP matchup, from both seats,
// and checks the design targets. Run after touching ANY rating, part, move, Super or tuning value.
//
//   npm run balance                          # 40 battles per ordered pair, Level 3
//   npm run balance -- -n 120 -s 9000        # more battles / another seed block
//   npm run balance -- --level 7             # all Supers unlocked
//   npm run balance -- --difficulty HARD
//   npm run balance -- --set KB_EXP=0.7      # try a tuning override without editing code
//   npm run balance -- --brief               # one-line summary for sweeps

import { buildBlade } from '../src/blades/BladeFactory';
import { MVP_BLADES, getBlade } from '../src/blades/bladeData';
import { TUNING } from '../src/core/Balance';
import { CLASS_BEATS } from '../src/core/types';
import type { AIDifficulty } from '../src/ai/AIStates';
import { playMatch } from '../src/sim/headless';

const args = process.argv.slice(2);
const opt = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const N = parseInt(opt('-n', '40'), 10);
const SEED0 = parseInt(opt('-s', '1000'), 10);
const LEVEL = parseInt(opt('--level', '3'), 10);
const DIFF = opt('--difficulty', 'NORMAL') as AIDifficulty;
const BRIEF = args.includes('--brief');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--set') {
    const [k, v] = args[i + 1].split('=');
    (TUNING as Record<string, number>)[k] = parseFloat(v);
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const ids = opt('--ids', '') ? opt('--ids', '').split(',') : MVP_BLADES;
const built = Object.fromEntries(ids.map((id) => [id, buildBlade(id, { level: LEVEL })]));

interface Cell { wins: number; draws: number; n: number; dur: number; ring: number; spin: number; early: number; timeouts: number; dbl: number; seatWins: [number, number]; seatN: [number, number] }
const cells: Record<string, Cell> = {};
const cell = (a: string, b: string) => (cells[`${a}>${b}`] ??= { wins: 0, draws: 0, n: 0, dur: 0, ring: 0, spin: 0, early: 0, timeouts: 0, dbl: 0, seatWins: [0, 0], seatN: [0, 0] });

for (const a of ids) {
  for (const b of ids) {
    const c = cell(a, b);
    for (let s = 0; s < N; s++) {
      // seats alternate so a counter is judged from both sides; mirrors always run bottom-seat-first
      const swap = a !== b && s % 2 === 1;
      const order = swap ? [b, a] : [a, b];
      const { result, duration } = await playMatch(order.map((id) => built[id]), { seed: SEED0 + s, difficulty: [DIFF, DIFF] });
      const mine = swap ? 1 : 0;
      c.n++; c.dur += duration; c.seatN[mine]++;
      if (duration < 6) c.early++;
      if (result.timeout) c.timeouts++;
      if (result.doubleKO) c.dbl++;
      if (result.winner === mine) { c.wins++; c.seatWins[mine]++; }
      else if (result.winner < 0) { c.draws++; c.seatWins[mine] += 0.5; }
      if (result.winner >= 0) {
        const cause = result.causes[1 - result.winner];
        if (cause === 'ring') c.ring++; else if (cause === 'spin') c.spin++;
      }
    }
  }
}

const rate = (a: string, b: string) => { const c = cell(a, b); return (c.wins + c.draws / 2) / c.n; };
const seat = (a: string, b: string) => { const c = cell(a, b); return [c.seatWins[0] / Math.max(1, c.seatN[0]), c.seatWins[1] / Math.max(1, c.seatN[1])]; };
let ring = 0, spinC = 0, draws = 0, early = 0, total = 0, dur = 0, timeouts = 0;
for (const c of Object.values(cells)) { ring += c.ring; spinC += c.spin; draws += c.draws; early += c.early; total += c.n; dur += c.dur; timeouts += c.timeouts; }

// the triangle, by class
const tri: Array<[string, string]> = [];
for (const a of ids) for (const b of ids) if (CLASS_BEATS[getBlade(a).class] === getBlade(b).class) tri.push([a, b]);

if (BRIEF) {
  console.log(tri.map(([a, b]) => `${a[0]}>${b[0]} ${pct(rate(a, b))}`).join(' ') + ` | mirrors ${ids.map((i) => pct(rate(i, i))).join('')} | ring ${pct(ring / Math.max(1, ring + spinC))} | ${(dur / total).toFixed(1)}s early ${pct(early / total)}`);
  process.exit(0);
}

console.log(`\nSpinblade balance — ${N} battles per ordered pair (${total} total), Level ${LEVEL}, CPU ${DIFF}\n`);
console.log('Row wins against column (class triangle: ' + ids.map((i) => `${getBlade(i).name}=${getBlade(i).class}`).join(', ') + ')');
console.log(''.padEnd(10) + ids.map((i) => i.padStart(10)).join(''));
for (const a of ids) console.log(a.padEnd(10) + ids.map((b) => (a === b ? '—' : pct(rate(a, b))).padStart(10)).join(''));
console.log('\nSeat check (win % from bottom seat / top seat — the player sits at the bottom):');
for (const [a, b] of tri) { const [x, y] = seat(a, b); console.log(`  ${a} vs ${b}: ${pct(x)} / ${pct(y)}`); }
for (const i of ids) console.log(`  ${i} mirror, bottom seat: ${pct(rate(i, i))}`);
console.log(`\nOutcome mix: ring-out ${pct(ring / total)}  spin-out ${pct(spinC / total)}  draw ${pct(draws / total)}  timeout ${pct(timeouts / total)}`);
console.log(`Mean battle: ${(dur / total).toFixed(1)}s   battles under 6s: ${pct(early / total)}`);
console.log('\nPer matchup (ordered pair): mean s | ring / spin of decisive');
for (const a of ids) for (const b of ids) {
  if (a > b) continue;
  const c = cell(a, b); const c2 = cell(b, a);
  const n = c.n + (a === b ? 0 : c2.n), d = c.dur + (a === b ? 0 : c2.dur);
  const r = c.ring + (a === b ? 0 : c2.ring), s = c.spin + (a === b ? 0 : c2.spin);
  console.log(`  ${a.padEnd(8)} v ${b.padEnd(8)} ${(d / n).toFixed(1).padStart(5)}s | ring ${pct(r / Math.max(1, r + s))}`);
}

const checks: Array<[string, boolean]> = [];
// A counter should be a real edge, not a lock: the disadvantaged blade must still win some (skill, Supers and
// terrain have to matter), otherwise picking it is simply a loss.
for (const [a, b] of tri) {
  const [x, y] = seat(a, b);
  checks.push([`${a} beats ${b}: 65–88% overall, 55–95% from either seat`, rate(a, b) >= 0.65 && rate(a, b) <= 0.88 && Math.min(x, y) >= 0.55 && Math.max(x, y) <= 0.95]);
}
for (const i of ids) checks.push([`${i} mirror is seat-neutral (bottom seat 40–60%)`, rate(i, i) > 0.4 && rate(i, i) < 0.6]);
checks.push(['mean battle 12–45s', dur / total >= 12 && dur / total <= 45]);
// a heavy Attack blade ringing out a light one on the first clash is the Attack fantasy; it just must not be most fights
checks.push(['battles under 6s < 20%', early / total < 0.2]);
checks.push(['timeouts < 3%', timeouts / total < 0.03]);
checks.push(['ring-out share 10–70% of decisive', ring / Math.max(1, ring + spinC) > 0.1 && ring / Math.max(1, ring + spinC) < 0.7]);
checks.push(['draws < 5%', draws / total < 0.05]);
console.log('\nTargets:');
let fail = 0;
for (const [l, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
