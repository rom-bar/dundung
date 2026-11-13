import { describe, expect, it } from 'vitest';
import { advance, applyAction, createInitialState } from '../src/core/game';
import { collectStageEvents } from '../src/core/stage-events';
import type { GameAction, GameState, StageEventPayload } from '../src/core/types';

const formId = 'fire-emberguard';
const strongStats = { HP: 1_000, ATK: 1_000, DEF: 1_000, SPD: 1_000, LUK: 20 };

function readyPet(seed: number): GameState {
  const state = createInitialState(seed);
  return {
    ...state,
    stage: 'baby',
    evolution: { ...state.evolution, formId },
    formDex: [formId],
  };
}

function runSeededFight(seed: number): { events: StageEventPayload[]; state: GameState } {
  const ready = readyPet(seed);
  const started = applyAction(ready, { type: 'dungeon-start-run', consumables: [] });
  expect(started.accepted).toBe(true);
  const payloads: StageEventPayload[] = collectStageEvents(ready, started.state);

  const active = started.state.dungeon.activeRun!;
  const choiceState: GameState = {
    ...started.state,
    dungeon: {
      ...started.state.dungeon,
      activeRun: {
        ...active,
        roomChoices: ['fight'],
        petStats: strongStats,
        petMaxHp: strongStats.HP,
        petHp: strongStats.HP,
      },
    },
  };
  const room = applyAction(choiceState, { type: 'dungeon-choose-room', roomType: 'fight' }).state;
  payloads.push(...collectStageEvents(choiceState, room));
  let state = applyAction(room, { type: 'dungeon-choose-tactic', tacticId: 'all-in' }).state;
  payloads.push(...collectStageEvents(room, state));

  for (let tick = 0; tick < 12 && state.dungeon.activeRun?.roomIndex === 0; tick += 1) {
    const next = advance(state, 100);
    payloads.push(...collectStageEvents(state, next));
    state = next;
  }
  return { events: payloads, state };
}

function seededCombatState(seed: number): GameState {
  const ready = readyPet(seed);
  const started = applyAction(ready, { type: 'dungeon-start-run', consumables: [] }).state;
  const active = started.dungeon.activeRun!;
  const choice: GameState = {
    ...started,
    dungeon: {
      ...started.dungeon,
      activeRun: { ...active, roomChoices: ['fight'], petStats: strongStats, petMaxHp: strongStats.HP, petHp: strongStats.HP },
    },
  };
  const room = applyAction(choice, { type: 'dungeon-choose-room', roomType: 'fight' }).state;
  return applyAction(room, { type: 'dungeon-choose-tactic', tacticId: 'all-in' }).state;
}

describe('stage event collection', () => {
  it('derives ordered walk, room, enemy, combat, attack and victory events from real transitions', () => {
    const first = runSeededFight(51);
    const second = runSeededFight(51);

    expect(first.events.map((event) => event.type)).toEqual(second.events.map((event) => event.type));
    expect(first.events).toEqual(second.events);
    expect(first.events[0]).toMatchObject({ type: 'walk_start', floor: 1 });
    expect(first.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'room_enter', 'enemy_appear', 'combat_start', 'attack', 'victory',
    ]));
    expect(first.state.dungeon.activeRun?.roomIndex).toBe(1);
  });

  it('does not mutate either snapshot or alter the seeded simulation outcome', () => {
    const ready = readyPet(802);
    const before = structuredClone(ready);
    const action: GameAction = { type: 'dungeon-start-run', consumables: [] };
    const next = applyAction(ready, action).state;
    const expected = structuredClone(next);

    const events = collectStageEvents(ready, next);

    expect(events).toContainEqual({ type: 'walk_start', floor: 1, biomeId: 'cinder-copse' });
    expect(ready).toEqual(before);
    expect(next).toEqual(expected);
    expect(applyAction(ready, action).state).toEqual(next);
  });

  it('targets burn cues at the real victim without duplicating environmental damage', () => {
    const combat = seededCombatState(337);
    const run = combat.dungeon.activeRun!;
    const previousRun = { ...run, combatLog: [] };
    const previous: GameState = { ...combat, dungeon: { ...combat.dungeon, activeRun: previousRun } };
    const petBurn: GameState = {
      ...previous,
      dungeon: {
        ...previous.dungeon,
        activeRun: { ...previousRun, petHp: previousRun.petHp - 3, combatLog: ['Pip takes 3 burn damage.'] },
      },
    };
    const enemy = previousRun.enemy!;
    const enemyBurn: GameState = {
      ...previous,
      dungeon: {
        ...previous.dungeon,
        activeRun: {
          ...previousRun,
          enemy: { ...enemy, hp: enemy.hp - 4 },
          combatLog: [`${enemy.name} takes 4 burn damage.`],
        },
      },
    };

    const petAttacks = collectStageEvents(previous, petBurn).filter((event) => event.type === 'attack');
    expect(petAttacks).toEqual([{
      type: 'attack', source: 'enemy', target: 'pet', actor: 'Pip', skill: 'Burn', amount: 3,
      critical: false, strongHit: false, flavor: 'burn',
    }]);
    expect(collectStageEvents(previous, enemyBurn)).toContainEqual({
      type: 'attack', source: 'pet', target: 'enemy', actor: enemy.name, skill: 'Burn', amount: 4,
      critical: false, strongHit: false, flavor: 'burn',
    });
  });

  it('emits a decision scene but never invents a player choice', () => {
    const ready = readyPet(991);
    const started = applyAction(ready, { type: 'dungeon-start-run', consumables: [] }).state;
    const run = started.dungeon.activeRun!;
    const pending = {
      ...started,
      dungeon: {
        ...started.dungeon,
        activeRun: { ...run, phase: 'event' as const, eventId: 'lantern-lost', currentRoom: 'event' as const },
      },
    };
    const events = collectStageEvents(started, pending);

    expect(events).toContainEqual({ type: 'room_story', roomType: 'event', title: 'The Lost Lantern' });
    expect(pending.dungeon.activeRun?.phase).toBe('event');
    expect(pending.dungeon.activeRun?.eventId).toBe('lantern-lost');
  });

  it('emits a typed buff event separately from negative combat statuses', () => {
    const started = applyAction(readyPet(711), { type: 'dungeon-start-run', consumables: [] }).state;
    const run = started.dungeon.activeRun!;
    const previous: GameState = {
      ...started,
      dungeon: { ...started.dungeon, activeRun: { ...run, petStatuses: [] } },
    };
    const next: GameState = {
      ...started,
      dungeon: {
        ...started.dungeon,
        activeRun: { ...run, petStatuses: [{ type: 'buff', stat: 'ATK', amount: 4, multiplier: 1.2, turns: 3 }] },
      },
    };

    expect(collectStageEvents(previous, next)).toContainEqual({
      type: 'buff_applied', target: 'pet', stat: 'ATK', amount: 4, multiplier: 1.2, turns: 3,
    });
  });
});
