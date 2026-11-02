import React, { useEffect, useRef, useState } from 'react';
import { Button, Icons, Input } from '../../ui';
import { ApiError, identityOf } from './api';
import type { Dataset, HomeApi, Identity, User } from './api';
import { demoUsers } from './demo';
import type { DemoLibrary } from './demo';
import './share-panel.css';

type Props = {
  dataset: Dataset;
  mode: 'real' | 'demo';
  api: HomeApi;
  demo: DemoLibrary | null;
  identity: Identity | null;
  scopeSignal: AbortSignal;
  enabled: boolean;
  loginUrl: string | null;
  onBusyChange(busy: boolean): void;
  onBlocked(status: number, kind?: string): void;
  onResourceLost(): void;
  onClose(): void;
};

const sameIdentity = (left: Identity | null, right: Identity | null) =>
  !!left && !!right && left.issuer === right.issuer && left.subject === right.subject;

export default function SharePanel({
  dataset,
  mode,
  api,
  demo,
  identity,
  scopeSignal,
  enabled,
  loginUrl,
  onBusyChange,
  onBlocked,
  onResourceLost,
  onClose,
}: Props) {
  const boundIdentity = useRef(identity ? { ...identity } : null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const pendingWrite = useRef<AbortController | null>(null);
  const callbacks = useRef({ onBusyChange, onBlocked, onResourceLost });
  callbacks.current = { onBusyChange, onBlocked, onResourceLost };
  const [members, setMembers] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const searchVersion = useRef(0);
  const contextValid = mode === 'demo' ? !!demo : sameIdentity(boundIdentity.current, identity);
  const active = enabled && contextValid && !scopeSignal.aborted && !blocked;
  const canWrite = active && loaded && !loading && !busy && !needsCheck;

  function trackedRequest() {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (scopeSignal.aborted) controller.abort();
    else scopeSignal.addEventListener('abort', abort, { once: true });
    requests.current.add(controller);
    return {
      controller,
      finish() {
        scopeSignal.removeEventListener('abort', abort);
        requests.current.delete(controller);
      },
    };
  }

  function current(epoch: number, signal: AbortSignal) {
    return mounted.current && epoch === generation.current && !signal.aborted;
  }

  function handleFailure(failure: unknown, isWrite = false) {
    const message = failure instanceof Error ? failure.message : '无法完成共享操作';
    setError(message);
    if (failure instanceof ApiError) {
      if (failure.status === 401 || failure.status === 403) {
        setBlocked(true);
        callbacks.current.onBlocked(failure.status, failure.kind);
      } else if (failure.status === 404) {
        callbacks.current.onResourceLost();
      } else if (isWrite && (failure.status === 0 || failure.status >= 500)) {
        setNeedsCheck(true);
        setError(`${message}。共享结果尚未确认，请先刷新共享名单核对，再决定是否重试。`);
      }
    } else if (isWrite) {
      setNeedsCheck(true);
      setError(`${message}。共享结果尚未确认，请先刷新共享名单核对。`);
    }
  }

  async function loadMembers() {
    if (dataset.access === 'public' || scopeSignal.aborted) return;
    const epoch = generation.current;
    const request = trackedRequest();
    setLoading(true);
    try {
      const items =
        mode === 'demo'
          ? demo?.listShares(dataset.id) || []
          : await api.listShares(dataset.id, request.controller.signal);
      if (!current(epoch, request.controller.signal)) return;
      setMembers(items);
      setLoaded(true);
      setNeedsCheck(false);
      setError('');
    } catch (failure) {
      if (current(epoch, request.controller.signal)) handleFailure(failure);
    } finally {
      request.finish();
      if (current(epoch, request.controller.signal)) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      requests.current.forEach((controller) => controller.abort());
      requests.current.clear();
      callbacks.current.onBusyChange(false);
    };
  }, []);

  useEffect(() => {
    generation.current++;
    requests.current.forEach((controller) => controller.abort());
    pendingWrite.current = null;
    setBusy(false);
    setSearching(false);
    setLoading(false);
    callbacks.current.onBusyChange(false);
    const abort = () => {
      generation.current++;
      requests.current.forEach((controller) => controller.abort());
      pendingWrite.current = null;
      if (mounted.current) {
        setBusy(false);
        setSearching(false);
        setLoading(false);
        callbacks.current.onBusyChange(false);
      }
    };
    scopeSignal.addEventListener('abort', abort, { once: true });
    if (enabled && contextValid && !scopeSignal.aborted) {
      setBlocked(false);
      loadMembers();
    }
    return () => scopeSignal.removeEventListener('abort', abort);
  }, [scopeSignal, enabled, dataset.id, mode]);

  async function searchUsers(event: React.FormEvent) {
    event.preventDefault();
    if (!active || searching || busy) return;
    const value = query.trim();
    if (value.length < 2 || value.length > 100) {
      setError('请输入 2–100 个字符的账号名称');
      return;
    }
    const version = ++searchVersion.current;
    const epoch = generation.current;
    const request = trackedRequest();
    setSearching(true);
    setResults(null);
    setSelected(null);
    setError('');
    try {
      const items =
        mode === 'demo'
          ? demoUsers.filter((user) =>
              user.username.toLocaleLowerCase().includes(value.toLocaleLowerCase())
            )
          : await api.listUsers(value, request.controller.signal);
      if (!current(epoch, request.controller.signal) || version !== searchVersion.current) return;
      setResults(items);
    } catch (failure) {
      if (current(epoch, request.controller.signal) && version === searchVersion.current)
        handleFailure(failure);
    } finally {
      request.finish();
      if (current(epoch, request.controller.signal) && version === searchVersion.current)
        setSearching(false);
    }
  }

  async function verifyAddTarget(epoch: number, signal: AbortSignal) {
    try {
      const session = await api.getSession(signal);
      if (!current(epoch, signal)) return;
      const freshIdentity = identityOf(session);
      if (!freshIdentity) throw new ApiError('请登录原账号后刷新会话', 401, 'signed-out');
      if (!sameIdentity(boundIdentity.current, freshIdentity))
        throw new ApiError('登录账号已变化，请重新载入本账号的数据集', 401, 'identity-changed');
      const items = await api.listShares(dataset.id, signal);
      if (!current(epoch, signal)) return;
      setMembers(items);
      setLoaded(true);
      setResults(null);
      setSelected(null);
      setError('目标账号当前不可共享，请重新搜索并选择账号。');
    } catch (checkFailure) {
      if (!current(epoch, signal)) return;
      setNeedsCheck(true);
      handleFailure(checkFailure);
    }
  }

  async function changeShare(user: User) {
    if (!canWrite || pendingWrite.current) return;
    const epoch = generation.current;
    const request = trackedRequest();
    pendingWrite.current = request.controller;
    setBusy(true);
    setError('');
    setNotice('');
    callbacks.current.onBusyChange(true);
    try {
      if (mode === 'demo' && demo) {
        demo.addShare(dataset.id, user);
      } else {
        const expected = boundIdentity.current;
        if (!expected) throw new ApiError('请登录原账号后刷新会话', 401, 'signed-out');
        await api.addShare(dataset.id, user.subject, { ...expected }, request.controller.signal);
      }
      if (!current(epoch, request.controller.signal)) return;
      setSelected(null);
      setNotice(
        mode === 'demo'
          ? '仅更新了本机示例的共享名单，未保存到云端。'
          : '已确认共享，不可撤销，正在更新名单。'
      );
      await loadMembers();
    } catch (failure) {
      if (!current(epoch, request.controller.signal)) return;
      if (failure instanceof ApiError && failure.status === 404) {
        await verifyAddTarget(epoch, request.controller.signal);
      } else {
        handleFailure(failure, true);
      }
    } finally {
      request.finish();
      if (pendingWrite.current === request.controller) {
        pendingWrite.current = null;
        if (mounted.current) {
          setBusy(false);
          callbacks.current.onBusyChange(false);
        }
      }
    }
  }

  function cancelWrite() {
    if (!pendingWrite.current) return;
    pendingWrite.current.abort();
    pendingWrite.current = null;
    setBusy(false);
    setNeedsCheck(true);
    setError('已停止等待。服务器可能已完成操作；请刷新共享名单核对，取消不会撤销已完成的共享。');
    callbacks.current.onBusyChange(false);
  }

  if (dataset.access === 'public')
    return (
      <div className="mc-library-share">
        <p>公共影像已向所有登录账号开放，无需设置共享。</p>
        <Button variant="outline" className="mc-library-secondary" onClick={onClose}>
          关闭
        </Button>
      </div>
    );

  return (
    <div className="mc-library-share" data-cy="home-share-panel">
      <p className="mc-library-share-dataset">{dataset.name}</p>
      <p className="mc-library-share-warning">
        <Icons.Info aria-hidden="true" />
        <span>共享成员可编辑影像，并能继续共享。确认共享后不可撤销，请核对账号。</span>
      </p>
      {(!active || blocked) && mode === 'real' && (
        <div className="mc-library-share-paused" role="status">
          <p>文件操作已暂停。请登录原账号后刷新会话，再确认操作。</p>
          {loginUrl && (
            <a
              href={loginUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              在新标签页登录
            </a>
          )}
        </div>
      )}
      <form className="mc-library-share-search" onSubmit={searchUsers}>
        <label htmlFor="home-share-account-search">查找账号</label>
        <div>
          <Input
            id="home-share-account-search"
            value={query}
            maxLength={100}
            placeholder={mode === 'demo' ? '搜索示例协作者' : '输入账号名称'}
            disabled={!active || busy}
            onChange={(event) => {
              searchVersion.current++;
              setSearching(false);
              setQuery(event.target.value);
              setResults(null);
              setSelected(null);
            }}
            data-cy="home-share-search"
          />
          <Button
            type="submit"
            variant="outline"
            className="mc-library-secondary"
            disabled={!active || searching || busy}
            dataCY="home-share-search-submit"
          >
            <Icons.Search aria-hidden="true" />
            {searching ? '查找中' : '搜索'}
          </Button>
        </div>
      </form>
      {results && (
        <div className="mc-library-share-results" aria-label="账号搜索结果">
          {results.length === 0 ? (
            <p>没有找到匹配账号。</p>
          ) : (
            results.map((user) => {
              const exists = members.some((member) => member.subject === user.subject);
              return (
                <button
                  key={user.subject}
                  type="button"
                  data-cy="home-user-result"
                  aria-pressed={selected?.subject === user.subject}
                  disabled={!active || busy || exists}
                  onClick={() => {
                    setSelected(user);
                  }}
                >
                  <Icons.Patient aria-hidden="true" />
                  <span>{user.username}</span>
                  <span>
                    {exists ? '已共享' : selected?.subject === user.subject ? '已选中' : '选择'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
      <div className="mc-library-share-confirm">
        {selected && (
          <p>
            将向 <strong>{selected.username}</strong> 开放上述权限。
          </p>
        )}
        <Button
          className="mc-library-primary"
          disabled={
            !selected || !canWrite || members.some((member) => member.subject === selected.subject)
          }
          onClick={() => selected && changeShare(selected)}
          dataCY="home-share-add"
        >
          <Icons.Plus aria-hidden="true" />
          确认共享
        </Button>
      </div>
      <div className="mc-library-share-members-heading">
        <h3>共享成员{loaded ? ` (${members.length})` : ''}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="mc-library-share-icon"
          disabled={!active || loading || busy}
          title="刷新共享名单"
          aria-label="刷新共享名单"
          onClick={loadMembers}
          dataCY="home-share-refresh"
        >
          <Icons.Refresh aria-hidden="true" />
        </Button>
      </div>
      {loading ? (
        <div className="mc-library-share-loading" role="status">
          正在读取共享名单
        </div>
      ) : loaded ? (
        members.length ? (
          <ul className="mc-library-share-members">
            {members.map((user) => (
              <li key={user.subject} data-cy="home-share-member">
                <Icons.Patient aria-hidden="true" />
                <span>
                  {user.username}
                  {user.subject === boundIdentity.current?.subject ? '（当前账号）' : ''}
                </span>
                <span>已共享，不可撤销</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mc-library-share-empty">尚未显式共享给其他账号。所有者不列在名单内。</p>
        )
      ) : (
        <p className="mc-library-share-empty">共享名单尚未载入。</p>
      )}
      {error && (
        <p className="mc-library-error" role="alert" data-cy="home-share-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-cy="home-share-notice">
          {notice}
        </p>
      )}
      <div className="mc-library-dialog-actions">
        {busy && (
          <Button
            variant="outline"
            className="mc-library-secondary"
            onClick={cancelWrite}
            dataCY="home-share-cancel-operation"
          >
            停止等待
          </Button>
        )}
        <Button variant="outline" className="mc-library-secondary" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}
