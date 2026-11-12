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
