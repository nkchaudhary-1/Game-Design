// Plain-language text for every power, written from the data that actually runs. A move's or Super's description says
// what it is for; these lines say exactly what it does, so the two cannot drift apart. Used by the pre-battle Powers
// panel, the in-battle help sheet, the power feed and the status chips.
//
// Text is written from a point of view (a Voice): for your own powers "you" are the blade and "the opponent" is the CPU;
// for the CPU's powers the blade is named and "you" are its opponent, so the sheet reads right for both.

import type { AbilityDef, EffectDef, ModFlag, ModKey, ModSet, SuperDef, TimedEffect } from './effects';
import type { ActiveMod } from './Blade';
import { CRYSTAL_INFO, type CrystalKind } from '../arenas/hazards';

/** Whose point of view the text takes. */
export interface Voice {
  /** The blade using the power: "you", or a name. */
  self: string;
  selfYou: boolean;
  /** The blade it is used on. */
  foe: string;
  foeYou: boolean;
  /** "your" / "its". */
  poss: string;
  foePoss: string;
}
export const YOU: Voice = { self: 'you', selfYou: true, foe: 'the opponent', foeYou: false, poss: 'your', foePoss: 'the opponent’s' };
/** The CPU's powers, seen by you. */
export const cpuVoice = (name: string): Voice => ({ self: name, selfYou: false, foe: 'you', foeYou: true, poss: 'its', foePoss: 'your' });

