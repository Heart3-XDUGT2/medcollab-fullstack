import { RecentOpenReporter } from './RecentOpenReporter';
const identity = { issuer: 'issuer', subject: 'a' };
const session = { loggedIn: true, ...identity, csrfHeaderName: 'X-Test-CSRF', csrfToken: 'fresh' };
const response = (v: unknown, status = 200) => ({status, json: async () => v});
function setup(fresh = session) {
  const fetcher = jest.fn().mockImplementation(async url => response(url.endsWith('/context') ? {generation:'generation-before-load'} : url === '/api/session' ? fresh : {success:true}));
  const reporter = new RecentOpenReporter('ct', identity, fetcher as any);
  return { fetcher, reporter };
}
test('preparing an opening context never records a visit before imaging succeeds', async () => {
  const {fetcher, reporter} = setup(); await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1); reporter.close();
});
test('does not bind native fetch to the reporter object', async () => {
  const fetcher = jest.fn(function (this: unknown, url: string) {
    if (this !== undefined) throw new TypeError('Illegal invocation');
    return Promise.resolve(response(url.endsWith('/context') ? {generation:'g'} : url === '/api/session' ? session : {success:true}));
  });
  await new RecentOpenReporter('ct', identity, fetcher as any).opened();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
test('records once after success with original context, a UUID and fresh CSRF', async () => {
  const {fetcher, reporter} = setup(); await Promise.all([reporter.opened(), reporter.opened()]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const [url, options] = fetcher.mock.calls[2];
  expect(url).toBe('/api/me/recent-datasets/ct');
  expect(options).toMatchObject({method:'POST', headers:{'X-Test-CSRF':'fresh'}});
  expect(JSON.parse(options.body)).toEqual({generation:'generation-before-load', eventId:expect.stringMatching(/^[0-9a-f-]{36}$/)});
});
test('close/rebind cancels the old navigation', async () => {
  const {fetcher, reporter} = setup(); reporter.close(); await reporter.opened();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
test('changed account cannot write the old opening', async () => {
  const {fetcher, reporter} = setup({...session, subject:'b'}); await reporter.opened();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test('cleared history or network failure cannot trigger an automatic replay', async () => {
  for (const status of [409, 500]) {
    const {fetcher, reporter} = setup();
    fetcher.mockImplementation(async url => response(url.endsWith('/context') ? {generation:'g'} : url === '/api/session' ? session : {code:'RECENT_CONTEXT_STALE'}, url === '/api/session' || url.endsWith('/context') ? 200 : status));
    await reporter.opened(); await reporter.opened();
    expect(fetcher).toHaveBeenCalledTimes(3);
  }
});
