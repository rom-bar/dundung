import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotDir = resolve(process.cwd(), 'docs/screenshots');

async function openFreshGame(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Little needs' })).toBeVisible();
  await expect(page.locator('[data-need-value="hunger"]')).not.toHaveText('—');
}

test('care targets fit the viewport and meet touch size on every device', async ({ page }, testInfo) => {
  await openFreshGame(page);
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportHeight: document.documentElement.clientHeight,
  }));
  expect(dimensions.documentWidth, 'the page should not scroll horizontally').toBeLessThanOrEqual(dimensions.viewportWidth);

  const controls = page.locator('.food-button, .action-button');
  await expect(controls).toHaveCount(6);
  await page.locator('#care-controls').scrollIntoViewIfNeeded();
  for (const control of await controls.all()) await expect(control).toBeInViewport();
  if (dimensions.viewportWidth <= 580) {
    const dock = await page.locator('#care-controls').boundingBox();
    expect(dock).not.toBeNull();
    expect(Math.abs(dock!.y + dock!.height - dimensions.viewportHeight)).toBeLessThanOrEqual(1);
  }
  const boxes = await controls.evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }));
  for (const box of boxes) {
    expect(box.width, `${testInfo.project.name} care control should be at least 56px wide`).toBeGreaterThanOrEqual(56);
    expect(box.height, `${testInfo.project.name} care control should be at least 56px tall`).toBeGreaterThanOrEqual(56);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  }

  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]!;
      const b = boxes[right]!;
      const overlaps = a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      expect(overlaps, `care controls ${left} and ${right} should not overlap`).toBe(false);
    }
  }
});

test('a care action fires on pointerdown and its generated click does not duplicate it', async ({ page }, testInfo) => {
  await openFreshGame(page);
  const play = page.getByTestId('action-play');
  await play.dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'touch', isPrimary: true });
  await expect(play).toHaveClass(/is-pressed/);
  await expect(page.locator('#toast')).toContainText('Pip', { timeout: 5_000 });
  const firstResult = await page.locator('#toast').textContent();
  await play.dispatchEvent('pointerup', { pointerId: 41, pointerType: 'touch', isPrimary: true });
  await expect(play).not.toHaveClass(/is-pressed/);
  await play.dispatchEvent('click', { detail: 1 });
  await expect(page.locator('#toast')).toHaveText(firstResult ?? '');

  if (testInfo.project.name !== 'desktop-1280') {
    const feed = page.getByTestId('feed-moonberry-jam');
    await feed.tap();
    await expect(page.locator('[data-need-value="hunger"]')).toHaveText('100%');
    const feedResult = await page.locator('#toast').textContent();
    await page.waitForTimeout(120);
    await expect(page.locator('#toast')).toHaveText(feedResult ?? '');
  }
});

test('multiple pointers remain independent and blur clears pressed states', async ({ page }) => {
  await openFreshGame(page);
  const feed = page.getByTestId('feed-moonberry-jam');
  const play = page.getByTestId('action-play');
  await feed.dispatchEvent('pointerdown', { pointerId: 51, pointerType: 'touch', isPrimary: true });
  await play.dispatchEvent('pointerdown', { pointerId: 52, pointerType: 'touch', isPrimary: false });
  await expect(feed).toHaveClass(/is-pressed/);
  await expect(play).toHaveClass(/is-pressed/);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(feed).not.toHaveClass(/is-pressed/);
  await expect(play).not.toHaveClass(/is-pressed/);
});

