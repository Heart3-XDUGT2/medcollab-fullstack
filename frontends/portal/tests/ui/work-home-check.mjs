import { chromium, expect, selectors } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

selectors.setTestIdAttribute('data-cy');
const base = process.env.PORTAL_E2E_BASE_URL || 'http://127.0.0.1:60833';
const out = path.resolve('.runtime/work-home', process.env.QA_ROUND || 'round-1');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const report = {
  scope:
    'Synthetic intercepted API responses and explicit in-memory demo only; no live service validation',
  screenshots: [],
  checks: [],
  errors: [],
  measurements: [],
};
let activePage;
const identity = {
  issuer: 'https://work-home-ui.example.test/realm',
  subject: 'work-home-ui-account',
};
const names = [
  '腹部 CT · 多器官标注集',
  '跨中心腹部影像一致性研究 · 第三轮补充与复核资料集',
  '脑部 MR · 多序列研究',
];
const items = (array) => ({ items: array, total: array.length });
const resources = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `work-ui-${index + 1}`,
    name: names[index % 3] + (index ? ` · ${String(index + 1).padStart(3, '0')}` : ''),
    access: ['owner', 'shared', 'public'][index % 3],
    ownerUsername: ['林知遥', '陈予安', '公共影像'][index % 3],
    instanceCount: [1248, 650, 512][index % 3],
    createdAt: new Date(Date.UTC(2026, 10, 1) - index * 86400000).toISOString(),
  }));
