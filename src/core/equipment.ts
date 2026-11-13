import affixJson from '../data/affixes.json';
import equipmentRulesJson from '../data/equipment-rules.json';
import itemJson from '../data/items.json';
import setJson from '../data/sets.json';
import { mulberry32 } from './rng';
import type {
  AutoScrapThreshold,
  Element,
  EquipmentCombatEffects,
  EquipmentItem,
  EquipmentSlot,
  EquipmentState,
  ItemRarity,
  OnHitStatusBonus,
  StatKey,
  Stats,
} from './types';

interface GearEffect {
  type: string;
  stat?: string;
  element?: string;
  status?: 'burn' | 'stun';
  chance?: number;
  baseValue?: number;
  value?: number;
}
interface ItemTemplate {
  id: string;
  name: string;
  slot: EquipmentSlot;
  setId: string;
  baseStats: Record<string, number>;
}
interface AffixDefinition { id: string; name: string; effect: GearEffect }
interface SetDefinition {
  id: string;
  name: string;
  element: Element;
  bonuses: { '2': GearEffect[]; '4': GearEffect[] };
}
interface LegendaryEffect { id: string; name: string; effect: GearEffect }
interface EquipmentRules {
  slots: EquipmentSlot[];
  elements: Element[];
  statFormula: {
    randomRange: { min: number; max: number };
    ilvlBonusPerLevel: number;
    floorRoll: { min: number; max: number };
  };
  rarities: Record<ItemRarity, { weight: number; multiplier: number; affixCount: number }>;
  rarityRoll: { rareAndAboveLuckMinimum: number };
  affixRoll: { ilvlScalePerLevel: number; randomRange: { min: number; max: number }; duplicateAffixesAllowed: boolean };
  caps: Record<string, number>;
  dropPolicy: Record<'normal' | 'elite' | 'boss' | 'treasure', {
    itemCount: { min: number; max: number };
    commonChance?: number;
    rarityFloor: ItemRarity;
    essenceYield?: { min: number; max: number };
  }>;
  inventory: { capacity: number; pendingItemsPerRunCap: number; fullBagOverflow: string; autoScrapDefault?: AutoScrapThreshold };
  scrap: { yieldByRarity: Record<ItemRarity, number>; upgradeCostExponentBase: number; upgradeCostBase: number };
  upgrades: { maximumLevel: number; startingLevel: number; minimumLevel?: number; successChanceByTargetLevel: Record<string, number>; statBonusPerLevel: number };
  fusion: { inputCount: number; rarityOrder: ItemRarity[]; outputLevel: number };
  shop: { offerCount: number; itemPriceFactorsByRarity: Record<ItemRarity, number>; refreshCost: number };
  currencies: { bossEssenceYield: { min: number; max: number }; essencePerEvolutionStone: number };
  legendaryEffects: LegendaryEffect[];
}
interface RolledAffix {
  id: string;
  name: string;
  value: number;
  effect: GearEffect;
}
interface DerivedEquipmentItem {
  item: EquipmentItem;
  template: ItemTemplate;
  set: SetDefinition | null;
  stats: Partial<Record<StatKey, number>>;
  critChance: number;
  affixes: RolledAffix[];
  uniqueEffect: LegendaryEffect | null;
  upgradeMultiplier: number;
}
interface EquipmentBonuses {
  flatStats: Stats;
  percentStats: Stats;
  combat: EquipmentCombatEffects;
}

