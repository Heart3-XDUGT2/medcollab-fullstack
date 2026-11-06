import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { addPortalConfiguration, expect, test } from './fixtures';

const identity = { issuer: 'https://work-fixture.example.test/realm', subject: 'work-account-a' };
const session = {
  loggedIn: true,
  username: '工作示例账号',
  ...identity,
  csrfToken: 'fixture-not-a-token',
  csrfHeaderName: 'X-Fixture-CSRF',
};
const datasets = [
  {
    id: 'work-a',
    name: '腹部资料 · 第一轮',
    access: 'owner',
    ownerUsername: '工作示例账号',
    instanceCount: 300,
    createdAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'work-b',
    name: '跨中心腹部影像一致性研究 · 第三轮补充与复核资料集 · 011',
    access: 'shared',
    ownerUsername: '协作者',
    instanceCount: 650,
    createdAt: '2026-10-31T00:00:00Z',
  },
];
const team = {
  id: 'work-team',
  name: '联合影像研究',
  leaderSubject: identity.subject,
  leaderUsername: '工作示例账号',
  memberCount: 2,
  datasetCount: 0,
  role: 'leader',
  createdAt: '2026-11-01T00:00:00Z',
};
const values = (array: unknown[]) => ({ items: array, total: array.length });
const defaults = {
  layout: 'cards',
  density: 'comfortable',
  groupBy: 'none',
  fields: { owner: true, instances: true, createdAt: true },
  home: {
    defaultEntry: 'work',
    order: ['continue', 'favorites', 'recent', 'library', 'teams'],
    hidden: [],
  },
};
function coverage(id: string) {
  const progress = {
    totalSlices: 300,
    annotatedSlices: 60,
    unannotatedSlices: 240,
    ratio: 0.2,
    percent: 20,
  };
  const publishedProgress = {
    totalSlices: 300,
    annotatedSlices: 38,
    unannotatedSlices: 262,
    ratio: 38 / 300,
    percent: 12.67,
  };
  return {
    datasetId: id,
    completionMethod: 'nonempty-mask-slices/ct-slices',
    seriesCount: 1,
    progress,
    publishedProgress,
    pendingArchive: true,
    generatedAt: '2026-11-03T12:00:00Z',
    series: [
      {
        datasetId: id,
        seriesId: 'source-ct',
        progress,
        publishedProgress,
        seq: 6,
        throughSeq: 4,
        publishedVersion: 1,
        pendingArchive: true,
        archiveError: '',
      },
    ],
  };
}
async function fixture(
  page: Page,
  options: {
    account?: () => typeof session;
    teams?: boolean;
    statistics?: boolean;
    beforeStats?: (id: string) => Promise<void>;
    statsStatus?: (id: string) => number;
  } = {}
) {
  const calls: { path: string; method: string }[] = [];
  await addPortalConfiguration(page, {
    medcollab: {
      apiEnabled: true,
      authOrigin: 'http://127.0.0.1:60833',
      workspacePath: null,
      logoutOrigins: [],
    },
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    calls.push({ path, method: request.method() });
    const statistic = path.match(/^\/api\/datasets\/([^/]+)\/annotation-stats$/);
    if (statistic) {
      await options.beforeStats?.(statistic[1]);
      const status = options.statsStatus?.(statistic[1]) || 200;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200 ? coverage(statistic[1]) : { error: 'fixture access lost' }
        ),
      });
      return;
    }
    const body =
      path === '/api/me/favorite-datasets'
        ? { items: [], total: 0, page: 0, size: 20 }
        : path === '/api/me/favorite-datasets/state'
          ? { items: datasets.map(dataset => ({datasetId: dataset.id, favorited: false, favoritedAt: null})), total: datasets.length }
          : path === '/api/me/recent-datasets'
            ? { items: [], total: 0, page: 0, size: 20, generation: 'fixture-generation', retentionDays: 90, maxItems: 100 }
            : path === '/api/session'
        ? options.account?.() || session
        : path === '/api/datasets'
          ? values(datasets)
          : path === '/api/teams'
            ? values(options.teams ? [team] : [])
            : path === '/api/health'
              ? { status: 'UP', ...(options.statistics ? { annotationStatsApi: 'v1' } : {}) }
              : path === `/api/teams/${team.id}`
                ? team
                : path === `/api/teams/${team.id}/datasets`
                  ? values([])
                  : path === `/api/teams/${team.id}/members`
                    ? values([])
                    : null;
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(body || { error: 'fixture unavailable' }),
    });
  });
  return calls;
}
async function seed(page: Page, preferences: unknown, slow = false) {
  const key =
    'medcollab.home.display.v1.' +
    createHash('sha256')
      .update(JSON.stringify(['medcollab-display-v1', identity.issuer, identity.subject]))
      .digest('hex');
  await page.addInitScript(
    ({ key, preferences, slow }) => {
      localStorage.setItem(key, JSON.stringify({ version: 1, preferences }));
      if (slow) {
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = async (...args) => {
          await new Promise((resolve) => setTimeout(resolve, 900));
          return digest(...args);
        };
      }
    },
    { key, preferences, slow }
  );
}
async function closeDetail(page: Page, width: number) {
  if (width <= 1200) await page.keyboard.press('Escape');
  else await page.getByRole('button', { name: '关闭资料概览', exact: true }).click();
  await expect(page.getByTestId('home-detail')).toHaveCount(0);
}

