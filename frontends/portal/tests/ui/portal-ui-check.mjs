import { chromium, expect, selectors } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.PORTAL_E2E_BASE_URL || 'http://127.0.0.1:60827';
selectors.setTestIdAttribute('data-cy');
const out = path.resolve('.runtime/ui-screens', process.env.QA_ROUND || 'round-1');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const report = {
  scope:
    'Local UI verification with memory demo and intercepted synthetic API responses, not live backend integration',
  captures: [],
  errors: [],
  checks: [],
};
const me = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const third = '33333333-3333-4333-8333-333333333333';
const session = {
  loggedIn: true,
  username: '林知遥',
  issuer: 'https://ui-fixture.example.test/realm',
  subject: me,
  csrfHeaderName: 'X-Fixture-CSRF',
  csrfToken: 'synthetic-ui-fixture-only',
};
const fixtures = [
  ['腹部 CT · 多器官标注集', 'owner', 1248],
  ['胸部影像 · 联合整理', 'shared', 864],
  ['头颈部 CT · 公共教学示例', 'public', 326],
  ['腹部增强 CT · 对照资料', 'owner', 1536],
  ['脑部 MR · 多序列样例', 'shared', 512],
  ['胸部 CT · 小样本整理', 'owner', 248],
  ['跨中心腹部影像一致性研究 · 第三轮补充与复核资料集', 'owner', 2048],
  ['骨盆 CT · 基础样例', 'shared', 416],
  ['影像标注入门 · 公开练习集', 'public', 128],
  ['头部影像 · 研究生练习', 'owner', 192],
  ['腹部 CT · 待导入资料', 'owner', 0],
  ['脊柱 MR · 观察样例', 'shared', 384],
].map(([name, access, instanceCount], i) => ({
  id: `ui-fixture-${i + 1}`,
  name,
  access,
  instanceCount,
  ownerUsername: access === 'owner' ? '林知遥' : access === 'public' ? '公共示例' : '陈予安',
  createdAt: `2026-10-${String(31 - i).padStart(2, '0')}T02:00:00Z`,
}));
const teams = [
  {
    id: 'TM-UI000000000001',
    name: '多模态影像研究组',
    leaderSubject: me,
    leaderUsername: '林知遥',
    memberCount: 3,
    role: 'leader',
    createdAt: '2026-10-30T02:00:00Z',
  },
  {
    id: 'TM-UI000000000002',
    name: '胸部影像联合整理小组',
    leaderSubject: other,
    leaderUsername: '陈予安',
    memberCount: 3,
    role: 'member',
    createdAt: '2026-10-29T02:00:00Z',
  },
  {
    id: 'TM-UI000000000003',
    name: '跨中心多模态医学影像联合研究与长期资料整理团队',
    leaderSubject: me,
    leaderUsername: '林知遥',
    memberCount: 3,
    role: 'leader',
    createdAt: '2026-10-28T02:00:00Z',
  },
];
const teamRows = fixtures
  .slice(0, 4)
  .filter((d) => d.access !== 'public')
  .map((d, i) => ({
    ...d,
    access: i === 0 ? 'owner' : 'shared',
    ownerUsername: i === 0 ? '林知遥' : '陈予安',
    scope: 'team',
    teamId: teams[0].id,
    uploaderSubject: i === 0 ? me : other,
    canDelete: i === 0,
  }));
const members = [
  { subject: me, username: '林知遥', role: 'leader' },
  { subject: other, username: '陈予安', role: 'member' },
  { subject: third, username: '许沐晴', role: 'member' },
].map((m) => ({ ...m, joinedAt: '2026-10-30T02:00:00Z' }));
const items = (values) => ({ items: values, total: values.length });

