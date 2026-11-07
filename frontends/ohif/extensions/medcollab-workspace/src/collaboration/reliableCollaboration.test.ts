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
function recoveryFixture(metadata = false) {
  const queuedSegments = metadata ? [{ ...segments[0], label: '新标签' }] : segments;
  const operation = { clientOpId: 'restored-operation', baseSeq: 0, segments: queuedSegments, masks: metadata ? [] : painted.masks };
  const journal: Journal = { clientId: 'previous-page', leaseId: 'expired-token',
    queued: { segments: queuedSegments, masks: metadata ? [] : painted.masks }, pending: [operation] };
  let leases: any[] = [];
  let seq = 0;
  const remote: any[] = [];
  let blocked = false;
  let commitStatus = 0;
  let afterAcquire: (() => void) | undefined;
  const persist = jest.fn(async () => {});
  const apply = jest.fn(async () => {});
  const onState = jest.fn();
  const request = jest.fn(async (tail: string, body?: any) => {
    if (tail.startsWith('/state')) return { seq, data: empty, lease: null, sliceLeases: leases,
      throughSeq: 0, publishedVersion: 0, archiveError: '' };
    if (tail.startsWith('/ops?')) {
      const after = Number(new URLSearchParams(tail.slice(tail.indexOf('?'))).get('after'));
      return { highWatermark: seq, operations: remote.filter(r => r.seq > after), lease: null,
        sliceLeases: leases, throughSeq: 0, publishedVersion: 0 };
    }
    if (tail === '/slice-lease') {
      if (blocked) throw Object.assign(new Error('slice occupied'), { status: 423 });
      leases = body.instanceIds.map(instanceId => ({ ...active, instanceId, leaseId: 'recovered-token',
        expiresAt: new Date(Date.now() + 30000).toISOString() }));
      afterAcquire?.();
      return leases;
    }
    if (tail === '/ops/batch') {
      expect(body.clientId).toBe('new-page');
      expect(body.leaseId).toBe('recovered-token');
      if (commitStatus) throw Object.assign(new Error('slice changed during offline editing'), { status: commitStatus });
      for (const op of body.operations) {
        const affected = metadata ? ['slice', 'other-slice'] : op.masks.map(mask => mask.instanceId);
        expect(affected.every(id => leases.some(l => l.instanceId === id && l.leaseId === body.leaseId))).toBe(true);
      }
      const receipts = body.operations.map(op => ({ seq: ++seq, clientOpId: op.clientOpId,
        operation: op, subject: 'alice', username: 'alice' }));
      remote.push(...receipts);
      return receipts;
    }
    throw new Error('Unexpected request '+tail);
  });
  const client = new ReliableCollaboration({ clientId: 'new-page', journal, privateDraft: false,
    request, persist, replace: async () => {}, apply, hasUnqueuedChanges: () => false,
    getLocalData: () => journal.queued, sourceIds: () => ['slice','other-slice'], onState });
  return { client, journal, operation, request, persist, apply, onState,
    blocked: (value: boolean) => { blocked = value; },
    rejectCommit: (status = 409) => { commitStatus = status; },
    afterAcquire: (action: () => void) => { afterAcquire = action; },
    expire: () => { leases = []; },
    remote: (instanceId: string) => {
      const receipt = { seq: ++seq, clientOpId: 'peer-'+seq, subject: 'bob', username: 'bob',
        operation: { clientOpId: 'peer-'+seq, baseSeq: seq-1, segments,
          masks: [{ instanceId, runs: [8,1,1] }] } };
      remote.push(receipt);
    } };
}
const settleOutbox = () => new Promise(resolve => setImmediate(resolve));

test('refresh restores pending pixels with a new slice lease before sending the immutable operation', async () => {
  const f=recoveryFixture();
  try {
    const original=structuredClone(f.operation);
    await f.client.connect();await settleOutbox();
    expect(f.journal.pending).toHaveLength(0);
    expect(f.onState.mock.calls.at(-1)[0].conflict).toBe(false);
    expect(f.request.mock.calls.filter(([tail]) => tail === '/slice-lease')).toHaveLength(1);
    const batch=f.request.mock.calls.find(([tail]) => tail === '/ops/batch')![1];
    expect(batch.operations).toEqual([original]);
    const acquireIndex=f.request.mock.calls.findIndex(([tail]) => tail === '/slice-lease');
    const batchIndex=f.request.mock.calls.findIndex(([tail]) => tail === '/ops/batch');
    expect(f.request.mock.calls.slice(acquireIndex+1,batchIndex).some(([tail]) => tail.startsWith('/ops?'))).toBe(true);
    expect(f.persist.mock.calls.some(([record]) => record.leaseId === 'recovered-token' && record.pending.length === 1)).toBe(true);
  } finally { f.client.stop(); }
});

