import rules from './data/rules.json';
import foods from './data/foods.json';
import { createInitialState, getMood, getNeedSignals } from './core/game';
import type { GameAction, GameState, NeedKey, StatKey, WorkerOutMessage } from './core/types';
import { drawPetScene } from './render/sprite';
import { playSound, type SoundKind } from './platform/audio';
import { attachPauseHandlers } from './platform/pause';
import { loadGame, saveGame } from './platform/storage';
import { attachTouchControls } from './platform/touch-controls';
import { createMiniMode } from './platform/mini-mode';
import { getAllForms, getEffectiveStats, getFormDefinition, getLevelCap, getTraitList, xpToNextLevel } from './core/progression';
import evolutions from './data/evolutions.json';
import './style.css';

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
const storedMute = readSetting('pocket-pal-muted', false);
const storedCrt = readSetting('pocket-pal-crt', false);
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
let lastSavedLabel = 'Save stays on this device';
let toastTimeout = 0;
const toastQueue: string[] = [];
let toastVisible = false;
let saveRequestId = 0;
let pendingInstall: BeforeInstallPromptEvent | null = null;
let installButton: HTMLButtonElement | null = null;

root.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="${import.meta.env.BASE_URL}#/" aria-label="Pocket Pal home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="brand-name">Pocket Pal</span>
      </a>
      <div class="topbar-actions">
        <button class="quiet-button" id="mini-mode-button" type="button" aria-label="Open mini mode" title="Open mini mode">
          <span class="button-icon" aria-hidden="true">▣</span><span>Mini</span>
        </button>
        <button class="quiet-button" id="forms-open" type="button" aria-haspopup="dialog" aria-controls="dex-dialog" data-testid="forms-open">
          <span class="button-icon" aria-hidden="true">✧</span><span>Forms</span>
        </button>
        <button class="quiet-button" id="settings-open" type="button" aria-haspopup="dialog" aria-controls="settings-dialog" data-testid="settings-open">
          <span class="button-icon" aria-hidden="true">⚙</span><span>Settings</span>
        </button>
        <button class="quiet-button" id="about-open" type="button" aria-haspopup="dialog">About</button>
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

      <div class="play-layout">
        <section class="habitat-panel" aria-label="Pip's cave habitat">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Pip's pocket habitat</p>
              <h2 id="pet-heading">A quiet place to grow</h2>
            </div>
            <span class="live-pill"><span class="live-dot"></span><span id="stage-pill">Egg</span></span>
          </div>
          <div class="scene-frame">
            <canvas id="pet-scene" width="240" height="160" role="img" aria-label="Pip resting in a small cave habitat"></canvas>
            <div class="scene-caption"><span id="stage-detail">A tiny life is stirring.</span><span class="scene-pin" aria-hidden="true">✦</span></div>
          </div>
          <div class="habitat-footer">
            <span class="tiny-ledger"><span class="ledger-dot"></span><span id="save-status">${lastSavedLabel}</span></span>
            <span class="offline-label"><span aria-hidden="true">◌</span> Offline-ready</span>
          </div>
        </section>

        <section class="care-panel" aria-labelledby="care-title">
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
            <button class="action-button" type="button" data-action="play" data-testid="action-play" aria-label="Play with Pip">
              <span class="action-glyph play-glyph" aria-hidden="true">✦</span><span class="action-name">Play</span><span class="action-detail">A happy wiggle</span>
            </button>
            <button class="action-button" type="button" data-action="toggle-sleep" data-testid="action-sleep" aria-label="Tuck Pip in or wake Pip">
              <span class="action-glyph sleep-glyph" aria-hidden="true">☾</span><span class="action-name" id="sleep-label">Tuck in</span><span class="action-detail" id="sleep-detail">Rest a little</span>
            </button>
            <button class="action-button" type="button" data-action="clean" data-testid="action-clean" aria-label="Clean Pip">
              <span class="action-glyph clean-glyph" aria-hidden="true">✧</span><span class="action-name">Clean</span><span class="action-detail">A freshen-up</span>
            </button>
          </div>
          </div>
          <p class="key-hint">Keyboard: 1–3 snacks · P play · S sleep · C clean</p>
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
      <p class="eyebrow">A pocket-sized original</p>
      <h2 id="about-title">About Pocket Pal</h2>
      <p>Pocket Pal is a tiny, original pet game. Its pixel scenes, sounds, names, and code were made for this little world.</p>
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
      <button class="quiet-button stone-button" id="evolution-stone" type="button" hidden>Use Evolution Stone</button>
      <div class="form-grid" id="form-grid" role="region" tabindex="0" aria-label="Form collection; scroll to browse all forms"></div>
      <section class="hall-section" aria-labelledby="hall-title"><h3 id="hall-title">Hall of Pets</h3><div id="hall-list"></div></section>
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
  </div>
