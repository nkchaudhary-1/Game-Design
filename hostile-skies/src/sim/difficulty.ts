export type Difficulty = 'cadet' | 'pilot' | 'ace';

export interface Tuning {
  label: string;
  blurb: string;
  /** Alien hit points multiplier. */
  hp: number;
  /** Damage dealt to the player and to cities. */
  damage: number;
  /** Max random aim error of alien fire, radians. */
  aimErr: number;
  /** How well aliens lead a moving target: 0 = fire at where you are, 1 = perfect lead. */
  lead: number;
  /** Alien rate of fire. */
  fireRate: number;
  /** Alien group size multiplier. */
  count: number;
  /** Scales the breather between waves. */
  breather: number;
  /** Cannon aim assist: how strongly rounds bend towards the selected target when you are already close (0 = none). */
  aimAssist: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  cadet: { label: 'Cadet', blurb: 'Forgiving aliens, fewer of them, and a little cannon aim assist.', hp: 0.75, damage: 0.6, aimErr: 0.055, lead: 0.45, fireRate: 0.7, count: 0.8, breather: 1.3, aimAssist: 0.3 },
  pilot: { label: 'Pilot', blurb: 'The intended fight.', hp: 1, damage: 1, aimErr: 0.03, lead: 0.8, fireRate: 1, count: 1, breather: 1, aimAssist: 0 },
  ace: { label: 'Ace', blurb: 'Sharper aim, tougher hulls, more of them.', hp: 1.3, damage: 1.3, aimErr: 0.014, lead: 1, fireRate: 1.3, count: 1.25, breather: 0.8, aimAssist: 0 },
};
