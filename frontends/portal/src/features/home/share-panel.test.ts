import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SharePanel from './SharePanel';
import { ApiError, HomeApi, Dataset } from './api';
import { createDemoLibrary } from './demo';

vi.mock('../../ui', async () => {
  const React = await import('react');
  return {
    Button: React.forwardRef(({ children, dataCY, variant, size, ...props }: any, ref) =>
      React.createElement('button', { ...props, ref, 'data-cy': dataCY }, children)
    ),
    Input: React.forwardRef((props: any, ref) => React.createElement('input', { ...props, ref })),
    Icons: {
      Info: () => null,
      Search: () => null,
      Patient: () => null,
      Plus: () => null,
      Refresh: () => null,
    },
  };
});

const dataset: Dataset = {
  id: 'dataset-a',
  name: '接口资料',
  access: 'shared',
  ownerUsername: 'owner',
  instanceCount: 0,
  createdAt: '2026-10-31T00:00:00Z',
};
const identity = { issuer: 'https://identity.example.test', subject: 'account-a' };
const collaborator = { subject: 'returned-subject', username: 'collaborator' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('account sharing panel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let scope: AbortController;
  let api;
  let props;
  const control = (id: string) => container.querySelector(`[data-cy="${id}"]`) as HTMLElement;
  const click = async (id: string) => {
    await act(async () => control(id).click());
  };
  const search = async (value = 'collaborator') => {
    act(() => Simulate.change(control('home-share-search'), { target: { value } } as any));
    await act(async () =>
      Simulate.submit(container.querySelector('.mc-library-share-search') as HTMLFormElement)
    );
  };
  const render = async (changes = {}) => {
    props = { ...props, ...changes };
    await act(async () => root.render(React.createElement(SharePanel, props)));
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    scope = new AbortController();
    api = {
      getSession: vi.fn().mockResolvedValue({
        loggedIn: true,
        username: 'account-a',
        ...identity,
        csrfToken: 'fixture-token',
        csrfHeaderName: 'X-CSRF-TOKEN',
      }),
      listShares: vi.fn().mockResolvedValue([]),
      listUsers: vi.fn().mockResolvedValue([collaborator]),
      addShare: vi.fn().mockResolvedValue(undefined),
      removeShare: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeApi;
    props = {
      dataset,
      mode: 'real',
      api,
      demo: null,
      identity,
      scopeSignal: scope.signal,
      enabled: true,
      loginUrl: 'http://127.0.0.1:8080/auth/login',
      onBusyChange: vi.fn(),
      onBlocked: vi.fn(),
      onResourceLost: vi.fn(),
      onClose: vi.fn(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('requires selection and explicit confirmation, sends only the returned subject', async () => {
    await render();
    expect((control('home-share-add') as HTMLButtonElement).disabled).toBe(true);
    await search();
    expect(api.addShare).not.toHaveBeenCalled();
    await click('home-user-result');
    expect(container.textContent).toContain('可编辑影像');
    expect(container.textContent).toContain('确认共享后不可撤销');
    expect(api.addShare).not.toHaveBeenCalled();
    await click('home-share-add');
    expect(api.addShare).toHaveBeenCalledWith(
      dataset.id,
      collaborator.subject,
      identity,
      expect.any(AbortSignal)
    );
    expect(api.listShares).toHaveBeenCalledTimes(2);
  });

  test('validates short search locally', async () => {
    await render();
    await search('a');
    expect(api.listUsers).not.toHaveBeenCalled();
    expect(control('home-share-error').textContent).toContain('2–100');
  });

  test('demo sharing uses only its memory store', async () => {
    const demo = createDemoLibrary();
    await render({ mode: 'demo', identity: null, demo });
    await search('示例');
    await click('home-user-result');
    await click('home-share-add');
    expect(demo.listShares(dataset.id)).toHaveLength(1);
    expect(api.listShares).not.toHaveBeenCalled();
    expect(api.listUsers).not.toHaveBeenCalled();
    expect(api.addShare).not.toHaveBeenCalled();
    expect(control('home-share-notice').textContent).toContain('未保存到云端');
  });

  test('public datasets do not read or expose sharing controls', async () => {
    await render({ dataset: { ...dataset, access: 'public' } });
    expect(api.listShares).not.toHaveBeenCalled();
    expect(control('home-share-search')).toBeNull();
    expect(container.textContent).toContain('无需设置共享');
  });

  test('401 preserves the query and selected user while notifying the parent', async () => {
    api.addShare.mockRejectedValue(new ApiError('登录已失效', 401, 'signed-out'));
    await render();
    await search();
    await click('home-user-result');
    await click('home-share-add');
    expect(props.onBlocked).toHaveBeenCalledWith(401, 'signed-out');
    expect((control('home-share-search') as HTMLInputElement).value).toBe('collaborator');
    expect(control('home-user-result').getAttribute('aria-pressed')).toBe('true');
    expect((control('home-share-add') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('a')?.getAttribute('target')).toBe('_blank');
  });

  test('never submits the old selection with a different account identity', async () => {
    await render();
    await search();
    await click('home-user-result');
    await render({ identity: { ...identity, subject: 'account-b' } });
    expect((control('home-share-add') as HTMLButtonElement).disabled).toBe(true);
    await click('home-share-add');
    expect(api.addShare).not.toHaveBeenCalled();
  });

  test('scope cancellation reaches the write and ignores a late success', async () => {
    const write = deferred<void>();
    api.addShare.mockReturnValue(write.promise);
    await render();
    await search();
    await click('home-user-result');
    await click('home-share-add');
    const signal = api.addShare.mock.calls[0][3] as AbortSignal;
    act(() => scope.abort());
    expect(signal.aborted).toBe(true);
    await act(async () => write.resolve());
    expect(control('home-share-notice')).toBeNull();
    expect(api.listShares).toHaveBeenCalledTimes(1);
  });

  test('unknown write results require explicit list refresh before another write', async () => {
    api.addShare.mockRejectedValue(new ApiError('响应超时', 0, 'timeout'));
    await render();
    await search();
    await click('home-user-result');
    await click('home-share-add');
    expect(control('home-share-error').textContent).toContain('结果尚未确认');
    expect((control('home-share-add') as HTMLButtonElement).disabled).toBe(true);
    expect(api.addShare).toHaveBeenCalledTimes(1);
    await click('home-share-refresh');
    expect((control('home-share-add') as HTMLButtonElement).disabled).toBe(false);
    expect(api.addShare).toHaveBeenCalledTimes(1);
  });

  test('confirmed shares have no removal controls, including the current account', async () => {
    api.listShares.mockResolvedValue([{ subject: identity.subject, username: 'me' }]);
    await render();
    expect(control('home-share-remove')).toBeNull();
    expect(control('home-share-remove-confirm')).toBeNull();
    expect(container.textContent).toContain('已共享，不可撤销');
    expect(api.removeShare).not.toHaveBeenCalled();
    expect(props.onResourceLost).not.toHaveBeenCalled();
  });

  test('404 exits the resource without retrying', async () => {
    api.listShares.mockRejectedValue(new ApiError('资源不存在', 404, 'http'));
    await render();
    expect(props.onResourceLost).toHaveBeenCalledTimes(1);
    expect(api.listShares).toHaveBeenCalledTimes(1);
  });

  test('an unavailable share target keeps an accessible dataset open without retrying the write', async () => {
    api.addShare.mockRejectedValue(new ApiError('not found', 404, 'http'));
    await render();
    await search();
    await click('home-user-result');
    await click('home-share-add');
    expect(props.onResourceLost).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(api.addShare).toHaveBeenCalledTimes(1);
    expect(api.getSession).toHaveBeenCalledTimes(1);
    expect(api.listShares).toHaveBeenCalledTimes(2);
    expect((control('home-share-search') as HTMLInputElement).value).toBe('collaborator');
    expect(control('home-share-error').textContent).toContain('目标账号当前不可共享');
    expect((control('home-share-add') as HTMLButtonElement).disabled).toBe(true);
  });

  test('an add 404 exits only when the verification read also loses the dataset', async () => {
    api.addShare.mockRejectedValue(new ApiError('not found', 404, 'http'));
    api.listShares.mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiError('not found', 404));
    await render();
    await search();
    await click('home-user-result');
    await click('home-share-add');
    expect(props.onResourceLost).toHaveBeenCalledTimes(1);
    expect(api.addShare).toHaveBeenCalledTimes(1);
  });

  test('target verification does not read another account shares after an identity change', async () => {
    api.addShare.mockRejectedValue(new ApiError('not found', 404, 'http'));
    api.getSession.mockResolvedValue({ loggedIn: true, ...identity, subject: 'account-b' });
    await render();
    await search();
    await click('home-user-result');
    await click('home-share-add');
    expect(props.onBlocked).toHaveBeenCalledWith(401, 'identity-changed');
    expect(props.onResourceLost).not.toHaveBeenCalled();
    expect(api.listShares).toHaveBeenCalledTimes(1);
    expect(api.addShare).toHaveBeenCalledTimes(1);
  });

  test('a canceled target verification cannot apply its late account or member response', async () => {
    const session = deferred<any>();
    api.addShare.mockRejectedValue(new ApiError('not found', 404, 'http'));
    api.getSession.mockReturnValue(session.promise);
    await render();
    await search();
    await click('home-user-result');
    await click('home-share-add');
    act(() => scope.abort());
    await act(async () => session.resolve({ loggedIn: true, ...identity }));
    expect(api.listShares).toHaveBeenCalledTimes(1);
    expect(props.onResourceLost).not.toHaveBeenCalled();
    expect(props.onBlocked).not.toHaveBeenCalled();
  });

  test('unmount aborts pending requests and does not report late errors', async () => {
    const read = deferred<[]>();
    api.listShares.mockReturnValue(read.promise);
    await render();
    const signal = api.listShares.mock.calls[0][1] as AbortSignal;
    act(() => root.unmount());
    expect(signal.aborted).toBe(true);
    await act(async () => read.reject(new ApiError('late', 401)));
    expect(props.onBlocked).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