test('settings persist size, handedness, opacity, haptics, sound, and CRT choices', async ({ page }) => {
  await openFreshGame(page);
  await page.getByTestId('settings-open').click();
  const dialog = page.getByRole('dialog', { name: 'Pocket Pal settings' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Care button size').selectOption('large');
  await page.getByLabel('Left-handed layout').check();
  await page.getByLabel('Haptics').check();
  await page.getByLabel('Care button opacity').fill('60');
  await page.getByTestId('sound-toggle').click();
  await page.getByTestId('crt-toggle').click();
  await page.getByTestId('settings-close').click();

  await expect(page.locator('#app')).toHaveAttribute('data-control-size', 'large');
  await expect(page.locator('#app')).toHaveAttribute('data-handedness', 'left');
  expect(await page.locator('#app').evaluate((element) => getComputedStyle(element).getPropertyValue('--control-opacity').trim())).toBe('0.6');
  await expect(page.getByTestId('action-play')).toHaveCSS('min-height', '78px');

  const settings = await page.evaluate(() => ({
    size: localStorage.getItem('pocket-pal-control-size'),
    left: localStorage.getItem('pocket-pal-left-handed'),
    haptics: localStorage.getItem('pocket-pal-haptics'),
    opacity: localStorage.getItem('pocket-pal-control-opacity'),
    muted: localStorage.getItem('pocket-pal-muted'),
    crt: localStorage.getItem('pocket-pal-crt'),
  }));
  expect(settings).toEqual({ size: 'large', left: 'true', haptics: 'true', opacity: '60', muted: 'true', crt: 'true' });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-control-size', 'large');
  await expect(page.locator('#app')).toHaveAttribute('data-handedness', 'left');
  await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('crt-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('growth HUD and Form Dex show current progress and silhouettes for undiscovered forms', async ({ page }) => {
  await openFreshGame(page);
  await expect(page.locator('#level-value')).toHaveText('1');
  await expect(page.locator('.stat-chip')).toHaveCount(5);
  await page.getByTestId('forms-open').click();
  const dex = page.getByRole('dialog', { name: 'Form Dex' });
  await expect(dex).toBeVisible();
  await expect(page.locator('#dex-progress')).toHaveText('0 of 20 forms found · scroll to explore');
  await expect(page.locator('.form-card.is-unknown')).toHaveCount(20);
  const grid = page.locator('#form-grid');
  expect(await grid.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await grid.focus();
  await expect(grid).toBeFocused();
  await grid.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(grid.locator('.form-card').last()).toBeInViewport();
  await expect(page.locator('#hall-list')).toContainText('Past pets');
  await page.getByRole('button', { name: 'Close Form Dex' }).click();
  await expect(dex).toBeHidden();
});

test('Dungeon run opens on desktop and mobile, enforces the three-slot pack, and resolves a fight', async ({ page }) => {
  await page.addInitScript(() => {
    const workerPrototype = Worker.prototype as unknown as { postMessage: (...args: any[]) => void };
    const originalPostMessage = workerPrototype.postMessage;
    workerPrototype.postMessage = function (this: Worker, message: any, ...options: any[]) {
      const loadMessage = message as { type?: string; state?: Record<string, any> };
      if (loadMessage.type === 'load' && loadMessage.state) {
        const evolution = loadMessage.state.evolution as Record<string, unknown>;
        loadMessage.state = {
          ...loadMessage.state,
          seed: 1,
          stage: 'adult',
          stageSeconds: 0,
          generationSeconds: 0,
          level: 40,
          peakLevel: 40,
          evolution: { ...evolution, formId: 'fire-emberguard', traitIds: [] },
          formDex: ['fire-emberguard'],
          training: { HP: 80, ATK: 80, DEF: 80, SPD: 80, LUK: 1 },
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
  await openFreshGame(page);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  await page.getByTestId('dungeon-open').click();
  const dialog = page.getByRole('dialog', { name: 'The Endless Descent' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Pack up to 3 items');
  const packItems = dialog.locator('[data-pack-item]');
  await expect(packItems).toHaveCount(6);
  await packItems.nth(0).check();
  await expect(packItems.nth(0)).toBeChecked();
  await packItems.nth(1).check();
  await packItems.nth(2).check();
  await expect(dialog.locator('#pack-count')).toHaveText('3 / 3');
  await expect(packItems.nth(3)).toBeDisabled();
  await dialog.getByTestId('dungeon-start').click();
  await expect(dialog.locator('[data-testid^="room-"]')).toHaveCount(3);
  await dialog.getByTestId('room-fight').click();
  await expect(dialog.getByTestId('tactic-all-in')).toBeVisible();
  await dialog.getByTestId('tactic-all-in').click();
  await expect(dialog.getByTestId('dungeon-fight')).toBeVisible({ timeout: 5_000 });
  await expect(dialog.locator('[data-testid^="room-"]')).toHaveCount(3, { timeout: 8_000 });
  await expect(dialog.locator('.dungeon-path .is-cleared')).toHaveCount(1);
  expect(Number(await dialog.locator('.run-ledger span').first().locator('strong').textContent())).toBeGreaterThan(0);
  await expect(dialog.locator('.run-ledger')).toContainText('Run coins');
});

test('memory mini-game awards a score and applies capped training to the selected stat', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1280', 'the timing-based memory sequence is exercised on desktop only');
  await page.addInitScript(() => {
    const workerPrototype = Worker.prototype as unknown as { postMessage: (...args: any[]) => void };
    const originalPostMessage = workerPrototype.postMessage;
    workerPrototype.postMessage = function (this: Worker, message: any, ...options: any[]) {
      const loadMessage = message as { type?: string; state?: Record<string, unknown> };
      if (loadMessage.type === 'load' && loadMessage.state) {
        const evolution = loadMessage.state.evolution as Record<string, unknown>;
        loadMessage.state = {
          ...loadMessage.state,
          stage: 'baby',
          stageSeconds: 0,
          generationSeconds: 0,
          evolution: { ...evolution, formId: 'fire-emberguard', traitIds: ['steadfast'] },
          formDex: ['fire-emberguard'],
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
  await openFreshGame(page);
  await expect(page.getByTestId('minigames-open')).toBeEnabled();
  await page.getByTestId('minigames-open').click();
  const dialog = page.getByRole('dialog', { name: 'Training games' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Train a stat').selectOption('ATK');
  await page.getByRole('button', { name: /Echo Garden/ }).click();
  await expect(page.locator('#memory-prompt')).toHaveText('Now repeat the 10-symbol trail.', { timeout: 20_000 });
  for (const index of [0, 2, 1, 3, 0, 1, 2, 3, 1, 0]) await page.locator(`[data-memory-index="${index}"]`).click();
  await expect(page.locator('.game-prompt')).toContainText('Game complete · 100/100');
  await expect(page.locator('#toast')).toContainText('Training complete: +2 attack points.', { timeout: 5_000 });
  await expect(page.locator('.stat-chip[title^="Attack"]')).toContainText('11');
  await expect(page.getByTestId('minigames-open')).toBeDisabled();
});

test('the installed app reloads offline after the service worker is ready', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1280', 'offline reload is verified once on desktop');
  await openFreshGame(page);
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable.');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await openFreshGame(page);
  await page.context().setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Little needs' })).toBeVisible();
    await expect(page.locator('[data-need-value="hunger"]')).not.toHaveText('—');
  } finally {
    await page.context().setOffline(false);
  }
});

test('haptics stay off by default and vibrate once when enabled for touch', async ({ page }) => {
  await openFreshGame(page);
  await page.evaluate(() => {
    const browserWindow = window as Window & { __vibrateCount?: number };
    browserWindow.__vibrateCount = 0;
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: () => { browserWindow.__vibrateCount = (browserWindow.__vibrateCount ?? 0) + 1; return true; },
    });
  });

  const clean = page.getByTestId('action-clean');
  await clean.dispatchEvent('pointerdown', { pointerId: 61, pointerType: 'touch', isPrimary: true });
  await clean.dispatchEvent('pointerup', { pointerId: 61, pointerType: 'touch', isPrimary: true });
  expect(await page.evaluate(() => (window as Window & { __vibrateCount?: number }).__vibrateCount)).toBe(0);

  await page.getByTestId('settings-open').click();
  await page.getByLabel('Haptics').check();
  await page.getByTestId('settings-close').click();
  const play = page.getByTestId('action-play');
  await play.dispatchEvent('pointerdown', { pointerId: 62, pointerType: 'touch', isPrimary: true });
  expect(await page.evaluate(() => (window as Window & { __vibrateCount?: number }).__vibrateCount)).toBe(1);
  await play.dispatchEvent('pointerup', { pointerId: 62, pointerType: 'touch', isPrimary: true });
});

test('mini mode keeps the worker active while the main page is hidden and pauses when PiP closes', async ({ page }) => {
  await page.addInitScript(() => {
    const browserWindow = window as Window & { __pocketTicks?: number; documentPictureInPicture?: unknown };
    browserWindow.__pocketTicks = 0;
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...options: any[]) {
      const loadMessage = message as { type?: string; state?: Record<string, any> };
      if (loadMessage.type === 'load' && loadMessage.state) {
        const evolution = loadMessage.state.evolution as Record<string, unknown>;
        loadMessage.state = {
          ...loadMessage.state,
          stage: 'baby',
          evolution: { ...evolution, formId: 'fire-emberguard' },
          formDex: ['fire-emberguard'],
        };
      }
      if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'tick') {
        browserWindow.__pocketTicks = (browserWindow.__pocketTicks ?? 0) + 1;
      }
      return postMessage.call(this, message, ...options);
    };
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: {
        window: null,
        async requestWindow() {
          const miniWindow = window.open('about:blank', 'PocketPalMini', 'width=320,height=400');
          if (!miniWindow) throw new Error('The test PiP window could not open.');
          this.window = miniWindow;
          return miniWindow;
        },
      },
    });
  });
  await openFreshGame(page);
  await page.getByTestId('dungeon-open').click();
  await page.getByTestId('dungeon-start').click();
  await page.getByRole('button', { name: 'Close dungeon' }).click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open mini mode' }).click();
  const mini = await popupPromise;
  await expect(mini.locator('#mini-scene')).toBeVisible();
  await expect(mini.locator('#mini-dungeon')).toBeVisible();
  await expect(mini.locator('#mini-dungeon-floor')).toHaveText('Floor 1');
  await expect(mini.locator('#mini-dungeon-room')).toContainText('Choose a room');
  await expect(mini.locator('#mini-dungeon-health')).toContainText('HP');
  await expect(mini.getByRole('button', { name: 'Play with Pip' })).toBeEnabled();

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
  const ticksBefore = await page.evaluate(() => (window as Window & { __pocketTicks?: number }).__pocketTicks ?? 0);
  await expect.poll(() => page.evaluate(() => (window as Window & { __pocketTicks?: number }).__pocketTicks ?? 0)).toBeGreaterThan(ticksBefore);

  await mini.getByRole('button', { name: 'Play with Pip' }).click();
  await expect(page.locator('#toast')).toContainText('lovely');
  await mini.close();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
});

test('mini mode falls back to video PiP and hides cleanly when neither PiP API exists', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    HTMLCanvasElement.prototype.captureStream = () => new MediaStream();
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLVideoElement.prototype.requestPictureInPicture = async function () {
      Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: this });
      return { width: 320, height: 180 } as PictureInPictureWindow;
    };
  });
  await openFreshGame(page);
  const miniButton = page.getByRole('button', { name: 'Open mini mode' });
  await expect(miniButton).toBeVisible();
  await miniButton.click();
  await expect(miniButton).toHaveAttribute('aria-pressed', 'true');
  const video = page.locator('video[aria-hidden="true"]');
  await expect(video).toBeAttached();
  await video.dispatchEvent('leavepictureinpicture');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();

  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { configurable: true, value: undefined });
    Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', { configurable: true, value: undefined });
  });
  await page.reload();
  await openFreshGame(page);
  await expect(page.locator('#mini-mode-button')).toBeHidden();
});

test('left-handed mode mirrors the visual order of both care banks', async ({ page }) => {
  await openFreshGame(page);
  const firstFood = page.getByTestId('feed-moonberry-jam');
  const lastFood = page.getByTestId('feed-moss-muffin');
  const firstAction = page.getByTestId('action-play');
  const lastAction = page.getByTestId('action-clean');
  const ltr = await Promise.all([firstFood, lastFood, firstAction, lastAction].map(async (button) => (await button.boundingBox())!.x));
  expect(ltr[0]).toBeLessThan(ltr[1]);
  expect(ltr[2]).toBeLessThan(ltr[3]);

  await page.getByTestId('settings-open').click();
  await page.getByLabel('Left-handed layout').check();
  await page.getByTestId('settings-close').click();
  const rtl = await Promise.all([firstFood, lastFood, firstAction, lastAction].map(async (button) => (await button.boundingBox())!.x));
  expect(rtl[0]).toBeGreaterThan(rtl[1]);
  expect(rtl[2]).toBeGreaterThan(rtl[3]);
});

test('care keyboard shortcuts still work on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1280', 'keyboard shortcut check is for desktop');
  await openFreshGame(page);
  await page.keyboard.press('p');
  await expect(page.locator('#toast')).toContainText('Pip', { timeout: 5_000 });
});

