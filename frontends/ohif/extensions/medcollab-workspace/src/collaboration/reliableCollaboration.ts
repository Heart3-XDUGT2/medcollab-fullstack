import {
  applyMaskOperation,
  buildMaskOperations,
  type Labelmap,
  type MaskOperation,
} from './maskOperations';

export const EDIT_LEASE_REQUIRED_MESSAGE = '请先申请编辑权；本机草稿不会自动覆盖共同画布';

export type Lease = {
  heldBySelf: boolean;
  subject: string | null;
  username: string | null;
  leaseId: string | null;
  expiresAt: string | null;
};
export type SliceLease = Lease & { instanceId: string };
export type Journal = {
  clientId: string;
  leaseId: string | null;
  queued: Labelmap;
  pending: MaskOperation[];
  conflict?: boolean;
};
type Committed = {
  seq: number;
  clientOpId: string;
  subject: string;
  username: string;
  operation: MaskOperation;
};
type Options = {
  clientId: string;
  journal?: Journal;
  privateDraft: boolean;
  request: (tail: string, body?: unknown) => Promise<any>;
  persist: (journal: Journal) => Promise<void>;
  replace: (data: Labelmap) => Promise<void>;
  apply: (operation: MaskOperation, data: Labelmap) => Promise<void>;
  hasUnqueuedChanges: () => boolean;
  getLocalData?: () => Labelmap;
  sourceIds?: () => string[];
  onState: (state: {
    seq: number;
    throughSeq: number;
    version: number;
    pending: number;
    canEdit: boolean;
    conflict: boolean;
    lease: Lease | null;
    error: string;
    sliceEditing: boolean;
    sliceLeases: SliceLease[];
  }) => void;
};

