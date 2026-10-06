// Arena hazards. Each arena has ONE mechanic; Core Pit has none. The interface exists so the other seven
// arenas (data in arenaData.ts) can be added without touching the combat loop.

import type { Match } from '../combat/Match';

export interface Hazard {
  id: string;
  /** Called every fixed step before physics. May push blades, drain spin, etc. */
  update(match: Match, dt: number): void;
}
