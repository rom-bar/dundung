import { expect, test, type Locator, type Page } from '@playwright/test';

const ACCEPTANCE_PROJECTS = ['phone-320', 'phone-360', 'phone-390', 'landscape-740', 'desktop-1280'];

async function installSeededPet(page: Page): Promise<void> {
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
          seed: 1,
          stage: 'adult',
          stageSeconds: 0,
          generationSeconds: 0,
          level: 40,
          peakLevel: 40,
          paused: false,
          sleeping: false,
          evolution: { ...evolution, formId: 'fire-emberguard', traitIds: [] },
          formDex: ['fire-emberguard'],
          training: { HP: 80, ATK: 80, DEF: 80, SPD: 80, LUK: 1 },
        };
      }
      return originalPostMessage.call(this, message, ...options);
    };
  });
}

async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function expectPhaserReady(page: Page): Promise<void> {
  await expect(page.locator('#stage-location')).toBeVisible();
  await expect(page.locator('[data-testid="stage-canvas"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__game?.getStageRenderer()), { timeout: 15_000 }).toEqual({
    type: 'phaser', ready: true, failed: false, canvasAttached: true,
  });
  const canvas = page.locator('[data-testid="stage-canvas"]');
  const evidence = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    const rect = node.getBoundingClientRect();
    const context = node.getContext('2d');
    let nonTransparentPixels = 0;
    if (context) {
      const pixels = context.getImageData(0, 0, node.width, node.height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index]! > 0) nonTransparentPixels += 1;
      }
    }
    return { rect: { width: rect.width, height: rect.height }, nonTransparentPixels };
  });
  expect(evidence.nonTransparentPixels).toBeGreaterThan(0);
  if ((await page.evaluate(() => innerWidth)) < (await page.evaluate(() => innerHeight))) {
    expect(evidence.rect.height, 'portrait Phaser canvas should occupy at least 40% of the viewport').toBeGreaterThanOrEqual(
      (await page.evaluate(() => innerHeight)) * 0.4,
    );
  }
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.documentHeight).toBeLessThanOrEqual(dimensions.viewportHeight);
}

async function waitForPhase(page: Page, phase: string, timeout = 15_000): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase ?? null),
    { timeout, intervals: [50, 100, 200, 400] },
  ).toBe(phase);
}

async function waitForRunPhaseChange(page: Page, previous: string, timeout = 20_000): Promise<string> {
  await expect.poll(
    () => page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase ?? null),
    { timeout, intervals: [50, 100, 200, 400] },
  ).not.toBe(previous);
  return page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase ?? 'none');
}

async function openSeededRun(page: Page): Promise<Locator> {
  await page.goto('/');
  await expectPhaserReady(page);
  await expect(page.locator('[data-need-value="hunger"]')).not.toHaveText('—');
  await page.evaluate(() => window.__game?.setSeed(1));
  await expect(page.getByTestId('dungeon-open')).toBeEnabled();
  await page.getByTestId('dungeon-open').click();
  const dungeon = page.getByRole('dialog', { name: 'The Endless Descent' });
  await expect(dungeon).toBeVisible();
  await dungeon.getByTestId('dungeon-start').click();
  await expect(page.locator('#stage-location')).toHaveText('CINDER COPSE');
  await expect.poll(() => page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase ?? null)).toBe('choice');
  return dungeon;
}

async function resolveCurrentDecision(page: Page, dungeon: Locator, firstFight: boolean): Promise<string> {
  const phase = await page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase ?? null);
  if (phase === 'choice') {
    const fight = dungeon.getByTestId('room-fight');
    const room = await fight.count() ? fight : dungeon.locator('[data-testid^="room-"]').first();
    await expect(room).toBeVisible();
    await room.click();
  } else if (phase === 'tactic') {
    const tactic = dungeon.getByTestId('tactic-all-in');
    await expect(tactic).toBeVisible();
    if (firstFight) await expect(page.locator('#stage-speed')).toHaveAttribute('aria-label', /^Animation speed 1/);
    await tactic.click();
  } else if (phase === 'event') {
    await dungeon.locator('[data-run-action="event"]').first().click();
  } else if (phase === 'treasure') {
    await dungeon.locator('[data-run-action="treasure"]').click();
  } else if (phase === 'rest') {
    await dungeon.locator('[data-run-action="rest"]').click();
  } else if (phase === 'shop') {
    const buy = dungeon.locator('[data-run-action="buy"]:not(:disabled)').first();
    if (await buy.count()) await buy.click();
    await dungeon.locator('[data-run-action="continue-shop"]').click();
  } else if (phase === 'loot') {
    await dungeon.locator('[data-run-action="take-drop"]').click();
  } else if (phase === 'combat') {
    await expect(dungeon.getByTestId('dungeon-fight')).toBeVisible();
    await expect.poll(
      () => page.evaluate(() => window.__game?.getEventLog().some((event) => event.type === 'attack') ?? false),
      { timeout: 20_000, intervals: [100, 200, 400] },
    ).toBe(true);
  } else {
    throw new Error(`Unexpected dungeon phase while resolving run: ${phase}`);
  }
  return phase ?? 'none';
}