test('capture representative mobile and landscape review states', async ({ page }, testInfo) => {
  await openFreshGame(page);
  mkdirSync(screenshotDir, { recursive: true });

  if (testInfo.project.name === 'phone-320') {
    await page.screenshot({ path: resolve(screenshotDir, 'pocket-pal-320-idle.png'), scale: 'css' });
    await page.getByTestId('settings-open').click();
    await page.screenshot({ path: resolve(screenshotDir, 'pocket-pal-320-settings.png'), scale: 'css' });
  }
  if (testInfo.project.name === 'phone-360') {
    await page.getByTestId('action-play').tap();
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(screenshotDir, 'pocket-pal-360-active.png'), scale: 'css' });
    await page.getByTestId('forms-open').tap();
    await expect(page.getByRole('dialog', { name: 'Form Dex' })).toBeVisible();
    await page.screenshot({ path: resolve(screenshotDir, 'pocket-pal-360-form-dex.png'), scale: 'css' });
  }
  if (testInfo.project.name === 'phone-390') {
    await page.getByTestId('settings-open').click();
    await page.screenshot({ path: resolve(screenshotDir, 'pocket-pal-390-settings.png'), scale: 'css' });
  }
  if (testInfo.project.name === 'landscape-740') {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.screenshot({ path: resolve(screenshotDir, 'pocket-pal-740-landscape-paused.png'), scale: 'css' });
  }
});
