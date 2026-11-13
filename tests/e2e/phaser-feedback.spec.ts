import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

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

test('mobile home motion diagnostics preserve the pixel grid and ground contact', async ({ page }, testInfo) => {
  test.skip(!['phone-360', 'phone-390'].includes(testInfo.project.name), 'Compare the requested 360px and 390px mobile widths.');
  test.setTimeout(45_000);
  const pass = process.env.PHASER_FEEDBACK_PASS ?? 'after';
  if (!/^[a-z0-9-]+$/.test(pass)) throw new Error('PHASER_FEEDBACK_PASS must be a safe path segment.');
  const folder = resolve('docs/art-review/feedback', pass, testInfo.project.name);
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
  await page.evaluate(() => {
    const game = window.__game as typeof window.__game & { previewStage: (name: 'home', progress: number, frozen: boolean) => void };
    game?.previewStage('home', 0.5, false);
  });

  const motion = await page.evaluate(async () => {
    const intervals: number[] = [];
    const actor: Array<{
      timeMs: number;
      frameName: string;
      petX: number;
      petY: number;
      petScaleX: number;
      petScaleY: number;
      petHeight: number;
      stageHeight: number;
      shadowY: number;
    }> = [];
    const startedAt = performance.now();
    let previous = 0;
    await new Promise<void>((resolve) => {
      const sample = (now: number) => {
        if (previous > 0) intervals.push(now - previous);
        previous = now;
        const metrics = window.__game?.getStageSceneMetrics();
        if (metrics) actor.push({
          timeMs: Math.round(now - startedAt),
          frameName: metrics.petFrameName,
          petX: metrics.petX,
          petY: metrics.petY,
          petScaleX: metrics.petScaleX,
          petScaleY: metrics.petScaleY,
          petHeight: metrics.petHeight,
          stageHeight: metrics.stageHeight,
          shadowY: metrics.shadowY,
        });
        if (now - startedAt < 1600) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    const sorted = [...intervals].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]! : null;
    const average = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
    return { sampleCount: intervals.length, averageFrameMs: average, p95FrameMs: p95, maxFrameMs: sorted.at(-1) ?? null, actor };
  });
  const layout = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    stage: document.querySelector('[data-testid="stage-canvas"]')!.getBoundingClientRect().toJSON(),
  }));
  expect(motion.sampleCount).toBeGreaterThan(30);
  expect(motion.actor.length).toBeGreaterThan(30);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.viewport.height);
  expect(errors).toEqual([]);

  const latest = motion.actor.at(-1)!;
  if (pass === 'after') {
    const zoom = Math.max(1, Math.floor(latest.stageHeight / 160));
    const petFootY = latest.petY + latest.petHeight / (2 * zoom);
    expect(latest.petHeight / latest.stageHeight).toBeGreaterThanOrEqual(0.25);
    expect(Math.abs(latest.petScaleX - Math.round(latest.petScaleX))).toBeLessThan(0.001);
    expect(Math.abs(latest.petScaleY - Math.round(latest.petScaleY))).toBeLessThan(0.001);
    expect(latest.shadowY).toBeGreaterThan(petFootY);
    expect(motion.actor.every((sample) => /^pet1\.rabbit\.fire(?:\.walk-[ab])?$/.test(sample.frameName))).toBe(true);
    expect(motion.actor.every((sample) => Number.isInteger(sample.petX) && Number.isInteger(sample.petY))).toBe(true);
    expect(new Set(motion.actor.map((sample) => `${sample.petX}:${sample.petY}:${sample.frameName}`)).size).toBeGreaterThan(1);
  }
  await page.screenshot({ path: resolve(folder, 'home-live.png'), scale: 'css' });
  writeFileSync(resolve(folder, 'evidence.json'), JSON.stringify({ pass, project: testInfo.project.name, layout, motion, errors }, null, 2) + '\n');
});

test('mobile dungeon choices stay inside the unblurred live stage', async ({ page }, testInfo) => {
  test.skip(!['phone-360', 'phone-390'].includes(testInfo.project.name), 'Capture the requested 360px and 390px mobile widths.');
  test.setTimeout(45_000);
  const pass = process.env.PHASER_FEEDBACK_PASS ?? 'after';
  if (!/^[a-z0-9-]+$/.test(pass)) throw new Error('PHASER_FEEDBACK_PASS must be a safe path segment.');
  const folder = resolve('docs/art-review/feedback', pass, testInfo.project.name);
  mkdirSync(folder, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await installAdultPet(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__game?.getStageRenderer().ready), { timeout: 20_000 }).toBe(true);
  const hideGuide = page.getByRole('button', { name: 'Hide guide' });
  if (await hideGuide.isVisible()) await hideGuide.click();

  const dungeon = page.getByRole('dialog', { name: 'The Endless Descent' });
  await page.getByTestId('dungeon-open').click();
  await expect(dungeon).toBeVisible();
  const backdropFilter = await dungeon.evaluate((element) => getComputedStyle(element, '::backdrop').backdropFilter);
  await dungeon.getByTestId('dungeon-start').click();
  await expect(dungeon).toBeHidden();
  await expect(page.getByTestId('stage-decision')).toBeVisible();

  const canvas = page.locator('[data-testid="stage-canvas"]');
  const frameBefore = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(220);
  const frameAfter = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector('.scene-frame')!.getBoundingClientRect();
    const card = document.querySelector('[data-testid="stage-decision"]')!.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom },
      card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom },
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
  const cardInsideScene = geometry.card.left >= geometry.frame.left
    && geometry.card.top >= geometry.frame.top
    && geometry.card.right <= geometry.frame.right
    && geometry.card.bottom <= geometry.frame.bottom;
  expect(backdropFilter).toBe('none');
  expect(frameAfter).not.toBe(frameBefore);
  expect(cardInsideScene).toBe(true);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.viewport.height);
  expect(await page.locator('[data-testid="stage-decision"] [data-testid^="room-"]').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: resolve(folder, 'decision-live.png'), scale: 'css' });
  writeFileSync(resolve(folder, 'decision-evidence.json'), JSON.stringify({ pass, project: testInfo.project.name, backdropFilter, frameChanged: frameAfter !== frameBefore, geometry, cardInsideScene, errors }, null, 2) + '\n');

  const phaseBefore = await page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase ?? null);
  await page.locator('[data-testid="stage-decision"] [data-testid^="room-"]').first().click();
  await expect.poll(() => page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase ?? null)).not.toBe(phaseBefore);
  await expect(dungeon).toBeHidden();
});
