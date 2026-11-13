import biomeJson from '../data/biomes.json';
import consumableJson from '../data/consumables.json';
import enemyJson from '../data/enemies.json';
import eventJson from '../data/events.json';
import dungeonRules from '../data/dungeon-rules.json';
import lootJson from '../data/loot.json';
import petSkillJson from '../data/pet-skills.json';
import rules from '../data/rules.json';
import roomJson from '../data/rooms.json';
import skillJson from '../data/skills.json';
import tacticJson from '../data/tactics.json';
import { awardXp, getEffectiveStats, getFormDefinition, updateTendency } from './progression';
import {
  createRandomEquipmentItem,
  equipmentItemName,
  getEquipmentCombatEffects,
  getEquipmentRules,
  getItemSalePrice,
  getScrapValue,
  nextEquipmentItemId,
  sanitizeEquipmentItem,
  shouldAutoScrap,
} from './equipment';
import { nextRandom } from './rng';
import type {
  ActionResult,
  CombatStatus,
  DungeonEnemyState,
  DungeonPhase,
  DungeonProgress,
  DungeonRoomType,
  DungeonRunState,
  Element,
  EquipmentCombatEffects,
  EquipmentItem,
  EnemyKind,
  GameAction,
  GameState,
  ShopEquipmentOffer,
  StatKey,
  Stats,
} from './types';

interface BiomeData { id: string; name: string; element: Element; accent: string }
interface RoomWeights { type: Exclude<DungeonRoomType, 'boss'>; weight: number }
interface RoomData {
  floorsPerBiome: number;
  bossEveryFloors: number;
  roomsPerFloor: number;
  choicesPerRoom: number;
  weights: RoomWeights[];
  elite: { weight: number; minFloor: number };
}
interface SkillEffect { type: 'burn' | 'stun' | 'shield'; chance: number; amount: number; turns: number }
interface SkillData { id: string; name: string; multiplier: number; effect: SkillEffect | null }
interface LootDrop { lootId: string; chance: number }
interface EnemyTemplate {
  id: string;
  name: string;
  biomeId: string;
  kind: EnemyKind;
  element: Element;
  stats: Stats;
  skillId: string;
  coinDrop: { min: number; max: number };
  lootDrops: LootDrop[];
  phaseTwo?: { atHealthPercent: number; skillId: string; attackMultiplier: number } | null;
}
interface PetSkillData { formId: string; name: string; multiplier: number; effect: SkillEffect | null }
interface EventEffect {
  type: 'coins' | 'heal' | 'damage' | 'loot' | 'consumable' | 'buff' | 'run-stat' | 'coin-multiplier';
  min?: number;
  max?: number;
  percent?: number;
  lootId?: string;
  consumableId?: string;
  stat?: StatKey;
  multiplier?: number;
  turns?: number;
  name?: string;
}
interface EventOption { id: string; label: string; successChance: number; success: EventEffect[]; failure: EventEffect[] }
interface EventData { id: string; title: string; description: string; options: EventOption[] }
interface ConsumableData {
  id: string;
  name: string;
  description: string;
  price: number;
  effect: { type: 'heal'; percent: number } | { type: 'cleanse' } | { type: 'buff'; stat: StatKey; multiplier: number; turns: number };
}
interface TacticData {
  id: string;
  name: string;
  description: string;
  attackMultiplier: number;
  damageTakenMultiplier: number;
  critBonus: number;
  speedMultiplier: number;
  defenseMultiplier: number;
}
interface LootData { id: string; name: string; description: string; coinValue: number }
interface DamageInput {
  attack: number;
  defense: number;
  skillMultiplier: number;
  elementMultiplier: number;
  critMultiplier?: number;
  randomMultiplier: number;
  damageTakenMultiplier?: number;
}
interface RngCursor {
  roll(): number;
  readonly seed: number;
}

const biomes = biomeJson as unknown as BiomeData[];
const rooms = roomJson as unknown as RoomData;
const skills = skillJson as unknown as SkillData[];
const petSkills = petSkillJson as unknown as PetSkillData[];
const enemies = enemyJson as unknown as EnemyTemplate[];
const events = eventJson as unknown as EventData[];
const consumables = consumableJson as unknown as ConsumableData[];
const tactics = tacticJson as unknown as TacticData[];
const loot = lootJson as unknown as LootData[];
const equipmentRules = getEquipmentRules();
const roomTypes: DungeonRoomType[] = ['fight', 'elite', 'event', 'treasure', 'rest', 'shop', 'boss'];
const statKeys: StatKey[] = ['HP', 'ATK', 'DEF', 'SPD', 'LUK'];
const statusTypes = ['burn', 'stun', 'shield', 'buff'] as const;
const maximumStoredCoins = 1_000_000_000;
const maximumStoredMaterials = 1_000_000_000;

function emptyEquipmentCombatEffects(): EquipmentCombatEffects {
  return {
    critChance: 0,
    lifesteal: 0,
    elementDamage: 0,
    foodEffectiveness: 0,
    coinFind: 0,
    resist: 0,
    resistByElement: { fire: 0, water: 0, moss: 0, storm: 0, shadow: 0 },
    thorns: 0,
    onHitStatuses: [],
  };
}

export function createEmptyDungeonProgress(): DungeonProgress {
  return { coins: 0, scrap: 0, essence: 0, deepestFloor: 0, petDeepestFloor: 0, runsCompleted: 0, activeRun: null };
}

function makeRng(seed: number): RngCursor {
  let current = seed >>> 0;
  return {
    roll() {
      const result = nextRandom(current);
      current = result.seed;
      return result.value;
    },
    get seed() { return current; },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function safeStats(value: unknown, fallback: Stats): Stats {
  const source = isRecord(value) ? value : {};
  return {
    HP: boundedNumber(source.HP, fallback.HP, 1, 1_000_000),
    ATK: boundedNumber(source.ATK, fallback.ATK, 1, 1_000_000),
    DEF: boundedNumber(source.DEF, fallback.DEF, 1, 1_000_000),
    SPD: boundedNumber(source.SPD, fallback.SPD, 1, 1_000_000),
    LUK: boundedNumber(source.LUK, fallback.LUK, 1, 1_000_000),
  };
}

function safeStatuses(value: unknown): CombatStatus[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, dungeonRules.maxStatusesPerTarget).flatMap((item) => {
    if (!isRecord(item) || !statusTypes.includes(item.type as (typeof statusTypes)[number])) return [];
    const status: CombatStatus = {
      type: item.type as CombatStatus['type'],
      amount: boundedNumber(item.amount, 0, 0, 1_000_000),
      turns: Math.floor(boundedNumber(item.turns, 0, 0, 99)),
    };
    if (statKeys.includes(item.stat as StatKey)) status.stat = item.stat as StatKey;
    if (typeof item.multiplier === 'number' && Number.isFinite(item.multiplier)) status.multiplier = boundedNumber(item.multiplier, 1, 0.1, dungeonRules.maxRunStatMultiplier);
    return status.turns > 0 ? [status] : [];
  });
}

function safeEnemy(value: unknown): DungeonEnemyState | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const template = enemies.find((item) => item.id === value.id);
  if (!template) return null;
  const stats = safeStats(value.stats, template.stats);
  const maxHp = boundedNumber(value.maxHp, stats.HP, 1, 1_000_000);
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    element: template.element,
    skillId: skills.some((skill) => skill.id === value.skillId) ? String(value.skillId) : template.skillId,
    stats,
    hp: boundedNumber(value.hp, maxHp, 0, maxHp),
    maxHp,
    gauge: boundedNumber(value.gauge, 0, 0, dungeonRules.actionGauge - 0.001),
    statuses: safeStatuses(value.statuses),
    phaseTwoTriggered: value.phaseTwoTriggered === true,
    phaseTwoSkillId: typeof value.phaseTwoSkillId === 'string' && skills.some((skill) => skill.id === value.phaseTwoSkillId)
      ? value.phaseTwoSkillId
      : template.phaseTwo?.skillId ?? null,
    phaseTwoAttackMultiplier: boundedNumber(value.phaseTwoAttackMultiplier, template.phaseTwo?.attackMultiplier ?? 1, 0.1, dungeonRules.maxRunStatMultiplier),
    coinDrop: template.coinDrop,
    lootDrops: template.lootDrops.filter((drop) => loot.some((item) => item.id === drop.lootId)),
  };
}

