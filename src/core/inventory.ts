import {
  createFusedEquipmentItem,
  equipmentItemsHaveSameSlotAndRarity,
  getEquipmentRules,
  getFusionSetId,
  getItemPreview,
  getItemTemplate,
  getItemTemplates,
  getScrapValue,
  getUpgradeCost,
  getUpgradeSuccessChance,
  nextEquipmentItemId,
  nextFusionRarity,
} from './equipment';
import { grantEvolutionStone } from './progression';
import { nextRandom } from './rng';
import type { ActionResult, EquipmentItem, EquipmentSlot, GameAction, GameState } from './types';

const equipmentRules = getEquipmentRules();
const slots: EquipmentSlot[] = ['Weapon', 'Armor', 'Hat', 'Charm'];

function reject(state: GameState, message: string): ActionResult {
  return { state, accepted: false, message };
}

function findItem(state: GameState, instanceId: string): { item: EquipmentItem; slot: EquipmentSlot | null } | null {
  const stored = state.equipment.inventory.find((item) => item.instanceId === instanceId);
  if (stored) return { item: stored, slot: null };
  for (const slot of slots) {
    const item = state.equipment.equipped[slot];
    if (item?.instanceId === instanceId) return { item, slot };
  }
  return null;
}

function replaceItem(state: GameState, instanceId: string, updated: EquipmentItem): GameState {
  const inventoryIndex = state.equipment.inventory.findIndex((item) => item.instanceId === instanceId);
  if (inventoryIndex >= 0) {
    const inventory = [...state.equipment.inventory];
    inventory[inventoryIndex] = updated;
    return { ...state, equipment: { ...state.equipment, inventory } };
  }
  const slot = slots.find((key) => state.equipment.equipped[key]?.instanceId === instanceId);
  if (!slot) return state;
  return {
    ...state,
    equipment: { ...state.equipment, equipped: { ...state.equipment.equipped, [slot]: updated } },
  };
}

function applyUpgrade(state: GameState, instanceId: string): ActionResult {
  const found = findItem(state, instanceId);
  if (!found) return reject(state, 'That gear is no longer in your collection.');
  if (found.item.upgradeLevel >= equipmentRules.upgrades.maximumLevel) return reject(state, 'This gear is already at its maximum upgrade level.');
  const cost = getUpgradeCost(found.item.upgradeLevel);
  if (state.dungeon.scrap < cost) return reject(state, `This upgrade needs ${cost} Scrap.`);
  const targetLevel = found.item.upgradeLevel + 1;
  const chance = getUpgradeSuccessChance(targetLevel);
  if (chance <= 0) return reject(state, 'This upgrade level is not configured.');
  const roll = nextRandom(found.item.upgradeSeed >>> 0);
  const success = roll.value < chance;
  const nextLevel = success ? targetLevel : Math.max(equipmentRules.upgrades.minimumLevel ?? 0, found.item.upgradeLevel - 1);
  const updated = { ...found.item, upgradeLevel: nextLevel, upgradeSeed: roll.seed };
  const next = replaceItem(state, instanceId, updated);
  return {
    state: { ...next, dungeon: { ...next.dungeon, scrap: next.dungeon.scrap - cost } },
    accepted: true,
    message: success
      ? `${found.item.templateId} upgraded to +${nextLevel} for ${cost} Scrap.`
      : `Upgrade missed; the gear dropped to +${nextLevel}, but was not destroyed. ${cost} Scrap spent.`,
  };
}

function fuseItems(state: GameState, instanceIds: string[], keepAffixId: string | null): ActionResult {
  const expectedCount = equipmentRules.fusion.inputCount;
  if (!Array.isArray(instanceIds) || instanceIds.length !== expectedCount || new Set(instanceIds).size !== expectedCount) {
    return reject(state, `Choose ${expectedCount} different items to fuse.`);
  }
  const items = instanceIds.map((id) => state.equipment.inventory.find((item) => item.instanceId === id));
  if (items.some((item): item is undefined => item === undefined)) return reject(state, 'All fusion items must be in your bag.');
  const inputs = items as EquipmentItem[];
  if (!equipmentItemsHaveSameSlotAndRarity(inputs)) return reject(state, 'Fusion needs items of the same slot and rarity.');
  const targetRarity = nextFusionRarity(inputs[0]!.rarity);
  if (!targetRarity) return reject(state, 'Legendary gear cannot be fused further.');
  const chosenAffixIds = new Set(inputs.flatMap((item) => getItemPreview(item)?.affixes.map((affix) => affix.id) ?? []));
  if (inputs[0]!.rarity === 'Common') {
    if (keepAffixId !== null) return reject(state, 'Common gear has no affix to carry into the fusion.');
  } else if (!keepAffixId || !chosenAffixIds.has(keepAffixId)) {
    return reject(state, 'Choose one affix from the selected gear to keep.');
  }
  const templateSlot = getItemTemplate(inputs[0]!.templateId)?.slot;
  if (!templateSlot) return reject(state, 'The selected gear has an unknown slot.');
  const sharedSetId = getFusionSetId(inputs);
  const allTemplates = getItemTemplates();
  const candidates = allTemplates.filter((template) => template.slot === templateSlot && (!sharedSetId || template.setId === sharedSetId));
  if (!candidates.length) return reject(state, 'No compatible template is available for this fusion.');
  const selection = nextRandom(state.seed >>> 0);
  const template = candidates[Math.floor(selection.value * candidates.length)]!;
  const allocation = nextEquipmentItemId(state.equipment);
  const random = (() => {
    let seed = selection.seed;
    return () => {
      const step = nextRandom(seed);
      seed = step.seed;
      return step.value;
    };
  })();
  const fused = createFusedEquipmentItem(
    template.id,
    targetRarity,
    Math.max(...inputs.map((item) => item.ilvl)),
    random,
    allocation.id,
    keepAffixId,
  );
  if (!fused) return reject(state, 'The fusion could not create a valid item.');
  const consumed = new Set(instanceIds);
  return {
    state: {
      ...state,
      seed: selection.seed,
      equipment: { ...allocation.equipment, inventory: [...state.equipment.inventory.filter((item) => !consumed.has(item.instanceId)), fused] },
    },
    accepted: true,
    message: `Fusion complete: ${targetRarity} ${template.name} created at item level ${fused.ilvl}.`,
  };
}

