/**
 * World clock. One in-game day lasts DAY_SECONDS of server time; the server starts at golden hour so the first
 * impression is the good light. Everything visual (sun, sky, lamps, windows) is derived from the hour.
 */
export const DAY_SECONDS = 1800;      // 30 real minutes per 24 in-game hours
export const START_HOUR = 18.2;
export const SUNRISE = 6.0, SUNSET = 19.5;

export const hourAt = (serverSeconds: number) => (((START_HOUR + (serverSeconds / DAY_SECONDS) * 24) % 24) + 24) % 24;

/** Sun angle: 0 at sunrise, π at sunset, continuing below the horizon through the night. */
export function sunAngle(hour: number): number {
  const h = hour < SUNRISE ? hour + 24 : hour;
  return h <= SUNSET ? ((h - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI : Math.PI + ((h - SUNSET) / (24 + SUNRISE - SUNSET)) * Math.PI;
}
/** Sun elevation, −1 (midnight) … 1 (solar noon). */
export const sunElevation = (hour: number) => Math.sin(sunAngle(hour));

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** 0 in daylight … 1 when the street lamps are fully on. */
export const nightness = (hour: number) => 1 - smooth(-0.12, 0.12, sunElevation(hour));

export function clockText(hour: number): string {
  const total = Math.floor(hour * 60), h = Math.floor(total / 60) % 24, m = total % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export function phaseName(hour: number): string {
  const e = sunElevation(hour), morning = hour < 12.5;
  if (e < -0.12) return 'Night';
  if (e < 0.12) return morning ? 'Sunrise' : 'Sunset';
  if (e < 0.4) return morning ? 'Morning' : 'Golden hour';
  return 'Daytime';
}
