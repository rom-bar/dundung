import { describe, expect, it } from 'vitest';
import { getDungeonData } from '../src/core/dungeon';
import { createEquipmentItem, getEquipmentRules, getUpgradeCost } from '../src/core/equipment';
import { applyAction, createInitialState } from '../src/core/game';
import { nextRandom } from '../src/core/rng';
import {
  getAchievementStatuses,
  getHomeEffects,
  getHomeUpgradeCost,
  unlockReadyAchievements,
} from '../src/core/home';
import { completeGeneration, getAllForms, getEffectiveStats, getEvolutionWeightHints } from '../src/core/progression';
import type { EquipmentItem, GameState, ItemRarity } from '../src/core/types';

const equipmentRules = getEquipmentRules();

function readyPet(seed = 41): GameState {
  const state = createInitialState(seed);
  return {
    ...state,
    stage: 'baby',
    evolution: { ...state.evolution, formId: 'fire-emberguard' },
    formDex: ['fire-emberguard'],
  };
}

function makeItem(instanceId: string, templateId: string, rarity: ItemRarity = 'Common'): EquipmentItem {
  const item = createEquipmentItem(templateId, rarity, 8, () => 0.5, instanceId);
  if (!item) throw new Error(`Unable to create ${templateId}`);
  return item;
}

