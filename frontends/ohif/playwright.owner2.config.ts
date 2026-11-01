import { chromium, defineConfig } from '@playwright/test';
import baseline from './playwright.config';

// Focused verification against a separately started development server.
// The shared e2e config and its screenshot baselines stay unchanged.
export default defineConfig({
  ...baseline,
  testMatch: 'Owner2SEGRoundTrip.spec.ts',
  globalSetup: undefined,
  webServer: undefined,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  globalTimeout: 240_000,
  outputDir: './tests/test-results/owner2-seg',
  reporter: [['list'], ['json', { outputFile: './tests/test-results/owner2-seg-results.json' }]],
  use: {
    ...baseline.use,
    baseURL: process.env.OWNER2_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    video: 'off',
    launchOptions: {
      executablePath: chromium.executablePath(),
      // Software WebGL is for reproducible headless verification, not a
      // performance benchmark or a change to the application configuration.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
});