export function applyEquipmentAction(state: GameState, action: GameAction): ActionResult | null {
  const isEquipmentAction = action.type === 'equip-item'
    || action.type === 'unequip-item'
    || action.type === 'scrap-item'
    || action.type === 'upgrade-item'
    || action.type === 'fuse-items'
    || action.type === 'set-auto-scrap'
    || action.type === 'craft-evolution-stone';
  if (!isEquipmentAction) return null;
  if (state.dungeon.activeRun) return reject(state, 'Finish or leave the current dungeon run before changing equipment.');

  if (action.type === 'equip-item') {
    const index = state.equipment.inventory.findIndex((item) => item.instanceId === action.instanceId);
    if (index < 0) return reject(state, 'That item is not in your bag.');
    const item = state.equipment.inventory[index]!;
    const slot = getItemTemplate(item.templateId)?.slot;
    if (!slot) return reject(state, 'That item has an unknown equipment slot.');
    const previous = state.equipment.equipped[slot];
    const inventory = state.equipment.inventory.filter((entry) => entry.instanceId !== item.instanceId);
    if (previous) inventory.push(previous);
    return {
      state: {
        ...state,
        equipment: { ...state.equipment, inventory, equipped: { ...state.equipment.equipped, [slot]: item } },
      },
      accepted: true,
      message: `${item.rarity} ${getItemTemplate(item.templateId)?.name ?? 'gear'} equipped in ${slot}.`,
    };
  }

  if (action.type === 'unequip-item') {
    if (!slots.includes(action.slot)) return reject(state, 'That equipment slot is not available.');
    const item = state.equipment.equipped[action.slot];
    if (!item) return reject(state, `Nothing is equipped in ${action.slot}.`);
    if (state.equipment.inventory.length >= equipmentRules.inventory.capacity) return reject(state, 'Your bag is full; scrap an item before unequipping this gear.');
    return {
      state: {
        ...state,
        equipment: {
          ...state.equipment,
          inventory: [...state.equipment.inventory, item],
          equipped: { ...state.equipment.equipped, [action.slot]: null },
        },
      },
      accepted: true,
      message: `${action.slot} gear moved to your bag.`,
    };
  }

  if (action.type === 'scrap-item') {
    const item = state.equipment.inventory.find((entry) => entry.instanceId === action.instanceId);
    if (!item) return reject(state, 'Only items in your bag can be scrapped.');
    const scrap = getScrapValue(item);
    return {
      state: {
        ...state,
        equipment: { ...state.equipment, inventory: state.equipment.inventory.filter((entry) => entry.instanceId !== item.instanceId) },
        dungeon: { ...state.dungeon, scrap: Math.min(equipmentRules.caps.maximumStoredCurrency, state.dungeon.scrap + scrap) },
      },
      accepted: true,
      message: `${item.rarity} ${getItemTemplate(item.templateId)?.name ?? 'gear'} scrapped for ${scrap} Scrap.`,
    };
  }

  if (action.type === 'upgrade-item') return applyUpgrade(state, action.instanceId);
  if (action.type === 'fuse-items') return fuseItems(state, action.instanceIds, action.keepAffixId);

  if (action.type === 'set-auto-scrap') {
    const valid = action.threshold === 'off' || equipmentRules.fusion.rarityOrder.includes(action.threshold);
    if (!valid) return reject(state, 'That auto-scrap threshold is not available.');
    return {
      state: { ...state, equipment: { ...state.equipment, autoScrapThrough: action.threshold } },
      accepted: true,
      message: action.threshold === 'off' ? 'Automatic salvaging is off.' : `New drops up to ${action.threshold} will be salvaged automatically.`,
    };
  }

  const essenceCost = equipmentRules.currencies.essencePerEvolutionStone;
  if (state.dungeon.essence < essenceCost) return reject(state, `An Evolution Stone needs ${essenceCost} Essence.`);
  if (state.evolution.evolutionStones >= 1_000_000) return reject(state, 'Your Evolution Stone collection is full.');
  const next = grantEvolutionStone(state);
  return {
    state: { ...next, dungeon: { ...next.dungeon, essence: next.dungeon.essence - essenceCost } },
    accepted: true,
    message: `One Evolution Stone crafted for ${essenceCost} Essence.`,
  };
}
