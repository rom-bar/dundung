import rules from './data/rules.json';
import endlessRules from './data/endless-rules.json';
import foods from './data/foods.json';
import { createInitialState, getMood, getNeedSignals } from './core/game';
import type { GameAction, GameState, HomeUpgradeId, NeedKey, StageVisualEvent, StatKey, WorkerOutMessage } from './core/types';
import { getStageSceneKind, StageSceneRenderer, stageCaption, stageLocation } from './render/stage/scene';
import { StageEventPlayer, stageEventCaption, type AnimationSpeed } from './render/stage/event-player';
import { PhaserStageAdapter } from './render/stage/phaser-stage';
import type { NativeStagePreviewName } from './render/stage/native-scene';
import { playSound, type SoundKind } from './platform/audio';
import { StageSoundPlayer } from './platform/stage-audio';
import { attachPauseHandlers } from './platform/pause';
import { loadGame, saveGame } from './platform/storage';
import { attachTouchControls } from './platform/touch-controls';
import { createMiniMode } from './platform/mini-mode';
import { splitElapsedMs } from './platform/simulation-clock';
import { getAllForms, getEffectiveStats, getEvolutionWeightHints, getFormDefinition, getLevelCap, getTraitList, xpToNextLevel } from './core/progression';
import { getBiomeForFloor, getDungeonData } from './core/dungeon';
import { getAchievementStatuses, getCosmeticName, getHomeEffects, getHomeUpgradeCost, getHomeUpgradeDefinitions, getTrainingCap } from './core/home';
import { getAscensionMilestone, getAscensionPerks, getBestiaryCoinMultiplier, getCurrentUtcDateKey, getDifficultyModifiers } from './core/endless';
import { createPetCodePayload, decodePetCode, encodePetCode } from './core/pet-code';
import { simulateGhostBattle, type GhostBattleResult } from './core/ghost-battle';
import {
  equipmentItemsHaveSameSlotAndRarity,
  getAffixDefinition,
  getEquipmentCombatEffects,
  getEquipmentRules,
  getEquipmentSetCounts,
  getItemPreview,
  getItemTemplate,
  getScrapValue,
  getSetDefinition,
  shouldAutoScrap,
  getUpgradeCost,
  getUpgradeSuccessChance,
  nextFusionRarity,
} from './core/equipment';
import type { AscensionPerkId, AutoScrapThreshold, DungeonRoomType, DungeonRunState, EquipmentItem, EquipmentSlot, ItemRarity } from './core/types';
import evolutions from './data/evolutions.json';
import dungeonRules from './data/dungeon-rules.json';
import './style.css';

declare global {
  interface Window {
    __game?: {
      getState: () => GameState | null;
      getVisualState: () => { phase: string | null; location: string | null } | null;
      getEventLog: () => StageVisualEvent[];
      getPlaybackState: () => {
        speed: AnimationSpeed;
        queueLength: number;
        frameEventType: StageVisualEvent['type'] | null;
        frameProgress: number;
        frameSummary: boolean;
      };
      getPerformanceMetrics: () => {
        combatFrameSamples: number;
        averageCombatFrameMs: number | null;
        p95CombatFrameMs: number | null;
        maxCombatFrameMs: number | null;
        combatRenderSamples: number;
        averageCombatRenderMs: number | null;
        combatControlUpdateSamples: number;
        averageCombatControlUpdateMs: number | null;
        averageCombatLoopWorkMs: number | null;
      };
      setSpeed: (speed: AnimationSpeed) => void;
      setSeed: (seed: number) => void;
      getStageRenderer: () => {
        type: 'phaser' | 'fallback';
        ready: boolean;
        failed: boolean;
        canvasAttached: boolean;
      };
      previewStage: (name: NativeStagePreviewName | null, progress?: number, frozen?: boolean) => void;
      getStageSceneMetrics: () => {
        petHeight: number;
        stageHeight: number;
        activeParticleCount: number;
        petWidth: number;
        petSpriteHeight: number;
        petFrameName: string;
        petX: number;
        petY: number;
        petScaleX: number;
        petScaleY: number;
        shadowY: number;
      } | null;
    };
  }
}

const dungeonData = getDungeonData();
const equipmentRules = getEquipmentRules();
const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Pocket Pal could not find its app root.');

const needLabels: Record<NeedKey, string> = {
  hunger: 'Fullness',
  happiness: 'Joy',
  energy: 'Energy',
  hygiene: 'Freshness',
};
const needCopy: Record<NeedKey, string> = {
  hunger: 'Pip is getting peckish.',
  happiness: 'Pip could use a little play.',
  energy: 'Pip looks ready for a rest.',
  hygiene: 'A quick clean would feel nice.',
};
const statLabels: Record<StatKey, string> = { HP: 'Health', ATK: 'Attack', DEF: 'Defense', SPD: 'Speed', LUK: 'Luck' };
const actionAnimations: Record<string, SoundKind> = {
  feed: 'eat',
  play: 'play',
  clean: 'clean',
  sleep: 'sleep',
};
const actionSounds: Partial<Record<GameAction['type'], SoundKind>> = {
  'mini-game-complete': 'play',
  'dungeon-start-run': 'enter',
  'dungeon-open-treasure': 'loot',
  'dungeon-resolve-item': 'loot',
  'dungeon-descend': 'descend',
  'dungeon-leave': 'bank',
  'home-upgrade': 'level',
  'endless-ascend': 'victory',
};
const storedMute = readSetting('pocket-pal-muted', false);
const storedCrt = readSetting('pocket-pal-crt', false);
let onboardingDismissed = readSetting('pocket-pal-onboarding-dismissed', false);
const controlSizes = ['small', 'medium', 'large'] as const;
type ControlSize = (typeof controlSizes)[number];
let controlSize = readControlSize();
let leftHanded = readSetting('pocket-pal-left-handed', false);
let hapticsOn = readSetting('pocket-pal-haptics', false);
let controlOpacity = readControlOpacity();
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const worker = new Worker(new URL('./core/worker.ts', import.meta.url), { type: 'module' });

let state: GameState | null = null;
let muted = storedMute;
let crtOn = storedCrt;
let lastFrameTime = 0;
let combatFrameTotalMs = 0;
let combatFrameSamples = 0;
let combatFrameIntervalsMs: number[] = [];
let combatRenderTotalMs = 0;
let combatRenderSamples = 0;
let combatControlUpdateTotalMs = 0;
let combatControlUpdateSamples = 0;
let combatLoopWorkTotalMs = 0;
let combatLoopWorkSamples = 0;
let lastSavedLabel = 'Save stays on this device';
let toastTimeout = 0;
const toastQueue: string[] = [];
let toastVisible = false;
const pendingActions: GameAction[] = [];
let saveRequestId = 0;
let pendingInstall: BeforeInstallPromptEvent | null = null;
let installButton: HTMLButtonElement | null = null;
let selectedDungeonPack: string[] = [];
let selectedGearTab: 'loadout' | 'bag' | 'workshop' = 'loadout';
let selectedFuseIds: string[] = [];
let selectedHomeTab: 'upgrades' | 'achievements' | 'records' | 'endless' = 'upgrades';
let selectedMealStat: StatKey = 'ATK';
let selectedDungeonMode: 'standard' | 'daily' = 'standard';
type StageTab = 'pack' | 'gear' | 'care' | 'log' | 'stats';
let selectedStageTab: StageTab = 'care';
let animationSpeed: AnimationSpeed = readAnimationSpeed();
const stageEventPlayer = new StageEventPlayer();
const stageRenderer = new StageSceneRenderer();
const stageSound = new StageSoundPlayer();
let petCodeOutput = '';
let ghostCodeInput = '';
let ghostBattleResult: GhostBattleResult | null = null;
let ghostBattleError = '';

root.innerHTML = `
  <div class="app-shell stage-shell">
    <header class="topbar">
      <a class="brand" href="${import.meta.env.BASE_URL}#/" aria-label="Pocket Pal home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="brand-name">Pocket Pal</span>
      </a>
      <div class="topbar-actions">
        <button class="quiet-button" id="mini-mode-button" type="button" aria-label="Open mini mode" title="Open mini mode">
          <span class="button-icon" aria-hidden="true">▣</span><span>Mini</span>
        </button>
        <button class="quiet-button" id="dungeon-open" type="button" aria-label="Dungeon" aria-haspopup="dialog" aria-controls="dungeon-dialog" data-testid="dungeon-open" disabled>
          <span class="button-icon" aria-hidden="true">⌁</span><span>Dungeon</span>
        </button>
        <button class="quiet-button" id="home-open" type="button" aria-label="Home upgrades and records" aria-haspopup="dialog" aria-controls="home-dialog" data-testid="home-open">
          <span class="button-icon" aria-hidden="true">⌂</span><span>Home</span>
        </button>
        <button class="quiet-button" id="gear-open" type="button" aria-label="Gear and workshop" aria-haspopup="dialog" aria-controls="gear-dialog" data-testid="gear-open">
          <span class="button-icon" aria-hidden="true">◇</span><span>Gear</span>
        </button>
        <button class="quiet-button" id="forms-open" type="button" aria-label="Forms" aria-haspopup="dialog" aria-controls="dex-dialog" data-testid="forms-open">
          <span class="button-icon" aria-hidden="true">✧</span><span>Forms</span>
        </button>
        <button class="quiet-button" id="settings-open" type="button" aria-label="Settings" aria-haspopup="dialog" aria-controls="settings-dialog" data-testid="settings-open">
          <span class="button-icon" aria-hidden="true">⚙</span><span>Settings</span>
        </button>
        <button class="quiet-button" id="about-open" type="button" aria-label="About" aria-haspopup="dialog"><span class="button-icon" aria-hidden="true">?</span><span>About</span></button>
        <button class="install-button" id="install-app" type="button" hidden>Install</button>
      </div>
    </header>

    <main>
      <section class="welcome-line" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">A small world, just for you</p>
          <h1 id="page-title">Keep a little light company.</h1>
        </div>
        <div class="day-marker"><span class="day-spark" aria-hidden="true">✦</span><span id="active-clock">0 min together</span></div>
      </section>

      <div id="getting-started-slot" class="guide-slot-loading" aria-live="polite" aria-busy="true">
        <span class="guide-loading-mark" aria-hidden="true"></span><span>Checking your saved world…</span>
      </div>

      <div class="play-layout">
        <section class="habitat-panel stage-panel" id="stage-panel" aria-label="Pip's living world">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Pip's pocket habitat</p>
              <h2 id="pet-heading">A quiet place to grow</h2>
            </div>
            <span class="live-pill"><span class="live-dot"></span><span id="stage-pill">Egg</span></span>
            <span class="stage-location" id="stage-location">HOME</span>
          </div>
          <div class="scene-frame">
            <canvas id="pet-scene" data-testid="stage-canvas" width="240" height="160" role="img" aria-label="Pip resting in a small cave habitat"></canvas>
            <div class="stage-choice-overlay" id="stage-choice-overlay" data-testid="stage-choice-overlay" hidden></div>
            <div class="scene-caption"><span id="stage-detail">A tiny life is stirring.</span><span class="scene-pin" aria-hidden="true">✦</span></div>
          </div>
          <div class="stage-ticker" id="stage-ticker" data-testid="stage-ticker" role="status" aria-live="polite">Pip's little world is waking up.</div>
          <div class="habitat-footer">
            <span class="tiny-ledger"><span class="ledger-dot"></span><span id="save-status">${lastSavedLabel}</span></span>
            <span class="offline-label"><span aria-hidden="true">◌</span> Offline-ready</span>
          </div>
        </section>

        <section class="stage-status-strip" id="stage-status-strip" data-testid="stage-status" aria-label="Pip's quick status">
          <div class="stage-status-item stage-status-hp" id="stage-hp-status" hidden>
            <span class="stage-status-icon" aria-hidden="true">♥</span>
            <div class="stage-status-meter" role="progressbar" aria-label="Pip health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" id="stage-hp-meter"><span id="stage-hp-fill"></span></div>
            <strong id="stage-hp-copy">—</strong>
          </div>
          <div class="stage-status-item">
            <span class="stage-status-icon" aria-hidden="true">●</span>
            <div class="stage-status-meter" role="progressbar" aria-label="Hunger" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" id="stage-hunger-meter"><span id="stage-hunger-fill"></span></div>
            <strong id="stage-hunger-copy">100</strong>
          </div>
          <div class="stage-status-item">
            <span class="stage-status-icon stage-energy-icon" aria-hidden="true">ϟ</span>
            <div class="stage-status-meter" role="progressbar" aria-label="Energy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" id="stage-energy-meter"><span id="stage-energy-fill"></span></div>
            <strong id="stage-energy-copy">100</strong>
          </div>
          <div class="stage-run-meta" id="stage-run-meta" hidden><span aria-hidden="true">⌁</span><strong id="stage-run-summary">F1 · 0c</strong></div>
          <div class="stage-home-meta" id="stage-home-meta"><span aria-hidden="true">✦</span><strong id="stage-home-summary">Lv 1</strong></div>
        </section>

        <nav class="stage-action-row stage-actions-home" id="stage-actions-home" data-testid="stage-actions-home" aria-label="Quick care">
          <button class="stage-action" type="button" data-action="feed" data-food-id="${foods[0]!.id}" aria-label="Feed Pip"><span aria-hidden="true">●</span><strong>Feed</strong></button>
          <button class="stage-action" type="button" data-action="play" aria-label="Play with Pip"><span aria-hidden="true">✦</span><strong>Play</strong></button>
          <button class="stage-action" type="button" data-stage-open="training" aria-label="Open training games"><span aria-hidden="true">◌</span><strong>Train</strong></button>
          <button class="stage-action" type="button" data-action="toggle-sleep" aria-label="Tuck Pip in or wake Pip"><span aria-hidden="true">☾</span><strong id="stage-sleep-label">Sleep</strong></button>
          <button class="stage-action" type="button" data-action="clean" aria-label="Clean Pip"><span aria-hidden="true">✧</span><strong>Clean</strong></button>
        </nav>
        <nav class="stage-action-row stage-actions-run" id="stage-actions-run" data-testid="stage-actions-run" aria-label="Dungeon controls" hidden>
          <button class="stage-action" type="button" data-stage-tab="pack" aria-label="Open run pack"><span aria-hidden="true">▣</span><strong>Pack</strong></button>
          <button class="stage-action" type="button" data-stage-open="dungeon" aria-label="Open current dungeon decision"><span aria-hidden="true">◇</span><strong id="stage-decision-label">Tactic</strong></button>
          <button class="stage-action" type="button" id="stage-speed" data-stage-speed aria-label="Animation speed 1 times"><span aria-hidden="true">»</span><strong>1×</strong></button>
          <button class="stage-action" type="button" data-run-action="leave" aria-label="Leave and bank run rewards"><span aria-hidden="true">↩</span><strong>Leave</strong></button>
        </nav>

        <section class="care-panel stage-drawer" id="stage-drawer" data-testid="stage-sheet" aria-label="Pocket Pal details">
          <button class="stage-sheet-handle" id="stage-sheet-toggle" data-testid="stage-sheet-toggle" type="button" aria-expanded="false" aria-controls="stage-sheet-content">
            <span class="sheet-grabber" aria-hidden="true"></span><span class="sheet-heading">Little details</span><span class="sheet-hint">Swipe up or tap</span><span class="sheet-chevron" aria-hidden="true">⌃</span>
          </button>
          <div class="stage-sheet-tabs" role="tablist" aria-label="Pet details">
            <button type="button" role="tab" data-stage-tab="pack" aria-selected="false">Pack</button>
            <button type="button" role="tab" data-stage-tab="gear" aria-selected="false">Gear</button>
            <button type="button" role="tab" data-stage-tab="care" aria-selected="true">Care</button>
            <button type="button" role="tab" data-stage-tab="log" aria-selected="false">Log</button>
            <button type="button" role="tab" data-stage-tab="stats" aria-selected="false">Stats</button>
          </div>
          <div class="stage-sheet-content" id="stage-sheet-content">
            <section class="stage-sheet-pane" id="stage-tab-care" role="tabpanel" aria-label="Care">
          <div class="care-heading">
            <div><p class="eyebrow">How is Pip doing?</p><h2 id="care-title">Little needs</h2></div>
            <span class="mood-chip" id="mood-chip">Settled</span>
          </div>
          <div class="need-list" id="need-list" aria-label="Pip's needs"></div>
          <section class="growth-summary" aria-label="Growth and training">
            <div class="growth-heading"><span>Level <strong id="level-value">1</strong></span><span id="xp-copy">0 XP</span></div>
            <div class="xp-track" role="progressbar" aria-label="Experience to next level" aria-valuemin="0" aria-valuemax="20" aria-valuenow="0" id="xp-meter"><span id="xp-fill"></span></div>
            <div class="stat-list" id="stat-list" aria-label="Current stats"></div>
            <p class="tendency-summary" id="tendency-summary">Care shapes the next form.</p>
            <p class="trait-summary" id="trait-summary"></p>
            <button class="quiet-button training-open" id="minigames-open" type="button" aria-haspopup="dialog" aria-controls="minigame-dialog" data-testid="minigames-open" disabled>Play a training game</button>
          </section>
          <div class="signal-note" id="signal-note" role="status" aria-live="polite">
            <span class="signal-star" aria-hidden="true">✦</span>
            <span id="signal-copy">Pip is happy to have you here.</span>
          </div>

          <div class="care-controls" id="care-controls">
          <div class="care-divider"><span>Little ways to help</span><span class="divider-line"></span></div>
          <div class="food-section">
            <div class="food-intro"><h3>Offer a snack</h3><p>Each bite gives Pip a different boost.</p></div>
            <div class="food-grid" id="food-actions"></div>
          </div>
          <div class="action-grid">
            <button class="action-button" type="button" data-action="play" data-testid="action-play">
              <span class="action-glyph play-glyph" aria-hidden="true">✦</span><span class="action-name">Play</span><span class="action-detail">A happy wiggle</span>
            </button>
            <button class="action-button" type="button" data-action="toggle-sleep" data-testid="action-sleep">
              <span class="action-glyph sleep-glyph" aria-hidden="true">☾</span><span class="action-name" id="sleep-label">Tuck in</span><span class="action-detail" id="sleep-detail">Rest a little</span>
            </button>
            <button class="action-button" type="button" data-action="clean" data-testid="action-clean">
              <span class="action-glyph clean-glyph" aria-hidden="true">✧</span><span class="action-name">Clean</span><span class="action-detail">A freshen-up</span>
            </button>
          </div>
          </div>
          <p class="key-hint">Keyboard: 1–3 snacks · P play · S sleep · C clean</p>
            </section>
            <section class="stage-sheet-pane" id="stage-tab-pack" role="tabpanel" aria-label="Run pack" hidden></section>
            <section class="stage-sheet-pane" id="stage-tab-gear" role="tabpanel" aria-label="Gear" hidden></section>
            <section class="stage-sheet-pane" id="stage-tab-log" role="tabpanel" aria-label="Expedition log" hidden></section>
            <section class="stage-sheet-pane" id="stage-tab-stats" role="tabpanel" aria-label="Pip's stats" hidden></section>
          </div>
        </section>
      </div>

      <footer class="page-footer">
        <span>Made for unhurried moments.</span>
        <span>Progress moves only while you are here.</span>
      </footer>
    </main>

    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <div class="pause-overlay" id="pause-overlay" hidden>
      <div class="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <span class="pause-icon" aria-hidden="true">Ⅱ</span>
        <p class="eyebrow">Your pocket can wait</p>
        <h2 id="pause-title">Paused</h2>
        <p>Pip's needs stay right where they are while you're away.</p>
        <button class="primary-button" id="resume-button" type="button">Tap to continue</button>
      </div>
    </div>

    <dialog class="about-dialog" id="about-dialog" aria-labelledby="about-title">
      <button class="dialog-close" id="about-close" type="button" aria-label="Close about">×</button>
      <h2 id="about-title">About Pocket Pal</h2>
      <p>Pocket Pal’s code and original game design are made for this little world. Its stage atlas uses <a href="https://kenney.nl/assets/tiny-town" target="_blank" rel="noreferrer">Tiny Town</a> and <a href="https://kenney.nl/assets/tiny-dungeon" target="_blank" rel="noreferrer">Tiny Dungeon</a> by Kenney, plus <a href="https://clintbellanger.net/" target="_blank" rel="noreferrer">Tiny Creatures</a> by Clint Bellanger, all under CC0.</p>
      <p>See the complete <a href="https://github.com/rom-bar/dundung/blob/main/CREDITS.md" target="_blank" rel="noreferrer">asset credits</a>. The native stage runs on <a href="https://phaser.io/" target="_blank" rel="noreferrer">Phaser</a> under the MIT license.</p>
      <p>There are no push notifications and no time-away penalties. When you leave, the world pauses.</p>
      <p class="dialog-footnote">Your save lives in this browser on this device.</p>
    </dialog>
    <dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
      <div class="settings-heading">
        <div><p class="eyebrow">Make care feel right</p><h2 id="settings-title">Pocket Pal settings</h2></div>
        <button class="dialog-close" id="settings-close" type="button" aria-label="Close settings" data-testid="settings-close">×</button>
      </div>
      <p class="settings-intro">Tune Pip's buttons for your hands and screen.</p>
      <div class="settings-list">
        <label class="settings-field" for="control-size">
          <span>Care button size</span>
          <select id="control-size" data-testid="control-size">
            <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
          </select>
        </label>
        <label class="settings-check" for="left-handed">
          <input id="left-handed" type="checkbox" data-testid="left-handed" />
          <span><strong>Left-handed layout</strong><small>Mirror the order of snacks and care actions.</small></span>
        </label>
        <label class="settings-check" for="haptics-toggle">
          <input id="haptics-toggle" type="checkbox" data-testid="haptics-toggle" />
          <span><strong>Haptics</strong><small>Use a short tick when you touch a care button.</small></span>
        </label>
        <label class="settings-field" for="control-opacity">
          <span>Care button opacity</span>
          <span class="range-line"><input id="control-opacity" type="range" min="40" max="100" step="10" data-testid="control-opacity" /><output id="control-opacity-value" for="control-opacity">100%</output></span>
        </label>
        <div class="settings-toggles" aria-label="Sound and display">
          <button class="quiet-button setting-toggle" id="sound-toggle" type="button" aria-pressed="${muted}" data-testid="sound-toggle">
            <span class="button-icon" aria-hidden="true">${muted ? '♪' : '♫'}</span><span>${muted ? 'Sound off' : 'Sound on'}</span>
          </button>
          <button class="quiet-button setting-toggle" id="crt-toggle" type="button" aria-pressed="${crtOn}" data-testid="crt-toggle">
            <span class="button-icon" aria-hidden="true">▦</span><span>${crtOn ? 'CRT on' : 'CRT off'}</span>
          </button>
        </div>
      </div>
    </dialog>
    <dialog class="settings-dialog dex-dialog" id="dex-dialog" aria-labelledby="dex-title">
      <div class="settings-heading">
        <div><p class="eyebrow">A field guide to Pip's family</p><h2 id="dex-title">Form Dex</h2></div>
        <button class="dialog-close" id="dex-close" type="button" aria-label="Close Form Dex">×</button>
      </div>
      <p class="settings-intro" id="dex-progress">0 of 20 forms found · scroll to explore</p>
      <p class="library-hint" id="library-hint"></p>
      <button class="quiet-button stone-button" id="evolution-stone" type="button" hidden>Use Evolution Stone</button>
      <div class="form-grid" id="form-grid" role="region" tabindex="0" aria-label="Form collection; scroll to browse all forms"></div>
      <section class="hall-section" aria-labelledby="hall-title"><h3 id="hall-title">Hall of Pets</h3><div id="hall-list"></div></section>
    </dialog>
    <dialog class="settings-dialog gear-dialog" id="gear-dialog" aria-labelledby="gear-title">
      <div class="settings-heading gear-heading">
        <div><p class="eyebrow">A little room for good finds</p><h2 id="gear-title">Gear & workshop</h2></div>
        <button class="dialog-close" id="gear-close" type="button" aria-label="Close gear and workshop">×</button>
      </div>
      <div class="gear-wallet" id="gear-wallet" aria-label="Gear currencies"></div>
      <div class="gear-tabs" role="tablist" aria-label="Gear sections">
        <button class="gear-tab" type="button" role="tab" data-gear-tab="loadout" aria-selected="true">Loadout</button>
        <button class="gear-tab" type="button" role="tab" data-gear-tab="bag" aria-selected="false">Bag</button>
        <button class="gear-tab" type="button" role="tab" data-gear-tab="workshop" aria-selected="false">Workshop</button>
      </div>
      <div class="gear-content" id="gear-content" aria-live="polite"></div>
    </dialog>
    <dialog class="settings-dialog home-dialog" id="home-dialog" aria-labelledby="home-title">
      <div class="settings-heading home-heading">
        <div><p class="eyebrow">A little place to grow together</p><h2 id="home-title">Home & family</h2></div>
        <button class="dialog-close" id="home-close" type="button" aria-label="Close Home">×</button>
      </div>
      <div class="home-wallet" id="home-wallet" aria-label="Home currencies"></div>
      <div class="home-tabs" role="tablist" aria-label="Home sections">
        <button class="home-tab" type="button" role="tab" data-home-tab="upgrades" aria-selected="true">Upgrades</button>
        <button class="home-tab" type="button" role="tab" data-home-tab="achievements" aria-selected="false">Achievements</button>
        <button class="home-tab" type="button" role="tab" data-home-tab="records" aria-selected="false">Records</button>
        <button class="home-tab" type="button" role="tab" data-home-tab="endless" aria-selected="false">Endless</button>
      </div>
      <div class="home-content" id="home-content" aria-live="polite"></div>
    </dialog>
    <dialog class="settings-dialog minigame-dialog" id="minigame-dialog" aria-labelledby="minigame-title">
      <div class="settings-heading">
        <div><p class="eyebrow">A little practice goes a long way</p><h2 id="minigame-title">Training games</h2></div>
        <button class="dialog-close" id="minigame-close" type="button" aria-label="Close training games">×</button>
      </div>
      <p class="settings-intro" id="minigame-status">Choose a game. A good score gives up to 3 training points.</p>
      <label class="settings-field" for="training-stat">Train a stat
        <select id="training-stat"><option value="HP">HP</option><option value="ATK">ATK</option><option value="DEF">DEF</option><option value="SPD">SPD</option><option value="LUK">LUK</option></select>
      </label>
      <div class="minigame-choices" id="minigame-choices">
        <button class="game-choice" type="button" data-game="reaction"><strong>Quick Spark</strong><span>Tap when the light wakes.</span></button>
        <button class="game-choice" type="button" data-game="memory"><strong>Echo Garden</strong><span>Remember a short symbol trail.</span></button>
        <button class="game-choice" type="button" data-game="rhythm"><strong>Beat Bubbles</strong><span>Tap along with a gentle pulse.</span></button>
      </div>
      <div id="minigame-stage" class="minigame-stage" hidden></div>
    </dialog>
    <dialog class="dungeon-dialog" id="dungeon-dialog" aria-labelledby="dungeon-title">
      <div class="dungeon-heading">
        <div><p class="eyebrow">A path made for brave little paws</p><h2 id="dungeon-title">The Endless Descent</h2></div>
        <button class="dialog-close" id="dungeon-close" type="button" aria-label="Close dungeon">×</button>
      </div>
      <div class="dungeon-content" id="dungeon-content" aria-live="polite"></div>
    </dialog>
  </div>
`;

