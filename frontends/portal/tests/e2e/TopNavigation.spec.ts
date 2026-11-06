import type { Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { addPortalConfiguration, expect, test } from './fixtures';

async function fixture(page: Page, count = 30, populated = false) {
  const calls: string[] = [];
  const favoriteIds = new Set(populated ? ['top-0'] : []);
  let recentIds = populated ? ['top-1'] : [];
  let generation = '11111111-1111-4111-8111-111111111111';
  const at = '2026-11-04T12:00:00Z';
  await addPortalConfiguration(page, {
    medcollab: {
      apiEnabled: true,
      authOrigin: 'http://127.0.0.1:60833',
      logoutOrigins: [],
      workspacePath: null,
    },
  });
  await page.route('**/api/**', (route) => {
    const request = route.request(),
      pathname = new URL(request.url()).pathname;
    calls.push(`${request.method()} ${pathname}`);
    const values = Array.from({ length: count }, (_, index) => ({
      id: `top-${index}`,
      name: `合成研究数据集 · ${String(index + 1).padStart(3, '0')}`,
      access: ['owner', 'shared', 'public'][index % 3],
      ownerUsername: '合成研究账号',
      instanceCount: 100,
      createdAt: '2026-11-01T00:00:00Z',
    }));
    const summary = (id: string) => ({
      ...values.find(value => value.id === id), scope: 'personal', teamId: null, teamName: null,
    });
    const favorite = pathname.match(/^\/api\/me\/favorite-datasets\/(top-\d+)$/);
    if (favorite && ['PUT', 'DELETE'].includes(request.method())) {
      expect(request.headers()['x-fixture-csrf']).toBe('fixture-not-secret');
      const id = favorite[1], favorited = request.method() === 'PUT';
      if (favorited) favoriteIds.add(id); else favoriteIds.delete(id);
      return route.fulfill({ json: { success: true, datasetId: id, favorited, favoritedAt: favorited ? at : null } });
    }
    if (pathname === '/api/me/recent-datasets' && request.method() === 'DELETE') {
      expect(request.headers()['x-fixture-csrf']).toBe('fixture-not-secret');
      recentIds = []; generation = '22222222-2222-4222-8222-222222222222';
      return route.fulfill({ json: { success: true, generation } });
    }
    if (pathname === '/api/me/favorite-datasets')
      return route.fulfill({ json: { items: [...favoriteIds].map(id => ({ dataset: summary(id), favoritedAt: at })), total: favoriteIds.size, page: 0, size: 20 } });
    if (pathname === '/api/me/favorite-datasets/state')
      return route.fulfill({ json: { items: values.map(value => ({ datasetId: value.id, favorited: favoriteIds.has(value.id), favoritedAt: favoriteIds.has(value.id) ? at : null })), total: values.length } });
    if (pathname === '/api/me/recent-datasets')
      return route.fulfill({ json: { items: recentIds.map(id => ({ dataset: summary(id), lastOpenedAt: at })), total: recentIds.length, page: 0, size: 20, generation, retentionDays: 90, maxItems: 100 } });
    const body =
      pathname === '/api/session'
        ? {
            loggedIn: true,
            username: '合成研究账号',
            issuer: 'https://top-fixture.example.test',
            subject: 'top-account',
            csrfToken: 'fixture-not-secret',
            csrfHeaderName: 'X-Fixture-CSRF',
          }
        : pathname === '/api/datasets'
          ? { items: values, total: values.length }
          : pathname === '/api/teams'
            ? { items: [], total: 0 }
            : pathname === '/api/health'
              ? { status: 'UP', homeActivityApi: 'v1' }
              : null;
    return route.fulfill({ status: body ? 200 : 404, json: body || {} });
  });
  return calls;
}
for (const width of [1440, 768, 390]) {
  test(`top navigation, right account and complete-source filtering remain operable at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    const calls = await fixture(page);
    await page.goto('/home');
    await expect(page.getByTestId('work-home')).toBeVisible();
    await expect(page.locator('.mc-shell-sidebar')).toHaveCount(0);
    await expect(page.locator('.mc-top-primary')).toBeVisible();
    await expect(page.locator('.mc-work-navigation')).toHaveCount(0);
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(6);
    const titleFits = await page
      .locator('h1')
      .evaluate(
        (node) =>
          node.getBoundingClientRect().height <= parseFloat(getComputedStyle(node).lineHeight) + 1
      );
    expect(titleFits).toBe(true);
    if (width === 1440) {
      const edges = await page.evaluate(() => ({
        bar: document.querySelector('.mc-scope-bar')!.getBoundingClientRect().right,
        datasets: document.querySelector('.mc-work-dataset-preview')!.getBoundingClientRect().right,
      }));
      expect(Math.abs(edges.bar - edges.datasets)).toBeLessThanOrEqual(1);
    }
    await expect(page.getByTestId('home-scope-all')).toContainText('30');
    for (const scope of ['owner', 'shared', 'public'])
      await expect(page.getByTestId(`home-scope-${scope}`)).toContainText('10');
    const account = await page.getByRole('button', { name: '账号菜单', exact: true }).boundingBox();
    expect(account && account.x > width / 2 && account.y < 64).toBeTruthy();
    await page.getByTestId('home-scope-shared').click();
    await expect(page.getByTestId('home-dataset-select')).toHaveCount(6);
    for (const row of await page.getByTestId('home-dataset-row').all())
      await expect(row).toContainText('与我共享');
    await expect(page.getByTestId('home-scope-all')).toContainText('30');
    await page.getByTestId('work-home-settings').click();
    await page
      .getByTestId('work-home-settings-panel')
      .getByRole('checkbox', { name: '资料库入口', exact: true })
      .uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('work-module-library')).toHaveCount(0);
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(0);
    expect(calls.every((call) => call.startsWith('GET '))).toBe(true);
    expect(calls.some((call) => /GET \/api\/me\/favorite-datasets/.test(call))).toBe(true);
    expect(calls.some((call) => /GET \/api\/me\/recent-datasets/.test(call))).toBe(true);
    expect(calls.some((call) => /labelmap|\/file$/.test(call))).toBe(false);
  });
}
test('empty account has real zero distribution and no fabricated dataset or coverage', async ({
  page,
}) => {
  await fixture(page, 0);
  await page.goto('/home');
  await expect(page.getByTestId('home-scope-all')).toContainText('0');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(0);
  const widths = await page
    .locator('.mc-scope-bar span')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.width));
  expect(widths).toEqual(['0%', '0%', '0%']);
  await expect(page.getByTestId('dataset-coverage')).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`merged top home retains real activity headers, preview stars and server mutations at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const calls = await fixture(page, 30, true);
    await page.goto('/home');
    const favorites = page.getByTestId('work-module-favorites');
    const recent = page.getByTestId('work-module-recent');
    await expect(favorites.getByRole('heading', { name: '我的收藏' })).toBeVisible();
    await expect(recent.getByRole('heading', { name: '最近打开' })).toBeVisible();
    await expect(favorites).not.toHaveClass(/is-unavailable/);
    await expect(recent).not.toHaveClass(/is-unavailable/);
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(1);
    await expect(page.getByTestId('work-recent-record')).toHaveCount(1);
    await expect(page.getByTestId('work-continue-target')).toContainText('合成研究数据集 · 002');
    const collection = page.getByTestId('work-module-library');
    await expect(collection.getByTestId('home-favorite')).toHaveCount(6);
    await expect(collection.getByRole('button', { name: '取消收藏 合成研究数据集 · 001', exact: true })).toBeEnabled();
    await page.evaluate(() => scrollTo(0, 0));
    if (process.env.MERGE_SCREENSHOTS === '1') {
      const directory = resolve('.runtime/merge-3c1fb5b/screenshots');
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `real-activity-${width}.png`), fullPage: true });
    }
    await collection.getByRole('button', { name: '收藏 合成研究数据集 · 003', exact: true }).click();
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(2);
    await expect(collection.getByRole('button', { name: '取消收藏 合成研究数据集 · 003', exact: true })).toBeEnabled();
    await favorites.getByRole('button', { name: '取消收藏 合成研究数据集 · 001', exact: true }).click();
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(1);
    await recent.getByRole('button', { name: '清空最近记录', exact: true }).click();
    await expect(page.getByTestId('work-recent-record')).toHaveCount(0);
    await expect(recent).toContainText('暂无最近打开记录。');
    await page.getByTestId('home-refresh').click();
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(1);
    await expect(page.getByTestId('work-recent-record')).toHaveCount(0);
    expect(calls.filter(call => call.startsWith('PUT '))).toEqual(['PUT /api/me/favorite-datasets/top-2']);
    expect(calls.filter(call => call.startsWith('DELETE '))).toEqual([
      'DELETE /api/me/favorite-datasets/top-0', 'DELETE /api/me/recent-datasets',
    ]);
    expect(calls.some(call => call.startsWith('POST '))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}
