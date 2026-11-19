import { CollisionWorld, TAG_GLASS, type Solid } from '../collision';

// ───────────────────────── palette (flat, muted, warm) ─────────────────────────
export const C = {
  offWhite: 0xf3ede0, beige: 0xddcfb4, sand: 0xe6d9bd, sage: 0x9fb59b, sageDark: 0x7c9678,
  blue: 0x8ea8be, blueDark: 0x6f8aa3, terra: 0xc7714e, terraDark: 0xa45a3c, yellow: 0xf1dd98,
  grey: 0xbdbab2, greyDark: 0x8e8d89, asphalt: 0x7d8082, charcoal: 0x2f3236, white: 0xfbf8f1,
  wood: 0xc9a77c, woodDark: 0x8c6a47, glass: 0xbfd9e6, grass: 0xafc79d, grassDark: 0x9ab589,
  grassLight: 0xbdd3ab, path: 0xe4d8be, tile: 0xe9e4d8, rug: 0xd69a7c, rugBlue: 0x9db6c9,
  roofDark: 0x5d6670, roofTerra: 0xb5593b, leaf: 0x86a67c, leafDark: 0x6d8f66, leafLight: 0xa4c18f,
  gold: 0xf0c04a, red: 0xcf6a5b, mint: 0xb8d6c4, plum: 0x8c6f86,
} as const;

// ───────────────────────── types shared with the client ─────────────────────────
export const PK = { BOX: 0, CYL: 1, CONE: 2, ICO: 3, GABLE: 4, SPHERE: 5 } as const;
export type PieceKind = (typeof PK)[keyof typeof PK];

export interface Piece {
  k: PieceKind;
  x: number; y: number; z: number;     // center
  sx: number; sy: number; sz: number;  // full size
  ry: number;                          // yaw (visual only)
  color: number;
  group: number;
  alpha: number;
  cast: boolean;
  glow: boolean;   // emissive at night (lamp heads, lit windows)
  wind: boolean;   // sways in the wind (foliage)
}

export interface DoorDef {
  id: number; solid: number;
  hx: number; hz: number;      // hinge point (world)
  dx: number; dz: number;      // unit vector along the closed leaf, from the hinge
  nx: number; nz: number;      // unit vector the leaf swings towards
  width: number; y0: number; height: number; thick: number;
  color: number; group: number; name: string;
  cx: number; cz: number;      // centre of the closed leaf
}
export interface SeatDef { id: number; x: number; y: number; z: number; yaw: number; group: number; name: string }
export interface SwitchDef { id: number; x: number; y: number; z: number; group: number; name: string }
export interface LampDef { id: number; switchId: number; x: number; y: number; z: number; color: number; group: number }
export interface Label { text: string; x: number; y: number; z: number; w: number; h: number; ry: number; bg: number; fg: number; group: number }
export interface FoundDef { id: number; x: number; y: number; z: number; name: string; text: string; group: number }
export type InteractKind = 'door' | 'knock' | 'switch' | 'seat' | 'liftCall' | 'liftPanel' | 'bell' | 'found' | 'info';
export interface Interactable {
  id: number; kind: InteractKind; x: number; y: number; z: number;
  ref: number; label: string; group: number; text?: string;
}
export interface Building {
  id: number; name: string; x0: number; z0: number; x1: number; z1: number;
  floors: number[];        // floor-top y per level (incl. roof level for apartments)
  levelGroups: number[];   // group id per level
}
export interface GroupInfo { building: number; level: number }
export interface Zone { name: string; x0: number; z0: number; x1: number; z1: number; prio: number; building?: number; y0?: number; y1?: number }
export interface MapRect { x0: number; z0: number; x1: number; z1: number; color: number; kind: 'road' | 'building' | 'green' | 'path' | 'water' }

export interface LiftPart {
  rel: [number, number, number, number, number, number]; // minX,minY,minZ,maxX,maxY,maxZ relative to (cx, cabFloorTop, cz)
  color: number; solid: number;
  leaf: -1 | 0 | 1;     // door leaf sliding to the left (-x) / right (+x) / not a leaf
  noCam?: boolean;
}
export interface LiftDef {
  cx: number; cz: number; hw: number; hd: number;
  floors: number[]; names: string[];
  doorW: number; doorH: number; slide: number;
  cab: LiftPart[];
  landings: { floor: number; group: number; parts: LiftPart[] }[];   // landing parts use absolute world extents in `rel`
  callPos: { x: number; y: number; z: number }[];
  panelPos: { x: number; y: number; z: number };
  indicatorPos: { x: number; y: number; z: number }[]; // per landing
  cabIndicatorPos: { x: number; y: number; z: number };
}

