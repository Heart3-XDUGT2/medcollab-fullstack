import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { motionFixture } from './helpers/motion-fixture';

const directory = path.resolve(
  '.runtime/home-section-motion',
  process.env.MOTION_ROUND || 'round-1'
);
async function shot(page: Page, name: string, full = false) {
  if (process.env.MOTION_SCREENSHOTS !== '1') return;
  await fs.mkdir(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(directory, name + '.png'),
    fullPage: full,
    animations: 'allow',
  });
}
async function ready(page: Page) {
  await expect(page.getByTestId('work-favorite-record')).toHaveCount(2);
  await expect(page.getByTestId('work-recent-record')).toHaveCount(2);
  await expect
    .poll(
      () =>
        page.getByTestId('dataset-coverage').evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const box = node.getBoundingClientRect();
              return box.top < innerHeight && box.bottom > 0;
            })
            .every((node) => node.getAttribute('data-status') === 'ready')
        ),
      { timeout: 15000 }
    )
    .toBe(true);
}
async function assertBoundaries(page: Page, width: number) {
  for (const module of ['library', 'continue', 'favorites', 'recent', 'teams']) {
    const header = page.getByTestId(`work-module-${module}`).locator(':scope > header');
    await expect(header).toBeVisible();
    const style = await header.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      fontSize: parseFloat(getComputedStyle(element.querySelector('h2')!).fontSize),
    }));
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(style.fontSize).toBeGreaterThanOrEqual(15);
  }
  const selected = page.getByTestId('work-continue-target');
  await expect(selected).toHaveAttribute('aria-labelledby', 'work-continue-title');
  await expect(selected).toContainText('跨中心腹部影像一致性研究');
  await expect(selected.getByTestId('dataset-coverage')).toHaveCount(1);
  await expect(selected.locator('.mc-resource-card')).toHaveCount(0);
  await expect(page.getByTestId('work-module-continue')).toHaveCSS('background-color', 'rgb(240, 245, 243)');
  await expect(selected.locator('summary')).toContainText('共享画布');
  await expect(selected.locator('summary')).toContainText('已归档');
}
async function pauseReflow(page: Page) {
  return page.evaluate(() => {
    const animations = document.getAnimations().filter((animation) => animation.id === 'mc-reflow');
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = Number(animation.effect!.getComputedTiming().duration) * 0.45;
    }
    return animations.map((animation) => ({
      duration: animation.effect!.getComputedTiming().duration,
      frames: animation.effect!.getKeyframes(),
      currentTime: animation.currentTime,
    }));
  });
}
async function finishMotion(page: Page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (animation.id.startsWith('mc-')) animation.finish();
    }
  });
}

