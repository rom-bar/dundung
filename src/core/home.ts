import achievementsJson from '../data/achievements.json';
import biomesJson from '../data/biomes.json';
import homeJson from '../data/home.json';
import equipmentRulesJson from '../data/equipment-rules.json';
import rulesJson from '../data/rules.json';
import type { ActionResult, GameAction, GameRecords, GameState, HomeProgress, HomeUpgradeId, PreparedMeal, StatKey } from './types';
import { getEquipmentSetCounts } from './equipment';

interface HomeRules {
  cost: { base: number; growth: number };
  maximumLevel: number;
  effects: {
    kitchen: {
      feedEffectPerLevel: number;
      maximumFeedEffectBonus: number;
      basePackSlots: number;
      additionalPackSlotEveryLevels: number;
      maximumPackSlots: number;
      baseMealStatBonus: number;
      mealStatBonusPerLevel: number;
      maximumMealStatBonus: number;
    };
    gym: { trainingCapMultiplierPerLevel: number; miniGameRewardMultiplierPerLevel: number };
    workshop: { upgradeCostDiscountPerLevel: number; fusionCostDiscountPerLevel: number; inventorySlotsPerLevel: number };
    nursery: {
      extraInheritedTraitAtLevel: number;
      maximumExtraInheritedTraits: number;
      legacyStatBonusPerLevel: number;
      maximumLegacyStatBonus: number;
    };
    library: { dexStatBonusPerFormPerLevel: number; weightHintLevel: number; advancedWeightHintLevel: number };
  };
  upgrades: Array<{ id: HomeUpgradeId; name: string; icon: string; description: string }>;
  cosmetics?: Array<{ id: string; name: string }>;
}

interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  progress: { type: 'forms' | 'depth' | 'boss-firsts' | 'boss-floor' | 'set-pieces'; target: number };
  rewards: { coins: number; essence: number; cosmetics: string[] };
}

export interface AchievementStatus {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unlocked: boolean;
  rewards: AchievementDefinition['rewards'];
}

export interface HomeEffects {
  feedEffectMultiplier: number;
  packSlots: number;
  mealStatBonus: number;
  trainingCapMultiplier: number;
  miniGameRewardMultiplier: number;
  upgradeCostMultiplier: number;
  fusionCostMultiplier: number;
  inventoryCapacity: number;
  extraInheritedTraits: number;
  legacyStatBonusPerGeneration: number;
  dexStatMultiplier: number;
  weightHintLevel: number;
  advancedWeightHintLevel: number;
}

const homeRules = homeJson as HomeRules;
const achievements = achievementsJson as AchievementDefinition[];
const statKeys: StatKey[] = ['HP', 'ATK', 'DEF', 'SPD', 'LUK'];
const upgradeIds: HomeUpgradeId[] = ['kitchen', 'gym', 'workshop', 'nursery', 'library'];
const validAchievementIds = new Set(achievements.map((entry) => entry.id));
const validCosmeticIds = new Set([
  ...achievements.flatMap((entry) => entry.rewards.cosmetics),
  ...(homeRules.cosmetics ?? []).map((entry) => entry.id),
]);
const currencyCap = (equipmentRulesJson as { caps?: { maximumStoredCurrency?: number } }).caps?.maximumStoredCurrency ?? 1_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function uniqueSafeStrings(value: unknown, allowed?: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string'
    && /^[a-z0-9-]{1,64}$/.test(item)
    && (!allowed || allowed.has(item))))].slice(0, 1000);
}

export function getHomeUpgradeDefinitions(): HomeRules['upgrades'] {
  return homeRules.upgrades.map((upgrade) => ({ ...upgrade }));
}

export function getCosmeticDefinitions(): Array<{ id: string; name: string }> {
  return (homeRules.cosmetics ?? []).map((cosmetic) => ({ ...cosmetic }));
}

export function getAchievementDefinitions(): AchievementDefinition[] {
  return achievements.map((entry) => ({ ...entry, progress: { ...entry.progress }, rewards: { ...entry.rewards, cosmetics: [...entry.rewards.cosmetics] } }));
}

