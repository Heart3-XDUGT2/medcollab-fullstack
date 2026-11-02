import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const portalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = process.env.TEAM_SCREENSHOTS || path.join(portalRoot, '.runtime/ui-screens/teams-auth');
await fs.mkdir(out, { recursive: true });
const issues = [], checks = [];
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
for (const width of [1440, 768, 390]) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  let lost = false, empty = false, queryFailure = false;
  const team = { id: 'TM-FIXTURE-A', name: '跨学科医学影像联合研究与多中心资料整理团队', leaderSubject: 'fixture-me', leaderUsername: '样式验证研究员', memberCount: 3, role: 'leader', createdAt: '2026-11-02T00:00:00Z' };
  const datasets = [{ id: 'fixture-d1', name: '多中心腹部影像一致性研究 · 第三轮补充资料与联合标注集', access: 'owner', scope: 'team', teamId: team.id, uploaderSubject: 'fixture-me', canDelete: true, ownerUsername: '样式验证研究员', instanceCount: 1248, createdAt: team.createdAt },
    { id: 'fixture-d2', name: '多序列影像 · 对照资料', access: 'shared', scope: 'team', teamId: team.id, uploaderSubject: 'fixture-other', canDelete: false, ownerUsername: '样式验证成员', instanceCount: 0, createdAt: team.createdAt }];
  const members = [{ subject: 'fixture-me', username: '样式验证研究员', role: 'leader', joinedAt: team.createdAt }, { subject: 'fixture-other', username: '样式验证成员', role: 'member', joinedAt: team.createdAt }, { subject: 'fixture-third', username: '长名称账号样式验证成员', role: 'member', joinedAt: team.createdAt }];
  page.on('pageerror', error => issues.push(`${width}: ${error.message}`));
  await page.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.config={medcollab:{apiEnabled:true,authOrigin:"http://127.0.0.1:60827",logoutOrigins:[],workspacePath:"/workspace"}}' }));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    let result, status = 200;
    if (url.pathname === '/api/session') result = { loggedIn: true, username: '样式验证研究员', issuer: 'fixture-issuer', subject: 'fixture-me', csrfToken: 'fixture-not-a-credential', csrfHeaderName: 'X-FIXTURE-CSRF' };
    else if (url.pathname === '/api/teams' && method === 'GET') result = { items: lost ? [] : [team], total: lost ? 0 : 1 };
    else if (url.pathname === '/api/users') result = { items: [{ subject: 'fixture-new', username: '新成员样式账号' }], total: 1 };
    else if (url.pathname === '/api/teams/search') result = { items: [{ ...team, id: 'TM-FIXTURE-JOIN', role: 'none' }], total: 1 };
    else if (lost && url.pathname.startsWith(`/api/teams/${team.id}`)) { status = 404; result = { error: 'Fixture permission loss' }; }
    else if (queryFailure && url.pathname === `/api/teams/${team.id}`) { status = 503; result = { error: 'Fixture unavailable' }; }
    else if (method === 'GET' && url.pathname === `/api/teams/${team.id}`) result = team;
    else if (method === 'GET' && url.pathname.endsWith('/members')) result = { items: members, total: members.length };
    else if (method === 'GET' && url.pathname.endsWith('/datasets')) result = { items: empty ? [] : datasets, total: empty ? 0 : datasets.length };
    else if (method === 'POST' && url.pathname === '/api/teams') result = { team, inviteCode: 'ISOLATED_FIXTURE_NOT_REAL_CODE' };
    else { status = 400; result = { error: 'Unexpected fixture path' }; issues.push(`${width}: unexpected mocked method/path ${method} ${url.pathname}`); }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  const shot = async name => {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) issues.push(`${width}/${name}: horizontal overflow`);
    await page.screenshot({ path: path.join(out, `${width}-${name}.png`), fullPage: false });
  };
  await page.goto('http://127.0.0.1:60827/teams');
  await page.addStyleTag({ content: 'body::before{content:"隔离协议模拟 · 不连接真实服务";display:block;background:#eaf2f5;color:#425c67;font:11px/26px sans-serif;padding:0 16px;position:relative;z-index:60}' });
  await expect(page.locator('.mc-team-list-row')).toHaveCount(1);
  await shot('team-list');
  await page.getByRole('button', { name: /跨学科医学影像联合研究/ }).click();
  await expect(page.locator('.mc-team-data-row')).toHaveCount(2);
  await shot('team-datasets');
  await page.getByRole('tab', { name: '成员 3' }).click();
  await shot('team-members');
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await page.getByLabel('已有账号名称').fill('新成员');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.mc-team-search-results')).toContainText('新成员样式账号');
  await shot('member-search');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: '数据集 2' }).click();
  await page.getByRole('button', { name: '上传', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(team.name);
  await shot('team-upload');
  await page.keyboard.press('Escape');
  empty = true;
  await page.getByRole('button', { name: '刷新团队资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '团队还没有数据集' })).toBeVisible();
  await shot('team-empty');
  lost = true;
  await page.getByRole('button', { name: '刷新团队资料', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('已失去成员资格');
  await shot('team-revoked');
  lost = false;
  await page.getByRole('button', { name: '重新读取' }).click();
  await expect(page.locator('.mc-team-list-row')).toHaveCount(1);
  await page.locator('.mc-team-list-row').click();
  await expect(page.locator('.mc-team-profile')).toBeVisible();
  queryFailure = true;
  await page.getByRole('button', { name: '刷新团队资料', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('服务暂时不可用');
  await shot('team-error');
  const store = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  if (store.local || store.session) issues.push(`${width}: unexpected persistent browser storage`);
  checks.push(`${width}: real TeamsPage with fully intercepted protocol responses; long names, datasets/members, account search, upload composition, empty/error/revoked, Escape, no overflow/storage checked`);
  await context.close();
}
for (const width of [1440, 768, 390]) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 960 }, reducedMotion: 'reduce' });
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) issues.push(`auth fixture sent a write: ${request.method()}`); });
  page.on('pageerror', error => issues.push(`auth fixture: ${error.message}`));
  for (const name of ['login', 'register', 'reset']) {
    await page.goto(`http://127.0.0.1:5188/fixtures/${name}.html`);
    await page.evaluate(() => document.fonts.ready);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) issues.push(`${width}/auth-${name}: overflow`);
    await page.screenshot({ path: path.join(out, `${width}-auth-${name}.png`), fullPage: true });
  }
  checks.push(`${width}: readonly isolated auth style projections, not a FreeMarker/SSO execution`);
  await page.close();
}
await browser.close();
await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify({ checks, issues, mockOnly: true, realIntegration: false }, null, 2));
console.log(JSON.stringify({ out, checks, issues }, null, 2));
if (issues.length) process.exitCode = 1;
