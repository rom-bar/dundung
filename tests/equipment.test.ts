import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState } from '../src/core/game';
import { applyDungeonAction } from '../src/core/dungeon';
import { applyEquipmentAction } from '../src/core/inventory';
import {
  createEquipmentItem,
  createRandomSource,
  createRandomEquipmentItem,
  createEmptyEquipment,
  getAffixDefinition,
  getEquipmentCombatEffects,
  getEquipmentRules,
  getEquipmentSetCounts,
  getItemPreview,
  getItemTemplate,
  getScrapValue,
  getUpgradeCost,
  rollItemRarity,
} from '../src/core/equipment';
import { getEffectiveStats } from '../src/core/progression';
import { nextRandom } from '../src/core/rng';
import type { EquipmentItem, GameState, ItemRarity } from '../src/core/types';

const rules = getEquipmentRules();
const weaponTemplate = 'emberfang-pick';

function makeItem(
  instanceId: string,
  rarity: ItemRarity = 'Common',
  templateId = weaponTemplate,
  overrides: Partial<EquipmentItem> = {},
): EquipmentItem {
  const created = createEquipmentItem(templateId, rarity, 8, () => 0.5, instanceId);
  if (!created) throw new Error(`Could not create test item ${templateId}`);
  return { ...created, ...overrides };
}

function stateWithItems(items: EquipmentItem[], seed = 31): GameState {
  const state = createInitialState(seed);
  return {
    ...state,
    equipment: { ...state.equipment, inventory: items, nextItemId: 100 },
  };
}

function readyForDungeon(seed = 41): GameState {
  const state = createInitialState(seed);
  return {
    ...state,
    stage: 'baby',
    evolution: { ...state.evolution, formId: 'fire-emberguard' },
    formDex: ['fire-emberguard'],
  };
}

function beginRun(state = readyForDungeon()): GameState {
  const result = applyAction(state, { type: 'dungeon-start-run', consumables: [] });
  expect(result.accepted).toBe(true);
  expect(result.state.dungeon.activeRun).not.toBeNull();
  return result.state;
}

