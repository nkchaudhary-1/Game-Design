// Graphics tiers. Picked once from the device and forced with ?quality=high|medium|low; the game also steps down by
// itself if frames run long (see main.ts).

export type Tier = 'high' | 'medium' | 'low';

export interface Gfx {
  tier: Tier;
  bloom: boolean;
  /** Terrain chunk radius (in chunks) and vertices per chunk edge. */
  chunkRadius: number;
  chunkSegs: number;
  maxDpr: number;
  /** Particle pool sizes. */
  particles: number;
  msaa: number;
  stars: number;
}

const TIERS: Record<Tier, Omit<Gfx, 'tier'>> = {
  high: { bloom: true, chunkRadius: 6, chunkSegs: 40, maxDpr: 1.75, particles: 4200, msaa: 4, stars: 1600 },
  medium: { bloom: true, chunkRadius: 5, chunkSegs: 32, maxDpr: 1.5, particles: 2600, msaa: 0, stars: 1000 },
  low: { bloom: false, chunkRadius: 4, chunkSegs: 24, maxDpr: 1, particles: 1400, msaa: 0, stars: 500 },
};

export const GFX: Gfx = { tier: 'high', ...TIERS.high };

export function setTier(t: Tier): void { Object.assign(GFX, { tier: t }, TIERS[t]); }

export const lowerTier = (t: Tier): Tier | null => (t === 'high' ? 'medium' : t === 'medium' ? 'low' : null);

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

/** Choose a tier from the hardware: software renderers and phones go lighter. */
export function detectTier(): Tier {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'high' || q === 'medium' || q === 'low') return q;
  } catch { /* ignore */ }
  const gpu = gpuName().toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (coarse) return 'medium';
  if (/nvidia|geforce|rtx|radeon rx|apple m|apple gpu|rx \d/.test(gpu)) return 'high';
  return 'medium';
}
