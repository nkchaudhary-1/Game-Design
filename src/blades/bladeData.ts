// The complete 21-blade roster (build spec §5), as data. Ratings are the spec's 1–10 design ratings;
// the central Balance turns them into physics. `implemented` marks what is fully playable in the MVP
// (Ravok, Gravion, Phantom); the rest are complete roster entries whose Supers are still to come.

import type { Build, BladeClass, Difficulty, Rarity, StatRatings } from '../core/types';
import { makeGenericMoves } from './abilities';
import { registerPlannedSupers, slugify, SUPERS } from './supers';

export interface VisualProfile {
  /** Silhouette family: the class visual language (sharp / thick / curved). */
  ringStyle: 'spikes' | 'plates' | 'fins';
  /** Number of major forms around the ring (3–8). */
  count: number;
  /** Secondary palette: each blade has its own, class colour stays an accent. */
  accent2: string;
  trim: string;
}

export interface BladeDef {
  id: string;
  name: string;
  class: BladeClass;
  role: string;
  fantasy: string;
  difficulty: Difficulty;
  rarity: Rarity;
  stats: StatRatings;
  basicMoves: [string, string, string];
  superPool: string[];
  ultimate: string | null;
  customizationProfile: { hints: string[]; recommended: Partial<Build> };
  visualProfile: VisualProfile;
  implemented: boolean;
}

const st = (
  attack: number, defense: number, stamina: number, weight: number, agility: number,
  stability: number, knockback: number, spinDamage: number, spinRetention: number,
): StatRatings => ({ attack, defense, stamina, weight, agility, stability, knockback, spinDamage, spinRetention });

export const BLADES: Record<string, BladeDef> = {};
export const BLADE_ORDER: string[] = [];

interface Row {
  id: string; name: string; cls: BladeClass; role: string; fantasy: string; difficulty: Difficulty; rarity: Rarity;
  stats: StatRatings; moves: [string, string, string]; supers: string[]; hints: string[]; recommended: Partial<Build>;
  visual: VisualProfile; implemented?: boolean; moveIds?: [string, string, string]; superIds?: string[];
}

function add(r: Row): void {
  const moveIds = r.moveIds ?? makeGenericMoves(r.id, r.cls, r.moves);
  const superIds = r.superIds ?? registerPlannedSupers(r.id, r.supers);
  // The last Super in a pool of 5+ is the blade's ultimate (Level 7+ tier).
  const ultimate = superIds.find((id) => SUPERS[id]?.ultimate) ?? null;
  BLADES[r.id] = {
    id: r.id, name: r.name, class: r.cls, role: r.role, fantasy: r.fantasy, difficulty: r.difficulty, rarity: r.rarity,
    stats: r.stats, basicMoves: moveIds, superPool: superIds, ultimate,
    customizationProfile: { hints: r.hints, recommended: r.recommended },
    visualProfile: r.visual, implemented: !!r.implemented,
  };
  BLADE_ORDER.push(r.id);
}

const spikes = (count: number, accent2: string, trim: string): VisualProfile => ({ ringStyle: 'spikes', count, accent2, trim });
const plates = (count: number, accent2: string, trim: string): VisualProfile => ({ ringStyle: 'plates', count, accent2, trim });
const fins = (count: number, accent2: string, trim: string): VisualProfile => ({ ringStyle: 'fins', count, accent2, trim });