const templates = itemJson as unknown as ItemTemplate[];
const affixes = affixJson as AffixDefinition[];
const sets = setJson as SetDefinition[];
const equipmentRules = equipmentRulesJson as EquipmentRules;
const rarities = equipmentRules.fusion.rarityOrder;
const slots = equipmentRules.slots;
const statKeys: StatKey[] = ['HP', 'ATK', 'DEF', 'SPD', 'LUK'];
const baseStatMap: Record<string, StatKey> = {
  hp: 'HP',
  attack: 'ATK',
  defense: 'DEF',
  speed: 'SPD',
  luck: 'LUK',
};
const emptyStats = (): Stats => ({ HP: 0, ATK: 0, DEF: 0, SPD: 0, LUK: 0 });
const emptyElementValues = (): Record<Element, number> => ({ fire: 0, water: 0, moss: 0, storm: 0, shadow: 0 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function isItemRarity(value: unknown): value is ItemRarity {
  return typeof value === 'string' && rarities.includes(value as ItemRarity);
}

function isEquipmentSlot(value: unknown): value is EquipmentSlot {
  return typeof value === 'string' && slots.includes(value as EquipmentSlot);
}

export function getEquipmentRules(): EquipmentRules {
  return equipmentRules;
}

export function getItemTemplates(): ItemTemplate[] {
  return templates.map((template) => ({ ...template, baseStats: { ...template.baseStats } }));
}

export function getItemTemplate(templateId: string): ItemTemplate | null {
  return templates.find((template) => template.id === templateId) ?? null;
}

export function getAffixDefinition(affixId: string): AffixDefinition | null {
  return affixes.find((affix) => affix.id === affixId) ?? null;
}

export function getSetDefinition(setId: string | null): SetDefinition | null {
  return setId ? sets.find((set) => set.id === setId) ?? null : null;
}

export function createEmptyEquipment(): EquipmentState {
  return {
    inventory: [],
    equipped: { Weapon: null, Armor: null, Hat: null, Charm: null },
    autoScrapThrough: equipmentRules.inventory.autoScrapDefault ?? 'off',
    nextItemId: 1,
  };
}

export function sanitizeEquipmentItem(value: unknown, seenIds: Set<string> = new Set()): EquipmentItem | null {
  if (!isRecord(value)) return null;
  const templateId = typeof value.templateId === 'string' ? value.templateId : '';
  if (!getItemTemplate(templateId) || !isItemRarity(value.rarity)) return null;
  const instanceId = typeof value.instanceId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.instanceId)
    ? value.instanceId
    : '';
  if (!instanceId || seenIds.has(instanceId)) return null;
  seenIds.add(instanceId);
  const affixId = typeof value.inheritedAffixId === 'string' && getAffixDefinition(value.inheritedAffixId)
    ? value.inheritedAffixId
    : null;
  const rollSeed = typeof value.rollSeed === 'number' && Number.isFinite(value.rollSeed) ? value.rollSeed >>> 0 : 1;
  const maxItemLevel = Math.max(1, Math.floor(equipmentRules.caps.maximumItemLevel ?? 1000));
  return {
    instanceId,
    templateId,
    rarity: value.rarity,
    ilvl: Math.floor(boundedNumber(value.ilvl, 1, 1, maxItemLevel)),
    upgradeLevel: Math.floor(boundedNumber(value.upgradeLevel, equipmentRules.upgrades.startingLevel, 0, equipmentRules.upgrades.maximumLevel)),
    rollSeed,
    upgradeSeed: typeof value.upgradeSeed === 'number' && Number.isFinite(value.upgradeSeed)
      ? value.upgradeSeed >>> 0
      : (rollSeed ^ 0x9e3779b9) >>> 0,
    inheritedAffixId: affixId,
  };
}

export function sanitizeEquipmentState(value: unknown, seenIds = new Set<string>()): EquipmentState {
  if (!isRecord(value)) return createEmptyEquipment();
  const inventory: EquipmentItem[] = Array.isArray(value.inventory)
    ? value.inventory.slice(0, equipmentRules.inventory.capacity).flatMap((item) => {
      const safe = sanitizeEquipmentItem(item, seenIds);
      return safe ? [safe] : [];
    })
    : [];
  const equippedSource = isRecord(value.equipped) ? value.equipped : {};
  const equipped = { Weapon: null, Armor: null, Hat: null, Charm: null } as Record<EquipmentSlot, EquipmentItem | null>;
  slots.forEach((slot) => {
    const safe = sanitizeEquipmentItem(equippedSource[slot], seenIds);
    if (safe && getItemTemplate(safe.templateId)?.slot === slot) equipped[slot] = safe;
  });
  const autoScrapThrough = value.autoScrapThrough === 'off' || isItemRarity(value.autoScrapThrough)
    ? value.autoScrapThrough as AutoScrapThreshold
    : 'off';
  return {
    inventory,
    equipped,
    autoScrapThrough,
    nextItemId: Math.floor(boundedNumber(value.nextItemId, 1, 1, 1_000_000_000)),
  };
}

export function nextEquipmentItemId(equipment: EquipmentState): { id: string; equipment: EquipmentState } {
  const nextItemId = Math.min(1_000_000_000, Math.max(1, equipment.nextItemId));
  return { id: `gear-${nextItemId}`, equipment: { ...equipment, nextItemId: nextItemId + 1 } };
}

export function rollItemRarity(random: () => number, luck: number, minimum: ItemRarity = 'Common'): ItemRarity {
  const floorIndex = Math.max(0, rarities.indexOf(minimum));
  const boundedLuck = Math.max(equipmentRules.rarityRoll.rareAndAboveLuckMinimum, Math.min(200, Number.isFinite(luck) ? luck : 0));
  const luckMultiplier = 1 + boundedLuck / 200;
  const eligible = rarities.slice(floorIndex);
  const weights = eligible.map((rarity) => {
    const base = equipmentRules.rarities[rarity].weight;
    return rarity === 'Rare' || rarity === 'Epic' || rarity === 'Legendary' ? base * luckMultiplier : base;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = Math.max(0, Math.min(0.999999999, random())) * total;
  for (let index = 0; index < eligible.length; index += 1) {
    target -= weights[index] ?? 0;
    if (target < 0) return eligible[index] ?? 'Common';
  }
  return eligible[eligible.length - 1] ?? 'Common';
}

export function createEquipmentItem(
  templateId: string,
  rarity: ItemRarity,
  floor: number,
  random: () => number,
  instanceId: string,
  inheritedAffixId: string | null = null,
): EquipmentItem | null {
  if (!getItemTemplate(templateId) || !isItemRarity(rarity)) return null;
  const minOffset = equipmentRules.statFormula.floorRoll.min;
  const maxOffset = equipmentRules.statFormula.floorRoll.max;
  const offset = minOffset + Math.floor(Math.max(0, Math.min(0.999999999, random())) * (maxOffset - minOffset + 1));
  const rollSeed = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 4_294_967_296) >>> 0;
  const upgradeSeed = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 4_294_967_296) >>> 0;
  return {
    instanceId,
    templateId,
    rarity,
    ilvl: Math.max(1, Math.floor(floor) + offset),
    upgradeLevel: equipmentRules.upgrades.startingLevel,
    rollSeed,
    upgradeSeed,
    inheritedAffixId: inheritedAffixId && getAffixDefinition(inheritedAffixId) ? inheritedAffixId : null,
  };
}

export function createRandomEquipmentItem(
  random: () => number,
  instanceId: string,
  floor: number,
  luck: number,
  element: Element,
  minimumRarity: ItemRarity = 'Common',
): EquipmentItem | null {
  const elementSetIds = new Set(sets.filter((set) => set.element === element).map((set) => set.id));
  const eligible = templates.filter((template) => elementSetIds.has(template.setId));
  const pool = eligible.length ? eligible : templates;
  if (!pool.length) return null;
  const template = pool[Math.floor(Math.max(0, Math.min(0.999999999, random())) * pool.length)];
  if (!template) return null;
  const rarity = rollItemRarity(random, luck, minimumRarity);
  return createEquipmentItem(template.id, rarity, floor, random, instanceId);
}

export function createFusedEquipmentItem(
  templateId: string,
  rarity: ItemRarity,
  ilvl: number,
  random: () => number,
  instanceId: string,
  inheritedAffixId: string | null,
): EquipmentItem | null {
  if (!getItemTemplate(templateId) || !isItemRarity(rarity)) return null;
  const rollSeed = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 4_294_967_296) >>> 0;
  const upgradeSeed = Math.floor(Math.max(0, Math.min(0.999999999, random())) * 4_294_967_296) >>> 0;
  return {
    instanceId,
    templateId,
    rarity,
    ilvl: Math.max(1, Math.floor(ilvl)),
    upgradeLevel: equipmentRules.fusion.outputLevel,
    rollSeed,
    upgradeSeed,
    inheritedAffixId: inheritedAffixId && getAffixDefinition(inheritedAffixId) ? inheritedAffixId : null,
  };
}

