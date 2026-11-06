import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { makeSyntheticDatasetStatistics } from '../../src/features/home/statistics/contract';

const path = '/tests/statistics/index.html';
const data = (n = 4) =>
  makeSyntheticDatasetStatistics('d', {
    totalSlices: 10,
    annotatedSlices: n,
    publishedAnnotatedSlices: 3,
  });
async function protocol(
  page: Page,
  options: {
    health?: () => object;
    healthStatus?: number;
    status?: () => number;
    subject?: () => string;
    before?: () => Promise<void>;
    annotated?: () => number;
  } = {}
) {
  const calls: { path: string; method: string }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()).pathname;
    calls.push({ path: url, method: request.method() });
    if (url === '/api/session') {
      await route.fulfill({
        json: {
          loggedIn: true,
          username: '合成验证身份',
          issuer: 'fixture-issuer',
          subject: options.subject?.() || 'fixture-a',
          csrfToken: 'fixture-only',
          csrfHeaderName: 'X-Fixture-CSRF',
        },
      });
    } else if (url === '/api/health') {
      await route.fulfill({
        status: options.healthStatus ?? 200,
        json: options.health?.() ?? { annotationStatsApi: 'v1' },
      });
    } else if (url === '/api/datasets/d/annotation-stats') {
      await options.before?.();
      const status = options.status?.() ?? 200;
      await route.fulfill({
        status,
        json:
          status === 200 ? data(options.annotated?.() ?? 4) : { error: 'SECRET must never render' },
      });
    } else {
      await route.abort('blockedbyclient');
      throw new Error('Unexpected request: ' + url);
    }
  });
  return calls;
}
const reads = (calls: { path: string }[]) =>
  calls.filter((call) => call.path.endsWith('/annotation-stats'));

