import { createHash } from 'node:crypto';
import { expect, test } from './fixtures';
import { approvedAFixture, fidelityIdentity } from './helpers/approved-a-fixture';
import { DEFAULT_HOME_PREFERENCES } from '../../src/features/home/preferences/model';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

async function capture(page: Page, name: string) {
  if (process.env.DESK_SCREENSHOTS !== '1') return;
  const directory = path.resolve('.runtime/a-fidelity', process.env.DESK_ROUND || 'first');
  await fs.mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' });
}

for (const width of [1440, 768, 390]) test(`approved A same-data proportions remain close to the selected reference at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
  await page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
  await approvedAFixture(page);
  await page.goto('/home?view=work');
  await expect(page.getByTestId('work-continue-target').getByTestId('dataset-coverage')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(() => document.fonts.ready);
  const panel = await page.getByTestId('work-module-continue').boundingBox();
  const library = await page.getByTestId('work-module-library').boundingBox();
  if (width === 1440) {
    expect(Math.abs(panel!.height - 238.78)).toBeLessThanOrEqual(18);
    expect(Math.abs(library!.y - 474.28)).toBeLessThanOrEqual(22);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await capture(page, `${width}-same-A-data`);
  if (process.env.DESK_SCREENSHOTS === '1' && width === 1440) {
    const directory = path.resolve('.runtime/a-fidelity', process.env.DESK_ROUND || 'first');
    await fs.writeFile(path.join(directory, 'same-data-metrics.json'), JSON.stringify({
      reference: { continuationHeight: 238.78, libraryTop: 474.28 },
      actual: { continuationHeight: panel!.height, libraryTop: library!.y, mainWidth: library!.width },
    }, null, 2));
  }
  await expect(page.getByTestId('work-continue-target')).toContainText('未恢复序列、视角或本机草稿');
  await expect(page.getByTestId('work-continue-select')).toBeEnabled();
});

test('A list is the fresh default while saved card and comparison choices stay available', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await approvedAFixture(page);
  await page.goto('/home?view=work');
  const library = page.getByTestId('work-module-library');
  await expect(library.getByRole('button', { name: '资料清单', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('medcollab-home')).toHaveAttribute('data-layout', 'rows');
  await library.getByRole('button', { name: '资料索引', exact: true }).click();
  await expect(library.locator('.mc-resource-card')).toHaveCount(6);
  await capture(page, '1440-mode-cards');
  await library.getByRole('button', { name: '对比表格', exact: true }).click();
  await expect(library.locator('table')).toHaveCount(1);
  await expect(page.getByTestId('medcollab-home')).toHaveAttribute('data-layout', 'list');
  await capture(page, '1440-mode-comparison');
});

for (const width of [1440, 768, 390]) test(`old order and hidden modules keep both A lanes without clearing saved choices at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
  await approvedAFixture(page);
  const key = 'medcollab.home.display.v1.' + createHash('sha256').update(JSON.stringify(['medcollab-display-v1', fidelityIdentity.issuer, fidelityIdentity.subject])).digest('hex');
  const raw = JSON.stringify({ version: 1, preferences: { ...DEFAULT_HOME_PREFERENCES, layout: 'cards', home: { defaultEntry: 'work', order: ['library', 'continue', 'favorites', 'recent', 'teams'], hidden: ['teams'] } } });
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
  await page.goto('/home?view=work');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(6);
  const library = await page.getByTestId('work-module-library').boundingBox();
  const continuation = await page.getByTestId('work-module-continue').boundingBox();
  const favorite = await page.getByTestId('work-module-favorites').boundingBox();
  const recent = await page.getByTestId('work-module-recent').boundingBox();
  if (width === 1440) {
    expect(library!.width).toBeCloseTo(990, 0);
    expect(favorite!.x).toBeGreaterThan(library!.x + library!.width);
  } else if (width === 768) {
    expect(library!.width).toBeCloseTo(720, 0);
    expect(favorite!.x).toBeGreaterThan(continuation!.x + continuation!.width);
  } else {
    expect(favorite!.y).toBeGreaterThan(continuation!.y + continuation!.height);
  }
  expect(library!.y).toBeLessThan(continuation!.y);
  expect(favorite!.y).toBeLessThan(recent!.y);
  await expect(page.getByTestId('work-module-teams')).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await capture(page, `${width}-old-order-hidden-card`);
  await page.getByTestId('work-home-settings').click();
  await page.getByRole('button', { name: '下移我的收藏', exact: true }).click();
  await page.keyboard.press('Escape');
  const reorderedRecent = await page.getByTestId('work-module-recent').boundingBox();
  const reorderedFavorite = await page.getByTestId('work-module-favorites').boundingBox();
  expect(reorderedRecent!.y).toBeLessThan(reorderedFavorite!.y);
});

test('all-reference hiding expands available main content without inventing or clearing modules', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await approvedAFixture(page);
  await page.goto('/home?view=work');
  await page.getByTestId('work-home-settings').click();
  for (const name of ['继续工作', '资料库入口'])
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mc-work-primary')).toHaveCount(0);
  await expect(page.locator('.mc-work-reference > section')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByTestId('work-home-settings').click();
  for (const name of ['继续工作', '资料库入口'])
    await page.getByRole('checkbox', { name, exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByTestId('work-home-settings').click();
  for (const name of ['最近打开', '我的收藏', '我的团队'])
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
  await page.keyboard.press('Escape');
  expect((await page.getByTestId('work-module-library').boundingBox())!.width).toBeCloseTo(1352, 0);
  await expect(page.locator('.mc-work-reference')).toHaveCount(0);
  await page.getByTestId('work-home-settings').click();
  for (const name of ['继续工作', '资料库入口'])
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('work-home')).toContainText('首页内容已全部隐藏');
  await expect(page.getByTestId('home-entry-library')).toBeVisible();
});

test('NIfTI selection reports unsupported format immediately without a create or import', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const fixture = await approvedAFixture(page);
  await page.goto('/home?view=work');
  await page.getByTestId('home-upload').click();
  await page.getByTestId('home-upload-name').fill('格式验证');
  await page.getByTestId('home-upload-files').setInputFiles({ name: 'specimen.NII.GZ', mimeType: 'application/gzip', buffer: Buffer.from('synthetic file metadata check') });
  await expect(page.getByTestId('home-action-dialog')).toContainText('NIfTI）暂不支持导入');
  await expect(page.getByTestId('home-upload-start')).toBeDisabled();
  await capture(page, '1440-nifti-rejected');
  expect(fixture.calls.every(call => call.startsWith('GET '))).toBe(true);
});
