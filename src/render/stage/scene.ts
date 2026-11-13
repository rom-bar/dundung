import type { DungeonRunState, GameState } from '../../core/types';
import dungeonData from '../../data/biomes.json';
import evolutions from '../../data/evolutions.json';
import { drawPetCharacter, drawPetScene } from '../sprite';
import type { StageEventFrame } from './event-player';

export type StageSceneKind = 'home' | 'dungeon_walk' | 'battle' | 'event';

const WIDTH = 240;
const HEIGHT = 160;
const battleEventTypes = new Set<string>([
  'enemy_appear', 'boss_intro', 'combat_start', 'attack', 'miss', 'heal', 'buff_applied', 'status_applied', 'victory', 'boss_phase', 'faint',
]);

function withResponsiveSprite(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  anchorX: number,
  anchorY: number,
  sourceHeight: number,
  targetHeight: number,
  draw: () => void,
): void {
  const cssScaleX = cssWidth / WIDTH;
  const cssScaleY = cssHeight / HEIGHT;
  const uniformCssScale = targetHeight / sourceHeight;
  ctx.save();
  ctx.translate(anchorX, anchorY);
  ctx.scale(uniformCssScale / cssScaleX, uniformCssScale / cssScaleY);
  ctx.translate(-anchorX, -anchorY);
  draw();
  ctx.restore();
}

function responsiveCharacterHeight(cssHeight: number): number {
  return Math.max(24, Math.min(88, (cssHeight || HEIGHT) * 0.84));
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function easeOutCubic(value: number): number {
  const progress = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - progress, 3);
}

function colorForRun(run: DungeonRunState): { accent: string; light: string; dark: string } {
  const biome = dungeonData.find((item) => item.id === run.biomeId);
  const element = evolutions.elements[run.petElement];
  const accent = biome?.accent ?? element.color;
  return { accent, light: element.light, dark: element.shade };
}

function drawDungeonBackdrop(ctx: CanvasRenderingContext2D, time: number, reducedMotion: boolean, run: DungeonRunState): void {
  const { accent, light, dark } = colorForRun(run);
  const drift = reducedMotion ? 0 : (time * 13) % 48;
  rect(ctx, 0, 0, WIDTH, HEIGHT, '#171426');
  rect(ctx, 0, 0, WIDTH, 78, '#211c33');
  rect(ctx, 0, 42, WIDTH, 48, '#2a263d');
  rect(ctx, 0, 84, WIDTH, 76, '#302b40');

  // Layered silhouettes scroll at different rates to suggest a long, living corridor.
  for (let index = 0; index < 6; index += 1) {
    const x = index * 48 - drift;
    rect(ctx, x, 37 + (index % 2) * 5, 22, 36, '#39334b');
    rect(ctx, x + 4, 43 + (index % 2) * 5, 14, 30, '#272338');
    rect(ctx, x + 8, 48 + (index % 2) * 5, 6, 25, '#211d32');
  }
  for (let index = 0; index < 7; index += 1) {
    const x = ((index * 43 - drift * 0.62) % (WIDTH + 14) + WIDTH + 14) % (WIDTH + 14) - 7;
    rect(ctx, x, 95 + (index % 3) * 14, 15, 3, index % 2 ? '#544b60' : '#665768');
  }
  rect(ctx, 0, 121, WIDTH, 39, '#332d42');
  rect(ctx, 0, 121, WIDTH, 4, '#665768');
  rect(ctx, 0, 146, WIDTH, 2, '#4e4659');

  // A small far doorway gives the corridor a destination rather than a dashboard feel.
  rect(ctx, 187, 49, 27, 45, '#171426');
  rect(ctx, 191, 53, 19, 38, accent);
  rect(ctx, 195, 57, 11, 34, '#211d32');
  rect(ctx, 197, 70, 4, 4, light);

  for (const x of [34, 157]) {
    rect(ctx, x, 61, 3, 17, '#a8754f');
    rect(ctx, x - 3, 58, 9, 5, '#d48c56');
    const flicker = reducedMotion ? 0 : Math.sin(time * 8 + x) * 2;
    rect(ctx, x - 2, 51 - flicker, 7, 8 + flicker, accent);
    rect(ctx, x, 54 - flicker, 3, 5, '#fff0b7');
  }
  rect(ctx, 0, 157, WIDTH, 3, dark);
}

