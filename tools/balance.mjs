#!/usr/bin/env node
// Headless balance check for Spinblade Arena.
//
// Extracts the pure simulation block (between the SIM:START / SIM:END markers) from index.html and
// runs CPU-vs-CPU battles across every blade matchup. Use it after touching any tuning knob.
//
//   node tools/balance.mjs                 # 300 battles per matchup against ../index.html
//   node tools/balance.mjs -n 1000         # more battles, tighter estimates
//   node tools/balance.mjs -s 5000         # different RNG seed block (use to validate tuning)
//   node tools/balance.mjs -f path.html    # another file
//   node tools/balance.mjs --set DRAG=1.4 --set SPIN_DMG=0.1   # try tuning overrides without editing
//   node tools/balance.mjs --brief         # one-line summary, handy for parameter sweeps
//
// Exits non-zero if the counter-triangle, pacing or launch-safety targets are missed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const N = parseInt(opt('-n', '300'), 10);
const SEED0 = parseInt(opt('-s', '1000'), 10);
const file = path.resolve(opt('-f', path.join(here, '..', 'index.html')));
const sets = args.flatMap((a, i) => (a === '--set' ? [args[i + 1]] : []));

const src = readFileSync(file, 'utf8');
const a = src.indexOf('// ===== SIM:START');
const b = src.indexOf('// ===== SIM:END');
if (a < 0 || b < 0) throw new Error('SIM markers not found in ' + file);
const SIM = new Function(src.slice(a, b) + '\nreturn SIM;')();
const { T, KINDS, BLADES } = SIM;
for (const s of sets) { // --set DRAG=1.4  or  --set striker.atk=1.4
  const [k, v] = s.split('=');
  if (k.includes('.')) { const [id, prop] = k.split('.'); BLADES[id][prop] = parseFloat(v); } else T[k] = parseFloat(v);
}

// ---- one battle ------------------------------------------------------------------------------
function battle(k0, k1, seed) {
  const rng = SIM.makeRng(seed);
  const m = SIM.createMatch([k0, k1], rng, ['ai', 'ai']);
  for (let i = 0; i < 2; i++) { const l = SIM.aiLaunch(m, i); SIM.launch(m, i, l.angle, l.power); }
  let guard = 0;
  while (m.phase !== 'over' && guard++ < 120 / T.DT) { SIM.step(m, T.DT); SIM.settleFallen(m); m.events.length = 0; }
  return m.result;
}

// ---- matchup table ---------------------------------------------------------------------------
const pct = (x) => (x * 100).toFixed(0).padStart(3) + '%';
const rows = {};   // rows[a][b] = win rate of a vs b (seats swapped half the time)
let total = 0, ring = 0, spin = 0, dbl = 0, timeouts = 0, dur = 0, hits = 0, draws = 0, early = 0;
const dursByPair = {};
const mix = {};   // per unordered pair: decisive-cause counts
const seatRate = {};   // seatRate[a][b] = [a wins from the bottom seat, a wins from the top seat]
for (const ka of KINDS) {
  rows[ka] = {}; seatRate[ka] = {};
  for (const kb of KINDS) {
    let w = 0, d = 0, n = 0, t = 0;
    const sw = [0, 0], ww = [0, 0];
    for (let s = 0; s < N; s++) {
      // Seats alternate so a counter is judged from both sides. Mirrors always run bottom-seat-first:
      // the player sits at the bottom, so a seat bias would show up there as a lopsided "mirror".
      const swap = ka !== kb && s % 2 === 1;
      const r = swap ? battle(kb, ka, SEED0 + s) : battle(ka, kb, SEED0 + s);
      const mine = swap ? 1 : 0;
      sw[mine]++;
      if (r.winner === mine) { w++; ww[mine]++; }
      else if (r.winner < 0) { d++; ww[mine] += 0.5; }
      n++; t += r.duration; if (r.duration < 6) early++;
      total++; dur += r.duration; hits += r.stats[0].hits;
      if (r.timeout) timeouts++;
      if (r.doubleKO) dbl++;
      const pk = [ka, kb].sort().join(' v ');
      const mx = (mix[pk] ||= { n: 0, ring: 0, spin: 0, dbl: 0, draw: 0, to: 0 });
      if (ka <= kb) { mx.n++; if (r.doubleKO) mx.dbl++; if (r.timeout) mx.to++; }
      if (r.winner < 0) { draws++; if (ka <= kb) mx.draw++; }
      else { const c = r.causes[r.winner === 0 ? 1 : 0]; if (c === 'ring') ring++; else if (c === 'spin') spin++; if (ka <= kb) mx[c === 'ring' ? 'ring' : 'spin']++; }
    }
    rows[ka][kb] = (w + d / 2) / n;
    seatRate[ka][kb] = [ww[0] / Math.max(1, sw[0]), ww[1] / Math.max(1, sw[1])];
    dursByPair[ka + ' v ' + kb] = t / n;
  }
}