function rollRange(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.max(0, Math.min(0.999999999, random())) * (maximum - minimum);
}

function effectBaseValue(effect: GearEffect): number {
  return typeof effect.baseValue === 'number' && Number.isFinite(effect.baseValue)
    ? effect.baseValue
    : typeof effect.value === 'number' && Number.isFinite(effect.value) ? effect.value : 0;
}

function effectMultiplier(item: EquipmentItem): number {
  return 1 + item.upgradeLevel * equipmentRules.upgrades.statBonusPerLevel;
}

export function getDerivedEquipmentItem(item: EquipmentItem): DerivedEquipmentItem | null {
  const template = getItemTemplate(item.templateId);
  if (!template) return null;
  const raritySpec = equipmentRules.rarities[item.rarity];
  if (!raritySpec) return null;
  const random = mulberry32(item.rollSeed >>> 0);
  const statScale = (1 + equipmentRules.statFormula.ilvlBonusPerLevel * item.ilvl) * raritySpec.multiplier * effectMultiplier(item);
  const stats: Partial<Record<StatKey, number>> = {};
  let critChance = 0;
  const statKeysInOrder = ['hp', 'attack', 'defense', 'speed', 'luck', 'critChance'];
  for (const key of statKeysInOrder) {
    const base = template.baseStats[key];
    if (typeof base !== 'number' || !Number.isFinite(base)) continue;
    const roll = rollRange(random, equipmentRules.statFormula.randomRange.min, equipmentRules.statFormula.randomRange.max);
    const value = base * statScale * roll;
    const mapped = baseStatMap[key];
    if (mapped) stats[mapped] = Math.max(1, Math.round(value));
    else if (key === 'critChance') critChance += Math.max(0, value);
  }

  const affixCount = Math.min(raritySpec.affixCount, affixes.length);
  const pool = [...affixes];
  const selected: AffixDefinition[] = [];
  if (affixCount > 0 && item.inheritedAffixId) {
    const inheritedIndex = pool.findIndex((affix) => affix.id === item.inheritedAffixId);
    if (inheritedIndex >= 0) selected.push(pool.splice(inheritedIndex, 1)[0]!);
  }
  while (selected.length < affixCount && pool.length) {
    const index = Math.floor(random() * pool.length);
    selected.push(pool.splice(index, 1)[0]!);
  }
  const affixIlvlScale = 1 + equipmentRules.affixRoll.ilvlScalePerLevel * item.ilvl;
  const affixMultiplier = raritySpec.multiplier * affixIlvlScale * effectMultiplier(item);
  const rolledAffixes = selected.map((affix) => {
    const randomValue = rollRange(random, equipmentRules.affixRoll.randomRange.min, equipmentRules.affixRoll.randomRange.max);
    return {
      id: affix.id,
      name: affix.name,
      value: effectBaseValue(affix.effect) * affixMultiplier * randomValue,
      effect: { ...affix.effect },
    };
  });
  const uniqueEffect = item.rarity === 'Legendary' && equipmentRules.legendaryEffects.length
    ? equipmentRules.legendaryEffects[Math.floor(random() * equipmentRules.legendaryEffects.length)] ?? null
    : null;
  return { item, template, set: getSetDefinition(template.setId), stats, critChance, affixes: rolledAffixes, uniqueEffect, upgradeMultiplier: effectMultiplier(item) };
}

