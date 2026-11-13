import dungeonEvents from '../data/events.json';
import lootData from '../data/loot.json';
import type { CombatStatus, DungeonRunState, GameState, StageEventPayload } from './types';

const lootNames = new Map(lootData.map((item) => [item.id, item.name]));
const eventTitles = new Map(dungeonEvents.map((item) => [item.id, item.title]));

function appendedLines(previous: string[], next: string[]): string[] {
  const maximumOverlap = Math.min(previous.length, next.length);
  for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
    const previousTail = previous.slice(-overlap);
    if (previousTail.every((line, index) => line === next[index])) return next.slice(overlap);
  }
  return next;
}

function sourceFor(actor: string): 'pet' | 'enemy' {
  return actor === 'Pip' ? 'pet' : 'enemy';
}

function targetFor(actor: string): 'pet' | 'enemy' {
  return actor === 'Pip' ? 'enemy' : 'pet';
}

function addedEntries(previous: string[], next: string[]): string[] {
  const counts = new Map<string, number>();
  previous.forEach((entry) => counts.set(entry, (counts.get(entry) ?? 0) + 1));
  const added: string[] = [];
  next.forEach((entry) => {
    const count = counts.get(entry) ?? 0;
    if (count > 0) counts.set(entry, count - 1);
    else added.push(entry);
  });
  return added;
}

function sameStatus(left: CombatStatus, right: CombatStatus): boolean {
  return left.type === right.type
    && left.stat === right.stat
    && left.amount === right.amount
    && left.multiplier === right.multiplier;
}

