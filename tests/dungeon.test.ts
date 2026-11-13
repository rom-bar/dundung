import { describe, expect, it } from 'vitest';
import { advance, applyAction, createInitialState } from '../src/core/game';
import { calculateDamage, getDungeonData, getElementMultiplier, migrateDungeonProgress, scaleEnemy } from '../src/core/dungeon';
import { migrateSave } from '../src/core/save';
import { nextRandom } from '../src/core/rng';
import type { DungeonRunState, GameState, Stats } from '../src/core/types';

const formId = 'fire-emberguard';
const emptyStats: Stats = { HP: 10, ATK: 10, DEF: 10, SPD: 10, LUK: 1 };

function readyPet(seed = 41): GameState {
  const state = createInitialState(seed);
  return {
    ...state,
    stage: 'baby',
    evolution: { ...state.evolution, formId },
    formDex: [formId],
  };
}

function startRun(seed = 41, pack: string[] = [], mode: 'standard' | 'daily' = 'standard', dateKey?: string): GameState {
  const result = applyAction(readyPet(seed), { type: 'dungeon-start-run', consumables: pack, mode, dateKey });
  expect(result.accepted).toBe(true);
  expect(result.state.dungeon.activeRun).not.toBeNull();
  return result.state;
}

function withRun(state: GameState, run: DungeonRunState): GameState {
  return { ...state, dungeon: { ...state.dungeon, activeRun: run } };
}

function chooseFight(state: GameState, stats = emptyStats): GameState {
  const run = state.dungeon.activeRun!;
  let next = withRun(state, {
    ...run,
    roomChoices: ['fight'],
    petStats: stats,
    petMaxHp: stats.HP,
    petHp: stats.HP,
  });
  next = applyAction(next, { type: 'dungeon-choose-room', roomType: 'fight' }).state;
  next = applyAction(next, { type: 'dungeon-choose-tactic', tacticId: 'all-in' }).state;
  return next;
}

function simulateFirstFight(seed: number): DungeonRunState {
  const state = chooseFight(startRun(seed), { HP: 1_000, ATK: 1_000, DEF: 1_000, SPD: 1_000, LUK: 20 });
  let next = state;
  for (let tick = 0; tick < 10 && next.dungeon.activeRun?.roomIndex === 0; tick += 1) next = advance(next, 100);
  return next.dungeon.activeRun!;
}

function simulateOneFloor(seed: number, mode: 'standard' | 'daily' = 'standard', dateKey?: string): GameState {
  let state = startRun(seed, [], mode, dateKey);
  const initialRun = state.dungeon.activeRun!;
  state = withRun(state, {
    ...initialRun,
    petStats: { HP: 1_000, ATK: 1_000, DEF: 1_000, SPD: 1_000, LUK: 20 },
    petMaxHp: 1_000,
    petHp: 1_000,
  });
  for (let actionCount = 0; actionCount < 24; actionCount += 1) {
    const run = state.dungeon.activeRun!;
    if (run.phase === 'summary') return state;
    if (run.phase === 'choice') {
      state = applyAction(state, { type: 'dungeon-choose-room', roomType: run.roomChoices[0]! }).state;
    } else if (run.phase === 'tactic') {
      state = applyAction(state, { type: 'dungeon-choose-tactic', tacticId: 'guard' }).state;
    } else if (run.phase === 'combat') {
      state = advance(state, 100);
    } else if (run.phase === 'event') {
      const event = getDungeonData().events.find((candidate) => candidate.id === run.eventId)!;
      state = applyAction(state, { type: 'dungeon-choose-event', optionId: event.options[0]!.id }).state;
    } else if (run.phase === 'treasure') {
      state = applyAction(state, { type: 'dungeon-open-treasure' }).state;
    } else if (run.phase === 'rest') {
      state = applyAction(state, { type: 'dungeon-rest' }).state;
    } else if (run.phase === 'shop') {
      state = applyAction(state, { type: 'dungeon-finish-shop' }).state;
    } else if (run.phase === 'floor-end') {
      state = applyAction(state, { type: 'dungeon-leave' }).state;
    }
  }
  throw new Error('The deterministic floor simulation did not reach a run summary.');
}