for (const width of [1440, 768, 390]) {
  test(`real-ready hierarchy, filter continuity, interruption and menu at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const fixture = await motionFixture(page);
    await page.goto('/home');
    await ready(page);
    await assertBoundaries(page, width);
    expect(
      await page.evaluate(() => document.getAnimations().filter((a) => a.id === 'mc-reflow').length)
    ).toBe(0);
    await shot(page, `${width}-real-ready`);
    await shot(page, `${width}-real-ready-full`, true);
    const hadVisibleRecords = await page.getByTestId('home-dataset-row').evaluateAll(nodes =>
      nodes.some(node => {
        const box = node.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      })
    );
    await page.getByTestId('home-scope-owner').click();
    if (hadVisibleRecords) await expect
      .poll(() =>
        page.evaluate(() => document.getAnimations().filter((a) => a.id === 'mc-reflow').length)
      )
      .toBeGreaterThan(0);
    const evidence = await pauseReflow(page);
    expect(evidence.every((animation) => animation.frames.every((frame) => !frame.transform))).toBe(
      true
    );
    expect(evidence.every((animation) => Number(animation.duration) <= 260)).toBe(true);
    await shot(page, `${width}-filter-midpoint`);
    await finishMotion(page);
    for (const scope of ['all', 'public', 'owner', 'shared'])
      await page.getByTestId(`home-scope-${scope}`).click();
    await expect(page.getByTestId('home-dataset-row')).toHaveCount(4);
    for (const row of await page.getByTestId('home-dataset-row').all())
      await expect(row).toContainText('与我共享');
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(() => document.getAnimations().filter((a) => a.id === 'mc-reflow').length)
    ).toBe(0);
    await page.evaluate(() => scrollTo(0, 400));
    await page.evaluate(() => scrollTo(0, 0));
    expect(
      await page.evaluate(() => document.getAnimations().filter((a) => a.id === 'mc-reflow').length)
    ).toBe(0);
    await page.getByTestId('home-dataset-more').first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await shot(page, `${width}-menu`);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByTestId('home-dataset-select').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('home-detail')).toBeVisible();
    expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
    if (process.env.MOTION_SCREENSHOTS === '1')
      await fs.writeFile(
        path.join(directory, `${width}-motion.json`),
        JSON.stringify(
          {
            width,
            filterAnimations: evidence,
            rapidFinalScope: 'shared',
            noScrollReplay: true,
            apiWrites: 0,
          },
          null,
          2
        )
      );
  });

  test(`small fully-visible list movement retains spatial continuity at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await motionFixture(page);
    await page.goto('/home?view=library');
    await page.getByRole('button', { name: '对比表格', exact: true }).click();
    await page.getByTestId('home-display-preferences').click();
    const settings = page.getByTestId('home-display-preferences-panel');
    await settings.getByRole('radio', { name: '紧凑', exact: true }).check();
    await settings.getByRole('checkbox', { name: '创建者', exact: true }).uncheck();
    await settings.getByRole('checkbox', { name: '创建时间', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    const row = page.locator('[data-motion-item="dataset:motion-1"]');
    await expect(row.getByTestId('dataset-coverage')).toHaveAttribute('data-status', 'ready', {
      timeout: 15000,
    });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(350);
    const before = await row.boundingBox();
    expect(before!.y).toBeGreaterThanOrEqual(0);
    expect(before!.y + before!.height).toBeLessThanOrEqual(width === 390 ? 844 : 960);
    await page.getByTestId('home-scope-shared').click();
    const evidence = await pauseReflow(page);
    expect(
      evidence.some((animation) =>
        animation.frames.some((frame) => !!frame.transform && String(frame.zIndex) === '2')
      )
    ).toBe(true);
    await shot(page, `${width}-small-reflow-midpoint`);
    await finishMotion(page);
    if (process.env.MOTION_SCREENSHOTS === '1')
      await fs.writeFile(
        path.join(directory, `${width}-small-motion.json`),
        JSON.stringify({ width, smallVisibleMovement: evidence, before }, null, 2)
      );
  });

  test(`reduced-motion feedback and keyboard disclosure at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await motionFixture(page);
    await page.goto('/home');
    await ready(page);
    await page.getByTestId('home-scope-owner').click();
    const evidence = await pauseReflow(page);
    expect(evidence.every((animation) => animation.frames.every((frame) => !frame.transform))).toBe(
      true
    );
    await finishMotion(page);
    const summary = page.getByTestId('work-module-library').getByTestId('coverage-summary').first();
    await summary.focus();
    await page.keyboard.press('Space');
    const disclosure = summary.locator('..');
    await expect(disclosure).toHaveAttribute('open', '');
    await expect(disclosure.locator('.mc-coverage-expanded')).toContainText('20 / 120 帧');
    await page.keyboard.press('Space');
    await expect(disclosure).not.toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(disclosure).toHaveAttribute('open', '');
    const disclosureMotion = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.id === 'mc-disclosure')
        .map((animation) => animation.effect!.getKeyframes())
    );
    expect(disclosureMotion.every((frames) => frames.every((frame) => !frame.transform))).toBe(
      true
    );
    await finishMotion(page);
    await shot(page, `${width}-reduced-motion`);
    await shot(page, `${width}-reduced-motion-full`, true);
  });

  for (const state of ['demo', 'empty', 'failed'] as const) {
    test(`${state} module boundaries without fabricated data at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const fixture = await motionFixture(page, {
        demo: state === 'demo',
        count: state === 'empty' ? 0 : 12,
        failed: state === 'failed',
      });
      await page.goto('/home');
      if (state === 'demo') await page.getByTestId('home-enter-demo').click();
      await expect(page.getByTestId('work-home')).toBeVisible();
      if (state === 'failed') {
        await expect(page.getByTestId('work-module-favorites')).toContainText('收藏暂时无法读取');
        await expect(page.getByTestId('work-module-recent')).toContainText('最近记录暂时无法读取');
      }
      if (state === 'empty') {
        await expect(page.getByTestId('work-module-favorites')).not.toHaveClass(/is-unavailable/);
        await expect(page.getByTestId('work-module-recent')).not.toHaveClass(/is-unavailable/);
        await expect(page.getByTestId('home-dataset-row')).toHaveCount(0);
        await expect(page.getByTestId('home-scope-all')).toContainText('0');
      }
      for (const module of ['favorites', 'recent', 'teams'])
        await expect(
          page.getByTestId(`work-module-${module}`).locator(':scope > header')
        ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false
      );
      await shot(page, `${width}-${state}`);
      await shot(page, `${width}-${state}-full`, true);
      expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }
}

test('only confirmed real favorite state gets feedback; a pending request is not animated as success', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const fixture = await motionFixture(page);
  await page.goto('/home');
  await ready(page);
  const button = page
    .getByTestId('work-module-library')
    .getByTestId('home-dataset-row')
    .filter({ hasText: '影像研究资料 · 003' })
    .getByTestId('home-favorite');
  fixture.holdFavorite();
  try {
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(
      await button.evaluate(
        (node) => node.getAnimations().filter((a) => a.id === 'mc-confirmed-feedback').length
      )
    ).toBe(0);
    fixture.releaseFavorite();
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('work-favorite-record')).toHaveCount(3);
    expect(
      await button.evaluate((node) =>
        node.getAnimations({ subtree: true }).some((a) => a.id === 'mc-confirmed-feedback')
      )
    ).toBe(true);
    expect(fixture.calls.filter((call) => call.method !== 'GET')).toEqual([
      { method: 'PUT', path: '/api/me/favorite-datasets/motion-2' },
    ]);
  } finally {
    fixture.releaseFavorite();
  }
});

