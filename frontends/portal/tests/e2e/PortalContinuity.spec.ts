import { test, expect } from './fixtures';
import { teamFavoriteFixture } from './helpers/team-favorite-fixture';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

async function staticCandidate(page: Page) {
  const directory = process.env.CONTINUITY_DIST;
  if (!directory) return;
  const root = path.resolve(directory);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['GET', 'HEAD'].includes(route.request().method()) ||
      /^\/(?:api|auth|realms|login-actions|oauth2)(?:\/|$)/.test(url.pathname) ||
      url.pathname === '/config.js') return route.fallback();
    const relative = /^\/(?:home|teams)\/?$/.test(url.pathname) ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return route.abort();
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    try { return route.fulfill({ body: await readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status: 404, body: 'Unmatched static fixture' }); }
  });
}

async function bounds(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector(selector)!;
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, font: style.fontFamily, color: style.color };
    };
    const frame = document.querySelector('.mc-library-main, .mc-teams-content')!;
    const style = getComputedStyle(frame), rect = frame.getBoundingClientRect();
    return {
      header: box('.mc-topbar'), brand: box('.mc-top-brand'), nav: box('.mc-top-primary'),
      heading: box('main h1'),
      content: { x: rect.x + parseFloat(style.paddingLeft), y: rect.y + parseFloat(style.paddingTop), right: rect.right - parseFloat(style.paddingRight) },
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

async function capture(page: Page, name: string) {
  if (process.env.CONTINUITY_SCREENSHOTS !== '1') return;
  const directory = path.resolve('.runtime/portal-continuity', process.env.CONTINUITY_ROUND || 'first');
  await mkdir(directory, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(directory, `${name}.png`),
    animations: name.endsWith('navigation-midframe') ? 'allow' : 'disabled' });
}

async function observeMotion(page: Page, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(() => {
    const state = { hold: false, records: [] as { id: string; duration: number; frames: PropertyIndexedKeyframes | Keyframe[] | null }[] };
    (window as any).__portalMotion = state;
    const original = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      const animation = original.call(this, frames, options);
      queueMicrotask(() => {
        if (!['mc-navigation', 'mc-route-content'].includes(animation.id)) return;
        state.records.push({ id: animation.id, duration: Number(animation.effect!.getTiming().duration), frames });
        if (state.hold) { animation.pause(); animation.currentTime = 0; }
      });
      return animation;
    };
  });
}

