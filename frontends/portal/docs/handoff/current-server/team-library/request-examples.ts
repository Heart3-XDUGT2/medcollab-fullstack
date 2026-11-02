/** Examples only; no requests execute on import. Prefer an existing validated request layer. */
import type { Identity, InviteResult, JoinRequest, Team, TeamDataset } from './contracts';
type Session = { loggedIn: boolean; issuer: string | null; subject: string | null; csrfHeaderName: string; csrfToken: string };
export class TeamHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function decode<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new TeamHttpError(r.status, typeof b.error === 'string' ? b.error : `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>; // Replace with DTO validators in the production adapter.
}
export async function teamWrite<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown, expected: Identity, signal: AbortSignal): Promise<T> {
  if (!path.startsWith('/api/teams')) throw new Error('Use a trusted team API path');
  const s = await decode<Session>(await fetch('/api/session', {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
  }));
  signal.throwIfAborted();
  if (!s.loggedIn || s.issuer !== expected.issuer || s.subject !== expected.subject)
    throw new TeamHttpError(401, '账号已变化，不能继续旧操作');
  return decode<T>(await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    headers: { [s.csrfHeaderName]: s.csrfToken, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })); // Never automatically retry writes on network failure or 5xx.
}
export const createTeam = (name: string, identity: Identity, signal: AbortSignal) =>
  teamWrite<InviteResult>('/api/teams', 'POST', { name }, identity, signal);
export const joinTeam = (body: JoinRequest, identity: Identity, signal: AbortSignal) =>
  teamWrite<Team>('/api/teams/join', 'POST', body, identity, signal);
export const createTeamDataset = (teamId: string, name: string, identity: Identity, signal: AbortSignal) =>
  teamWrite<TeamDataset>(`/api/teams/${encodeURIComponent(teamId)}/datasets`, 'POST', { name }, identity, signal);