/** Owns the durable queue; HTTP receipts and WS echoes both acknowledge the same immutable operation. */
export class ReliableCollaboration {
  private seq = 0;
  private throughSeq = 0;
  private version = 0;
  private data: Labelmap = { segments: [], masks: [] };
  private journal: Journal;
  private lease: Lease | null = null;
  private conflict = false;
  private error = '';
  private stopped = false;
  private initialized = false;
  private offline = false;
  private sliceEditing = false;
  private sliceLeases: SliceLease[] = [];
  private touchedAt = 0;
  private wasEditor = false;
  private syncing?: Promise<void>;
  private flushing?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private rendering: Promise<void> = Promise.resolve();
  private buffer = new Map<number, Committed>();
  private poller?: ReturnType<typeof setInterval>;
  private renewer?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setInterval>;
  constructor(private options: Options) {
    this.journal = options.journal || {
      clientId: options.clientId,
      leaseId: null,
      queued: this.data,
      pending: [],
    };
    this.journal.clientId = options.clientId;
    this.conflict = !!this.journal.conflict;
  }
  get canEdit() {
    if (this.sliceEditing) return this.initialized && !this.conflict && !this.stopped;
    return (
      this.initialized &&
      !this.conflict &&
      !this.stopped &&
      ((this.offline && this.wasEditor) ||
        !!(this.lease?.heldBySelf && Date.parse(this.lease.expiresAt || '') > Date.now()))
    );
  }
  private emit() {
    if (!this.stopped)
      this.options.onState({
        seq: this.seq,
        throughSeq: this.throughSeq,
        version: this.version,
        pending: this.journal.pending.length,
        canEdit: this.canEdit,
        conflict: this.conflict,
        lease: this.lease,
        error: this.error,
        sliceEditing: this.sliceEditing,
        sliceLeases: this.sliceLeases,
      });
  }
  private fail(error: any) {
    if (this.stopped) return;
    this.error = error.message || '协作同步失败，本机草稿保留';
    if ([409, 423].includes(error.status)) {
      this.lease = null;
      this.wasEditor = false;
    }
    if ([401, 403, 404].includes(error.status)) {
      this.conflict = true;
      this.wasEditor = false;
    }
    this.emit();
  }
  transport(online: boolean) {
    this.offline = !online;
    if (online && !this.conflict && this.error.startsWith('连接中断')) this.error = '';
    if (!online && this.wasEditor) this.error = '连接中断，修改仅存本机；重新连接后校验编辑权';
    this.emit();
  }
  async connect() {
    if (this.syncing) return this.syncing;
    // An existing in-memory canvas already has a paired cursor. Reconnect by replaying forward only.
    if (this.initialized) {
      this.offline = false;
      try {
        await this.catchup();
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    this.syncing = this.initialize();
    try {
      await this.syncing;
    } catch (error) {
      this.fail(error);
    } finally {
      this.syncing = undefined;
    }
  }
  private async initialize() {
    await this.writes;
    const state = await this.options.request(
      '/state?clientId=' + encodeURIComponent(this.options.clientId)
    );
    if (this.stopped) return;
    this.offline = false;
    this.error = state.archiveError || '';
    this.lease = state.lease;
    this.sliceEditing = Array.isArray(state.sliceLeases);
    this.sliceLeases = state.sliceLeases || [];
    // Recover receipts lost before refresh, including the last operation before a server crash.
    if (this.journal.pending.length) {
      let after = this.journal.pending[0].baseSeq;
      const accepted = new Set<string>();
      while (after < state.seq) {
        const page = await this.options.request(
          `/ops?clientId=${encodeURIComponent(this.options.clientId)}&after=${after}`
        );
        if (this.stopped) return;
        const bounded = page.operations.filter(op => op.seq <= state.seq);
        if (!bounded.length) break;
        bounded.forEach(op => {
          const local = this.journal.pending.find(p => p.clientOpId === op.clientOpId);
          if (local && JSON.stringify(local) === JSON.stringify(op.operation))
            accepted.add(op.clientOpId);
        });
        after = bounded[bounded.length - 1].seq;
      }
      this.journal.pending = this.journal.pending.filter(op => !accepted.has(op.clientOpId));
      if (this.journal.pending.length && this.journal.pending[0].baseSeq !== state.seq)
        this.conflict = true;
    }
    if (this.options.privateDraft || this.options.hasUnqueuedChanges()) this.conflict = true;
    this.seq = state.seq;
    this.throughSeq = state.throughSeq;
    this.version = state.publishedVersion;
    this.data = state.data;
    this.initialized = true;
    if (this.conflict) this.error = '本机草稿与共同画布存在差异，请先导出草稿，再加载共同画布';
    else if (!this.journal.pending.length && !this.options.hasUnqueuedChanges()) {
      this.journal.queued = this.data;
      await this.render(() => this.options.replace(this.data));
    }
    if (this.lease?.heldBySelf) {
      this.journal.leaseId = this.lease.leaseId;
      this.wasEditor = true;
    } else this.wasEditor = false;
    if (!this.conflict) await this.persist();
    this.drain();
    this.emit();
    if (!this.poller)
      this.poller = setInterval(() => this.catchup().catch(error => this.fail(error)), 3000);
    if (!this.renewer)
      this.renewer = setInterval(() => this.renew().catch(error => this.fail(error)), 10000);
    if (!this.expiry) this.expiry = setInterval(() => this.emit(), 1000);
    this.flush().catch(error => this.fail(error));
  }
  private persist() {
    this.journal.conflict = this.conflict;
    const journal = structuredClone(this.journal);
    this.writes = this.writes.then(() =>
      this.stopped ? undefined : this.options.persist(journal)
    );
    // A failed IndexedDB transaction must stop submissions; never acknowledge an unsaved local queue.
    this.writes.catch(error => {
      this.conflict = true;
      this.fail(error);
    });
    return this.writes;
  }
  private render(action: () => Promise<void>) {
    this.rendering = this.rendering.then(() => (this.stopped ? undefined : action()));
    this.rendering.catch(error => {
      this.conflict = true;
      this.fail(error);
    });
    return this.rendering;
  }
  async enqueue(data: Labelmap) {
    if (!this.initialized || this.stopped) throw new Error(EDIT_LEASE_REQUIRED_MESSAGE);
    if (this.sliceEditing && !this.offline) {
      const preview = buildMaskOperations(this.journal.queued, data, this.seq);
      if (preview.length) {
        const definitionsChanged = JSON.stringify(this.journal.queued.segments) !== JSON.stringify(data.segments);
        const ids = definitionsChanged ? this.options.sourceIds?.() || [] : [...new Set(preview.flatMap(op => op.masks.map(m => m.instanceId)))];
        if (!this.holdsSlices(ids)) {
          await this.acquireSlices(ids);
          data = this.options.getLocalData?.() || data;
        }
      }
    }
    const last = this.journal.pending[this.journal.pending.length - 1];
    const operations = buildMaskOperations(
      this.journal.queued,
      data,
      last ? last.baseSeq + 1 : this.seq
    );
    if (!operations.length) return;
    // Display events can request a save without changing pixels. Only mutations need a lease.
    // Preserve the last stroke even when a lease expires between drawing and the local save timer.
    if (!this.canEdit && !this.wasEditor) throw new Error(EDIT_LEASE_REQUIRED_MESSAGE);
    this.journal.pending.push(...operations);
    this.touchedAt = Date.now();
    this.journal.queued = data;
    this.emit();
    await this.persist();
    this.emit();
    this.flush().catch(error => this.fail(error));
  }
  private async flush() {
    if (this.flushing) return this.flushing;
    if (
      this.offline ||
      this.conflict ||
      (!this.sliceEditing && !this.lease?.heldBySelf) ||
      this.stopped ||
      (!this.sliceEditing && Date.parse(this.lease!.expiresAt || '') <= Date.now())
    )
      return;
    this.flushing = (async () => {
      while (this.journal.pending.length && !this.stopped && !this.conflict && !this.offline) {
        await this.writes;
        const batch = this.journal.pending.slice(0, 4);
        const receipts = await this.options.request('/ops/batch', {
          clientId: this.options.clientId,
          leaseId: this.journal.leaseId,
          operations: batch,
          ...(this.sliceEditing ? { sliced: true } : {}),
        });
        if (this.stopped) return;
        for (const receipt of receipts) this.receive(receipt);
        const acknowledged = new Set(receipts.map(r => r.clientOpId));
        this.journal.pending = this.journal.pending.filter(op => !acknowledged.has(op.clientOpId));
        await this.persist();
        this.emit();
      }
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
    }
  }
  receive(receipt: Committed) {
    if (this.stopped || !Number.isSafeInteger(receipt.seq) || receipt.seq <= this.seq) return;
    this.buffer.set(receipt.seq, receipt);
    if (this.buffer.size > 200) {
      this.buffer.clear();
      this.catchup().catch(error => this.fail(error));
      return;
    }
    if (this.initialized) this.drain();
  }
  private drain() {
    for (const seq of this.buffer.keys()) if (seq <= this.seq) this.buffer.delete(seq);
    while (this.buffer.has(this.seq + 1)) {
      const receipt = this.buffer.get(this.seq + 1)!;
      this.buffer.delete(receipt.seq);
      const own = this.journal.pending.some(op => op.clientOpId === receipt.clientOpId);
      this.data = applyMaskOperation(this.data, receipt.operation);
      this.seq = receipt.seq;
      if (own) {
        this.journal.pending = this.journal.pending.filter(
          op => op.clientOpId !== receipt.clientOpId
        );
        if (!this.conflict) this.persist().catch(() => {});
      } else if (!this.conflict && this.canApplyRemote(receipt.operation)) {
        this.journal.queued = applyMaskOperation(this.journal.queued, receipt.operation);
        const data = this.data;
        this.render(() => this.options.apply(receipt.operation, data));
      } else if (!own) {
        this.conflict = true;
        this.error = '共同画布已有其他修改，本机草稿已保留，请处理差异';
      }
    }
    this.emit();
  }
  private canApplyRemote(operation: MaskOperation) {
    const dirty = this.options.hasUnqueuedChanges();
    if (!this.sliceEditing) return !this.journal.pending.length && !dirty;
    const local = [...this.journal.pending];
    if (dirty) {
      if (!this.options.getLocalData) return false;
      local.push(...buildMaskOperations(this.journal.queued, this.options.getLocalData(), this.seq));
    }
    if (!local.length) return true;
    if (JSON.stringify(operation.segments) !== JSON.stringify(this.journal.queued.segments)) return false;
    const changed = new Set(operation.masks.map(m => m.instanceId));
    return local.every(op => JSON.stringify(op.segments) === JSON.stringify(operation.segments)
      && op.masks.every(m => !changed.has(m.instanceId)));
  }
  async catchup() {
    if (!this.initialized || this.syncing || this.stopped) return;
    let more = true;
    while (more && !this.stopped) {
      const page = await this.options.request(
        `/ops?clientId=${encodeURIComponent(this.options.clientId)}&after=${this.seq}`
      );
      if (this.stopped) return;
      this.lease = page.lease;
      if (Array.isArray(page.sliceLeases)) this.sliceLeases = page.sliceLeases;
      this.throughSeq = page.throughSeq;
      this.version = page.publishedVersion;
      if (page.archiveError || (!this.conflict && !this.journal.pending.length))
        this.error = page.archiveError || '';
      for (const receipt of page.operations) this.receive(receipt);
      more = page.operations.length > 0 && this.seq < page.highWatermark;
    }
    this.emit();
    this.flush().catch(error => this.fail(error));
  }
  async acquire() {
    if (this.sliceEditing) throw new Error('切片编辑权会在开始绘制时自动获取');
    if (!this.initialized || this.conflict) throw new Error('请先加载共同画布并处理本机草稿');
    await this.catchup();
    this.lease = await this.options.request('/lease', {
      clientId: this.options.clientId,
      action: 'acquire',
    });
    this.journal.leaseId = this.lease!.leaseId;
    this.wasEditor = true;
    this.error = '';
    await this.persist();
    this.emit();
    await this.flush();
  }
  private async renew() {
    if (this.sliceEditing) {
      if (this.offline || this.stopped) return;
      const ids = this.sliceLeases.filter(s => s.heldBySelf).map(s => s.instanceId);
      if (!ids.length) return;
      const idle = Date.now() - this.touchedAt > 3000 && !this.journal.pending.length && !this.options.hasUnqueuedChanges();
      this.sliceLeases = await this.options.request('/slice-lease', { clientId: this.options.clientId,
        leaseId: this.journal.leaseId, action: idle ? 'release' : 'renew', instanceIds: ids });
      this.emit();
      return;
    }
    if (!this.lease?.heldBySelf || this.offline || this.stopped) return;
    this.lease = await this.options.request('/lease', {
      clientId: this.options.clientId,
      leaseId: this.journal.leaseId,
      action: 'renew',
    });
    this.emit();
  }
  async release() {
    await this.flush();
    if (this.journal.pending.length || this.options.hasUnqueuedChanges())
      throw new Error('修改尚未同步，请先同步后释放编辑权');
    if (this.sliceEditing) {
      const ids = this.sliceLeases.filter(s => s.heldBySelf).map(s => s.instanceId);
      if (ids.length) this.sliceLeases = await this.options.request('/slice-lease', {
        clientId: this.options.clientId, leaseId: this.journal.leaseId, action: 'release', instanceIds: ids,
      });
      this.emit();
      return;
    }
    this.lease = await this.options.request('/lease', {
      clientId: this.options.clientId,
      leaseId: this.journal.leaseId,
      action: 'release',
    });
    this.wasEditor = false;
    this.emit();
  }
  holdsSlices(ids: string[]) {
    return ids.length > 0 && ids.every(id => this.sliceLeases.some(s => s.instanceId === id && s.heldBySelf
      && Date.parse(s.expiresAt || '') > Date.now()));
  }
  touch() { this.touchedAt = Date.now(); }
  get queuedData() { return this.journal.queued; }
  async acquireSlices(ids: string[]) {
    if (!this.sliceEditing || !this.canEdit || this.offline) throw new Error('连接未就绪，暂不能获取切片编辑权');
    this.touchedAt = Date.now();
    if (this.holdsSlices(ids)) return;
    await this.catchup();
    if (this.conflict) throw new Error('请先处理本机草稿差异');
    this.sliceLeases = await this.options.request('/slice-lease', {
      clientId: this.options.clientId, leaseId: this.journal.leaseId, action: 'acquire', instanceIds: ids,
    });
    this.journal.leaseId = this.sliceLeases.find(s => s.heldBySelf)?.leaseId || null;
    this.wasEditor = true;
    await this.catchup();
    // Catch-up queues the render. Do not start a brush on a stale canvas.
    await this.rendering;
    if (this.conflict) throw new Error('请先处理本机草稿差异');
    await this.persist();
    this.emit();
  }
  async archive() {
    await this.flush();
    if (this.journal.pending.length || this.options.hasUnqueuedChanges() || this.conflict)
      throw new Error('请先将本机修改同步到服务器');
    await this.options.request('/archive', {});
  }
  async reset() {
    if (this.flushing) await this.flushing.catch(() => {});
    await this.rendering.catch(() => {});
    this.rendering = Promise.resolve();
    await this.writes;
    this.options.privateDraft = false;
    this.conflict = false;
    this.error = '';
    this.journal.pending = [];
    this.initialized = false;
    this.buffer.clear();
    await this.connect();
  }
  stop() {
    this.stopped = true;
    clearInterval(this.poller);
    clearInterval(this.renewer);
    clearInterval(this.expiry);
  }
}
