// Basic moves (3 per blade). All data: one shared ability system runs them (see combat/AbilitySystem.ts).
//
// Slot convention (it is what the controller buttons mean):
//   Move 1 — the attack. Chargeable: hold to charge (drains spin), release to fire. This is the PRD's
//            "press and hold to charge a burst meter, release to dash".
//   Move 2 — defensive / evasive, instant.
//   Move 3 — movement / stance, instant.

import type { AbilityDef, EffectDef } from './effects';
import type { BladeClass } from '../core/types';

export const ABILITIES: Record<string, AbilityDef> = {};

export function registerAbility(a: AbilityDef): AbilityDef {
  ABILITIES[a.id] = a;
  return a;
}
export function getAbility(id: string): AbilityDef {
  const a = ABILITIES[id];
  if (!a) throw new Error(`Unknown ability: ${id}`);
  return a;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------------------------------
// Ravok — Heavy Striker (Attack)
// ---------------------------------------------------------------------------------------------------
registerAbility({
  id: 'ravok.strike', name: 'Strike', type: 'ATTACK',
  description: 'Hold to charge, release to lunge. A heavy collision that hits harder the longer you charge.',
  cooldown: 1.5, duration: 0.7, force: 9, damage: 1.5, staminaCost: 1, movementModifier: 1,
  charge: { maxTime: 1.1, drainPerSec: 5, minCharge: 0.12 },
  effects: [
    { kind: 'dash', dir: 'heading', speed: 9.5, scaleByCharge: true },
    { kind: 'mod', duration: 0.8, mods: { dmgDealt: 1.55, kbDealt: 1.5 }, scaleByCharge: true, tag: 'strike' },
  ],
});
registerAbility({
  id: 'ravok.guard', name: 'Guard', type: 'DEFENSE',
  description: 'Brace for impact: a short window of reduced damage and knockback.',
  cooldown: 3.0, duration: 1.1, force: 0, damage: 0, staminaCost: 1, movementModifier: 1,
  effects: [{ kind: 'mod', duration: 1.1, mods: { dmgTaken: 0.55, kbTaken: 0.55 }, tag: 'guard' }],
});
registerAbility({
  id: 'ravok.dash', name: 'Dash', type: 'MOVEMENT',
  description: 'Directional burst along your current heading.',
  cooldown: 2.4, duration: 0.3, force: 11, damage: 0, staminaCost: 1.5, movementModifier: 1,
  effects: [{ kind: 'dash', dir: 'heading', speed: 11 }],
});

// ---------------------------------------------------------------------------------------------------
// Gravion — Heavy Tank (Defense)
// ---------------------------------------------------------------------------------------------------
registerAbility({
  id: 'gravion.bash', name: 'Bash', type: 'ATTACK',
  description: 'Hold to charge, release for a short shoulder-charge. Slow, but nothing pushes back.',
  cooldown: 1.8, duration: 0.7, force: 5.5, damage: 1.35, staminaCost: 1, movementModifier: 1,
  charge: { maxTime: 1.0, drainPerSec: 4, minCharge: 0.12 },
  effects: [
    { kind: 'dash', dir: 'heading', speed: 5.5, scaleByCharge: true },
    { kind: 'mod', duration: 0.8, mods: { dmgDealt: 1.4, kbDealt: 1.4 }, scaleByCharge: true, tag: 'bash' },
  ],
});
registerAbility({
  id: 'gravion.block', name: 'Block', type: 'DEFENSE',
  description: 'Raise the shell: heavy damage and knockback reduction for a moment.',
  cooldown: 3.5, duration: 1.2, force: 0, damage: 0, staminaCost: 1, movementModifier: 1,
  effects: [{ kind: 'mod', duration: 1.2, mods: { dmgTaken: 0.35, kbTaken: 0.4 }, tag: 'block' }],
});
registerAbility({
  id: 'gravion.brace', name: 'Brace', type: 'BUFF',
  description: 'Dig in. Much heavier and almost impossible to displace, but barely able to steer.',
  cooldown: 4.0, duration: 1.6, force: 0, damage: 0, staminaCost: 1, movementModifier: 0.55,
  effects: [{ kind: 'mod', duration: 1.6, mods: { mass: 1.6, accel: 0.55, external: 0.3, kbTaken: 0.6 }, tag: 'brace' }],
});

// ---------------------------------------------------------------------------------------------------
// Phantom — Evasive Spinner (Stamina)
// ---------------------------------------------------------------------------------------------------
registerAbility({
  id: 'phantom.spin-attack', name: 'Spin Attack', type: 'ATTACK',
  description: 'Hold to charge, release to whirl into them. Light on knockback, heavy on spin damage.',
  cooldown: 1.4, duration: 0.6, force: 8.5, damage: 1.6, staminaCost: 1, movementModifier: 1,
  charge: { maxTime: 0.9, drainPerSec: 4, minCharge: 0.12 },
  effects: [
    { kind: 'dash', dir: 'heading', speed: 8.5, scaleByCharge: true },
    { kind: 'mod', duration: 0.7, mods: { dmgDealt: 1.7, kbDealt: 1.05 }, scaleByCharge: true, tag: 'spin-attack' },
  ],
});
registerAbility({
  id: 'phantom.dodge', name: 'Dodge', type: 'MOVEMENT',
  description: 'A sidestep burst with a brief moment of invulnerability.',
  cooldown: 2.0, duration: 0.35, force: 8, damage: 0, staminaCost: 1, movementModifier: 1,
  effects: [
    { kind: 'mod', duration: 0.35, flags: ['invuln'], tag: 'dodge' },
    { kind: 'dash', dir: 'perp', speed: 8 },
  ],
});
registerAbility({
  id: 'phantom.drift', name: 'Drift', type: 'BUFF',
  description: 'Go slippery: much lower friction and sharper acceleration for a moment.',
  cooldown: 3.2, duration: 1.3, force: 0, damage: 0, staminaCost: 0.5, movementModifier: 1.5,
  effects: [{ kind: 'mod', duration: 1.3, mods: { grip: 0.25, accel: 1.5, drag: 0.5 }, tag: 'drift' }],
});

// ---------------------------------------------------------------------------------------------------
// The other eighteen blades. Same three slots, same effect primitives, but each blade's moves are tuned to
// how it is meant to play (spec §35: no two blades are simple skins of each other).
// ---------------------------------------------------------------------------------------------------
interface AtkOpts {
  cd: number; maxT: number; drain: number; speed: number; dmg: number; kb: number; desc: string;
  dir?: 'heading' | 'target'; extra?: EffectDef[]; min?: number;
}
/** Move 1: hold to charge, release to fire. */
function atk(bladeId: string, name: string, o: AtkOpts): void {
  registerAbility({
    id: `${bladeId}.${slug(name)}`, name, type: 'ATTACK', description: o.desc,
    cooldown: o.cd, duration: 0.7, force: o.speed, damage: o.dmg, staminaCost: 1, movementModifier: 1,
    charge: { maxTime: o.maxT, drainPerSec: o.drain, minCharge: o.min ?? 0.12 },
    effects: [
      { kind: 'dash', dir: o.dir ?? 'heading', speed: o.speed, scaleByCharge: true },
      { kind: 'mod', duration: 0.8, mods: { dmgDealt: o.dmg, kbDealt: o.kb }, scaleByCharge: true, tag: slug(name) },
      ...(o.extra ?? []),
    ],
  });
}
interface MvOpts { type: AbilityDef['type']; cd: number; desc: string; effects: EffectDef[]; cost?: number; duration?: number; mm?: number }
/** Moves 2 and 3: instant. */
function mv(bladeId: string, name: string, o: MvOpts): void {
  registerAbility({
    id: `${bladeId}.${slug(name)}`, name, type: o.type, description: o.desc,
    cooldown: o.cd, duration: o.duration ?? 1.1, force: 0, damage: 0, staminaCost: o.cost ?? 1, movementModifier: o.mm ?? 1, effects: o.effects,
  });
}
const invuln = (t: number, tag: string): EffectDef => ({ kind: 'mod', duration: t, flags: ['invuln'], tag });
const ghost = (t: number, tag: string): EffectDef => ({ kind: 'mod', duration: t, flags: ['ghost'], tag });
const drift = (t: number, tag: string, accel = 1.5): EffectDef => ({ kind: 'mod', duration: t, mods: { grip: 0.25, accel, drag: 0.5 }, tag });

// ------------------------------------------------------------------------------------------------ ATTACK
// Blazefang — speed creates impact: quick, lighter hits, lots of sidestepping
atk('blazefang', 'Fang Rush', { cd: 1.3, maxT: 0.9, drain: 4.5, speed: 10.5, dmg: 1.6, kb: 1.25, desc: 'Hold to charge, release for a blistering lunge. Fast and hot, a little light on knockback.' });
mv('blazefang', 'Flare Guard', { type: 'DEFENSE', cd: 2.8, duration: 1.0, desc: 'A short guard that flares outward and shoves close attackers back.', effects: [{ kind: 'mod', duration: 1.0, mods: { dmgTaken: 0.6, kbTaken: 0.6 }, tag: 'flare-guard' }, { kind: 'radial', radius: 2.6, impulse: 4, damage: 1.5 }] });
mv('blazefang', 'Side Burst', { type: 'MOVEMENT', cd: 2.0, duration: 0.3, desc: 'A hard sidestep burst: dodge in, then punish.', effects: [{ kind: 'dash', dir: 'perp', speed: 12 }] });
// Riftclaw — one perfect hit: aimed lunges, feints
atk('riftclaw', 'Claw Strike', { cd: 1.3, maxT: 0.7, drain: 4, speed: 9, dmg: 1.7, kb: 1.3, dir: 'target', desc: 'Hold to charge, release to lock on and strike. Quick to charge, aimed straight at the opponent.' });
mv('riftclaw', 'Feint', { type: 'MOVEMENT', cd: 2.4, duration: 0.3, desc: 'A fake-out: slip away from an incoming hit with a moment of invulnerability.', effects: [invuln(0.3, 'feint'), { kind: 'dash', dir: 'away', speed: 9 }] });
mv('riftclaw', 'Lunge', { type: 'MOVEMENT', cd: 2.6, duration: 0.3, desc: 'A long, straight burst at the opponent.', effects: [{ kind: 'dash', dir: 'target', speed: 13 }] });
// Volt Reaper — never stop moving
atk('volt-reaper', 'Volt Dash', { cd: 1.4, maxT: 0.8, drain: 4.5, speed: 11.5, dmg: 1.45, kb: 1.2, desc: 'Hold to charge, release for a very long dash.' });
mv('volt-reaper', 'Reaper Spin', { type: 'DEFENSE', cd: 3.0, duration: 1.0, desc: 'Spin up a ring of sparks: a small shockwave and a brief damage cut.', effects: [{ kind: 'radial', radius: 3, impulse: 5, damage: 3 }, { kind: 'mod', duration: 1.0, mods: { dmgTaken: 0.8 }, tag: 'reaper-spin' }] });
mv('volt-reaper', 'Arc Dodge', { type: 'MOVEMENT', cd: 2.0, duration: 0.3, desc: 'Arc sideways, untouchable for a blink.', effects: [invuln(0.3, 'arc-dodge'), { kind: 'dash', dir: 'perp', speed: 10 }] });
// Titan Breaker — weight is power: slow, huge, immovable while charging
atk('titan-breaker', 'Titan Bash', { cd: 1.9, maxT: 1.2, drain: 5, speed: 7, dmg: 1.8, kb: 1.8, desc: 'Hold to charge, release for the heaviest collision in the roster. Slow to wind up.' });
mv('titan-breaker', 'Heavy Guard', { type: 'DEFENSE', cd: 3.4, duration: 1.3, desc: 'Plant and take it: big damage and knockback reduction.', effects: [{ kind: 'mod', duration: 1.3, mods: { dmgTaken: 0.4, kbTaken: 0.35 }, tag: 'heavy-guard' }] });
mv('titan-breaker', 'Ground Charge', { type: 'MOVEMENT', cd: 3.0, duration: 0.8, desc: 'Barrel forward, heavier for a moment, shaking the floor where you land.', effects: [{ kind: 'dash', dir: 'heading', speed: 8 }, { kind: 'mod', duration: 0.8, mods: { mass: 1.5 }, tag: 'ground-charge' }, { kind: 'radial', radius: 3, impulse: 4, damage: 2 }] });
// Inferno X — constant pressure: leaves fire behind
atk('inferno-x', 'Burn Strike', { cd: 1.45, maxT: 1.0, drain: 4.5, speed: 9, dmg: 1.5, kb: 1.3, desc: 'Hold to charge, release to strike and leave a patch of fire.', extra: [{ kind: 'zone', zone: 'trap', radius: 2, duration: 2.5, strength: 3, damage: 3, at: 'self' }] });
mv('inferno-x', 'Heat Guard', { type: 'DEFENSE', cd: 3.0, duration: 1.1, desc: 'Brace behind a wall of heat that scorches anything close.', effects: [{ kind: 'mod', duration: 1.1, mods: { dmgTaken: 0.6, kbTaken: 0.6 }, tag: 'heat-guard' }, { kind: 'radial', radius: 2.8, impulse: 3.5, damage: 2 }] });
mv('inferno-x', 'Flame Dash', { type: 'MOVEMENT', cd: 2.4, duration: 0.3, desc: 'Dash forward, burning a trail where you started.', effects: [{ kind: 'zone', zone: 'trap', radius: 2, duration: 2.5, strength: 3, damage: 3, at: 'self' }, { kind: 'dash', dir: 'heading', speed: 11 }] });
// Stormfang — the more you hit, the stronger you become
atk('stormfang', 'Fang Combo', { cd: 1.35, maxT: 0.9, drain: 4.5, speed: 9.5, dmg: 1.4, kb: 1.25, desc: 'Hold to charge, release to strike. Every hit in a row makes the next one hit harder.', extra: [{ kind: 'mod', duration: 3, mods: { dmgDealt: 1.1 }, tag: 'combo', stack: 3 }] });
mv('stormfang', 'Storm Dash', { type: 'MOVEMENT', cd: 2.2, duration: 1.0, desc: 'A dash that leaves you quicker for a second.', effects: [{ kind: 'dash', dir: 'heading', speed: 12 }, { kind: 'mod', duration: 1.0, mods: { accel: 1.3 }, tag: 'storm-dash' }] });
mv('stormfang', 'Whiplash', { type: 'MOVEMENT', cd: 2.6, duration: 0.3, desc: 'Whip round the side with a small shockwave.', effects: [{ kind: 'dash', dir: 'perp', speed: 9 }, { kind: 'radial', radius: 3, impulse: 4, damage: 2 }] });

// ----------------------------------------------------------------------------------------------- DEFENSE
// Iron Warden — attack me, I dare you: counters
atk('iron-warden', 'Guard Bash', { cd: 1.7, maxT: 1.0, drain: 4, speed: 6, dmg: 1.4, kb: 1.4, desc: 'Hold to charge, release for a shoulder-charge from behind the shield.', extra: [{ kind: 'mod', duration: 0.8, mods: { dmgTaken: 0.7 }, tag: 'guard-bash-cover' }] });
mv('iron-warden', 'Counter', { type: 'DEFENSE', cd: 3.4, duration: 1.2, desc: 'Take the hit and throw the damage back at whoever made it.', effects: [{ kind: 'mod', duration: 1.2, mods: { dmgTaken: 0.55, kbTaken: 0.5 }, flags: ['reflectDamage'], tag: 'counter' }] });
mv('iron-warden', 'Brace', { type: 'BUFF', cd: 4.0, duration: 1.6, mm: 0.55, desc: 'Dig in: much heavier and almost impossible to displace, but barely able to steer.', effects: [{ kind: 'mod', duration: 1.6, mods: { mass: 1.6, accel: 0.55, external: 0.3, kbTaken: 0.6 }, tag: 'brace' }] });
// Bastion X — you cannot push me out
atk('bastion-x', 'Wall Bash', { cd: 2.0, maxT: 1.0, drain: 4, speed: 5, dmg: 1.3, kb: 1.4, desc: 'Hold to charge, release to lean the whole wall into them. Slow, and nothing pushes back.' });
mv('bastion-x', 'Fortify', { type: 'DEFENSE', cd: 4.0, duration: 1.4, desc: 'Raise the walls: the heaviest damage and knockback cut of any basic move.', effects: [{ kind: 'mod', duration: 1.4, mods: { dmgTaken: 0.3, kbTaken: 0.35 }, tag: 'fortify' }] });
mv('bastion-x', 'Brace', { type: 'BUFF', cd: 4.0, duration: 1.8, mm: 0.5, desc: 'Sink in: far heavier, nearly unmovable, barely steerable.', effects: [{ kind: 'mod', duration: 1.8, mods: { mass: 1.8, accel: 0.5, external: 0.25, kbTaken: 0.5 }, tag: 'brace' }] });
// Stonecore — become the arena
atk('stonecore', 'Stone Bash', { cd: 2.0, maxT: 1.1, drain: 4, speed: 5, dmg: 1.35, kb: 1.45, desc: 'Hold to charge, release for a slow, crushing shove.' });
mv('stonecore', 'Root', { type: 'BUFF', cd: 4.5, duration: 2.0, mm: 0.25, desc: 'Put down roots: enormous weight and almost no steering for two seconds.', effects: [{ kind: 'mod', duration: 2.0, mods: { mass: 2.2, accel: 0.25, external: 0.1, kbTaken: 0.4 }, tag: 'root' }] });
mv('stonecore', 'Center Hold', { type: 'BUFF', cd: 5.0, duration: 2.0, desc: 'A gravity field round you that drags the opponent close and slows them.', effects: [{ kind: 'zone', zone: 'well', radius: 4, duration: 2, strength: 4, damage: 0, at: 'self', follow: true }] });
// Aegiron — turn defence into power
atk('aegiron', 'Energy Bash', { cd: 1.6, maxT: 1.0, drain: 4.5, speed: 6.5, dmg: 1.45, kb: 1.35, desc: 'Hold to charge, release for an energised shoulder-charge.' });
mv('aegiron', 'Shield', { type: 'DEFENSE', cd: 5.0, duration: 2.0, desc: 'A one-hit energy shield: the next hit does nothing.', effects: [{ kind: 'shield', hits: 1, duration: 2 }] });
mv('aegiron', 'Pulse Guard', { type: 'DEFENSE', cd: 3.2, duration: 1.0, desc: 'Guard that pulses outward and shoves attackers away.', effects: [{ kind: 'mod', duration: 1.0, mods: { dmgTaken: 0.6, kbTaken: 0.6 }, tag: 'pulse-guard' }, { kind: 'radial', radius: 3, impulse: 5, damage: 2 }] });
// Guardian Prime — ready for anything
atk('guardian-prime', 'Prime Bash', { cd: 1.7, maxT: 1.0, drain: 4, speed: 6, dmg: 1.4, kb: 1.4, desc: 'Hold to charge, release for a solid, reliable shove.' });
mv('guardian-prime', 'Guard', { type: 'DEFENSE', cd: 3.0, duration: 1.1, desc: 'A balanced guard: good damage and knockback reduction.', effects: [{ kind: 'mod', duration: 1.1, mods: { dmgTaken: 0.5, kbTaken: 0.5 }, tag: 'guard' }] });
mv('guardian-prime', 'Recover', { type: 'BUFF', cd: 6.0, duration: 1.2, mm: 0.6, desc: 'Catch your breath: win back a little spin, slower while you do.', effects: [{ kind: 'spin', amount: 4 }, { kind: 'mod', duration: 1.2, mods: { accel: 0.6 }, tag: 'recover' }] });
// Gravity Rex — control where the fight happens
atk('gravity-rex', 'Gravity Bash', { cd: 1.8, maxT: 1.0, drain: 4, speed: 6, dmg: 1.4, kb: 1.4, desc: 'Hold to charge, release for a heavy shove with a small shockwave.', extra: [{ kind: 'radial', radius: 2.5, impulse: 3, damage: 0 }] });
mv('gravity-rex', 'Pull', { type: 'CONTROL', cd: 5.0, duration: 1.5, desc: 'Drag the opponent towards you for a moment.', effects: [{ kind: 'pull', radius: 9, strength: 6, duration: 1.5 }] });
mv('gravity-rex', 'Center Lock', { type: 'BUFF', cd: 5.0, duration: 2.0, mm: 0.7, desc: 'Lock down your spot: heavier, with a field that slows anything near.', effects: [{ kind: 'mod', duration: 2, mods: { mass: 1.4, accel: 0.7 }, tag: 'center-lock' }, { kind: 'zone', zone: 'slow', radius: 3.5, duration: 2, strength: 0, damage: 0, at: 'self', follow: true }] });

// ----------------------------------------------------------------------------------------------- STAMINA
// Voidrunner — catch me if you can
atk('voidrunner', 'Void Dash', { cd: 1.3, maxT: 0.8, drain: 3.5, speed: 10, dmg: 1.5, kb: 1.0, desc: 'Hold to charge, release for a long, cheap dash. Light on knockback.' });
mv('voidrunner', 'Slipstream', { type: 'MOVEMENT', cd: 2.2, duration: 1.0, desc: 'Slip sideways untouchable, and keep the speed for a second.', effects: [invuln(0.25, 'slipstream-i'), { kind: 'dash', dir: 'perp', speed: 9 }, { kind: 'mod', duration: 1.0, mods: { accel: 1.5 }, tag: 'slipstream' }] });
mv('voidrunner', 'Drift', { type: 'BUFF', cd: 3.2, duration: 1.3, mm: 1.5, desc: 'Go slippery: much lower friction and sharper acceleration.', effects: [drift(1.3, 'drift')] });
// Nightveil — disappear, reposition, strike
atk('nightveil', 'Veil Strike', { cd: 1.4, maxT: 0.8, drain: 4, speed: 8.5, dmg: 1.7, kb: 1.05, desc: 'Hold to charge, release to strike out of a brief fade.', extra: [{ kind: 'mod', duration: 0.8, flags: ['stealth'], tag: 'veil' }] });
mv('nightveil', 'Fade', { type: 'MOVEMENT', cd: 3.0, duration: 0.6, desc: 'Slip through other blades for a heartbeat while you sidestep.', effects: [ghost(0.6, 'fade'), { kind: 'dash', dir: 'perp', speed: 7 }] });
mv('nightveil', 'Shadow Drift', { type: 'BUFF', cd: 3.4, duration: 1.3, mm: 1.4, desc: 'Drift away half-hidden: slippery, quick, and hard to track.', effects: [drift(1.3, 'shadow-drift', 1.4), { kind: 'mod', duration: 0.9, flags: ['stealth'], tag: 'shadow-stealth' }] });
// Spectra — make the opponent attack the wrong blade
atk('spectra', 'Mirror Spin', { cd: 1.4, maxT: 0.8, drain: 4, speed: 8, dmg: 1.6, kb: 1.05, desc: 'Hold to charge, release to strike and leave a mirror image where you were.', extra: [{ kind: 'decoy', duration: 1.5 }] });
mv('spectra', 'Fake Dash', { type: 'MOVEMENT', cd: 2.4, duration: 1.5, desc: 'Dash one way while a copy of you drifts the other.', effects: [{ kind: 'decoy', duration: 1.5 }, { kind: 'dash', dir: 'perp', speed: 8 }] });
mv('spectra', 'Prism Drift', { type: 'BUFF', cd: 3.2, duration: 1.3, mm: 1.5, desc: 'Go slippery with a sharper turn.', effects: [drift(1.3, 'prism-drift')] });
// Ghost Viper — let them attack first
atk('ghost-viper', 'Viper Strike', { cd: 1.3, maxT: 0.8, drain: 4, speed: 9.5, dmg: 1.8, kb: 1.1, desc: 'Hold to charge, release for a fast, venomous strike.' });
mv('ghost-viper', 'Dodge', { type: 'MOVEMENT', cd: 2.0, duration: 0.35, desc: 'A sidestep burst with a brief moment of invulnerability.', effects: [invuln(0.35, 'dodge'), { kind: 'dash', dir: 'perp', speed: 8 }] });
mv('ghost-viper', 'Counter Spin', { type: 'DEFENSE', cd: 3.0, duration: 1.0, desc: 'Ride a hit and send some of the damage back.', effects: [{ kind: 'mod', duration: 1.0, mods: { dmgTaken: 0.8 }, flags: ['reflectDamage'], tag: 'counter-spin' }] });
// Chrono — control the pace
atk('chrono', 'Chrono Spin', { cd: 1.4, maxT: 0.9, drain: 4, speed: 8, dmg: 1.5, kb: 1.05, desc: 'Hold to charge, release to strike and slow them for a moment.', extra: [{ kind: 'mod', target: 'opponent', duration: 1.0, mods: { accel: 0.85 }, tag: 'chrono-slow' }] });
mv('chrono', 'Slow Drift', { type: 'CONTROL', cd: 4.0, duration: 1.6, desc: 'Bend time round the opponent: they steer and brake like it is syrup.', effects: [{ kind: 'mod', target: 'opponent', duration: 1.6, mods: { accel: 0.6, drag: 1.4 }, tag: 'slow-drift' }] });
mv('chrono', 'Time Dash', { type: 'MOVEMENT', cd: 2.4, duration: 0.3, desc: 'A burst that skips a moment of time: a dash with a blink of invulnerability.', effects: [invuln(0.2, 'time-dash'), { kind: 'dash', dir: 'heading', speed: 11 }] });
// Nebula Drift — the longer the fight, the stronger I become
atk('nebula-drift', 'Nebula Spin', { cd: 1.4, maxT: 0.9, drain: 3.5, speed: 8, dmg: 1.45, kb: 1.0, desc: 'Hold to charge, release for a gentle, spin-saving strike.' });
mv('nebula-drift', 'Orbit', { type: 'MOVEMENT', cd: 2.2, duration: 1.5, desc: 'Circle round the opponent while your spin burns slower.', effects: [{ kind: 'dash', dir: 'perp', speed: 8 }, { kind: 'mod', duration: 1.5, mods: { spinDecay: 0.6 }, tag: 'orbit' }] });
mv('nebula-drift', 'Drift Guard', { type: 'BUFF', cd: 3.5, duration: 1.3, mm: 1.2, desc: 'Drift away behind a soft guard.', effects: [{ kind: 'mod', duration: 1.3, mods: { dmgTaken: 0.65, grip: 0.3, accel: 1.2, drag: 0.6 }, tag: 'drift-guard' }] });

// ---------------------------------------------------------------------------------------------------
// Generic moves: every other blade gets the same three slot templates, tuned by class. This is what
// makes "add a blade = add data": a new roster entry plays on day one; its Supers come later.
// ---------------------------------------------------------------------------------------------------
export function makeGenericMoves(bladeId: string, cls: BladeClass, names: [string, string, string]): [string, string, string] {
  const p = (n: string) => `${bladeId}.${slug(n)}`;
  // a blade with authored moves keeps them
  if (names.every((n) => ABILITIES[p(n)])) return [p(names[0]), p(names[1]), p(names[2])];
  const [n1, n2, n3] = names;
  const heavy = cls === 'DEFENSE';
  const light = cls === 'STAMINA';
  registerAbility({
    id: p(n1), name: n1, type: 'ATTACK',
    description: 'Hold to charge, release to fire.',
    cooldown: heavy ? 1.8 : 1.45, duration: 0.7, force: heavy ? 5.5 : light ? 8.5 : 9.5, damage: 1.5, staminaCost: 1, movementModifier: 1,
    charge: { maxTime: light ? 0.9 : 1.05, drainPerSec: heavy ? 4 : 5, minCharge: 0.12 },
    effects: [
      { kind: 'dash', dir: 'heading', speed: heavy ? 5.5 : light ? 8.5 : 9.5, scaleByCharge: true },
      { kind: 'mod', duration: 0.8, mods: light ? { dmgDealt: 1.7, kbDealt: 1.05 } : { dmgDealt: 1.5, kbDealt: 1.45 }, scaleByCharge: true, tag: slug(n1) },
    ],
  });
  registerAbility({
    id: p(n2), name: n2, type: light ? 'MOVEMENT' : 'DEFENSE',
    description: light ? 'A sidestep burst with a brief moment of invulnerability.' : 'A short window of reduced damage and knockback.',
    cooldown: light ? 2.0 : 3.2, duration: 1.1, force: light ? 8 : 0, damage: 0, staminaCost: 1, movementModifier: 1,
    effects: light
      ? [{ kind: 'mod', duration: 0.35, flags: ['invuln'], tag: slug(n2) }, { kind: 'dash', dir: 'perp', speed: 8 }]
      : [{ kind: 'mod', duration: heavy ? 1.2 : 1.1, mods: heavy ? { dmgTaken: 0.35, kbTaken: 0.4 } : { dmgTaken: 0.55, kbTaken: 0.55 }, tag: slug(n2) }],
  });
  registerAbility({
    id: p(n3), name: n3, type: heavy ? 'BUFF' : light ? 'BUFF' : 'MOVEMENT',
    description: heavy ? 'Dig in: heavier and harder to move, slower to steer.' : light ? 'Go slippery for a moment.' : 'Directional burst.',
    cooldown: heavy ? 4 : light ? 3.2 : 2.4, duration: 1.4, force: heavy || light ? 0 : 11, damage: 0, staminaCost: 1, movementModifier: 1,
    effects: heavy
      ? [{ kind: 'mod', duration: 1.6, mods: { mass: 1.6, accel: 0.55, external: 0.3, kbTaken: 0.6 }, tag: slug(n3) }]
      : light
        ? [{ kind: 'mod', duration: 1.3, mods: { grip: 0.25, accel: 1.5, drag: 0.5 }, tag: slug(n3) }]
        : [{ kind: 'dash', dir: 'heading', speed: 11 }],
  });
  return [p(n1), p(n2), p(n3)];
}
