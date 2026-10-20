// Super Powers. Each Super is a timeline of reusable effects (see effects.ts). Every Super runs
// 6–8 s (never above 8), then recharges for 10 s. Strength grows slightly with blade level.
//
// Implemented now: the full pools for the three MVP blades (Ravok, Gravion, Phantom). Every other
// blade's pool exists in data as `implemented: false` so the roster, UI and unlock tables are complete.

import type { SuperDef, TimedEffect } from './effects';
import { SUPER_MAX_DURATION, SUPER_RECHARGE } from './effects';

export const SUPERS: Record<string, SuperDef> = {};

export function slugify(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function def(d: Omit<SuperDef, 'recharge' | 'strength' | 'implemented'> & Partial<Pick<SuperDef, 'recharge' | 'strength'>>): SuperDef {
  if (d.duration > SUPER_MAX_DURATION) throw new Error(`Super ${d.id} exceeds the ${SUPER_MAX_DURATION}s cap`);
  const s: SuperDef = { recharge: SUPER_RECHARGE, strength: 1, implemented: true, ...d };
  SUPERS[s.id] = s;
  return s;
}
const start = (effect: TimedEffect['effect']): TimedEffect => ({ at: 'start', effect });
const every = (interval: number, effect: TimedEffect['effect']): TimedEffect => ({ at: 'every', interval, effect });
const onHit = (interval: number, effect: TimedEffect['effect']): TimedEffect => ({ at: 'onHit', interval, effect });
const onHurt = (interval: number, effect: TimedEffect['effect']): TimedEffect => ({ at: 'onHurt', interval, effect });
const atEnd = (effect: TimedEffect['effect']): TimedEffect => ({ at: 'end', effect });

// ------------------------------------------------------------------------------------------ RAVOK
def({
  id: 'ravok.dash-strike', name: 'Dash Strike', bladeId: 'ravok', unlockLevel: 1, duration: 6, fx: 'trail',
  description: 'Rocket at the opponent, then keep lunging at them: high-speed targeted collisions.',
  requiredStats: { agility: 6 },
  effects: [
    start({ kind: 'dash', dir: 'target', speed: 15 }),
    start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.3, kbDealt: 1.35 } }),
    every(1.8, { kind: 'dash', dir: 'target', speed: 9 }),
  ],
});
def({
  id: 'ravok.shockwave', name: 'Shockwave', bladeId: 'ravok', unlockLevel: 2, duration: 6, fx: 'burst',
  description: 'Every hit sends out a radial shockwave that throws the opponent back.',
  effects: [
    start({ kind: 'radial', radius: 4.2, impulse: 9, damage: 5 }),
    onHit(0.9, { kind: 'radial', radius: 3.8, impulse: 7, damage: 4 }),
  ],
});
def({
  id: 'ravok.magnet-pull', name: 'Magnet Pull', bladeId: 'ravok', unlockLevel: 3, duration: 6, fx: 'aura',
  description: 'Drag the opponent into attack range, then hit them while they cannot get away.',
  effects: [
    start({ kind: 'pull', radius: 15, strength: 7, duration: 3.5 }),
    start({ kind: 'mod', duration: 6, mods: { kbDealt: 1.2 } }),
  ],
});
def({
  id: 'ravok.rage-mode', name: 'Rage Mode', bladeId: 'ravok', unlockLevel: 4, duration: 8, fx: 'aura',
  description: 'Attack climbs as your spin falls. The weaker you get, the harder you hit.',
  requiredStats: { attack: 8 },
  effects: [start({ kind: 'mod', duration: 8, mods: { dmgDealt: 1.1, spinDecay: 1.1 }, spinLoss: { dmgDealt: 1.9, kbDealt: 1.6 } })],
});
def({
  id: 'ravok.blade-trap', name: 'Blade Trap', bladeId: 'ravok', unlockLevel: 5, duration: 7, fx: 'zone',
  description: 'Lay impact zones as you move. Anything that crosses one is hit.',
  effects: [
    start({ kind: 'zone', zone: 'trap', radius: 2.4, duration: 4.5, strength: 8, damage: 7, at: 'self' }),
    every(2.5, { kind: 'zone', zone: 'trap', radius: 2.4, duration: 4.5, strength: 8, damage: 7, at: 'self' }),
  ],
});
def({
  id: 'ravok.overdrive', name: 'Overdrive', bladeId: 'ravok', unlockLevel: 6, duration: 7, fx: 'trail',
  description: 'Faster and harder-hitting, but your spin drains almost twice as fast.',
  requiredStats: { agility: 6 },
  effects: [start({ kind: 'mod', duration: 7, mods: { accel: 1.35, dmgDealt: 1.25, kbDealt: 1.2, spinDecay: 1.8 } })],
});
def({
  id: 'ravok.meteor-crash', name: 'Meteor Crash', bladeId: 'ravok', unlockLevel: 7, duration: 7, fx: 'burst', ultimate: true,
  description: 'Leap, vanish, and come down on the opponent with a crater-making slam.',
  requiredStats: { weight: 7 },
  effects: [
    start({ kind: 'slam', delay: 0.85, radius: 5.2, impulse: 17, damage: 22 }),
    start({ kind: 'mod', duration: 7, mods: { kbDealt: 1.2, dmgDealt: 1.2 } }),
  ],
});

// ---------------------------------------------------------------------------------------------- GRAVION
def({
  id: 'gravion.anchor', name: 'Anchor', bladeId: 'gravion', unlockLevel: 1, duration: 7, fx: 'shield',
  description: 'Become almost immovable. Nothing in the arena can push you off your spot.',
  requiredStats: { stability: 9 },
  effects: [start({ kind: 'mod', duration: 7, mods: { mass: 2.6, accel: 0.4, external: 0.15, kbTaken: 0.25, drag: 1.4 } })],
});
def({
  id: 'gravion.rebound', name: 'Rebound', bladeId: 'gravion', unlockLevel: 2, duration: 7, fx: 'shield',
  description: 'Knockback you take is thrown back at whoever hit you.',
  effects: [start({ kind: 'mod', duration: 7, mods: { kbTaken: 0.55 }, flags: ['reflectKnockback'] })],
});
def({
  id: 'gravion.fortress', name: 'Fortress', bladeId: 'gravion', unlockLevel: 3, duration: 8, fx: 'shield',
  description: 'Heavy damage and knockback reduction. You can still move, slowly.',
  requiredStats: { defense: 8 },
  effects: [start({ kind: 'mod', duration: 8, mods: { dmgTaken: 0.3, kbTaken: 0.3, accel: 0.65 } })],
});
def({
  id: 'gravion.gravity-well', name: 'Gravity Well', bladeId: 'gravion', unlockLevel: 4, duration: 7, fx: 'zone',
  description: 'A field around you drags the opponent in and slows them down.',
  effects: [start({ kind: 'zone', zone: 'well', radius: 6.5, duration: 7, strength: 6, damage: 0, at: 'self', follow: true })],
});
def({
  id: 'gravion.reflect', name: 'Reflect', bladeId: 'gravion', unlockLevel: 5, duration: 6, fx: 'shield',
  description: 'Spin damage you take is also dealt to the attacker.',
  effects: [start({ kind: 'mod', duration: 6, mods: { dmgTaken: 0.6 }, flags: ['reflectDamage'] })],
});
def({
  id: 'gravion.last-stand', name: 'Last Stand', bladeId: 'gravion', unlockLevel: 6, duration: 8, fx: 'aura',
  description: 'As your spin runs low you hit harder and take far less. Refuse to fall.',
  requiredStats: { stamina: 6 },
  effects: [start({ kind: 'mod', duration: 8, mods: { spinDecay: 0.75 }, spinLoss: { dmgDealt: 1.6, kbDealt: 1.4, dmgTaken: 0.55 } })],
});
def({
  id: 'gravion.iron-dome', name: 'Iron Dome', bladeId: 'gravion', unlockLevel: 7, duration: 8, fx: 'shield', ultimate: true,
  description: 'A barrier absorbs the next three hits completely.',
  effects: [
    start({ kind: 'shield', hits: 3, duration: 8 }),
    start({ kind: 'mod', duration: 8, mods: { external: 0.3 } }),
  ],
});

