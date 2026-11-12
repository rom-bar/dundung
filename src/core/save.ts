import rules from '../data/rules.json';
import { getAllForms, getFormDefinition, getLevelCap, getTraitDefinition } from './progression';
import type { Element, GameState, LifeStage, Needs, PetRecord, Stats, Tendencies } from './types';
import { createInitialState } from './game';

const maximumLevel = Math.max(...Object.values(rules.lifeStages.levelCaps));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function nonNegative(value: unknown): number {
  return boundedNumber(value, 0, 0, Number.MAX_SAFE_INTEGER);
}

function validStage(value: unknown): LifeStage {
  return value === 'baby' || value === 'teen' || value === 'adult' || value === 'elder' ? value : 'egg';
}

function validPetRecord(value: unknown): PetRecord | null {
  if (!isRecord(value)) return null;
  const formIds = new Set(getAllForms().map((form) => form.id));
  const formId = typeof value.formId === 'string' && formIds.has(value.formId) ? value.formId : null;
  const inheritedTraitId = typeof value.inheritedTraitId === 'string' && getTraitDefinition(value.inheritedTraitId)
    ? value.inheritedTraitId
    : null;
  return {
    generation: Math.floor(boundedNumber(value.generation, 1, 1, 1_000_000)),
    name: getFormDefinition(formId)?.name ?? 'Pip',
    formId,
    peakLevel: Math.floor(boundedNumber(value.peakLevel, 1, 1, maximumLevel)),
    activeSeconds: nonNegative(value.activeSeconds),
    inheritedTraitId,
  };
}

