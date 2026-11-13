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
import { getBiomeForFloor, getDungeonData } from './core/dungeon';
import type { DungeonRoomType, DungeonRunState } from './core/types';
import evolutions from './data/evolutions.json';
import dungeonRules from './data/dungeon-rules.json';
import './style.css';

const dungeonData = getDungeonData();
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
let selectedDungeonPack: string[] = [];

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
        <button class="quiet-button" id="dungeon-open" type="button" aria-label="Dungeon" aria-haspopup="dialog" aria-controls="dungeon-dialog" data-testid="dungeon-open" disabled>
          <span class="button-icon" aria-hidden="true">⌁</span><span>Dungeon</span>
        </button>
        <button class="quiet-button" id="forms-open" type="button" aria-label="Forms" aria-haspopup="dialog" aria-controls="dex-dialog" data-testid="forms-open">
          <span class="button-icon" aria-hidden="true">✧</span><span>Forms</span>
        </button>
        <button class="quiet-button" id="settings-open" type="button" aria-label="Settings" aria-haspopup="dialog" aria-controls="settings-dialog" data-testid="settings-open">
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

function healthMeter(label: string, value: number, maximum: number, kind: string): string {
  const percent = Math.max(0, Math.min(100, Math.round((value / Math.max(1, maximum)) * 100)));
  return `<div class="dungeon-meter dungeon-meter-${kind}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${Math.round(maximum)}" aria-valuenow="${Math.round(value)}"><span style="width:${percent}%"></span><small>${escapeHtml(label)} · ${Math.round(value)} / ${Math.round(maximum)}</small></div>`;
}

