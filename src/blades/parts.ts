// Customization parts. Every blade is RING + CORE + WEIGHT + TIP. Parts are functional: they shift the
// 1–10 design ratings (so they flow through the central Balance into real physics), change the model,
// gate Supers (via each Super's requiredStats) and rewrite the build description.
//
// Rule (enforced by tests): every non-neutral part trades something away. No universally superior parts.

import type { BladeClass, PartSlot, Rarity, StatRatings } from '../core/types';

export interface PartVisual {
  /** ring: relative outer radius / thickness / spike scale; core: shape; weight: disc scale; tip: shape */
  scale?: number;
  thickness?: number;
  spikes?: number;
  shape?: 'gem' | 'disc' | 'orb' | 'hex' | 'star' | 'cone' | 'ball' | 'flat' | 'pin' | 'stub';
  tint?: string;
}

export interface PartDef {
  id: string;
  slot: PartSlot;
  name: string;
  rarity: Rarity;
  unlockLevel: number;
  /** Which blade classes can equip it. */
  classes: BladeClass[];
  /** Additive deltas on the 1–10 design ratings. */
  mods: Partial<StatRatings>;
  visual: PartVisual;
  description: string;
}

export const PARTS: Record<string, PartDef> = {};
const A: BladeClass = 'ATTACK', D: BladeClass = 'DEFENSE', S: BladeClass = 'STAMINA';
const ANY: BladeClass[] = [A, D, S];

function part(
  slot: PartSlot, key: string, name: string, rarity: Rarity, unlockLevel: number, classes: BladeClass[],
  mods: Partial<StatRatings>, visual: PartVisual, description: string,
): void {
  const id = `${slot}.${key}`;
  PARTS[id] = { id, slot, name, rarity, unlockLevel, classes, mods, visual, description };
}

// ------------------------------------------------------------------------------------------- RINGS
part('ring', 'standard', 'Standard Ring', 'COMMON', 1, ANY, {}, { scale: 1, thickness: 1 }, 'The stock ring. No trade-offs.');
part('ring', 'heavy', 'Heavy Ring', 'COMMON', 2, [A, D], { weight: 2, knockback: 1, agility: -1, stamina: -1 }, { scale: 1.06, thickness: 1.35 }, 'More mass behind every hit, slower to turn.');
part('ring', 'medium-heavy', 'Medium-Heavy Ring', 'COMMON', 2, [A], { weight: 1, attack: 1, stamina: -1 }, { scale: 1.03, thickness: 1.18 }, 'A step up in punch for a small stamina cost.');
part('ring', 'light-attack', 'Light Attack Ring', 'COMMON', 2, [A], { weight: -2, agility: 1, spinDamage: 1, defense: -1 }, { scale: 0.97, thickness: 0.8, spikes: 1.2 }, 'Quick and cutting, but fragile.');
part('ring', 'light', 'Light Ring', 'COMMON', 2, [A, S], { weight: -1, agility: 1, defense: -1 }, { scale: 0.96, thickness: 0.8 }, 'Trades armour for speed.');
part('ring', 'agile', 'Agile Ring', 'COMMON', 2, [A, S], { agility: 2, stability: -1 }, { scale: 0.98, thickness: 0.9 }, 'Turns on a coin; easier to knock off line.');
part('ring', 'agile-attack', 'Agile Attack Ring', 'RARE', 3, [A, S], { agility: 1, attack: 1, defense: -1, stamina: -1 }, { scale: 1, thickness: 0.9, spikes: 1.15 }, 'Fast and sharp, a glass cannon.');
part('ring', 'heavy-defensive', 'Heavy Defensive Ring', 'RARE', 3, [D], { weight: 1, defense: 1, stability: 1, agility: -1, attack: -1 }, { scale: 1.07, thickness: 1.5 }, 'A bulwark: hard to move, hard to use.');
part('ring', 'shield', 'Shield Ring', 'RARE', 3, [D], { defense: 2, agility: -1, knockback: -1 }, { scale: 1.05, thickness: 1.3 }, 'Plated for impact absorption.');
part('ring', 'crescent', 'Crescent Ring', 'RARE', 3, [S], { spinRetention: 1, agility: 1, defense: -1, knockback: -1 }, { scale: 1, thickness: 0.7 }, 'Curved fins hold spin and bite lightly.');
part('ring', 'spiked', 'Spiked Ring', 'RARE', 3, [A], { attack: 1, spinDamage: 1, spinRetention: -1, stability: -1 }, { scale: 1.02, thickness: 1, spikes: 1.4 }, 'Ripping edges that tear spin, and tear your own.');

