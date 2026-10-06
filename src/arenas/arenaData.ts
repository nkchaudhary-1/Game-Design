// The eight arenas (build spec §11) as data. Design rule: simple circular geometry + ONE major gameplay
// mechanic + strong visual identity. Only Core Pit is playable in the MVP; the rest are complete data
// entries (mechanic, who it favours, how to exploit and counter it) ready for their phase.

import type { BladeClass } from '../core/types';
import { TUNING } from '../core/Balance';

export interface ArenaDef {
  id: string;
  name: string;
  tagline: string;
  /** The one main mechanic. */
  mechanic: string;
  /** How the mechanic changes movement. */
  movement: string;
  favours: BladeClass | null;
  exploit: string;
  counter: string;
  implemented: boolean;
  radius: number;
  /** Palette: floor, ring segments, rim, accent. */
  palette: { floor: string; segment: string; rim: string; accent: string };
}

const R = () => TUNING.RIM;

export const ARENAS: Record<string, ArenaDef> = {};
export const ARENA_ORDER: string[] = [];

function arena(a: Omit<ArenaDef, 'radius'>): void {
  ARENAS[a.id] = { ...a, radius: R() };
  ARENA_ORDER.push(a.id);
}

arena({
  id: 'core-pit', name: 'Core Pit', tagline: 'Pure blade combat.',
  mechanic: 'A clean open pit with no hazards: the bowl pulls everyone towards the centre.',
  movement: 'None beyond the pit itself; skill decides.',
  favours: null, exploit: 'Control the centre, push from the inside towards the wall.', counter: 'Stay off the rim and out of the middle brawl.',
  implemented: true,
  palette: { floor: '#283766', segment: '#34467f', rim: '#e9eefb', accent: '#ffcf3a' },
});
arena({
  id: 'elevation-ring', name: 'Elevation Ring', tagline: 'High ground wins.',
  mechanic: 'Raised platforms, a lower centre and ramps.', movement: 'Ramps launch; drops add impact.',
  favours: 'ATTACK', exploit: 'Drop attacks from the platforms.', counter: 'Stay in the low centre, away from ramps.',
  implemented: false,
  palette: { floor: '#2a2740', segment: '#34304f', rim: '#f3e9d6', accent: '#ff8a3a' },
});
arena({
  id: 'magnetic-core', name: 'Magnetic Core', tagline: 'The middle pulls back.',
  mechanic: 'A central magnet that pulls and pushes.', movement: 'Curved paths towards (or away from) the centre.',
  favours: 'DEFENSE', exploit: 'Hold the centre while it drags opponents in.', counter: 'Use the push phase to slip past.',
  implemented: false,
  palette: { floor: '#162a3d', segment: '#1d3850', rim: '#dff1ff', accent: '#2f86ff' },
});
arena({
  id: 'crystal-arena', name: 'Crystal Arena', tagline: 'Smash for buffs.',
  mechanic: 'Breakable crystals that spawn temporary buffs.', movement: 'Players divert to claim crystals.',
  favours: 'STAMINA', exploit: 'Grab buffs while the opponent is busy.', counter: 'Contest crystals, deny the buff.',
  implemented: false,
  palette: { floor: '#241a40', segment: '#2e2252', rim: '#eadbff', accent: '#27e0ff' },
});
arena({
  id: 'shift-floor', name: 'Shift Floor', tagline: 'The ground moves.',
  mechanic: 'Five to eight large floor sections that move and rotate, with occasional gaps.', movement: 'Routes keep changing.',
  favours: 'STAMINA', exploit: 'Ambush from shifting sections.', counter: 'Stay on the larger, slower sections.',
  implemented: false,
  palette: { floor: '#1c2b33', segment: '#26404b', rim: '#e3f6f2', accent: '#38d6b8' },
});
arena({
  id: 'wind-tunnel', name: 'Wind Tunnel', tagline: 'Ride the lanes.',
  mechanic: 'Directional airflow zones with speed lanes.', movement: 'Pushes and speed boosts along visible lanes.',
  favours: 'ATTACK', exploit: 'Use speed lanes to get a running start.', counter: 'Cross the wind, never ride into it.',
  implemented: false,
  palette: { floor: '#1a2f40', segment: '#22405a', rim: '#e6f4ff', accent: '#6fe0ff' },
});
arena({
  id: 'lava-ring', name: 'Lava Ring', tagline: 'Risky shortcuts.',
  mechanic: 'A lava channel round a safe centre, with vents.', movement: 'Lava damages and launches; shortcuts cross it.',
  favours: 'ATTACK', exploit: 'Knock opponents into the lava channel.', counter: 'Stay in the safe centre and let them come.',
  implemented: false,
  palette: { floor: '#2f1f22', segment: '#40292d', rim: '#ffe3cf', accent: '#ff5a36' },
});
arena({
  id: 'gravity-well', name: 'Gravity Well', tagline: 'Weight changes everything.',
  mechanic: 'A central well with low-, high- and orbit-gravity zones.', movement: 'Floaty, heavy or curving depending on the zone.',
  favours: 'DEFENSE', exploit: 'Fight in the high-gravity zone where collisions are stronger.', counter: 'Use low gravity to out-run, orbit to flank.',
  implemented: false,
  palette: { floor: '#1d1a3a', segment: '#272250', rim: '#e4dcff', accent: '#a05cff' },
});

export const getArena = (id: string): ArenaDef => {
  const a = ARENAS[id];
  if (!a) throw new Error(`Unknown arena: ${id}`);
  return a;
};
