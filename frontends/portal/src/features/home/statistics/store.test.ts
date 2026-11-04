import { afterEach, describe, expect, test, vi } from 'vitest';
import { StatisticsModel } from './store';
import type { StatisticsOptions } from './store';
import {
  dataset,
  deferred,
  flush,
  identity,
  json,
  normalFetch,
  realOptions,
  resource,
  session,
  personal,
} from './testSupport';

const models: StatisticsModel[] = [];
function model(options: StatisticsOptions) {
  const value = new StatisticsModel(options);
  models.push(value);
  value.start();
  return value;
}
afterEach(() => {
  models.splice(0).forEach((value) => value.dispose());
  vi.useRealTimers();
});
const statsCalls = (fetcher: ReturnType<typeof normalFetch>) =>
  fetcher.mock.calls.filter(([path]) => String(path).includes('annotation-stats'));

describe('scoped statistics model', () => {
  test.each([403, 404])(
    'personal %s withdraws old totals without a dataset notification',
    async (status) => {
      let denied = false;
      const onAccessIssue = vi.fn();
      const fetcher = vi.fn<typeof fetch>(async (path) =>
        path === '/api/health'
          ? json({ annotationStatsApi: 'v1' })
          : denied
            ? json({}, status)
            : json(personal())
      );
      const value = model(realOptions(fetcher, { onAccessIssue }));
      value.watch({ type: 'personal' });
      await flush();
      expect(value.getSnapshot({ type: 'personal' }).data).toMatchObject({ totalStrokes: 120 });
      denied = true;
      value.refresh({ type: 'personal' });
      await flush();
      expect(value.getSnapshot({ type: 'personal' })).toMatchObject({
        status: status === 403 ? 'forbidden' : 'missing',
        data: null,
        stale: false,
      });
      expect(onAccessIssue).not.toHaveBeenCalled();
    }
  );
  test.each([
    { mode: 'anonymous' as const },
    { apiEnabled: false },
    { identity: null },
    { mode: 'demo' as const, demoData: { d: dataset() } },
  ])('never networks outside confirmed enabled real scope %j', async (rest) => {
    const fetcher = normalFetch(),
      value = model(realOptions(fetcher, rest));
    value.watch(resource());
    value.refreshWatched();
    value.refreshDataset('d');
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('demo validates explicit counts, leaves unknown IDs unknown, ignores prototype fixtures', async () => {
    const fetcher = normalFetch(),
      value = model(
        realOptions(fetcher, {
          mode: 'demo',
          demoData: Object.assign(Object.create({ inherited: dataset('inherited') }), {
            d: dataset(),
            broken: { ...dataset('broken'), progress: { ...dataset().progress, percent: 90 } },
          }),
        })
      );
    ['d', 'unknown', 'broken', 'inherited'].forEach((id) => value.watch(resource(id)));
    expect(value.getSnapshot(resource())).toMatchObject({ status: 'ready', source: 'synthetic' });
    expect(value.getSnapshot(resource('unknown'))).toMatchObject({
      status: 'demo-missing',
      data: null,
    });
    expect(value.getSnapshot(resource('inherited')).status).toBe('demo-missing');
    expect(value.getSnapshot(resource('broken')).status).toBe('error');
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('repeated consumers share one capability/request/cache; no polling or warm reread', async () => {
    vi.useFakeTimers();
    const fetcher = normalFetch(),
      value = model(realOptions(fetcher));
    const releaseA = value.watch(resource()),
      releaseB = value.watch(resource());
    await flush();
    expect(value.getSnapshot(resource())).toMatchObject({
      status: 'ready',
      stale: false,
      source: 'server',
    });
    expect(statsCalls(fetcher)).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/health')).toHaveLength(1);
    releaseA();
    releaseB();
    value.watch(resource());
    await flush();
    expect(statsCalls(fetcher)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120000);
    expect(statsCalls(fetcher)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    value.refreshDataset('d');
    value.refreshDataset('d');
    await flush();
    expect(statsCalls(fetcher)).toHaveLength(2);
  });
  test.each([json({}, 200), json({ annotationStatsApi: 'v0' }), json({}, 404)])(
    'old/missing health never requests statistics or reports resource loss',
    async (health) => {
      const fetcher = vi.fn<typeof fetch>(async () => health),
        onAccessIssue = vi.fn(),
        getSession = vi.fn(session);
      const value = model(realOptions(fetcher, { onAccessIssue, sessionApi: { getSession } }));
      value.watch(resource());
      await flush();
      expect(value.getSnapshot(resource())).toMatchObject({ status: 'unsupported', data: null });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(getSession).not.toHaveBeenCalled();
      expect(onAccessIssue).not.toHaveBeenCalled();
    }
  );
  test('v1 resource 404 is rechecked and notified at most once per scope', async () => {
    const fetcher = vi.fn<typeof fetch>(async (path) =>
      path === '/api/health' ? json({ annotationStatsApi: 'v1' }) : json({}, 404)
    );
    const onAccessIssue = vi.fn(),
      getSession = vi.fn(session);
    const value = model(realOptions(fetcher, { onAccessIssue, sessionApi: { getSession } }));
    value.watch(resource());
    await flush();
    expect(value.getSnapshot(resource())).toMatchObject({ status: 'missing', data: null });
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/health')).toHaveLength(2);
    expect(getSession).toHaveBeenCalledTimes(3);
    value.refreshDataset('d');
    await flush();
    expect(onAccessIssue).toHaveBeenCalledExactlyOnceWith({
      status: 404,
      resource: 'dataset',
      datasetId: 'd',
    });
  });
  test('route downgrade 404 preserves host resource and discards previous counts', async () => {
    let downgraded = false;
    const onAccessIssue = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async (path) =>
      path === '/api/health'
        ? json(downgraded ? {} : { annotationStatsApi: 'v1' })
        : downgraded
          ? json({}, 404)
          : json(dataset())
    );
    const value = model(realOptions(fetcher, { onAccessIssue }));
    value.watch(resource());
    await flush();
    downgraded = true;
    value.refreshDataset('d');
    await flush();
    expect(value.getSnapshot(resource())).toMatchObject({ status: 'unsupported', data: null });
    expect(onAccessIssue).not.toHaveBeenCalled();
  });
  test('capability downgrade also withholds cached peers and concurrent late successes', async () => {
    let downgrade = false,
      hold = false;
    const late = deferred<Response>(),
      onAccessIssue = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async (path) => {
      if (path === '/api/health') return json(downgrade ? {} : { annotationStatsApi: 'v1' });
      if (String(path).includes('/b/') && hold) return late.promise;
      return downgrade ? json({}, 404) : json(dataset(String(path).split('/')[3]));
    });
    const value = model(realOptions(fetcher, { onAccessIssue }));
    value.watch(resource('a'));
    value.watch(resource('b'));
    await flush();
    expect(value.getSnapshot(resource('b')).status).toBe('ready');
    hold = true;
    value.refreshDataset('b');
    await flush();
    downgrade = true;
    value.refreshDataset('a');
    await flush();
    expect(value.getSnapshot(resource('b'))).toMatchObject({ status: 'unsupported', data: null });
    late.resolve(json(dataset('b')));
    await flush();
    expect(value.getSnapshot(resource('b'))).toMatchObject({ status: 'unsupported', data: null });
    expect(onAccessIssue).not.toHaveBeenCalled();
  });
  test('unreachable capability recheck after resource404 withholds stale counts and notification', async () => {
    let failed = false;
    const onAccessIssue = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async (path) => {
      if (path === '/api/health') {
        if (failed) throw new Error('private');
        return json({ annotationStatsApi: 'v1' });
      }
      return failed ? json({}, 404) : json(dataset());
    });
    const value = model(realOptions(fetcher, { onAccessIssue }));
    value.watch(resource());
    await flush();
    failed = true;
    value.refreshDataset('d');
    await flush();
    expect(value.getSnapshot(resource())).toMatchObject({ status: 'error', data: null });
    expect(onAccessIssue).not.toHaveBeenCalled();
  });
  test.each([423, 500, 'malformed'] as const)(
    'transient %s retains last good value marked stale without retries',
    async (failure) => {
      vi.useFakeTimers();
      let failed = false;
      const fetcher = vi.fn<typeof fetch>(async (path) =>
        path === '/api/health'
          ? json({ annotationStatsApi: 'v1' })
          : !failed
            ? json(dataset())
            : failure === 'malformed'
              ? json({ progress: 0 })
              : json({}, failure)
      );
      const value = model(realOptions(fetcher));
      value.watch(resource());
      await flush();
      failed = true;
      value.refreshDataset('d');
      await flush();
      expect(value.getSnapshot(resource())).toMatchObject({
        status: failure === 423 ? 'busy' : 'error',
        stale: true,
        data: { progress: { annotatedSlices: 4 } },
      });
      const before = fetcher.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120000);
      await flush();
      expect(fetcher).toHaveBeenCalledTimes(before);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  test('failed identity verification never presents previous values', async () => {
    let failed = false;
    const getSession = vi.fn(async () => {
      if (failed) throw new Error('private');
      return session();
    });
    const value = model(realOptions(normalFetch(), { sessionApi: { getSession } }));
    value.watch(resource());
    await flush();
    failed = true;
    value.refreshDataset('d');
    await flush();
    expect(value.getSnapshot(resource())).toMatchObject({
      status: 'error',
      data: null,
      stale: false,
    });
  });
  test('401 clears every resource and blocks even a late concurrent response', async () => {
    const late = deferred<Response>(),
      issue = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async (path) =>
      path === '/api/health'
        ? json({ annotationStatsApi: 'v1' })
        : String(path).includes('/b/')
          ? late.promise
          : json({}, 401)
    );
    const value = model(realOptions(fetcher, { onAccessIssue: issue }));
    value.watch(resource('a'));
    value.watch(resource('b'));
    await flush();
    late.resolve(json(dataset('b')));
    await flush();
    expect(value.getSnapshot(resource('a'))).toMatchObject({
      status: 'unauthenticated',
      data: null,
    });
    expect(value.getSnapshot(resource('b'))).toMatchObject({
      status: 'unauthenticated',
      data: null,
    });
    value.refreshDataset('b');
    await flush();
    expect(issue).toHaveBeenCalledExactlyOnceWith({ status: 401, resource: 'account' });
  });
  test('post-read account change discards result and clears all cached data', async () => {
    let account = identity;
    const fetcher = normalFetch(),
      issue = vi.fn();
    const value = model(
      realOptions(fetcher, {
        sessionApi: { getSession: async () => ({ loggedIn: true, ...account }) },
        onAccessIssue: issue,
      })
    );
    value.watch(resource());
    await flush();
    account = { ...identity, subject: 'different' };
    value.refreshDataset('d');
    await flush();
    expect(value.getSnapshot(resource())).toMatchObject({ status: 'unauthenticated', data: null });
    expect(issue).toHaveBeenCalledOnce();
  });
  test.each(['dispose', 'parent'] as const)(
    '%s abort invalidates late results and cancels scheduled work',
    async (action) => {
      const late = deferred<Response>(),
        parent = new AbortController(),
        issue = vi.fn();
      const value = model(
        realOptions(
          vi.fn<typeof fetch>(async (path) =>
            path === '/api/health' ? json({ annotationStatsApi: 'v1' }) : late.promise
          ),
          {
            scopeSignal: parent.signal,
            onAccessIssue: issue,
          }
        )
      );
      value.watch(resource());
      await flush();
      action === 'dispose' ? value.dispose() : parent.abort();
      late.resolve(json(dataset()));
      await flush();
      expect(value.getSnapshot(resource())).toMatchObject({ status: 'idle', data: null });
      expect(issue).not.toHaveBeenCalled();
    }
  );
  test('last consumer aborts; rewatch within cooldown resumes once, without polling', async () => {
    vi.useFakeTimers();
    let requestedSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>(async (path, init) => {
      if (path === '/api/health') return json({ annotationStatsApi: 'v1' });
      requestedSignal = init?.signal as AbortSignal;
      if (fetcher.mock.calls.filter(([p]) => String(p).includes('annotation-stats')).length === 1)
        return new Promise<Response>(() => {});
      return json(dataset());
    });
    const value = model(realOptions(fetcher));
    const releaseA = value.watch(resource()),
      releaseB = value.watch(resource());
    await flush();
    releaseA();
    expect(requestedSignal?.aborted).toBe(false);
    releaseB();
    await flush();
    expect(requestedSignal?.aborted).toBe(true);
    const releaseC = value.watch(resource());
    await flush();
    expect(value.getSnapshot(resource()).status).toBe('idle');
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetcher.mock.calls.filter(([p]) => String(p).includes('annotation-stats'))).toHaveLength(
      1
    );
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(value.getSnapshot(resource()).status).toBe('ready');
    expect(fetcher.mock.calls.filter(([p]) => String(p).includes('annotation-stats'))).toHaveLength(
      2
    );
    releaseC();
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.getTimerCount()).toBe(0);
  });
  test('leaving again before cancellation cooldown cancels the one-shot wakeup', async () => {
    vi.useFakeTimers();
    const late = deferred<Response>(),
      fetcher = vi.fn<typeof fetch>(async (path) =>
        path === '/api/health' ? json({ annotationStatsApi: 'v1' }) : late.promise
      );
    const value = model(realOptions(fetcher));
    const release = value.watch(resource());
    await flush();
    release();
    await flush();
    const releaseAgain = value.watch(resource());
    releaseAgain();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetcher.mock.calls.filter(([p]) => String(p).includes('annotation-stats'))).toHaveLength(
      1
    );
    expect(vi.getTimerCount()).toBe(0);
    late.resolve(json(dataset()));
    await flush();
    expect(value.getSnapshot(resource()).data).toBeNull();
  });
  test('bounds concurrency to 2 and queue to 16 even without IntersectionObserver', async () => {
    const late = deferred<Response>(),
      fetcher = vi.fn<typeof fetch>(async (path) =>
        path === '/api/health' ? json({ annotationStatsApi: 'v1' }) : late.promise
      );
    const value = model(realOptions(fetcher));
    const releases = Array.from({ length: 50 }, (_, index) => value.watch(resource(String(index))));
    await flush();
    expect(fetcher.mock.calls.filter(([p]) => String(p).includes('annotation-stats'))).toHaveLength(
      2
    );
    expect(
      Array.from({ length: 50 }, (_, i) => value.getSnapshot(resource(String(i))).status).filter(
        (s) => s === 'queued'
      )
    ).toHaveLength(16);
    expect(value.getSnapshot(resource('18')).status).toBe('deferred');
    releases.forEach((release) => release());
    await flush();
    expect(value.getSnapshot(resource('0')).status).toBe('idle');
    late.resolve(json(dataset('0')));
    await flush();
    expect(value.getSnapshot(resource('0')).data).toBeNull();
  });
  test('scope restart rejects old reads but accepts new work; host callback failure is contained', async () => {
    const late = deferred<Response>(),
      fetcher = normalFetch();
    fetcher.mockImplementationOnce(() => late.promise);
    const value = model(realOptions(fetcher));
    value.watch(resource());
    await flush();
    value.dispose();
    value.start();
    value.watch(resource());
    await flush();
    expect(value.getSnapshot(resource()).status).toBe('ready');
    late.resolve(json({ annotationStatsApi: 'v1' }));
    await flush();
    expect(value.getSnapshot(resource()).status).toBe('ready');
    const blocked = model(
      realOptions(
        vi.fn<typeof fetch>(async (path) =>
          path === '/api/health' ? json({ annotationStatsApi: 'v1' }) : json({}, 403)
        ),
        {
          onAccessIssue: () => {
            throw new Error('host failure');
          },
        }
      )
    );
    blocked.watch(resource());
    await flush();
    expect(blocked.getSnapshot(resource())).toMatchObject({ status: 'forbidden', data: null });
  });
});
