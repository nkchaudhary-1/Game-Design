// Simulation-side arena: the force field of the pit, the rim, spawn points. No rendering here.

import { TUNING, wallGrip } from '../core/Balance';
import type { ArenaDef } from './arenaData';
import type { Hazard } from './hazards';

export class Arena {
  readonly hazards: Hazard[] = [];
  constructor(readonly def: ArenaDef) {}

  get radius(): number { return this.def.radius; }

  /** Is this point past the rim (ring-out)? */
  isOut(x: number, z: number): boolean {
    return x * x + z * z > this.radius * this.radius;
  }

  /**
   * Bowl pull towards the centre (acceleration). It grows linearly with distance, then ramps up steeply at
   * the wall, and the wall's grip scales with the blade's spin: high-spin blades ride it, low-spin ones slide off.
   */
  pit(x: number, z: number, spin: number): { ax: number; az: number } {
    const d = Math.hypot(x, z);
    if (d < 1e-4) return { ax: 0, az: 0 };
    const u = d / this.radius;
    const pull = TUNING.BOWL * u + TUNING.LIP * Math.pow(u, 6) * wallGrip(spin);
    return { ax: (-pull * x) / d, az: (-pull * z) / d };
  }

  /** Clockwise orbit push (viewed from above), so blades circle instead of grinding in the middle. */
  swirl(x: number, z: number): { ax: number; az: number } {
    const d = Math.hypot(x, z);
    if (d < 1e-4) return { ax: 0, az: 0 };
    const u = d / this.radius;
    return { ax: (TUNING.SWIRL * u * -z) / d, az: (TUNING.SWIRL * u * x) / d };
  }

  /** Spawn point for `slot` of `count` players: evenly spaced on a circle at mid-radius, slot 0 at the bottom. */
  spawn(slot: number, count: number): { x: number; z: number; angle: number } {
    const order = count <= 2 ? [Math.PI / 2, -Math.PI / 2] : [Math.PI / 2, -Math.PI / 2, 0, Math.PI];
    const a = order[slot % order.length];
    return { x: Math.cos(a) * TUNING.SPAWN_R, z: Math.sin(a) * TUNING.SPAWN_R, angle: a };
  }

  /** Visual dish: the floor sinks towards the centre. Used only by the renderer (physics stays planar). */
  dishDepth(r: number): number {
    const u = Math.min(1, r / this.radius);
    return 0.9 * (1 - u * u);
  }
}