`;

const canvas = must<HTMLCanvasElement>('#pet-scene');
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
installButton = must<HTMLButtonElement>('#install-app');
const miniModeButton = must<HTMLButtonElement>('#mini-mode-button');
const miniMode = createMiniMode({
  canvas,
  getState: () => state,
  onTick: (dtMs) => worker.postMessage({ type: 'tick', dtMs }),
  onAction: sendAction,
  onOpen: (kind) => {
    miniModeButton.setAttribute('aria-pressed', 'true');
    miniModeButton.title = kind === 'document' ? 'Mini mode is open' : 'Video mini mode is open';
  },
  onClose: () => {
    miniModeButton.setAttribute('aria-pressed', 'false');
    miniModeButton.title = 'Open mini mode';
    pauseAndSave();
  },
});
if (!miniMode.available) miniModeButton.hidden = true;
root.dataset.controlSize = controlSize;
root.dataset.handedness = leftHanded ? 'left' : 'right';
root.style.setProperty('--control-opacity', String(controlOpacity / 100));

function must<T extends Element>(selector: string): T {
  const element = root?.querySelector<T>(selector);
  if (!element) throw new Error(`Pocket Pal is missing ${selector}.`);
  return element;
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
      return `<div class="hall-entry"><strong>${pet.name}</strong> · Generation ${pet.generation} · ${form?.name ?? 'Unformed'} · peak Lv ${pet.peakLevel}</div>`;
    }).join('')
    : '<p class="hall-empty">Past pets will find a place here after their long life.</p>';
  evolutionStoneButton.hidden = current.evolution.evolutionStones < 1 || !current.evolution.formId;
  evolutionStoneButton.disabled = current.paused;
  evolutionStoneButton.textContent = `Use Evolution Stone (${current.evolution.evolutionStones})`;
}

function renderFoodActions(): void {
  const grid = must<HTMLDivElement>('#food-actions');
  const marks: Record<string, string> = {
    'moonberry-jam': '●',
    'dew-drop': '◉',
    'moss-muffin': '▣',
  };
  grid.innerHTML = foods.map((food, index) => `
    <button class="food-button" type="button" data-action="feed" data-food-id="${food.id}" data-testid="feed-${food.id}" aria-label="Feed Pip ${food.name}. ${food.description}" title="${food.description}">
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

function updateControls(current: GameState): void {
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
  must<HTMLButtonElement>('[data-action="toggle-sleep"]').setAttribute('aria-label', current.sleeping ? 'Wake Pip' : 'Tuck Pip in');
  const stageNames = { egg: 'Egg', baby: 'Baby', teen: 'Teen', adult: 'Adult', elder: 'Elder' };
  const nextStageNames = { egg: 'hatching', baby: 'a teen', teen: 'an adult', adult: 'an elder', elder: 'a new egg' };
  const remaining = formatClock(Math.max(0, rules.lifeStages.stageMinutes[current.stage] * 60 - current.stageSeconds));
  const form = getFormDefinition(current.evolution.formId);
  must<HTMLSpanElement>('#stage-pill').textContent = stageNames[current.stage];
  must<HTMLSpanElement>('#stage-detail').textContent = current.stage === 'egg'
    ? `Hatching in ${remaining}`
    : `Growing into ${nextStageNames[current.stage]} in ${remaining}`;
  must<HTMLHeadingElement>('#pet-heading').textContent = form?.name ?? (current.stage === 'egg' ? 'A quiet place to grow' : 'Hello, little friend');
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

  overlay.hidden = !current.paused;
  if (current.paused) must<HTMLButtonElement>('#resume-button').focus({ preventScroll: true });
  root?.classList.toggle('crt-on', crtOn);
  drawPetScene(canvas, current, performance.now() / 1000, prefersReducedMotion.matches);
  miniMode.update(current);
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
  worker.postMessage({ type: 'action', action });
}

function onWorkerMessage(event: MessageEvent<WorkerOutMessage>): void {
  const message = event.data;
  if (message.type === 'snapshot') {
    const previousStage = state?.stage;
    const previousForm = state?.evolution.formId;
    const previousGeneration = state?.generation;
    state = message.state;
    updateControls(state);
    if (previousGeneration !== undefined && state.generation > previousGeneration) {
      showToast('A new egg has begun the next little story.');
    } else if (previousStage === 'egg' && state.stage === 'baby') {
      showToast(`Pip hatched as ${getFormDefinition(state.evolution.formId)?.name ?? 'a new friend'}!`);
    } else if (previousForm && state.evolution.formId && previousForm !== state.evolution.formId) {
      showToast(`Pip grew into ${getFormDefinition(state.evolution.formId)?.name ?? 'a new form'}.`);
    }
  } else if (message.type === 'action-result') {
    showToast(message.result.message);
    miniMode.setMessage(message.result.message);
    if (message.result.accepted && message.result.action) {
      const kind = message.result.action === 'sleep' && state?.sleeping ? 'wake' : actionAnimations[message.result.action];
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

function startLoop(now: number): void {
  if (state && !state.paused && (document.visibilityState === 'visible' || miniMode.kind === 'video')) {
    if (!miniMode.open && document.visibilityState === 'visible' && lastFrameTime > 0) {
      worker.postMessage({ type: 'tick', dtMs: Math.min(now - lastFrameTime, rules.simulation.maxStepMs) });
    }
    lastFrameTime = miniMode.open ? 0 : now;
    if (document.visibilityState === 'visible' || miniMode.kind === 'video') {
      drawPetScene(canvas, state, now / 1000, prefersReducedMotion.matches);
    }
  } else {
    lastFrameTime = 0;
  }
  window.requestAnimationFrame(startLoop);
}

renderNeedList();
renderFoodActions();
applyControlSettings();
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
  if (button.dataset.action) {
    activateCareButton(button);
  } else if (button.id === 'mini-mode-button') {
    void miniMode.enter().then((opened) => {
      if (opened) return;
      showToast(state?.paused ? 'Continue with Pip before opening mini mode.' : 'Mini mode could not open here.');
    });
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
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || aboutDialog.open || settingsDialog.open || dexDialog.open || minigameDialog.open) return;
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

attachTouchControls({
  root,
  onActivate: activateCareButton,
  hapticsEnabled: () => hapticsOn,
});
