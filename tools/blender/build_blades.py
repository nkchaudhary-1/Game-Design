"""Build the blade models in Blender (headless) and export one GLB per blade, and/or render preview images.

  python -I build_blades.py --ids ravok,gravion --render OUT_DIR            # previews only
  python -I build_blades.py --all --export ../../src/assets/models/blades    # the game's models

Needs the `bpy` module (pip install bpy, Python 3.11).  Run from this folder.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from blade_geo import TAU, lathe
from blades import DESIGNS, build_blade


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def hexcol(h, k=1.0):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: (c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r) * k, f(g) * k, f(b) * k, 1.0)


def mat(name, color, metal=0.0, rough=0.4, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes['Principled BSDF']
    n.inputs['Base Color'].default_value = color
    n.inputs['Metallic'].default_value = metal
    n.inputs['Roughness'].default_value = rough
    if 'Coat Weight' in n.inputs:
        n.inputs['Coat Weight'].default_value = coat
    return m


def studio(target=(0, 0, 0.35)):
    """Soft-box lighting that gives metal something to reflect."""
    w = bpy.context.scene.world = bpy.data.worlds.new('w')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.16, 0.17, 0.2, 1)
    bg.inputs['Strength'].default_value = 0.6

    def box(loc, size, energy):
        bpy.ops.object.light_add(type='AREA', location=loc)
        l = bpy.context.object
        l.data.energy = energy
        l.data.size = size
        l.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    box((2.6, -2.4, 3.2), 2.2, 260)
    box((-3.2, 1.8, 2.2), 1.6, 160)
    box((0.4, 3.4, 1.4), 1.4, 200)
    box((0, 0, 4.2), 2.6, 60)


def render(bid, out_dir, views=('iso', 'top', 'side'), res=(640, 520), samples=40):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = 'Standard'
    studio()
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.001))
    bpy.context.object.data.materials.append(mat('floor', (0.14, 0.15, 0.19, 1), 0.0, 0.7))
    cams = {
        'iso': ((1.9, -2.3, 1.55), (0, 0, 0.30), 42),
        'top': ((0.001, -0.001, 3.6), (0, 0, 0.3), 38),
        'side': ((0.0, -3.4, 0.55), (0, 0, 0.30), 36),
    }
    for v in views:
        loc, tgt, fov = cams[v]
        bpy.ops.object.camera_add(location=loc)
        cam = bpy.context.object
        cam.data.angle = math.radians(fov)
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        sc.render.filepath = os.path.join(out_dir, f'{bid}-{v}.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam)


def add_preview_parts(parts):
    """Approximate the procedural parts (weight disc, emblem cap, tip) so a preview reads as a whole blade."""
    parts['disc'] = lathe('disc', [(0.0, 0.24), (0.55, 0.24), (0.6, 0.265), (0.6, 0.30), (0.0, 0.30)], 48)
    parts['tip'] = lathe('tip', [(0.0, 0.0), (0.045, 0.01), (0.075, 0.05), (0.13, 0.17), (0.14, 0.25), (0.0, 0.25)], 40)
    parts['cap'] = lathe('cap', [(0.0, 0.60), (0.20, 0.606), (0.275, 0.598), (0.275, 0.56), (0.0, 0.56)], 48)


def light_of(c):
    """The colour of the long top blades: the blade's own second paint, or a tint of its main colour (a dark steel when
    the main colour is already pale)."""
    if c.get('alt'):
        return c['alt']
    h = c['main'].lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    if lum > 0.62:
        return '#3a4256'
    mix = lambda v: int(v + (255 - v) * 0.84)
    return '#%02x%02x%02x' % (mix(r), mix(g), mix(b))


def assign(parts, d):
    c = dict(d['colors'])
    c['light'] = light_of(c)
    M = lambda n, col, me, ro, co=0.0: mat(n, col, me, ro, co)
    mats = dict(
        base=M('base', hexcol(c['dark'], 1.0), 0.6, 0.35, 0.3),
        blades=M('blades', hexcol(c['main']), 0.25, 0.25, 1.0),
        crown=M('crown', hexcol(c['light']), 0.2, 0.25, 1.0),
        inlay=M('inlay', hexcol(c['main'], 1.0), 0.2, 0.3, 1.0),
        plates_a=M('plates_a', hexcol(c['light']), 0.3, 0.28, 0.8),
        plates_b=M('plates_b', hexcol(c['main']), 0.3, 0.28, 0.8),
        bezel=M('bezel', hexcol(c['dark'], 1.0), 0.85, 0.3),
        ticks=M('ticks', hexcol(c['light']), 0.3, 0.4),
        rim=M('rim', hexcol(c['light']), 0.7, 0.3, 0.5),
        disc=M('disc', hexcol(c['trim'], 0.9), 0.85, 0.4),
        tip=M('tip', (0.7, 0.72, 0.78, 1), 1.0, 0.25),
        cap=M('cap', (0.03, 0.03, 0.04, 1), 0.9, 0.3),
    )
    for k, o in parts.items():
        if k in mats:
            o.data.materials.append(mats[k])


def pack_part(obj):
    """One part as quantised, de-duplicated vertex data in Y-up: int16 positions (1/20000), int8 normals, uint16 indices."""
    import numpy as np
    me = obj.data
    me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    n_loops = len(me.loops)
    vidx = np.empty(n_loops, np.int32)
    me.loops.foreach_get('vertex_index', vidx)
    cn = np.empty(n_loops * 3, np.float32)
    me.corner_normals.foreach_get('vector', cn)
    cn = cn.reshape(-1, 3)
    tris = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('loops', tris)
    P = co[vidx]
    P3 = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)       # Blender Z-up -> Y-up (a proper rotation: winding is kept)
    N3 = np.stack([cn[:, 0], cn[:, 2], -cn[:, 1]], 1)
    key = np.concatenate([np.round(P3 * 20000).astype(np.int32), np.round(N3 * 127).astype(np.int32)], 1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    idx = inv.reshape(-1)[tris]
    # drop triangles that collapsed after quantising
    t = idx.reshape(-1, 3)
    keep = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    t = t[keep]
    assert len(uniq) < 65535, 'part has too many vertices for uint16 indices'
    return uniq[:, :3].astype(np.int16), uniq[:, 3:].astype(np.int8), t.astype(np.uint16)


def write_packs(blades, path):
    """blades: {id: {part: obj}} -> one zlib-compressed binary the game inflates at start-up.  Layout (little-endian):
    'SBM1', u16 blades; per blade: u8 len + id, u8 parts; per part: u8 len + name, u32 vertices, u32 indices,
    then (4-byte aligned) int16 positions[3V], int8 normals[3V], uint16 indices[I]."""
    import struct
    import zlib
    out = bytearray(b'SBM1' + struct.pack('<H', len(blades)))
    pad = lambda: out.extend(b'\0' * ((-len(out)) % 4))
    for bid, parts in blades.items():
        out.extend(struct.pack('<B', len(bid)) + bid.encode())
        out.extend(struct.pack('<B', len(parts)))
        for name, obj in parts.items():
            pos, nor, idx = obj
            out.extend(struct.pack('<B', len(name)) + name.encode())
            out.extend(struct.pack('<II', len(pos), idx.size))
            pad(); out.extend(pos.tobytes())
            pad(); out.extend(nor.tobytes())
            pad(); out.extend(idx.tobytes())
            pad()
    raw = bytes(out)
    comp = zlib.compress(raw, 9)
    with open(path, 'wb') as f:
        f.write(comp)
    return len(raw), len(comp)


EXPORT_PARTS = ('base', 'blades', 'crown', 'inlay', 'plates_a', 'plates_b', 'bezel', 'ticks', 'rim')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ids', default='')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--render', default='')
    ap.add_argument('--export', default='', help="write the game's model pack (one file) to this path")
    ap.add_argument('--views', default='iso,top,side')
    ap.add_argument('--samples', type=int, default=40)
    a = ap.parse_args()
    ids = list(DESIGNS) if a.all or not a.ids else a.ids.split(',')
    packs = {}
    for bid in ids:
        clear()
        d = DESIGNS[bid]
        parts = build_blade(bid, d)
        faces = sum(len(o.data.polygons) for o in parts.values())
        if a.export:
            packs[bid] = {k: pack_part(parts[k]) for k in EXPORT_PARTS if k in parts}
        if a.render:
            add_preview_parts(parts)
            assign(parts, d)
            os.makedirs(a.render, exist_ok=True)
            render(bid, a.render, tuple(a.views.split(',')), samples=a.samples)
        print(bid, 'faces', faces)
    if a.export:
        os.makedirs(os.path.dirname(os.path.abspath(a.export)), exist_ok=True)
        raw, comp = write_packs(packs, a.export)
        print('wrote', a.export, raw, 'bytes raw,', comp, 'compressed')


if __name__ == '__main__':
    main()
