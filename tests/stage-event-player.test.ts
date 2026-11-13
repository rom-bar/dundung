import { describe, expect, it } from 'vitest';
import { StageEventPlayer } from '../src/render/stage/event-player';
import type { StageVisualEvent } from '../src/core/types';
import timing from '../src/data/stage-animations.json';

const events: StageVisualEvent[] = [
  { id: 1, type: 'walk_start', floor: 1, biomeId: 'cinder-copse' },
  {
    id: 2,
    type: 'attack',
    source: 'pet',
    target: 'enemy',
    actor: 'Pip',
    skill: 'Ember Pop',
    amount: 21,
    critical: true,
    strongHit: false,
    flavor: 'skill',
  },
];

describe('StageEventPlayer', () => {
  it('plays events one at a time and retains a bounded, ordered history', () => {
    const player = new StageEventPlayer();
    player.enqueue(events);
    expect(player.queueLength()).toBe(2);
    player.advance(390, '1x', false);
    expect(player.frame().event?.type).toBe('walk_start');
    expect(player.frame().progress).toBeGreaterThan(0);
    player.advance(10_000, '1x', false);
    expect(player.queueLength()).toBe(0);
    expect(player.eventLog()).toEqual(events);
  });

  it('2× shortens presentation time while skip resolves it without altering event history', () => {
    const regular = new StageEventPlayer();
    regular.enqueue(events);
    regular.advance(100, '1x', false);
    const regularProgress = regular.frame().progress;

    const double = new StageEventPlayer();
    double.enqueue(events);
    double.advance(100, '2x', false);
    expect(double.frame().progress).toBeGreaterThan(regularProgress);

    const skipped = new StageEventPlayer();
    skipped.enqueue(events);
    skipped.advance(0, 'skip', false);
    expect(skipped.queueLength()).toBe(0);
    expect(skipped.frame()).toMatchObject({ event: events[1], progress: 1, summary: true });
    expect(skipped.eventLog()).toEqual(events);
  });

  it('freezes the current animation while a decision overlay is open and resumes afterward', () => {
    const player = new StageEventPlayer();
    player.enqueue(events);
    player.advance(100, '1x', false);
    const pausedFrame = player.frame();
    const pausedQueueLength = player.queueLength();

    player.advance(500, '1x', false, true);
    expect(player.frame()).toEqual(pausedFrame);
    expect(player.queueLength()).toBe(pausedQueueLength);

    player.advance(100, '1x', false);
    expect(player.frame().progress).toBeGreaterThan(pausedFrame.progress);
  });

  it('uses a short static cue when reduced motion is requested', () => {
    const player = new StageEventPlayer();
    player.enqueue(events.slice(0, 1));
    player.advance(120, '1x', true);
    expect(player.frame().progress).toBe(0.5);
    expect(player.frame().event?.type).toBe('walk_start');
  });

  it('ignores duplicate event IDs from repeated snapshots', () => {
    const player = new StageEventPlayer();
    player.enqueue(events);
    player.enqueue(events);
    expect(player.queueLength()).toBe(2);
    expect(player.eventLog()).toEqual(events);
  });

  it('keeps a battle sequence active across a preceding walk event until its summary finishes', () => {
    const player = new StageEventPlayer();
    player.enqueue(events);
    expect(player.hasBattleSequence()).toBe(true);
    player.advance(0, 'skip', false);
    expect(player.hasBattleSequence()).toBe(true);
    player.advance(1_000, 'skip', false);
    player.advance(500, 'skip', false);
    expect(player.hasBattleSequence()).toBe(false);
  });

  it('uses the default duration and completes if a new event has no specific timing entry', () => {
    const durationMap = timing.durationsMs as Record<string, number>;
    const originalDuration = durationMap.walk_start;
    delete durationMap.walk_start;
    try {
      const player = new StageEventPlayer();
      player.enqueue(events.slice(0, 1));
      player.advance(timing.defaultDurationMs, '1x', false);
      expect(player.queueLength()).toBe(0);
      expect(player.frame()).toMatchObject({ event: events[0], progress: 1, summary: true });
    } finally {
      durationMap.walk_start = originalDuration;
    }
  });
});
