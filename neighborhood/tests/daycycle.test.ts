import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, START_HOUR, clockText, hourAt, nightness, phaseName, sunElevation } from '../src/shared/daycycle';

describe('day cycle', () => {
  it('starts in golden light, reaches night, and wraps after a full day', () => {
    expect(hourAt(0)).toBeCloseTo(START_HOUR);
    expect(phaseName(hourAt(0))).toBe('Golden hour');
    expect(nightness(hourAt(0))).toBe(0);
    expect(nightness(23)).toBe(1);
    expect(nightness(12.5)).toBe(0);
    expect(hourAt(DAY_SECONDS)).toBeCloseTo(START_HOUR);
    expect(hourAt(DAY_SECONDS * 3.25)).toBeCloseTo((START_HOUR + 6) % 24);
  });
  it('sun is up at noon, down at midnight, near the horizon at sunrise and sunset', () => {
    expect(sunElevation(12.75)).toBeGreaterThan(0.95);
    expect(sunElevation(0)).toBeLessThan(-0.5);
    expect(Math.abs(sunElevation(6))).toBeLessThan(0.01);
    expect(Math.abs(sunElevation(19.5))).toBeLessThan(0.01);
  });
  it('lamps come on gradually through dusk, never flicker, and are fully on by 20:30', () => {
    let last = -1;
    for (let h = 18; h <= 21; h += 0.05) { const n = nightness(h); expect(n).toBeGreaterThanOrEqual(last - 1e-9); last = n; }
    expect(nightness(18)).toBe(0);
    expect(nightness(20.6)).toBeGreaterThan(0.95);
  });
  it('formats the clock', () => {
    expect(clockText(0)).toBe('12:00 AM'); expect(clockText(12)).toBe('12:00 PM'); expect(clockText(19.75)).toBe('7:45 PM');
  });
});
