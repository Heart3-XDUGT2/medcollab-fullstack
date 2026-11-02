import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Files, LogOut, MoreHorizontal, Plus, RefreshCw, Search, Upload, UserRound, UsersRound } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Label } from '../../ui';
import { ApiError, buildWorkspaceUrl, createHomeApi, getAuthUrl, getHomeConfig, identityOf } from '../home/api';
import type { Dataset, HomeApi, HomeConfig, Identity, Session, Team, TeamDataset, TeamInvite, TeamMember, User } from '../home/api';
import UploadPanel from '../home/UploadPanel';
import PortalShell from '../../ui/PortalShell';
import './teams.css';

type Props = { config?: HomeConfig; api?: HomeApi };
type Action =
  | { kind: 'create' | 'find' }
  | { kind: 'join'; team: Team }
  | { kind: 'rename' | 'rotate' | 'leave' | 'add' | 'dataset'; team: Team }
  | { kind: 'remove' | 'transfer'; team: Team; member: TeamMember }
  | { kind: 'delete' | 'renameDataset'; team: Team; dataset: TeamDataset }
  | { kind: 'upload'; team: Team; dataset?: TeamDataset };
const sameIdentity = (a: Identity | null, b: Identity | null) => !!a && !!b && a.issuer === b.issuer && a.subject === b.subject;
const dateLabel = (value: string) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const errorText = (failure: unknown) => failure instanceof ApiError ? failure.message : '操作未完成，请刷新核对当前状态。';
const unknownWrite = (failure: unknown) => !(failure instanceof ApiError) || failure.status >= 500 ||
  ['network', 'timeout', 'protocol', 'aborted'].includes(failure.kind || '');
function Avatar({ name, team = false }: { name: string; team?: boolean }) {
  return <span className={`mc-team-avatar ${team ? 'is-team' : ''}`} aria-hidden="true">{team ? <UsersRound size={20} /> : name.slice(0, 1)}</span>;
}