// ---------------------------------------------------------------------------------------------- PHANTOM
def({
  id: 'phantom.hide-and-seek', name: 'Hide & Seek', bladeId: 'phantom', unlockLevel: 1, duration: 6, fx: 'trail',
  description: 'Fade from sight. Your next hit is an ambush for bonus damage.',
  effects: [start({ kind: 'mod', duration: 6, mods: { accel: 1.2 }, flags: ['stealth', 'ambush'] })],
});
def({
  id: 'phantom.phase-shift', name: 'Phase Shift', bladeId: 'phantom', unlockLevel: 2, duration: 6, fx: 'trail',
  description: 'Pass through other blades for a few seconds and move faster.',
  requiredStats: { agility: 9 },
  effects: [
    start({ kind: 'mod', duration: 2.5, flags: ['ghost'] }),
    start({ kind: 'mod', duration: 6, mods: { accel: 1.4 } }),
  ],
});
def({
  id: 'phantom.decoy', name: 'Decoy', bladeId: 'phantom', unlockLevel: 3, duration: 6, fx: 'trail',
  description: 'Leave a ghost copy behind that the opponent will chase.',
  effects: [start({ kind: 'decoy', duration: 6 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.2 } })],
});
def({
  id: 'phantom.spin-burst', name: 'Spin Burst', bladeId: 'phantom', unlockLevel: 3, duration: 6, fx: 'burst',
  description: 'Recover some spin right now, then burn it half as fast.',
  requiredStats: { stamina: 9 },
  effects: [start({ kind: 'spin', amount: 14 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.4, spinDecay: 0.5 } })],
});
def({
  id: 'phantom.time-slow', name: 'Time Slow', bladeId: 'phantom', unlockLevel: 4, duration: 6, fx: 'aura',
  description: 'The opponent moves through syrup while you do not.',
  effects: [start({ kind: 'mod', target: 'opponent', duration: 6, mods: { accel: 0.45, drag: 1.6 } })],
});
def({
  id: 'phantom.spin-drain', name: 'Spin Drain', bladeId: 'phantom', unlockLevel: 5, duration: 7, fx: 'aura',
  description: 'Stay close and siphon the opponent’s spin into your own.',
  effects: [start({ kind: 'drain', radius: 5, rate: 5.5, duration: 7 })],
});
def({
  id: 'phantom.teleport-strike', name: 'Teleport Strike', bladeId: 'phantom', unlockLevel: 6, duration: 6, fx: 'burst',
  description: 'Vanish and reappear behind the opponent with a strike.',
  effects: [
    start({ kind: 'teleport', to: 'behindTarget', distance: 3.2 }),
    start({ kind: 'dash', dir: 'target', speed: 14 }),
    start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.35, kbDealt: 1.2 } }),
  ],
});
def({
  id: 'phantom.black-hole', name: 'Black Hole', bladeId: 'phantom', unlockLevel: 7, duration: 8, fx: 'zone', ultimate: true,
  description: 'Open a singularity on the opponent that pulls them in and drains their spin.',
  effects: [start({ kind: 'zone', zone: 'blackhole', radius: 6.5, duration: 8, strength: 8, damage: 0, at: 'target' })],
});

// ====================================================================================== the other 18 blades
// Each Super is a timeline of the same primitives as the three above. Unlock levels follow the roster rule
// (first at 1, the ultimate at 7); a few need a stat the stock build lacks, so a part choice decides them.

// -------------------------------------------------------------------------------------------- BLAZEFANG
def({ id: 'blazefang.inferno-rush', name: 'Inferno Rush', bladeId: 'blazefang', unlockLevel: 1, duration: 6, fx: 'trail',
  description: 'Rocket at the opponent in a trail of fire, quicker and harder-hitting for the whole Super.',
  effects: [start({ kind: 'dash', dir: 'target', speed: 14 }), start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.25, kbDealt: 1.2, accel: 1.3 } })] });
def({ id: 'blazefang.flame-trail', name: 'Flame Trail', bladeId: 'blazefang', unlockLevel: 3, duration: 7, fx: 'zone',
  description: 'Burn a trail of fire patches as you move. Anything that crosses one is scorched.',
  effects: [start({ kind: 'zone', zone: 'trap', radius: 2.1, duration: 3.5, strength: 6, damage: 6, at: 'self' }), every(1.3, { kind: 'zone', zone: 'trap', radius: 2.1, duration: 3.5, strength: 6, damage: 6, at: 'self' }), start({ kind: 'mod', duration: 7, mods: { accel: 1.25 } })] });
def({ id: 'blazefang.burnout', name: 'Burnout', bladeId: 'blazefang', unlockLevel: 4, duration: 7, fx: 'aura', requiredStats: { agility: 8 },
  description: 'Hit far harder and move far faster, while your spin burns twice as fast.',
  effects: [start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.45, kbDealt: 1.3, accel: 1.4, spinDecay: 2.0 } })] });
def({ id: 'blazefang.fang-storm', name: 'Fang Storm', bladeId: 'blazefang', unlockLevel: 6, duration: 7, fx: 'burst',
  description: 'A storm of lunges: dash at them again and again, with a shockwave on every hit.',
  effects: [start({ kind: 'dash', dir: 'target', speed: 10 }), every(1.2, { kind: 'dash', dir: 'target', speed: 10 }), onHit(0.9, { kind: 'radial', radius: 3, impulse: 5, damage: 3 }), start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.2 } })] });
def({ id: 'blazefang.inferno-crash', name: 'Inferno Crash', bladeId: 'blazefang', unlockLevel: 7, duration: 7, fx: 'burst', ultimate: true,
  description: 'Leap and crash down on the opponent in a burst of fire, which erupts again when the Super ends.',
  effects: [start({ kind: 'slam', delay: 0.7, radius: 4.8, impulse: 15, damage: 18 }), start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.3 } }), atEnd({ kind: 'radial', radius: 5, impulse: 9, damage: 6 })] });