function safeEquipmentCombatEffects(value: unknown): EquipmentCombatEffects {
  const source = isRecord(value) ? value : {};
  const fallback = emptyEquipmentCombatEffects();
  const resistByElement = isRecord(source.resistByElement) ? source.resistByElement : {};
  const elementValue = (key: Element) => boundedNumber(resistByElement[key], 0, 0, 0.75);
  const onHitStatuses = Array.isArray(source.onHitStatuses)
    ? source.onHitStatuses.slice(0, 4).flatMap((status) => {
      if (!isRecord(status) || (status.type !== 'burn' && status.type !== 'stun')) return [];
      return [{
        type: status.type as EquipmentCombatEffects['onHitStatuses'][number]['type'],
        chance: boundedNumber(status.chance, 0, 0, 0.75),
        amount: boundedNumber(status.amount, 0, 0, 1_000_000),
        turns: Math.floor(boundedNumber(status.turns, 1, 1, 99)),
      }];
    })
    : [];
  return {
    critChance: boundedNumber(source.critChance, fallback.critChance, 0, 0.5),
    lifesteal: boundedNumber(source.lifesteal, fallback.lifesteal, 0, 0.5),
    elementDamage: boundedNumber(source.elementDamage, fallback.elementDamage, 0, 3),
    foodEffectiveness: boundedNumber(source.foodEffectiveness, fallback.foodEffectiveness, 0, 3),
    coinFind: boundedNumber(source.coinFind, fallback.coinFind, 0, 4),
    resist: boundedNumber(source.resist, fallback.resist, 0, 0.75),
    resistByElement: {
      fire: elementValue('fire'), water: elementValue('water'), moss: elementValue('moss'),
      storm: elementValue('storm'), shadow: elementValue('shadow'),
    },
    thorns: boundedNumber(source.thorns, fallback.thorns, 0, 1),
    onHitStatuses,
  };
}

function safeShopEquipmentOffers(value: unknown, seenItemIds: Set<string>): DungeonRunState['shopEquipmentOffers'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, equipmentRules.shop.offerCount).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id)) return [];
    const item = sanitizeEquipmentItem(entry.item, seenItemIds);
    if (!item) return [];
    return [{ id: entry.id, item, price: Math.floor(boundedNumber(entry.price, 1, 1, maximumStoredCoins)) }];
  });
}

function safeRun(value: unknown, seenItemIds: Set<string>): DungeonRunState | null {
  if (!isRecord(value)) return null;
  const phases: DungeonPhase[] = ['choice', 'tactic', 'combat', 'loot', 'event', 'treasure', 'rest', 'shop', 'floor-end', 'summary'];
  const phase = phases.includes(value.phase as DungeonPhase) ? value.phase as DungeonPhase : null;
  const biomeId = typeof value.biomeId === 'string' && biomes.some((item) => item.id === value.biomeId) ? value.biomeId : null;
  const petFormId = typeof value.petFormId === 'string' && Boolean(getFormDefinition(value.petFormId)) ? value.petFormId : null;
  const petElement: Element | null = ['fire', 'water', 'moss', 'storm', 'shadow'].includes(String(value.petElement))
    ? value.petElement as Element
    : null;
  if (!phase || !biomeId || !petFormId || !petElement) return null;
  const petStats = safeStats(value.petStats, { HP: 1, ATK: 1, DEF: 1, SPD: 1, LUK: 1 });
  const oldRunStatMultipliers = isRecord(value.runStatMultipliers) ? value.runStatMultipliers : {};
  const runStatMultipliers = statKeys.reduce<Stats>((result, key) => {
    result[key] = boundedNumber(oldRunStatMultipliers[key], 1, 0.1, dungeonRules.maxRunStatMultiplier);
    return result;
  }, { HP: 1, ATK: 1, DEF: 1, SPD: 1, LUK: 1 });
  const enemy = safeEnemy(value.enemy);
  const currentRoom = roomTypes.includes(value.currentRoom as DungeonRoomType) ? value.currentRoom as DungeonRoomType : null;
  const eventId = typeof value.eventId === 'string' && events.some((item) => item.id === value.eventId) ? value.eventId : null;
  if (phase === 'combat' && !enemy) return null;
  if (phase === 'event' && !eventId) return null;
  const pendingItems = Array.isArray(value.pendingItems)
    ? value.pendingItems.slice(0, equipmentRules.inventory.pendingItemsPerRunCap).flatMap((item) => {
      const safe = sanitizeEquipmentItem(item, seenItemIds);
      return safe ? [safe] : [];
    })
    : [];
  const pendingItem = sanitizeEquipmentItem(value.pendingItem, seenItemIds);
  if (phase === 'loot' && !pendingItem) return null;
  const basePetMax = Math.max(1, Math.round(petStats.HP * runStatMultipliers.HP));
  const petMaxHp = boundedNumber(value.petMaxHp, basePetMax, 1, 1_000_000);
  const run: DungeonRunState = {
    generation: Math.floor(boundedNumber(value.generation, 1, 1, 1_000_000)),
    floor: Math.floor(boundedNumber(value.floor, 1, 1, 1_000_000)),
    roomIndex: Math.floor(boundedNumber(value.roomIndex, 0, 0, rooms.roomsPerFloor)),
    biomeId,
    petFormId,
    petElement,
    phase,
    rngSeed: typeof value.rngSeed === 'number' && Number.isFinite(value.rngSeed) ? value.rngSeed >>> 0 : 1,
    petStats,
    runStatMultipliers,
    coinMultiplier: boundedNumber(value.coinMultiplier, 1, 0.1, dungeonRules.maxRunCoinMultiplier),
    petHp: boundedNumber(value.petHp, petMaxHp, 0, petMaxHp),
    petMaxHp,
    petGauge: boundedNumber(value.petGauge, 0, 0, dungeonRules.actionGauge - 0.001),
    petStatuses: safeStatuses(value.petStatuses),
    equipmentEffects: safeEquipmentCombatEffects(value.equipmentEffects),
    enemy,
    roomChoices: Array.isArray(value.roomChoices) ? value.roomChoices.filter((item): item is DungeonRoomType => roomTypes.includes(item as DungeonRoomType)).slice(0, rooms.choicesPerRoom) : [],
    currentRoom,
    eventId,
    shopOfferIds: Array.isArray(value.shopOfferIds) ? [...new Set(value.shopOfferIds.filter((id): id is string => typeof id === 'string' && consumables.some((item) => item.id === id)))].slice(0, dungeonRules.shopOfferCount) : [],
    shopEquipmentOffers: safeShopEquipmentOffers(value.shopEquipmentOffers, seenItemIds),
    tacticId: typeof value.tacticId === 'string' && tactics.some((item) => item.id === value.tacticId) ? value.tacticId : null,
    consumables: Array.isArray(value.consumables) ? value.consumables.filter((id): id is string => typeof id === 'string' && consumables.some((item) => item.id === id)).slice(0, dungeonRules.packSlots) : [],
    coins: Math.floor(boundedNumber(value.coins, 0, 0, maximumStoredCoins)),
    lootIds: Array.isArray(value.lootIds) ? value.lootIds.filter((id): id is string => typeof id === 'string' && loot.some((item) => item.id === id)).slice(0, 100) : [],
    pendingItems,
    pendingItem,
    pendingScrap: Math.floor(boundedNumber(value.pendingScrap, 0, 0, maximumStoredMaterials)),
    pendingEssence: Math.floor(boundedNumber(value.pendingEssence, 0, 0, maximumStoredMaterials)),
    combatLog: Array.isArray(value.combatLog) ? value.combatLog.filter((line): line is string => typeof line === 'string').map((line) => line.slice(0, 180)).slice(-dungeonRules.combatLogLimit) : [],
    combatElapsedSeconds: boundedNumber(value.combatElapsedSeconds, 0, 0, 1_000_000),
    turns: Math.floor(boundedNumber(value.turns, 0, 0, 1_000_000)),
    result: value.result === 'left' || value.result === 'fainted' ? value.result : null,
    bankedCoins: Math.floor(boundedNumber(value.bankedCoins, 0, 0, maximumStoredCoins)),
    bankedLootCount: Math.floor(boundedNumber(value.bankedLootCount, 0, 0, 100)),
    lostLootCount: Math.floor(boundedNumber(value.lostLootCount, 0, 0, 100)),
    bankedItemCount: Math.floor(boundedNumber(value.bankedItemCount, 0, 0, equipmentRules.inventory.capacity)),
    lostItemCount: Math.floor(boundedNumber(value.lostItemCount, 0, 0, equipmentRules.inventory.pendingItemsPerRunCap)),
    bankedScrap: Math.floor(boundedNumber(value.bankedScrap, 0, 0, maximumStoredMaterials)),
    bankedEssence: Math.floor(boundedNumber(value.bankedEssence, 0, 0, maximumStoredMaterials)),
    lostScrap: Math.floor(boundedNumber(value.lostScrap, 0, 0, maximumStoredMaterials)),
    lostEssence: Math.floor(boundedNumber(value.lostEssence, 0, 0, maximumStoredMaterials)),
  };
  if (run.phase === 'summary' && !run.result) return null;
  return run;
}

