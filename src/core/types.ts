export type NeedKey = 'hunger' | 'happiness' | 'energy' | 'hygiene';
export type LifeStage = 'egg' | 'baby' | 'teen' | 'adult' | 'elder';
export type Element = 'fire' | 'water' | 'moss' | 'storm' | 'shadow';
export type Archetype = 'tank' | 'striker' | 'trickster' | 'healer';
export type StatKey = 'HP' | 'ATK' | 'DEF' | 'SPD' | 'LUK';
export type TendencyKey = 'play' | 'sleep' | 'fight' | 'training' | 'feedQuality' | 'hygiene';
export type Rarity = 'common' | 'uncommon' | 'rare';

export interface Needs {
  hunger: number;
  happiness: number;
  energy: number;
  hygiene: number;
}

export interface Tendencies {
  play: number;
  sleep: number;
  fight: number;
  training: number;
  feedQuality: number;
  hygiene: number;
}

export interface Stats {
  HP: number;
  ATK: number;
  DEF: number;
  SPD: number;
  LUK: number;
}

export interface FormDefinition {
  id: string;
  name: string;
  element: Element;
  archetype: Archetype;
  rarity: Rarity;
}

export interface PetRecord {
  generation: number;
  name: string;
  formId: string | null;
  peakLevel: number;
  activeSeconds: number;
  inheritedTraitId: string | null;
}

export interface EvolutionProgress {
  formId: string | null;
  traitIds: string[];
  mutationTraitId: string | null;
  drawbackTraitId: string | null;
  rareMisses: number;
  evolutionStones: number;
  elementMeals: Record<Element, number>;
  inheritedTraitId: string | null;
  baseStatBonus: number;
}

export type Animation = 'idle' | 'eat' | 'play' | 'clean' | 'sleep' | 'wake' | 'evolve';
export type CooldownKey = 'feed' | 'play' | 'clean' | 'sleep';
export type ActionLabel = CooldownKey | 'train';

export interface GameState {
  schemaVersion: 2;
  seed: number;
  stage: LifeStage;
  stageSeconds: number;
  activeSeconds: number;
  generationSeconds: number;
  needs: Needs;
  signalCooldowns: Record<NeedKey, number>;
  sleeping: boolean;
  paused: boolean;
  cooldowns: Record<CooldownKey, number>;
  animation: Animation;
  animationRemainingSeconds: number;
  generation: number;
  level: number;
  xp: number;
  training: Stats;
  tendencies: Tendencies;
  evolution: EvolutionProgress;
  formDex: string[];
  hallOfPets: PetRecord[];
  miniGameCooldownSeconds: number;
  peakLevel: number;
}

export interface Food {
  id: string;
  name: string;
  description: string;
  hunger: number;
  happiness: number;
  energy: number;
  hygiene: number;
  tags: string[];
}

export type GameAction =
  | { type: 'feed'; foodId: string }
  | { type: 'play' }
  | { type: 'clean' }
  | { type: 'toggle-sleep' }
  | { type: 'mini-game-complete'; stat: StatKey; score: number }
  | { type: 'use-evolution-stone' };

export interface ActionResult {
  state: GameState;
  accepted: boolean;
  message: string;
  action?: ActionLabel;
}

export type WorkerInMessage =
  | { type: 'load'; state: GameState; startPaused: boolean }
  | { type: 'tick'; dtMs: number }
  | { type: 'action'; action: GameAction }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'save'; requestId: number };

export type WorkerOutMessage =
  | { type: 'snapshot'; state: GameState }
  | { type: 'action-result'; result: Omit<ActionResult, 'state'> }
  | { type: 'signals'; needs: NeedKey[] }
  | { type: 'save'; requestId: number; state: GameState };
