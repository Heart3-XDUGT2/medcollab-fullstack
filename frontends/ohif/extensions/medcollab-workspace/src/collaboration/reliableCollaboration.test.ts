import { webcrypto } from 'node:crypto';
import {
  EDIT_LEASE_REQUIRED_MESSAGE,
  ReliableCollaboration,
  type Journal,
} from './reliableCollaboration';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const segments = [{ number: 1, label: '心脏', color: [255, 80, 80] }];
const empty = { segments, masks: [] };
const painted = { segments, masks: [{ instanceId: 'slice', runs: [0, 3, 1] }] };
const active = {
  heldBySelf: true,
  subject: 'alice',
  username: 'alice',
  leaseId: 'lease-123456',
  expiresAt: new Date(Date.now() + 30000).toISOString(),
};
function setup(journal?: Journal, seq = 0) {
  const persist = jest.fn(async () => {}),
    replace = jest.fn(async () => {}),
    apply = jest.fn(async () => {}),
    onState = jest.fn();
  const request = jest.fn(async (tail, body?) => {
    if (tail.startsWith('/state'))
      return {
        seq,
        data: empty,
        lease: active,
        throughSeq: 0,
        publishedVersion: 0,
        archiveError: '',
      };
    if (tail.startsWith('/ops?'))
      return {
        highWatermark: seq,
        operations: [],
        lease: active,
        throughSeq: 0,
        publishedVersion: 0,
      };
    if (tail === '/lease') return active;
    if (tail === '/ops/batch')
      return body.operations.map((operation, i) => ({
        seq: operation.baseSeq + 1,
        clientOpId: operation.clientOpId,
        operation,
        subject: 'alice',
      }));
  });
  const client = new ReliableCollaboration({
    clientId: 'client-123456',
    journal,
    privateDraft: false,
    request,
    persist,
    replace,
    apply,
    hasUnqueuedChanges: () => false,
    onState,
  });
  return { client, persist, replace, apply, onState, request };
}
afterEach(() => jest.restoreAllMocks());

function sliced(journal?: Journal, localData = () => empty) {
  const fixture = setup(journal);
  const legacyRequest = fixture.request.getMockImplementation()!;
  fixture.request.mockImplementation(async (tail, body?) => {
    const result = await legacyRequest(tail, body);
    if (tail.startsWith('/state') || tail.startsWith('/ops?')) return { ...result,
      sliceLeases: [{ ...active, instanceId: 'slice' }] };
    return result;
  });
  (fixture.client as any).options.getLocalData = localData;
  return fixture;
}

test('slice editors merge another slice while their own stroke is still queued offline', async () => {
  const { client, apply, persist, onState } = sliced();
  try {
    await client.connect();
    client.transport(false);
    await client.enqueue(painted);
    client.receive({ seq: 1, clientOpId: 'other-slice-op', subject: 'bob', username: 'bob',
      operation: { clientOpId: 'other-slice-op', baseSeq: 0, segments,
        masks: [{ instanceId: 'other-slice', runs: [4, 2, 1] }] } });
    await new Promise(resolve => setImmediate(resolve));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onState.mock.calls.at(-1)[0].conflict).toBe(false);
    expect((client as any).journal.queued.masks).toEqual(expect.arrayContaining([
      ...painted.masks, { instanceId: 'other-slice', runs: [4, 2, 1] },
    ]));
    expect(persist).toHaveBeenCalled();
  } finally { client.stop(); }
});

test('another slice renders beside an unqueued local stroke, but the same slice is protected', async () => {
  const { client, apply, onState } = sliced(undefined, () => painted);
  try {
    await client.connect();
    (client as any).options.hasUnqueuedChanges = () => true;
    const op = (id: string, seq: number) => ({ seq, clientOpId: `remote-${seq}`, subject: 'bob', username: 'bob',
      operation: { clientOpId: `remote-${seq}`, baseSeq: seq - 1, segments,
        masks: [{ instanceId: id, runs: [9, 1, 1] }] } });
    client.receive(op('other-slice', 1));
    await new Promise(resolve => setImmediate(resolve));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onState.mock.calls.at(-1)[0].conflict).toBe(false);
    client.receive(op('slice', 2));
    expect(onState.mock.calls.at(-1)[0].conflict).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
  } finally { client.stop(); }
});

