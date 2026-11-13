import evolutions from '../data/evolutions.json';
import rules from '../data/rules.json';
import traitsJson from '../data/traits.json';
import { applyEquipmentToStats } from './equipment';
import { nextRandom } from './rng';
import type {
  Archetype,
  Element,
  EvolutionProgress,
  FormDefinition,
  GameState,
  LifeStage,
  PetRecord,
  Rarity,
  StatKey,
  Stats,
  Tendencies,
  TendencyKey,
} from './types';

const statKeys: StatKey[] = ['HP', 'ATK', 'DEF', 'SPD', 'LUK'];
const elementKeys: Element[] = ['fire', 'water', 'moss', 'storm', 'shadow'];
const forms = evolutions.forms as FormDefinition[];
const baseStats = evolutions.baseStats as Stats;
const growthPerLevel = evolutions.growthPerLevel as Stats;
const elementMultipliers = evolutions.elementMultipliers as Record<Element, Stats>;
const archetypeMultipliers = evolutions.archetypeMultipliers as Record<Archetype, Stats>;
const rarityWeights = evolutions.baseRarityWeights as Record<Rarity, number>;
const archetypeAffinities = evolutions.archetypes as Record<Archetype, Partial<Record<TendencyKey, number>>>;

type TraitKind = 'passive' | 'strong' | 'drawback';
interface TraitDefinition {
  id: string;
  name: string;
  kind: TraitKind;
  element?: Element;
  archetype?: Archetype;
  description: string;
  foodEffectMultiplier?: number;
  sleepEnergyMultiplier?: number;
  hygieneDecayMultiplier?: number;
  xpMultiplier?: number;
  needsDecayMultiplier?: number;
  careEffectMultiplier?: number;
  statBonus?: Partial<Stats>;
  statMultiplier?: Partial<Stats>;
}
const traits = traitsJson as TraitDefinition[];

export const stageOrder: LifeStage[] = ['egg', 'baby', 'teen', 'adult', 'elder'];

export function emptyStats(): Stats {
  return { HP: 0, ATK: 0, DEF: 0, SPD: 0, LUK: 0 };
}

export function emptyTendencies(): Tendencies {
  return { play: 0, sleep: 0, fight: 0, training: 0, feedQuality: 0, hygiene: 0 };
}

export function emptyElementMeals(): Record<Element, number> {
  return { fire: 0, water: 0, moss: 0, storm: 0, shadow: 0 };
}

export function emptyEvolution(inheritedTraitId: string | null = null, baseStatBonus = 0): EvolutionProgress {
  return {
    formId: null,
    traitIds: [],
    mutationTraitId: null,
    drawbackTraitId: null,
    rareMisses: 0,
    evolutionStones: 0,
    elementMeals: emptyElementMeals(),
    inheritedTraitId,
    baseStatBonus,
  };
}

export function getFormDefinition(formId: string | null): FormDefinition | null {
  return forms.find((form) => form.id === formId) ?? null;
}

export function getAllForms(): FormDefinition[] {
  return forms.map((form) => ({ ...form }));
}

export function getTraitDefinition(traitId: string | null): TraitDefinition | null {
  return traits.find((trait) => trait.id === traitId) ?? null;
}

export function getTraitList(state: GameState): TraitDefinition[] {
  const ids = [
    ...state.evolution.traitIds,
    state.evolution.mutationTraitId,
    state.evolution.drawbackTraitId,
    state.evolution.inheritedTraitId,
  ].filter((id): id is string => Boolean(id));
  return [...new Set(ids)].map((id) => getTraitDefinition(id)).filter((trait): trait is TraitDefinition => trait !== null);
}

export function getTraitEffects(state: GameState): {
  foodEffectMultiplier: number;
  sleepEnergyMultiplier: number;
  hygieneDecayMultiplier: number;
  xpMultiplier: number;
  needsDecayMultiplier: number;
  careEffectMultiplier: number;
} {
  const effects = {
    foodEffectMultiplier: 1,
    sleepEnergyMultiplier: 1,
    hygieneDecayMultiplier: 1,
    xpMultiplier: 1,
    needsDecayMultiplier: 1,
    careEffectMultiplier: 1,
  };
  getTraitList(state).forEach((trait) => {
    effects.foodEffectMultiplier *= trait.foodEffectMultiplier ?? 1;
    effects.sleepEnergyMultiplier *= trait.sleepEnergyMultiplier ?? 1;
    effects.hygieneDecayMultiplier *= trait.hygieneDecayMultiplier ?? 1;
    effects.xpMultiplier *= trait.xpMultiplier ?? 1;
    effects.needsDecayMultiplier *= trait.needsDecayMultiplier ?? 1;
    effects.careEffectMultiplier *= trait.careEffectMultiplier ?? 1;
  });
  return effects;
}

export function getLevelCap(stage: LifeStage): number {
  const caps = rules.lifeStages.levelCaps as Record<string, number>;
  return stage === 'egg' ? caps.baby : caps[stage];
}

