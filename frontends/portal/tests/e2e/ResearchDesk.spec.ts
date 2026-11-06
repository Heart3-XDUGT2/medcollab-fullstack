import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { motionFixture } from './helpers/motion-fixture';

const directory = path.resolve('.runtime/research-desk-integration', process.env.DESK_ROUND || 'first');
async function capture(page: Page, name: string, fullPage = false) {
  if (process.env.DESK_SCREENSHOTS !== '1') return;
  await fs.mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage, animations: 'disabled' });
}

for (const width of [1440, 768, 390]) {
  test(`research desk uses authorized models, keeps controls and honest states at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = await motionFixture(page);
    await page.goto('/home?view=work');
    const current = page.getByTestId('work-continue-target');
    await expect(current.getByTestId('dataset-coverage')).toHaveAttribute('data-status', 'ready');
    await expect(current).toContainText('跨中心腹部影像一致性研究');
    await expect(page.getByTestId('work-module-continue')).toContainText('上次访问');
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await capture(page, `${width}-home`);
    await capture(page, `${width}-home-full`, true);
    const summary = current.getByTestId('coverage-summary');
    await summary.focus();
    await page.keyboard.press('Space');
    await expect(summary.locator('..')).toHaveAttribute('open', '');
    await expect(summary.locator('..')).toContainText('不代表医学质量或审核结论');
    await page.keyboard.press('Space');
    await page.getByTestId('work-continue-detail').click();
    await expect(page.getByTestId('home-detail')).toBeVisible();
    await capture(page, `${width}-detail`);
    if (width <= 1200) await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: '关闭资料概览', exact: true }).click();
    await page.getByTestId('home-dataset-more').first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await capture(page, `${width}-menu`);
    await page.keyboard.press('Escape');
    await page.getByTestId('work-search').fill('004');
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(1);
    await page.getByTestId('home-entry-library').click();
    await expect(page.getByTestId('home-search')).toHaveValue('');
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(12);
    await capture(page, `${width}-library`);
    const selectedReads = fixture.calls.filter(call => call.path === '/api/datasets/motion-3/annotation-stats');
    expect(selectedReads).toHaveLength(1);
    expect(fixture.calls.every(call => call.method === 'GET')).toBe(true);
    const empty = await motionFixture(page, { count: 0 });
    await page.goto('/home?view=work');
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(0);
    await expect(page.getByTestId('work-module-continue')).not.toContainText('上次访问');
    await expect(page.getByTestId('dataset-coverage')).toHaveCount(0);
    await capture(page, `${width}-empty`);
    expect(empty.calls.every(call => call.method === 'GET')).toBe(true);
    const failed = await motionFixture(page, { failed: true });
    await page.reload();
    await expect(page.getByTestId('work-module-recent')).toContainText('最近记录暂时无法读取');
    await expect(page.getByTestId('work-module-favorites')).toContainText('收藏暂时无法读取');
    await capture(page, `${width}-error`);
    expect(failed.calls.every(call => call.method === 'GET')).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('work-directory query returns from teams in memory without replacing the library query', async ({ page }) => {
  await motionFixture(page);
  await page.goto('/home?view=library&scope=owner');
  await page.getByTestId('home-search').fill('unrelated-library-query');
  await page.getByTestId('home-entry-work').click();
  await page.getByTestId('work-search').fill('004');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(1);
  await page.locator('.mc-top-primary').getByRole('link', { name: '团队影像库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的团队', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('work-search')).toHaveValue('004');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(1);
  expect(page.url()).not.toContain('004');
  await page.getByTestId('home-entry-library').click();
  await expect(page.getByTestId('home-search')).toHaveValue('unrelated-library-query');
});
