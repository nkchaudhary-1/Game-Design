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