test('a viewer can save an unchanged canvas without an editing lease or an upload', async () => {
  const { client, request, persist, onState } = setup();
  request.mockImplementationOnce(async () => ({
    seq: 0,
    data: empty,
    lease: { ...active, heldBySelf: false, leaseId: null },
    throughSeq: 0,
    publishedVersion: 0,
    archiveError: '',
  }));
  try {
    await client.connect();
    const saved = persist.mock.calls.length;
    await expect(client.enqueue(structuredClone(empty))).resolves.toBeUndefined();
    expect(client.canEdit).toBe(false);
    expect(persist).toHaveBeenCalledTimes(saved);
    expect(onState.mock.calls.at(-1)[0].pending).toBe(0);
    expect(request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  } finally {
    client.stop();
  }
});

test('a viewer still cannot queue changed pixels without an editing lease', async () => {
  const { client, request, persist, onState } = setup();
  request.mockImplementationOnce(async () => ({
    seq: 0,
    data: empty,
    lease: { ...active, heldBySelf: false, leaseId: null },
    throughSeq: 0,
    publishedVersion: 0,
    archiveError: '',
  }));
  try {
    await client.connect();
    const saved = persist.mock.calls.length;
    await expect(client.enqueue(painted)).rejects.toThrow(EDIT_LEASE_REQUIRED_MESSAGE);
    expect(persist).toHaveBeenCalledTimes(saved);
    expect(onState.mock.calls.at(-1)[0].pending).toBe(0);
    expect(request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  } finally {
    client.stop();
  }
});

test('persists before sending and handles its own WebSocket echo only once', async () => {
  const { client, persist, request, onState } = setup();
  await client.connect();
  await client.enqueue(painted);
  await new Promise(resolve => setImmediate(resolve));
  const batchIndex = request.mock.calls.findIndex(([tail]) => tail === '/ops/batch');
  expect(batchIndex).toBeGreaterThan(0);
  const batch = request.mock.calls[batchIndex][1];
  client.receive({
    seq: 1,
    clientOpId: batch.operations[0].clientOpId,
    operation: batch.operations[0],
    subject: 'alice',
    username: 'alice',
  });
  expect(onState.mock.calls.at(-1)[0].seq).toBe(1);
  expect(onState.mock.calls.at(-1)[0].pending).toBe(0);
  expect(persist.mock.invocationCallOrder[1]).toBeLessThan(
    request.mock.invocationCallOrder[batchIndex]
  );
  client.stop();
});
test('buffers out-of-order commits and renders them in sequence', async () => {
  const { client, apply, onState } = setup();
  await client.connect();
  const op = baseSeq => ({
    clientOpId: `operation-${baseSeq}`,
    baseSeq,
    segments,
    masks: [{ instanceId: 'slice', runs: [baseSeq, 1, 1] }],
  });
  client.receive({
    seq: 2,
    clientOpId: 'operation-1',
    operation: op(1),
    subject: 'bob',
    username: 'bob',
  });
  expect(apply).not.toHaveBeenCalled();
  client.receive({
    seq: 1,
    clientOpId: 'operation-0',
    operation: op(0),
    subject: 'bob',
    username: 'bob',
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(apply.mock.calls.map(([operation]) => operation.baseSeq)).toEqual([0, 1]);
  expect(onState.mock.calls.at(-1)[0].seq).toBe(2);
  client.stop();
});
test('a stale offline queue is preserved and cannot overwrite a newer shared state', async () => {
  const operation = { clientOpId: 'operation-old', baseSeq: 0, segments, masks: painted.masks };
  const journal = {
    clientId: 'old-client',
    leaseId: 'old-lease',
    queued: painted,
    pending: [operation],
  };
  const { client, request, replace, onState } = setup(journal, 2);
  await client.connect();
  expect(onState.mock.calls.at(-1)[0].conflict).toBe(true);
  expect(journal.pending).toEqual([operation]);
  expect(replace).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  client.stop();
});
test('failed IndexedDB writes stop uploads and keep the pending operation', async () => {
  const { client, persist, request, onState } = setup();
  await client.connect();
  persist.mockRejectedValueOnce(new Error('quota exceeded'));
  await expect(client.enqueue(painted)).rejects.toThrow('quota exceeded');
  expect(request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  expect(onState.mock.calls.at(-1)[0].pending).toBe(1);
  client.stop();
});

test('the final stroke is saved locally when the editing lease expires before the save timer', async () => {
  const { client, persist, request } = setup();
  await client.connect();
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60000);
  expect(client.canEdit).toBe(false);
  await client.enqueue(painted);
  expect(persist.mock.calls.at(-1)[0].pending).toHaveLength(1);
  expect(request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  client.stop();
});

test('a persisted private conflict remains blocked after refresh even if its base matches', async () => {
  const operation = { clientOpId: 'operation-private', baseSeq: 0, segments, masks: painted.masks };
  const journal = {
    clientId: 'old-client',
    leaseId: null,
    queued: painted,
    pending: [operation],
    conflict: true,
  };
  const { client, request, onState } = setup(journal);
  await client.connect();
  expect(onState.mock.calls.at(-1)[0].conflict).toBe(true);
  expect(request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  client.stop();
});

test('a failed remote render stays visible as a conflict and explicit reload repairs the render queue', async () => {
  const { client, apply, replace, onState } = setup();
  try {
    await client.connect();
    apply.mockRejectedValueOnce(new Error('绘制更新失败'));
    client.receive({
      seq: 1,
      clientOpId: 'remote-failed',
      subject: 'bob',
      username: 'bob',
      operation: { clientOpId: 'remote-failed', baseSeq: 0, segments, masks: painted.masks },
    });
    await new Promise(resolve => setImmediate(resolve));
    await client.catchup();
    expect(onState.mock.calls.at(-1)[0].conflict).toBe(true);
    expect(onState.mock.calls.at(-1)[0].error).toBe('绘制更新失败');
    await client.reset();
    expect(replace).toHaveBeenCalledTimes(2);
    expect(onState.mock.calls.at(-1)[0].conflict).toBe(false);
    expect(onState.mock.calls.at(-1)[0].error).toBe('');
  } finally {
    client.stop();
  }
});