describe('Phase 6 Home and meta progression', () => {
  it('scales Home upgrade costs and Kitchen effects from data', () => {
    const state = readyPet();
    state.dungeon = { ...state.dungeon, coins: 500 };
    expect(getHomeUpgradeCost(state.home, 'kitchen')).toBe(50);
    const first = applyAction(state, { type: 'home-upgrade', upgradeId: 'kitchen' });
    expect(first.accepted).toBe(true);
    expect(first.state.dungeon.coins).toBe(450);
    expect(first.state.home.upgradeLevels.kitchen).toBe(1);
    expect(getHomeUpgradeCost(first.state.home, 'kitchen')).toBe(80);

    const second = applyAction(first.state, { type: 'home-upgrade', upgradeId: 'kitchen' });
    expect(second.accepted).toBe(true);
    const effects = getHomeEffects(second.state.home);
    expect(effects.feedEffectMultiplier).toBeCloseTo(1.1);
    expect(effects.packSlots).toBe(4);
    expect(effects.mealStatBonus).toBeCloseTo(0.14);
    expect(getHomeUpgradeCost(second.state.home, 'kitchen')).toBe(128);
  });

  it('consumes the prepared meal only after a valid run starts and applies the Kitchen pack limit', () => {
    const state = readyPet();
    state.home = {
      ...state.home,
      upgradeLevels: { ...state.home.upgradeLevels, kitchen: 2 },
      preparedMeal: { stat: 'SPD', bonus: 0.14 },
    };
    const pack = getDungeonData().consumables.slice(0, 4).map((item) => item.id);
    const tooMany = applyAction(state, { type: 'dungeon-start-run', consumables: [...pack, getDungeonData().consumables[4]!.id] });
    expect(tooMany.accepted).toBe(false);
    expect(tooMany.state.home.preparedMeal).toEqual({ stat: 'SPD', bonus: 0.14 });

    const started = applyAction(state, { type: 'dungeon-start-run', consumables: pack });
    expect(started.accepted).toBe(true);
    expect(started.state.dungeon.activeRun?.consumables).toEqual(pack);
    expect(started.state.dungeon.activeRun?.runStatMultipliers.SPD).toBeCloseTo(1.14);
    expect(started.state.home.preparedMeal).toBeNull();
    expect(started.state.dungeon.deepestFloor).toBe(1);
    expect(started.state.records.bestRunFloor).toBe(1);
  });

  it('raises Gym training caps and mini-game rewards without exceeding the new cap', () => {
    const state = readyPet();
    state.level = 10;
    state.training = { ...state.training, ATK: 24 };
    state.home = { ...state.home, upgradeLevels: { ...state.home.upgradeLevels, gym: 2 } };
    const result = applyAction(state, { type: 'mini-game-complete', stat: 'ATK', score: 100 });
    expect(result.accepted).toBe(true);
    expect(result.state.training.ATK).toBe(26);
    expect(result.message).toContain('+2 attack points');
  });

  it('reduces Workshop upgrade/fusion costs and expands gear capacity', () => {
    const upgradeItem = makeItem('discount-upgrade', 'emberfang-pick');
    const workshop = readyPet();
    workshop.home = { ...workshop.home, upgradeLevels: { ...workshop.home.upgradeLevels, workshop: 2 } };
    workshop.equipment = { ...workshop.equipment, inventory: [upgradeItem] };
    workshop.dungeon = { ...workshop.dungeon, scrap: Math.floor(getUpgradeCost(0) * 0.84) };
    const upgraded = applyAction(workshop, { type: 'upgrade-item', instanceId: upgradeItem.instanceId });
    expect(upgraded.accepted).toBe(true);
    expect(upgraded.state.equipment.inventory[0]?.upgradeLevel).toBe(1);
    expect(upgraded.state.dungeon.scrap).toBe(0);
    expect(getHomeEffects(workshop.home).inventoryCapacity).toBe(equipmentRules.inventory.capacity + 10);

    const inputs = [
      makeItem('discount-fuse-a', 'emberfang-pick'),
      makeItem('discount-fuse-b', 'emberfang-pick'),
      makeItem('discount-fuse-c', 'emberfang-pick'),
    ];
    const fusionState = readyPet();
    fusionState.home = { ...fusionState.home, upgradeLevels: { ...fusionState.home.upgradeLevels, workshop: 2 } };
    fusionState.equipment = { ...fusionState.equipment, inventory: inputs };
    fusionState.dungeon = { ...fusionState.dungeon, scrap: Math.floor(equipmentRules.fusion.scrapCostBase * 0.8) };
    const fused = applyAction(fusionState, { type: 'fuse-items', instanceIds: inputs.map((item) => item.instanceId), keepAffixId: null });
    expect(fused.accepted).toBe(true);
    expect(fused.state.dungeon.scrap).toBe(0);
    expect(fused.state.equipment.inventory).toHaveLength(1);
  });

  it('uses Nursery levels to pass more traits and add legacy stats across generations', () => {
    const elder = readyPet();
    elder.stage = 'elder';
    elder.generation = 3;
    elder.level = 20;
    elder.peakLevel = 20;
    elder.evolution = { ...elder.evolution, traitIds: ['fireproof', 'steadfast', 'keen-edge'] };
    elder.home = { ...elder.home, upgradeLevels: { ...elder.home.upgradeLevels, nursery: 3 } };
    const next = completeGeneration(elder);
    expect(next.stage).toBe('egg');
    expect(next.evolution.inheritedTraitIds).toHaveLength(2);
    expect(next.evolution.inheritedTraitId).toBe(next.evolution.inheritedTraitIds[0]);
    expect(next.evolution.baseStatBonus).toBeCloseTo(0.08);
    expect(next.hallOfPets[0]?.generation).toBe(3);
  });

  it('applies Library Dex bonuses and awards achievement currencies/cosmetics once', () => {
    const allForms = getAllForms().map((form) => form.id);
    const base = readyPet();
    base.formDex = allForms;
    const library = {
      ...base,
      home: { ...base.home, upgradeLevels: { ...base.home.upgradeLevels, library: 5 } },
    };
    expect(getHomeEffects(library.home, library.formDex.length).dexStatMultiplier).toBeCloseTo(1.05);
    expect(getEffectiveStats(library).HP).toBeGreaterThan(getEffectiveStats(base).HP);
    expect(getEvolutionWeightHints(library, 3)).toHaveLength(3);

    const neutralWeights = getEvolutionWeightHints(readyPet(), 20);
    const fireFed = readyPet();
    fireFed.evolution = { ...fireFed.evolution, elementMeals: { ...fireFed.evolution.elementMeals, fire: 10 } };
    const fireWeights = getEvolutionWeightHints(fireFed, 20);
    const fireShare = (hints: typeof neutralWeights) => hints.filter((hint) => hint.element === 'fire').reduce((sum, hint) => sum + hint.weight, 0)
      / hints.reduce((sum, hint) => sum + hint.weight, 0);
    expect(fireShare(fireWeights)).toBeGreaterThan(fireShare(neutralWeights));

    const reroll = readyPet();
    const currentFormId = getAllForms()[0]!.id;
    reroll.evolution = { ...reroll.evolution, formId: currentFormId, evolutionStones: 1 };
    const candidates = getEvolutionWeightHints(reroll, 20).filter((hint) => hint.formId !== currentFormId);
    const firstCandidateShare = candidates[0]!.weight / candidates.reduce((sum, hint) => sum + hint.weight, 0);
    let seed = 1;
    while (nextRandom(seed).value >= firstCandidateShare) seed += 1;
    reroll.seed = seed;
    const rerolled = applyAction(reroll, { type: 'use-evolution-stone' });
    expect(rerolled.accepted).toBe(true);
    expect(rerolled.state.evolution.formId).not.toBe(currentFormId);

    const achievementState = readyPet();
    achievementState.formDex = allForms.slice(0, 5);
    achievementState.home = { ...achievementState.home, bossFirstBiomes: ['cinder-copse'], bossClearedFloors: [10] };
    achievementState.dungeon = { ...achievementState.dungeon, deepestFloor: 5 };
    achievementState.equipment = {
      ...achievementState.equipment,
      equipped: {
        ...achievementState.equipment.equipped,
        Weapon: makeItem('achievement-weapon', 'emberfang-pick'),
        Armor: makeItem('achievement-armor', 'coalcap-plate'),
      },
    };
    const firstAward = unlockReadyAchievements(achievementState);
    const unlocked = firstAward.state.home.unlockedAchievementIds;
    expect(unlocked).toContain('first-five-forms');
    expect(unlocked).toContain('depth-five');
    expect(unlocked).toContain('first-boss');
    expect(unlocked).toContain('two-piece-set');
    expect(unlocked).toContain('depth-ten');
    expect(firstAward.state.dungeon.coins).toBe(270);
    expect(firstAward.state.dungeon.essence).toBe(35);
    expect(firstAward.state.home.unlockedCosmeticIds.sort()).toEqual(['ginger-pin', 'moss-lantern']);
    expect(getAchievementStatuses(firstAward.state).filter((status) => status.unlocked)).toHaveLength(5);

    const repeated = unlockReadyAchievements(firstAward.state);
    expect(repeated.unlocked).toEqual([]);
    expect(repeated.state.dungeon.coins).toBe(270);

    const automatic = readyPet();
    automatic.formDex = allForms.slice(0, 5);
    const cooked = applyAction(automatic, { type: 'home-cook-meal', stat: 'ATK' });
    expect(cooked.accepted).toBe(true);
    expect(cooked.state.home.unlockedAchievementIds).toContain('first-five-forms');
    expect(cooked.state.dungeon.coins).toBe(40);
    const repeatedAction = applyAction(cooked.state, { type: 'clean' });
    expect(repeatedAction.state.dungeon.coins).toBe(40);
  });
});
