import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const states = ['corridor', 'intro', 'attack', 'crit', 'chest', 'home', 'eating'] as const;
type Preview = typeof states[number];

async function installAdultPet(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const originalPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...options: any[]) {
      const load = message as { type?: string; state?: Record<string, unknown> };
      if (load.type === 'load' && load.state) {
        const evolution = load.state.evolution as Record<string, unknown>;
        load.state = {
          ...load.state,
          seed: 1,
          stage: 'adult',
          level: 40,
          peakLevel: 40,
          stageSeconds: 0,
          generationSeconds: 0,
          evolution: { ...evolution, formId: 'fire-emberguard', traitIds: [] },
          formDex: ['fire-emberguard'],
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
}

test('Phaser slice visual review captures sourced art and a full attack sequence', async ({ page }, testInfo) => {
  test.skip(!['phone-360', 'landscape-740'].includes(testInfo.project.name), 'The brief requires portrait 360x740 and landscape 740x360 review.');
  test.setTimeout(60_000);
  const round = process.env.PHASER_ART_ROUND ?? '6';
  if (!/^[1-9]\d?$/.test(round)) throw new Error('PHASER_ART_ROUND must be an integer from 1 to 99.');
  const folder = resolve('docs/art-review', `round-${round}`, testInfo.project.name);
  mkdirSync(folder, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await installAdultPet(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__game?.getStageRenderer().ready), { timeout: 20_000 }).toBe(true);
  await expect(page.locator('[data-need-value="hunger"]')).not.toHaveText('—');
  const hideGuide = page.getByRole('button', { name: 'Hide guide' });
  if (await hideGuide.isVisible()) await hideGuide.click();
  const originalSeed = await page.evaluate(() => window.__game?.getState()?.seed);
  const preview = async (name: Preview | null, progress = 0.5): Promise<void> => {
    await page.evaluate(({ name, progress }) => {
      const game = window.__game as typeof window.__game & { previewStage: (name: Preview | null, progress: number, frozen: boolean) => void };
      if (!game?.previewStage) throw new Error('The presentation-only preview hook is unavailable.');
      game.previewStage(name, progress, true);
    }, { name, progress });
    await page.waitForTimeout(90);
  };
  for (const name of states) {
    await preview(name, name === 'chest' ? 0.7 : name === 'crit' ? 0.5 : name === 'attack' ? 0.6 : name === 'eating' ? 0.55 : 0.42);
    await page.screenshot({ path: resolve(folder, `${name}.png`), scale: 'css' });
  }
  const attackProgress = [0, 0.16, 0.3, 0.45, 0.48, 0.52, 0.72, 1];
  for (let index = 0; index < 8; index += 1) {
    await preview('attack', attackProgress[index]);
    await page.screenshot({ path: resolve(folder, `attack-${index + 1}.png`), scale: 'css' });
  }
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="stage-canvas"]')!.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      stage: { width: stage.width, height: stage.height },
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      seed: window.__game?.getState()?.seed,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.viewport.height);
  expect(layout.seed).toBe(originalSeed);
  expect(errors).toEqual([]);
  writeFileSync(resolve(folder, 'evidence.json'), JSON.stringify({ round, project: testInfo.project.name, states, attackFrames: 8, attackProgress, layout, errors }, null, 2) + '\n');
  await preview(null);
});

test('fresh save shows the sourced egg before the pet hatches', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-360', 'Capture the fresh egg state once at the portrait reference viewport.');
  const round = process.env.PHASER_ART_ROUND ?? '6';
  const folder = resolve('docs/art-review', `round-${round}`, 'phone-360');
  mkdirSync(folder, { recursive: true });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__game?.getStageRenderer().ready), { timeout: 20_000 }).toBe(true);
  await expect(page.locator('#stage-pill')).toHaveText('Egg');
  await expect.poll(() => page.evaluate(() => window.__game?.getStageSceneMetrics()?.petFrameName ?? null)).toBe('pet1.egg');
  const hideGuide = page.getByRole('button', { name: 'Hide guide' });
  if (await hideGuide.isVisible()) await hideGuide.click();
  await page.screenshot({ path: resolve(folder, 'egg-state.png'), scale: 'css' });
});
