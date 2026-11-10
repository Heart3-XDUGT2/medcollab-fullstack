import type { Page } from '@playwright/test';
import { addPortalConfiguration } from '../fixtures';

export async function teamFavoriteFixture(page: Page, options: { missingStates?: boolean; failedStates?: boolean; unknownWrite?: boolean; blockedWrite?: 401 | 403; emptyTeamB?: boolean } = {}) {
  const identity = { issuer: 'https://team-favorite.example.test', subject: 'member-a' };
  const at = '2026-11-07T00:00:00Z';
  const teams = ['TM-A', 'TM-B'].map((id, index) => ({ id, name: index ? '第二研究组' : '跨中心联合影像研究与多器官资料协作组', role: 'member', leaderSubject: 'other', leaderUsername: '组长', memberCount: 2, createdAt: at }));
  const data = teams.map((team, index) => ({ id: `team-dataset-${index}`, name: index ? '第二组影像资料' : '骨骼 CT · 第三轮补充与跨中心复核资料', access: 'shared', ownerUsername: '研究伙伴', instanceCount: index ? 0 : 128, createdAt: at, scope: 'team', teamId: team.id, uploaderSubject: 'other', canDelete: false }));
  const personal = { id: 'personal-copy', name: '我拥有的独立副本', access: 'owner', ownerUsername: '本人', instanceCount: 0, createdAt: at, canDelete: true };
  const favorites = new Set<string>();
  const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
  let currentSubject = identity.subject, revoked = false, gate: Promise<void> | null = null, release: (() => void) | null = null;
  const stateGates = new Map<string, Promise<void>>(), stateReleases = new Map<string, () => void>();
  let teamBGate: Promise<void> | null = null, releaseTeamB: (() => void) | null = null;
  await addPortalConfiguration(page, { medcollab: { apiEnabled: true, authOrigin: null, workspacePath: null } });
  await page.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path: pathname, headers: request.headers() });
    if (pathname === '/api/session') {
      if (gate) await gate;
      return route.fulfill({ json: { loggedIn: true, username: '测试成员', issuer: identity.issuer, subject: currentSubject, csrfToken: 'fresh-synthetic-token', csrfHeaderName: 'X-Team-Test' } }).catch(() => {});
    }
    if (pathname === '/api/health') return route.fulfill({ json: { status: 'UP', homeActivityApi: 'v1' } });
    if (pathname === '/api/datasets') return route.fulfill({ json: { items: [personal], total: 1 } });
    if (pathname === '/api/teams') return route.fulfill({ json: { items: revoked ? [teams[1]] : teams, total: revoked ? 1 : 2 } });
    const favorite = pathname.match(/^\/api\/me\/favorite-datasets\/(team-dataset-\d)$/);
    if (favorite && ['PUT', 'DELETE'].includes(request.method())) {
      if (options.blockedWrite) return route.fulfill({ status: options.blockedWrite, json: {} });
      if (revoked) return route.fulfill({ status: 404, json: {} });
      if (options.unknownWrite) return route.fulfill({ status: 503, json: {} });
      if (request.headers()['x-team-test'] !== 'fresh-synthetic-token') return route.fulfill({ status: 403, json: {} });
      const active = request.method() === 'PUT';
      if (active) favorites.add(favorite[1]); else favorites.delete(favorite[1]);
      return route.fulfill({ json: { success: true, datasetId: favorite[1], favorited: active, favoritedAt: active ? at : null } });
    }
    if (request.method() !== 'GET') return route.fulfill({ status: 405, json: {} });
    const summary = (id: string) => { const item = data.find(value => value.id === id)!; return { id: item.id, name: item.name, access: item.access, ownerUsername: item.ownerUsername, instanceCount: item.instanceCount, createdAt: item.createdAt, scope: 'team', teamId: item.teamId, teamName: teams.find(team => team.id === item.teamId)!.name }; };
    if (pathname === '/api/me/favorite-datasets') {
      const items = [...favorites].filter(id => !revoked || id !== data[0].id).map(id => ({ dataset: summary(id), favoritedAt: at }));
      return route.fulfill({ json: { items, total: items.length, page: 0, size: 20 } });
    }
    if (pathname === '/api/me/recent-datasets') return route.fulfill({ json: { items: [], total: 0, page: 0, size: 20, generation: '11111111-1111-4111-8111-111111111111', retentionDays: 90, maxItems: 100 } });
    if (pathname === '/api/me/favorite-datasets/state') {
      if (options.failedStates) return route.fulfill({ status: 503, json: {} });
      const ids = new URL(request.url()).searchParams.getAll('datasetId');
      for (const id of ids) if (stateGates.has(id)) await stateGates.get(id);
      const items = options.missingStates ? [] : ids.filter(id => !revoked || id !== data[0].id).map(datasetId => ({ datasetId, favorited: favorites.has(datasetId) }));
      return route.fulfill({ json: { items, total: items.length } }).catch(() => {});
    }
    const target = pathname.match(/^\/api\/teams\/(TM-[AB])(?:\/(datasets|members))?$/);
    if (target) {
      const team = teams.find(team => team.id === target[1])!;
      if (team.id === 'TM-B' && teamBGate) await teamBGate;
      if (revoked && team.id === teams[0].id) return route.fulfill({ status: 404, json: {} });
      if (target[2] === 'datasets') {
        const items = options.emptyTeamB && team.id === 'TM-B' ? [] : data.filter(item => item.teamId === team.id);
        return route.fulfill({ json: { items, total: items.length } });
      }
      if (target[2] === 'members') return route.fulfill({ json: { items: [], total: 0 } });
      return route.fulfill({ json: team });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return { calls, data, teams, favorites,
    changeAccount: () => { currentSubject = 'member-b'; },
    revoke: () => { revoked = true; },
    holdSessions: () => { gate = new Promise<void>(resolve => { release = resolve; }); },
    releaseSessions: () => { gate = null; release?.(); },
    holdStates: (id: string) => { stateGates.set(id, new Promise(resolve => stateReleases.set(id, resolve))); },
    releaseStates: (id: string) => { stateGates.delete(id); stateReleases.get(id)?.(); },
    holdTeamB: () => { teamBGate = new Promise(resolve => { releaseTeamB = resolve; }); },
    releaseTeamB: () => { teamBGate = null; releaseTeamB?.(); },
    failStates: () => { options.failedStates = true; },
  };
}