function drawRoomSet(ctx: CanvasRenderingContext2D, run: DungeonRunState, time: number, reducedMotion: boolean): void {
  const room = run.currentRoom;
  const { accent, light } = colorForRun(run);
  if (room === 'treasure' || run.phase === 'loot') {
    const bounce = reducedMotion ? 0 : Math.abs(Math.sin(time * 4)) * 3;
    rect(ctx, 152, 102 - bounce, 43, 24, '#9b673f');
    rect(ctx, 148, 97 - bounce, 50, 10, '#d4944c');
    rect(ctx, 160, 98 - bounce, 25, 4, '#f1c96b');
    rect(ctx, 170, 106 - bounce, 9, 8, '#f1c96b');
    rect(ctx, 172, 106 - bounce, 4, 5, '#3b2e3f');
    rect(ctx, 159, 90 - bounce, 3, 3, light);
    rect(ctx, 186, 85 - bounce, 3, 3, accent);
  } else if (room === 'rest') {
    rect(ctx, 149, 119, 47, 6, '#54425c');
    rect(ctx, 154, 111, 38, 8, '#abdfb4');
    rect(ctx, 156, 107, 15, 4, '#f7f0dc');
  } else if (room === 'event') {
    rect(ctx, 166, 70, 3, 45, '#b68158');
    rect(ctx, 156, 75, 23, 3, accent);
    rect(ctx, 158, 78, 4, 7, light);
    rect(ctx, 173, 78, 4, 7, light);
    rect(ctx, 159, 92, 21, 3, '#f1c96b');
  }
}

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  run: DungeonRunState,
  time: number,
  reducedMotion: boolean,
  centerX: number,
  eventFrame: StageEventFrame | null,
): void {
  const enemy = run.enemy;
  if (!enemy) return;
  const palette = evolutions.elements[enemy.element];
  const bob = reducedMotion ? 0 : Math.sin(time * 4.5 + 1) * 2;
  const scale = enemy.kind === 'boss' ? 1.18 : enemy.kind === 'elite' ? 1.07 : 1;
  const entering = eventFrame?.event?.type === 'enemy_appear' && eventFrame.event.enemyId === enemy.id;
  const entranceProgress = entering ? eventFrame.summary ? 1 : easeOutCubic(eventFrame.progress) : 1;
  const entranceScale = entering ? 0.38 + entranceProgress * 0.62 : 1;
  const entranceY = entering && !reducedMotion && !eventFrame.summary ? (1 - entranceProgress) * 13 : 0;
  const x = centerX;
  const y = 71 + bob + entranceY;
  ctx.save();
  ctx.globalAlpha = entering ? 0.48 + entranceProgress * 0.52 : 1;
  ctx.translate(x, y);
  ctx.scale(scale * entranceScale, scale * entranceScale);
  rect(ctx, -21, 37, 42, 4, '#171426');
  rect(ctx, -18, 17, 36, 22, palette.shade);
  rect(ctx, -15, 7, 30, 22, palette.color);
  rect(ctx, -11, 1, 22, 12, palette.color);
  rect(ctx, -17, 12, 8, 8, palette.light);
  rect(ctx, 9, 12, 8, 8, palette.light);
  rect(ctx, -11, 16, 4, 6, '#171426');
  rect(ctx, 7, 16, 4, 6, '#171426');
  rect(ctx, -5, 27, 10, 3, palette.shade);
  if (enemy.kind === 'elite' || enemy.kind === 'boss') {
    rect(ctx, -15, 0, 7, 8, '#f1c96b');
    rect(ctx, 8, 0, 7, 8, '#f1c96b');
  }
  if (enemy.kind === 'boss') {
    rect(ctx, -24, 4, 6, 21, palette.shade);
    rect(ctx, 18, 4, 6, 21, palette.shade);
  }
  ctx.restore();

  const width = enemy.kind === 'boss' ? 45 : 37;
  const percent = Math.max(0, Math.min(1, enemy.hp / Math.max(1, enemy.maxHp)));
  const gauge = Math.max(0, Math.min(1, enemy.gauge / 100));
  const accent = palette.color;
  rect(ctx, x - width / 2, 51, width, 4, '#171426');
  rect(ctx, x - width / 2 + 1, 52, (width - 2) * percent, 2, '#dc7181');
  rect(ctx, x - width / 2, 57, width, 2, '#171426');
  rect(ctx, x - width / 2, 57, width * gauge, 2, accent);
}