export function createHomeProgress(): HomeProgress {
  return {
    upgradeLevels: { kitchen: 0, gym: 0, workshop: 0, nursery: 0, library: 0 },
    preparedMeal: null,
    unlockedAchievementIds: [],
    unlockedCosmeticIds: [],
    bossFirstBiomes: [],
    bossClearedFloors: [],
  };
}

export function createGameRecords(): GameRecords {
  return {
    totalRoomsCleared: 0,
    bossesDefeated: 0,
    runsLeftSafely: 0,
    runsFainted: 0,
    bestRunFloor: 0,
    totalCoinsBanked: 0,
  };
}

export function sanitizeHomeProgress(value: unknown): HomeProgress {
  const base = createHomeProgress();
  if (!isRecord(value)) return base;
  const rawLevels = isRecord(value.upgradeLevels) ? value.upgradeLevels : {};
  const upgradeLevels = { ...base.upgradeLevels };
  for (const id of upgradeIds) {
    upgradeLevels[id] = Math.floor(boundedNumber(rawLevels[id], 0, 0, homeRules.maximumLevel));
  }
  let preparedMeal: PreparedMeal | null = null;
  if (isRecord(value.preparedMeal) && statKeys.includes(value.preparedMeal.stat as StatKey)) {
    preparedMeal = {
      stat: value.preparedMeal.stat as StatKey,
      bonus: boundedNumber(value.preparedMeal.bonus, 0, 0, homeRules.effects.kitchen.maximumMealStatBonus),
    };
  }
  const validBiomes = new Set((biomesJson as Array<{ id: string }>).map((biome) => biome.id));
  return {
    upgradeLevels,
    preparedMeal,
    unlockedAchievementIds: uniqueSafeStrings(value.unlockedAchievementIds, validAchievementIds),
    unlockedCosmeticIds: uniqueSafeStrings(value.unlockedCosmeticIds, validCosmeticIds),
    bossFirstBiomes: uniqueSafeStrings(value.bossFirstBiomes, validBiomes),
    bossClearedFloors: Array.isArray(value.bossClearedFloors)
      ? [...new Set(value.bossClearedFloors.filter((floor): floor is number => typeof floor === 'number' && Number.isInteger(floor) && floor > 0 && floor <= 1_000_000))].slice(0, 1000)
      : [],
  };
}

export function sanitizeGameRecords(value: unknown): GameRecords {
  const base = createGameRecords();
  if (!isRecord(value)) return base;
  const safe = (key: keyof GameRecords, fallback: number, maximum = 1_000_000_000) => Math.floor(boundedNumber(value[key], fallback, 0, maximum));
  return {
    totalRoomsCleared: safe('totalRoomsCleared', base.totalRoomsCleared),
    bossesDefeated: safe('bossesDefeated', base.bossesDefeated),
    runsLeftSafely: safe('runsLeftSafely', base.runsLeftSafely),
    runsFainted: safe('runsFainted', base.runsFainted),
    bestRunFloor: safe('bestRunFloor', base.bestRunFloor),
    totalCoinsBanked: safe('totalCoinsBanked', base.totalCoinsBanked),
  };
}

export function getHomeLevel(home: HomeProgress, upgradeId: HomeUpgradeId): number {
  return Math.floor(boundedNumber(home.upgradeLevels[upgradeId], 0, 0, homeRules.maximumLevel));
}

export function getHomeUpgradeCost(home: HomeProgress, upgradeId: HomeUpgradeId): number | null {
  const level = getHomeLevel(home, upgradeId);
  if (level >= homeRules.maximumLevel) return null;
  return Math.max(1, Math.floor(homeRules.cost.base * Math.pow(homeRules.cost.growth, level)));
}