const canvas = must<HTMLCanvasElement>('#pet-scene');
const stageChoiceOverlay = must<HTMLDivElement>('#stage-choice-overlay');
const stageEngine = new PhaserStageAdapter(canvas, stageRenderer);
let artPreviewName: NativeStagePreviewName | null = null;
const artPreviewCaptions: Record<NativeStagePreviewName, string> = {
  corridor: 'Pip follows the meadow path.', intro: 'A meadow slime joins the path.',
  attack: 'Pip winds up, pounces, and recovers.', crit: 'A critical pounce lands.',
  chest: 'The chest opens with a little sparkle.', home: 'Pip takes a quiet moment at home.',
  eating: 'Pip nibbles a biscuit.',
};
const overlay = must<HTMLDivElement>('#pause-overlay');
const saveStatus = must<HTMLSpanElement>('#save-status');
const signalCopy = must<HTMLSpanElement>('#signal-copy');
const moodChip = must<HTMLSpanElement>('#mood-chip');
const soundToggle = must<HTMLButtonElement>('#sound-toggle');
const crtToggle = must<HTMLButtonElement>('#crt-toggle');
const aboutDialog = must<HTMLDialogElement>('#about-dialog');
const settingsDialog = must<HTMLDialogElement>('#settings-dialog');
const controlSizeInput = must<HTMLSelectElement>('#control-size');
const leftHandedInput = must<HTMLInputElement>('#left-handed');
const hapticsInput = must<HTMLInputElement>('#haptics-toggle');
const controlOpacityInput = must<HTMLInputElement>('#control-opacity');
const controlOpacityValue = must<HTMLOutputElement>('#control-opacity-value');
const dexDialog = must<HTMLDialogElement>('#dex-dialog');
const gearDialog = must<HTMLDialogElement>('#gear-dialog');
const gearContent = must<HTMLDivElement>('#gear-content');
const homeDialog = must<HTMLDialogElement>('#home-dialog');
const homeContent = must<HTMLDivElement>('#home-content');
const homeWallet = must<HTMLDivElement>('#home-wallet');
const dungeonDialog = must<HTMLDialogElement>('#dungeon-dialog');
const dungeonContent = must<HTMLDivElement>('#dungeon-content');
const minigameDialog = must<HTMLDialogElement>('#minigame-dialog');
const minigameStatus = must<HTMLParagraphElement>('#minigame-status');
const minigameChoices = must<HTMLDivElement>('#minigame-choices');
const minigameStage = must<HTMLDivElement>('#minigame-stage');
const trainingStatInput = must<HTMLSelectElement>('#training-stat');
const formGrid = must<HTMLDivElement>('#form-grid');
const hallList = must<HTMLDivElement>('#hall-list');
const evolutionStoneButton = must<HTMLButtonElement>('#evolution-stone');
const miniGameTimers = new Set<number>();
let miniGameInput: ((button: HTMLButtonElement) => void) | null = null;
let sheetSwipeHandled = false;
installButton = must<HTMLButtonElement>('#install-app');
const miniModeButton = must<HTMLButtonElement>('#mini-mode-button');
must<HTMLElement>('#stage-panel').append(must<HTMLElement>('#getting-started-slot'));
const miniMode = createMiniMode({
  canvas,
  getState: () => state,
  onTick: (dtMs) => worker.postMessage({ type: 'tick', dtMs }),
  onStageFrame: (timeMs, deltaMs) => renderStageFrame(timeMs, deltaMs, true),
  onAction: sendAction,
  onOpen: (kind) => {
    stageEngine.resetClock();
    miniModeButton.setAttribute('aria-pressed', 'true');
    miniModeButton.title = kind === 'document' ? 'Mini mode is open' : 'Video mini mode is open';
  },
  onClose: () => {
    stageEngine.resetClock();
    miniModeButton.setAttribute('aria-pressed', 'false');
    miniModeButton.title = 'Open mini mode';
    pauseAndSave();
  },
});
if (!miniMode.available) miniModeButton.hidden = true;
root.dataset.controlSize = controlSize;
root.dataset.handedness = leftHanded ? 'left' : 'right';
root.style.setProperty('--control-opacity', String(controlOpacity / 100));
if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
  window.__game = {
    getState: () => state ? structuredClone(state) : null,
    getVisualState: () => {
      const visual = stageRenderer.visualState();
      const run = visual?.dungeon.activeRun;
      return visual ? { phase: run?.phase ?? null, location: stageLocation(visual) } : null;
    },
    getEventLog: () => stageEventPlayer.eventLog(),
    getPlaybackState: () => {
      const frame = stageEventPlayer.frame();
      return {
        speed: animationSpeed,
        queueLength: stageEventPlayer.queueLength(),
        frameEventType: frame.event?.type ?? null,
        frameProgress: frame.progress,
        frameSummary: frame.summary,
      };
    },
    getPerformanceMetrics: () => {
      const sortedIntervals = [...combatFrameIntervalsMs].sort((left, right) => left - right);
      const p95Index = Math.max(0, Math.ceil(sortedIntervals.length * 0.95) - 1);
      return {
        combatFrameSamples,
        averageCombatFrameMs: combatFrameSamples ? combatFrameTotalMs / combatFrameSamples : null,
        p95CombatFrameMs: sortedIntervals.length ? sortedIntervals[p95Index]! : null,
        maxCombatFrameMs: sortedIntervals.length ? sortedIntervals[sortedIntervals.length - 1]! : null,
        combatRenderSamples,
        averageCombatRenderMs: combatRenderSamples ? combatRenderTotalMs / combatRenderSamples : null,
        combatControlUpdateSamples,
        averageCombatControlUpdateMs: combatControlUpdateSamples ? combatControlUpdateTotalMs / combatControlUpdateSamples : null,
        averageCombatLoopWorkMs: combatLoopWorkSamples ? combatLoopWorkTotalMs / combatLoopWorkSamples : null,
      };
    },
    setSpeed: (speed) => {
      if (!['1x', '2x', 'skip'].includes(speed)) return;
      animationSpeed = speed;
      if (state) updateStageHud(state);
    },
    setSeed: (seed) => {
      if (!state || !Number.isFinite(seed)) return;
      const seededState: GameState = {
        ...state,
        seed: seed >>> 0,
        paused: false,
        dungeon: { ...state.dungeon, activeRun: null },
      };
      stageEventPlayer.reset();
      stageEngine.clear();
      combatFrameTotalMs = 0;
      combatFrameSamples = 0;
      combatFrameIntervalsMs = [];
      combatRenderTotalMs = 0;
      combatRenderSamples = 0;
      combatControlUpdateTotalMs = 0;
      combatControlUpdateSamples = 0;
      combatLoopWorkTotalMs = 0;
      combatLoopWorkSamples = 0;
      state = seededState;
      worker.postMessage({ type: 'load', state: seededState, startPaused: false });
      updateControls(seededState);
    },
    getStageRenderer: () => stageEngine.status,
    previewStage: (name, progress, frozen) => {
      artPreviewName = name;
      stageEngine.setPreviewState(name, progress, frozen);
    },
    getStageSceneMetrics: () => stageEngine.getStageSceneMetrics(),
  };
}

function must<T extends Element>(selector: string): T {
  const element = root?.querySelector<T>(selector);
  if (!element) throw new Error(`Pocket Pal is missing ${selector}.`);
  return element;
}

const renderedMarkup = new WeakMap<HTMLElement, string>();

function setMarkupIfChanged(element: HTMLElement, markup: string): void {
  if (renderedMarkup.get(element) === markup) return;
  element.innerHTML = markup;
  renderedMarkup.set(element, markup);
}

function readSetting(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Preferences are optional and never block the game.
  }
}

function readControlSize(): ControlSize {
  try {
    const saved = localStorage.getItem('pocket-pal-control-size');
    return controlSizes.find((size) => size === saved) ?? 'medium';
  } catch {
    return 'medium';
  }
}

function readControlOpacity(): number {
  try {
    const value = Number(localStorage.getItem('pocket-pal-control-opacity'));
    return Number.isFinite(value) && value >= 40 && value <= 100 ? value : 100;
  } catch {
    return 100;
  }
}

function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are optional and never block the game.
  }
}

function applyControlSettings(): void {
  if (!root) return;
  root.dataset.controlSize = controlSize;
  root.dataset.handedness = leftHanded ? 'left' : 'right';
  root.style.setProperty('--control-opacity', String(controlOpacity / 100));
  controlSizeInput.value = controlSize;
  leftHandedInput.checked = leftHanded;
  hapticsInput.checked = hapticsOn;
  controlOpacityInput.value = String(controlOpacity);
  controlOpacityValue.value = `${controlOpacity}%`;
  controlOpacityValue.textContent = `${controlOpacity}%`;
}

function renderNeedList(): void {
  const list = must<HTMLDivElement>('#need-list');
  list.innerHTML = (Object.keys(needLabels) as NeedKey[]).map((key) => `
    <div class="need-row" data-need-row="${key}">
      <div class="need-label-line"><span>${needLabels[key]}</span><span class="need-value" data-need-value="${key}">—</span></div>
      <div class="meter-track" role="progressbar" aria-label="${needLabels[key]}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-need-meter="${key}">
        <span class="meter-fill" data-need-fill="${key}"></span>
        <span class="meter-threshold" aria-hidden="true"></span>
      </div>
    </div>
  `).join('');
}

function renderGrowthSummary(current: GameState): void {
  const stats = getEffectiveStats(current);
  const cap = getLevelCap(current.stage);
  const xpTarget = current.level >= cap ? 0 : xpToNextLevel(current.level);
  const xpFill = must<HTMLSpanElement>('#xp-fill');
  const xpMeter = must<HTMLDivElement>('#xp-meter');
  const xpPercent = xpTarget > 0 ? Math.min(100, Math.round((current.xp / xpTarget) * 100)) : 100;
  must<HTMLSpanElement>('#level-value').textContent = String(current.level);
  must<HTMLSpanElement>('#xp-copy').textContent = current.level >= cap ? `Stage cap · Lv ${cap}` : `${current.xp} / ${xpTarget} XP`;
  xpFill.style.width = `${xpPercent}%`;
  xpMeter.setAttribute('aria-valuemax', String(Math.max(1, xpTarget)));
  xpMeter.setAttribute('aria-valuenow', String(Math.min(current.xp, xpTarget)));
  must<HTMLDivElement>('#stat-list').innerHTML = (Object.keys(statLabels) as StatKey[]).map((key) => `
    <div class="stat-chip" role="group" aria-label="${statLabels[key]}: ${stats[key]}${current.training[key] ? `, ${current.training[key]} trained points` : ''}" title="${statLabels[key]}${current.training[key] ? ` · +${current.training[key]} trained` : ''}">
      <strong>${key}</strong><span>${stats[key]}</span>
    </div>
  `).join('');
  const tendencies = current.tendencies;
  const preference = [
    ['play', 'play'], ['sleep', 'rest'], ['fight', 'fight'], ['training', 'training'], ['feedQuality', 'food'], ['hygiene', 'clean'],
  ] as const;
  const topSignals = [...preference]
    .sort((left, right) => tendencies[right[0]] - tendencies[left[0]])
    .slice(0, 2)
    .filter(([key]) => tendencies[key] > 0.02)
    .map(([, label]) => label);
  must<HTMLParagraphElement>('#tendency-summary').textContent = topSignals.length
    ? `This stage leans toward ${topSignals.join(' and ')}.`
    : 'Care this stage shapes the next form.';
  const activeTraits = getTraitList(current);
  const traitSummary = must<HTMLParagraphElement>('#trait-summary');
  traitSummary.textContent = activeTraits.length ? `Traits: ${activeTraits.map((trait) => trait.name).join(', ')}` : '';
  traitSummary.hidden = activeTraits.length === 0;
}