export function migrateDungeonProgress(value: unknown, seenItemIds = new Set<string>()): DungeonProgress {
  if (!isRecord(value)) return createEmptyDungeonProgress();
  return {
    coins: Math.floor(boundedNumber(value.coins, 0, 0, maximumStoredCoins)),
    scrap: Math.floor(boundedNumber(value.scrap, 0, 0, maximumStoredMaterials)),
    essence: Math.floor(boundedNumber(value.essence, 0, 0, maximumStoredMaterials)),
    deepestFloor: Math.floor(boundedNumber(value.deepestFloor, 0, 0, 1_000_000)),
    petDeepestFloor: Math.floor(boundedNumber(value.petDeepestFloor, 0, 0, 1_000_000)),
    runsCompleted: Math.floor(boundedNumber(value.runsCompleted, 0, 0, 1_000_000)),
    activeRun: safeRun(value.activeRun, seenItemIds),
  };
}

export function getBiomeForFloor(floor: number): BiomeData {
  const index = Math.floor((Math.max(1, floor) - 1) / rooms.floorsPerBiome) % biomes.length;
  return biomes[index] ?? biomes[0]!;
}

export function getElementMultiplier(attacker: Element, defender: Element): number {
  const advantages = dungeonRules.elementalAdvantages as Record<Element, Element>;
  if (advantages[attacker] === defender) return dungeonRules.elementAdvantageMultiplier;
  if (advantages[defender] === attacker) return dungeonRules.elementDisadvantageMultiplier;
  return dungeonRules.elementNeutralMultiplier;
}

export function calculateDamage(input: DamageInput): number {
  const damage = input.attack
    * input.skillMultiplier
    * (dungeonRules.defenseBase / (dungeonRules.defenseBase + Math.max(0, input.defense)))
    * input.elementMultiplier
    * (input.critMultiplier ?? 1)
    * input.randomMultiplier
    * (input.damageTakenMultiplier ?? 1);
  return Math.max(dungeonRules.minimumDamage, Math.floor(damage));
}

export function scaleEnemy(template: EnemyTemplate, floor: number): Stats {
  const factor = Math.pow(dungeonRules.enemyScalingPerFloor, Math.max(1, floor) * dungeonRules.floorExponent);
  const scaled: Stats = {
    HP: Math.max(1, Math.round(template.stats.HP * factor)),
    ATK: Math.max(1, Math.round(template.stats.ATK * factor)),
    DEF: Math.max(1, Math.round(template.stats.DEF * factor)),
    SPD: Math.max(1, Math.round(template.stats.SPD * factor)),
    LUK: Math.max(1, Math.round(template.stats.LUK * factor)),
  };
  if (template.kind === 'elite') {
    scaled.HP = Math.round(scaled.HP * dungeonRules.eliteHpMultiplier);
    scaled.ATK = Math.round(scaled.ATK * dungeonRules.eliteAttackMultiplier);
  } else if (template.kind === 'boss') {
    scaled.HP = Math.round(scaled.HP * dungeonRules.bossHpMultiplier);
    scaled.ATK = Math.round(scaled.ATK * dungeonRules.bossAttackMultiplier);
  }
  return scaled;
}

function pushLog(run: DungeonRunState, message: string): DungeonRunState {
  return { ...run, combatLog: [...run.combatLog, message].slice(-dungeonRules.combatLogLimit) };
}

function updateChoices(run: DungeonRunState, rng: RngCursor): DungeonRunState {
  if (run.floor % rooms.bossEveryFloors === 0) {
    return { ...run, roomChoices: ['boss'], rngSeed: rng.seed };
  }
  const pool: Array<{ type: DungeonRoomType; weight: number }> = rooms.weights.map((entry) => ({ ...entry }));
  if (run.floor >= rooms.elite.minFloor) pool.push({ type: 'elite', weight: rooms.elite.weight });
  const choices: DungeonRoomType[] = [];
  const choiceCount = Math.min(rooms.choicesPerRoom, pool.length);
  for (let count = 0; count < choiceCount; count += 1) {
    const totalWeight = pool.reduce((total, entry) => total + Math.max(0, entry.weight), 0);
    if (totalWeight <= 0) break;
    let target = rng.roll() * totalWeight;
    const selectedIndex = pool.findIndex((entry) => {
      target -= Math.max(0, entry.weight);
      return target < 0;
    });
    const [selected] = pool.splice(selectedIndex < 0 ? pool.length - 1 : selectedIndex, 1);
    if (selected) choices.push(selected.type);
  }
  return { ...run, roomChoices: choices, rngSeed: rng.seed };
}

function openInitialRun(state: GameState, packIds: string[]): ActionResult {
  if (state.stage === 'egg' || !state.evolution.formId) return { state, accepted: false, message: 'Wait until Pip has hatched before starting a run.' };
  if (state.sleeping) return { state, accepted: false, message: 'Wake Pip before starting a run.' };
  if (state.dungeon.activeRun) return { state, accepted: false, message: 'Finish the current run before starting another.' };
  if (!Array.isArray(packIds) || packIds.length > dungeonRules.packSlots || new Set(packIds).size !== packIds.length || packIds.some((id) => !consumables.some((item) => item.id === id))) {
    return { state, accepted: false, message: `Choose up to ${dungeonRules.packSlots} different pack items.` };
  }
  const form = getFormDefinition(state.evolution.formId);
  if (!form) return { state, accepted: false, message: 'Pip needs a known form before entering the dungeon.' };
  const petStats = getEffectiveStats(state);
  const equipmentEffects = getEquipmentCombatEffects(state.equipment, form.element);
  const rng = makeRng((state.seed ^ Math.imul(state.dungeon.runsCompleted + 1, 0x9e3779b9)) >>> 0);
  const run: DungeonRunState = {
    generation: state.generation,
    floor: dungeonRules.startingFloor,
    roomIndex: 0,
    biomeId: getBiomeForFloor(dungeonRules.startingFloor).id,
    petFormId: form.id,
    petElement: form.element,
    phase: 'choice',
    rngSeed: rng.seed,
    petStats,
    runStatMultipliers: { HP: 1, ATK: 1, DEF: 1, SPD: 1, LUK: 1 },
    coinMultiplier: Math.min(dungeonRules.maxRunCoinMultiplier, 1 + equipmentEffects.coinFind),
    petHp: petStats.HP,
    petMaxHp: petStats.HP,
    petGauge: 0,
    petStatuses: [],
    equipmentEffects,
    enemy: null,
    roomChoices: [],
    currentRoom: null,
    eventId: null,
    shopOfferIds: [],
    shopEquipmentOffers: [],
    tacticId: null,
    consumables: [...packIds],
    coins: 0,
    lootIds: [],
    pendingItems: [],
    pendingItem: null,
    pendingScrap: 0,
    pendingEssence: 0,
    combatLog: ['The descent begins. Choose a path.'],
    combatElapsedSeconds: 0,
    turns: 0,
    result: null,
    bankedCoins: 0,
    bankedLootCount: 0,
    lostLootCount: 0,
    bankedItemCount: 0,
    lostItemCount: 0,
    bankedScrap: 0,
    bankedEssence: 0,
    lostScrap: 0,
    lostEssence: 0,
  };
  const nextRun = updateChoices(run, rng);
  const dungeon = {
    ...state.dungeon,
    deepestFloor: Math.max(state.dungeon.deepestFloor, nextRun.floor),
    petDeepestFloor: nextRun.generation === state.generation ? Math.max(state.dungeon.petDeepestFloor, nextRun.floor) : state.dungeon.petDeepestFloor,
    activeRun: nextRun,
  };
  return { state: { ...state, dungeon }, accepted: true, message: `Pip enters ${getBiomeForFloor(nextRun.floor).name}.` };
}

function spawnEnemy(run: DungeonRunState, kind: EnemyKind, rng: RngCursor): DungeonEnemyState | null {
  const candidates = enemies.filter((enemy) => enemy.biomeId === run.biomeId && enemy.kind === kind);
  if (!candidates.length) return null;
  const template = candidates[Math.floor(rng.roll() * candidates.length)]!;
  const stats = scaleEnemy(template, run.floor);
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    element: template.element,
    skillId: template.skillId,
    stats,
    hp: stats.HP,
    maxHp: stats.HP,
    gauge: 0,
    statuses: [],
    phaseTwoTriggered: false,
    phaseTwoSkillId: template.phaseTwo?.skillId ?? null,
    phaseTwoAttackMultiplier: template.phaseTwo?.attackMultiplier ?? 1,
    coinDrop: template.coinDrop,
    lootDrops: template.lootDrops,
  };
}

function addStatus(statuses: CombatStatus[], status: CombatStatus): CombatStatus[] {
  const same = statuses.findIndex((current) => current.type === status.type && current.stat === status.stat);
  const result = [...statuses];
  if (same >= 0) {
    const existing = result[same]!;
    result[same] = {
      ...status,
      turns: Math.max(existing.turns, status.turns),
      amount: status.type === 'shield' ? existing.amount + status.amount : Math.max(existing.amount, status.amount),
    };
  } else {
    result.push(status);
  }
  return result.slice(-dungeonRules.maxStatusesPerTarget);
}

