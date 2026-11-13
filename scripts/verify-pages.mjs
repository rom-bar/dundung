import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const label = process.argv[2] ?? 'slice';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple release label.');
const out = resolve('docs/art-review/live');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const response = await page.goto('https://rom-bar.github.io/dundung/', { waitUntil: 'networkidle' });
  if (response?.status() !== 200) throw new Error(`Pages returned ${response?.status()}.`);
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => /phaser[-\w]*\.js/.test(entry.name)), { timeout: 20000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="stage-canvas"]');
    const context = canvas?.getContext('2d');
    return Boolean(context && context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3]);
  });
  const hide = page.getByRole('button', { name: 'Hide guide' });
  if (await hide.isVisible()) await hide.click();
  await page.waitForTimeout(300);
  const evidence = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="stage-canvas"]');
    const rect = canvas.getBoundingClientRect();
    return {
      url: location.href,
      resources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /assets\/(index|phaser|atlas)/.test(name)),
      canvas: { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    };
  });
  if (errors.length || evidence.overflow) throw new Error(JSON.stringify({ errors, evidence }));
  await page.screenshot({ path: resolve(out, `${label}-phone-360.png`), fullPage: true });
  writeFileSync(resolve(out, `${label}-evidence.json`), JSON.stringify({ ...evidence, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ ...evidence, errors }, null, 2));
} finally {
  await browser.close();
}