test('new accounts read empty real activity without inventing history or business writes', async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto('/home');
  await expect(page.getByTestId('work-home')).toBeVisible();
  await expect(page.getByText('还没有收藏的数据集。', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无最近打开记录。', { exact: true })).toBeVisible();
  await expect(page.getByTestId('work-continue-target')).toHaveCount(0);
  await page.getByTestId('work-continue-select').selectOption('work-a');
  await expect(page.getByTestId('work-continue-target')).toContainText(datasets[0].name);
  await page.getByTestId('work-continue-open').click();
  await expect(page.getByTestId('home-notice')).toContainText('未被打开');
  await expect(page.getByTestId('work-recent-record')).toHaveCount(0);
  expect(calls.some((call) => /favorite-datasets/.test(call.path))).toBe(true);
  expect(calls.some((call) => /recent-datasets/.test(call.path))).toBe(true);
  expect(calls.some((call) => /labelmap|workspace/.test(call.path))).toBe(false);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('entry switches retain library search, sort, selection and display layout', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/home?view=library');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(2);
  await page.getByTestId('home-search').fill('腹部');
  await page.getByTestId('home-sort').selectOption('name');
  await page.getByRole('button', { name: '资料清单', exact: true }).click();
  await page.getByTestId('home-dataset-select').first().click();
  await closeDetail(page, 1440);
  await page.getByTestId('home-entry-work').click();
  await expect(page.getByTestId('work-continue-target')).toContainText(datasets[0].name);
  await page.getByTestId('home-entry-library').click();
  await expect(page.getByTestId('home-search')).toHaveValue('腹部');
  await expect(page.getByTestId('home-sort')).toHaveValue('name');
  await expect(page.getByTestId('medcollab-home')).toHaveAttribute('data-layout', 'list');
  await expect(page.getByTestId('home-dataset-select').first()).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('mobile work count uses its full resource scope without discarding a library search', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/home?view=library');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(2);
  await page.getByTestId('home-search').fill('第一轮');
  await expect(page.locator('.mc-library-mobile-count')).toHaveText('1 项');
  await page.getByTestId('home-entry-work').click();
  await expect(page.locator('.mc-library-mobile-count')).toHaveText('2 项');
  await expect(page.locator('.mc-library-mobile-density')).toHaveCount(0);
  await page.getByTestId('home-entry-library').click();
  await expect(page.getByTestId('home-search')).toHaveValue('第一轮');
  await expect(page.locator('.mc-library-mobile-count')).toHaveText('1 项');
});

test('explicit scope and a manual library switch beat a late saved default', async ({ page }) => {
  await fixture(page);
  await seed(page, defaults, true);
  await page.goto('/home?scope=owner');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(1);
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('home-entry-library')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('home-search')).toBeVisible();
});

test('manual library entry is not undone when default preference finishes loading', async ({
  page,
}) => {
  await fixture(page);
  await seed(page, defaults, true);
  await page.goto('/home');
  await page.getByTestId('home-entry-library').click();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(2);
});

test('legacy v1 list preferences keep their old library entry', async ({ page }) => {
  await fixture(page);
  const { home, ...legacy } = defaults;
  await seed(page, {
    ...legacy,
    layout: 'list',
    density: 'compact',
    fields: { owner: false, instances: true, createdAt: false },
  });
  await page.goto('/home');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(2);
  await expect(page.getByTestId('medcollab-home')).toHaveAttribute('data-layout', 'list');
  await expect(page.getByTestId('medcollab-home')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('th[data-field="owner"]')).toHaveCount(0);
});

test('home settings reorder/hide modules, persist enums only, and leave original display preferences alone', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/home');
  await expect(page.getByTestId('work-home')).toBeVisible();
  await page.getByTestId('work-home-settings').click();
  const panel = page.getByTestId('work-home-settings-panel');
  await panel.getByLabel('默认进入', { exact: true }).selectOption('library');
  await panel.getByRole('checkbox', { name: '最近打开', exact: true }).uncheck();
  await panel.getByRole('button', { name: '上移我的收藏', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('work-home-settings')).toBeFocused();
  await expect(page.locator('.mc-work-module > header h2')).toHaveText([
    '数据集',
    '我的收藏',
    '继续工作',
    '我的团队',
  ]);
  await page.reload();
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(2);
  const saved = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) => key.startsWith('medcollab.home.display.'))
  );
  const serialized = JSON.stringify(saved);
  expect(serialized).not.toMatch(/work-a|work-b|腹部|协作者|csrf|work-fixture|work-account/);
  expect(JSON.parse(saved[0][1]).preferences.home.defaultEntry).toBe('library');
});