function renderFormDex(current: GameState): void {
  const forms = getAllForms();
  const discovered = new Set(current.formDex);
  must<HTMLParagraphElement>('#dex-progress').textContent = `${discovered.size} of ${forms.length} forms found · scroll to explore`;
  const libraryEffects = getHomeEffects(current.home, current.formDex.length);
  const libraryHint = must<HTMLParagraphElement>('#library-hint');
  libraryHint.hidden = libraryEffects.weightHintLevel < 1;
  if (libraryEffects.advancedWeightHintLevel > 0) {
    const hints = getEvolutionWeightHints(current, 3).map((hint) => {
      const form = getFormDefinition(hint.formId);
      const label = discovered.has(hint.formId) && form
        ? form.name
        : `${hint.rarity} ${hint.element} ${hint.archetype}`;
      return `${label} · ${hint.sharePercent.toFixed(1)}% weight share`;
    });
    libraryHint.textContent = `Advanced Library clue: current leading evolution weights — ${hints.join('; ')}. This is a live hint, not a promise. Form discoveries add +${((libraryEffects.dexStatMultiplier - 1) * 100).toFixed(1)}% to Pip's stats.`;
  } else if (libraryEffects.weightHintLevel > 0) {
    libraryHint.textContent = `Library clue: care tendencies and elemental meals nudge evolution toward matching forms. Discoveries add +${((libraryEffects.dexStatMultiplier - 1) * 100).toFixed(1)}% to Pip's stats.`;
  } else {
    libraryHint.textContent = '';
  }
  formGrid.innerHTML = forms.map((form) => {
    if (!discovered.has(form.id)) {
      return '<div class="form-card is-unknown" aria-label="Undiscovered form"><span class="form-mark" aria-hidden="true">?</span><strong>Unknown form</strong><small>Silhouette</small></div>';
    }
    const palette = evolutions.elements[form.element];
    return `<div class="form-card" data-rarity="${form.rarity}" aria-label="${form.name}, ${palette.label} ${form.archetype}">
      <span class="form-mark" aria-hidden="true" style="color:${palette.color}">${palette.mark}</span>
      <strong>${form.name}</strong><small>${palette.label} · ${form.archetype}</small>
    </div>`;
  }).join('');
  hallList.innerHTML = current.hallOfPets.length
    ? current.hallOfPets.map((pet) => {
      const form = getFormDefinition(pet.formId);
      return `<div class="hall-entry"><strong>${pet.name}</strong> · Generation ${pet.generation} · ${form?.name ?? 'Unformed'} · peak Lv ${pet.peakLevel} · deepest floor ${pet.deepestFloor}</div>`;
    }).join('')
    : '<p class="hall-empty">Past pets will find a place here after their long life.</p>';
  evolutionStoneButton.hidden = current.evolution.evolutionStones < 1 || !current.evolution.formId;
  evolutionStoneButton.disabled = current.paused;
  evolutionStoneButton.textContent = `Use Evolution Stone (${current.evolution.evolutionStones})`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function describeGearEffect(effect: { type: string; stat?: string; element?: string; status?: string; chance?: number; value?: number; baseValue?: number }): string {
  const value = effect.baseValue ?? effect.value ?? 0;
  const percent = `${Math.round(value * 100)}%`;
  if (effect.type === 'flat-stat') return `+${value} ${effect.stat ?? 'stat'}`;
  if (effect.type === 'percent-stat') return `+${percent} ${effect.stat ?? 'stat'}`;
  if (effect.type === 'crit') return `+${percent} critical chance`;
  if (effect.type === 'lifesteal') return `${percent} life returned`;
  if (effect.type === 'element-damage') return `+${percent} ${effect.element ?? 'element'} damage`;
  if (effect.type === 'food-effectiveness') return `+${percent} snack boost`;
  if (effect.type === 'coin-find') return `+${percent} coins found`;
  if (effect.type === 'resist') return `${percent} ${effect.element ?? 'all'} resistance`;
  if (effect.type === 'thorns') return `${percent} damage returned`;
  if (effect.type === 'on-hit-status') return `${Math.round((effect.chance ?? 0) * 100)}% chance to ${effect.status ?? 'affect'} (${value})`;
  return 'A small gear bonus';
}

function renderItemComparison(item: EquipmentItem, slot: EquipmentSlot, current: GameState): string {
  const before = getEffectiveStats(current);
  const after = getEffectiveStats({
    ...current,
    equipment: { ...current.equipment, equipped: { ...current.equipment.equipped, [slot]: item } },
  });
  return `<div class="gear-comparison" aria-label="Stats compared with current ${slot.toLowerCase()}">${(Object.keys(statLabels) as StatKey[]).map((key) => {
    const delta = after[key] - before[key];
    return `<span><small>${key}</small><strong>${delta >= 0 ? '+' : ''}${delta}</strong></span>`;
  }).join('')}</div>`;
}

function renderGearItem(item: EquipmentItem, current: GameState, options: {
  compareSlot?: EquipmentSlot;
  showEquip?: boolean;
  showUnequip?: EquipmentSlot;
  showScrap?: boolean;
  showUpgrade?: boolean;
  showFuse?: boolean;
  equipped?: boolean;
} = {}): string {
  const template = getItemTemplate(item.templateId);
  const preview = getItemPreview(item);
  if (!template || !preview) return '';
  const stats = (Object.keys(statLabels) as StatKey[])
    .filter((key) => (preview.stats[key] ?? 0) > 0)
    .map((key) => `<span>${key} <strong>+${Math.round(preview.stats[key] ?? 0)}</strong></span>`);
  if (preview.critChance > 0) stats.push(`<span>Crit <strong>+${Math.round(preview.critChance * 100)}%</strong></span>`);
  const affixes = preview.affixes.map((affix) => {
    const definition = getAffixDefinition(affix.id);
    return `<li><strong>${escapeHtml(definition?.name ?? affix.name)}</strong><span>${escapeHtml(describeGearEffect({ ...affix.effect, value: affix.value }))}</span></li>`;
  });
  if (preview.uniqueEffect) affixes.push(`<li class="is-unique"><strong>${escapeHtml(preview.uniqueEffect.name)}</strong><span>${escapeHtml(describeGearEffect(preview.uniqueEffect.effect))}</span></li>`);
  const controls: string[] = [];
  if (options.showEquip) controls.push(`<button class="gear-action" type="button" data-gear-action="equip" data-instance-id="${escapeHtml(item.instanceId)}" ${current.paused || current.dungeon.activeRun ? 'disabled' : ''}>Equip</button>`);
  if (options.showUnequip) controls.push(`<button class="gear-action" type="button" data-gear-action="unequip" data-slot="${options.showUnequip}" ${current.paused || current.dungeon.activeRun ? 'disabled' : ''}>Unequip</button>`);
  if (options.showScrap) controls.push(`<button class="gear-action is-quiet" type="button" data-gear-action="scrap" data-instance-id="${escapeHtml(item.instanceId)}" ${current.paused || current.dungeon.activeRun ? 'disabled' : ''}>Scrap · ${getScrapValue(item)}</button>`);
  if (options.showUpgrade) {
    const cost = Math.max(1, Math.floor(getUpgradeCost(item.upgradeLevel) * getHomeEffects(current.home).upgradeCostMultiplier));
    const chance = getUpgradeSuccessChance(item.upgradeLevel + 1);
    controls.push(`<button class="gear-action" type="button" data-gear-action="upgrade" data-instance-id="${escapeHtml(item.instanceId)}" ${current.paused || current.dungeon.activeRun || item.upgradeLevel >= equipmentRules.upgrades.maximumLevel || current.dungeon.scrap < cost ? 'disabled' : ''}>Upgrade to +${item.upgradeLevel + 1} · ${cost} Scrap${chance < 1 ? ` · ${Math.round(chance * 100)}%` : ''}</button>`);
  }
  if (options.showFuse) {
    controls.push(`<label class="gear-fuse-select"><input type="checkbox" data-fuse-item value="${escapeHtml(item.instanceId)}" ${selectedFuseIds.includes(item.instanceId) ? 'checked' : ''} ${current.paused || current.dungeon.activeRun ? 'disabled' : ''}><span>Choose to fuse</span></label>`);
  }
  const comparison = options.compareSlot ? renderItemComparison(item, options.compareSlot, current) : '';
  return `<article class="gear-card" data-rarity="${item.rarity}" data-testid="gear-card-${escapeHtml(item.instanceId)}">
    <div class="gear-card-top"><span class="gear-rarity">${item.rarity}</span><span class="gear-slot">${template.slot}</span></div>
    <h4>${escapeHtml(template.name)}</h4>
    <p class="gear-level">Item Lv ${item.ilvl} · ${item.upgradeLevel > 0 ? `+${item.upgradeLevel}` : 'Unupgraded'}${options.equipped ? ' · Equipped' : ''}</p>
    <div class="gear-stat-lines">${stats.join('') || '<span>Steady little find</span>'}</div>
    ${affixes.length ? `<ul class="gear-affixes">${affixes.join('')}</ul>` : '<p class="gear-no-affix">No extra affix</p>'}
    ${comparison}
    ${controls.length ? `<div class="gear-card-actions">${controls.join('')}</div>` : ''}
  </article>`;
}

function renderGearWallet(current: GameState): void {
  const wallet = must<HTMLDivElement>('#gear-wallet');
  setMarkupIfChanged(wallet, `<span><small>Coins</small><strong>${current.dungeon.coins}</strong></span><span><small>Scrap</small><strong>${current.dungeon.scrap}</strong></span><span><small>Essence</small><strong>${current.dungeon.essence}</strong></span><span><small>Stones</small><strong>${current.evolution.evolutionStones}</strong></span>`);
}

function renderGearLoadout(current: GameState): string {
  const slots: EquipmentSlot[] = ['Weapon', 'Armor', 'Hat', 'Charm'];
  const slotCards = slots.map((slot) => {
    const item = current.equipment.equipped[slot];
    const candidates = current.equipment.inventory.filter((candidate) => getItemTemplate(candidate.templateId)?.slot === slot);
    return `<section class="gear-slot-panel"><div class="gear-slot-heading"><h3>${slot}</h3><span>${item ? 'Worn by Pip' : 'Empty slot'}</span></div>
      ${item ? renderGearItem(item, current, { showUnequip: slot, showUpgrade: true, equipped: true }) : '<p class="gear-empty-slot">A good find can live here.</p>'}
      ${candidates.length ? `<div class="gear-candidates"><h4>Try on</h4>${candidates.map((candidate) => renderGearItem(candidate, current, { compareSlot: slot, showEquip: true, showScrap: true })).join('')}</div>` : ''}
    </section>`;
  }).join('');
  const stats = getEffectiveStats(current);
  const sets = Object.entries(getEquipmentSetCounts(current.equipment)).map(([setId, count]) => {
    const set = getSetDefinition(setId);
    if (!set) return '';
    const pieces = count >= 4 ? 4 : count >= 2 ? 2 : 0;
    const effects = pieces ? set.bonuses[String(pieces) as '2' | '4'].map((effect) => describeGearEffect(effect)).join(' · ') : 'Find more pieces to wake the set.';
    return `<div class="gear-set-line"><strong>${escapeHtml(set.name)}</strong><span>${count} / 4 pieces</span><small>${pieces ? `${pieces}-piece bonus: ${escapeHtml(effects)}` : escapeHtml(effects)}</small></div>`;
  }).join('');
  const combat = getEquipmentCombatEffects(current.equipment, getFormDefinition(current.evolution.formId)?.element ?? 'fire');
  return `<section class="gear-overview"><div><p class="eyebrow">Pip's current kit</p><h3>Every little piece counts.</h3></div><div class="gear-stat-ribbon">${(Object.keys(statLabels) as StatKey[]).map((key) => `<span><small>${key}</small><strong>${stats[key]}</strong></span>`).join('')}</div>
    <p class="gear-bonus-note">Gear: ${Math.round(combat.critChance * 100)}% crit · ${Math.round(combat.lifesteal * 100)}% life return · ${Math.round(combat.resist * 100)}% resistance · +${Math.round(combat.coinFind * 100)}% coins</p></section>
    <section class="gear-set-shelf" aria-labelledby="gear-sets-title"><h3 id="gear-sets-title">Set marks</h3>${sets || '<p>Matching pieces share a set mark. Two pieces and four pieces wake a bonus.</p>'}</section>
    <div class="gear-loadout-grid">${slotCards}</div>
    ${current.dungeon.activeRun ? '<p class="gear-lock-note">Gear is locked until the current run ends.</p>' : ''}`;
}

function renderGearBag(current: GameState): string {
  const selected = current.equipment.inventory.filter((item) => selectedFuseIds.includes(item.instanceId));
  const matching = selected.length === equipmentRules.fusion.inputCount && equipmentItemsHaveSameSlotAndRarity(selected);
  const nextRarity = matching ? nextFusionRarity(selected[0]!.rarity) : null;
  const commonInputs = matching && selected[0]!.rarity === 'Common';
  const availableAffixes = [...new Map(selected.flatMap((item) => getItemPreview(item)?.affixes ?? []).map((affix) => [affix.id, affix])).values()];
  const keepAffix = gearContent.querySelector<HTMLSelectElement>('#fusion-affix')?.value ?? '';
  const homeEffects = getHomeEffects(current.home);
  const fusionScrapCost = Math.max(1, Math.floor(equipmentRules.fusion.scrapCostBase * homeEffects.fusionCostMultiplier));
  const canFuse = Boolean(matching && nextRarity && (commonInputs || availableAffixes.some((affix) => affix.id === keepAffix)) && !current.paused && !current.dungeon.activeRun && current.dungeon.scrap >= fusionScrapCost);
  const runItems = current.dungeon.activeRun?.pendingItems ?? [];
  const fusionPanel = `<section class="gear-fusion-panel"><div><p class="eyebrow">Three become one</p><h3>Fusion</h3><p>Choose three items of the same slot and rarity. Common gear rolls a new affix; higher rarities keep one you choose.</p></div>
    <p class="fusion-count" aria-live="polite">${selected.length} / ${equipmentRules.fusion.inputCount} selected</p>
    ${matching && nextRarity && !commonInputs ? `<label class="gear-field" for="fusion-affix">Keep an affix<select id="fusion-affix"><option value="">Choose an affix</option>${availableAffixes.map((affix) => `<option value="${escapeHtml(affix.id)}" ${keepAffix === affix.id ? 'selected' : ''}>${escapeHtml(getAffixDefinition(affix.id)?.name ?? affix.name)}</option>`).join('')}</select></label>` : ''}
    <button class="primary-button" type="button" data-gear-action="fuse" ${canFuse ? '' : 'disabled'}>${nextRarity ? `Fuse into ${nextRarity} · ${fusionScrapCost} Scrap` : 'Choose three matching items'}</button>
    ${matching && nextRarity && current.dungeon.scrap < fusionScrapCost ? `<small>Fusion needs ${fusionScrapCost} Scrap.</small>` : ''}
    ${selected.length === equipmentRules.fusion.inputCount && !matching ? '<small>Those items do not share a slot and rarity.</small>' : ''}
  </section>`;
  const items = current.equipment.inventory.map((item) => renderGearItem(item, current, { showEquip: true, showScrap: true, showFuse: true })).join('');
  const autoScrapOptions: Array<ItemRarity | 'off'> = ['off', ...equipmentRules.fusion.rarityOrder];
  const runGearShelf = current.dungeon.activeRun ? `<section class="run-gear-shelf"><div class="gear-slot-heading"><h3>Carried this run</h3><span>${runItems.length} item${runItems.length === 1 ? '' : 's'}</span></div><p class="gear-bag-hint">These finds are still at risk until you safely bank or salvage them at the end of a run.</p>${runItems.length ? `<div class="run-gear-list">${runItems.map((item) => renderGearItem(item, current)).join('')}</div>` : '<p class="gear-empty-slot">No gear carried yet. Shop buys and drops appear here until the run ends.</p>'}</section>` : '';
  return `<section class="gear-bag-head"><div><p class="eyebrow">A little shelf for finds</p><h3>Your bag</h3></div><span>${current.equipment.inventory.length} / ${homeEffects.inventoryCapacity}</span>
    <label class="gear-field" for="auto-scrap-select">Auto-scrap new drops<select id="auto-scrap-select" ${current.paused || current.dungeon.activeRun ? 'disabled' : ''}>${autoScrapOptions.map((value) => `<option value="${value}" ${current.equipment.autoScrapThrough === value ? 'selected' : ''}>${value === 'off' ? 'Off' : `Through ${value}`}</option>`).join('')}</select></label></section>
    ${current.equipment.inventory.length ? '<p class="gear-bag-hint">Pick an item to equip it, or scrap it for upgrade material. Select three matching pieces to fuse.</p>' : '<p class="gear-empty-bag">Your bag is quiet for now. Elites, bosses and treasure rooms can leave gear behind.</p>'}
    ${items ? `<div class="gear-bag-grid">${items}</div>` : ''}${fusionPanel}${runGearShelf}
    ${current.dungeon.activeRun ? '<p class="gear-lock-note">Bag changes are locked until the current run ends.</p>' : ''}`;
}

function renderGearWorkshop(current: GameState): string {
  const items = [
    ...current.equipment.inventory.map((item) => ({ item, equipped: false })),
    ...Object.values(current.equipment.equipped).filter((item): item is EquipmentItem => item !== null).map((item) => ({ item, equipped: true })),
  ];
  const essenceCost = equipmentRules.currencies.essencePerEvolutionStone;
  const workshopCards = items.map(({ item, equipped }) => renderGearItem(item, current, { showUpgrade: true, equipped })).join('');
  return `<section class="workshop-intro"><p class="eyebrow">A careful tune-up</p><h3>Help a good find grow.</h3><p>Upgrades add 8% per level. Attempts through +5 always work; later misses drop one level, never destroy the item.</p></section>
    <section class="stone-crafting"><div><strong>Evolution Stone</strong><small>Trade ${essenceCost} Essence for one reroll stone.</small></div><button class="gear-action" type="button" data-gear-action="craft-stone" ${current.paused || current.dungeon.activeRun || current.dungeon.essence < essenceCost ? 'disabled' : ''}>Craft · ${essenceCost} Essence</button></section>
    ${workshopCards ? `<div class="gear-workshop-grid">${workshopCards}</div>` : '<p class="gear-empty-bag">Bring a piece of gear back from a run to begin upgrading it.</p>'}
    <button class="quiet-button" type="button" data-gear-tab="bag">Choose three items to fuse</button>
    ${current.dungeon.activeRun ? '<p class="gear-lock-note">Workshop actions are locked until the current run ends.</p>' : ''}`;
}

function renderEquipment(current: GameState): void {
  const availableIds = new Set(current.equipment.inventory.map((item) => item.instanceId));
  selectedFuseIds = selectedFuseIds.filter((id) => availableIds.has(id));
  renderGearWallet(current);
  gearDialog.querySelectorAll<HTMLButtonElement>('[data-gear-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.gearTab === selectedGearTab));
  });
  const markup = selectedGearTab === 'loadout'
    ? renderGearLoadout(current)
    : selectedGearTab === 'bag'
      ? renderGearBag(current)
      : renderGearWorkshop(current);
  setMarkupIfChanged(gearContent, markup);
}

