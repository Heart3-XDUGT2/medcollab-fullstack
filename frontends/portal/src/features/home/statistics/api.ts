import {
  parseDatasetStatistics,
  parsePersonalStatistics,
  parseSeriesStatistics,
  resourceId,
  StatisticsError,
} from './contract';
import type { StatisticsData, StatisticsResource } from './contract';

export type StatisticsIdentity = { issuer: string; subject: string };
export type StatisticsSessionApi = {
  getSession(
    signal?: AbortSignal
  ): Promise<{ loggedIn: boolean; issuer: string | null; subject: string | null }>;
};
export const STATISTICS_TIMEOUT_MS = 150000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export function abortRace<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new StatisticsError('cancelled', '统计读取已取消'));
    if (signal.aborted) {
      void promise.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then((value) => (signal.aborted ? abort() : resolve(value)), reject)
      .finally(() => signal.removeEventListener('abort', abort))
      .catch(() => {});
  });
}
async function deadline<T>(
  signal: AbortSignal,
  milliseconds: number,
  stage: 'session' | 'health' | 'statistics',
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, milliseconds);
  try {
    if (controller.signal.aborted)
      throw new StatisticsError('cancelled', '统计读取已取消', 0, stage);
    return await abortRace(operation(controller.signal), controller.signal);
  } catch (failure) {
    if (timedOut) throw new StatisticsError('timeout', '统计读取超时，可稍后重新读取', 0, stage);
    if (signal.aborted) throw new StatisticsError('cancelled', '统计读取已取消', 0, stage);
    if (failure instanceof StatisticsError) throw failure;
    throw new StatisticsError('network', '统计服务暂时无法连接', 0, stage);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
async function jsonBody(
  response: Response,
  signal: AbortSignal,
  stage: 'health' | 'statistics'
): Promise<unknown> {
  const invalid = () => new StatisticsError('protocol', '统计服务未返回有效数据', 0, stage);
  const type = response.headers.get('Content-Type');
  if (type && !/(?:application\/json|\+json)(?:;|$)/i.test(type)) {
    void response.body?.cancel().catch(() => {});
    throw invalid();
  }
  const declared = response.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw invalid();
  }
  if (!response.body) throw invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0,
    complete = false;
  try {
    while (true) {
      const next = await abortRace(reader.read(), signal);
      if (next.done) {
        complete = true;
        break;
      }
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw invalid();
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw invalid();
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function createStatisticsApi(options: {
  identity: StatisticsIdentity;
  sessionApi: StatisticsSessionApi;
  fetchImpl?: typeof fetch;
}) {
  const identity = { issuer: options.identity.issuer, subject: options.identity.subject };
  const fetcher = options.fetchImpl || globalThis.fetch;
  async function request(path: string, signal: AbortSignal, stage: 'health' | 'statistics') {
    return deadline(
      signal,
      stage === 'health' ? 10000 : STATISTICS_TIMEOUT_MS,
      stage,
      async (current) => {
        const incoming = fetcher(path, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: current,
        }).then((response) => {
          if (current.aborted) void response.body?.cancel().catch(() => {});
          return response;
        });
        const response = await abortRace(incoming, current);
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          throw new StatisticsError('http', '统计读取未完成', response.status, stage);
        }
        return jsonBody(response, current, stage);
      }
    );
  }
  async function verifyIdentity(signal: AbortSignal) {
    await deadline(signal, 15000, 'session', async (current) => {
      let session;
      try {
        session = await abortRace(options.sessionApi.getSession(current), current);
      } catch (failure) {
        if (failure instanceof StatisticsError) throw failure;
        const status =
          failure && typeof failure === 'object' && 'status' in failure
            ? Number(failure.status)
            : 0;
        throw new StatisticsError(
          status === 401 || status === 403 ? 'identity' : 'network',
          '无法确认当前统计账号',
          status,
          'session'
        );
      }
      if (
        !session ||
        !session.loggedIn ||
        session.issuer !== identity.issuer ||
        session.subject !== identity.subject
      )
        throw new StatisticsError('identity', '登录账号已变化，请重新载入', 401, 'session');
    });
  }
  async function capability(signal: AbortSignal): Promise<boolean> {
    try {
      const value = await request('/api/health', signal, 'health');
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new StatisticsError('protocol', '无法确认统计能力', 0, 'health');
      return (value as Record<string, unknown>).annotationStatsApi === 'v1';
    } catch (failure) {
      if (failure instanceof StatisticsError && failure.status === 404) return false;
      throw failure;
    }
  }
  async function read(resource: StatisticsResource, signal: AbortSignal): Promise<StatisticsData> {
    if (resource.type === 'personal')
      return parsePersonalStatistics(
        await request('/api/me/annotation-stats', signal, 'statistics')
      );
    const base = '/api/datasets/' + encodeURIComponent(resourceId(resource.datasetId));
    if (resource.type === 'dataset')
      return parseDatasetStatistics(
        await request(base + '/annotation-stats', signal, 'statistics'),
        resource.datasetId
      );
    return parseSeriesStatistics(
      await request(
        base + '/segmentations/' + encodeURIComponent(resourceId(resource.seriesId)) + '/stats',
        signal,
        'statistics'
      ),
      resource.datasetId,
      resource.seriesId
    );
  }
  return { verifyIdentity, capability, read };
}
