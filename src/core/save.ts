import rules from '../data/rules.json';
import type { GameState, Needs } from './types';
import { createInitialState } from './game';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validNeed(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(rules.needs.maximum, Math.max(rules.needs.minimum, value))
    : fallback;
}

function validCooldown(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function migrateSave(input: unknown): GameState {
  if (!isRecord(input)) throw new Error('Save data is not an object.');
  const version = typeof input.schemaVersion === 'number' ? input.schemaVersion : 0;
  if (version > 1) throw new Error(`Save version ${version} is newer than this game.`);

  const base = createInitialState(typeof input.seed === 'number' ? input.seed : 1);
  const oldNeeds = isRecord(input.needs) ? input.needs : {};
  const needs: Needs = {
    hunger: validNeed(oldNeeds.hunger, base.needs.hunger),
    happiness: validNeed(oldNeeds.happiness, base.needs.happiness),
    energy: validNeed(oldNeeds.energy, base.needs.energy),
    hygiene: validNeed(oldNeeds.hygiene, base.needs.hygiene),
  };
  const oldSignalCooldowns = isRecord(input.signalCooldowns) ? input.signalCooldowns : {};
  const signalCooldowns: Needs = {
    hunger: validCooldown(oldSignalCooldowns.hunger),
    happiness: validCooldown(oldSignalCooldowns.happiness),
    energy: validCooldown(oldSignalCooldowns.energy),
    hygiene: validCooldown(oldSignalCooldowns.hygiene),
  };
  const stage = input.stage === 'baby' ? 'baby' : 'egg';
  const cooldownsInput = isRecord(input.cooldowns) ? input.cooldowns : {};
  const cooldowns = {
    feed: validCooldown(cooldownsInput.feed),
    play: validCooldown(cooldownsInput.play),
    clean: validCooldown(cooldownsInput.clean),
    sleep: validCooldown(cooldownsInput.sleep),
  };

  return {
    ...base,
    schemaVersion: 1,
    seed: typeof input.seed === 'number' ? input.seed >>> 0 : base.seed,
    stage,
    stageSeconds: nonNegative(input.stageSeconds),
    activeSeconds: nonNegative(input.activeSeconds),
    needs,
    signalCooldowns,
    sleeping: input.sleeping === true,
    paused: true,
    cooldowns,
    animation: 'idle',
    animationRemainingSeconds: 0,
  };
}