export interface MapDef {
  world: CollisionWorld;
  pieces: Piece[];
  doors: DoorDef[];
  seats: SeatDef[];
  switches: SwitchDef[];
  lamps: LampDef[];
  labels: Label[];
  found: FoundDef[];
  interactables: Interactable[];
  buildings: Building[];
  groups: GroupInfo[];
  zones: Zone[];
  mapRects: MapRect[];
  lift: LiftDef;
  spawns: { x: number; z: number; yaw: number }[];
  streetLamps: { x: number; y: number; z: number }[];
  chimneys: { x: number; y: number; z: number }[];
  bounds: { x0: number; z0: number; x1: number; z1: number };
}

export interface BoxOpts {
  solid?: boolean; group?: number; tag?: number; cast?: boolean; alpha?: number;
  noPiece?: boolean; dyn?: boolean; glow?: boolean;
}

/** Local frame: u runs along a building's front wall, v runs inward. Rotations are quarter-turns so boxes stay axis-aligned. */
export class Frame {
  constructor(readonly ox: number, readonly oz: number, readonly rot: 0 | 1 | 2 | 3 = 0, readonly mirror = false) {}
  vec(du: number, dv: number): [number, number] {
    if (this.mirror) du = -du;
    switch (this.rot) {
      case 0: return [du, dv];
      case 1: return [-dv, du];
      case 2: return [-du, -dv];
      default: return [dv, -du];
    }
  }
  p(u: number, v: number): [number, number] {
    const [x, z] = this.vec(u, v);
    return [this.ox + x, this.oz + z];
  }
  rect(u0: number, v0: number, u1: number, v1: number): [number, number, number, number] {
    const [xa, za] = this.p(u0, v0), [xb, zb] = this.p(u1, v1);
    return [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)];
  }
}

export interface Opening { a: number; b: number; lo: number; hi: number; glass?: boolean }
export interface WallOpts extends BoxOpts { inner?: number; outerSide?: 1 | -1 }

export class MB {
  world = new CollisionWorld();
  pieces: Piece[] = [];
  doors: DoorDef[] = [];
  seats: SeatDef[] = [];
  switches: SwitchDef[] = [];
  lamps: LampDef[] = [];
  labels: Label[] = [];
  found: FoundDef[] = [];
  interactables: Interactable[] = [];
  buildings: Building[] = [];
  groups: GroupInfo[] = [];
  zones: Zone[] = [];
  mapRects: MapRect[] = [];
  spawns: { x: number; z: number; yaw: number }[] = [];
  streetLamps: { x: number; y: number; z: number }[] = [];
  chimneys: { x: number; y: number; z: number }[] = [];

  newGroup(building: number, level: number): number {
    this.groups.push({ building, level });
    return this.groups.length - 1;
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, o: BoxOpts = {}): Solid | undefined {
    if (x1 - x0 < 1e-5 || y1 - y0 < 1e-5 || z1 - z0 < 1e-5) return undefined;
    const group = o.group ?? -1;
    if (!o.noPiece)
      this.pieces.push({
        k: PK.BOX, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
        sx: x1 - x0, sy: y1 - y0, sz: z1 - z0, ry: 0, color, group, alpha: o.alpha ?? 1, cast: o.cast ?? true, glow: o.glow ?? false, wind: false,
      });
    if (o.solid ?? true)
      return this.world.add({ minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1, group, tag: o.tag ?? 0, dyn: o.dyn ?? false });
    return undefined;
  }
  /** Box from a centre + size. */
  cbox(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: number, o: BoxOpts = {}) {
    return this.box(cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + sy, cz + sz / 2, color, o);
  }
  fbox(f: Frame, u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, color: number, o: BoxOpts = {}) {
    const [x0, z0, x1, z1] = f.rect(u0, v0, u1, v1);
    return this.box(x0, y0, z0, x1, y1, z1, color, o);
  }
  /** Visual-only primitive (cylinder/cone/ico/gable/sphere). */
  prim(k: PieceKind, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, o: { ry?: number; group?: number; cast?: boolean; alpha?: number; glow?: boolean; wind?: boolean } = {}) {
    this.pieces.push({ k, x, y, z, sx, sy, sz, ry: o.ry ?? 0, color, group: o.group ?? -1, alpha: o.alpha ?? 1, cast: o.cast ?? true, glow: o.glow ?? false, wind: o.wind ?? false });
  }

  interact(kind: InteractKind, x: number, y: number, z: number, ref: number, label: string, group = -1, text?: string): number {
    const id = this.interactables.length;
    this.interactables.push({ id, kind, x, y, z, ref, label, group, text });
    return id;
  }
  label(text: string, x: number, y: number, z: number, w: number, h: number, ry: number, bg: number, fg: number, group = -1) {
    this.labels.push({ text, x, y, z, w, h, ry, bg, fg, group });
  }

