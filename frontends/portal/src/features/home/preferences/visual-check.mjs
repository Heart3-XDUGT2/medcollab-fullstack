import { chromium, expect, selectors } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const portal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const out = process.env.PREFERENCE_SCREENSHOTS || path.join(portal, '.runtime/ui-screens/preferences/round-1');
const base = process.env.PORTAL_E2E_BASE_URL || 'http://127.0.0.1:5189';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
selectors.setTestIdAttribute('data-cy');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const errors = [], captures = [];
for (const width of [1440, 768, 390]) {
  for (const state of ['default', 'changed', 'recovered', 'unavailable']) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, reducedMotion: 'reduce' });
    if (state === 'unavailable') await context.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${width}/${state}: ${error.message}`));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method()) || new URL(request.url()).pathname.startsWith('/api/')) errors.push(`${width}/${state}: unexpected business request`); });
    await page.goto(new URL('/src/features/home/preferences/fixture.html', base).href);
    await expect(page.getByTestId('fixture-persistence')).toHaveText(state === 'unavailable' ? 'unavailable' : 'local');
    await page.getByRole('button', { name: '显示设置', exact: true }).click();
    let panel = page.getByTestId('home-display-preferences-panel');
    if (state === 'changed' || state === 'recovered') {
      await panel.getByRole('radio', { name: '资料清单', exact: true }).check();
      await panel.getByRole('radio', { name: '紧凑', exact: true }).check();
      await panel.getByLabel('资料分组').selectOption('source');
      await panel.getByRole('checkbox', { name: '创建者', exact: true }).uncheck();
    }
    if (state === 'recovered') {
      await page.evaluate(() => { const key = Object.keys(localStorage).find(key => key.startsWith('medcollab.home.display.v1.')); localStorage.setItem(key, '{"version":0}'); });
      await page.reload();
      await expect(page.getByTestId('fixture-persistence')).toHaveText('recovered');
      await page.getByRole('button', { name: '显示设置', exact: true }).click();
      panel = page.getByTestId('home-display-preferences-panel');
    }
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    const measurements = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        outside: rect.left < 0 || rect.right > innerWidth + 1 || rect.top < 0 || rect.bottom > innerHeight + 1,
        undersized: [...element.querySelectorAll('legend,label,select,p,footer')].filter(node => parseFloat(getComputedStyle(node).fontSize) < 12).length,
      };
    });
    if (measurements.overflow || measurements.outside || measurements.undersized) errors.push(`${width}/${state}: ${JSON.stringify(measurements)}`);
    const filename = `${width}-${state}.png`;
    await page.screenshot({ path: path.join(out, filename), fullPage: false });
    captures.push({ width, state, filename, measurements });
    await context.close();
  }
}
await browser.close();
await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify({ isolatedComponentFixture: true, productionHomeIntegration: false, captures, errors }, null, 2));
console.log(JSON.stringify({ out, captures: captures.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
