import type PhaserType from 'phaser';
import type { GameState, StageVisualEvent } from '../../core/types';
import spriteData from '../../data/stage-sprites.json';
import type { StageEventFrame } from './event-player';
import { cosmeticSeed, createCosmeticRng } from './cosmetic-rng';
import { easeInOut, easeOut, IMPACT_END, IMPACT_START, writeAttackPose, type AttackPose } from './attack-motion';

type PhaserRuntime = typeof import('phaser');
type Sprite = PhaserType.GameObjects.Sprite;
type Image = PhaserType.GameObjects.Image;
type Text = PhaserType.GameObjects.Text;
type Rectangle = PhaserType.GameObjects.Rectangle;
type TileSprite = PhaserType.GameObjects.TileSprite;
type PreviewName = 'corridor' | 'intro' | 'attack' | 'crit' | 'chest' | 'home' | 'eating';
type Attack = Extract<StageVisualEvent, { type: 'attack' }>;

export interface NativeStageBridge {
  getState(): GameState | null;
  getEventFrame(): StageEventFrame | null;
  getNowSeconds(): number;
  isReducedMotion(): boolean;
  hasBattleSequence(): boolean;
  isDecisionPaused(): boolean;
}

export interface NativeStageScene extends PhaserType.Scene {
  create(): void;
  setPreviewState(name: PreviewName | null, progress?: number, frozen?: boolean): void;
  resizeStage(width: number, height: number): void;
  getMetrics(): { petHeight: number; stageHeight: number; activeParticleCount: number; petWidth: number; petSpriteHeight: number; petFrameName: string; petX: number; petY: number; petScaleX: number; petScaleY: number; shadowY: number };
}

export const NATIVE_STAGE_WIDTH = 240;
export const NATIVE_STAGE_HEIGHT = 160;
export const NATIVE_STAGE_ATLAS_KEY = 'pocket-pal-stage-atlas';
const MAX_PARTICLES = 40;
const BASE_PATH = `${import.meta.env.BASE_URL}assets/stage/`;
const CHARACTER_FRAME_SIZE = 48;
const CHARACTER_POSES = ['idle', 'walk-a', 'walk-b', 'hurt'] as const;
const COAL_CUB_TEXTURE = 'pocket-pal-coal-cub';
const snapPixel = (value: number): number => Math.round(value);
const F = {
  grass: 'biome1.ground.grass', detail: 'biome1.ground.grass-detail', flower: 'biome1.ground.flower',
  young: 'biome1.tree.young', round: 'biome1.tree.round', tall: 'biome1.tree.tall', canopy: 'biome1.canopy.soft',
  chest: 'chest.closed', openChest: 'chest.closed-highlight', biscuit: 'food.biscuit', coin: 'icon.coin',
  pet: 'pet1.rabbit.idle', egg: 'pet1.egg', slime: 'enemy1.slime.idle', torch: 'dungeon.torch', path: 'dungeon.path',
  sparkle: 'particle.sparkle-1', heart: 'icon.heart',
} as const;
const petPaletteTextures: Record<string, string> = {
  fire: 'pocket-pal-rabbit-fire', water: 'pocket-pal-rabbit-water', moss: 'pocket-pal-rabbit-moss',
  storm: 'pocket-pal-rabbit-storm', shadow: 'pocket-pal-rabbit-shadow',
};
const enemyPaletteFrames: Record<string, string> = {
  fire: 'enemy1.slime.fire', water: 'enemy1.slime.water', moss: 'enemy1.slime.moss',
  storm: 'enemy1.slime.storm', shadow: 'enemy1.slime.shadow',
};
const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n));
const is = (event: StageVisualEvent | null, type: StageVisualEvent['type']): boolean => event?.type === type;

