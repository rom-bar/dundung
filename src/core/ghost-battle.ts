import endlessRules from '../data/endless-rules.json';
import { calculateDamage, getElementMultiplier } from './dungeon';
import { getFormDefinition } from './progression';
import type { PetCodePayload } from './pet-code';

export interface GhostBattleResult {
  winner: 'pocket-pal' | 'ghost' | 'draw';
  turns: number;
  pocketPalHp: number;
  ghostHp: number;
  log: string[];
}

interface Fighter {
  label: string;
  element: PetCodePayload['element'];
  stats: PetCodePayload['stats'];
  hp: number;
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function simulateGhostBattle(pocketPal: PetCodePayload, ghost: PetCodePayload, seed = 1): GhostBattleResult {
  const palForm = getFormDefinition(pocketPal.formId);
  const ghostForm = getFormDefinition(ghost.formId);
  if (!palForm || !ghostForm) throw new Error('Both battle forms must exist in this game.');
  const pal: Fighter = { label: pocketPal.name, element: palForm.element, stats: pocketPal.stats, hp: pocketPal.stats.HP };
  const foe: Fighter = { label: ghost.name, element: ghostForm.element, stats: ghost.stats, hp: ghost.stats.HP };
  const random = makeRandom(seed);
  const variance = endlessRules.ghostBattle.damageVariance;
  const maximumTurns = endlessRules.ghostBattle.maximumTurns;
  const log: string[] = [];
  const order: Array<'pal' | 'ghost'> = pal.stats.SPD >= foe.stats.SPD ? ['pal', 'ghost'] : ['ghost', 'pal'];
  let turns = 0;
  for (; turns < maximumTurns && pal.hp > 0 && foe.hp > 0; turns += 1) {
    for (const actor of order) {
      const attacker = actor === 'pal' ? pal : foe;
      const defender = actor === 'pal' ? foe : pal;
      if (attacker.hp <= 0 || defender.hp <= 0) break;
      const criticalChance = Math.min(0.5, 0.05 + 0.004 * attacker.stats.LUK);
      const critical = random() < criticalChance ? 1.5 : 1;
      const damage = calculateDamage({
        attack: attacker.stats.ATK,
        defense: defender.stats.DEF,
        skillMultiplier: 1,
        elementMultiplier: getElementMultiplier(attacker.element, defender.element),
        critMultiplier: critical,
        randomMultiplier: 1 - variance + random() * variance * 2,
      });
      defender.hp = Math.max(0, defender.hp - damage);
      log.push(`${attacker.label} deals ${damage} damage to ${defender.label}${critical > 1 ? ' (critical)' : ''}.`);
    }
  }
  const winner = pal.hp > 0 && foe.hp <= 0
    ? 'pocket-pal'
    : foe.hp > 0 && pal.hp <= 0
      ? 'ghost'
      : pal.hp === foe.hp
        ? 'draw'
        : pal.hp > foe.hp ? 'pocket-pal' : 'ghost';
  return {
    winner,
    turns: Math.min(maximumTurns, turns),
    pocketPalHp: pal.hp,
    ghostHp: foe.hp,
    log: log.slice(-12),
  };
}