describe('Phase 4 dungeon core', () => {
  it('uses the configured elemental wheel and damage formula', () => {
    expect(getElementMultiplier('fire', 'moss')).toBe(1.25);
    expect(getElementMultiplier('moss', 'water')).toBe(1.25);
    expect(getElementMultiplier('water', 'fire')).toBe(1.25);
    expect(getElementMultiplier('storm', 'shadow')).toBe(1.25);
    expect(getElementMultiplier('shadow', 'storm')).toBe(1.25);
    expect(getElementMultiplier('fire', 'fire')).toBe(1);
    expect(getElementMultiplier('moss', 'fire')).toBe(0.8);
    expect(calculateDamage({ attack: 100, defense: 100, skillMultiplier: 1, elementMultiplier: 1, randomMultiplier: 1 })).toBe(50);
  });

  it('scales enemy stats deterministically with floor and elite/boss multipliers', () => {
    const enemies = getDungeonData().enemies;
    const common = enemies.find((enemy) => enemy.id === 'cinder-sprout')!;
    const elite = enemies.find((enemy) => enemy.id === 'blazebark-bruiser')!;
    const boss = enemies.find((enemy) => enemy.id === 'cinder-crown')!;
    const firstFloor = scaleEnemy(common, 1);
    const secondFloor = scaleEnemy(common, 2);
    expect(secondFloor.HP).toBeGreaterThan(firstFloor.HP);
    expect(scaleEnemy(elite, 1).HP).toBe(Math.round(Math.round(elite.stats.HP * 1.09) * 1.6));
    expect(scaleEnemy(boss, 1).HP).toBe(Math.round(Math.round(boss.stats.HP * 1.09) * 2.5));
    const challenged = scaleEnemy(common, 1, {
      enemyStatsMultiplier: 1.06,
      enemyHpMultiplier: 1.25,
      enemyAttackMultiplier: 1.2,
      enemySpeedMultiplier: 1.1,
      lootChanceMultiplier: 1,
      rarityLuckBonus: 0,
      maxHpMultiplier: 1,
    });
    expect(challenged.HP).toBeGreaterThan(firstFloor.HP);
    expect(challenged.ATK).toBeGreaterThan(firstFloor.ATK);
  });

  it('starts a deterministic three-choice run with a validated three-slot pack', () => {
    const first = startRun(700, ['peppy-potion', 'brave-biscuit', 'sparkle-sip']).dungeon.activeRun!;
    const second = startRun(700, ['peppy-potion', 'brave-biscuit', 'sparkle-sip']).dungeon.activeRun!;
    expect(first.roomChoices).toHaveLength(3);
    expect(new Set(first.roomChoices).size).toBe(3);
    expect(first.roomChoices).toEqual(second.roomChoices);
    expect(first.rngSeed).toBe(second.rngSeed);
    expect(first.consumables).toHaveLength(3);

    const rejected = applyAction(readyPet(), { type: 'dungeon-start-run', consumables: ['peppy-potion', 'peppy-potion'] });
    expect(rejected.accepted).toBe(false);
    expect(rejected.state.dungeon.activeRun).toBeNull();
  });

  it('resolves the first auto-fight repeatably and awards configured XP/coins', () => {
    const first = simulateFirstFight(51);
    const second = simulateFirstFight(51);
    expect(first).toEqual(second);
    expect(first.roomIndex).toBe(1);
    expect(first.phase).toBe('choice');
    expect(first.coins).toBeGreaterThan(0);
    expect(first.combatLog.some((line) => line.includes('defeated'))).toBe(true);
  });

  it('records each defeated enemy once in the persistent Bestiary', () => {
    let state = chooseFight(startRun(511), { HP: 1_000, ATK: 1_000, DEF: 1_000, SPD: 1_000, LUK: 20 });
    const enemyId = state.dungeon.activeRun!.enemy!.id;
    for (let tick = 0; tick < 10 && state.dungeon.activeRun?.roomIndex === 0; tick += 1) state = advance(state, 100);
    expect(state.endless.defeatedEnemyIds).toEqual([enemyId]);
  });

  it('uses one fixed-seed Daily attempt per UTC date and records its best floor', () => {
    const dateKey = '2026-11-13';
    const daily = simulateOneFloor(512, 'daily', dateKey);
    expect(daily.endless.dailyAttemptDate).toBe(dateKey);
    expect(daily.endless.dailyBestFloor).toBe(1);
    expect(daily.endless.dailyBestDate).toBe(dateKey);
    expect(daily.endless.bestFloorSinceAscension).toBe(1);
    expect(daily.dungeon.activeRun?.mode).toBe('daily');
    expect(daily.dungeon.activeRun?.dailyDateKey).toBe(dateKey);
    expect(daily.dungeon.activeRun?.modifierIds).toEqual([]);

    const closed = applyAction(daily, { type: 'dungeon-close-summary' }).state;
    const repeat = applyAction(closed, { type: 'dungeon-start-run', consumables: [], mode: 'daily', dateKey });
    expect(repeat.accepted).toBe(false);
    const nextDay = applyAction(closed, { type: 'dungeon-start-run', consumables: [], mode: 'daily', dateKey: '2026-11-14' });
    expect(nextDay.accepted).toBe(true);
  });

  it('keeps Daily trials free of optional difficulty modifiers', () => {
    let state = readyPet(513);
    state = applyAction(state, { type: 'endless-set-modifiers', modifierIds: ['ironhide'] }).state;
    const daily = applyAction(state, { type: 'dungeon-start-run', consumables: [], mode: 'daily', dateKey: '2026-11-13' });
    expect(daily.accepted).toBe(true);
    expect(daily.state.dungeon.activeRun?.modifierIds).toEqual([]);
    expect(daily.state.dungeon.activeRun?.challengeEffects.enemyHpMultiplier).toBe(1);
  });

  it('keeps a complete floor and safe bank deterministic for the same seed', () => {
    const first = simulateOneFloor(61);
    const second = simulateOneFloor(61);
    expect(first.dungeon.activeRun).toEqual(second.dungeon.activeRun);
    expect(first.dungeon.coins).toBe(second.dungeon.coins);
    expect(first.dungeon.runsCompleted).toBe(1);
    expect(first.dungeon.activeRun?.phase).toBe('summary');
    expect(first.dungeon.activeRun?.result).toBe('left');
    expect(first.records.runsLeftSafely).toBe(1);
    expect(first.records.bestRunFloor).toBe(1);
    expect(first.records.totalCoinsBanked).toBe(first.dungeon.activeRun?.bankedCoins);
    expect(first.records.totalRoomsCleared).toBeGreaterThan(0);
  });

  it('activates a boss phase-two ability when the health threshold is crossed', () => {
    let state = startRun(52);
    let run = state.dungeon.activeRun!;
    run = {
      ...run,
      floor: 10,
      roomChoices: ['boss'],
      petStats: { HP: 1_000, ATK: 100, DEF: 1_000, SPD: 1_000, LUK: 1 },
      petMaxHp: 1_000,
      petHp: 1_000,
    };
    state = withRun(state, run);
    state = applyAction(state, { type: 'dungeon-choose-room', roomType: 'boss' }).state;
    state = applyAction(state, { type: 'dungeon-choose-tactic', tacticId: 'guard' }).state;
    for (let tick = 0; tick < 2; tick += 1) state = advance(state, 100);
    expect(state.dungeon.activeRun?.enemy?.phaseTwoTriggered).toBe(true);
    expect(state.dungeon.activeRun?.combatLog.some((line) => line.includes('new move'))).toBe(true);
  });

  it('records a first-biome boss win and automatically awards boss milestones', () => {
    let state = startRun(521);
    let run = state.dungeon.activeRun!;
    run = {
      ...run,
      floor: 10,
      roomChoices: ['boss'],
      petStats: { HP: 1_000, ATK: 1_000, DEF: 1_000, SPD: 1_000, LUK: 20 },
      petMaxHp: 1_000,
      petHp: 1_000,
    };
    state = withRun(state, run);
    state = applyAction(state, { type: 'dungeon-choose-room', roomType: 'boss' }).state;
    state = applyAction(state, { type: 'dungeon-choose-tactic', tacticId: 'all-in' }).state;
    run = state.dungeon.activeRun!;
    state = withRun(state, { ...run, petGauge: 100, enemy: { ...run.enemy!, hp: 1 } });
    state = advance(state, 100);

    expect(state.records.bossesDefeated).toBe(1);
    expect(state.home.bossFirstBiomes).toContain('cinder-copse');
    expect(state.home.bossClearedFloors).toContain(10);
    expect(state.home.unlockedAchievementIds).toContain('first-boss');
    expect(state.home.unlockedAchievementIds).toContain('depth-ten');
    expect(state.dungeon.essence).toBeGreaterThanOrEqual(35);
  });

  it('stores event boons and curses as run-only modifiers', () => {
    let state = startRun(53);
    let run = state.dungeon.activeRun!;
    let seed = 1;
    while (nextRandom(seed).value >= 0.6) seed += 1;
    run = { ...run, phase: 'event', currentRoom: 'event', eventId: 'twilight-promise', rngSeed: seed };
    state = withRun(state, run);
    state = applyAction(state, { type: 'dungeon-choose-event', optionId: 'thorny-bargain' }).state;
    const nextRun = state.dungeon.activeRun!;
    expect(nextRun.runStatMultipliers.HP).toBe(0.9);
    expect(nextRun.coinMultiplier).toBe(1.25);
    expect(nextRun.petMaxHp).toBe(Math.round(run.petStats.HP * 0.9));
  });

  it('uses a data-driven shop, three-slot pack, and persistent consumable effects within the run', () => {
    let state = startRun(54, ['peppy-potion']);
    let run = state.dungeon.activeRun!;
    run = { ...run, phase: 'shop', currentRoom: 'shop', shopOfferIds: ['brave-biscuit'], coins: 12 };
    state = withRun(state, run);
    state = applyAction(state, { type: 'dungeon-buy-consumable', consumableId: 'brave-biscuit' }).state;
    expect(state.dungeon.activeRun?.coins).toBe(4);
    expect(state.dungeon.activeRun?.consumables).toEqual(['peppy-potion', 'brave-biscuit']);
    state = applyAction(state, { type: 'dungeon-finish-shop' }).state;
    expect(state.dungeon.activeRun?.roomIndex).toBe(1);
    expect(state.dungeon.activeRun?.phase).toBe('choice');

    const usedFrom = state.dungeon.activeRun!;
    state = withRun(state, { ...usedFrom, petHp: Math.floor(usedFrom.petMaxHp / 2), consumables: ['peppy-potion'] });
    state = applyAction(state, { type: 'dungeon-use-consumable', slot: 0 }).state;
    expect(state.dungeon.activeRun?.petHp).toBeGreaterThan(Math.floor(usedFrom.petMaxHp / 2));
    expect(state.dungeon.activeRun?.consumables).toHaveLength(0);
  });

  it('applies a one-turn stat buff to the next attack before expiring it', () => {
    const combat = chooseFight(startRun(58));
    const run = combat.dungeon.activeRun!;
    const readyToAct = { ...run, petGauge: 100 };
    const baseline = advance(withRun(combat, { ...readyToAct, petStatuses: [] }), 100).dungeon.activeRun!;
    const boosted = advance(withRun(combat, {
      ...readyToAct,
      petStatuses: [{ type: 'buff', amount: 0, turns: 1, stat: 'ATK', multiplier: 1.15 }],
    }), 100).dungeon.activeRun!;
    expect(boosted.enemy!.hp).toBeLessThan(baseline.enemy!.hp);
    expect(boosted.petStatuses.some((status) => status.type === 'buff')).toBe(false);
  });

  it('banks all rewards on leave, but applies the faint penalty and exhausts Pip', () => {
    let state = startRun(55, ['peppy-potion']);
    let run = state.dungeon.activeRun!;
    run = { ...run, phase: 'floor-end', roomIndex: 3, coins: 10, lootIds: ['warm-pebble', 'cinder-charm', 'sunny-spark'] };
    state = withRun(state, run);
    state = applyAction(state, { type: 'dungeon-leave' }).state;
    expect(state.dungeon.activeRun?.phase).toBe('summary');
    expect(state.dungeon.activeRun?.result).toBe('left');
    expect(state.dungeon.activeRun?.bankedCoins).toBe(23);
    expect(state.dungeon.coins).toBe(23);
    expect(state.dungeon.activeRun?.lostLootCount).toBe(0);
    state = applyAction(state, { type: 'dungeon-close-summary' }).state;
    expect(state.dungeon.activeRun).toBeNull();

    let faintState = startRun(56, ['peppy-potion']);
    faintState = chooseFight(faintState);
    const active = faintState.dungeon.activeRun!;
    faintState = withRun(faintState, { ...active, petHp: 0, coins: 10, lootIds: ['warm-pebble', 'cinder-charm', 'sunny-spark'] });
    faintState = advance(faintState, 100);
    const summary = faintState.dungeon.activeRun!;
    expect(summary.result).toBe('fainted');
    expect(summary.bankedCoins).toBeGreaterThanOrEqual(7);
    expect(summary.bankedCoins).toBeLessThanOrEqual(12);
    expect([2, 4, 7]).toContain(summary.bankedCoins - Math.floor(10 / 2));
    expect(summary.lostLootCount).toBe(2);
    expect(summary.consumables).toEqual([]);
    expect(faintState.needs.energy).toBe(0);
    expect(faintState.records.runsFainted).toBe(1);
  });

  it('bounds persisted dungeon state and keeps valid run snapshots on schema-v6 load', () => {
    const active = startRun(57, ['peppy-potion']);
    const restored = migrateSave(JSON.parse(JSON.stringify(active)) as unknown);
    expect(restored.schemaVersion).toBe(6);
    expect(restored.paused).toBe(true);
    expect(restored.dungeon.activeRun?.consumables).toEqual(['peppy-potion']);
    expect(restored.dungeon.activeRun?.petFormId).toBe(formId);
    expect(restored.dungeon.activeRun?.mode).toBe('standard');
    expect(restored.dungeon.activeRun?.challengeEffects.enemyStatsMultiplier).toBe(1);

    expect(migrateDungeonProgress({ coins: -4, deepestFloor: 1e20, activeRun: { phase: 'combat' } })).toMatchObject({
      coins: 0,
      deepestFloor: 1_000_000,
      activeRun: null,
    });
  });
});