export function applyHomeAction(state: GameState, action: GameAction): ActionResult | null {
  if (action.type === 'home-upgrade') {
    if (state.dungeon.activeRun) return { state, accepted: false, message: 'Finish the current dungeon run before improving Home.' };
    if (!upgradeIds.includes(action.upgradeId)) return { state, accepted: false, message: 'That Home upgrade is not available.' };
    const cost = getHomeUpgradeCost(state.home, action.upgradeId);
    if (cost === null) return { state, accepted: false, message: `${getHomeUpgradeName(action.upgradeId)} is already at its maximum level.` };
    if (state.dungeon.coins < cost) return { state, accepted: false, message: `${getHomeUpgradeName(action.upgradeId)} needs ${cost} coins.` };
    const currentLevel = getHomeLevel(state.home, action.upgradeId);
    return {
      state: {
        ...state,
        home: { ...state.home, upgradeLevels: { ...state.home.upgradeLevels, [action.upgradeId]: currentLevel + 1 } },
        dungeon: { ...state.dungeon, coins: state.dungeon.coins - cost },
      },
      accepted: true,
      message: `${getHomeUpgradeName(action.upgradeId)} upgraded to level ${currentLevel + 1} for ${cost} coins.`,
    };
  }
  if (action.type === 'home-cook-meal') {
    if (state.dungeon.activeRun) return { state, accepted: false, message: 'Cook your next-run meal after returning from the dungeon.' };
    if (state.home.preparedMeal) return { state, accepted: false, message: 'A meal is already waiting for the next dungeon run.' };
    if (!statKeys.includes(action.stat)) return { state, accepted: false, message: 'Choose one stat for the meal.' };
    const bonus = getHomeEffects(state.home).mealStatBonus;
    return {
      state: { ...state, home: { ...state.home, preparedMeal: { stat: action.stat, bonus } } },
      accepted: true,
      message: `A meal is ready: +${Math.round(bonus * 100)}% ${action.stat} for the next dungeon run.`,
    };
  }
  return null;
}

export function getTrainingCap(level: number, gymLevel: number): number {
  const perLevel = (rulesJson as { progression: { trainingCapPerLevel: number } }).progression.trainingCapPerLevel;
  const multiplier = 1 + Math.max(0, gymLevel) * homeRules.effects.gym.trainingCapMultiplierPerLevel;
  return Math.max(0, Math.floor(perLevel * Math.max(1, level) * multiplier));
}

export function getHomeEffects(home: HomeProgress, formDexCount = 0): HomeEffects {
  const kitchen = getHomeLevel(home, 'kitchen');
  const gym = getHomeLevel(home, 'gym');
  const workshop = getHomeLevel(home, 'workshop');
  const nursery = getHomeLevel(home, 'nursery');
  const library = getHomeLevel(home, 'library');
  const kitchenRules = homeRules.effects.kitchen;
  const workshopRules = homeRules.effects.workshop;
  const nurseryRules = homeRules.effects.nursery;
  const libraryRules = homeRules.effects.library;
  return {
    feedEffectMultiplier: 1 + Math.min(kitchenRules.maximumFeedEffectBonus, kitchen * kitchenRules.feedEffectPerLevel),
    packSlots: Math.min(kitchenRules.maximumPackSlots, kitchenRules.basePackSlots + Math.floor(kitchen / kitchenRules.additionalPackSlotEveryLevels)),
    mealStatBonus: Math.min(kitchenRules.maximumMealStatBonus, kitchenRules.baseMealStatBonus + kitchen * kitchenRules.mealStatBonusPerLevel),
    trainingCapMultiplier: 1 + gym * homeRules.effects.gym.trainingCapMultiplierPerLevel,
    miniGameRewardMultiplier: 1 + gym * homeRules.effects.gym.miniGameRewardMultiplierPerLevel,
    upgradeCostMultiplier: Math.max(0.5, 1 - workshop * workshopRules.upgradeCostDiscountPerLevel),
    fusionCostMultiplier: Math.max(0.5, 1 - workshop * workshopRules.fusionCostDiscountPerLevel),
    inventoryCapacity: Math.floor((equipmentRulesJson as { inventory: { capacity: number } }).inventory.capacity + workshop * workshopRules.inventorySlotsPerLevel),
    extraInheritedTraits: Math.min(nurseryRules.maximumExtraInheritedTraits, Math.floor(nursery / nurseryRules.extraInheritedTraitAtLevel)),
    legacyStatBonusPerGeneration: Math.min(nurseryRules.maximumLegacyStatBonus, nursery * nurseryRules.legacyStatBonusPerLevel),
    dexStatMultiplier: 1 + Math.max(0, Math.floor(formDexCount)) * library * libraryRules.dexStatBonusPerFormPerLevel,
    weightHintLevel: library >= libraryRules.weightHintLevel ? library : 0,
    advancedWeightHintLevel: library >= libraryRules.advancedWeightHintLevel ? library : 0,
  };
}

