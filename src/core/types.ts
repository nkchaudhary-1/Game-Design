// Shared types for Spinblade Arena. No runtime dependencies: this file is imported by the headless
// simulation (Node) as well as the browser UI.

export type BladeClass = 'ATTACK' | 'DEFENSE' | 'STAMINA';
export type Rarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

/** The nine design ratings from the build spec (1–10 each). */
export const STAT_KEYS = [
  'attack', 'defense', 'stamina', 'weight', 'agility', 'stability', 'knockback', 'spinDamage', 'spinRetention',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatRatings = Record<StatKey, number>;

export const STAT_LABELS: Record<StatKey, string> = {
  attack: 'Attack', defense: 'Defense', stamina: 'Stamina', weight: 'Weight', agility: 'Agility',
  stability: 'Stability', knockback: 'Knockback', spinDamage: 'Spin Damage', spinRetention: 'Spin Retention',
};

export type PartSlot = 'ring' | 'core' | 'weight' | 'tip';
export const PART_SLOTS: PartSlot[] = ['ring', 'core', 'weight', 'tip'];
export type Build = Record<PartSlot, string>;

/** 2D point on the arena floor (x, z of the 3D world). */
export interface V2 { x: number; z: number }

export const CLASS_COLORS: Record<BladeClass, { main: string; dark: string; light: string; label: string }> = {
  ATTACK: { main: '#fc2c33', dark: '#8a1018', light: '#ff8a85', label: 'Attack' },
  DEFENSE: { main: '#2f7bff', dark: '#0b3aa8', light: '#9cc4ff', label: 'Defense' },
  STAMINA: { main: '#a05cff', dark: '#5a22b0', light: '#27e0ff', label: 'Stamina' },
};

export const CLASS_BEATS: Record<BladeClass, BladeClass> = {
  ATTACK: 'STAMINA', STAMINA: 'DEFENSE', DEFENSE: 'ATTACK',
};
export const CLASS_COUNTER: Record<BladeClass, BladeClass> = {
  STAMINA: 'ATTACK', DEFENSE: 'STAMINA', ATTACK: 'DEFENSE',
};

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const TAU = Math.PI * 2;