// -------------------------------------------------------------------------------------------- RIFTCLAW
def({ id: 'riftclaw.critical-strike', name: 'Critical Strike', bladeId: 'riftclaw', unlockLevel: 1, duration: 6, fx: 'aura',
  description: 'Line up the perfect hit: lunge in, and your next hit lands for bonus damage.',
  effects: [start({ kind: 'dash', dir: 'target', speed: 8 }), start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.15 }, flags: ['ambush'] })] });
def({ id: 'riftclaw.rift-dash', name: 'Rift Dash', bladeId: 'riftclaw', unlockLevel: 3, duration: 6, fx: 'burst',
  description: 'Tear a rift and come out behind the opponent, already lunging.',
  effects: [start({ kind: 'teleport', to: 'behindTarget', distance: 3 }), start({ kind: 'dash', dir: 'target', speed: 9 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.2 } })] });
def({ id: 'riftclaw.mark-target', name: 'Mark Target', bladeId: 'riftclaw', unlockLevel: 4, duration: 7, fx: 'aura',
  description: 'Mark the opponent: they take extra damage and knockback from everything for the whole Super.',
  effects: [start({ kind: 'mod', target: 'opponent', duration: 7, mods: { dmgTaken: 1.4, kbTaken: 1.25 }, tag: 'marked' }), start({ kind: 'mod', duration: 7, mods: { accel: 1.15 } })] });
def({ id: 'riftclaw.execution', name: 'Execution', bladeId: 'riftclaw', unlockLevel: 6, duration: 6, fx: 'burst', requiredStats: { attack: 8 },
  description: 'A single killing lunge: dash straight in with a heavily boosted, ambushing hit.',
  effects: [start({ kind: 'dash', dir: 'target', speed: 14 }), start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.5, kbDealt: 1.2 }, flags: ['ambush'] })] });
def({ id: 'riftclaw.rift-breaker', name: 'Rift Breaker', bladeId: 'riftclaw', unlockLevel: 7, duration: 7, fx: 'burst', ultimate: true,
  description: 'Step through a rift behind the opponent and bring the sky down on them.',
  effects: [start({ kind: 'teleport', to: 'behindTarget', distance: 3.2 }), start({ kind: 'slam', delay: 0.5, radius: 4.2, impulse: 14, damage: 20 }), start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.25, kbDealt: 1.2 } })] });

// -------------------------------------------------------------------------------------------- VOLT REAPER
def({ id: 'volt-reaper.overcharge', name: 'Overcharge', bladeId: 'volt-reaper', unlockLevel: 1, duration: 6, fx: 'aura',
  description: 'Overload the core: much faster and harder-hitting, at the price of faster spin loss.',
  effects: [start({ kind: 'mod', duration: 6, mods: { accel: 1.45, dmgDealt: 1.2, kbDealt: 1.15, spinDecay: 1.5 } })] });
def({ id: 'volt-reaper.chain-strike', name: 'Chain Strike', bladeId: 'volt-reaper', unlockLevel: 3, duration: 7, fx: 'trail',
  description: 'Chain lunges at the opponent, one after another.',
  effects: [start({ kind: 'dash', dir: 'target', speed: 11 }), every(1.1, { kind: 'dash', dir: 'target', speed: 11 }), start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.2 } })] });
def({ id: 'volt-reaper.electric-field', name: 'Electric Field', bladeId: 'volt-reaper', unlockLevel: 4, duration: 7, fx: 'zone',
  description: 'A crackling field round you that shocks anything that stays inside.',
  effects: [start({ kind: 'zone', zone: 'trap', radius: 3.2, duration: 7, strength: 5, damage: 5, at: 'self', follow: true }), start({ kind: 'mod', duration: 7, mods: { accel: 1.15 } })] });
def({ id: 'volt-reaper.flash-step', name: 'Flash Step', bladeId: 'volt-reaper', unlockLevel: 6, duration: 6, fx: 'burst', requiredStats: { agility: 9 },
  description: 'Blink behind the opponent, untouchable for an instant, and strike.',
  effects: [start({ kind: 'teleport', to: 'behindTarget', distance: 3 }), start({ kind: 'mod', duration: 0.4, flags: ['invuln'], tag: 'flash' }), start({ kind: 'dash', dir: 'target', speed: 12 }), start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.3 } })] });
def({ id: 'volt-reaper.volt-storm', name: 'Volt Storm', bladeId: 'volt-reaper', unlockLevel: 7, duration: 8, fx: 'burst', ultimate: true,
  description: 'A storm round you: shockwaves every second, a live field, and a lot of speed.',
  effects: [start({ kind: 'zone', zone: 'trap', radius: 3.4, duration: 8, strength: 6, damage: 5, at: 'self', follow: true }), every(0.9, { kind: 'radial', radius: 3.4, impulse: 6, damage: 4 }), start({ kind: 'mod', duration: 8, mods: { accel: 1.35, dmgDealt: 1.2 } })] });

// -------------------------------------------------------------------------------------------- TITAN BREAKER
def({ id: 'titan-breaker.earthquake', name: 'Earthquake', bladeId: 'titan-breaker', unlockLevel: 1, duration: 6, fx: 'burst',
  description: 'Shake the whole floor: a huge shockwave now and another every two seconds.',
  effects: [start({ kind: 'radial', radius: 5, impulse: 10, damage: 6 }), every(2, { kind: 'radial', radius: 4.5, impulse: 8, damage: 4 })] });
def({ id: 'titan-breaker.crush-mode', name: 'Crush Mode', bladeId: 'titan-breaker', unlockLevel: 3, duration: 7, fx: 'aura',
  description: 'Heavier and hitting harder than anything, a little slower to turn.',
  effects: [start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.5, kbDealt: 1.5, accel: 0.8, mass: 1.3 } })] });
def({ id: 'titan-breaker.gravity-slam', name: 'Gravity Slam', bladeId: 'titan-breaker', unlockLevel: 4, duration: 6, fx: 'burst',
  description: 'Jump, vanish, and land on the opponent for a crater-making slam.',
  effects: [start({ kind: 'slam', delay: 0.9, radius: 4.6, impulse: 15, damage: 17 })] });
def({ id: 'titan-breaker.unstoppable', name: 'Unstoppable', bladeId: 'titan-breaker', unlockLevel: 6, duration: 7, fx: 'shield', requiredStats: { weight: 8 },
  description: 'Shrug off nearly all knockback and plough through them.',
  effects: [start({ kind: 'mod', duration: 7, mods: { kbTaken: 0.1, dmgTaken: 0.6, mass: 1.8, accel: 1.2, dmgDealt: 1.2 } })] });
def({ id: 'titan-breaker.titan-fall', name: 'Titan Fall', bladeId: 'titan-breaker', unlockLevel: 7, duration: 7, fx: 'burst', ultimate: true,
  description: 'The biggest slam in the roster, with an aftershock when it ends.',
  effects: [start({ kind: 'slam', delay: 1.0, radius: 6.5, impulse: 20, damage: 26 }), start({ kind: 'mod', duration: 7, mods: { kbDealt: 1.3 } }), atEnd({ kind: 'radial', radius: 5, impulse: 10, damage: 8 })] });