function collectLogEvents(oldRun: DungeonRunState, lines: string[]): StageEventPayload[] {
  const result: StageEventPayload[] = [];
  for (const line of lines) {
    const attack = line.match(/^(.+?) uses (.+?) for (\d+)(.*)\.$/);
    if (attack) {
      const actor = attack[1]!;
      const flags = attack[2]!.split(' · ');
      const skill = flags.shift() ?? 'a move';
      const suffix = attack[4] ?? '';
      result.push({
        type: 'attack',
        source: sourceFor(actor),
        target: targetFor(actor),
        actor,
        skill,
        amount: Number(attack[3]),
        critical: flags.includes('critical'),
        strongHit: flags.includes('strong hit'),
        flavor: 'skill',
      });
      const siphon = suffix.match(/siphons (\d+) health/);
      if (siphon) result.push({ type: 'heal', target: 'pet', amount: Number(siphon[1]) });
      continue;
    }

    const burn = line.match(/^(.+?) takes (\d+) burn damage\./);
    if (burn) {
      const target = burn[1] === 'Pip' ? 'pet' : 'enemy';
      result.push({
        type: 'attack',
        source: target === 'pet' ? 'enemy' : 'pet',
        target,
        actor: burn[1]!,
        skill: 'Burn',
        amount: Number(burn[2]),
        critical: false,
        strongHit: false,
        flavor: 'burn',
      });
      continue;
    }

    const thorn = line.match(/^Pip's gear returns (\d+) thorn damage\./);
    if (thorn) {
      result.push({
        type: 'attack',
        source: 'pet',
        target: 'enemy',
        actor: 'Pip',
        skill: 'Thorns',
        amount: Number(thorn[1]),
        critical: false,
        strongHit: false,
        flavor: 'thorn',
      });
      continue;
    }

    const missed = line.match(/^(.+?) is stunned and misses a turn\./);
    if (missed) {
      result.push({ type: 'miss', source: sourceFor(missed[1]!), actor: missed[1]!, reason: 'stunned' });
      continue;
    }
    if (line === 'Pip steadies for a moment.') {
      result.push({ type: 'miss', source: 'pet', actor: 'Pip', reason: 'steady' });
      continue;
    }

    const rest = line.match(/^Pip rests and restores (\d+) health\./);
    const restored = line.match(/^Restored (\d+) health\./);
    const healAmount = Number(rest?.[1] ?? restored?.[1] ?? 0);
    if (healAmount > 0) {
      result.push({ type: 'heal', target: 'pet', amount: healAmount });
      continue;
    }

    if (line.includes('reveals a new move!')) {
      result.push({ type: 'boss_phase', enemyName: oldRun.enemy?.name ?? 'The boss' });
      continue;
    }

    const defeated = line.match(/^(.+?) is defeated\./);
    if (defeated) {
      result.push({ type: 'victory', enemyName: defeated[1]! });
      continue;
    }

    const chest = line.match(/^Treasure opened: \+(\d+) coins( and a token)?\./);
    if (chest) {
      result.push({ type: 'chest_open', coins: Number(chest[1]), tokenFound: Boolean(chest[2]) });
      continue;
    }

    const usedItem = line.match(/^(.+?) used\./);
    if (usedItem) result.push({ type: 'item_used', name: usedItem[1]! });
  }
  return result;
}

function statusEvents(previous: DungeonRunState, next: DungeonRunState): StageEventPayload[] {
  const result: StageEventPayload[] = [];
  const targets = [
    { target: 'pet' as const, before: previous.petStatuses, after: next.petStatuses },
    { target: 'enemy' as const, before: previous.enemy?.statuses ?? [], after: next.enemy?.statuses ?? [] },
  ];
  for (const group of targets) {
    for (const status of group.after) {
      if (!group.before.some((item) => sameStatus(item, status))) {
        if (status.type === 'buff') {
          result.push({
            type: 'buff_applied',
            target: group.target,
            stat: status.stat,
            amount: status.amount,
            multiplier: status.multiplier,
            turns: status.turns,
          });
        } else {
          result.push({ type: 'status_applied', target: group.target, status: status.type, stat: status.stat, turns: status.turns });
        }
      }
    }
  }
  return result;
}

function runLootEvents(previous: DungeonRunState, next: DungeonRunState): StageEventPayload[] {
  const result: StageEventPayload[] = addedEntries(previous.lootIds, next.lootIds).map((id) => ({
    type: 'loot_drop',
    kind: 'token',
    lootId: id,
    name: lootNames.get(id) ?? id,
  }));

  if (!previous.pendingItem && next.pendingItem) {
    result.push({ type: 'loot_drop', kind: 'gear', name: `${next.pendingItem.rarity} gear`, rarity: next.pendingItem.rarity });
  }
  if (next.pendingEssence > previous.pendingEssence) {
    result.push({ type: 'loot_drop', kind: 'essence', amount: next.pendingEssence - previous.pendingEssence, name: 'Essence' });
  }
  if (next.pendingScrap > previous.pendingScrap) {
    result.push({ type: 'loot_drop', kind: 'scrap', amount: next.pendingScrap - previous.pendingScrap, name: 'Scrap' });
  }
  return result;
}

function roomStory(run: DungeonRunState): StageEventPayload | null {
  if (run.phase === 'event') {
    return { type: 'room_story', roomType: 'event', title: eventTitles.get(run.eventId ?? '') ?? 'A small story' };
  }
  if (run.phase === 'treasure') return { type: 'room_story', roomType: 'treasure', title: 'Treasure room' };
  if (run.phase === 'rest') return { type: 'room_story', roomType: 'rest', title: 'Rest stop' };
  if (run.phase === 'shop') return { type: 'room_story', roomType: 'shop', title: 'Traveling shop' };
  return null;
}

/** Derives ordered presentation events from real transitions; it never changes state or consumes RNG. */
export function collectStageEvents(previousState: GameState, nextState: GameState): StageEventPayload[] {
  const events: StageEventPayload[] = [];
  const previous = previousState.dungeon.activeRun;
  const next = nextState.dungeon.activeRun;

  if (!next) {
    if (previous?.phase === 'summary') events.push({ type: 'return_home' });
    return events;
  }

  if (!previous || next.floor > previous.floor || next.roomIndex > previous.roomIndex) {
    events.push({ type: 'walk_start', floor: next.floor, biomeId: next.biomeId });
  }

  if (next.currentRoom && (!previous || previous.currentRoom !== next.currentRoom || previous.roomIndex !== next.roomIndex)) {
    events.push({ type: 'room_enter', floor: next.floor, roomType: next.currentRoom, phase: next.phase });
  }

  if (next.enemy && (!previous?.enemy || previous.enemy.id !== next.enemy.id)) {
    events.push({ type: 'enemy_appear', enemyId: next.enemy.id, name: next.enemy.name, kind: next.enemy.kind, element: next.enemy.element });
    if (next.enemy.kind === 'boss') events.push({ type: 'boss_intro', enemyName: next.enemy.name });
  }

  if (previous?.phase === 'tactic' && next.phase === 'combat' && next.enemy) {
    events.push({ type: 'combat_start', enemyName: next.enemy.name });
  }

  const story = previous && previous.phase !== next.phase ? roomStory(next) : (!previous ? roomStory(next) : null);
  if (story) events.push(story);

  if (previous) {
    const logEvents = collectLogEvents(previous, appendedLines(previous.combatLog, next.combatLog));
    events.push(...logEvents);

    const hpDelta = Math.round(next.petHp - previous.petHp);
    const explicitHeal = logEvents.some((event) => event.type === 'heal');
    const explicitPetDamage = logEvents.some((event) => event.type === 'attack' && event.target === 'pet');
    if (hpDelta > 0 && !explicitHeal) events.push({ type: 'heal', target: 'pet', amount: hpDelta });
    if (hpDelta < 0 && !explicitPetDamage) {
      events.push({
        type: 'attack', source: 'environment', target: 'pet', actor: 'The path', skill: 'A rough patch',
        amount: Math.abs(hpDelta), critical: false, strongHit: false, flavor: 'environment',
      });
    }

    events.push(...statusEvents(previous, next));
    events.push(...runLootEvents(previous, next));
  }

  if (next.phase === 'floor-end' && previous?.phase !== 'floor-end') {
    events.push({ type: 'floor_cleared', floor: next.floor });
  }
  if (next.phase === 'summary' && previous?.phase !== 'summary') {
    if (next.result === 'fainted') events.push({ type: 'faint', floor: next.floor });
    else events.push({ type: 'run_complete', result: 'left', floor: next.floor });
  }

  return events;
}
