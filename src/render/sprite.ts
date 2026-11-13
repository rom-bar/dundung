import type { GameState } from '../core/types';
import { getMood } from '../core/game';
import evolutions from '../data/evolutions.json';
import rules from '../data/rules.json';
import { getFormDefinition } from '../core/progression';

const width = 240;
const height = 160;
const colors = {
  night: '#1b172b',
  deep: '#29243b',
  rock: '#483d59',
  rockLight: '#64536c',
  mint: '#abdfb4',
  mintShade: '#68aa83',
  honey: '#f1c96b',
  honeyShade: '#c78d4e',
  pet: '#a5dfb2',
  petShade: '#619779',
  petLight: '#d9f4c5',
  plum: '#d782a7',
  cream: '#fff1c9',
  water: '#82c8d3',
};

const stars = [
  [22, 31], [48, 51], [80, 22], [119, 38], [171, 26], [210, 48], [196, 78], [34, 88],
] as const;

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawHabitat(ctx: CanvasRenderingContext2D, seconds: number, reducedMotion: boolean): void {
  rect(ctx, 0, 0, width, height, colors.night);
  rect(ctx, 0, 105, width, 55, colors.deep);

  // Stalactites and ledges make the scene feel like a quiet underground pocket.
  rect(ctx, 0, 0, width, 12, colors.deep);
  rect(ctx, 18, 12, 10, 18, colors.deep);
  rect(ctx, 28, 12, 8, 10, colors.deep);
  rect(ctx, 89, 12, 12, 14, colors.deep);
  rect(ctx, 101, 12, 8, 8, colors.deep);
  rect(ctx, 187, 12, 12, 20, colors.deep);
  rect(ctx, 199, 12, 8, 10, colors.deep);
  rect(ctx, 10, 94, 24, 5, colors.rock);
  rect(ctx, 206, 92, 22, 5, colors.rock);

  stars.forEach(([x, y], index) => {
    const flicker = reducedMotion ? 0 : Math.sin(seconds * 2 + index) * 1.5;
    rect(ctx, x, y + flicker, index % 3 === 0 ? 3 : 2, index % 3 === 0 ? 3 : 2,
      index % 2 === 0 ? colors.honey : colors.mint);
  });

  // A tiny spring and two fern silhouettes frame the pet without hiding it.
  rect(ctx, 25, 118, 3, 18, colors.mintShade);
  rect(ctx, 17, 115, 9, 4, colors.mint);
  rect(ctx, 25, 109, 8, 4, colors.mint);
  rect(ctx, 29, 119, 8, 4, colors.mint);
  rect(ctx, 205, 121, 3, 17, colors.mintShade);
  rect(ctx, 198, 116, 8, 4, colors.mint);
  rect(ctx, 207, 110, 8, 4, colors.mint);
  rect(ctx, 208, 122, 10, 4, colors.mint);
  rect(ctx, 0, 139, width, 21, colors.rock);
  rect(ctx, 0, 139, width, 3, colors.rockLight);
  rect(ctx, 42, 148, 9, 3, colors.honeyShade);
  rect(ctx, 179, 145, 11, 3, colors.honeyShade);
  rect(ctx, 88, 143, 5, 3, colors.rockLight);
  rect(ctx, 146, 151, 8, 3, colors.rockLight);
}

function drawEgg(ctx: CanvasRenderingContext2D, cx: number, top: number, frame: number): void {
  const wobble = frame % 2 === 0 ? 0 : 1;
  const x = cx - 21 + wobble;
  rect(ctx, x + 12, top, 18, 4, colors.cream);
  rect(ctx, x + 7, top + 4, 28, 4, colors.honey);
  rect(ctx, x + 4, top + 8, 34, 8, colors.honey);
  rect(ctx, x, top + 16, 42, 24, colors.honey);
  rect(ctx, x + 4, top + 40, 34, 8, colors.honeyShade);
  rect(ctx, x + 8, top + 48, 26, 4, colors.honeyShade);
  rect(ctx, x + 8, top + 12, 8, 4, colors.cream);
  rect(ctx, x + 12, top + 8, 8, 4, colors.cream);
  rect(ctx, x + 13, top + 26, 4, 5, colors.deep);
  rect(ctx, x + 27, top + 26, 4, 5, colors.deep);
  rect(ctx, x + 17, top + 35, 10, 3, colors.honeyShade);
}

