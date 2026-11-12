import rules from '../data/rules.json';
import foods from '../data/foods.json';
import {
  awardTraining,
  awardXp,
  completeGeneration,
  emptyTendencies,
  evolveForStage,
  getLevelCap,
  getTraitEffects,
  pointsForMiniGameScore,
  recordFoodElement,
  rerollWithEvolutionStone,
  updateTendency,
} from './progression';
import type { ActionResult, CooldownKey, GameAction, GameState, Needs, NeedKey, StatKey } from './types';

const needKeys: NeedKey[] = ['hunger', 'happiness', 'energy', 'hygiene'];
const initialCooldowns: Record<CooldownKey, number> = { feed: 0, play: 0, clean: 0, sleep: 0 };
const initialSignalCooldowns: Needs = { hunger: 0, happiness: 0, energy: 0, hygiene: 0 };
const stageNext = { egg: 'baby', baby: 'teen', teen: 'adult', adult: 'elder' } as const;

function clampNeed(value: number): number {
  return Math.min(rules.needs.maximum, Math.max(rules.needs.minimum, value));
}

function stageDurationSeconds(stage: GameState['stage']): number {
  return rules.lifeStages.stageMinutes[stage] * 60;
}

export function createInitialState(seed = 1): GameState {
  return {
    schemaVersion: 2,
    seed: seed >>> 0,
    stage: 'egg',
    stageSeconds: 0,
    activeSeconds: 0,
    generationSeconds: 0,
    needs: { ...rules.needs.starting },
    signalCooldowns: { ...initialSignalCooldowns },
    sleeping: false,
    paused: false,
    cooldowns: { ...initialCooldowns },
    animation: 'idle',
    animationRemainingSeconds: 0,
    generation: 1,
    level: 1,
    xp: 0,
    training: { HP: 0, ATK: 0, DEF: 0, SPD: 0, LUK: 0 },
    tendencies: emptyTendencies(),
    evolution: {
      formId: null,
      traitIds: [],
      mutationTraitId: null,
      drawbackTraitId: null,
      rareMisses: 0,
      evolutionStones: 0,
      elementMeals: { fire: 0, water: 0, moss: 0, storm: 0, shadow: 0 },
      inheritedTraitId: null,
      baseStatBonus: 0,
    },
    formDex: [],
    hallOfPets: [],
    miniGameCooldownSeconds: 0,
    peakLevel: 1,
  };
}

export function advance(state: GameState, dtMs: number): GameState {
  if (state.paused || !Number.isFinite(dtMs) || dtMs <= 0) return state;

  const stepMs = Math.min(dtMs, rules.simulation.maxStepMs);
  const stepSeconds = stepMs / 1000;
  const needs: Needs = { ...state.needs };
  const baseRates = state.sleeping ? rules.needs.decayPerMinute.sleeping : rules.needs.decayPerMinute.awake;
  const traitEffects = getTraitEffects(state);
  for (const key of needKeys) {
    let multiplier = traitEffects.needsDecayMultiplier;
    if (key === 'hygiene') multiplier *= traitEffects.hygieneDecayMultiplier;
    if (key === 'energy' && state.sleeping) multiplier *= traitEffects.sleepEnergyMultiplier;
    needs[key] = clampNeed(needs[key] - baseRates[key] * multiplier * (stepSeconds / 60));
  }

  const cooldowns = { ...state.cooldowns };
  for (const key of Object.keys(cooldowns) as CooldownKey[]) {
    cooldowns[key] = Math.max(0, cooldowns[key] - stepSeconds);
  }
  const signalCooldowns = { ...state.signalCooldowns };
  for (const key of needKeys) signalCooldowns[key] = Math.max(0, signalCooldowns[key] - stepSeconds);

  const activeSeconds = state.activeSeconds + stepSeconds;
  const generationSeconds = state.generationSeconds + stepSeconds;
  const animationRemainingSeconds = Math.max(0, state.animationRemainingSeconds - stepSeconds);
  let next: GameState = {
    ...state,
    activeSeconds,
    generationSeconds,
    needs,
    signalCooldowns,
    cooldowns,
    miniGameCooldownSeconds: Math.max(0, state.miniGameCooldownSeconds - stepSeconds),
    animationRemainingSeconds,
    animation: animationRemainingSeconds === 0 ? (state.sleeping ? 'sleep' : 'idle') : state.animation,
  };

  const stageSeconds = state.stageSeconds + stepSeconds;
  if (stageSeconds < stageDurationSeconds(state.stage)) return { ...next, stageSeconds };

  const leftover = Math.max(0, stageSeconds - stageDurationSeconds(state.stage));
  if (state.stage === 'elder') {
    return completeGeneration({ ...next, stageSeconds });
  }

  const nextStage = stageNext[state.stage];
  next = {
    ...next,
    stage: nextStage,
    stageSeconds: leftover,
    level: Math.min(next.level, getLevelCap(nextStage)),
    sleeping: false,
  };
  const evolved = evolveForStage(next);
  return { ...evolved, tendencies: { ...emptyTendencies() } };
}

