export interface AttackPose {
  x: number;
  y: number;
}

export const IMPACT_START = 0.46;
export const IMPACT_END = 0.54;

export function easeOut(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return 1 - (1 - t) ** 3;
}

export function easeInOut(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Writes into a reused object: sampling animation never allocates or touches RNG. */
export function writeAttackPose(progress: number, out: AttackPose): void {
  const p = Math.max(0, Math.min(1, progress));
  out.x = 0;
  out.y = 0;
  if (p === 0 || p === 1) return;
  if (p < 0.25) {
    const t = easeInOut(p / 0.25);
    out.x = -5 * t;
    out.y = 3 * t;
  } else if (p < IMPACT_START) {
    const t = easeOut((p - 0.25) / (IMPACT_START - 0.25));
    out.x = -5 + 65 * t;
    out.y = 3 - 5 * t;
  } else if (p < IMPACT_END) {
    out.x = 60;
    out.y = -2;
  } else {
    const t = easeInOut((p - IMPACT_END) / (1 - IMPACT_END));
    out.x = 60 * (1 - t);
    out.y = -2 * (1 - t);
  }
}
