"""Geometry kit for the Spinblade blade models (Blender / bpy).

A blade is a stack of layers, the way the layered turbine-style spinners are built: a dark base plate with a jagged
rim, a layer of swept blades in the main colour, a layer of long jagged blades on top, a ring of chunky plates
round a bezelled emblem disc.  The weight disc, emblem cap and performance tip stay procedural in the game because
the player can swap those parts.

Units are normalised: the blade's outer radius is 1.0, the tip touches z = 0 and the model is about 0.6 tall.
The blade spins CLOCKWISE seen from above, so the leading edge of every blade is on its clockwise side.
"""
import math
import bmesh
import bpy

TAU = math.tau


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ objects
def finish(name, bm, sharp_deg=38, bevel=0.0, segments=1):
    """Mark hard edges, smooth the rest, optionally bevel, and hand back an object."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ang = math.radians(sharp_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > ang:
            e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    if bevel:
        bevel_edges(obj, bevel, segments)
    smooth_by_angle(obj)
    return obj


def smooth_by_angle(obj, deg=38):
    """Smooth shading that keeps the hard edges hard (flat faces stay flat, bevels read as rounded)."""
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(deg))


def bevel_edges(obj, width, segments=1, angle=36):
    bpy.context.view_layer.objects.active = obj
    md = obj.modifiers.new('bevel', 'BEVEL')
    md.width = width
    md.segments = segments
    md.limit_method = 'ANGLE'
    md.angle_limit = math.radians(angle)
    bpy.ops.object.modifier_apply(modifier=md.name)


def extrude(bm, face, dz):
    """Push a face up (or down) into a solid; returns the new top face."""
    r = bmesh.ops.extrude_face_region(bm, geom=[face])
    verts = [v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=verts, vec=(0, 0, dz))
    top = [f for f in r['geom'] if isinstance(f, bmesh.types.BMFace)]
    return top[0] if top else None


def prism(bm, pts, z, dz, taper=0.0):
    """A closed solid from an outline of (x, y) points: the bottom at z, `dz` tall.  taper pulls the top outline in."""
    n = len(pts)
    if n < 3:
        return
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    bot = [bm.verts.new((x, y, z)) for (x, y) in pts]
    top = [bm.verts.new((x + (cx - x) * taper, y + (cy - y) * taper, z + dz)) for (x, y) in pts]
    try:
        bm.faces.new(list(reversed(bot)))
        bm.faces.new(top)
    except ValueError:
        pass
    for i in range(n):
        j = (i + 1) % n
        try:
            bm.faces.new((bot[i], bot[j], top[j], top[i]))
        except ValueError:
            pass


# ------------------------------------------------------------------------------------------------ shard outlines
def shard_outline(r0, r1, a0, sweep, hw, gam=1.0, pw=2.0, qw=0.8, lead=0.7, notch=0.0, nz=4, tipcut=0.0, wave=0.0,
                  wave_n=2, n=46, hook=0.0, spin=-1):
    """Outline (x, y) of one swept blade.

    The centre line runs from radius r0 to r1, turning by `sweep` radians (backwards, away from the direction of
    spin).  Half-width tapers to a point: hw * (1 - s^pw)^qw.  The trailing edge can carry saw-tooth notches (`notch`
    deep, `nz` of them) or a flame wave; `hook` curls the tip forward; `tipcut` blunts the end."""
    def cen(s):
        r = r0 + (r1 - r0) * s
        th = a0 - spin * sweep * (s ** gam) * 1.0
        th += spin * hook * max(0.0, s - 0.75) ** 1.5 * 3
        return r * math.cos(th), r * math.sin(th)

    lead_pts, trail_pts = [], []
    for i in range(n + 1):
        s = i / n
        x, y = cen(s)
        x2, y2 = cen(min(1.0, s + 0.01))
        x1, y1 = cen(max(0.0, s - 0.01))
        tx, ty = x2 - x1, y2 - y1
        tl = math.hypot(tx, ty) or 1.0
        # left-hand normal of the travel direction (outwards): points to the counter-clockwise side = trailing side
        nx, ny = -ty / tl, tx / tl
        h = hw * max(0.0, (1 - s ** pw)) ** qw
        if tipcut and s > 1 - tipcut:
            h = max(h, hw * 0.45 * (1 - (s - (1 - tipcut)) / tipcut * 0.6))
        hl = h * lead
        ht = h
        if notch:
            f = (s * nz) % 1.0
            ht += notch * f * (1 - s) ** 0.5 * (1 if s > 0.12 else s / 0.12)
        if wave:
            ht += wave * math.sin(s * wave_n * TAU) * (1 - s) ** 0.6 * 0.5 + wave * 0.5 * (1 - s)
        lead_pts.append((x - nx * hl, y - ny * hl))
        trail_pts.append((x + nx * ht, y + ny * ht))
    # the tip is shared: drop the duplicate
    pts = lead_pts + list(reversed(trail_pts[:-1]))
    if tipcut:
        pass
    return pts


def armor_outline(r0, r1, a0, hw0, hw1, cut=0.10, skew=0.0, merlons=0, tipw=0.5, jitter=0.0, seed=1):
    """An angular armour plate: straight edges, chamfered outer corners.  Half-widths are angles (radians) at the inner and
    outer edge, `skew` leans the plate back, `merlons` cuts battlements into the outer edge, `jitter` roughens it (rock)."""
    import random
    rnd = random.Random(seed)
    def P(r, a):
        j = 1 + (rnd.random() - 0.5) * jitter
        return (r * j * math.cos(a), r * j * math.sin(a))
    pts = [P(r0, a0 - hw0), P(r1 - cut, a0 - hw1 + skew)]
    if merlons:
        # outer edge: alternate raised and recessed blocks
        span = 2 * hw1 * tipw
        for k in range(merlons):
            lo = a0 + skew - hw1 * tipw + span * k / merlons
            hi = lo + span / merlons * 0.58
            pts += [P(r1 - 0.07, lo), P(r1, lo + (hi - lo) * 0.15), P(r1, hi - (hi - lo) * 0.15), P(r1 - 0.07, hi)]
    else:
        pts += [P(r1, a0 - hw1 * tipw + skew), P(r1, a0 + hw1 * tipw + skew)]
    pts += [P(r1 - cut, a0 + hw1 + skew), P(r0, a0 + hw0)]
    return pts


def armor_layer(name, n, z, dz, phase=0.0, taper=0.06, bevel=0.009, **kw):
    bm = bmesh.new()
    base = armor_outline(**kw)
    for k in range(n):
        # rough plates (rock) get a different outline each; the rest are copies
        pts = armor_outline(**dict(kw, seed=kw.get('seed', 1) + k)) if kw.get('jitter') else base
        prism(bm, rot(pts, phase + TAU * k / n), z, dz, taper)
    return finish(name, bm, bevel=bevel, segments=2)


def rot(pts, a):
    c, s = math.cos(a), math.sin(a)
    return [(x * c - y * s, x * s + y * c) for (x, y) in pts]


def shard_layer(name, n, z, dz, phase=0.0, taper=0.0, bevel=0.007, **kw):
    """n copies of a blade outline round the axis, one merged object."""
    bm = bmesh.new()
    base = shard_outline(**kw)
    for k in range(n):
        prism(bm, rot(base, phase + TAU * k / n), z, dz, taper)
    return finish(name, bm, bevel=bevel)


# ------------------------------------------------------------------------------------------------ rings and plates
def sector_outline(r0, r1, a0, a1, rnd=0.012, n=10):
    """An annular sector with slightly rounded corners (x, y)."""
    pts = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        pts.append((math.cos(a) * r1, math.sin(a) * r1))
    for i in range(n, -1, -1):
        a = a0 + (a1 - a0) * i / n
        pts.append((math.cos(a) * r0, math.sin(a) * r0))
    return pts


def plate_ring(name, count, r0, r1, z, dz, gap=0.07, pick=None, bevel=0.01, taper=0.1):
    """A ring of chunky plates; pick(k) -> bool chooses which belong to this object (alternating colours)."""
    bm = bmesh.new()
    for k in range(count):
        if pick is not None and not pick(k):
            continue
        a0 = TAU * k / count + gap / 2 * TAU / count
        a1 = TAU * (k + 1) / count - gap / 2 * TAU / count
        prism(bm, sector_outline(r0, r1, a0, a1), z, dz, taper)
    return finish(name, bm, bevel=bevel, segments=2)


def spiky_base(name, n, r_in, r_out, depth, z, dz, p=1.7, tp=0.78, cw=0.07, spin=-1, per=26, bevel=0.006):
    """The dark base plate: a disc whose rim is cut into n saw teeth, pointing the way the blade turns."""
    def saw(t):
        if t < tp:
            return (t / tp) ** p
        if t < tp + cw:
            return 0.5 * (1 + math.cos(math.pi * (t - tp) / cw))
        return 0.0
    pts = []
    ts = sorted({i / per for i in range(per)} | {0.74, 0.8, 0.82, 0.85, 0.9, 0.97})
    for k in range(n):
        for t in ts:
            ang = spin * (k + t) / n * TAU
            r = r_out - depth + depth * saw(t)
            pts.append((math.cos(ang) * r, math.sin(ang) * r))
    if spin < 0:
        pts.reverse()
    bm = bmesh.new()
    prism(bm, pts, z, dz, 0.0)
    # open the centre for the bezel
    return finish(name, bm, bevel=bevel)


def lathe(name, pts, segs=64, z0=0.0, bevel=0.0):
    """Revolve (radius, z) points about the axis; open ends are capped."""
    bm = bmesh.new()
    rings = []
    for (rad, z) in pts:
        rings.append([bm.verts.new((math.cos(TAU * i / segs) * rad, math.sin(TAU * i / segs) * rad, z0 + z)) for i in range(segs)])
    for j in range(len(pts) - 1):
        a, b = rings[j], rings[j + 1]
        for i in range(segs):
            k = (i + 1) % segs
            try:
                bm.faces.new((a[i], a[k], b[k], b[i]))
            except ValueError:
                pass
    for ring, p in ((rings[0], pts[0]), (rings[-1], pts[-1])):
        if p[0] > 1e-6:
            try:
                bm.faces.new(ring)
            except ValueError:
                pass
    return finish(name, bm, bevel=bevel)


def ticks(name, count, radius, z, length=0.035, width=0.012, height=0.012):
    """Little tick marks round a bezel (one merged object)."""
    bm = bmesh.new()
    for k in range(count):
        a = TAU * k / count
        c, s = math.cos(a), math.sin(a)
        pts = [(radius - length / 2, -width / 2), (radius + length / 2, -width / 2), (radius + length / 2, width / 2), (radius - length / 2, width / 2)]
        prism(bm, [(x * c - y * s, x * s + y * c) for (x, y) in pts], z, height)
    return finish(name, bm)