function renderHomeUpgrades(current: GameState): string {
  const effects = getHomeEffects(current.home, current.formDex.length);
  const upgradeCards = getHomeUpgradeDefinitions().map((upgrade) => {
    const level = current.home.upgradeLevels[upgrade.id];
    const cost = getHomeUpgradeCost(current.home, upgrade.id);
    const effectText: Record<HomeUpgradeId, string> = {
      kitchen: `Snacks ×${effects.feedEffectMultiplier.toFixed(2)} · ${effects.packSlots} pack slots · next meal +${Math.round(effects.mealStatBonus * 100)}% to one stat`,
      gym: `Training cap ${getTrainingCap(current.level, level)} per stat · mini-game rewards ×${effects.miniGameRewardMultiplier.toFixed(2)}`,
      workshop: `Bag ${current.equipment.inventory.length}/${effects.inventoryCapacity} · upgrades ${Math.round((1 - effects.upgradeCostMultiplier) * 100)}% cheaper · fusion ${Math.round((1 - effects.fusionCostMultiplier) * 100)}% cheaper`,
      nursery: `Next-generation stat legacy +${Math.round(effects.legacyStatBonusPerGeneration * 100)}% · extra inherited traits ${effects.extraInheritedTraits}`,
      library: `Form discovery stat bonus +${((effects.dexStatMultiplier - 1) * 100).toFixed(1)}% · evolution clues ${effects.weightHintLevel ? (effects.advancedWeightHintLevel ? 'advanced' : 'basic') : 'locked'}`,
    };
    const atMaximum = cost === null;
    return `<article class="home-upgrade-card" data-upgrade="${upgrade.id}">
      <div class="home-upgrade-top"><span class="home-upgrade-icon" aria-hidden="true">${escapeHtml(upgrade.icon)}</span><div><h3>${escapeHtml(upgrade.name)}</h3><span class="home-level">Level ${level} / 5</span></div></div>
      <p>${escapeHtml(upgrade.description)}</p><p class="home-effect-line">${escapeHtml(effectText[upgrade.id])}</p>
      <button class="home-action" type="button" data-home-action="upgrade" data-upgrade-id="${upgrade.id}" ${current.paused || current.dungeon.activeRun || atMaximum || current.dungeon.coins < (cost ?? 0) ? 'disabled' : ''}>${atMaximum ? 'Fully upgraded' : `Upgrade · ${cost} coins`}</button>
    </article>`;
  }).join('');
  const meal = current.home.preparedMeal;
  const mealOptions = (Object.keys(statLabels) as StatKey[]).map((stat) => `<option value="${stat}" ${selectedMealStat === stat ? 'selected' : ''}>${statLabels[stat]} (${stat})</option>`).join('');
  const mealPanel = `<section class="home-meal"><div><p class="eyebrow">Kitchen · next run</p><h3>Prepare a little meal</h3><p>A free, one-run boost. The meal is consumed when Pip enters the dungeon.</p></div>
    ${meal ? `<p class="meal-ready" role="status">Meal ready: +${Math.round(meal.bonus * 100)}% ${statLabels[meal.stat]} for the next run.</p>` : `<label class="home-field" for="home-meal-stat">Choose a stat<select id="home-meal-stat" ${current.paused || current.dungeon.activeRun ? 'disabled' : ''}>${mealOptions}</select></label><button class="home-action" type="button" data-home-action="cook-meal" ${current.paused || current.dungeon.activeRun ? 'disabled' : ''}>Cook meal · +${Math.round(effects.mealStatBonus * 100)}%</button>`}
    ${current.dungeon.activeRun ? '<small class="home-lock-note">You can prepare the next meal after returning.</small>' : ''}</section>`;
  return `<section class="home-intro"><p class="eyebrow">Every run builds something</p><h3>Small improvements, carried forward.</h3><p>Upgrades cost banked coins. A run must be finished before changing Home.</p></section><div class="home-upgrade-grid">${upgradeCards}</div>${mealPanel}`;
}

function renderHomeAchievements(current: GameState): string {
  const statuses = getAchievementStatuses(current);
  const cards = statuses.map((achievement) => {
    const percent = Math.min(100, Math.round(achievement.progress / Math.max(1, achievement.target) * 100));
    const rewardParts = [
      achievement.rewards.coins ? `${achievement.rewards.coins} coins` : '',
      achievement.rewards.essence ? `${achievement.rewards.essence} Essence` : '',
      ...achievement.rewards.cosmetics.map((id) => getCosmeticName(id)),
    ].filter(Boolean);
    return `<article class="home-achievement${achievement.unlocked ? ' is-unlocked' : ''}">
      <div class="achievement-top"><div><h3>${escapeHtml(achievement.title)}</h3><p>${escapeHtml(achievement.description)}</p></div><span class="achievement-state">${achievement.unlocked ? 'Unlocked' : 'In progress'}</span></div>
      <div class="achievement-progress"><span>${achievement.progress} / ${achievement.target}</span><div role="progressbar" aria-label="${escapeHtml(achievement.title)} progress" aria-valuemin="0" aria-valuemax="${achievement.target}" aria-valuenow="${achievement.progress}"><span style="width:${percent}%"></span></div></div>
      <small class="achievement-reward">Reward: ${escapeHtml(rewardParts.join(' · ') || 'A little keepsake')}</small>
    </article>`;
  }).join('');
  const keepsakes = current.home.unlockedCosmeticIds.length
    ? current.home.unlockedCosmeticIds.map((id) => `<span class="keepsake-chip"><span aria-hidden="true">✦</span>${escapeHtml(getCosmeticName(id))}</span>`).join('')
    : '<p class="home-empty">Keepsakes will appear here when an achievement unlocks one.</p>';
  return `<section class="home-intro"><p class="eyebrow">Little milestones</p><h3>${current.home.unlockedAchievementIds.length} of ${statuses.length} achievements</h3><p>Rewards arrive automatically when a goal is reached.</p></section><div class="achievement-grid">${cards}</div><section class="home-keepsakes"><h3>Unlocked keepsakes</h3><div class="keepsake-list">${keepsakes}</div></section>`;
}

function renderHomeRecords(current: GameState): string {
  const activeSets = Object.values(getEquipmentSetCounts(current.equipment)).filter((count) => count >= 2).length;
  const entries: Array<[string, string | number]> = [
    ['Current generation', current.generation],
    ['Lifetime room clears', current.records.totalRoomsCleared],
    ['Bosses defeated', current.records.bossesDefeated],
    ['Runs completed', current.dungeon.runsCompleted],
    ['Safe returns', current.records.runsLeftSafely],
    ['Faints', current.records.runsFainted],
    ['Deepest floor · this pet', current.dungeon.petDeepestFloor],
    ['Deepest floor · all time', current.dungeon.deepestFloor],
    ['Best floor in one run', current.records.bestRunFloor],
    ['Coins banked · lifetime', current.records.totalCoinsBanked],
    ['Forms discovered', `${current.formDex.length} / ${getAllForms().length}`],
    ['Active 2-piece sets', activeSets],
    ['Keepsakes unlocked', current.home.unlockedCosmeticIds.length],
  ];
  return `<section class="home-intro"><p class="eyebrow">A growing little history</p><h3>Pip's records</h3><p>Milestones and totals stay on this device.</p></section><div class="record-grid">${entries.map(([label, value]) => `<div class="record-card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value))}</strong></div>`).join('')}</div>`;
}

function renderHomeEndless(current: GameState): string {
  const today = getCurrentUtcDateKey();
  const dailyUsed = current.endless.dailyAttemptDate === today;
  const canStart = !current.paused && !current.dungeon.activeRun && current.stage !== 'egg' && !current.sleeping && Boolean(current.evolution.formId);
  const dailyStatus = dailyUsed ? 'Today’s attempt is already used. A new trial opens at 00:00 UTC.' : 'One attempt per UTC date. The route seed is fixed for today and works offline.';
  const milestone = getAscensionMilestone(current.endless.ascensionRank);
  const canAscend = canStart && milestone !== null && current.endless.bestFloorSinceAscension >= milestone;
  const perks = getAscensionPerks().map((perk) => {
    const rank = current.endless.ascensionPerks[perk.id];
    const disabled = !canAscend || rank >= perk.maxStacks;
    return `<article class="ascension-perk"><div><h4>${escapeHtml(perk.name)}</h4><p>${escapeHtml(perk.description)}</p></div><span class="perk-rank">${rank}/${perk.maxStacks}</span><button class="endless-action" type="button" data-endless-action="ascend" data-perk-id="${perk.id}" ${disabled ? 'disabled' : ''}>Ascend with this perk</button></article>`;
  }).join('');
  const modifiers = getDifficultyModifiers();
  const selectedCount = current.endless.selectedModifierIds.length;
  const modifierRows = modifiers.map((modifier) => {
    const checked = current.endless.selectedModifierIds.includes(modifier.id);
    const locked = current.paused || Boolean(current.dungeon.activeRun) || (!checked && selectedCount >= endlessRules.difficultyModifiers.selectionLimit);
    return `<label class="modifier-row"><input type="checkbox" data-endless-modifier value="${modifier.id}" data-testid="modifier-${modifier.id}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>${escapeHtml(modifier.name)}</strong><small>${escapeHtml(modifier.description)}</small></span></label>`;
  }).join('');
  const discovered = new Set(current.endless.defeatedEnemyIds);
  const bestiaryRows = dungeonData.enemies.map((enemy) => {
    const found = discovered.has(enemy.id);
    const biome = dungeonData.biomes.find((entry) => entry.id === enemy.biomeId)?.name ?? 'Unknown biome';
    return `<li class="bestiary-entry${found ? ' is-known' : ' is-unknown'}"><strong>${found ? escapeHtml(enemy.name) : 'Unrecorded visitor'}</strong><small>${found ? escapeHtml(biome) : 'Meet this creature in the descent'}</small><span>${found ? 'Found' : 'Hidden'}</span></li>`;
  }).join('');
  const bestiaryBonus = Math.round((getBestiaryCoinMultiplier(current.endless.defeatedEnemyIds) - 1) * 100);
  const petReady = Boolean(createPetCodePayload(current));
  const battleResult = ghostBattleResult
    ? `<section class="ghost-result" data-testid="ghost-result" role="status"><h4>${ghostBattleResult.winner === 'pocket-pal' ? 'Pip wins this friendly match' : ghostBattleResult.winner === 'ghost' ? 'The visiting pet wins' : 'A very even match'}</h4><p>${ghostBattleResult.turns} exchanges · Pip ${ghostBattleResult.pocketPalHp} HP · visitor ${ghostBattleResult.ghostHp} HP</p><ol>${ghostBattleResult.log.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol></section>`
    : ghostBattleError
      ? `<p class="ghost-error" role="alert">${escapeHtml(ghostBattleError)}</p>`
      : '<p class="ghost-empty">A battle is a local simulation. It gives no rewards and changes neither pet nor save.</p>';
  return `<div class="endless-layout">
    <section class="endless-daily"><div><h3>Daily trail</h3><p class="daily-date">${today} · UTC</p><p>${dailyStatus} There is no online leaderboard.</p></div><div class="daily-best"><small>Your best</small><strong>Floor ${current.endless.dailyBestFloor}</strong><span>${current.endless.dailyBestDate ?? 'No trial recorded yet'}</span></div><button class="endless-action" type="button" data-endless-action="daily" data-testid="open-daily-trial" ${dailyUsed || !canStart ? 'disabled' : ''}>${dailyUsed ? 'Today’s trial used' : 'Open today’s trial'}</button></section>
    <section class="endless-section ascension-section"><h3>Ascension</h3><p class="endless-copy">Reach a depth milestone, then restart the dungeon at a harder scale for one permanent perk.</p><div class="ascension-progress"><span>Rank <strong>${current.endless.ascensionRank}</strong></span><span>Best since ascension <strong>Floor ${current.endless.bestFloorSinceAscension}</strong></span><span>${milestone === null ? 'Maximum rank reached' : `Next milestone · Floor ${milestone}`}</span></div><div class="ascension-perks">${perks}</div>${milestone !== null && !canAscend ? `<p class="endless-lock">Reach floor ${milestone} in a run, then return safely to ascend.</p>` : ''}</section>
    <section class="endless-section modifier-section"><h3>Challenge modifiers</h3><p class="endless-copy">Choose up to ${endlessRules.difficultyModifiers.selectionLimit} for a standard run. Tougher enemies bring better rewards; Daily trials ignore these choices.</p><div class="modifier-list">${modifierRows}</div><p class="modifier-count">${selectedCount} / ${endlessRules.difficultyModifiers.selectionLimit} selected</p></section>
    <section class="endless-section bestiary-section"><div class="section-heading-line"><div><h3>Bestiary</h3><p class="endless-copy">Record encounters for a small, permanent coin bonus.</p></div><strong>${discovered.size} / ${dungeonData.enemies.length}</strong></div><p class="bestiary-bonus">Field notes bonus · +${bestiaryBonus}% run coins</p><ul class="bestiary-list">${bestiaryRows}</ul></section>
    <section class="endless-section ghost-section"><h3>Ghost battles</h3><p class="endless-copy">Share a short pet code with a friend, then simulate a friendly match on this device. Codes are checked and bounded before use; nothing is sent online.</p><div class="ghost-code-grid"><div class="ghost-code-column"><label for="pet-code-output">Your pet code</label><textarea id="pet-code-output" data-testid="pet-code-output" readonly rows="3" maxlength="${endlessRules.petCodes.maximumEncodedCharacters}" spellcheck="false">${escapeHtml(petCodeOutput)}</textarea><div class="ghost-buttons"><button class="endless-action" type="button" data-endless-action="export" ${!petReady ? 'disabled' : ''}>Create my code</button><button class="endless-action is-secondary" type="button" data-endless-action="copy-code" ${!petCodeOutput ? 'disabled' : ''}>Copy code</button></div></div><div class="ghost-code-column"><label for="ghost-code-input">Friend’s pet code</label><textarea id="ghost-code-input" data-testid="ghost-code-input" rows="3" maxlength="${endlessRules.petCodes.maximumEncodedCharacters}" spellcheck="false">${escapeHtml(ghostCodeInput)}</textarea><button class="endless-action" type="button" data-endless-action="ghost-battle" ${!petReady || current.paused ? 'disabled' : ''}>Validate and battle</button></div></div>${battleResult}</section>
  </div>`;
}

function renderHome(current: GameState): void {
  setMarkupIfChanged(homeWallet, `<span><small>Coins</small><strong>${current.dungeon.coins}</strong></span><span><small>Scrap</small><strong>${current.dungeon.scrap}</strong></span><span><small>Essence</small><strong>${current.dungeon.essence}</strong></span><span><small>Achievements</small><strong>${current.home.unlockedAchievementIds.length}</strong></span>`);
  homeDialog.querySelectorAll<HTMLButtonElement>('[data-home-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.homeTab === selectedHomeTab));
  });
  const markup = selectedHomeTab === 'upgrades'
    ? renderHomeUpgrades(current)
    : selectedHomeTab === 'achievements'
      ? renderHomeAchievements(current)
      : selectedHomeTab === 'records'
        ? renderHomeRecords(current)
        : renderHomeEndless(current);
  setMarkupIfChanged(homeContent, markup);
}

function healthMeter(label: string, value: number, maximum: number, kind: string): string {
  const percent = Math.max(0, Math.min(100, Math.round((value / Math.max(1, maximum)) * 100)));
  return `<div class="dungeon-meter dungeon-meter-${kind}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${Math.round(maximum)}" aria-valuenow="${Math.round(value)}"><span style="width:${percent}%"></span><small>${escapeHtml(label)} · ${Math.round(value)} / ${Math.round(maximum)}</small></div>`;
}

const roomPresentation: Record<DungeonRoomType, { title: string; detail: string; mark: string }> = {
  fight: { title: 'Skirmish', detail: 'A quick auto-fight and a handful of coins.', mark: '✦' },
  elite: { title: 'Elite', detail: 'A tougher foe with a brighter reward.', mark: '◆' },
  event: { title: 'Event', detail: 'Choose a little risk or a little reward.', mark: '☼' },
  treasure: { title: 'Treasure', detail: 'Open a chest for run coins, a token chance and a gear find.', mark: '▣' },
  rest: { title: 'Rest', detail: 'Restore health and a little energy.', mark: '☾' },
  shop: { title: 'Shop', detail: 'Spend run coins on a pack tonic or gear.', mark: '⌂' },
  boss: { title: 'Boss', detail: 'A single room with a two-part challenge.', mark: '♛' },
};

function renderPack(run: DungeonRunState): string {
  if (!run.consumables.length) return '<p class="pack-empty">Your pack is empty. Look for a shop or event on the next floor.</p>';
  return `<div class="dungeon-pack-list">${run.consumables.map((id, slot) => {
    const item = dungeonData.consumables.find((candidate) => candidate.id === id);
    if (!item) return '';
    return `<button class="pack-item" type="button" data-run-action="use" data-slot="${slot}" aria-label="Use ${escapeHtml(item.name)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span><span class="pack-use">Use</span></button>`;
  }).join('')}</div>`;
}

function renderStageTabContent(current: GameState, tab: Exclude<StageTab, 'care'>): string {
  const run = current.dungeon.activeRun;
  if (tab === 'pack') {
    if (!run) {
      return `<div class="stage-tab-empty"><p>No active run. Your pocket world is at home.</p><p>Banked wallet · ${current.dungeon.coins} coins · ${current.dungeon.scrap} Scrap · ${current.dungeon.essence} Essence</p><button class="quiet-button" type="button" data-stage-open="dungeon">Plan a descent</button></div>`;
    }
    return `<div class="stage-tab-heading"><div><p class="eyebrow">Floor ${run.floor} · ${escapeHtml(stageLocation(current))}</p><h3>Run pack & finds</h3></div><button class="quiet-button" type="button" data-stage-open="dungeon">Details</button></div>
      <div class="stage-ledger"><span><small>Run coins</small><strong>${run.coins}</strong></span><span><small>Run materials</small><strong>${run.pendingScrap} Scrap · ${run.pendingEssence} Essence</strong></span><span><small>Bagged gear</small><strong>${run.pendingItems.length + (run.pendingItem ? 1 : 0)}</strong></span><span><small>Banked wallet</small><strong>${current.dungeon.coins}c · ${current.dungeon.scrap} Scrap</strong></span></div>
      <div class="stage-pack-items">${renderPack(run)}</div>`;
  }
  if (tab === 'gear') {
    const slots: EquipmentSlot[] = ['Weapon', 'Armor', 'Hat', 'Charm'];
    const rows = slots.map((slot) => {
      const item = current.equipment.equipped[slot];
      const template = item ? getItemTemplate(item.templateId) : null;
      return `<div class="stage-gear-line"><span>${slot}</span><strong>${template ? escapeHtml(template.name) : 'Empty slot'}</strong><small>${item ? item.rarity : 'A good find can live here'}</small></div>`;
    }).join('');
    return `<div class="stage-tab-heading"><div><p class="eyebrow">Pip's current kit</p><h3>Gear & workshop</h3></div><button class="quiet-button" type="button" data-stage-open="gear">Open</button></div><div class="stage-gear-list">${rows}</div>`;
  }
  if (tab === 'log') {
    const entries = run?.combatLog.slice(-10) ?? [];
    return `<div class="stage-tab-heading"><div><p class="eyebrow">${run ? `Floor ${run.floor}` : 'Pocket journal'}</p><h3>Recent moments</h3></div></div>${entries.length
      ? `<ol class="stage-log-list" role="log" aria-label="Recent expedition log">${entries.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>`
      : '<p class="stage-tab-empty">Pip’s little adventures will leave a note here.</p>'}`;
  }
  const stats = getEffectiveStats(current);
  return `<div class="stage-tab-heading"><div><p class="eyebrow">Level ${current.level} · ${current.stage}</p><h3>Growth & tendencies</h3></div></div>
    <div class="stage-stats-grid">${(Object.keys(statLabels) as StatKey[]).map((key) => `<span><small>${key}</small><strong>${stats[key]}</strong><em>+${current.training[key]} trained</em></span>`).join('')}</div>
    <p class="stage-stat-note">${escapeHtml(must<HTMLParagraphElement>('#tendency-summary').textContent ?? 'Care shapes the next form.')}</p>`;
}

