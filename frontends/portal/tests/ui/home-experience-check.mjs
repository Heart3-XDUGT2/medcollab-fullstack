import { chromium, expect, selectors } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

selectors.setTestIdAttribute('data-cy');
const base = process.env.PORTAL_E2E_BASE_URL || 'http://127.0.0.1:60833';
const out = path.resolve('.runtime/home-personalization', process.env.QA_ROUND || 'round-1');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const report = {
  scope: 'Synthetic UI responses only; no live account or medical data',
  screenshots: [],
  measurements: [],
  checks: [],
  errors: [],
};
const correctionCases = {
  1440: ['few-index', 'fields-hidden'],
  768: ['many-list-compact', 'large-list-compact', 'fields-hidden'],
  390: [
    'few-index',
    'many-list-compact',
    'many-index-grouped',
    'many-index-comfortable',
    'large-list-compact',
    'fields-hidden',
    'display-settings',
  ],
};
const identity = {
  issuer: 'https://home-ui-fixture.example.test/realm',
  subject: 'home-fixture-account-a',
};
const names = [
  '腹部 CT · 多器官标注集',
  '胸部影像 · 联合整理',
  '头颈部 CT · 公共教学示例',
  '脑部 MR · 多序列样例',
  '跨中心腹部影像一致性研究 · 第三轮补充与复核资料集',
  '影像标注入门 · 公开练习集',
];
const source = ['owner', 'shared', 'public'];
function resources(count, account = 'a') {
  return Array.from({ length: count }, (_, i) => ({
    id: `ui-${account}-${i + 1}`,
    name: `${names[i % names.length]}${i >= names.length ? ` · ${String(i + 1).padStart(3, '0')}` : ''}`,
    access: source[i % source.length],
    ownerUsername: ['林知遥', '陈予安', '公共影像'][i % 3],
    instanceCount: i === 0 ? 0 : [1248, 864, 326, 2048][i % 4],
    createdAt: new Date(Date.UTC(2026, 10, 1) - i * 86400000).toISOString(),
  }));
}
const items = (array) => ({ items: array, total: array.length });

