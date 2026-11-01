import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HomePageObject } from './pages/HomePageObject';
import { SignInPageObject } from './pages/SignInPageObject';

type PageObjects = {
  homePageObject: HomePageObject;
  signInPageObject: SignInPageObject;
};

export const test = base.extend<PageObjects>({
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
