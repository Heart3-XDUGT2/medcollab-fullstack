import { expect, test } from './fixtures';
import { motionFixture } from './helpers/motion-fixture';

test('primary view changes update the deep link and browser back restores the prior view', async ({ page }) => {
  await motionFixture(page);
  await page.goto('/home?view=work');
  await expect(page.getByTestId('work-home')).toBeVisible();
  await page.getByTestId('home-entry-library').click();
  await expect(page).toHaveURL(/view=library/);
  await page.goBack();
  await expect(page.getByTestId('work-home')).toBeVisible();
  await expect(page.getByTestId('home-entry-work')).toHaveAttribute('aria-pressed', 'true');
});

test('source changes participate in history instead of leaving a stale scope deep link', async ({ page }) => {
  await motionFixture(page);
  await page.goto('/home?view=library&scope=owner');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(4);
  await page.getByTestId('home-scope-shared').click();
  await expect(page).toHaveURL(/scope=shared/);
  await page.goBack();
  await expect(page.getByTestId('home-scope-owner')).toHaveAttribute('aria-pressed', 'true');
  for (const row of await page.getByTestId('home-dataset-row').all()) await expect(row).toContainText('我拥有的');
});

test('returning from teams restores the verified account library search, sort and selection without putting them in the URL', async ({ page }) => {
  await motionFixture(page);
  await page.goto('/home?view=library&scope=owner');
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(4);
  await page.getByTestId('home-search').fill('004');
  await page.getByTestId('home-sort').selectOption('name');
  await page.getByTestId('home-dataset-select').click();
  await page.getByRole('button', { name: '关闭资料概览', exact: true }).click();
  await page.locator('.mc-top-primary').getByRole('link', { name: '团队影像库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的团队', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('home-search')).toHaveValue('004');
  await expect(page.getByTestId('home-sort')).toHaveValue('name');
  await expect(page.getByTestId('home-dataset-select')).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(page.url()).searchParams.has('search')).toBe(false);
  expect(new URL(page.url()).searchParams.has('selectedId')).toBe(false);
});

test('a different verified account cannot restore the previous account private query or selection', async ({ page }) => {
  await motionFixture(page);
  await page.goto('/home?view=library');
  await page.getByTestId('home-search').fill('004');
  await page.getByTestId('home-dataset-select').click();
  await page.getByRole('button', { name: '关闭资料概览', exact: true }).click();
  await page.locator('.mc-top-primary').getByRole('link', { name: '团队影像库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的团队', exact: true })).toBeVisible();
  await page.route('**/api/session', route => route.fulfill({ json: {
    loggedIn: true, username: '另一研究员', issuer: 'https://motion-fixture.example.test',
    subject: 'other-account', csrfToken: 'synthetic-other', csrfHeaderName: 'X-Motion-CSRF',
  } }));
  await page.goBack();
  await expect(page.getByTestId('home-search')).toHaveValue('');
  await expect(page.locator('[data-cy="home-dataset-select"][aria-pressed="true"]')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('search')).toBe(false);
});

test('an explicit work view remains work with a source scope after teams and back', async ({ page }) => {
  await motionFixture(page);
  await page.goto('/home?view=work&scope=shared');
  await expect(page.getByTestId('work-home')).toBeVisible();
  await page.locator('.mc-top-primary').getByRole('link', { name: '团队影像库', exact: true }).click();
  await page.goBack();
  await expect(page.getByTestId('work-home')).toBeVisible();
  await expect(page.getByTestId('home-scope-shared')).toHaveAttribute('aria-pressed', 'true');
});

test('team detail return removes the team deep link so reload remains on the index', async ({ page }) => {
  await motionFixture(page);
  await page.route('**/api/teams/motion-team', route => route.fulfill({ json: {
    id: 'motion-team', name: '联合影像研究组', leaderSubject: 'motion-other', leaderUsername: '研究伙伴',
    memberCount: 4, role: 'member', createdAt: '2026-11-05T10:00:00Z',
  } }));
  await page.route('**/api/teams/motion-team/members', route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/teams/motion-team/datasets', route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.goto('/teams?team=motion-team');
  await expect(page.getByRole('heading', { name: '联合影像研究组', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '我的团队', exact: true }).click();
  expect(new URL(page.url()).searchParams.has('team')).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的团队', exact: true })).toBeVisible();
  await page.locator('.mc-team-list-row').click();
  await expect(page).toHaveURL(/team=motion-team/);
  await expect(page.getByRole('heading', { name: '联合影像研究组', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '我的团队', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: '联合影像研究组', exact: true })).toBeVisible();
});

test('browsing all visible work-home resources clears an unrelated hidden library search', async ({ page }) => {
  await motionFixture(page);
  await page.goto('/home?view=library');
  await page.getByTestId('home-search').fill('not-a-present-dataset');
  await expect(page.getByTestId('home-empty')).toBeVisible();
  await page.getByTestId('home-entry-work').click();
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(6);
  await page.locator('.mc-work-dataset-preview > footer > button').click();
  await expect(page.getByTestId('home-dataset-row')).toHaveCount(12);
  await expect(page.getByTestId('home-search')).toHaveValue('');
});
