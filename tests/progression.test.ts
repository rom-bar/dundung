import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState } from '../src/core/game';
import {
  awardTraining,
  awardXp,
  completeGeneration,
  emptyEvolution,
  evolveForStage,
  getAllForms,
  getEffectiveStats,
  getFormDefinition,
  getTraitList,
  grantEvolutionStone,
  pointsForMiniGameScore,
  recordFoodElement,
  rerollWithEvolutionStone,
  updateTendency,
  xpToNextLevel,
} from '../src/core/progression';
import type { GameState } from '../src/core/types';

function stateWithForm(formId = 'fire-emberguard'): GameState {
  const initial = createInitialState(808);
  return {
    ...initial,
    stage: 'baby',
    evolution: { ...emptyEvolution(), formId, traitIds: ['steadfast'] },
    formDex: [formId],
  };
}

describe('life-stage progression and stats', () => {
  it('defines 20 unique forms across five elements, four archetypes, and three rarities', () => {
    const forms = getAllForms();
    expect(forms).toHaveLength(20);
    expect(new Set(forms.map((form) => form.id)).size).toBe(20);
    expect(new Set(forms.map((form) => form.element))).toEqual(new Set(['fire', 'water', 'moss', 'storm', 'shadow']));
    expect(new Set(forms.map((form) => form.archetype))).toEqual(new Set(['tank', 'striker', 'trickster', 'healer']));
    expect(forms.filter((form) => form.rarity === 'rare')).toHaveLength(2);
  });

  it('awards care XP and updates food, play, and hygiene tendencies', () => {
    const fed = applyAction(createInitialState(9), { type: 'feed', foodId: 'moonberry-jam' });
    expect(fed.state.xp).toBe(2);
    expect(fed.state.tendencies.feedQuality).toBeCloseTo(0.013);
    expect(fed.state.evolution.elementMeals.fire).toBe(1);

    const played = applyAction({ ...fed.state, cooldowns: { ...fed.state.cooldowns, play: 0 } }, { type: 'play' });
    expect(played.state.xp).toBe(5);
    expect(played.state.tendencies.play).toBeCloseTo(0.02);

    const cleaned = applyAction({ ...played.state, cooldowns: { ...played.state.cooldowns, clean: 0 } }, { type: 'clean' });
    expect(cleaned.state.xp).toBe(7);
    expect(cleaned.state.tendencies.hygiene).toBeCloseTo(0.02);
  });

  it('uses the documented base + level growth + training formula and form multipliers', () => {
    const initial = stateWithForm();
    const atLevelOne = getEffectiveStats(initial);
    expect(atLevelOne.HP).toBe(43); // floor(((30 + 4) * tank 1.2) + steadfast 3)
    expect(atLevelOne.DEF).toBeGreaterThan(8);

    const trained = { ...initial, level: 3, training: { ...initial.training, HP: 4, ATK: 2 } };
    const atLevelThree = getEffectiveStats(trained);
    expect(atLevelThree.HP).toBeGreaterThan(atLevelOne.HP);
    expect(atLevelThree.ATK).toBeGreaterThan(atLevelOne.ATK);
  });

  it('applies stage caps, XP progression, and a per-stat training cap', () => {
    const state = createInitialState(12);
    expect(xpToNextLevel(1)).toBe(20);
    const leveled = awardXp(state, 20);
    expect(leveled.level).toBe(2);
    expect(leveled.xp).toBe(0);
    expect(leveled.peakLevel).toBe(2);

    const capped = awardTraining(leveled, 'HP', 9);
    expect(capped.awarded).toBe(4);
    expect(capped.state.training.HP).toBe(4);
    expect(awardTraining(capped.state, 'HP', 1).awarded).toBe(0);
  });

  it('maps mini-game score bands to points and enforces cooldown and training caps', () => {
    expect([0, 24, 25, 55, 85, 130].map(pointsForMiniGameScore)).toEqual([0, 0, 1, 2, 3, 3]);
    const state = { ...createInitialState(15), stage: 'baby' as const };
    const result = applyAction(state, { type: 'mini-game-complete', stat: 'LUK', score: 100 });
    expect(result.accepted).toBe(true);
    expect(result.state.training.LUK).toBe(2);
    expect(result.state.tendencies.training).toBeCloseTo(0.02);
    expect(result.state.miniGameCooldownSeconds).toBe(45);
    expect(applyAction(result.state, { type: 'mini-game-complete', stat: 'LUK', score: 100 }).accepted).toBe(false);

    const atCap = { ...result.state, miniGameCooldownSeconds: 0 };
    const noMorePoints = applyAction(atCap, { type: 'mini-game-complete', stat: 'LUK', score: 100 });
    expect(noMorePoints.accepted).toBe(true);
    expect(noMorePoints.state.training.LUK).toBe(2);
  });

  it('rejects training before hatch or while asleep', () => {
    expect(applyAction(createInitialState(), { type: 'mini-game-complete', stat: 'HP', score: 70 }).accepted).toBe(false);
    const sleeping = { ...createInitialState(), stage: 'baby' as const, sleeping: true };
    expect(applyAction(sleeping, { type: 'mini-game-complete', stat: 'HP', score: 70 }).accepted).toBe(false);
  });

  it('produces deterministic forms, traits, mutation rolls, and RNG state for the same seed', () => {
    const initial = { ...createInitialState(12345), stage: 'baby' as const };
    const first = evolveForStage(initial);
    const second = evolveForStage(initial);
    expect(first.evolution).toEqual(second.evolution);
    expect(first.seed).toBe(second.seed);
    expect(first.formDex).toEqual([first.evolution.formId]);
    expect(getFormDefinition(first.evolution.formId)).not.toBeNull();
    expect(first.animation).toBe('evolve');
  });

  it('responds to elemental meal tags and maintains rare-form pity', () => {
    const sampleRareCount = (rareMisses: number) => Array.from({ length: 500 }, (_, index) => {
      const state = {
        ...createInitialState(index + 1),
        stage: 'baby' as const,
        evolution: { ...emptyEvolution(), rareMisses },
      };
      return getFormDefinition(evolveForStage(state).evolution.formId)?.rarity === 'rare' ? 1 : 0;
    }).reduce<number>((sum, value) => sum + value, 0);
    expect(sampleRareCount(60)).toBeGreaterThan(sampleRareCount(0));

    const fireBiasedCount = (meals: number) => Array.from({ length: 500 }, (_, index) => {
      const state = {
        ...createInitialState(index + 1001),
        stage: 'baby' as const,
        evolution: { ...emptyEvolution(), elementMeals: { fire: meals, water: 0, moss: 0, storm: 0, shadow: 0 } },
      };
      return getFormDefinition(evolveForStage(state).evolution.formId)?.element === 'fire' ? 1 : 0;
    }).reduce<number>((sum, value) => sum + value, 0);
    expect(fireBiasedCount(12)).toBeGreaterThan(fireBiasedCount(0));
  });

  it('raises mutation chance with pity, caps it at 10%, and applies drawbacks about half the time', () => {
    const sample = (rareMisses: number) => Array.from({ length: 2_000 }, (_, index) => {
      const state = {
        ...createInitialState(index + 1),
        stage: 'baby' as const,
        evolution: { ...emptyEvolution(), rareMisses },
      };
      const mutation = evolveForStage(state).evolution;
      return { mutation: mutation.mutationTraitId !== null, drawback: mutation.drawbackTraitId !== null };
    }).reduce((totals, result) => ({
      mutations: totals.mutations + Number(result.mutation),
      drawbacks: totals.drawbacks + Number(result.drawback),
    }), { mutations: 0, drawbacks: 0 });
    const base = sample(0);
    const pity = sample(20);
    const aboveCap = sample(1_000);
    expect(pity.mutations).toBeGreaterThan(base.mutations);
    expect(aboveCap.mutations).toBe(pity.mutations);
    expect(pity.drawbacks / pity.mutations).toBeGreaterThan(0.35);
    expect(pity.drawbacks / pity.mutations).toBeLessThan(0.65);
  });

  it('tracks a per-stage tendency EMA and supports an Evolution Stone reroll', () => {
    let state = createInitialState(99);
    state = updateTendency(state, 'play');
    state = updateTendency(state, 'play');
    expect(state.tendencies.play).toBeCloseTo(0.0396);
    state = evolveForStage({ ...state, stage: 'baby' });
    const oldForm = state.evolution.formId;
    state = grantEvolutionStone(state);
    const rerolled = rerollWithEvolutionStone(state);
    expect(rerolled.evolution.evolutionStones).toBe(0);
    expect(rerolled.evolution.formId).not.toBeNull();
    expect(rerolled.evolution.formId).not.toBe(oldForm);
    expect(rerolled.formDex).toContain(oldForm);
    expect(rerolled.formDex).toContain(rerolled.evolution.formId);
  });

  it('carries one non-drawback trait and a small base-stat bonus into the next generation', () => {
    const parent = {
      ...stateWithForm(),
      stage: 'elder' as const,
      generation: 4,
      generationSeconds: 12_345,
      level: 40,
      peakLevel: 40,
      evolution: {
        ...stateWithForm().evolution,
        mutationTraitId: 'iron-will',
        drawbackTraitId: 'heavy-burden',
        rareMisses: 7,
        evolutionStones: 2,
      },
    };
    const child = completeGeneration(parent);
    expect(child.stage).toBe('egg');
    expect(child.generation).toBe(5);
    expect(child.generationSeconds).toBe(0);
    expect(child.level).toBe(1);
    expect(child.evolution.baseStatBonus).toBeCloseTo(0.05);
    expect(child.evolution.evolutionStones).toBe(2);
    expect(child.evolution.rareMisses).toBe(7);
    expect(child.evolution.inheritedTraitId).not.toBe('heavy-burden');
    expect(getTraitList(child).some((trait) => trait.id === child.evolution.inheritedTraitId)).toBe(child.evolution.inheritedTraitId !== null);
    expect(child.hallOfPets[0]?.generation).toBe(4);
    expect(child.hallOfPets[0]?.formId).toBe('fire-emberguard');
  });

  it('accepts only recognized food-element tags for evolution bias', () => {
    const state = recordFoodElement(createInitialState(3), ['comfort', 'element:shadow']);
    expect(state.evolution.elementMeals.shadow).toBe(1);
    expect(state.evolution.elementMeals.fire).toBe(0);
    const withoutTag = recordFoodElement(state, ['fresh']);
    expect(withoutTag).toBe(state);
  });
});
