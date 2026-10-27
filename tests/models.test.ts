// The Blender blade models: the pack on disk decodes, every blade has the parts BladeMesh paints, and the geometry is sane.

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BLADE_ORDER, BLADES, crownColor } from '../src/blades/bladeData';
import { decodeModelPack, MODEL } from '../src/blades/models';

const raw = inflateSync(readFileSync(new URL('../src/assets/models/blades.sbm', import.meta.url)));
const pack = decodeModelPack(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

const REQUIRED = ['base', 'blades', 'crown', 'inlay', 'plates_a', 'plates_b', 'bezel', 'ticks'];

describe('blade model pack', () => {
  it('has a model for every blade in the roster', () => {
    expect([...pack.keys()].sort()).toEqual([...BLADE_ORDER].sort());
  });

  it('gives every blade the parts the renderer paints', () => {
    for (const id of BLADE_ORDER) {
      const parts = pack.get(id)!;
      for (const name of REQUIRED) expect(parts.has(name), `${id}.${name}`).toBe(true);
      // Stamina blades with a round silhouette carry a smooth rim
      for (const name of parts.keys()) expect([...REQUIRED, 'rim'], `${id}.${name}`).toContain(name);
    }
  });

  it('is well-formed: finite, indexed in range, unit-length normals, sized to a wheel radius of about 1', () => {
    for (const id of BLADE_ORDER) {
      let maxR = 0, minY = Infinity, maxY = -Infinity, tris = 0, badNormals = 0, badIndex = 0, notFinite = 0;
      for (const g of pack.get(id)!.values()) {
        const pos = g.getAttribute('position').array as Float32Array;
        const nor = g.getAttribute('normal').array as Float32Array;
        const idx = g.getIndex()!.array;
        for (let i = 0; i < pos.length; i += 3) {
          if (!Number.isFinite(pos[i] + pos[i + 1] + pos[i + 2])) notFinite++;
          maxR = Math.max(maxR, Math.hypot(pos[i], pos[i + 2]));
          minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
        }
        for (let i = 0; i < nor.length; i += 3) if (Math.abs(Math.hypot(nor[i], nor[i + 1], nor[i + 2]) - 1) > 0.02) badNormals++;
        for (let i = 0; i < idx.length; i++) if (idx[i] >= pos.length / 3) badIndex++;
        tris += idx.length / 3;
      }
      expect({ id, notFinite, badNormals, badIndex }).toEqual({ id, notFinite: 0, badNormals: 0, badIndex: 0 });
      expect(maxR, id).toBeGreaterThan(0.9);
      expect(maxR, id).toBeLessThan(1.12);
      // the stack sits on the weight disc and tip the game adds below it
      expect(minY, id).toBeGreaterThanOrEqual(MODEL.baseZ - 0.01);
      expect(maxY, id).toBeLessThan(MODEL.bezelTop + 0.03);
      expect(tris, id).toBeLessThan(26000);   // keeps two blades plus shadows cheap
    }
  }, 30000);

  it('stays small enough for the single-file build', () => {
    expect(raw.length).toBeLessThan(5_500_000);
  });

  it('every blade has a crown colour that differs from its main colour', () => {
    for (const id of BLADE_ORDER) {
      const v = BLADES[id].visualProfile;
      expect(crownColor(v).toLowerCase(), id).not.toBe(v.main.toLowerCase());
    }
  });
});