export function migrateSave(input: unknown): GameState {
  if (!isRecord(input)) throw new Error('Save data is not an object.');
  const version = typeof input.schemaVersion === 'number' ? input.schemaVersion : 0;
  if (version > 2) throw new Error(`Save version ${version} is newer than this game.`);

  const base = createInitialState(typeof input.seed === 'number' ? input.seed : 1);
  const oldNeeds = isRecord(input.needs) ? input.needs : {};
  const needs: Needs = {
    hunger: boundedNumber(oldNeeds.hunger, base.needs.hunger, rules.needs.minimum, rules.needs.maximum),
    happiness: boundedNumber(oldNeeds.happiness, base.needs.happiness, rules.needs.minimum, rules.needs.maximum),
    energy: boundedNumber(oldNeeds.energy, base.needs.energy, rules.needs.minimum, rules.needs.maximum),
    hygiene: boundedNumber(oldNeeds.hygiene, base.needs.hygiene, rules.needs.minimum, rules.needs.maximum),
  };
  const oldSignalCooldowns = isRecord(input.signalCooldowns) ? input.signalCooldowns : {};
  const signalCooldowns: Needs = {
    hunger: boundedNumber(oldSignalCooldowns.hunger, 0, 0, rules.needs.signalCooldownSeconds.hunger),
    happiness: boundedNumber(oldSignalCooldowns.happiness, 0, 0, rules.needs.signalCooldownSeconds.happiness),
    energy: boundedNumber(oldSignalCooldowns.energy, 0, 0, rules.needs.signalCooldownSeconds.energy),
    hygiene: boundedNumber(oldSignalCooldowns.hygiene, 0, 0, rules.needs.signalCooldownSeconds.hygiene),
  };
  const oldCooldowns = isRecord(input.cooldowns) ? input.cooldowns : {};
  const cooldowns = {
    feed: boundedNumber(oldCooldowns.feed, 0, 0, rules.actionCooldownSeconds.feed),
    play: boundedNumber(oldCooldowns.play, 0, 0, rules.actionCooldownSeconds.play),
    clean: boundedNumber(oldCooldowns.clean, 0, 0, rules.actionCooldownSeconds.clean),
    sleep: boundedNumber(oldCooldowns.sleep, 0, 0, rules.actionCooldownSeconds.sleep),
  };

  const stage = validStage(input.stage);
  const levelCap = getLevelCap(stage);
  const level = Math.floor(boundedNumber(input.level, 1, 1, levelCap));
  const trainingCap = level * rules.progression.trainingCapPerLevel;
  const oldTraining = isRecord(input.training) ? input.training : {};
  const training: Stats = {
    HP: boundedNumber(oldTraining.HP, 0, 0, trainingCap),
    ATK: boundedNumber(oldTraining.ATK, 0, 0, trainingCap),
    DEF: boundedNumber(oldTraining.DEF, 0, 0, trainingCap),
    SPD: boundedNumber(oldTraining.SPD, 0, 0, trainingCap),
    LUK: boundedNumber(oldTraining.LUK, 0, 0, trainingCap),
  };
  const oldTendencies = isRecord(input.tendencies) ? input.tendencies : {};
  const tendencies: Tendencies = {
    play: boundedNumber(oldTendencies.play, 0, 0, 1),
    sleep: boundedNumber(oldTendencies.sleep, 0, 0, 1),
    fight: boundedNumber(oldTendencies.fight, 0, 0, 1),
    training: boundedNumber(oldTendencies.training, 0, 0, 1),
    feedQuality: boundedNumber(oldTendencies.feedQuality, 0, 0, 1),
    hygiene: boundedNumber(oldTendencies.hygiene, 0, 0, 1),
  };

  const oldEvolution = isRecord(input.evolution) ? input.evolution : {};
  const forms = getAllForms();
  const validFormIds = new Set(forms.map((form) => form.id));
  const formId = typeof oldEvolution.formId === 'string' && validFormIds.has(oldEvolution.formId) ? oldEvolution.formId : null;
  const validTraitIds = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(getTraitDefinition(item))))].slice(0, 8)
    : [];
  const validTrait = (value: unknown): string | null => typeof value === 'string' && getTraitDefinition(value) ? value : null;
  const oldMeals = isRecord(oldEvolution.elementMeals) ? oldEvolution.elementMeals : {};
  const elementMeals: Record<Element, number> = {
    fire: nonNegative(oldMeals.fire),
    water: nonNegative(oldMeals.water),
    moss: nonNegative(oldMeals.moss),
    storm: nonNegative(oldMeals.storm),
    shadow: nonNegative(oldMeals.shadow),
  };
  const evolution = {
    formId,
    traitIds: validTraitIds(oldEvolution.traitIds),
    mutationTraitId: validTrait(oldEvolution.mutationTraitId),
    drawbackTraitId: validTrait(oldEvolution.drawbackTraitId),
    rareMisses: Math.floor(boundedNumber(oldEvolution.rareMisses, 0, 0, 1_000_000)),
    evolutionStones: Math.floor(boundedNumber(oldEvolution.evolutionStones, 0, 0, 1_000_000)),
    elementMeals,
    inheritedTraitId: validTrait(oldEvolution.inheritedTraitId),
    baseStatBonus: boundedNumber(oldEvolution.baseStatBonus, 0, 0, 100),
  };
  const formDex = Array.isArray(input.formDex)
    ? [...new Set(input.formDex.filter((id): id is string => typeof id === 'string' && validFormIds.has(id)))].slice(0, forms.length)
    : [];
  if (formId && !formDex.includes(formId)) formDex.push(formId);
  const hallOfPets = Array.isArray(input.hallOfPets)
    ? input.hallOfPets.map(validPetRecord).filter((record): record is PetRecord => record !== null).slice(0, rules.progression.hallOfPetsLimit)
    : [];

  return {
    ...base,
    schemaVersion: 2,
    seed: typeof input.seed === 'number' ? input.seed >>> 0 : base.seed,
    stage,
    stageSeconds: Math.min(nonNegative(input.stageSeconds), rules.lifeStages.stageMinutes[stage] * 60),
    activeSeconds: nonNegative(input.activeSeconds),
    generationSeconds: nonNegative(input.generationSeconds ?? input.activeSeconds),
    needs,
    signalCooldowns,
    sleeping: input.sleeping === true,
    paused: true,
    cooldowns,
    animation: 'idle',
    animationRemainingSeconds: 0,
    generation: Math.floor(boundedNumber(input.generation, 1, 1, 1_000_000)),
    level,
    xp: nonNegative(input.xp),
    training,
    tendencies,
    evolution,
    formDex,
    hallOfPets,
    miniGameCooldownSeconds: boundedNumber(input.miniGameCooldownSeconds, 0, 0, rules.progression.miniGameCooldownSeconds),
    peakLevel: Math.floor(boundedNumber(input.peakLevel, level, level, maximumLevel)),
  };
}
