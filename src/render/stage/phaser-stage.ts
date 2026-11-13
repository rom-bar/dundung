import type { GameState } from '../../core/types';
import type { StageEventFrame } from './event-player';
import type { NativeStageBridge, NativeStagePreviewName, NativeStageScene } from './native-scene';
import type { StageSceneRenderer } from './scene';

const WIDTH = 240;
const HEIGHT = 160;
type PhaserModule = typeof import('phaser');
type PhaserModuleInterop = PhaserModule & { default?: PhaserModule };
type PhaserGame = {
  destroy: (removeCanvas: boolean, noReturn?: boolean) => void;
  scale: { refresh: () => void; resize: (width: number, height: number) => void };
  step?: (time: number, delta: number) => void;
  loop?: { stop: () => void };
};

type NativeStageMetrics = {
  petHeight: number;
  stageHeight: number;
  activeParticleCount: number;
  petWidth: number;
  petSpriteHeight: number;
  petFrameName: string;
};

export type StageRendererStatus = {
  type: 'phaser' | 'fallback';
  ready: boolean;
  failed: boolean;
  canvasAttached: boolean;
};

/** Owns the native Phaser scene, while keeping the old renderer as a first-paint/import fallback. */
export class PhaserStageAdapter {
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: unknown) => void) | null = null;
  private game: PhaserGame | null = null;
  private nativeScene: NativeStageScene | null = null;
  private phaserReady = false;
  private phaserFailed = false;
  private disposed = false;
  private cssWidth = WIDTH;
  private cssHeight = HEIGHT;
  private lastStepTime = 0;
  private previewName: NativeStagePreviewName | null = null;
  private previewProgress = 0.5;
  private previewFrozen = true;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly renderer: StageSceneRenderer) {}

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
    this.readyPromise = Promise.all([import('phaser'), import('./native-scene'), document.fonts.ready])
      .then(([module, scene]) => this.createGame(module, scene.createNativeStageScene)).catch((error: unknown) => {
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
    this.cssWidth = Math.max(1, Math.round(this.canvas.clientWidth || WIDTH));
    this.cssHeight = Math.max(1, Math.round(this.canvas.clientHeight || HEIGHT));
    this.renderer.resize(this.canvas, this.cssWidth, this.cssHeight);
    if (this.game) {
      // Keep the backing store in lockstep with CSS pixels. Phaser's native
      // renderer then preserves atlas aspect instead of object-fitting 240x160.
      this.game.scale.resize(this.cssWidth, this.cssHeight);
      this.nativeScene?.resizeStage(this.cssWidth, this.cssHeight);
      this.game.scale.refresh();
    }
  }

  render(state: GameState, nowSeconds: number, reducedMotion: boolean, eventFrame: StageEventFrame | null, hasBattleSequence: boolean, decisionPaused = false): void {
    this.renderer.update(state, nowSeconds, reducedMotion, eventFrame, hasBattleSequence, decisionPaused);
    if (!this.game || this.phaserFailed || !this.phaserReady) {
      // The old canvas renderer is intentionally only a first-paint/import failure fallback.
      this.renderer.draw(this.canvas, this.cssWidth, this.cssHeight);
      return;
    }
    const safeNow = Number.isFinite(nowSeconds) ? Math.max(0, nowSeconds * 1000) : 0;
    const previousStepTime = this.lastStepTime;
    const stepTime = previousStepTime ? Math.max(previousStepTime + 0.1, safeNow) : safeNow;
    this.lastStepTime = stepTime;
    this.game.step?.(stepTime, previousStepTime ? stepTime - previousStepTime : 16.67);
  }

  setPreviewState(name: NativeStagePreviewName | null, progress = 0.5, frozen = true): void {
    this.previewName = name;
    this.previewProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0.5));
    this.previewFrozen = frozen;
    this.nativeScene?.setPreviewState(name, this.previewProgress, frozen);
  }

  getStageSceneMetrics(): NativeStageMetrics | null {
    return this.nativeScene?.getMetrics?.() ?? null;
  }

  clear(): void {
    if (!this.phaserReady) this.renderer.clear(this.canvas);
    this.lastStepTime = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.resolveReady = null;
    this.rejectReady = null;
    this.destroyPhaserGame();
    this.readyPromise = null;
  }

  private createGame(module: PhaserModuleInterop, createNativeStageScene: typeof import('./native-scene').createNativeStageScene): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const Phaser = module.default ?? module;
    const adapter = this;
    const bridge: NativeStageBridge = {
      getState: () => adapter.renderer.visualState(),
      getEventFrame: () => adapter.renderer.getEventFrame(),
      getNowSeconds: () => adapter.renderer.getTimeSeconds(),
      isReducedMotion: () => adapter.renderer.isReducedMotion(),
      hasBattleSequence: () => adapter.renderer.hasBattleSequence(),
      isDecisionPaused: () => adapter.renderer.isDecisionPaused(),
    };
    const NativeScene = createNativeStageScene(Phaser, bridge);
    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const Scene = class extends NativeScene {
      create(): void {
        super.create();
        adapter.nativeScene = this as unknown as NativeStageScene;
        adapter.nativeScene.resizeStage(adapter.cssWidth, adapter.cssHeight);
        adapter.nativeScene.setPreviewState(adapter.previewName, adapter.previewProgress, adapter.previewFrozen);
        // Loader/create has completed; from this point the parent owns the event clock.
        adapter.game?.loop?.stop();
        adapter.phaserReady = true;
        adapter.resolveReady?.();
        adapter.resolveReady = null;
        adapter.rejectReady = null;
      }
    };
    try {
      this.game = new Phaser.Game({
        type: Phaser.CANVAS,
        canvas: this.canvas,
        width: this.cssWidth,
        height: this.cssHeight,
        zoom: 1,
        pixelArt: true,
        roundPixels: true,
        antialias: false,
        transparent: true,
        render: { antialias: false, pixelArt: true, roundPixels: true },
        scale: { mode: Phaser.Scale.NONE, width: this.cssWidth, height: this.cssHeight, autoRound: true },
        scene: Scene,
        banner: false,
      });
    } catch (error: unknown) {
      this.rejectReady?.(error);
      throw error;
    }
    return ready;
  }

  private destroyPhaserGame(): void {
    this.game?.destroy(false, false);
    this.game = null;
    this.nativeScene = null;
    this.phaserReady = false;
    this.lastStepTime = 0;
  }
}
