import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotDir = resolve(process.cwd(), 'docs/screenshots');

async function installSeededPet(page: import('@playwright/test').Page): Promise<void> {
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

test('seeded dungeon walk and combat events play on the stage while choices stay over the live scene', async ({ page }, testInfo) => {
  test.skip(!['phone-360', 'landscape-740', 'desktop-1280'].includes(testInfo.project.name), 'Step 3 acceptance and visual evidence sizes');
  test.setTimeout(45_000);
  await installSeededPet(page);
  await page.goto('/');
  await expect(page.locator('#stage-location')).toBeVisible();
  await expect(page.locator('[data-need-value="hunger"]')).not.toHaveText('—');
  const hideGuide = page.getByRole('button', { name: 'Hide guide' });
  if (await hideGuide.isVisible()) await hideGuide.click();
  await page.evaluate(() => window.__game?.setSeed(1));
  await expect(page.getByTestId('dungeon-open')).toBeVisible();

  const dungeon = page.getByRole('dialog', { name: 'The Endless Descent' });
  await page.getByTestId('dungeon-open').click();
  await expect(dungeon).toBeVisible();
  const backdropFilter = await dungeon.evaluate((element) => getComputedStyle(element, '::backdrop').backdropFilter);
  expect(backdropFilter).toBe('none');
  await dungeon.getByTestId('dungeon-start').click();
  await expect(dungeon).toBeHidden();
  await expect(page.locator('#stage-location')).toHaveText('CINDER COPSE');
  await expect(page.getByTestId('stage-decision')).toBeVisible();

  const saveFrame = async (name: string): Promise<void> => {
    if (!['phone-360', 'landscape-740'].includes(testInfo.project.name)) return;
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: resolve(screenshotDir, `pocket-pal-${name}-${testInfo.project.name}.png`), scale: 'css' });
  };
  await saveFrame('dungeon-walk');

  await expect(page.getByTestId('stage-decision').locator('[data-testid^="room-"]')).toHaveCount(3);
  const canvas = page.locator('[data-testid="stage-canvas"]');
  const frameBeforeDecisionWait = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(180);
  const frameAfterDecisionWait = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  expect(frameAfterDecisionWait).not.toBe(frameBeforeDecisionWait);
  await page.getByTestId('room-fight').click();
  await expect(page.getByTestId('tactic-all-in')).toBeVisible();
  await expect(dungeon).toBeHidden();

  const waitForEvent = async (eventType: string, screenshotName: string): Promise<void> => {
    await expect.poll(
      () => page.evaluate(() => window.__game?.getPlaybackState().frameEventType),
      { intervals: [40], timeout: 10_000 },
    ).toBe(eventType);
    await expect(page.locator('#stage-location')).toHaveText('BATTLE');
    await saveFrame(screenshotName);
  };
  await waitForEvent('enemy_appear', 'enemy-intro');

  await page.getByTestId('tactic-all-in').click();
  await waitForEvent('combat_start', 'combat-start');
  await waitForEvent('attack', 'combat-damage');
  await expect(page.locator('#stage-hp-status')).toBeVisible();
  await waitForEvent('victory', 'combat-victory');

  if (testInfo.project.name === 'desktop-1280') {
    const metrics = await page.evaluate(() => window.__game?.getPerformanceMetrics());
    expect(metrics?.combatFrameSamples).toBeGreaterThan(0);
    expect(metrics?.averageCombatFrameMs).not.toBeNull();
    expect(metrics?.averageCombatRenderMs).not.toBeNull();
    expect(metrics?.averageCombatControlUpdateMs).not.toBeNull();
    expect(metrics?.averageCombatLoopWorkMs).not.toBeNull();
    console.log(`[Pocket Pal Step 3] desktop combat: rAF avg ${metrics!.averageCombatFrameMs!.toFixed(2)} ms / p95 ${metrics!.p95CombatFrameMs!.toFixed(2)} / max ${metrics!.maxCombatFrameMs!.toFixed(2)}; JS stage ${metrics!.averageCombatRenderMs!.toFixed(2)} ms; controls ${metrics!.averageCombatControlUpdateMs!.toFixed(2)} ms; loop ${metrics!.averageCombatLoopWorkMs!.toFixed(2)} ms (${metrics!.combatFrameSamples} frames).`);
  }

  const eventTypes = await page.evaluate(() => (window.__game?.getEventLog() ?? []).map((event) => event.type));
  expect(eventTypes).toEqual(expect.arrayContaining(['walk_start', 'room_enter', 'enemy_appear', 'combat_start', 'attack', 'victory']));
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
});
