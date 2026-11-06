import type { Page } from '@playwright/test';
import { addPortalConfiguration } from '../fixtures';
import { specimens } from './approved-a-data';
import { makeSyntheticDatasetStatistics } from '../../../src/features/home/statistics/contract';

export const fidelityIdentity = { issuer: 'https://a-fidelity.example.test', subject: 'fixture-only' };
export async function approvedAFixture(page: Page) {
  const values = specimens();
  const calls: string[] = [];
  const at = '2026-11-05T08:42:00Z';
  const datasets = values.map(item => ({
    id: item.id, name: item.name, access: item.source, ownerUsername: item.creator,
    instanceCount: item.instances, createdAt: `${item.createdAt}T00:00:00Z`,
  }));
  const summary = (id: string) => ({
    ...datasets.find(item => item.id === id), scope: 'personal', teamId: null, teamName: null,
  });
  const paged = (items: unknown[]) => ({ items, total: items.length, page: 0, size: 20 });
  await addPortalConfiguration(page, { medcollab: { apiEnabled: true, authOrigin: null, workspacePath: null } });
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    calls.push(`${route.request().method()} ${pathname}`);
    if (route.request().method() !== 'GET') return route.abort();
    let json: unknown = null;
    if (pathname === '/api/session') json = { ...fidelityIdentity, loggedIn: true, username: '林知遥', csrfToken: 'synthetic-only', csrfHeaderName: 'X-Test' };
    else if (pathname === '/api/datasets') json = { items: datasets, total: datasets.length };
    else if (pathname === '/api/health') json = { status: 'UP', annotationStatsApi: 'v1', homeActivityApi: 'v1' };
    else if (pathname === '/api/teams') json = { items: [{ id: 'fixture-team', name: '联合影像研究组', role: 'member', leaderSubject: 'other', leaderUsername: '研究伙伴', memberCount: 4, createdAt: at }], total: 1 };
    else if (pathname === '/api/me/favorite-datasets') json = paged([values[0], values[3]].map(item => ({ dataset: summary(item.id), favoritedAt: at })));
    else if (pathname === '/api/me/favorite-datasets/state') json = { items: values.map(item => {
      const favorited = [values[0].id, values[3].id].includes(item.id);
      return { datasetId: item.id, favorited, favoritedAt: favorited ? at : null };
    }), total: values.length };
    else if (pathname === '/api/me/recent-datasets') json = { ...paged([values[0], values[3], values[1]].map(item => ({ dataset: summary(item.id), lastOpenedAt: at }))), generation: '11111111-1111-4111-8111-111111111111', retentionDays: 90, maxItems: 100 };
    else {
      const id = pathname.match(/^\/api\/datasets\/(.+)\/annotation-stats$/)?.[1];
      const item = values.find(value => value.id === id);
      if (item) json = makeSyntheticDatasetStatistics(item.id, { totalSlices: item.ctFrames, annotatedSlices: item.canvasFrames, publishedAnnotatedSlices: item.archiveFrames });
    }
    return route.fulfill({ status: json ? 200 : 404, json: json || { error: 'Unmocked request blocked' } });
  });
  return { calls };
}