// -------------------------------------------------------------------------------------------- INFERNO X
def({ id: 'inferno-x.heatwave', name: 'Heatwave', bladeId: 'inferno-x', unlockLevel: 1, duration: 7, fx: 'burst',
  description: 'Pulses of heat from your core, every second and a half, that shove and scorch.',
  effects: [start({ kind: 'radial', radius: 4, impulse: 6, damage: 4 }), every(1.4, { kind: 'radial', radius: 4, impulse: 6, damage: 4 })] });
def({ id: 'inferno-x.burning-spin', name: 'Burning Spin', bladeId: 'inferno-x', unlockLevel: 3, duration: 7, fx: 'aura',
  description: 'Wrap yourself in fire: a burning field round you and harder hits, at a small spin cost.',
  effects: [start({ kind: 'zone', zone: 'trap', radius: 2.6, duration: 7, strength: 4, damage: 3.5, at: 'self', follow: true }), start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.25, spinDecay: 1.2 } })] });
def({ id: 'inferno-x.inferno-ring', name: 'Inferno Ring', bladeId: 'inferno-x', unlockLevel: 4, duration: 7, fx: 'zone',
  description: 'Set a ring of fire round yourself that the opponent has to cross.',
  effects: [start({ kind: 'zone', zone: 'trap', radius: 4.5, duration: 7, strength: 7, damage: 6, at: 'self' }), every(2.5, { kind: 'zone', zone: 'trap', radius: 4.5, duration: 4.5, strength: 7, damage: 6, at: 'self' })] });
def({ id: 'inferno-x.overheat', name: 'Overheat', bladeId: 'inferno-x', unlockLevel: 6, duration: 7, fx: 'aura', requiredStats: { attack: 8 },
  description: 'Run hot: much harder hits and more speed, and your spin burns more than twice as fast.',
  effects: [start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.6, kbDealt: 1.3, spinDecay: 2.2, accel: 1.2 } })] });
def({ id: 'inferno-x.inferno-core', name: 'Inferno Core', bladeId: 'inferno-x', unlockLevel: 7, duration: 8, fx: 'burst', ultimate: true,
  description: 'Your core erupts: a huge blast now, and a blast every second and a half after it.',
  effects: [start({ kind: 'radial', radius: 5.5, impulse: 12, damage: 10 }), every(1.6, { kind: 'radial', radius: 4, impulse: 7, damage: 5 }), start({ kind: 'mod', duration: 8, mods: { dmgDealt: 1.25 } })] });

// -------------------------------------------------------------------------------------------- STORMFANG
def({ id: 'stormfang.combo-rush', name: 'Combo Rush', bladeId: 'stormfang', unlockLevel: 1, duration: 7, fx: 'trail',
  description: 'Every hit makes the next one hit harder: stacks up to five times.',
  effects: [onHit(0.3, { kind: 'mod', duration: 3, mods: { dmgDealt: 1.12 }, tag: 'combo-rush', stack: 5 }), start({ kind: 'mod', duration: 7, mods: { accel: 1.2 } })] });
def({ id: 'stormfang.storm-chain', name: 'Storm Chain', bladeId: 'stormfang', unlockLevel: 3, duration: 6, fx: 'trail',
  description: 'Each hit chains into a fresh lunge at the opponent.',
  effects: [start({ kind: 'dash', dir: 'target', speed: 10 }), onHit(0.9, { kind: 'dash', dir: 'target', speed: 9 }), start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.15 } })] });
def({ id: 'stormfang.cyclone-strike', name: 'Cyclone Strike', bladeId: 'stormfang', unlockLevel: 4, duration: 6, fx: 'burst',
  description: 'Spin up a cyclone: shockwaves now and every second and a half, and more speed.',
  effects: [start({ kind: 'radial', radius: 4, impulse: 8, damage: 5 }), every(1.5, { kind: 'radial', radius: 4, impulse: 6, damage: 4 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.25 } })] });
def({ id: 'stormfang.momentum', name: 'Momentum', bladeId: 'stormfang', unlockLevel: 6, duration: 8, fx: 'aura', requiredStats: { agility: 8 },
  description: 'Hits build momentum: you get faster and hit harder with every one, up to six stacks.',
  effects: [onHit(0.2, { kind: 'mod', duration: 4, mods: { accel: 1.08, dmgDealt: 1.08 }, tag: 'momentum', stack: 6 }), start({ kind: 'mod', duration: 8, mods: { accel: 1.2 } })] });
def({ id: 'stormfang.storm-breaker', name: 'Storm Breaker', bladeId: 'stormfang', unlockLevel: 7, duration: 7, fx: 'burst', ultimate: true,
  description: 'Crash down like a thunderbolt, then keep the combo going.',
  effects: [start({ kind: 'slam', delay: 0.7, radius: 4.8, impulse: 14, damage: 18 }), onHit(0.3, { kind: 'mod', duration: 3, mods: { dmgDealt: 1.12 }, tag: 'storm-combo', stack: 5 }), every(1.8, { kind: 'dash', dir: 'target', speed: 9 })] });

// -------------------------------------------------------------------------------------------- IRON WARDEN
def({ id: 'iron-warden.perfect-reflect', name: 'Perfect Reflect', bladeId: 'iron-warden', unlockLevel: 1, duration: 6, fx: 'shield',
  description: 'Everything thrown at you, damage and knockback, is thrown back.',
  effects: [start({ kind: 'mod', duration: 6, mods: { dmgTaken: 0.7, kbTaken: 0.7 }, flags: ['reflectDamage', 'reflectKnockback'] })] });
def({ id: 'iron-warden.counter-zone', name: 'Counter Zone', bladeId: 'iron-warden', unlockLevel: 3, duration: 7, fx: 'zone',
  description: 'A field round you that shocks anything that stays in it, while you reflect the knockback.',
  effects: [start({ kind: 'zone', zone: 'trap', radius: 3.4, duration: 7, strength: 5, damage: 5, at: 'self', follow: true }), start({ kind: 'mod', duration: 7, mods: { dmgTaken: 0.8 }, flags: ['reflectKnockback'] })] });
def({ id: 'iron-warden.iron-counter', name: 'Iron Counter', bladeId: 'iron-warden', unlockLevel: 4, duration: 7, fx: 'shield',
  description: 'Every hit you take answers with a shockwave.',
  effects: [onHurt(1.2, { kind: 'radial', radius: 3.4, impulse: 8, damage: 6 }), start({ kind: 'mod', duration: 7, mods: { dmgTaken: 0.6 } })] });
def({ id: 'iron-warden.punish', name: 'Punish', bladeId: 'iron-warden', unlockLevel: 6, duration: 6, fx: 'aura',
  description: 'Get hit and you lunge straight back, hitting much harder.',
  effects: [onHurt(0.8, { kind: 'dash', dir: 'target', speed: 9 }), onHurt(0.8, { kind: 'mod', duration: 2, mods: { dmgDealt: 1.5, kbDealt: 1.3 }, tag: 'punish' }), start({ kind: 'mod', duration: 6, mods: { dmgTaken: 0.8 } })] });
