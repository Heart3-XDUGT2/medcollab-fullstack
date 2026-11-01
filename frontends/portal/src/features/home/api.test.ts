import { afterEach, describe, expect, test, vi, type Mock } from 'vitest';
import {
  ApiError,
  buildWorkspaceUrl,
  createHomeApi,
  Dataset,
  getAuthUrl,
  getHomeConfig,
  getPublicSampleUrl,
  HomeConfig,
  identityOf,
  Session,
} from './api';

const config: HomeConfig = {
  apiEnabled: true,
  authOrigin: 'http://127.0.0.1:8080',
  logoutOrigins: ['http://127.0.0.1:8081'],
  workspacePath: '/approved-workspace',
  publicSamplePath: null,
};
const identity = { issuer: 'https://identity.example.test/realm', subject: 'subject-a' };
const session = (token = 'test-csrf-one'): Session => ({
  loggedIn: true,
  username: 'account-a',
  ...identity,
  csrfToken: token,
  csrfHeaderName: 'X-REQUEST-CSRF',
});
const dataset: Dataset = {
  id: 'dataset-a',
  name: '公开接口样例',
  access: 'shared',
  ownerUsername: 'owner-a',
  instanceCount: 0,
  createdAt: '2026-10-31T00:00:00Z',
};
const response = (value: unknown, status = 200) => ({
  status,
  json: vi.fn().mockResolvedValue(value),
});
const client = (mock: Mock, options = config) => createHomeApi(options, mock as any);

describe('controlled deployment and launch configuration', () => {
  const originalConfig = (window as any).config;
  afterEach(() => {
    (window as any).config = originalConfig;
    window.history.replaceState({}, '', '/');
    localStorage.clear();
  });

  test('defaults to unconfigured and ignores query/localStorage origins', () => {
    (window as any).config = undefined;
    window.history.replaceState(
      {},
      '',
      '/?backendOrigin=https://untrusted.example&publicSamplePath=%2Fimaging%2Finjected-example'
    );
    localStorage.setItem('backendOrigin', 'https://untrusted.example');
    localStorage.setItem('publicSamplePath', '/imaging/injected-example');
    expect(getHomeConfig()).toEqual({
      apiEnabled: false,
      authOrigin: null,
      logoutOrigins: [],
      workspacePath: null,
      publicSamplePath: null,
    });
    expect(getAuthUrl(getHomeConfig(), 'login')).toBeNull();
    expect(getPublicSampleUrl(getHomeConfig())).toBeNull();
  });
  test('reads only the explicit deployment configuration', () => {
    (window as any).config = { medcollab: config };
    expect(getHomeConfig()).toEqual(config);
    expect(getAuthUrl(config, 'login')).toBe('http://127.0.0.1:8080/auth/login');
    expect(getAuthUrl(config, 'register')).toBe('http://127.0.0.1:8080/auth/register');
  });
  test('launches only the configured same-origin independent public sample', () => {
    (window as any).config = {
      medcollab: { ...config, publicSamplePath: '/imaging/public-example' },
    };
    expect(getHomeConfig().publicSamplePath).toBe('/imaging/public-example');
    expect(getPublicSampleUrl(getHomeConfig())).toBe('/imaging/public-example');
  });
  test('query and localStorage cannot override the deployment public sample path', () => {
    (window as any).config = {
      medcollab: { ...config, publicSamplePath: '/imaging/public-example' },
    };
    window.history.replaceState({}, '', '/?publicSamplePath=%2Fimaging%2Finjected-example');
    localStorage.setItem('publicSamplePath', '/imaging/injected-example');
    expect(getHomeConfig().publicSamplePath).toBe('/imaging/public-example');
    expect(getPublicSampleUrl(getHomeConfig())).toBe('/imaging/public-example');
  });
  test.each([
    'https://untrusted.example/sample',
    '//untrusted.example/sample',
    '/\\untrusted.example/sample',
    '/imaging/public-example?datasetId=injected',
    '/imaging/public-example#injected',
  ])('rejects an unapproved independent public sample location: %s', (publicSamplePath) => {
    expect(getPublicSampleUrl({ ...config, publicSamplePath })).toBeNull();
    (window as any).config = { medcollab: { ...config, publicSamplePath } };
    expect(getHomeConfig().publicSamplePath).toBeNull();
  });
  test.each([
    'javascript:alert(1)',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test/?returnTo=elsewhere',
    'https://example.test/#fragment',
  ])('rejects a non-origin auth location: %s', (authOrigin) => {
    expect(getAuthUrl({ ...config, authOrigin }, 'login')).toBeNull();
  });
  test.each([
    '//untrusted.example/path',
    '/\\untrusted.example/path',
    'https://untrusted.example/path',
    '/work?returnTo=outside',
    '/work#fragment',
  ])('rejects an unapproved workspace location: %s', (workspacePath) => {
    expect(buildWorkspaceUrl({ ...config, workspacePath }, dataset)).toBeNull();
  });
  test('launches with the business dataset id, not a DICOM UID or user returnTo', () => {
    const result = buildWorkspaceUrl(config, { ...dataset, id: '业务/影像&1' }, 'annotate');
    const url = new URL(result!, window.location.origin);
    expect(url.pathname).toBe('/approved-workspace');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      datasetId: '业务/影像&1',
      access: 'shared',
      intent: 'annotate',
      returnPath: '/home',
    });
    expect(url.searchParams.has('StudyInstanceUIDs')).toBe(false);
    expect(buildWorkspaceUrl({ ...config, workspacePath: null }, dataset)).toBeNull();
  });
});