for (const width of [769, 900, 1000]) {
  test(`intermediate header handles a long account without overflow at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await motionFixture(page, { username: '跨中心联合医学影像研究协作工作账号'.repeat(5) });
    await page.goto('/home');
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false
    );
    const bar = await page.locator('.mc-topbar').boundingBox();
    const user = await page.getByRole('button', { name: '账号菜单', exact: true }).boundingBox();
    expect(user!.x + user!.width).toBeLessThanOrEqual(width);
    expect(user!.y + user!.height).toBeLessThanOrEqual(bar!.y + bar!.height);
  });
}
test('long summary text and mobile tools are in normal layout rather than overlapping absolute controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await motionFixture(page);
  await page.goto('/home');
  await ready(page);
  const geometry = await page.locator('.mc-library-heading').evaluate((element) => {
    element.querySelector('p')!.textContent =
      '跨中心研究协作资料库的可访问数据集'.repeat(4);
    const label = element.querySelector('p')!.getBoundingClientRect();
    const utilities = element.querySelector('.mc-home-utilities')!;
    const tools = utilities.getBoundingClientRect();
    return {
      overlaps: label.left < tools.right && label.right > tools.left &&
        label.top < tools.bottom && label.bottom > tools.top,
      position: getComputedStyle(utilities).position,
    };
  });
  expect(geometry.position).not.toBe('absolute');
  expect(geometry.overlaps).toBe(false);
});
test('low-end devices retain feedback without spatial reflow', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 })
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await motionFixture(page);
  await page.goto('/home');
  await ready(page);
  await page.getByTestId('home-scope-owner').click();
  const evidence = await pauseReflow(page);
  expect(evidence.every((animation) => animation.frames.every((frame) => !frame.transform))).toBe(
    true
  );
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(4);
});
