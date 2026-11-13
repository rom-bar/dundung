export type NeedKey = 'hunger' | 'happiness' | 'energy' | 'hygiene';
export type LifeStage = 'egg' | 'baby' | 'teen' | 'adult' | 'elder';
export type Element = 'fire' | 'water' | 'moss' | 'storm' | 'shadow';
export type Archetype = 'tank' | 'striker' | 'trickster' | 'healer';
export type StatKey = 'HP' | 'ATK' | 'DEF' | 'SPD' | 'LUK';
export type TendencyKey = 'play' | 'sleep' | 'fight' | 'training' | 'feedQuality' | 'hygiene';
export type Rarity = 'common' | 'uncommon' | 'rare';
export type ItemRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export type EquipmentSlot = 'Weapon' | 'Armor' | 'Hat' | 'Charm';
export type AutoScrapThreshold = ItemRarity | 'off';

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
  deepestFloor: number;
  inheritedTraitId: string | null;
  inheritedTraitIds?: string[];
}

export interface EquipmentItem {
  instanceId: string;
  templateId: string;
  rarity: ItemRarity;
  ilvl: number;
  upgradeLevel: number;
  rollSeed: number;
  upgradeSeed: number;
  inheritedAffixId: string | null;
}

export interface EquipmentState {
  inventory: EquipmentItem[];
  equipped: Record<EquipmentSlot, EquipmentItem | null>;
  autoScrapThrough: AutoScrapThreshold;
  nextItemId: number;
}

export interface OnHitStatusBonus {
  type: 'burn' | 'stun';
  chance: number;
  amount: number;
  turns: number;
}

export interface EquipmentCombatEffects {
  critChance: number;
  lifesteal: number;
  elementDamage: number;
  foodEffectiveness: number;
  coinFind: number;
  resist: number;
  resistByElement: Record<Element, number>;
  thorns: number;
  onHitStatuses: OnHitStatusBonus[];
}

export interface ShopEquipmentOffer {
  id: string;
  item: EquipmentItem;
  price: number;
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
  inheritedTraitIds: string[];
  baseStatBonus: number;
}

export type DungeonRoomType = 'fight' | 'elite' | 'event' | 'treasure' | 'rest' | 'shop' | 'boss';
export type DungeonPhase = 'choice' | 'tactic' | 'combat' | 'loot' | 'event' | 'treasure' | 'rest' | 'shop' | 'floor-end' | 'summary';
export type CombatStatusType = 'burn' | 'stun' | 'shield' | 'buff';
export type EnemyKind = 'fight' | 'elite' | 'boss';

export interface CombatStatus {
  type: CombatStatusType;
  amount: number;
  turns: number;
  stat?: StatKey;
  multiplier?: number;
}

export interface DungeonEnemyState {
  id: string;
  name: string;
  kind: EnemyKind;
  element: Element;
  skillId: string;
  stats: Stats;
  hp: number;
  maxHp: number;
  gauge: number;
  statuses: CombatStatus[];
  phaseTwoTriggered: boolean;
  phaseTwoSkillId: string | null;
  phaseTwoAttackMultiplier: number;
  coinDrop: { min: number; max: number };
  lootDrops: Array<{ lootId: string; chance: number }>;
}

export interface DungeonRunState {
  generation: number;
  floor: number;
  roomIndex: number;
  biomeId: string;
  petFormId: string;
  petElement: Element;
  phase: DungeonPhase;
  rngSeed: number;
  petStats: Stats;
  runStatMultipliers: Stats;
  coinMultiplier: number;
  petHp: number;
  petMaxHp: number;
  petGauge: number;
  petStatuses: CombatStatus[];
  equipmentEffects: EquipmentCombatEffects;
  enemy: DungeonEnemyState | null;
  roomChoices: DungeonRoomType[];
  currentRoom: DungeonRoomType | null;
  eventId: string | null;
  shopOfferIds: string[];
  shopEquipmentOffers: ShopEquipmentOffer[];
  tacticId: string | null;
  consumables: string[];
  coins: number;
  lootIds: string[];
  pendingItems: EquipmentItem[];
  pendingItem: EquipmentItem | null;
  pendingScrap: number;
  pendingEssence: number;
  combatLog: string[];
  combatElapsedSeconds: number;
  turns: number;
  result: 'left' | 'fainted' | null;
  bankedCoins: number;
  bankedLootCount: number;
  lostLootCount: number;
  bankedItemCount: number;
  lostItemCount: number;
  bankedScrap: number;
  bankedEssence: number;
  lostScrap: number;
  lostEssence: number;
}

export interface DungeonProgress {
  coins: number;
  scrap: number;
  essence: number;
  deepestFloor: number;
  petDeepestFloor: number;
  runsCompleted: number;
  activeRun: DungeonRunState | null;
}

export type HomeUpgradeId = 'kitchen' | 'gym' | 'workshop' | 'nursery' | 'library';

export interface PreparedMeal {
  stat: StatKey;
  bonus: number;
}

export interface HomeProgress {
  upgradeLevels: Record<HomeUpgradeId, number>;
  preparedMeal: PreparedMeal | null;
  unlockedAchievementIds: string[];
  unlockedCosmeticIds: string[];
  bossFirstBiomes: string[];
  bossClearedFloors: number[];
}

export interface GameRecords {
  totalRoomsCleared: number;
  bossesDefeated: number;
  runsLeftSafely: number;
  runsFainted: number;
  bestRunFloor: number;
  totalCoinsBanked: number;
}

export type Animation = 'idle' | 'eat' | 'play' | 'clean' | 'sleep' | 'wake' | 'evolve';
export type CooldownKey = 'feed' | 'play' | 'clean' | 'sleep';
export type ActionLabel = CooldownKey | 'train';

export interface GameState {
  schemaVersion: 5;
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
  dungeon: DungeonProgress;
  equipment: EquipmentState;
  home: HomeProgress;
  records: GameRecords;
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
  | { type: 'use-evolution-stone' }
  | { type: 'home-upgrade'; upgradeId: HomeUpgradeId }
  | { type: 'home-cook-meal'; stat: StatKey }
  | { type: 'dungeon-start-run'; consumables: string[] }
  | { type: 'dungeon-choose-room'; roomType: DungeonRoomType }
  | { type: 'dungeon-choose-tactic'; tacticId: string }
  | { type: 'dungeon-choose-event'; optionId: string }
  | { type: 'dungeon-open-treasure' }
  | { type: 'dungeon-rest' }
  | { type: 'dungeon-buy-consumable'; consumableId: string }
  | { type: 'dungeon-buy-equipment'; offerId: string }
  | { type: 'dungeon-finish-shop' }
  | { type: 'dungeon-resolve-item'; choice: 'take' | 'scrap' | 'leave' }
  | { type: 'dungeon-use-consumable'; slot: number }
  | { type: 'dungeon-descend' }
  | { type: 'dungeon-leave' }
  | { type: 'dungeon-close-summary' }
  | { type: 'equip-item'; instanceId: string }
  | { type: 'unequip-item'; slot: EquipmentSlot }
  | { type: 'scrap-item'; instanceId: string }
  | { type: 'upgrade-item'; instanceId: string }
  | { type: 'fuse-items'; instanceIds: string[]; keepAffixId: string | null }
  | { type: 'set-auto-scrap'; threshold: AutoScrapThreshold }
  | { type: 'craft-evolution-stone' };

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
