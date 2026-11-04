import { afterEach, describe, expect, test, vi } from 'vitest';
import { abortRace, createStatisticsApi, STATISTICS_TIMEOUT_MS } from './api';
import { dataset, deferred, flush, identity, json, personal, session } from './testSupport';

afterEach(() => vi.useRealTimers());
const signal = () => new AbortController().signal;
describe('read-only statistics API', () => {
  test('uses only exact encoded GET paths and cookie/no-store/redirect protection', async () => {
    const id = '集 /?#',
      seriesId = '序列 /?#';
    const data = dataset(id);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ annotationStatsApi: 'v1' }))
      .mockResolvedValueOnce(json(data))
      .mockResolvedValueOnce(json({ ...data.series[0], seriesId }))
      .mockResolvedValueOnce(json(personal()));
    const api = createStatisticsApi({ identity, sessionApi: { getSession: session }, fetchImpl });
    expect(await api.capability(signal())).toBe(true);
    await api.read({ type: 'dataset', datasetId: id }, signal());
    await api.read({ type: 'series', datasetId: id, seriesId }, signal());
    await api.read({ type: 'personal' }, signal());
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      '/api/health',
      `/api/datasets/${encodeURIComponent(id)}/annotation-stats`,
      `/api/datasets/${encodeURIComponent(id)}/segmentations/${encodeURIComponent(seriesId)}/stats`,
      '/api/me/annotation-stats',
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(init?.headers).toBeUndefined();
      expect(init?.body).toBeUndefined();
    }
  });
  test.each([{}, { annotationStatsApi: 'v0' }, { annotationStatsApi: true }])(
    'requires exact v1 health marker %j',
    async (body) => {
      const api = createStatisticsApi({
        identity,
        sessionApi: { getSession: session },
        fetchImpl: vi.fn().mockResolvedValue(json(body)),
      });
      expect(await api.capability(signal())).toBe(false);
    }
  );
  test('health 404 is unsupported and does not echo raw response errors', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: 'SECRET' }, 404))
      .mockResolvedValueOnce(json({ error: 'SECRET' }, 500));
    const api = createStatisticsApi({ identity, sessionApi: { getSession: session }, fetchImpl });
    expect(await api.capability(signal())).toBe(false);
    await expect(api.read({ type: 'personal' }, signal())).rejects.toMatchObject({
      kind: 'http',
      status: 500,
      stage: 'statistics',
    });
  });
  test.each([
    () => new Response('<html>SECRET</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('not json', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('{}', { headers: { 'Content-Length': '2097153' } }),
    () => new Response(' '.repeat(2097153)),
  ])('rejects malformed/HTML/oversized bodies without echoing them', async (response) => {
    const api = createStatisticsApi({
      identity,
      sessionApi: { getSession: session },
      fetchImpl: vi.fn().mockResolvedValue(response()),
    });
    await expect(api.read({ type: 'personal' }, signal())).rejects.toMatchObject({
      kind: 'protocol',
    });
  });
  test('aborts a hanging stream and cancels the body', async () => {
    const cancel = vi.fn(),
      controller = new AbortController();
    const api = createStatisticsApi({
      identity,
      sessionApi: { getSession: session },
      fetchImpl: vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))),
    });
    const pending = api.read({ type: 'personal' }, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    await flush();
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
  test('rejects promptly and cancels a late fetch body even if fetch ignores abort', async () => {
    const late = deferred<Response>(),
      controller = new AbortController(),
      cancel = vi.fn();
    const api = createStatisticsApi({
      identity,
      sessionApi: { getSession: session },
      fetchImpl: vi.fn().mockReturnValue(late.promise),
    });
    const pending = api.read({ type: 'personal' }, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    controller.abort();
    await assertion;
    late.resolve(new Response(new ReadableStream({ cancel })));
    await flush();
    expect(cancel).toHaveBeenCalledOnce();
  });
  test('bounds cold reads, health and session even when underlying promises never settle', async () => {
    vi.useFakeTimers();
    const never = () => new Promise<never>(() => {});
    const api = createStatisticsApi({
      identity,
      sessionApi: { getSession: never },
      fetchImpl: vi.fn().mockImplementation(never),
    });
    const stats = expect(api.read({ type: 'personal' }, signal())).rejects.toMatchObject({
      kind: 'timeout',
      stage: 'statistics',
    });
    const health = expect(api.capability(signal())).rejects.toMatchObject({
      kind: 'timeout',
      stage: 'health',
    });
    const account = expect(api.verifyIdentity(signal())).rejects.toMatchObject({
      kind: 'timeout',
      stage: 'session',
    });
    await vi.advanceTimersByTimeAsync(STATISTICS_TIMEOUT_MS);
    await Promise.all([stats, health, account]);
    expect(vi.getTimerCount()).toBe(0);
  });
  test('identity is issuer + subject, cancellation ignores late session and network text', async () => {
    const late = deferred<Awaited<ReturnType<typeof session>>>(),
      controller = new AbortController();
    const api = createStatisticsApi({
      identity,
      sessionApi: { getSession: vi.fn().mockReturnValue(late.promise) },
    });
    const assertion = expect(api.verifyIdentity(controller.signal)).rejects.toMatchObject({
      kind: 'cancelled',
    });
    controller.abort();
    await assertion;
    late.resolve({ loggedIn: true, ...identity });
    await flush();
    const changed = createStatisticsApi({
      identity,
      sessionApi: { getSession: async () => ({ loggedIn: true, ...identity, issuer: 'other' }) },
    });
    await expect(changed.verifyIdentity(signal())).rejects.toMatchObject({
      kind: 'identity',
      status: 401,
    });
    const failed = createStatisticsApi({
      identity,
      sessionApi: {
        getSession: async () => {
          throw new Error('SECRET');
        },
      },
    });
    await expect(failed.verifyIdentity(signal())).rejects.not.toThrow('SECRET');
    await expect(
      abortRace(Promise.reject(new Error('late')), controller.signal)
    ).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
