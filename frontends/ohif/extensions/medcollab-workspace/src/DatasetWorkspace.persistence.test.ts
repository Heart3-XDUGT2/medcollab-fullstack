import { webcrypto } from 'node:crypto';
import { DatasetWorkspace } from './DatasetWorkspace';

jest.mock('./OHIFWorkspaceDriver', () => ({ OHIFWorkspaceDriver: jest.fn() }));
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const segments = [{ number: 1, label: '心脏', color: [255, 80, 80] }];
const painted = { segments, masks: [{ instanceId: 'slice', runs: [0, 2, 1] }] };
const erased = { segments, masks: [] };
let realtime = false;
const previousWindow = (globalThis as any).window;
beforeEach(() => {
  jest.useFakeTimers();
  realtime = false;
  (globalThis as any).window = {
    localStorage: { getItem: () => String(realtime) },
    removeEventListener: jest.fn(),
  };
});
afterEach(() => {
  jest.useRealTimers();
  (globalThis as any).window = previousWindow;
});

function fixture() {
  let canvas = structuredClone(painted);
  let stored: any = { revision: 0, draft: null };
  const response = deferred<any>();
  const requested = deferred();
  const runtime = { commandsManager: { registerCommand: jest.fn() } };
  const workspace: any = new DatasetWorkspace(runtime);
  workspace.guard = { setReadOnly: jest.fn(), clear: jest.fn() };
  workspace.stopped = false;
  workspace.state.ready = true;
  workspace.key = 'issuer/alice/dataset/series';
  workspace.fingerprint = 'source-fingerprint';
  workspace.state.datasetId = 'dataset';
  workspace.state.seriesId = 'series';
  workspace.capture = () => structuredClone(canvas);
  workspace.syncPresence = jest.fn();
  workspace.session = jest.fn(async () => ({ issuer: 'issuer', subject: 'alice', csrfHeaderName: 'X-CSRF-TOKEN', csrfToken: 'fixture' }));
  const write = jest.fn(async (_key, revision, draft) => {
    expect(revision).toBe(stored.revision);
    stored = { revision: revision + 1, draft: draft ? { ...structuredClone(draft), updatedAt: '2026-11-07T08:00:00Z' } : null };
    return structuredClone(stored);
  });
  workspace.store = () => ({ write });
  workspace.json = jest.fn(async () => { requested.resolve(); return response.promise; });
  return { workspace, write, response, requested, stored: () => stored,
    change(data) { canvas = structuredClone(data); workspace.changed(); } };
}

test('an unchanged successful publication clears only the confirmed local snapshot', async () => {
  const f = fixture();
  const publish = f.workspace.publish();
  await f.requested.promise;
  f.response.resolve({ publishedVersion: 1 });
  await publish;
  expect(f.stored().draft).toBeNull();
  expect(f.workspace.state).toMatchObject({ version: 1, dirty: false, local: false, busy: false });
});

test('new pixels during slow publication are durably retained against the confirmed version', async () => {
  const f = fixture();
  const publish = f.workspace.publish();
  await f.requested.promise;
  f.change(erased); // Simulate an external command/plugin that slips past UI history protection.
  expect(f.workspace.state.dirty).toBe(true);
  expect(jest.getTimerCount()).toBe(0); // Do not try to overwrite a frozen publish request.
  f.response.resolve({ publishedVersion: 1 });
  await publish;
  expect(JSON.parse(f.workspace.json.mock.calls[0][1].body).data).toEqual(painted);
  expect(f.stored().draft).toMatchObject({ data: erased, baseVersion: 1 });
  expect(f.stored().draft.publishAttempted).toBeUndefined();
  expect(f.workspace.state).toMatchObject({ version: 1, dirty: false, local: true, busy: false });
  expect(f.workspace.state.message).toContain('新修改保留在本机，尚未发布');
});

test('edits arriving during final draft persistence remain dirty and are autosaved later', async () => {
  const f = fixture();
  const finalWrite = deferred<any>();
  const finalStarted = deferred();
  f.write.mockImplementationOnce(async (_key, revision, draft) => ({ revision: revision + 1, draft }))
    .mockImplementationOnce(async (_key, revision, draft) => ({ revision: revision + 1, draft }))
    .mockImplementationOnce(async () => { finalStarted.resolve(); return finalWrite.promise; });
  const publish = f.workspace.publish();
  await f.requested.promise;
  f.response.resolve({ publishedVersion: 1 });
  await finalStarted.promise;
  f.change(erased);
  finalWrite.resolve({ revision: 3, draft: null });
  await publish;
  expect(f.workspace.state).toMatchObject({ dirty: true, local: true, busy: false });
  expect(jest.getTimerCount()).toBe(1);
});

test('an ambiguous publication failure retains its frozen idempotent snapshot', async () => {
  const f = fixture();
  const publish = f.workspace.publish();
  await f.requested.promise;
  f.response.reject(new Error('network timeout'));
  await publish;
  expect(f.stored().draft).toMatchObject({ data: painted, publishAttempted: true });
  expect(f.workspace.state.busy).toBe(false);
  expect(f.workspace.guard.setReadOnly).toHaveBeenLastCalledWith(true);
});