def({ id: 'iron-warden.warden-protocol', name: 'Warden Protocol', bladeId: 'iron-warden', unlockLevel: 7, duration: 8, fx: 'shield', ultimate: true,
  description: 'A barrier for the next two hits, reflected damage, and a shockwave for every blow that lands.',
  effects: [start({ kind: 'shield', hits: 2, duration: 8 }), start({ kind: 'mod', duration: 8, mods: { dmgTaken: 0.7 }, flags: ['reflectDamage'] }), onHurt(1.5, { kind: 'radial', radius: 3.6, impulse: 8, damage: 5 })] });

// -------------------------------------------------------------------------------------------- BASTION X
def({ id: 'bastion-x.fortress', name: 'Fortress', bladeId: 'bastion-x', unlockLevel: 1, duration: 8, fx: 'shield', requiredStats: { defense: 9 },
  description: 'Huge damage and knockback reduction. You can still creep.',
  effects: [start({ kind: 'mod', duration: 8, mods: { dmgTaken: 0.3, kbTaken: 0.3, accel: 0.6 } })] });
def({ id: 'bastion-x.anchor-field', name: 'Anchor Field', bladeId: 'bastion-x', unlockLevel: 3, duration: 7, fx: 'zone',
  description: 'A field round you that drags everything in it to a crawl, while you dig in.',
  effects: [start({ kind: 'zone', zone: 'slow', radius: 5.5, duration: 7, strength: 0, damage: 0, at: 'self', follow: true }), start({ kind: 'mod', duration: 7, mods: { mass: 1.8, kbTaken: 0.5 } })] });
def({ id: 'bastion-x.barrier', name: 'Barrier', bladeId: 'bastion-x', unlockLevel: 4, duration: 7, fx: 'shield',
  description: 'A barrier that soaks up the next two hits completely.',
  effects: [start({ kind: 'shield', hits: 2, duration: 7 })] });
def({ id: 'bastion-x.unbreakable', name: 'Unbreakable', bladeId: 'bastion-x', unlockLevel: 6, duration: 6, fx: 'shield',
  description: 'Nothing touches you for the first two and a half seconds, and little after that.',
  effects: [start({ kind: 'mod', duration: 2.5, flags: ['invuln'], tag: 'unbreakable' }), start({ kind: 'mod', duration: 6, mods: { dmgTaken: 0.5, accel: 0.5 } })] });
def({ id: 'bastion-x.bastion-core', name: 'Bastion Core', bladeId: 'bastion-x', unlockLevel: 7, duration: 8, fx: 'shield', ultimate: true,
  description: 'The whole fortress at once: a barrier, enormous weight, a slowing field and a steady trickle of spin.',
  effects: [start({ kind: 'shield', hits: 3, duration: 8 }), start({ kind: 'mod', duration: 8, mods: { mass: 2.4, kbTaken: 0.1 } }), start({ kind: 'zone', zone: 'slow', radius: 4.5, duration: 8, strength: 0, damage: 0, at: 'self', follow: true }), every(2, { kind: 'spin', amount: 3 })] });

// -------------------------------------------------------------------------------------------- STONECORE
def({ id: 'stonecore.earth-anchor', name: 'Earth Anchor', bladeId: 'stonecore', unlockLevel: 1, duration: 7, fx: 'shield', requiredStats: { stability: 9 },
  description: 'Anchored to the arena: almost impossible to move.',
  effects: [start({ kind: 'mod', duration: 7, mods: { mass: 2.8, accel: 0.3, external: 0.1, kbTaken: 0.2, drag: 1.5 } })] });
def({ id: 'stonecore.stone-skin', name: 'Stone Skin', bladeId: 'stonecore', unlockLevel: 3, duration: 7, fx: 'shield',
  description: 'A shell of stone: damage and knockback are cut right down.',
  effects: [start({ kind: 'mod', duration: 7, mods: { dmgTaken: 0.35, kbTaken: 0.45, accel: 0.7 } })] });
def({ id: 'stonecore.gravity-lock', name: 'Gravity Lock', bladeId: 'stonecore', unlockLevel: 4, duration: 7, fx: 'zone',
  description: 'A gravity field round you that pulls the opponent in and holds them.',
  effects: [start({ kind: 'zone', zone: 'well', radius: 5.5, duration: 7, strength: 7, damage: 0, at: 'self', follow: true })] });
def({ id: 'stonecore.core-recovery', name: 'Core Recovery', bladeId: 'stonecore', unlockLevel: 6, duration: 8, fx: 'aura', requiredStats: { stamina: 8 },
  description: 'The core feeds itself: spin back now and a steady trickle, with damage cut.',
  effects: [start({ kind: 'spin', amount: 10 }), every(2.2, { kind: 'spin', amount: 3.5 }), start({ kind: 'mod', duration: 8, mods: { dmgTaken: 0.7 } })] });
def({ id: 'stonecore.mountain-form', name: 'Mountain Form', bladeId: 'stonecore', unlockLevel: 7, duration: 8, fx: 'shield', ultimate: true,
  description: 'Become the mountain: all but immovable and nearly untouchable, with a shockwave for every hit you take.',
  effects: [start({ kind: 'mod', duration: 8, mods: { mass: 3, dmgTaken: 0.25, kbTaken: 0.15, accel: 0.35 } }), start({ kind: 'zone', zone: 'slow', radius: 4, duration: 8, strength: 0, damage: 0, at: 'self', follow: true }), onHurt(1.6, { kind: 'radial', radius: 3.6, impulse: 9, damage: 5 })] });

// -------------------------------------------------------------------------------------------- AEGIRON
def({ id: 'aegiron.energy-shield', name: 'Energy Shield', bladeId: 'aegiron', unlockLevel: 1, duration: 7, fx: 'shield',
  description: 'An energy shield that soaks up two hits.',
  effects: [start({ kind: 'shield', hits: 2, duration: 7 }), start({ kind: 'mod', duration: 7, mods: { dmgTaken: 0.8 } })] });
def({ id: 'aegiron.reflect-pulse', name: 'Reflect Pulse', bladeId: 'aegiron', unlockLevel: 3, duration: 6, fx: 'shield',
  description: 'A shield that answers every hit with a pulse that throws the attacker back.',
  effects: [start({ kind: 'shield', hits: 1, duration: 6 }), onHurt(1.0, { kind: 'radial', radius: 3.6, impulse: 8, damage: 5 })] });
def({ id: 'aegiron.absorb', name: 'Absorb', bladeId: 'aegiron', unlockLevel: 4, duration: 7, fx: 'aura',
  description: 'Soak up the damage you take and turn over half of it into spin.',
  effects: [start({ kind: 'mod', duration: 7, mods: { dmgTaken: 0.75 }, flags: ['absorb'] })] });