for (const width of [1920, 1440, 768, 390]) test(`Portal frame remains continuous across all libraries at ${width}`, async ({ page }) => {
  await staticCandidate(page);
  const fixture = await teamFavoriteFixture(page);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1032 });
  const measurements: Record<string, Awaited<ReturnType<typeof bounds>>> = {};
  for (const [name, url] of [['work', '/home?view=work'], ['library', '/home?view=library'], ['teams', '/teams'], ['detail', '/teams?team=TM-A']]) {
    await page.goto(url);
    await expect(page.locator('main h1')).toBeVisible();
    if (name === 'detail') await expect(page.getByRole('heading', { name: fixture.teams[0].name, exact: true })).toBeVisible();
    if (name === 'teams') await expect(page.locator('.mc-team-list-row')).toHaveCount(2);
    if (name === 'work' || name === 'library') await expect(page.locator('[data-ready="true"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    measurements[name] = await bounds(page);
    await capture(page, `${width}-${name}`);
    if (name === 'library') {
      await page.getByTestId('home-team-source').click();
      await expect(page.getByTestId('home-team-picker')).toBeVisible();
      await capture(page, `${width}-source-dialog`);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('home-team-source')).toBeFocused();
    }
    if (name === 'detail') {
      const menu = page.getByRole('button', { name: `${fixture.data[0].name} 数据集操作`, exact: true });
      await menu.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await capture(page, `${width}-dataset-menu`);
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
    }
  }
  const directory = path.resolve('.runtime/portal-continuity', process.env.CONTINUITY_ROUND || 'red');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${width}-bounds.json`), JSON.stringify(measurements, null, 2));
  for (const name of ['library', 'teams', 'detail']) {
    expect.soft(measurements[name].header.height, `${name} header height`).toBe(measurements.work.header.height);
    expect.soft(measurements[name].brand.x, `${name} brand x`).toBe(measurements.work.brand.x);
    expect.soft(measurements[name].nav.x, `${name} navigation x`).toBe(measurements.work.nav.x);
    expect.soft(measurements[name].content.x, `${name} content left`).toBe(measurements.work.content.x);
    expect.soft(measurements[name].content.right, `${name} content right`).toBe(measurements.work.content.right);
    expect.soft(measurements[name].overflow, `${name} horizontal overflow`).toBe(false);
  }
  expect.soft(measurements.teams.heading.y, 'team index title baseline').toBe(measurements.work.heading.y);
});

for (const width of [1920, 1440, 768, 390]) test(`SPA chrome and interruptible motion retain navigation and current content at ${width}`, async ({ page }) => {
  await staticCandidate(page);
  const fixture = await teamFavoriteFixture(page);
  await observeMotion(page);
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1032 });
  await page.goto('/home?view=work');
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  const header = await page.locator('.mc-topbar').elementHandle();
  const oldMain = await page.locator('main').elementHandle();
  await page.evaluate(() => { (window as any).__portalMotion.hold = true; });
  const before = await page.locator('.mc-navigation-marker').boundingBox();
  const teamLink = page.locator('.mc-top-primary').getByRole('link', { name: '团队影像库', exact: true });
  await teamLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.mc-team-list-row')).toHaveCount(2);
  await expect(teamLink).toBeFocused();
  expect(await header!.evaluate(node => node === document.querySelector('.mc-topbar') && node.isConnected)).toBe(true);
  expect(await oldMain!.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.locator('main')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.id === 'mc-navigation').length)).toBeGreaterThan(0);
  const target = await teamLink.boundingBox();
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) if (animation.id === 'mc-navigation' || animation.id === 'mc-route-content') animation.currentTime = 80;
  });
  const middle = await page.locator('.mc-navigation-marker').boundingBox();
  expect(middle!.x).toBeGreaterThan(before!.x + 1);
  expect(middle!.x).toBeLessThan(target!.x - 0.1);
  const opacity = await page.locator('main').evaluate(node => Number(getComputedStyle(node).opacity));
  expect(opacity).toBeGreaterThan(0.88);
  expect(opacity).toBeLessThan(1);
  await capture(page, `${width}-navigation-midframe`);
  await expect(teamLink).toBeEnabled();
  await page.locator('.mc-team-list-row').filter({ hasText: 'TM-A' }).click();
  await expect(page.getByRole('heading', { name: fixture.teams[0].name, exact: true })).toBeVisible();
  await page.locator('.mc-top-primary').getByRole('link', { name: '完整资料库', exact: true }).click();
  await expect(page.getByTestId('home-entry-library')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('home-entry-work').click();
  await page.getByTestId('home-entry-library').click();
  await expect(page).toHaveURL(/\/home\?view=library/);
  await page.goBack();
  await expect(page.getByTestId('home-entry-work')).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(page.getByTestId('home-entry-library')).toHaveAttribute('aria-current', 'page');
  expect(await header!.evaluate(node => node === document.querySelector('.mc-topbar'))).toBe(true);
  await page.evaluate(() => {
    (window as any).__portalMotion.hold = false;
    for (const animation of document.getAnimations()) if (['mc-navigation', 'mc-route-content'].includes(animation.id)) animation.finish();
  });
  const count = await page.evaluate(() => (window as any).__portalMotion.records.length);
  await page.evaluate(() => scrollTo(0, 80));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).__portalMotion.records.length)).toBe(count);
  const evidence = await page.evaluate(() => (window as any).__portalMotion.records);
  expect(evidence.every((entry: { duration: number }) => entry.duration <= 240)).toBe(true);
  const directory = path.resolve('.runtime/portal-continuity', process.env.CONTINUITY_ROUND || 'first');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${width}-motion.json`), JSON.stringify({ before, middle, target, opacity, animations: evidence }, null, 2));
  expect(fixture.calls.filter(call => call.method !== 'GET')).toEqual([]);
});