function renderStageSheet(current: GameState): void {
  root?.querySelectorAll<HTMLButtonElement>('[data-stage-tab]').forEach((button) => {
    if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(button.dataset.stageTab === selectedStageTab));
  });
  (['pack', 'gear', 'care', 'log', 'stats'] as StageTab[]).forEach((tab) => {
    const panel = must<HTMLElement>(`#stage-tab-${tab}`);
    panel.hidden = tab !== selectedStageTab;
    if (tab !== 'care') panel.innerHTML = renderStageTabContent(current, tab);
  });
}

function readAnimationSpeed(): AnimationSpeed {
  try {
    const value = localStorage.getItem('pocket-pal-animation-speed');
    return value === '2x' || value === 'skip' ? value : '1x';
  } catch {
    return '1x';
  }
}

function animationSpeedLabel(speed: AnimationSpeed): string {
  return speed === 'skip' ? 'Skip' : speed === '2x' ? '2×' : '1×';
}

function renderDungeonStart(current: GameState): string {
  const active = current.stage !== 'egg' && !current.sleeping && Boolean(current.evolution.formId);
  const packLimit = getHomeEffects(current.home, current.formDex.length).packSlots;
  const meal = current.home.preparedMeal;
  const today = getCurrentUtcDateKey();
  const dailyUsed = current.endless.dailyAttemptDate === today;
  const selectedModifierNames = getDifficultyModifiers().filter((modifier) => current.endless.selectedModifierIds.includes(modifier.id)).map((modifier) => modifier.name);
  const items = dungeonData.consumables.map((item) => `
    <label class="pack-choice">
      <input type="checkbox" data-pack-item value="${escapeHtml(item.id)}" ${selectedDungeonPack.includes(item.id) ? 'checked' : ''} />
      <span class="pack-choice-mark" aria-hidden="true">✦</span>
      <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span>
    </label>`).join('');
  const reason = current.stage === 'egg' || !current.evolution.formId
    ? 'Pip can enter after hatching.'
    : current.sleeping
      ? 'Wake Pip before setting out.'
    : `Choose up to ${packLimit} run-only items. Unused items leave with the run.${meal ? ` Your meal will boost ${meal.stat} by ${Math.round(meal.bonus * 100)}%.` : ''}`;
  return `<div class="dungeon-start-grid">
    <section class="dungeon-start-story"><h3>Make a small plan, then see how far Pip can go.</h3><p>${escapeHtml(reason)}</p><div class="run-mode-picker" role="group" aria-label="Dungeon run mode"><button class="run-mode-choice" type="button" data-run-mode="standard" aria-pressed="${selectedDungeonMode === 'standard'}"><strong>Standard</strong><small>Choose your challenge settings</small></button><button class="run-mode-choice" type="button" data-run-mode="daily" data-testid="daily-mode" aria-pressed="${selectedDungeonMode === 'daily'}" ${dailyUsed ? 'disabled' : ''}><strong>Daily trial</strong><small>${today} · UTC${dailyUsed ? ' · already used' : ''}</small></button></div><p class="dungeon-note">${selectedDungeonMode === 'daily' ? `Today’s route uses a fixed seed. One attempt per UTC date; modifiers are off.${dailyUsed ? ' Today’s attempt is already used.' : ''}` : selectedModifierNames.length ? `Standard modifiers: ${escapeHtml(selectedModifierNames.join(', '))}. Change them in Home → Endless.` : 'Standard route · optional modifiers can be set in Home → Endless.'}</p>
      <div class="dungeon-records"><span><strong>${current.dungeon.coins}</strong><small>banked coins</small></span><span><strong>${current.dungeon.scrap}</strong><small>Scrap</small></span><span><strong>${current.dungeon.essence}</strong><small>Essence</small></span><span><strong>${current.dungeon.petDeepestFloor}</strong><small>this pet's best floor</small></span></div>
      <p class="dungeon-note">Leave safely to bank all carried gear and materials. Fainting keeps half the coins, random half the gear and half the materials.</p>
    </section>
    <section class="pack-picker" aria-labelledby="pack-title"><div class="dungeon-section-heading"><div><p class="eyebrow">Before the first step</p><h3 id="pack-title">Pack up to ${packLimit} items</h3></div><span class="pack-count" id="pack-count">0 / ${packLimit}</span></div>
      <div class="pack-choice-list">${items}</div>
      <button class="primary-button dungeon-start-button" type="button" data-run-action="start" data-testid="dungeon-start" ${active && !current.paused && !(selectedDungeonMode === 'daily' && dailyUsed) ? '' : 'disabled'}>${selectedDungeonMode === 'daily' ? 'Start today’s trial' : 'Start a run'}</button>
    </section>
  </div>`;
}

function bindDungeonStartControls(current: GameState): void {
  const startButton = dungeonContent.querySelector<HTMLButtonElement>('[data-run-action="start"]');
  if (startButton) startButton.disabled = current.paused || current.stage === 'egg' || current.sleeping || !current.evolution.formId
    || (selectedDungeonMode === 'daily' && current.endless.dailyAttemptDate === getCurrentUtcDateKey());
  const packChecks = [...dungeonContent.querySelectorAll<HTMLInputElement>('[data-pack-item]')];
  const packCount = dungeonContent.querySelector<HTMLElement>('#pack-count');
  const packLimit = getHomeEffects(current.home, current.formDex.length).packSlots;
  const refreshPackCount = () => {
    const selectedChecks = packChecks.filter((check) => check.checked);
    selectedDungeonPack = selectedChecks.map((check) => check.value);
    const selected = selectedChecks.length;
    if (packCount) packCount.textContent = `${selected} / ${packLimit}`;
    packChecks.forEach((check) => { check.disabled = !check.checked && selected >= packLimit; });
  };
  packChecks.forEach((check) => check.addEventListener('change', refreshPackCount));
  refreshPackCount();
}

function renderDungeon(current: GameState): void {
  const run = current.dungeon.activeRun;
  if (!run) {
    dungeonContent.innerHTML = renderDungeonStart(current);
    bindDungeonStartControls(current);
    return;
  }
  selectedDungeonPack = [];
  const homeEffects = getHomeEffects(current.home, current.formDex.length);

  const biome = dungeonData.biomes.find((item) => item.id === run.biomeId) ?? getBiomeForFloor(run.floor);
  const roomCount = run.floor % dungeonData.rooms.bossEveryFloors === 0 ? 1 : dungeonData.rooms.roomsPerFloor;
  const nodes = Array.from({ length: roomCount }, (_, index) => {
    const currentNode = index === run.roomIndex && run.phase !== 'floor-end' && run.phase !== 'summary';
    const cleared = index < run.roomIndex || (run.phase === 'summary' && run.result === 'left');
    const label = currentNode && run.currentRoom ? roomPresentation[run.currentRoom].title : cleared ? 'Cleared' : `Room ${index + 1}`;
    return `<li class="path-node${currentNode ? ' is-current' : ''}${cleared ? ' is-cleared' : ''}" aria-current="${currentNode ? 'step' : 'false'}"><span class="path-node-mark">${cleared ? '✓' : currentNode && run.currentRoom ? roomPresentation[run.currentRoom].mark : index + 1}</span><span>${escapeHtml(label)}</span></li>`;
  }).join('');
  const runStats = Object.entries(run.runStatMultipliers)
    .filter(([, multiplier]) => Math.abs(multiplier - 1) > 0.001)
    .map(([key, multiplier]) => `${key} ×${multiplier.toFixed(2)}`);
  const modifiers = [
    ...(run.mode === 'daily' && run.dailyDateKey ? [`Daily trial · ${run.dailyDateKey} UTC`] : [`Standard · Ascension ${run.ascensionRank}`]),
    ...run.modifierIds.map((id) => getDifficultyModifiers().find((modifier) => modifier.id === id)?.name).filter((name): name is string => Boolean(name)),
    ...runStats,
    ...(Math.abs(run.coinMultiplier - 1) > 0.001 ? [`Coins ×${run.coinMultiplier.toFixed(2)}`] : []),
  ];

  let stage = '';
  if (run.phase === 'choice') {
    stage = `<section class="dungeon-decision"><p class="eyebrow">Choose the next room</p><h3>Which path feels right?</h3><div class="room-choice-list">${run.roomChoices.map((type) => {
      const item = roomPresentation[type];
      return `<button class="room-choice" type="button" data-run-action="room" data-room-type="${type}" data-testid="room-${type}"><span class="room-choice-mark" aria-hidden="true">${item.mark}</span><span><strong>${item.title}</strong><small>${item.detail}</small></span><span class="room-choice-prompt">Choose</span></button>`;
    }).join('')}</div></section>`;
  } else if (run.phase === 'tactic' && run.enemy) {
    const enemy = run.enemy;
    stage = `<section class="dungeon-decision"><p class="eyebrow">Before the fight</p><h3>${escapeHtml(enemy.name)} is ready</h3>${healthMeter(`${enemy.name} health`, enemy.hp, enemy.maxHp, 'enemy')}<p class="dungeon-body-copy">Pick one tactic. Pip's moves then play out automatically.</p><div class="tactic-grid">${dungeonData.tactics.map((tactic) => `<button class="tactic-choice" type="button" data-run-action="tactic" data-tactic-id="${escapeHtml(tactic.id)}" data-testid="tactic-${escapeHtml(tactic.id)}"><strong>${escapeHtml(tactic.name)}</strong><small>${escapeHtml(tactic.description)}</small></button>`).join('')}</div></section>`;
  } else if (run.phase === 'combat' && run.enemy) {
    const enemy = run.enemy;
    const enemyGauge = Math.min(100, Math.round((enemy.gauge / dungeonRules.actionGauge) * 100));
    const petGauge = Math.min(100, Math.round((run.petGauge / dungeonRules.actionGauge) * 100));
    stage = `<section class="dungeon-fight" data-testid="dungeon-fight"><p class="eyebrow">Auto-fight · Floor ${run.floor}</p><div class="combat-versus"><div class="combatant combatant-pet"><span class="combatant-mark" aria-hidden="true">✦</span><strong>Pip</strong>${healthMeter('Pip health', run.petHp, run.petMaxHp, 'pet')}<div class="gauge-track" role="progressbar" aria-label="Pip action gauge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${petGauge}"><span style="width:${petGauge}%"></span><small>Next move</small></div></div><span class="versus-mark" aria-hidden="true">✕</span><div class="combatant combatant-enemy"><span class="combatant-mark" aria-hidden="true">${roomPresentation[enemy.kind].mark}</span><strong>${escapeHtml(enemy.name)}</strong>${healthMeter(`${enemy.name} health`, enemy.hp, enemy.maxHp, 'enemy')}<div class="gauge-track gauge-enemy" role="progressbar" aria-label="${escapeHtml(enemy.name)} action gauge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${enemyGauge}"><span style="width:${enemyGauge}%"></span><small>Next move</small></div></div></div><div class="combat-effect-row">${run.petStatuses.map((status) => `<span class="effect-chip">${status.type === 'buff' ? `${status.stat} boost` : status.type} · ${status.turns}</span>`).join('')}${enemy.phaseTwoTriggered ? '<span class="effect-chip is-boss">New boss move</span>' : ''}</div><ol class="combat-log" role="log" aria-label="Combat log" aria-live="polite">${run.combatLog.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol><p class="dungeon-body-copy">The gauges fill from speed. Care still matters while Pip is inside.</p></section>`;
  } else if (run.phase === 'loot' && run.pendingItem) {
    const item = run.pendingItem;
    const slot = getItemTemplate(item.templateId)?.slot ?? 'Weapon';
    stage = `<section class="dungeon-decision loot-scene"><p class="eyebrow">A new find</p><h3>${item.rarity} gear from the path</h3>${renderGearItem(item, current, { compareSlot: slot })}<p class="dungeon-body-copy">Take it in the run bag, turn it into Scrap now, or leave it behind. Run gear is banked only when the run ends.</p><div class="loot-actions"><button class="primary-button" type="button" data-run-action="take-drop">Take gear</button><button class="quiet-button" type="button" data-run-action="scrap-drop">Scrap · ${getScrapValue(item)}</button><button class="quiet-button" type="button" data-run-action="leave-drop">Leave it</button></div></section>`;
  } else if (run.phase === 'event' && run.eventId) {
    const event = dungeonData.events.find((item) => item.id === run.eventId);
    stage = event ? `<section class="dungeon-decision event-scene"><p class="eyebrow">A small story on the path</p><h3>${escapeHtml(event.title)}</h3><p class="dungeon-body-copy">${escapeHtml(event.description)}</p><div class="event-options">${event.options.map((option) => `<button class="event-option" type="button" data-run-action="event" data-option-id="${escapeHtml(option.id)}"><strong>${escapeHtml(option.label)}</strong><small>${Math.round(option.successChance * 100)}% chance to go well</small></button>`).join('')}</div></section>` : '';
  } else if (run.phase === 'treasure') {
    stage = `<section class="dungeon-decision room-interlude"><span class="interlude-mark" aria-hidden="true">▣</span><p class="eyebrow">A quiet glimmer</p><h3>Treasure room</h3><p class="dungeon-body-copy">Open the chest for run coins, a chance at a token, and one gear find. Tokens become coins when the run ends.</p><button class="primary-button" type="button" data-run-action="treasure">Open treasure</button></section>`;
  } else if (run.phase === 'rest') {
    stage = `<section class="dungeon-decision room-interlude"><span class="interlude-mark" aria-hidden="true">☾</span><p class="eyebrow">Take a breath</p><h3>Rest stop</h3><p class="dungeon-body-copy">Restore ${Math.round(run.petMaxHp * dungeonRules.restHealPercent)} health and ${dungeonRules.restEnergyRestore} energy before continuing.</p><button class="primary-button" type="button" data-run-action="rest">Rest here</button></section>`;
  } else if (run.phase === 'shop') {
    const consumableShelf = run.shopOfferIds.map((id) => {
      const item = dungeonData.consumables.find((candidate) => candidate.id === id);
      if (!item) return '';
      return `<div class="shop-item"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span><button class="shop-buy" type="button" data-run-action="buy" data-consumable-id="${escapeHtml(item.id)}" ${run.consumables.length >= homeEffects.packSlots || run.coins < item.price ? 'disabled' : ''}>${item.price} coins</button></div>`;
    }).join('');
    const gearShelf = run.shopEquipmentOffers.map((offer) => {
      const full = current.equipment.inventory.length + run.pendingItems.length >= homeEffects.inventoryCapacity;
      const autoScrap = shouldAutoScrap(offer.item, current.equipment.autoScrapThrough);
      return `<div class="shop-gear-offer">${renderGearItem(offer.item, current)}<button class="shop-buy" type="button" data-run-action="buy-gear" data-offer-id="${escapeHtml(offer.id)}" ${full || autoScrap || run.pendingItems.length >= equipmentRules.inventory.pendingItemsPerRunCap || run.coins < offer.price ? 'disabled' : ''}>${offer.price} coins · add to bag</button></div>`;
    }).join('');
    stage = `<section class="dungeon-decision"><p class="eyebrow">Traveling shop · ${run.coins} run coins</p><h3>Choose a useful little thing</h3><h4 class="shop-shelf-title">Pack tonics</h4><div class="shop-list">${consumableShelf || '<p class="pack-empty">No tonics left on this shelf.</p>'}</div><h4 class="shop-shelf-title">Gear finds</h4><div class="shop-gear-list">${gearShelf || '<p class="pack-empty">No gear left on this shelf.</p>'}</div><button class="quiet-button continue-room" type="button" data-run-action="continue-shop">Leave the shop</button></section>`;
  } else if (run.phase === 'floor-end') {
    stage = `<section class="dungeon-decision floor-stop"><p class="eyebrow">A natural stopping point</p><h3>Floor ${run.floor} cleared</h3><p class="dungeon-body-copy">Pip has ${run.petHp} / ${run.petMaxHp} health. You can bank everything now, or descend to floor ${run.floor + 1}.</p><div class="floor-actions"><button class="primary-button" type="button" data-run-action="descend" data-testid="dungeon-descend">Descend to floor ${run.floor + 1}</button><button class="quiet-button leave-button" type="button" data-run-action="leave" data-testid="dungeon-leave">Leave and bank rewards</button></div></section>`;
  } else if (run.phase === 'summary') {
    stage = `<section class="dungeon-decision run-summary" data-testid="dungeon-summary"><span class="interlude-mark ${run.result === 'fainted' ? 'is-fainted' : ''}" aria-hidden="true">${run.result === 'fainted' ? '♡' : '✦'}</span><p class="eyebrow">${run.result === 'fainted' ? 'A brave try' : 'Safe return'}</p><h3>${run.result === 'fainted' ? 'Pip is ready to rest' : 'The descent is complete'}</h3><p class="dungeon-body-copy">${run.result === 'fainted' ? `Pip reached floor ${run.floor} and came back exhausted.` : `Pip reached floor ${run.floor} and returned safely.`} ${run.lostLootCount ? `${run.lostLootCount} treasure token${run.lostLootCount === 1 ? '' : 's'} were lost.` : ''} ${run.lostItemCount ? `${run.lostItemCount} gear item${run.lostItemCount === 1 ? '' : 's'} lost.` : ''}</p><div class="dungeon-records"><span><strong>+${run.bankedCoins}</strong><small>coins banked</small></span><span><strong>${run.bankedItemCount}</strong><small>gear banked</small></span><span><strong>${run.bankedScrap}</strong><small>Scrap banked</small></span><span><strong>${run.bankedEssence}</strong><small>Essence banked</small></span></div><button class="primary-button" type="button" data-run-action="close-summary" data-testid="dungeon-summary-close">Back to Pip</button></section>`;
  }

  dungeonContent.innerHTML = `<div class="dungeon-run-grid" style="--biome-accent:${escapeHtml(biome.accent)}">
    <section class="dungeon-map" aria-label="Floor map">
      <div class="biome-banner"><div><p class="eyebrow">Floor ${run.floor}</p><h3>${escapeHtml(biome.name)}</h3></div><span class="biome-sigil" aria-hidden="true">${evolutions.elements[biome.element].mark}</span></div>
      <ol class="dungeon-path" aria-label="${roomCount} room route">${nodes}</ol>
      <div class="run-ledger"><span><small>Run coins</small><strong>${run.coins}</strong></span><span><small>Run gear</small><strong>${run.pendingItems.length + (run.pendingItem ? 1 : 0)}</strong></span><span><small>Run materials</small><strong>${run.pendingScrap} Scrap · ${run.pendingEssence} Essence</strong></span><span><small>Wallet</small><strong>${current.dungeon.coins} coins · ${current.dungeon.scrap} Scrap</strong></span></div>
      ${healthMeter('Pip health', run.petHp, run.petMaxHp, 'pet')}
      <div class="care-conditions"><span>Hunger ${Math.round(current.needs.hunger)}%</span><span>Energy ${Math.round(current.needs.energy)}%</span></div>
      ${modifiers.length ? `<div class="run-modifiers" aria-label="Run boons and curses">${modifiers.map((modifier) => `<span>${escapeHtml(modifier)}</span>`).join('')}</div>` : ''}
    </section>
    <section class="dungeon-console">${stage}${run.phase !== 'summary' ? `<section class="pack-panel" aria-label="Run pack"><div class="dungeon-section-heading"><h3>Run pack</h3><span>${run.consumables.length} / ${homeEffects.packSlots}</span></div>${renderPack(run)}</section>` : ''}</section>
  </div>`;
}

