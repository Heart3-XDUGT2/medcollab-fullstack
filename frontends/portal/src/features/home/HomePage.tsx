import { useHomeActivity } from './useHomeActivity';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  LayoutList,
  PanelRight,
  UserRound,
  UsersRound,
  ArrowUpRight,
  X,
  Home as HomeIcon,
  Files,
} from 'lucide-react';
import PortalShell from '../../ui/PortalShell';
import { personalNavigation } from '../../ui/navigation';
import {
  Button,
  Input,
  Icons,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../ui';
import {
  ApiError,
  buildWorkspaceUrl,
  createHomeApi,
  getAuthUrl,
  getHomeConfig,
  getPublicSampleUrl,
  identityOf,
} from './api';
import type { Dataset, Identity, Team } from './api';
import { createDemoLibrary } from './demo';
import type { DemoLibrary } from './demo';
import UploadPanel from './UploadPanel';
import SharePanel from './SharePanel';
import DeleteDatasetPanel from './DeleteDatasetPanel';
import DatasetCollection from './DatasetCollection';
import { PreferencesButton, useHomePreferences } from './preferences';
import type { HomeEntry } from './preferences/model';
import WorkHome from './WorkHome';
import WorkHomeSettings from './WorkHomeSettings';
import { createDemoActivity, removeDemoRecent, toggleDemoFavorite } from './demo-work';
import type { DemoActivity } from './demo-work';
import {
  DatasetCoverage,
  makeSyntheticDatasetStatistics,
  useAnnotationStatistics,
} from './statistics';
import { demoStatistics } from './demo-statistics';
import './home.css';
import './work-home.css';

type Filter = 'all' | 'owner' | 'shared' | 'public';
type Phase = 'loading' | 'unconfigured' | 'signed-out' | 'ready' | 'failed' | 'expired';
type Action = { kind: 'create' | 'rename' | 'share' | 'upload' | 'delete'; dataset?: Dataset };
const filters = personalNavigation;
const accessLabels = { owner: '我拥有的', shared: '与我共享', public: '公共示例' };
const date = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function explicitEntry(search: string): HomeEntry | null {
  const query = new URLSearchParams(search);
  if (filters.some((item) => item.id === query.get('scope'))) return 'library';
  const view = query.get('view');
  return view === 'work' || view === 'library' ? view : null;
}

export default function HomePage() {
  const location = useLocation();
  const config = useMemo(getHomeConfig, []);
  const api = useMemo(() => createHomeApi(config), [config]);
  const [mode, setMode] = useState<'real' | 'demo'>('real');
  const [phase, setPhase] = useState<Phase>('loading');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [username, setUsername] = useState('');
  const [filter, setFilter] = useState<Filter>(() => {
    const value = new URLSearchParams(window.location.search).get('scope');
    return filters.some((item) => item.id === value) ? (value as Filter) : 'all';
  });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [entry, setEntry] = useState<HomeEntry | null>(() => explicitEntry(window.location.search));
  const [demoActivity, setDemoActivity] = useState<DemoActivity | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamState, setTeamState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [teamRead, setTeamRead] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const landingNotice = useRef(
    (() => {
      const query = new URLSearchParams(window.location.search);
      if (query.get('authError') === 'unavailable') return '账号服务暂时不可用，请稍后重试。';
      if (query.has('authError')) return '登录未完成，请重新登录。';
      if (query.get('logout') === '1') return '已退出登录。';
      return '';
    })()
  );
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [compactDetail, setCompactDetail] = useState(
    () => window.matchMedia('(max-width: 1200px)').matches
  );
  const identity = useRef<Identity | null>(null);
  const accountContext = useRef<Identity | null>(null);
  const demo = useRef<DemoLibrary | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const writeBusy = useRef(false);
  const modeRef = useRef<'real' | 'demo'>('real');
  const scopeController = useRef(new AbortController());
  const [scopeSignal, setScopeSignal] = useState(scopeController.current.signal);
  const actionScope = useRef(new AbortController());
  const [actionSignal, setActionSignal] = useState(actionScope.current.signal);
  const datasetTriggers = useRef(new Map<string, HTMLButtonElement>());
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const display = useHomePreferences({
    mode: mode === 'demo' ? 'demo' : phase === 'ready' && identity.current ? 'real' : 'anonymous',
    identity: mode === 'real' && phase === 'ready' ? identity.current : null,
  });
  const preferences = display.preferences;
  const syntheticStatistics = useMemo(() => {
    if (mode !== 'demo') return undefined;
    const added = Object.fromEntries(
      datasets
        .filter((dataset) => dataset.id.startsWith('demo-created-'))
        .map((dataset) => [
          dataset.id,
          makeSyntheticDatasetStatistics(dataset.id, {
            totalSlices: 0,
            annotatedSlices: 0,
            publishedAnnotatedSlices: 0,
          }),
        ])
    );
    return { ...demoStatistics, ...added };
  }, [mode, datasets]);
  const statistics = useAnnotationStatistics({
    mode: mode === 'demo' ? 'demo' : phase === 'ready' ? 'real' : 'anonymous',
    apiEnabled: config.apiEnabled,
    identity: phase === 'ready' && mode === 'real' ? identity.current : null,
    scopeSignal,
    sessionApi: api,
    demoData: syntheticStatistics,
    onAccessIssue: (issue) => {
      if (issue.resource === 'account' && (issue.status === 401 || issue.status === 403)) {
        onBlocked(issue.status);
      } else if (
        issue.resource !== 'account' &&
        [403, 404].includes(issue.status) &&
        issue.datasetId
      ) {
        const id = issue.datasetId;
        const interrupted = action?.dataset?.id === id && writeBusy.current;
        if (action?.dataset?.id === id) {
          resetActionScope();
          writeController.current?.abort();
          writeController.current = null;
          setOperationBusy(false);
          setAction(null);
          setName('');
          setActionError('');
          setNeedsVerification(false);
          actionTrigger.current = null;
        }
        if (selectedId === id) {
          setDetailOpen(false);
          detailTrigger.current = null;
        }
        setDatasets((current) => current.filter((dataset) => dataset.id !== id));
        setSelectedId((current) => (current === id ? null : current));
        setNotice(
          interrupted
            ? '资料已不存在或失去访问权限，已停止等待操作；服务端可能已处理，不会自动重试。'
            : '一份资料已不存在或失去访问权限，已从当前页面移除。'
        );
      }
    },
  });
  const activity = useHomeActivity({
    enabled: mode === 'real' && phase === 'ready' && config.apiEnabled,
    api, identity: phase === 'ready' && mode === 'real' ? identity.current : null,
    signal: scopeSignal, datasetIds: datasets.map(item => item.id), onBlocked,
  });
  const activityDatasets = useMemo(() => [...new Map([
    ...activity.recent.items.map(item => item.dataset),
    ...activity.favorites.items.map(item => item.dataset), ...datasets,
  ].map(item => [item.id, item])).values()], [datasets, activity.recent.items, activity.favorites.items]);
  const activeEntry = entry || preferences.home.defaultEntry;
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const scope = query.get('scope'),
      view = query.get('view');
    if (filters.some((item) => item.id === scope)) {
      setEntry('library');
      setFilter(scope as Filter);
    } else if (view === 'library' || view === 'work') setEntry(view);
  }, [location.search]);
  useEffect(() => {
    if (phase === 'ready' && display.persistence !== 'loading') {
      setEntry((current) => current || preferences.home.defaultEntry);
    }
  }, [phase, display.persistence, preferences.home.defaultEntry]);
  const wantsTeams = activeEntry === 'work' && !preferences.home.hidden.includes('teams');
  useEffect(() => {
    if (mode !== 'real' || phase !== 'ready' || !wantsTeams || !identity.current) return;
    const expected = { ...identity.current },
      epoch = generation.current;
    const operation = new AbortController();
    const abort = () => operation.abort();
    scopeSignal.addEventListener('abort', abort, { once: true });
    if (scopeSignal.aborted) operation.abort();
    setTeamState('loading');
    void (async () => {
      try {
        const list = await api.listTeams(operation.signal);
        const session = await api.getSession(operation.signal),
          fresh = identityOf(session);
        if (operation.signal.aborted || epoch !== generation.current) return;
        if (!fresh || fresh.issuer !== expected.issuer || fresh.subject !== expected.subject) {
          onBlocked(401, fresh ? 'identity-changed' : undefined);
          return;
        }
        setTeams(list);
        setTeamState('ready');
      } catch (failure) {
        if (operation.signal.aborted || epoch !== generation.current) return;
        setTeams([]);
        setTeamState('failed');
        if (failure instanceof ApiError && [401, 403].includes(failure.status))
          onBlocked(failure.status, failure.kind);
      }
    })();
    return () => {
      operation.abort();
      scopeSignal.removeEventListener('abort', abort);
    };
  }, [mode, phase, wantsTeams, scopeSignal, teamRead, api]);

  function resetActionScope() {
    actionScope.current.abort();
    actionScope.current = new AbortController();
    setActionSignal(actionScope.current.signal);
  }
  function resetScope() {
    resetActionScope();
    scopeController.current.abort();
    scopeController.current = new AbortController();
    setScopeSignal(scopeController.current.signal);
    writeController.current?.abort();
    writeController.current = null;
    writeBusy.current = false;
    setBusy(false);
  }
  function setOperationBusy(value: boolean) {
    writeBusy.current = value;
    setBusy(value);
  }
  function clearAccount() {
    identity.current = null;
    accountContext.current = null;
    demo.current = null;
    setDemoActivity(null);
    setTeams([]);
    setDatasets([]);
    setSelectedId(null);
    setDetailOpen(false);
    setAction(null);
    setName('');
    setActionError('');
    setNeedsVerification(false);
    setSearch('');
    setFilter('all');
    setUsername('');
    setEntry(explicitEntry(location.search));
  }
  function onBlocked(status: number, kind?: string) {
    if (status === 404) {
      onResourceLost();
    } else if (kind === 'identity-changed') {
      generation.current++;
      controller.current?.abort();
      resetScope();
      clearAccount();
      setPhase('expired');
      setNotice('登录账号已变化，已清除原账号的资料与待提交操作。请重新读取会话。');
    } else if (status === 401 || status === 403) {
      generation.current++;
      controller.current?.abort();
      resetScope();
      identity.current = null;
      setDatasets([]);
      setSelectedId(null);
      setDetailOpen(false);
      setPhase('expired');
    }
  }

  async function refresh() {
    const epoch = ++generation.current;
    const interrupted = writeBusy.current;
    if (modeRef.current === 'demo') {
      clearAccount();
      setFilter('all');
      setSearch('');
    }
    controller.current?.abort();
    resetScope();
    controller.current = new AbortController();
    const signal = controller.current.signal;
    modeRef.current = 'real';
    setMode('real');
    demo.current = null;
    setPhase('loading');
    setNotice(
      interrupted
        ? '已停止等待操作；服务端可能已处理，请核对列表，不会自动重试。'
        : landingNotice.current
    );
    landingNotice.current = '';
    try {
      const session = await api.getSession(signal);
      if (epoch !== generation.current) return;
      const nextIdentity = identityOf(session);
      if (
        nextIdentity &&
        accountContext.current &&
        (nextIdentity.issuer !== accountContext.current.issuer ||
          nextIdentity.subject !== accountContext.current.subject)
      ) {
        clearAccount();
        setNotice('当前账号已变化，原账号的待提交操作已清除。');
      }
      identity.current = nextIdentity;
      if (nextIdentity) accountContext.current = { ...nextIdentity };
      setUsername(session.username || '');
      if (!nextIdentity) {
        setDatasets([]);
        setPhase('signed-out');
        return;
      }
      const items = await api.listDatasets(signal);
      if (epoch !== generation.current) return;
      setDatasets(items);
      setSelectedId((current) => (items.some((item) => item.id === current) ? current : null));
      setNeedsVerification(false);
      setPhase('ready');
    } catch (error) {
      if (epoch !== generation.current) return;
      identity.current = null;
      setDatasets([]);
      setPhase(
        error instanceof ApiError && error.kind === 'unconfigured'
          ? 'unconfigured'
          : error instanceof ApiError && error.status === 401
            ? 'expired'
            : 'failed'
      );
      setNotice(error instanceof Error ? error.message : '无法读取影像列表');
    }
  }
  useEffect(() => {
    const previousTitle = document.title;
    document.title = '我的数据集 | MedCollab';
    refresh();
    const media = window.matchMedia('(max-width: 1200px)');
    const onChange = () => setCompactDetail(media.matches);
    media.addEventListener('change', onChange);
    return () => {
      generation.current++;
      controller.current?.abort();
      writeController.current?.abort();
      scopeController.current.abort();
      actionScope.current.abort();
      media.removeEventListener('change', onChange);
      document.title = previousTitle;
    };
  }, []);

  function enterDemo() {
    generation.current++;
    controller.current?.abort();
    resetScope();
    clearAccount();
    modeRef.current = 'demo';
    setMode('demo');
    demo.current = createDemoLibrary();
    setDemoActivity(createDemoActivity());
    setDatasets(demo.current.list());
    setFilter('all');
    setSearch('');
    setSelectedId('demo-abdomen-first');
    setAction(null);
    setNotice('');
    setPhase('ready');
  }
  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return datasets
      .filter(
        (item) =>
          (filter === 'all' || item.access === filter) &&
          (!query ||
            `${item.name} ${item.ownerUsername} ${item.id}`.toLocaleLowerCase().includes(query))
      )
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name, 'zh-CN')
          : (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * (sort === 'oldest' ? 1 : -1) ||
            a.id.localeCompare(b.id)
      );
  }, [datasets, filter, search, sort]);
  const selected = activityDatasets.find((item) => item.id === selectedId);
  const ready = phase === 'ready';
  const authUrl = getAuthUrl(config, 'login');
  const publicSampleUrl = getPublicSampleUrl(config);

  function openAction(kind: Action['kind'], dataset?: Dataset, trigger?: HTMLButtonElement) {
    resetActionScope();
    actionTrigger.current =
      trigger ||
      (detailOpen && detailTrigger.current?.isConnected ? detailTrigger.current : null) ||
      (dataset ? datasetTriggers.current.get(dataset.id) : null) ||
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setDetailOpen(false);
    setAction({ kind, dataset });
    setName(kind === 'rename' ? dataset?.name || '' : '');
    setActionError('');
    setNeedsVerification(false);
  }
  function closeAction() {
    const interrupted = writeBusy.current;
    resetActionScope();
    writeController.current?.abort();
    writeController.current = null;
    setOperationBusy(false);
    setAction(null);
    setActionError('');
    setNeedsVerification(false);
    setName('');
    if (interrupted && modeRef.current === 'real')
      setNotice('已停止等待操作，已完成的更改不会回滚；请刷新核对服务端状态。');
  }
  function selectDataset(id: string, trigger?: HTMLButtonElement) {
    const dataset = activityDatasets.find(item => item.id === id);
    if (mode === 'real' && dataset?.scope === 'team' && dataset.teamId) {
      window.location.assign('/teams?team=' + encodeURIComponent(dataset.teamId));
      return;
    }
    detailTrigger.current = trigger || datasetTriggers.current.get(id) || null;
    setSelectedId(id);
    setDetailOpen(true);
  }
  function restoreDatasetFocus(event: Event) {
    event.preventDefault();
    if (detailTrigger.current?.isConnected) detailTrigger.current.focus({ preventScroll: true });
    else if (selectedId) datasetTriggers.current.get(selectedId)?.focus({ preventScroll: true });
  }
  function onResourceLost() {
    setAction(null);
    setSelectedId(null);
    setDetailOpen(false);
    setName('');
    setDatasets([]);
    refresh();
  }
  function openWorkspace(item: Dataset) {
    if (mode === 'demo') {
      setNotice('本机演示资料未接入工作界面，不会打开对应的后台影像。');
      return;
    }
    const target = buildWorkspaceUrl(config, item);
    if (!target) {
      setNotice('工作界面入口尚未接入，此数据集未被打开。');
      return;
    }
    window.location.assign(target);
  }
  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (writeBusy.current || needsVerification || !action) return;
    const value = name.trim();
    if (!value || value.length > 200) {
      setActionError('名称需为 1–200 个字符');
      return;
    }
    const epoch = generation.current;
    const expectedIdentity = identity.current ? { ...identity.current } : null;
    const operation = new AbortController();
    writeController.current?.abort();
    writeController.current = operation;
    writeBusy.current = true;
    setBusy(true);
    setActionError('');
    try {
      if (modeRef.current === 'demo' && demo.current) {
        if (action.kind === 'rename' && action.dataset)
          demo.current.rename(action.dataset.id, value);
        else demo.current.create(value);
        setDatasets(demo.current.list());
        setNotice('仅更改了本机示例，未保存到云端。');
      } else {
        if (!expectedIdentity || !ready) throw new Error('请先刷新会话并登录');
        const item =
          action.kind === 'rename' && action.dataset
            ? await api.renameDataset(action.dataset.id, value, expectedIdentity, operation.signal)
            : await api.createDataset(value, expectedIdentity, operation.signal);
        if (epoch !== generation.current || modeRef.current !== 'real' || operation.signal.aborted)
          return;
        setDatasets((current) => [item, ...current.filter((existing) => existing.id !== item.id)]);
        setNotice(
          action.kind === 'rename' ? '数据集名称已更新。' : '数据集已创建，可开始导入 DICOM。'
        );
      }
      setAction(null);
    } catch (error) {
      if (epoch !== generation.current || operation.signal.aborted) return;
      const message = error instanceof Error ? error.message : '操作失败';
      setActionError(
        error instanceof ApiError && (error.status === 0 || error.status >= 500)
          ? `${message}。结果可能未知，请重新读取列表核对后再操作。`
          : message
      );
      if (error instanceof ApiError && (error.status === 0 || error.status >= 500))
        setNeedsVerification(true);
      if (error instanceof ApiError) {
        if (error.status === 404) onResourceLost();
        else onBlocked(error.status, error.kind);
      }
    } finally {
      if (writeController.current === operation) {
        writeBusy.current = false;
        setBusy(false);
      }
    }
  }
  async function logout() {
    if (writeBusy.current) return;
    if (mode === 'demo') {
      refresh();
      return;
    }
    if (!identity.current) return;
    const epoch = generation.current;
    const expectedIdentity = { ...identity.current };
    const operation = new AbortController();
    writeController.current?.abort();
    writeController.current = operation;
    writeBusy.current = true;
    setBusy(true);
    try {
      const result = await api.logout(expectedIdentity, operation.signal);
      if (epoch !== generation.current || operation.signal.aborted) return;
      generation.current++;
      controller.current?.abort();
      resetScope();
      clearAccount();
      setPhase('signed-out');
      window.location.assign(result.logoutUrl);
    } catch (error) {
      if (epoch !== generation.current || operation.signal.aborted) return;
      setNotice(error instanceof Error ? error.message : '退出失败');
      if (error instanceof ApiError && (error.status === 200 || error.status === 401)) {
        generation.current++;
        controller.current?.abort();
        resetScope();
        clearAccount();
        setPhase('signed-out');
      } else if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
        generation.current++;
        controller.current?.abort();
        resetScope();
        clearAccount();
        setPhase('failed');
        setNotice('退出结果尚未确认，已清除本页资料；请重新读取会话确认服务端状态。');
      } else if (error instanceof ApiError) onBlocked(error.status, error.kind);
    } finally {
      if (writeController.current === operation) {
        writeBusy.current = false;
        setBusy(false);
      }
    }
  }

  const detailBody = selected && (
    <>
      <Icons.Series className="mc-library-detail-icon" aria-hidden="true" />
      <h3>{selected.name}</h3>
      <dl>
        <dt>来源</dt>
        <dd>{accessLabels[selected.access]}</dd>
        <dt>创建者</dt>
        <dd>{selected.ownerUsername || '未提供'}</dd>
        <dt>实例数</dt>
        <dd>{selected.instanceCount}</dd>
        <dt>创建时间</dt>
        <dd>{date.format(new Date(selected.createdAt))}</dd>
        <dt>数据集编号</dt>
        <dd className="mc-library-id">{selected.id}</dd>
      </dl>
      <p>
        {selected.access === 'public'
          ? '公共影像面向所有登录账号开放。'
          : '共享成员可编辑并继续共享，个人共享确认后不可撤销。'}
      </p>
      <DatasetCoverage model={statistics} datasetId={selected.id} variant="detail" active />
      <Button
        className="mc-library-primary"
        onClick={() => {
          openWorkspace(selected);
          if (compactDetail) setDetailOpen(false);
        }}
        dataCY="home-open-workspace"
      >
        <Icons.ArrowRight />
        打开工作界面
      </Button>
      <Button
        variant="outline"
        className="mc-library-secondary"
        onClick={() => openAction('rename', selected)}
      >
        重命名
      </Button>
      <Button
        variant="outline"
        className="mc-library-secondary"
        onClick={() => openAction('upload', selected)}
      >
        <Icons.Upload />
        追加文件
      </Button>
      {selected.access !== 'public' && (
        <Button
          variant="ghost"
          className="mc-library-text-button"
          onClick={() => openAction('share', selected)}
        >
          按账号共享
        </Button>
      )}
    </>
  );

  const navigation = (
    <>
      {filters.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? 'is-active' : ''}
            aria-current={filter === item.id ? 'page' : undefined}
            data-cy={`home-filter-${item.id}`}
            onClick={() => {
              setEntry('library');
              setFilter(item.id);
            }}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </>
  );
  const sampleEntry =
    publicSampleUrl || !config.apiEnabled ? (
      <div className="mc-library-sidebar-foot">
        {publicSampleUrl ? (
          <>
            <a href={publicSampleUrl} data-cy="home-sample-link">
              <Icons.Series aria-hidden="true" />
              <span>独立 CT 查看样例</span>
            </a>
            <span>独立入口，不对应所选数据集</span>
          </>
        ) : (
          <div className="mc-library-sample-unconfigured" data-cy="home-sample-unconfigured">
            <Icons.Series aria-hidden="true" />
            <span>独立 CT 示例未接入</span>
          </div>
        )}
      </div>
    ) : null;

  return (
    <PortalShell
      activeSection="home"
      username={username}
      mode={mode}
      homeNavigation={navigation}
      onLogout={mode === 'demo' || (ready && identity.current) ? logout : undefined}
      busy={busy}
      accountActions={sampleEntry}
    >
      <div
        className="mc-library"
        data-cy="medcollab-home"
        data-layout={preferences.layout}
        data-density={preferences.density}
      >
        <div className="mc-library-body">
          <main className="mc-library-main">
            <div className="mc-library-space-bar" aria-label="资料空间">
              <span>
                <UserRound size={15} />
                个人资料
              </span>
              <Link to="/teams">
                <UsersRound size={16} />
                团队影像库
                <ArrowUpRight size={14} />
              </Link>
            </div>
            {mode === 'demo' && (
              <div className="mc-library-demo" role="status" data-cy="home-demo-banner">
                <Icons.Info aria-hidden="true" />
                <div>
                  <strong>本机演示</strong>
                  <span>不保存到云端；刷新重置，不上传文件。</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  title="退出示例，返回真实服务"
                  aria-label="退出示例，返回真实服务"
                  onClick={refresh}
                >
                  <Icons.Close />
                </Button>
              </div>
            )}
            <div className="mc-library-heading">
              <div>
                <h1>{activeEntry === 'work' ? '工作首页' : '我的数据集'}</h1>
                <p>
                  {activeEntry === 'work'
                    ? '个人工作空间'
                    : filters.find((item) => item.id === filter)?.label}
                  {ready && (
                    <span className="mc-library-mobile-count">
                      {activeEntry === 'work' ? datasets.length : shown.length} 项
                    </span>
                  )}
                  {activeEntry === 'library' && (
                    <span className="mc-library-mobile-density">
                      {preferences.density === 'compact' ? '紧凑' : '舒适'}
                    </span>
                  )}
                  {ready && (
                    <span className="mc-library-heading-count">{datasets.length} 份可访问资料</span>
                  )}
                </p>
              </div>
              <div className="mc-library-heading-actions">
                <Button
                  variant="outline"
                  className="mc-library-secondary"
                  disabled={!ready}
                  dataCY="home-create"
                  aria-label="新建数据集"
                  title="新建数据集"
                  onClick={() => openAction('create')}
                >
                  <Icons.Plus />
                  <span className="mc-library-create-label">新建数据集</span>
                </Button>
                <Button
                  className="mc-library-primary"
                  disabled={!ready}
                  dataCY="home-upload"
                  onClick={() => openAction('upload')}
                >
                  <Icons.Upload />
                  上传 DICOM
                </Button>
              </div>
            </div>
            <div className="mc-work-navigation">
              <div role="group" aria-label="个人资料入口">
                <Button
                  variant="ghost"
                  aria-pressed={activeEntry === 'work'}
                  onClick={() => setEntry('work')}
                  dataCY="home-entry-work"
                >
                  <HomeIcon size={17} />
                  工作首页
                </Button>
                <Button
                  variant="ghost"
                  aria-pressed={activeEntry === 'library'}
                  onClick={() => setEntry('library')}
                  dataCY="home-entry-library"
                >
                  <Files size={17} />
                  完整资料库
                </Button>
              </div>
              <WorkHomeSettings model={display} />
              {activeEntry === 'work' && (
                <Button
                  variant="ghost"
                  size="icon"
                  title="刷新真实会话与列表"
                  aria-label="刷新真实会话与列表"
                  dataCY="home-refresh"
                  onClick={
                    mode === 'demo' ? () => setNotice('演示资料已就绪，不改变示例历史。') : refresh
                  }
                >
                  <Icons.Refresh />
                </Button>
              )}
            </div>
            {activeEntry === 'library' && (
              <div className="mc-library-toolbar">
                <div className="mc-library-search">
                  <Icons.Search aria-hidden="true" />
                  <Input
                    aria-label="搜索当前列表"
                    placeholder="搜索数据集名称、创建者或编号"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    data-cy="home-search"
                  />
                  {search && (
                    <button
                      type="button"
                      aria-label="清空搜索"
                      title="清空搜索"
                      onClick={() => setSearch('')}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <label className="mc-library-sort">
                  <span>排序</span>
                  <select
                    aria-label="影像排序"
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                    data-cy="home-sort"
                  >
                    <option value="newest">创建较新</option>
                    <option value="oldest">创建较早</option>
                    <option value="name">名称排序</option>
                  </select>
                </label>
                <div className="mc-library-view-switch" role="group" aria-label="资料呈现">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="资料索引"
                    title="资料索引"
                    aria-pressed={preferences.layout === 'cards'}
                    onClick={() => display.update({ layout: 'cards' })}
                  >
                    <LayoutGrid />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="资料清单"
                    title="资料清单"
                    aria-pressed={preferences.layout === 'list'}
                    onClick={() => display.update({ layout: 'list' })}
                  >
                    <LayoutList />
                  </Button>
                </div>
                <PreferencesButton model={display} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="mc-library-icon-button"
                  aria-label="切换资料概览"
                  title="切换资料概览"
                  aria-pressed={Boolean(selected && detailOpen)}
                  disabled={!ready || (!selected && !shown.length)}
                  onClick={() => {
                    if (!selected) setSelectedId(shown[0]?.id || null);
                    setDetailOpen((current) => !current);
                  }}
                >
                  <PanelRight />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mc-library-icon-button"
                  title="刷新真实会话与列表"
                  aria-label="刷新真实会话与列表"
                  dataCY="home-refresh"
                  onClick={
                    mode === 'demo'
                      ? () => {
                          setDatasets(demo.current?.list() || []);
                          setNotice('本机示例列表已刷新。');
                        }
                      : refresh
                  }
                >
                  <Icons.Refresh />
                </Button>
              </div>
            )}
            {notice && (
              <div className="mc-library-notice" role="status" data-cy="home-notice">
                {notice}
                <button aria-label="关闭提示" onClick={() => setNotice('')}>
                  <Icons.Close />
                </button>
              </div>
            )}
            {activeEntry === 'library' && (
              <div className="mc-library-list-summary">
                <span>{ready ? `${shown.length} 个数据集` : '等待连接'}</span>
                <span>
                  {preferences.groupBy === 'source'
                    ? '按来源分组'
                    : preferences.layout === 'cards'
                      ? '资料索引'
                      : '资料清单'}
                  <span className="mc-library-density-label">
                    {preferences.density === 'compact' ? '紧凑' : '舒适'}
                  </span>
                </span>
              </div>
            )}
            <div
              className={`mc-library-content ${selected && detailOpen && !compactDetail ? 'has-detail' : ''}`}
            >
              <section className="mc-library-files" aria-label="影像列表">
                {!ready ? (
                  <div className="mc-library-empty" data-cy="home-connection-state">
                    <Icons.Database aria-hidden="true" />
                    <h2>
                      {phase === 'loading'
                        ? '正在读取会话'
                        : phase === 'signed-out' || phase === 'expired'
                          ? '登录后查看你的影像'
                          : phase === 'unconfigured'
                            ? '连接你的数据集资料库'
                            : '暂时无法读取影像'}
                    </h2>
                    <p>
                      {phase === 'loading'
                        ? '正在确认当前账号与可访问的数据集。'
                        : phase === 'unconfigured'
                          ? '尚未连接影像服务，登录与云端资料当前不可用。'
                          : phase === 'signed-out' || phase === 'expired'
                            ? '没有有效的登录会话，文件操作已暂停。'
                            : '读取失败。可以重试，也可以主动查看本机示例。'}
                    </p>
                    <div className="mc-library-empty-actions">
                      {authUrl ? (
                        <a className="mc-library-auth-link" href={authUrl}>
                          使用平台账号登录
                        </a>
                      ) : (
                        <Link to="/account/sign-in?lng=zh">前往平台账号登录</Link>
                      )}
                      <Button
                        variant="outline"
                        className="mc-library-secondary"
                        onClick={enterDemo}
                        dataCY="home-enter-demo"
                      >
                        进入示例空间
                      </Button>
                      {phase !== 'unconfigured' && (
                        <Button variant="ghost" onClick={refresh}>
                          重试读取
                        </Button>
                      )}
                    </div>
                  </div>
                ) : activeEntry === 'work' ? (
                  <WorkHome
                    datasets={datasets}
                    selectedId={selectedId}
                    composition={preferences.home}
                    demoActivity={mode === 'demo' ? demoActivity : null}
                    activity={mode === 'real' ? activity : undefined}
                    availableDatasets={activityDatasets}
                    teams={teams}
                    teamState={teamState}
                    onRetryTeams={() => setTeamRead((value) => value + 1)}
                    onChoose={(id) => setSelectedId(id || null)}
                    onSelect={selectDataset}
                    onOpen={openWorkspace}
                    onFavorite={(id) => {
                      if (mode === 'real') void activity.toggleFavorite(id);
                      else setDemoActivity(current => current ? toggleDemoFavorite(current, id) : current);
                    }}
                    onRemoveRecent={(id) => {
                      if (mode === 'real') void activity.removeRecent(id);
                      else setDemoActivity(current => current ? removeDemoRecent(current, id) : current);
                    }}
                    onLibrary={() => setEntry('library')}
                    renderCoverage={(dataset) => (
                      <DatasetCoverage
                        model={statistics}
                        datasetId={dataset.id}
                        variant="detail"
                        active
                      />
                    )}
                  />
                ) : shown.length === 0 ? (
                  <div className="mc-library-empty" data-cy="home-empty">
                    <Icons.Series aria-hidden="true" />
                    <h2>{search ? '没有匹配的数据集' : '这里还没有数据集'}</h2>
                    <p>
                      {search
                        ? '试试其他名称、创建者或编号。搜索仅在本次载入列表内进行。'
                        : '新建数据集，或上传 DICOM 开始整理资料。'}
                    </p>
                    {search && (
                      <Button
                        variant="outline"
                        className="mc-library-secondary"
                        onClick={() => setSearch('')}
                      >
                        清除搜索
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {mode === 'real' && activity.error && <p role="alert">{activity.error} <Button variant="ghost" onClick={activity.refresh}>重新读取</Button></p>}
                    <DatasetCollection
                      datasets={shown}
                      layout={preferences.layout}
                      density={preferences.density}
                      grouped={preferences.groupBy === 'source'}
                      fields={preferences.fields}
                      selectedId={selectedId}
                      onSelect={selectDataset}
                      onOpen={openWorkspace}
                      onAction={openAction}
                      favoriteIds={mode === 'demo' ? demoActivity?.favorites : activity.favoriteIds}
                      favoriteDisabled={mode === 'real' && activity.favoriteDisabled}
                      onFavorite={
                        mode === 'demo'
                          ? (id) =>
                              setDemoActivity((current) =>
                                current ? toggleDemoFavorite(current, id) : current
                              )
                          : (id) => { void activity.toggleFavorite(id); }
                      }
                      renderCoverage={(dataset) => (
                        <DatasetCoverage
                          model={statistics}
                          datasetId={dataset.id}
                          variant="compact"
                        />
                      )}
                      registerTrigger={(id, element) => {
                        if (element) datasetTriggers.current.set(id, element);
                        else datasetTriggers.current.delete(id);
                      }}
                    />
                    <p className="mc-library-list-foot">
                      <span>
                        显示 {shown.length} 项 / 本次载入 {datasets.length} 项
                      </span>
                      <span>MedCollab</span>
                    </p>
                  </>
                )}
              </section>
              {selected && ready && detailOpen && !compactDetail && (
                <aside className="mc-library-detail" data-cy="home-detail">
                  <div className="mc-library-detail-header">
                    <h2>资料概览</h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mc-library-icon-button"
                      aria-label="关闭资料概览"
                      onClick={() => {
                        setDetailOpen(false);
                        detailTrigger.current?.focus({ preventScroll: true });
                      }}
                    >
                      <Icons.Close />
                    </Button>
                  </div>
                  {detailBody}
                </aside>
              )}
            </div>
          </main>
        </div>
        <Dialog
          open={Boolean(selected && ready && compactDetail && detailOpen)}
          onOpenChange={setDetailOpen}
        >
          <DialogContent
            className="mc-library-dialog mc-library-detail mc-library-detail-drawer"
            data-cy="home-detail"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              detailHeading.current?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={restoreDatasetFocus}
          >
            <DialogHeader>
              <DialogTitle ref={detailHeading} tabIndex={-1}>
                资料概览
              </DialogTitle>
              <DialogDescription className={mode === 'demo' ? undefined : 'sr-only'}>
                {mode === 'demo' ? '本机演示，不保存到云端。' : '所选数据集的资料和操作'}
              </DialogDescription>
            </DialogHeader>
            {detailBody}
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(action)}
          onOpenChange={(open) => {
            if (!open) closeAction();
          }}
        >
          <DialogContent
            className={`mc-library-dialog ${action?.kind === 'upload' || action?.kind === 'share' ? 'mc-library-operation-dialog' : ''}`}
            data-cy="home-action-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (actionTrigger.current?.isConnected)
                actionTrigger.current.focus({ preventScroll: true });
              else if (selectedId)
                datasetTriggers.current.get(selectedId)?.focus({ preventScroll: true });
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {action?.kind === 'rename'
                  ? '重命名数据集'
                  : action?.kind === 'delete'
                    ? '删除个人数据集'
                  : action?.kind === 'share'
                    ? '按账号共享'
                    : action?.kind === 'upload'
                      ? '上传 DICOM'
                      : '新建数据集'}
              </DialogTitle>
              <DialogDescription className={mode === 'demo' ? undefined : 'sr-only'}>
                {mode === 'demo' ? '本机演示，更改不会保存到云端。' : '所选数据集的操作'}
              </DialogDescription>
            </DialogHeader>
            {mode === 'real' &&
              (needsVerification || ['expired', 'signed-out', 'failed'].includes(phase)) && (
                <div className="mc-library-session-recovery" role="status">
                  <p>
                    {needsVerification
                      ? '操作结果尚未确认。请重新读取列表，核对已完成的更改后再操作。'
                      : '文件操作已暂停。请登录原账号，再重新读取会话；不会自动重发操作。'}
                  </p>
                  {authUrl && (
                    <a href={authUrl} target="_blank" rel="noopener noreferrer">
                      在新标签页登录
                    </a>
                  )}
                  <Button
                    variant="outline"
                    className="mc-library-secondary"
                    dataCY="home-session-refresh"
                    onClick={refresh}
                  >
                    重新读取会话
                  </Button>
                </div>
              )}
            {action?.kind === 'create' || action?.kind === 'rename' ? (
              <form onSubmit={saveName}>
                <label htmlFor="home-dataset-name">数据集名称</label>
                <Input
                  id="home-dataset-name"
                  value={name}
                  disabled={busy}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                  data-cy="home-name-input"
                />
                {actionError && (
                  <p className="mc-library-error" role="alert" data-cy="home-action-error">
                    {actionError}
                  </p>
                )}
                <div className="mc-library-dialog-actions">
                  <Button
                    type="button"
                    variant="outline"
                    className="mc-library-secondary"
                    dataCY="home-action-cancel"
                    onClick={closeAction}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    className="mc-library-primary"
                    disabled={busy || needsVerification || (mode === 'real' && !ready)}
                    dataCY="home-name-save"
                  >
                    {busy ? '处理中…' : mode === 'demo' ? '在示例中保存' : '保存'}
                  </Button>
                </div>
              </form>
            ) : action?.kind === 'delete' && action.dataset && mode === 'real' ? (
              <DeleteDatasetPanel dataset={action.dataset} api={api} identity={identity.current} scopeSignal={actionSignal}
                onBusyChange={setOperationBusy} onBlocked={onBlocked} onClose={closeAction}
                onDeleted={() => { closeAction(); landingNotice.current = '数据集已删除，其他人的副本不受影响。'; void refresh(); }} />
            ) : action?.kind === 'upload' ? (
              <UploadPanel
                mode={mode}
                api={api}
                identity={identity.current}
                scopeSignal={actionSignal}
                enabled={ready}
                loginUrl={authUrl}
                targetDataset={action.dataset}
                onBusyChange={setOperationBusy}
                onBlocked={onBlocked}
                onCompleted={() => {
                  if (modeRef.current === 'real') refresh();
                }}
                onClose={closeAction}
              />
            ) : action?.kind === 'share' && action.dataset ? (
              <SharePanel
                dataset={action.dataset}
                mode={mode}
                api={api}
                demo={demo.current}
                identity={identity.current}
                scopeSignal={actionSignal}
                enabled={ready}
                loginUrl={authUrl}
                onBusyChange={setOperationBusy}
                onBlocked={onBlocked}
                onResourceLost={onResourceLost}
                onClose={closeAction}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </PortalShell>
  );
}