function drawBattlePetHud(ctx: CanvasRenderingContext2D, run: DungeonRunState, centerX: number): void {
  const hp = Math.max(0, Math.min(1, run.petHp / Math.max(1, run.petMaxHp)));
  const gauge = Math.max(0, Math.min(1, run.petGauge / 100));
  const x = centerX - 23;
  rect(ctx, x, 54, 46, 4, '#171426');
  rect(ctx, x + 1, 55, 44 * hp, 2, '#abdfb4');
  rect(ctx, x, 60, 46, 2, '#171426');
  rect(ctx, x, 60, 46 * gauge, 2, '#f1c96b');
}

function attackLunge(frame: StageEventFrame | null, source: 'pet' | 'enemy', reducedMotion: boolean): number {
  const event = frame?.event;
  if (!event || event.type !== 'attack' || event.source !== source || reducedMotion || frame.summary) return 0;
  const progress = Math.max(0, Math.min(1, frame.progress));
  return Math.sin(progress * Math.PI) * (event.critical ? 15 : 9);
}

function drawStageEventCue(
  ctx: CanvasRenderingContext2D,
  frame: StageEventFrame | null,
  petCenter: number,
  enemyCenter: number,
  reducedMotion: boolean,
): void {
  const event = frame?.event;
  if (!event) return;
  const progress = frame.summary ? 1 : Math.max(0, Math.min(1, frame.progress));
  if (event.type === 'attack') {
    const targetX = event.target === 'pet' ? petCenter : enemyCenter;
    const targetY = event.target === 'pet' ? 92 : 88;
    const staticCue = reducedMotion || frame.summary;
    const spread = staticCue ? 0 : Math.sin(progress * Math.PI) * (event.critical ? 13 : 9);
    const alpha = staticCue ? 1 : Math.min(1, progress * 3, (1 - progress) * 3 + 0.18);
    const color = event.critical ? '#f1c96b' : event.target === 'pet' ? '#f28b89' : '#fff1c9';
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI / 3 + event.id * 0.37;
      const distance = spread + (staticCue ? 5 : 2);
      rect(ctx, targetX + Math.cos(angle) * distance, targetY + Math.sin(angle) * distance, 3, 3, color);
    }
    ctx.fillStyle = color;
    ctx.font = event.critical ? 'bold 9px monospace' : 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${event.critical ? '!' : ''}${event.amount}`, targetX, targetY - (staticCue ? 12 : 12 + spread * 0.35));
    if (event.critical) {
      ctx.font = 'bold 6px monospace';
      ctx.fillText('CRIT', targetX, targetY - 21);
    }
    ctx.restore();
    return;
  }

  if (event.type === 'miss') {
    ctx.save();
    ctx.fillStyle = '#f1c96b';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MISS', event.source === 'pet' ? petCenter : enemyCenter, 78);
    ctx.restore();
    return;
  }

  if (event.type === 'boss_intro' || event.type === 'combat_start') {
    const visible = frame.summary || progress > 0.08;
    if (!visible) return;
    ctx.save();
    ctx.globalAlpha = frame.summary || reducedMotion ? 1 : Math.min(1, progress * 4, (1 - progress) * 4 + 0.25);
    rect(ctx, 48, 18, 144, 16, '#171426');
    rect(ctx, 48, 18, 144, 1, '#f1c96b');
    ctx.fillStyle = '#fff1c9';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(event.type === 'boss_intro' ? 'A BOSS APPROACHES' : 'FIGHT!', 120, 27, 136);
    ctx.restore();
    return;
  }

  if (event.type === 'heal') {
    ctx.save();
    ctx.fillStyle = '#abdfb4';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`+${event.amount} HP`, petCenter, 81 - (reducedMotion || frame.summary ? 0 : Math.sin(progress * Math.PI) * 7));
    ctx.restore();
    return;
  }

  if (event.type === 'status_applied' || event.type === 'buff_applied') {
    ctx.save();
    ctx.fillStyle = event.type === 'buff_applied' ? '#abdfb4' : '#82c8d3';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    const label = event.type === 'buff_applied'
      ? `${event.stat ?? 'BUFF'} UP`
      : event.stat ? `${event.stat} UP` : event.status.toUpperCase();
    ctx.fillText(label, event.target === 'pet' ? petCenter : enemyCenter, 77);
    ctx.restore();
    return;
  }

  const banner = event.type === 'victory' ? 'VICTORY'
    : event.type === 'boss_phase' ? 'NEW BOSS MOVE'
      : event.type === 'faint' ? 'PIP NEEDS REST' : null;
  if (banner) {
    ctx.save();
    ctx.globalAlpha = frame.summary || reducedMotion ? 1 : Math.min(1, progress * 4, (1 - progress) * 4 + 0.25);
    rect(ctx, 57, 20, 126, 16, '#171426');
    rect(ctx, 57, 20, 126, 1, '#f1c96b');
    ctx.fillStyle = '#fff1c9';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner, 120, 28, 118);
    ctx.restore();
  }
}

export function getStageSceneKind(state: GameState): StageSceneKind {
  const run = state.dungeon.activeRun;
  if (!run) return 'home';
  if (run.phase === 'event' || run.phase === 'treasure' || run.phase === 'rest' || run.phase === 'shop' || run.phase === 'loot') return 'event';
  if (run.phase === 'tactic' || run.phase === 'combat') return 'battle';
  return 'dungeon_walk';
}

export function drawStageScene(
  canvas: HTMLCanvasElement,
  state: GameState,
  nowSeconds: number,
  reducedMotion: boolean,
  eventFrame: StageEventFrame | null = null,
  cssWidth = canvas.clientWidth || WIDTH,
  cssHeight = canvas.clientHeight || HEIGHT,
): void {
  const run = state.dungeon.activeRun;
  const scene = getStageSceneKind(state);
  if (!run || scene === 'home') {
    drawPetScene(canvas, state, nowSeconds, reducedMotion, false);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const targetHeight = responsiveCharacterHeight(cssHeight);
    withResponsiveSprite(ctx, cssWidth, cssHeight, WIDTH / 2, 139, 56, targetHeight, () => {
      drawPetCharacter(ctx, state, nowSeconds, reducedMotion, WIDTH / 2);
    });
    drawStageEventCue(ctx, eventFrame, WIDTH / 2, WIDTH / 2, reducedMotion);
    return;
  }

  const ctx = canvas.getContext('2d', { desynchronized: true });
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const time = reducedMotion ? 0 : nowSeconds;
  drawDungeonBackdrop(ctx, time, reducedMotion, run);
  drawRoomSet(ctx, run, time, reducedMotion);

  if (scene === 'battle') {
    const petLunge = attackLunge(eventFrame, 'pet', reducedMotion);
    const enemyLunge = attackLunge(eventFrame, 'enemy', reducedMotion);
    const petCenter = 69 + (reducedMotion ? 0 : Math.sin(time * 3) * 2) + petLunge;
    const enemyCenter = 166 - enemyLunge;
    const targetHeight = responsiveCharacterHeight(cssHeight);
    withResponsiveSprite(ctx, cssWidth, cssHeight, petCenter, 139, 56, targetHeight, () => {
      rect(ctx, petCenter - 23, 121, 46, 4, '#171426');
      drawPetCharacter(ctx, state, nowSeconds, reducedMotion, petCenter);
    });
    const hudScaleX = Math.min(72, cssWidth * 0.28) / (46 * (cssWidth / WIDTH));
    const hudScaleY = 6 / (8 * (cssHeight / HEIGHT));
    ctx.save();
    ctx.translate(petCenter, 62);
    ctx.scale(hudScaleX, hudScaleY);
    ctx.translate(-petCenter, -62);
    drawBattlePetHud(ctx, run, petCenter);
    ctx.restore();
    const enemyHeight = Math.max(24, Math.min(52, cssHeight * 0.68));
    withResponsiveSprite(ctx, cssWidth, cssHeight, enemyCenter, 110, 59, enemyHeight, () => {
      drawEnemy(ctx, run, time, reducedMotion, enemyCenter, eventFrame);
    });
    drawStageEventCue(ctx, eventFrame, petCenter, enemyCenter, reducedMotion);
    return;
  }

  const walking = scene === 'dungeon_walk' && run.phase === 'choice';
  const walk = reducedMotion ? 0 : Math.sin(time * (walking ? 8.5 : 2.7)) * (walking ? 4 : 6);
  const centerX = 112 + walk;
  const targetHeight = responsiveCharacterHeight(cssHeight);
  withResponsiveSprite(ctx, cssWidth, cssHeight, centerX, 139, 56, targetHeight, () => {
    rect(ctx, centerX - 22, 130, 44, 4, '#171426');
    drawPetCharacter(ctx, state, nowSeconds, reducedMotion, centerX);
  });
  drawStageEventCue(ctx, eventFrame, centerX, 166, reducedMotion);
}

export class StageSceneRenderer {
  private state: GameState | null = null;
  private lastBattleState: GameState | null = null;
  private timeSeconds = 0;
  private reducedMotion = false;
  private eventFrame: StageEventFrame | null = null;
  private cssWidth = WIDTH;
  private cssHeight = HEIGHT;

  rememberBattleState(state: GameState): void {
    const run = state.dungeon.activeRun;
    if (run && (run.phase === 'tactic' || run.phase === 'combat')) this.lastBattleState = state;
  }

  update(state: GameState, timeSeconds: number, reducedMotion: boolean, eventFrame: StageEventFrame | null, hasBattleSequence = false): void {
    const run = state.dungeon.activeRun;
    const battlePhase = Boolean(run && (run.phase === 'tactic' || run.phase === 'combat'));
    if (battlePhase) this.lastBattleState = state;
    else if (!run) this.lastBattleState = null;

    const lastRun = this.lastBattleState?.dungeon.activeRun;
    const eventType = eventFrame?.event?.type;
    const roomTransition = eventFrame?.event?.type === 'room_enter'
      && ['fight', 'elite', 'boss'].includes(eventFrame.event.roomType);
    const battleEvent = hasBattleSequence || Boolean(eventType && (battleEventTypes.has(eventType) || roomTransition));
    const shouldHoldBattleScene = Boolean(
      run
      && lastRun
      && run.generation === lastRun.generation
      && !battlePhase
      && battleEvent,
    );
    this.state = shouldHoldBattleScene && lastRun
      ? { ...state, dungeon: { ...state.dungeon, activeRun: lastRun } }
      : state;
    if (!battlePhase && !battleEvent) this.lastBattleState = null;
    this.timeSeconds = timeSeconds;
    this.reducedMotion = reducedMotion;
    this.eventFrame = eventFrame;
  }

  draw(canvas: HTMLCanvasElement, cssWidth = this.cssWidth, cssHeight = this.cssHeight): void {
    if (!this.state) return;
    drawStageScene(canvas, this.state, this.timeSeconds, this.reducedMotion, this.eventFrame, cssWidth, cssHeight);
  }

  visualState(): GameState | null {
    return this.state;
  }

  clear(canvas: HTMLCanvasElement): void {
    this.lastBattleState = null;
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
    this.state = null;
    this.eventFrame = null;
  }

  resize(canvas: HTMLCanvasElement): void {
    if (canvas.width !== WIDTH) canvas.width = WIDTH;
    if (canvas.height !== HEIGHT) canvas.height = HEIGHT;
    this.cssWidth = canvas.clientWidth || WIDTH;
    this.cssHeight = canvas.clientHeight || HEIGHT;
    const context = canvas.getContext('2d');
    if (context) context.imageSmoothingEnabled = false;
  }
}

export function stageCaption(state: GameState): string {
  const run = state.dungeon.activeRun;
  if (!run) return state.sleeping ? 'A quiet moment in the pocket habitat.' : 'Pip wanders softly around the room.';
  if (run.phase === 'combat' && run.enemy) return `${run.enemy.name} · auto-fight in progress`;
  if (run.phase === 'tactic' && run.enemy) return `${run.enemy.name} is here · choose a tactic`;
  if (run.phase === 'choice') return `Floor ${run.floor} · choose the next room`;
  if (run.phase === 'floor-end') return `Floor ${run.floor} cleared · choose what comes next`;
  if (run.phase === 'summary') return run.result === 'fainted' ? 'A brave try · Pip needs a rest.' : 'Safe return · your finds are ready.';
  if (run.phase === 'event') return 'A small story waits on the path.';
  if (run.phase === 'treasure' || run.phase === 'loot') return 'A little glimmer caught Pip’s eye.';
  if (run.phase === 'rest') return 'A quiet spot to catch a breath.';
  if (run.phase === 'shop') return 'A traveling shop has opened.';
  return `Floor ${run.floor} · ${run.currentRoom ?? 'on the path'}`;
}

export function stageLocation(state: GameState): string {
  const run = state.dungeon.activeRun;
  if (!run) return 'HOME';
  const biome = dungeonData.find((item) => item.id === run.biomeId);
  if (run.phase === 'combat' || run.phase === 'tactic') return run.enemy?.kind === 'boss' ? 'BOSS' : 'BATTLE';
  if (run.phase === 'summary') return 'RETURN';
  if (run.currentRoom === 'treasure' || run.phase === 'loot') return 'TREASURE';
  if (run.currentRoom) return run.currentRoom.toUpperCase();
  return biome?.name.toUpperCase() ?? 'DUNGEON';
}
