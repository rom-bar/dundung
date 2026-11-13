import endlessRules from '../data/endless-rules.json';
import enemies from '../data/enemies.json';
import type {
  ActionResult,
  AscensionPerkId,
  DungeonRunMode,
  EndlessProgress,
  GameAction,
  GameState,
} from './types';

interface DifficultyModifierDefinition {
  id: string;
  name: string;
  description: string;
  enemyHpMultiplier: number;
  enemyAttackMultiplier: number;
  enemySpeedMultiplier: number;
  coinMultiplier: number;
  lootChanceMultiplier: number;
  rarityLuckBonus: number;
}

interface AscensionPerkDefinition {
  id: AscensionPerkId;
  name: string;
  description: string;
  maxStacks: number;
  maxHpMultiplierPerStack?: number;
  coinMultiplierPerStack?: number;
  lootChanceMultiplierPerStack?: number;
  rarityLuckPerStack?: number;
}

const modifierDefinitions = endlessRules.difficultyModifiers.items as DifficultyModifierDefinition[];
const perkDefinitions = endlessRules.ascension.perks as AscensionPerkDefinition[];
const enemyIds = new Set(enemies.map((enemy) => enemy.id));
const modifierIds = new Set(modifierDefinitions.map((modifier) => modifier.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function isValidUtcDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function getCurrentUtcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function getDailySeed(dateKey: string): number {
  if (!isValidUtcDateKey(dateKey)) throw new RangeError('A daily seed needs a valid UTC date.');
  let hash = 0x811c9dc5;
  const source = `${endlessRules.daily.seedPrefix}:${dateKey}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createEndlessProgress(): EndlessProgress {
  return {
    dailyAttemptDate: null,
    dailyBestFloor: 0,
    dailyBestDate: null,
    ascensionRank: 0,
    bestFloorSinceAscension: 0,
    ascensionPerks: { vitality: 0, fortune: 0, 'keen-eye': 0 },
    selectedModifierIds: [],
    defeatedEnemyIds: [],
  };
}

export function getDifficultyModifiers(): DifficultyModifierDefinition[] {
  return modifierDefinitions.map((modifier) => ({ ...modifier }));
}

export function getAscensionPerks(): AscensionPerkDefinition[] {
  return perkDefinitions.map((perk) => ({ ...perk }));
}

export function getAscensionPerk(perkId: string): AscensionPerkDefinition | null {
  return perkDefinitions.find((perk) => perk.id === perkId) ?? null;
}

export function getAscensionMilestone(rank: number): number | null {
  const safeRank = Math.floor(boundedNumber(rank, 0, 0, endlessRules.ascension.maximumRank));
  if (safeRank >= endlessRules.ascension.maximumRank) return null;
  return endlessRules.ascension.firstMilestoneFloor + safeRank * endlessRules.ascension.milestoneFloorStep;
}

export function getBestiaryCoinMultiplier(defeatedEnemyIds: string[]): number {
  const uniqueCount = new Set(defeatedEnemyIds.filter((id) => enemyIds.has(id))).size;
  return endlessRules.bestiary.bonusTiers.reduce(
    (multiplier, tier) => uniqueCount >= tier.uniqueEnemies ? multiplier * tier.coinMultiplier : multiplier,
    1,
  );
}

export function sanitizeEndlessProgress(value: unknown): EndlessProgress {
  if (!isRecord(value)) return createEndlessProgress();
  const oldPerks = isRecord(value.ascensionPerks) ? value.ascensionPerks : {};
  const ascensionPerks = createEndlessProgress().ascensionPerks;
  for (const perk of perkDefinitions) {
    const key = perk.id as AscensionPerkId;
    ascensionPerks[key] = Math.floor(boundedNumber(oldPerks[key], 0, 0, perk.maxStacks));
  }
  const selectedModifierIds = Array.isArray(value.selectedModifierIds)
    ? [...new Set(value.selectedModifierIds.filter((id): id is string => typeof id === 'string' && modifierIds.has(id)))].slice(0, endlessRules.difficultyModifiers.selectionLimit)
    : [];
  const defeatedEnemyIds = Array.isArray(value.defeatedEnemyIds)
    ? [...new Set(value.defeatedEnemyIds.filter((id): id is string => typeof id === 'string' && enemyIds.has(id)))].slice(0, enemies.length)
    : [];
  const dailyBestFloor = Math.floor(boundedNumber(value.dailyBestFloor, 0, 0, 1_000_000));
  return {
    dailyAttemptDate: isValidUtcDateKey(value.dailyAttemptDate) ? value.dailyAttemptDate : null,
    dailyBestFloor,
    dailyBestDate: dailyBestFloor > 0 && isValidUtcDateKey(value.dailyBestDate) ? value.dailyBestDate : null,
    ascensionRank: Math.floor(boundedNumber(value.ascensionRank, 0, 0, endlessRules.ascension.maximumRank)),
    bestFloorSinceAscension: Math.floor(boundedNumber(value.bestFloorSinceAscension, 0, 0, 1_000_000)),
    ascensionPerks,
    selectedModifierIds,
    defeatedEnemyIds,
  };
}

export interface EndlessRunEffects {
  challengeEffects: {
    enemyStatsMultiplier: number;
    enemyHpMultiplier: number;
    enemyAttackMultiplier: number;
    enemySpeedMultiplier: number;
    lootChanceMultiplier: number;
    rarityLuckBonus: number;
    maxHpMultiplier: number;
  };
  coinMultiplier: number;
}

export function getEndlessRunEffects(
  progress: EndlessProgress,
  selectedModifierIds: string[] = progress.selectedModifierIds,
  mode: DungeonRunMode = 'standard',
): EndlessRunEffects {
  const rank = Math.min(endlessRules.ascension.maximumRank, Math.max(0, Math.floor(progress.ascensionRank)));
  const perkRanks = progress.ascensionPerks;
  const modifiers = mode === 'daily'
    ? []
    : [...new Set(selectedModifierIds)].map((id) => modifierDefinitions.find((item) => item.id === id)).filter((item): item is DifficultyModifierDefinition => Boolean(item));
  const perk = (id: AscensionPerkId) => perkDefinitions.find((item) => item.id === id)!;
  const vitality = Math.min(perk('vitality').maxStacks, perkRanks.vitality);
  const fortune = Math.min(perk('fortune').maxStacks, perkRanks.fortune);
  const keenEye = Math.min(perk('keen-eye').maxStacks, perkRanks['keen-eye']);
  const challengeEffects = {
    enemyStatsMultiplier: 1 + rank * endlessRules.ascension.enemyStatsMultiplierPerRank,
    enemyHpMultiplier: modifiers.reduce((product, item) => product * item.enemyHpMultiplier, 1),
    enemyAttackMultiplier: modifiers.reduce((product, item) => product * item.enemyAttackMultiplier, 1),
    enemySpeedMultiplier: modifiers.reduce((product, item) => product * item.enemySpeedMultiplier, 1),
    lootChanceMultiplier: (1 + rank * endlessRules.ascension.lootChanceMultiplierPerRank)
      * (1 + (perk('keen-eye').lootChanceMultiplierPerStack ?? 0) * keenEye)
      * modifiers.reduce((product, item) => product * item.lootChanceMultiplier, 1),
    rarityLuckBonus: rank * endlessRules.ascension.rarityLuckPerRank
      + (perk('keen-eye').rarityLuckPerStack ?? 0) * keenEye
      + modifiers.reduce((sum, item) => sum + item.rarityLuckBonus, 0),
    maxHpMultiplier: 1 + (perk('vitality').maxHpMultiplierPerStack ?? 0) * vitality,
  };
  const coinMultiplier = (1 + rank * endlessRules.ascension.coinMultiplierPerRank)
    * (1 + (perk('fortune').coinMultiplierPerStack ?? 0) * fortune)
    * modifiers.reduce((product, item) => product * item.coinMultiplier, 1)
    * getBestiaryCoinMultiplier(progress.defeatedEnemyIds);
  return { challengeEffects, coinMultiplier };
}

export function recordEndlessFloor(
  progress: EndlessProgress,
  floor: number,
  run: { mode: DungeonRunMode; dailyDateKey: string | null },
): EndlessProgress {
  const safeFloor = Math.floor(boundedNumber(floor, 0, 0, 1_000_000));
  const next: EndlessProgress = {
    ...progress,
    bestFloorSinceAscension: Math.max(progress.bestFloorSinceAscension, safeFloor),
  };
  if (run.mode !== 'daily' || !isValidUtcDateKey(run.dailyDateKey)) return next;
  const isNewBest = safeFloor > progress.dailyBestFloor;
  return {
    ...next,
    dailyBestFloor: Math.max(progress.dailyBestFloor, safeFloor),
    dailyBestDate: isNewBest || !progress.dailyBestDate ? run.dailyDateKey : progress.dailyBestDate,
  };
}

export function recordBestiaryDefeat(progress: EndlessProgress, enemyId: string): EndlessProgress {
  if (!enemyIds.has(enemyId) || progress.defeatedEnemyIds.includes(enemyId)) return progress;
  return { ...progress, defeatedEnemyIds: [...progress.defeatedEnemyIds, enemyId].slice(0, enemies.length) };
}

function reject(state: GameState, message: string): ActionResult {
  return { state, accepted: false, message };
}

export function applyEndlessAction(state: GameState, action: GameAction): ActionResult | null {
  if (action.type === 'endless-set-modifiers') {
    if (state.dungeon.activeRun) return reject(state, 'Finish the current run before changing challenge modifiers.');
    if (!Array.isArray(action.modifierIds)) return reject(state, 'Choose valid challenge modifiers.');
    const selected = [...new Set(action.modifierIds)];
    if (selected.some((id) => !modifierIds.has(id)) || selected.length !== action.modifierIds.length) {
      return reject(state, 'One or more challenge modifiers are not valid.');
    }
    if (selected.length > endlessRules.difficultyModifiers.selectionLimit) {
      return reject(state, `Choose up to ${endlessRules.difficultyModifiers.selectionLimit} challenge modifiers.`);
    }
    return {
      state: { ...state, endless: { ...state.endless, selectedModifierIds: selected } },
      accepted: true,
      message: selected.length ? `${selected.length} challenge modifier${selected.length === 1 ? '' : 's'} ready for the next standard run.` : 'Challenge modifiers cleared.',
    };
  }
  if (action.type !== 'endless-ascend') return null;
  if (state.dungeon.activeRun) return reject(state, 'Finish the current run before ascending.');
  if (state.stage === 'egg' || !state.evolution.formId) return reject(state, 'Pip needs to hatch and evolve before ascending.');
  const milestone = getAscensionMilestone(state.endless.ascensionRank);
  if (milestone === null) return reject(state, 'Pocket Pal has reached the current ascension limit.');
  if (state.endless.bestFloorSinceAscension < milestone) {
    return reject(state, `Reach floor ${milestone} since the last ascension first.`);
  }
  const perk = getAscensionPerk(action.perkId);
  if (!perk) return reject(state, 'Choose a valid permanent perk.');
  if (state.endless.ascensionPerks[action.perkId] >= perk.maxStacks) return reject(state, `${perk.name} is already fully learned.`);
  const nextRank = state.endless.ascensionRank + 1;
  return {
    state: {
      ...state,
      endless: {
        ...state.endless,
        ascensionRank: nextRank,
        bestFloorSinceAscension: 0,
        ascensionPerks: { ...state.endless.ascensionPerks, [action.perkId]: state.endless.ascensionPerks[action.perkId] + 1 },
      },
    },
    accepted: true,
    message: `Ascension ${nextRank} begins. ${perk.name} is now permanent; your lifetime records stay safe.`,
  };
}
