import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { runtime, evidence, origin } from './tests/medcollab-e2e-env';
export default defineConfig({
  testDir: './tests',
  testMatch: 'MedCollabServer.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 240000,
  outputDir: path.join(runtime, 'playwright-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(evidence, 'e2e-results.json') }],
  ],
  use: {
    baseURL: origin,
    viewport: { width: 1600, height: 1000 },
    testIdAttribute: 'data-cy',
    actionTimeout: 30000,
    launchOptions: {
      executablePath: process.env.MEDCOLLAB_E2E_BROWSER_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
  },
});
