// Graphics tiers. High-poly blades, 2K concrete maps, real shadows and bloom look best on a desktop GPU, so the
// tier is chosen once at start (phones and tablets get Medium) and can be forced with ?quality=high|medium|low.
// The game also steps down on its own if frames run long (see BattleScreen).

export type Tier = 'high' | 'medium' | 'low';

export interface Gfx {
  tier: Tier;
  /** 0 = light geometry, 1 = detailed, 2 = full. Drives segment counts in the blade and arena builders. */
  detail: 0 | 1 | 2;
  shadows: boolean;
  shadowSize: number;
  bloom: boolean;
  texSize: number;
  dust: number;
  rocks: number;
  maxDpr: number;
}

const TIERS: Record<Tier, Omit<Gfx, 'tier'>> = {
  high: { detail: 2, shadows: true, shadowSize: 2048, bloom: true, texSize: 2048, dust: 160, rocks: 64, maxDpr: 1.5 },
  medium: { detail: 1, shadows: true, shadowSize: 1024, bloom: true, texSize: 1024, dust: 60, rocks: 40, maxDpr: 1.5 },
  low: { detail: 0, shadows: false, shadowSize: 512, bloom: false, texSize: 512, dust: 0, rocks: 24, maxDpr: 1 },
};

/** Live settings read by the builders. Mutated by setTier(). */
export const GFX: Gfx = { tier: 'high', ...TIERS.high };

export function setTier(t: Tier): void { Object.assign(GFX, { tier: t }, TIERS[t]); }

/** The GPU's own name, when the browser will tell us ('' otherwise). */
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

/**
 * Pick the tier from the hardware. High is the full look and needs a real GPU: a discrete card or an Apple-silicon
 * Mac. Integrated Intel/AMD graphics get Medium, software rendering and phones get Low/Medium. When in doubt, go
 * lighter: a smooth Medium beats a choppy High (and the game still steps down on its own if frames run long).
 */
export function detectTier(): Tier {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'high' || q === 'medium' || q === 'low') return q;
    if (window.matchMedia('(pointer: coarse)').matches) return 'medium';
    const gpu = gpuName();
    if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return 'low';
    if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|apple m\d|arc\b/i.test(gpu)) return 'high';
    return 'medium';
  } catch { return 'medium'; }
}