describe('Phase 5 equipment and loot', () => {
  it('improves rare-tier odds with luck for the same deterministic roll', () => {
    expect(rollItemRarity(() => 0.94, 0)).toBe('Rare');
    expect(rollItemRarity(() => 0.94, 200)).toBe('Epic');
    expect(rollItemRarity(() => 0, -100)).toBe('Common');
  });

  it('generates the same item and stat preview from the same seed', () => {
    const first = createRandomEquipmentItem(createRandomSource(991), 'drop-a', 12, 40, 'fire');
    const second = createRandomEquipmentItem(createRandomSource(991), 'drop-a', 12, 40, 'fire');
    expect(first).toEqual(second);
    expect(getItemPreview(first!)).toEqual(getItemPreview(second!));
    expect(getItemTemplate(first!.templateId)).not.toBeNull();
  });

  it('rolls the configured number of affixes within each rarity range and gives Legendary gear a unique effect', () => {
    const expectedCounts: Record<ItemRarity, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
    for (const rarity of rules.fusion.rarityOrder) {
      const item = makeItem(`affix-${rarity}`, rarity);
      const preview = getItemPreview(item)!;
      expect(preview.affixes).toHaveLength(expectedCounts[rarity]);
      const rarityMultiplier = rules.rarities[rarity].multiplier;
      const ilvlScale = 1 + rules.affixRoll.ilvlScalePerLevel * item.ilvl;
      for (const affix of preview.affixes) {
        const definition = getAffixDefinition(affix.id)!;
        const baseValue = definition.effect.baseValue ?? definition.effect.value ?? 0;
        const unrolled = baseValue * rarityMultiplier * ilvlScale;
        expect(affix.value).toBeGreaterThanOrEqual(unrolled * rules.affixRoll.randomRange.min - 1e-9);
        expect(affix.value).toBeLessThanOrEqual(unrolled * rules.affixRoll.randomRange.max + 1e-9);
      }
      if (rarity === 'Legendary') expect(preview.uniqueEffect).not.toBeNull();
    }
  });

  it('activates the matching set bonus at two equipped pieces', () => {
    const equipment = {
      ...createEmptyEquipment(),
      equipped: {
        ...createEmptyEquipment().equipped,
        Weapon: makeItem('set-weapon', 'Common', 'emberfang-pick'),
        Armor: makeItem('set-armor', 'Common', 'coalcap-plate'),
      },
    };
    expect(getEquipmentSetCounts(equipment).cinderburrow).toBe(2);
    expect(getEquipmentCombatEffects(equipment, 'fire').elementDamage).toBeCloseTo(0.15);
    const singlePiece = { ...equipment, equipped: { ...equipment.equipped, Armor: null } };
    expect(getEquipmentCombatEffects(singlePiece, 'fire').elementDamage).toBe(0);
  });

  it('equips and swaps gear while applying its stats to Pip', () => {
    const first = makeItem('weapon-a');
    const second = makeItem('weapon-b', 'Uncommon');
    const state = stateWithItems([first, second]);
    const beforeAttack = getEffectiveStats(state).ATK;
    const equipped = applyEquipmentAction(state, { type: 'equip-item', instanceId: first.instanceId });
    expect(equipped?.accepted).toBe(true);
    expect(equipped?.state.equipment.equipped.Weapon?.instanceId).toBe(first.instanceId);
    expect(equipped?.state.equipment.inventory.map((item) => item.instanceId)).toEqual([second.instanceId]);
    expect(getEffectiveStats(equipped!.state).ATK).toBeGreaterThan(beforeAttack);

    const swapped = applyEquipmentAction(equipped!.state, { type: 'equip-item', instanceId: second.instanceId });
    expect(swapped?.accepted).toBe(true);
    expect(swapped?.state.equipment.equipped.Weapon?.instanceId).toBe(second.instanceId);
    expect(swapped?.state.equipment.inventory.map((item) => item.instanceId)).toEqual([first.instanceId]);
  });

  it('prevents unequipping into a full bag without losing the equipped item', () => {
    const equipped = makeItem('worn-weapon');
    const fullInventory = Array.from({ length: rules.inventory.capacity }, (_, index) => makeItem(`bag-${index}`));
    const state = stateWithItems(fullInventory);
    state.equipment = { ...state.equipment, equipped: { ...state.equipment.equipped, Weapon: equipped } };
    const result = applyEquipmentAction(state, { type: 'unequip-item', slot: 'Weapon' });
    expect(result?.accepted).toBe(false);
    expect(result?.state.equipment.inventory).toHaveLength(rules.inventory.capacity);
    expect(result?.state.equipment.equipped.Weapon?.instanceId).toBe('worn-weapon');
  });

  it('salvages bag items into Scrap and respects auto-scrap thresholds', () => {
    const item = makeItem('scrap-me', 'Rare');
    const state = stateWithItems([item]);
    const result = applyEquipmentAction(state, { type: 'scrap-item', instanceId: item.instanceId });
    expect(result?.accepted).toBe(true);
    expect(result?.state.equipment.inventory).toHaveLength(0);
    expect(result?.state.dungeon.scrap).toBe(getScrapValue(item));

    const auto = applyEquipmentAction(state, { type: 'set-auto-scrap', threshold: 'Uncommon' });
    expect(auto?.accepted).toBe(true);
    expect(auto?.state.equipment.autoScrapThrough).toBe('Uncommon');
  });

  it('upgrades through guaranteed levels and safely downgrades rather than destroying on a miss', () => {
    const item = makeItem('upgrade-success', 'Common', weaponTemplate, { upgradeLevel: 0 });
    const state = stateWithItems([item]);
    state.dungeon = { ...state.dungeon, scrap: getUpgradeCost(0) };
    const success = applyEquipmentAction(state, { type: 'upgrade-item', instanceId: item.instanceId });
    expect(success?.accepted).toBe(true);
    expect(success?.state.equipment.inventory[0]?.upgradeLevel).toBe(1);
    expect(success?.state.dungeon.scrap).toBe(0);

    let failureSeed = 1;
    while (nextRandom(failureSeed).value < 0.85) failureSeed += 1;
    const advanced = makeItem('upgrade-miss', 'Rare', weaponTemplate, { upgradeLevel: 5, upgradeSeed: failureSeed });
    const failureState = stateWithItems([advanced]);
    failureState.dungeon = { ...failureState.dungeon, scrap: getUpgradeCost(5) };
    const failure = applyEquipmentAction(failureState, { type: 'upgrade-item', instanceId: advanced.instanceId });
    expect(failure?.accepted).toBe(true);
    expect(failure?.state.equipment.inventory).toHaveLength(1);
    expect(failure?.state.equipment.inventory[0]?.instanceId).toBe(advanced.instanceId);
    expect(failure?.state.equipment.inventory[0]?.upgradeLevel).toBe(4);
    expect(failure?.state.dungeon.scrap).toBe(0);
  });

  it('fuses three matching Common items into one Uncommon item and rejects mismatched inputs', () => {
    const inputs = [makeItem('fuse-a'), makeItem('fuse-b'), makeItem('fuse-c')];
    const state = stateWithItems(inputs);
    const fused = applyEquipmentAction(state, { type: 'fuse-items', instanceIds: inputs.map((item) => item.instanceId), keepAffixId: null });
    expect(fused?.accepted).toBe(true);
    expect(fused?.state.equipment.inventory).toHaveLength(1);
    expect(fused?.state.equipment.inventory[0]?.rarity).toBe('Uncommon');
    expect(getItemTemplate(fused!.state.equipment.inventory[0]!.templateId)?.slot).toBe('Weapon');

    const mismatch = applyEquipmentAction(state, { type: 'fuse-items', instanceIds: [inputs[0]!.instanceId, inputs[1]!.instanceId, 'missing'], keepAffixId: null });
    expect(mismatch?.accepted).toBe(false);
    expect(mismatch?.state.equipment.inventory).toHaveLength(3);

    const rareInputs = [makeItem('rare-fuse-a', 'Rare'), makeItem('rare-fuse-b', 'Rare'), makeItem('rare-fuse-c', 'Rare')];
    const retainedAffix = getItemPreview(rareInputs[0]!)!.affixes[0]!.id;
    const rareResult = applyEquipmentAction(stateWithItems(rareInputs), {
      type: 'fuse-items', instanceIds: rareInputs.map((item) => item.instanceId), keepAffixId: retainedAffix,
    });
    expect(rareResult?.accepted).toBe(true);
    const fusedItem = rareResult!.state.equipment.inventory[0]!;
    expect(fusedItem.rarity).toBe('Epic');
    expect(getItemPreview(fusedItem)?.affixes.some((affix) => affix.id === retainedAffix)).toBe(true);
  });

  it('crafts an Evolution Stone from Essence without allowing equipment edits during a run', () => {
    const state = stateWithItems([makeItem('locked-gear')]);
    state.dungeon = { ...state.dungeon, essence: rules.currencies.essencePerEvolutionStone };
    const crafted = applyEquipmentAction(state, { type: 'craft-evolution-stone' });
    expect(crafted?.accepted).toBe(true);
    expect(crafted?.state.evolution.evolutionStones).toBe(state.evolution.evolutionStones + 1);
    expect(crafted?.state.dungeon.essence).toBe(0);

    const runReady = {
      ...state,
      stage: 'baby' as const,
      evolution: { ...state.evolution, formId: 'fire-emberguard' },
      formDex: ['fire-emberguard'],
    };
    const active = beginRun(runReady);
    const blocked = applyEquipmentAction(active, { type: 'equip-item', instanceId: 'locked-gear' });
    expect(blocked?.accepted).toBe(false);
    expect(blocked?.state.equipment.equipped.Weapon).toBeNull();
  });

  it('banks run gear after a shop purchase without adding it to permanent inventory early', () => {
    const state = beginRun();
    const run = state.dungeon.activeRun!;
    const item = makeItem('shop-gear', 'Rare');
    const offer = { id: 'offer-test', item, price: 17 };
    const shopState = {
      ...state,
      dungeon: { ...state.dungeon, activeRun: { ...run, phase: 'shop' as const, coins: 30, shopEquipmentOffers: [offer] } },
    };
    const bought = applyDungeonAction(shopState, { type: 'dungeon-buy-equipment', offerId: offer.id });
    expect(bought?.accepted).toBe(true);
    expect(bought?.state.equipment.inventory).toHaveLength(0);
    expect(bought?.state.dungeon.activeRun?.pendingItems).toEqual([item]);
    expect(bought?.state.dungeon.activeRun?.coins).toBe(13);

    const full = stateWithItems(Array.from({ length: rules.inventory.capacity }, (_, index) => makeItem(`shop-full-${index}`)));
    full.dungeon = { ...full.dungeon, activeRun: { ...run, phase: 'shop', coins: 30, shopEquipmentOffers: [offer] } };
    const rejected = applyDungeonAction(full, { type: 'dungeon-buy-equipment', offerId: offer.id });
    expect(rejected?.accepted).toBe(false);
    expect(rejected?.state.dungeon.activeRun?.pendingItems).toHaveLength(0);
  });

  it('salvages run gear to Scrap on safe settlement when the permanent bag is full', () => {
    const state = beginRun();
    const run = state.dungeon.activeRun!;
    const carried = makeItem('overflow-run-gear', 'Uncommon');
    const fullInventory = Array.from({ length: rules.inventory.capacity }, (_, index) => makeItem(`settlement-${index}`));
    const full = stateWithItems(fullInventory);
    full.dungeon = {
      ...full.dungeon,
      activeRun: { ...run, phase: 'floor-end', pendingItems: [carried], pendingItem: null },
    };
    const left = applyDungeonAction(full, { type: 'dungeon-leave' });
    expect(left?.accepted).toBe(true);
    expect(left?.state.dungeon.activeRun?.phase).toBe('summary');
    expect(left?.state.dungeon.activeRun?.bankedItemCount).toBe(0);
    expect(left?.state.dungeon.activeRun?.bankedScrap).toBe(getScrapValue(carried));
    expect(left?.state.equipment.inventory).toHaveLength(rules.inventory.capacity);
  });
});
