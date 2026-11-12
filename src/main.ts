import rules from './data/rules.json';
import foods from './data/foods.json';
import { createInitialState, getMood, getNeedSignals } from './core/game';
import type { GameAction, GameState, NeedKey, WorkerOutMessage } from './core/types';
import { drawPetScene } from './render/sprite';
import { playSound, type SoundKind } from './platform/audio';
import { attachPauseHandlers } from './platform/pause';
import { loadGame, saveGame } from './platform/storage';
import { attachTouchControls } from './platform/touch-controls';
import { createMiniMode } from './platform/mini-mode';
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
  must<HTMLSpanElement>('#stage-pill').textContent = current.stage === 'egg' ? 'Egg' : 'Baby';
  must<HTMLSpanElement>('#stage-detail').textContent = current.stage === 'egg'
    ? `Hatching in ${formatClock(Math.max(0, rules.lifeStages.eggMinutes * 60 - current.stageSeconds))}`
    : 'A new little friend is here.';
  must<HTMLHeadingElement>('#pet-heading').textContent = current.stage === 'egg' ? 'A quiet place to grow' : 'Hello, little friend';
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
    state = message.state;
    updateControls(state);
    if (previousStage === 'egg' && state.stage === 'baby') showToast('Pip hatched into a little friend!');
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
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || aboutDialog.open || settingsDialog.open) return;
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