try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 960 },
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => report.errors.push(`${width}: ${e.message}`));
    let count = 3,
      account = 'a';
    const requests = [];
    await page.route('**/config.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'window.config=' +
          JSON.stringify({
            medcollab: {
              apiEnabled: true,
              authOrigin: base,
              logoutOrigins: [],
              workspacePath: null,
              publicSamplePath: null,
            },
          }),
      })
    );
    await page.route('**/api/**', (route) => {
      const req = route.request(),
        url = new URL(req.url());
      requests.push({ method: req.method(), pathname: url.pathname });
      if (req.method() !== 'GET') {
        report.errors.push(`${width}: display sent a business write`);
        return route.abort();
      }
      const body =
        url.pathname === '/api/session'
          ? {
              loggedIn: true,
              username: account === 'a' ? '林知遥' : '陈予安',
              ...identity,
              subject: `home-fixture-account-${account}`,
              csrfToken: 'synthetic-not-a-credential',
              csrfHeaderName: 'X-Fixture-CSRF',
            }
          : url.pathname === '/api/datasets'
            ? items(resources(count, account))
            : url.pathname === '/api/teams'
              ? items([])
              : null;
      return route.fulfill({
        status: body ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(body || { error: 'unexpected isolated fixture' }),
      });
    });
    const ready = () => expect(page.getByTestId('home-dataset-row')).toHaveCount(count);
    const closeSettings = async () => {
      const panel = page.getByTestId('home-display-preferences-panel');
      if (await panel.count()) {
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(page.getByTestId('home-display-preferences')).toBeFocused();
      }
    };
    const settings = async (patch) => {
      await page.getByTestId('home-display-preferences').click();
      const panel = page.getByTestId('home-display-preferences-panel');
      await expect(panel).toBeVisible();
      if (patch.density)
        await panel
          .getByRole('radio', { name: patch.density === 'compact' ? '紧凑' : '舒适', exact: true })
          .check();
      if (patch.group)
        await panel.getByLabel('资料分组', { exact: true }).selectOption(patch.group);
      if (patch.owner !== undefined)
        await panel.getByRole('checkbox', { name: '创建者', exact: true }).setChecked(patch.owner);
      if (patch.date !== undefined)
        await panel.getByRole('checkbox', { name: '创建时间', exact: true }).setChecked(patch.date);
      if (!patch.keepOpen) await closeSettings();
    };
    const shot = async (name) => {
      if (process.env.QA_SCOPE === 'fix-confirmation' && !correctionCases[width].includes(name))
        return;
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(180);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        report.errors.push(`${width}/${name}: horizontal overflow`);
      const file = `${width}-${name}.png`;
      await page.screenshot({ path: path.join(out, file) });
      report.screenshots.push(file);
      if (
        ['few-index', 'many-list-compact', 'large-list-compact', 'many-index-grouped'].includes(
          name
        )
      ) {
        const metrics = await page.getByTestId('home-dataset-row').evaluateAll((rows) => {
          const rects = rows.map((row) => row.getBoundingClientRect());
          return {
            firstTop: rects[0]?.top ?? null,
            fullyVisibleRows: rects.filter((rect) => rect.top >= 0 && rect.bottom <= innerHeight)
              .length,
            firstRowHeights: rects.slice(0, 8).map((rect) => rect.height),
          };
        });
        if (width === 768 && name.includes('list-compact')) {
          const names = await page
            .getByTestId('home-dataset-select')
            .locator('strong')
            .evaluateAll((nodes) =>
              nodes
                .filter((node) => node.textContent.includes('跨中心'))
                .map((node) => ({
                  name: node.textContent,
                  clipped:
                    node.scrollWidth > node.clientWidth + 1 ||
                    node.scrollHeight > node.clientHeight + 1,
                  whiteSpace: getComputedStyle(node).whiteSpace,
                }))
            );
          if (!names.length || names.some((item) => item.clipped || item.whiteSpace === 'nowrap'))
            report.errors.push(`${width}/${name}: long identifying names are clipped`);
          metrics.longNameChecks = names;
        }
        report.measurements.push({ width, name, ...metrics });
      }
    };
    await page.goto(base + '/home?view=library');
    await ready();
    await page.getByRole('button', { name: '资料索引', exact: true }).click();
    await shot('few-index');
    await page.getByTestId('home-dataset-select').first().click();
    await expect(page.getByTestId('home-detail')).toBeVisible();
    await shot('few-detail');
    if (width <= 1200) {
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('home-dataset-select').first()).toBeFocused();
    } else await page.getByRole('button', { name: '关闭资料概览', exact: true }).click();
    await settings({ density: 'compact', keepOpen: true });
    await shot('display-settings');
    await closeSettings();
    await page.getByTestId('home-search').fill('腹部');
    const selected = page.getByTestId('home-dataset-select').first();
    await page.getByRole('button', { name: '资料清单', exact: true }).click();
    await expect(page.getByTestId('home-search')).toHaveValue('腹部');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('home-search').fill('');
    await settings({ owner: false, date: false });
    await shot('fields-hidden');
    await closeSettings();
    await expect(page.locator('th[data-field="owner"],th[data-field="createdAt"]')).toHaveCount(0);
    await settings({ owner: true, date: true });
    count = 30;
    await page.reload();
    await ready();
    await expect(page.getByTestId('medcollab-home')).toHaveAttribute('data-density', 'compact');
    await expect(page.getByTestId('medcollab-home')).toHaveAttribute('data-layout', 'list');
    await shot('many-list-compact');
    await page.getByRole('button', { name: '资料索引', exact: true }).click();
    await settings({ group: 'source' });
    await shot('many-index-grouped');
    await settings({ density: 'comfortable', group: 'none' });
    await shot('many-index-comfortable');
    count = 300;
    await page.reload();
    await ready();
    await page.getByRole('button', { name: '资料清单', exact: true }).click();
    await settings({ density: 'compact' });
    await shot('large-list-compact');
    await page.getByTestId('home-search').fill('not-present-ui-fixture');
    await expect(page.getByTestId('home-empty')).toContainText('没有匹配');
    await shot('no-match');
    await page.getByTestId('home-search').fill('');
    count = 0;
    await page.reload();
    await expect(page.getByTestId('home-empty')).toContainText('这里还没有');
    await shot('empty');
    account = 'b';
    count = 3;
    await page.reload();
    await ready();
    await expect(page.getByTestId('medcollab-home')).toHaveAttribute('data-density', 'comfortable');
    await settings({ keepOpen: true });
    await page
      .getByTestId('home-display-preferences-panel')
      .getByRole('button', { name: '恢复默认', exact: true })
      .click();
    await closeSettings();
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(3);
    const serialized = await page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) => key.startsWith('medcollab.home.display.'))
    );
    const persisted = JSON.stringify(serialized);
    if (
      /腹部|林知遥|陈予安|home-fixture-account|home-ui-fixture|ui-a-|ui-b-|csrf|workspacePath/.test(
        persisted
      )
    )
      report.errors.push(`${width}: sensitive data entered preference storage`);
    report.checks.push(
      `${width}: 0/3/30/300 synthetic resources, live layout/density/group/fields, retained search/selection, local refresh persistence, account defaults, safe reset, no business writes`
    );
    await page.close();
  }
} catch (error) {
  report.errors.push(error.stack || String(error));
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
