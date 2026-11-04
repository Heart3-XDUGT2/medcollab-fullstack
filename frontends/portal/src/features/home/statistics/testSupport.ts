import { vi } from 'vitest';
import { makeSyntheticDatasetStatistics } from './contract';
import type { StatisticsOptions } from './store';

export const identity = { issuer: 'fixture-issuer', subject: 'fixture-subject' };
export const session = () => Promise.resolve({ loggedIn: true, ...identity });
export const dataset = (id = 'd', annotated = 4, published = 3, total = 10) =>
  makeSyntheticDatasetStatistics(id, {
    totalSlices: total,
    annotatedSlices: annotated,
    publishedAnnotatedSlices: published,
  });
export const resource = (datasetId = 'd') => ({ type: 'dataset' as const, datasetId });
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
export const realOptions = (
  fetchImpl: typeof fetch,
  rest: Partial<StatisticsOptions> = {}
): StatisticsOptions => ({
  mode: 'real',
  apiEnabled: true,
  identity,
  sessionApi: { getSession: session },
  fetchImpl,
  ...rest,
});
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function flush() {
  for (let i = 0; i < 150; i++) await Promise.resolve();
}
export const normalFetch = () =>
  vi.fn<typeof fetch>(async (path) =>
    String(path) === '/api/health'
      ? json({ annotationStatsApi: 'v1' })
      : json(dataset(decodeURIComponent(String(path).split('/')[3])))
  );
export const personal = () => ({
  statisticVersion: 1,
  countingMethod: 'accepted-mask-edit-operation',
  scope: 'server-accepted-collaboration-history',
  historyIncluded: true,
  totalStrokes: 120,
  totalAcceptedOperations: 128,
  paintOperations: 100,
  eraseOperations: 25,
  mixedOperations: 5,
  editedSliceCount: 30,
  everPaintedSliceCount: 28,
  editedDatasetCount: 3,
  editedSeriesCount: 4,
  firstEditAt: '2026-11-02T08:00:00Z',
  lastEditAt: '2026-11-03T11:00:00Z',
  generatedAt: '2026-11-03T11:30:00Z',
});