export function createNativeStageScene(Phaser: PhaserRuntime, bridge: NativeStageBridge): new (...args: never[]) => NativeStageScene {
  class Stage extends Phaser.Scene {
    private pet!: Sprite;
    private enemy!: Sprite;
    private chest!: Sprite;
    private biscuit!: Image;
    private petShadow!: PhaserType.GameObjects.Ellipse;
    private enemyShadow!: PhaserType.GameObjects.Ellipse;
    private ground!: TileSprite;
    private path!: TileSprite;
    private readonly far: Image[] = [];
    private readonly middle: Image[] = [];
    private readonly edge: Image[] = [];
    private readonly flowers: Image[] = [];
    private readonly homeGroundDetails: Image[] = [];
    private readonly torches: Image[] = [];
    private readonly particles: Image[] = [];
    private readonly born = new Float64Array(MAX_PARTICLES);
    private readonly particleX = new Float32Array(MAX_PARTICLES);
    private readonly particleY = new Float32Array(MAX_PARTICLES);
    private readonly particleVelocity = new Float32Array(MAX_PARTICLES);
    private readonly bars: Rectangle[] = [];
    private readonly tracks: Rectangle[] = [];
    private readonly ratios = new Float32Array(4);
    private damage!: Text;
    private critical!: Text;
    private status!: Text;
    private banner!: Text;
    private dim!: Rectangle;
    private readonly pose: AttackPose = { x: 0, y: 0 };
    private readonly rng = createCosmeticRng(cosmeticSeed(1, 1));
    private preview: PreviewName | null = null;
    private previewProgress = 0.5;
    private previewFrozen = true;
    private width = NATIVE_STAGE_WIDTH;
    private height = NATIVE_STAGE_HEIGHT;
    private zoom = 1;
    private worldWidth = NATIVE_STAGE_WIDTH;
    private worldHeight = NATIVE_STAGE_HEIGHT;
    private left = 0;
    private top = 0;
    private elapsed = 0;
    private visualTime = 0;
    private travel = 0;
    private lastDust = 0;
    private eventId = -1;
    private impactId = -1;
    private lastFloor: number | null = null;
    private lastRoom = -1;
    private ready = false;
    private frozen = false;

    constructor() { super({ key: 'PocketPalNativeStage' }); }

    preload(): void {
      this.load.atlas(NATIVE_STAGE_ATLAS_KEY, `${BASE_PATH}atlas.png`, `${BASE_PATH}atlas.json`);
      for (const [element, key] of Object.entries(petPaletteTextures)) {
        this.load.spritesheet(key, `${BASE_PATH}characters/rabbit-${element}.png`, {
          frameWidth: CHARACTER_FRAME_SIZE, frameHeight: CHARACTER_FRAME_SIZE,
        });
      }
      this.load.spritesheet(COAL_CUB_TEXTURE, `${BASE_PATH}characters/coal-cub.png`, {
        frameWidth: CHARACTER_FRAME_SIZE, frameHeight: CHARACTER_FRAME_SIZE,
      });
    }

    create(): void {
      for (const [key, animation] of Object.entries(spriteData.animations)) {
        this.anims.create({
          key, frames: animation.frames.map((frame) => ({ key: NATIVE_STAGE_ATLAS_KEY, frame })),
          frameRate: animation.frameRate, repeat: animation.repeat,
        });
      }
      this.ground = this.add.tileSprite(120, 140, 400, 100, NATIVE_STAGE_ATLAS_KEY, F.grass).setDepth(2);
      this.path = this.add.tileSprite(120, 127, 400, 24, NATIVE_STAGE_ATLAS_KEY, F.path).setDepth(3);
      const farFrames = [F.canopy, F.tall, F.young, F.round, F.tall, F.canopy, F.round, F.young] as const;
      const farScales = [2, 1, 2, 2, 1, 2, 1, 2] as const;
      const midFrames = [F.round, F.young, F.tall, F.round, F.canopy, F.young, F.round, F.tall] as const;
      const midScales = [2, 2, 3, 1, 2, 3, 1, 2] as const;
      for (let i = 0; i < 40; i += 1) {
        const index = i % farFrames.length;
        this.far.push(this.add.image(0, 50, NATIVE_STAGE_ATLAS_KEY, farFrames[index]!).setScale(farScales[index]!).setAlpha(0.68).setDepth(0));
        this.middle.push(this.add.image(0, 79, NATIVE_STAGE_ATLAS_KEY, midFrames[index]!).setScale(midScales[index]!).setDepth(1));
      }
      for (let i = 0; i < 4; i += 1) this.edge.push(this.add.image(0, 140, NATIVE_STAGE_ATLAS_KEY, i % 2 ? F.tall : F.round).setScale(i % 2 ? 3 : 2).setAlpha(0.88).setDepth(17));
      for (let i = 0; i < 16; i += 1) this.flowers.push(this.add.image(0, 146, NATIVE_STAGE_ATLAS_KEY, i % 3 ? F.detail : F.flower).setDepth(4));
      for (let i = 0; i < 3; i += 1) this.homeGroundDetails.push(this.add.image(100 + i * 20, 145, NATIVE_STAGE_ATLAS_KEY, F.detail).setDepth(7).setVisible(false));
      for (let i = 0; i < 2; i += 1) this.torches.push(this.add.image(0, 104, NATIVE_STAGE_ATLAS_KEY, F.torch).setScale(2).setDepth(5));
      this.petShadow = this.add.ellipse(70, 142, 30, 6, 0x213e34, 0.3).setDepth(6);
      this.enemyShadow = this.add.ellipse(170, 138, 32, 6, 0x213e34, 0.28).setDepth(6);
      this.chest = this.add.sprite(175, 121, NATIVE_STAGE_ATLAS_KEY, F.chest).setScale(2).setDepth(7).setVisible(false);
      this.enemy = this.add.sprite(170, 113, NATIVE_STAGE_ATLAS_KEY, F.slime).setDepth(9);
      this.pet = this.add.sprite(70, 116, NATIVE_STAGE_ATLAS_KEY, F.pet).setDepth(10);
      this.biscuit = this.add.image(100, 100, NATIVE_STAGE_ATLAS_KEY, F.biscuit).setDepth(13).setVisible(false);
      for (let i = 0; i < 4; i += 1) {
        this.tracks.push(this.add.rectangle(0, 0, 38, i % 2 ? 2 : 3, 0x284838).setOrigin(0, 0.5).setDepth(14));
        this.bars.push(this.add.rectangle(0, 0, 38, i % 2 ? 2 : 3, [0x9bdf99, 0xf7d386, 0xe99c83, 0xa4d6de][i]!).setOrigin(0, 0.5).setDepth(15));
      }
      const textStyle = { fontFamily: '"Press Start 2P"', fontSize: '14px', color: '#fff8dc', stroke: '#283f3b', strokeThickness: 2 };
      this.damage = this.add.text(170, 80, '', textStyle).setOrigin(0.5).setDepth(22).setVisible(false);
      this.critical = this.add.text(170, 60, 'CRIT!', { ...textStyle, fontSize: '16px', color: '#ffe095' }).setOrigin(0.5).setDepth(23).setVisible(false);
      this.status = this.add.text(70, 80, '', { ...textStyle, color: '#b9f0d0' }).setOrigin(0.5).setDepth(22).setVisible(false);
      this.banner = this.add.text(120, 26, '', { ...textStyle, fontSize: '14px', color: '#fff2c9', backgroundColor: '#294b40', padding: { x: 7, y: 4 } }).setOrigin(0.5).setDepth(25).setVisible(false);
      this.dim = this.add.rectangle(120, 80, 600, 300, 0x142b2b, 0.46).setDepth(30).setVisible(false);
      for (let i = 0; i < MAX_PARTICLES; i += 1) this.particles.push(this.add.image(0, 0, NATIVE_STAGE_ATLAS_KEY, F.sparkle).setScale(0.5).setDepth(20).setVisible(false));
      this.ready = true;
      this.cameras.main.setBackgroundColor('#a6ccba');
      this.resizeStage(this.game.canvas.width, this.game.canvas.height);
    }

    resizeStage(width: number, height: number): void {
      this.width = Math.max(1, Math.round(width));
      this.height = Math.max(1, Math.round(height));
      this.zoom = Math.max(1, Math.floor(this.height / NATIVE_STAGE_HEIGHT));
      this.worldWidth = this.width / this.zoom;
      this.worldHeight = this.height / this.zoom;
      this.left = 120 - this.worldWidth / 2;
      this.top = 85 - this.worldHeight / 2;
      this.cameras.main.setViewport(0, 0, this.width, this.height).setZoom(this.zoom).centerOn(120, 85);
      if (!this.ready) return;
      this.ground.setPosition(120, 97 + (this.top + this.worldHeight - 97) / 2).setSize(this.worldWidth + 96, Math.max(64, this.top + this.worldHeight - 97));
      this.path.setSize(this.worldWidth + 96, 24);
      this.dim.setPosition(120, 85).setSize(this.worldWidth + 96, this.worldHeight + 96);
      this.status.setFontSize(Math.ceil(16 / this.zoom));
      this.banner.setFontSize(Math.ceil(16 / this.zoom));
      this.critical.setFontSize(Math.ceil(18 / this.zoom));
    }

    setPreviewState(name: PreviewName | null, progress = 0.5, frozen = true): void {
      this.preview = name;
      this.previewProgress = clamp(progress);
      this.previewFrozen = frozen;
      this.eventId = -1;
      this.impactId = -1;
      for (const particle of this.particles) particle.setVisible(false);
      this.cameras.main.fadeEffect.reset();
    }

    getMetrics(): { petHeight: number; stageHeight: number; activeParticleCount: number; petWidth: number; petSpriteHeight: number; petFrameName: string; petX: number; petY: number; petScaleX: number; petScaleY: number; shadowY: number } {
      let activeParticleCount = 0;
      for (const particle of this.particles) if (particle.visible) activeParticleCount += 1;
      const textureKey = this.pet.texture.key;
      const poseIndex = Number(this.pet.frame.name);
      const element = textureKey.startsWith('pocket-pal-rabbit-') ? textureKey.slice('pocket-pal-rabbit-'.length) : '';
      const pose = CHARACTER_POSES[poseIndex] ?? 'idle';
      const petFrameName = element ? (pose === 'idle' ? `pet1.rabbit.${element}` : `pet1.rabbit.${element}.${pose}`) : String(this.pet.frame.name);
      return {
        petHeight: this.pet.displayHeight * this.zoom, stageHeight: this.height, activeParticleCount,
        petWidth: this.pet.displayWidth * this.zoom, petSpriteHeight: this.pet.displayHeight * this.zoom,
        petFrameName, petX: this.pet.x, petY: this.pet.y,
        petScaleX: this.pet.scaleX, petScaleY: this.pet.scaleY, shadowY: this.petShadow.y,
      };
    }

    update(_time: number, delta: number): void {
      const state = bridge.getState();
      if (!this.ready || !state) return;
      const reduced = bridge.isReducedMotion();
      this.frozen = bridge.isDecisionPaused() || (this.preview !== null && this.previewFrozen);
      const dt = this.frozen ? 0 : clamp(delta, 0, 100);
      this.elapsed += dt;
      if (!this.frozen) this.visualTime = bridge.getNowSeconds();
      else if (this.preview) this.visualTime = 2.5;
      const frame = this.preview ? this.previewFrame() : bridge.getEventFrame();
      const event = frame?.event ?? null;
      const progress = clamp(frame?.progress ?? 0);
      const home = this.preview === 'home' || this.preview === 'eating' || (!this.preview && !state.dungeon.activeRun);
      const walking = this.preview === 'corridor' || (!this.preview && state.dungeon.activeRun?.phase === 'choice');
      const battle = this.preview === 'intro' || this.preview === 'attack' || this.preview === 'crit'
        || (!this.preview && Boolean(state.dungeon.activeRun?.enemy) && !home && !walking);
      this.updateWorld(walking, home, reduced, dt);
      this.updatePet(state, event, progress, home, walking, reduced);
      this.updateEnemy(state, event, progress, battle, reduced);
      this.updateProps(event, progress, reduced);
      this.updateBars(state, battle);
      this.updateEffects(event, progress, reduced);
      this.updateCamera(state, event, progress, reduced);
      this.dim.setVisible(bridge.isDecisionPaused());
    }

    private updateWorld(walking: boolean, home: boolean, reduced: boolean, dt: number): void {
      if (walking && !reduced) this.travel += dt * 0.024;
      const farShift = snapPixel(this.travel * 0.18);
      const midShift = snapPixel(this.travel * 0.45);
      const farOffsets = [-8, 3, 9, -4, 6, -2, 10, -6] as const;
      const midOffsets = [4, -7, 1, 8, -5, 9, -2, -6] as const;
      for (let i = 0; i < this.far.length; i += 1) {
        const far = this.far[i]!;
        const middle = this.middle[i]!;
        const pattern = i % farOffsets.length;
        far.setPosition(snapPixel(this.left - 40 + i * 44 + farOffsets[pattern]! - farShift % 44), snapPixel(79 - far.displayHeight / 2 + pattern % 3 * 2));
        middle.setPosition(snapPixel(this.left - 40 + i * 36 + midOffsets[pattern]! - midShift % 36), snapPixel(105 - middle.displayHeight / 2 + pattern % 2 * 3));
      }
      this.ground.tilePositionX = walking ? snapPixel(this.travel) : 0;
      this.path.tilePositionX = walking ? snapPixel(this.travel) : 0;
      this.path.setVisible(!home);
      for (let i = 0; i < this.flowers.length; i += 1) {
        const sway = home && !reduced && i % 4 === 0 ? snapPixel(Math.sin(this.visualTime * 1.1 + i) * 0.5) : 0;
        this.flowers[i]!.setPosition(snapPixel(this.left - 12 + i * 54), snapPixel(147 + i % 3 * 5 + sway));
      }
      for (let i = 0; i < this.homeGroundDetails.length; i += 1) {
        const detail = this.homeGroundDetails[i]!;
        const sway = home && !reduced ? snapPixel(Math.sin(this.visualTime * 0.9 + i * 1.7) * 0.5) : 0;
        detail.setVisible(home).setPosition(snapPixel(100 + i * 20), snapPixel(145 + sway));
      }
      this.edge[0]!.setPosition(snapPixel(this.left - 12), 122);
      this.edge[1]!.setPosition(snapPixel(this.left - 4), 151);
      this.edge[2]!.setPosition(snapPixel(this.left + this.worldWidth + 12), 122);
      this.edge[3]!.setPosition(snapPixel(this.left + this.worldWidth + 4), 151);
      for (let i = 0; i < 2; i += 1) this.torches[i]!.setVisible(!home).setPosition(snapPixel(i ? this.left + this.worldWidth - 28 : this.left + 28), 111).setAlpha(reduced ? 1 : 0.9 + Math.sin(this.visualTime * 7 + i) * 0.08);
      if (walking && !reduced && this.elapsed - this.lastDust > 260) {
        this.lastDust = this.elapsed;
        this.burst(3, this.pet.x - 8, 139, 0xd9d1aa, false);
      }
    }

    private updatePet(state: GameState, event: StageVisualEvent | null, p: number, home: boolean, walking: boolean, reduced: boolean): void {
      const hit = event?.type === 'attack' ? event : null;
      const attacking = hit?.source === 'pet';
      const hurt = hit?.target === 'pet';
      const eating = is(event, 'item_used') || this.preview === 'eating' || (home && state.animation === 'eat');
      const faint = is(event, 'faint');
      let x = home ? 120 : 70;
      let y = 116;
      if (home && !reduced) x += snapPixel(Math.sin(this.visualTime * 0.55) * 10);
      if (attacking && !reduced) {
        writeAttackPose(p, this.pose);
        x += this.pose.x;
        y += this.pose.y;
      } else if (!reduced) {
        if (walking) y -= Math.abs(Math.sin(this.visualTime * 8)) * 2;
        if (hurt && p >= IMPACT_START) x -= Math.sin(clamp((p - IMPACT_START) / 0.54) * Math.PI) * 9;
        if (eating && p > 0.4) y += Math.sin(p * 35) * 0.45;
      }
      if (faint) y += easeOut(p) * 8;
      const petElement = state.evolution.formId?.split('-')[0] ?? 'moss';
      if (!this.preview && state.stage === 'egg') {
        if (this.pet.frame.name !== F.egg) this.pet.anims.stop();
        this.pet.setTexture(NATIVE_STAGE_ATLAS_KEY, F.egg).setScale(2);
      } else {
        const movingAtHome = home && !reduced && Math.abs(Math.cos(this.visualTime * 0.55)) > 0.35;
        let poseIndex = 0;
        if (hurt && !reduced && p >= IMPACT_START && p <= IMPACT_END + 0.07) poseIndex = 3;
        else if (attacking && !reduced) poseIndex = p < IMPACT_START ? 1 : 2;
        else if ((walking || movingAtHome) && !reduced) poseIndex = 1 + Math.floor(this.visualTime * 5) % 2;
        const texture = petPaletteTextures[petElement] ?? petPaletteTextures.moss!;
        if (this.pet.texture.key !== texture || Number(this.pet.frame.name) !== poseIndex) this.pet.setTexture(texture, poseIndex);
        this.pet.setScale(1);
      }
      this.pet.setPosition(snapPixel(x), snapPixel(y)).setRotation(0).setAlpha(faint ? 1 - p * 0.35 : 1).setFlipX(false);
      this.petShadow.setPosition(this.pet.x, snapPixel(this.pet.y + this.pet.displayHeight / 2 + 2))
        .setDisplaySize(Math.max(12, this.pet.displayWidth * 0.74), Math.max(4, this.pet.displayHeight * 0.12));
    }

    private updateEnemy(state: GameState, event: StageVisualEvent | null, p: number, visible: boolean, reduced: boolean): void {
      this.enemy.setVisible(visible);
      this.enemyShadow.setVisible(visible);
      if (!visible) return;
      const hit = event?.type === 'attack' ? event : null;
      const attacking = hit?.source === 'enemy';
      const hurt = hit?.target === 'enemy';
      const dead = is(event, 'victory');
      const isCoalCub = state.dungeon.activeRun?.enemy?.id === 'coal-cub' || state.dungeon.activeRun?.enemy?.name.toLowerCase() === 'coal cub';
      const scale = isCoalCub ? 1 : Math.max(2, Math.ceil((this.height * 0.25) / (16 * this.zoom)));
      let x = 170;
      let y = 113;
      if (attacking && !reduced) {
        writeAttackPose(p, this.pose);
        x -= this.pose.x;
      } else if (!reduced) {
        y += Math.sin(this.visualTime * 3) * 0.45;
        if (hurt && p >= IMPACT_START) x += Math.sin(clamp((p - IMPACT_START) / 0.54) * Math.PI) * 10;
      }
      if (dead) y += p * 8;
      this.enemy.setPosition(snapPixel(x), snapPixel(y)).setScale(scale).setAlpha(dead ? 1 - p : 1);
      const element = state.dungeon.activeRun?.enemy?.element ?? 'moss';
      const paletteFrame = enemyPaletteFrames[element];
      if (isCoalCub) {
        const poseIndex = hurt && !reduced && p >= IMPACT_START && p <= IMPACT_END + 0.07
          ? 3
          : attacking && !reduced ? 1 + Math.floor(this.visualTime * 5) % 2 : 0;
        if (this.enemy.texture.key !== COAL_CUB_TEXTURE || Number(this.enemy.frame.name) !== poseIndex) this.enemy.setTexture(COAL_CUB_TEXTURE, poseIndex);
      } else {
        const frame = hurt && !reduced && p >= IMPACT_START && p <= IMPACT_END + 0.07 ? 'enemy1.slime.hit-flash' : paletteFrame ?? F.slime;
        if (this.enemy.frame.name !== frame) this.enemy.setTexture(NATIVE_STAGE_ATLAS_KEY, frame);
      }
      this.enemyShadow.setPosition(this.enemy.x, snapPixel(this.enemy.y + this.enemy.displayHeight / 2 + 2))
        .setDisplaySize(Math.max(12, this.enemy.displayWidth * 0.74), Math.max(4, this.enemy.displayHeight * 0.12));
    }

    private updateProps(event: StageVisualEvent | null, p: number, reduced: boolean): void {
      const chest = is(event, 'chest_open');
      this.chest.setVisible(chest).setFrame(p > 0.35 ? F.openChest : F.chest).setPosition(175, snapPixel(124 - (reduced ? 0 : Math.sin(p * Math.PI) * 2)));
      const eating = is(event, 'item_used');
      this.biscuit.setVisible(eating && p < 0.82);
      if (eating) {
        const t = reduced ? 1 : easeInOut(clamp(p / 0.6));
        this.biscuit.setPosition(snapPixel(this.pet.x - 25 + t * 35), snapPixel(this.pet.y - 39 + t * 28)).setScale(0.5);
      }
    }

    private updateBars(state: GameState, visible: boolean): void {
      const run = state.dungeon.activeRun;
      this.ratios[0] = run ? clamp(run.petHp / Math.max(1, run.petMaxHp)) : 0.8;
      this.ratios[1] = run ? clamp(run.petGauge / 100) : 0.55;
      this.ratios[2] = run?.enemy ? clamp(run.enemy.hp / Math.max(1, run.enemy.maxHp)) : 0.65;
      this.ratios[3] = run?.enemy ? clamp(run.enemy.gauge / 100) : 0.35;
      for (let i = 0; i < 4; i += 1) {
        const actor = i < 2 ? this.pet : this.enemy;
        const x = snapPixel(actor.x - 19);
        const y = snapPixel(actor.y - actor.displayHeight / 2 - 8 + i % 2 * 5);
        this.tracks[i]!.setVisible(visible).setPosition(x, y);
        this.bars[i]!.setVisible(visible).setPosition(x, y).setScale(this.ratios[i]!, 1);
      }
    }

    private updateEffects(event: StageVisualEvent | null, p: number, reduced: boolean): void {
      if (event && event.id !== this.eventId) {
        this.eventId = event.id;
        if (is(event, 'chest_open')) this.burst(12, 175, 113, 0xffda7a, true);
        if (is(event, 'loot_drop')) this.burst(8, 170, 110, 0xffdd9a, true);
        if (is(event, 'heal')) this.burst(9, this.pet.x, 100, 0xb2f0bc, false);
      }
      const hit = event?.type === 'attack' ? event : null;
      if (hit && hit.id !== this.impactId && (p >= IMPACT_START || reduced)) {
        this.impactId = hit.id;
        this.burst(hit.critical ? 14 : 7, hit.target === 'pet' ? this.pet.x : this.enemy.x, 107, hit.critical ? 0xffd879 : 0xfff2bd, false);
      }
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        const particle = this.particles[i]!;
        if (!particle.visible) continue;
        const age = this.elapsed - this.born[i]!;
        const t = clamp(age / 480);
        if (t >= 1 || reduced) { particle.setVisible(false); continue; }
        particle.setPosition(snapPixel(this.particleX[i]! + this.particleVelocity[i]! * easeOut(t)), snapPixel(this.particleY[i]! - Math.sin(t * Math.PI / 2) * 19)).setAlpha(1 - t).setRotation(0);
      }
      const impact = Boolean(hit && (reduced || p >= IMPACT_START) && (reduced || p < 0.97));
      const rise = reduced ? 0 : easeOut(clamp((p - IMPACT_START) / (1 - IMPACT_START)));
      const target = hit?.target === 'pet' ? this.pet : this.enemy;
      this.damage.setVisible(impact).setText(hit ? String(hit.amount) : '').setPosition(snapPixel(target.x), snapPixel(target.y - target.displayHeight / 2 - 17 - rise * 12))
        .setColor(hit?.critical ? '#ffe09a' : '#fff8dc').setFontSize(Math.ceil((hit?.critical ? 26 : 20) / this.zoom)).setScale(1).setAlpha(p < 0.8 || reduced ? 1 : (1 - p) / 0.2);
      this.critical.setVisible(impact && Boolean(hit?.critical)).setPosition(snapPixel(target.x), snapPixel(target.y - target.displayHeight / 2 - 37 - rise * 6));
      const healed = event?.type === 'heal' ? event : null;
      const miss = is(event, 'miss');
      const status = event?.type === 'status_applied' ? event.status.toUpperCase() : is(event, 'buff_applied') ? 'BUFF' : '';
      this.status.setVisible(Boolean(healed || miss || status)).setText(healed ? `+${healed.amount}` : miss ? 'MISS' : status).setPosition(snapPixel(this.pet.x), snapPixel(this.pet.y - this.pet.displayHeight / 2 - 18 - (reduced ? 0 : easeOut(p) * 8)));
      const intro = is(event, 'enemy_appear') || is(event, 'combat_start');
      const showBanner = intro || is(event, 'chest_open') || is(event, 'floor_cleared') || is(event, 'victory');
      const title = is(event, 'chest_open') ? 'TREASURE!' : is(event, 'floor_cleared') ? 'FLOOR CLEAR!' : is(event, 'victory') ? 'WELL DONE!' : is(event, 'enemy_appear') ? 'A SLIME APPEARS!' : 'READY!';
      this.banner.setVisible(showBanner).setText(title).setPosition(snapPixel(120 - (reduced ? 0 : (1 - easeOut(clamp(p / 0.32))) * 90)), snapPixel(this.top + (this.zoom >= 2 ? 40 : 24)));
    }

    private burst(count: number, x: number, y: number, tint: number, coin: boolean): void {
      let used = 0;
      for (let i = 0; i < MAX_PARTICLES && used < count; i += 1) {
        const particle = this.particles[i]!;
        if (particle.visible) continue;
        this.born[i] = this.elapsed;
        this.particleX[i] = snapPixel(x + (this.rng.next() - 0.5) * 20);
        this.particleY[i] = snapPixel(y + (this.rng.next() - 0.5) * 9);
        this.particleVelocity[i] = (this.rng.next() - 0.5) * 24;
        const glyph = coin ? F.coin : tint === 0xb2f0bc ? 'particle.heal' : tint === 0xd9d1aa ? 'particle.dust' : 'particle.gold';
        particle.setTexture(NATIVE_STAGE_ATLAS_KEY, glyph).setScale(0.5).setPosition(this.particleX[i]!, this.particleY[i]!).setAlpha(1).setVisible(true);
        used += 1;
      }
    }

    private updateCamera(state: GameState, event: StageVisualEvent | null, p: number, reduced: boolean): void {
      const hit: Attack | null = event?.type === 'attack' ? event : null;
      const contact = Boolean(hit && p >= IMPACT_START && p < 0.68);
      const strength = hit ? clamp(hit.amount / 35, 0.3, 1) : 0;
      const shake = !reduced && contact ? Math.sin((p - IMPACT_START) * 160) * strength * (hit?.critical ? 1.8 : 0.8) : 0;
      const follow = reduced ? 0 : clamp((this.pet.x - 70) * 0.025, -1.5, 1.5);
      this.cameras.main.setZoom(this.zoom).centerOn(snapPixel(120 + follow + shake), snapPixel(85 + shake * 0.45));
      const run = state.dungeon.activeRun;
      const floor = run?.floor ?? 0;
      const room = run?.roomIndex ?? -1;
      if (floor !== this.lastFloor || room !== this.lastRoom) {
        if (this.lastFloor !== null && !this.preview && !reduced) this.cameras.main.fadeIn(160, 32, 61, 48);
        this.lastFloor = floor;
        this.lastRoom = room;
      }
    }

    private previewFrame(): StageEventFrame | null {
      if (!this.preview || this.preview === 'home' || this.preview === 'corridor') return null;
      const id = 900000 + this.preview.charCodeAt(0) * 10;
      let event: StageVisualEvent;
      if (this.preview === 'intro') event = { id, type: 'enemy_appear', enemyId: 'preview-slime', name: 'Meadow Slime', kind: 'fight', element: 'moss' };
      else if (this.preview === 'chest') event = { id, type: 'chest_open', coins: 12, tokenFound: true };
      else if (this.preview === 'eating') event = { id, type: 'item_used', name: 'Biscuit' };
      else event = { id, type: 'attack', source: 'pet', target: 'enemy', actor: 'Pip', skill: 'Pounce', amount: this.preview === 'crit' ? 24 : 12, critical: this.preview === 'crit', strongHit: this.preview === 'crit', flavor: 'skill' };
      return { event, progress: this.previewProgress, summary: false };
    }
  }
  return Stage as unknown as new (...args: never[]) => NativeStageScene;
}

export type { PreviewName as NativeStagePreviewName };
