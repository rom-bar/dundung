/** A tiny deterministic stream for visual-only variation. Never use this for gameplay. */
export interface CosmeticRandom {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(values: readonly T[]): T;
}

function normalizeSeed(seed: number): number {
  return (Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0;
}

export function createCosmeticRng(seed: number): CosmeticRandom {
  let state = normalizeSeed(seed) || 0x9e3779b9;
  return {
    next(): number {
      state = (Math.imul(state ^ (state >>> 16), 0x21f0aaad) + 0x735a2d97) >>> 0;
      state ^= state >>> 15;
      state = Math.imul(state, 0x846ca68b) >>> 0;
      return ((state ^ (state >>> 16)) >>> 0) / 0x100000000;
    },
    int(maxExclusive: number): number {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
      return Math.min(Math.floor(maxExclusive) - 1, Math.floor(this.next() * Math.floor(maxExclusive)));
    },
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) throw new Error('Cannot pick from an empty cosmetic collection');
      return values[this.int(values.length)]!;
    },
  };
}

export function cosmeticSeed(gameSeed: number, generation: number): number {
  return (normalizeSeed(gameSeed) ^ Math.imul(normalizeSeed(generation), 0x45d9f3b)) >>> 0;
}
