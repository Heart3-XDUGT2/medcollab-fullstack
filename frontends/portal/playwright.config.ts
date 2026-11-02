import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.PORTAL_E2E_BASE_URL || 'http://127.0.0.1:5173',
    testIdAttribute: 'data-cy',
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
});