function elementKey(value: string | undefined): value is Element {
  return Boolean(value && equipmentRules.elements.includes(value as Element));
}

function addEffect(
  bonuses: EquipmentBonuses,
  effect: GearEffect,
  value: number,
  petElement: Element,
  statusChance = effect.chance ?? 0,
): void {
  if (!Number.isFinite(value)) return;
  if (effect.type === 'flat-stat' || effect.type === 'percent-stat') {
    const stat = effect.stat ?? '';
    const mapped = baseStatMap[stat];
    if (effect.type === 'percent-stat' && (stat === 'healing' || stat === 'food')) {
      bonuses.combat.foodEffectiveness += value;
    } else if (mapped) {
      if (effect.type === 'flat-stat') bonuses.flatStats[mapped] += value;
      else bonuses.percentStats[mapped] += value;
    }
  } else if (effect.type === 'crit') {
    bonuses.combat.critChance += value;
  } else if (effect.type === 'lifesteal') {
    bonuses.combat.lifesteal += value;
  } else if (effect.type === 'element-damage') {
    if (effect.element === 'pet' || effect.element === petElement) bonuses.combat.elementDamage += value;
  } else if (effect.type === 'food-effectiveness') {
    bonuses.combat.foodEffectiveness += value;
  } else if (effect.type === 'coin-find') {
    bonuses.combat.coinFind += value;
  } else if (effect.type === 'resist') {
    if (elementKey(effect.element)) bonuses.combat.resistByElement[effect.element] += value;
    else bonuses.combat.resist += value;
  } else if (effect.type === 'thorns') {
    bonuses.combat.thorns += value;
  } else if (effect.type === 'on-hit-status' && effect.status) {
    const bonus: OnHitStatusBonus = {
      type: effect.status,
      chance: Math.max(0, Math.min(0.75, statusChance)),
      amount: Math.max(0, value),
      turns: effect.status === 'burn' ? 2 : 1,
    };
    bonuses.combat.onHitStatuses.push(bonus);
  }
}

