import { describe, expect, test, vi } from 'vitest';
import { MAX_UPLOAD_BYTES, runUpload, UploadProgress } from './upload';
import type { Dataset, Identity } from './api';

const identity: Identity = { issuer: 'https://accounts.example.test/realm', subject: 'account-a' };
const dataset: Dataset = {
  id: 'created-dataset',
  name: '影像集',
  access: 'owner',
  ownerUsername: 'local-test-account',
  instanceCount: 0,
  createdAt: '2026-11-01T00:00:00Z',
};
const file = (name = 'source.dcm', contents = 'sample') =>
  new File([contents], name, { type: 'application/dicom' });
const result = (status: 'Success' | 'AlreadyStored' = 'Success', id = 'stored-instance') => ({
  status,
  id,
});
const api = () => ({
  createDataset: vi.fn().mockResolvedValue(dataset),
  importFile: vi.fn().mockResolvedValue(result()),
});

describe('upload queue validation', () => {
  test.each(['', '   ', 'x'.repeat(201)])(
    'rejects invalid names before creating a dataset',
    async (name) => {
      const client = api();
      await expect(runUpload(client, { name, files: [file()], identity })).rejects.toThrow('名称');
      expect(client.createDataset).not.toHaveBeenCalled();
      expect(client.importFile).not.toHaveBeenCalled();
    }
  );

  test('rejects an empty selection before creating a dataset', async () => {
    const client = api();
    await expect(runUpload(client, { name: '影像集', files: [], identity })).rejects.toThrow(
      '至少'
    );
    expect(client.createDataset).not.toHaveBeenCalled();
  });

  test('validates every file before starting any mutation', async () => {
    const client = api();
    const tooLarge = file('large.dcm');
    Object.defineProperty(tooLarge, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    await expect(
      runUpload(client, { name: '影像集', files: [file('valid.dcm'), tooLarge], identity })
    ).rejects.toThrow('64 MiB');
    expect(client.createDataset).not.toHaveBeenCalled();
  });

  test.each([
    new File([], 'empty.dcm'),
    new File(['archive'], 'batch.ZIP'),
    new File(['archive'], 'renamed.dcm', { type: 'application/zip' }),
  ])('rejects empty files and unsupported ZIP archives', async (invalid) => {
    const client = api();
    await expect(
      runUpload(client, { name: '影像集', files: [invalid], identity })
    ).rejects.toThrow();
    expect(client.createDataset).not.toHaveBeenCalled();
  });

  test('accepts the 64 MiB boundary and does not infer valid DICOM from a suffix', async () => {
    const client = api();
    const boundary = file('DICOMDIR');
    Object.defineProperty(boundary, 'size', { value: MAX_UPLOAD_BYTES });
    const state = await runUpload(client, {
      name: '  影像集  ',
      files: [boundary, file('image.IMA')],
      identity,
    });
    expect(client.createDataset).toHaveBeenCalledWith('影像集', identity, undefined);
    expect(client.importFile).toHaveBeenCalledTimes(2);
    expect(state.success).toBe(2);
  });
});

describe('confirmed serial upload outcomes', () => {
  test('starts the next file only after the current request completes', async () => {
    const client = api();
    let finishFirst;
    const first = new Promise((resolve) => {
      finishFirst = resolve;
    });
    client.importFile.mockImplementationOnce(() => first).mockResolvedValueOnce(result());
    const files = [file('first.dcm'), file('second.dcm')];
    const completion = runUpload(client, { name: '影像集', files, identity });
    await Promise.resolve();
    expect(client.importFile).toHaveBeenCalledTimes(1);
    expect(client.importFile.mock.calls[0][1]).toBe(files[0]);
    finishFirst(result());
    const state = await completion;
    expect(client.importFile).toHaveBeenCalledTimes(2);
    expect(client.importFile.mock.calls[1][1]).toBe(files[1]);
    expect(state).toMatchObject({ total: 2, completed: 2, success: 2, stopped: false });
  });

  test('counts new, already stored and ordinary failures separately without retrying', async () => {
    const client = api();
    client.importFile
      .mockRejectedValueOnce({ status: 400, message: '不是有效 DICOM', kind: 'http' })
      .mockResolvedValueOnce(result('AlreadyStored'))
      .mockResolvedValueOnce(result());
    const state = await runUpload(client, {
      name: '影像集',
      files: [file('invalid.dcm'), file('existing.dcm'), file('new.dcm')],
      identity,
    });
    expect(state).toMatchObject({
      total: 3,
      completed: 3,
      success: 1,
      alreadyStored: 1,
      failed: 1,
      stopped: false,
    });
    expect(state.errors).toEqual([{ name: 'invalid.dcm', message: '不是有效 DICOM' }]);
    expect(client.importFile).toHaveBeenCalledTimes(3);
    // Duplicate association does not prove that the dataset member count increased.
    expect(state.dataset?.instanceCount).toBe(0);
  });

  test.each([
    { status: 401, kind: 'http' },
    { status: 403, kind: 'http' },
    { status: 404, kind: 'http' },
    { status: 401, kind: 'identity-changed' },
  ])('stops on a session or permission failure: %j', async (failure) => {
    const client = api();
    client.importFile
      .mockResolvedValueOnce(result())
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(result());
    const state = await runUpload(client, {
      name: '影像集',
      files: [file('confirmed.dcm'), file('blocked.dcm'), file('not-started.dcm')],
      identity,
    });
    expect(state).toMatchObject({
      completed: 2,
      success: 1,
      failed: 1,
      stopped: true,
      blockingStatus: failure.status,
      blockingKind: failure.kind,
    });
    expect(client.importFile).toHaveBeenCalledTimes(2);
    expect(state.errors[0].name).toBe('blocked.dcm');
  });

  test('keeps immutable snapshots and a stable operation identity', async () => {
    const client = api();
    client.importFile
      .mockRejectedValueOnce({ status: 409, kind: 'http', message: '内容不同' })
      .mockResolvedValueOnce(result());
    const account = { ...identity };
    const files = [file('conflict.dcm'), file('confirmed.dcm')];
    const snapshots: UploadProgress[] = [];
    const state = await runUpload(client, {
      name: '影像集',
      files,
      identity: account,
      onProgress: (progress) => {
        snapshots.push(progress);
        account.subject = 'different-account';
        files.pop();
      },
    });
    expect(client.importFile).toHaveBeenCalledTimes(2);
    expect(client.createDataset.mock.calls[0][1]).toEqual(identity);
    expect(client.importFile.mock.calls[1][2]).toEqual(identity);
    expect(snapshots[0].dataset).toBeNull();
    expect(snapshots[0].errors).toEqual([]);
    expect(snapshots[1].errors).toEqual([]);
    expect(snapshots[2].errors).toHaveLength(1);
    expect(snapshots[2].completed).toBe(1);
    expect(state.completed).toBe(2);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.dataset)).toBe(true);
    expect(Object.isFrozen(state.errors)).toBe(true);
    expect(Object.isFrozen(state.errors[0])).toBe(true);
    expect(() => state.errors.push({ name: 'injected', message: 'not allowed' })).toThrow();
  });
});

