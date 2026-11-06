import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';
import { sparseDeskFixture } from './helpers/sparse-desk-fixture';

async function iconGeometry(button: Locator) {
  return button.evaluate(element => {
    const box = element.getBoundingClientRect(), svg = element.querySelector('svg')!.getBoundingClientRect();
    return { x: svg.x + svg.width / 2 - box.x - box.width / 2, y: svg.y + svg.height / 2 - box.y - box.height / 2,
      width: box.width, height: box.height, svgWidth: svg.width, svgHeight: svg.height };
  });
}
async function capture(page: Page, name: string) {
  if (process.env.SPARSE_SCREENSHOTS !== '1') return;
  const directory = path.resolve('.runtime/sparse-desk', process.env.SPARSE_ROUND || 'first');
  await fs.mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' });
}

test('reported disabled star stays geometrically centered in its full hit target', async ({ page }) => {
  await page.setViewportSize({ width: 1904, height: 952 });
  await sparseDeskFixture(page);
  await page.goto('/home?view=work');
  const star = page.getByTestId('home-favorite');
  await expect(star).toBeDisabled();
  const geometry = await iconGeometry(star);
  expect(Math.abs(geometry.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geometry.y)).toBeLessThanOrEqual(0.5);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.svgWidth).toBeLessThan(geometry.width);
  await expect(page.getByTestId('work-module-favorites')).toContainText('当前服务未提供收藏功能');
  await capture(page, '1904-reported-legacy');
  if (process.env.SPARSE_SCREENSHOTS === '1') {
    const directory = path.resolve('.runtime/sparse-desk', process.env.SPARSE_ROUND || 'first');
    await fs.writeFile(path.join(directory, 'reported-geometry.json'), JSON.stringify({
      icon: geometry,
      card: await page.locator('.mc-resource-card').boundingBox(),
      main: await page.locator('.mc-work-primary').boundingBox(),
      frame: await page.locator('.mc-library-main').boundingBox(),
    }, null, 2));
  }
});

test('one card does not occupy only one of three phantom slots on a wide working frame', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1032 });
  await sparseDeskFixture(page);
  await page.goto('/home?view=work');
  await expect(page.locator('.mc-resource-card')).toHaveCount(1);
  const card = await page.locator('.mc-resource-card').boundingBox();
  const main = await page.locator('.mc-work-primary').boundingBox();
  const frame = await page.locator('.mc-library-main').boundingBox();
  expect(card!.width / main!.width).toBeGreaterThanOrEqual(0.5);
  expect(card!.height).toBeLessThan(260);
  expect(frame!.width).toBeGreaterThan(1440);
  await expect(page.getByTestId('home-dataset-select')).toContainText('bone');
});

for (const width of [1920, 1440, 768, 390]) {
  for (const count of [0, 1, 2, 12]) {
    test(`sparse cards ${count} objects retain honest data and layout at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1032 });
      await page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const fixture = await sparseDeskFixture(page, { count });
      await page.goto('/home?view=work');
      await expect(page.getByTestId('home-dataset-row')).toHaveCount(Math.min(count, 6));
      await expect(page.getByTestId('work-module-favorites')).toContainText('当前服务未提供收藏功能');
      await expect(page.getByTestId('work-module-recent')).toContainText('当前服务未提供最近打开功能');
      await expect(page.getByTestId('work-module-recent').getByRole('button', { name: '重新读取', exact: true })).toHaveCount(0);
      expect(fixture.calls.some(call => call.includes('/api/me/'))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (count) {
        await expect(page.getByTestId('dataset-coverage').first()).toHaveAttribute('data-status', 'unsupported');
        const star = page.getByTestId('home-favorite').first();
        await expect(star).toBeDisabled();
        const geometry = await iconGeometry(star);
        expect(Math.abs(geometry.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(geometry.y)).toBeLessThanOrEqual(0.5);
        const tracks = await page.locator('.mc-resource-card-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
        expect(tracks).toBe(width <= 640 ? 1 : Math.min(count, width <= 1000 ? 2 : 3));
      } else await expect(page.getByTestId('dataset-coverage')).toHaveCount(0);
      await capture(page, `${width}-cards-${count}`);
      expect(errors).toEqual([]);
    });
  }
  test(`confirmed star and keyboard detail remain stable with long names at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1032 });
    await page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
    const fixture = await sparseDeskFixture(page, { supported: true, longName: true });
    await page.goto('/home?view=work');
    const star = page.getByTestId('home-favorite');
    await expect(star).toBeEnabled();
    const before = await iconGeometry(star);
    await star.hover();
    await star.focus();
    expect(await iconGeometry(star)).toEqual(before);
    await page.keyboard.press('Enter');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(star).toBeEnabled();
    expect(fixture.calls.filter(call => call.startsWith('PUT '))).toEqual(['PUT /api/me/favorite-datasets/sparse-0']);
    await capture(page, `${width}-confirmed-long`);
    const name = page.getByTestId('home-dataset-select');
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('home-detail')).toBeVisible();
    await capture(page, `${width}-detail-long`);
    if (width <= 1200) await page.getByTestId('home-detail').getByRole('button', { name: '关闭', exact: true }).click();
    else await page.getByRole('button', { name: '关闭资料概览', exact: true }).click();
    await expect(name).toBeFocused();
    await page.getByTestId('home-dataset-more').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await capture(page, `${width}-menu`);
    await page.keyboard.press('Escape');
    await page.getByTestId('work-search').focus();
    expect(await page.getByTestId('work-search').evaluate(element => element.closest('.mc-desk-search')!.getBoundingClientRect().width)).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