function getTactic(run: DungeonRunState): TacticData | null {
  return tactics.find((item) => item.id === run.tacticId) ?? null;
}

function petStat(run: DungeonRunState, stat: StatKey, state: GameState): number {
  const tactic = getTactic(run);
  let value = run.petStats[stat] * run.runStatMultipliers[stat];
  if (stat === 'ATK' && tactic) value *= tactic.attackMultiplier;
  if (stat === 'SPD' && tactic) value *= tactic.speedMultiplier;
  if (stat === 'DEF' && tactic) value *= tactic.defenseMultiplier;
  for (const status of run.petStatuses) if (status.type === 'buff' && status.stat === stat) value *= status.multiplier ?? 1;
  if (stat === 'ATK' || stat === 'SPD') {
    const lowestNeed = Math.min(state.needs.hunger, state.needs.energy);
    value *= lowestNeed <= 0 ? dungeonRules.emptyNeedAttackSpeedMultiplier
      : lowestNeed < dungeonRules.lowNeedThreshold ? dungeonRules.lowNeedAttackSpeedMultiplier
        : 1;
  }
  return Math.max(1, value);
}

function enemyStat(enemy: DungeonEnemyState, stat: StatKey): number {
  let value = enemy.stats[stat];
  for (const status of enemy.statuses) if (status.type === 'buff' && status.stat === stat) value *= status.multiplier ?? 1;
  return Math.max(1, value);
}

function getSkill(id: string): SkillData | null { return skills.find((skill) => skill.id === id) ?? null; }
function getPetSkill(formId: string | null): PetSkillData | null { return petSkills.find((skill) => skill.formId === formId) ?? null; }
function clampHp(value: number, max: number): number { return Math.max(0, Math.min(max, value)); }

function absorbShield(statuses: CombatStatus[], damage: number): { statuses: CombatStatus[]; damage: number; absorbed: number } {
  let remaining = damage;
  let absorbed = 0;
  const next = statuses.map((status) => {
    if (status.type !== 'shield' || remaining <= 0) return status;
    const used = Math.min(status.amount, remaining);
    remaining -= used;
    absorbed += used;
    return { ...status, amount: status.amount - used };
  }).filter((status) => status.type !== 'shield' || status.amount > 0);
  return { statuses: next, damage: remaining, absorbed };
}

function applySkillEffect(run: DungeonRunState, source: 'pet' | 'enemy', effect: SkillEffect | null, rng: RngCursor): DungeonRunState {
  if (!effect || rng.roll() >= effect.chance) return run;
  const status: CombatStatus = { type: effect.type, amount: effect.amount, turns: effect.turns };
  if (effect.type === 'shield') {
    if (source === 'pet') return { ...run, petStatuses: addStatus(run.petStatuses, status) };
    if (!run.enemy) return run;
    return { ...run, enemy: { ...run.enemy, statuses: addStatus(run.enemy.statuses, status) } };
  }
  if (source === 'pet') {
    if (!run.enemy) return run;
    return { ...run, enemy: { ...run.enemy, statuses: addStatus(run.enemy.statuses, status) } };
  }
  return { ...run, petStatuses: addStatus(run.petStatuses, status) };
}

function processActorStatuses(run: DungeonRunState, actor: 'pet' | 'enemy'): { run: DungeonRunState; skipped: boolean } {
  const statuses = actor === 'pet' ? run.petStatuses : run.enemy?.statuses ?? [];
  let hp = actor === 'pet' ? run.petHp : run.enemy?.hp ?? 0;
  const maxHp = actor === 'pet' ? run.petMaxHp : run.enemy?.maxHp ?? 0;
  const stunned = statuses.some((status) => status.type === 'stun' && status.turns > 0);
  const burn = statuses.filter((status) => status.type === 'burn').reduce((sum, status) => sum + status.amount, 0);
  if (burn > 0) {
    hp = clampHp(hp - burn, maxHp);
    run = pushLog(run, `${actor === 'pet' ? 'Pip' : run.enemy?.name ?? 'Enemy'} takes ${burn} burn damage.`);
  }
  if (actor === 'pet') run = { ...run, petHp: hp };
  else if (run.enemy) run = { ...run, enemy: { ...run.enemy, hp } };
  return { run, skipped: stunned };
}

function ageActorStatuses(run: DungeonRunState, actor: 'pet' | 'enemy'): DungeonRunState {
  if (actor === 'pet') {
    return { ...run, petStatuses: run.petStatuses.map((status) => ({ ...status, turns: status.turns - 1 })).filter((status) => status.turns > 0) };
  }
  if (!run.enemy) return run;
  return { ...run, enemy: { ...run.enemy, statuses: run.enemy.statuses.map((status) => ({ ...status, turns: status.turns - 1 })).filter((status) => status.turns > 0) } };
}

