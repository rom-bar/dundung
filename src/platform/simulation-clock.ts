export function splitElapsedMs(elapsedMs: number, maxStepMs: number): number[] {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !Number.isFinite(maxStepMs) || maxStepMs <= 0) return [];
  const steps: number[] = [];
  let remaining = elapsedMs;
  while (remaining > maxStepMs) {
    steps.push(maxStepMs);
    remaining -= maxStepMs;
  }
  if (remaining > 0) steps.push(remaining);
  return steps;
}
