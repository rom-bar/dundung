import foods from '../data/foods.json';
import rooms from '../data/rooms.json';
import type { GameAction, GameState, NeedKey } from '../core/types';
import { drawPetScene } from '../render/sprite';

const needLabels: Record<NeedKey, string> = {
  hunger: 'Fullness',
  happiness: 'Joy',
  energy: 'Energy',
  hygiene: 'Freshness',
};
const needKeys: NeedKey[] = ['hunger', 'happiness', 'energy', 'hygiene'];

type PipWindow = Window & { documentPictureInPicture?: DocumentPipApi };
type DocumentPipApi = EventTarget & {
  window: Window | null;
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
};
type VideoPipElement = HTMLVideoElement & { requestPictureInPicture?: () => Promise<PictureInPictureWindow> };

export interface MiniModeOptions {
  canvas: HTMLCanvasElement;
  getState: () => GameState | null;
  onTick: (dtMs: number) => void;
  onAction: (action: GameAction) => void;
  onOpen: (kind: 'document' | 'video') => void;
  onClose: () => void;
}

export interface MiniModeController {
  readonly available: boolean;
  readonly open: boolean;
  readonly kind: 'document' | 'video' | null;
  enter: () => Promise<boolean>;
  update: (state: GameState) => void;
  setMessage: (message: string) => void;
  dispose: () => void;
}