def({ id: 'aegiron.energy-conversion', name: 'Energy Conversion', bladeId: 'aegiron', unlockLevel: 6, duration: 7, fx: 'aura', requiredStats: { defense: 9 },
  description: 'Absorb damage as spin, and hit harder every time you are hit.',
  effects: [start({ kind: 'mod', duration: 7, flags: ['absorb'] }), onHurt(0.6, { kind: 'mod', duration: 4, mods: { dmgDealt: 1.15 }, tag: 'conversion', stack: 4 })] });
def({ id: 'aegiron.aegis-nova', name: 'Aegis Nova', bladeId: 'aegiron', unlockLevel: 7, duration: 7, fx: 'burst', ultimate: true,
  description: 'Three hits of shield and absorbed damage, then it all goes off as one huge nova.',
  effects: [start({ kind: 'shield', hits: 3, duration: 7 }), start({ kind: 'mod', duration: 7, flags: ['absorb'] }), atEnd({ kind: 'radial', radius: 7, impulse: 14, damage: 12 })] });

// -------------------------------------------------------------------------------------------- GUARDIAN PRIME
def({ id: 'guardian-prime.guardian-shield', name: 'Guardian Shield', bladeId: 'guardian-prime', unlockLevel: 1, duration: 7, fx: 'shield',
  description: 'A single-hit shield, a firm cut to damage and knockback, and a little spin back to start.',
  effects: [start({ kind: 'shield', hits: 1, duration: 7 }), start({ kind: 'mod', duration: 7, mods: { dmgTaken: 0.65, kbTaken: 0.65 } }), start({ kind: 'spin', amount: 4 })] });
def({ id: 'guardian-prime.recovery-pulse', name: 'Recovery Pulse', bladeId: 'guardian-prime', unlockLevel: 3, duration: 6, fx: 'aura',
  description: 'Win back spin now and again every two seconds, with a gentle shockwave.',
  effects: [start({ kind: 'spin', amount: 12 }), every(2, { kind: 'spin', amount: 3 }), start({ kind: 'radial', radius: 3, impulse: 4, damage: 0 })] });
def({ id: 'guardian-prime.counter-guard', name: 'Counter Guard', bladeId: 'guardian-prime', unlockLevel: 4, duration: 7, fx: 'shield',
  description: 'Damage you take is dealt back, and you shed most of the knockback.',
  effects: [start({ kind: 'mod', duration: 7, mods: { dmgTaken: 0.65, kbTaken: 0.6 }, flags: ['reflectDamage'] })] });
def({ id: 'guardian-prime.last-stand', name: 'Last Stand', bladeId: 'guardian-prime', unlockLevel: 6, duration: 8, fx: 'aura', requiredStats: { stamina: 8 },
  description: 'As your spin runs low you hit harder and take far less.',
  effects: [start({ kind: 'mod', duration: 8, mods: { spinDecay: 0.75 }, spinLoss: { dmgDealt: 1.6, kbDealt: 1.4, dmgTaken: 0.55 } })] });
def({ id: 'guardian-prime.guardian-mode', name: 'Guardian Mode', bladeId: 'guardian-prime', unlockLevel: 7, duration: 8, fx: 'shield', ultimate: true,
  description: 'Balanced and unbreakable: a shield, a damage cut, stronger hits and a burst of spin.',
  effects: [start({ kind: 'shield', hits: 2, duration: 8 }), start({ kind: 'mod', duration: 8, mods: { dmgTaken: 0.5, dmgDealt: 1.25, kbTaken: 0.5 } }), start({ kind: 'spin', amount: 8 })] });

// -------------------------------------------------------------------------------------------- GRAVITY REX
def({ id: 'gravity-rex.gravity-well', name: 'Gravity Well', bladeId: 'gravity-rex', unlockLevel: 1, duration: 7, fx: 'zone',
  description: 'A field round you that drags the opponent in and slows them down.',
  effects: [start({ kind: 'zone', zone: 'well', radius: 6.5, duration: 7, strength: 6, damage: 0, at: 'self', follow: true })] });
def({ id: 'gravity-rex.heavy-field', name: 'Heavy Field', bladeId: 'gravity-rex', unlockLevel: 3, duration: 7, fx: 'zone',
  description: 'The air round you turns to syrup, while you grow heavier.',
  effects: [start({ kind: 'zone', zone: 'slow', radius: 6, duration: 7, strength: 0, damage: 0, at: 'self', follow: true }), start({ kind: 'mod', duration: 7, mods: { mass: 1.5 } })] });
def({ id: 'gravity-rex.orbit-lock', name: 'Orbit Lock', bladeId: 'gravity-rex', unlockLevel: 4, duration: 7, fx: 'zone',
  description: 'Catch the opponent in orbit: they are swung round you in a curve they cannot steer out of.',
  effects: [start({ kind: 'zone', zone: 'orbit', radius: 6.5, duration: 7, strength: 7, damage: 0, at: 'self', follow: true })] });
def({ id: 'gravity-rex.reverse-gravity', name: 'Reverse Gravity', bladeId: 'gravity-rex', unlockLevel: 6, duration: 6, fx: 'zone', requiredStats: { weight: 8 },
  description: 'Everything near you is pushed away, towards the wall, while you stay put.',
  effects: [start({ kind: 'zone', zone: 'repel', radius: 6, duration: 6, strength: 9, damage: 0, at: 'self', follow: true }), start({ kind: 'mod', duration: 6, mods: { mass: 1.3 } })] });
def({ id: 'gravity-rex.gravity-collapse', name: 'Gravity Collapse', bladeId: 'gravity-rex', unlockLevel: 7, duration: 8, fx: 'zone', ultimate: true,
  description: 'Collapse space on the opponent: a black hole that pulls them in and drains their spin, with a shockwave to start.',
  effects: [start({ kind: 'radial', radius: 4.5, impulse: 8, damage: 5 }), start({ kind: 'zone', zone: 'blackhole', radius: 6.5, duration: 8, strength: 8, damage: 0, at: 'target' })] });

// -------------------------------------------------------------------------------------------- VOIDRUNNER
def({ id: 'voidrunner.void-step', name: 'Void Step', bladeId: 'voidrunner', unlockLevel: 1, duration: 6, fx: 'trail',
  description: 'Step through the void: a sideways burst, untouchable for a moment, then quicker.',
  effects: [start({ kind: 'mod', duration: 0.3, flags: ['invuln'], tag: 'void-step' }), start({ kind: 'dash', dir: 'perp', speed: 12 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.3 } })] });
def({ id: 'voidrunner.speed-burst', name: 'Speed Burst', bladeId: 'voidrunner', unlockLevel: 3, duration: 6, fx: 'trail',
  description: 'A huge burst of speed and slipperiness, with spin loss slowed.',
  effects: [start({ kind: 'mod', duration: 6, mods: { accel: 1.7, drag: 0.7, spinDecay: 0.8 } })] });
def({ id: 'voidrunner.afterimage', name: 'Afterimage', bladeId: 'voidrunner', unlockLevel: 4, duration: 6, fx: 'trail',
  description: 'Leave an afterimage the opponent will chase.',
  effects: [start({ kind: 'decoy', duration: 6 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.25 } })] });
