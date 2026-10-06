// Thin abstraction over Rapier 3D. Gameplay is planar (blades slide on the XZ plane, Y is locked) but
// everything runs through a real rigid-body world: integration, collision detection and resolution,
// restitution/friction, and a genuine fall when a blade leaves the arena.

import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let initPromise: Promise<void> | null = null;
/** Rapier's WASM must be initialised once before any world exists. Safe to call repeatedly. */
export function initPhysics(): Promise<void> {
  return (initPromise ??= RAPIER.init());
}

const GROUP = { BLADE: 0x0001, GROUND: 0x0002, GHOST: 0x0004 } as const;
const groups = (membership: number, filter: number) => (((membership << 16) | filter) >>> 0);
export const BLADE_GROUPS = groups(GROUP.BLADE, GROUP.BLADE | GROUP.GROUND);
/** Ghost blades (Phase Shift, Meteor Crash leap) touch the ground but pass through other blades. */
export const GHOST_GROUPS = groups(GROUP.GHOST, GROUP.GROUND);
const GROUND_GROUPS = groups(GROUP.GROUND, GROUP.BLADE | GROUP.GHOST);

export interface BladeBodyOptions {
  x: number;
  z: number;
  radius: number;
  height: number;
  mass: number;
  restitution: number;
  friction: number;
  linearDamping: number;
}

export interface BladeBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Resting height of the blade centre above the floor. */
  y: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly queue = new RAPIER.EventQueue(true);
  private readonly colliderOwners = new Map<number, number>();

  constructor(readonly dt: number, gravity = -34) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = dt;
  }

  /** The arena floor: a finite disc. Past its edge there is nothing, so a blade really falls. */
  addGround(radius: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(0.5, radius)
      .setTranslation(0, -0.5, 0)
      .setFriction(0)
      .setRestitution(0)
      .setCollisionGroups(GROUND_GROUPS);
    return this.world.createCollider(desc);
  }

  /**
   * A blade body: dynamic, translation locked to the XZ plane, rotation free only around Y (its spin).
   * The body hovers a hair above the floor so it never drags on it.
   */
  createBlade(ownerSlot: number, o: BladeBodyOptions): BladeBody {
    const y = o.height / 2 + 0.03;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(o.x, y, o.z)
      .setLinearDamping(o.linearDamping)
      .setAngularDamping(0)
      .setCanSleep(false)
      .enabledRotations(false, true, false)
      .enabledTranslations(true, false, true);
    const body = this.world.createRigidBody(desc);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(o.height / 2, o.radius)
        .setMass(o.mass)
        .setRestitution(o.restitution)
        .setFriction(o.friction)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(BLADE_GROUPS),
      body,
    );
    this.colliderOwners.set(collider.handle, ownerSlot);
    return { body, collider, y };
  }

  /** Let a blade that has left the arena fall for real. */
  releaseToFall(b: BladeBody): void {
    b.body.setEnabledTranslations(true, true, true, true);
  }

  setGhost(b: BladeBody, ghost: boolean): void {
    b.collider.setCollisionGroups(ghost ? GHOST_GROUPS : BLADE_GROUPS);
  }

  /** Advance one fixed step and return the (slotA, slotB) pairs whose colliders started touching. */
  step(): Array<[number, number]> {
    this.world.step(this.queue);
    const pairs: Array<[number, number]> = [];
    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.colliderOwners.get(h1);
      const b = this.colliderOwners.get(h2);
      if (a !== undefined && b !== undefined && a !== b) pairs.push([a, b]);
    });
    return pairs;
  }

  dispose(): void {
    this.queue.free();
    this.world.free();
  }
}
