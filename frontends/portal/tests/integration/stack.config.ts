import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../../../tests/integration',
  testMatch: 'portal-stack.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 600000,
  outputDir: '../../../../.runtime/integration/portal-results',
  reporter: [['list']],
  use: {
    testIdAttribute: 'data-cy',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
});