function randomInteger(rng: RngCursor, min: number, max: number): number {
  const low = Math.floor(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return low + Math.floor(rng.roll() * (high - low + 1));
}

function coinMultiplier(run: DungeonRunState): number {
  return Math.min(dungeonRules.maxRunCoinMultiplier, Math.max(0.1, run.coinMultiplier));
}

function addRunCoins(run: DungeonRunState, amount: number): DungeonRunState {
  const scaled = amount >= 0 ? Math.floor(amount * coinMultiplier(run)) : Math.ceil(amount);
  return { ...run, coins: Math.max(0, Math.min(maximumStoredCoins, run.coins + scaled)) };
}

function addLoot(run: DungeonRunState, lootId: string): DungeonRunState {
  return loot.some((item) => item.id === lootId) ? { ...run, lootIds: [...run.lootIds, lootId].slice(-100) } : run;
}

function rollLootDrops(run: DungeonRunState, drops: LootDrop[], rng: RngCursor): DungeonRunState {
  let next = run;
  for (const drop of drops) if (rng.roll() < drop.chance) next = addLoot(next, drop.lootId);
  return next;
}

function lootValue(ids: string[], multiplier = 1): number {
  return ids.reduce((sum, id) => sum + Math.floor((loot.find((item) => item.id === id)?.coinValue ?? 0) * multiplier), 0);
}

function stageEquipmentDrop(
  state: GameState,
  run: DungeonRunState,
  rng: RngCursor,
  minimumRarity: EquipmentItem['rarity'],
): { state: GameState; run: DungeonRunState; awaitingChoice: boolean; message: string } {
  const allocation = nextEquipmentItemId(state.equipment);
  const item = createRandomEquipmentItem(
    () => rng.roll(),
    allocation.id,
    run.floor,
    run.petStats.LUK,
    run.petElement,
    minimumRarity,
  );
  if (!item) return { state, run, awaitingChoice: false, message: '' };
  const nextState = { ...state, equipment: allocation.equipment };
  const inventoryCapacity = equipmentRules.inventory.capacity;
  const full = state.equipment.inventory.length + run.pendingItems.length >= inventoryCapacity
    || run.pendingItems.length >= equipmentRules.inventory.pendingItemsPerRunCap;
  if (full || shouldAutoScrap(item, state.equipment.autoScrapThrough)) {
    const scrap = getScrapValue(item);
    const reason = full ? 'the bag is full' : `auto-scrap is set through ${state.equipment.autoScrapThrough}`;
    const nextRun = pushLog({ ...run, pendingScrap: Math.min(maximumStoredMaterials, run.pendingScrap + scrap), rngSeed: rng.seed }, `${equipmentItemName(item)} was ${full ? 'salvaged' : 'auto-scrapped'} (${reason}) for ${scrap} Scrap.`);
    return { state: nextState, run: nextRun, awaitingChoice: false, message: `${equipmentItemName(item)} became ${scrap} Scrap because ${reason}.` };
  }
  const nextRun = pushLog({ ...run, phase: 'loot', pendingItem: item, rngSeed: rng.seed }, `${item.rarity} drop: ${equipmentItemName(item)}.`);
  return { state: nextState, run: nextRun, awaitingChoice: true, message: `${item.rarity} drop: ${equipmentItemName(item)}.` };
}

function endRun(state: GameState, run: DungeonRunState, result: 'left' | 'fainted', rng: RngCursor): ActionResult {
  let keptLoot = [...run.lootIds];
  let keptItems = [...run.pendingItems];
  if (result === 'fainted') {
    const keepCount = Math.floor(keptLoot.length / 2);
    for (let index = keptLoot.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(rng.roll() * (index + 1));
      [keptLoot[index], keptLoot[swap]] = [keptLoot[swap]!, keptLoot[index]!];
    }
    keptLoot = keptLoot.slice(0, keepCount);
    const itemKeepCount = Math.floor(keptItems.length / 2);
    for (let index = keptItems.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(rng.roll() * (index + 1));
      [keptItems[index], keptItems[swap]] = [keptItems[swap]!, keptItems[index]!];
    }
    keptItems = keptItems.slice(0, itemKeepCount);
  }
  const retainedCoins = result === 'left' ? run.coins : Math.floor(run.coins / 2);
  const bankedCoins = Math.min(maximumStoredCoins, retainedCoins + lootValue(keptLoot, coinMultiplier(run)));
  const retainedScrap = result === 'left' ? run.pendingScrap : Math.floor(run.pendingScrap / 2);
  const retainedEssence = result === 'left' ? run.pendingEssence : Math.floor(run.pendingEssence / 2);
  let equipment = state.equipment;
  let overflowScrap = 0;
  let bankedItemCount = 0;
  for (const item of keptItems) {
    if (equipment.inventory.length < equipmentRules.inventory.capacity) {
      equipment = { ...equipment, inventory: [...equipment.inventory, item] };
      bankedItemCount += 1;
    } else {
      overflowScrap += getScrapValue(item);
    }
  }
  const bankedScrap = Math.min(maximumStoredMaterials, retainedScrap + overflowScrap);
  const bankedEssence = Math.min(maximumStoredMaterials, retainedEssence);
  const nextRun: DungeonRunState = {
    ...pushLog(run, result === 'left' ? 'Pip leaves the dungeon safely.' : 'Pip fainted; half the carried gear and materials were lost, and the pack was lost.'),
    phase: 'summary',
    result,
    bankedCoins,
    bankedLootCount: keptLoot.length,
    lostLootCount: run.lootIds.length - keptLoot.length,
    bankedItemCount,
    lostItemCount: run.pendingItems.length - keptItems.length,
    bankedScrap,
    bankedEssence,
    lostScrap: run.pendingScrap - retainedScrap,
    lostEssence: run.pendingEssence - retainedEssence,
    roomChoices: [],
    enemy: null,
    currentRoom: null,
    eventId: null,
    shopOfferIds: [],
    shopEquipmentOffers: [],
    consumables: [],
    pendingItems: [],
    pendingItem: null,
    pendingScrap: 0,
    pendingEssence: 0,
    rngSeed: rng.seed,
  };
  const nextState: GameState = {
    ...state,
    equipment,
    needs: result === 'fainted' ? { ...state.needs, energy: 0 } : state.needs,
    sleeping: false,
    dungeon: {
      ...state.dungeon,
      coins: Math.min(maximumStoredCoins, state.dungeon.coins + bankedCoins),
      scrap: Math.min(maximumStoredMaterials, state.dungeon.scrap + bankedScrap),
      essence: Math.min(maximumStoredMaterials, state.dungeon.essence + bankedEssence),
      runsCompleted: Math.min(1_000_000, state.dungeon.runsCompleted + 1),
      activeRun: nextRun,
    },
  };
  const message = result === 'left'
    ? `Run complete: ${bankedCoins} coins, ${bankedItemCount} gear item${bankedItemCount === 1 ? '' : 's'}, ${bankedScrap} Scrap and ${bankedEssence} Essence banked.`
    : `Pip fainted. ${bankedCoins} coins and ${bankedItemCount} gear item${bankedItemCount === 1 ? '' : 's'} banked; ${nextRun.lostLootCount} tokens and ${nextRun.lostItemCount} gear item${nextRun.lostItemCount === 1 ? '' : 's'} lost, and the pack is gone.`;
  return { state: nextState, accepted: true, message };
}

function finishRoom(state: GameState, run: DungeonRunState, rng: RngCursor): GameState {
  const needs = { ...state.needs, hunger: Math.max(0, state.needs.hunger - dungeonRules.roomHungerCost) };
  const nextIndex = run.roomIndex + 1;
  const roomCount = run.floor % rooms.bossEveryFloors === 0 ? 1 : rooms.roomsPerFloor;
  let nextRun: DungeonRunState = {
    ...run,
    roomIndex: nextIndex,
    phase: nextIndex >= roomCount ? 'floor-end' : 'choice',
    currentRoom: null,
    roomChoices: [],
    enemy: null,
    eventId: null,
    shopOfferIds: [],
    shopEquipmentOffers: [],
    tacticId: null,
    rngSeed: rng.seed,
  };
  if (nextRun.phase === 'choice') nextRun = updateChoices(nextRun, rng);
  return { ...state, needs, dungeon: { ...state.dungeon, activeRun: nextRun } };
}

function rewardCombatVictory(state: GameState, run: DungeonRunState, rng: RngCursor): GameState {
  const enemy = run.enemy;
  if (!enemy) return state;
  let nextRun = addRunCoins(run, randomInteger(rng, enemy.coinDrop.min, enemy.coinDrop.max));
  nextRun = rollLootDrops(nextRun, enemy.lootDrops, rng);
  const kind = enemy.kind;
  const xp = dungeonRules.xpRewards[kind];
  let nextState = awardXp(state, xp);
  nextState = updateTendency(nextState, 'fight');
  nextRun = pushLog(nextRun, `${enemy.name} is defeated. +${xp} XP.`);
  const policy = equipmentRules.dropPolicy[kind === 'fight' ? 'normal' : kind];
  if (kind === 'boss' && policy.essenceYield) {
    const essence = randomInteger(rng, policy.essenceYield.min, policy.essenceYield.max);
    nextRun = pushLog({ ...nextRun, pendingEssence: Math.min(maximumStoredMaterials, nextRun.pendingEssence + essence) }, `${essence} Essence found.`);
  }
  const dropCount = randomInteger(rng, policy.itemCount.min, policy.itemCount.max);
  const shouldDrop = kind !== 'fight' || rng.roll() < (policy.commonChance ?? 0);
  if (dropCount > 0 && shouldDrop) {
    const staged = stageEquipmentDrop(nextState, nextRun, rng, policy.rarityFloor);
    nextState = staged.state;
    nextRun = staged.run;
    if (staged.awaitingChoice) {
      return { ...nextState, dungeon: { ...nextState.dungeon, activeRun: nextRun } };
    }
  }
  nextRun = { ...nextRun, rngSeed: rng.seed };
  return finishRoom(nextState, nextRun, rng);
}

function applyIncomingDamage(run: DungeonRunState, target: 'pet' | 'enemy', damage: number): { run: DungeonRunState; received: number; absorbed: number } {
  if (target === 'pet') {
    const shield = absorbShield(run.petStatuses, damage);
    return {
      run: { ...run, petStatuses: shield.statuses, petHp: clampHp(run.petHp - shield.damage, run.petMaxHp) },
      received: shield.damage,
      absorbed: shield.absorbed,
    };
  }
  if (!run.enemy) return { run, received: 0, absorbed: 0 };
  const shield = absorbShield(run.enemy.statuses, damage);
  return {
    run: { ...run, enemy: { ...run.enemy, statuses: shield.statuses, hp: clampHp(run.enemy.hp - shield.damage, run.enemy.maxHp) } },
    received: shield.damage,
    absorbed: shield.absorbed,
  };
}

function checkBossPhase(run: DungeonRunState): DungeonRunState {
  const enemy = run.enemy;
  if (!enemy || enemy.kind !== 'boss' || enemy.phaseTwoTriggered || !enemy.phaseTwoSkillId) return run;
  const phaseTwo = enemies.find((item) => item.id === enemy.id)?.phaseTwo;
  if (!phaseTwo || (enemy.hp / enemy.maxHp) * 100 > phaseTwo.atHealthPercent) return run;
  return pushLog({ ...run, enemy: { ...enemy, phaseTwoTriggered: true, skillId: enemy.phaseTwoSkillId } }, `${enemy.name} reveals a new move!`);
}

function petTurn(run: DungeonRunState, state: GameState, rng: RngCursor): DungeonRunState {
  if (!run.enemy) return run;
  const processed = processActorStatuses(run, 'pet');
  run = processed.run;
  if (run.petHp <= 0 || !run.enemy || run.enemy.hp <= 0) return run;
  if (processed.skipped) return pushLog(ageActorStatuses(run, 'pet'), 'Pip is stunned and misses a turn.');
  const skill = getPetSkill(run.petFormId);
  if (!skill) return pushLog(ageActorStatuses(run, 'pet'), 'Pip steadies for a moment.');
  const enemy = run.enemy;
  const tactic = getTactic(run);
  const chance = Math.min(dungeonRules.critChanceCap, dungeonRules.critBaseChance + dungeonRules.critChancePerLuck * petStat(run, 'LUK', state) + (tactic?.critBonus ?? 0) + run.equipmentEffects.critChance);
  const critical = rng.roll() < chance;
  const randomMultiplier = dungeonRules.damageRandomMin + rng.roll() * (dungeonRules.damageRandomMax - dungeonRules.damageRandomMin);
  const damage = calculateDamage({
    attack: petStat(run, 'ATK', state),
    defense: enemyStat(enemy, 'DEF'),
    skillMultiplier: skill.multiplier,
    elementMultiplier: getElementMultiplier(run.petElement, enemy.element) * (1 + run.equipmentEffects.elementDamage),
    critMultiplier: critical ? dungeonRules.critMultiplier : 1,
    randomMultiplier,
  });
  const effectiveness = getElementMultiplier(run.petElement, enemy.element);
  run = {
    ...run,
    enemy: { ...enemy, hp: clampHp(enemy.hp - damage, enemy.maxHp) },
    turns: run.turns + 1,
  };
  const healed = Math.min(run.petMaxHp - run.petHp, Math.floor(damage * run.equipmentEffects.lifesteal));
  if (healed > 0) run = { ...run, petHp: run.petHp + healed };
  run = pushLog(run, `Pip uses ${skill.name}${critical ? ' · critical' : ''}${effectiveness > 1 ? ' · strong hit' : ''} for ${damage}${healed > 0 ? ` · siphons ${healed} health` : ''}.`);
  if (run.enemy && run.enemy.hp > 0) run = applySkillEffect(run, 'pet', skill.effect, rng);
  for (const bonus of run.equipmentEffects.onHitStatuses) {
    if (!run.enemy || run.enemy.hp <= 0) break;
    if (rng.roll() < bonus.chance) {
      run = { ...run, enemy: { ...run.enemy, statuses: addStatus(run.enemy.statuses, { type: bonus.type, amount: bonus.amount, turns: bonus.turns }) } };
    }
  }
  run = ageActorStatuses(run, 'pet');
  return checkBossPhase(run);
}

function enemyTurn(run: DungeonRunState, state: GameState, rng: RngCursor): DungeonRunState {
  const current = run.enemy;
  if (!current) return run;
  const processed = processActorStatuses(run, 'enemy');
  run = processed.run;
  if (run.petHp <= 0 || !run.enemy || run.enemy.hp <= 0) return run;
  if (processed.skipped) return pushLog(ageActorStatuses(run, 'enemy'), `${run.enemy.name} is stunned and misses a turn.`);
  const enemy = run.enemy;
  const skill = getSkill(enemy.skillId);
  if (!skill) return ageActorStatuses(run, 'enemy');
  const critical = rng.roll() < Math.min(dungeonRules.critChanceCap, dungeonRules.critBaseChance + dungeonRules.critChancePerLuck * enemyStat(enemy, 'LUK'));
  const randomMultiplier = dungeonRules.damageRandomMin + rng.roll() * (dungeonRules.damageRandomMax - dungeonRules.damageRandomMin);
  const tactic = getTactic(run);
  const damage = calculateDamage({
    attack: enemyStat(enemy, 'ATK') * (enemy.phaseTwoTriggered ? enemy.phaseTwoAttackMultiplier : 1),
    defense: petStat(run, 'DEF', state),
    skillMultiplier: skill.multiplier,
    elementMultiplier: getElementMultiplier(enemy.element, run.petElement),
    critMultiplier: critical ? dungeonRules.critMultiplier : 1,
    randomMultiplier,
    damageTakenMultiplier: (tactic?.damageTakenMultiplier ?? 1) * (1 - Math.min(0.75, run.equipmentEffects.resist + run.equipmentEffects.resistByElement[enemy.element])),
  });
  const applied = applyIncomingDamage(run, 'pet', damage);
  run = pushLog(applied.run, `${enemy.name} uses ${skill.name}${critical ? ' · critical' : ''} for ${applied.received}${applied.absorbed ? ` (${applied.absorbed} blocked)` : ''}.`);
  run = { ...run, turns: run.turns + 1 };
  if (run.enemy && run.enemy.hp > 0 && applied.received > 0 && run.equipmentEffects.thorns > 0) {
    const reflected = Math.floor(applied.received * run.equipmentEffects.thorns);
    if (reflected > 0) {
      const thornResult = applyIncomingDamage(run, 'enemy', reflected);
      run = pushLog(thornResult.run, `Pip's gear returns ${reflected} thorn damage.`);
    }
  }
  if (run.petHp > 0 && run.enemy?.hp) run = applySkillEffect(run, 'enemy', skill.effect, rng);
  return ageActorStatuses(run, 'enemy');
}

function combatTick(state: GameState, stepSeconds: number): GameState {
  const initial = state.dungeon.activeRun;
  if (!initial || initial.phase !== 'combat' || !initial.enemy) return state;
  let run: DungeonRunState = { ...initial, enemy: { ...initial.enemy }, combatElapsedSeconds: initial.combatElapsedSeconds + stepSeconds };
  const rng = makeRng(run.rngSeed);
  run.petGauge += petStat(run, 'SPD', state) * stepSeconds;
  if (run.enemy) run.enemy.gauge += enemyStat(run.enemy, 'SPD') * stepSeconds;
  for (let action = 0; action < dungeonRules.maxCombatActionsPerStep; action += 1) {
    if (!run.enemy || run.petHp <= 0 || run.enemy.hp <= 0) break;
    const petReady = run.petGauge >= dungeonRules.actionGauge;
    const enemyReady = run.enemy.gauge >= dungeonRules.actionGauge;
    if (!petReady && !enemyReady) break;
    if (petReady && (!enemyReady || run.petGauge >= run.enemy.gauge)) {
      run.petGauge -= dungeonRules.actionGauge;
      run = petTurn(run, state, rng);
    } else if (run.enemy) {
      run.enemy = { ...run.enemy, gauge: run.enemy.gauge - dungeonRules.actionGauge };
      run = enemyTurn(run, state, rng);
    }
  }
  run = { ...run, rngSeed: rng.seed };
  if (run.petHp <= 0) return endRun(state, run, 'fainted', rng).state;
  if (run.enemy && run.enemy.hp <= 0) return rewardCombatVictory(state, run, rng);
  return { ...state, dungeon: { ...state.dungeon, activeRun: run } };
}

export function advanceDungeon(state: GameState, stepSeconds: number): GameState {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return state;
  return combatTick(state, stepSeconds);
}

function startEncounter(state: GameState, run: DungeonRunState, roomType: DungeonRoomType, rng: RngCursor): ActionResult {
  if (roomType === 'fight' || roomType === 'elite' || roomType === 'boss') {
    const enemy = spawnEnemy(run, roomType, rng);
    if (!enemy) return { state, accepted: false, message: 'No encounter is ready for this path.' };
    const nextRun = pushLog({ ...run, phase: 'tactic', currentRoom: roomType, enemy, rngSeed: rng.seed }, `${enemy.name} appears. Choose a tactic.`);
    return { state: { ...state, dungeon: { ...state.dungeon, activeRun: nextRun } }, accepted: true, message: `${enemy.name} is waiting. Choose a tactic.` };
  }
  if (roomType === 'event') {
    const event = events[Math.floor(rng.roll() * events.length)];
    if (!event) return { state, accepted: false, message: 'No event is ready for this path.' };
    const nextRun = pushLog({ ...run, phase: 'event', currentRoom: roomType, eventId: event.id, rngSeed: rng.seed }, event.title);
    return { state: { ...state, dungeon: { ...state.dungeon, activeRun: nextRun } }, accepted: true, message: `${event.title} appears on the path.` };
  }
  if (roomType === 'treasure') {
    const nextRun = pushLog({ ...run, phase: 'treasure', currentRoom: roomType }, 'A little treasure waits ahead.');
    return { state: { ...state, dungeon: { ...state.dungeon, activeRun: nextRun } }, accepted: true, message: 'A treasure room is ahead.' };
  }
  if (roomType === 'rest') {
    const nextRun = pushLog({ ...run, phase: 'rest', currentRoom: roomType }, 'A quiet rest stop appears.');
    return { state: { ...state, dungeon: { ...state.dungeon, activeRun: nextRun } }, accepted: true, message: 'A rest stop is ahead.' };
  }
  const rngOffers = consumables.map((item) => item.id);
  const offers: string[] = [];
  while (offers.length < Math.min(dungeonRules.shopOfferCount, rngOffers.length)) {
    const index = Math.floor(rng.roll() * rngOffers.length);
    offers.push(rngOffers.splice(index, 1)[0]!);
  }
  let equipment = state.equipment;
  const gearOffers: ShopEquipmentOffer[] = [];
  while (gearOffers.length < equipmentRules.shop.offerCount) {
    const allocation = nextEquipmentItemId(equipment);
    const item = createRandomEquipmentItem(() => rng.roll(), allocation.id, run.floor, run.petStats.LUK, run.petElement);
    equipment = allocation.equipment;
    if (!item) break;
    gearOffers.push({ id: `offer-${item.instanceId}`, item, price: getItemSalePrice(item) });
  }
  const nextRun = pushLog({ ...run, phase: 'shop', currentRoom: roomType, shopOfferIds: offers, shopEquipmentOffers: gearOffers, rngSeed: rng.seed }, 'A traveling shop has opened.');
  return {
    state: { ...state, equipment, dungeon: { ...state.dungeon, activeRun: nextRun } },
    accepted: true,
    message: 'A traveling shop is open.',
  };
}

function chooseRoom(state: GameState, roomType: DungeonRoomType): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase !== 'choice' || !run.roomChoices.includes(roomType)) return { state, accepted: false, message: 'Choose one of the paths shown.' };
  const rng = makeRng(run.rngSeed);
  return startEncounter(state, run, roomType, rng);
}

