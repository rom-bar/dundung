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
type AnimationKey = keyof typeof spriteData.animations;

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
  getMetrics(): { petHeight: number; stageHeight: number; activeParticleCount: number; petWidth: number; petSpriteHeight: number; petFrameName: string };
}

export const NATIVE_STAGE_WIDTH = 240;
export const NATIVE_STAGE_HEIGHT = 160;
export const NATIVE_STAGE_ATLAS_KEY = 'pocket-pal-stage-atlas';
const MAX_PARTICLES = 40;
const BASE_PATH = `${import.meta.env.BASE_URL}assets/stage/`;
const F = {
  grass: 'biome1.ground.grass', detail: 'biome1.ground.grass-detail', flower: 'biome1.ground.flower',
  young: 'biome1.tree.young', round: 'biome1.tree.round', tall: 'biome1.tree.tall', canopy: 'biome1.canopy.soft',
  chest: 'chest.closed', openChest: 'chest.closed-highlight', biscuit: 'food.biscuit', coin: 'icon.coin',
  pet: 'pet1.rabbit.idle', egg: 'pet1.egg', slime: 'enemy1.slime.idle', torch: 'dungeon.torch', path: 'dungeon.path',
  sparkle: 'particle.sparkle-1', heart: 'icon.heart',
} as const;
const petPaletteFrames: Record<string, string> = {
  fire: 'pet1.rabbit.fire', water: 'pet1.rabbit.water', moss: 'pet1.rabbit.moss',
  storm: 'pet1.rabbit.storm', shadow: 'pet1.rabbit.shadow',
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
    private readonly pose: AttackPose = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
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
      for (let i = 0; i < 2; i += 1) this.torches.push(this.add.image(0, 104, NATIVE_STAGE_ATLAS_KEY, F.torch).setScale(2).setDepth(5));
      this.petShadow = this.add.ellipse(70, 139, 30, 6, 0x213e34, 0.22).setDepth(6);
      this.enemyShadow = this.add.ellipse(170, 134, 32, 6, 0x213e34, 0.22).setDepth(6);
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
      for (let i = 0; i < MAX_PARTICLES; i += 1) this.particles.push(this.add.image(0, 0, NATIVE_STAGE_ATLAS_KEY, F.sparkle).setScale(0.25).setDepth(20).setVisible(false));
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

    getMetrics(): { petHeight: number; stageHeight: number; activeParticleCount: number; petWidth: number; petSpriteHeight: number; petFrameName: string } {
      let activeParticleCount = 0;
      for (const particle of this.particles) if (particle.visible) activeParticleCount += 1;
      return {
        petHeight: this.pet.displayHeight * this.zoom, stageHeight: this.height, activeParticleCount,
        petWidth: this.pet.displayWidth * this.zoom, petSpriteHeight: this.pet.displayHeight * this.zoom,
        petFrameName: this.pet.frame.name,
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
      const farShift = this.travel * 0.18;
      const midShift = this.travel * 0.45;
      const farOffsets = [-8, 3, 9, -4, 6, -2, 10, -6] as const;
      const midOffsets = [4, -7, 1, 8, -5, 9, -2, -6] as const;
      for (let i = 0; i < this.far.length; i += 1) {
        const far = this.far[i]!;
        const middle = this.middle[i]!;
        const pattern = i % farOffsets.length;
        far.setPosition(this.left - 40 + i * 44 + farOffsets[pattern]! - farShift % 44, 79 - far.displayHeight / 2 + pattern % 3 * 2);
        middle.setPosition(this.left - 40 + i * 36 + midOffsets[pattern]! - midShift % 36, 105 - middle.displayHeight / 2 + pattern % 2 * 3);
      }
      this.ground.tilePositionX = walking ? this.travel : 0;
      this.path.tilePositionX = walking ? this.travel : 0;
      this.path.setVisible(!home);
      for (let i = 0; i < this.flowers.length; i += 1) this.flowers[i]!.setPosition(this.left - 12 + i * 54, 147 + i % 3 * 5);
      this.edge[0]!.setPosition(this.left - 12, 122);
      this.edge[1]!.setPosition(this.left - 4, 151);
      this.edge[2]!.setPosition(this.left + this.worldWidth + 12, 122);
      this.edge[3]!.setPosition(this.left + this.worldWidth + 4, 151);
      for (let i = 0; i < 2; i += 1) this.torches[i]!.setVisible(!home).setPosition(i ? this.left + this.worldWidth - 28 : this.left + 28, 111).setAlpha(reduced ? 1 : 0.9 + Math.sin(this.visualTime * 7 + i) * 0.08);
      if (walking && !reduced && this.elapsed - this.lastDust > 260) {
        this.lastDust = this.elapsed;
        this.burst(3, this.pet.x - 8, 139, 0xd9d1aa, false);
      }
    }

    private play(sprite: Sprite, key: AnimationKey, progress: number): void {
      if (sprite.anims.currentAnim?.key !== key) sprite.play(key);
      if (this.preview && this.previewFrozen) {
        sprite.anims.pause();
        const frames = spriteData.animations[key].frames;
        sprite.setFrame(frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))]!);
      } else if (this.frozen || bridge.isReducedMotion()) sprite.anims.pause();
      else sprite.anims.resume();
    }

    private updatePet(state: GameState, event: StageVisualEvent | null, p: number, home: boolean, walking: boolean, reduced: boolean): void {
      const hit = event?.type === 'attack' ? event : null;
      const attacking = hit?.source === 'pet';
      const hurt = hit?.target === 'pet';
      const eating = is(event, 'item_used') || this.preview === 'eating' || (home && state.animation === 'eat');
      const faint = is(event, 'faint');
      const scale = Math.max(2, Math.ceil(this.worldHeight * 0.28 / 16));
      let x = home ? 120 : 70;
      let y = 116;
      let sx = 1;
      let sy = 1;
      if (attacking && !reduced) {
        writeAttackPose(p, this.pose);
        x += this.pose.x;
        y += this.pose.y;
        sx = this.pose.scaleX;
        sy = this.pose.scaleY;
      } else if (!reduced) {
        const breath = Math.sin(this.visualTime * 2.5) * 0.018;
        sx = 1 + breath;
        sy = 1 - breath;
        if (walking) y -= Math.abs(Math.sin(this.visualTime * 8)) * 2;
        if (hurt && p >= IMPACT_START) x -= Math.sin(clamp((p - IMPACT_START) / 0.54) * Math.PI) * 9;
        if (eating && p > 0.4) sy += Math.sin(p * 35) * 0.035;
      }
      if (faint) { y += easeOut(p) * 8; sy *= 1 - p * 0.45; }
      this.pet.setPosition(x, y).setScale(scale * sx, scale * sy).setRotation(faint ? p * 0.2 : 0).setAlpha(faint ? 1 - p * 0.35 : 1).setFlipX(false);
      const pose: AnimationKey = faint ? 'pet1.faint' : eating ? 'pet1.eat' : hurt ? 'pet1.hurt' : attacking ? 'pet1.attack' : walking ? 'pet1.walk' : state.sleeping ? 'pet1.sleep' : 'pet1.idle';
      const petElement = state.evolution.formId?.split('-')[0] ?? 'moss';
      const petPaletteFrame = petPaletteFrames[petElement] ?? F.pet;
      if (!this.preview && state.stage === 'egg') {
        if (this.pet.frame.name !== F.egg) this.pet.anims.stop();
        this.pet.setFrame(F.egg).setScale(Math.max(2, scale - 1));
      } else {
        const wasEgg = this.pet.frame.name === F.egg;
        this.play(this.pet, pose, p);
        if (hurt && !reduced && p >= IMPACT_START && p <= IMPACT_END + 0.07) this.pet.setFrame('pet1.rabbit.hit-flash');
        else if (wasEgg || this.pet.frame.name === 'pet1.rabbit.hit-flash' || this.pet.frame.name !== petPaletteFrame) this.pet.setFrame(petPaletteFrame);
      }
      this.petShadow.setPosition(x, 116 + scale * 7).setDisplaySize(scale * 11, scale * 2);
    }

    private updateEnemy(state: GameState, event: StageVisualEvent | null, p: number, visible: boolean, reduced: boolean): void {
      this.enemy.setVisible(visible);
      this.enemyShadow.setVisible(visible);
      if (!visible) return;
      const hit = event?.type === 'attack' ? event : null;
      const attacking = hit?.source === 'enemy';
      const hurt = hit?.target === 'enemy';
      const dead = is(event, 'victory');
      const scale = Math.max(2, Math.ceil(this.worldHeight * 0.25 / 16));
      let x = 170;
      let y = 113;
      let sx = 1;
      let sy = 1;
      if (attacking && !reduced) {
        writeAttackPose(p, this.pose);
        x -= this.pose.x;
        sx = this.pose.scaleX;
        sy = this.pose.scaleY;
      } else if (!reduced) {
        const breath = Math.sin(this.visualTime * 3) * 0.045;
        sx += breath;
        sy -= breath;
        if (hurt && p >= IMPACT_START) x += Math.sin(clamp((p - IMPACT_START) / 0.54) * Math.PI) * 10;
      }
      if (dead) { sy *= 1 - easeOut(p) * 0.8; y += p * 8; }
      this.enemy.setPosition(x, y).setScale(scale * sx, scale * sy).setAlpha(dead ? 1 - p : 1);
      const element = state.dungeon.activeRun?.enemy?.element ?? 'moss';
      const paletteFrame = enemyPaletteFrames[element];
      const key: AnimationKey = dead ? 'enemy1.death' : hurt ? 'enemy1.hurt' : attacking ? 'enemy1.attack' : element === 'fire' ? 'enemy1.variant-idle' : 'enemy1.idle';
      this.play(this.enemy, key, p);
      if (hurt && !reduced && p >= IMPACT_START && p <= IMPACT_END + 0.07) this.enemy.setFrame('enemy1.slime.hit-flash');
      else if (element !== 'moss' && paletteFrame) this.enemy.setFrame(paletteFrame);
      else if (this.enemy.frame.name === 'enemy1.slime.hit-flash') this.enemy.setFrame(F.slime);
      this.enemyShadow.setPosition(x, 113 + scale * 6).setDisplaySize(scale * 11, scale * 2);
    }

    private updateProps(event: StageVisualEvent | null, p: number, reduced: boolean): void {
      const chest = is(event, 'chest_open');
      this.chest.setVisible(chest).setFrame(p > 0.35 ? F.openChest : F.chest).setPosition(175, 124 - (reduced ? 0 : Math.sin(p * Math.PI) * 2));
      const eating = is(event, 'item_used');
      this.biscuit.setVisible(eating && p < 0.82);
      if (eating) {
        const t = reduced ? 1 : easeInOut(clamp(p / 0.6));
        this.biscuit.setPosition(this.pet.x - 25 + t * 35, this.pet.y - 39 + t * 28).setScale(0.9 * (1 - t * 0.45));
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
        const x = actor.x - 19;
        const y = actor.y - actor.displayHeight / 2 - 8 + i % 2 * 5;
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
        particle.setPosition(this.particleX[i]! + this.particleVelocity[i]! * easeOut(t), this.particleY[i]! - Math.sin(t * Math.PI / 2) * 19).setAlpha(1 - t).setRotation(0);
      }
      const impact = Boolean(hit && (reduced || p >= IMPACT_START) && (reduced || p < 0.97));
      const rise = reduced ? 0 : easeOut(clamp((p - IMPACT_START) / (1 - IMPACT_START)));
      const target = hit?.target === 'pet' ? this.pet : this.enemy;
      this.damage.setVisible(impact).setText(hit ? String(hit.amount) : '').setPosition(target.x, target.y - target.displayHeight / 2 - 17 - rise * 12)
        .setColor(hit?.critical ? '#ffe09a' : '#fff8dc').setFontSize(Math.ceil((hit?.critical ? 26 : 20) / this.zoom)).setScale(reduced ? 1 : 1 + Math.sin(clamp((p - IMPACT_START) / 0.2) * Math.PI) * 0.18).setAlpha(p < 0.8 || reduced ? 1 : (1 - p) / 0.2);
      this.critical.setVisible(impact && Boolean(hit?.critical)).setPosition(target.x, target.y - target.displayHeight / 2 - 37 - rise * 6);
      const healed = event?.type === 'heal' ? event : null;
      const miss = is(event, 'miss');
      const status = event?.type === 'status_applied' ? event.status.toUpperCase() : is(event, 'buff_applied') ? 'BUFF' : '';
      this.status.setVisible(Boolean(healed || miss || status)).setText(healed ? `+${healed.amount}` : miss ? 'MISS' : status).setPosition(this.pet.x, this.pet.y - this.pet.displayHeight / 2 - 18 - (reduced ? 0 : easeOut(p) * 8));
      const intro = is(event, 'enemy_appear') || is(event, 'combat_start');
      const showBanner = intro || is(event, 'chest_open') || is(event, 'floor_cleared') || is(event, 'victory');
      const title = is(event, 'chest_open') ? 'TREASURE!' : is(event, 'floor_cleared') ? 'FLOOR CLEAR!' : is(event, 'victory') ? 'WELL DONE!' : is(event, 'enemy_appear') ? 'A SLIME APPEARS!' : 'READY!';
      this.banner.setVisible(showBanner).setText(title).setPosition(120 - (reduced ? 0 : (1 - easeOut(clamp(p / 0.32))) * 90), this.top + (this.zoom >= 2 ? 40 : 24));
    }

    private burst(count: number, x: number, y: number, tint: number, coin: boolean): void {
      let used = 0;
      for (let i = 0; i < MAX_PARTICLES && used < count; i += 1) {
        const particle = this.particles[i]!;
        if (particle.visible) continue;
        this.born[i] = this.elapsed;
        this.particleX[i] = x + (this.rng.next() - 0.5) * 20;
        this.particleY[i] = y + (this.rng.next() - 0.5) * 9;
        this.particleVelocity[i] = (this.rng.next() - 0.5) * 24;
        const glyph = coin ? F.coin : tint === 0xb2f0bc ? 'particle.heal' : tint === 0xd9d1aa ? 'particle.dust' : 'particle.gold';
        particle.setTexture(NATIVE_STAGE_ATLAS_KEY, glyph).setScale(coin ? 0.45 : 0.25).setPosition(this.particleX[i]!, this.particleY[i]!).setAlpha(1).setVisible(true);
        used += 1;
      }
    }

    private updateCamera(state: GameState, event: StageVisualEvent | null, p: number, reduced: boolean): void {
      const hit: Attack | null = event?.type === 'attack' ? event : null;
      const contact = Boolean(hit && p >= IMPACT_START && p < 0.68);
      const strength = hit ? clamp(hit.amount / 35, 0.3, 1) : 0;
      const shake = !reduced && contact ? Math.sin((p - IMPACT_START) * 160) * strength * (hit?.critical ? 1.8 : 0.8) : 0;
      const punch = !reduced && hit?.critical && p >= IMPACT_START ? Math.sin(clamp((p - IMPACT_START) / 0.4) * Math.PI) * 0.035 : 0;
      const follow = reduced ? 0 : clamp((this.pet.x - 70) * 0.025, -1.5, 1.5);
      this.cameras.main.setZoom(this.zoom * (1 + punch)).centerOn(120 + follow + shake, 85 + shake * 0.45);
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