const pct = (v: number): number => Math.round(Math.abs(1 - v) * 100);
/** A multiplier scaled the way the game scales it: a Super's strength and the blade's level stretch it away from 1. */
const scaled = (v: number, k: number): number => 1 + (v - 1) * k;
const secs = (s: number): string => `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
const up1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** One stat change in words, in the form for "you" and for a named blade. */
interface Phrase { you: string; they: string }
const both = (t: string): Phrase => ({ you: t, they: t });

function modPhrase(key: ModKey, v: number): Phrase | null {
  const up = v > 1, p = pct(v);
  if (p < 1) return null;
  switch (key) {
    case 'accel': return up ? { you: `steer ${p}% harder`, they: `steers ${p}% harder` } : v < 0.1 ? both('cannot steer') : { you: `steer ${p}% slower`, they: `steers ${p}% slower` };
    case 'drag': return up ? (v > 3 ? { you: 'come almost to a stop', they: 'comes almost to a stop' } : { you: `slow down ${p}% faster`, they: `slows down ${p}% faster` }) : { you: `slide more (${p}% less drag)`, they: `slides more (${p}% less drag)` };
    case 'mass': return up ? { you: `are ${p}% heavier, so harder to shove`, they: `is ${p}% heavier, so harder to shove` } : { you: `are ${p}% lighter, so easier to shove`, they: `is ${p}% lighter, so easier to shove` };
    case 'kbDealt': return up ? { you: `shove ${p}% harder`, they: `shoves ${p}% harder` } : { you: `shove ${p}% less`, they: `shoves ${p}% less` };
    case 'kbTaken': return up ? { you: `take ${p}% more knockback`, they: `takes ${p}% more knockback` } : { you: `take ${p}% less knockback`, they: `takes ${p}% less knockback` };
    case 'dmgDealt': return up ? { you: `hit ${p}% harder`, they: `hits ${p}% harder` } : { you: `hit ${p}% weaker`, they: `hits ${p}% weaker` };
    case 'dmgTaken': return up ? { you: `take ${p}% more damage`, they: `takes ${p}% more damage` } : { you: `take ${p}% less damage`, they: `takes ${p}% less damage` };
    case 'spinDecay': return up ? { you: `lose spin ${p}% faster`, they: `loses spin ${p}% faster` } : { you: `lose spin ${p}% slower`, they: `loses spin ${p}% slower` };
    case 'grip': return up ? { you: 'turn sharper', they: 'turns sharper' } : { you: 'turn wider (slide)', they: 'turns wider (slides)' };
    case 'external': return up ? { you: 'are easier to pull and push around', they: 'is easier to pull and push around' } : { you: 'are harder to pull and push around', they: 'is harder to pull and push around' };
  }
}

const FLAG_TEXT: Record<ModFlag, { you: string; they: string; chip: string }> = {
  invuln: { you: 'cannot be hurt or pushed', they: 'cannot be hurt or pushed', chip: 'Invulnerable' },
  ghost: { you: 'pass through other blades', they: 'passes through other blades', chip: 'Ghost' },
  reflectDamage: { you: 'send damage back at the attacker', they: 'sends damage back at the attacker', chip: 'Reflecting' },
  reflectKnockback: { you: 'bounce knockback back at the attacker', they: 'bounces knockback back at the attacker', chip: 'Rebound' },
  stealth: { you: 'are hard to see and aim at', they: 'is hard to see and aim at', chip: 'Hidden' },
  ambush: { you: 'deal about 70% more damage with your next hit', they: 'deals about 70% more damage with its next hit', chip: 'Ambush ready' },
  absorb: { you: 'turn damage you take into spin', they: 'turns damage it takes into spin', chip: 'Absorbing' },
};

function modLines(mods: ModSet | undefined, flags: ModFlag[] | undefined, duration: number, who: 'self' | 'opponent', note: string, k: number, v: Voice): string[] {
  const subject = who === 'self' ? v.self : v.foe;
  const youForm = who === 'self' ? v.selfYou : v.foeYou;
  const parts: string[] = [];
  for (const key of Object.keys(mods ?? {}) as ModKey[]) {
    const ph = modPhrase(key, scaled(mods![key]!, k));
    if (ph) parts.push(youForm ? ph.you : ph.they);
  }
  for (const f of flags ?? []) parts.push(youForm ? FLAG_TEXT[f].you : FLAG_TEXT[f].they);
  if (!parts.length) return [];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return [`${up1(subject)} ${list} for ${secs(duration)}${note}.`];
}

const size = (r: number): string => (r < 2.5 ? 'a small area' : r < 4 ? 'a medium area' : 'a wide area');
const dmg = (d: number): string => (d >= 8 ? 'heavy damage' : d >= 4 ? 'solid damage' : 'light damage');

/** What a list of effects does, one sentence each. */
export function describeEffects(effects: EffectDef[], k = 1, v: Voice = YOU): string[] {
  const out: string[] = [];
  const dirText: Record<string, string> = {
    heading: `in the direction ${v.selfYou ? 'you are' : 'it is'} steering`, target: `straight at ${v.foe}`,
    perp: `sideways, off ${v.foePoss} line`, away: `away from ${v.foe}`,
  };
  const me = v.selfYou ? 'you' : 'it';
  for (const e of effects) {
    switch (e.kind) {
      case 'dash': out.push(`Dashes ${dirText[e.dir]}${e.scaleByCharge ? ', further the longer it charges' : ''}.`); break;
      case 'mod': {
        const note = (e.scaleByCharge ? ' (stronger with a longer charge)' : '') + (e.stack ? `, stacking up to ${e.stack} times` : '');
        out.push(...modLines(e.mods, e.flags, e.duration, e.target === 'opponent' ? 'opponent' : 'self', note, k, v));
        if (e.spinLoss) {
          const bits: string[] = [];
          const s = e.spinLoss;
          if (s.dmgDealt) bits.push(`hits up to ${pct(scaled(s.dmgDealt, k))}% harder`);
          if (s.kbDealt) bits.push(`shoves up to ${pct(scaled(s.kbDealt, k))}% harder`);
          if (s.dmgTaken) bits.push(`takes up to ${pct(scaled(s.dmgTaken, k))}% ${s.dmgTaken < 1 ? 'less' : 'more'} damage`);
          if (s.spinDecay) bits.push(`spin drains up to ${pct(scaled(s.spinDecay, k))}% ${s.spinDecay < 1 ? 'slower' : 'faster'}`);
          if (bits.length) out.push(`The less spin ${v.self} ${v.selfYou ? 'have' : 'has'}, the stronger it gets: ${bits.join(', ')} at zero spin.`);
        }
        break;
      }
      case 'radial': out.push(`A shockwave pushes away and damages blades in ${size(e.radius)} (${dmg(e.damage * k)}).`); break;
      case 'pull': out.push(`Pulls ${v.foe} towards ${v.selfYou ? 'you' : 'itself'} for ${secs(e.duration)}.`); break;
      case 'zone': {
        const where = e.at === 'target' ? `on ${v.foe}` : e.follow ? `around ${v.self}, moving with ${me}` : `where ${v.self} ${v.selfYou ? 'stand' : 'stands'}`;
        const kind: Record<string, string> = {
          trap: `Leaves a trap ${where} for ${secs(e.duration)}: any blade crossing it is hit and shoved (${dmg(e.damage * k)})`,
          well: `A gravity well ${where} for ${secs(e.duration)} pulls blades in and slows them`,
          blackhole: `A black hole ${where} for ${secs(e.duration)} drags blades in and steals their spin`,
          repel: `A repulsor ${where} for ${secs(e.duration)} pushes blades away`,
          orbit: `A whirl ${where} for ${secs(e.duration)} swings blades round in a curve`,
          slow: `A slow field ${where} for ${secs(e.duration)} drags blades down to a crawl`,
        };
        out.push(`${kind[e.zone]} (${size(e.radius)}).`);
        break;
      }
      case 'drain': out.push(`Steals spin from blades close to ${me} for ${secs(e.duration)}, about ${(e.rate * k).toFixed(1)} a second, and passes most of it on to ${me}.`); break;
      case 'teleport': out.push(`Teleports ${me} right behind ${v.foe}.`); break;
      case 'spin': out.push(`Gives ${me} ${Math.round(e.amount * k)} spin back.`); break;
      case 'shield': out.push(`A shield absorbs the next ${e.hits} hit${e.hits > 1 ? 's' : ''} (up to ${secs(e.duration)}).`); break;
      case 'decoy': out.push(`Leaves a decoy of ${v.poss} blade for ${secs(e.duration)}; the other blade chases it until it touches it.`); break;
      case 'slam': out.push(`Leaps clear of everything, then slams down on ${v.foe} after ${secs(e.delay)}: a big shockwave (${dmg(e.damage * k)}).`); break;
      case 'rewind': out.push(`Jumps back to where ${v.selfYou ? 'you were' : 'it was'} ${secs(e.seconds)} ago and wins back ${Math.round(e.spin * 100)}% of the spin lost since.`); break;
    }
  }
  return out;
}

/** A Super's timeline as lines: what happens at the start, every N seconds, on hits, at the end. */
export function describeSuper(def: SuperDef, k = 1, v: Voice = YOU): string[] {
  const out: string[] = [];
  const hit = `Each time ${v.self} ${v.selfYou ? 'hit' : 'hits'}`, hurt = `Each time ${v.self} ${v.selfYou ? 'are' : 'is'} hit`;
  const WHEN: Record<TimedEffect['at'], string> = { start: 'When it starts', every: 'Every', onHit: hit, onHurt: hurt, end: 'When it ends' };
  for (const te of def.effects) {
    const when = te.at === 'every' ? `Every ${secs(te.interval ?? 1)}` : WHEN[te.at] + (te.at === 'onHit' || te.at === 'onHurt' ? (te.interval ? ` (at most every ${secs(te.interval)})` : '') : '');
    for (const line of describeEffects([te.effect], k, v)) out.push(`${when}, ${line.charAt(0).toLowerCase()}${line.slice(1)}`);
  }
  return out;
}

export interface PowerInfo {
  kind: 'move' | 'super';
  /** 1–3 for moves, 4 for the Super. */
  slot: number;
  name: string;
  type: string;
  /** The key on the keyboard and pad. */
  key: string;
  /** How to use it: "Hold to charge, release to fire", "Tap". */
  how: string;
  flavor: string;
  lines: string[];
  cooldown: number;
  /** How long it lasts (Supers) or the move's own window. */
  duration: number;
  /** Spin it costs to use, per use (and per second while charging). */
  cost: string;
}

export function moveInfo(m: AbilityDef, slot: number, v: Voice = YOU): PowerInfo {
  return {
    kind: 'move', slot, name: m.name, type: m.type, key: String(slot),
    how: v.selfYou ? (m.charge ? `Hold ${slot} to charge, release to fire` : `Tap ${slot}`) : (m.charge ? 'Charges, then fires' : 'Instant'),
    flavor: m.description, lines: describeEffects(m.effects, 1, v), cooldown: m.cooldown, duration: m.duration,
    cost: m.charge ? `${m.staminaCost} spin, plus ${m.charge.drainPerSec} a second while charging` : `${m.staminaCost} spin`,
  };
}

/** `levelBoost` is the blade's level boost: pass built.levelBoost so the numbers match what will actually happen. */
export function superInfo(s: SuperDef, levelBoost = 1, v: Voice = YOU): PowerInfo {
  return {
    kind: 'super', slot: 4, name: s.name, type: 'SUPER', key: 'Space',
    how: v.selfYou ? 'Tap Super (Space) when it reads READY' : 'Used when it is READY',
    flavor: s.description, lines: describeSuper(s, s.strength * levelBoost, v), cooldown: s.recharge, duration: s.duration,
    cost: 'no spin cost; runs for its full time, then recharges',
  };
}

// ------------------------------------------------------------------------------------------ status chips
export interface StatusChip { label: string; good: boolean; remaining: number }

/** What a status effect on a blade is called on screen: one chip per effect. */
export function chipFor(a: ActiveMod, now: number, _mine = true): StatusChip | null {
  const remaining = Math.max(0, a.until - now);
  if (a.source === 'arena' && a.kind) {
    const info = CRYSTAL_INFO[a.kind as CrystalKind];
    return { label: info ? info.name : a.kind === 'drop' ? 'Drop attack' : a.kind, good: true, remaining };
  }
  for (const f of a.flags) if (FLAG_TEXT[f]) return { label: FLAG_TEXT[f].chip, good: true, remaining };
  const m = a.mods;
  const get = (k: ModKey): number => m[k] ?? 1;
  // what it does to the blade decides what it is called, whoever put it there
  if (get('accel') < 0.2) return { label: 'Frozen', good: false, remaining };
  if (get('dmgTaken') < 1 && get('kbTaken') < 1) return { label: 'Armor', good: true, remaining };
  if (get('dmgTaken') < 1) return { label: 'Tough', good: true, remaining };
  if (get('kbTaken') < 1) return { label: 'Anchored', good: true, remaining };
  if (get('dmgDealt') > 1 || get('kbDealt') > 1) return { label: 'Power up', good: true, remaining };
  if (get('mass') > 1) return { label: 'Heavy', good: true, remaining };
  if (get('accel') > 1 || get('drag') < 1 || get('grip') < 1) return { label: 'Speed up', good: true, remaining };
  if (get('accel') < 1) return { label: 'Slowed', good: false, remaining };
  if (get('dmgTaken') > 1) return { label: 'Vulnerable', good: false, remaining };
  if (get('spinDecay') > 1) return { label: 'Draining', good: false, remaining };
  if (get('dmgDealt') < 1 || get('kbDealt') < 1) return { label: 'Weakened', good: false, remaining };
  return null;
}