describe('Java session and response contract', () => {
  test('unconfigured mode makes no network request, including writes', async () => {
    const mock = vi.fn();
    const api = client(mock, { ...config, apiEnabled: false });
    await expect(api.getSession()).rejects.toMatchObject({ kind: 'unconfigured' });
    await expect(api.listDatasets()).rejects.toMatchObject({ kind: 'unconfigured' });
    await expect(api.createDataset('new', identity)).rejects.toMatchObject({
      kind: 'unconfigured',
    });
    expect(mock).not.toHaveBeenCalled();
  });
  test('reads session with Cookie credentials/no-store and does not invent Bearer auth', async () => {
    const mock = vi.fn().mockResolvedValue(response(session()));
    expect(identityOf(await client(mock).getSession())).toEqual(identity);
    expect(mock).toHaveBeenCalledWith(
      '/api/session',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: {},
      })
    );
  });
  test('a logged-out session is a valid response, not a fake user', async () => {
    const mock = vi.fn().mockResolvedValue(
      response({
        ...session(),
        loggedIn: false,
        username: null,
        issuer: null,
        subject: null,
      })
    );
    expect(identityOf(await client(mock).getSession())).toBeNull();
  });
  test.each([
    { ...session(), issuer: null },
    { ...session(), csrfHeaderName: 'Authorization' },
    { ...session(), csrfHeaderName: 'X-Test\r\nInjected' },
    { ...session(), csrfToken: '' },
  ])('rejects an invalid identity/CSRF session response', async (invalid) => {
    const mock = vi.fn().mockResolvedValue(response(invalid));
    await expect(client(mock).getSession()).rejects.toMatchObject({ kind: 'protocol' });
  });
  test('rejects malformed/non-JSON responses without echoing their content', async () => {
    const mock = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockRejectedValue(new Error('secret response URL')),
    });
    await expect(client(mock).getSession()).rejects.toMatchObject({
      kind: 'protocol',
      message: '服务器没有返回有效的 JSON 响应',
    });
  });
  test('lists have no invented server pagination and must match their returned total', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response({ items: [dataset], total: 1 }))
      .mockResolvedValueOnce(response({ items: [dataset], total: 20 }));
    await expect(client(mock).listDatasets()).resolves.toEqual([dataset]);
    expect(mock.mock.calls[0][0]).toBe('/api/datasets');
    await expect(client(mock).listDatasets()).rejects.toMatchObject({ kind: 'protocol' });
  });
  test('rejects invalid dataset fields instead of inventing dates/counts', async () => {
    const mock = vi.fn().mockResolvedValue(
      response({
        items: [{ ...dataset, instanceCount: -1, createdAt: 'unknown' }],
        total: 1,
      })
    );
    await expect(client(mock).listDatasets()).rejects.toMatchObject({ kind: 'protocol' });
  });
  test('encodes dataset paths and keeps instanceNumber as its actual string', async () => {
    const mock = vi.fn().mockResolvedValue(
      response({
        items: [{ id: 'instance-a', instanceNumber: '' }],
        total: 1,
      })
    );
    await expect(client(mock).listInstances('a/b')).resolves.toEqual([
      { id: 'instance-a', instanceNumber: '' },
    ]);
    expect(mock.mock.calls[0][0]).toBe('/api/datasets/a%2Fb/instances');
  });
  test('validates and encodes the documented account search', async () => {
    const mock = vi.fn().mockResolvedValue(response({ items: [], total: 0 }));
    const api = client(mock);
    await expect(api.listUsers('a')).rejects.toMatchObject({ status: 400 });
    await expect(api.listUsers('a'.repeat(101))).rejects.toMatchObject({ status: 400 });
    expect(mock).not.toHaveBeenCalled();
    await expect(api.listUsers('  a+b  ')).resolves.toEqual([]);
    expect(mock.mock.calls[0][0]).toBe('/api/users?q=a%2Bb');
  });
  test('does not echo network/server text containing secret tokens or URLs', async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new Error('https://secret.example/?csrf=private'))
      .mockResolvedValueOnce(response({ error: 'private csrf=https://secret.example' }, 403));
    await expect(client(mock).listDatasets()).rejects.toMatchObject({
      kind: 'network',
      message: '无法连接服务，请保留当前操作并检查连接',
    });
    await expect(client(mock).listDatasets()).rejects.toMatchObject({
      status: 403,
      message: '操作未获授权或会话校验已失效，请刷新会话后确认',
    });
  });
  test('honors cancellation before fetching', async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = vi.fn();
    await expect(client(mock).getSession(controller.signal)).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(mock).not.toHaveBeenCalled();
  });
  test('reports an in-flight abort without claiming rollback', async () => {
    const mock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(client(mock).listDatasets()).rejects.toMatchObject({ status: 0, kind: 'aborted' });
  });
  test('forwards caller cancellation to the actual request signal', async () => {
    const controller = new AbortController();
    const mock = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('stopped', 'AbortError'))
          );
        })
    );
    const pending = client(mock).listDatasets(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 0, kind: 'aborted' });
    expect(mock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  test('bounds a read request and clears its timeout without retrying', async () => {
    vi.useFakeTimers();
    try {
      const mock = vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('deadline', 'AbortError'))
            );
          })
      );
      const pending = client(mock).getSession();
      const expectation = expect(pending).rejects.toMatchObject({ status: 0, kind: 'timeout' });
      vi.advanceTimersByTime(15000);
      await expectation;
      expect(mock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fresh-session writes and safe logout', () => {
  test('each explicit write gets a fresh CSRF token and preserves the server header name', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response(session('first-token')))
      .mockResolvedValueOnce(response(dataset))
      .mockResolvedValueOnce(response(session('new-token')))
      .mockResolvedValueOnce(response(dataset));
    const api = client(mock);
    await api.createDataset('  新影像  ', identity);
    await api.renameDataset('dataset-a', '更新名称', identity);
    expect(mock.mock.calls.map((call) => call[0])).toEqual([
      '/api/session',
      '/api/datasets',
      '/api/session',
      '/api/datasets/dataset-a',
    ]);
    expect(mock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: { 'X-REQUEST-CSRF': 'first-token', 'Content-Type': 'application/json' },
      body: '{"name":"新影像"}',
    });
    expect(mock.mock.calls[3][1]).toMatchObject({
      method: 'PATCH',
      headers: { 'X-REQUEST-CSRF': 'new-token', 'Content-Type': 'application/json' },
    });
  });
  test.each([
    { fresh: { ...session(), subject: 'other-user' }, kind: 'identity-changed' },
    { fresh: { ...session(), issuer: 'https://other-issuer.test' }, kind: 'identity-changed' },
    { fresh: { ...session(), loggedIn: false, issuer: null, subject: null }, kind: 'signed-out' },
  ])('does not write after identity loss/change', async ({ fresh, kind }) => {
    const mock = vi.fn().mockResolvedValue(response(fresh));
    await expect(client(mock).createDataset('name', identity)).rejects.toMatchObject({
      status: 401,
      kind,
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  test.each(['response', 'json'])(
    'does not write after cancellation even when the fresh-session %s arrives late',
    async (phase) => {
      const controller = new AbortController();
      let finishSession: (value: unknown) => void;
      const lateSession = new Promise((resolve) => {
        finishSession = resolve;
      });
      const mock = vi
        .fn()
        .mockImplementationOnce(() =>
          phase === 'response'
            ? lateSession
            : Promise.resolve({ status: 200, json: () => lateSession })
        );
      const pending = client(mock).createDataset('cancelled-name', identity, controller.signal);
      const rejection = expect(pending).rejects.toMatchObject({
        status: 0,
        kind: 'aborted',
      });

      controller.abort();
      finishSession(phase === 'response' ? response(session()) : session());

      await rejection;
      expect(mock.mock.calls.map((call) => call[0])).toEqual(['/api/session']);
      expect(mock.mock.calls[0][1].signal.aborted).toBe(true);
    }
  );
  test.each([401, 403])('never blindly repeats a %i write', async (status) => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({ error: 'expired' }, status));
    await expect(client(mock).renameDataset('dataset-a', 'name', identity)).rejects.toMatchObject({
      status,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls.filter((call) => call[1].method === 'PATCH')).toHaveLength(1);
  });
  test('share writes use the selected subject, support shared access, and use fresh CSRF each time', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response(session('second')))
      .mockResolvedValueOnce(response({ success: true }));
    const api = client(mock);
    await api.addShare(dataset.id, 'selected-subject', identity);
    await api.removeShare(dataset.id, 'selected/subject', identity);
    expect(mock.mock.calls[1]).toEqual([
      '/api/datasets/dataset-a/shares',
      expect.objectContaining({
        method: 'PUT',
        body: '{"subject":"selected-subject"}',
      }),
    ]);
    expect(mock.mock.calls[3][0]).toBe('/api/datasets/dataset-a/shares/selected%2Fsubject');
    expect(mock.mock.calls[3][1].headers).toEqual({ 'X-REQUEST-CSRF': 'second' });
  });
  test('validates dataset names before issuing any request', async () => {
    const mock = vi.fn();
    const api = client(mock);
    await expect(api.createDataset(' ', identity)).rejects.toMatchObject({ kind: 'validation' });
    await expect(api.createDataset('x'.repeat(201), identity)).rejects.toMatchObject({
      status: 400,
    });
    expect(mock).not.toHaveBeenCalled();
  });
  test('validates a nonempty single file within 64 MiB before any request', async () => {
    const mock = vi.fn();
    const api = client(mock);
    await expect(
      api.importFile('dataset-a', new File([], 'empty.dcm'), identity)
    ).rejects.toMatchObject({ status: 400 });
    const large = new File(['x'], 'large.dcm');
    Object.defineProperty(large, 'size', { value: 64 * 1024 * 1024 + 1 });
    await expect(api.importFile('dataset-a', large, identity)).rejects.toMatchObject({
      status: 413,
    });
    expect(mock).not.toHaveBeenCalled();
  });
  test.each(['Success', 'AlreadyStored'])(
    'single multipart import supports %s without manual Content-Type',
    async (status) => {
      const mock = vi
        .fn()
        .mockResolvedValueOnce(response(session()))
        .mockResolvedValueOnce(response({ status, id: 'instance-a' }));
      const file = new File(['local test bytes'], 'sample.dcm');
      await expect(client(mock).importFile('dataset-a', file, identity)).resolves.toEqual({
        status,
        id: 'instance-a',
      });
      const [url, options] = mock.mock.calls[1];
      expect(url).toBe('/api/import');
      expect(options.headers).toEqual({ 'X-REQUEST-CSRF': 'test-csrf-one' });
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('datasetId')).toBe('dataset-a');
      expect(options.body.get('file').name).toBe('sample.dcm');
      expect(options.body.get('file').size).toBe(file.size);
    }
  );
  test('logout POST uses fresh CSRF and accepts only a configured provider origin', async () => {
    const url = 'http://127.0.0.1:8081/realms/demo/protocol/openid-connect/logout?test=fixture';
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({ logoutUrl: url }));
    await expect(client(mock).logout(identity)).resolves.toEqual({ logoutUrl: url });
    expect(mock.mock.calls[1]).toEqual([
      '/api/logout',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-REQUEST-CSRF': 'test-csrf-one' },
        body: undefined,
      }),
    ]);
  });
  test.each([
    'javascript:alert(1)',
    'https://untrusted.example/logout',
    'http://user:pass@127.0.0.1:8081/logout',
  ])('does not navigate to an untrusted logout response: %s', async (logoutUrl) => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({ logoutUrl }));
    await expect(client(mock).logout(identity)).rejects.toMatchObject({
      status: 200,
      kind: 'unsafe-redirect',
    });
  });
  test('errors are the application-specific typed errors', () => {
    expect(new ApiError('generic', 403, 'http')).toBeInstanceOf(Error);
  });
});
