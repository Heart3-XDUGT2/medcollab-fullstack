import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import TeamsPage from './TeamsPage';
import { ApiError, type HomeApi, type HomeConfig, type Session, type Team } from '../home/api';

vi.mock('../../ui/PortalShell', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('../home/UploadPanel', () => ({ default: ({ scopeSignal }: any) => <div data-upload-aborted={String(scopeSignal.aborted)}>上传队列</div> }));
vi.mock('../../ui', () => {
  const Button = React.forwardRef(({ children, variant, size, dataCY, ...props }: any, ref: any) => <button {...props} ref={ref}>{children}</button>);
  return {
    Button, Input: (props: any) => <input {...props} />, Label: (props: any) => <label {...props} />,
    Dialog: ({ children }: any) => <div>{children}</div>,
    DialogContent: ({ children, onEscapeKeyDown, onInteractOutside, ...props }: any) => <div role="dialog" {...props} onKeyDown={event => { if (event.key === 'Escape') onEscapeKeyDown?.(event); }}>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
    DialogDescription: ({ children }: any) => <p>{children}</p>,
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: any) => children,
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: ({ onSelect, children, ...props }: any) => <button {...props} onClick={onSelect}>{children}</button>,
  };
});
const config: HomeConfig = { apiEnabled: true, authOrigin: null, logoutOrigins: [], workspacePath: null, publicSamplePath: null };
const session: Session = { loggedIn: true, username: '研究员', issuer: 'test-issuer', subject: 'me', csrfHeaderName: 'X-CSRF', csrfToken: 'fixture' };
const team: Team = { id: 'TM-A', name: '同名研究组', role: 'leader', leaderSubject: 'me', leaderUsername: '研究员', memberCount: 1, createdAt: '2026-11-02T00:00:00Z' };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((r, fail) => { resolve = r; reject = fail; });
  return { promise, resolve, reject };
};
describe('real team page context boundaries', () => {
  let root: Root, container: HTMLDivElement, api: HomeApi;
  const find = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
  const click = async (label: string) => { await act(async () => find(label).click()); };
  const render = async () => { await act(async () => root.render(<TeamsPage api={api} config={config} />)); };
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    api = {
      getSession: vi.fn().mockResolvedValue(session),
      listTeams: vi.fn().mockResolvedValue([team]),
      getTeam: vi.fn().mockResolvedValue(team),
      listTeamMembers: vi.fn().mockResolvedValue([{ subject: 'me', username: '研究员', role: 'leader', joinedAt: team.createdAt }]),
      listTeamDatasets: vi.fn().mockResolvedValue([]),
      createTeam: vi.fn().mockResolvedValue({ team, inviteCode: 'only-once-fixture-code' }),
      searchTeams: vi.fn().mockResolvedValue([{ ...team, id: 'TM-JOIN', role: 'none' }]),
      joinTeam: vi.fn().mockResolvedValue({ ...team, id: 'TM-JOIN', role: 'member' }),
    } as unknown as HomeApi;
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  test.each([
    new ApiError('服务暂时不可用', 503, 'http'),
    new ApiError('服务器没有返回有效的 JSON 响应', 0, 'protocol'),
  ])('initial team-list failure is not rendered as an empty membership list: %s', async failure => {
    vi.mocked(api.listTeams).mockRejectedValue(failure);
    await render();
    expect(container.textContent).toContain('团队列表读取失败');
    expect(container.textContent).toContain('团队数量未知');
    expect(container.textContent).not.toContain('还没有加入团队');
    expect(container.textContent).not.toContain('0 个团队');
    expect(find('重新读取团队')).toBeDefined();
  });
  test('only a successful empty response shows an empty membership list', async () => {
    vi.mocked(api.listTeams).mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain('还没有加入团队');
    expect(container.textContent).toContain('0 个团队');
    expect(container.textContent).not.toContain('团队列表读取失败');
  });
  test('a refresh failure retains the last successful list and labels its count stale', async () => {
    await render();
    vi.mocked(api.listTeams).mockRejectedValue(new ApiError('服务暂时不可用', 503, 'http'));
    await act(async () => (container.querySelector('[aria-label="刷新团队"]') as HTMLButtonElement).click());
    expect(container.querySelectorAll('.mc-team-list-row')).toHaveLength(1);
    expect(container.textContent).toContain('上次结果：1 个团队（刷新未成功）');
    expect(container.textContent).not.toContain('还没有加入团队');
  });
  test('a failed refresh after an empty success does not claim the current account has no teams', async () => {
    vi.mocked(api.listTeams).mockResolvedValue([]);
    await render();
    vi.mocked(api.listTeams).mockRejectedValue(new ApiError('服务暂时不可用', 503, 'http'));
    await act(async () => (container.querySelector('[aria-label="刷新团队"]') as HTMLButtonElement).click());
    expect(container.textContent).toContain('上次读取没有团队，当前状态待确认');
    expect(container.textContent).toContain('上次结果：0 个团队（刷新未成功）');
    expect(container.textContent).not.toContain('还没有加入团队');
  });
  test('same display names use stable team IDs rather than guessing identity', async () => {
    vi.mocked(api.listTeams).mockResolvedValue([team, { ...team, id: 'TM-B' }]);
    await render();
    expect(container.querySelectorAll('.mc-team-list-row')).toHaveLength(2);
    expect(container.textContent).toContain('TM-A'); expect(container.textContent).toContain('TM-B');
  });
  test('team switch cancels old reads and cannot apply their late results', async () => {
    const delayed = deferred<Team>(); let oldSignal: AbortSignal | undefined;
    vi.mocked(api.listTeams).mockResolvedValue([team, { ...team, id: 'TM-B', name: '另一研究组' }]);
    vi.mocked(api.getTeam).mockImplementation((id, signal) => {
      if (id === team.id) { oldSignal = signal; return delayed.promise; }
      return Promise.resolve({ ...team, id, name: '另一研究组' });
    });
    await render();
    await act(async () => (container.querySelector('.mc-team-list-row') as HTMLButtonElement).click());
    await click('我的团队');
    await act(async () => (container.querySelectorAll('.mc-team-list-row')[1] as HTMLButtonElement).click());
    await act(async () => delayed.resolve(team));
    expect(oldSignal?.aborted).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('另一研究组');
  });
  test('revoked membership clears content and stops its context', async () => {
    let oldSignal: AbortSignal | undefined;
    vi.mocked(api.getTeam).mockImplementation(async (_id, signal) => { oldSignal = signal; return team; });
    await render();
    await act(async () => (container.querySelector('.mc-team-list-row') as HTMLButtonElement).click());
    vi.mocked(api.getTeam).mockRejectedValue(new ApiError('unavailable', 404, 'http'));
    await act(async () => (container.querySelector('[aria-label="刷新团队资料"]') as HTMLButtonElement).click());
    expect(oldSignal?.aborted).toBe(true);
    expect(container.textContent).toContain('已失去成员资格');
    expect(container.querySelectorAll('.mc-team-data-row')).toHaveLength(0);
    expect(container.querySelectorAll('.mc-team-profile')).toHaveLength(0);
  });
  test('account change discards the original account data and secret', async () => {
    await render(); await click('创建团队');
    act(() => Simulate.change(container.querySelector('#team-name')!, { target: { value: '新团队' } } as any));
    await act(async () => Simulate.submit(container.querySelector('[role=dialog] form')!));
    expect(container.textContent).toContain('团队邀请码');
    vi.mocked(api.getSession).mockResolvedValue({ ...session, subject: 'another' });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.querySelector('#team-invite')).toBeNull();
    expect(container.querySelectorAll('.mc-team-list-row')).toHaveLength(0);
    expect(container.textContent).toContain('账号已变化');
  });
  test('search result requires invite entry, not a pretend membership jump', async () => {
    await render(); await click('查找并加入');
    act(() => Simulate.change(container.querySelector('#team-search')!, { target: { value: '研究' } } as any));
    await act(async () => Simulate.submit(container.querySelector('.mc-team-search-form')!));
    await click('填写邀请码');
    expect(container.querySelector('#join-code')).not.toBeNull();
    expect(api.joinTeam).not.toHaveBeenCalled();
    expect(api.getTeam).not.toHaveBeenCalled();
  });
  test('late search results are discarded when the account changes in another tab', async () => {
    const delayed = deferred<Team[]>();
    vi.mocked(api.searchTeams).mockReturnValue(delayed.promise);
    await render(); await click('查找并加入');
    act(() => Simulate.change(container.querySelector('#team-search')!, { target: { value: '研究' } } as any));
    await act(async () => Simulate.submit(container.querySelector('.mc-team-search-form')!));
    vi.mocked(api.getSession).mockResolvedValue({ ...session, subject: 'another-account' });
    await act(async () => delayed.resolve([{ ...team, id: 'new-account-result', name: '不可回填的团队', role: 'none' }]));
    expect(container.textContent).not.toContain('不可回填的团队');
    expect(container.textContent).toContain('账号已变化');
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });
  test('pending mutation blocks cancel and Escape; unknown result freezes repeat submission', async () => {
    const delayed = deferred<any>(); let signal: AbortSignal | undefined;
    vi.mocked(api.createTeam).mockImplementation((_name, _identity, currentSignal) => { signal = currentSignal; return delayed.promise; });
    await render(); await click('创建团队');
    act(() => Simulate.change(container.querySelector('#team-name')!, { target: { value: '新团队' } } as any));
    await act(async () => Simulate.submit(container.querySelector('[role=dialog] form')!));
    expect(find('取消').disabled).toBe(true);
    await click('取消');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => container.querySelector('[role=dialog]')!.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(signal?.aborted).toBe(false);
    await act(async () => delayed.reject(new ApiError('请求超时', 0, 'timeout')));
    expect(container.textContent).toContain('结果尚未确认');
    await act(async () => Simulate.submit(container.querySelector('[role=dialog] form')!));
    expect(container.querySelector('#team-invite')).toBeNull();
    expect(api.createTeam).toHaveBeenCalledTimes(1);
    await click('关闭并核对');
    expect(signal?.aborted).toBe(true);
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });
});
