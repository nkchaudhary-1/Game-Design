// Basic moves (3 per blade). All data: one shared ability system runs them (see combat/AbilitySystem.ts).
//
// Slot convention (it is what the controller buttons mean):
//   Move 1 — the attack. Chargeable: hold to charge (drains spin), release to fire. This is the PRD's
//            "press and hold to charge a burst meter, release to dash".
//   Move 2 — defensive / evasive, instant.
//   Move 3 — movement / stance, instant.

import type { AbilityDef } from './effects';
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
// Generic moves: every other blade gets the same three slot templates, tuned by class. This is what
// makes "add a blade = add data": a new roster entry plays on day one; its Supers come later.
// ---------------------------------------------------------------------------------------------------
export function makeGenericMoves(bladeId: string, cls: BladeClass, names: [string, string, string]): [string, string, string] {
  const p = (n: string) => `${bladeId}.${slug(n)}`;
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
