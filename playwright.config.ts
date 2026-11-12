import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4175/dundung/';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone-320',
      use: { ...devices['iPhone 13 mini'], browserName: 'chromium', viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'phone-360',
      use: { ...devices['iPhone 13 mini'], browserName: 'chromium', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'phone-390',
      use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'landscape-740',
      use: { ...devices['iPhone 13 mini'], browserName: 'chromium', viewport: { width: 740, height: 360 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'tablet-768',
      use: { ...devices['iPad Mini'], browserName: 'chromium', viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4175 --strictPort',
    url: baseURL,
    env: {
      GITHUB_REPOSITORY: 'rom-bar/dundung',
      VITE_E2E: 'true',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
