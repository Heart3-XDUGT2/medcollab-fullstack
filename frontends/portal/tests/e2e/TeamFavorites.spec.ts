import { expect, test } from './fixtures';
import { teamFavoriteFixture } from './helpers/team-favorite-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

async function capture(page: Page, name: string) {
  if (process.env.TEAM_SCREENSHOTS !== '1') return;
  const directory = path.resolve('.runtime/team-favorites', process.env.TEAM_ROUND || 'first');
  await fs.mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' });
}

test('team dataset favorite uses the real shared API and returns a team summary on home', async ({ page }) => {
  const fixture = await teamFavoriteFixture(page);
  await page.goto('/teams?team=TM-A');
  const star = page.getByTestId('team-favorite');
  await expect(star).toBeEnabled();
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  expect(fixture.calls.filter(call => call.method === 'PUT').map(call => call.path)).toEqual(['/api/me/favorite-datasets/team-dataset-0']);
  await page.locator('.mc-top-primary').getByRole('link', { name: '工作首页', exact: true }).click();
  const record = page.getByTestId('work-favorite-record');
  await expect(record).toContainText(fixture.data[0].name);
  await expect(record).toContainText(fixture.teams[0].name);
  await record.getByTestId('work-favorite-detail').click();
  await expect(page).toHaveURL(/\/teams\?team=TM-A/);
  await expect(page.getByTestId('team-favorite')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('team-favorite').click();
  await expect(page.getByTestId('team-favorite')).toHaveAttribute('aria-pressed', 'false');
  expect(fixture.calls.filter(call => call.method === 'DELETE').map(call => call.path)).toEqual(['/api/me/favorite-datasets/team-dataset-0']);
});

test('team-source entry selects one independent library without scanning all teams', async ({ page }) => {
  const fixture = await teamFavoriteFixture(page);
  await page.goto('/home?view=library&scope=owner');
  await page.getByTestId('home-search').fill('独立副本');
  await page.getByTestId('home-team-source').click();
  await expect(page.getByTestId('home-team-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home-team-source')).toBeFocused();
  await page.getByTestId('home-team-source').click();
  expect(fixture.calls.some(call => /\/teams\/.+\/datasets/.test(call.path))).toBe(false);
  await page.getByTestId('home-team-picker').getByRole('link', { name: new RegExp(fixture.teams[0].name) }).click();
  await expect(page).toHaveURL(/\/teams\?team=TM-A/);
  await expect(page.getByTestId('team-favorite')).toBeVisible();
  expect(fixture.calls.filter(call => /\/teams\/.+\/datasets/.test(call.path)).map(call => call.path)).toEqual(['/api/teams/TM-A/datasets']);
  await page.goBack();
  await expect(page.getByTestId('home-search')).toHaveValue('独立副本');
  expect(fixture.calls.some(call => call.method === 'POST')).toBe(false);
});

test('switching teams cancels a waiting fresh favorite write before it can be sent', async ({ page }) => {
  const fixture = await teamFavoriteFixture(page);
  await page.goto('/teams?team=TM-A');
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  fixture.holdSessions();
  const reads = fixture.calls.filter(call => call.path === '/api/session').length;
  await page.getByTestId('team-favorite').click();
  await expect.poll(() => fixture.calls.filter(call => call.path === '/api/session').length).toBeGreaterThan(reads);
  await page.getByRole('button', { name: '我的团队', exact: true }).click();
  await page.locator('.mc-team-list-row').filter({ hasText: 'TM-B' }).click();
  fixture.releaseSessions();
  await expect(page.getByRole('heading', { name: '第二研究组', exact: true })).toBeVisible();
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  expect(fixture.calls.filter(call => call.method === 'PUT')).toEqual([]);
});

test('account change rejects the old team favorite without any PUT', async ({ page }) => {
  const fixture = await teamFavoriteFixture(page);
  await page.goto('/teams?team=TM-A');
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  fixture.changeAccount();
  await page.getByTestId('team-favorite').click();
  await expect(page.locator('.mc-team-data-row')).toHaveCount(0);
  await expect(page.locator('.mc-team-error')).toContainText('会话或访问权限已变化');
  expect(fixture.calls.filter(call => call.method === 'PUT')).toEqual([]);
});

for (const state of ['missing', 'failed'] as const) test(`unconfirmed ${state} states never render a writable false favorite`, async ({ page }) => {
  const fixture = await teamFavoriteFixture(page, { missingStates: state === 'missing', failedStates: state === 'failed' });
  await page.goto('/teams?team=TM-A');
  await expect(page.getByTestId('team-favorite-status')).toBeVisible();
  await expect(page.getByTestId('team-favorite')).toBeDisabled();
  await expect(page.getByTestId('team-favorite')).toHaveAttribute('aria-pressed', 'mixed');
  expect(fixture.calls.filter(call => call.method === 'PUT')).toEqual([]);
});

test('an unknown favorite outcome is not replayed and requires read verification', async ({ page }) => {
  const fixture = await teamFavoriteFixture(page, { unknownWrite: true });
  await page.goto('/teams?team=TM-A');
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  await page.getByTestId('team-favorite').click();
  await expect(page.getByTestId('team-favorite-status')).toContainText('不会自动重试写入');
  await expect(page.getByTestId('team-favorite')).toBeDisabled();
  await page.getByRole('button', { name: '重新核对收藏', exact: true }).click();
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  expect(fixture.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

test('membership loss reconciles the team and clears old writable rows', async ({ page }) => {
  const fixture = await teamFavoriteFixture(page);
  await page.goto('/teams?team=TM-A');
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  fixture.revoke();
  await page.getByTestId('team-favorite').click();
  await expect(page.locator('.mc-team-data-row')).toHaveCount(0);
  await expect(page.locator('.mc-team-error')).toContainText('失去成员资格');
  expect(fixture.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

test('late T1 states cannot enable T2 while the new team or its states are still loading', async ({ page }) => {
  const fixture = await teamFavoriteFixture(page);
  await page.goto('/teams?team=TM-A');
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  fixture.favorites.add('team-dataset-0');
  fixture.holdStates('team-dataset-0');
  const oldReads = fixture.calls.filter(call => call.path === '/api/me/favorite-datasets/state').length;
  await page.getByRole('button', { name: '刷新团队资料', exact: true }).click();
  await expect.poll(() => fixture.calls.filter(call => call.path === '/api/me/favorite-datasets/state').length).toBeGreaterThan(oldReads);
  await expect(page.getByTestId('team-favorite')).toBeDisabled();
  fixture.holdTeamB();
  fixture.holdStates('team-dataset-1');
  await page.getByRole('button', { name: '我的团队', exact: true }).click();
  await page.locator('.mc-team-list-row').filter({ hasText: 'TM-B' }).click();
  fixture.releaseStates('team-dataset-0');
  await expect(page.locator('.mc-team-data-row')).toHaveCount(0);
  await expect(page.getByTestId('team-favorite')).toHaveCount(0);
  fixture.releaseTeamB();
  await expect(page.getByRole('heading', { name: '第二研究组', exact: true })).toBeVisible();
  await expect(page.getByTestId('team-favorite')).toBeDisabled();
  await expect(page.getByTestId('team-favorite')).toHaveAttribute('aria-pressed', 'mixed');
  fixture.releaseStates('team-dataset-1');
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  await expect(page.getByTestId('team-favorite')).toHaveAttribute('aria-pressed', 'false');
  expect(fixture.calls.filter(call => call.method === 'PUT')).toEqual([]);
});

for (const status of [401, 403] as const) test(`favorite ${status} clears the team scope without retry`, async ({ page }) => {
  const fixture = await teamFavoriteFixture(page, { blockedWrite: status });
  await page.goto('/teams?team=TM-A');
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  await page.getByTestId('team-favorite').click();
  await expect(page.locator('.mc-team-data-row')).toHaveCount(0);
  await expect(page.getByTestId('team-favorite')).toHaveCount(0);
  expect(fixture.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
});

for (const mode of ['personal', 'team'] as const) test(`${mode} mixed TXT batch is rejected before create or import, extensionless candidates remain selectable`, async ({ page }) => {
  const fixture = await teamFavoriteFixture(page);
  await page.goto(mode === 'team' ? '/teams?team=TM-A' : '/home?view=work');
  if (mode === 'team') await page.getByRole('button', { name: '上传', exact: true }).click();
  else await page.getByTestId('home-upload').click();
  await page.getByTestId('home-upload-name').fill('格式验证');
  const input = page.getByTestId('home-upload-files');
  expect(await input.getAttribute('accept')).toBeNull();
  await input.setInputFiles([
    { name: 'candidate.dcm', mimeType: 'application/dicom', buffer: Buffer.from('synthetic candidate') },
    { name: 'notes.TXT', mimeType: 'text/plain', buffer: Buffer.from('synthetic unsupported text') },
  ]);
  await expect(page.getByTestId('home-upload-start')).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: 'notes.TXT' })).toBeVisible();
  await page.getByTestId('home-upload-name').press('Enter');
  expect(fixture.calls.filter(call => call.method === 'POST')).toEqual([]);
  await input.setInputFiles({ name: 'DICOMDIR', mimeType: 'image/x-dicom', buffer: Buffer.from('candidate delegated to content validation') });
  await expect(page.getByTestId('home-upload-start')).toBeEnabled();
});

for (const width of [1920, 1440, 768, 390]) test(`team favorite, source picker and empty/error states remain usable at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1032 });
  await page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
  const fixture = await teamFavoriteFixture(page, { emptyTeamB: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/teams?team=TM-A');
  const star = page.getByTestId('team-favorite');
  await expect(star).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const geometry = await star.evaluate(element => {
    const button = element.getBoundingClientRect(), svg = element.querySelector('svg')!.getBoundingClientRect();
    return { x: svg.x + svg.width / 2 - button.x - button.width / 2, y: svg.y + svg.height / 2 - button.y - button.height / 2, width: button.width, height: button.height };
  });
  expect(Math.abs(geometry.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geometry.y)).toBeLessThanOrEqual(0.5);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  await capture(page, `${width}-team-ready`);
  await star.focus();
  await page.keyboard.press('Space');
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(star).toBeEnabled();
  await capture(page, `${width}-team-favorited`);
  const menu = page.getByRole('button', { name: `${fixture.data[0].name} 数据集操作`, exact: true });
  await menu.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '删除数据集', exact: true })).toHaveCount(0);
  await capture(page, `${width}-team-menu`);
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await page.locator('.mc-top-primary').getByRole('link', { name: '完整资料库', exact: true }).click();
  await page.getByTestId('home-team-source').click();
  await expect(page.getByTestId('home-team-picker').getByRole('link', { name: new RegExp(fixture.teams[0].name) })).toBeVisible();
  await capture(page, `${width}-team-source`);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home-team-source')).toBeFocused();
  await page.goto('/teams?team=TM-B');
  await expect(page.getByRole('heading', { name: '团队还没有数据集', exact: true })).toBeVisible();
  await expect(page.getByTestId('team-favorite')).toHaveCount(0);
  await capture(page, `${width}-team-empty`);
  await page.goto('/teams?team=TM-A');
  await expect(star).toBeEnabled();
  fixture.failStates();
  await page.getByRole('button', { name: '刷新团队资料', exact: true }).click();
  await expect(page.getByTestId('team-favorite-status')).toContainText('收藏状态');
  await expect(star).toBeDisabled();
  await capture(page, `${width}-team-state-error`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
