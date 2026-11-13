#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const trialCount = Math.max(1, Number.parseInt(process.argv[2] ?? '2000', 10) || 2000);
const sessionOneBankFloor = 9;
const maxFloor = 40;
const maxStepsPerRun = 80_000;
const pack = ['peppy-potion', 'brave-biscuit', 'snug-snack'];
const events = JSON.parse(await readFile(resolve(root, 'src/data/events.json'), 'utf8'));
const vite = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { advance, applyAction, createInitialState } = await vite.ssrLoadModule('/src/core/game.ts');
  const { getEffectiveStats } = await vite.ssrLoadModule('/src/core/progression.ts');

  function act(state, action) {
    const result = applyAction(state, action);
    if (!result.accepted) throw new Error(`Rejected ${action.type}: ${result.message}`);
    return result.state;
  }

  function hatchFreshPet(seed) {
    let state = createInitialState(seed);
    for (let tick = 0; tick < 600; tick += 1) state = advance(state, 100);
    if (state.stage !== 'baby' || !state.evolution.formId) {
      throw new Error(`Seed ${seed} did not hatch into a form.`);
    }
    return state;
  }

  function expectedEffectScore(effect, run) {
    switch (effect.type) {
      case 'heal':
        return Math.min(run.petMaxHp - run.petHp, run.petMaxHp * (effect.percent ?? 0) / 100) * 1.4;
      case 'damage':
        return -run.petMaxHp * (effect.percent ?? 0) / 100 * 1.4;
      case 'coins':
        return ((effect.min ?? 0) + (effect.max ?? effect.min ?? 0)) / 2 * 0.25;
      case 'loot':
        return 2.5;
      case 'consumable':
        return effect.consumableId === 'peppy-potion' ? 5 : 2;
      case 'buff':
        return effect.stat === 'ATK' ? 4 : effect.stat === 'DEF' ? 3.5 : 2.5;
      case 'run-stat':
        return effect.stat === 'HP' && (effect.multiplier ?? 1) < 1 ? -5 : 3;
      case 'coin-multiplier':
        return ((effect.multiplier ?? 1) - 1) * 5;
      default:
        return 0;
    }
  }

  function eventOptionScore(option, run) {
    const success = option.success.reduce((sum, effect) => sum + expectedEffectScore(effect, run), 0);
    const failure = option.failure.reduce((sum, effect) => sum + expectedEffectScore(effect, run), 0);
    return option.successChance * success + (1 - option.successChance) * failure;
  }

  function chooseRoom(run) {
    const choices = run.roomChoices;
    const health = run.petHp / run.petMaxHp;
    if (health < 0.72 && choices.includes('rest')) return 'rest';
    if (health < 0.56 && choices.includes('event')) return 'event';
    if (health < 0.5 && choices.includes('shop')) return 'shop';
    if (choices.includes('fight')) return 'fight';
    if (choices.includes('treasure')) return 'treasure';
    if (choices.includes('event')) return 'event';
    if (choices.includes('rest')) return 'rest';
    if (choices.includes('shop')) return 'shop';
    if (choices.includes('elite')) return health > 0.8 ? 'elite' : 'fight';
    return choices[0];
  }

  function useNeededItems(state) {
    let run = state.dungeon.activeRun;
    if (!run || run.phase === 'summary') return state;
    const health = run.petHp / run.petMaxHp;
    if (health <= 0.68) {
      const healSlot = run.consumables.indexOf('peppy-potion');
      if (healSlot >= 0) return act(state, { type: 'dungeon-use-consumable', slot: healSlot });
    }
    if (run.phase === 'tactic' && run.floor % 10 === 0) {
      const defenseSlot = run.consumables.indexOf('snug-snack');
      if (defenseSlot >= 0) return act(state, { type: 'dungeon-use-consumable', slot: defenseSlot });
      const attackSlot = run.consumables.indexOf('brave-biscuit');
      if (attackSlot >= 0) return act(state, { type: 'dungeon-use-consumable', slot: attackSlot });
    }
    return state;
  }

  function runSession(state, sessionNumber) {
    state = act(state, { type: 'dungeon-start-run', consumables: pack, mode: 'standard' });
    let highestFloor = 1;
    let bossCleared = false;
    let steps = 0;

    while (steps < maxStepsPerRun) {
      let run = state.dungeon.activeRun;
      if (!run || run.phase === 'summary') break;
      highestFloor = Math.max(highestFloor, run.floor);
      if (run.phase === 'floor-end') {
        if (run.floor % 10 === 0) bossCleared = true;
        if ((sessionNumber === 1 && run.floor >= sessionOneBankFloor) || run.floor >= maxFloor) {
          state = act(state, { type: 'dungeon-leave' });
          continue;
        }
        state = act(state, { type: 'dungeon-descend' });
        continue;
      }

      const beforeItems = run.consumables.length;
      state = useNeededItems(state);
      run = state.dungeon.activeRun;
      if (!run || run.phase === 'summary') break;
      if (run.consumables.length < beforeItems) continue;

      if (run.phase === 'choice') {
        state = act(state, { type: 'dungeon-choose-room', roomType: chooseRoom(run) });
      } else if (run.phase === 'tactic') {
        const tacticId = run.floor % 10 === 0 || run.petHp / run.petMaxHp < 0.55 ? 'guard' : 'all-in';
        state = act(state, { type: 'dungeon-choose-tactic', tacticId });
      } else if (run.phase === 'combat') {
        state = advance(state, 100);
        steps += 1;
        continue;
      } else if (run.phase === 'event') {
        const event = events.find((entry) => entry.id === run.eventId);
        if (!event?.options.length) throw new Error(`Missing event data for ${run.eventId}.`);
        const option = [...event.options].sort((left, right) => eventOptionScore(right, run) - eventOptionScore(left, run))[0];
        state = act(state, { type: 'dungeon-choose-event', optionId: option.id });
      } else if (run.phase === 'treasure') {
        state = act(state, { type: 'dungeon-open-treasure' });
      } else if (run.phase === 'rest') {
        state = act(state, { type: 'dungeon-rest' });
      } else if (run.phase === 'shop') {
        const healAvailable = run.shopOfferIds.includes('peppy-potion') && run.coins >= 5 && run.consumables.length < 3;
        state = healAvailable
          ? act(state, { type: 'dungeon-buy-consumable', consumableId: 'peppy-potion' })
          : act(state, { type: 'dungeon-finish-shop' });
      } else if (run.phase === 'loot') {
        state = act(state, { type: 'dungeon-resolve-item', choice: 'take' });
      } else {
        throw new Error(`Unhandled dungeon phase: ${run.phase}`);
      }

      run = state.dungeon.activeRun;
      if (run && run.phase === 'floor-end' && run.floor % 10 === 0) bossCleared = true;
      steps += 1;
    }

    const finalRun = state.dungeon.activeRun;
    if (steps >= maxStepsPerRun && finalRun?.phase !== 'summary') {
      throw new Error(`Seed ${state.seed} exceeded the run step limit on floor ${finalRun?.floor}.`);
    }
    return {
      state,
      highestFloor: Math.max(highestFloor, finalRun?.floor ?? 1),
      bossCleared,
      result: finalRun?.result ?? 'unknown',
      steps,
    };
  }

  function closeSummary(state) {
    if (state.dungeon.activeRun?.phase === 'summary') return act(state, { type: 'dungeon-close-summary' });
    return state;
  }

  function prepareBetweenSessions(state) {
    return {
      ...state,
      paused: false,
      sleeping: false,
      needs: { hunger: 90, happiness: 90, energy: 90, hygiene: 90 },
      cooldowns: { feed: 0, play: 0, clean: 0, sleep: 0 },
      animation: 'idle',
      animationRemainingSeconds: 0,
    };
  }

  function gearScore(stats) {
    return stats.HP + stats.ATK * 1.5 + stats.DEF * 1.2 + stats.SPD * 1.1 + stats.LUK * 0.2;
  }

  function equipBestGear(state) {
    let changed = true;
    while (changed) {
      changed = false;
      const currentScore = gearScore(getEffectiveStats(state));
      let bestState = state;
      let bestScore = currentScore;
      for (const item of state.equipment.inventory) {
        const result = applyAction(state, { type: 'equip-item', instanceId: item.instanceId });
        if (!result.accepted) continue;
        const score = gearScore(getEffectiveStats(result.state));
        if (score > bestScore) {
          bestState = result.state;
          bestScore = score;
        }
      }
      if (bestState !== state) {
        state = bestState;
        changed = true;
      }
    }
    return state;
  }

  const results = [];
  for (let index = 0; index < trialCount; index += 1) {
    const seed = index + 1;
    let state = hatchFreshPet(seed);
    const first = runSession(state, 1);
    state = equipBestGear(prepareBetweenSessions(closeSummary(first.state)));
    const secondStartLevel = state.level;
    const equippedSlots = Object.values(state.equipment.equipped).filter(Boolean).length;
    const second = runSession(state, 2);
    results.push({
      seed,
      formId: first.state.evolution.formId,
      sessionOneFloor: first.highestFloor,
      sessionOneResult: first.result,
      levelAtSecondStart: secondStartLevel,
      equippedSlotsAtSecondStart: equippedSlots,
      sessionTwoFloor: second.highestFloor,
      sessionTwoResult: second.result,
      firstBossCleared: first.bossCleared || second.bossCleared,
      secondRunSteps: second.steps,
    });
    if ((index + 1) % 250 === 0) console.log(`Simulated ${index + 1}/${trialCount} two-session fresh-pet trials.`);
  }

  const floors = results.map((result) => result.sessionTwoFloor).sort((left, right) => left - right);
  const firstSessionFloors = results.map((result) => result.sessionOneFloor).sort((left, right) => left - right);
  const percentile = (fraction) => floors[Math.min(floors.length - 1, Math.floor((floors.length - 1) * fraction))] ?? 0;
  const firstSessionPercentile = (fraction) => firstSessionFloors[Math.min(firstSessionFloors.length - 1, Math.floor((firstSessionFloors.length - 1) * fraction))] ?? 0;
  const reachRates = Object.fromEntries([5, 10, 15, 20, 25].map((floor) => [floor, results.filter((result) => result.sessionTwoFloor >= floor).length / trialCount]));
  const bossRate = results.filter((result) => result.firstBossCleared).length / trialCount;
  const meanSteps = results.reduce((sum, result) => sum + result.secondRunSteps, 0) / trialCount;
  const summary = {
    trials: trialCount,
    seedRange: [1, trialCount],
    simulatedFreshPet: 'Actual egg-to-baby hatch through the game engine; randomized form and traits; level 1; no gear or Home upgrades.',
    strategy: `Three-item pack (${pack.join(', ')}); prefers rest below 72% HP, favors fights/treasure when healthy, uses the heal at or below 68%, guards bosses, equips stat-improving gear from session one, and banks session one at floor ${sessionOneBankFloor}; session two continues until faint or floor ${maxFloor}. Between sessions, needs are reset to 90% to represent ordinary care.`,
    firstBossEncounteredWithinTwoSessions: results.filter((result) => result.sessionOneFloor >= 10 || result.sessionTwoFloor >= 10).length / trialCount,
    firstBossClearedWithinTwoSessions: bossRate,
    medianLevelAtSecondStart: [...results.map((result) => result.levelAtSecondStart)].sort((left, right) => left - right)[Math.floor((trialCount - 1) / 2)],
    firstSessionSafelyBanked: results.filter((result) => result.sessionOneResult === 'left').length / trialCount,
    firstSessionMaxFloor: {
      p10: firstSessionPercentile(0.1),
      median: firstSessionPercentile(0.5),
      p90: firstSessionPercentile(0.9),
    },
    secondSessionMaxFloor: {
      p10: percentile(0.1),
      p25: percentile(0.25),
      median: percentile(0.5),
      p75: percentile(0.75),
      p90: percentile(0.9),
    },
    secondSessionReachRate: reachRates,
    meanSecondSessionSteps: Math.round(meanSteps),
  };

  console.log('\nBalance simulation summary');
  console.log(JSON.stringify(summary, null, 2));
  if (trialCount <= 20) console.log('\nSample outcomes\n' + JSON.stringify(results, null, 2));
  if (summary.firstBossEncounteredWithinTwoSessions < 0.95 || bossRate < 0.5 || summary.secondSessionMaxFloor.median < 15 || summary.secondSessionMaxFloor.median > 20) {
    process.exitCode = 2;
  }
} finally {
  await vite.close();
}