function chooseTactic(state: GameState, tacticId: string): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase !== 'tactic' || !run.enemy) return { state, accepted: false, message: 'There is no fight ready for a tactic.' };
  if (!tactics.some((item) => item.id === tacticId)) return { state, accepted: false, message: 'That tactic is not available.' };
  let nextState: GameState = {
    ...state,
    needs: { ...state.needs, energy: Math.max(0, state.needs.energy - dungeonRules.fightEnergyCost) },
  };
  nextState = updateTendency(nextState, 'fight');
  const nextRun = pushLog({ ...run, phase: 'combat', tacticId, combatElapsedSeconds: 0 }, `${tactics.find((item) => item.id === tacticId)?.name} chosen. Fight!`);
  return { state: { ...nextState, dungeon: { ...nextState.dungeon, activeRun: nextRun } }, accepted: true, message: `${tactics.find((item) => item.id === tacticId)?.name} chosen. Fight!` };
}

function applyEventEffects(state: GameState, run: DungeonRunState, effects: EventEffect[], rng: RngCursor): { state: GameState; run: DungeonRunState; messages: string[] } {
  let nextState = state;
  let nextRun = run;
  const messages: string[] = [];
  for (const effect of effects) {
    if (effect.type === 'coins') {
      const amount = randomInteger(rng, effect.min ?? 0, effect.max ?? effect.min ?? 0);
      nextRun = addRunCoins(nextRun, amount);
      messages.push(amount >= 0 ? `+${Math.floor(amount * coinMultiplier(nextRun))} coins` : `${amount} coin cost`);
    } else if (effect.type === 'heal') {
      const previousHp = nextRun.petHp;
      const amount = Math.max(1, Math.round(nextRun.petMaxHp * Math.max(0, effect.percent ?? 0) / 100));
      nextRun = { ...nextRun, petHp: Math.min(nextRun.petMaxHp, nextRun.petHp + amount) };
      messages.push(`restored ${nextRun.petHp - previousHp} health`);
    } else if (effect.type === 'damage') {
      const percent = Math.min(dungeonRules.eventDamageMaxPercent * 100, Math.max(0, effect.percent ?? 0));
      const amount = Math.max(1, Math.round(nextRun.petMaxHp * percent / 100));
      nextRun = { ...nextRun, petHp: clampHp(nextRun.petHp - amount, nextRun.petMaxHp) };
      messages.push(`lost ${amount} health`);
    } else if (effect.type === 'loot' && effect.lootId) {
      nextRun = addLoot(nextRun, effect.lootId);
      messages.push('found a small treasure');
    } else if (effect.type === 'consumable' && effect.consumableId) {
      const item = consumables.find((candidate) => candidate.id === effect.consumableId);
      if (item && nextRun.consumables.length < dungeonRules.packSlots) {
        nextRun = { ...nextRun, consumables: [...nextRun.consumables, item.id] };
        messages.push(`${item.name} added to the pack`);
      } else if (item) {
        nextRun = addRunCoins(nextRun, Math.floor(item.price / 2));
        messages.push('The full pack traded the tonic for coins');
      }
    } else if (effect.type === 'buff' && effect.stat && effect.multiplier) {
      nextRun = { ...nextRun, petStatuses: addStatus(nextRun.petStatuses, { type: 'buff', stat: effect.stat, multiplier: effect.multiplier, amount: 0, turns: effect.turns ?? 1 }) };
      messages.push(`${effect.stat} boosted for ${effect.turns ?? 1} turns`);
    } else if (effect.type === 'run-stat' && effect.stat && effect.multiplier) {
      const runStatMultipliers = { ...nextRun.runStatMultipliers, [effect.stat]: Math.min(dungeonRules.maxRunStatMultiplier, nextRun.runStatMultipliers[effect.stat] * effect.multiplier) };
      const petMaxHp = Math.max(1, Math.round(nextRun.petStats.HP * runStatMultipliers.HP));
      nextRun = {
        ...nextRun,
        runStatMultipliers,
        petMaxHp,
        petHp: Math.min(nextRun.petHp, petMaxHp),
      };
      messages.push(`${effect.name ?? effect.stat} changed for this run`);
    } else if (effect.type === 'coin-multiplier' && effect.multiplier) {
      nextRun = { ...nextRun, coinMultiplier: Math.min(dungeonRules.maxRunCoinMultiplier, nextRun.coinMultiplier * effect.multiplier) };
      messages.push(`${effect.name ?? 'Coin boon'} affects this run`);
    }
  }
  nextRun = { ...nextRun, rngSeed: rng.seed };
  return { state: nextState, run: nextRun, messages };
}

