import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const atlasPath = resolve(root, 'public/assets/stage/atlas.json');
const dataPath = resolve(root, 'src/data/stage-sprites.json');

type StageData = {
  frames: Record<string, unknown>;
  animations: Record<string, { frames: string[]; frameRate: number; repeat: number }>;
};

describe('stage atlas contract', () => {
  it('ships the generated atlas and metadata', () => {
    expect(existsSync(resolve(root, 'public/assets/stage/atlas.png'))).toBe(true);
    expect(existsSync(atlasPath)).toBe(true);
    expect(existsSync(dataPath)).toBe(true);
  });

  it('resolves every animation frame to a packed atlas frame', () => {
    const atlas = JSON.parse(readFileSync(atlasPath, 'utf8')) as { frames: Record<string, unknown> };
    const data = JSON.parse(readFileSync(dataPath, 'utf8')) as StageData;
    expect(Object.keys(atlas.frames).sort()).toEqual(Object.keys(data.frames).sort());

    for (const [animationName, animation] of Object.entries(data.animations)) {
      expect(animation.frameRate, animationName).toBeGreaterThan(0);
      expect(Number.isInteger(animation.repeat), animationName).toBe(true);
      expect(animation.frames.length, animationName).toBeGreaterThan(0);
      for (const frameId of animation.frames) {
        expect(data.frames[frameId], `${animationName} -> ${frameId}`).toBeDefined();
        expect(atlas.frames[frameId], `${animationName} -> ${frameId}`).toBeDefined();
      }
    }
  });

  it('preserves master-sheet provenance and ships Canvas-compatible flash and palette frames', () => {
    const data = JSON.parse(readFileSync(dataPath, 'utf8')) as StageData;
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/assets/stage/asset-manifest.json'), 'utf8')) as {
      sources: { id: string; sourceMember: string; sourceIndex?: number; transform: string }[];
    };
    for (const [family, index] of [['pet1.rabbit', 152], ['enemy1.slime', 99]] as const) {
      const base = manifest.sources.find((source) => source.id === `${family}.idle`);
      expect(base?.sourceMember).toBe('tiny-creatures/Tilemap/tilemap.png');
      expect(base?.sourceIndex).toBe(index);
      expect(data.frames[`${family}.hit-flash`]).toBeDefined();
      for (const element of ['fire', 'water', 'moss', 'storm', 'shadow']) expect(data.frames[`${family}.${element}`]).toBeDefined();
      expect(manifest.sources.find((source) => source.id === `${family}.hit-flash`)?.transform).toBe('white-fill');
    }
    for (const effect of ['gold', 'heal', 'dust']) expect(data.frames[`particle.${effect}`]).toBeDefined();
    expect(data.frames['pet1.egg']).toBeDefined();
    expect(data.frames['food.biscuit']).toBeDefined();
    expect(manifest.sources.find((source) => source.id === 'pet1.egg')?.transform).toBe('downsample-nearest-2x');
    expect(manifest.sources.find((source) => source.id === 'food.biscuit')?.sourceMember).toBe('henry-food.png#crop=0,0,16,16');
    expect(manifest.sources.some((source) => source.id.startsWith('pet1.cat.'))).toBe(false);
  });
});
