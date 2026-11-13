import { expect, test } from '@playwright/test';

test('production preview boots the real Phaser renderer after its lazy chunk loads', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('[data-testid="stage-canvas"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__game?.getStageRenderer()), { timeout: 15_000 }).toEqual({
    type: 'phaser', ready: true, failed: false, canvasAttached: true,
  });

  const evidence = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="stage-canvas"]');
    if (!canvas) throw new Error('Stage canvas is missing.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Stage canvas has no 2D context.');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparentPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]! > 0) nonTransparentPixels += 1;
    }
    const lazyPhaserChunk = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => /phaser[-\w]*\.js/.test(name));
    const rect = canvas.getBoundingClientRect();
    return { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height, nonTransparentPixels, lazyPhaserChunk };
  });

  expect(Math.abs(evidence.width - evidence.cssWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(evidence.height - evidence.cssHeight)).toBeLessThanOrEqual(1);
  expect(evidence.nonTransparentPixels).toBeGreaterThan(0);
  expect(evidence.lazyPhaserChunk).toBeTruthy();
  expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: `docs/screenshots/pocket-pal-phaser-engine-${testInfo.project.name}.png`, fullPage: true });

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('[data-testid="stage-canvas"]')).toHaveCount(1);
  expect(await page.locator('[data-testid="stage-canvas"]').evaluate((canvas) => canvas.isConnected)).toBe(true);
});