function drawHatchBurst(ctx: CanvasRenderingContext2D, cx: number, top: number, progress: number, reducedMotion: boolean): void {
  const distance = reducedMotion ? 0 : Math.max(0, Math.min(1, progress)) * 9;
  rect(ctx, cx - 32 - distance, top + 20 - distance, 5, 5, colors.honey);
  rect(ctx, cx + 27 + distance, top + 26 + distance, 5, 5, colors.cream);
  rect(ctx, cx - 27 - distance / 2, top + 42 + distance, 4, 4, colors.honeyShade);
  rect(ctx, cx + 25 + distance / 2, top + 16 - distance, 4, 4, colors.mint);
}

function drawGearOverlays(ctx: CanvasRenderingContext2D, x: number, y: number, state: GameState): void {
  const equipped = state.equipment?.equipped;
  if (!equipped) return;
  const rarityColor = (rarity: string): string => ({
    Common: '#c9c2d0',
    Uncommon: colors.mint,
    Rare: colors.honey,
    Epic: '#c89be8',
    Legendary: '#f08d69',
  })[rarity] ?? colors.honey;

  const hat = equipped.Hat;
  if (hat) {
    const color = rarityColor(hat.rarity);
    rect(ctx, x + 15, y + 7, 26, 3, colors.deep);
    rect(ctx, x + 18, y + 3, 20, 5, color);
    rect(ctx, x + 14, y + 8, 29, 3, color);
    rect(ctx, x + 23, y + 4, 5, 2, colors.cream);
  }

  const armor = equipped.Armor;
  if (armor) {
    const color = rarityColor(armor.rarity);
    rect(ctx, x + 15, y + 19, 27, 3, colors.deep);
    rect(ctx, x + 14, y + 22, 4, 13, color);
    rect(ctx, x + 18, y + 22, 21, 11, color);
    rect(ctx, x + 39, y + 22, 4, 13, color);
    rect(ctx, x + 22, y + 23, 13, 2, colors.cream);
    rect(ctx, x + 27, y + 27, 4, 4, colors.deep);
  }

  const weapon = equipped.Weapon;
  if (weapon) {
    const color = rarityColor(weapon.rarity);
    rect(ctx, x + 41, y + 28, 12, 3, color);
    rect(ctx, x + 49, y + 23, 4, 14, color);
    rect(ctx, x + 47, y + 36, 8, 3, colors.honeyShade);
    rect(ctx, x + 45, y + 27, 4, 2, colors.cream);
  }

  const charm = equipped.Charm;
  if (charm) {
    const color = rarityColor(charm.rarity);
    rect(ctx, x - 7, y + 27, 5, 5, color);
    rect(ctx, x - 5, y + 23, 2, 13, colors.cream);
    rect(ctx, x - 9, y + 28, 10, 2, colors.cream);
  }
}

function drawBaby(ctx: CanvasRenderingContext2D, cx: number, top: number, frame: number, sleeping: boolean, state: GameState): void {
  const x = cx - 24;
  const hop = frame % 2 === 0 ? 0 : -3;
  const y = top + hop;
  const form = getFormDefinition(state.evolution.formId);
  const palette = form ? evolutions.elements[form.element] : null;
  const body = palette?.color ?? colors.pet;
  const shade = palette?.shade ?? colors.petShade;
  const light = palette?.light ?? colors.petLight;
  const scale = state.stage === 'baby' ? 1 : state.stage === 'teen' ? 1.08 : state.stage === 'adult' ? 1.18 : 1.12;
  ctx.save();
  ctx.translate(cx, y + 27);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -y - 27);

  // The base pixel body keeps the same silhouette while palettes and small marks make forms distinct.
  rect(ctx, x + 5, y + 15, 8, 10, shade);
  rect(ctx, x + 11, y + 7, 8, 10, body);
  rect(ctx, x + 34, y + 7, 8, 10, body);
  rect(ctx, x + 39, y + 15, 7, 10, shade);
  rect(ctx, x + 5, y + 25, 6, 20, shade);
  rect(ctx, x + 11, y + 17, 34, 31, body);
  rect(ctx, x + 17, y + 11, 22, 8, body);
  rect(ctx, x + 11, y + 42, 8, 8, shade);
  rect(ctx, x + 37, y + 42, 8, 8, shade);
  rect(ctx, x + 18, y + 31, 20, 13, light);
  rect(ctx, x + 13, y + 22, 6, 4, colors.cream);

  if (form?.archetype === 'tank') {
    rect(ctx, x + 1, y + 27, 10, 9, shade);
    rect(ctx, x + 41, y + 27, 9, 9, shade);
    rect(ctx, x + 21, y + 15, 8, 5, light);
  } else if (form?.archetype === 'striker') {
    rect(ctx, x + 14, y + 3, 5, 8, light);
    rect(ctx, x + 34, y + 3, 5, 8, light);
    rect(ctx, x + 22, y + 42, 7, 3, shade);
  } else if (form?.archetype === 'trickster') {
    rect(ctx, x - 3, y + 35, 8, 4, shade);
    rect(ctx, x - 7, y + 31, 5, 4, body);
    rect(ctx, x + 40, y + 11, 6, 4, light);
  } else if (form?.archetype === 'healer') {
    rect(ctx, x + 20, y + 4, 8, 6, light);
    rect(ctx, x + 15, y + 8, 6, 4, body);
    rect(ctx, x + 28, y + 8, 6, 4, body);
  }

  if (sleeping) {
    rect(ctx, x + 17, y + 25, 7, 3, colors.deep);
    rect(ctx, x + 33, y + 25, 7, 3, colors.deep);
    rect(ctx, x + 25, y + 34, 8, 3, colors.petShade);
  } else if (frame % 5 === 0) {
    rect(ctx, x + 17, y + 24, 7, 3, colors.deep);
    rect(ctx, x + 33, y + 24, 7, 3, colors.deep);
    rect(ctx, x + 27, y + 33, 5, 4, colors.petShade);
  } else {
    rect(ctx, x + 18, y + 23, 4, 5, colors.deep);
    rect(ctx, x + 34, y + 23, 4, 5, colors.deep);
    rect(ctx, x + 27, y + 34, 6, 3, colors.petShade);
  }
  rect(ctx, x + 9, y + 31, 5, 4, colors.plum);
  rect(ctx, x + 41, y + 31, 5, 4, colors.plum);
  drawGearOverlays(ctx, x, y, state);
  ctx.restore();
}

