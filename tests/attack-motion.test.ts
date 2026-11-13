import { describe, expect, it } from 'vitest';
import { IMPACT_END, IMPACT_START, writeAttackPose, type AttackPose } from '../src/render/stage/attack-motion';

const pose = (): AttackPose => ({ x: 0, y: 0 });

describe('presentation-only attack motion', () => {
  it('starts and recovers at the same resting pose', () => {
    const out = pose();
    writeAttackPose(0, out);
    expect(out).toEqual(pose());
    writeAttackPose(1, out);
    expect(out).toEqual(pose());
  });

  it('eases backward before the forward contact lunge', () => {
    const out = pose();
    writeAttackPose(0.2, out);
    expect(out.x).toBeLessThan(0);
    expect(out.y).toBeGreaterThan(0);
    writeAttackPose(0.44, out);
    expect(out.x).toBeGreaterThan(55);
  });

  it('holds the contact pose for the short impact interval', () => {
    const first = pose();
    const second = pose();
    writeAttackPose(IMPACT_START + 0.01, first);
    writeAttackPose(IMPACT_END - 0.01, second);
    expect(first).toEqual(second);
    expect(first.x).toBe(60);
    expect((IMPACT_END - IMPACT_START) * 650).toBeCloseTo(52);
  });

  it('writes deterministically into a reused object without changing simulation data', () => {
    const state = Object.freeze({ seed: 42, hp: 80 });
    const out = pose();
    writeAttackPose(0.8, out);
    const expected = { ...out };
    writeAttackPose(0.8, out);
    expect(out).toEqual(expected);
    expect(state).toEqual({ seed: 42, hp: 80 });
  });
});