test('history commands are guarded for buttons and shortcuts and restored on close', () => {
  const f = fixture();
  const undo = { commandFn: jest.fn(), options: { retained: true } };
  const redo = { commandFn: jest.fn(), options: {} };
  const definitions = new Map([['CORNERSTONE:undo', undo], ['CORNERSTONE:redo', redo]]);
  const manager = {
    getCommand: (name, context) => definitions.get(`${context}:${name}`),
    registerCommand: (context, name, definition) => definitions.set(`${context}:${name}`, definition),
  };
  f.workspace.runtime.commandsManager = manager;
  f.workspace.installCommands();
  definitions.get('CORNERSTONE:undo')!.commandFn({ retained: true });
  expect(undo.commandFn).toHaveBeenCalledTimes(1);
  f.workspace.state.busy = true;
  definitions.get('CORNERSTONE:undo')!.commandFn({});
  definitions.get('CORNERSTONE:redo')!.commandFn({});
  expect(undo.commandFn).toHaveBeenCalledTimes(1);
  expect(redo.commandFn).not.toHaveBeenCalled();
  f.workspace.state.busy = false;
  f.workspace.currentDraft = { publishAttempted: true };
  definitions.get('CORNERSTONE:undo')!.commandFn({});
  expect(undo.commandFn).toHaveBeenCalledTimes(1);
  f.workspace.currentDraft = undefined;
  realtime = true;
  f.workspace.state.collaborationReady = true;
  f.workspace.state.canEdit = false;
  definitions.get('CORNERSTONE:redo')!.commandFn({});
  expect(redo.commandFn).not.toHaveBeenCalled();
  f.workspace.close();
  expect(definitions.get('CORNERSTONE:undo')).toBe(undo);
  expect(definitions.get('CORNERSTONE:redo')).toBe(redo);
});

test('disabling realtime waits for local persistence then restores local editing', async () => {
  const f = fixture();
  const persisted = deferred();
  const client = { waitForPersistence: jest.fn(() => persisted.promise), stop: jest.fn() };
  f.workspace.reliable = client;
  f.workspace.state.collaborationReady = true;
  const stopping = f.workspace.disableRealtime(f.workspace.generation, f.workspace.realtimeTransition);
  expect(f.workspace.guard.setReadOnly).toHaveBeenLastCalledWith(true);
  expect(f.workspace.canEditHistory()).toBe(false);
  expect(client.stop).not.toHaveBeenCalled();
  persisted.resolve();
  await stopping;
  expect(client.stop).toHaveBeenCalledTimes(1);
  expect(f.workspace.state.collaborationReady).toBe(false);
  expect(f.workspace.guard.setReadOnly).toHaveBeenLastCalledWith(false);
  expect(f.workspace.canEditHistory()).toBe(true);
});

test.each(['blocked', 'publishAttempted'])('realtime disable does not bypass %s editing protection', async reason => {
  const f = fixture();
  if (reason === 'blocked') f.workspace.blocked = true;
  else f.workspace.currentDraft = { publishAttempted: true };
  await f.workspace.disableRealtime(f.workspace.generation, f.workspace.realtimeTransition);
  expect(f.workspace.guard.setReadOnly).toHaveBeenLastCalledWith(true);
  expect(f.workspace.canEditHistory()).toBe(false);
});

test('failed persistence on disable keeps an unsaved warning and never reports saved', async () => {
  const f = fixture();
  f.workspace.reliable = { waitForPersistence: async () => { throw new Error('disk full'); }, stop: jest.fn() };
  await f.workspace.disableRealtime(f.workspace.generation, f.workspace.realtimeTransition);
  expect(f.workspace.state).toMatchObject({ dirty: true, local: true, collaborationReady: false });
  expect(f.workspace.state.error).toContain('disk full');
  expect(f.workspace.guard.setReadOnly).toHaveBeenLastCalledWith(true);
  expect(f.workspace.canEditHistory()).toBe(false);
  await f.workspace.saveDraft();
  expect(f.workspace.state.dirty).toBe(false);
  expect(f.workspace.state.error).toBe('');
  expect(f.workspace.canEditHistory()).toBe(true);
  expect(f.workspace.guard.setReadOnly).toHaveBeenLastCalledWith(false);
});

test('an obsolete asynchronous disable cannot tear down a re-enabled client', async () => {
  const f = fixture();
  const persisted = deferred();
  const old = { waitForPersistence: () => persisted.promise, stop: jest.fn() };
  f.workspace.reliable = old;
  const stopping = f.workspace.disableRealtime(f.workspace.generation, f.workspace.realtimeTransition);
  f.workspace.realtimeTransition++;
  const current = { stop: jest.fn() };
  f.workspace.reliable = current;
  persisted.resolve();
  await stopping;
  expect(current.stop).not.toHaveBeenCalled();
});