function chooseEvent(state: GameState, optionId: string): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase !== 'event' || !run.eventId) return { state, accepted: false, message: 'There is no event choice waiting.' };
  const event = events.find((item) => item.id === run.eventId);
  const option = event?.options.find((item) => item.id === optionId);
  if (!event || !option) return { state, accepted: false, message: 'Choose one of the options shown.' };
  const rng = makeRng(run.rngSeed);
  const success = rng.roll() < option.successChance;
  const effects = success ? option.success : option.failure;
  const applied = applyEventEffects(state, run, effects, rng);
  let currentRun = pushLog(applied.run, `${event.title}: ${success ? 'a lucky outcome' : 'a tricky outcome'}. ${applied.messages.join(', ')}.`);
  if (currentRun.petHp <= 0) return endRun(applied.state, currentRun, 'fainted', rng);
  const nextState = finishRoom(applied.state, currentRun, rng);
  return { state: nextState, accepted: true, message: `${success ? 'Good fortune' : 'A small setback'}: ${applied.messages.join(', ') || 'the path continues'}.` };
}

function openTreasure(state: GameState): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase !== 'treasure') return { state, accepted: false, message: 'There is no treasure room to open.' };
  const rng = makeRng(run.rngSeed);
  const amount = randomInteger(rng, dungeonRules.treasureCoins.min, dungeonRules.treasureCoins.max);
  let nextRun = addRunCoins(run, amount);
  let foundLoot = false;
  if (rng.roll() < dungeonRules.treasureLootChance && loot.length) {
    const found = loot[Math.floor(rng.roll() * loot.length)];
    if (found) {
      nextRun = addLoot(nextRun, found.id);
      foundLoot = true;
    }
  }
  nextRun = pushLog({ ...nextRun, rngSeed: rng.seed }, `Treasure opened: +${Math.floor(amount * coinMultiplier(nextRun))} coins${foundLoot ? ' and a token' : ''}.`);
  const coinMessage = `Found ${Math.floor(amount * coinMultiplier(nextRun))} coins${foundLoot ? ' and a treasure token' : ''}.`;
  const staged = stageEquipmentDrop(state, nextRun, rng, equipmentRules.dropPolicy.treasure.rarityFloor);
  const message = `${coinMessage} ${staged.message}`.trim();
  if (staged.awaitingChoice) {
    return { state: { ...staged.state, dungeon: { ...staged.state.dungeon, activeRun: staged.run } }, accepted: true, message };
  }
  return { state: finishRoom(staged.state, { ...staged.run, rngSeed: rng.seed }, rng), accepted: true, message };
}

function restAtRoom(state: GameState): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase !== 'rest') return { state, accepted: false, message: 'There is no rest room to use.' };
  const heal = Math.max(1, Math.round(run.petMaxHp * dungeonRules.restHealPercent));
  const petHp = Math.min(run.petMaxHp, run.petHp + heal);
  const energy = Math.min(rules.needs.maximum, state.needs.energy + dungeonRules.restEnergyRestore);
  const nextRun = pushLog({ ...run, petHp }, `Pip rests and restores ${petHp - run.petHp} health.`);
  const nextState = { ...state, needs: { ...state.needs, energy }, dungeon: { ...state.dungeon, activeRun: nextRun } };
  return { state: finishRoom(nextState, nextRun, makeRng(run.rngSeed)), accepted: true, message: `Restored ${petHp - run.petHp} health and ${energy - state.needs.energy} energy.` };
}

