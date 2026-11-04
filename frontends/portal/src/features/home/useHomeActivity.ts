import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, identityOf, type HomeApi, type Identity } from './api';
import type { ActivityPage, FavoriteItem, RecentItem } from './activity';

type List<T> = ActivityPage<T> & { status: 'loading' | 'ready' | 'failed'; error: string };
const empty = <T,>(): List<T> => ({ items: [], total: 0, page: 0, size: 20, status: 'loading', error: '' });
type Options = { enabled: boolean; api: HomeApi; identity: Identity | null; signal: AbortSignal;
  datasetIds: string[]; onBlocked: (status: number, kind?: string) => void };

export function useHomeActivity({ enabled, api, identity, signal, datasetIds, onBlocked }: Options) {
  const [favorites, setFavorites] = useState<List<FavoriteItem>>(empty);
  const [recent, setRecent] = useState<List<RecentItem>>(empty);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const context = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const blocked = useRef(onBlocked); blocked.current = onBlocked;
  const knownIds = useRef<string[]>([]); knownIds.current = datasetIds;
  const statesReady = useRef(false);
  const idsKey = JSON.stringify(datasetIds);
  const active = enabled && !!identity && !signal.aborted;
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const check = useCallback(async (controller: AbortController) => {
    const current = identityOf(await api.getSession(controller.signal));
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!current || current.issuer !== identity?.issuer || current.subject !== identity?.subject)
      throw new ApiError('账号已变化，请重新载入', 401, 'identity-changed');
  }, [api, identity?.issuer, identity?.subject]);
  function failure(reason: unknown, controller: AbortController) {
    if (controller.signal.aborted) return '';
    if (reason instanceof ApiError && [401, 403].includes(reason.status))
      blocked.current(reason.status, reason.kind);
    return reason instanceof Error ? reason.message : '读取失败，请重试';
  }
  useEffect(() => {
    const controller = new AbortController(); context.current = controller;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    setFavorites(empty()); setRecent(empty()); setFavoriteIds([]); setError(''); setBusy(false);
    writing.current = false; statesReady.current = false;
    if (active) {
      void Promise.all([api.listFavorites(0, controller.signal), api.listRecent(0, controller.signal),
        api.favoriteStates(knownIds.current, controller.signal)])
        .then(async ([f, r, states]) => {
          await check(controller);
          if (controller.signal.aborted) return;
          setFavorites({ ...f, status: 'ready', error: '' });
          setRecent({ ...r, status: 'ready', error: '' });
          setFavoriteIds([...new Set([...states.filter(s => s.favorited).map(s => s.datasetId),
            ...f.items.map(s => s.dataset.id)])]);
          statesReady.current = true;
        }).catch(reason => {
          const message = failure(reason, controller); if (!message) return;
          setFavorites({ ...empty(), status: 'failed', error: message });
          setRecent({ ...empty(), status: 'failed', error: message });
        });
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
    if (!active || !identity || !controller || controller.signal.aborted || writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try {
      await operation(identity, controller.signal);
      await check(controller);
      if (!controller.signal.aborted) refresh();
    } catch (reason) {
      const message = failure(reason, controller);
      if (message) { statesReady.current = false; setError(`${message}。请重新读取核对状态；不会自动重试写入。`); }
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
    } catch (reason) { const message = failure(reason, controller); if (message) setError(message); }
    finally { if (!controller.signal.aborted) { writing.current = false; setBusy(false); } }
  }
  return { favorites, recent, favoriteIds, busy, error, refresh, loadMore,
    favoriteDisabled: !active || favorites.status !== 'ready' || busy || !!error,
    toggleFavorite: (id: string) => {
      if (!statesReady.current) return;
      return mutate((who, abort) => api.setFavorite(id, !favoriteIds.includes(id), who, abort));
    },
    removeRecent: (id?: string) => mutate((who, abort) => api.removeRecent(id, who, abort)),
  };
}
export type HomeActivity = ReturnType<typeof useHomeActivity>;