export function createMiniMode(options: MiniModeOptions): MiniModeController {
  let pipWindow: Window | null = null;
  let video: VideoPipElement | null = null;
  let stream: MediaStream | null = null;
  let animationFrame = 0;
  let videoTimer = 0;
  let previousFrame = 0;
  let activeKind: 'document' | 'video' | null = null;
  let currentState: GameState | null = null;
  let message = 'Care stays close while you switch apps.';
  let disposed = false;

  const documentPip = (window as PipWindow).documentPictureInPicture;
  const canUseVideoPip = typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && typeof (HTMLVideoElement.prototype as VideoPipElement).requestPictureInPicture === 'function';

  const controller: MiniModeController = {
    get available() { return Boolean(documentPip || canUseVideoPip); },
    get open() { return activeKind !== null; },
    get kind() { return activeKind; },
    async enter() {
      if (disposed || activeKind || !controller.available) return false;
      const state = options.getState();
      if (!state || state.paused) return false;
      if (documentPip) {
        try {
          pipWindow = await documentPip.requestWindow({ width: 320, height: 400 });
          buildDocumentWindow(pipWindow);
          activeKind = 'document';
          options.onOpen('document');
          renderDocument(state, performance.now());
          previousFrame = 0;
          animationFrame = pipWindow.requestAnimationFrame(documentFrame);
          pipWindow.addEventListener('pagehide', handleClosed, { once: true });
          return true;
        } catch {
          pipWindow = null;
        }
      }
      if (canUseVideoPip) return enterVideoPip();
      return false;
    },
    update(state) {
      currentState = state;
      if (activeKind === 'document') renderDocument(state, performance.now());
    },
    setMessage(value) {
      message = value;
      const line = pipWindow?.document.querySelector<HTMLElement>('#mini-message');
      if (line) line.textContent = value;
    },
    dispose() {
      disposed = true;
      clearVideoLoop();
      if (animationFrame && pipWindow) pipWindow.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (pipWindow && !pipWindow.closed) pipWindow.close();
      pipWindow = null;
      if (video) {
        video.removeEventListener('leavepictureinpicture', handleClosed);
        video.pause();
        video.srcObject = null;
        video.remove();
      }
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video = null;
      activeKind = null;
    },
  };

  function buildDocumentWindow(target: Window): void {
    const doc = target.document;
    doc.open();
    doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocket Pal mini mode</title></head><body></body></html>');
    doc.close();
    doc.documentElement.style.colorScheme = 'dark';
    doc.body.style.cssText = 'margin:0; min-width:280px; min-height:100vh; background:#1b172b; color:#f7f0dc; font:13px ui-rounded,"Trebuchet MS",system-ui,sans-serif;';

    document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach((source) => {
      doc.head.append(source.cloneNode(true));
    });
    const miniStyle = doc.createElement('style');
    miniStyle.textContent = `
      *{box-sizing:border-box} body{padding:12px;background:#1b172b;color:#f7f0dc}
      .mini-card{max-width:420px;margin:0 auto}.mini-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 9px}
      .mini-title h1{margin:0;font:11px 'Press Start 2P',monospace;line-height:1.7}.mini-stage{color:#abdfb4;font-size:11px}
      .mini-scene{width:100%;display:block;border:1px solid rgba(241,201,107,.28);background:#211d32;image-rendering:pixelated}
      .mini-needs{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;margin:10px 0;color:#ded6e8;font-size:10px}
      .mini-need{min-width:0}.mini-label{display:flex;justify-content:space-between;margin-bottom:3px}.mini-meter{height:5px;background:#151221;border:1px solid rgba(247,240,220,.12)}
      .mini-fill{display:block;height:100%;background:#abdfb4}.mini-fill.low{background:#f1c96b}.mini-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
      .mini-dungeon{margin:0 0 9px;padding:8px;border:1px solid rgba(241,201,107,.3);background:#242035}.mini-dungeon[hidden]{display:none}.mini-dungeon-head{display:flex;justify-content:space-between;gap:8px;color:#f1c96b;font-size:10px;font-weight:700}.mini-dungeon-room{margin:4px 0 6px;color:#c9bfd5;font-size:9px}.mini-dungeon-meter{height:7px;overflow:hidden;border:1px solid rgba(247,240,220,.15);background:#151221}.mini-dungeon-meter span{display:block;height:100%;background:#abdfb4;transition:width 100ms linear}
      .mini-actions button{min-width:0;min-height:42px;border:1px solid rgba(219,207,235,.17);border-radius:4px;background:#29243b;color:#f7f0dc;font:600 10px ui-rounded,'Trebuchet MS',system-ui,sans-serif;cursor:pointer;touch-action:manipulation}
      .mini-actions button:disabled{opacity:.48}.mini-actions button:focus-visible{outline:2px solid #f1c96b;outline-offset:2px}
      #mini-message{min-height:28px;margin:8px 0 0;color:#aaa0b8;font-size:10px;line-height:1.4}
      @media(max-width:300px){body{padding:8px}.mini-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
    `;
    doc.head.append(miniStyle);

    const card = doc.createElement('main');
    card.className = 'mini-card';
    card.innerHTML = `
      <header class="mini-title"><h1>Pocket Pal</h1><span class="mini-stage" id="mini-stage">Egg</span></header>
      <canvas class="mini-scene" id="mini-scene" width="240" height="160" role="img" aria-label="Pip in the pocket habitat"></canvas>
      <section class="mini-needs" aria-label="Pip's needs">
        ${needKeys.map((key) => `<div class="mini-need"><div class="mini-label"><span>${needLabels[key]}</span><span data-mini-value="${key}">100%</span></div><div class="mini-meter" role="progressbar" aria-label="${needLabels[key]}" aria-valuemin="0" aria-valuemax="100" data-mini-meter="${key}"><span class="mini-fill" data-mini-fill="${key}"></span></div></div>`).join('')}
      </section>
      <section class="mini-dungeon" id="mini-dungeon" aria-label="Dungeon progress" hidden>
        <div class="mini-dungeon-head"><span id="mini-dungeon-floor">Floor 1</span><span id="mini-dungeon-health">HP</span></div>
        <p class="mini-dungeon-room" id="mini-dungeon-room">Choosing a path</p>
        <div class="mini-dungeon-meter" role="progressbar" aria-label="Dungeon health" aria-valuemin="0" data-mini-dungeon-meter><span id="mini-dungeon-fill"></span></div>
      </section>
      <div class="mini-actions" aria-label="Quick care actions">
        <button type="button" data-mini-action="feed" aria-label="Feed Pip">Snack</button>
        <button type="button" data-mini-action="play" aria-label="Play with Pip">Play</button>
        <button type="button" data-mini-action="sleep" aria-label="Tuck Pip in or wake Pip">Rest</button>
        <button type="button" data-mini-action="clean" aria-label="Clean Pip">Clean</button>
      </div>
      <p id="mini-message" role="status" aria-live="polite"></p>
    `;
    doc.body.append(card);
    card.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mini-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.miniAction;
      if (action === 'feed') options.onAction({ type: 'feed', foodId: foods[0]!.id });
      if (action === 'play') options.onAction({ type: 'play' });
      if (action === 'sleep') options.onAction({ type: 'toggle-sleep' });
      if (action === 'clean') options.onAction({ type: 'clean' });
    });
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') target.close();
    });
  }

  function documentFrame(time: number): void {
    if (!pipWindow || pipWindow.closed || activeKind !== 'document') return;
    const dt = previousFrame ? Math.min(time - previousFrame, 100) : 0;
    previousFrame = time;
    if (dt > 0) options.onTick(dt);
    if (currentState) renderDocument(currentState, time);
    animationFrame = pipWindow.requestAnimationFrame(documentFrame);
  }

  function renderDocument(state: GameState, time: number): void {
    if (!pipWindow || pipWindow.closed) return;
    const doc = pipWindow.document;
    const canvas = doc.querySelector<HTMLCanvasElement>('#mini-scene');
    if (canvas) drawPetScene(canvas, state, time / 1000, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const stage = doc.querySelector<HTMLElement>('#mini-stage');
    if (stage) stage.textContent = state.stage[0]!.toUpperCase() + state.stage.slice(1);
    needKeys.forEach((key) => {
      const percent = Math.round(state.needs[key]);
      const fill = doc.querySelector<HTMLElement>(`[data-mini-fill="${key}"]`);
      const value = doc.querySelector<HTMLElement>(`[data-mini-value="${key}"]`);
      const meter = doc.querySelector<HTMLElement>(`[data-mini-meter="${key}"]`);
      if (fill) {
        fill.style.width = `${percent}%`;
        fill.classList.toggle('low', percent < 30);
      }
      if (value) value.textContent = `${percent}%`;
      meter?.setAttribute('aria-valuenow', String(percent));
    });
    doc.querySelectorAll<HTMLButtonElement>('[data-mini-action]').forEach((button) => {
      const action = button.dataset.miniAction;
      const cooldownKey = action === 'sleep' ? 'sleep' : action;
      const sleepingLock = state.sleeping && action !== 'sleep';
      button.disabled = state.paused || sleepingLock || Boolean(cooldownKey && state.cooldowns[cooldownKey as keyof GameState['cooldowns']] > 0);
      if (action === 'sleep') button.textContent = state.sleeping ? 'Wake' : 'Rest';
    });
    const run = state.dungeon.activeRun;
    const dungeonTile = doc.querySelector<HTMLElement>('#mini-dungeon');
    const dungeonFloor = doc.querySelector<HTMLElement>('#mini-dungeon-floor');
    const dungeonRoom = doc.querySelector<HTMLElement>('#mini-dungeon-room');
    const dungeonHealth = doc.querySelector<HTMLElement>('#mini-dungeon-health');
    const dungeonMeter = doc.querySelector<HTMLElement>('[data-mini-dungeon-meter]');
    const dungeonFill = doc.querySelector<HTMLElement>('#mini-dungeon-fill');
    if (dungeonTile) dungeonTile.hidden = !run;
    if (run) {
      const roomCount = run.floor % rooms.bossEveryFloors === 0 ? 1 : rooms.roomsPerFloor;
      const roomName = run.currentRoom ? run.currentRoom[0]!.toUpperCase() + run.currentRoom.slice(1) : run.phase === 'choice' ? 'Choose a room' : run.phase;
      if (dungeonFloor) dungeonFloor.textContent = run.phase === 'summary' ? `Run ended · +${run.bankedCoins}` : `Floor ${run.floor}`;
      if (dungeonRoom) dungeonRoom.textContent = run.phase === 'summary' ? `${run.result === 'fainted' ? 'Pip fainted' : 'Safe return'} · ${run.bankedLootCount} tokens kept` : `Room ${Math.min(run.roomIndex + 1, roomCount)} / ${roomCount} · ${roomName}`;
      if (dungeonHealth) dungeonHealth.textContent = run.phase === 'summary' ? 'Done' : `${Math.round(run.petHp)} / ${Math.round(run.petMaxHp)} HP`;
      const percent = run.phase === 'summary' ? 0 : Math.max(0, Math.min(100, Math.round((run.petHp / Math.max(1, run.petMaxHp)) * 100)));
      if (dungeonFill) dungeonFill.style.width = `${percent}%`;
      dungeonMeter?.setAttribute('aria-valuemax', String(Math.round(run.petMaxHp)));
      dungeonMeter?.setAttribute('aria-valuenow', String(Math.round(run.petHp)));
    }
    const line = doc.querySelector<HTMLElement>('#mini-message');
    if (line) line.textContent = message;
  }

  async function enterVideoPip(): Promise<boolean> {
    try {
      video = document.createElement('video') as VideoPipElement;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.append(video);
      stream = options.canvas.captureStream(12);
      video.srcObject = stream;
      await video.play();
      await video.requestPictureInPicture?.();
      if (document.pictureInPictureElement !== video) throw new Error('Video Picture-in-Picture did not open.');
      activeKind = 'video';
      options.onOpen('video');
      video.addEventListener('leavepictureinpicture', handleClosed, { once: true });
      configureMediaActions();
      previousFrame = 0;
      videoTimer = window.setInterval(videoFrame, 100);
      return true;
    } catch {
      clearVideoLoop();
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video?.remove();
      video = null;
      return false;
    }
  }

  function configureMediaActions(): void {
    const session = navigator.mediaSession;
    if (!session) return;
    try {
      session.metadata = new MediaMetadata({ title: 'Pocket Pal', artist: 'Pip', album: 'Mini mode · Previous: snack · Next: play' });
      session.setActionHandler('previoustrack', () => options.onAction({ type: 'feed', foodId: foods[0]!.id }));
      session.setActionHandler('nexttrack', () => options.onAction({ type: 'play' }));
    } catch {
      // Browsers expose different media-session action sets; the video view remains useful without them.
    }
  }

function videoFrame(): void {
  const time = performance.now();
  const dt = previousFrame ? Math.min(time - previousFrame, 100) : 0;
  previousFrame = time;
  if (dt > 0) options.onTick(dt);
  if (currentState) {
    drawPetScene(options.canvas, currentState, time / 1000, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    drawDungeonVideoOverlay(options.canvas, currentState);
  }
}

function drawDungeonVideoOverlay(canvas: HTMLCanvasElement, state: GameState): void {
  const run = state.dungeon.activeRun;
  const context = canvas.getContext('2d');
  if (!run || !context) return;
  const width = canvas.width;
  const height = canvas.height;
  const boxX = 7;
  const boxY = height - 31;
  const boxWidth = width - 14;
  context.save();
  context.fillStyle = 'rgba(21, 18, 33, 0.9)';
  context.fillRect(boxX, boxY, boxWidth, 25);
  context.fillStyle = '#f7f0dc';
  context.font = '8px system-ui, sans-serif';
  context.textBaseline = 'top';
  const room = run.currentRoom ?? (run.phase === 'choice' ? 'path' : run.phase);
  context.fillText(`F${run.floor} · ${room} · ${Math.round(run.petHp)}/${Math.round(run.petMaxHp)} HP`, boxX + 5, boxY + 3, boxWidth - 10);
  context.fillStyle = '#494158';
  context.fillRect(boxX + 5, boxY + 15, boxWidth - 10, 5);
  context.fillStyle = '#abdfb4';
  context.fillRect(boxX + 5, boxY + 15, (boxWidth - 10) * Math.max(0, Math.min(1, run.petHp / Math.max(1, run.petMaxHp))), 5);
  context.restore();
}

  function clearVideoLoop(): void {
    if (videoTimer) window.clearInterval(videoTimer);
    videoTimer = 0;
  }

  function handleClosed(): void {
    if (!activeKind) return;
    clearVideoLoop();
    if (animationFrame && pipWindow) pipWindow.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    pipWindow = null;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
      video = null;
    }
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    activeKind = null;
    options.onClose();
  }

  return controller;
}