export function getPackSlots(kitchenLevel: number): number {
  return getHomeEffects({ ...createHomeProgress(), upgradeLevels: { ...createHomeProgress().upgradeLevels, kitchen: kitchenLevel } }).packSlots;
}

export function getInventoryCapacity(workshopLevel: number): number {
  return getHomeEffects({ ...createHomeProgress(), upgradeLevels: { ...createHomeProgress().upgradeLevels, workshop: workshopLevel } }).inventoryCapacity;
}

export function getMealStatBonus(kitchenLevel: number): number {
  return getHomeEffects({ ...createHomeProgress(), upgradeLevels: { ...createHomeProgress().upgradeLevels, kitchen: kitchenLevel } }).mealStatBonus;
}

function achievementProgress(state: GameState, entry: AchievementDefinition): number {
  switch (entry.progress.type) {
    case 'forms': return state.formDex.length;
    case 'depth': return state.dungeon.deepestFloor;
    case 'boss-firsts': return state.home.bossFirstBiomes.length;
    case 'boss-floor': return state.home.bossClearedFloors.includes(entry.progress.target) ? entry.progress.target : 0;
    case 'set-pieces': return Math.max(0, ...Object.values(getEquipmentSetCounts(state.equipment)));
  }
}

export function getAchievementStatuses(state: GameState): AchievementStatus[] {
  const unlocked = new Set(state.home.unlockedAchievementIds);
  return achievements.map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
    progress: Math.min(entry.progress.target, achievementProgress(state, entry)),
    target: entry.progress.target,
    unlocked: unlocked.has(entry.id),
    rewards: { ...entry.rewards, cosmetics: [...entry.rewards.cosmetics] },
  }));
}

export function unlockReadyAchievements(state: GameState): { state: GameState; unlocked: string[] } {
  const alreadyUnlocked = new Set(state.home.unlockedAchievementIds);
  const newlyUnlocked = achievements.filter((entry) => !alreadyUnlocked.has(entry.id)
    && achievementProgress(state, entry) >= entry.progress.target);
  if (!newlyUnlocked.length) return { state, unlocked: [] };
  let coins = state.dungeon.coins;
  let essence = state.dungeon.essence;
  const cosmeticIds = new Set(state.home.unlockedCosmeticIds);
  for (const entry of newlyUnlocked) {
    coins = Math.min(currencyCap, coins + Math.max(0, Math.floor(entry.rewards.coins)));
    essence = Math.min(currencyCap, essence + Math.max(0, Math.floor(entry.rewards.essence)));
    entry.rewards.cosmetics.forEach((id) => { if (validCosmeticIds.has(id)) cosmeticIds.add(id); });
  }
  const unlocked = newlyUnlocked.map((entry) => entry.id);
  return {
    state: {
      ...state,
      home: {
        ...state.home,
        unlockedAchievementIds: [...state.home.unlockedAchievementIds, ...unlocked],
        unlockedCosmeticIds: [...cosmeticIds],
      },
      dungeon: { ...state.dungeon, coins, essence },
    },
    unlocked,
  };
}

export function getCosmeticName(cosmeticId: string): string {
  return homeRules.cosmetics?.find((cosmetic) => cosmetic.id === cosmeticId)?.name ?? cosmeticId.replaceAll('-', ' ');
}

export function getHomeUpgradeName(upgradeId: HomeUpgradeId): string {
  return homeRules.upgrades.find((upgrade) => upgrade.id === upgradeId)?.name ?? upgradeId;
}