export function advanceWithSignals(state: GameState, dtMs: number): { state: GameState; signals: NeedKey[] } {
  const next = advance(state, dtMs);
  if (next === state) return { state, signals: [] };

  const signalCooldowns = { ...next.signalCooldowns };
  const signals = needKeys.filter((key) => {
    const crossedThreshold = state.needs[key] >= rules.needs.signalThreshold
      && next.needs[key] < rules.needs.signalThreshold;
    if (!crossedThreshold || signalCooldowns[key] > 0) return false;
    signalCooldowns[key] = rules.needs.signalCooldownSeconds[key];
    return true;
  });
  return { state: { ...next, signalCooldowns }, signals };
}

function startAnimation(state: GameState, animation: GameState['animation'], durationSeconds: number): GameState {
  return { ...state, animation, animationRemainingSeconds: durationSeconds };
}

function withNeedEffects(state: GameState, effects: Partial<Needs>, multiplier = 1): GameState {
  const needs = { ...state.needs };
  for (const key of needKeys) {
    const effect = effects[key];
    if (effect !== undefined) needs[key] = clampNeed(needs[key] + effect * multiplier);
  }
  return { ...state, needs };
}

function reject(state: GameState, message: string): ActionResult {
  return { state, accepted: false, message };
}

function awardCareXp(state: GameState, action: keyof typeof rules.progression.xpRewards): GameState {
  return awardXp(state, rules.progression.xpRewards[action]);
}

