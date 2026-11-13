import { describe, expect, it } from 'vitest';
import { cosmeticSeed, createCosmeticRng } from '../src/render/stage/cosmetic-rng';

describe('cosmetic RNG', () => {
  it('replays the same visual sequence for the same seed', () => {
    const first = createCosmeticRng(cosmeticSeed(42, 3));
    const second = createCosmeticRng(cosmeticSeed(42, 3));
    expect(Array.from({ length: 12 }, () => first.next())).toEqual(
      Array.from({ length: 12 }, () => second.next()),
    );
  });

  it('changes stream identity without touching core RNG state', () => {
    const first = createCosmeticRng(cosmeticSeed(42, 3));
    const otherGeneration = createCosmeticRng(cosmeticSeed(42, 4));
    expect(first.next()).not.toBe(otherGeneration.next());
  });

  it('keeps integer and pick helpers in bounds', () => {
    const rng = createCosmeticRng(9);
    for (let index = 0; index < 100; index += 1) {
      expect(rng.int(4)).toBeGreaterThanOrEqual(0);
      expect(rng.int(4)).toBeLessThan(4);
      expect(['a', 'b']).toContain(rng.pick(['a', 'b'] as const));
    }
    expect(rng.int(0)).toBe(0);
    expect(() => rng.pick([])).toThrow();
  });
});