for (const width of [1440, 768, 390]) {
  test(`compact summary keeps list density and keyboard detail access at ${width}`, async ({
    page,
  }) => {
    const calls = await protocol(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(path + '?case=protocol');
    const compact = page.getByTestId('record-d').getByTestId('dataset-coverage');
    await expect(compact).toHaveAttribute('data-status', 'ready');
    const summary = compact.locator('summary');
    await expect(summary).toContainText('共享画布 40%');
    await expect(summary).toContainText('已归档 30%');
    await expect(compact.locator('details')).not.toHaveAttribute('open', '');
    await expect(compact.locator('.mc-coverage-heading')).not.toBeVisible();
    await expect(compact.getByRole('button', { name: '重新读取统计' })).not.toBeVisible();
    const geometry = await summary.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      font: parseFloat(getComputedStyle(element).fontSize),
      overflow: element.scrollWidth > element.clientWidth,
    }));
    expect(geometry.height).toBeLessThanOrEqual(64);
    expect(geometry.font).toBe(14);
    expect(geometry.overflow).toBe(false);
    const readCount = reads(calls).length;
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(compact.locator('details')).toHaveAttribute('open', '');
    await expect(compact.locator('.mc-coverage-count').first()).toBeVisible();
    await expect(compact).toContainText('4 / 10 帧');
    await expect(compact.getByRole('button', { name: '重新读取统计' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(compact.locator('.mc-coverage-heading')).not.toBeVisible();
    expect(reads(calls)).toHaveLength(readCount);
    const detail = page.getByRole('region', { name: '选中资料' });
    await expect(detail.locator('.mc-coverage-heading')).toBeVisible();
    await expect(detail.locator('.mc-coverage-count').first()).toBeVisible();
  });
}

test('same resource in compact/detail is one GET with distinct canvas/archive counts', async ({
  page,
}) => {
  const calls = await protocol(page);
  await page.goto(path + '?case=protocol');
  await expect(page.locator('[data-status="ready"]')).toHaveCount(2);
  await expect(page.getByRole('region', { name: '选中资料' })).toContainText('4 / 10 帧');
  await expect(page.getByRole('region', { name: '选中资料' })).toContainText('3 / 10 帧');
  expect(reads(calls)).toHaveLength(1);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
for (const old of ['missing-marker', 'health404']) {
  test(`${old} does not read sessions/statistics or report lost resources`, async ({ page }) => {
    const calls = await protocol(page, {
      health: () => ({}),
      healthStatus: old === 'health404' ? 404 : 200,
    });
    await page.goto(path + '?case=protocol');
    await expect(page.locator('[data-status="unsupported"]')).toHaveCount(2);
    expect(calls.every((call) => call.path === '/api/health' && call.method === 'GET')).toBe(true);
    // StrictMode may send the aborted first-scope probe before replaying the live scope.
    expect(calls.length).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('access-issues')).toHaveText('访问事件 0');
  });
}
test('confirmed resource404 probes capability and emits one notification despite manual reread', async ({
  page,
}) => {
  const calls = await protocol(page, { status: () => 404 });
  await page.goto(path + '?case=protocol');
  await expect(page.locator('[data-status="missing"]')).toHaveCount(2);
  await expect(page.getByTestId('access-issues')).toHaveText('访问事件 1 · 404');
  const probesBefore = calls.filter((call) => call.path === '/api/health').length;
  await page.getByRole('button', { name: '刷新可见统计', exact: true }).click();
  await expect.poll(() => reads(calls).length).toBe(2);
  await expect(page.getByTestId('access-issues')).toHaveText('访问事件 1 · 404');
  expect(calls.filter((call) => call.path === '/api/health')).toHaveLength(probesBefore + 1);
  await expect(page.locator('body')).not.toContainText('SECRET');
});
test('423 retains stale results and manual refresh can recover', async ({ page }) => {
  let status = 200;
  await protocol(page, { status: () => status });
  await page.goto(path + '?case=protocol');
  await expect(page.locator('[data-status="ready"]')).toHaveCount(2);
  status = 423;
  await page
    .getByRole('region', { name: '选中资料' })
    .getByRole('button', { name: '重新读取统计' })
    .click();
  await expect(page.locator('[data-status="busy"]')).toHaveCount(2);
  const summary = page.getByTestId('record-d').locator('summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('共享画布 40%');
  await expect(summary).toContainText('旧值');
  await expect(summary).toContainText('统计版本正在变化');
  await expect(page.getByRole('region', { name: '选中资料' })).toContainText('上次结果，尚未更新');
  await expect(page.getByRole('region', { name: '选中资料' })).toContainText('4 / 10 帧');
  status = 200;
  await page
    .getByRole('region', { name: '选中资料' })
    .getByRole('button', { name: '重新读取统计' })
    .click();
  await expect(page.locator('[data-status="ready"]')).toHaveCount(2);
});
test('last-consumer hide/show resumes once after cooldown and ignores delayed response', async ({
  page,
}) => {
  let release!: () => void,
    blocked = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await protocol(page, { before: () => (blocked ? gate : Promise.resolve()) });
  await page.goto(path + '?case=protocol');
  await expect.poll(() => reads(calls).length).toBe(1);
  await page.getByRole('button', { name: '隐藏统计', exact: true }).click();
  blocked = false;
  await page.getByRole('button', { name: '显示统计', exact: true }).click();
  await expect(page.locator('[data-status="ready"]')).toHaveCount(2, { timeout: 10000 });
  expect(reads(calls)).toHaveLength(2);
  release();
  await expect(page.getByRole('region', { name: '选中资料' })).toContainText('4 / 10 帧');
});
test('account changes discard old values and re-read under the new scope', async ({ page }) => {
  let subject = 'fixture-a',
    annotated = 4;
  await protocol(page, { subject: () => subject, annotated: () => annotated });
  await page.goto(path + '?case=protocol');
  await expect(page.locator('[data-status="ready"]')).toHaveCount(2);
  subject = 'fixture-b';
  annotated = 9;
  await page.getByRole('button', { name: '切换验证身份', exact: true }).click();
  await expect(page.getByRole('region', { name: '选中资料' })).toContainText('9 / 10 帧');
  await expect(page.locator('body')).not.toContainText('4 / 10 帧');
  await page.getByLabel('验证场景').selectOption('anonymous');
  await expect(page.locator('[data-status="unauthenticated"]')).toHaveCount(2);
  await expect(page.locator('body')).not.toContainText('9 / 10 帧');
});
for (const width of [1440, 768, 390]) {
  test(`synthetic states and responsive geometry at ${width}`, async ({ page }) => {
    const calls = await protocol(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(path);
    await expect(page.getByTestId('record-almost')).toContainText('<100%');
    await expect(page.getByTestId('record-empty')).toContainText('覆盖率不适用');
    await expect(page.getByTestId('record-zero')).toContainText('尚未发布 SEG');
    await expect(page.getByTestId('record-archived')).toContainText('已有 SEG 归档');
    await expect(page.getByTestId('record-erased')).toContainText('归档异常');
    await expect(page.getByTestId('record-unknown')).toContainText('未提供合成统计');
    expect(calls).toHaveLength(0);
    await page.getByLabel('验证场景').focus();
    await expect(page.getByLabel('验证场景')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    const collisions = await page.locator('.mc-coverage-line').evaluateAll(
      (rows) =>
        rows.filter((row) => {
          const [label, count, percent] = [...row.children].map((child) =>
            child.getBoundingClientRect()
          );
          return (
            label.right > count.left + 1 ||
            (count.top === percent.top && count.right > percent.left + 1)
          );
        }).length
    );
    expect(collisions).toBe(0);
    const output = resolve('.runtime/statistics/first');
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: resolve(output, `synthetic-${width}.png`), fullPage: true });
  });
}
