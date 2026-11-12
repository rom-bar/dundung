export type NeedKey = 'hunger' | 'happiness' | 'energy' | 'hygiene';

export interface Needs {
  hunger: number;
  happiness: number;
  energy: number;
  hygiene: number;
}

export type LifeStage = 'egg' | 'baby';
export type Animation = 'idle' | 'eat' | 'play' | 'clean' | 'sleep' | 'wake';
export type CooldownKey = 'feed' | 'play' | 'clean' | 'sleep';

export interface GameState {
  schemaVersion: 1;
  seed: number;
  stage: LifeStage;
  stageSeconds: number;
  activeSeconds: number;
  needs: Needs;
  signalCooldowns: Record<NeedKey, number>;
  sleeping: boolean;
  paused: boolean;
  cooldowns: Record<CooldownKey, number>;
  animation: Animation;
  animationRemainingSeconds: number;
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
  | { type: 'toggle-sleep' };

export interface ActionResult {
  state: GameState;
  accepted: boolean;
  message: string;
  action?: CooldownKey;
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