function drawSignal(ctx: CanvasRenderingContext2D, state: GameState): void {
  const mood = getMood(state);
  if (mood === 'content') return;
  const mark = mood === 'sick' ? '!' : mood === 'unhappy' ? '…' : '?';
  ctx.fillStyle = colors.cream;
  ctx.fillRect(158, 48, 42, 27);
  ctx.fillRect(153, 54, 6, 13);
  ctx.fillRect(151, 69, 8, 6);
  ctx.fillStyle = colors.deep;
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(mark, 179, 62);
}

export function drawPetScene(
  canvas: HTMLCanvasElement,
  state: GameState,
  nowSeconds: number,
  reducedMotion: boolean,
  renderCharacter = true,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const animationTime = reducedMotion ? 0 : nowSeconds;
  drawHabitat(ctx, animationTime, reducedMotion);
  if (renderCharacter) drawPetCharacter(ctx, state, nowSeconds, reducedMotion);
}

export function drawPetCharacter(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  nowSeconds: number,
  reducedMotion: boolean,
  centerX = 120,
): void {
  ctx.save();
  ctx.translate(centerX - 120, 0);
  const animationTime = reducedMotion ? 0 : nowSeconds;

  const animationActive = state.animationRemainingSeconds > 0;
  const bouncing = animationActive && (state.animation === 'play' || state.animation === 'wake');
  const eating = animationActive && state.animation === 'eat';
  const hatching = animationActive && state.animation === 'hatch';
  const frame = Math.floor(animationTime * (bouncing ? 8 : 2));
  const petTop = 83 + (bouncing ? Math.sin(animationTime * 14) * 5 : hatching && !reducedMotion ? Math.sin(animationTime * 8) * 2 : eating ? 2 : 0);

  if (state.stage === 'egg') drawEgg(ctx, 120, petTop + 1, frame);
  else drawBaby(ctx, 120, petTop, frame, state.sleeping || state.animation === 'sleep', state);
  if (hatching) drawHatchBurst(ctx, 120, petTop, 1 - state.animationRemainingSeconds / rules.animationSeconds.hatch, reducedMotion);
  drawSignal(ctx, state);

  if (state.animation === 'evolve' && state.animationRemainingSeconds > 0) {
    const twinkle = reducedMotion ? 0 : Math.floor(nowSeconds * 8) % 2;
    rect(ctx, 82, 77 - twinkle, 4, 4, colors.honey);
    rect(ctx, 150, 72 + twinkle, 4, 4, colors.honey);
    rect(ctx, 92, 54 + twinkle, 3, 3, colors.mint);
    rect(ctx, 143, 56 - twinkle, 3, 3, colors.mint);
  }

  if (state.sleeping && state.stage === 'baby') {
    ctx.fillStyle = colors.honey;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('z', 155, 96 + Math.sin(animationTime * 2) * (reducedMotion ? 0 : 2));
    ctx.font = '8px monospace';
    ctx.fillText('z', 165, 88 + Math.sin(animationTime * 2 + 1) * (reducedMotion ? 0 : 2));
  }
  ctx.restore();
}