def({ id: 'voidrunner.phase-run', name: 'Phase Run', bladeId: 'voidrunner', unlockLevel: 6, duration: 6, fx: 'trail', requiredStats: { agility: 9 },
  description: 'Run through other blades for four seconds, faster and slower to tire.',
  effects: [start({ kind: 'mod', duration: 4, flags: ['ghost'], tag: 'phase-run' }), start({ kind: 'mod', duration: 6, mods: { accel: 1.5, spinDecay: 0.6 } })] });
def({ id: 'voidrunner.voidstorm', name: 'Voidstorm', bladeId: 'voidrunner', unlockLevel: 7, duration: 8, fx: 'zone', ultimate: true,
  description: 'Open a void on the opponent that drags them in, while you pass through everything for two seconds.',
  effects: [start({ kind: 'zone', zone: 'blackhole', radius: 6, duration: 8, strength: 7, damage: 0, at: 'target' }), start({ kind: 'mod', duration: 2, flags: ['ghost'], tag: 'voidstorm' }), start({ kind: 'mod', duration: 8, mods: { accel: 1.3 } })] });

// -------------------------------------------------------------------------------------------- NIGHTVEIL
def({ id: 'nightveil.cloak', name: 'Cloak', bladeId: 'nightveil', unlockLevel: 1, duration: 6, fx: 'trail',
  description: 'Vanish from sight and move quicker. The opponent has to guess where you are.',
  effects: [start({ kind: 'mod', duration: 6, mods: { accel: 1.2 }, flags: ['stealth'] })] });
def({ id: 'nightveil.hide-and-seek', name: 'Hide & Seek', bladeId: 'nightveil', unlockLevel: 3, duration: 6, fx: 'trail',
  description: 'Fade from sight. Your next hit is an ambush for bonus damage.',
  effects: [start({ kind: 'mod', duration: 6, mods: { accel: 1.2 }, flags: ['stealth', 'ambush'] })] });
def({ id: 'nightveil.shadow-clone', name: 'Shadow Clone', bladeId: 'nightveil', unlockLevel: 4, duration: 7, fx: 'trail',
  description: 'Leave a shadow behind and slip out of sight for a moment.',
  effects: [start({ kind: 'decoy', duration: 7 }), start({ kind: 'mod', duration: 2.5, flags: ['stealth'], tag: 'shadow-clone' }), start({ kind: 'mod', duration: 7, mods: { accel: 1.2 } })] });
def({ id: 'nightveil.night-dash', name: 'Night Dash', bladeId: 'nightveil', unlockLevel: 6, duration: 6, fx: 'burst',
  description: 'Vanish and reappear behind the opponent for an ambush strike.',
  effects: [start({ kind: 'teleport', to: 'behindTarget', distance: 3.2 }), start({ kind: 'dash', dir: 'target', speed: 13 }), start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.3 }, flags: ['ambush'] })] });
def({ id: 'nightveil.nightfall', name: 'Nightfall', bladeId: 'nightveil', unlockLevel: 7, duration: 8, fx: 'aura', ultimate: true,
  description: 'Night falls: hidden, quicker, siphoning spin from anyone close, with an ambush waiting.',
  effects: [start({ kind: 'mod', duration: 8, mods: { accel: 1.25 }, flags: ['stealth', 'ambush'] }), start({ kind: 'drain', radius: 5, rate: 5, duration: 8 })] });

// -------------------------------------------------------------------------------------------- SPECTRA
def({ id: 'spectra.decoy', name: 'Decoy', bladeId: 'spectra', unlockLevel: 1, duration: 6, fx: 'trail',
  description: 'Leave a ghost copy behind that the opponent will chase.',
  effects: [start({ kind: 'decoy', duration: 6 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.2 } })] });
def({ id: 'spectra.mirror-clone', name: 'Mirror Clone', bladeId: 'spectra', unlockLevel: 3, duration: 7, fx: 'trail',
  description: 'A fresh mirror image every two and a half seconds.',
  effects: [start({ kind: 'decoy', duration: 2.5 }), every(2.5, { kind: 'decoy', duration: 2.5 }), start({ kind: 'mod', duration: 7, mods: { accel: 1.2 } })] });
def({ id: 'spectra.phase-shift', name: 'Phase Shift', bladeId: 'spectra', unlockLevel: 4, duration: 6, fx: 'trail', requiredStats: { agility: 9 },
  description: 'Pass through other blades for a few seconds and move faster.',
  effects: [start({ kind: 'mod', duration: 2.5, flags: ['ghost'], tag: 'phase-shift' }), start({ kind: 'mod', duration: 6, mods: { accel: 1.4 } })] });
def({ id: 'spectra.false-target', name: 'False Target', bladeId: 'spectra', unlockLevel: 6, duration: 7, fx: 'trail',
  description: 'A decoy and a vanishing act together: the opponent attacks the wrong blade and you strike from the side.',
  effects: [start({ kind: 'decoy', duration: 7 }), start({ kind: 'mod', duration: 7, mods: { accel: 1.25 }, flags: ['stealth', 'ambush'] })] });
def({ id: 'spectra.spectral-storm', name: 'Spectral Storm', bladeId: 'spectra', unlockLevel: 7, duration: 8, fx: 'burst', ultimate: true,
  description: 'A storm of mirror images, with a shockwave on every hit and a moment of ghosting.',
  effects: [start({ kind: 'decoy', duration: 2 }), every(1.5, { kind: 'decoy', duration: 2 }), start({ kind: 'mod', duration: 2, flags: ['ghost'], tag: 'spectral' }), onHit(1.0, { kind: 'radial', radius: 3.2, impulse: 6, damage: 3 }), start({ kind: 'mod', duration: 8, mods: { accel: 1.3 } })] });

// -------------------------------------------------------------------------------------------- GHOST VIPER
def({ id: 'ghost-viper.venom-dash', name: 'Venom Dash', bladeId: 'ghost-viper', unlockLevel: 1, duration: 6, fx: 'trail',
  description: 'Strike in a streak of venom: a lunge, then a poisoned field that siphons spin from anything close.',
  effects: [start({ kind: 'dash', dir: 'target', speed: 13 }), start({ kind: 'drain', radius: 3.5, rate: 4.5, duration: 6 }), start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.2 } })] });
def({ id: 'ghost-viper.phase-shift', name: 'Phase Shift', bladeId: 'ghost-viper', unlockLevel: 3, duration: 6, fx: 'trail',
  description: 'Pass through other blades for a few seconds and move faster.',
  effects: [start({ kind: 'mod', duration: 2.5, flags: ['ghost'], tag: 'phase-shift' }), start({ kind: 'mod', duration: 6, mods: { accel: 1.4 } })] });
def({ id: 'ghost-viper.counter-bite', name: 'Counter Bite', bladeId: 'ghost-viper', unlockLevel: 4, duration: 6, fx: 'aura',
  description: 'Let them hit you: the damage is thrown back, and you lunge straight back at them.',
  effects: [start({ kind: 'mod', duration: 6, mods: { dmgTaken: 0.8 }, flags: ['reflectDamage'] }), onHurt(1.0, { kind: 'dash', dir: 'target', speed: 11 }), onHurt(1.0, { kind: 'radial', radius: 3, impulse: 5, damage: 3 })] });
