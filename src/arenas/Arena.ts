// Simulation-side arena: the force field of the pit, the rim, spawn points. No rendering here.

import { TUNING, wallGrip } from '../core/Balance';
import type { ArenaDef } from './arenaData';
import type { Rng } from '../core/Rng';
import { createHazards, type Hazard, type Pickup } from './hazards';
import type { Match } from '../combat/Match';

export class Arena {
  readonly hazards: Hazard[];
  constructor(readonly def: ArenaDef, rng?: Rng) {
    this.hazards = rng ? createHazards(def.id, rng) : [];
  }

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

  /** Height the arena's mechanic adds on top of the dish (Elevation Ring's platforms); 0 everywhere else. */
  heightAt(x: number, z: number): number {
    let h = 0;
    for (const k of this.hazards) if (k.heightAt) h += k.heightAt(x, z);
    return h;
  }

  /** Where the floor is, for drawing blades on it. */
  surfaceY(x: number, z: number): number {
    return -this.dishDepth(Math.hypot(x, z)) + this.heightAt(x, z);
  }

  /** 0–1: how much a blade should keep away from this spot right now (lava, an open gap, a downwind rim…). */
  danger(x: number, z: number, match: Match): number {
    let d = 0;
    for (const k of this.hazards) if (k.danger) d = Math.max(d, k.danger(x, z, match));
    return d;
  }

  /** Things worth a detour for a CPU (Crystal Arena's crystals). */
  pickups(match: Match): Pickup[] {
    const out: Pickup[] = [];
    for (const k of this.hazards) if (k.pickups) out.push(...k.pickups(match));
    return out;
  }
}