// ======================================================================================== ATTACK (7)
add({
  id: 'ravok', name: 'Ravok', cls: 'ATTACK', role: 'Heavy Striker', fantasy: 'Hit first. Hit harder.', difficulty: 'MEDIUM', rarity: 'COMMON',
  stats: st(9, 4, 5, 8, 7, 5, 9, 8, 5), moves: ['Strike', 'Guard', 'Dash'], supers: [],
  hints: ['Heavy ring', 'Aggressive tip', 'Attack-focused core'],
  recommended: { ring: 'ring.heavy', tip: 'tip.aggressive', core: 'core.attack' },
  visual: spikes(5, '#ffcf3a', '#2b2f3a'), implemented: true,
  moveIds: ['ravok.strike', 'ravok.guard', 'ravok.dash'],
  superIds: ['ravok.dash-strike', 'ravok.shockwave', 'ravok.magnet-pull', 'ravok.rage-mode', 'ravok.blade-trap', 'ravok.overdrive', 'ravok.meteor-crash'],
});
add({
  id: 'blazefang', name: 'Blazefang', cls: 'ATTACK', role: 'Burst Attacker', fantasy: 'Speed creates impact.', difficulty: 'MEDIUM', rarity: 'COMMON',
  stats: st(8, 3, 5, 5, 9, 4, 8, 9, 5), moves: ['Fang Rush', 'Flare Guard', 'Side Burst'],
  supers: ['Inferno Rush', 'Flame Trail', 'Burnout', 'Fang Storm', 'Inferno Crash'],
  hints: ['Light attack ring', 'High-grip tip', 'Speed core'],
  recommended: { ring: 'ring.light-attack', tip: 'tip.high-grip', core: 'core.speed' },
  visual: spikes(4, '#ffb02e', '#3a1f1f'),
});
add({
  id: 'riftclaw', name: 'Riftclaw', cls: 'ATTACK', role: 'Precision Attacker', fantasy: 'One perfect hit.', difficulty: 'HARD', rarity: 'RARE',
  stats: st(9, 4, 4, 6, 9, 4, 8, 7, 4), moves: ['Claw Strike', 'Feint', 'Lunge'],
  supers: ['Critical Strike', 'Rift Dash', 'Mark Target', 'Execution', 'Rift Breaker'],
  hints: ['Balanced weight', 'Precision tip', 'Agility core'],
  recommended: { weight: 'weight.balanced', tip: 'tip.precision', core: 'core.agility' },
  visual: spikes(3, '#ff4d8f', '#2a2330'),
});
add({
  id: 'volt-reaper', name: 'Volt Reaper', cls: 'ATTACK', role: 'Speed Attacker', fantasy: 'Never stop moving.', difficulty: 'HARD', rarity: 'RARE',
  stats: st(8, 3, 5, 4, 10, 3, 7, 9, 5), moves: ['Volt Dash', 'Reaper Spin', 'Arc Dodge'],
  supers: ['Overcharge', 'Chain Strike', 'Electric Field', 'Flash Step', 'Volt Storm'],
  hints: ['Lightweight ring', 'Speed tip', 'Agility core'],
  recommended: { ring: 'ring.light', tip: 'tip.speed', core: 'core.agility' },
  visual: spikes(6, '#f5ff3a', '#1d2433'),
});
add({
  id: 'titan-breaker', name: 'Titan Breaker', cls: 'ATTACK', role: 'Heavy Destroyer', fantasy: 'Weight is power.', difficulty: 'EASY', rarity: 'EPIC',
  stats: st(10, 7, 4, 10, 2, 8, 10, 8, 4), moves: ['Titan Bash', 'Heavy Guard', 'Ground Charge'],
  supers: ['Earthquake', 'Crush Mode', 'Gravity Slam', 'Unstoppable', 'Titan Fall'],
  hints: ['Maximum weight', 'Heavy ring', 'Stability core'],
  recommended: { weight: 'weight.maximum', ring: 'ring.heavy', core: 'core.stability' },
  visual: spikes(4, '#ff8a3a', '#3a3f4a'),
});
add({
  id: 'inferno-x', name: 'Inferno X', cls: 'ATTACK', role: 'Sustained Attacker', fantasy: 'Constant pressure.', difficulty: 'MEDIUM', rarity: 'RARE',
  stats: st(8, 4, 6, 6, 6, 5, 7, 9, 6), moves: ['Burn Strike', 'Heat Guard', 'Flame Dash'],
  supers: ['Heatwave', 'Burning Spin', 'Inferno Ring', 'Overheat', 'Inferno Core'],
  hints: ['Medium-heavy ring', 'Attack core', 'Balanced tip'],
  recommended: { ring: 'ring.medium-heavy', core: 'core.attack', tip: 'tip.balanced' },
  visual: spikes(6, '#ffb02e', '#40201a'),
});
add({
  id: 'stormfang', name: 'Stormfang', cls: 'ATTACK', role: 'Combo Attacker', fantasy: 'The more you hit, the stronger you become.', difficulty: 'HARD', rarity: 'EPIC',
  stats: st(8, 4, 6, 5, 9, 4, 7, 9, 6), moves: ['Fang Combo', 'Storm Dash', 'Whiplash'],
  supers: ['Combo Rush', 'Storm Chain', 'Cyclone Strike', 'Momentum', 'Storm Breaker'],
  hints: ['Agile ring', 'Combo core', 'Speed tip'],
  recommended: { ring: 'ring.agile', core: 'core.combo', tip: 'tip.speed' },
  visual: spikes(5, '#4fd8ff', '#28303f'),
});

