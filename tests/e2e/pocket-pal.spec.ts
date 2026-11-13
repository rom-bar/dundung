import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotDir = resolve(process.cwd(), 'docs/screenshots');

async function openFreshGame(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#stage-location')).toBeVisible();
  await expect(page.locator('[data-need-value="hunger"]')).not.toHaveText('—');
}

async function installDungeonFixture(page: import('@playwright/test').Page, phase: 'shop' | 'loot'): Promise<void> {
  await page.addInitScript((fixturePhase) => {
    const workerPrototype = Worker.prototype as unknown as { postMessage: (...args: any[]) => void };
    const originalPostMessage = workerPrototype.postMessage;
    workerPrototype.postMessage = function (this: Worker, message: any, ...options: any[]) {
      const loadMessage = message as { type?: string; state?: Record<string, any> };
      if (loadMessage.type === 'load' && loadMessage.state) {
        const state = loadMessage.state;
        const item = {
          instanceId: `e2e-${fixturePhase}-gear`, templateId: 'emberfang-pick', rarity: 'Rare',
          ilvl: 8, upgradeLevel: 0, rollSeed: 123, upgradeSeed: 456, inheritedAffixId: null,
        };
        const run = {
          generation: 1, floor: 1, roomIndex: 0, biomeId: 'cinder-copse', petFormId: 'fire-emberguard', petElement: 'fire',
          phase: fixturePhase, rngSeed: 73, mode: 'standard', dailyDateKey: null, modifierIds: [], ascensionRank: 0,
          challengeEffects: { enemyStatsMultiplier: 1, enemyHpMultiplier: 1, enemyAttackMultiplier: 1, enemySpeedMultiplier: 1,
            lootChanceMultiplier: 1, rarityLuckBonus: 0, maxHpMultiplier: 1 },
          petStats: { HP: 80, ATK: 20, DEF: 15, SPD: 15, LUK: 1 },
          runStatMultipliers: { HP: 1, ATK: 1, DEF: 1, SPD: 1, LUK: 1 }, coinMultiplier: 1,
          petHp: 80, petMaxHp: 80, petGauge: 0, petStatuses: [],
          equipmentEffects: { critChance: 0, lifesteal: 0, elementDamage: 0, foodEffectiveness: 0, coinFind: 0, resist: 0,
            resistByElement: { fire: 0, water: 0, moss: 0, storm: 0, shadow: 0 }, thorns: 0, onHitStatuses: [] },
          enemy: null, roomChoices: [], currentRoom: fixturePhase === 'shop' ? 'shop' : 'treasure', eventId: null,
          shopOfferIds: [], shopEquipmentOffers: fixturePhase === 'shop' ? [{ id: 'e2e-shop-offer', item, price: 17 }] : [],
          tacticId: null, consumables: [], coins: 30, lootIds: [], pendingItems: [],
          pendingItem: fixturePhase === 'loot' ? item : null, pendingScrap: 0, pendingEssence: 0,
          combatLog: [], combatElapsedSeconds: 0, turns: 0, result: null, bankedCoins: 0, bankedLootCount: 0,
          lostLootCount: 0, bankedItemCount: 0, lostItemCount: 0, bankedScrap: 0, bankedEssence: 0, lostScrap: 0, lostEssence: 0,
        };
        const evolution = state.evolution as Record<string, unknown>;
        loadMessage.state = {
          ...state, stage: 'adult', sleeping: false, level: 40, peakLevel: 40, paused: false,
          evolution: { ...evolution, formId: 'fire-emberguard', traitIds: [] },
          formDex: ['fire-emberguard'], training: { HP: 80, ATK: 80, DEF: 80, SPD: 80, LUK: 1 },
          dungeon: { ...(state.dungeon as Record<string, unknown>), activeRun: run },
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  }, phase);
}

async function installHatchedFixture(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const workerPrototype = Worker.prototype as unknown as { postMessage: (...args: any[]) => void };
    const originalPostMessage = workerPrototype.postMessage;
    workerPrototype.postMessage = function (this: Worker, message: any, ...options: any[]) {
      const loadMessage = message as { type?: string; state?: Record<string, any> };
      if (loadMessage.type === 'load' && loadMessage.state) {
        const state = loadMessage.state;
        const evolution = state.evolution as Record<string, unknown>;
        loadMessage.state = {
          ...state,
          stage: 'baby',
          stageSeconds: 0,
          paused: false,
          sleeping: false,
          evolution: { ...evolution, formId: 'fire-emberguard' },
          formDex: ['fire-emberguard'],
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
}

test('saved progress is loaded before first-steps guidance is shown', async ({ page }) => {
  await page.addInitScript(() => {
    const originalPostMessage = Worker.prototype.postMessage;
    (window as any).__pendingGameLoad = null;
    (window as any).__gameWorker = null;
    (window as any).__releasedGameLoad = false;
    Worker.prototype.postMessage = function (message: any, ...options: any[]) {
      if (message?.type === 'load' && !(window as any).__releasedGameLoad) {
        (window as any).__pendingGameLoad = message;
        (window as any).__gameWorker = this;
        return;
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
  await page.goto('/');
  const slot = page.locator('#getting-started-slot');
  await expect(slot).toContainText('Checking your saved world…');
  await expect(slot).not.toContainText('Hatch Pip');

  const loadCaptured = await page.evaluate(() => Boolean((window as any).__pendingGameLoad?.state));
  expect(loadCaptured).toBe(true);
  await page.evaluate(() => {
    const message = (window as any).__pendingGameLoad;
    message.state.stage = 'baby';
    message.state.evolution.formId = 'fire-emberguard';
    message.state.dungeon.runsCompleted = 1;
    message.state.paused = false;
    (window as any).__releasedGameLoad = true;
    (window as any).__gameWorker.postMessage(message);
  });
  await expect(page.locator('[data-need-value="hunger"]')).not.toHaveText('—');
  await expect(slot).toBeHidden();
  await expect(page.getByTestId('first-steps-guide')).toHaveCount(0);
});

test('first-steps guide follows a fresh egg, and its dismissal persists', async ({ page }) => {
  await openFreshGame(page);
  const guide = page.getByTestId('first-steps-guide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Hatch Pip');
  await expect(guide).toContainText('Spend one active minute');
  await expect(page.locator('#pet-scene')).toHaveAttribute('aria-label', 'Pip’s egg resting in the cave habitat.');

  await guide.getByRole('button', { name: 'Hide guide' }).click();
  await expect(page.getByTestId('first-steps-guide')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('first-steps-guide')).toHaveCount(0);
});

test('first-steps guide opens the first dungeon after hatching', async ({ page }) => {
  await installHatchedFixture(page);
  await openFreshGame(page);
  const guide = page.getByTestId('first-steps-guide');
  await expect(guide.locator('.guide-step[aria-current="step"]')).toContainText('Take a first descent');
  await expect(guide).toContainText('leave at any floor to bank your finds');
  await guide.getByRole('button', { name: 'Open Dungeon' }).click();
  await expect(page.getByTestId('dungeon-start')).toBeVisible();
  await expect(page.getByTestId('dungeon-start')).toBeEnabled();
});

test('stage-first home starts collapsed, fills the viewport, and keeps action targets clear', async ({ page }, testInfo) => {
  await openFreshGame(page);
  await expect(page.getByTestId('stage-canvas')).toBeVisible();
  await expect(page.getByTestId('stage-status')).toBeVisible();
  await expect(page.getByTestId('stage-sheet')).not.toHaveClass(/is-expanded/);
  await expect(page.getByTestId('stage-sheet-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#stage-location')).toHaveText('HOME');

  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    canvasHeight: document.querySelector<HTMLCanvasElement>('#pet-scene')!.getBoundingClientRect().height,
    sheetClient: document.querySelector<HTMLElement>('#stage-sheet-content')!.clientWidth,
    sheetScroll: document.querySelector<HTMLElement>('#stage-sheet-content')!.scrollWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.width);
  expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.height);
  expect(metrics.sheetScroll).toBeLessThanOrEqual(metrics.sheetClient);
  if (metrics.width < metrics.height) expect(metrics.canvasHeight).toBeGreaterThanOrEqual(metrics.height * .4);

  const buttons = page.getByTestId('stage-actions-home').locator('.stage-action');
  await expect(buttons).toHaveCount(5);
  const boxes = await buttons.evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    return { x: box.x, right: box.right, y: box.y, bottom: box.bottom, width: box.width, height: box.height };
  }));
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(56);
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(metrics.width + 1);
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]!;
      const b = boxes[right]!;
      expect(a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y).toBe(false);
    }
  }

  if (testInfo.project.name === 'phone-360' || testInfo.project.name === 'landscape-740') {
    mkdirSync(screenshotDir, { recursive: true });
    const screenshotName = testInfo.project.name === 'phone-360' ? 'pocket-pal-stage-home-360x740.png' : 'pocket-pal-stage-home-740x360.png';
    await page.screenshot({ path: resolve(screenshotDir, screenshotName), scale: 'css' });
  }
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.locator('#stage-tab-log')).toBeVisible();
  await expect(page.getByTestId('stage-sheet-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('stage stays in a fixed viewport and stage/care controls meet touch size on every device', async ({ page }, testInfo) => {
  await openFreshGame(page);
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
  }));
  expect(dimensions.documentWidth, 'the page should not scroll horizontally').toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.documentHeight, 'the main screen should fit the viewport without page scrolling').toBeLessThanOrEqual(dimensions.viewportHeight);

  const stage = page.locator('#pet-scene');
  await expect(stage).toBeVisible();
  const stageBox = await stage.boundingBox();
  expect(stageBox).not.toBeNull();
  if (dimensions.viewportWidth < dimensions.viewportHeight) {
    expect(stageBox!.height, `${testInfo.project.name} stage should fill at least 40% of portrait viewport`).toBeGreaterThanOrEqual(dimensions.viewportHeight * 0.4);
  }

  await page.getByRole('tab', { name: 'Care' }).click();
  await expect(page.locator('#stage-drawer')).toHaveClass(/is-expanded/);
  const sheet = page.locator('#stage-sheet-content');
  const sheetSize = await sheet.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(sheetSize.scroll, `${testInfo.project.name} sheet should not scroll horizontally`).toBeLessThanOrEqual(sheetSize.client);

  const controls = page.locator('.food-button, .action-button');
  await expect(controls).toHaveCount(6);
  await page.locator('#care-controls').scrollIntoViewIfNeeded();
  for (const control of await controls.all()) await expect(control).toBeInViewport();
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

  await page.getByRole('button', { name: /Little details/ }).click();
  const stageActions = page.locator('#stage-actions-home .stage-action');
  await expect(stageActions).toHaveCount(5);
  const actionBoxes = await stageActions.evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height };
  }));
  for (const box of actionBoxes) {
    expect(box.width, `${testInfo.project.name} stage action should be at least 56px wide`).toBeGreaterThanOrEqual(56);
    expect(box.height, `${testInfo.project.name} stage action should be at least 56px high`).toBeGreaterThanOrEqual(56);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  }
});

