import { describe, expect, it } from 'vitest';
import {
  applyEndlessAction,
  createEndlessProgress,
  getAscensionMilestone,
  getBestiaryCoinMultiplier,
  getCurrentUtcDateKey,
  getDailySeed,
  getEndlessRunEffects,
  recordBestiaryDefeat,
  recordEndlessFloor,
  sanitizeEndlessProgress,
} from '../src/core/endless';
import { applyAction, createInitialState } from '../src/core/game';
import { getDungeonData } from '../src/core/dungeon';

function grownState() {
  const state = createInitialState(44);
  return {
    ...state,
    stage: 'adult' as const,
    evolution: { ...state.evolution, formId: 'fire-emberguard' },
    formDex: ['fire-emberguard'],
  };
}

describe('Endless progression', () => {
  it('uses a stable per-date seed and rolls the attempt key at UTC midnight', () => {
    expect(getDailySeed('2026-11-13')).toBe(getDailySeed('2026-11-13'));
    expect(getDailySeed('2026-11-13')).not.toBe(getDailySeed('2026-11-14'));
    expect(getCurrentUtcDateKey(new Date('2026-11-13T00:30:00+07:00'))).toBe('2026-11-12');
    expect(() => getDailySeed('2026-02-30')).toThrow('valid UTC date');
  });

  it('sanitizes malformed dates, unknown ids, duplicate discoveries and excessive ranks', () => {
    expect(sanitizeEndlessProgress({
      dailyAttemptDate: '2026-02-30',
      dailyBestFloor: 1e12,
      ascensionRank: 500,
      bestFloorSinceAscension: -5,
      ascensionPerks: { vitality: 99, fortune: -2, 'keen-eye': 3 },
      selectedModifierIds: ['ironhide', 'ironhide', 'made-up'],
      defeatedEnemyIds: ['cinder-sprout', 'cinder-sprout', 'made-up'],
    })).toEqual({
      dailyAttemptDate: null,
      dailyBestFloor: 1_000_000,
      dailyBestDate: null,
      ascensionRank: 5,
      bestFloorSinceAscension: 0,
      ascensionPerks: { vitality: 5, fortune: 0, 'keen-eye': 3 },
      selectedModifierIds: ['ironhide'],
      defeatedEnemyIds: ['cinder-sprout'],
    });
  });

  it('applies challenge, ascension, perk and Bestiary effects only to the run snapshot', () => {
    const enemies = getDungeonData().enemies;
    const progress = {
      ...createEndlessProgress(),
      ascensionRank: 2,
      ascensionPerks: { vitality: 1, fortune: 1, 'keen-eye': 1 },
      defeatedEnemyIds: enemies.slice(0, 5).map((enemy) => enemy.id),
    };
    const standard = getEndlessRunEffects(progress, ['ironhide'], 'standard');
    expect(standard.challengeEffects.enemyStatsMultiplier).toBeCloseTo(1.12);
    expect(standard.challengeEffects.enemyHpMultiplier).toBe(1.25);
    expect(standard.challengeEffects.maxHpMultiplier).toBeCloseTo(1.04);
    expect(standard.challengeEffects.rarityLuckBonus).toBe(15);
    expect(standard.coinMultiplier).toBeCloseTo(1.08 * 1.05 * 1.2 * 1.02);

    const daily = getEndlessRunEffects(progress, ['ironhide'], 'daily');
    expect(daily.challengeEffects.enemyHpMultiplier).toBe(1);
    expect(daily.coinMultiplier).toBeCloseTo(1.08 * 1.05 * 1.02);
  });

  it('awards bounded, cumulative Bestiary coin bonuses for unique enemy discoveries', () => {
    const ids = getDungeonData().enemies.slice(0, 10).map((enemy) => enemy.id);
    expect(getBestiaryCoinMultiplier(ids.slice(0, 4))).toBe(1);
    expect(getBestiaryCoinMultiplier(ids.slice(0, 5))).toBeCloseTo(1.02);
    expect(getBestiaryCoinMultiplier(ids)).toBeCloseTo(1.02 * 1.02);
    const initial = createEndlessProgress();
    expect(recordBestiaryDefeat(initial, 'not-a-real-enemy')).toBe(initial);
    const discovered = recordBestiaryDefeat(initial, ids[0]!);
    expect(recordBestiaryDefeat(discovered, ids[0]!)).toBe(discovered);
  });

  it('records Daily and ascension best floors without overwriting older daily bests', () => {
    const initial = createEndlessProgress();
    const first = recordEndlessFloor(initial, 8, { mode: 'daily', dailyDateKey: '2026-11-13' });
    expect(first.dailyBestFloor).toBe(8);
    expect(first.dailyBestDate).toBe('2026-11-13');
    expect(first.bestFloorSinceAscension).toBe(8);
    const lower = recordEndlessFloor(first, 4, { mode: 'daily', dailyDateKey: '2026-11-14' });
    expect(lower.dailyBestFloor).toBe(8);
    expect(lower.dailyBestDate).toBe('2026-11-13');
    expect(lower.bestFloorSinceAscension).toBe(8);
  });

  it('requires each ascension milestone, resets the milestone counter and keeps perks permanent', () => {
    let state = grownState();
    expect(getAscensionMilestone(0)).toBe(20);
    expect(getAscensionMilestone(1)).toBe(25);
    expect(applyEndlessAction(state, { type: 'endless-ascend', perkId: 'vitality' })?.accepted).toBe(false);
    state = { ...state, endless: { ...state.endless, bestFloorSinceAscension: 20 } };
    const ascended = applyEndlessAction(state, { type: 'endless-ascend', perkId: 'vitality' });
    expect(ascended?.accepted).toBe(true);
    expect(ascended?.state.endless).toMatchObject({ ascensionRank: 1, bestFloorSinceAscension: 0 });
    expect(ascended?.state.endless.ascensionPerks.vitality).toBe(1);
    expect(ascended?.message).toContain('lifetime records stay safe');
  });

  it('validates modifier limits and prevents changes during a run', () => {
    const state = grownState();
    const tooMany = applyAction(state, { type: 'endless-set-modifiers', modifierIds: ['ironhide', 'quickstep', 'hardbite', 'curio'] });
    expect(tooMany.accepted).toBe(false);
    const changed = applyAction(state, { type: 'endless-set-modifiers', modifierIds: ['ironhide', 'curio'] });
    expect(changed.accepted).toBe(true);
    expect(changed.state.endless.selectedModifierIds).toEqual(['ironhide', 'curio']);
    const run = applyAction(state, { type: 'dungeon-start-run', consumables: [] });
    const blocked = applyAction(run.state, { type: 'endless-set-modifiers', modifierIds: [] });
    expect(blocked.accepted).toBe(false);
  });
});