function emptyBonuses(): EquipmentBonuses {
  return {
    flatStats: emptyStats(),
    percentStats: emptyStats(),
    combat: {
      critChance: 0,
      lifesteal: 0,
      elementDamage: 0,
      foodEffectiveness: 0,
      coinFind: 0,
      resist: 0,
      resistByElement: emptyElementValues(),
      thorns: 0,
      onHitStatuses: [],
    },
  };
}

function equippedItems(equipment: EquipmentState): EquipmentItem[] {
  return slots.flatMap((slot) => equipment.equipped[slot] ? [equipment.equipped[slot]!] : []);
}

function getBonuses(equipment: EquipmentState, petElement: Element): EquipmentBonuses {
  const bonuses = emptyBonuses();
  const items = equippedItems(equipment);
  const setCounts = new Map<string, number>();
  for (const item of items) {
    const derived = getDerivedEquipmentItem(item);
    if (!derived) continue;
    if (derived.set) setCounts.set(derived.set.id, (setCounts.get(derived.set.id) ?? 0) + 1);
    for (const key of statKeys) bonuses.flatStats[key] += derived.stats[key] ?? 0;
    bonuses.combat.critChance += derived.critChance;
    for (const affix of derived.affixes) {
      addEffect(bonuses, affix.effect, affix.value, petElement, affix.effect.chance ?? 0);
    }
    if (derived.uniqueEffect) {
      addEffect(bonuses, derived.uniqueEffect.effect, effectBaseValue(derived.uniqueEffect.effect) * derived.upgradeMultiplier, petElement);
    }
  }
  for (const [setId, count] of setCounts) {
    const set = getSetDefinition(setId);
    if (!set) continue;
    const threshold = count >= 4 ? '4' : count >= 2 ? '2' : null;
    if (!threshold) continue;
    for (const effect of set.bonuses[threshold]) addEffect(bonuses, effect, effectBaseValue(effect), petElement);
  }
  const caps = equipmentRules.caps;
  bonuses.combat.critChance = Math.min(caps.critChance ?? 0.5, Math.max(0, bonuses.combat.critChance));
  bonuses.combat.lifesteal = Math.min(caps.lifesteal ?? 0.5, Math.max(0, bonuses.combat.lifesteal));
  bonuses.combat.resist = Math.min(caps.resist ?? 0.75, Math.max(0, bonuses.combat.resist));
  Object.keys(bonuses.combat.resistByElement).forEach((element) => {
    const key = element as Element;
    bonuses.combat.resistByElement[key] = Math.min(caps.resist ?? 0.75, bonuses.combat.resistByElement[key]);
  });
  bonuses.combat.foodEffectiveness = Math.min(Math.max(0, (caps.foodEffectiveness ?? 3) - 1), Math.max(0, bonuses.combat.foodEffectiveness));
  bonuses.combat.coinFind = Math.min((caps.coinFind ?? 5) - 1, Math.max(0, bonuses.combat.coinFind));
  bonuses.combat.thorns = Math.min(caps.thorns ?? 1, Math.max(0, bonuses.combat.thorns));
  bonuses.combat.elementDamage = Math.min(caps.elementDamage ?? 3, Math.max(0, bonuses.combat.elementDamage));
  return bonuses;
}