test('reduced motion uses short tonal feedback instead of moving the navigation marker', async ({ page }) => {
  await staticCandidate(page);
  await teamFavoriteFixture(page);
  await observeMotion(page, true);
  await page.goto('/home?view=work');
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  await page.locator('.mc-top-primary').getByRole('link', { name: '团队影像库', exact: true }).click();
  await expect(page.locator('.mc-team-list-row')).toHaveCount(2);
  const records = await page.evaluate(() => (window as any).__portalMotion.records);
  expect(records.length).toBeGreaterThan(0);
  expect(records.every((entry: { duration: number; frames: Keyframe[] }) =>
    entry.duration <= 90 && entry.frames.every(frame => !('transform' in frame)))).toBe(true);
});

test('unpaused navigation produces real intermediate browser frames and settles without replay on scroll', async ({ page }) => {
  await staticCandidate(page);
  await teamFavoriteFixture(page);
  await observeMotion(page);
  await page.goto('/home?view=work');
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  const frames = await page.evaluate(async () => {
    const samples: { at: number; x: number; opacity: number }[] = [];
    const start = performance.now();
    (document.querySelector('.mc-top-primary a[href="/teams"]') as HTMLElement).click();
    for (let index = 0; index < 120; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      samples.push({
        at: performance.now() - start,
        x: document.querySelector('.mc-navigation-marker')!.getBoundingClientRect().x,
        opacity: Number(getComputedStyle(document.querySelector('main')!).opacity),
      });
      const elapsed = performance.now() - start;
      const moving = document.getAnimations().some(animation => ['mc-navigation', 'mc-route-content'].includes(animation.id));
      if ((elapsed >= 500 && !moving) || elapsed >= 1000) break;
    }
    return samples;
  });
  const target = await page.locator('.mc-top-primary [aria-current="page"]').boundingBox();
  const directory = path.resolve('.runtime/portal-continuity', process.env.CONTINUITY_ROUND || 'first');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'unpaused-frames.json'), JSON.stringify(frames, null, 2));
  const changing = new Set(frames.map(frame => Math.round(frame.x * 10)));
  expect(changing.size).toBeGreaterThan(3);
  expect(frames.some(frame => frame.opacity > 0.88 && frame.opacity < 1)).toBe(true);
  expect(Math.abs(frames.at(-1)!.x - target!.x)).toBeLessThan(0.5);
  expect(await page.evaluate(() => document.getAnimations().filter(animation => ['mc-navigation', 'mc-route-content'].includes(animation.id)).length)).toBe(0);
});

for (const status of ['account', 401, 403] as const) test(`private content is removed immediately during held route motion on ${status}`, async ({ page }) => {
  await staticCandidate(page);
  const fixture = await teamFavoriteFixture(page, typeof status === 'number' ? { blockedWrite: status } : {});
  await observeMotion(page);
  await page.goto('/teams?team=TM-A');
  await expect(page.getByTestId('team-favorite')).toBeEnabled();
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) if (animation.id === 'mc-route-content') { animation.pause(); animation.currentTime = 30; }
  });
  const oldRow = await page.locator('.mc-team-data-row').elementHandle();
  if (status === 'account') fixture.changeAccount();
  await page.getByTestId('team-favorite').click();
  await expect(page.locator('.mc-team-data-row')).toHaveCount(0);
  expect(await oldRow!.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.locator('main')).toHaveCount(1);
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.id === 'mc-route-content').length)).toBe(0);
  expect(fixture.calls.filter(call => call.method === 'PUT')).toHaveLength(status === 'account' ? 0 : 1);
});

for (const status of [401, 403]) test(`personal ${status} removes private content and the old header identity without an exit`, async ({ page }) => {
  await staticCandidate(page);
  await teamFavoriteFixture(page);
  await observeMotion(page);
  let writes = 0;
  await page.route('**/api/me/favorite-datasets/personal-copy', route => {
    writes++;
    return route.fulfill({ status, json: {} });
  });
  await page.goto('/home?view=library');
  await expect(page.getByTestId('home-favorite').first()).toBeEnabled();
  await expect(page.getByTestId('home-account')).toHaveText('测试成员');
  const oldRow = await page.getByTestId('home-dataset-row').first().elementHandle();
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) if (animation.id === 'mc-route-content') { animation.pause(); animation.currentTime = 30; }
  });
  await page.getByTestId('home-favorite').first().click();
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(0);
  await expect(page.getByTestId('home-account')).not.toContainText('测试成员');
  expect(await oldRow!.evaluate(node => node.isConnected)).toBe(false);
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.id === 'mc-route-content').length)).toBe(0);
  expect(writes).toBe(1);
});
