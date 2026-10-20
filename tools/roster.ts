// Roster balance: every blade against every other blade from both seats, then each blade's average win rate and
// each class's win rate against the class it should beat and the class that should beat it. The three-blade
// balance tool (tools/balance.ts) checks the triangle on the spec's MVP trio; this one checks the other 18 are
// neither useless nor dominant.
//
//   npm run roster                               # 10 battles per pair, Level 3, CPU Normal
//   npm run roster -- -n 24 --level 5
//   npm run roster -- --shard 2/4                # run a quarter of the pairs (merge the JSON afterwards)
//   npm run roster -- --json out.json            # write raw results
//   npm run roster -- --focus ghost-viper,voidrunner   # only the pairs that include these blades
//   npm run roster -- --set KB_EXP=0.5 --stat ravok.attack=8

import fs from 'node:fs';
import { buildBlade } from '../src/blades/BladeFactory';
import { BLADES, PLAYABLE_BLADES } from '../src/blades/bladeData';
import { TUNING } from '../src/core/Balance';
import { CLASS_BEATS } from '../src/core/types';
import type { AIDifficulty } from '../src/ai/AIStates';
import { playMatch } from '../src/sim/headless';

const args = process.argv.slice(2);
const opt = (f: string, d: string): string => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const N = parseInt(opt('-n', '10'), 10);
const LEVEL = parseInt(opt('--level', '3'), 10);
const DIFF = opt('--difficulty', 'NORMAL') as AIDifficulty;
const SEED0 = parseInt(opt('-s', '7000'), 10);
const ARENA = opt('--arena', 'core-pit');
const [shard, shards] = opt('--shard', '1/1').split('/').map(Number);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--set') { const [k, v] = args[i + 1].split('='); (TUNING as Record<string, number>)[k] = parseFloat(v); }
  if (args[i] === '--stat') { const [path, v] = args[i + 1].split('='); const [id, key] = path.split('.'); (BLADES[id].stats as unknown as Record<string, number>)[key] = parseFloat(v); }
}

const focus = opt('--focus', '') ? opt('--focus', '').split(',') : null;
const ids = opt('--ids', '') ? opt('--ids', '').split(',') : PLAYABLE_BLADES;

interface Cell { w: number; n: number; dur: number; ring: number }
const cells: Record<string, Cell> = {};   // "a>b": wins of a over b

// --merge a.json,b.json: combine shard outputs and report
if (opt('--merge', '')) {
  for (const f of opt('--merge', '').split(',')) Object.assign(cells, JSON.parse(fs.readFileSync(f, 'utf8')).cells);
  report(cells, ids);
}
const built = Object.fromEntries(ids.map((id) => [id, buildBlade(id, { level: LEVEL })]));

let pairIndex = 0;
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    if (focus && !focus.includes(a) && !focus.includes(b)) continue;
    if ((pairIndex++ % shards) !== shard - 1) continue;
    const c: Cell = { w: 0, n: 0, dur: 0, ring: 0 };
    for (let s = 0; s < N; s++) {
      const swap = s % 2 === 1;
      const order = swap ? [b, a] : [a, b];
      const { result, duration } = await playMatch(order.map((id) => built[id]), { seed: SEED0 + s * 31 + i * 7 + j, difficulty: [DIFF, DIFF], arenaId: ARENA });
      const aSlot = swap ? 1 : 0;
      c.n++; c.dur += duration;
      if (result.winner === aSlot) c.w++; else if (result.winner < 0) c.w += 0.5;
      if (result.winner >= 0 && result.causes[1 - result.winner] === 'ring') c.ring++;
    }
    cells[`${a}>${b}`] = c;
  }
}

const jsonOut = opt('--json', '');
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ N, LEVEL, DIFF, cells }));
if (shards > 1) { console.log(`shard ${shard}/${shards}: ${Object.keys(cells).length} pairs`); process.exit(0); }

report(cells, ids);

export function report(cells: Record<string, Cell>, ids: string[]): void {
  const total: Record<string, { w: number; n: number }> = {};
  const vs = (a: string, b: string): number | null => {
    const c = cells[`${a}>${b}`]; if (c) return c.w / c.n;
    const d = cells[`${b}>${a}`]; if (d) return 1 - d.w / d.n;
    return null;
  };
  for (const a of ids) {
    total[a] = { w: 0, n: 0 };
    for (const b of ids) { if (a === b) continue; const r = vs(a, b); if (r === null) continue; total[a].w += r; total[a].n++; }
  }
  const rows = ids.map((id) => ({ id, cls: BLADES[id].class, rate: total[id].w / Math.max(1, total[id].n) })).sort((x, y) => y.rate - x.rate);
  console.log(`\nRoster balance: ${ids.length} blades, Level ${LEVEL}, CPU ${DIFF}, ${N} battles per pair\n`);
  console.log('Average win rate against the rest of the roster:');
  for (const r of rows) console.log(`  ${r.id.padEnd(16)} ${BLADES[r.id].class.padEnd(8)} ${(r.rate * 100).toFixed(0).padStart(3)}%  ${'█'.repeat(Math.round(r.rate * 40))}`);

  const classRate = (x: string, y: string): number => {
    let w = 0, n = 0;
    for (const a of ids) for (const b of ids) if (BLADES[a].class === x && BLADES[b].class === y) { const r = vs(a, b); if (r !== null) { w += r; n++; } }
    return n ? w / n : NaN;
  };
  console.log('\nClass triangle (win rate of the row class against the column class):');
  const classes = ['ATTACK', 'STAMINA', 'DEFENSE'] as const;
  console.log(''.padEnd(10) + classes.map((c) => c.padStart(9)).join(''));
  for (const x of classes) console.log(x.padEnd(10) + classes.map((y) => (x === y ? '—' : `${(classRate(x, y) * 100).toFixed(0)}%`).padStart(9)).join(''));

  let dur = 0, n = 0, ring = 0, dec = 0;
  for (const c of Object.values(cells)) { dur += c.dur; n += c.n; ring += c.ring; dec += c.n; }
  console.log(`\nMean battle ${(dur / n).toFixed(1)} s over ${n} battles; ring-outs ${(100 * ring / dec).toFixed(0)}% of results`);

  const checks: Array<[string, boolean]> = [];
  for (const r of rows) checks.push([`${r.id} average win rate 35–65%`, r.rate >= 0.35 && r.rate <= 0.65]);
  for (const x of classes) { const y = CLASS_BEATS[x]; const r = classRate(x, y); checks.push([`${x} beats ${y}: ${(r * 100).toFixed(0)}% (want 55–80%)`, r >= 0.55 && r <= 0.8]); }
  const classAvg = (c: string): number => { const g = rows.filter((r) => r.cls === c); return g.reduce((s, r) => s + r.rate, 0) / Math.max(1, g.length); };
  for (const c of classes) checks.push([`${c} class average 42–58%`, classAvg(c) >= 0.42 && classAvg(c) <= 0.58]);
  console.log('\nTargets:');
  let fail = 0;
  for (const [l, ok] of checks) { if (!ok) { console.log(`  FAIL  ${l}`); fail++; } }
  console.log(fail ? `\n${fail} of ${checks.length} checks fail.` : `  all ${checks.length} checks pass`);
  process.exit(fail ? 1 : 0);
}
