import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import UploadPanel from './UploadPanel';
import { ApiError, Dataset, HomeApi } from './api';
import { MAX_UPLOAD_BYTES } from './upload-policy';

vi.mock('../../ui', async () => {
  const React = await import('react');
  return {
    Button: React.forwardRef(({ children, dataCY, variant, size, ...props }: any, ref) =>
      React.createElement('button', { ...props, ref, 'data-cy': dataCY }, children)
    ),
    Input: React.forwardRef((props: any, ref) => React.createElement('input', { ...props, ref })),
    Label: ({ children, ...props }: any) => React.createElement('label', props, children),
    Icons: { Upload: () => null },
  };
});

const dataset: Dataset = {
  id: 'created-dataset',
  name: '待导入影像',
  access: 'owner',
  ownerUsername: 'owner',
  instanceCount: 0,
  createdAt: '2026-11-01T00:00:00Z',
};
const identity = { issuer: 'https://identity.example.test', subject: 'account-a' };
const file = (name = 'source.dcm') => new File(['sample'], name, { type: 'application/dicom' });
const stored = (status = 'Success') => ({ status, id: 'stored-instance' });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('upload panel operation isolation', () => {
  let container: HTMLDivElement;
  let root: Root;
  let scope: AbortController;
  let api;
  let props;
  const control = (id: string) => container.querySelector(`[data-cy="${id}"]`) as HTMLElement;
  const nameInput = () => control('home-upload-name') as HTMLInputElement;
  const start = () => control('home-upload-start') as HTMLButtonElement;
  const changeName = (value = '待导入影像') =>
    act(() => Simulate.change(nameInput(), { target: { value } } as any));
  const select = (files = [file()], id = 'home-upload-files') => {
    const input = control(id) as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    act(() => Simulate.change(input));
  };
  const submit = async () => {
    await act(async () => Simulate.submit(container.querySelector('form') as HTMLFormElement));
  };
  const click = async (id: string) => {
    await act(async () => control(id).click());
  };
  const render = async (changes = {}) => {
    props = { ...props, ...changes };
    await act(async () => root.render(React.createElement(UploadPanel, props)));
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    scope = new AbortController();
    api = {
      createDataset: vi.fn().mockResolvedValue(dataset),
      importFile: vi.fn().mockResolvedValue(stored()),
    } as unknown as HomeApi;
    props = {
      mode: 'real',
      api,
      identity,
      scopeSignal: scope.signal,
      enabled: true,
      loginUrl: 'http://127.0.0.1:8080/auth/login',
      onBusyChange: vi.fn(),
      onBlocked: vi.fn(),
      onCompleted: vi.fn(),
      onClose: vi.fn(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  test('demo selection renders names and sizes without reading bytes or calling APIs', async () => {
    const selected = file('private-source.dcm');
    const reads = ['arrayBuffer', 'text', 'stream', 'slice'].map((method) => {
      const read = vi.fn(() => {
        throw new Error('File content must not be read');
      });
      Object.defineProperty(selected, method, { value: read });
      return read;
    });
    const fileReader = vi.spyOn(globalThis, 'FileReader').mockImplementation(() => {
      throw new Error('FileReader must not be used');
    });
    const fetch = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      await render({ mode: 'demo', identity: null, enabled: false });
      changeName('演示选择');
      select([selected]);
      expect(nameInput().value).toBe('演示选择');
      expect(container.textContent).toContain('private-source.dcm');
      expect(container.textContent).toContain('6 B');
      expect(container.textContent).toContain('本机演示不会读取或上传文件');
      expect(start().disabled).toBe(true);
      await submit();
      expect(api.createDataset).not.toHaveBeenCalled();
      expect(api.importFile).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(fileReader).not.toHaveBeenCalled();
      reads.forEach((read) => expect(read).not.toHaveBeenCalled());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('prevalidates locally and lets the user correct a name before starting', async () => {
    await render();
    select();
    await submit();
    expect(api.createDataset).not.toHaveBeenCalled();
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(nameInput());
    expect(control('home-upload-progress')).toBeNull();
    changeName();
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
    expect(props.onCompleted).toHaveBeenCalledTimes(1);
  });
  test('shows the 1 GiB single-file policy and rejects one byte over it without a request', async () => {
    await render();
    expect(container.textContent).toContain('单个文件不超过 1 GiB');
    expect(container.textContent).toContain('文件夹按文件逐个导入');
    const oversized = file('too-large.dcm');
    Object.defineProperty(oversized, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    changeName();
    select([oversized]);
    await submit();
    expect(container.textContent).toContain('超过 1 GiB 限制');
    expect(api.createDataset).not.toHaveBeenCalled();
    expect(api.importFile).not.toHaveBeenCalled();
  });

  test('appends to an existing target and displays the destination without a creation field', async () => {
    await render({ targetDataset: dataset, destinationLabel: '研究团队' });
    expect(nameInput()).toBeNull();
    expect(container.textContent).toContain('研究团队');
    expect(container.textContent).toContain(dataset.name);
    select();
    await submit();
    expect(api.createDataset).not.toHaveBeenCalled();
    expect(api.importFile).toHaveBeenCalledWith(
      dataset.id,
      expect.any(File),
      identity,
      expect.any(AbortSignal)
    );
  });

  test('changing append target cancels in-flight work and rejects its late response', async () => {
    const request = deferred<{ status: string; id: string }>();
    api.importFile.mockReturnValueOnce(request.promise);
    await render({ targetDataset: dataset });
    select([file('one.dcm'), file('two.dcm')]);
    await submit();
    const signal = api.importFile.mock.calls[0][3] as AbortSignal;
    await render({ targetDataset: { ...dataset, id: 'another-target' } });
    expect(signal.aborted).toBe(true);
    await act(async () => request.resolve(stored()));
    expect(api.importFile).toHaveBeenCalledTimes(1);
    expect(props.onCompleted).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('one.dcm');
  });

  test('preserves same-account fields on an idle scope replacement without replaying', async () => {
    await render();
    const selected = file('preserved.dcm');
    changeName('保留输入');
    select([selected]);
    const nextScope = new AbortController();
    await render({ scopeSignal: nextScope.signal, identity: { ...identity } });
    expect(nameInput().value).toBe('保留输入');
    expect(container.textContent).toContain('preserved.dcm');
    expect(start().disabled).toBe(false);
    expect(api.createDataset).not.toHaveBeenCalled();
    expect(api.importFile).not.toHaveBeenCalled();
    await submit();
    expect(api.createDataset).toHaveBeenCalledWith('保留输入', identity, expect.any(AbortSignal));
    expect(api.importFile).toHaveBeenCalledWith(
      dataset.id,
      selected,
      identity,
      expect.any(AbortSignal)
    );
    expect(props.onCompleted).toHaveBeenCalledTimes(1);
  });

  test('keeps a cancelled idle selection and requires an explicit action on the new scope', async () => {
    await render();
    changeName();
    select([file('not-started.dcm')]);
    act(() => scope.abort());
    expect(start().disabled).toBe(true);
    await submit();
    expect(api.createDataset).not.toHaveBeenCalled();
    await render({ scopeSignal: new AbortController().signal });
    expect(start().disabled).toBe(false);
    expect(container.textContent).toContain('not-started.dcm');
    expect(api.createDataset).not.toHaveBeenCalled();
  });

  test('invalidates a pending creation immediately on scope abort and ignores a late result', async () => {
    const creation = deferred<Dataset>();
    api.createDataset.mockReturnValue(creation.promise);
    await render();
    changeName();
    select();
    await submit();
    const signal = api.createDataset.mock.calls[0][2] as AbortSignal;
    act(() => scope.abort());
    expect(signal.aborted).toBe(true);
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('false');
    expect(container.textContent).toContain('核对');
    await act(async () => creation.resolve(dataset));
    expect(api.importFile).not.toHaveBeenCalled();
    expect(props.onCompleted).not.toHaveBeenCalled();
    expect(props.onBlocked).not.toHaveBeenCalled();
    expect(control('home-upload-summary')?.textContent).toContain('成功 0');
    await render({ scopeSignal: new AbortController().signal });
    expect(nameInput().value).toBe('待导入影像');
    expect(start().disabled).toBe(true);
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
  });

  test('scope replacement aborts an in-flight import and retains its last confirmed counters', async () => {
    const upload = deferred<{ status: string; id: string }>();
    api.importFile.mockResolvedValueOnce(stored()).mockReturnValueOnce(upload.promise);
    await render();
    changeName();
    select([file('confirmed.dcm'), file('unknown.dcm'), file('not-started.dcm')]);
    await submit();
    expect(api.importFile).toHaveBeenCalledTimes(2);
    const signal = api.importFile.mock.calls[1][3] as AbortSignal;
    await render({ scopeSignal: new AbortController().signal });
    expect(signal.aborted).toBe(true);
    expect(nameInput().value).toBe('待导入影像');
    expect(container.textContent).toContain('unknown.dcm');
    expect(control('home-upload-summary').textContent).toContain('成功 1');
    expect(start().disabled).toBe(true);
    await act(async () => upload.resolve(stored()));
    expect(control('home-upload-summary').textContent).toContain('成功 1');
    expect(api.importFile).toHaveBeenCalledTimes(2);
    expect(props.onCompleted).not.toHaveBeenCalled();
    expect(props.onBlocked).not.toHaveBeenCalled();
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
  });

  test('clears account A selections before accepting any account B submission', async () => {
    const upload = deferred<{ status: string; id: string }>();
    api.importFile.mockReturnValueOnce(upload.promise).mockResolvedValueOnce(stored());
    await render();
    const accountAFile = file('account-a.dcm');
    changeName('账号 A 选择');
    select([accountAFile]);
    await submit();
    const oldSignal = api.importFile.mock.calls[0][3] as AbortSignal;
    const accountB = { ...identity, subject: 'account-b' };
    await render({ identity: accountB });
    expect(oldSignal.aborted).toBe(true);
    expect(nameInput().value).toBe('');
    expect(container.textContent).not.toContain('account-a.dcm');
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
    const accountBFile = file('account-b.dcm');
    changeName('账号 B 选择');
    select([accountBFile]);
    await submit();
    expect(api.createDataset.mock.calls[1][1]).toEqual(accountB);
    expect(api.importFile.mock.calls[1][1]).toBe(accountBFile);
    expect(api.importFile.mock.calls[1][2]).toEqual(accountB);
    await act(async () => upload.resolve(stored()));
    expect(api.importFile).toHaveBeenCalledTimes(2);
    expect(props.onCompleted).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('account-a.dcm');
  });

  test('rejects an account A picker result that returns after switching to account B', async () => {
    await render();
    await click('home-upload-choose-files');
    await render({ identity: { ...identity, subject: 'account-b' } });
    changeName('账号 B 选择');
    select([file('late-account-a.dcm')]);
    expect(container.textContent).not.toContain('late-account-a.dcm');
    await submit();
    expect(api.createDataset).not.toHaveBeenCalled();
  });

  test('session loss without a new scope aborts and preserves the selection without replaying', async () => {
    const upload = deferred<{ status: string; id: string }>();
    api.importFile.mockReturnValue(upload.promise);
    await render();
    changeName();
    select([file('retained-on-expiry.dcm')]);
    await submit();
    const signal = api.importFile.mock.calls[0][3] as AbortSignal;
    await render({ identity: null, enabled: false });
    expect(signal.aborted).toBe(true);
    expect(nameInput().value).toBe('待导入影像');
    expect(container.textContent).toContain('retained-on-expiry.dcm');
    await act(async () => upload.resolve(stored()));
    expect(props.onCompleted).not.toHaveBeenCalled();
    await render({ identity: { ...identity }, enabled: true });
    expect(start().disabled).toBe(true);
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
    expect(api.importFile).toHaveBeenCalledTimes(1);
  });

  test.each([
    new ApiError('响应超时', 0, 'timeout'),
    new ApiError('响应无效', 0, 'protocol'),
    new ApiError('服务不可用', 503, 'http'),
  ])('unknown outcomes remain locked after a read-only scope refresh: %j', async (failure) => {
    api.importFile.mockRejectedValue(failure);
    await render();
    changeName();
    select();
    await submit();
    expect(control('home-upload-summary').textContent).toContain('成功 0');
    expect(control('home-upload-summary').textContent).toContain('失败 0');
    expect(container.textContent).toContain('结果尚未确认');
    expect(props.onCompleted).not.toHaveBeenCalled();
    expect(start().disabled).toBe(true);
    await render({ scopeSignal: new AbortController().signal });
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
    expect(api.importFile).toHaveBeenCalledTimes(1);
  });

  test('401 reports the block while retaining input and never retries after session refresh', async () => {
    api.importFile.mockRejectedValue(new ApiError('会话已失效', 401, 'signed-out'));
    await render();
    changeName();
    select([file('blocked.dcm')]);
    await submit();
    expect(props.onBlocked).toHaveBeenCalledWith(401, 'signed-out');
    expect(nameInput().value).toBe('待导入影像');
    expect(container.textContent).toContain('blocked.dcm');
    expect(props.onCompleted).not.toHaveBeenCalled();
    await render({ scopeSignal: new AbortController().signal });
    expect(start().disabled).toBe(true);
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
    expect(api.importFile).toHaveBeenCalledTimes(1);
  });

  test('reports separate outcomes and releases busy before the read-only completion refresh', async () => {
    api.importFile
      .mockResolvedValueOnce(stored())
      .mockResolvedValueOnce(stored('AlreadyStored'))
      .mockRejectedValueOnce(new ApiError('文件格式无效', 400, 'http'));
    await render();
    changeName();
    select([file('new.dcm'), file('existing.dcm'), file('invalid.dcm')]);
    await submit();
    expect(control('home-upload-summary').textContent).toContain('成功 1');
    expect(control('home-upload-summary').textContent).toContain('已存在 1');
    expect(control('home-upload-summary').textContent).toContain('失败 1');
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(props.onCompleted).toHaveBeenCalledTimes(1);
    expect(props.onBusyChange.mock.invocationCallOrder[1]).toBeLessThan(
      props.onCompleted.mock.invocationCallOrder[0]
    );
    expect(start().disabled).toBe(true);
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
  });

  test('double submit starts one operation and stop keeps confirmed results without rollback', async () => {
    const upload = deferred<{ status: string; id: string }>();
    api.importFile.mockResolvedValueOnce(stored()).mockReturnValueOnce(upload.promise);
    await render();
    changeName();
    select([file('confirmed.dcm'), file('unknown.dcm'), file('not-started.dcm')]);
    await submit();
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
    const signal = api.importFile.mock.calls[1][3] as AbortSignal;
    await click('home-upload-cancel');
    expect(signal.aborted).toBe(true);
    await act(async () => upload.reject(new DOMException('aborted', 'AbortError')));
    expect(control('home-upload-summary').textContent).toContain('成功 1');
    expect(control('home-upload-summary').textContent).toContain('失败 0');
    expect(container.textContent).toContain('不会自动回滚');
    expect(api.importFile).toHaveBeenCalledTimes(2);
    expect(props.onCompleted).not.toHaveBeenCalled();
  });

  test('changing to demo aborts an operation and clears the real-account files', async () => {
    const upload = deferred<{ status: string; id: string }>();
    api.importFile.mockReturnValue(upload.promise);
    await render();
    changeName();
    select([file('real-account.dcm')]);
    await submit();
    const signal = api.importFile.mock.calls[0][3] as AbortSignal;
    await render({ mode: 'demo', identity: null, enabled: false });
    expect(signal.aborted).toBe(true);
    expect(nameInput().value).toBe('');
    expect(container.textContent).not.toContain('real-account.dcm');
    await act(async () => upload.resolve(stored()));
    expect(control('home-upload-summary')).toBeNull();
    expect(props.onCompleted).not.toHaveBeenCalled();
    await submit();
    expect(api.createDataset).toHaveBeenCalledTimes(1);
  });

  test('unmount aborts the request and ignores all late response callbacks', async () => {
    const creation = deferred<Dataset>();
    api.createDataset.mockReturnValue(creation.promise);
    await render();
    changeName();
    select();
    await submit();
    const signal = api.createDataset.mock.calls[0][2] as AbortSignal;
    act(() => root.unmount());
    expect(signal.aborted).toBe(true);
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
    await act(async () => creation.reject(new ApiError('late', 401, 'signed-out')));
    expect(props.onCompleted).not.toHaveBeenCalled();
    expect(props.onBlocked).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
