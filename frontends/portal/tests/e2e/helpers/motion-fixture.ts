import type { Page } from '@playwright/test';
import { addPortalConfiguration } from '../fixtures';

export async function motionFixture(
  page: Page,
  options: {
    count?: number;
    demo?: boolean;
    failed?: boolean;
    username?: string;
  } = {}
) {
  const calls: { method: string; path: string }[] = [];
  const count = options.count ?? 12;
  const values = Array.from({ length: count }, (_, index) => ({
    id: `motion-${index}`,
    name:
      index === 3
        ? '跨中心腹部影像一致性研究 · 第三轮补充与复核资料集 · 004'
        : `影像研究资料 · ${String(index + 1).padStart(3, '0')}`,
    access: ['owner', 'shared', 'public'][index % 3],
    ownerUsername: ['林知遥', '陈予安', '公共影像'][index % 3],
    instanceCount: 600 + index * 10,
    createdAt: '2026-11-01T00:00:00Z',
  }));
  const favorites = new Set(
    ['motion-0', 'motion-3'].filter((id) => values.some((item) => item.id === id))
  );
  let recent = ['motion-3', 'motion-1'].filter((id) => values.some((item) => item.id === id));
  let releaseFavorite: (() => void) | null = null;
  let favoriteGate: Promise<void> | null = null;
  const at = '2026-11-05T10:00:00Z';
  const summary = (id: string) => ({
    ...values.find((item) => item.id === id),
    scope: 'personal',
    teamId: null,
    teamName: null,
  });
  const pageOf = (items: unknown[]) => ({ items, total: items.length, page: 0, size: 20 });
  const progress = (total: number, annotated: number) => ({
    totalSlices: total,
    annotatedSlices: annotated,
    unannotatedSlices: total - annotated,
    ratio: total ? annotated / total : 0,
    percent: total ? Math.round((annotated / total) * 10000) / 100 : 0,
  });
  await addPortalConfiguration(page, {
    medcollab: {
      apiEnabled: !options.demo,
      authOrigin: 'http://127.0.0.1:60833',
      logoutOrigins: [],
      workspacePath: null,
    },
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      pathname = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path: pathname });
    const item = pathname.match(/^\/api\/me\/favorite-datasets\/(motion-\d+)$/);
    if (item && ['PUT', 'DELETE'].includes(request.method())) {
      if (favoriteGate) await favoriteGate;
      if (request.headers()['x-motion-csrf'] !== 'synthetic-not-a-token')
        return route.fulfill({ status: 403, json: {} });
      const active = request.method() === 'PUT';
      if (active) favorites.add(item[1]);
      else favorites.delete(item[1]);
      return route.fulfill({
        json: {
          success: true,
          datasetId: item[1],
          favorited: active,
          favoritedAt: active ? at : null,
        },
      });
    }
    const recentItem = pathname.match(/^\/api\/me\/recent-datasets\/(motion-\d+)$/);
    if (request.method() === 'DELETE' && (recentItem || pathname === '/api/me/recent-datasets')) {
      recent = recentItem ? recent.filter((id) => id !== recentItem[1]) : [];
      return route.fulfill({
        json: { success: true, generation: '22222222-2222-4222-8222-222222222222' },
      });
    }
    if (pathname.startsWith('/api/me/') && options.failed)
      return route.fulfill({ status: 503, json: { error: 'Synthetic unavailable' } });
    if (pathname === '/api/me/favorite-datasets')
      return route.fulfill({
        json: pageOf([...favorites].map((id) => ({ dataset: summary(id), favoritedAt: at }))),
      });
    if (pathname === '/api/me/favorite-datasets/state')
      return route.fulfill({
        json: {
          items: values.map((value) => ({
            datasetId: value.id,
            favorited: favorites.has(value.id),
            favoritedAt: favorites.has(value.id) ? at : null,
          })),
          total: values.length,
        },
      });
    if (pathname === '/api/me/recent-datasets')
      return route.fulfill({
        json: {
          ...pageOf(recent.map((id) => ({ dataset: summary(id), lastOpenedAt: at }))),
          generation: '11111111-1111-4111-8111-111111111111',
          retentionDays: 90,
          maxItems: 100,
        },
      });
    const stats = pathname.match(/^\/api\/datasets\/(motion-\d+)\/annotation-stats$/);
    if (stats) {
      if (options.failed) return route.fulfill({ status: 503, json: {} });
      const id = stats[1],
        total = Number(id.split('-')[1]) % 3 === 2 ? 0 : 120;
      const current = progress(total, total ? 20 : 0),
        archived = progress(total, total ? 12 : 0);
      return route.fulfill({
        json: {
          datasetId: id,
          completionMethod: 'nonempty-mask-slices/ct-slices',
          seriesCount: total ? 1 : 0,
          progress: current,
          publishedProgress: archived,
          pendingArchive: !!total,
          generatedAt: at,
          series: total
            ? [
                {
                  datasetId: id,
                  seriesId: 'synthetic-series',
                  progress: current,
                  publishedProgress: archived,
                  seq: 8,
                  throughSeq: 5,
                  publishedVersion: 2,
                  pendingArchive: true,
                  archiveError: '',
                },
              ]
            : [],
        },
      });
    }
    const body =
      pathname === '/api/session'
        ? {
            loggedIn: true,
            username: options.username || '林知遥',
            issuer: 'https://motion-fixture.example.test',
            subject: 'motion-account',
            csrfToken: 'synthetic-not-a-token',
            csrfHeaderName: 'X-Motion-CSRF',
          }
        : pathname === '/api/datasets'
          ? { items: values, total: values.length }
          : pathname === '/api/teams'
            ? {
                items: count
                  ? [
                      {
                        id: 'motion-team',
                        name: '联合影像研究组',
                        leaderSubject: 'motion-other',
                        leaderUsername: '研究伙伴',
                        memberCount: 4,
                        role: 'member',
                        createdAt: at,
                      },
                    ]
                  : [],
                total: count ? 1 : 0,
              }
            : pathname === '/api/health'
              ? { status: 'UP', annotationStatsApi: 'v1', homeActivityApi: 'v1' }
              : null;
    return route.fulfill({ status: body ? 200 : 404, json: body || {} });
  });
  return {
    calls,
    holdFavorite() {
      favoriteGate = new Promise((resolve) => {
        releaseFavorite = resolve;
      });
    },
    releaseFavorite() {
      releaseFavorite?.();
      favoriteGate = null;
    },
  };
}