if (args.includes('--brief')) {
  const r = rows;
  console.log(`S>V ${pct(r.striker.vortex)} V>A ${pct(r.vortex.aegis)} A>S ${pct(r.aegis.striker)} | mirrors S${pct(r.striker.striker)} A${pct(r.aegis.aegis)} V${pct(r.vortex.vortex)}` +
    ` | ring ${pct(ring / (ring + spin || 1))} dbl ${pct(dbl / total)} to ${pct(timeouts / total)} | ${(dur / total).toFixed(1)}s hits ${(hits / total).toFixed(1)}  ${sets.join(' ')}`);
  process.exit(0);
}
console.log(`\nSpinblade balance — ${N} battles per matchup (${total} total)  ${sets.length ? '[' + sets.join(' ') + ']' : ''}`);
console.log('\nRow wins against column:');
console.log(''.padEnd(10) + KINDS.map((k) => k.padStart(9)).join(''));
for (const ka of KINDS) console.log(ka.padEnd(10) + KINDS.map((kb) => (ka === kb ? '   —' : pct(rows[ka][kb])).padStart(9)).join(''));
console.log('\nSeat check (win % from bottom seat / top seat — the player sits at the bottom):');
for (const [x, y] of [['striker', 'vortex'], ['vortex', 'aegis'], ['aegis', 'striker']]) console.log(`  ${x} vs ${y}: ${pct(seatRate[x][y][0])} / ${pct(seatRate[x][y][1])}`);
for (const k of KINDS) console.log(`  ${k} mirror, bottom seat: ${pct(rows[k][k])}`);
console.log('\nOutcome mix:   ring-out ' + pct(ring / total) + '   spin-out ' + pct(spin / total) +
  '   double-KO ' + pct(dbl / total) + '   timeout ' + pct(timeouts / total) + '   draw ' + pct(draws / total));
console.log('Mean battle:   ' + (dur / total).toFixed(1) + 's   hits/battle ' + (hits / total).toFixed(1));
console.log('\nPer matchup (ordered pairs counted once):  ring / spin / dblKO / draw / timeout   mean s');
for (const [k, v] of Object.entries(mix)) {
  const dd = dursByPair[k] ?? dursByPair[k.split(' v ').reverse().join(' v ')];
  console.log('  ' + k.padEnd(18) + [v.ring, v.spin, v.dbl, v.draw, v.to].map((x) => pct(x / v.n)).join(' ') + '   ' + dd.toFixed(1) + 's');
}

// ---- launch safety: full-power shot straight out must not ring out on its own ------------------
console.log('\nLaunch safety (full power, no steering, straight away from centre):');
let launchOK = true;
for (const k of KINDS) {
  const m = SIM.createMatch([k, 'aegis'], SIM.makeRng(1), ['human', 'none']);
  m.blades[1].launched = true; m.blades[1].x = 0; m.blades[1].y = -90; m.blades[1].px = 0; m.blades[1].py = -90;
  SIM.launch(m, 0, Math.PI / 2, 1);            // +y is "down"; the blade spawns at +y, so this is radially outward
  let maxD = 0;
  for (let i = 0; i < 6 / T.DT && m.phase !== 'over'; i++) { SIM.step(m, T.DT); maxD = Math.max(maxD, Math.hypot(m.blades[0].x, m.blades[0].y)); m.events.length = 0; }
  const ok = (!m.blades[0].out || m.blades[0].out === 'spin') && maxD <= 92;
  if (!ok) launchOK = false;
  console.log(`  ${k.padEnd(8)} peak distance ${maxD.toFixed(1)} / ${T.RIM}   ${ok ? 'ok' : 'RINGED OUT'}`);
}

// ---- targets (design intent) -------------------------------------------------------------------
// Counter-triangle: each counter wins clearly in CPU-vs-CPU play but not as a lock — a human can still
// turn it with steering. Mirrors are coin-flips. Both win conditions must show up. No dead or instant fights.
const checks = [];
const tri = [['striker', 'vortex'], ['vortex', 'aegis'], ['aegis', 'striker']];
for (const [x, y] of tri) checks.push([`${x} beats ${y} ≥ 70%, and ≥ 60% from either seat`, rows[x][y] >= 0.7 && Math.min(...seatRate[x][y]) >= 0.6]);
for (const k of KINDS) checks.push([`${k} mirror is seat-neutral (bottom seat 40–60%)`, rows[k][k] > 0.4 && rows[k][k] < 0.6]);
checks.push(['mean battle 12–35s', dur / total >= 12 && dur / total <= 35]);
checks.push(['battles under 6s < 15%', early / total < 0.15]);
checks.push(['timeouts < 3%', timeouts / total < 0.03]);
checks.push(['ring-out share 10–70% of decisive', ring / (ring + spin) > 0.10 && ring / (ring + spin) < 0.7]);
checks.push(['draws < 5%', draws / total < 0.05]);
checks.push(['launch never self-rings-out (peak ≤ 92)', launchOK]);
console.log('\nTargets:');
let fail = 0;
for (const [label, ok] of checks) { console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