export function xpToNextLevel(level: number): number {
  return Math.max(1, Math.floor(rules.progression.xpBase * Math.pow(rules.progression.xpGrowth, Math.max(0, level - 1))));
}

export function awardXp(state: GameState, amount: number): GameState {
  const cap = getLevelCap(state.stage);
  if (state.level >= cap || amount <= 0) return { ...state, level: Math.min(state.level, cap), xp: 0 };
  const scaledAmount = Math.max(0, Math.floor(amount * getTraitEffects(state).xpMultiplier));
  let xp = state.xp + scaledAmount;
  let level = state.level;
  while (level < cap && xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level += 1;
  }
  if (level >= cap) xp = 0;
  return { ...state, level, xp, peakLevel: Math.max(state.peakLevel, level) };
}

export function pointsForMiniGameScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  const bounded = Math.min(rules.progression.miniGameMaximumScore, Math.max(0, score));
  const [one, two, three] = rules.progression.miniGameScoreThresholds;
  const [onePoint, twoPoints, threePoints] = rules.progression.miniGameTrainingPointsByBand;
  return bounded >= three! ? threePoints! : bounded >= two! ? twoPoints! : bounded >= one! ? onePoint! : 0;
}

export function awardTraining(state: GameState, stat: StatKey, points: number): { state: GameState; awarded: number } {
  const cap = Math.floor(rules.progression.trainingCapPerLevel * state.level);
  const current = state.training[stat];
  const awarded = Math.max(0, Math.min(cap - current, Math.floor(points)));
  return {
    state: { ...state, training: { ...state.training, [stat]: current + awarded } },
    awarded,
  };
}

export function getEffectiveStats(state: GameState): Stats {
  const form = getFormDefinition(state.evolution.formId);
  const element = form ? elementMultipliers[form.element] : { HP: 1, ATK: 1, DEF: 1, SPD: 1, LUK: 1 };
  const archetype = form ? archetypeMultipliers[form.archetype] : { HP: 1, ATK: 1, DEF: 1, SPD: 1, LUK: 1 };
  const effects = getTraitList(state);
  const elderDecline = state.stage === 'elder'
    ? Math.max(rules.lifeStages.elderStatFloorMultiplier, 1 - (state.stageSeconds / 60) * (rules.lifeStages.elderStatDeclinePercentPerMinute / 100))
    : 1;
  const result = emptyStats();
  statKeys.forEach((stat) => {
    let value = (baseStats[stat] * (1 + state.evolution.baseStatBonus) + growthPerLevel[stat] * state.level + state.training[stat])
      * element[stat]
      * archetype[stat];
    effects.forEach((trait) => {
      value += trait.statBonus?.[stat] ?? 0;
      value *= trait.statMultiplier?.[stat] ?? 1;
    });
    result[stat] = Math.max(1, Math.floor(value * elderDecline));
  });
  return applyEquipmentToStats(result, state.equipment);
}

export function updateTendency(state: GameState, key: TendencyKey, signal = rules.progression.tendencySignals.default): GameState {
  const alpha = rules.progression.tendencyEmaAlpha;
  const boundedSignal = Math.min(1, Math.max(0, signal));
  const tendencies = { ...state.tendencies, [key]: state.tendencies[key] * (1 - alpha) + boundedSignal * alpha };
  return { ...state, tendencies };
}

export function recordFoodElement(state: GameState, tags: string[]): GameState {
  const element = tags.map((tag) => tag.startsWith('element:') ? tag.slice('element:'.length) : '').find((tag) => elementKeys.includes(tag as Element));
  if (!element) return state;
  const key = element as Element;
  return { ...state, evolution: { ...state.evolution, elementMeals: { ...state.evolution.elementMeals, [key]: state.evolution.elementMeals[key] + 1 } } };
}

