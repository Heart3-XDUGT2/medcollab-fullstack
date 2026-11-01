import type {
  Artifact, DraftReceipt, EditLease, EditState, LaunchContext, LeaveDecision,
  OpenCaseRequest, SaveOperation, WorkspaceBackend, WorkspaceDriver, WorkspaceEvent,
} from './types';

export class WorkspaceError extends Error {
  constructor(public readonly code: string, message: string = code) { super(message); }
}
const fail = (code: string): never => { throw new WorkspaceError(code); };
const uid = (value: unknown) => typeof value === 'string' && value.length <= 64 && /^\d+(\.\d+)+$/.test(value);
const nonempty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const expiry = (lease: EditLease) => Date.parse(lease.expiresAt);
const validLease = (lease: EditLease) => lease && nonempty(lease.leaseId) &&
  Number.isSafeInteger(lease.generation) && lease.generation >= 0 && expiry(lease) > Date.now();

type Session = {
  id: string;
  request: OpenCaseRequest;
  context: LaunchContext;
  lease?: EditLease;
  dirty: boolean;
  ready: boolean;
  change: number;
  writeBlocked: boolean;
};
type PendingSave = { operation: SaveOperation; artifacts: Artifact[]; change: number };

export class AnnotationWorkspace {
  private backend?: WorkspaceBackend;
  private session?: Session;
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private opening = false;
  private saving?: Promise<DraftReceipt>;
  private pending?: PendingSave;
  private leaseTimer?: ReturnType<typeof setTimeout>;
  private confirmLeave: (state: EditState) => Promise<LeaveDecision> = async () => 'stay';

  constructor(private driver: WorkspaceDriver, private newId: () => string) {}

  configure(backend: WorkspaceBackend, confirmLeave?: (state: EditState) => Promise<LeaveDecision>) {
    if (this.session || this.opening) fail('SESSION_ACTIVE');
    this.backend = backend;
    this.confirmLeave = confirmLeave || (async () => 'stay');
  }

