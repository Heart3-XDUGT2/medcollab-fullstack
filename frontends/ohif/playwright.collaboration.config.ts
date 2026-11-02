import { defineConfig } from '@playwright/test';
import path from 'node:path';
const runtime = process.env.MEDCOLLAB_E2E_RUNTIME;
if (!runtime) throw new Error('Set MEDCOLLAB_E2E_RUNTIME to an isolated prepared QA runtime.');
export default defineConfig({
  testDir: './tests',
  testMatch: 'MedCollabRealtime.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 240000,
  outputDir: path.join(runtime, 'playwright-results'),
  reporter: [['list'], ['json', { outputFile: path.join(runtime, 'e2e-results.json') }]],
  use: {
    viewport: { width: 1600, height: 1000 },
    testIdAttribute: 'data-cy',
    actionTimeout: 30000,
    launchOptions: {
      executablePath: process.env.MEDCOLLAB_E2E_BROWSER_PATH,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
});
