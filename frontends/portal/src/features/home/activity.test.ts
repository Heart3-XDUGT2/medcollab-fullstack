import { expect, test, vi } from 'vitest';
import { createHomeApi, type HomeConfig } from './api';

const config: HomeConfig = { apiEnabled: true, authOrigin: null, logoutOrigins: [], workspacePath: '/workspace', publicSamplePath: null };
const identity = { issuer: 'issuer', subject: 'a' };
const session = { loggedIn: true, username: 'a', ...identity, csrfHeaderName: 'X-Test-CSRF', csrfToken: 'fresh' };
const dataset = { id: 'ct', name: 'CT', access: 'public', scope: 'personal', ownerUsername: null,
  instanceCount: 100, createdAt: '2026-11-04T00:00:00Z', teamId: null, teamName: null };
const response = (v: unknown, status = 200) => ({ status, json: async () => v });
test('health explicitly declares activity v1; missing markers and legacy health 404 are unsupported',async()=>{
  for(const [body,status,expected] of [
    [{homeActivityApi:'v1'},200,true], [{status:'UP'},200,false], [{homeActivityApi:'v2'},200,false], [{},404,false],
  ] as const){
    const fetcher=vi.fn().mockResolvedValue(response(body,status));
    expect(await createHomeApi(config,fetcher as any).homeActivitySupported()).toBe(expected);
    expect(fetcher).toHaveBeenCalledWith('/api/health',expect.objectContaining({method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error'}));
  }
});
test('failed capability reads do not pretend to be unsupported or successful',async()=>{
  for(const status of [401,403,503]){
    const fetcher=vi.fn().mockResolvedValue(response({},status));
    await expect(createHomeApi(config,fetcher as any).homeActivitySupported()).rejects.toMatchObject({status});
  }
  await expect(createHomeApi(config,vi.fn().mockResolvedValue(response([])) as any).homeActivitySupported())
    .rejects.toMatchObject({kind:'protocol'});
});
test('accepts nested activity summaries and paginated totals, normalizes unknown owner', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ items: [{ dataset, favoritedAt: dataset.createdAt }], total: 45, page: 1, size: 20 }));
  const page = await createHomeApi(config, fetcher as any).listFavorites(1);
  expect(page.total).toBe(45); expect(page.items[0].dataset.ownerUsername).toBe('');
  expect(fetcher.mock.calls[0][0]).toBe('/api/me/favorite-datasets?page=1&size=20');
});
test('retains team identity for activity summaries', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ items: [{ dataset: { ...dataset, scope: 'team', teamId: 'TM-A', teamName: '团队' }, lastOpenedAt: dataset.createdAt }], total: 1, page: 0, size: 20, generation: 'g', retentionDays: 90, maxItems: 100 }));
  expect((await createHomeApi(config, fetcher as any).listRecent()).items[0].dataset.teamId).toBe('TM-A');
});
test('rejects malformed paginated responses', async () => {
  for (const payload of [ {items: [], total: -1, page: 0, size: 20},
    {items: [{dataset, favoritedAt: 'bad'}], total: 1, page: 0, size: 20} ]) {
    await expect(createHomeApi(config, vi.fn().mockResolvedValue(response(payload)) as any).listFavorites()).rejects.toMatchObject({kind: 'protocol'});
  }
});
test('writes favorites with fresh identity and CSRF', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(session)).mockResolvedValueOnce(response({success: true, datasetId: 'ct', favorited: true}));
  await createHomeApi(config, fetcher as any).setFavorite('ct', true, identity);
  expect(fetcher.mock.calls[1][1]).toMatchObject({method:'PUT', credentials:'same-origin', cache:'no-store', headers:{'X-Test-CSRF':'fresh'}});
});
test('account switch stops favorite mutation before sending it', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({...session, subject: 'b'}));
  await expect(createHomeApi(config, fetcher as any).setFavorite('ct', true, identity)).rejects.toMatchObject({kind:'identity-changed'});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('clear and individual removal use separate paths and CSRF', async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string) => response(url === '/api/session' ? session : {success:true,generation:'new'}));
  const api = createHomeApi(config, fetcher as any);
  await api.removeRecent('a/b', identity); await api.removeRecent(undefined, identity);
  expect(fetcher.mock.calls.filter(c => c[1].method === 'DELETE').map(c => c[0])).toEqual(['/api/me/recent-datasets/a%2Fb', '/api/me/recent-datasets']);
});
test('batch favorite state chunks 101 IDs and accepts filtered inaccessible entries', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({items:[], total:0}));
  await createHomeApi(config, fetcher as any).favoriteStates(Array.from({length:101}, (_,i) => String(i)));
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test('unknown write outcome is not automatically retried', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(session)).mockRejectedValue(new Error('disconnect'));
  await expect(createHomeApi(config, fetcher as any).setFavorite('ct', true, identity)).rejects.toMatchObject({kind:'network'});
  expect(fetcher).toHaveBeenCalledTimes(2);
});