try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 960 },
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (e) => report.errors.push(`${width}: ${e.message}`));
    const defaultApi = [];
    await page.route('**/api/**', (route) => {
      defaultApi.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"isolated UI fixture"}',
      });
    });
    const shot = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      );
      if (horizontalOverflow) report.errors.push(`${width}/${name}: horizontal overflow`);
      const filename = `${width}-${name}.png`;
      await page.screenshot({ path: path.join(out, filename), fullPage: false });
      report.captures.push(filename);
    };
    await page.goto(baseURL + '/home');
    await expect(page.getByTestId('home-connection-state')).toBeVisible();
    await shot('home-unconfigured');
    await page.getByTestId('home-enter-demo').click();
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(12);
    await shot('home-demo');
    await page.getByTestId('home-search').fill('腹部');
    await page.getByRole('button', { name: '按来源分组', exact: true }).click();
    await expect(page.getByTestId('home-search')).toHaveValue('腹部');
    await shot('home-grouped');
    await page.getByTestId('home-dataset-select').filter({ hasText: '跨中心腹部影像' }).click();
    await shot('home-detail');
    if (width <= 1200)
      await page.getByTestId('home-detail').getByTestId('dialog-close-button').click();
    else await page.getByRole('button', { name: '关闭资料概览', exact: true }).click();
    await page.getByTestId('home-search').fill('');
    await page.getByTestId('home-upload').click();
    await page.getByTestId('home-upload-files').setInputFiles({
      name: 'synthetic-ui-only.dcm',
      mimeType: 'application/dicom',
      buffer: Buffer.from('synthetic metadata-only UI fixture, not medical data'),
    });
    await expect(page.getByTestId('home-upload-start')).toBeDisabled();
    await shot('upload-demo');
    await page.keyboard.press('Escape');
    if (defaultApi.length) report.errors.push(`${width}: demo/default made API requests`);
    await page.goto(baseURL + '/sign-in');
    await shot('password-preview');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('sign-in-identifier')).toBeFocused();
    await shot('password-errors');
    await page.goto(baseURL + '/account/sign-in');
    await shot('account-entry');
    await page.close();

    const real = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 960 },
      reducedMotion: 'reduce',
    });
    real.on('pageerror', (e) => report.errors.push(`${width}/fixture: ${e.message}`));
    const intercepted = [];
    let shares = [{ subject: other, username: '陈予安' }];
    await real.route('**/config.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'window.config=' +
          JSON.stringify({
            medcollab: {
              apiEnabled: true,
              authOrigin: new URL(baseURL).origin,
              logoutOrigins: [],
              workspacePath: '/workspace',
              publicSamplePath: null,
            },
          }),
      })
    );
    await real.route('**/api/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      intercepted.push({ method: req.method(), path: url.pathname });
      let body;
      if (url.pathname === '/api/session') body = session;
      else if (url.pathname === '/api/datasets') body = items(fixtures);
      else if (url.pathname === '/api/teams') body = items(teams);
      else if (url.pathname === '/api/users')
        body = items([
          { subject: third, username: '许沐晴' },
          { subject: other, username: '陈予安' },
        ]);
      else if (/\/shares$/.test(url.pathname)) {
        if (req.method() === 'PUT') {
          shares = [...shares, { subject: third, username: '许沐晴' }];
          body = { success: true };
        } else body = items(shares);
      } else if (url.pathname === '/api/import') {
        if (!req.headers()['x-fixture-csrf'])
          report.errors.push(`${width}: append lacked fresh fixture CSRF`);
        if (!req.postDataBuffer()?.includes(Buffer.from('ui-fixture-1')))
          report.errors.push(`${width}: append lost its target`);
        body = { status: 'Success', id: 'synthetic-import-response' };
      } else {
        const team = teams.find((t) => url.pathname.startsWith(`/api/teams/${t.id}`));
        if (team && url.pathname.endsWith('/members')) body = items(members);
        else if (team && url.pathname.endsWith('/datasets'))
          body = items(teamRows.map((d) => ({ ...d, teamId: team.id })));
        else if (team) body = team;
      }
      await route.fulfill({
        status: body ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(body || { error: 'unhandled isolated UI fixture' }),
      });
    });
    const fixtureShot = async (name) => {
      await real.evaluate(() => document.fonts.ready);
      await real.mouse.move(0, 0);
      await real.waitForTimeout(200);
      if (await real.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        report.errors.push(`${width}/${name}: horizontal overflow`);
      const filename = `${width}-${name}-fixture.png`;
      await real.screenshot({ path: path.join(out, filename), fullPage: false });
      report.captures.push(filename);
    };
    await real.goto(baseURL + '/home');
    await expect(real.getByTestId('home-dataset-row')).toHaveCount(12);
    await fixtureShot('home');
    await real
      .getByTestId('home-dataset-row')
      .filter({ hasText: fixtures[0].name })
      .getByTestId('home-dataset-more')
      .click();
    await real.getByTestId('home-menu-share').click();
    await real.getByTestId('home-share-search').fill('许沐');
    await real.getByTestId('home-share-search-submit').click();
    await real.getByTestId('home-user-result').filter({ hasText: '许沐晴' }).click();
    await expect(real.getByTestId('home-user-result').filter({ hasText: '陈予安' })).toHaveCount(0);
    await expect(real.getByTestId('home-share-panel')).toContainText('确认共享后不可撤销');
    await fixtureShot('personal-share');
    await real.keyboard.press('Escape');
    await real.goto(baseURL + '/teams');
    await expect(real.locator('.mc-team-list-row')).toHaveCount(3);
    await fixtureShot('teams');
    await real.locator('.mc-team-list-row').first().click();
    await expect(real.locator('.mc-team-data-row')).toHaveCount(3);
    await fixtureShot('team-datasets');
    await real.getByRole('tab', { name: /成员/ }).click();
    await expect(real.locator('.mc-team-member-row')).toHaveCount(3);
    await fixtureShot('team-members');
    await real.getByRole('button', { name: '添加成员', exact: true }).click();
    await fixtureShot('team-add-member');
    await real.keyboard.press('Escape');
    await real.getByRole('tab', { name: /数据集/ }).click();
    await real.getByRole('button', { name: `${fixtures[0].name} 数据集操作`, exact: true }).click();
    await real.getByRole('menuitem', { name: '追加文件', exact: true }).click();
    await expect(real.locator('.mc-upload-target')).toContainText(fixtures[0].name);
    await expect(real.getByTestId('home-upload-name')).toHaveCount(0);
    await fixtureShot('team-append');
    await real.getByTestId('home-upload-files').setInputFiles({
      name: 'synthetic-ui-only.dcm',
      mimeType: 'application/dicom',
      buffer: Buffer.from('controlled synthetic request; not a valid medical file'),
    });
    await real.getByTestId('home-upload-start').click();
    await expect(real.getByTestId('home-upload-summary')).toContainText('成功 1');
    if (intercepted.some((r) => r.method === 'POST' && /\/datasets$/.test(r.path)))
      report.errors.push(`${width}: append created a dataset`);
    await real.getByTestId('home-upload-close').click();
    await real.getByRole('button', { name: '我的团队', exact: true }).click();
    await real.getByRole('button', { name: '创建团队', exact: true }).click();
    await fixtureShot('create-team');
    await real.keyboard.press('Escape');
    await real.locator('.mc-team-list-row').filter({ hasText: teams[2].name }).click();
    await expect(real.locator('.mc-team-profile h1')).toHaveText(teams[2].name);
    await fixtureShot('team-long-name');
    report.checks.push(
      `${width}: default/demo no API calls; retained group search; login focus; personal irreversible sharing; team route/list/tabs; existing-target append with fresh CSRF and no create; all business traffic intercepted`
    );
    await real.close();
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
      captures: report.captures.length,
      errors: report.errors,
      checks: report.checks,
    },
    null,
    2
  )
);
if (report.errors.length) process.exitCode = 1;
