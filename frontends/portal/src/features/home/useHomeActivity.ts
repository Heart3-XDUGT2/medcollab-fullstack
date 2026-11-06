import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, identityOf, type HomeApi, type Identity } from './api';
import type { ActivityPage, FavoriteItem, RecentItem } from './activity';

type List<T> = ActivityPage<T> & { status: 'loading' | 'ready' | 'failed' | 'unsupported'; error: string };
const empty = <T,>(): List<T> => ({ items: [], total: 0, page: 0, size: 20, status: 'loading', error: '' });
type Options = { enabled: boolean; api: HomeApi; identity: Identity | null; signal: AbortSignal;
  datasetIds: string[]; onBlocked: (status: number, kind?: string) => void };

export function useHomeActivity({ enabled, api, identity, signal, datasetIds, onBlocked }: Options) {
  const [favorites, setFavorites] = useState<List<FavoriteItem>>(empty);
  const [recent, setRecent] = useState<List<RecentItem>>(empty);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statesLoaded, setStatesLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const context = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const blocked = useRef(onBlocked); blocked.current = onBlocked;
  const knownIds = useRef<string[]>([]); knownIds.current = datasetIds;
  const statesReady = useRef(false);
  const supported = useRef(false);
  const idsKey = JSON.stringify(datasetIds);
  const active = enabled && !!identity && !signal.aborted;
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const check = useCallback(async (controller: AbortController) => {
    const current = identityOf(await api.getSession(controller.signal));
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!current || current.issuer !== identity?.issuer || current.subject !== identity?.subject)
      throw new ApiError('账号已变化，请重新载入', 401, 'identity-changed');
  }, [api, identity?.issuer, identity?.subject]);
  function failure(reason: unknown, controller: AbortController, source: string, collection = true) {
    if (controller.signal.aborted) return '';
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
      controller.abort();
      statesReady.current = false; supported.current = false;
      setStatesLoaded(false); setFavoriteIds([]); setBusy(false); setError('');
      setFavorites({ ...empty(), status: 'failed', error: '会话或账号已变化，请重新读取会话。' });
      setRecent({ ...empty(), status: 'failed', error: '会话或账号已变化，请重新读取会话。' });
      blocked.current(reason.status, reason.kind);
      return '';
    }
    if (collection && reason instanceof ApiError && reason.status === 404)
      return `${source}接口与当前服务不匹配，请核对服务版本后重新读取。`;
    return `${source}：${reason instanceof Error ? reason.message : '读取失败，请重试'}`;
  }
  useEffect(() => {
    const controller = new AbortController(); context.current = controller;
    const abort = () => {
      controller.abort();
      statesReady.current = false; supported.current = false;
      setStatesLoaded(false); setFavoriteIds([]); setFavorites(empty()); setRecent(empty());
      setError(''); setBusy(false);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    setFavorites(empty()); setRecent(empty()); setFavoriteIds([]); setError(''); setBusy(false); setStatesLoaded(false);
    writing.current = false; statesReady.current = false; supported.current = false;
    if (active && !controller.signal.aborted) {
      void (async () => {
        try {
          const available = await api.homeActivitySupported(controller.signal);
          await check(controller);
          if (controller.signal.aborted) return;
          if (!available) {
            setFavorites({ ...empty(), status: 'unsupported', error: '当前服务未提供收藏功能。' });
            setRecent({ ...empty(), status: 'unsupported', error: '当前服务未提供最近打开功能。' });
            return;
          }
          supported.current = true;
        } catch (reason) {
          const message = failure(reason, controller, '活动功能检测'); if (!message) return;
          setFavorites({ ...empty(), status: 'failed', error: message });
          setRecent({ ...empty(), status: 'failed', error: message });
          return;
        }
        // Lists settle independently; a failed recent read must not hide valid favorites.
        void api.listFavorites(0, controller.signal).then(async f => {
          await check(controller); if (controller.signal.aborted) return;
          setFavorites({ ...f, status: 'ready', error: '' });
          setFavoriteIds(ids => [...new Set([...ids, ...f.items.map(s => s.dataset.id)])]);
        }).catch(reason => {
          const message = failure(reason, controller, '收藏列表'); if (!message) return;
          setFavorites({ ...empty(), status: 'failed', error: message });
        });
        void api.listRecent(0, controller.signal).then(async r => {
          await check(controller); if (controller.signal.aborted) return;
          setRecent({ ...r, status: 'ready', error: '' });
        }).catch(reason => {
          const message = failure(reason, controller, '最近打开列表'); if (!message) return;
          setRecent({ ...empty(), status: 'failed', error: message });
        });
        void api.favoriteStates(knownIds.current, controller.signal).then(async states => {
          await check(controller); if (controller.signal.aborted) return;
          setFavoriteIds(ids => [...new Set([...ids, ...states.filter(s => s.favorited).map(s => s.datasetId)])]);
          const covered = new Set(states.map(s => s.datasetId));
          if (!knownIds.current.every(id => covered.has(id))) {
            setError('部分资料的收藏状态未能确认，请重新读取核对后再操作收藏。');
            return;
          }
          statesReady.current = true; setStatesLoaded(true);
        }).catch(reason => {
          const message = failure(reason, controller, '收藏状态'); if (!message) return;
          setError(`${message}。请重新读取核对后再操作收藏。`);
        });
      })();
    }
    return () => { controller.abort(); signal.removeEventListener('abort', abort); };
  }, [active, api, identity?.issuer, identity?.subject, signal, revision, check, idsKey]);

  // Returning from a separate viewer tab also updates the server-backed lists.
  useEffect(() => {
    if (!active) return;
    const focus = () => { if (!writing.current && document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [active, refresh]);

  async function mutate(operation: (identity: Identity, signal: AbortSignal) => Promise<unknown>) {
    const controller = context.current;
    if (!active || !supported.current || !identity || !controller || controller.signal.aborted || writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try {
      await operation(identity, controller.signal);
      await check(controller);
      if (!controller.signal.aborted) refresh();
    } catch (reason) {
      const message = failure(reason, controller, '活动操作', false);
      if (message) { statesReady.current = false; setStatesLoaded(false); setError(`${message}。请重新读取核对状态；不会自动重试写入。`); }
    } finally {
      if (!controller.signal.aborted) { writing.current = false; setBusy(false); }
    }
  }
  async function loadMore(kind: 'favorite' | 'recent') {
    const controller = context.current, list = kind === 'favorite' ? favorites : recent;
    if (!active || !controller || controller.signal.aborted || writing.current || list.status !== 'ready' || list.items.length >= list.total) return;
    writing.current = true; setBusy(true);
    try {
      const page = list.page + 1;
      const result = kind === 'favorite' ? await api.listFavorites(page, controller.signal) : await api.listRecent(page, controller.signal);
      await check(controller);
      if (controller.signal.aborted) return;
      if (kind === 'favorite') {
        const next = result as ActivityPage<FavoriteItem>;
        setFavorites(v => ({ ...next, items: [...new Map([...v.items, ...next.items].map(i => [i.dataset.id, i])).values()], status: 'ready', error: '' }));
        setFavoriteIds(v => [...new Set([...v, ...next.items.map(i => i.dataset.id)])]);
      } else {
        const next = result as ActivityPage<RecentItem>;
        setRecent(v => ({ ...next, items: [...new Map([...v.items, ...next.items].map(i => [i.dataset.id, i])).values()], status: 'ready', error: '' }));
      }
    } catch (reason) {
      const message = failure(reason, controller, kind === 'favorite' ? '收藏分页' : '最近打开分页');
      if (message) {
        if (kind === 'favorite') setFavorites(v => ({ ...v, error: message }));
        else setRecent(v => ({ ...v, error: message }));
      }
    }
    finally { if (!controller.signal.aborted) { writing.current = false; setBusy(false); } }
  }
  return { favorites, recent, favoriteIds, busy, error, refresh, loadMore,
    favoriteDisabled: !active || !statesLoaded || favorites.status !== 'ready' || busy || !!error,
    toggleFavorite: (id: string) => {
      if (!statesReady.current || favorites.status !== 'ready' || error) return;
      return mutate((who, abort) => api.setFavorite(id, !favoriteIds.includes(id), who, abort));
    },
    removeRecent: (id?: string) => recent.status === 'ready'
      ? mutate((who, abort) => api.removeRecent(id, who, abort)) : undefined,
  };
}
export type HomeActivity = ReturnType<typeof useHomeActivity>;