for (const width of [1440, 390]) {
  test(`demo repeated dataset entrances return focus to their own ${width}px trigger and never record a successful open`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    const calls = await fixture(page);
    await page.goto('/home');
    // Enter the demo from a genuinely unconfigured page, not by fabricating a user action.
    await page.unroute('**/config.js');
    await addPortalConfiguration(page, { medcollab: { apiEnabled: false } });
    await page.reload();
    await page.getByTestId('home-enter-demo').click();
    for (const testId of ['work-continue-detail', 'work-favorite-detail', 'work-recent-detail']) {
      const trigger = page.getByTestId(testId).first();
      await trigger.click();
      await expect(page.getByTestId('home-detail')).toContainText('腹部 CT · 多器官标注集');
      await closeDetail(page, width);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page
        .getByTestId('home-detail')
        .getByRole('button', { name: '重命名', exact: true })
        .click();
      await expect(page.getByTestId('home-action-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('home-action-dialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await page.getByTestId('work-continue-open').click();
    await expect(page.getByTestId('home-notice')).toContainText('未接入');
    await expect(page.getByTestId('work-recent-record')).toHaveCount(3);
    await page
      .getByRole('button', { name: '移除记录 腹部 CT · 多器官标注集', exact: true })
      .click();
    await expect(page.getByTestId('work-recent-record')).toHaveCount(2);
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(3);
    await page.getByTestId('work-clear-recent').click();
    await expect(page.getByTestId('work-recent-record')).toHaveCount(0);
    await page
      .getByTestId('work-module-favorites')
      .getByRole('button', { name: '取消收藏 腹部 CT · 多器官标注集', exact: true })
      .click();
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(2);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    await page.reload();
    await page.getByTestId('home-enter-demo').click();
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(3);
    await expect(page.getByTestId('work-recent-record')).toHaveCount(3);
  });
}

test('home team shortcut resolves only an actual current membership', async ({ page }) => {
  await fixture(page, { teams: true });
  await page.goto('/home');
  await page.getByRole('link', { name: /联合影像研究/ }).click();
  await expect(page).toHaveURL(/\/teams\?team=work-team/);
  await expect(page.getByRole('heading', { name: '联合影像研究', exact: true })).toBeVisible();
});

test('account B gets its own saved default after A manually changed entries; leaving demo restores B default', async ({
  page,
}) => {
  let account = session;
  await fixture(page, { account: () => account });
  const accountB = { ...session, username: '另一个账号', subject: 'work-account-b' };
  const keyB =
    'medcollab.home.display.v1.' +
    createHash('sha256')
      .update(JSON.stringify(['medcollab-display-v1', identity.issuer, accountB.subject]))
      .digest('hex');
  await page.addInitScript(
    ({ key, preferences }) =>
      localStorage.setItem(key, JSON.stringify({ version: 1, preferences })),
    { key: keyB, preferences: defaults }
  );
  await page.goto('/home');
  await expect(page.getByTestId('work-home')).toBeVisible();
  await page.getByTestId('home-entry-library').click();
  account = accountB;
  await page.getByTestId('home-refresh').click();
  await expect(page.getByTestId('work-home')).toBeVisible();
  await expect(page.getByTestId('home-entry-work')).toHaveAttribute('aria-pressed', 'true');
  account = { ...accountB, loggedIn: false };
  await page.getByTestId('home-refresh').click();
  await page.getByTestId('home-enter-demo').click();
  await page.getByTestId('home-entry-library').click();
  account = accountB;
  await page.getByRole('button', { name: '退出示例，返回真实服务', exact: true }).click();
  await expect(page.getByTestId('work-home')).toBeVisible();
  await expect(page.getByTestId('home-entry-work')).toHaveAttribute('aria-pressed', 'true');
});

for (const status of [403, 404])
  for (const action of ['重命名', '追加文件', '按账号共享']) {
    test(`confirmed resource statistics ${status} closes only the affected ${action} action without a full-page reload loop`, async ({
      page,
    }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const calls = await fixture(page, {
        statistics: true,
        beforeStats: (id) => (id === 'work-a' ? gate : Promise.resolve()),
        statsStatus: (id) => (id === 'work-a' ? status : 200),
      });
      await page.route('**/api/datasets/work-a/shares', (route) =>
        route.fulfill({ json: values([]) })
      );
      await page.goto('/home?view=library');
      await expect(page.getByTestId('home-dataset-row')).toHaveCount(2);
      await expect
        .poll(
          () => calls.filter((call) => call.path === '/api/datasets/work-a/annotation-stats').length
        )
        .toBe(1);
      await page.getByTestId('home-dataset-more').first().click();
      await page.getByRole('menuitem', { name: action, exact: true }).click();
      await expect(page.getByTestId('home-action-dialog')).toBeVisible();
      release();
      await expect(page.getByTestId('home-action-dialog')).toHaveCount(0);
      await expect(page.getByTestId('home-dataset-row')).toHaveCount(1);
      await expect(page.getByTestId('home-dataset-row')).toContainText(datasets[1].name);
      await expect(page.getByTestId('home-create')).toBeEnabled();
      await expect(page.getByTestId('home-notice')).toContainText('失去访问权限');
      await page.waitForTimeout(400);
      expect(calls.filter((call) => call.path === '/api/datasets')).toHaveLength(1);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }

test('duplicate continuation/detail coverage shares one resource read', async ({ page }) => {
  const calls = await fixture(page, { statistics: true });
  await page.goto('/home');
  await page.getByTestId('work-continue-select').selectOption('work-a');
  await expect(page.locator('.mc-work-coverage')).toContainText('60');
  await page.getByTestId('work-continue-detail').click();
  await expect(page.getByTestId('home-detail')).toContainText('60');
  expect(
    calls.filter((call) => call.path === '/api/datasets/work-a/annotation-stats')
  ).toHaveLength(1);
});

test('old backend capabilities never request dataset statistics or remove an available dataset', async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto('/home?view=library');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(2);
  await page.waitForTimeout(300);
  expect(calls.some((call) => call.path.endsWith('/annotation-stats'))).toBe(false);
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(2);
  expect(calls.filter((call) => call.path === '/api/datasets')).toHaveLength(1);
});

test('statistics access loss cancels a waiting rename without claiming server rollback or retrying the write', async ({
  page,
}) => {
  let releaseStats!: () => void, releaseWrite!: () => void;
  const statGate = new Promise<void>((resolve) => (releaseStats = resolve));
  const writeGate = new Promise<void>((resolve) => (releaseWrite = resolve));
  const calls = await fixture(page, {
    statistics: true,
    beforeStats: (id) => (id === 'work-a' ? statGate : Promise.resolve()),
    statsStatus: (id) => (id === 'work-a' ? 404 : 200),
  });
  let writes = 0;
  await page.route('**/api/datasets/work-a', async (route) => {
    writes++;
    await writeGate;
    await route.fulfill({ json: { ...datasets[0], name: 'rename-in-flight' } });
  });
  await page.goto('/home?view=library');
  await expect
    .poll(
      () => calls.filter((call) => call.path === '/api/datasets/work-a/annotation-stats').length
    )
    .toBe(1);
  await page.getByTestId('home-dataset-more').first().click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByTestId('home-name-input').fill('rename-in-flight');
  await page.getByTestId('home-name-save').click();
  await expect.poll(() => writes).toBe(1);
  releaseStats();
  await expect(page.getByTestId('home-action-dialog')).toHaveCount(0);
  await expect(page.getByTestId('home-notice')).toContainText('服务端可能已处理');
  releaseWrite();
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(1);
  await expect(page.getByTestId('home-dataset-row')).not.toContainText('rename-in-flight');
  await expect(page.getByTestId('home-create')).toBeEnabled();
  expect(writes).toBe(1);
});

test('access loss for another dataset does not clear an unrelated action draft', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const calls = await fixture(page, {
    statistics: true,
    beforeStats: (id) => (id === 'work-a' ? gate : Promise.resolve()),
    statsStatus: (id) => (id === 'work-a' ? 404 : 200),
  });
  await page.goto('/home?view=library');
  await expect
    .poll(
      () => calls.filter((call) => call.path === '/api/datasets/work-a/annotation-stats').length
    )
    .toBe(1);
  await page.getByTestId('home-dataset-more').nth(1).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByTestId('home-name-input').fill('unrelated draft retained');
  release();
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(1);
  await expect(page.getByTestId('home-action-dialog')).toBeVisible();
  await expect(page.getByTestId('home-name-input')).toHaveValue('unrelated draft retained');
  await expect(page.getByTestId('home-name-save')).toBeEnabled();
  expect(calls.filter((call) => call.path === '/api/datasets')).toHaveLength(1);
});

for (const width of [1440, 768, 390]) {
  test(`compact library retains full identities and reaches complete coverage detail at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    const calls = await fixture(page, { statistics: true });
    await page.goto('/home?view=library');
    await page.getByRole('button', { name: '资料清单', exact: true }).click();
    await page.getByTestId('home-display-preferences').click();
    await page
      .getByTestId('home-display-preferences-panel')
      .getByRole('radio', { name: '紧凑', exact: true })
      .check();
    await page.keyboard.press('Escape');
    await expect(
      page.locator('.mc-resource-table [data-cy="dataset-coverage"][data-status="ready"]')
    ).toHaveCount(2, { timeout: 15000 });
    const longName = page.getByTestId('home-dataset-select').nth(1);
    await expect(longName.locator('strong')).toHaveText(datasets[1].name);
    await expect(longName).toContainText('与我共享');
    const clipped = await longName
      .locator('strong')
      .evaluate(
        (element) =>
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1
      );
    expect(clipped).toBe(false);
    const readsBeforeDetail = calls.filter(
      (call) => call.path === '/api/datasets/work-b/annotation-stats'
    ).length;
    await longName.click();
    const detail = page.getByTestId('home-detail');
    await expect(detail.locator('.mc-coverage--detail')).toContainText('60 / 300 帧');
    await expect(detail.locator('.mc-coverage--detail')).toContainText('38 / 300 帧');
    await expect(detail.locator('.mc-coverage--detail')).toContainText('不代表医学质量');
    await expect(detail.locator('.mc-coverage--detail')).toContainText('有操作待归档');
    await closeDetail(page, width);
    await expect(longName).toBeFocused();
    expect(
      calls.filter((call) => call.path === '/api/datasets/work-b/annotation-stats')
    ).toHaveLength(readsBeforeDetail);
    expect(calls.some((call) => /labelmap|\/file$/.test(call.path))).toBe(false);
  });
}
