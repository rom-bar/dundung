import rules from '../data/rules.json';
import foods from '../data/foods.json';
import type { ActionResult, CooldownKey, GameAction, GameState, Needs, NeedKey } from './types';

const needKeys: NeedKey[] = ['hunger', 'happiness', 'energy', 'hygiene'];
const initialCooldowns: Record<CooldownKey, number> = {
  feed: 0,
  play: 0,
  clean: 0,
  sleep: 0,
};
const initialSignalCooldowns: Needs = {
  hunger: 0,
  happiness: 0,
  energy: 0,
  hygiene: 0,
};

function clampNeed(value: number): number {
  return Math.min(rules.needs.maximum, Math.max(rules.needs.minimum, value));
}

export function createInitialState(seed = 1): GameState {
  return {
    schemaVersion: 1,
    seed: seed >>> 0,
    stage: 'egg',
    stageSeconds: 0,
    activeSeconds: 0,
    needs: { ...rules.needs.starting },
    signalCooldowns: { ...initialSignalCooldowns },
    sleeping: false,
    paused: false,
    cooldowns: { ...initialCooldowns },
    animation: 'idle',
    animationRemainingSeconds: 0,
  };
}

export function advance(state: GameState, dtMs: number): GameState {
  if (state.paused || !Number.isFinite(dtMs) || dtMs <= 0) return state;

  const stepMs = Math.min(dtMs, rules.simulation.maxStepMs);
  const stepSeconds = stepMs / 1000;
  const needs: Needs = { ...state.needs };
  const rates = state.sleeping
    ? rules.needs.decayPerMinute.sleeping
    : rules.needs.decayPerMinute.awake;

  for (const key of needKeys) {
    needs[key] = clampNeed(needs[key] - rates[key] * (stepSeconds / 60));
  }

  const cooldowns = { ...state.cooldowns };
  for (const key of Object.keys(cooldowns) as CooldownKey[]) {
    cooldowns[key] = Math.max(0, cooldowns[key] - stepSeconds);
  }
  const signalCooldowns = { ...state.signalCooldowns };
  for (const key of needKeys) {
    signalCooldowns[key] = Math.max(0, signalCooldowns[key] - stepSeconds);
  }

  const activeSeconds = state.activeSeconds + stepSeconds;
  let stage = state.stage;
  let stageSeconds = state.stageSeconds + stepSeconds;
  if (stage === 'egg') {
    const hatchSeconds = rules.lifeStages.eggMinutes * 60;
    if (stageSeconds >= hatchSeconds) {
      stage = 'baby';
      stageSeconds = Math.max(0, stageSeconds - hatchSeconds);
    }
  } else {
    stageSeconds = Math.min(stageSeconds, rules.lifeStages.babyMinutes * 60);
  }

  const animationRemainingSeconds = Math.max(0, state.animationRemainingSeconds - stepSeconds);
  const animation = animationRemainingSeconds === 0
    ? (state.sleeping ? 'sleep' : 'idle')
    : state.animation;

  return {
    ...state,
    stage,
    stageSeconds,
    activeSeconds,
    needs,
    signalCooldowns,
    cooldowns,
    animation,
    animationRemainingSeconds,
  };
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

function startAnimation(
  state: GameState,
  animation: GameState['animation'],
  durationSeconds: number,
): GameState {
  return { ...state, animation, animationRemainingSeconds: durationSeconds };
}

function withNeedEffects(state: GameState, effects: Partial<Needs>): GameState {
  const needs = { ...state.needs };
  for (const key of needKeys) {
    const effect = effects[key];
    if (effect !== undefined) needs[key] = clampNeed(needs[key] + effect);
  }
  return { ...state, needs };
}

function reject(state: GameState, message: string): ActionResult {
  return { state, accepted: false, message };
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  if (state.paused) return reject(state, 'Tap continue before caring for Pip.');

  if (action.type === 'toggle-sleep') {
    const key: CooldownKey = 'sleep';
    if (state.cooldowns[key] > 0) return reject(state, 'Give Pip a moment first.');
    const sleeping = !state.sleeping;
    const next = {
      ...state,
      sleeping,
      cooldowns: { ...state.cooldowns, [key]: rules.actionCooldownSeconds[key] },
    };
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
    const next = withNeedEffects(state, {
      hunger: food.hunger,
      happiness: food.happiness,
      energy: food.energy,
      hygiene: food.hygiene,
    });
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
    const next = withNeedEffects(state, rules.actionEffects.play);
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

  const next = withNeedEffects(state, rules.actionEffects.clean);
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
  return {
    minimum: rules.needs.minimum,
    maximum: rules.needs.maximum,
    signal: rules.needs.signalThreshold,
  };
}
