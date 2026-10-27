// The blade models: 21 layered blades modelled in Blender (tools/blender) and packed into one small file.
// Each blade is a handful of named parts (dark base plate, swept blades, jagged crown blades, accent inlay, the ring of
// plates, the bezel, tick marks, an optional rim). BladeMesh paints each part by name. The weight disc, emblem cap and
// tip stay procedural because the player can swap those parts.
//
// File layout (see tools/blender/build_blades.py): zlib-compressed, little-endian, 'SBM1', u16 blades, then per blade
// u8 len + id, u8 parts, per part u8 len + name, u32 vertices, u32 indices, then 4-byte-aligned int16 positions (1/20000),
// int8 normals and uint16 indices.

import * as THREE from 'three';
import packUrl from '../assets/models/blades.sbm?url';

export type BladeParts = Map<string, THREE.BufferGeometry>;

const MODELS = new Map<string, BladeParts>();

const POS_SCALE = 1 / 20000;

/** Parse an inflated model pack into geometries (Y up, tip at y = 0, wheel radius 1). */
export function decodeModelPack(buf: ArrayBuffer): Map<string, BladeParts> {
  const dv = new DataView(buf);
  const text = (o: number, n: number): string => String.fromCharCode(...new Uint8Array(buf, o, n));
  if (text(0, 4) !== 'SBM1') throw new Error('Not a blade model pack');
  let o = 4;
  const blades = dv.getUint16(o, true); o += 2;
  const align = (): void => { o += (4 - (o % 4)) % 4; };
  const out = new Map<string, BladeParts>();
  for (let b = 0; b < blades; b++) {
    const idLen = dv.getUint8(o++); const id = text(o, idLen); o += idLen;
    const nParts = dv.getUint8(o++);
    const parts: BladeParts = new Map();
    for (let p = 0; p < nParts; p++) {
      const nameLen = dv.getUint8(o++); const name = text(o, nameLen); o += nameLen;
      const V = dv.getUint32(o, true); o += 4;
      const I = dv.getUint32(o, true); o += 4;
      align(); const pos = new Int16Array(buf, o, V * 3); o += V * 6;
      align(); const nor = new Int8Array(buf, o, V * 3); o += V * 3;
      align(); const idx = new Uint16Array(buf, o, I); o += I * 2;
      align();
      const position = new Float32Array(V * 3), normal = new Float32Array(V * 3), uv = new Float32Array(V * 2);
      for (let i = 0; i < V; i++) {
        const x = pos[i * 3] * POS_SCALE, y = pos[i * 3 + 1] * POS_SCALE, z = pos[i * 3 + 2] * POS_SCALE;
        position[i * 3] = x; position[i * 3 + 1] = y; position[i * 3 + 2] = z;
        const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1;
        normal[i * 3] = nx / l; normal[i * 3 + 1] = ny / l; normal[i * 3 + 2] = nz / l;
        // planar UVs for the brushed-metal bump map (the pack carries none)
        uv[i * 2] = x * 0.5 + 0.5; uv[i * 2 + 1] = z * 0.5 + 0.5;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
      g.computeBoundingSphere();
      parts.set(name, g);
    }
    out.set(id, parts);
  }
  return out;
}

async function inflate(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
}

/** Fetch, inflate and decode the pack. Call once before any blade is drawn; if it fails BladeMesh falls back to its procedural blades. */
export async function loadBladeModels(url: string = packUrl): Promise<void> {
  if (MODELS.size) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blade models: ${res.status}`);
  for (const [id, parts] of decodeModelPack(await inflate(await res.arrayBuffer()))) MODELS.set(id, parts);
}

/** The model parts for a blade, or undefined if the pack is not loaded (or has no such blade). */
export function bladeModel(id: string): BladeParts | undefined { return MODELS.get(id); }

/** For tests: register decoded models without fetching. */
export function setBladeModels(m: Map<string, BladeParts>): void { MODELS.clear(); for (const [k, v] of m) MODELS.set(k, v); }

/** Where the model's parts sit, in model units (wheel radius 1): the base plate's underside, and the bezel's top. */
export const MODEL = { baseZ: 0.30, bezelTop: 0.655, baseTop: 0.39, bezelInner: 0.285 } as const;