export default function TeamsPage({ config: providedConfig, api: providedApi }: Props) {
  const [config] = useState(() => providedConfig || getHomeConfig());
  const api = useMemo(() => providedApi || createHomeApi(config), [providedApi, config]);
  const [session, setSession] = useState<Session | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [indexRead, setIndexRead] = useState<'unread' | 'ready' | 'failed' | 'stale'>('unread');
  const [selected, setSelected] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [datasets, setDatasets] = useState<TeamDataset[]>([]);
  const [tab, setTab] = useState<'datasets' | 'members'>('datasets');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [invite, setInvite] = useState<TeamInvite | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const mounted = useRef(false);
  const account = useRef<Identity | null>(null);
  const pageScope = useRef(new AbortController());
  const teamScope = useRef(new AbortController());
  const indexSequence = useRef(0);
  const detailSequence = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const teamTitle = useRef<HTMLHeadingElement>(null);
  const loginUrl = getAuthUrl(config, 'login');

  function clearTeam() {
    teamScope.current.abort();
    teamScope.current = new AbortController();
    detailSequence.current++;
    selectedRef.current = null;
    setSelected(null); setTeam(null); setMembers([]); setDatasets([]);
    setInvite(null); setAction(null); setUploadBusy(false); setDetailLoading(false);
  }
  function invalidate(message: string) {
    pageScope.current.abort(); pageScope.current = new AbortController();
    indexSequence.current++;
    account.current = null;
    clearTeam(); setSession(null); setTeams([]); setIndexRead('unread'); setLoading(false); setError(message);
  }
  async function verify(expected: Identity, signal: AbortSignal) {
    const fresh = await api.getSession(signal);
    if (signal.aborted) throw new ApiError('请求已取消', 0, 'aborted');
    if (!sameIdentity(expected, identityOf(fresh))) {
      if (mounted.current) invalidate('账号已变化或登录已失效，请重新载入团队。');
      throw new ApiError('账号已变化，请重新载入', 401, 'identity-changed');
    }
    return fresh;
  }
  async function loadIndex() {
    const signal = pageScope.current.signal;
    const sequence = ++indexSequence.current;
    setLoading(true); setError('');
    try {
      const fresh = await api.getSession(signal);
      if (signal.aborted || !mounted.current || sequence !== indexSequence.current) return;
      const identity = identityOf(fresh);
      if (!identity) { invalidate('请登录后访问团队。'); return; }
      if (account.current && !sameIdentity(identity, account.current)) {
        invalidate('账号已变化，请重新载入当前账号的团队。'); return;
      }
      account.current = identity; setSession(fresh);
      const list = await api.listTeams(signal);
      await verify(identity, signal);
      if (!signal.aborted && mounted.current && sequence === indexSequence.current) {
        setTeams(list); setIndexRead('ready');
      }
    } catch (failure) {
      if (!signal.aborted && mounted.current && sequence === indexSequence.current) {
        if (failure instanceof ApiError && failure.status === 401) invalidate(errorText(failure));
        else {
          setError(errorText(failure));
          setIndexRead(previous => previous === 'ready' || previous === 'stale' ? 'stale' : 'failed');
        }
      }
    } finally {
      if (mounted.current && sequence === indexSequence.current) setLoading(false);
    }
  }
  async function loadTeam(id: string, signal = teamScope.current.signal) {
    const expected = account.current;
    if (!expected) return;
    const sequence = ++detailSequence.current;
    setDetailLoading(true); setError('');
    try {
      const [nextTeam, nextMembers, nextDatasets] = await Promise.all([
        api.getTeam(id, signal), api.listTeamMembers(id, signal), api.listTeamDatasets(id, signal),
      ]);
      await verify(expected, signal);
      if (signal.aborted || !mounted.current || selectedRef.current !== id || sequence !== detailSequence.current) return;
      setTeam(nextTeam); setMembers(nextMembers); setDatasets(nextDatasets);
      setTeams(previous => previous.map(t => t.id === id ? nextTeam : t));
      if (nextTeam.role !== 'leader') setAction(previous => previous && ['add', 'rename', 'rotate', 'transfer', 'remove'].includes(previous.kind) ? null : previous);
    } catch (failure) {
      if (signal.aborted || !mounted.current || sequence !== detailSequence.current) return;
      if (failure instanceof ApiError && failure.status === 401) invalidate(errorText(failure));
      else if (failure instanceof ApiError && failure.status === 404) {
        clearTeam(); setTeams(previous => previous.filter(t => t.id !== id));
        setError('该团队不存在或你已失去成员资格。上传已停止，已完成的内容不会自动撤回。');
      } else {
        setError(errorText(failure));
        // Do not leave stale mutation controls active after an unsuccessful refresh.
        teamScope.current.abort(); setTeam(null); setAction(null); setInvite(null);
      }
    } finally {
      if (mounted.current && sequence === detailSequence.current) setDetailLoading(false);
    }
  }
  function selectTeam(next: Team) {
    clearTeam();
    selectedRef.current = next.id; setSelected(next.id); setTab('datasets'); setQuery('');
    void loadTeam(next.id);
  }
  function reloadTeam() {
    if (!selectedRef.current) return;
    teamScope.current.abort(); teamScope.current = new AbortController();
    setAction(null); setInvite(null);
    void loadTeam(selectedRef.current);
  }
  useEffect(() => {
    mounted.current = true;
    pageScope.current = new AbortController(); teamScope.current = new AbortController();
    void loadIndex();
    return () => {
      mounted.current = false; indexSequence.current++; detailSequence.current++;
      pageScope.current.abort(); teamScope.current.abort(); account.current = null;
    };
  }, [api]);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'hidden' || !account.current) return;
      const id = selectedRef.current;
      void loadIndex();
      if (id) void loadTeam(id);
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 30000);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [api]);

  async function execute(operation: (identity: Identity, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) {
    const identity = account.current;
    if (!identity || signal.aborted) throw new ApiError('请重新确认登录和团队状态', 401, 'signed-out');
    try {
      const result = await operation(identity, signal);
      await verify(identity, signal);
      if (!mounted.current || signal.aborted || !sameIdentity(account.current, identity)) throw new ApiError('操作上下文已变化', 0, 'aborted');
      return result;
    } catch (failure) {
      if (!signal.aborted && mounted.current && failure instanceof ApiError) {
        if (failure.status === 401) invalidate(errorText(failure));
        else if ([403, 404].includes(failure.status) && selectedRef.current) {
          // An invalid target user can also return 404; re-read membership before discarding a team.
          void loadTeam(selectedRef.current);
        }
      }
      throw failure;
    }
  }
  async function searchRecords(kind: 'teams' | 'users', query: string, signal: AbortSignal) {
    const expected = account.current;
    if (!expected) throw new ApiError('请重新确认登录状态', 401, 'signed-out');
    await verify(expected, signal);
    const result = kind === 'teams' ? await api.searchTeams(query, signal) : await api.listUsers(query, signal);
    await verify(expected, signal);
    return result;
  }
  async function openDataset(dataset: TeamDataset) {
    const signal = teamScope.current.signal, expected = account.current;
    if (!expected || !selectedRef.current) return;
    try {
      const list = await api.listTeamDatasets(selectedRef.current, signal);
      await verify(expected, signal);
      if (signal.aborted) return;
      setDatasets(list);
      const current = list.find(d => d.id === dataset.id);
      if (!current) { setError('该数据集已删除或不可访问，请从当前列表重新选择。'); return; }
      const url = buildWorkspaceUrl(config, current, 'annotate');
      if (!url) { setError('工作界面尚未配置。'); return; }
      window.location.assign(url);
    } catch (failure) {
      if (!signal.aborted) { setError(errorText(failure)); if (selectedRef.current) void loadTeam(selectedRef.current); }
    }
  }
  const uploadApi = useMemo<HomeApi>(() => ({
    ...api,
    createDataset: (name, identity, signal) => {
      if (!team || teamScope.current.signal.aborted) return Promise.reject(new ApiError('团队已变化，请重新选择', 0, 'aborted'));
      return api.createTeamDataset(team.id, name, identity, signal);
    },
  }), [api, team]);
  const visibleTeams = teams.filter(t => `${t.name} ${t.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const hasIndex = indexRead === 'ready' || indexRead === 'stale';
  const visibleDatasets = datasets.filter(d => `${d.name} ${d.ownerUsername}`.toLowerCase().includes(query.trim().toLowerCase()));
  const enabled = !!identityOf(session || { loggedIn: false } as Session) && !!account.current;
  const activeScope = selected ? teamScope.current.signal : pageScope.current.signal;
  const closeAction = () => { if (!uploadBusy) setAction(null); };
  async function logout() {
    const identity = account.current;
    if (!identity || logoutBusy || uploadBusy) return;
    teamScope.current.abort(); setInvite(null); setAction(null); setLogoutBusy(true);
    try {
      const result = await api.logout(identity, pageScope.current.signal);
      if (!mounted.current) return;
      invalidate('已退出当前账号。');
      window.location.assign(result.logoutUrl);
    } catch (failure) {
      if (mounted.current) invalidate(errorText(failure));
    } finally { if (mounted.current) setLogoutBusy(false); }
  }

  return <PortalShell activeSection="teams" username={session?.username || ''} onLogout={enabled ? () => void logout() : undefined} busy={uploadBusy || logoutBusy}><div className="mc-teams">
    <main className="mc-teams-main">
      <div className="mc-teams-content">
        {error && <div role="alert" className="mc-team-error">{error}<Button variant="link" onClick={() => selected ? reloadTeam() : void loadIndex()}>重新读取</Button>{!enabled && loginUrl && <a href={loginUrl}>前往登录</a>}</div>}
        {notice && <div role="status" className="mc-team-notice">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>关闭</button></div>}
        {!selected ? <>
          <header className="mc-team-heading"><h1>我的团队</h1><div><Button variant="outline" onClick={() => setAction({ kind: 'find' })} disabled={!enabled}><Search size={16} />查找并加入</Button><Button onClick={() => setAction({ kind: 'create' })} disabled={!enabled}><Plus size={16} />创建团队</Button></div></header>
          <div className="mc-team-toolbar"><div className="mc-team-search"><Search size={17} /><Input aria-label="搜索我的团队" placeholder="搜索团队名称或 ID" value={query} disabled={!hasIndex} onChange={e => setQuery(e.target.value)} /></div><span>{hasIndex ? `${indexRead === 'stale' ? '上次结果：' : ''}${visibleTeams.length} 个团队${indexRead === 'stale' ? '（刷新未成功）' : ''}` : '团队数量未知'}</span><Button variant="ghost" size="icon" title="刷新团队" aria-label="刷新团队" onClick={() => void loadIndex()} disabled={loading}><RefreshCw size={17} /></Button></div>
          {loading && !hasIndex ? <Loading /> : !enabled ? <Empty title={config.apiEnabled ? '登录后查看团队' : '团队服务尚未配置'} /> : !hasIndex ? <Empty title="团队列表读取失败"><Button variant="outline" onClick={() => void loadIndex()}>重新读取团队</Button></Empty> : !visibleTeams.length ? <Empty title={indexRead === 'stale' ? query ? '上次结果中没有匹配的团队' : '上次读取没有团队，当前状态待确认' : query ? '没有匹配的团队' : '还没有加入团队'}>{!query && indexRead === 'ready' && <Button variant="outline" onClick={() => setAction({ kind: 'find' })}>查找团队</Button>}</Empty> : <div className="mc-team-list">
            <div className="mc-team-list-head"><span>团队</span><span>组长</span><span>成员数</span><span /></div>
            {visibleTeams.map(item => <button key={item.id} className="mc-team-list-row" onClick={() => selectTeam(item)}><div className="mc-team-list-name"><Avatar name={item.name} team /><span><strong>{item.name}</strong><small>{item.id}<span className="mc-team-tag">{item.role === 'leader' ? '组长' : '成员'}</span></small></span></div><span className="mc-team-leader">{item.leaderUsername}</span><span className="mc-team-num">{item.memberCount.toLocaleString()}<small> 位成员</small></span><ArrowRight size={17} /></button>)}
          </div>}
        </> : <>
          <button className="mc-team-back" onClick={clearTeam}><ArrowLeft size={16} />我的团队</button>
          {detailLoading && !team ? <Loading /> : team && <>
            <header className="mc-team-profile"><Avatar name={team.name} team /><div><h1 ref={teamTitle} tabIndex={-1}>{team.name}</h1><p><span className="mc-team-tag">{team.role === 'leader' ? '组长' : '成员'}</span><span>{team.memberCount.toLocaleString()} 位成员</span></p><small>{team.id}<Button variant="ghost" size="icon" aria-label="复制团队 ID" title="复制团队 ID" onClick={() => void navigator.clipboard.writeText(team.id).then(() => setNotice('团队 ID 已复制。')).catch(() => setError('无法复制，请手动选择团队 ID。'))}><Copy size={14} /></Button></small></div>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="团队操作" title="团队操作"><MoreHorizontal size={19} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
                {team.role === 'leader' && <><DropdownMenuItem onSelect={() => setAction({ kind: 'rename', team })}>修改团队名称</DropdownMenuItem><DropdownMenuItem onSelect={() => setAction({ kind: 'rotate', team })}>轮换邀请码</DropdownMenuItem></>}
                <DropdownMenuItem disabled={team.role === 'leader'} onSelect={() => setAction({ kind: 'leave', team })}>退出团队</DropdownMenuItem>
              </DropdownMenuContent></DropdownMenu>
            </header>
            <div className="mc-team-tabs" role="tablist" aria-label="团队内容"><button role="tab" id="team-datasets-tab" aria-controls="team-datasets-panel" aria-selected={tab === 'datasets'} onClick={() => { setTab('datasets'); setQuery(''); }}>数据集 <span>{datasets.length}</span></button><button role="tab" id="team-members-tab" aria-controls="team-members-panel" aria-selected={tab === 'members'} onClick={() => { setTab('members'); setQuery(''); }}>成员 <span>{members.length}</span></button><Button variant="ghost" size="icon" title="刷新团队资料" aria-label="刷新团队资料" onClick={reloadTeam} disabled={detailLoading || uploadBusy}><RefreshCw size={17} /></Button></div>
            {tab === 'datasets' ? <section role="tabpanel" aria-labelledby="team-datasets-tab" id="team-datasets-panel">
              <div className="mc-team-toolbar"><div className="mc-team-search"><Search size={17} /><Input placeholder="搜索名称或上传者" aria-label="搜索团队数据集" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="mc-team-actions"><Button variant="outline" onClick={() => setAction({ kind: 'upload', team })}><Upload size={16} />上传</Button><Button onClick={() => setAction({ kind: 'dataset', team })}><Plus size={16} />新建数据集</Button></div></div>
              {!visibleDatasets.length ? <Empty title={query ? '没有匹配的数据集' : '团队还没有数据集'}>{!query && <Button variant="outline" onClick={() => setAction({ kind: 'dataset', team })}>新建数据集</Button>}</Empty> : <div className="mc-team-datasets"><div className="mc-team-data-head"><span>名称 / 上传者</span><span>实例数</span><span>创建时间</span><span>操作</span></div>{visibleDatasets.map(d => <div className="mc-team-data-row" key={d.id}><div className="mc-team-data-name"><button onClick={() => void openDataset(d)}>{d.name}</button><small>{d.ownerUsername}{d.uploaderSubject === account.current?.subject && <span className="mc-team-tag">我创建的</span>}</small></div><span className="mc-team-num">{d.instanceCount.toLocaleString()}<small className="mc-team-mobile-unit"> 实例</small></span><time dateTime={d.createdAt}>{dateLabel(d.createdAt)}</time><div className="mc-team-row-actions"><Button variant="ghost" onClick={() => void openDataset(d)}>{d.instanceCount ? '进入标注' : '打开'}<ArrowRight size={14} /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" title="数据集操作" aria-label={`${d.name} 数据集操作`}><MoreHorizontal size={18} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setAction({ kind: 'upload', team, dataset: d })}>追加文件</DropdownMenuItem><DropdownMenuItem onSelect={() => setAction({ kind: 'renameDataset', team, dataset: d })}>重命名</DropdownMenuItem>{d.canDelete && d.uploaderSubject === account.current?.subject && <DropdownMenuItem className="mc-team-danger" onSelect={() => setAction({ kind: 'delete', team, dataset: d })}>删除数据集</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div></div>)}</div>}
            </section> : <section role="tabpanel" aria-labelledby="team-members-tab" id="team-members-panel">
              <div className="mc-team-toolbar"><span>当前团队成员</span>{team.role === 'leader' && <Button onClick={() => setAction({ kind: 'add', team })}><Plus size={16} />添加成员</Button>}</div>
              <div className="mc-team-members">{members.map(member => <div className="mc-team-member-row" key={member.subject}><Avatar name={member.username} /><div><strong>{member.username}{member.subject === account.current?.subject && <small>我</small>}</strong><small>加入于 {dateLabel(member.joinedAt)}</small></div><span className="mc-team-tag">{member.role === 'leader' ? '组长' : '成员'}</span>{team.role === 'leader' && member.subject !== account.current?.subject && <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" title="成员操作" aria-label={`${member.username} 成员操作`}><MoreHorizontal size={18} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setAction({ kind: 'transfer', team, member })}>移交组长</DropdownMenuItem><DropdownMenuItem className="mc-team-danger" onSelect={() => setAction({ kind: 'remove', team, member })}>移除成员</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>)}</div>
              {team.role === 'leader' && <p className="mc-team-footnote">退出前，请先将组长移交给一位当前成员。</p>}
            </section>}
          </>}
        </>}
      </div>
    </main>
    {action && action.kind !== 'upload' && <TeamAction key={`${action.kind}:${'team' in action ? action.team.id : ''}`} action={action} api={api} signal={activeScope} execute={execute} searchRecords={searchRecords} onReconcile={() => { if (selectedRef.current) reloadTeam(); else void loadIndex(); }} onClose={closeAction} onJoined={next => { setAction({ kind: 'join', team: next }); }} onDone={result => {
      setAction(null);
      if (action.kind === 'create') {
        const created = result as TeamInvite; selectTeam(created.team); setInvite(created); void loadIndex();
      } else if (action.kind === 'rotate') setInvite(result as TeamInvite);
      else if (action.kind === 'join') { selectTeam(result as Team); void loadIndex(); setNotice('已加入团队。'); }
      else if (action.kind === 'leave') { clearTeam(); void loadIndex(); setNotice('已退出团队。上传的资料仍保留在团队库中。'); }
      else { if (selectedRef.current) void loadTeam(selectedRef.current); void loadIndex(); setNotice('操作已完成，正在核对最新状态。'); }
    }} />}
    {action?.kind === 'upload' && <Dialog open onOpenChange={open => { if (!open) closeAction(); }}><DialogContent className="mc-team-dialog" onEscapeKeyDown={e => { if (uploadBusy) e.preventDefault(); }} onInteractOutside={e => { if (uploadBusy) e.preventDefault(); }}><DialogHeader><DialogTitle>{action.dataset ? '追加团队资料' : '上传到团队'}</DialogTitle><DialogDescription>{action.team.name}</DialogDescription></DialogHeader><UploadPanel key={`${session?.issuer}:${session?.subject}:${action.team.id}:${action.dataset?.id || 'new'}`} mode="real" api={uploadApi} identity={account.current} scopeSignal={teamScope.current.signal} enabled={enabled && !!team} loginUrl={loginUrl} targetDataset={action.dataset} destinationLabel={action.team.name} onBusyChange={setUploadBusy} onBlocked={() => { if (selectedRef.current) void loadTeam(selectedRef.current); }} onCompleted={() => { if (selectedRef.current) void loadTeam(selectedRef.current); }} onClose={() => { setAction(null); reloadTeam(); }} /></DialogContent></Dialog>}
    {invite && <Dialog open onOpenChange={open => { if (!open) setInvite(null); }}><DialogContent className="mc-team-dialog"><DialogHeader><DialogTitle>团队邀请码</DialogTitle><DialogDescription>{invite.team.name}</DialogDescription></DialogHeader><p className="mc-team-footnote">仅在本次展示，请妥善保存。分享团队 ID 与此码即可邀请成员；轮换后旧码失效。</p><Label htmlFor="team-invite">邀请码</Label><div className="mc-team-code"><Input id="team-invite" value={invite.inviteCode} readOnly autoComplete="off" spellCheck={false} /><Button variant="outline" onClick={() => void navigator.clipboard.writeText(invite.inviteCode).then(() => setNotice('邀请码已复制，请仅发送给受邀成员。')).catch(() => setError('复制失败，请手动选择邀请码。'))}><Copy size={16} />复制</Button></div><p className="mc-team-stable-id">{invite.team.id}</p><Button onClick={() => setInvite(null)}>完成</Button></DialogContent></Dialog>}
  </div></PortalShell>;
}

function Loading() { return <div className="mc-team-loading" role="status" aria-label="正在读取"><span /><span /><span /></div>; }
function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="mc-team-empty"><UsersRound size={27} strokeWidth={1.4} /><h2>{title}</h2>{children}</div>;
}
type ActionProps = {
  action: Action; api: HomeApi; signal: AbortSignal;
  execute: (operation: (identity: Identity, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => Promise<unknown>;
  searchRecords: (kind: 'teams' | 'users', query: string, signal: AbortSignal) => Promise<Array<Team | User>>;
  onReconcile: () => void; onClose: () => void; onDone: (result: unknown) => void; onJoined: (team: Team) => void;
};
function TeamAction({ action, api, signal, execute, searchRecords, onReconcile, onClose, onDone, onJoined }: ActionProps) {
  const [name, setName] = useState(action.kind === 'rename' ? action.team.name : action.kind === 'renameDataset' ? action.dataset.name : '');
  const [code, setCode] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<Team | User>>([]);
  const [chosen, setChosen] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const life = useRef(new AbortController());
  const searchScope = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const pending = useRef(false);
  function close() {
    if (pending.current) return;
    if (uncertain) onReconcile();
    onClose();
  }
  useEffect(() => {
    life.current = new AbortController();
    const abort = () => { life.current.abort(); searchScope.current?.abort(); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    return () => { abort(); setCode(''); signal.removeEventListener('abort', abort); };
  }, [signal]);
  const titles: Record<Action['kind'], string> = { create: '创建团队', find: '查找并加入团队', join: '加入团队', rename: '修改团队名称', rotate: '轮换邀请码', leave: '退出团队', add: '添加成员', remove: '移除成员', transfer: '移交组长', dataset: '新建团队数据集', delete: '删除数据集', renameDataset: '重命名数据集', upload: '上传资料' };
  async function search() {
    searchScope.current?.abort();
    const controller = new AbortController(); searchScope.current = controller;
    const abort = () => controller.abort();
    life.current.signal.addEventListener('abort', abort, { once: true });
    const sequence = ++searchSequence.current;
    setSearching(true); setError(''); setChosen(null); setResults([]);
    try {
      const list = await searchRecords(action.kind === 'find' ? 'teams' : 'users', query, controller.signal);
      if (!controller.signal.aborted && sequence === searchSequence.current) { setResults(list); setSearched(true); }
    } catch (failure) { if (!controller.signal.aborted) setError(errorText(failure)); }
    finally { life.current.signal.removeEventListener('abort', abort); if (!controller.signal.aborted) setSearching(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || uncertain || signal.aborted || life.current.signal.aborted) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await execute((identity, currentSignal) => {
        switch (action.kind) {
          case 'create': return api.createTeam(name, identity, currentSignal);
          case 'join': return api.joinTeam(action.team.id, code, identity, currentSignal);
          case 'rename': return api.renameTeam(action.team.id, name, identity, currentSignal);
          case 'dataset': return api.createTeamDataset(action.team.id, name, identity, currentSignal);
          case 'renameDataset': return api.renameDataset(action.dataset.id, name, identity, currentSignal);
          case 'rotate': return api.rotateTeamInvite(action.team.id, identity, currentSignal);
          case 'leave': return api.leaveTeam(action.team.id, identity, currentSignal);
          case 'remove': return api.removeTeamMember(action.team.id, action.member.subject, identity, currentSignal);
          case 'transfer': return api.transferTeam(action.team.id, action.member.subject, identity, currentSignal);
          case 'delete': return api.deleteTeamDataset(action.team.id, action.dataset.id, identity, currentSignal);
          case 'add': if (chosen) return api.addTeamMember(action.team.id, chosen.subject, identity, currentSignal);
        }
        return Promise.reject(new ApiError('请先选择账号', 400, 'validation'));
      }, life.current.signal);
      if (!life.current.signal.aborted) onDone(result);
    } catch (failure) {
      if (!life.current.signal.aborted) { setError(unknownWrite(failure) ? '本次结果尚未确认，请关闭后刷新列表核对，不要直接重复操作。' : errorText(failure)); setUncertain(unknownWrite(failure)); }
    } finally { pending.current = false; if (!life.current.signal.aborted) setBusy(false); }
  }
  const searchMode = action.kind === 'find' || action.kind === 'add';
  const nameMode = ['create', 'rename', 'dataset', 'renameDataset'].includes(action.kind);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="mc-team-dialog" aria-busy={busy} data-pending={busy} onEscapeKeyDown={event => { if (pending.current) event.preventDefault(); }} onInteractOutside={event => { if (pending.current) event.preventDefault(); }}><DialogHeader><DialogTitle>{titles[action.kind]}</DialogTitle><DialogDescription>{'team' in action ? action.team.name : action.kind === 'find' ? '按名称或完整团队 ID 查找' : '团队名称可修改，团队 ID 保持不变。'}</DialogDescription></DialogHeader>
    {searchMode && <><form className="mc-team-search-form" onSubmit={e => { e.preventDefault(); void search(); }}><Label htmlFor="team-search">{action.kind === 'find' ? '团队名称或 ID' : '已有账号名称'}</Label><div><Input id="team-search" value={query} minLength={2} maxLength={100} autoComplete="off" onChange={e => { setQuery(e.target.value); searchScope.current?.abort(); searchSequence.current++; setSearching(false); setSearched(false); setResults([]); setChosen(null); }} /><Button variant="outline" disabled={searching || busy} type="submit"><Search size={16} />搜索</Button></div></form>
      <div className="mc-team-search-results" aria-live="polite">{searching ? '正在搜索…' : searched && !results.length ? '没有找到匹配结果' : results.map(item => 'memberCount' in item ? <div key={item.id}><Avatar name={item.name} team /><span><strong>{item.name}</strong><small>{item.id} · {item.memberCount} 位成员</small></span><Button variant="outline" disabled={item.role !== 'none'} onClick={() => onJoined(item)}>{item.role === 'none' ? '填写邀请码' : '已加入'}</Button></div> : <label key={item.subject}><Avatar name={item.username} /><span>{item.username}</span><input type="radio" name="team-member" checked={chosen?.subject === item.subject} onChange={() => setChosen(item)} /></label>)}</div>
    </>}
    {action.kind !== 'find' && <form onSubmit={submit}>
      {nameMode && <div className="mc-team-field"><Label htmlFor="team-name">{action.kind === 'dataset' || action.kind === 'renameDataset' ? '数据集名称' : '团队名称'}</Label><Input id="team-name" value={name} required maxLength={action.kind === 'dataset' || action.kind === 'renameDataset' ? 200 : 100} onChange={e => setName(e.target.value)} disabled={busy || uncertain} /></div>}
      {action.kind === 'join' && <div className="mc-team-field"><p className="mc-team-stable-id">{action.team.id}</p><Label htmlFor="join-code">邀请码</Label><Input id="join-code" value={code} type="password" autoComplete="off" required maxLength={100} onChange={e => setCode(e.target.value)} disabled={busy || uncertain} /></div>}
      {action.kind === 'rotate' && <p className="mc-team-confirm-copy">旧邀请码将立即失效，已加入的成员不受影响。新码仅在本次结果中展示。</p>}
      {action.kind === 'leave' && <p className="mc-team-confirm-copy">退出后将无法访问这份团队资料库。你上传的资料仍留在团队中。</p>}
      {action.kind === 'remove' && <p className="mc-team-confirm-copy">移除“{action.member.username}”后，该成员将失去团队访问权限，其上传资料仍留在团队中。</p>}
      {action.kind === 'transfer' && <p className="mc-team-confirm-copy">将组长移交给“{action.member.username}”？你将成为普通成员。</p>}
      {action.kind === 'delete' && <p className="mc-team-confirm-copy">删除“{action.dataset.name}”后，所有团队成员都将无法通过该数据集访问资料。此操作不会清除其他数据集引用的影像。</p>}
      {error && <p role="alert" className="mc-team-error">{error}</p>}
      <div className="mc-team-dialog-actions"><Button variant="outline" onClick={close} disabled={busy}>{uncertain ? '关闭并核对' : '取消'}</Button><Button type="submit" disabled={busy || uncertain || (action.kind === 'add' && !chosen)}>{busy ? '正在处理…' : ['delete', 'remove', 'transfer', 'leave', 'rotate'].includes(action.kind) ? '确认操作' : '确认'}</Button></div>
    </form>}
    {action.kind === 'find' && error && <p role="alert" className="mc-team-error">{error}</p>}
  </DialogContent></Dialog>;
}