  subscribe(listener: (event: WorkspaceEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getEditState(): EditState {
    const s = this.session;
    const leaseValid = Boolean(s?.lease && validLease(s.lease) && !s.writeBlocked);
    return {
      caseId: s?.context.caseId ?? null, sessionId: s?.id ?? null,
      intent: s?.request.intent ?? null, versionId: s?.context.version?.id ?? null,
      ready: Boolean(s?.ready), dirty: Boolean(s?.dirty), saving: Boolean(this.saving),
      leaseValid, readOnly: !s?.ready || s.request.intent !== 'edit' || !leaseValid,
    };
  }

  getLaunchContext() { return this.session && structuredClone(this.session.context); }

  async openCase(request: OpenCaseRequest): Promise<void> {
    if (!this.backend) fail('BACKEND_NOT_CONFIGURED');
    if (this.opening || this.saving) fail('WORKSPACE_BUSY');
    if (!nonempty(request.caseId) || !['edit', 'review', 'view'].includes(request.intent) ||
      !['zh', 'en-US'].includes(request.locale)) fail('INVALID_OPEN_REQUEST');
    this.opening = true;
    try {
      if (this.session && await this.prepareToLeave() === 'stay') fail('LEAVE_CANCELLED');
      const context = await this.backend.getLaunchContext({ ...request });
      this.validateLaunch(request, context);
      this.driver.validateContext(context);
      await this.dispose();
      const session: Session = {
        id: this.newId(), request: { ...request }, context,
        ready: false, dirty: false, change: 0, writeBlocked: false,
      };
      this.session = session;
      try {
        if (request.intent === 'edit') {
          session.lease = await this.backend.acquireLease(context.caseId, context.revision);
          if (!validLease(session.lease)) fail('INVALID_LEASE');
          this.scheduleLease(session);
        }
        await this.driver.open(request, context, session.id);
        if (this.session !== session) fail('STALE_SESSION');
        session.ready = true;
        this.driver.setReadOnly(this.getEditState().readOnly);
        this.emit('ready');
      } catch (error) {
        await this.dispose();
        throw error;
      }
    } finally { this.opening = false; }
  }

  markDirty(sessionId: string) {
    const s = this.session;
    if (!s?.ready || s.id !== sessionId || s.request.intent !== 'edit') return;
    s.change++;
    const first = !s.dirty;
    s.dirty = true;
    if (first) this.emit('dirtyChanged');
  }

  saveDraft(): Promise<DraftReceipt> {
    if (this.saving) return this.saving;
    const s = this.session;
    if (!this.backend) return Promise.reject(new WorkspaceError('BACKEND_NOT_CONFIGURED'));
    if (!s?.ready) return Promise.reject(new WorkspaceError('WORKSPACE_NOT_READY'));
    if (this.getEditState().readOnly) return Promise.reject(new WorkspaceError('EDIT_NOT_ALLOWED'));
    // Schedule work after assigning `saving`, including for synchronous failures.
    this.saving = Promise.resolve().then(() => this.performSave(s));
    this.emit('saveStarted');
    return this.saving;
  }

  async prepareToLeave(): Promise<'saved' | 'discard-confirmed' | 'stay'> {
    if (this.saving) return 'stay';
    if (!this.session?.dirty) return 'saved';
    const decision = await this.confirmLeave(this.getEditState());
    if (decision === 'discard') return 'discard-confirmed';
    if (decision !== 'save') return 'stay';
    try {
      await this.saveDraft();
      return this.session?.dirty ? 'stay' : 'saved';
    } catch { return 'stay'; }
  }

  async close(): Promise<boolean> {
    if (this.opening || this.saving) return false;
    if (await this.prepareToLeave() === 'stay') return false;
    await this.dispose();
    return true;
  }

  markLeaseLost(sessionId: string, code = 'LEASE_EXPIRED') {
    const s = this.session;
    if (!s || s.id !== sessionId || s.writeBlocked) return;
    s.writeBlocked = true;
    clearTimeout(this.leaseTimer);
    this.driver.setReadOnly(true);
    this.emit('leaseLost', { errorCode: code });
  }

  private async performSave(s: Session): Promise<DraftReceipt> {
    try {
      if (!this.pending) {
        const change = s.change;
        const artifacts = await this.driver.captureArtifacts(s.context);
        this.pending = {
          operation: {
            operationId: this.newId(), caseId: s.context.caseId,
            sourceManifestId: s.context.sourceManifest.id,
            baseDraftVersionId: s.context.version?.kind === 'draft' ? s.context.version.id : null,
            revision: s.context.revision, lease: { ...s.lease! }, artifactIds: [],
          }, artifacts, change,
        };
      }
      const pending = this.pending;
      this.assertWritable(s);
      if (!pending.operation.artifactIds.length && pending.artifacts.length) {
        const ids = await this.backend!.persistArtifacts(pending.operation, pending.artifacts);
        if (ids.length !== pending.artifacts.length || ids.some(id => !nonempty(id)) ||
          new Set(ids).size !== ids.length) fail('INVALID_ARTIFACT_RECEIPT');
        pending.operation.artifactIds = [...ids];
      }
      this.assertWritable(s);
      const receipt = await this.backend!.commitDraft(pending.operation);
      if (receipt.caseId !== s.context.caseId || !nonempty(receipt.draftVersionId) ||
        !nonempty(receipt.revision) || !Number.isFinite(Date.parse(receipt.persistedAt)) ||
        !/(Z|[+-]\d\d:\d\d)$/.test(receipt.persistedAt)) fail('INVALID_SAVE_RECEIPT');
      if (this.session !== s) fail('STALE_SESSION');
      s.context = { ...s.context, revision: receipt.revision, version: {
        id: receipt.draftVersionId, kind: 'draft', sourceManifestId: s.context.sourceManifest.id,
        sopInstanceUIDs: pending.artifacts.map(artifact => artifact.sopInstanceUID),
        instances: pending.artifacts.map(artifact => ({
          sopInstanceUID: artifact.sopInstanceUID, seriesInstanceUID: artifact.seriesInstanceUID,
        })),
      } };
      s.dirty = s.change !== pending.change;
      this.pending = undefined;
      this.saving = undefined;
      this.emit('saveSucceeded', { receipt });
      this.emit('dirtyChanged');
      return receipt;
    } catch (error) {
      const code = (error as { code?: string })?.code || 'SAVE_FAILED';
      if (['LEASE_EXPIRED', 'CASE_BUSY', 'CASE_FORBIDDEN', 'REVISION_MISMATCH'].includes(code)) {
        this.pending = undefined;
        this.markLeaseLost(s.id, code);
      }
      if (['INVALID_ARTIFACT', 'INVALID_ARTIFACT_RECEIPT'].includes(code)) this.pending = undefined;
      this.saving = undefined;
      this.emit('saveFailed', { errorCode: code });
      throw error;
    }
  }

  private assertWritable(s: Session) {
    if (this.session !== s) fail('STALE_SESSION');
    if (this.getEditState().readOnly) fail('LEASE_EXPIRED');
  }

  private validateLaunch(request: OpenCaseRequest, c: LaunchContext) {
    if (!c || c.caseId !== request.caseId || !c.permissions?.canView) fail('CASE_FORBIDDEN');
    if (request.intent === 'edit' && !c.permissions.canEdit) fail('CASE_FORBIDDEN');
    const m = c.sourceManifest;
    if (!nonempty(c.dataSourceId) || !nonempty(c.revision) || !m || !nonempty(m.id) ||
      ![m.studyInstanceUID, m.seriesInstanceUID, m.frameOfReferenceUID].every(uid) ||
      !m.frames?.length || m.frames.some(f => !uid(f.sopInstanceUID) || !Number.isSafeInteger(f.frameNumber) || f.frameNumber < 1))
      fail('INVALID_LAUNCH_CONTEXT');
    if (request.versionId && c.version?.id !== request.versionId) fail('VERSION_MISMATCH');
    if (c.version && (c.version.sourceManifestId !== m.id || !nonempty(c.version.id) ||
      !Array.isArray(c.version.sopInstanceUIDs) || !Array.isArray(c.version.instances) ||
      c.version.sopInstanceUIDs.some(id => !uid(id)) ||
      c.version.instances.length !== c.version.sopInstanceUIDs.length ||
      c.version.instances.some(instance => !uid(instance.seriesInstanceUID) ||
        !c.version!.sopInstanceUIDs.includes(instance.sopInstanceUID)))) fail('INVALID_VERSION');
    if (request.intent === 'review' && c.version?.kind !== 'submission') fail('REVIEW_VERSION_REQUIRED');
  }

  private scheduleLease(s: Session) {
    clearTimeout(this.leaseTimer);
    const remaining = expiry(s.lease!) - Date.now();
    const delay = this.backend?.renewLease ? Math.max(1, remaining / 2) : Math.max(1, remaining);
    this.leaseTimer = setTimeout(async () => {
      if (this.session !== s) return;
      if (!validLease(s.lease!)) { this.markLeaseLost(s.id); return; }
      try {
        const next = await this.backend!.renewLease!(s.context.caseId, { ...s.lease! });
        if (this.session !== s) return;
        if (!validLease(next) || next.leaseId !== s.lease!.leaseId || next.generation !== s.lease!.generation)
          fail('LEASE_EXPIRED');
        s.lease = next;
        this.scheduleLease(s);
      } catch { this.markLeaseLost(s.id); }
    }, Math.min(delay, 2_147_483_647));
  }

  private emit(type: WorkspaceEvent['type'], extra: Partial<WorkspaceEvent> = {}) {
    const s = this.session;
    if (!s) return;
    const event: WorkspaceEvent = {
      ...extra, type, caseId: s.context.caseId, sessionId: s.id, state: this.getEditState(),
    };
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* UI listeners cannot change persistence results. */ }
    }
  }

  private async dispose() {
    const s = this.session;
    clearTimeout(this.leaseTimer);
    this.driver.clear();
    if (!s) return;
    this.emit('closed');
    this.session = undefined;
    this.pending = undefined;
    if (s.lease) {
      try { await this.backend!.releaseLease(s.context.caseId, s.lease); } catch { /* Server lease must expire. */ }
    }
  }
}
