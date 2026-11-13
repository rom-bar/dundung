import { describe, expect, it } from 'vitest';
import { advance, advanceWithSignals, applyAction, createInitialState, getMood } from '../src/core/game';
import { migrateSave } from '../src/core/save';
import { mulberry32 } from '../src/core/rng';
import rules from '../src/data/rules.json';

function runFor(state: ReturnType<typeof createInitialState>, seconds: number) {
  let next = state;
  const ticks = Math.round(seconds * 10);
  for (let index = 0; index < ticks; index += 1) next = advance(next, 100);
  return next;
}

describe('care-loop simulation', () => {
  it('clamps each simulation step to 100 ms', () => {
    const initial = createInitialState(12);
    const longFrame = advance(initial, 900);
    const normalFrame = advance(initial, 100);
    expect(longFrame.activeSeconds).toBe(normalFrame.activeSeconds);
    expect(longFrame.needs.hunger).toBe(normalFrame.needs.hunger);
  });

  it('does not simulate time while paused', () => {
    const paused = { ...createInitialState(12), paused: true };
    expect(advance(paused, 100)).toBe(paused);
    expect(advance(paused, 10_000).activeSeconds).toBe(0);
  });

  it('decays awake needs by the configured active-minute rates', () => {
    const afterMinute = runFor(createInitialState(12), 60);
    expect(afterMinute.needs.hunger).toBeCloseTo(79, 5);
    expect(afterMinute.needs.happiness).toBeCloseTo(84, 5);
    expect(afterMinute.needs.energy).toBeCloseTo(82, 5);
    expect(afterMinute.needs.hygiene).toBeCloseTo(88.5, 5);
  });

  it('queues a need signal once and respects its active-time cooldown', () => {
    const closeToThreshold = {
      ...createInitialState(15),
      needs: { ...createInitialState(15).needs, hunger: 30.001 },
    };
    const first = advanceWithSignals(closeToThreshold, 100);
    expect(first.signals).toEqual(['hunger']);
    expect(first.state.signalCooldowns.hunger).toBeCloseTo(30, 5);
    expect(advanceWithSignals(first.state, 100).signals).toEqual([]);

    const cooldownAlmostDone = {
      ...first.state,
      needs: { ...first.state.needs, hunger: 30.001 },
      signalCooldowns: { ...first.state.signalCooldowns, hunger: 0.05 },
    };
    expect(advanceWithSignals(cooldownAlmostDone, 100).signals).toEqual(['hunger']);
  });

  it('restores sleeping energy and pauses the other sleeping needs', () => {
    const start = { ...createInitialState(12), sleeping: true };
    const afterTenSeconds = runFor(start, 10);
    expect(afterTenSeconds.needs.energy).toBeCloseTo(85.333333, 4);
    expect(afterTenSeconds.needs.hunger).toBeCloseTo(81.75, 4);
    expect(afterTenSeconds.needs.happiness).toBe(start.needs.happiness);
    expect(afterTenSeconds.needs.hygiene).toBe(start.needs.hygiene);
  });

  it('feeds from the data file and enforces action cooldowns', () => {
    const start = createInitialState(44);
    const fed = applyAction(start, { type: 'feed', foodId: 'moonberry-jam' });
    expect(fed.accepted).toBe(true);
    expect(fed.state.needs.hunger).toBe(100);
    expect(fed.state.animation).toBe('eat');
    expect(applyAction(fed.state, { type: 'feed', foodId: 'moonberry-jam' }).accepted).toBe(false);
    const ready = runFor(fed.state, 2.1);
    expect(applyAction(ready, { type: 'feed', foodId: 'moonberry-jam' }).accepted).toBe(true);
  });

  it('lets sleep recover energy and rejects care actions until wake-up', () => {
    const slept = applyAction(createInitialState(), { type: 'toggle-sleep' });
    expect(slept.accepted).toBe(true);
    expect(slept.state.sleeping).toBe(true);
    const refused = applyAction({ ...slept.state, cooldowns: { feed: 0, play: 0, clean: 0, sleep: 0 } }, { type: 'play' });
    expect(refused.accepted).toBe(false);
    expect(refused.message).toContain('Wake Pip');
  });

  it('hatches from egg to baby after one active minute', () => {
    const hatched = runFor(createInitialState(9), 60);
    expect(hatched.stage).toBe('baby');
    expect(hatched.activeSeconds).toBeCloseTo(60, 5);
    expect(hatched.evolution.formId).not.toBeNull();
    expect(hatched.tendencies.play).toBe(0);
  });

  it('completes every life stage and records the elder before starting a new egg', () => {
    let state = createInitialState(31);
    const transitions = [
      ['baby', 'teen'],
      ['teen', 'adult'],
      ['adult', 'elder'],
      ['elder', 'egg'],
    ] as const;
    for (const [from, to] of transitions) {
      state = {
        ...state,
        stage: from,
        stageSeconds: rules.lifeStages.stageMinutes[from] * 60 - 0.1,
        tendencies: { ...state.tendencies, play: 0.8 },
      };
      state = advance(state, 100);
      expect(state.stage).toBe(to);
      expect(state.tendencies.play).toBe(0);
      if (to !== 'egg') expect(state.evolution.formId).not.toBeNull();
    }
    expect(state.generation).toBe(2);
    expect(state.hallOfPets).toHaveLength(1);
    expect(state.hallOfPets[0]?.name).not.toBe('Pip');
    expect(state.evolution.baseStatBonus).toBeCloseTo(rules.progression.legacyBaseStatBonus);
  });

  it('clamps needs and reflects an empty need in the mood', () => {
    const state = { ...createInitialState(), needs: { hunger: 100, happiness: 100, energy: 100, hygiene: 0 } };
    expect(getMood(state)).toBe('sick');
    const fed = applyAction({ ...state, needs: { ...state.needs, hygiene: 100 } }, { type: 'feed', foodId: 'moss-muffin' });
    expect(fed.state.needs.hunger).toBe(100);
    expect(fed.state.needs.hygiene).toBe(98);
  });
});