const roomPresentation: Record<DungeonRoomType, { title: string; detail: string; mark: string }> = {
  fight: { title: 'Skirmish', detail: 'A quick auto-fight and a handful of coins.', mark: '✦' },
  elite: { title: 'Elite', detail: 'A tougher foe with a brighter reward.', mark: '◆' },
  event: { title: 'Event', detail: 'Choose a little risk or a little reward.', mark: '☼' },
  treasure: { title: 'Treasure', detail: 'Open a chest for run coins and a chance at a token.', mark: '▣' },
  rest: { title: 'Rest', detail: 'Restore health and a little energy.', mark: '☾' },
  shop: { title: 'Shop', detail: 'Spend run coins on a pack item.', mark: '⌂' },
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

function renderDungeonStart(current: GameState): string {
  const active = current.stage !== 'egg' && !current.sleeping && Boolean(current.evolution.formId);
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
      : 'Choose up to three run-only items. Unused items leave with the run.';
  return `<div class="dungeon-start-grid">
    <section class="dungeon-start-story"><p class="eyebrow">A new route every time</p><h3>Make a small plan, then see how far Pip can go.</h3><p>${escapeHtml(reason)}</p>
      <div class="dungeon-records"><span><strong>${current.dungeon.coins}</strong><small>banked coins</small></span><span><strong>${current.dungeon.petDeepestFloor}</strong><small>this pet's best floor</small></span><span><strong>${current.dungeon.deepestFloor}</strong><small>all-time best</small></span></div>
      <p class="dungeon-note">Coins and treasure are banked when Pip leaves or faints. Fainting keeps half the coins and a random half of the tokens.</p>
    </section>
    <section class="pack-picker" aria-labelledby="pack-title"><div class="dungeon-section-heading"><div><p class="eyebrow">Before the first step</p><h3 id="pack-title">Pack up to 3 items</h3></div><span class="pack-count" id="pack-count">0 / 3</span></div>
      <div class="pack-choice-list">${items}</div>
      <button class="primary-button dungeon-start-button" type="button" data-run-action="start" data-testid="dungeon-start" ${active ? '' : 'disabled'}>Start a run</button>
    </section>
  </div>`;
}

function bindDungeonStartControls(current: GameState): void {
  const startButton = dungeonContent.querySelector<HTMLButtonElement>('[data-run-action="start"]');
  if (startButton) startButton.disabled = current.paused || current.stage === 'egg' || current.sleeping || !current.evolution.formId;
  const packChecks = [...dungeonContent.querySelectorAll<HTMLInputElement>('[data-pack-item]')];
  const packCount = dungeonContent.querySelector<HTMLElement>('#pack-count');
  const refreshPackCount = () => {
    const selectedChecks = packChecks.filter((check) => check.checked);
    selectedDungeonPack = selectedChecks.map((check) => check.value);
    const selected = selectedChecks.length;
    if (packCount) packCount.textContent = `${selected} / ${dungeonRules.packSlots}`;
    packChecks.forEach((check) => { check.disabled = !check.checked && selected >= dungeonRules.packSlots; });
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
  } else if (run.phase === 'event' && run.eventId) {
    const event = dungeonData.events.find((item) => item.id === run.eventId);
    stage = event ? `<section class="dungeon-decision event-scene"><p class="eyebrow">A small story on the path</p><h3>${escapeHtml(event.title)}</h3><p class="dungeon-body-copy">${escapeHtml(event.description)}</p><div class="event-options">${event.options.map((option) => `<button class="event-option" type="button" data-run-action="event" data-option-id="${escapeHtml(option.id)}"><strong>${escapeHtml(option.label)}</strong><small>${Math.round(option.successChance * 100)}% chance to go well</small></button>`).join('')}</div></section>` : '';
  } else if (run.phase === 'treasure') {
    stage = `<section class="dungeon-decision room-interlude"><span class="interlude-mark" aria-hidden="true">▣</span><p class="eyebrow">A quiet glimmer</p><h3>Treasure room</h3><p class="dungeon-body-copy">Open a small chest for run coins and a chance to find a token. Tokens become coins when the run ends.</p><button class="primary-button" type="button" data-run-action="treasure">Open treasure</button></section>`;
  } else if (run.phase === 'rest') {
    stage = `<section class="dungeon-decision room-interlude"><span class="interlude-mark" aria-hidden="true">☾</span><p class="eyebrow">Take a breath</p><h3>Rest stop</h3><p class="dungeon-body-copy">Restore ${Math.round(run.petMaxHp * dungeonRules.restHealPercent)} health and ${dungeonRules.restEnergyRestore} energy before continuing.</p><button class="primary-button" type="button" data-run-action="rest">Rest here</button></section>`;
  } else if (run.phase === 'shop') {
    stage = `<section class="dungeon-decision"><p class="eyebrow">Traveling shop · ${run.coins} run coins</p><h3>Choose a useful little thing</h3><div class="shop-list">${run.shopOfferIds.map((id) => {
      const item = dungeonData.consumables.find((candidate) => candidate.id === id);
      if (!item) return '';
      return `<div class="shop-item"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span><button class="shop-buy" type="button" data-run-action="buy" data-consumable-id="${escapeHtml(item.id)}" ${run.consumables.length >= dungeonRules.packSlots || run.coins < item.price ? 'disabled' : ''}>${item.price} coins</button></div>`;
    }).join('') || '<p class="pack-empty">The shelf is empty. Move on when you are ready.</p>'}</div><button class="quiet-button continue-room" type="button" data-run-action="continue-shop">Leave the shop</button></section>`;
  } else if (run.phase === 'floor-end') {
    stage = `<section class="dungeon-decision floor-stop"><p class="eyebrow">A natural stopping point</p><h3>Floor ${run.floor} cleared</h3><p class="dungeon-body-copy">Pip has ${run.petHp} / ${run.petMaxHp} health. You can bank everything now, or descend to floor ${run.floor + 1}.</p><div class="floor-actions"><button class="primary-button" type="button" data-run-action="descend" data-testid="dungeon-descend">Descend to floor ${run.floor + 1}</button><button class="quiet-button leave-button" type="button" data-run-action="leave" data-testid="dungeon-leave">Leave and bank rewards</button></div></section>`;
  } else if (run.phase === 'summary') {
    stage = `<section class="dungeon-decision run-summary" data-testid="dungeon-summary"><span class="interlude-mark ${run.result === 'fainted' ? 'is-fainted' : ''}" aria-hidden="true">${run.result === 'fainted' ? '♡' : '✦'}</span><p class="eyebrow">${run.result === 'fainted' ? 'A brave try' : 'Safe return'}</p><h3>${run.result === 'fainted' ? 'Pip is ready to rest' : 'The descent is complete'}</h3><p class="dungeon-body-copy">${run.result === 'fainted' ? `Pip reached floor ${run.floor} and came back exhausted.` : `Pip reached floor ${run.floor} and returned safely.`} ${run.lostLootCount ? `${run.lostLootCount} treasure token${run.lostLootCount === 1 ? '' : 's'} were lost.` : ''}</p><div class="dungeon-records"><span><strong>+${run.bankedCoins}</strong><small>coins banked</small></span><span><strong>${run.bankedLootCount}</strong><small>tokens kept</small></span><span><strong>${current.dungeon.petDeepestFloor}</strong><small>this pet's best</small></span></div><button class="primary-button" type="button" data-run-action="close-summary" data-testid="dungeon-summary-close">Back to Pip</button></section>`;
  }

  dungeonContent.innerHTML = `<div class="dungeon-run-grid" style="--biome-accent:${escapeHtml(biome.accent)}">
    <section class="dungeon-map" aria-label="Floor map">
      <div class="biome-banner"><div><p class="eyebrow">Floor ${run.floor}</p><h3>${escapeHtml(biome.name)}</h3></div><span class="biome-sigil" aria-hidden="true">${evolutions.elements[biome.element].mark}</span></div>
      <ol class="dungeon-path" aria-label="${roomCount} room route">${nodes}</ol>
      <div class="run-ledger"><span><small>Run coins</small><strong>${run.coins}</strong></span><span><small>Treasure</small><strong>${run.lootIds.length} token${run.lootIds.length === 1 ? '' : 's'}</strong></span><span><small>Wallet</small><strong>${current.dungeon.coins}</strong></span></div>
      ${healthMeter('Pip health', run.petHp, run.petMaxHp, 'pet')}
      <div class="care-conditions"><span>Hunger ${Math.round(current.needs.hunger)}%</span><span>Energy ${Math.round(current.needs.energy)}%</span></div>
      ${modifiers.length ? `<div class="run-modifiers" aria-label="Run boons and curses">${modifiers.map((modifier) => `<span>${escapeHtml(modifier)}</span>`).join('')}</div>` : ''}
    </section>
    <section class="dungeon-console">${stage}${run.phase !== 'summary' ? `<section class="pack-panel" aria-label="Run pack"><div class="dungeon-section-heading"><h3>Run pack</h3><span>${run.consumables.length} / ${dungeonRules.packSlots}</span></div>${renderPack(run)}</section>` : ''}</section>
  </div>`;
}

function renderFoodActions(): void {
  const grid = must<HTMLDivElement>('#food-actions');
  const marks: Record<string, string> = {
    'moonberry-jam': '●',
    'dew-drop': '◉',
    'moss-muffin': '▣',
  };
  grid.innerHTML = foods.map((food, index) => `
    <button class="food-button" type="button" data-action="feed" data-food-id="${food.id}" data-testid="feed-${food.id}" aria-label="${food.name}. Feed Pip. ${food.description}" title="${food.description}">
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
  const dungeonOpen = must<HTMLButtonElement>('#dungeon-open');
  dungeonOpen.disabled = current.paused || (!current.dungeon.activeRun && (current.sleeping || current.stage === 'egg' || !current.evolution.formId));
  dungeonOpen.setAttribute('aria-pressed', String(Boolean(current.dungeon.activeRun)));
  if (dungeonDialog.open) renderDungeon(current);

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
  } else if (button.id === 'dungeon-open') {
    if (state) renderDungeon(state);
    dungeonDialog.showModal();
  } else if (button.id === 'dungeon-close') {
    dungeonDialog.close();
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
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || aboutDialog.open || settingsDialog.open || dexDialog.open || minigameDialog.open || dungeonDialog.open) return;
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
    sendAction({ type: 'dungeon-start-run', consumables: [...selectedDungeonPack] });
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

attachTouchControls({
  root,
  onActivate: activateCareButton,
  hapticsEnabled: () => hapticsOn,
});