function renderStageDecision(current: GameState): void {
  const run = current.dungeon.activeRun;
  if (!run) {
    if (!stageChoiceOverlay.hidden) stageChoiceOverlay.hidden = true;
    setMarkupIfChanged(stageChoiceOverlay, '');
    return;
  }

  let content = '';
  if (run.phase === 'choice') {
    content = `<p class="stage-choice-kicker">Choose the next room</p><h3>Which path feels right?</h3><div class="stage-choice-options">${run.roomChoices.map((type) => {
      const item = roomPresentation[type];
      return `<button class="stage-choice-option" type="button" data-run-action="room" data-room-type="${type}" data-testid="room-${type}"><strong>${item.title}</strong><small>${item.detail}</small></button>`;
    }).join('')}</div>`;
  } else if (run.phase === 'tactic' && run.enemy) {
    content = `<p class="stage-choice-kicker">Before the fight · ${escapeHtml(run.enemy.name)}</p><h3>Pick one tactic</h3><div class="stage-choice-options">${dungeonData.tactics.map((tactic) => `<button class="stage-choice-option" type="button" data-run-action="tactic" data-tactic-id="${escapeHtml(tactic.id)}" data-testid="tactic-${escapeHtml(tactic.id)}"><strong>${escapeHtml(tactic.name)}</strong><small>${escapeHtml(tactic.description)}</small></button>`).join('')}</div>`;
  } else if (run.phase === 'event' && run.eventId) {
    const event = dungeonData.events.find((item) => item.id === run.eventId);
    if (event) content = `<p class="stage-choice-kicker">A small story on the path</p><h3>${escapeHtml(event.title)}</h3><p class="stage-choice-copy">${escapeHtml(event.description)}</p><div class="stage-choice-options">${event.options.map((option) => `<button class="stage-choice-option" type="button" data-run-action="event" data-option-id="${escapeHtml(option.id)}"><strong>${escapeHtml(option.label)}</strong><small>${Math.round(option.successChance * 100)}% chance to go well</small></button>`).join('')}</div>`;
  } else if (run.phase === 'treasure') {
    content = `<p class="stage-choice-kicker">A quiet glimmer</p><h3>Treasure room</h3><p class="stage-choice-copy">Open the chest for run coins, a chance at a token, and a little find.</p><button class="stage-choice-primary" type="button" data-run-action="treasure">Open treasure</button>`;
  } else if (run.phase === 'rest') {
    content = `<p class="stage-choice-kicker">Take a breath</p><h3>Rest stop</h3><p class="stage-choice-copy">Restore ${Math.round(run.petMaxHp * dungeonRules.restHealPercent)} health and ${dungeonRules.restEnergyRestore} energy before continuing.</p><button class="stage-choice-primary" type="button" data-run-action="rest">Rest here</button>`;
  } else if (run.phase === 'floor-end') {
    content = `<p class="stage-choice-kicker">A natural stopping point</p><h3>Floor ${run.floor} cleared</h3><p class="stage-choice-copy">Pip has ${run.petHp} / ${run.petMaxHp} health. Bank your finds or keep going.</p><div class="stage-choice-options stage-choice-actions"><button class="stage-choice-primary" type="button" data-run-action="descend" data-testid="dungeon-descend">Descend</button><button class="stage-choice-option" type="button" data-run-action="leave" data-testid="dungeon-leave">Leave and bank</button></div>`;
  } else if (run.phase === 'loot' && run.pendingItem) {
    const item = run.pendingItem;
    const itemName = getItemTemplate(item.templateId)?.name ?? item.templateId;
    content = `<p class="stage-choice-kicker">A new find · ${escapeHtml(item.rarity)}</p><h3>${escapeHtml(itemName)}</h3><p class="stage-choice-copy">Take it in the run bag, turn it into ${getScrapValue(item)} Scrap, or leave it behind.</p><div class="stage-choice-options stage-choice-actions"><button class="stage-choice-primary" type="button" data-run-action="take-drop">Take gear</button><button class="stage-choice-option" type="button" data-run-action="scrap-drop">Scrap</button><button class="stage-choice-option" type="button" data-run-action="leave-drop">Leave</button></div>`;
  } else if (run.phase === 'shop') {
    content = `<p class="stage-choice-kicker">Traveling shop · ${run.coins} run coins</p><h3>A little shop is open</h3><button class="stage-choice-primary" type="button" data-stage-open="dungeon">Browse shop</button>`;
  } else if (run.phase === 'summary') {
    const fainted = run.result === 'fainted';
    content = `<p class="stage-choice-kicker">${fainted ? 'A brave try' : 'Safe return'} · Floor ${run.floor}</p><h3>${fainted ? 'Pip is ready to rest' : 'The descent is complete'}</h3><p class="stage-choice-copy">+${run.bankedCoins} coins · ${run.bankedItemCount} gear · ${run.bankedScrap} Scrap · ${run.bankedEssence} Essence</p><button class="stage-choice-primary" type="button" data-run-action="close-summary" data-testid="dungeon-summary-close">Back to Pip</button>`;
  }

  const decisionTestId = run.phase === 'summary' ? 'dungeon-summary' : 'stage-decision';
  const markup = content ? `<section class="stage-choice-card" data-testid="${decisionTestId}" aria-label="${run.phase === 'summary' ? 'Run summary' : 'Dungeon choice'}">${content}</section>` : '';
  setMarkupIfChanged(stageChoiceOverlay, markup);
  if (stageChoiceOverlay.hidden !== !markup) stageChoiceOverlay.hidden = !markup;
}

function renderFoodActions(): void {
  const grid = must<HTMLDivElement>('#food-actions');
  const marks: Record<string, string> = {
    'moonberry-jam': '●',
    'dew-drop': '◉',
    'moss-muffin': '▣',
  };
  grid.innerHTML = foods.map((food, index) => `
    <button class="food-button" type="button" data-action="feed" data-food-id="${food.id}" data-testid="feed-${food.id}" aria-label="${food.name}, ${index + 1}. Feed Pip. ${food.description}" title="${food.description}">
      <span class="food-mark food-mark-${index + 1}" aria-hidden="true">${marks[food.id] ?? '✦'}</span>
      <span class="food-name">${food.name}</span>
      <span class="food-hint">${index + 1}</span>
    </button>
  `).join('');
}

function showToast(message: string): void {
  if (toastQueue.length >= rules.notifications.maximumQueueLength) toastQueue.shift();
  toastQueue.push(message);
  if (!toastVisible) showNextToast();
}

function showNextToast(): void {
  const toast = must<HTMLDivElement>('#toast');
  const message = toastQueue.shift();
  if (!message) {
    toast.classList.remove('is-visible');
    toastVisible = false;
    return;
  }
  toastVisible = true;
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    toastTimeout = window.setTimeout(showNextToast, 160);
  }, rules.notifications.toastDurationSeconds * 1000);
}

type MiniGameKind = 'reaction' | 'memory' | 'rhythm';

function clearMiniGameTimers(): void {
  miniGameTimers.forEach((timer) => {
    window.clearTimeout(timer);
    window.clearInterval(timer);
  });
  miniGameTimers.clear();
}

function scheduleMiniGame(callback: () => void, delayMs: number): void {
  const timer = window.setTimeout(() => {
    miniGameTimers.delete(timer);
    callback();
  }, delayMs);
  miniGameTimers.add(timer);
}

function finishMiniGame(score: number): void {
  clearMiniGameTimers();
  miniGameInput = null;
  const boundedScore = Math.round(Math.max(0, Math.min(rules.progression.miniGameMaximumScore, score)));
  minigameStage.innerHTML = `<p class="game-prompt">Game complete · ${boundedScore}/100</p><button class="game-pad" id="minigame-again" type="button">Choose a game</button>`;
  minigameStatus.textContent = 'Your score is ready. Training points are limited by each level.';
  sendAction({ type: 'mini-game-complete', stat: trainingStatInput.value as StatKey, score: boundedScore });
}

function startMiniGame(kind: MiniGameKind): void {
  if (!state || state.paused || state.sleeping || state.stage === 'egg' || state.miniGameCooldownSeconds > 0) return;
  clearMiniGameTimers();
  minigameChoices.hidden = true;
  minigameStage.hidden = false;
  if (kind === 'reaction') startReactionGame();
  else if (kind === 'memory') startMemoryGame();
  else startRhythmGame();
}

function startReactionGame(): void {
  const config = rules.progression.miniGames.reaction;
  const roundScores: number[] = [];
  let armed = false;
  let signalOn = false;
  let roundDone = false;
  let signalAt = 0;

  const showRound = () => {
    armed = false;
    signalOn = false;
    roundDone = false;
    minigameStage.innerHTML = `<p class="game-prompt">Quick Spark · Round ${roundScores.length + 1} of ${config.rounds}</p><p class="game-prompt" id="reaction-prompt">Tap to get ready.</p><button class="game-pad" id="reaction-pad" type="button">Ready</button>`;
  };
  const completeRound = (score: number) => {
    if (roundDone) return;
    roundDone = true;
    clearMiniGameTimers();
    roundScores.push(score);
    if (roundScores.length >= config.rounds) {
      finishMiniGame(roundScores.reduce((sum, value) => sum + value, 0) / roundScores.length);
    } else {
      scheduleMiniGame(showRound, config.betweenRoundsMs);
    }
  };
  showRound();
  miniGameInput = (button) => {
    if (button.id !== 'reaction-pad' || roundDone) return;
    const prompt = must<HTMLParagraphElement>('#reaction-prompt');
    if (!armed) {
      armed = true;
      button.disabled = true;
      button.textContent = 'Wait for the spark…';
      prompt.textContent = 'Not yet — watch closely.';
      scheduleMiniGame(() => {
        if (roundDone) return;
        signalOn = true;
        signalAt = performance.now();
        prompt.textContent = 'Tap now!';
        prompt.classList.add('is-ready');
        button.disabled = false;
        button.textContent = 'Tap!';
        scheduleMiniGame(() => completeRound(0), config.signalWindowMs);
      }, config.readyDelayMs);
      return;
    }
    if (!signalOn) {
      prompt.textContent = 'Too early — steady paws!';
      completeRound(0);
      return;
    }
    const reactionMs = performance.now() - signalAt;
    completeRound(Math.max(0, rules.progression.miniGameMaximumScore
      - Math.max(0, reactionMs - config.latencyGraceMs) * config.scorePenaltyPerMs));
  };
}

function startMemoryGame(): void {
  const config = rules.progression.miniGames.memory;
  const symbols = config.symbols;
  const sequence = config.sequence;
  let position = 0;
  let correct = 0;
  let accepting = false;
  const renderPads = () => {
    minigameStage.innerHTML = `<p class="game-prompt" id="memory-prompt">Watch the trail…</p><div class="memory-grid">${symbols.map((symbol, index) => `<button class="memory-pad" type="button" data-memory-index="${index}" aria-label="Symbol ${index + 1}" disabled>${symbol}</button>`).join('')}</div>`;
  };
  renderPads();
  const showStep = (index: number) => {
    if (index >= sequence.length) {
      accepting = true;
      minigameStage.querySelectorAll<HTMLButtonElement>('.memory-pad').forEach((pad) => { pad.disabled = false; });
      must<HTMLParagraphElement>('#memory-prompt').textContent = `Now repeat the ${sequence.length}-symbol trail.`;
      return;
    }
    const pad = minigameStage.querySelector<HTMLButtonElement>(`[data-memory-index="${sequence[index]}"]`);
    pad?.classList.add('is-lit');
    scheduleMiniGame(() => {
      pad?.classList.remove('is-lit');
      scheduleMiniGame(() => showStep(index + 1), config.symbolGapMs);
    }, config.symbolOnMs);
  };
  scheduleMiniGame(() => showStep(0), config.introDelayMs);
  miniGameInput = (button) => {
    if (!accepting || button.dataset.memoryIndex === undefined || position >= sequence.length) return;
    if (Number(button.dataset.memoryIndex) === sequence[position]) correct += 1;
    position += 1;
    must<HTMLParagraphElement>('#memory-prompt').textContent = `Trail ${position} of ${sequence.length}`;
    if (position === sequence.length) finishMiniGame((correct / sequence.length) * rules.progression.miniGameMaximumScore);
  };
}

function startRhythmGame(): void {
  const config = rules.progression.miniGames.rhythm;
  const beatCount = config.beats;
  let beat = -1;
  let expectedAt = 0;
  let scoredThisBeat = false;
  let hits = 0;
  minigameStage.innerHTML = `<p class="game-prompt" id="rhythm-prompt">Tap the button on each glowing beat.</p><div class="rhythm-row" aria-hidden="true">${Array.from({ length: beatCount }, () => '<span class="rhythm-beat"></span>').join('')}</div><button class="game-pad" id="rhythm-pad" type="button">Tap with the beat</button>`;
  const pulse = () => {
    beat += 1;
    if (beat >= beatCount) {
      finishMiniGame((hits / beatCount) * rules.progression.miniGameMaximumScore);
      return;
    }
    expectedAt = performance.now();
    scoredThisBeat = false;
    const dot = minigameStage.querySelectorAll<HTMLElement>('.rhythm-beat')[beat];
    dot?.classList.add('is-lit');
    scheduleMiniGame(() => dot?.classList.remove('is-lit'), 220);
    must<HTMLParagraphElement>('#rhythm-prompt').textContent = `Beat ${beat + 1} of ${beatCount} · tap in time.`;
  };
  scheduleMiniGame(() => {
    pulse();
    const interval = window.setInterval(pulse, config.intervalMs);
    miniGameTimers.add(interval);
  }, config.startDelayMs);
  miniGameInput = (button) => {
    if (button.id !== 'rhythm-pad' || beat < 0 || beat >= beatCount || scoredThisBeat) return;
    if (Math.abs(performance.now() - expectedAt) <= config.toleranceMs) {
      hits += 1;
      scoredThisBeat = true;
      must<HTMLParagraphElement>('#rhythm-prompt').textContent = `Nice timing · ${hits} hit${hits === 1 ? '' : 's'}.`;
    }
  };
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function describeSignals(current: GameState): string {
  const mood = getMood(current);
  if (mood === 'sick') return 'Pip needs a gentle clean and a little care.';
  if (mood === 'unhappy') return 'Pip needs some care to feel better.';
  const signals = getNeedSignals(current);
  return signals.length ? needCopy[signals[0]!] : 'Pip is happy to have you here.';
}

function renderGettingStarted(current: GameState): string {
  if (onboardingDismissed || current.dungeon.runsCompleted > 0) return '';

  const hatched = current.stage !== 'egg';
  const inFirstRun = Boolean(current.dungeon.activeRun);
  const canOpenDungeon = hatched && Boolean(current.evolution.formId) && !current.sleeping && !current.paused;
  const stepTwoCopy = inFirstRun
    ? 'Your first descent is underway. Choose a room, pick a tactic before fights, then bank safely at a floor stop.'
    : !hatched
      ? 'After Pip hatches, open Dungeon to set out. You can leave at any floor to bank your finds.'
      : current.sleeping
        ? 'Wake Pip, then open Dungeon to choose a route. You can leave at any floor to bank your finds.'
        : 'Open Dungeon, choose a route and start. You can leave at any floor to bank your finds.';
  const mobileGuideCopy = inFirstRun
    ? 'Choose rooms and tactics, then bank at a floor stop. Time pauses when you leave.'
    : !hatched
      ? 'Spend one active minute to hatch. Afterward, open Dungeon and bank at a floor stop.'
      : current.sleeping
        ? 'Wake Pip, then open Dungeon. Bank at a floor stop and return any time.'
        : 'Open Dungeon to begin. Bank at a floor stop; time pauses when you leave.';
  const stepTwoAction = inFirstRun
    ? '<button class="quiet-button" type="button" data-guide-action="dungeon">Return to Dungeon</button>'
    : canOpenDungeon
      ? '<button class="quiet-button" type="button" data-guide-action="dungeon">Open Dungeon</button>'
      : `<span class="guide-unlock-note">${!hatched ? 'Opens after hatching' : current.sleeping ? 'Wake Pip first' : 'Pip is not ready yet'}</span>`;

  return `<section class="getting-started" data-testid="first-steps-guide" aria-labelledby="getting-started-title">
    <div class="guide-heading"><h2 id="getting-started-title">A first little adventure</h2><p>Two small steps to Pip’s first descent.</p></div>
    <p class="guide-mobile-summary">${mobileGuideCopy}</p>
    <ol class="guide-step-list">
      <li class="guide-step ${hatched ? 'is-complete' : 'is-current'}" ${hatched ? '' : 'aria-current="step"'}>
        <span class="guide-step-mark" aria-hidden="true">${hatched ? '<span class="guide-check"></span>' : '1'}</span>
        <span><strong>Hatch Pip</strong><small>${hatched ? 'Pip has hatched. Time pauses when you leave.' : 'Spend one active minute together. Time pauses when you leave.'}</small></span>
      </li>
      <li class="guide-step ${hatched ? 'is-current' : 'is-upcoming'}" ${hatched ? 'aria-current="step"' : ''}>
        <span class="guide-step-mark" aria-hidden="true">2</span>
        <span><strong>Take a first descent</strong><small>${stepTwoCopy}</small></span>
      </li>
    </ol>
    <div class="guide-actions">${stepTwoAction}<button class="quiet-button" type="button" data-guide-action="dismiss">Hide guide</button></div>
  </section>`;
}

function hasFocusedField(dialog: HTMLDialogElement): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && dialog.contains(active) && active.matches('input, textarea, select');
}

