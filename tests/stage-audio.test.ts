import { afterEach, describe, expect, it, vi } from 'vitest';
import { StageSoundPlayer } from '../src/platform/stage-audio';
import type { StageVisualEvent } from '../src/core/types';
import type { StageEventFrame } from '../src/render/stage/event-player';

class FakeGain {
  gain = {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeOscillator {
  type: OscillatorType = 'sine';
  frequency = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  onended: (() => void) | null = null;
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 10;
  state: AudioContextState = 'running';
  destination = {};
  close = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  createGain = vi.fn(() => new FakeGain());
  createOscillator = vi.fn(() => new FakeOscillator());

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

const attack = Object.freeze({
  id: 7,
  type: 'attack',
  source: 'pet',
  target: 'enemy',
  actor: 'Pip',
  skill: 'Ember Pop',
  amount: 21,
  critical: false,
  strongHit: false,
  flavor: 'skill',
} satisfies StageVisualEvent);

const frame = (progress: number, summary = false): StageEventFrame => ({
  event: attack,
  progress,
  summary,
});

const installAudioContext = (): void => {
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
};

const oscillators = (): FakeOscillator[] => {
  const context = FakeAudioContext.instances[0];
  return context ? context.createOscillator.mock.results.map((result) => result.value) : [];
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('StageSoundPlayer', () => {
  it('creates no audio context while muted', () => {
    installAudioContext();
    const player = new StageSoundPlayer();

    player.update(frame(0.46), true, false);

    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('waits for attack progress .46, then plays hit layers exactly once', () => {
    installAudioContext();
    const player = new StageSoundPlayer();

    player.update(frame(0.2), false, false);
    expect(FakeAudioContext.instances).toHaveLength(0);

    player.update(frame(0.46), false, false);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(oscillators()).toHaveLength(2);

    player.update(frame(0.6), false, false);
    expect(oscillators()).toHaveLength(2);
  });

  it('does not sound a paused frame or a summary frame', () => {
    installAudioContext();
    const player = new StageSoundPlayer();

    player.update(frame(0.8), false, true);
    expect(FakeAudioContext.instances).toHaveLength(0);

    player.update(frame(1, true), false, false);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('unmuting plays and muting immediately drives the master gain to zero', () => {
    installAudioContext();
    const player = new StageSoundPlayer();

    player.update(frame(0.46), false, false);
    const context = FakeAudioContext.instances[0]!;
    const master = context.createGain.mock.results[0]!.value;

    player.setMuted(true);

    expect(master.gain.setValueAtTime).toHaveBeenLastCalledWith(0, context.currentTime);
  });

  it('uses cosmetic pitch without mutating a frozen event fixture', () => {
    installAudioContext();
    const player = new StageSoundPlayer();
    const before = { ...attack };

    player.update(frame(0.46), false, false);

    expect(attack).toEqual(before);
    expect(Object.isFrozen(attack)).toBe(true);
    expect(oscillators()[0]!.frequency.setValueAtTime).toHaveBeenCalled();
  });

  it('closes and clears its audio context on dispose', () => {
    installAudioContext();
    const player = new StageSoundPlayer();

    player.update(frame(0.46), false, false);
    const context = FakeAudioContext.instances[0]!;

    player.dispose();

    expect(context.close).toHaveBeenCalledOnce();
    player.update(frame(0.6), false, false);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});
