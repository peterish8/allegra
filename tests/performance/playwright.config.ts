import { defineConfig } from '@playwright/test';

const baseURL = process.env.PERF_BASE_URL?.replace(/\/+$/, '') ?? 'http://127.0.0.1:5175';

export default defineConfig({
  testDir: '.',
  testMatch: /search-to-play\.web\.spec\.ts/,
  outputDir: '../../output/performance/search-to-play/playwright-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 860 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