function setStageDrawerExpanded(expanded: boolean): void {
  const drawer = must<HTMLElement>('#stage-drawer');
  const toggle = must<HTMLButtonElement>('#stage-sheet-toggle');
  drawer.classList.toggle('is-expanded', expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
}

function openDungeonSurface(current: GameState): void {
  const run = current.dungeon.activeRun;
  if (!run) {
    dungeonDialog.classList.remove('is-run-sheet');
    renderDungeon(current);
    dungeonDialog.showModal();
    return;
  }
  if (run.phase === 'shop') {
    dungeonDialog.classList.add('is-run-sheet');
    renderDungeon(current);
    dungeonDialog.showModal();
    return;
  }
  const choiceButton = stageChoiceOverlay.querySelector<HTMLButtonElement>('button');
  if (!stageChoiceOverlay.hidden && choiceButton) {
    choiceButton.focus({ preventScroll: true });
    return;
  }
  selectedStageTab = 'log';
  renderStageSheet(current);
  setStageDrawerExpanded(true);
}

function updateStageHud(current: GameState): void {
  const run = current.dungeon.activeRun;
  const hpStatus = must<HTMLElement>('#stage-hp-status');
  const runMeta = must<HTMLElement>('#stage-run-meta');
  const homeMeta = must<HTMLElement>('#stage-home-meta');
  hpStatus.hidden = !run;
  runMeta.hidden = !run;
  homeMeta.hidden = Boolean(run);

  const hunger = Math.round(current.needs.hunger);
  const energy = Math.round(current.needs.energy);
  for (const [key, value] of [['hunger', hunger], ['energy', energy]] as const) {
    const fill = must<HTMLElement>(`#stage-${key}-fill`);
    const meter = must<HTMLElement>(`#stage-${key}-meter`);
    const copy = must<HTMLElement>(`#stage-${key}-copy`);
    fill.style.width = `${value}%`;
    meter.setAttribute('aria-valuenow', String(value));
    copy.textContent = String(value);
    meter.classList.toggle('is-low', value < rules.needs.signalThreshold);
  }

  if (run) {
    const hp = Math.max(0, Math.round(run.petHp));
    const maxHp = Math.max(1, Math.round(run.petMaxHp));
    const percent = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
    must<HTMLElement>('#stage-hp-fill').style.width = `${percent}%`;
    const hpMeter = must<HTMLElement>('#stage-hp-meter');
    hpMeter.setAttribute('aria-valuemax', String(maxHp));
    hpMeter.setAttribute('aria-valuenow', String(hp));
    must<HTMLElement>('#stage-hp-copy').textContent = `${hp}`;
    must<HTMLElement>('#stage-run-summary').textContent = `F${run.floor} · ${run.coins}c`;
    must<HTMLButtonElement>('#stage-actions-home').hidden = true;
    must<HTMLButtonElement>('#stage-actions-run').hidden = false;
    must<HTMLElement>('#stage-decision-label').textContent = run.phase === 'tactic' ? 'Tactic' : run.phase === 'choice' ? 'Path' : run.phase === 'floor-end' ? 'Next' : run.phase === 'summary' ? 'Return' : run.phase === 'shop' ? 'Shop' : run.phase === 'loot' ? 'Loot' : 'Details';
    const leave = must<HTMLButtonElement>('#stage-actions-run [data-run-action="leave"]');
    leave.disabled = current.paused || run.phase !== 'floor-end';
  } else {
    must<HTMLButtonElement>('#stage-actions-home').hidden = false;
    must<HTMLButtonElement>('#stage-actions-run').hidden = true;
    must<HTMLElement>('#stage-home-summary').textContent = `Lv ${current.level}`;
    must<HTMLButtonElement>('#stage-actions-home [data-stage-open="training"]').disabled = current.paused || current.sleeping || current.stage === 'egg' || current.miniGameCooldownSeconds > 0;
  }

  const stageKind = getStageSceneKind(current);
  must<HTMLElement>('#stage-location').textContent = stageLocation(current);
  const eventCaption = stageEventCaption(stageEventPlayer.frame().event);
  must<HTMLElement>('#stage-ticker').textContent = eventCaption ?? stageCaption(current);
  must<HTMLSpanElement>('#stage-sleep-label').textContent = current.sleeping ? 'Wake' : 'Sleep';
  canvas.setAttribute('aria-label', stageKind === 'home'
    ? current.stage === 'egg'
      ? 'Pip’s egg resting in the cave habitat.'
      : `${getFormDefinition(current.evolution.formId)?.name ?? 'Pip'} in the cave habitat.`
    : stageKind === 'battle'
      ? `${run?.enemy?.name ?? 'An enemy'} faces Pip in a dungeon battle.`
      : `Pip walking through the ${stageLocation(current).toLowerCase()} dungeon scene.`);
  const speedButton = must<HTMLButtonElement>('#stage-speed');
  speedButton.querySelector('strong')!.textContent = animationSpeedLabel(animationSpeed);
  speedButton.setAttribute('aria-label', `Animation speed ${animationSpeedLabel(animationSpeed)}`);
}

function updateControls(current: GameState): void {
  const controlsUpdateStartedAt = performance.now();
  root?.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    const action = button.dataset.action;
    const key = action === 'toggle-sleep' ? 'sleep' : action;
    const lockedBySleep = current.sleeping && action !== 'toggle-sleep';
    const lockedByPause = current.paused;
    const cooldown = key && key in current.cooldowns ? current.cooldowns[key as keyof GameState['cooldowns']] : 0;
    button.disabled = lockedByPause || lockedBySleep || (cooldown ?? 0) > 0;
    button.classList.toggle('is-cooling', !button.disabled && (cooldown ?? 0) > 0);
  });
  const isLow = (need: NeedKey) => current.needs[need] < rules.needs.signalThreshold;
  root?.querySelectorAll<HTMLButtonElement>('[data-action="feed"]').forEach((button) => {
    button.classList.toggle('has-signal', isLow('hunger'));
  });
  root?.querySelector<HTMLButtonElement>('[data-action="play"]')?.classList.toggle('has-signal', isLow('happiness'));
  root?.querySelector<HTMLButtonElement>('[data-action="toggle-sleep"]')?.classList.toggle('has-signal', !current.sleeping && isLow('energy'));
  root?.querySelector<HTMLButtonElement>('[data-action="clean"]')?.classList.toggle('has-signal', isLow('hygiene'));

  must<HTMLSpanElement>('#sleep-label').textContent = current.sleeping ? 'Wake up' : 'Tuck in';
  must<HTMLSpanElement>('#sleep-detail').textContent = current.sleeping ? 'Say hello again' : 'Rest a little';
  const stageNames = { egg: 'Egg', baby: 'Baby', teen: 'Teen', adult: 'Adult', elder: 'Elder' };
  const nextStageNames = { egg: 'hatching', baby: 'a teen', teen: 'an adult', adult: 'an elder', elder: 'a new egg' };
  const remaining = formatClock(Math.max(0, rules.lifeStages.stageMinutes[current.stage] * 60 - current.stageSeconds));
  const form = getFormDefinition(current.evolution.formId);
  must<HTMLSpanElement>('#stage-pill').textContent = stageNames[current.stage];
  must<HTMLSpanElement>('#stage-detail').textContent = current.stage === 'egg'
    ? `Hatching in ${remaining}`
    : `Growing into ${nextStageNames[current.stage]} in ${remaining}`;
  must<HTMLHeadingElement>('#pet-heading').textContent = form?.name ?? (current.stage === 'egg' ? 'A quiet place to grow' : 'Hello, little friend');
  canvas.setAttribute('aria-label', current.stage === 'egg'
    ? 'Pip’s egg resting in the cave habitat.'
    : `${form?.name ?? 'Pip'} is ${current.sleeping ? 'sleeping' : 'resting'} in the cave habitat.`);
  must<HTMLSpanElement>('#active-clock').textContent = `${Math.floor(current.activeSeconds / 60)} min together`;

  const mood = getMood(current);
  const moodLabel: Record<typeof mood, string> = {
    content: 'Settled',
    'needs-care': 'A little signal',
    unhappy: 'Needs a hand',
    sick: 'Needs a clean',
  };
  moodChip.textContent = moodLabel[mood];
  moodChip.dataset.mood = mood;
  signalCopy.textContent = describeSignals(current);

  (Object.keys(needLabels) as NeedKey[]).forEach((key) => {
    const value = current.needs[key];
    const percent = Math.round(value);
    const fill = must<HTMLSpanElement>(`[data-need-fill="${key}"]`);
    const meter = must<HTMLDivElement>(`[data-need-meter="${key}"]`);
    const text = must<HTMLSpanElement>(`[data-need-value="${key}"]`);
    fill.style.width = `${percent}%`;
    meter.setAttribute('aria-valuenow', String(percent));
    meter.setAttribute('aria-valuetext', `${percent} percent`);
    text.textContent = `${percent}%`;
    meter.parentElement?.classList.toggle('is-low', value < rules.needs.signalThreshold);
    meter.parentElement?.classList.toggle('is-empty', value <= rules.needs.unhappyThreshold);
  });

  renderGrowthSummary(current);
  const gettingStarted = must<HTMLElement>('#getting-started-slot');
  const gettingStartedMarkup = renderGettingStarted(current);
  if (gettingStarted.innerHTML !== gettingStartedMarkup) gettingStarted.innerHTML = gettingStartedMarkup;
  gettingStarted.classList.remove('guide-slot-loading');
  gettingStarted.removeAttribute('aria-live');
  gettingStarted.setAttribute('aria-busy', 'false');
  gettingStarted.hidden = !gettingStartedMarkup;
  const miniGameButton = must<HTMLButtonElement>('#minigames-open');
  const waitingForHatch = current.stage === 'egg';
  const trainingCooling = current.miniGameCooldownSeconds > 0;
  miniGameButton.disabled = current.paused || current.sleeping || waitingForHatch || trainingCooling;
  minigameChoices.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((button) => {
    button.disabled = current.paused || current.sleeping || waitingForHatch || trainingCooling;
  });
  minigameStatus.textContent = waitingForHatch
    ? 'Training games open after Pip hatches.'
    : current.sleeping
      ? 'Wake Pip to start a training game.'
        : trainingCooling
          ? `Training games need a breather for ${Math.ceil(current.miniGameCooldownSeconds)}s.`
          : 'Choose a game. A good score gives up to 3 training points.';
  if (dexDialog.open) renderFormDex(current);
  const dungeonOpen = must<HTMLButtonElement>('#dungeon-open');
  dungeonOpen.disabled = current.paused || (!current.dungeon.activeRun && (current.sleeping || current.stage === 'egg' || !current.evolution.formId));
  dungeonOpen.setAttribute('aria-pressed', String(Boolean(current.dungeon.activeRun)));
  renderStageDecision(current);
  if (current.dungeon.activeRun && current.dungeon.activeRun.phase !== 'shop' && dungeonDialog.open) {
    dungeonDialog.close();
    dungeonDialog.classList.remove('is-run-sheet');
  }
  if (!current.dungeon.activeRun) dungeonDialog.classList.remove('is-run-sheet');
  if (dungeonDialog.open) renderDungeon(current);
  if (gearDialog.open && !hasFocusedField(gearDialog)) renderEquipment(current);
  if (homeDialog.open && !hasFocusedField(homeDialog)) renderHome(current);

  overlay.hidden = !current.paused;
  if (current.paused) must<HTMLButtonElement>('#resume-button').focus({ preventScroll: true });
  root?.classList.toggle('crt-on', crtOn);
  updateStageHud(current);
  renderStageSheet(current);
  miniMode.update(current);
  const currentPhase = current.dungeon.activeRun?.phase;
  if ((import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') && currentPhase === 'combat') {
    combatControlUpdateTotalMs += performance.now() - controlsUpdateStartedAt;
    combatControlUpdateSamples += 1;
  }
}

function scheduleSave(): void {
  if (!state) return;
  const requestId = ++saveRequestId;
  worker.postMessage({ type: 'save', requestId });
  const fallbackState = { ...state, paused: state.paused };
  void saveGame(fallbackState).then((store) => {
    lastSavedLabel = store === 'indexeddb' ? 'Saved on this device' : 'Saved in browser storage';
    saveStatus.textContent = lastSavedLabel;
  }).catch(() => {
    lastSavedLabel = 'Save unavailable';
    saveStatus.textContent = lastSavedLabel;
  });
}

function pauseAndSave(): void {
  if (!state || state.paused) {
    if (state) scheduleSave();
    return;
  }
  state = { ...state, paused: true };
  worker.postMessage({ type: 'pause' });
  updateControls(state);
  scheduleSave();
}

function sendAction(action: GameAction): void {
  if (!state || state.paused) return;
  pendingActions.push(action);
  worker.postMessage({ type: 'action', action });
}

function onWorkerMessage(event: MessageEvent<WorkerOutMessage>): void {
  const message = event.data;
  if (message.type === 'snapshot') {
    stageEventPlayer.enqueue(message.events ?? []);
    if (state?.dungeon.activeRun?.phase === 'tactic' || state?.dungeon.activeRun?.phase === 'combat') {
      stageRenderer.rememberBattleState(state);
    }
    const previousStage = state?.stage;
    const previousForm = state?.evolution.formId;
    const previousGeneration = state?.generation;
    const previousLevel = state?.level;
    const previousBossesDefeated = state?.records.bossesDefeated;
    const previousAchievements = new Set(state?.home.unlockedAchievementIds ?? []);
    state = message.state;
    updateControls(state);
    if (previousGeneration !== undefined && state.generation > previousGeneration) {
      showToast('A new egg has begun the next little story.');
    } else if (previousStage === 'egg' && state.stage === 'baby') {
      showToast(`Pip hatched as ${getFormDefinition(state.evolution.formId)?.name ?? 'a new friend'}!`);
      playSound('hatch', muted);
    } else if (previousForm && state.evolution.formId && previousForm !== state.evolution.formId) {
      showToast(`Pip grew into ${getFormDefinition(state.evolution.formId)?.name ?? 'a new form'}.`);
      playSound('level', muted);
    } else if (previousLevel !== undefined && state.level > previousLevel) {
      playSound('level', muted);
    }
    if (previousBossesDefeated !== undefined && state.records.bossesDefeated > previousBossesDefeated) playSound('victory', muted);
    const newAchievements = getAchievementStatuses(state).filter((achievement) => achievement.unlocked && !previousAchievements.has(achievement.id));
    if (newAchievements.length) showToast(`Achievement unlocked: ${newAchievements.map((achievement) => achievement.title).join(', ')}.`);
  } else if (message.type === 'action-result') {
    const requestedAction = pendingActions.shift();
    showToast(message.result.message);
    miniMode.setMessage(message.result.message);
    if (message.result.accepted) {
      const kind = requestedAction?.type === 'toggle-sleep'
        ? (state?.sleeping ? 'wake' : 'sleep')
        : (message.result.action ? actionAnimations[message.result.action] : undefined)
          ?? (requestedAction ? actionSounds[requestedAction.type] : undefined);
      if (kind) playSound(kind, muted);
    }
  } else if (message.type === 'signals') {
    message.needs.forEach((need) => showToast(needCopy[need]));
  } else if (message.type === 'save') {
    void saveGame(message.state).then((store) => {
      lastSavedLabel = store === 'indexeddb' ? 'Saved on this device' : 'Saved in browser storage';
      saveStatus.textContent = lastSavedLabel;
    }).catch(() => {
      lastSavedLabel = 'Save unavailable';
      saveStatus.textContent = lastSavedLabel;
    });
  }
}

const MAX_FRAME_CATCH_UP_MS = 5_000;

