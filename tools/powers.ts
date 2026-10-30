// Power audit: fire every basic move and every Super of every blade in a staged fight and report what each one
// visibly did: events, status effects given to either blade, zones/pulls/drains/decoys created, speed and position
// change, spin change. A power that shows nothing at all is a dead power.
//
//   npx tsx tools/powers.ts                 # all 21 blades
//   npx tsx tools/powers.ts ravok,phantom   # some of them
//   npx tsx tools/powers.ts --dead          # only print the powers that did nothing

import { buildBlade } from '../src/blades/BladeFactory';
import { BLADES, PLAYABLE_BLADES } from '../src/blades/bladeData';
import { getSuper } from '../src/blades/supers';
import { getArena } from '../src/arenas/arenaData';
import { Match } from '../src/combat/Match';
import { TUNING } from '../src/core/Balance';
import { initPhysics } from '../src/core/Physics';
import { makeRng } from '../src/core/Rng';

const args = process.argv.slice(2);
const onlyDead = args.includes('--dead');
const ids = (args.find((a) => !a.startsWith('--')) ?? '').split(',').filter(Boolean);
await initPhysics();

interface Signal {
  events: Set<string>; myTags: Set<string>; oppTags: Set<string>; flags: Set<string>;
  zones: number; pulls: number; drains: number; decoys: number; shield: boolean;
  dv: number; jump: number; spinMe: number; spinOpp: number; dmgDealt: number; hits: number;
}

function stage(a: string, b: string, level: number, equip?: string): Match {
  const m = new Match(getArena('core-pit'), [
    { built: buildBlade(a, { level, equippedSuper: equip }), control: 'human' },
    { built: buildBlade(b, { level }), control: 'human' },
  ], makeRng(9));
  m.launch(0, 0, 0); m.launch(1, Math.PI, 0);
  // face to face, 4 units apart, closing slowly
  const set = (s: number, x: number, vx: number): void => {
    const bd = m.blades[s].bb.body;
    bd.setTranslation({ x, y: m.blades[s].bb.y, z: 0 }, true);
    bd.setLinvel({ x: vx, y: 0, z: 0 }, true);
  };
  set(0, -2.2, 1.5); set(1, 2.2, -1.5);
  for (let i = 0; i < 6; i++) m.step();
  return m;
}

function run(m: Match, fire: () => void, seconds: number): Signal {
  const me = m.blades[0], opp = m.blades[1];
  const sig: Signal = { events: new Set(), myTags: new Set(), oppTags: new Set(), flags: new Set(), zones: 0, pulls: 0, drains: 0, decoys: 0, shield: false, dv: 0, jump: 0, spinMe: 0, spinOpp: 0, dmgDealt: 0, hits: 0 };
  m.takeEvents();
  const spin0 = me.spin, oSpin0 = opp.spin;
  fire();
  let px = me.x, pz = me.z, pvx = me.vx, pvz = me.vz;
  for (let i = 0; i < seconds / TUNING.DT; i++) {
    m.step();
    for (const e of m.takeEvents()) {
      if (e.type === 'fx') sig.events.add(e.kind); else if (e.type === 'hit') sig.hits++; else if (e.type === 'ability' || e.type === 'super' || e.type === 'charge') sig.events.add(`${e.type}:${'state' in e ? e.state : ''}`.replace(/:$/, ''));
    }
    for (const a of me.mods) { if (a.tag) sig.myTags.add(a.tag); for (const f of a.flags) sig.flags.add(f); }
    for (const a of opp.mods) if (a.tag) sig.oppTags.add(a.tag);
    sig.zones = Math.max(sig.zones, m.zones.length); sig.pulls = Math.max(sig.pulls, m.pulls.length);
    sig.drains = Math.max(sig.drains, m.drains.length); sig.decoys = Math.max(sig.decoys, m.decoys.length);
    if (me.shield) sig.shield = true;
    sig.jump = Math.max(sig.jump, Math.hypot(me.x - px, me.z - pz));
    sig.dv = Math.max(sig.dv, Math.hypot(me.vx - pvx, me.vz - pvz));
    px = me.x; pz = me.z; pvx = me.vx; pvz = me.vz;
  }
  sig.spinMe = me.spin - spin0; sig.spinOpp = opp.spin - oSpin0; sig.dmgDealt = me.stats.damageDealt;
  return sig;
}

const dead = (s: Signal): boolean =>
  s.events.size === 0 && s.myTags.size === 0 && s.oppTags.size === 0 && !s.zones && !s.pulls && !s.drains && !s.decoys && !s.shield && s.dv < 0.6 && s.jump < 0.35;

const fmt = (s: Signal): string => {
  const bits: string[] = [];
  if (s.myTags.size) bits.push(`self[${[...s.myTags].join(',')}]`);
  if (s.oppTags.size) bits.push(`foe[${[...s.oppTags].join(',')}]`);
  if (s.flags.size) bits.push(`flags[${[...s.flags].join(',')}]`);
  const made = [s.zones && `zone×${s.zones}`, s.pulls && 'pull', s.drains && 'drain', s.decoys && 'decoy', s.shield && 'shield'].filter(Boolean);
  if (made.length) bits.push(made.join(' '));
  if (s.dv >= 0.6) bits.push(`Δv ${s.dv.toFixed(1)}`);
  if (s.jump >= 0.35) bits.push(`jump ${s.jump.toFixed(1)}`);
  if (Math.abs(s.spinMe) > 0.4) bits.push(`spin ${s.spinMe > 0 ? '+' : ''}${s.spinMe.toFixed(1)}`);
  if (s.hits) bits.push(`${s.hits} hits`);
  const ev = [...s.events].filter((e) => !/^(ability|charge)/.test(e));
  if (ev.length) bits.push(`fx{${ev.join(',')}}`);
  return bits.join(' · ') || '—';
};

let deadCount = 0, total = 0;
for (const id of ids.length ? ids : PLAYABLE_BLADES) {
  const def = BLADES[id];
  const foe = id === 'gravion' ? 'ravok' : 'gravion';
  const lines: string[] = [];
  // basic moves: tap each (a charged move is held for half a second)
  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    const m = stage(id, foe, 7);
    const mv = m.blades[0].built.moves[i];
    const sig = run(m, () => {
      m.pushAction(0, { k: 'down', i });
      if (mv.charge) { for (let k = 0; k < 60; k++) m.step(); }
      m.pushAction(0, { k: 'up', i });
    }, 2.5);
    total++;
    const d = dead(sig);
    if (d) deadCount++;
    if (!onlyDead || d) lines.push(`  move ${i + 1} ${mv.name.padEnd(16)} ${d ? 'DEAD  ' : ''}${fmt(sig)}`);
    m.dispose();
    if (i === 2) break;
  }
  for (const sid of def.superPool) {
    const sd = getSuper(sid);
    const m = stage(id, foe, 7, sid);
    const sig = run(m, () => { m.pushAction(0, { k: 'super' }); }, Math.min(sd.duration, 7) + 0.5);
    total++;
    const d = dead(sig);
    if (d) deadCount++;
    if (!onlyDead || d) lines.push(`  super  ${sd.name.padEnd(16)} ${d ? 'DEAD  ' : ''}${fmt(sig)}`);
    m.dispose();
  }
  if (lines.length) console.log(`${def.name} (${def.class})\n${lines.join('\n')}`);
}
console.log(`\n${deadCount} of ${total} powers showed no visible effect.`);
