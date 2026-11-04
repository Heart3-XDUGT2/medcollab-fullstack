import { describe, expect, test, vi } from 'vitest';
import { liveOrigin, readOnlyFetch } from './read-only-transport';

function transport() {
  const dispose = vi.fn(async () => {});
  const get = vi.fn(async () => ({
    body: async () => Buffer.from('{"status":"UP"}'),
    status: () => 200,
    statusText: () => 'OK',
    headers: () => ({ 'content-type': 'application/json' }),
    dispose,
  }));
  return { get, dispose, fetcher: readOnlyFetch('http://127.0.0.1:8080', { get } as any) };
}
describe('opt-in live smoke transport safety', () => {
  test.each([
    '',
    'file:///tmp/a',
    'http://user:secret@localhost',
    'http://localhost/home',
    'http://localhost/?token=x',
  ])('refuses a non-origin or credential-bearing target: %s', (value) => {
    expect(() => liveOrigin(value)).toThrow();
  });
  test.each([
    ['/api/datasets', { method: 'POST' }],
    ['/api/datasets/any-id', { method: 'PATCH' }],
    ['/api/import', { method: 'POST' }],
    ['/api/datasets/any-id/annotation-stats', { method: 'DELETE' }],
    ['/api/datasets', { body: 'unexpected' }],
    ['https://outside.example/api/session', {}],
    ['/api/me/recent-datasets', {}],
    ['/api/me/favorite-datasets', {}],
    ['/api/datasets/any-id/segmentations/series/labelmap', {}],
    ['/api/session?token=x', {}],
  ] as const)(
    'blocks writes, drafts, absent contracts and external destinations: %s',
    async (path, init) => {
      const { get, fetcher } = transport();
      await expect(fetcher(path, init)).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    }
  );
  test('uses the existing context GET and disables redirects without exporting cookies', async () => {
    const { get, dispose, fetcher } = transport();
    expect(await (await fetcher('/api/health')).json()).toEqual({ status: 'UP' });
    expect(get).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/health',
      expect.objectContaining({ maxRedirects: 0, timeout: 15000 })
    );
    expect(dispose).toHaveBeenCalledOnce();
  });
  test('does not send an already cancelled read', async () => {
    const { get, fetcher } = transport();
    await expect(fetcher('/api/session', { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  test('does not propagate transport details into a saved test failure', async () => {
    const get = vi.fn(async () => {
      throw new Error('private payload and secret cookie');
    });
    await expect(
      readOnlyFetch('http://127.0.0.1:8080', { get } as any)('/api/session')
    ).rejects.toThrow(
      'Live API transport did not complete; no response body or credentials were recorded.'
    );
  });
});