  /** One straight wall run along a local axis with openings (doorways, windows). */
  wall(f: Frame, axis: 'u' | 'v', at: number, a: number, b: number, y0: number, y1: number, t: number,
       color: number, openings: Opening[] = [], o: WallOpts = {}) {
    const ops = [...openings].sort((p, q) => p.a - q.a);
    let cur = a;
    for (const op of ops) {
      this.wbox(f, axis, at, cur, op.a, y0, y1, t, color, o);
      this.wbox(f, axis, at, op.a, op.b, y0, op.lo, t, color, o);
      this.wbox(f, axis, at, op.a, op.b, op.hi, y1, t, color, o);
      if (op.glass) {
        const g = 0.02;
        const rect = axis === 'u' ? f.rect(op.a, at - g, op.b, at + g) : f.rect(at - g, op.a, at + g, op.b);
        this.box(rect[0], op.lo, rect[1], rect[2], op.hi, rect[3], C.glass, { group: o.group, alpha: 0.32, cast: false, tag: TAG_GLASS, glow: true });
        const sr = axis === 'u' ? f.rect(op.a - 0.07, at - t / 2 - 0.08, op.b + 0.07, at + t / 2 + 0.08) : f.rect(at - t / 2 - 0.08, op.a - 0.07, at + t / 2 + 0.08, op.b + 0.07);
        this.box(sr[0], op.lo - 0.07, sr[1], sr[2], op.lo, sr[3], C.offWhite, { group: o.group, solid: false });
      }
      cur = op.b;
    }
    this.wbox(f, axis, at, cur, b, y0, y1, t, color, o);
  }
  private wbox(f: Frame, axis: 'u' | 'v', at: number, a: number, b: number, ya: number, yb: number, t: number, color: number, o: WallOpts) {
    if (b - a < 1e-4 || yb - ya < 1e-4) return;
    const rect = (c0: number, c1: number) => (axis === 'u' ? f.rect(a, c0, b, c1) : f.rect(c0, a, c1, b));
    const lo = at - t / 2, hi = at + t / 2;
    if (o.inner === undefined) {
      const [x0, z0, x1, z1] = rect(lo, hi);
      this.box(x0, ya, z0, x1, yb, z1, color, o);
      return;
    }
    const os = o.outerSide ?? 1;
    const [ox0, oz0, ox1, oz1] = os > 0 ? rect(at, hi) : rect(lo, at);
    const [ix0, iz0, ix1, iz1] = os > 0 ? rect(lo, at) : rect(at, hi);
    const [sx0, sz0, sx1, sz1] = rect(lo, hi);
    this.box(sx0, ya, sz0, sx1, yb, sz1, color, { ...o, noPiece: true });
    this.box(ox0, ya, oz0, ox1, yb, oz1, color, { ...o, solid: false });
    this.box(ix0, ya, iz0, ix1, yb, iz1, o.inner, { ...o, solid: false });
  }

  /** A swinging door in a wall opening. Returns its definition (id doubles as server state key). */
  door(f: Frame, axis: 'u' | 'v', at: number, a: number, w: number, y0: number, h: number,
       o: { hingeA: boolean; swing: 1 | -1; color: number; group: number; name: string; thick?: number }): DoorDef {
    const th = o.thick ?? 0.08;
    const rect = axis === 'u' ? f.rect(a, at - th / 2, a + w, at + th / 2) : f.rect(at - th / 2, a, at + th / 2, a + w);
    const solid = this.box(rect[0], y0, rect[1], rect[2], y0 + h, rect[3], o.color, { group: o.group, dyn: true, noPiece: true })!;
    const hl = o.hingeA ? a : a + w;
    const [hx, hz] = axis === 'u' ? f.p(hl, at) : f.p(at, hl);
    const sgn = o.hingeA ? 1 : -1;
    const [dx, dz] = axis === 'u' ? f.vec(sgn, 0) : f.vec(0, sgn);
    const [nx, nz] = axis === 'u' ? f.vec(0, o.swing) : f.vec(o.swing, 0);
    const def: DoorDef = {
      id: this.doors.length, solid: solid.id, hx, hz, dx, dz, nx, nz, width: w, y0, height: h, thick: th,
      color: o.color, group: o.group, name: o.name, cx: hx + dx * w / 2, cz: hz + dz * w / 2,
    };
    this.doors.push(def);
    this.interact('door', def.cx, y0 + 1.1, def.cz, def.id, o.name, o.group);
    return def;
  }

  /** Decorative, locked door panel on a facade (solid wall behind it). Knockable. */
  lockedDoor(f: Frame, axis: 'u' | 'v', at: number, a: number, w: number, y0: number, h: number,
             color: number, group: number, name: string, wallT: number, outerSide: 1 | -1) {
    const proud = wallT / 2 + 0.04;
    const c = at + outerSide * proud;
    const rect = axis === 'u' ? f.rect(a, c - 0.04, a + w, c + 0.04) : f.rect(c - 0.04, a, c + 0.04, a + w);
    this.box(rect[0], y0, rect[1], rect[2], y0 + h, rect[3], color, { group, solid: false });
    const [cx, cz] = axis === 'u' ? f.p(a + w / 2, c + outerSide * 0.3) : f.p(c + outerSide * 0.3, a + w / 2);
    this.interact('knock', cx, y0 + 1.1, cz, 0, name, group);
  }
}