describe('save migration and seeded randomness', () => {
  it('round-trips a current save and reopens it paused', () => {
    const state = { ...createInitialState(777), stage: 'baby' as const, activeSeconds: 123.4 };
    const restored = migrateSave(JSON.parse(JSON.stringify(state)) as unknown);
    expect(restored.seed).toBe(777);
    expect(restored.stage).toBe('baby');
    expect(restored.activeSeconds).toBeCloseTo(123.4);
    expect(restored.paused).toBe(true);
  });

  it('migrates a schema-less save and repairs invalid need values', () => {
    const restored = migrateSave({ stage: 'baby', needs: { hunger: 200, happiness: 'lots' } });
    expect(restored.schemaVersion).toBe(4);
    expect(restored.stage).toBe('baby');
    expect(restored.needs.hunger).toBe(100);
    expect(restored.needs.happiness).toBe(86);
    expect(restored.paused).toBe(true);
  });

  it('migrates a Phase 2 save, backfills generation time, and clamps progression fields', () => {
    const restored = migrateSave({
      schemaVersion: 1,
      stage: 'baby',
      activeSeconds: 123,
      stageSeconds: 9_999_999,
      cooldowns: { feed: 9_999 },
      training: { ATK: 9_999 },
      miniGameCooldownSeconds: 99_999,
      tendencies: { play: 0.75 },
      hallOfPets: [{ generation: 2, name: '<img src=x onerror=alert(1)>', formId: 'fire-emberguard', peakLevel: 999 }],
    });
    expect(restored.schemaVersion).toBe(4);
    expect(restored.generationSeconds).toBe(123);
    expect(restored.stageSeconds).toBe(rules.lifeStages.stageMinutes.baby * 60);
    expect(restored.cooldowns.feed).toBe(rules.actionCooldownSeconds.feed);
    expect(restored.training.ATK).toBe(rules.progression.trainingCapPerLevel);
    expect(restored.miniGameCooldownSeconds).toBe(rules.progression.miniGameCooldownSeconds);
    expect(restored.tendencies.training).toBe(0);
    expect(restored.hallOfPets[0]?.name).toBe('Emberguard');
    expect(restored.hallOfPets[0]?.peakLevel).toBe(40);
    expect(restored.hallOfPets[0]?.deepestFloor).toBe(0);
    expect(restored.dungeon).toMatchObject({ coins: 0, deepestFloor: 0, petDeepestFloor: 0, runsCompleted: 0, activeRun: null });
  });

  it('refuses to open a save from a future schema version', () => {
    expect(() => migrateSave({ schemaVersion: 99 })).toThrow('newer than this game');
  });

  it('produces repeatable random sequences for the same seed', () => {
    const first = mulberry32(1234);
    const second = mulberry32(1234);
    expect(Array.from({ length: 8 }, first)).toEqual(Array.from({ length: 8 }, second));
  });
});
