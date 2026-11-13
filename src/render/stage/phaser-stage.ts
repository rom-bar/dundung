import type { GameState } from '../../core/types';
import type { StageEventFrame } from './event-player';
import type { StageSceneRenderer } from './scene';

const WIDTH = 240;
const HEIGHT = 160;
const TEXTURE_KEY = 'pocket-pal-stage-compat';
type PhaserModule = typeof import('phaser');
type PhaserGame = { destroy: (removeCanvas: boolean, noReturn?: boolean) => void; scale: { refresh: () => void } };
type PhaserModuleInterop = PhaserModule & { default?: PhaserModule };

export type StageRendererStatus = {
  type: 'phaser' | 'fallback';
  ready: boolean;
  failed: boolean;
  canvasAttached: boolean;
};

/** Bridges the existing Step 1 renderer into Phaser without changing visuals. */
export class PhaserStageAdapter {
  private readonly sourceCanvas: HTMLCanvasElement;
  private game: PhaserGame | null = null;
  private texture: { refresh: () => void } | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: unknown) => void) | null = null;
  private phaserReady = false;
  private disposed = false;
  private phaserFailed = false;
  private cssWidth = WIDTH;
  private cssHeight = HEIGHT;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly renderer: StageSceneRenderer) {
    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = WIDTH;
    this.sourceCanvas.height = HEIGHT;
    this.sourceCanvas.setAttribute('aria-hidden', 'true');
    // display:none makes clientWidth/clientHeight zero; dimensions are passed explicitly during resize.
    this.sourceCanvas.style.cssText = 'position:absolute;width:240px;height:160px;visibility:hidden;pointer-events:none;';
  }

  get ready(): boolean { return this.phaserReady; }

  get status(): StageRendererStatus {
    return {
      type: this.phaserReady ? 'phaser' : 'fallback',
      ready: this.phaserReady,
      failed: this.phaserFailed,
      canvasAttached: this.canvas.isConnected,
    };
  }

  boot(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = import('phaser').then((module) => this.createGame(module)).catch((error: unknown) => {
      this.phaserFailed = true;
      this.rejectReady?.(error);
      this.resolveReady = null;
      this.rejectReady = null;
      this.destroyPhaserGame();
      this.readyPromise = null;
      throw error;
    });
    return this.readyPromise;
  }

  resize(): void {
    const cssWidth = this.canvas.clientWidth || WIDTH;
    const cssHeight = this.canvas.clientHeight || HEIGHT;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.renderer.resize(this.canvas, cssWidth, cssHeight);
    this.renderer.resize(this.sourceCanvas, cssWidth, cssHeight);
    this.game?.scale.refresh();
  }

  render(state: GameState, nowSeconds: number, reducedMotion: boolean, eventFrame: StageEventFrame | null, hasBattleSequence: boolean): void {
    this.renderer.update(state, nowSeconds, reducedMotion, eventFrame, hasBattleSequence);
    // First paint and import/init failure stay visible on the real canvas.
    if (!this.game || this.phaserFailed) {
      this.renderer.draw(this.canvas, this.cssWidth, this.cssHeight);
      return;
    }
    this.renderer.draw(this.sourceCanvas, this.cssWidth, this.cssHeight);
    this.texture?.refresh();
  }

  clear(): void {
    this.renderer.clear(this.canvas);
    this.renderer.clear(this.sourceCanvas);
    this.texture?.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.resolveReady = null;
    this.rejectReady = null;
    this.destroyPhaserGame();
    this.readyPromise = null;
  }

  private createGame(module: PhaserModuleInterop): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const Phaser = module.default ?? module;
    const adapter = this;
    const sourceCanvas = this.sourceCanvas;
    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const AdapterScene = class extends Phaser.Scene {
      constructor() { super({ key: 'PocketPalStage' }); }
      create(): void {
        const scene = this as unknown as {
          textures: { addCanvas: (key: string, canvas: HTMLCanvasElement) => { refresh: () => void } };
          add: { image: (x: number, y: number, key: string) => { setOrigin: (x: number, y: number) => void } };
        };
        const canvasTexture = scene.textures.addCanvas(TEXTURE_KEY, sourceCanvas);
        adapter.texture = canvasTexture;
        scene.add.image(0, 0, TEXTURE_KEY).setOrigin(0, 0);
        adapter.phaserReady = true;
        adapter.resolveReady?.();
        adapter.resolveReady = null;
        adapter.rejectReady = null;
      }
    };
    try {
      this.game = new Phaser.Game({
        type: Phaser.CANVAS, canvas: this.canvas, width: WIDTH, height: HEIGHT, zoom: 1,
        pixelArt: true, roundPixels: true, antialias: false, transparent: true,
        render: { antialias: false, pixelArt: true, roundPixels: true },
        scale: { mode: Phaser.Scale.NONE, width: WIDTH, height: HEIGHT, autoRound: true },
        scene: AdapterScene, banner: false,
      });
    } catch (error: unknown) {
      this.rejectReady?.(error);
      throw error;
    }
    return ready;
  }

  private destroyPhaserGame(): void {
    // The supplied canvas belongs to the app, not Phaser. Keep it in the DOM
    // for document/video PiP and for page lifecycle teardown.
    this.game?.destroy(false, false);
    this.game = null;
    this.texture = null;
    this.phaserReady = false;
  }
}