function progress(total, annotated) {
  return {
    totalSlices: total,
    annotatedSlices: annotated,
    unannotatedSlices: total - annotated,
    ratio: total ? annotated / total : 0,
    percent: total ? Math.round((annotated / total) * 10000) / 100 : 0,
  };
}
function statistics(id) {
  const index = Number(id.split('-').at(-1)) - 1;
  const total = index % 3 === 2 ? 0 : 300;
  const current = total ? 60 + (index % 40) : 0,
    archived = total ? 38 : 0;
  const series = total
    ? [
        {
          datasetId: id,
          seriesId: 'synthetic-ct-series',
          progress: progress(total, current),
          publishedProgress: progress(total, archived),
          seq: 24,
          throughSeq: 18,
          publishedVersion: 2,
          pendingArchive: true,
          archiveError: '',
        },
      ]
    : [];
  return {
    datasetId: id,
    completionMethod: 'nonempty-mask-slices/ct-slices',
    seriesCount: series.length,
    progress: progress(total, current),
    publishedProgress: progress(total, archived),
    pendingArchive: !!total,
    series,
    generatedAt: '2026-11-03T12:00:00Z',
  };
}
try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 960 },
      reducedMotion: 'reduce',
    });
    activePage = page;
    page.on('pageerror', (error) => report.errors.push(`${width}: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/api/'))
        report.errors.push(`${width}: resource ${response.status()} ${response.url()}`);
    });
    let count = 3,
      capability = true,
      failed = false,
      demo = false;
    const calls = [];
    await page.route('**/config.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'window.config=' +
          JSON.stringify({
            medcollab: {
              apiEnabled: !demo,
              authOrigin: base,
              logoutOrigins: [],
              workspacePath: null,
              publicSamplePath: null,
            },
          }),
      })
    );
    await page.route('**/api/**', async (route) => {
      const request = route.request(),
        pathname = new URL(request.url()).pathname;
      calls.push({ pathname, method: request.method() });
      if (request.method() !== 'GET') {
        report.errors.push(`${width}: unexpected business write ${pathname}`);
        return route.abort();
      }
      const match = pathname.match(/^\/api\/datasets\/([^/]+)\/annotation-stats$/);
      const body =
        pathname === '/api/session'
          ? {
              loggedIn: true,
              username: '林知遥',
              ...identity,
              csrfToken: 'synthetic-not-a-credential',
              csrfHeaderName: 'X-Fixture-CSRF',
            }
          : pathname === '/api/health'
            ? { status: 'UP', ...(capability ? { annotationStatsApi: 'v1' } : {}) }
            : pathname === '/api/datasets'
              ? items(resources(count))
              : pathname === '/api/teams'
                ? items([
                    {
                      id: 'research-a',
                      name: '跨中心影像研究',
                      leaderSubject: identity.subject,
                      leaderUsername: '林知遥',
                      memberCount: 6,
                      datasetCount: 8,
                      role: 'leader',
                      createdAt: '2026-11-01T00:00:00Z',
                    },
                    {
                      id: 'research-b',
                      name: '医学标注教学组',
                      leaderSubject: 'synthetic-leader',
                      leaderUsername: '陈予安',
                      memberCount: 12,
                      datasetCount: 3,
                      role: 'member',
                      createdAt: '2026-10-20T00:00:00Z',
                    },
                  ])
                : match && capability
                  ? statistics(decodeURIComponent(match[1]))
                  : null;
      const status = match && failed ? 503 : body ? 200 : 404;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(status === 200 ? body : { error: 'synthetic unavailable' }),
      });
    });
    async function shot(name) {
      if (
        process.env.QA_SCOPE === 'compact-confirmation' &&
        !['real-work-current', 'library-30-compact', 'library-300-compact'].includes(name)
      )
        return;
      if (name === 'library-30-compact' || name === 'library-300-compact') {
        await expect.poll(() => page.locator('.mc-resource-table [data-cy="dataset-coverage"]').evaluateAll(nodes =>
          nodes.filter(node => {
            const rect = node.getBoundingClientRect();
            return rect.top < innerHeight && rect.bottom > 0;
          }).every(node => node.getAttribute('data-status') === 'ready')
        ), { timeout: 15000 }).toBe(true);
      }
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        report.errors.push(`${width}/${name}: page horizontal overflow`);
      const file = `${width}-${name}.png`;
      await page.screenshot({ path: path.join(out, file) });
      report.screenshots.push(file);
      if (['real-work-current', 'demo-work', 'demo-cleared', 'empty-work'].includes(name)) {
        const full = `${width}-${name}-full.png`;
        await page.screenshot({ path: path.join(out, full), fullPage: true });
        report.screenshots.push(full);
      }
      report.measurements.push({
        width,
        name,
        ...(await page.evaluate(() => {
          const rows = [...document.querySelectorAll('[data-cy="home-dataset-row"]')];
          const rects = rows.map((row) => row.getBoundingClientRect());
          const names = [...document.querySelectorAll('[data-cy="home-dataset-select"] strong')];
          const longNames = names
            .filter((node) => node.textContent.includes('跨中心'))
            .map((node) => ({
              text: node.textContent,
              clipped:
                node.scrollWidth > node.clientWidth + 1 ||
                node.scrollHeight > node.clientHeight + 1,
              whiteSpace: getComputedStyle(node).whiteSpace,
            }));
          return {
            heading: document.querySelector('h1')?.textContent,
            moduleOrder: [...document.querySelectorAll('.mc-work-module > header h2')].map(
              (node) => node.textContent
            ),
            rowCount: rows.length,
            firstTop: rects[0]?.top ?? null,
            fullyVisibleRows: rects.filter(
              (rect) => rect.top >= 0 && rect.bottom <= innerHeight + 1
            ).length,
            firstRowHeights: rects.slice(0, 12).map((rect) => rect.height),
            visibleActions: rows
              .filter(
                (row, index) => rects[index].top >= 0 && rects[index].bottom <= innerHeight + 1
              )
              .map((row) => {
                const box = row.querySelector('[data-cy="home-row-open"]')?.getBoundingClientRect();
                return box
                  ? {
                      top: box.top,
                      right: box.right,
                      bottom: box.bottom,
                      visible:
                        box.width > 0 &&
                        box.left >= 0 &&
                        box.right <= innerWidth + 1 &&
                        box.bottom <= innerHeight + 1,
                    }
                  : null;
              }),
            longNameCount: longNames.length,
            clippedLongNameCount: longNames.filter((node) => node.clipped).length,
            longNameChecks: longNames.slice(0, 10),
          };
        })),
      });
      const measurement = report.measurements.at(-1);
      if (measurement.clippedLongNameCount)
        report.errors.push(`${width}/${name}: identifying long names clipped`);
      if (measurement.visibleActions.some((action) => !action?.visible))
        report.errors.push(`${width}/${name}: a complete row has an unavailable open action`);
    }
    async function work(id = 'work-ui-1') {
      await page.goto(base + '/home?view=work');
      await expect(page.getByTestId('work-home')).toBeVisible();
      if (count) {
        await page.getByTestId('work-continue-select').selectOption(id);
        await expect(page.getByTestId('work-continue-target')).toBeVisible();
        await page.waitForTimeout(500);
      }
    }
    await work();
    await shot('real-work-current');
    await page.getByTestId('work-continue-select').selectOption('work-ui-2');
    await page.waitForTimeout(400);
    await shot('real-work-long');
    await page.getByTestId('work-home-settings').click();
    await expect(page.getByTestId('work-home-settings-panel')).toBeVisible();
    await shot('home-settings');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('work-home-settings')).toBeFocused();
    count = 30;
    await page.goto(base + '/home?view=library');
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(count);
    await page.getByRole('button', { name: '资料清单', exact: true }).click();
    await page.getByTestId('home-display-preferences').click();
    await page
      .getByTestId('home-display-preferences-panel')
      .getByRole('radio', { name: '紧凑', exact: true })
      .check();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await shot('library-30-compact');
    const statisticReads = calls.filter((call) =>
      call.pathname.endsWith('/annotation-stats')
    ).length;
    if (statisticReads > 25)
      report.errors.push(
        `${width}: initial visible library read too many statistics (${statisticReads})`
      );
    count = 300;
    await page.reload();
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(count);
    await page.waitForTimeout(500);
    await shot('library-300-compact');
    count = 0;
    await work();
    await shot('empty-work');
    count = 3;
    capability = false;
    const beforeUnsupported = calls.filter((call) =>
      call.pathname.endsWith('/annotation-stats')
    ).length;
    await work();
    await shot('unsupported-statistics');
    if (
      calls.filter((call) => call.pathname.endsWith('/annotation-stats')).length !==
      beforeUnsupported
    )
      report.errors.push(`${width}: unsupported backend received a statistics request`);
    await expect(page.getByTestId('work-continue-select').locator('option')).toHaveCount(4);
    capability = true;
    failed = true;
    await work();
    await shot('failed-statistics');
    failed = false;
    demo = true;
    await page.goto(base + '/home?view=work');
    const beforeDemo = calls.length;
    await page.getByTestId('home-enter-demo').click();
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(3);
    await shot('demo-work');
    await page.getByTestId('work-continue-open').click();
    await expect(page.getByTestId('home-notice')).toContainText('未接入');
    await expect(page.getByTestId('work-recent-record')).toHaveCount(3);
    await page.getByTestId('home-notice').getByRole('button', { name: '关闭提示' }).click();
    for (const id of ['demo-abdomen-first', 'demo-chest-joint', 'demo-abdomen-long']) {
      const name = {
        'demo-abdomen-first': '腹部 CT · 多器官标注集',
        'demo-chest-joint': '胸部影像 · 联合整理',
        'demo-abdomen-long': names[1],
      }[id];
      await page.getByRole('button', { name: `取消收藏 ${name}`, exact: true }).click();
    }
    await page.getByTestId('work-clear-recent').click();
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(0);
    await expect(page.getByTestId('work-recent-record')).toHaveCount(0);
    await shot('demo-cleared');
    if (calls.length !== beforeDemo) report.errors.push(`${width}: demo sent a real API request`);
    const stored = await page.evaluate(() =>
      JSON.stringify(
        Object.entries(localStorage).filter(([key]) => key.startsWith('medcollab.home.display.'))
      )
    );
    if (/work-ui-|腹部|林知遥|work-home-ui-account|csrf|window.config/.test(stored))
      report.errors.push(`${width}: resource or identity content persisted in display preferences`);
    report.checks.push(
      `${width}: real current/long/empty, 30/300 compact library, settings focus, unsupported vs failed statistics, ephemeral demo favorite/recent changes, no synthetic successful opens or business writes`
    );
    await page.close();
  }
} catch (failure) {
  report.errors.push(failure.stack || String(failure));
  if (activePage && !activePage.isClosed())
    report.errors.push(await activePage.locator('body').innerText());
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify(
    {
      directory: out,
      screenshots: report.screenshots.length,
      checks: report.checks,
      errors: report.errors,
    },
    null,
    2
  )
);
if (report.errors.length) process.exitCode = 1;