function buyConsumable(state: GameState, consumableId: string): ActionResult {
  const run = state.dungeon.activeRun;
  const item = consumables.find((candidate) => candidate.id === consumableId);
  if (!run || run.phase !== 'shop' || !item || !run.shopOfferIds.includes(consumableId)) return { state, accepted: false, message: 'That item is not on this shop shelf.' };
  if (run.consumables.length >= dungeonRules.packSlots) return { state, accepted: false, message: 'The pack is full. Use an item before buying another.' };
  if (run.coins < item.price) return { state, accepted: false, message: `Need ${item.price} run coins for ${item.name}.` };
  const nextRun = pushLog({
    ...run,
    coins: run.coins - item.price,
    consumables: [...run.consumables, item.id],
    shopOfferIds: run.shopOfferIds.filter((id) => id !== item.id),
  }, `${item.name} added to the pack.`);
  return { state: { ...state, dungeon: { ...state.dungeon, activeRun: nextRun } }, accepted: true, message: `${item.name} added to the pack.` };
}

function buyEquipment(state: GameState, offerId: string): ActionResult {
  const run = state.dungeon.activeRun;
  const offer = run?.shopEquipmentOffers.find((candidate) => candidate.id === offerId);
  if (!run || run.phase !== 'shop' || !offer) return { state, accepted: false, message: 'That gear is not on this shop shelf.' };
  if (state.equipment.inventory.length + run.pendingItems.length >= equipmentRules.inventory.capacity
    || run.pendingItems.length >= equipmentRules.inventory.pendingItemsPerRunCap) {
    return { state, accepted: false, message: 'Your bag is full. Finish the run or leave some gear behind before buying more.' };
  }
  if (shouldAutoScrap(offer.item, state.equipment.autoScrapThrough)) {
    return { state, accepted: false, message: `Your auto-scrap setting would salvage ${offer.item.rarity} gear; turn it off or lower the threshold before buying.` };
  }
  if (run.coins < offer.price) return { state, accepted: false, message: `Need ${offer.price} run coins for this gear.` };
  const itemName = equipmentItemName(offer.item);
  const nextRun = pushLog({
    ...run,
    coins: run.coins - offer.price,
    pendingItems: [...run.pendingItems, offer.item],
    shopEquipmentOffers: run.shopEquipmentOffers.filter((candidate) => candidate.id !== offer.id),
  }, `${offer.item.rarity} ${itemName} added to the run bag for ${offer.price} coins.`);
  return { state: { ...state, dungeon: { ...state.dungeon, activeRun: nextRun } }, accepted: true, message: `${offer.item.rarity} ${itemName} added to the run bag.` };
}

function resolvePendingItem(state: GameState, choice: 'take' | 'scrap' | 'leave'): ActionResult {
  const run = state.dungeon.activeRun;
  const item = run?.pendingItem;
  if (!run || run.phase !== 'loot' || !item) return { state, accepted: false, message: 'There is no gear drop waiting.' };
  let nextRun: DungeonRunState = { ...run, pendingItem: null, phase: 'choice' };
  let message: string;
  if (choice === 'take' && state.equipment.inventory.length + run.pendingItems.length < equipmentRules.inventory.capacity
    && run.pendingItems.length < equipmentRules.inventory.pendingItemsPerRunCap) {
    nextRun = { ...nextRun, pendingItems: [...run.pendingItems, item] };
    message = `${equipmentItemName(item)} added to the run bag.`;
  } else if (choice === 'scrap' || choice === 'take') {
    const scrap = getScrapValue(item);
    nextRun = { ...nextRun, pendingScrap: Math.min(maximumStoredMaterials, run.pendingScrap + scrap) };
    message = choice === 'scrap'
      ? `${equipmentItemName(item)} salvaged for ${scrap} Scrap.`
      : `The bag is full; ${equipmentItemName(item)} was salvaged for ${scrap} Scrap.`;
  } else {
    message = `${equipmentItemName(item)} left behind.`;
  }
  nextRun = pushLog(nextRun, message);
  const nextState = finishRoom(state, nextRun, makeRng(run.rngSeed));
  return { state: nextState, accepted: true, message };
}

function finishShop(state: GameState): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase !== 'shop') return { state, accepted: false, message: 'There is no shop to leave.' };
  return { state: finishRoom(state, run, makeRng(run.rngSeed)), accepted: true, message: 'You leave the shop and continue down the path.' };
}

function useConsumable(state: GameState, slot: number): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase === 'summary' || !Number.isInteger(slot) || slot < 0 || slot >= run.consumables.length) return { state, accepted: false, message: 'That pack item is not available.' };
  const item = consumables.find((candidate) => candidate.id === run.consumables[slot]);
  if (!item) return { state, accepted: false, message: 'That pack item is not valid.' };
  let nextRun = run;
  let resultMessage: string;
  if (item.effect.type === 'heal') {
    if (run.petHp >= run.petMaxHp) return { state, accepted: false, message: 'Pip is already at full health.' };
    const amount = Math.max(1, Math.round(run.petMaxHp * item.effect.percent / 100));
    nextRun = { ...run, petHp: Math.min(run.petMaxHp, run.petHp + amount) };
    resultMessage = `Restored ${nextRun.petHp - run.petHp} health.`;
  } else if (item.effect.type === 'cleanse') {
    const petStatuses = run.petStatuses.filter((status) => status.type !== 'burn' && status.type !== 'stun');
    if (petStatuses.length === run.petStatuses.length) return { state, accepted: false, message: 'There is no lingering effect to cleanse.' };
    nextRun = { ...run, petStatuses };
    resultMessage = 'Pip is clear of lingering effects.';
  } else {
    nextRun = { ...run, petStatuses: addStatus(run.petStatuses, { type: 'buff', stat: item.effect.stat, multiplier: item.effect.multiplier, amount: 0, turns: item.effect.turns }) };
    resultMessage = `${item.effect.stat} boosted for ${item.effect.turns} turns.`;
  }
  const consumablesLeft = nextRun.consumables.filter((_, index) => index !== slot);
  nextRun = pushLog({ ...nextRun, consumables: consumablesLeft }, `${item.name} used. ${resultMessage}`);
  return { state: { ...state, dungeon: { ...state.dungeon, activeRun: nextRun } }, accepted: true, message: `${item.name} used. ${resultMessage}` };
}

function descend(state: GameState): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase !== 'floor-end') return { state, accepted: false, message: 'Finish the floor before descending.' };
  const floor = run.floor + 1;
  const biome = getBiomeForFloor(floor);
  const rng = makeRng(run.rngSeed);
  let nextRun: DungeonRunState = {
    ...pushLog(run, `Descend to floor ${floor} · ${biome.name}.`),
    floor,
    roomIndex: 0,
    biomeId: biome.id,
    phase: 'choice',
    currentRoom: null,
    eventId: null,
    roomChoices: [],
    enemy: null,
    tacticId: null,
    shopOfferIds: [],
    combatElapsedSeconds: 0,
  };
  nextRun = updateChoices(nextRun, rng);
  const dungeon = {
    ...state.dungeon,
    deepestFloor: Math.max(state.dungeon.deepestFloor, floor),
    petDeepestFloor: nextRun.generation === state.generation ? Math.max(state.dungeon.petDeepestFloor, floor) : state.dungeon.petDeepestFloor,
    activeRun: { ...nextRun, rngSeed: rng.seed },
  };
  return { state: { ...state, dungeon }, accepted: true, message: `Pip reaches floor ${floor} in ${biome.name}.` };
}

function leave(state: GameState): ActionResult {
  const run = state.dungeon.activeRun;
  if (!run || run.phase !== 'floor-end') return { state, accepted: false, message: 'Leave safely at the end of a floor.' };
  return endRun(state, run, 'left', makeRng(run.rngSeed));
}

export function applyDungeonAction(state: GameState, action: GameAction): ActionResult | null {
  switch (action.type) {
    case 'dungeon-start-run': return openInitialRun(state, action.consumables);
    case 'dungeon-choose-room': return chooseRoom(state, action.roomType);
    case 'dungeon-choose-tactic': return chooseTactic(state, action.tacticId);
    case 'dungeon-choose-event': return chooseEvent(state, action.optionId);
    case 'dungeon-open-treasure': return openTreasure(state);
    case 'dungeon-rest': return restAtRoom(state);
    case 'dungeon-buy-consumable': return buyConsumable(state, action.consumableId);
    case 'dungeon-buy-equipment': return buyEquipment(state, action.offerId);
    case 'dungeon-resolve-item': return resolvePendingItem(state, action.choice);
    case 'dungeon-finish-shop': return finishShop(state);
    case 'dungeon-use-consumable': return useConsumable(state, action.slot);
    case 'dungeon-descend': return descend(state);
    case 'dungeon-leave': return leave(state);
    case 'dungeon-close-summary': {
      const run = state.dungeon.activeRun;
      if (!run || run.phase !== 'summary') return { state, accepted: false, message: 'There is no run summary to close.' };
      return { state: { ...state, dungeon: { ...state.dungeon, activeRun: null } }, accepted: true, message: 'Back to Pip’s habitat.' };
    }
    default: return null;
  }
}

export function getDungeonData() {
  return {
    biomes,
    rooms,
    enemies,
    events,
    consumables,
    tactics,
    loot,
    skills,
    petSkills,
  };
}