// ======================================================================================= DEFENSE (7)
add({
  id: 'gravion', name: 'Gravion', cls: 'DEFENSE', role: 'Heavy Tank', fantasy: 'Nothing moves it.', difficulty: 'EASY', rarity: 'COMMON',
  stats: st(5, 9, 7, 9, 3, 10, 4, 4, 8), moves: ['Bash', 'Block', 'Brace'], supers: [],
  hints: ['Heavy ring', 'Stability core', 'Defensive tip'],
  recommended: { ring: 'ring.heavy', core: 'core.stability', tip: 'tip.defensive' },
  visual: plates(6, '#38d6b8', '#222c45'), implemented: true,
  moveIds: ['gravion.bash', 'gravion.block', 'gravion.brace'],
  superIds: ['gravion.anchor', 'gravion.rebound', 'gravion.fortress', 'gravion.gravity-well', 'gravion.reflect', 'gravion.last-stand', 'gravion.iron-dome'],
});
add({
  id: 'iron-warden', name: 'Iron Warden', cls: 'DEFENSE', role: 'Counter Defender', fantasy: 'Attack me. I dare you.', difficulty: 'MEDIUM', rarity: 'RARE',
  stats: st(7, 9, 6, 8, 4, 9, 5, 7, 6), moves: ['Guard Bash', 'Counter', 'Brace'],
  supers: ['Perfect Reflect', 'Counter Zone', 'Iron Counter', 'Punish', 'Warden Protocol'],
  hints: ['Heavy defensive ring', 'Counter core'],
  recommended: { ring: 'ring.heavy-defensive', core: 'core.counter' },
  visual: plates(6, '#ffc94a', '#2a2f45'),
});
add({
  id: 'bastion-x', name: 'Bastion X', cls: 'DEFENSE', role: 'Fortress', fantasy: 'You cannot push me out.', difficulty: 'EASY', rarity: 'RARE',
  stats: st(4, 10, 8, 10, 2, 10, 2, 3, 9), moves: ['Wall Bash', 'Fortify', 'Brace'],
  supers: ['Fortress', 'Anchor Field', 'Barrier', 'Unbreakable', 'Bastion Core'],
  hints: ['Maximum weight', 'Stability parts'],
  recommended: { weight: 'weight.maximum', core: 'core.stability' },
  visual: plates(8, '#e8eefc', '#1f2a4a'),
});
add({
  id: 'stonecore', name: 'Stonecore', cls: 'DEFENSE', role: 'Immovable Tank', fantasy: 'Become the arena.', difficulty: 'EASY', rarity: 'EPIC',
  stats: st(4, 9, 9, 10, 1, 10, 2, 3, 9), moves: ['Stone Bash', 'Root', 'Center Hold'],
  supers: ['Earth Anchor', 'Stone Skin', 'Gravity Lock', 'Core Recovery', 'Mountain Form'],
  hints: ['Maximum weight', 'Stamina core'],
  recommended: { weight: 'weight.maximum', core: 'core.stamina' },
  visual: plates(5, '#c79a5b', '#2c3550'),
});
add({
  id: 'aegiron', name: 'Aegiron', cls: 'DEFENSE', role: 'Energy Defender', fantasy: 'Turn defense into power.', difficulty: 'MEDIUM', rarity: 'RARE',
  stats: st(6, 9, 7, 6, 5, 8, 5, 6, 7), moves: ['Energy Bash', 'Shield', 'Pulse Guard'],
  supers: ['Energy Shield', 'Reflect Pulse', 'Absorb', 'Energy Conversion', 'Aegis Nova'],
  hints: ['Balanced weight', 'Energy core', 'Defensive tip'],
  recommended: { weight: 'weight.balanced', core: 'core.energy', tip: 'tip.defensive' },
  visual: plates(6, '#36e6ff', '#1b2b55'),
});
add({
  id: 'guardian-prime', name: 'Guardian Prime', cls: 'DEFENSE', role: 'Balanced Defender', fantasy: 'Ready for anything.', difficulty: 'EASY', rarity: 'COMMON',
  stats: st(6, 8, 8, 7, 5, 8, 5, 5, 8), moves: ['Prime Bash', 'Guard', 'Recover'],
  supers: ['Guardian Shield', 'Recovery Pulse', 'Counter Guard', 'Last Stand', 'Guardian Mode'],
  hints: ['Balanced parts'], recommended: {},
  visual: plates(6, '#d7e0f5', '#26304f'),
});
add({
  id: 'gravity-rex', name: 'Gravity Rex', cls: 'DEFENSE', role: 'Arena Controller', fantasy: 'Control where the fight happens.', difficulty: 'HARD', rarity: 'EPIC',
  stats: st(6, 8, 7, 8, 3, 9, 6, 5, 7), moves: ['Gravity Bash', 'Pull', 'Center Lock'],
  supers: ['Gravity Well', 'Heavy Field', 'Orbit Lock', 'Reverse Gravity', 'Gravity Collapse'],
  hints: ['Heavy ring', 'Control core'],
  recommended: { ring: 'ring.heavy', core: 'core.control' },
  visual: plates(7, '#b072ff', '#1d2347'),
});

