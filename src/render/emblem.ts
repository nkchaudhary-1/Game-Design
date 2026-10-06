// The SPINBLADE chevron. One path, used for the in-world decals (canvas textures) and the UI logo (SVG).
// 100×100 box; the inner V is a hole (fill-rule: evenodd).

export const EMBLEM_PATH = 'M2 14 L36 14 L50 40 L64 14 L98 14 L66 88 L34 88 Z M31 34 L40 34 L50 55 L60 34 L69 34 L50 76 Z';

export function emblemSvg(color = 'currentColor', size = 32): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><path d="${EMBLEM_PATH}" fill="${color}" fill-rule="evenodd"/></svg>`;
}

/** Draw the emblem centred in a square canvas context. */
export function drawEmblem(g: CanvasRenderingContext2D, size: number, color: string, scale = 0.62): void {
  const s = (size * scale) / 100;
  g.save();
  g.translate(size / 2 - 50 * s, size / 2 - 50 * s);
  g.scale(s, s);
  g.fillStyle = color;
  g.fill(new Path2D(EMBLEM_PATH), 'evenodd');
  g.restore();
}
