import { describe, expect, it } from 'vitest';
import { splitElapsedMs } from '../src/platform/simulation-clock';

describe('splitElapsedMs', () => {
  it('preserves a normal frame as one simulation tick', () => {
    expect(splitElapsedMs(16.67, 100)).toEqual([16.67]);
  });

  it('splits a dropped-frame interval into bounded ticks without losing time', () => {
    const steps = splitElapsedMs(275, 100);
    expect(steps).toEqual([100, 100, 75]);
    expect(steps.reduce((sum, step) => sum + step, 0)).toBeCloseTo(275);
    expect(steps.every((step) => step > 0 && step <= 100)).toBe(true);
  });

  it('returns no ticks for invalid or empty intervals', () => {
    expect(splitElapsedMs(0, 100)).toEqual([]);
    expect(splitElapsedMs(-1, 100)).toEqual([]);
    expect(splitElapsedMs(Number.NaN, 100)).toEqual([]);
    expect(splitElapsedMs(50, 0)).toEqual([]);
  });
});
