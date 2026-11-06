import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HomePageObject } from './pages/HomePageObject';
import { SignInPageObject } from './pages/SignInPageObject';
import { readFile } from 'node:fs/promises';

type PageObjects = {
  homePageObject: HomePageObject;
  signInPageObject: SignInPageObject;
};

export const test = base.extend<PageObjects>({
  page: async ({ page }, use) => {
    await page.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method())
      ? route.fallback()
      : route.abort('blockedbyclient'));
    await page.route('**/config.js', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.config = { medcollab: { apiEnabled: false } };',
    }));
    // Tests may target the running gateway; unmatched API traffic must never reach it.
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      json: { error: 'Unmocked API request blocked by browser test fixture' },
    }));
    await page.route(/\/(?:auth|realms|login-actions|oauth2)(?:\/|\?|$)/, route => route.fulfill({
      status: 503, contentType: 'text/plain', body: 'Real authentication disabled by frontend test fixture',
    }));
    if (process.env.PORTAL_E2E_GATEWAY === '1') {
      // The live gateway redirects these paths to SSO. Preview tests exercise only the built SPA.
      await page.route(/\/(?:account\/sign-in|sign-in)(?:\?|$)/, async route => {
        await route.fulfill({
          contentType: 'text/html',
          body: await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8'),
        });
      });
    }
    await use(page);
  },
  homePageObject: async ({ page }, use) => {
    await use(new HomePageObject(page));
  },
  signInPageObject: async ({ page }, use) => {
    await use(new SignInPageObject(page));
  },
});

export { expect };

export async function addPortalConfiguration(page: Page, config: Record<string, unknown>) {
  await page.route('**/config.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.config = ${JSON.stringify(config)};`,
    });
  });
}