// -------------------------------------------------------------------------------------------- CORES
part('core', 'balanced', 'Balanced Core', 'COMMON', 1, ANY, {}, { shape: 'gem' }, 'The stock core. No trade-offs.');
part('core', 'attack', 'Attack Core', 'COMMON', 2, [A], { attack: 1, spinDamage: 1, stamina: -1, stability: -1 }, { shape: 'star', tint: '#ffb199' }, 'Hits harder and burns out sooner.');
part('core', 'speed', 'Speed Core', 'COMMON', 2, [A, S], { agility: 1, attack: 1, stamina: -1, defense: -1 }, { shape: 'hex', tint: '#ffd37a' }, 'Quicker off the mark, thinner when hit.');
part('core', 'agility', 'Agility Core', 'COMMON', 2, [A, S], { agility: 2, stability: -1, weight: -1 }, { shape: 'orb', tint: '#8be9ff' }, 'Maximum steering response; lighter and loose.');
part('core', 'stability', 'Stability Core', 'COMMON', 2, [A, D], { stability: 2, agility: -1, spinDamage: -1 }, { shape: 'disc', tint: '#a6cdff' }, 'Plants the blade. Less cutting power, less agility.');
part('core', 'combo', 'Combo Core', 'RARE', 3, [A], { spinDamage: 2, knockback: -1, defense: -1 }, { shape: 'star', tint: '#ffe08a' }, 'Spin damage over launching: chip them down.');
part('core', 'counter', 'Counter Core', 'RARE', 3, [D], { attack: 1, spinDamage: 1, agility: -1, stamina: -1 }, { shape: 'hex', tint: '#ffb199' }, 'Gives a wall some teeth.');
part('core', 'stamina', 'Stamina Core', 'COMMON', 2, [D, S], { stamina: 2, attack: -1, knockback: -1 }, { shape: 'orb', tint: '#b8a0ff' }, 'Outlasts almost anyone, but pushes nobody around.');
part('core', 'energy', 'Energy Core', 'RARE', 3, [D], { spinRetention: 1, spinDamage: 1, stability: -1, agility: -1 }, { shape: 'gem', tint: '#7be8ff' }, 'Turns defence into spin pressure.');
part('core', 'control', 'Control Core', 'RARE', 3, [D], { stability: 1, knockback: 1, agility: -1, spinDamage: -1 }, { shape: 'disc', tint: '#8fb6ff' }, 'Shoves the fight where you want it.');
part('core', 'stealth', 'Stealth Core', 'RARE', 3, [S], { agility: 1, spinRetention: 1, defense: -1, attack: -1 }, { shape: 'orb', tint: '#6fe0ff' }, 'Slippery and quiet, easily broken.');
part('core', 'deception', 'Deception Core', 'EPIC', 4, [S], { agility: 1, stamina: 1, stability: -1, defense: -1 }, { shape: 'gem', tint: '#e0a6ff' }, 'Hard to read, hard to keep on course.');
part('core', 'spin', 'Spin Core', 'COMMON', 2, [S, D], { spinRetention: 2, stability: -1, spinDamage: -1 }, { shape: 'orb', tint: '#c9a8ff' }, 'Hangs on to spin through hits; wobbles when pushed.');
part('core', 'max-stamina', 'Max-Stamina Core', 'EPIC', 5, [S], { stamina: 3, attack: -2, knockback: -1, spinDamage: -1 }, { shape: 'orb', tint: '#d6c2ff' }, 'The longest-lasting core in the game and the softest hitter.');

// ------------------------------------------------------------------------------------------ WEIGHTS
part('weight', 'balanced', 'Balanced Weight', 'COMMON', 1, ANY, {}, { scale: 1 }, 'The stock disc. No trade-offs.');
part('weight', 'heavy', 'Heavy Weight', 'COMMON', 2, [A, D], { weight: 2, agility: -1, stamina: -1 }, { scale: 1.15 }, 'Mass wins collisions and loses races.');
part('weight', 'maximum', 'Maximum Weight', 'RARE', 4, [A, D], { weight: 3, agility: -2, stamina: -1 }, { scale: 1.3 }, 'As heavy as a blade can get.');
part('weight', 'light', 'Lightweight Disc', 'COMMON', 2, ANY, { weight: -2, agility: 1, stability: -1 }, { scale: 0.85 }, 'Sheds mass for quickness.');
part('weight', 'ultra-light', 'Ultra-Light Disc', 'RARE', 4, [A, S], { weight: -3, agility: 2, defense: -1, stability: -1 }, { scale: 0.7 }, 'Feather-weight. Fast, and flung around by everything.');

// --------------------------------------------------------------------------------------------- TIPS
part('tip', 'balanced', 'Balanced Tip', 'COMMON', 1, ANY, {}, { shape: 'cone' }, 'The stock tip. No trade-offs.');
part('tip', 'aggressive', 'Aggressive Tip', 'COMMON', 2, [A], { attack: 1, knockback: 1, spinRetention: -1, stamina: -1 }, { shape: 'pin' }, 'Bites the floor and bites back; shortens your spin.');
part('tip', 'high-grip', 'High-Grip Tip', 'COMMON', 2, [A, S], { agility: 1, spinDamage: 1, spinRetention: -1 }, { shape: 'stub' }, 'Rubbery grip for hard cornering at a cost in spin.');
part('tip', 'precision', 'Precision Tip', 'RARE', 3, [A, S], { agility: 1, spinDamage: 1, stability: -1, defense: -1 }, { shape: 'pin' }, 'Needle-fine control, no margin for error.');
part('tip', 'speed', 'Speed Tip', 'COMMON', 2, [A, S], { agility: 1, knockback: 1, stability: -1, spinRetention: -1 }, { shape: 'flat' }, 'Low friction, high pace.');
part('tip', 'defensive', 'Defensive Tip', 'COMMON', 2, [D], { stability: 1, defense: 1, agility: -1, knockback: -1 }, { shape: 'ball' }, 'A planted tip that resists being moved.');
part('tip', 'spin', 'Spin Tip', 'COMMON', 2, [S, D], { spinRetention: 1, stamina: 1, agility: -1, attack: -1 }, { shape: 'ball' }, 'Almost frictionless: spins forever, steers lazily.');
part('tip', 'agile', 'Agile Tip', 'COMMON', 2, [S], { agility: 1, spinRetention: 1, stability: -1, defense: -1 }, { shape: 'stub' }, 'Quick to redirect, easy to unsettle.');

export const partsForSlot = (slot: PartSlot): PartDef[] =>
  Object.values(PARTS).filter((p) => p.slot === slot);

export const getPart = (id: string): PartDef => {
  const p = PARTS[id];
  if (!p) throw new Error(`Unknown part: ${id}`);
  return p;
};

export const NEUTRAL_BUILD = {
  ring: 'ring.standard', core: 'core.balanced', weight: 'weight.balanced', tip: 'tip.balanced',
} as const;