test('seeded run plays every Floor 1 room, resolves a real fight, banks, and closes its summary', async ({ page }, testInfo) => {
  test.skip(!ACCEPTANCE_PROJECTS.includes(testInfo.project.name), 'Acceptance uses the required 320, 360, 390, landscape 740, and desktop viewports.');
  test.setTimeout(90_000);
  const consoleErrors = await collectConsoleErrors(page);
  await installSeededPet(page);
  const dungeon = await openSeededRun(page);
  const visitedPhases: string[] = [];
  let firstFight = true;

  for (let step = 0; step < 24; step += 1) {
    const phase = await page.evaluate(() => window.__game?.getState()?.dungeon.activeRun?.phase ?? null);
    if (!phase) throw new Error('The seeded run ended before its summary.');
    if (phase === 'floor-end') {
      const run = await page.evaluate(() => window.__game?.getState()?.dungeon.activeRun);
      expect(run?.floor).toBe(1);
      expect(run?.roomIndex).toBe(3);
      await dungeon.getByTestId('dungeon-leave').click();
      await waitForPhase(page, 'summary');
      continue;
    }
    if (phase === 'summary') break;
    visitedPhases.push(phase);
    const before = phase;
    await resolveCurrentDecision(page, dungeon, firstFight);
    if (before === 'tactic') firstFight = false;
    await waitForRunPhaseChange(page, before);
  }

  await waitForPhase(page, 'summary');
  await expect(dungeon.getByTestId('dungeon-summary')).toBeVisible();
  await expect(dungeon.getByTestId('dungeon-summary')).toContainText('Safe return');
  const summaryState = await page.evaluate(() => window.__game?.getState()?.dungeon.activeRun);
  expect(summaryState?.result).toBe('left');
  expect(summaryState?.floor).toBe(1);
  expect(summaryState?.roomIndex).toBe(3);
  expect(visitedPhases.filter((phase) => phase === 'choice')).toHaveLength(3);
  expect(visitedPhases).toEqual(expect.arrayContaining(['tactic', 'combat']));
  const eventTypes = await page.evaluate(() => (window.__game?.getEventLog() ?? []).map((event) => event.type));
  for (const required of ['walk_start', 'room_enter', 'enemy_appear', 'combat_start', 'attack', 'victory', 'floor_cleared', 'run_complete']) {
    expect(eventTypes, `event log should include ${required}`).toContain(required);
  }
  expect(eventTypes.filter((type) => type === 'room_enter')).toHaveLength(3);
  expect(eventTypes.indexOf('attack')).toBeGreaterThan(eventTypes.indexOf('combat_start'));
  expect(eventTypes.indexOf('victory')).toBeGreaterThan(eventTypes.indexOf('attack'));
  await dungeon.getByTestId('dungeon-summary-close').click();
  await expect(page.getByTestId('dungeon-open')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__game?.getEventLog().some((event) => event.type === 'return_home'))).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('a new save keeps the egg sprite until the simulation hatches Pip', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-360', 'The egg identity check is captured once at the primary portrait viewport.');
  await page.goto('/');
  await expectPhaserReady(page);
  await expect.poll(() => page.evaluate(() => window.__game?.getState()?.stage ?? null)).toBe('egg');
  await expect(page.locator('#stage-pill')).toHaveText('Egg');
  await expect.poll(() => page.evaluate(() => window.__game?.getStageSceneMetrics()?.petFrameName ?? null)).toBe('pet1.egg');
});

test('the installed Phaser shell reloads offline after its service worker controls the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1280', 'Offline reload is exercised once on desktop.');
  test.setTimeout(45_000);
  const consoleErrors = await collectConsoleErrors(page);
  await page.goto('/');
  await expectPhaserReady(page);
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable.');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expectPhaserReady(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const responses = await Promise.all(keys.map(async (key) => ({ key, count: (await caches.open(key)).keys().then((items) => items.length) })));
    return { keys, counts: await Promise.all(responses.map(async (item) => ({ key: item.key, count: await item.count }))) };
  });
  expect(cached.keys.some((key) => key.startsWith('pocket-pal-'))).toBe(true);
  expect(cached.counts.some((item) => item.count > 0)).toBe(true);
  try {
    await page.context().setOffline(true);
    await page.reload();
    await expectPhaserReady(page);
    expect(await page.locator('[data-testid="stage-canvas"]').isVisible()).toBe(true);
  } finally {
    await page.context().setOffline(false);
  }
  expect(consoleErrors).toEqual([]);
});

test('reduced motion keeps Phaser ready, rendered, bounded, and exposes all animation speeds', async ({ page }, testInfo) => {
  test.skip(!ACCEPTANCE_PROJECTS.includes(testInfo.project.name), 'Reduced-motion coverage uses the required viewports plus desktop.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const consoleErrors = await collectConsoleErrors(page);
  await installSeededPet(page);
  const dungeon = await openSeededRun(page);
  await dungeon.getByRole('button', { name: 'Close dungeon' }).click();
  const speed = page.locator('#stage-speed');
  await expect(speed).toHaveAttribute('aria-label', /^Animation speed 1/);
  await speed.click();
  await expect(speed).toHaveAttribute('aria-label', /^Animation speed 2/);
  await speed.click();
  await expect(speed).toHaveAttribute('aria-label', /^Animation speed skip/i);
  await speed.click();
  await expect(speed).toHaveAttribute('aria-label', /^Animation speed 1/);
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height);
  expect(consoleErrors).toEqual([]);
});
