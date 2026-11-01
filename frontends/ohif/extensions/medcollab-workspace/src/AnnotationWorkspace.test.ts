import { AnnotationWorkspace, WorkspaceError } from './AnnotationWorkspace';
import type { LaunchContext, WorkspaceBackend, WorkspaceDriver, WorkspaceEvent } from './types';

const request = { caseId: 'case-a', intent: 'edit', locale: 'zh' } as const;
const source = {
  id: 'source-a', studyInstanceUID: '1.2.3', seriesInstanceUID: '1.2.3.4',
  frameOfReferenceUID: '1.2.3.5', frames: [{ sopInstanceUID: '1.2.3.6', frameNumber: 1 }],
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad; });
  return { promise, resolve, reject };
};

function setup() {
  let sequence = 0;
  const context: LaunchContext = {
    caseId: request.caseId, dataSourceId: 'ohif', sourceManifest: structuredClone(source),
    revision: 'rev-1', permissions: { canView: true, canEdit: true }, version: null,
  };
  const lease = { leaseId: 'lease-1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const receipt = { caseId: 'case-a', draftVersionId: 'draft-1', revision: 'rev-2', persistedAt: new Date().toISOString() };
  const backend: jest.Mocked<WorkspaceBackend> = {
    getLaunchContext: jest.fn(async () => structuredClone(context)),
    acquireLease: jest.fn(async () => ({ ...lease })),
    releaseLease: jest.fn(async () => {}),
    persistArtifacts: jest.fn(async () => ['artifact-1']),
    commitDraft: jest.fn(async () => ({ ...receipt })),
  };
  const driver: jest.Mocked<WorkspaceDriver> = {
    validateContext: jest.fn(), open: jest.fn(async () => {}),
    captureArtifacts: jest.fn(async () => [{
      bytes: new Blob(['SEG']), format: 'DICOM_SEG', sopInstanceUID: '1.2.3.7',
      seriesInstanceUID: '1.2.3.8', sopClassUID: '1.2.840.10008.5.1.4.1.1.66.7',
      sourceManifestId: source.id,
    }]),
    setReadOnly: jest.fn(), clear: jest.fn(),
  };
  const workspace = new AnnotationWorkspace(driver, () => `id-${++sequence}`);
  const confirm = jest.fn(async () => 'stay' as const);
  workspace.configure(backend, confirm);
  const events: WorkspaceEvent[] = [];
  workspace.subscribe(event => events.push(event));
  const dirty = () => workspace.markDirty(workspace.getEditState().sessionId!);
  return { workspace, backend, driver, context, receipt, events, confirm, dirty };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('an unconfigured backend cannot claim to open or save a case', async () => {
  const { driver } = setup();
  const workspace = new AnnotationWorkspace(driver, () => 'session');
  await expect(workspace.openCase(request)).rejects.toMatchObject({ code: 'BACKEND_NOT_CONFIGURED' });
  await expect(workspace.saveDraft()).rejects.toMatchObject({ code: 'BACKEND_NOT_CONFIGURED' });
  expect(driver.open).not.toHaveBeenCalled();
});

test('ready and changes carry the current case/session and ignore stale callbacks', async () => {
  const s = setup();
  await s.workspace.openCase(request);
  expect(s.events[0]).toMatchObject({ type: 'ready', caseId: 'case-a', sessionId: 'id-1' });
  s.workspace.markDirty('old-session');
  expect(s.workspace.getEditState().dirty).toBe(false);
  s.dirty();
  expect(s.workspace.getEditState()).toMatchObject({ dirty: true, leaseValid: true, readOnly: false });
});

test('review resolves a fixed submission, uses no edit lease and refuses saves', async () => {
  const s = setup();
  s.context.version = { id: 'submission-1', kind: 'submission', sourceManifestId: source.id, sopInstanceUIDs: [], instances: [] };
  await s.workspace.openCase({ ...request, intent: 'review' });
  expect(s.workspace.getEditState()).toMatchObject({ versionId: 'submission-1', readOnly: true });
  expect(s.backend.acquireLease).not.toHaveBeenCalled();
  await expect(s.workspace.saveDraft()).rejects.toMatchObject({ code: 'EDIT_NOT_ALLOWED' });
});

test.each(['unfixed-review', 'wrong-version', 'wrong-case', 'wrong-source', 'forbidden'])('%s fails before viewer navigation', async kind => {
  const s = setup();
  const req: any = { ...request };
  if (kind === 'unfixed-review') req.intent = 'review';
  if (kind === 'wrong-version') req.versionId = 'unknown';
  if (kind === 'wrong-case') s.context.caseId = 'case-b';
  if (kind === 'forbidden') s.context.permissions.canView = false;
  if (kind === 'wrong-source') s.context.version = {
    id: 'draft-1', kind: 'draft', sourceManifestId: 'other-source', sopInstanceUIDs: [], instances: [],
  };
  await expect(s.workspace.openCase(req)).rejects.toBeInstanceOf(WorkspaceError);
  expect(s.driver.open).not.toHaveBeenCalled();
});

test('upload alone cannot mark a draft saved; confirmation advances the version', async () => {
  const s = setup(); const commit = deferred<any>();
  s.backend.commitDraft.mockReturnValue(commit.promise);
  await s.workspace.openCase(request); s.dirty();
  const saving = s.workspace.saveDraft();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(s.workspace.getEditState()).toMatchObject({ dirty: true, saving: true });
  expect(s.events.some(e => e.type === 'saveSucceeded')).toBe(false);
  commit.resolve(s.receipt); await saving;
  expect(s.workspace.getEditState()).toMatchObject({ dirty: false, saving: false, versionId: 'draft-1' });
});

test('edits made during save stay dirty and a second click shares the in-flight operation', async () => {
  const s = setup(); const commit = deferred<any>();
  s.backend.commitDraft.mockReturnValue(commit.promise);
  await s.workspace.openCase(request); s.dirty();
  const saving = s.workspace.saveDraft();
  expect(s.workspace.saveDraft()).toBe(saving);
  await Promise.resolve(); await Promise.resolve();
  s.dirty(); commit.resolve(s.receipt); await saving;
  expect(s.workspace.getEditState().dirty).toBe(true);
  expect(s.backend.commitDraft).toHaveBeenCalledTimes(1);
});

test('ambiguous failure retries the exact snapshot/idempotency key without re-upload', async () => {
  const s = setup();
  s.backend.commitDraft.mockRejectedValueOnce(new Error('response lost'));
  await s.workspace.openCase(request); s.dirty();
  await expect(s.workspace.saveDraft()).rejects.toThrow('response lost');
  const first = s.backend.commitDraft.mock.calls[0][0];
  s.dirty(); await s.workspace.saveDraft();
  expect(s.backend.commitDraft.mock.calls[1][0].operationId).toBe(first.operationId);
  expect(s.backend.persistArtifacts).toHaveBeenCalledTimes(1);
  expect(s.driver.captureArtifacts).toHaveBeenCalledTimes(1);
  expect(s.workspace.getEditState().dirty).toBe(true);
});

test('revision conflict blocks further writes and keeps unsaved content', async () => {
  const s = setup();
  s.backend.commitDraft.mockRejectedValue(new WorkspaceError('REVISION_MISMATCH'));
  await s.workspace.openCase(request); s.dirty();
  await expect(s.workspace.saveDraft()).rejects.toMatchObject({ code: 'REVISION_MISMATCH' });
  expect(s.workspace.getEditState()).toMatchObject({ dirty: true, saving: false, readOnly: true });
  await expect(s.workspace.saveDraft()).rejects.toMatchObject({ code: 'EDIT_NOT_ALLOWED' });
});

test('lease expiry disables editing and never submits a late upload', async () => {
  const s = setup(); const upload = deferred<string[]>();
  s.backend.persistArtifacts.mockReturnValue(upload.promise);
  await s.workspace.openCase(request); s.dirty();
  const saving = s.workspace.saveDraft();
  await Promise.resolve(); await Promise.resolve();
  jest.advanceTimersByTime(60_001); upload.resolve(['artifact-1']);
  await expect(saving).rejects.toMatchObject({ code: 'LEASE_EXPIRED' });
  expect(s.backend.commitDraft).not.toHaveBeenCalled();
  expect(s.workspace.getEditState()).toMatchObject({ dirty: true, leaseValid: false });
  expect(s.driver.setReadOnly).toHaveBeenLastCalledWith(true);
});

test('cancel/discard permission does not erase edits or release a lease until actual close', async () => {
  const s = setup(); await s.workspace.openCase(request); s.dirty();
  expect(await s.workspace.prepareToLeave()).toBe('stay');
  expect(s.backend.releaseLease).not.toHaveBeenCalled();
  s.confirm.mockResolvedValue('discard' as any);
  expect(await s.workspace.prepareToLeave()).toBe('discard-confirmed');
  expect(s.workspace.getEditState().dirty).toBe(true);
  expect(s.backend.releaseLease).not.toHaveBeenCalled();
  expect(await s.workspace.close()).toBe(true);
  expect(s.backend.releaseLease).toHaveBeenCalledTimes(1);
  expect(s.workspace.getEditState().caseId).toBe(null);
});

test('a rejected new context preserves the current dirty viewer', async () => {
  const s = setup(); await s.workspace.openCase(request); s.dirty();
  await expect(s.workspace.openCase({ ...request, caseId: 'case-b' })).rejects.toMatchObject({ code: 'LEAVE_CANCELLED' });
  expect(s.workspace.getEditState()).toMatchObject({ caseId: 'case-a', dirty: true });
});

test('UI listener errors cannot turn confirmed persistence into failure', async () => {
  const s = setup(); s.workspace.subscribe(() => { throw new Error('UI bug'); });
  await s.workspace.openCase(request); s.dirty();
  await expect(s.workspace.saveDraft()).resolves.toMatchObject(s.receipt);
  expect(s.workspace.getEditState().dirty).toBe(false);
});
