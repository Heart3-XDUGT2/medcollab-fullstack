import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { addPortalConfiguration } from '../fixtures';
import { DEFAULT_HOME_PREFERENCES } from '../../../src/features/home/preferences/model';

export async function sparseDeskFixture(page: Page, options: {
  count?: number; supported?: boolean; favorited?: boolean; longName?: boolean;
} = {}) {
  const count = options.count ?? 1, supported = options.supported ?? false;
  const identity = { issuer: 'https://sparse-desk-fixture.example.test', subject: 'synthetic-only' };
  const at = '2026-11-06T00:00:00Z';
  let favorited = options.favorited ?? false;
  const values = Array.from({ length: count }, (_, index) => ({
    id: `sparse-${index}`, name: index === 0 ? (options.longName ? '跨中心骨骼影像一致性研究 · 第三轮补充资料与联合整理' : 'bone') : `研究资料 · ${index + 1}`,
    access: 'owner', ownerUsername: '截图样例', instanceCount: index * 12, createdAt: at,
  }));
  const key = 'medcollab.home.display.v1.' + createHash('sha256').update(JSON.stringify(['medcollab-display-v1', identity.issuer, identity.subject])).digest('hex');
  const preferences = { version: 1, preferences: { ...DEFAULT_HOME_PREFERENCES, layout: 'cards', home: { defaultEntry: 'work', order: ['library', 'continue', 'favorites', 'recent', 'teams'], hidden: [] } } };
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key, raw: JSON.stringify(preferences) });
  await addPortalConfiguration(page, { medcollab: { apiEnabled: true, authOrigin: null, workspacePath: null } });
  const calls: string[] = [];
  const paged = (items: unknown[]) => ({ items, total: items.length, page: 0, size: 20 });
  const summary = () => ({ ...values[0], scope: 'personal', teamId: null, teamName: null });
  await page.route('**/api/**', route => {
    const method = route.request().method(), pathname = new URL(route.request().url()).pathname;
    calls.push(`${method} ${pathname}`);
    if (supported && pathname === '/api/me/favorite-datasets/sparse-0' && ['PUT', 'DELETE'].includes(method)) {
      favorited = method === 'PUT';
      return route.fulfill({ json: { success: true, datasetId: 'sparse-0', favorited, favoritedAt: favorited ? at : null } });
    }
    if (method !== 'GET') return route.abort();
    if (pathname === '/api/session') return route.fulfill({ json: { loggedIn: true, ...identity, username: '截图样例', csrfToken: 'synthetic-not-a-secret', csrfHeaderName: 'X-Fixture-CSRF' } });
    if (pathname === '/api/datasets') return route.fulfill({ json: { items: values, total: values.length } });
    if (pathname === '/api/health') return route.fulfill({ json: { status: 'UP', ...(supported ? { homeActivityApi: 'v1' } : {}) } });
    if (pathname === '/api/teams') return route.fulfill({ json: { items: [{ id: 'sparse-team', name: 'test', role: 'leader', leaderSubject: identity.subject, leaderUsername: '截图样例', memberCount: 2, createdAt: at }], total: 1 } });
    if (supported && pathname === '/api/me/favorite-datasets') return route.fulfill({ json: paged(favorited && count ? [{ dataset: summary(), favoritedAt: at }] : []) });
    if (supported && pathname === '/api/me/favorite-datasets/state') return route.fulfill({ json: { items: values.map(item => ({ datasetId: item.id, favorited: item.id === 'sparse-0' && favorited, favoritedAt: item.id === 'sparse-0' && favorited ? at : null })), total: count } });
    if (supported && pathname === '/api/me/recent-datasets') return route.fulfill({ json: { ...paged([]), generation: '11111111-1111-4111-8111-111111111111', retentionDays: 90, maxItems: 100 } });
    return route.fulfill({ status: 404, json: { error: 'Synthetic missing capability endpoint' } });
  });
  return { calls, key };
}
