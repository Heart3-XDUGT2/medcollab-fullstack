import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'portal-live.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 180000,
  reporter: [['list']],
  outputDir: '../../.runtime/live-integration/test-results',
  use: {
    testIdAttribute: 'data-cy',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
});
