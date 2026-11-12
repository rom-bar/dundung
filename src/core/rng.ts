export type RandomSource = () => number;

export interface RandomStep {
  value: number;
  seed: number;
}

export function nextRandom(seed: number): RandomStep {
  const nextSeed = (seed + 0x6d2b79f5) >>> 0;
  let value = nextSeed;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { value: ((value ^ (value >>> 14)) >>> 0) / 4294967296, seed: nextSeed };
}

export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    const result = nextRandom(state);
    state = result.seed;
    return result.value;
  };
}