function renderStageFrame(timeMs: number, deltaMs: number, advancePlayback: boolean, rawDeltaMs = deltaMs): void {
  if (!state) return;
  const decisionPaused = false;
  const elapsedMs = Number.isFinite(rawDeltaMs) ? Math.max(0, Math.min(rawDeltaMs, MAX_FRAME_CATCH_UP_MS)) : 0;
  if (advancePlayback) {
    for (const stepMs of splitElapsedMs(elapsedMs, rules.simulation.maxStepMs)) {
      stageEventPlayer.advance(stepMs, animationSpeed, prefersReducedMotion.matches, false);
    }
  }
  const frame = stageEventPlayer.frame();
  const renderStartedAt = performance.now();
  stageEngine.render(state, timeMs / 1000, prefersReducedMotion.matches, frame, stageEventPlayer.hasBattleSequence(), decisionPaused);
  stageSound.update(frame, muted, decisionPaused);
  const renderDurationMs = performance.now() - renderStartedAt;
  const visualState = stageRenderer.visualState() ?? state;
  const isCombatFrame = state.dungeon.activeRun?.phase === 'combat' && !state.paused;
  const location = must<HTMLElement>('#stage-location');
  const locationLabel = artPreviewName ? `REVIEW · ${artPreviewName.toUpperCase()}` : stageLocation(visualState);
  if (location.textContent !== locationLabel) location.textContent = locationLabel;
  const detail = must<HTMLElement>('#stage-detail');
  const detailLabel = artPreviewName ? artPreviewCaptions[artPreviewName] : stageCaption(visualState);
  if (detail.textContent !== detailLabel) detail.textContent = detailLabel;
  const ticker = must<HTMLElement>('#stage-ticker');
  const caption = artPreviewName ? detailLabel : stageEventCaption(frame.event) ?? detailLabel;
  if (ticker.textContent !== caption) ticker.textContent = caption;
  if ((import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') && isCombatFrame && rawDeltaMs > 0) {
    combatFrameTotalMs += rawDeltaMs;
    combatFrameIntervalsMs.push(rawDeltaMs);
    combatFrameSamples += 1;
    combatRenderTotalMs += renderDurationMs;
    combatRenderSamples += 1;
  }
}

function startLoop(now: number): void {
  const loopStartedAt = performance.now();
  const isVisible = document.visibilityState === 'visible';
  if (state && !state.paused && (isVisible || miniMode.kind === 'video')) {
    const rawDeltaMs = lastFrameTime > 0 ? Math.max(0, now - lastFrameTime) : 0;
    const elapsedMs = Math.min(rawDeltaMs, MAX_FRAME_CATCH_UP_MS);
    if (!miniMode.open && isVisible && elapsedMs > 0) {
      for (const dtMs of splitElapsedMs(elapsedMs, rules.simulation.maxStepMs)) worker.postMessage({ type: 'tick', dtMs });
    }
    const shouldRenderStage = !miniMode.open && isVisible;
    lastFrameTime = miniMode.open ? 0 : now;
    if (shouldRenderStage) {
      renderStageFrame(now, elapsedMs, true, elapsedMs);
      if ((import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') && state.dungeon.activeRun?.phase === 'combat' && !state.paused) {
        combatLoopWorkTotalMs += performance.now() - loopStartedAt;
        combatLoopWorkSamples += 1;
      }
    }
  } else {
    lastFrameTime = 0;
  }
  window.requestAnimationFrame(startLoop);
}

renderNeedList();
renderFoodActions();
applyControlSettings();
root.addEventListener('pointerdown', (event) => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button');
  if (button && !button.disabled && !button.matches('[data-care-action]')) stageSound.click(muted);
});
const stageResizeObserver = new ResizeObserver(() => stageEngine.resize());
stageResizeObserver.observe(canvas);
stageEngine.resize();
window.addEventListener('pagehide', () => {
  stageResizeObserver.disconnect();
  stageSound.dispose();
  stageEngine.dispose();
}, { once: true });
void stageEngine.boot().catch((error: unknown) => {
  console.error('Pocket Pal stage engine could not start.', error);
});
root.classList.toggle('crt-on', crtOn);
must<HTMLButtonElement>('#settings-open').addEventListener('click', () => settingsDialog.showModal());
must<HTMLButtonElement>('#settings-close').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
controlSizeInput.addEventListener('change', () => {
  const selected = controlSizes.find((size) => size === controlSizeInput.value);
  if (!selected) return;
  controlSize = selected;
  writePreference('pocket-pal-control-size', controlSize);
  applyControlSettings();
});
leftHandedInput.addEventListener('change', () => {
  leftHanded = leftHandedInput.checked;
  writeSetting('pocket-pal-left-handed', leftHanded);
  applyControlSettings();
});
hapticsInput.addEventListener('change', () => {
  hapticsOn = hapticsInput.checked;
  writeSetting('pocket-pal-haptics', hapticsOn);
  applyControlSettings();
});
controlOpacityInput.addEventListener('input', () => {
  controlOpacity = Number(controlOpacityInput.value);
  writePreference('pocket-pal-control-opacity', String(controlOpacity));
  applyControlSettings();
});
soundToggle.addEventListener('click', () => {
  muted = !muted;
  writeSetting('pocket-pal-muted', muted);
  soundToggle.setAttribute('aria-pressed', String(muted));
  soundToggle.innerHTML = `<span class="button-icon" aria-hidden="true">${muted ? '♪' : '♫'}</span><span>${muted ? 'Sound off' : 'Sound on'}</span>`;
  stageSound.setMuted(muted);
  if (!muted) playSound('wake', false);
});
crtToggle.addEventListener('click', () => {
  crtOn = !crtOn;
  writeSetting('pocket-pal-crt', crtOn);
  crtToggle.setAttribute('aria-pressed', String(crtOn));
  crtToggle.innerHTML = `<span class="button-icon" aria-hidden="true">▦</span><span>${crtOn ? 'CRT on' : 'CRT off'}</span>`;
  root?.classList.toggle('crt-on', crtOn);
});

root.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.dataset.guideAction === 'dismiss') {
    onboardingDismissed = true;
    writeSetting('pocket-pal-onboarding-dismissed', onboardingDismissed);
    if (state) updateControls(state);
  } else if (button.dataset.guideAction === 'dungeon') {
    if (state && !button.disabled) {
      openDungeonSurface(state);
    }
  } else if (button.id === 'stage-sheet-toggle') {
    if (sheetSwipeHandled) {
      sheetSwipeHandled = false;
      return;
    }
    setStageDrawerExpanded(!must<HTMLElement>('#stage-drawer').classList.contains('is-expanded'));
  } else if (button.dataset.stageTab) {
    const tab = button.dataset.stageTab;
    if (tab === 'pack' || tab === 'gear' || tab === 'care' || tab === 'log' || tab === 'stats') {
      selectedStageTab = tab;
      setStageDrawerExpanded(true);
      if (state) renderStageSheet(state);
    }
  } else if (button.dataset.stageOpen) {
    if (button.dataset.stageOpen === 'dungeon') {
      if (state) openDungeonSurface(state);
    } else if (button.dataset.stageOpen === 'gear') {
      if (state) renderEquipment(state);
      gearDialog.showModal();
    } else if (button.dataset.stageOpen === 'training') {
      if (state) updateControls(state);
      minigameChoices.hidden = false;
      minigameStage.hidden = true;
      minigameDialog.showModal();
    }
  } else if (button.hasAttribute('data-stage-speed')) {
    const speeds: AnimationSpeed[] = ['1x', '2x', 'skip'];
    animationSpeed = speeds[(speeds.indexOf(animationSpeed) + 1) % speeds.length] ?? '1x';
    writePreference('pocket-pal-animation-speed', animationSpeed);
    if (state) updateStageHud(state);
    showToast(`Animation speed · ${animationSpeedLabel(animationSpeed)}.`);
  } else if (button.dataset.action) {
    activateCareButton(button);
  } else if (button.id === 'mini-mode-button') {
    void miniMode.enter().then((opened) => {
      if (opened) return;
      showToast(state?.paused ? 'Continue with Pip before opening mini mode.' : 'Mini mode could not open here.');
    });
  } else if (button.id === 'dungeon-open') {
    if (state) openDungeonSurface(state);
  } else if (button.id === 'dungeon-close') {
    dungeonDialog.close();
    dungeonDialog.classList.remove('is-run-sheet');
  } else if (button.id === 'home-open') {
    if (state) renderHome(state);
    homeDialog.showModal();
  } else if (button.id === 'home-close') {
    homeDialog.close();
  } else if (button.id === 'gear-open') {
    if (state) renderEquipment(state);
    gearDialog.showModal();
  } else if (button.id === 'gear-close') {
    gearDialog.close();
  } else if (button.dataset.gearTab) {
    if (button.dataset.gearTab === 'loadout' || button.dataset.gearTab === 'bag' || button.dataset.gearTab === 'workshop') {
      selectedGearTab = button.dataset.gearTab;
      if (state) renderEquipment(state);
    }
  } else if (button.dataset.gearAction) {
    activateGearAction(button);
  } else if (button.dataset.homeTab) {
    if (button.dataset.homeTab === 'upgrades' || button.dataset.homeTab === 'achievements' || button.dataset.homeTab === 'records' || button.dataset.homeTab === 'endless') {
      selectedHomeTab = button.dataset.homeTab;
      if (state) renderHome(state);
    }
  } else if (button.dataset.homeAction) {
    activateHomeAction(button);
  } else if (button.dataset.endlessAction) {
    activateEndlessAction(button);
  } else if (button.id === 'forms-open') {
    if (state) renderFormDex(state);
    dexDialog.showModal();
  } else if (button.id === 'dex-close') {
    dexDialog.close();
  } else if (button.id === 'evolution-stone') {
    sendAction({ type: 'use-evolution-stone' });
  } else if (button.id === 'minigames-open') {
    if (state) updateControls(state);
    minigameChoices.hidden = false;
    minigameStage.hidden = true;
    minigameDialog.showModal();
  } else if (button.id === 'minigame-close') {
    minigameDialog.close();
  } else if (button.dataset.game) {
    startMiniGame(button.dataset.game as MiniGameKind);
  } else if (button.id === 'minigame-again') {
    minigameStage.hidden = true;
    minigameChoices.hidden = false;
    if (state) updateControls(state);
  } else if (button.dataset.runMode === 'standard' || button.dataset.runMode === 'daily') {
    if (button.dataset.runMode !== 'daily' || state?.endless.dailyAttemptDate !== getCurrentUtcDateKey()) {
      selectedDungeonMode = button.dataset.runMode;
      if (state) renderDungeon(state);
    }
  } else if (button.dataset.runAction) {
    activateDungeonAction(button);
  } else if (button.id === 'resume-button') {
    state = state ? { ...state, paused: false } : state;
    worker.postMessage({ type: 'resume' });
    lastFrameTime = 0;
    if (state) updateControls(state);
    showToast('Time with Pip is back on.');
  } else if (button.id === 'about-open') {
    window.location.hash = '/about';
  } else if (button.id === 'about-close') {
    aboutDialog.close();
  }
});

minigameStage.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (button) miniGameInput?.(button);
});
minigameDialog.addEventListener('close', () => {
  clearMiniGameTimers();
  miniGameInput = null;
  minigameStage.hidden = true;
  minigameChoices.hidden = false;
});
minigameDialog.addEventListener('click', (event) => {
  if (event.target === minigameDialog) minigameDialog.close();
});
dungeonDialog.addEventListener('click', (event) => {
  if (event.target === dungeonDialog) dungeonDialog.close();
});
gearDialog.addEventListener('click', (event) => {
  if (event.target === gearDialog) gearDialog.close();
});
homeDialog.addEventListener('click', (event) => {
  if (event.target === homeDialog) homeDialog.close();
});
homeDialog.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'home-meal-stat' && Object.hasOwn(statLabels, target.value)) {
    selectedMealStat = target.value as StatKey;
  } else if (target instanceof HTMLInputElement && target.hasAttribute('data-endless-modifier')) {
    const selected = [...homeDialog.querySelectorAll<HTMLInputElement>('[data-endless-modifier]:checked')].map((input) => input.value);
    sendAction({ type: 'endless-set-modifiers', modifierIds: selected });
    const selectionLimit = endlessRules.difficultyModifiers.selectionLimit;
    const countLabel = homeDialog.querySelector<HTMLElement>('.modifier-count');
    if (countLabel) countLabel.textContent = `${selected.length} / ${selectionLimit} selected`;
    homeDialog.querySelectorAll<HTMLInputElement>('[data-endless-modifier]').forEach((input) => {
      input.disabled = Boolean(state?.paused || state?.dungeon.activeRun || (!input.checked && selected.length >= selectionLimit));
    });
  }
});
homeDialog.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement && target.id === 'ghost-code-input') {
    ghostCodeInput = target.value.slice(0, endlessRules.petCodes.maximumEncodedCharacters);
    if (target.value !== ghostCodeInput) target.value = ghostCodeInput;
    ghostBattleResult = null;
    ghostBattleError = '';
  }
});
gearDialog.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.hasAttribute('data-fuse-item')) {
    selectedFuseIds = [...gearContent.querySelectorAll<HTMLInputElement>('[data-fuse-item]:checked')].map((input) => input.value);
    if (state) renderEquipment(state);
  } else if (target instanceof HTMLSelectElement && target.id === 'fusion-affix') {
    if (state) renderEquipment(state);
  } else if (target instanceof HTMLSelectElement && target.id === 'auto-scrap-select') {
    const threshold = target.value;
    if (threshold === 'off' || equipmentRules.fusion.rarityOrder.includes(threshold as ItemRarity)) {
      sendAction({ type: 'set-auto-scrap', threshold: threshold as AutoScrapThreshold });
    }
  }
});
dexDialog.addEventListener('click', (event) => {
  if (event.target === dexDialog) dexDialog.close();
});

aboutDialog.addEventListener('click', (event) => {
  if (event.target === aboutDialog) aboutDialog.close();
});
aboutDialog.addEventListener('close', () => {
  if (window.location.hash === '#/about') {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
  }
});
window.addEventListener('hashchange', syncAboutRoute);
syncAboutRoute();

function syncAboutRoute(): void {
  if (window.location.hash === '#/about') {
    if (!aboutDialog.open) aboutDialog.showModal();
  } else if (aboutDialog.open) {
    aboutDialog.close();
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || aboutDialog.open || settingsDialog.open || dexDialog.open || homeDialog.open || minigameDialog.open || dungeonDialog.open) return;
  const target = event.target as HTMLElement;
  if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if (key >= '1' && key <= '3') {
    const food = foods[Number(key) - 1];
    if (food) sendAction({ type: 'feed', foodId: food.id });
  } else if (key === 'p') sendAction({ type: 'play' });
  else if (key === 's') sendAction({ type: 'toggle-sleep' });
  else if (key === 'c') sendAction({ type: 'clean' });
});

window.addEventListener('beforeinstallprompt', (event: Event) => {
  event.preventDefault();
  pendingInstall = event as BeforeInstallPromptEvent;
  installButton?.removeAttribute('hidden');
});

installButton.addEventListener('click', async () => {
  if (!pendingInstall) return;
  await pendingInstall.prompt();
  const choice = await pendingInstall.userChoice;
  showToast(choice.outcome === 'accepted' ? 'Pocket Pal is ready to install.' : 'Install can wait for another time.');
  pendingInstall = null;
  installButton?.setAttribute('hidden', '');
});

worker.addEventListener('message', onWorkerMessage);
attachPauseHandlers({
  pause: pauseAndSave,
  saveNow: scheduleSave,
  miniModeActive: () => miniMode.open,
});
window.setInterval(scheduleSave, rules.simulation.autosaveSeconds * 1000);

void (async () => {
  const saved = await loadGame();
  const initial = saved ?? createInitialState(createSeed());
  worker.postMessage({ type: 'load', state: initial, startPaused: saved !== null });
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
      lastSavedLabel = 'Offline setup unavailable';
      saveStatus.textContent = lastSavedLabel;
    });
  }
})();
window.requestAnimationFrame(startLoop);

function createSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] ?? 1;
  }
  return Date.now() >>> 0;
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
function activateCareButton(button: HTMLButtonElement): void {
  if (button.dataset.action === 'feed' && button.dataset.foodId) {
    sendAction({ type: 'feed', foodId: button.dataset.foodId });
  } else if (button.dataset.action === 'play') {
    sendAction({ type: 'play' });
  } else if (button.dataset.action === 'clean') {
    sendAction({ type: 'clean' });
  } else if (button.dataset.action === 'toggle-sleep') {
    sendAction({ type: 'toggle-sleep' });
  }
}

function activateDungeonAction(button: HTMLButtonElement): void {
  const action = button.dataset.runAction;
  if (action === 'start') {
    const mode = selectedDungeonMode;
    sendAction({ type: 'dungeon-start-run', consumables: [...selectedDungeonPack], mode, ...(mode === 'daily' ? { dateKey: getCurrentUtcDateKey() } : {}) });
  } else if (action === 'room') {
    const roomType = button.dataset.roomType;
    if (roomType && ['fight', 'elite', 'event', 'treasure', 'rest', 'shop', 'boss'].includes(roomType)) {
      sendAction({ type: 'dungeon-choose-room', roomType: roomType as DungeonRoomType });
    }
  } else if (action === 'tactic' && button.dataset.tacticId) {
    sendAction({ type: 'dungeon-choose-tactic', tacticId: button.dataset.tacticId });
  } else if (action === 'event' && button.dataset.optionId) {
    sendAction({ type: 'dungeon-choose-event', optionId: button.dataset.optionId });
  } else if (action === 'treasure') {
    sendAction({ type: 'dungeon-open-treasure' });
  } else if (action === 'rest') {
    sendAction({ type: 'dungeon-rest' });
  } else if (action === 'buy' && button.dataset.consumableId) {
    sendAction({ type: 'dungeon-buy-consumable', consumableId: button.dataset.consumableId });
  } else if (action === 'buy-gear' && button.dataset.offerId) {
    sendAction({ type: 'dungeon-buy-equipment', offerId: button.dataset.offerId });
  } else if (action === 'take-drop' || action === 'scrap-drop' || action === 'leave-drop') {
    const choice = action === 'take-drop' ? 'take' : action === 'scrap-drop' ? 'scrap' : 'leave';
    sendAction({ type: 'dungeon-resolve-item', choice });
  } else if (action === 'continue-shop') {
    sendAction({ type: 'dungeon-finish-shop' });
  } else if (action === 'use' && button.dataset.slot !== undefined) {
    sendAction({ type: 'dungeon-use-consumable', slot: Number(button.dataset.slot) });
  } else if (action === 'descend') {
    sendAction({ type: 'dungeon-descend' });
  } else if (action === 'leave') {
    sendAction({ type: 'dungeon-leave' });
  } else if (action === 'close-summary') {
    sendAction({ type: 'dungeon-close-summary' });
  }
}

function activateGearAction(button: HTMLButtonElement): void {
  const action = button.dataset.gearAction;
  const instanceId = button.dataset.instanceId;
  if (action === 'equip' && instanceId) {
    sendAction({ type: 'equip-item', instanceId });
  } else if (action === 'unequip' && button.dataset.slot) {
    const slot = button.dataset.slot;
    if (['Weapon', 'Armor', 'Hat', 'Charm'].includes(slot)) sendAction({ type: 'unequip-item', slot: slot as EquipmentSlot });
  } else if (action === 'scrap' && instanceId) {
    sendAction({ type: 'scrap-item', instanceId });
  } else if (action === 'upgrade' && instanceId) {
    sendAction({ type: 'upgrade-item', instanceId });
  } else if (action === 'fuse') {
    const keepAffixId = gearContent.querySelector<HTMLSelectElement>('#fusion-affix')?.value || null;
    sendAction({ type: 'fuse-items', instanceIds: [...selectedFuseIds], keepAffixId });
    selectedFuseIds = [];
  } else if (action === 'craft-stone') {
    sendAction({ type: 'craft-evolution-stone' });
  }
}

function activateHomeAction(button: HTMLButtonElement): void {
  if (button.dataset.homeAction === 'upgrade') {
    const upgradeId = button.dataset.upgradeId;
    if (upgradeId && getHomeUpgradeDefinitions().some((upgrade) => upgrade.id === upgradeId)) {
      sendAction({ type: 'home-upgrade', upgradeId: upgradeId as HomeUpgradeId });
    }
  } else if (button.dataset.homeAction === 'cook-meal') {
    const selected = homeContent.querySelector<HTMLSelectElement>('#home-meal-stat')?.value ?? selectedMealStat;
    if (Object.hasOwn(statLabels, selected)) {
      selectedMealStat = selected as StatKey;
      sendAction({ type: 'home-cook-meal', stat: selectedMealStat });
    }
  }
}

function activateEndlessAction(button: HTMLButtonElement): void {
  const action = button.dataset.endlessAction;
  if (action === 'daily') {
    selectedDungeonMode = 'daily';
    selectedDungeonPack = [];
    homeDialog.close();
    if (state) renderDungeon(state);
    dungeonDialog.showModal();
  } else if (action === 'ascend') {
    const perkId = button.dataset.perkId;
    if (perkId && getAscensionPerks().some((perk) => perk.id === perkId)) {
      sendAction({ type: 'endless-ascend', perkId: perkId as AscensionPerkId });
    }
  } else if (action === 'export') {
    void createPetCode();
  } else if (action === 'copy-code') {
    void copyPetCode();
  } else if (action === 'ghost-battle') {
    void startGhostBattle();
  }
}

async function createPetCode(): Promise<void> {
  const current = state;
  if (!current) return;
  const payload = createPetCodePayload(current);
  if (!payload) {
    ghostBattleError = 'Hatch Pip and discover a form before creating a pet code.';
    renderHome(current);
    return;
  }
  try {
    petCodeOutput = await encodePetCode(payload);
    ghostBattleError = '';
    renderHome(current);
    const output = homeContent.querySelector<HTMLTextAreaElement>('#pet-code-output');
    output?.focus();
    output?.select();
  } catch (error) {
    ghostBattleError = error instanceof Error ? error.message : 'Pet code could not be created.';
    renderHome(current);
  }
}

async function copyPetCode(): Promise<void> {
  if (!petCodeOutput) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
    await navigator.clipboard.writeText(petCodeOutput);
    showToast('Pet code copied. Share it with a friend.');
  } catch {
    const output = homeContent.querySelector<HTMLTextAreaElement>('#pet-code-output');
    output?.focus();
    output?.select();
    showToast('The code is selected. Copy it from the text box.');
  }
}

async function startGhostBattle(): Promise<void> {
  const current = state;
  if (!current) return;
  const ownPet = createPetCodePayload(current);
  if (!ownPet) {
    ghostBattleError = 'Hatch Pip and discover a form before starting a ghost battle.';
    ghostBattleResult = null;
    renderHome(current);
    return;
  }
  try {
    const visitor = await decodePetCode(ghostCodeInput.trim());
    ghostBattleResult = simulateGhostBattle(ownPet, visitor, (current.seed ^ current.generation) >>> 0);
    ghostBattleError = '';
  } catch (error) {
    ghostBattleResult = null;
    ghostBattleError = error instanceof Error ? error.message : 'This pet code could not be used.';
  }
  renderHome(current);
}

attachTouchControls({
  root,
  onActivate: activateCareButton,
  hapticsEnabled: () => hapticsOn,
});

const stageSheetHandle = must<HTMLButtonElement>('#stage-sheet-toggle');
let sheetPointerStartY = 0;
stageSheetHandle.addEventListener('pointerdown', (event) => { sheetPointerStartY = event.clientY; });
stageSheetHandle.addEventListener('pointerup', (event) => {
  const delta = event.clientY - sheetPointerStartY;
  if (Math.abs(delta) < 36) return;
  setStageDrawerExpanded(delta < 0);
  sheetSwipeHandled = true;
  window.setTimeout(() => { sheetSwipeHandled = false; }, 500);
});