def({ id: 'ghost-viper.predator-mode', name: 'Predator Mode', bladeId: 'ghost-viper', unlockLevel: 6, duration: 7, fx: 'aura', requiredStats: { agility: 9 },
  description: 'Hunt: you are faster and hit harder, and the opponent is slower and sloppier.',
  effects: [start({ kind: 'mod', duration: 7, mods: { accel: 1.35, dmgDealt: 1.35 } }), start({ kind: 'mod', target: 'opponent', duration: 7, mods: { accel: 0.75 }, tag: 'prey' })] });
def({ id: 'ghost-viper.ghost-strike', name: 'Ghost Strike', bladeId: 'ghost-viper', unlockLevel: 7, duration: 7, fx: 'burst', ultimate: true,
  description: 'Ghost through them, reappear behind and strike with an ambushing, much harder hit.',
  effects: [start({ kind: 'mod', duration: 1.2, flags: ['ghost'], tag: 'ghost-strike' }), start({ kind: 'teleport', to: 'behindTarget', distance: 3.2 }), start({ kind: 'dash', dir: 'target', speed: 15 }), start({ kind: 'mod', duration: 7, mods: { dmgDealt: 1.5 }, flags: ['ambush'] })] });

// -------------------------------------------------------------------------------------------- CHRONO
def({ id: 'chrono.time-slow', name: 'Time Slow', bladeId: 'chrono', unlockLevel: 1, duration: 6, fx: 'aura',
  description: 'The opponent moves through syrup while you do not.',
  effects: [start({ kind: 'mod', target: 'opponent', duration: 6, mods: { accel: 0.45, drag: 1.6 }, tag: 'time-slow' })] });
def({ id: 'chrono.time-freeze', name: 'Time Freeze', bladeId: 'chrono', unlockLevel: 3, duration: 6, fx: 'aura',
  description: 'Stop the opponent dead for two seconds. They can still be hit.',
  effects: [start({ kind: 'mod', target: 'opponent', duration: 2.2, mods: { accel: 0.04, drag: 7 }, tag: 'time-freeze' }), start({ kind: 'mod', duration: 6, mods: { accel: 1.2 } })] });
def({ id: 'chrono.rewind', name: 'Rewind', bladeId: 'chrono', unlockLevel: 4, duration: 6, fx: 'burst',
  description: 'Rewind two and a half seconds: back to where you were, with most of the spin you have lost since.',
  effects: [start({ kind: 'rewind', seconds: 2.5, spin: 0.7 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.15 } })] });
def({ id: 'chrono.temporal-shift', name: 'Temporal Shift', bladeId: 'chrono', unlockLevel: 6, duration: 6, fx: 'burst', requiredStats: { agility: 8 },
  description: 'Slip a second ahead: appear behind the opponent, slow them down, and strike.',
  effects: [start({ kind: 'teleport', to: 'behindTarget', distance: 3 }), start({ kind: 'mod', target: 'opponent', duration: 3, mods: { accel: 0.6 }, tag: 'temporal' }), start({ kind: 'mod', duration: 6, mods: { dmgDealt: 1.25 } })] });
def({ id: 'chrono.time-collapse', name: 'Time Collapse', bladeId: 'chrono', unlockLevel: 7, duration: 8, fx: 'zone', ultimate: true,
  description: 'Collapse time on the opponent: they crawl, a black hole pulls them in, and at the end you rewind.',
  effects: [start({ kind: 'mod', target: 'opponent', duration: 4, mods: { accel: 0.3, drag: 4 }, tag: 'collapse' }), start({ kind: 'zone', zone: 'blackhole', radius: 6, duration: 8, strength: 6, damage: 0, at: 'target' }), atEnd({ kind: 'rewind', seconds: 2, spin: 0.5 })] });

// -------------------------------------------------------------------------------------------- NEBULA DRIFT
def({ id: 'nebula-drift.spin-burst', name: 'Spin Burst', bladeId: 'nebula-drift', unlockLevel: 1, duration: 6, fx: 'burst', requiredStats: { stamina: 9 },
  description: 'Recover some spin right now, then burn it half as fast.',
  effects: [start({ kind: 'spin', amount: 14 }), start({ kind: 'mod', duration: 6, mods: { accel: 1.4, spinDecay: 0.5 } })] });
def({ id: 'nebula-drift.spin-drain', name: 'Spin Drain', bladeId: 'nebula-drift', unlockLevel: 3, duration: 7, fx: 'aura',
  description: 'Stay close and siphon the opponent’s spin into your own.',
  effects: [start({ kind: 'drain', radius: 5, rate: 5.5, duration: 7 })] });
def({ id: 'nebula-drift.endurance-mode', name: 'Endurance Mode', bladeId: 'nebula-drift', unlockLevel: 4, duration: 8, fx: 'aura',
  description: 'Settle in for the long haul: your spin barely burns and trickles back.',
  effects: [start({ kind: 'mod', duration: 8, mods: { spinDecay: 0.3, accel: 1.15 } }), every(2, { kind: 'spin', amount: 3 })] });
def({ id: 'nebula-drift.energy-recover', name: 'Energy Recover', bladeId: 'nebula-drift', unlockLevel: 6, duration: 6, fx: 'burst',
  description: 'A big gulp of spin straight away, with damage cut while it settles.',
  effects: [start({ kind: 'spin', amount: 24 }), start({ kind: 'mod', duration: 6, mods: { dmgTaken: 0.8 } })] });
def({ id: 'nebula-drift.nebula-collapse', name: 'Nebula Collapse', bladeId: 'nebula-drift', unlockLevel: 7, duration: 8, fx: 'zone', ultimate: true,
  description: 'A collapsing nebula on the opponent: it pulls them in and drains them, feeding you spin.',
  effects: [start({ kind: 'zone', zone: 'blackhole', radius: 6.5, duration: 8, strength: 7, damage: 0, at: 'target' }), start({ kind: 'drain', radius: 5, rate: 4, duration: 8 }), start({ kind: 'spin', amount: 10 })] });

// ------------------------------------------------------------------------------------ planned (data only)
/** Register a blade's pool as data-only placeholders (shown as “coming soon”; effects arrive later). */
export function registerPlannedSupers(bladeId: string, names: string[], ultimateIndex = names.length - 1): string[] {
  return names.map((name, i) => {
    const id = `${bladeId}.${slugify(name)}`;
    if (!SUPERS[id]) {
      SUPERS[id] = {
        id, name, bladeId, description: 'Coming soon.', duration: 7, recharge: SUPER_RECHARGE, strength: 1,
        unlockLevel: Math.min(7, 1 + Math.round((i * 6) / Math.max(1, names.length - 1))),
        implemented: false, fx: 'burst', effects: [], ultimate: i === ultimateIndex && names.length >= 5,
      };
    }
    return id;
  });
}

export function getSuper(id: string): SuperDef {
  const s = SUPERS[id];
  if (!s) throw new Error(`Unknown super: ${id}`);
  return s;
}