test.each(['catchup','connect','save'])('%s resumes an occupied restored outbox without submitting an obsolete token', async action => {
  const f=recoveryFixture();f.blocked(true);
  try {
    await f.client.connect();await settleOutbox();
    expect(f.request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
    expect(f.journal.pending).toHaveLength(1);
    f.blocked(false);
    if(action==='save') await f.client.enqueue(structuredClone(f.journal.queued));
    else await f.client[action]();
    await settleOutbox();
    expect(f.journal.pending).toHaveLength(0);
    expect(f.onState.mock.calls.at(-1)[0].conflict).toBe(false);
  } finally { f.client.stop(); }
});

test('pending metadata recovery atomically reserves every source slice, even without pixel patches', async () => {
  const f=recoveryFixture(true);
  try {
    await f.client.connect();await settleOutbox();
    expect(f.request.mock.calls.find(([tail]) => tail === '/slice-lease')![1].instanceIds).toEqual(['slice','other-slice']);
    expect(f.journal.pending).toHaveLength(0);
  } finally { f.client.stop(); }
});

test('a peer changing the pending slice between baseline read and lease grant blocks recovery', async () => {
  const f=recoveryFixture();f.afterAcquire(() => f.remote('slice'));
  try {
    await f.client.connect();await settleOutbox();
    expect(f.journal.pending).toEqual([f.operation]);
    expect(f.onState.mock.calls.at(-1)[0].conflict).toBe(true);
    expect(f.request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  } finally { f.client.stop(); }
});

test('a disjoint peer commit is replayed during recovery without rebasing or overwriting its slice', async () => {
  const f=recoveryFixture();f.afterAcquire(() => f.remote('other-slice'));
  try {
    await f.client.connect();await settleOutbox();
    expect(f.onState.mock.calls.at(-1)[0].conflict).toBe(false);
    expect(f.journal.pending).toHaveLength(0);
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.journal.queued.masks).toEqual(expect.arrayContaining([
      ...painted.masks,{instanceId:'other-slice',runs:[8,1,1]},
    ]));
    expect(f.request.mock.calls.find(([tail]) => tail === '/ops/batch')![1].operations[0].baseSeq).toBe(0);
  } finally { f.client.stop(); }
});

test('authoritative 409 keeps the restored queue as a durable conflict rather than retrying it', async () => {
  const f=recoveryFixture();f.rejectCommit();
  try {
    await f.client.connect();await settleOutbox();
    await f.client.catchup();await settleOutbox();
    expect(f.journal.pending).toHaveLength(1);
    expect(f.journal.conflict).toBe(true);
    expect(f.request.mock.calls.filter(([tail]) => tail === '/ops/batch')).toHaveLength(1);
  } finally { f.client.stop(); }
});

test('expired slice leases recover queued offline edits without requiring another brush stroke', async () => {
  const f=recoveryFixture();
  f.journal.pending=[];f.journal.queued=structuredClone(empty);
  try {
    await f.client.connect();await settleOutbox();
    await f.client.acquireSlices(['slice']);
    f.client.transport(false);
    await f.client.enqueue(structuredClone(painted));
    expect(f.journal.pending).toHaveLength(1);
    jest.spyOn(Date,'now').mockReturnValue(Date.now()+60000);
    f.expire();
    await f.client.connect();await settleOutbox();
    expect(f.journal.pending).toHaveLength(0);
    expect(f.request.mock.calls.filter(([tail]) => tail === '/slice-lease')).toHaveLength(2);
    expect(f.request.mock.calls.filter(([tail]) => tail === '/ops/batch')).toHaveLength(1);
  } finally { f.client.stop(); }
});

test('recovered outbox spanning several batches keeps every operation id and baseline unchanged', async () => {
  const f=recoveryFixture();
  f.journal.pending=Array.from({length:5},(_,i) => ({clientOpId:'restored-'+i,baseSeq:i,segments,
    masks:[{instanceId:'slice',runs:[i,1,1]}]}));
  f.journal.queued={segments,masks:[{instanceId:'slice',runs:[0,5,1]}]};
  const original=structuredClone(f.journal.pending);
  try {
    await f.client.connect();await settleOutbox();
    const batches=f.request.mock.calls.filter(([tail]) => tail === '/ops/batch').map(([,body]) => body.operations);
    expect(batches.map(batch => batch.length)).toEqual([4,1]);
    expect(batches.flat()).toEqual(original);
    expect(f.journal.pending).toHaveLength(0);
    expect(f.request.mock.calls.filter(([tail]) => tail === '/slice-lease')).toHaveLength(1);
  } finally { f.client.stop(); }
});

test('a receipt recovered after refresh removes the accepted operation without reacquiring or resending', async () => {
  const f=recoveryFixture();
  const receipt={seq:1,clientOpId:f.operation.clientOpId,operation:structuredClone(f.operation),subject:'alice',username:'alice'};
  f.request.mockResolvedValueOnce({seq:1,data:painted,lease:null,sliceLeases:[],throughSeq:0,publishedVersion:0,archiveError:''});
  f.request.mockResolvedValueOnce({highWatermark:1,operations:[receipt],lease:null,sliceLeases:[],throughSeq:0,publishedVersion:0});
  try {
    await f.client.connect();await settleOutbox();
    expect(f.journal.pending).toHaveLength(0);
    expect(f.onState.mock.calls.at(-1)[0].conflict).toBe(false);
    expect(f.request.mock.calls.some(([tail]) => tail === '/slice-lease' || tail === '/ops/batch')).toBe(false);
  } finally { f.client.stop(); }
});

test('a rejected cached token is invalidated before an explicit unchanged save retries', async () => {
  const f=recoveryFixture();f.rejectCommit(423);
  try {
    await f.client.connect();await settleOutbox();
    expect(f.journal.pending).toHaveLength(1);
    expect(f.onState.mock.calls.at(-1)[0].conflict).toBe(false);
    f.rejectCommit(0);
    await f.client.enqueue(structuredClone(f.journal.queued));
    expect(f.journal.pending).toHaveLength(0);
    expect(f.request.mock.calls.filter(([tail]) => tail === '/slice-lease')).toHaveLength(2);
  } finally { f.client.stop(); }
});

test('stopping while a recovery grant arrives cannot submit or discard the pending pixels', async () => {
  const f=recoveryFixture();f.afterAcquire(() => f.client.stop());
  try {
    await f.client.connect();await settleOutbox();
    expect(f.journal.pending).toEqual([f.operation]);
    expect(f.request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  } finally { f.client.stop(); }
});

test('metadata recovery without an authoritative source list retains the queue without a partial lease', async () => {
  const f=recoveryFixture(true);
  (f.client as any).options.sourceIds = undefined;
  try {
    await f.client.connect();await settleOutbox();
    expect(f.journal.pending).toHaveLength(1);
    expect(f.request.mock.calls.some(([tail]) => tail === '/slice-lease' || tail === '/ops/batch')).toBe(false);
    expect(f.onState.mock.calls.at(-1)[0].error).toContain('源切片清单未就绪');
  } finally { f.client.stop(); }
});

test('waitForPersistence waits for already queued disk work before stop', async () => {
  const f=setup();
  let release!: () => void;
  f.persist.mockImplementationOnce(() => new Promise<void>(resolve => { release=resolve; }));
  try {
    const connecting=f.client.connect();await settleOutbox();
    let settled=false;
    const waiting=f.client.waitForPersistence().then(() => { settled=true; });
    await settleOutbox();expect(settled).toBe(false);
    release();await waiting;await connecting;
    expect(settled).toBe(true);
  } finally { f.client.stop(); }
});

test('new recovery lease must be durable before any pending operation is submitted', async () => {
  const f=recoveryFixture();f.persist.mockImplementation(async () => {
    if(f.journal.leaseId==='recovered-token') throw new Error('disk unavailable');
  });
  try {
    await f.client.connect();await settleOutbox();
    expect(f.journal.pending).toHaveLength(1);
    expect(f.onState.mock.calls.at(-1)[0].conflict).toBe(true);
    expect(f.request.mock.calls.some(([tail]) => tail === '/ops/batch')).toBe(false);
  } finally { f.client.stop(); }
});

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