// ======================================================================================= STAMINA (7)
add({
  id: 'phantom', name: 'Phantom', cls: 'STAMINA', role: 'Evasive Spinner', fantasy: 'You can’t hit what you can’t find.', difficulty: 'HARD', rarity: 'COMMON',
  stats: st(5, 4, 10, 4, 10, 4, 5, 6, 10), moves: ['Spin Attack', 'Dodge', 'Drift'], supers: [],
  hints: ['Light ring', 'Agility core', 'Spin tip'],
  recommended: { ring: 'ring.light', core: 'core.agility', tip: 'tip.spin' },
  visual: fins(3, '#27e0ff', '#2a1650'), implemented: true,
  moveIds: ['phantom.spin-attack', 'phantom.dodge', 'phantom.drift'],
  superIds: ['phantom.hide-and-seek', 'phantom.phase-shift', 'phantom.decoy', 'phantom.spin-burst', 'phantom.time-slow', 'phantom.spin-drain', 'phantom.teleport-strike', 'phantom.black-hole'],
});
add({
  id: 'voidrunner', name: 'Voidrunner', cls: 'STAMINA', role: 'Speed Spinner', fantasy: 'Catch me if you can.', difficulty: 'MEDIUM', rarity: 'COMMON',
  stats: st(5, 3, 9, 3, 10, 3, 4, 6, 9), moves: ['Void Dash', 'Slipstream', 'Drift'],
  supers: ['Void Step', 'Speed Burst', 'Afterimage', 'Phase Run', 'Voidstorm'],
  hints: ['Ultra-light parts', 'Agility core'],
  recommended: { weight: 'weight.ultra-light', core: 'core.agility' },
  visual: fins(4, '#8a7bff', '#231a4f'),
});
add({
  id: 'nightveil', name: 'Nightveil', cls: 'STAMINA', role: 'Stealth Spinner', fantasy: 'Disappear. Reposition. Strike.', difficulty: 'HARD', rarity: 'RARE',
  stats: st(5, 4, 9, 4, 9, 4, 5, 7, 9), moves: ['Veil Strike', 'Fade', 'Shadow Drift'],
  supers: ['Cloak', 'Hide & Seek', 'Shadow Clone', 'Night Dash', 'Nightfall'],
  hints: ['Lightweight', 'Stealth core'],
  recommended: { weight: 'weight.light', core: 'core.stealth' },
  visual: fins(3, '#c05cff', '#1f1442'),
});
add({
  id: 'spectra', name: 'Spectra', cls: 'STAMINA', role: 'Illusion Spinner', fantasy: 'Make the opponent attack the wrong blade.', difficulty: 'HARD', rarity: 'EPIC',
  stats: st(5, 4, 8, 4, 10, 3, 4, 6, 8), moves: ['Mirror Spin', 'Fake Dash', 'Prism Drift'],
  supers: ['Decoy', 'Mirror Clone', 'Phase Shift', 'False Target', 'Spectral Storm'],
  hints: ['Agility parts', 'Lightweight', 'Deception core'],
  recommended: { ring: 'ring.agile', weight: 'weight.light', core: 'core.deception' },
  visual: fins(5, '#ff7bd9', '#2a1650'),
});
add({
  id: 'ghost-viper', name: 'Ghost Viper', cls: 'STAMINA', role: 'Dodge / Counter Spinner', fantasy: 'Let them attack first.', difficulty: 'HARD', rarity: 'RARE',
  stats: st(7, 4, 8, 4, 10, 4, 6, 8, 8), moves: ['Viper Strike', 'Dodge', 'Counter Spin'],
  supers: ['Venom Dash', 'Phase Shift', 'Counter Bite', 'Predator Mode', 'Ghost Strike'],
  hints: ['Agile attack ring', 'Speed tip'],
  recommended: { ring: 'ring.agile-attack', tip: 'tip.speed' },
  visual: fins(3, '#7bff9b', '#1c1a45'),
});
add({
  id: 'chrono', name: 'Chrono', cls: 'STAMINA', role: 'Time Controller', fantasy: 'Control the pace.', difficulty: 'HARD', rarity: 'EPIC',
  stats: st(4, 5, 9, 4, 8, 5, 4, 6, 9), moves: ['Chrono Spin', 'Slow Drift', 'Time Dash'],
  supers: ['Time Slow', 'Time Freeze', 'Rewind', 'Temporal Shift', 'Time Collapse'],
  hints: ['Spin core', 'Agile tip'],
  recommended: { core: 'core.spin', tip: 'tip.agile' },
  visual: fins(6, '#ffe27a', '#2a1a52'),
});
add({
  id: 'nebula-drift', name: 'Nebula Drift', cls: 'STAMINA', role: 'Endurance Specialist', fantasy: 'The longer the fight, the stronger I become.', difficulty: 'MEDIUM', rarity: 'LEGENDARY',
  stats: st(4, 6, 10, 5, 7, 6, 4, 5, 10), moves: ['Nebula Spin', 'Orbit', 'Drift Guard'],
  supers: ['Spin Burst', 'Spin Drain', 'Endurance Mode', 'Energy Recover', 'Nebula Collapse'],
  hints: ['Maximum stamina', 'Balanced stability'],
  recommended: { core: 'core.max-stamina' },
  visual: fins(4, '#7b9bff', '#1e1948'),
});

// ------------------------------------------------------------------------------------------- queries
export const MVP_BLADES = BLADE_ORDER.filter((id) => BLADES[id].implemented);
export const bladesByClass = (c: BladeClass): BladeDef[] => BLADE_ORDER.map((id) => BLADES[id]).filter((b) => b.class === c);
export function getBlade(id: string): BladeDef {
  const b = BLADES[id];
  if (!b) throw new Error(`Unknown blade: ${id}`);
  return b;
}
export { slugify };