test('a care action fires on pointerdown and its generated click does not duplicate it', async ({ page }, testInfo) => {
  await openFreshGame(page);
  await page.getByRole('tab', { name: 'Care' }).click();
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
  await page.getByRole('tab', { name: 'Care' }).click();
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
  await page.getByRole('tab', { name: 'Care' }).click();
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

test('Gear opens accessibly on every device and equips a catalog item through the worker', async ({ page }) => {
  await page.addInitScript(() => {
    const workerPrototype = Worker.prototype as unknown as { postMessage: (...args: any[]) => void };
    const originalPostMessage = workerPrototype.postMessage;
    workerPrototype.postMessage = function (this: Worker, message: any, ...options: any[]) {
      if (message?.type === 'action' && message.action?.type === 'set-auto-scrap') {
        const history = (window as any).__autoScrapActionHistory ?? [];
        (window as any).__autoScrapActionHistory = [...history, message.action.threshold];
      }
      const loadMessage = message as { type?: string; state?: Record<string, any> };
      if (loadMessage.type === 'load' && loadMessage.state) {
        const equipment = loadMessage.state.equipment as Record<string, any>;
        const testItem = {
          instanceId: 'e2e-emberfang', templateId: 'emberfang-pick', rarity: 'Rare',
          ilvl: 8, upgradeLevel: 0, rollSeed: 123, upgradeSeed: 456, inheritedAffixId: null,
        };
        const fuseItems = ['a', 'b', 'c'].map((suffix, index) => ({
          ...testItem, instanceId: `e2e-fuse-${suffix}`, rarity: 'Common', rollSeed: 500 + index,
        }));
        const scrapItem = { ...testItem, instanceId: 'e2e-scrap-armor', templateId: 'coalcap-plate', rollSeed: 900 };
        loadMessage.state = {
          ...loadMessage.state,
          equipment: { ...equipment, inventory: [testItem, ...fuseItems, scrapItem], nextItemId: 20 },
          dungeon: { ...loadMessage.state.dungeon, scrap: 100 },
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
  await openFreshGame(page);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth, 'the page should not scroll horizontally').toBeLessThanOrEqual(dimensions.width);

  await page.getByTestId('gear-open').click();
  const dialog = page.getByRole('dialog', { name: 'Gear & workshop' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab')).toHaveCount(3);
  await expect(dialog.locator('.gear-slot-panel')).toHaveCount(4);
  await expect(dialog).toContainText('Emberfang Pick');
  const equip = dialog.locator('[data-testid="gear-card-e2e-emberfang"]').getByRole('button', { name: 'Equip' });
  await expect(equip).toBeEnabled();
  await equip.click();
  await expect(dialog.locator('.gear-slot-panel').first()).toContainText('Worn by Pip');
  await expect(dialog.locator('.gear-slot-panel').first()).toContainText('Emberfang Pick');
  await expect(dialog.locator('.gear-slot-panel').first().getByRole('button', { name: 'Unequip' })).toBeEnabled();

  await dialog.getByRole('tab', { name: 'Workshop' }).click();
  const upgradedCard = dialog.locator('[data-testid="gear-card-e2e-emberfang"]');
  const upgrade = upgradedCard.locator('[data-gear-action="upgrade"]');
  await expect(upgrade).toBeEnabled();
  await upgrade.click();
  await expect(upgradedCard.locator('.gear-level')).toContainText('+1');

  await dialog.getByRole('tab', { name: 'Bag' }).click();
  await expect(dialog.getByRole('heading', { name: 'Your bag' })).toBeVisible();
  for (const suffix of ['a', 'b', 'c']) {
    await dialog.locator(`[data-testid="gear-card-e2e-fuse-${suffix}"] input[data-fuse-item]`).check();
  }
  const fuse = dialog.getByRole('button', { name: /Fuse into Uncommon/ });
  await expect(fuse).toBeEnabled();
  await fuse.click();
  await expect(dialog.locator('.gear-bag-grid .gear-card[data-rarity="Uncommon"]')).toHaveCount(1);
  const scrapCard = dialog.locator('[data-testid="gear-card-e2e-scrap-armor"]');
  await scrapCard.locator('[data-gear-action="scrap"]').click();
  await expect(dialog.locator('[data-testid="gear-card-e2e-scrap-armor"]')).toHaveCount(0);
  await expect(dialog.locator('#gear-wallet span').nth(1).locator('strong')).toHaveText('81');

  const autoScrap = dialog.locator('#auto-scrap-select');
  await expect(autoScrap).toBeEnabled();
  await autoScrap.selectOption('Common');
  const sentThresholds = () => page.evaluate(() => (window as unknown as { __autoScrapActionHistory?: string[] }).__autoScrapActionHistory ?? []);
  await expect.poll(async () => (await sentThresholds()).includes('Common')).toBe(true);
  await autoScrap.selectOption('Uncommon');
  await expect(autoScrap).toHaveValue('Uncommon');
  await expect.poll(async () => (await sentThresholds()).includes('Uncommon')).toBe(true);

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(dimensions.width + 1);
  await dialog.getByRole('button', { name: 'Close gear and workshop' }).click();
  await expect(dialog).toBeHidden();
});

test('Home upgrades, achievements, records and Kitchen meals work on every device', async ({ page }) => {
  await page.addInitScript(() => {
    const workerPrototype = Worker.prototype as unknown as { postMessage: (...args: any[]) => void };
    const originalPostMessage = workerPrototype.postMessage;
    workerPrototype.postMessage = function (this: Worker, message: any, ...options: any[]) {
      const loadMessage = message as { type?: string; state?: Record<string, any> };
      if (loadMessage.type === 'load' && loadMessage.state) {
        const evolution = loadMessage.state.evolution as Record<string, unknown>;
        loadMessage.state = {
          ...loadMessage.state,
          stage: 'adult', paused: false, level: 40, peakLevel: 40,
          evolution: { ...evolution, formId: 'fire-emberguard', traitIds: [] },
          formDex: ['fire-emberguard'],
          dungeon: { ...loadMessage.state.dungeon, coins: 500 },
          home: {
            ...loadMessage.state.home,
            upgradeLevels: { ...loadMessage.state.home.upgradeLevels, library: 3 },
          },
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
  await openFreshGame(page);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth, 'Home should not introduce horizontal page overflow').toBeLessThanOrEqual(dimensions.width);

  await page.getByTestId('home-open').click();
  const home = page.getByRole('dialog', { name: 'Home & family' });
  await expect(home).toBeVisible();
  await expect(home.getByRole('tab')).toHaveCount(4);
  const kitchen = home.locator('[data-upgrade="kitchen"]');
  await expect(kitchen).toContainText('Level 0 / 5');
  await kitchen.locator('[data-home-action="upgrade"]').click();
  await expect(kitchen).toContainText('Level 1 / 5');
  await kitchen.locator('[data-home-action="upgrade"]').click();
  await expect(kitchen).toContainText('Level 2 / 5');
  await expect(home.locator('#home-wallet span').first().locator('strong')).toHaveText('370');

  await home.locator('#home-meal-stat').selectOption('HP');
  await home.getByRole('button', { name: /Cook meal/ }).click();
  await expect(home.getByRole('status')).toContainText('Meal ready: +14% Health');
  await home.getByRole('tab', { name: 'Achievements' }).click();
  await expect(home.locator('.achievement-grid .home-achievement').first()).toBeVisible();
  await home.getByRole('tab', { name: 'Records' }).click();
  await expect(home.getByRole('heading', { name: "Pip's records" })).toBeVisible();
  await expect(home.locator('.record-grid .record-card')).toHaveCount(13);
  const homeBox = await home.boundingBox();
  expect(homeBox).not.toBeNull();
  expect(homeBox!.x).toBeGreaterThanOrEqual(0);
  expect(homeBox!.x + homeBox!.width).toBeLessThanOrEqual(dimensions.width + 1);
  await home.getByRole('button', { name: 'Close Home' }).click();

  await page.getByTestId('forms-open').click();
  const dex = page.getByRole('dialog', { name: 'Form Dex' });
  await expect(dex.locator('#library-hint')).toContainText('Advanced Library clue');
  await expect(dex.locator('#library-hint')).toContainText('weight share');
  await dex.getByRole('button', { name: 'Close Form Dex' }).click();

  await page.getByTestId('dungeon-open').click();
  const dungeon = page.getByRole('dialog', { name: 'The Endless Descent' });
  await expect(dungeon).toContainText('Pack up to 4 items');
  await expect(dungeon.locator('#pack-count')).toHaveText('0 / 4');
  const packItems = dungeon.locator('[data-pack-item]');
  for (let index = 0; index < 4; index += 1) await packItems.nth(index).check();
  await expect(packItems.nth(4)).toBeDisabled();
  await dungeon.getByTestId('dungeon-start').click();
  await expect(dungeon).toBeHidden();
  await expect(page.getByTestId('stage-decision')).toBeVisible();
  await expect(page.locator('#stage-run-meta')).toBeVisible();
  await expect(page.locator('#stage-run-summary')).toContainText('F1');
  await page.getByTestId('stage-actions-run').getByRole('button', { name: 'Open run pack' }).click();
  await expect(page.locator('#stage-tab-pack')).toContainText('Run coins');
});

test('Endless daily, ascension, modifiers and local ghost battles work on every device', async ({ page }) => {
  await page.addInitScript(() => {
    const workerPrototype = Worker.prototype as unknown as { postMessage: (...args: any[]) => void };
    const originalPostMessage = workerPrototype.postMessage;
    workerPrototype.postMessage = function (this: Worker, message: any, ...options: any[]) {
      const loadMessage = message as { type?: string; state?: Record<string, any> };
      if (loadMessage.type === 'load' && loadMessage.state) {
        const evolution = loadMessage.state.evolution as Record<string, unknown>;
        const endless = loadMessage.state.endless as Record<string, any>;
        loadMessage.state = {
          ...loadMessage.state,
          stage: 'adult', paused: false, level: 40, peakLevel: 40,
          evolution: { ...evolution, formId: 'fire-emberguard', traitIds: [] },
          formDex: ['fire-emberguard'],
          endless: { ...endless, bestFloorSinceAscension: 20, dailyAttemptDate: null, selectedModifierIds: [], defeatedEnemyIds: ['cinder-sprout'] },
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
  await openFreshGame(page);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth, 'Endless controls should not cause horizontal overflow').toBeLessThanOrEqual(dimensions.width);

  await page.getByTestId('home-open').click();
  const home = page.getByRole('dialog', { name: 'Home & family' });
  await home.getByRole('tab', { name: 'Endless' }).click();
  await expect(home.getByTestId('open-daily-trial')).toBeEnabled();
  await expect(home.locator('.daily-date')).toHaveText(/\d{4}-\d{2}-\d{2} · UTC/);
  await expect(home.locator('.bestiary-entry.is-known')).toContainText('Cinder Sprout');
  await expect(home.locator('.bestiary-entry.is-unknown')).toHaveCount(19);
  const unknownEntries = await home.locator('.bestiary-entry.is-unknown').allTextContents();
  expect(unknownEntries.join(' ')).not.toContain('Cinder Crown');

  await home.locator('[data-perk-id="vitality"]').click();
  await expect(home.locator('.ascension-progress')).toContainText('Rank 1');
  await home.getByTestId('modifier-ironhide').check();
  await home.getByTestId('modifier-quickstep').check();
  await home.getByTestId('modifier-hardbite').check();
  await expect(home.getByTestId('modifier-curio')).toBeDisabled();
  await expect(home.locator('.modifier-count')).toHaveText('3 / 3 selected');

  await home.getByRole('button', { name: 'Create my code' }).click();
  const output = home.getByTestId('pet-code-output');
  await expect(output).toHaveValue(/^PP1[ GJ]\./);
  const code = await output.inputValue();
  await home.getByTestId('ghost-code-input').fill(code);
  await home.getByRole('button', { name: 'Validate and battle' }).click();
  await expect(home.getByTestId('ghost-result')).toBeVisible();
  await home.getByTestId('ghost-code-input').fill('not-a-pet-code');
  await home.getByRole('button', { name: 'Validate and battle' }).click();
  await expect(home.locator('.ghost-error')).toContainText('not a Pocket Pal pet code');

  await home.getByTestId('open-daily-trial').click();
  const dungeon = page.getByRole('dialog', { name: 'The Endless Descent' });
  await expect(dungeon.getByTestId('daily-mode')).toHaveAttribute('aria-pressed', 'true');
  await expect(dungeon.getByTestId('dungeon-start')).toHaveText('Start today’s trial');
  await dungeon.getByTestId('dungeon-start').click();
  await expect(dungeon).toBeHidden();
  await expect(page.getByTestId('stage-decision')).toBeVisible();
  const dailyRun = await page.evaluate(() => window.__game?.getState()?.dungeon.activeRun);
  expect(dailyRun?.mode).toBe('daily');
  expect(dailyRun?.modifierIds).toEqual([]);
  await page.getByTestId('home-open').click();
  await home.getByRole('tab', { name: 'Endless' }).click();
  await expect(home.getByTestId('open-daily-trial')).toBeDisabled();
  await expect(home.getByTestId('open-daily-trial')).toHaveText('Today’s trial used');
});

test('the traveling shop sells gear into the run bag without enabling loadout changes mid-run', async ({ page }) => {
  await installDungeonFixture(page, 'shop');
  await openFreshGame(page);
  await page.getByTestId('dungeon-open').click();
  const dungeon = page.getByRole('dialog', { name: 'The Endless Descent' });
  await expect(dungeon).toContainText('Traveling shop');
  await expect(dungeon.locator('.shop-gear-offer .gear-card')).toContainText('Emberfang Pick');
  const buy = dungeon.locator('[data-run-action="buy-gear"]');
  await expect(buy).toBeEnabled();
  await expect(buy).toContainText('17 coins');
  await buy.click();
  await expect(dungeon.locator('.run-ledger span').nth(1).locator('strong')).toHaveText('1');

  await dungeon.getByRole('button', { name: 'Close dungeon' }).click();
  await page.getByTestId('gear-open').click();
  const gear = page.getByRole('dialog', { name: 'Gear & workshop' });
  await gear.getByRole('tab', { name: 'Bag' }).click();
  await expect(gear.locator('[data-testid="gear-card-e2e-shop-gear"]')).toContainText('Emberfang Pick');
  await expect(gear.locator('.run-gear-shelf [data-gear-action="equip"]')).toHaveCount(0);
  await expect(gear).toContainText('Bag changes are locked until the current run ends');
});

test('the dungeon shows take, scrap and leave choices for a gear drop, then carries a taken item', async ({ page }) => {
  await installDungeonFixture(page, 'loot');
  await openFreshGame(page);
  const decision = page.getByTestId('stage-decision');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('Emberfang Pick');
  await expect(decision.getByRole('button', { name: 'Take gear' })).toBeEnabled();
  await expect(decision.locator('[data-run-action="scrap-drop"]')).toBeEnabled();
  await expect(decision.getByRole('button', { name: 'Leave' })).toBeEnabled();
  await decision.getByRole('button', { name: 'Take gear' }).click();
  await expect.poll(() => page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.pendingItems.length ?? 0)).toBe(1);
  await page.getByTestId('stage-actions-run').getByRole('button', { name: 'Open run pack' }).click();
  await expect(page.locator('#stage-tab-pack .stage-ledger')).toContainText('Bagged gear');
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
  await expect(dialog).toBeHidden();
  await expect(page.locator('#stage-location')).toHaveText('CINDER COPSE');
  await expect(page.getByTestId('stage-actions-run')).toBeVisible();
  await expect(page.getByTestId('stage-actions-home')).toBeHidden();
  await expect(page.getByTestId('stage-decision').locator('[data-testid^="room-"]')).toHaveCount(3);
  await page.getByTestId('room-fight').click();
  await expect(page.getByTestId('tactic-all-in')).toBeVisible();
  await page.getByTestId('tactic-all-in').click();
  await expect.poll(() => page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase)).toBe('combat');
  await expect(page.locator('#stage-location')).toHaveText('BATTLE', { timeout: 5_000 });
  await expect(page.locator('#stage-hp-status')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__game?.getEventLog().some((event) => event.type === 'attack') ?? false), { timeout: 5_000 }).toBe(true);
  await expect(page.getByTestId('stage-decision').locator('[data-testid^="room-"]')).toHaveCount(3, { timeout: 8_000 });
  await page.getByTestId('stage-actions-run').getByRole('button', { name: 'Open run pack' }).click();
  await expect(page.locator('#stage-tab-pack .stage-ledger')).toContainText('Run coins');
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
  await page.getByRole('tab', { name: 'Care' }).click();
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
    await expect(page.locator('#stage-location')).toBeVisible();
    await expect(page.locator('[data-need-value="hunger"]')).not.toHaveText('—');
  } finally {
    await page.context().setOffline(false);
  }
});

test('haptics stay off by default and vibrate once when enabled for touch', async ({ page }) => {
  await openFreshGame(page);
  await page.getByRole('tab', { name: 'Care' }).click();
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
    const browserWindow = window as Window & { __pocketTicks?: number; __requestedCaptureFPS?: number; documentPictureInPicture?: unknown };
    browserWindow.__pocketTicks = 0;
    const captureStream = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (frameRate?: number) {
      browserWindow.__requestedCaptureFPS = frameRate;
      return captureStream.call(this, frameRate);
    };
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
  await expect(page.getByRole('dialog', { name: 'The Endless Descent' })).toBeHidden();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open mini mode' }).click();
  const mini = await popupPromise;
  await expect(mini.locator('#mini-scene')).toBeVisible();
  const scene = await mini.locator('#mini-scene').evaluate((element) => {
    const video = element as HTMLVideoElement;
    const rect = video.getBoundingClientRect();
    return {
      tagName: video.tagName,
      hasStream: Boolean(video.srcObject),
      liveVideoTracks: video.srcObject ? (video.srcObject as MediaStream).getVideoTracks().filter((track) => track.readyState === 'live').length : 0,
      frameRate: video.srcObject ? ((video.srcObject as MediaStream).getVideoTracks()[0]?.getSettings().frameRate ?? null) : null,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(scene.tagName).toBe('VIDEO');
  expect(scene.hasStream).toBe(true);
  expect(scene.liveVideoTracks).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as Window & { __requestedCaptureFPS?: number }).__requestedCaptureFPS)).toBe(60);
  expect(scene.frameRate === null || scene.frameRate >= 30).toBe(true);
  expect(scene.width).toBeGreaterThan(0);
  expect(scene.height).toBeGreaterThan(70);
  const miniBounds = await mini.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    controls: [...document.querySelectorAll<HTMLElement>('[data-mini-action]')].map((control) => {
      const rect = control.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom };
    }),
  }));
  expect(miniBounds.scrollWidth).toBeLessThanOrEqual(miniBounds.width);
  expect(miniBounds.scrollHeight).toBeLessThanOrEqual(miniBounds.height);
  expect(miniBounds.controls).toHaveLength(4);
  expect(miniBounds.controls.every((control) => control.left >= 0 && control.right <= miniBounds.width && control.bottom <= miniBounds.height)).toBe(true);
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
    const browserWindow = window as Window & { __pocketTicks?: number; __requestedCaptureFPS?: number };
    browserWindow.__pocketTicks = 0;
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    HTMLCanvasElement.prototype.captureStream = (frameRate?: number) => {
      browserWindow.__requestedCaptureFPS = frameRate;
      return new MediaStream();
    };
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...options: any[]) {
      if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'tick') {
        browserWindow.__pocketTicks = (browserWindow.__pocketTicks ?? 0) + 1;
      }
      return postMessage.call(this, message, ...options);
    };
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
  expect(await page.evaluate(() => (window as Window & { __requestedCaptureFPS?: number }).__requestedCaptureFPS)).toBe(60);
  const ticksAtOpen = await page.evaluate(() => (window as Window & { __pocketTicks?: number }).__pocketTicks ?? 0);
  await page.waitForTimeout(700);
  const fallbackTicks = (await page.evaluate(() => (window as Window & { __pocketTicks?: number }).__pocketTicks ?? 0)) - ticksAtOpen;
  expect(fallbackTicks).toBeGreaterThanOrEqual(12);
  expect(fallbackTicks).toBeLessThanOrEqual(28);
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
  await page.getByRole('tab', { name: 'Care' }).click();
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

test('all training games fit narrow viewports and expose tappable controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-1280' || testInfo.project.name === 'tablet-768', 'mobile-width regression check');
  await installHatchedFixture(page);
  await openFreshGame(page);
  await page.getByRole('tab', { name: 'Care' }).click();

  for (const game of [
    { name: /Quick Spark/, control: '#reaction-pad' },
    { name: /Echo Garden/, control: '.memory-grid' },
    { name: /Beat Bubbles/, control: '#rhythm-pad' },
  ]) {
    await page.getByTestId('minigames-open').click();
    const dialog = page.getByRole('dialog', { name: 'Training games' });
    await dialog.getByRole('button', { name: game.name }).click();
    const control = page.locator(game.control);
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const bounds = await page.evaluate((selector) => {
      const dialog = document.querySelector<HTMLDialogElement>('#minigame-dialog')!;
      const stage = document.querySelector<HTMLElement>('#minigame-stage')!;
      const control = stage.querySelector<HTMLElement>(selector)!;
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const box = rect(control);
      const row = stage.querySelector<HTMLElement>('.rhythm-row');
      const dots = [...(row?.querySelectorAll('.rhythm-beat') ?? [])].map(rect);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        dialog: rect(dialog), stage: rect(stage), control: box, row: row ? rect(row) : null, dots,
        close: rect(document.querySelector<HTMLButtonElement>('#minigame-close')!),
        widths: { document: document.documentElement.scrollWidth, dialog: dialog.scrollWidth, dialogClient: dialog.clientWidth, stage: stage.scrollWidth, stageClient: stage.clientWidth, row: row?.scrollWidth ?? 0, rowClient: row?.clientWidth ?? 0 },
      };
    }, game.control);
    expect(bounds.widths.document).toBeLessThanOrEqual(bounds.viewport.width);
    expect(bounds.widths.dialog).toBeLessThanOrEqual(bounds.widths.dialogClient + 1);
    expect(bounds.widths.stage).toBeLessThanOrEqual(bounds.widths.stageClient + 1);
    expect(bounds.control.left).toBeGreaterThanOrEqual(bounds.stage.left);
    expect(bounds.control.right).toBeLessThanOrEqual(bounds.stage.right + 1);
    expect(bounds.close.left).toBeGreaterThanOrEqual(0);
    expect(bounds.close.right).toBeLessThanOrEqual(bounds.viewport.width);
    expect(bounds.close.top).toBeGreaterThanOrEqual(bounds.dialog.top);
    expect(bounds.close.bottom).toBeLessThanOrEqual(bounds.dialog.bottom);
    if (bounds.row) {
      expect(bounds.widths.row).toBeLessThanOrEqual(bounds.widths.rowClient + 1);
      for (const dot of bounds.dots) {
        expect(dot.left).toBeGreaterThanOrEqual(bounds.row.left - 1);
        expect(dot.right).toBeLessThanOrEqual(bounds.row.right + 1);
      }
    } else {
      expect(bounds.control.height).toBeGreaterThanOrEqual(48);
    }
    if (game.name.source === 'Beat Bubbles') {
      expect(bounds.control.height).toBeGreaterThanOrEqual(56);
      const screenshotName: Record<string, string> = {
        'phone-320': 'pocket-pal-320-beat-bubbles.png',
        'phone-360': 'pocket-pal-360-beat-bubbles.png',
        'landscape-740': 'pocket-pal-740-landscape-beat-bubbles.png',
      };
      const screenshot = screenshotName[testInfo.project.name];
      if (screenshot) {
        mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: resolve(screenshotDir, screenshot), scale: 'css' });
      }
      await page.getByRole('button', { name: 'Tap with the beat' }).tap();
    }
    await page.locator('#minigame-close').click();
  }
});

test('every app dialog and its main tab panels stay within mobile viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-1280' || testInfo.project.name === 'tablet-768', 'mobile overflow audit');
  await installHatchedFixture(page);
  await openFreshGame(page);

  const audit = async (selector: string) => {
    const dimensions = await page.evaluate((dialogSelector) => {
      const dialog = document.querySelector<HTMLDialogElement>(dialogSelector)!;
      const box = dialog.getBoundingClientRect();
      const close = dialog.querySelector<HTMLButtonElement>('.dialog-close')!.getBoundingClientRect();
      const outside = [...dialog.querySelectorAll<HTMLElement>('*')].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
      }).map((element) => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 60), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, close: { left: close.left, right: close.right, top: close.top, bottom: close.bottom }, scroll: dialog.scrollWidth, client: dialog.clientWidth, outside };
    }, selector);
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.box.left).toBeGreaterThanOrEqual(-1);
    expect(dimensions.box.right).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.close.left).toBeGreaterThanOrEqual(-1);
    expect(dimensions.close.right).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.close.top).toBeGreaterThanOrEqual(-1);
    expect(dimensions.close.bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight + 1));
    expect(dimensions.outside).toEqual([]);
  };
  const dialogs = [
    { open: '#about-open', close: '#about-close', dialog: '#about-dialog' },
    { open: '#settings-open', close: '#settings-close', dialog: '#settings-dialog' },
    { open: '#forms-open', close: '#dex-close', dialog: '#dex-dialog' },
    { open: '#gear-open', close: '#gear-close', dialog: '#gear-dialog' },
    { open: '#home-open', close: '#home-close', dialog: '#home-dialog' },
    { open: '#stage-actions-home [data-stage-open="training"]', close: '#minigame-close', dialog: '#minigame-dialog' },
    { open: '#dungeon-open', close: '#dungeon-close', dialog: '#dungeon-dialog' },
  ];
  for (const entry of dialogs) {
    await page.locator(entry.open).click();
    await expect(page.locator(entry.dialog)).toBeVisible();
    await audit(entry.dialog);
    if (entry.dialog === '#gear-dialog') {
      for (const name of ['Bag', 'Workshop']) {
        await page.getByRole('tab', { name }).click();
        await audit(entry.dialog);
      }
    } else if (entry.dialog === '#home-dialog') {
      for (const name of ['Achievements', 'Records', 'Endless']) {
        await page.getByRole('tab', { name }).click();
        await audit(entry.dialog);
      }
    }
    await page.locator(entry.close).click();
  }
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
    await page.locator('#stage-actions-home [data-action="play"]').tap();
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