function completeMiniGame(state: GameState, action: Extract<GameAction, { type: 'mini-game-complete' }>): ActionResult {
  if (state.miniGameCooldownSeconds > 0) return reject(state, 'A short breather before the next training game.');
  if (state.stage === 'egg') return reject(state, 'Wait until Pip hatches before training.');
  if (state.sleeping) return reject(state, 'Wake Pip before training.');
  const score = Number.isFinite(action.score)
    ? Math.min(rules.progression.miniGameMaximumScore, Math.max(0, action.score))
    : 0;
  const points = pointsForMiniGameScore(score);
  const trainingResult = awardTraining(state, action.stat, points);
  let next = updateTendency(trainingResult.state, 'training', rules.progression.tendencySignals.training);
  next = {
    ...next,
    miniGameCooldownSeconds: rules.progression.miniGameCooldownSeconds,
  };
  next = awardXp(next, Math.floor(rules.progression.xpRewards.miniGame * score / rules.progression.miniGameMaximumScore));
  const statName: Record<StatKey, string> = { HP: 'health', ATK: 'attack', DEF: 'defense', SPD: 'speed', LUK: 'luck' };
  const message = trainingResult.awarded > 0
    ? `Training complete: +${trainingResult.awarded} ${statName[action.stat]} point${trainingResult.awarded === 1 ? '' : 's'}.`
    : points > 0
      ? `${statName[action.stat]} training is at its level cap.`
      : 'Training done. Try again for a training point.';
  return { state: next, accepted: true, message, action: trainingResult.awarded > 0 ? 'train' : undefined };
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  if (state.paused) return reject(state, 'Tap continue before caring for Pip.');
  if (action.type === 'mini-game-complete') return completeMiniGame(state, action);
  if (action.type === 'use-evolution-stone') {
    if (state.evolution.evolutionStones < 1 || !state.evolution.formId) return reject(state, 'No Evolution Stone is ready.');
    const next = rerollWithEvolutionStone(state);
    return { state: next, accepted: true, message: 'The Evolution Stone revealed a new form!', action: 'train' };
  }

  if (action.type === 'toggle-sleep') {
    const key: CooldownKey = 'sleep';
    if (state.cooldowns[key] > 0) return reject(state, 'Give Pip a moment first.');
    const sleeping = !state.sleeping;
    let next: GameState = {
      ...state,
      sleeping,
      cooldowns: { ...state.cooldowns, [key]: rules.actionCooldownSeconds[key] },
    };
    if (sleeping) next = updateTendency(next, 'sleep', rules.progression.tendencySignals.sleep);
    next = awardCareXp(next, 'sleep');
    return {
      state: startAnimation(next, sleeping ? 'sleep' : 'wake', rules.animationSeconds[sleeping ? 'sleep' : 'wake']),
      accepted: true,
      message: sleeping ? 'Pip is tucked in.' : 'Pip is awake again.',
      action: key,
    };
  }

  const key: CooldownKey = action.type;
  if (state.cooldowns[key] > 0) return reject(state, 'Give Pip a moment first.');
  if (state.sleeping) return reject(state, 'Wake Pip before doing that.');

  if (action.type === 'feed') {
    const food = foods.find((item) => item.id === action.foodId);
    if (!food) return reject(state, 'That snack is not in the pantry.');
    const traitEffects = getTraitEffects(state);
    let next = withNeedEffects(state, {
      hunger: food.hunger,
      happiness: food.happiness,
      energy: food.energy,
      hygiene: food.hygiene,
    }, traitEffects.foodEffectMultiplier * traitEffects.careEffectMultiplier);
    next = recordFoodElement(next, food.tags);
    next = updateTendency(next, 'feedQuality', food.tags.includes('comfort')
      ? rules.progression.tendencySignals.feedComfort
      : rules.progression.tendencySignals.feedOther);
    next = awardCareXp(next, 'feed');
    return {
      state: startAnimation(
        { ...next, cooldowns: { ...next.cooldowns, feed: rules.actionCooldownSeconds.feed } },
        'eat',
        rules.animationSeconds.eat,
      ),
      accepted: true,
      message: `Pip enjoyed the ${food.name.toLowerCase()}.`,
      action: 'feed',
    };
  }

  if (action.type === 'play') {
    const traitEffects = getTraitEffects(state);
    let next = withNeedEffects(state, rules.actionEffects.play, traitEffects.careEffectMultiplier);
    next = updateTendency(next, 'play', rules.progression.tendencySignals.play);
    next = awardCareXp(next, 'play');
    return {
      state: startAnimation(
        { ...next, cooldowns: { ...next.cooldowns, play: rules.actionCooldownSeconds.play } },
        'play',
        rules.animationSeconds.play,
      ),
      accepted: true,
      message: 'Pip had a lovely little play.',
      action: 'play',
    };
  }

  const traitEffects = getTraitEffects(state);
  let next = withNeedEffects(state, rules.actionEffects.clean, traitEffects.careEffectMultiplier);
  next = updateTendency(next, 'hygiene', rules.progression.tendencySignals.hygiene);
  next = awardCareXp(next, 'clean');
  return {
    state: startAnimation(
      { ...next, cooldowns: { ...next.cooldowns, clean: rules.actionCooldownSeconds.clean } },
      'clean',
      rules.animationSeconds.clean,
    ),
    accepted: true,
    message: 'Pip is fresh as a cave flower.',
    action: 'clean',
  };
}

export function getNeedSignals(state: GameState): NeedKey[] {
  return needKeys.filter((key) => state.needs[key] < rules.needs.signalThreshold);
}

export function getMood(state: GameState): 'content' | 'needs-care' | 'unhappy' | 'sick' {
  if (state.needs.hygiene <= rules.needs.unhappyThreshold) return 'sick';
  if (needKeys.some((key) => state.needs[key] <= rules.needs.unhappyThreshold)) return 'unhappy';
  if (getNeedSignals(state).length > 0) return 'needs-care';
  return 'content';
}

export function getNeedBounds(): { minimum: number; maximum: number; signal: number } {
  return { minimum: rules.needs.minimum, maximum: rules.needs.maximum, signal: rules.needs.signalThreshold };
}
