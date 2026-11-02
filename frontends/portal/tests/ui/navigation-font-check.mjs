import { chromium, expect, selectors } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

selectors.setTestIdAttribute('data-cy');
const base = process.env.PORTAL_E2E_BASE_URL || 'http://127.0.0.1:60827';
const out = path.resolve('.runtime/ui-screens/navigation-font-final');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const me = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const createdAt = '2026-11-01T02:00:00Z';
const team = {
  id: 'TM-FINAL00000001',
  name: '跨中心多模态医学影像联合研究与长期资料整理团队',
  leaderSubject: me,
  leaderUsername: '林知遥',
  memberCount: 2,
  role: 'leader',
  createdAt,
};
const members = [
  { subject: me, username: '林知遥', role: 'leader', joinedAt: createdAt },
  { subject: other, username: '陈予安', role: 'member', joinedAt: createdAt },
];
const datasets = [
  {
    id: 'nav-font-fixture',
    name: '腹部 CT · 多器官标注集',
    access: 'owner',
    ownerUsername: '林知遥',
    instanceCount: 1248,
    createdAt,
    scope: 'team',
    teamId: team.id,
    uploaderSubject: me,
    canDelete: true,
  },
];
const items = (values) => ({ items: values, total: values.length });
const report = {
  scope: 'Only shared navigation icons and team metadata sizes; all team responses intercepted',
  screenshots: [],
  fontChecks: [],
  iconComparisons: [],
  errors: [],
};

try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 960 },
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => report.errors.push(`${width}: ${e.message}`));
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
      if (route.request().method() !== 'GET') {
        report.errors.push(`${width}: unexpected write`);
        return route.abort();
      }
      const pathname = new URL(route.request().url()).pathname;
      const body =
        pathname === '/api/session'
          ? {
              loggedIn: true,
              username: '林知遥',
              issuer: 'https://navigation-fixture.example.test',
              subject: me,
              csrfToken: 'synthetic-navigation-only',
              csrfHeaderName: 'X-Fixture-CSRF',
            }
          : pathname === '/api/datasets'
            ? items([])
            : pathname === '/api/teams'
              ? items([team])
              : pathname.endsWith('/members')
                ? items(members)
                : pathname.endsWith('/datasets')
                  ? items(datasets)
                  : pathname === `/api/teams/${team.id}`
                    ? team
                    : null;
      return route.fulfill({
        status: body ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(body || { error: 'isolated fixture' }),
      });
    });
    const shot = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        report.errors.push(`${width}/${name}: overflow`);
      const file = `${width}-${name}-fixture.png`;
      await page.screenshot({ path: path.join(out, file) });
      report.screenshots.push(file);
    };
    const navigation = async (name) => {
      if (width <= 1100) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      const nav = page.locator('nav[aria-label="数据集分类"]:visible');
      const shapes = await nav
        .locator('svg')
        .evaluateAll((nodes) => nodes.map((node) => node.innerHTML));
      await expect(nav.locator('svg')).toHaveCount(4);
      await shot(name);
      if (width <= 1100) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: '打开导航', exact: true })).toBeFocused();
      }
      return shapes;
    };
    const fonts = async (state) => {
      const sizes = await page
        .locator('.mc-teams small:visible, .mc-teams time:visible, .mc-team-tag:visible')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.textContent.trim())
            .map((node) => ({
              text: node.textContent.trim(),
              px: parseFloat(getComputedStyle(node).fontSize),
            }))
        );
      if (!sizes.length || sizes.some((item) => item.px < 12))
        report.errors.push(`${width}/${state}: metadata below 12px`);
      report.fontChecks.push({
        width,
        state,
        minPx: Math.min(...sizes.map((item) => item.px)),
        elements: sizes.length,
      });
    };
    await page.goto(base + '/home');
    await expect(page.getByTestId('medcollab-home')).toBeVisible();
    const homeIcons = await navigation('home-navigation');
    await page.goto(base + '/teams');
    await expect(page.locator('.mc-team-list-row')).toHaveCount(1);
    await fonts('team-list');
    const teamIcons = await navigation('team-navigation');
    expect(teamIcons).toEqual(homeIcons);
    report.iconComparisons.push({ width, matchingScopes: 4 });
    await page.locator('.mc-team-list-row').click();
    await expect(page.locator('.mc-team-data-row')).toHaveCount(1);
    await fonts('team-datasets');
    await shot('team-datasets-text');
    await page.getByRole('tab', { name: /成员/ }).click();
    await expect(page.locator('.mc-team-member-row')).toHaveCount(2);
    await fonts('team-members');
    await shot('team-members-text');
    if (width <= 1100) await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page
      .locator('nav[aria-label="数据集分类"]:visible')
      .getByRole('link', { name: '我创建的', exact: true })
      .click();
    await expect(page).toHaveURL(/\/home\?scope=owner$/);
    await expect(page.locator('[data-cy="home-filter-owner"]')).toHaveAttribute(
      'aria-current',
      'page'
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
      iconComparisons: report.iconComparisons,
      fontChecks: report.fontChecks,
      errors: report.errors,
    },
    null,
    2
  )
);
if (report.errors.length) process.exitCode = 1;