describe('cancellation and unknown results', () => {
  test('does not describe an unconfigured adapter as an uncertain server mutation', async () => {
    const client = api();
    client.createDataset.mockRejectedValueOnce({ status: 0, kind: 'unconfigured' });
    const state = await runUpload(client, { name: '影像集', files: [file()], identity });
    expect(state).toMatchObject({
      dataset: null,
      completed: 0,
      stopped: true,
      blockingKind: 'unconfigured',
    });
    expect(state.errors[0].message).toContain('尚未创建影像集或上传文件');
    expect(state.errors[0].message).not.toContain('结果尚未确认');
    expect(client.importFile).not.toHaveBeenCalled();
  });

  test('does not create a dataset if already cancelled', async () => {
    const client = api();
    const controller = new AbortController();
    controller.abort();
    const state = await runUpload(client, {
      name: '影像集',
      files: [file()],
      identity,
      signal: controller.signal,
    });
    expect(state).toMatchObject({ dataset: null, stopped: true, completed: 0, failed: 0 });
    expect(client.createDataset).not.toHaveBeenCalled();
    expect(client.importFile).not.toHaveBeenCalled();
    expect(state.errors[0].message).toContain('尚未创建');
  });

  test('retains a confirmed response when cancellation arrives between files', async () => {
    const client = api();
    const controller = new AbortController();
    client.importFile.mockImplementationOnce(async () => {
      controller.abort();
      return result();
    });
    const state = await runUpload(client, {
      name: '影像集',
      files: [file('confirmed.dcm'), file('not-started.dcm')],
      identity,
      signal: controller.signal,
    });
    expect(state).toMatchObject({ completed: 1, success: 1, failed: 0, stopped: true });
    expect(state.dataset?.id).toBe(dataset.id);
    expect(client.importFile).toHaveBeenCalledTimes(1);
    expect(state.errors[0].message).toContain('尚未开始');
    expect(state.errors[0].message).toContain('未自动回滚');
  });

  test('does not label an aborted in-flight request as a confirmed failure', async () => {
    const client = api();
    const controller = new AbortController();
    let rejectCurrent;
    let notifyStarted;
    const started = new Promise((resolve) => {
      notifyStarted = resolve;
    });
    client.importFile.mockResolvedValueOnce(result()).mockImplementationOnce(() => {
      notifyStarted();
      return new Promise((_resolve, reject) => {
        rejectCurrent = reject;
      });
    });
    const completion = runUpload(client, {
      name: '影像集',
      files: [file('confirmed.dcm'), file('unknown.dcm'), file('not-started.dcm')],
      identity,
      signal: controller.signal,
    });
    await started;
    controller.abort();
    rejectCurrent(new DOMException('aborted', 'AbortError'));
    const state = await completion;
    expect(state).toMatchObject({
      completed: 1,
      success: 1,
      failed: 0,
      stopped: true,
      blockingStatus: 0,
      blockingKind: 'aborted',
    });
    expect(client.importFile).toHaveBeenCalledTimes(2);
    expect(state.errors[0].message).toContain('尚未确认');
    expect(state.errors[0].message).toContain('刷新影像集核对');
  });

  test.each([
    { status: 0, kind: 'network' },
    { status: 0, kind: 'protocol' },
    { status: 503, kind: 'http' },
  ])('stops with an unknown outcome rather than claiming rollback: %j', async (failure) => {
    const client = api();
    client.importFile
      .mockResolvedValueOnce(result())
      .mockRejectedValueOnce({ ...failure, message: 'private-provider-detail' });
    const state = await runUpload(client, {
      name: '影像集',
      files: [file('confirmed.dcm'), file('unknown.dcm'), file('not-started.dcm')],
      identity,
    });
    expect(state).toMatchObject({ completed: 1, success: 1, failed: 0, stopped: true });
    expect(client.importFile).toHaveBeenCalledTimes(2);
    expect(state.errors[0].message).toContain('不会自动回滚');
    expect(state.errors[0].message).not.toContain('private-provider-detail');
  });

  test('treats an invalid import response as unknown rather than successful', async () => {
    const client = api();
    client.importFile.mockResolvedValueOnce({ status: 'unexpected', id: 'unknown' });
    const state = await runUpload(client, {
      name: '影像集',
      files: [file('unknown.dcm'), file('not-started.dcm')],
      identity,
    });
    expect(state).toMatchObject({
      completed: 0,
      success: 0,
      failed: 0,
      stopped: true,
      blockingKind: 'protocol',
    });
    expect(client.importFile).toHaveBeenCalledTimes(1);
  });

  test.each([
    { status: 403, kind: 'http' },
    { status: 0, kind: 'network' },
  ])('does not start file requests after a dataset-creation error: %j', async (failure) => {
    const client = api();
    client.createDataset.mockRejectedValueOnce(failure);
    const state = await runUpload(client, { name: '影像集', files: [file()], identity });
    expect(state).toMatchObject({
      dataset: null,
      completed: 0,
      failed: 0,
      stopped: true,
      blockingStatus: failure.status,
      blockingKind: failure.kind,
    });
    expect(client.importFile).not.toHaveBeenCalled();
    if (failure.status === 0) expect(state.errors[0].message).toContain('勿直接重复创建');
  });
});