function rollEvolution(state: GameState, excludedFormId: string | null = null): GameState {
  let seed = state.seed >>> 0;
  const random = () => {
    const step = nextRandom(seed);
    seed = step.seed;
    return step.value;
  };
  const totalMeals = elementKeys.reduce((sum, element) => sum + state.evolution.elementMeals[element], 0);
  const eligibleForms = forms.filter((form) => form.id !== excludedFormId);
  const weights = eligibleForms.map((form) => {
    const affinities = archetypeAffinities[form.archetype];
    const tendencyBoost = Object.entries(affinities).reduce((sum, [key, affinity]) => {
      return sum + state.tendencies[key as TendencyKey] * (affinity ?? 0);
    }, 0);
    const mealShare = totalMeals > 0 ? state.evolution.elementMeals[form.element] / totalMeals : 0;
    const elementBoost = 1 + mealShare * evolutions.elementFoodBiasAtFullShare;
    const pityWeight = form.rarity === 'rare'
      ? evolutions.rarePityBonusPerMiss * state.evolution.rareMisses
      : 0;
    return (rarityWeights[form.rarity] + pityWeight) * (1 + tendencyBoost) * elementBoost;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let target = random() * totalWeight;
  let form = eligibleForms[eligibleForms.length - 1]!;
  for (let index = 0; index < eligibleForms.length; index += 1) {
    target -= weights[index]!;
    if (target <= 0) {
      form = forms[index]!;
      break;
    }
  }

  const eligiblePassive = traits.filter((trait) => trait.kind === 'passive'
    && (!trait.element || trait.element === form.element)
    && (!trait.archetype || trait.archetype === form.archetype));
  const passivePool = [...eligiblePassive];
  const traitIds: string[] = [];
  while (traitIds.length < 2 && passivePool.length > 0) {
    const index = Math.floor(random() * passivePool.length);
    traitIds.push(passivePool.splice(index, 1)[0]!.id);
  }
  const missesBeforeRoll = state.evolution.rareMisses;
  const mutationChance = Math.min(
    evolutions.mutationChanceCap,
    evolutions.mutationBaseChance + evolutions.mutationChancePerMiss * missesBeforeRoll,
  );
  let mutationTraitId: string | null = null;
  let drawbackTraitId: string | null = null;
  if (random() < mutationChance) {
    const strongPool = traits.filter((trait) => trait.kind === 'strong'
      && (!trait.element || trait.element === form.element)
      && (!trait.archetype || trait.archetype === form.archetype));
    if (strongPool.length > 0) mutationTraitId = strongPool[Math.floor(random() * strongPool.length)]!.id;
    if (random() < evolutions.mutationDrawbackChance) {
      const drawbacks = traits.filter((trait) => trait.kind === 'drawback');
      drawbackTraitId = drawbacks[Math.floor(random() * drawbacks.length)]?.id ?? null;
    }
  }

  const rareMisses = form.rarity === 'rare' ? 0 : state.evolution.rareMisses + 1;
  const formDex = state.formDex.includes(form.id) ? state.formDex : [...state.formDex, form.id];
  const evolution = {
    ...state.evolution,
    formId: form.id,
    traitIds,
    mutationTraitId,
    drawbackTraitId,
    rareMisses,
    elementMeals: emptyElementMeals(),
  };
  return {
    ...state,
    seed,
    evolution,
    formDex,
    animation: 'evolve',
    animationRemainingSeconds: rules.animationSeconds.evolve,
  };
}

export function evolveForStage(state: GameState): GameState {
  return rollEvolution(state);
}

export function rerollWithEvolutionStone(state: GameState): GameState {
  if (state.evolution.evolutionStones < 1 || !state.evolution.formId) return state;
  const rerolled = rollEvolution(state, state.evolution.formId);
  return {
    ...rerolled,
    evolution: { ...rerolled.evolution, evolutionStones: state.evolution.evolutionStones - 1 },
  };
}

export function grantEvolutionStone(state: GameState, count = 1): GameState {
  return {
    ...state,
    evolution: { ...state.evolution, evolutionStones: Math.max(0, state.evolution.evolutionStones + Math.floor(count)) },
  };
}

export function completeGeneration(state: GameState): GameState {
  const candidateIds = [
    ...state.evolution.traitIds,
    state.evolution.mutationTraitId,
    state.evolution.inheritedTraitId,
  ].filter((id): id is string => Boolean(id));
  const traitRoll = nextRandom(state.seed);
  const selectedTrait = candidateIds.length
    ? candidateIds[Math.floor(traitRoll.value * candidateIds.length)]!
    : null;
  const randomSeed = nextRandom(traitRoll.seed).seed;
  const record: PetRecord = {
    generation: state.generation,
    name: getFormDefinition(state.evolution.formId)?.name ?? 'Pip',
    formId: state.evolution.formId,
    peakLevel: state.peakLevel,
    activeSeconds: state.generationSeconds,
    deepestFloor: state.dungeon.petDeepestFloor,
    inheritedTraitId: state.evolution.inheritedTraitId,
  };
  const nextEvolution = emptyEvolution(selectedTrait, state.evolution.baseStatBonus + rules.progression.legacyBaseStatBonus);
  nextEvolution.evolutionStones = state.evolution.evolutionStones;
  nextEvolution.rareMisses = state.evolution.rareMisses;
  return {
    ...state,
    seed: randomSeed,
    stage: 'egg',
    stageSeconds: 0,
    generationSeconds: 0,
    needs: { ...(rules.needs.starting as GameState['needs']) },
    signalCooldowns: { hunger: 0, happiness: 0, energy: 0, hygiene: 0 },
    sleeping: false,
    cooldowns: { feed: 0, play: 0, clean: 0, sleep: 0 },
    generation: state.generation + 1,
    level: 1,
    xp: 0,
    training: { HP: 0, ATK: 0, DEF: 0, SPD: 0, LUK: 0 },
    tendencies: emptyTendencies(),
    evolution: nextEvolution,
    formDex: state.formDex,
    hallOfPets: [record, ...state.hallOfPets].slice(0, rules.progression.hallOfPetsLimit),
    dungeon: { ...state.dungeon, petDeepestFloor: 0 },
    miniGameCooldownSeconds: 0,
    peakLevel: 1,
    animation: 'evolve',
    animationRemainingSeconds: rules.animationSeconds.evolve,
  };
}

export function evolveDebugItemLabel(): string {
  return 'Evolution Stone';
}