export function applyEquipmentToStats(stats: Stats, equipment: EquipmentState): Stats {
  const element = 'fire';
  const bonuses = getBonuses(equipment, element);
  const result = emptyStats();
  for (const key of statKeys) {
    result[key] = Math.max(1, Math.floor((stats[key] + bonuses.flatStats[key]) * (1 + bonuses.percentStats[key])));
  }
  return result;
}

export function getEquipmentCombatEffects(equipment: EquipmentState, petElement: Element): EquipmentCombatEffects {
  return getBonuses(equipment, petElement).combat;
}

export function getEquipmentSetCounts(equipment: EquipmentState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of equippedItems(equipment)) {
    const setId = getItemTemplate(item.templateId)?.setId;
    if (setId) counts[setId] = (counts[setId] ?? 0) + 1;
  }
  return counts;
}

export function getScrapValue(item: EquipmentItem): number {
  const base = equipmentRules.scrap.yieldByRarity[item.rarity] ?? 0;
  const ilvlBonus = 1 + Math.max(0, item.ilvl) * 0.1;
  return Math.max(1, Math.floor(base * ilvlBonus + item.upgradeLevel * 2));
}

export function getUpgradeCost(currentLevel: number): number {
  return Math.ceil(equipmentRules.scrap.upgradeCostBase * Math.pow(equipmentRules.scrap.upgradeCostExponentBase, Math.max(0, Math.floor(currentLevel))));
}

export function getUpgradeSuccessChance(targetLevel: number): number {
  return equipmentRules.upgrades.successChanceByTargetLevel[String(targetLevel)] ?? 0;
}

export function nextFusionRarity(rarity: ItemRarity): ItemRarity | null {
  const index = rarities.indexOf(rarity);
  return index >= 0 && index < rarities.length - 1 ? rarities[index + 1] ?? null : null;
}

export function getItemSalePrice(item: EquipmentItem): number {
  const template = getItemTemplate(item.templateId);
  if (!template) return 0;
  const basePrice = Math.max(10, Object.values(template.baseStats).reduce((sum, value) => sum + Math.max(0, value), 0) * 2);
  const factor = equipmentRules.shop.itemPriceFactorsByRarity[item.rarity] ?? 1;
  return Math.max(1, Math.round(basePrice * factor * (1 + equipmentRules.statFormula.ilvlBonusPerLevel * item.ilvl)));
}

export function equipmentItemsHaveSameSlotAndRarity(items: EquipmentItem[]): boolean {
  if (items.length !== equipmentRules.fusion.inputCount) return false;
  const first = items[0];
  const template = first ? getItemTemplate(first.templateId) : null;
  return Boolean(first && template && items.every((item) => item.rarity === first.rarity && getItemTemplate(item.templateId)?.slot === template.slot));
}

export function getFusionSetId(items: EquipmentItem[]): string | null {
  const setIds = items.map((item) => getItemTemplate(item.templateId)?.setId ?? null);
  return setIds.length && setIds.every((id) => id === setIds[0]) ? setIds[0] ?? null : null;
}

export function getAutoScrapThresholdValue(threshold: AutoScrapThreshold): number {
  return threshold === 'off' ? -1 : rarities.indexOf(threshold);
}

export function shouldAutoScrap(item: EquipmentItem, threshold: AutoScrapThreshold): boolean {
  const cutoff = getAutoScrapThresholdValue(threshold);
  return cutoff >= 0 && rarities.indexOf(item.rarity) <= cutoff;
}

export function equipmentItemName(item: EquipmentItem): string {
  return getItemTemplate(item.templateId)?.name ?? 'Unknown item';
}

export function getItemPreview(item: EquipmentItem): DerivedEquipmentItem | null {
  return getDerivedEquipmentItem(item);
}

export function normalizeItemRarity(value: unknown, fallback: ItemRarity = 'Common'): ItemRarity {
  return isItemRarity(value) ? value : fallback;
}

export function normalizeEquipmentSlot(value: unknown): EquipmentSlot | null {
  return isEquipmentSlot(value) ? value : null;
}

export function getItemStatLabel(stat: StatKey): string {
  const labels: Record<StatKey, string> = { HP: 'Health', ATK: 'Attack', DEF: 'Defense', SPD: 'Speed', LUK: 'Luck' };
  return labels[stat];
}

export function createRandomSource(seed: number): () => number {
  return mulberry32(seed >>> 0);
}
