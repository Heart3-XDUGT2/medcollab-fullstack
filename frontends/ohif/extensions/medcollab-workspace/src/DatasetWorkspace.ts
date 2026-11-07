import { OHIFWorkspaceDriver } from './OHIFWorkspaceDriver';
import { RecentOpenReporter } from './RecentOpenReporter';
import {
  EDIT_LEASE_REQUIRED_MESSAGE,
  ReliableCollaboration,
  type Journal,
} from './collaboration/reliableCollaboration';
import { applyMaskOperation, type MaskOperation } from './collaboration/maskOperations';
import { SliceEditGate } from './collaboration/SliceEditGate';
import { CollaborationOverlay } from './collaboration/CollaborationOverlay';
import {
  isRealtimeEnabled,
  RealtimeClient,
  type RealtimeActivity,
  type RealtimeMember,
  type RealtimeStatus,
} from './collaboration/realtimeClient';

type Segment = { number: number; label: string; color: number[] };
type Mask = { instanceId: string; runs: number[] };
type Labelmap = { segments: Segment[]; masks: Mask[] };
type Collaborator = {
  username: string;
  role: 'owner' | 'editor' | 'public' | 'leader' | 'uploader' | 'member';
  isSelf: boolean;
};

type Progress = {
  totalSlices: number;
  annotatedSlices: number;
  unannotatedSlices: number;
  ratio: number;
  percent: number;
};

type SeriesStats = {
  datasetId: string;
  seriesId: string;
  progress: Progress;
  publishedProgress: Progress;
  seq: number;
  throughSeq: number;
  publishedVersion: number;
  pendingArchive: boolean;
  archiveError: string;
};

type Draft = {
  data: Labelmap;
  label: string;
  baseVersion: number;
  sourceFingerprint: string;
  publicationId: string;
  publishAttempted?: boolean;
  updatedAt?: string;
  collaboration?: Journal;
};

/** Real dataset adapter. Local drafts and optimistic publication versions, no simulated leases. */
export class DatasetWorkspace {
  state = {
    ready: false,
    busy: false,
    dirty: false,
    local: false,
    username: '',
    datasetId: '',
    seriesId: '',
    version: 0,
    savedAt: '',
    message: '正在读取影像与账户…',
    error: '',
    newerVersion: 0,
    collaborators: [] as Collaborator[],
    datasetAccess: '',
    realtimeStatus: 'off' as RealtimeStatus,
    onlineMembers: [] as RealtimeMember[],
    activities: [] as RealtimeActivity[],
    realtimeError: '',
    collaborationReady: false,
    canEdit: false,
    editingBy: '',
    pendingOps: 0,
    operationSeq: 0,
    archivedThrough: 0,
    collabConflict: false,
    sliceEditing: false,
    sliceLeaseCount: 0,
    stats: null as SeriesStats | null,
    statsLoading: false,
    statsError: '',
    statsUpdatedAt: '',
  };
  private listeners = new Set<() => void>();
  private subscriptions: (() => void)[] = [];
  private guard: OHIFWorkspaceDriver;
  private identity: any;
  private sources: any[] = [];
  private selected: any;
  private key = '';
  private fingerprint = '';
  private revision = 0;
  private currentDraft?: Draft;
  private segmentationId?: string;
  private displaySet: any;
  private restoring = false;
  private serial = 0;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout>;
  private poller: ReturnType<typeof setInterval>;
  private saving?: Promise<any>;
  private stopped = true;
  private blocked = false;
  private originalCommands = new Map<string, any>();
  private originalHistoryCommands = new Map<string, any>();
  private lastSignature = '';
  private segmentColors = new Map<number, number[]>();
  private realtime?: RealtimeClient;
  private realtimeTransition = 0;
  private realtimeStopping = false;
  private realtimeSaveFailed = false;
  private statsTimer?: ReturnType<typeof setInterval>;
  private reliable?: ReliableCollaboration;
  private overlay?: CollaborationOverlay;
  private sliceGate?: SliceEditGate;
  private clientId = '';
  private recentOpen?: RecentOpenReporter;
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.state.dirty || this.state.pendingOps) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  private realtimePreferenceHandler = (event: Event) => {
    const enabled = Boolean((event as CustomEvent).detail);
    const transition = ++this.realtimeTransition;
    if (!enabled) {
      void this.disableRealtime(this.generation, transition);
      return;
    }
    this.realtimeStopping = false;
    if (enabled && this.state.dirty && !this.reliable) {
      const generation = this.generation;
      this.setReadOnly(true);
      clearTimeout(this.timer);
      this.timer = undefined;
      this.saveDraft()
        .then(() => this.startRealtime(generation))
        .catch(error => this.fail(error));
    } else this.startRealtime(this.generation);
  };

  constructor(private runtime: any) {
    this.guard = new OHIFWorkspaceDriver(runtime);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.listeners.forEach(listener => listener());
  }
  private update(patch: Partial<typeof this.state>) {
    Object.assign(this.state, patch);
    this.emit();
  }
  private store() {
    const store = (window as any).maskDrafts;
    if (!store) throw new Error('本地草稿组件未加载，请刷新页面');
    return store;
  }
  private libraries() {
    return this.runtime.extensionManager
      .getModuleEntry('@ohif/extension-cornerstone.utilityModule.common')
      .exports.getCornerstoneLibraries();
  }
  private api(tail: string) {
    return `/api/datasets/${encodeURIComponent(this.state.datasetId)}${tail}`;
  }
  private segApi(tail = '') {
    return this.api(`/segmentations/${encodeURIComponent(this.state.seriesId)}${tail}`);
  }
  private async json(url: string, options: RequestInit = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error || `请求失败 (${response.status})`), {
        status: response.status,
      });
    return data;
  }
  private async session() {
    const identity = this.identity;
    const session = await this.json('/api/session');
    if (this.stopped || identity !== this.identity)
      throw new Error('工作台已关闭或切换，请重新进入');
    if (!session.loggedIn || !session.issuer || !session.subject)
      throw new Error('登录已过期，请返回首页重新登录。草稿仍保存在原账户下');
    if (
      this.identity &&
      (session.issuer !== this.identity.issuer || session.subject !== this.identity.subject)
    )
      throw new Error('账户已切换，请重新打开工作台。当前草稿仍归原账户所有');
    return session;
  }
  setReadOnly(value: boolean) {
    this.guard.setReadOnly(
      value || this.realtimeStopping || this.realtimeSaveFailed || (isRealtimeEnabled() && (!this.state.collaborationReady || !this.state.canEdit))
    );
  }

  /**
   * Load the accounts that can access this dataset.
   *
   * Personal datasets use the owner + explicit share list. Team datasets are not
   * returned by /api/datasets and /shares returns 400 for them, so resolve the
   * owning team first and use its member list. No presence/online status here.
   */
  private async loadCollaborators(generation: number) {
    try {
      const datasets = await this.json('/api/datasets');
      if (this.stopped || generation !== this.generation) return;
      const dataset = (datasets.items || []).find(item => item.id === this.state.datasetId);
      const self = this.identity?.username || this.state.username;

      if (dataset) {
        const list: Collaborator[] = [];
        if (dataset.access === 'public') {
          list.push({ username: '所有登录用户', role: 'public', isSelf: false });
        } else if (dataset.ownerUsername) {
          list.push({
            username: dataset.ownerUsername,
            role: 'owner',
            isSelf: dataset.access === 'owner',
          });
        }

        if (dataset.access !== 'public') {
          const shares = await this.json(this.api('/shares'));
          for (const item of shares.items || []) {
            if (!list.some(existing => existing.username === item.username)) {
              list.push({
                username: item.username,
                role: 'editor',
                isSelf: item.username === self,
              });
            }
          }
        }

        if (self && !list.some(existing => existing.username === self)) {
          list.push({
            username: self,
            role: dataset.access === 'owner' ? 'owner' : 'editor',
            isSelf: true,
          });
        }

        if (!this.stopped && generation === this.generation) {
          this.update({ collaborators: list, datasetAccess: dataset.access || '' });
        }
        return;
      }

      const teamCollaborators = await this.loadTeamCollaborators(generation);
      if (!this.stopped && generation === this.generation) {
        this.update({
          collaborators: teamCollaborators || [],
          datasetAccess: teamCollaborators ? 'team' : '',
        });
      }
    } catch {
      // Collaborator display is non-critical; never block the workspace on it.
      if (!this.stopped && generation === this.generation) {
        this.update({ collaborators: [] });
      }
    }
  }

  /**
   * Server-side slice coverage for the current series. Local unsynced drafts are
   * deliberately excluded: the backend only counts accepted collaboration ops.
   */
  private async fetchStats(generation: number) {
    if (
      this.stopped ||
      generation !== this.generation ||
      !this.state.ready ||
      this.state.statsLoading ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    ) {
      return;
    }
    this.update({ statsLoading: true });
    try {
      const stats = (await this.json(this.segApi('/stats'))) as SeriesStats;
      if (this.stopped || generation !== this.generation) return;
      if (
        !stats?.progress ||
        !Number.isFinite(stats.progress.totalSlices) ||
        !Number.isFinite(stats.progress.annotatedSlices)
      ) {
        throw new Error('进度响应格式不正确');
      }
      this.update({
        stats,
        statsError: '',
        statsUpdatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      if (this.stopped || generation !== this.generation) return;
      const status = Number(error?.status);
      if (status === 401 || status === 403 || status === 404) {
        this.update({ stats: null, statsError: '进度不可用或影像集已失去访问权限' });
      } else if (status === 423) {
        this.update({ statsError: '版本正在更新，进度稍后重试' });
      } else if (!status || status >= 500) {
        this.update({ statsError: '进度暂时无法读取，保留上次结果' });
      } else {
        this.update({ statsError: error?.message || '进度读取失败' });
      }
    } finally {
      if (!this.stopped && generation === this.generation) {
        this.update({ statsLoading: false });
      }
    }
  }

  private startRealtime(generation: number) {
    this.realtime?.destroy(false);
    this.realtime = undefined;
    if (
      !isRealtimeEnabled() ||
      this.stopped ||
      generation !== this.generation ||
      !this.state.ready
    ) {
      this.update({
        realtimeStatus: 'off',
        onlineMembers: [],
        activities: [],
        realtimeError: '',
      });
      return;
    }
    const client = new RealtimeClient({
      datasetId: this.state.datasetId,
      seriesId: this.state.seriesId,
      clientId: this.clientId,
      onReady: () => this.startReliable(generation).catch(error => this.fail(error)),
      onEvent: (type, payload) => {
        if (this.stopped || generation !== this.generation) return;
        if (type === 'mask-committed') this.reliable?.receive(payload as any);
        if (type === 'mask-committed') this.overlay?.committed(payload.subject);
        if (type === 'stroke-preview') this.overlay?.preview(payload);
        if (type === 'lock-state') this.reliable?.catchup().catch(error => this.fail(error));
      },
      onState: snapshot => {
        if (this.stopped || generation !== this.generation) return;
        this.reliable?.transport(snapshot.status === 'connected');
        this.overlay?.update(snapshot.members);
        this.update({
          realtimeStatus: snapshot.status,
          onlineMembers: snapshot.members.filter(member => member.online),
          activities: snapshot.activities,
          realtimeError: snapshot.error,
        });
      },
    });
    this.realtime = client;
    this.overlay?.destroy();
    this.overlay = new CollaborationOverlay(
      this.runtime,
      client,
      this.identity.subject,
      () => this.state.canEdit
    );
    this.setReadOnly(true);
    client.connect();
    this.syncPresence();
  }

  private async disableRealtime(generation: number, transition: number) {
    this.realtimeStopping = true;
    this.setReadOnly(true);
    this.emit();
    clearTimeout(this.timer);
    this.timer = undefined;
    const client = this.reliable;
    let failure: any;
    try {
      if (this.state.dirty) await this.saveDraft();
      if (this.saving) await this.saving;
      await client?.waitForPersistence();
    } catch (error) {
      failure = error;
    }
    if (this.stopped || generation !== this.generation || transition !== this.realtimeTransition) return;
    this.realtimeStopping = false;
    this.realtimeSaveFailed = !!failure;
    this.stopRealtime();
    if (failure) {
      this.update({ dirty: true, local: true,
        error: `关闭实时协作时本机保存失败，请先导出当前标注：${failure.message || failure}` });
      this.setReadOnly(true);
    }
  }

  private stopRealtime() {
    this.sliceGate?.destroy();
    this.sliceGate = undefined;
    this.overlay?.destroy();
    this.overlay = undefined;
    this.reliable?.stop();
    this.reliable = undefined;
    this.realtime?.destroy(false);
    this.realtime = undefined;
    if (!this.stopped) {
      this.update({
        realtimeStatus: 'off',
        onlineMembers: [],
        activities: [],
        realtimeError: '',
        collaborationReady: false,
        canEdit: false,
        pendingOps: 0,
        sliceEditing: false,
        sliceLeaseCount: 0,
      });
      this.setReadOnly(!this.state.ready || this.blocked || this.state.busy || !!this.currentDraft?.publishAttempted);
    }
  }

  canEditHistory() {
    return this.state.ready && !this.state.busy && !this.realtimeStopping && !this.realtimeSaveFailed && !this.stopped && !this.blocked &&
      !this.currentDraft?.publishAttempted &&
      (!isRealtimeEnabled() || (this.state.collaborationReady && this.state.canEdit && !this.state.collabConflict));
  }

  private async collaborationRequest(tail: string, body?: unknown) {
    const generation = this.generation;
    const endpoint = this.segApi('/collaboration' + tail);
    const session = await this.session();
    if (this.stopped || generation !== this.generation) throw new Error('工作台已切换');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await this.json(endpoint, {
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                [session.csrfHeaderName]: session.csrfToken,
                'X-Medcollab-Issuer': session.issuer,
                'X-Medcollab-Subject': session.subject,
              },
              body: JSON.stringify(body),
            }),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async startReliable(generation: number) {
    if (this.stopped || generation !== this.generation || !isRealtimeEnabled()) return;
    if (!this.reliable) {
      if (this.saving) await this.saving;
      if (this.stopped || generation !== this.generation || !isRealtimeEnabled()) return;
      this.reliable = new ReliableCollaboration({
        clientId: this.clientId,
        journal: this.currentDraft?.collaboration,
        privateDraft: !!this.currentDraft && !this.currentDraft.collaboration,
        request: (tail, body) => this.collaborationRequest(tail, body),
        persist: async journal => {
          const key = this.key;
          const record = await this.store().write(key, this.revision, {
            data: journal.queued,
            collaboration: journal,
            label: '医学标注',
            baseVersion: this.state.version,
            sourceFingerprint: this.fingerprint,
            publicationId: crypto.randomUUID(),
          });
          if (this.stopped || generation !== this.generation) return;
          this.revision = record.revision;
          this.currentDraft = record.draft;
          this.realtimeSaveFailed = false;
          this.update({ local: journal.pending.length > 0, savedAt: record.draft.updatedAt });
        },
        replace: async data => {
          if (this.stopped || generation !== this.generation) return;
          await this.restore(data);
          this.lastSignature = this.signature(this.capture());
        },
        apply: async (operation, data) => {
          if (!this.stopped && generation === this.generation)
            await this.applyRemote(operation, data);
        },
        hasUnqueuedChanges: () => this.hasUnqueuedChanges(),
        getLocalData: () => this.capture(),
        sourceIds: () => this.sources.map(s => s.id),
        onState: state => {
          if (this.stopped || generation !== this.generation) return;
          this.update({
            collaborationReady: true,
            canEdit: state.canEdit,
            editingBy: state.lease?.username || '',
            pendingOps: state.pending,
            operationSeq: state.seq,
            archivedThrough: state.throughSeq,
            collabConflict: state.conflict,
            sliceEditing: state.sliceEditing,
            sliceLeaseCount: state.sliceLeases.filter(s => s.heldBySelf).length,
            version: state.version,
            message:
              state.error ||
              (state.pending
                ? `${state.pending} 条修改已存本机，等待同步`
                : `已同步到服务器 · 操作 ${state.seq}`),
          });
          this.setReadOnly(
            this.blocked || this.state.busy || !!this.currentDraft?.publishAttempted
          );
        },
      });
    }
    await this.reliable.connect();
    if (this.state.sliceEditing && !this.sliceGate)
      this.sliceGate = new SliceEditGate({
        scope: event => this.editSlices(event),
        holds: ids => this.reliable?.holdsSlices(ids) || false,
        acquire: async ids => {
          await this.reliable!.acquireSlices(ids);
          if (this.state.error?.includes('切片') || this.state.error?.includes('序列编辑权'))
            this.update({ error: '' });
        },
        touch: () => this.reliable?.touch(),
        error: error => this.fail(error),
      });
  }

  private editSlices(event: MouseEvent): string[] | null {
    if (
      !this.state.sliceEditing ||
      !this.state.ready ||
      this.state.busy ||
      this.state.collabConflict
    )
      return null;
    const { viewportGridService, cornerstoneViewportService, toolGroupService } =
      this.runtime.servicesManager.services;
    for (const id of viewportGridService.getState().viewports.keys()) {
      let viewport;
      try {
        viewport = cornerstoneViewportService.getCornerstoneViewport(id);
      } catch {
        continue;
      }
      if (!viewport?.element?.contains(event.target)) continue;
      const group = toolGroupService.getToolGroupForViewport(id);
      const tool = group?.getActivePrimaryMouseButtonTool?.() || '';
      if (!/Brush|Eraser|Paint|Scissors|Fill|Threshold/.test(tool)) return null;
      const { cornerstone } = this.libraries();
      const imageId = viewport.getCurrentImageId?.();
      const meta = imageId && cornerstone.metaData.get('instance', imageId);
      const plane = imageId && cornerstone.metaData.get('imagePlaneModule', imageId);
      const normal = viewport.getCamera?.()?.viewPlaneNormal;
      const row = plane?.rowCosines,
        col = plane?.columnCosines;
      const axial =
        row &&
        col &&
        normal &&
        Math.abs(
          normal[0] * (row[1] * col[2] - row[2] * col[1]) +
            normal[1] * (row[2] * col[0] - row[0] * col[2]) +
            normal[2] * (row[0] * col[1] - row[1] * col[0])
        ) > 0.999;
      const spherical = /SPHERE/.test(
        group.getToolInstance(tool)?.configuration?.activeStrategy || ''
      );
      if ((axial || viewport.type === 'stack') && !spherical) {
        const source = this.sources.find(s => s.sopInstanceUid === meta?.SOPInstanceUID);
        if (source) return [source.id];
      }
      // A resliced plane or volumetric brush can mutate multiple source DICOM images.
      // Reserve them together rather than letting cross-plane strokes bypass a slice lock.
      return this.sources.map(s => s.id);
    }
    return null;
  }

  private signature(data: Labelmap) {
    return JSON.stringify({
      ...data,
      masks: [...data.masks].sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
    });
  }

  private async applyRemote(operation: MaskOperation, data: Labelmap) {
    const current = this.capture();
    const baseline = this.lastSignature ? JSON.parse(this.lastSignature) : current;
    if (JSON.stringify(current.segments) !== JSON.stringify(data.segments)) {
      await this.restore(data);
    } else {
      this.restoring = true;
      try {
        const { cornerstone, cornerstoneTools } = this.libraries();
        const sourceBySOP = new Map(this.sources.map(s => [s.sopInstanceUid, s.id]));
        const patches = new Map(operation.masks.map(m => [m.instanceId, m.runs]));
        for (const id of cornerstoneTools.segmentation.getLabelmapImageIds(this.segmentationId)) {
          const image = cornerstone.cache.getImage(id);
          const meta = cornerstone.metaData.get('instance', image?.referencedImageId);
          const runs = patches.get(sourceBySOP.get(meta?.SOPInstanceUID));
          if (!runs) continue;
          const pixels = image.getPixelData();
          for (let i = 0; i < runs.length; i += 3)
            pixels.fill(runs[i + 2], runs[i], runs[i] + runs[i + 1]);
          image.voxelManager?.resetModifiedSlices?.();
        }
        cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
          this.segmentationId
        );
      } finally {
        this.restoring = false;
      }
    }
    this.lastSignature = this.signature(applyMaskOperation(baseline, operation));
  }

  async acquireEdit() {
    await this.reliable?.acquire();
    if (this.reliable?.canEdit && this.state.error === EDIT_LEASE_REQUIRED_MESSAGE)
      this.update({ error: '' });
  }
  async releaseEdit() {
    if (this.state.dirty) await this.saveDraft();
    await this.reliable?.release();
  }

  private syncPresence() {
    if (!this.realtime) return;
    try {
      const { segmentationService, viewportGridService } = this.runtime.servicesManager.services;
      const viewportId = viewportGridService.getActiveViewportId();
      const segment = segmentationService.getActiveSegment?.(viewportId);
      const segmentNumber = Number.isSafeInteger(segment?.segmentNumber)
        ? segment.segmentNumber
        : null;
      const segmentation = this.segmentationId
        ? segmentationService.getSegmentation?.(this.segmentationId)
        : null;
      const label =
        segmentNumber && segmentation?.segments?.[segmentNumber]?.label
          ? segmentation.segments[segmentNumber].label
          : null;
      this.realtime.setActive(segmentNumber, label);
    } catch {
      // Presence is best-effort; the viewer must not fail because of it.
    }
  }

  /** Resolve a team dataset through the existing team APIs (no new backend endpoint). */
  private async loadTeamCollaborators(generation: number): Promise<Collaborator[] | null> {
    try {
      const teams = await this.json('/api/teams');
      if (this.stopped || generation !== this.generation) return null;

      for (const team of teams.items || []) {
        const datasets = await this.json(`/api/teams/${encodeURIComponent(team.id)}/datasets`);
        const dataset = (datasets.items || []).find(item => item.id === this.state.datasetId);
        if (!dataset) continue;

        const members = await this.json(`/api/teams/${encodeURIComponent(team.id)}/members`);
        if (this.stopped || generation !== this.generation) return null;
        const self = this.identity?.username || this.state.username;
        const list: Collaborator[] = (members.items || []).map(member => ({
          username: member.username,
          role:
            member.role === 'leader'
              ? 'leader'
              : member.subject === dataset.uploaderSubject
                ? 'uploader'
                : 'member',
          isSelf: member.username === self,
        }));
        if (self && !list.some(existing => existing.username === self)) {
          list.push({ username: self, role: 'member', isSelf: true });
        }
        return list;
      }
    } catch {
      // Older deployments may not have /api/teams; fall back to no collaborators.
    }
    return null;
  }
  installCommands() {
    const manager = this.runtime.commandsManager;
    for (const [name, action] of [
      ['downloadSegmentation', () => this.exportFile()],
      ['storeSegmentation', () => this.publish()],
      [
        'downloadRTSS',
        () => {
          this.update({ error: '当前仅保存和导出 Labelmap SEG，轮廓导出尚未接入' });
        },
      ],
    ] as const) {
      if (!this.originalCommands.has(name))
        this.originalCommands.set(name, manager.getCommand(name, 'SEGMENTATION'));
      manager.registerCommand('SEGMENTATION', name, { commandFn: action, options: {} });
    }
    for (const name of ['undo', 'redo']) {
      const definition = manager.getCommand(name, 'CORNERSTONE');
      if (!definition?.commandFn || this.originalHistoryCommands.has(name)) continue;
      this.originalHistoryCommands.set(name, definition);
      manager.registerCommand('CORNERSTONE', name, {
        ...definition,
        commandFn: options => {
          if (this.canEditHistory()) return definition.commandFn(options);
        },
      });
    }
  }
  async bind() {
    this.close();
    this.stopped = false;
    this.blocked = false;
    this.realtimeSaveFailed = false;
    this.installCommands();
    const generation = ++this.generation;
    const query = new URLSearchParams(location.search);
    this.state.datasetId = query.get('datasetId') || '';
    this.state.seriesId = query.get('seriesId') || '';
    this.state.error = '';
    this.state.ready = false;
    this.state.local = false;
    this.state.dirty = false;
    this.state.collaborators = [];
    this.state.datasetAccess = '';
    this.state.realtimeStatus = 'off';
    this.state.onlineMembers = [];
    this.state.activities = [];
    this.state.realtimeError = '';
    this.emit();
    this.setReadOnly(true);
    try {
      this.identity = undefined;
      this.identity = await this.session();
      const launch = await this.json(this.api('/workspace'));
      this.selected = launch.series.find(s => s.id === this.state.seriesId);
      if (
        !this.selected ||
        query.get('StudyInstanceUIDs') !== this.selected.studyInstanceUID ||
        query.get('SeriesInstanceUIDs') !== this.selected.seriesInstanceUID
      )
        throw new Error('影像入口不匹配，请从首页“打开工作界面”进入');
      this.recentOpen = new RecentOpenReporter(this.state.datasetId, this.identity);
      this.sources = (await this.json(this.api('/segmentation/sources'))).items.filter(
        s => s.seriesId === this.selected.id
      );
      this.fingerprint = this.store().fingerprint(this.sources);
      this.key = this.store().key(
        this.identity,
        this.state.datasetId,
        this.state.seriesId + ':ohif-labelmap'
      );
      // A new page gets a new lease identity, including duplicated tabs. Old queues remain recoverable.
      this.clientId = crypto.randomUUID();
      const record = await this.store().read(this.key);
      this.revision = record.revision;
      this.currentDraft = record.draft || undefined;
      // Upgrade an existing single-label IndexedDB draft without deleting its original copy.
      if (!this.currentDraft && this.revision === 0) {
        const legacy = await this.store().read(
          this.store().key(this.identity, this.state.datasetId, this.state.seriesId)
        );
        if (legacy.draft?.masks && legacy.draft.sourceFingerprint === this.fingerprint) {
          const old = legacy.draft;
          this.currentDraft = {
            label: old.label,
            baseVersion: old.baseVersion,
            sourceFingerprint: this.fingerprint,
            publicationId: crypto.randomUUID(),
            data: {
              segments: [{ number: 1, label: old.label, color: [255, 80, 80] }],
              masks: old.masks.map(m => ({
                instanceId: m.instanceId,
                runs: m.runs.flatMap((n, i, a) => (i % 2 ? [] : [n, a[i + 1], 1])),
              })),
            },
          };
          const migrated = await this.store().write(this.key, this.revision, this.currentDraft);
          this.revision = migrated.revision;
        }
      }
      if (this.currentDraft && this.currentDraft.sourceFingerprint !== this.fingerprint)
        throw new Error('CT 清单已变化，本地草稿已保留，不能直接叠加。请先回到原影像集处理草稿');
      const published = await this.json(this.segApi('/labelmap'));
      if (this.stopped || generation !== this.generation) return;
      this.displaySet = await this.waitForDisplaySet();
      if (this.stopped || generation !== this.generation) return;
      await this.restore(this.currentDraft?.data || published.data);
      this.lastSignature = this.signature(this.capture());
      const base = this.currentDraft?.baseVersion ?? published.status.publishedVersion;
      this.update({
        ready: true,
        username: this.identity.username,
        version: base,
        local: !!this.currentDraft,
        savedAt: this.currentDraft?.updatedAt || '',
        newerVersion:
          published.status.publishedVersion > base ? published.status.publishedVersion : 0,
        message: this.currentDraft ? '已恢复本机草稿，尚未发布' : '已加载共享版本',
      });
      this.loadCollaborators(generation).catch(() => {});
      this.recordUsableImage(generation);
      this.setReadOnly(!!this.currentDraft?.publishAttempted);
      const { segmentationService, cornerstoneViewportService } =
        this.runtime.servicesManager.services;
      for (const name of [
        'SEGMENTATION_ADDED',
        'SEGMENTATION_REMOVED',
        'SEGMENTATION_MODIFIED',
        'SEGMENTATION_DATA_MODIFIED',
      ]) {
        const { unsubscribe } = segmentationService.subscribe(
          segmentationService.EVENTS[name],
          () => this.changed()
        );
        this.subscriptions.push(unsubscribe);
      }
      const { unsubscribe } = cornerstoneViewportService.subscribe(
        cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
        () => this.attach()
      );
      this.subscriptions.push(unsubscribe);
      const { cornerstone, cornerstoneTools } = this.libraries();
      const activated = () => {
        if (isRealtimeEnabled() && (!this.state.canEdit || this.state.busy)) this.setReadOnly(true);
      };
      cornerstone.eventTarget.addEventListener(
        cornerstoneTools.Enums.Events.TOOL_ACTIVATED,
        activated
      );
      this.subscriptions.push(() =>
        cornerstone.eventTarget.removeEventListener(
          cornerstoneTools.Enums.Events.TOOL_ACTIVATED,
          activated
        )
      );
      this.poller = setInterval(() => this.checkUpdates().catch(error => this.fail(error)), 15000);
      window.addEventListener('medcollab:realtime-preference', this.realtimePreferenceHandler);
      window.addEventListener('beforeunload', this.beforeUnload);
      this.startRealtime(generation);
      this.fetchStats(generation);
      this.statsTimer = setInterval(() => this.fetchStats(this.generation), 10000);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }
  private recordUsableImage(generation: number) {
    const reporter = this.recentOpen;
    const { cornerstone } = this.libraries();
    const { cornerstoneViewportService, viewportGridService } = this.runtime.servicesManager.services;
    let finished = false;
    const check = () => {
      if (finished || this.stopped || generation !== this.generation) return;
      try {
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportGridService.getActiveViewportId());
        const imageId = viewport?.getCurrentImageId?.();
        if (!imageId || !this.displaySet.imageIds.includes(imageId)) return;
        const pixels = cornerstone.cache.getImage(imageId)?.getPixelData?.();
        if (!pixels?.length) return;
        finished = true;
        done();
        void reporter?.opened();
      } catch { /* The target viewport is still being attached. */ }
    };
    const rendered = cornerstone.Enums.Events.IMAGE_RENDERED;
    const loaded = cornerstone.Enums.Events.IMAGE_LOADED;
    const done = () => {
      clearTimeout(timeout);
      cornerstone.eventTarget.removeEventListener(loaded, check);
      if (rendered) document.removeEventListener(rendered, check, true);
    };
    const timeout = setTimeout(done, 120000);
    cornerstone.eventTarget.addEventListener(loaded, check);
    if (rendered) document.addEventListener(rendered, check, true);
    this.subscriptions.push(done);
    check();
  }
  private waitForDisplaySet(): Promise<any> {
    const { displaySetService, cornerstoneViewportService, viewportGridService } =
      this.runtime.servicesManager.services;
    const { cornerstone } = this.libraries();
    return new Promise((resolve, reject) => {
      const disposers: (() => void)[] = [];
      const done = () => {
        clearTimeout(timeout);
        disposers.forEach(f => f());
      };
      const check = () => {
        const ds = displaySetService
          .getActiveDisplaySets()
          .find(ds => ds.SeriesInstanceUID === this.selected.seriesInstanceUID);
        const ids = ds?.imageIds;
        if (!ids?.length) return;
        const expected = new Set(this.sources.map(s => s.sopInstanceUid));
        if (ids.length !== expected.size) {
          done();
          reject(new Error('CT 切片清单与服务器不一致'));
          return;
        }
        for (const imageId of ids) {
          const meta = cornerstone.metaData.get('instance', imageId);
          if (
            !meta ||
            !expected.has(meta.SOPInstanceUID) ||
            meta.FrameOfReferenceUID !== this.selected.frameOfReferenceUID
          ) {
            done();
            reject(new Error('CT 坐标系或源切片不匹配'));
            return;
          }
        }
        let vp;
        try {
          vp = cornerstoneViewportService.getCornerstoneViewport(
            viewportGridService.getActiveViewportId()
          );
        } catch {
          return;
        }
        if (!vp?.getImageIds?.().length) return;
        done();
        resolve(ds);
      };
      const timeout = setTimeout(() => {
        done();
        reject(new Error('CT 加载超时，请刷新重试'));
      }, 120000);
      for (const [service, name] of [
        [displaySetService, 'DISPLAY_SETS_ADDED'],
        [cornerstoneViewportService, 'VIEWPORT_DATA_CHANGED'],
        [viewportGridService, 'VIEWPORTS_READY'],
      ]) {
        const { unsubscribe } = service.subscribe(service.EVENTS[name], check);
        disposers.push(unsubscribe);
      }
      cornerstone.eventTarget.addEventListener(cornerstone.Enums.Events.IMAGE_LOADED, check);
      disposers.push(() =>
        cornerstone.eventTarget.removeEventListener(cornerstone.Enums.Events.IMAGE_LOADED, check)
      );
      this.subscriptions.push(done);
      check();
    });
  }
  private async restore(data: Labelmap) {
    this.restoring = true;
    const { segmentationService } = this.runtime.servicesManager.services;
    try {
      for (const seg of segmentationService.getSegmentations())
        segmentationService.remove(seg.segmentationId);
      const segments = data.segments.length
        ? data.segments
        : [{ number: 1, label: '手绘区域', color: [255, 80, 80] }];
      this.segmentColors = new Map(segments.map(segment => [segment.number, [...segment.color]]));
      this.segmentationId = await segmentationService.createLabelmapForDisplaySet(this.displaySet, {
        label: '医学标注',
        segments: Object.fromEntries(
          segments.map((s, i) => [s.number, { label: s.label, active: i === 0 }])
        ),
      });
      const { cornerstone, cornerstoneTools } = this.libraries();
      const ids = cornerstoneTools.segmentation.getLabelmapImageIds(this.segmentationId);
      const sourceBySOP = new Map(this.sources.map(s => [s.sopInstanceUid, s.id]));
      const masks = new Map(data.masks.map(m => [m.instanceId, m.runs]));
      for (const id of ids) {
        const image = cornerstone.cache.getImage(id);
        const meta = cornerstone.metaData.get('instance', image.referencedImageId);
        const pixels = image.getPixelData();
        pixels.fill(0);
        const runs = masks.get(sourceBySOP.get(meta.SOPInstanceUID)) || [];
        for (let i = 0; i < runs.length; i += 3)
          pixels.fill(runs[i + 2], runs[i], runs[i] + runs[i + 1]);
        image.voxelManager?.resetModifiedSlices?.();
      }
      await this.attach();
      for (const viewportId of this.runtime.servicesManager.services.viewportGridService
        .getState()
        .viewports.keys())
        for (const segment of segments)
          segmentationService.setSegmentColor(viewportId, this.segmentationId, segment.number, [
            ...segment.color,
            255,
          ]);
      cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
        this.segmentationId
      );
      segmentationService.setActiveSegment(this.segmentationId, segments[0].number);
    } finally {
      this.restoring = false;
    }
  }
  private async attach() {
    if (!this.segmentationId) return;
    const { segmentationService, viewportGridService, cornerstoneViewportService } =
      this.runtime.servicesManager.services;
    for (const viewportId of viewportGridService.getState().viewports.keys()) {
      try {
        const vp = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        if (vp?.getImageIds?.().length || vp?.getActors?.().length)
          await segmentationService.addSegmentationRepresentation(viewportId, {
            segmentationId: this.segmentationId,
          });
      } catch {
        /* A viewport being created will be handled on its next data event. */
      }
    }
  }
  private segmentColor(segmentationId: string, number: number): number[] {
    const { segmentationService, viewportGridService } = this.runtime.servicesManager.services;
    // The active viewport can be empty or still attaching its representation after a layout change.
    const viewportIds = new Set([
      viewportGridService.getActiveViewportId(),
      ...segmentationService.getViewportIdsWithSegmentation(segmentationId),
    ]);
    for (const viewportId of viewportIds) {
      const color = segmentationService.getSegmentColor(viewportId, segmentationId, number);
      if (color?.length >= 3 && color.slice(0, 3).every(Number.isFinite)) {
        const rgb = color.slice(0, 3).map(Math.round);
        this.segmentColors.set(number, rgb);
        return rgb;
      }
    }
    const previous = this.segmentColors.get(number);
    if (previous) return [...previous];
    throw new Error('掩码颜色尚未加载，请等待影像显示完成后重试保存');
  }
  private capture(): Labelmap {
    const { segmentationService } = this.runtime.servicesManager.services;
    const { cornerstone, cornerstoneTools } = this.libraries();
    const all = segmentationService.getSegmentations();
    if (all.length !== 1)
      throw new Error('每个 CT 序列请使用一个分割，在其中添加多个标签；请移除多余分割后重试');
    const seg = all[0];
    const data = seg.representationData.Labelmap;
    if (!data || (data.labelmaps && Object.keys(data.labelmaps).length > 1))
      throw new Error('Labelmap 不支持重叠图层，请在同一图层绘制多个标签');
    const segments: Segment[] = Object.keys(seg.segments)
      .map(Number)
      .filter(n => n > 0)
      .sort((a, b) => a - b)
      .map(number => ({
        number,
        label: seg.segments[number].label || `标签 ${number}`,
        color: this.segmentColor(seg.segmentationId, number),
      }));
    if (!segments.length || segments.length > 64 || segments.some(s => s.number > 255))
      throw new Error('最多支持 64 个标签，编号需在 1 至 255 之间');
    const allowed = new Map(this.sources.map(s => [s.sopInstanceUid, s]));
    const masks: Mask[] = [];
    const seen = new Set();
    for (const id of cornerstoneTools.segmentation.getLabelmapImageIds(seg.segmentationId)) {
      const image = cornerstone.cache.getImage(id),
        meta = cornerstone.metaData.get('instance', image?.referencedImageId);
      const source = allowed.get(meta?.SOPInstanceUID);
      if (
        !source ||
        meta.SeriesInstanceUID !== this.selected.seriesInstanceUID ||
        seen.has(source.id)
      )
        throw new Error('分割引用了当前序列以外的图像');
      seen.add(source.id);
      const pixels = image.getPixelData(),
        runs: number[] = [];
      if (pixels.length !== source.rows * source.columns) throw new Error('掩码尺寸与 CT 不一致');
      for (let start = 0; start < pixels.length; ) {
        const number = pixels[start];
        let end = start + 1;
        while (end < pixels.length && pixels[end] === number) end++;
        if (number) runs.push(start, end - start, number);
        start = end;
      }
      if (runs.length) masks.push({ instanceId: source.id, runs });
    }
    return { segments, masks };
  }
  private changed() {
    if (this.restoring || !this.state.ready || this.stopped) return;
    if (this.reliable) {
      // Viewport/active-label events also fire for viewers. They are not local mask edits.
      if (!this.state.canEdit && !this.state.dirty) {
        try {
          if (this.signature(this.capture()) === this.lastSignature) return;
        } catch (error) {
          this.fail(error);
          return;
        }
      }
      this.serial++;
      this.update({ dirty: true, local: true, message: '正在保存并同步修改…' });
      if (!this.timer)
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.syncPresence();
          this.saveDraft().catch(error => this.fail(error));
        }, 400);
      return;
    }
    try {
      const signature = this.signature(this.capture());
      if (signature === this.lastSignature) return;
      this.lastSignature = signature;
    } catch (error) {
      this.fail(error);
      this.update({ dirty: true });
      return;
    }
    this.serial++;
    this.syncPresence();
    this.update({ dirty: true, local: true, message: '正在自动保存到本机…' });
    clearTimeout(this.timer);
    if (!this.state.error && !this.state.busy)
      this.timer = setTimeout(() => this.saveDraft().catch(error => this.fail(error)), 700);
  }
  private hasUnqueuedChanges() {
    if (!this.state.dirty) return false;
    try {
      if (this.signature(this.capture()) !== this.lastSignature) return true;
    } catch {
      // Do not overwrite a canvas whose state cannot be safely inspected.
      return true;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    this.update({ dirty: false });
    return false;
  }
  async saveDraft() {
    if (this.reliable) {
      const serial = this.serial,
        generation = this.generation;
      const data = this.capture();
      await this.reliable.enqueue(data);
      if (!this.stopped && generation === this.generation) {
        this.lastSignature = this.signature(this.reliable.queuedData || data);
        this.update({
          dirty: serial !== this.serial,
          error: this.state.error === EDIT_LEASE_REQUIRED_MESSAGE ? '' : this.state.error,
        });
      }
      return;
    }
    const entered = this.generation;
    if (this.saving) {
      await this.saving;
      if (!this.state.dirty) return;
    }
    if (entered !== this.generation) throw new Error('工作台已切换');
    if (!this.state.ready || this.stopped) throw new Error('工作台尚未就绪');
    const serial = this.serial,
      generation = this.generation,
      key = this.key,
      revision = this.revision;
    this.saving = (async () => {
      const data = this.capture();
      if (this.currentDraft?.publishAttempted)
        throw new Error('上次发布结果待确认，请先点击“重试发布”');
      const draft: Draft = {
        data,
        label: '医学标注',
        baseVersion: this.state.version,
        sourceFingerprint: this.fingerprint,
        publicationId: crypto.randomUUID(),
      };
      const record = await this.store().write(key, revision, draft);
      if (generation !== this.generation) return;
      this.revision = record.revision;
      this.currentDraft = record.draft;
      const recoveredPersistence = this.realtimeSaveFailed;
      this.realtimeSaveFailed = false;
      this.update({
        dirty: serial !== this.serial,
        local: true,
        savedAt: record.draft.updatedAt,
        message: '草稿已保存到本机，尚未发布',
        ...(recoveredPersistence ? { error: '' } : {}),
      });
      if (recoveredPersistence)
        this.setReadOnly(this.blocked || this.state.busy || !!this.currentDraft?.publishAttempted);
    })();
    try {
      await this.saving;
    } finally {
      this.saving = undefined;
    }
  }
  async publish() {
    if (this.state.busy || !this.state.ready) return;
    if (this.reliable) {
      if (this.state.dirty) await this.saveDraft();
      await this.reliable.archive();
      this.update({ message: '已请求后台生成 SEG 归档版本，可继续绘制' });
      return;
    }
    const generation = this.generation;
    clearTimeout(this.timer);
    this.update({ busy: true, error: '' });
    this.setReadOnly(true);
    try {
      if (!this.currentDraft?.publishAttempted) await this.saveDraft();
      const session = await this.session();
      if (this.stopped || generation !== this.generation) return;
      // Freeze a durable request id before sending. A lost response retries exactly this payload.
      const attempted = { ...this.currentDraft!, publishAttempted: true };
      const record = await this.store().write(this.key, this.revision, attempted);
      if (this.stopped || generation !== this.generation) return;
      this.revision = record.revision;
      this.currentDraft = record.draft;
      const result = await this.json(this.segApi('/publish-labelmap'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [session.csrfHeaderName]: session.csrfToken,
          'X-Medcollab-Issuer': session.issuer,
          'X-Medcollab-Subject': session.subject,
        },
        body: JSON.stringify({
          expectedPublishedVersion: attempted.baseVersion,
          label: attempted.label,
          data: attempted.data,
          publicationId: attempted.publicationId,
        }),
      });
      if (this.stopped || generation !== this.generation) return;
      // A command/plugin can still mutate pixels while the request is in flight.
      // Confirm the published snapshot, but never acknowledge a newer canvas as saved.
      const serial = this.serial;
      const data = this.capture();
      const hasLaterChanges = this.signature(data) !== this.signature(attempted.data);
      const nextDraft: Draft | null = hasLaterChanges ? {
        data,
        label: attempted.label,
        baseVersion: result.publishedVersion,
        sourceFingerprint: this.fingerprint,
        publicationId: crypto.randomUUID(),
      } : null;
      const saved = await this.store().write(this.key, this.revision, nextDraft);
      if (this.stopped || generation !== this.generation) return;
      this.revision = saved.revision;
      this.currentDraft = saved.draft || undefined;
      this.realtimeSaveFailed = false;
      const dirty = serial !== this.serial;
      this.update({
        version: result.publishedVersion,
        local: hasLaterChanges || dirty,
        dirty,
        savedAt: saved.draft?.updatedAt || this.state.savedAt,
        newerVersion: 0,
        message: hasLaterChanges || dirty
          ? `已发布版本 ${result.publishedVersion}；发布期间的新修改保留在本机，尚未发布`
          : `已发布版本 ${result.publishedVersion}，有权限的用户可读取`,
        error: '',
      });
    } catch (error) {
      if (this.stopped || generation !== this.generation) return;
      // A definite precondition failure did not publish. Keep the pixels, permit export and recovery.
      if ([400, 409, 413, 423].includes(error.status) && this.currentDraft) {
        const record = await this.store().write(this.key, this.revision, {
          ...this.currentDraft,
          publishAttempted: false,
        });
        this.revision = record.revision;
        this.currentDraft = record.draft;
      }
      this.fail(error);
    } finally {
      if (generation === this.generation && !this.stopped) {
        this.update({ busy: false });
        this.setReadOnly(this.blocked || !!this.currentDraft?.publishAttempted);
        if (this.state.dirty && !this.blocked && !this.currentDraft?.publishAttempted) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.saveDraft().catch(error => this.fail(error)), 700);
        }
      }
    }
  }
  async exportFile() {
    if (!this.state.ready || this.state.busy) return;
    const generation = this.generation;
    this.update({ busy: true, error: '' });
    try {
      const data = this.capture(),
        session = await this.session();
      if (this.stopped || generation !== this.generation) return;
      const response = await fetch(this.segApi('/export-labelmap'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          [session.csrfHeaderName]: session.csrfToken,
          'X-Medcollab-Issuer': session.issuer,
          'X-Medcollab-Subject': session.subject,
        },
        body: JSON.stringify({
          expectedPublishedVersion: this.state.version,
          label: '医学标注',
          data,
          publicationId: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error || '导出失败');
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement('a');
      link.href = url;
      link.download = 'labelmap-seg.dcm';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.update({ message: '已导出 Labelmap SEG（.dcm）' });
    } catch (error) {
      if (generation === this.generation && !this.stopped) this.fail(error);
    } finally {
      if (generation === this.generation && !this.stopped) this.update({ busy: false });
    }
  }
  async loadLatest() {
    if (this.state.busy) return;
    const generation = this.generation;
    if (
      (this.state.local || this.state.dirty) &&
      !window.confirm('加载共享版本会替换本机草稿。请先导出需要保留的 Labelmap SEG，再确认继续。')
    )
      return;
    if (this.currentDraft?.publishAttempted && !this.reliable)
      throw new Error('发布结果待确认，请先重试发布');
    if (this.reliable) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.update({ dirty: false, local: false });
      await this.reliable.reset();
      this.update({ collabConflict: false, error: '', newerVersion: 0 });
      return;
    }
    clearTimeout(this.timer);
    if (this.saving) await this.saving;
    if (this.stopped || generation !== this.generation) return;
    this.update({ busy: true });
    this.setReadOnly(true);
    try {
      await this.session();
      const published = await this.json(this.segApi('/labelmap'));
      if (this.stopped || generation !== this.generation) return;
      const record = await this.store().write(this.key, this.revision, null);
      this.revision = record.revision;
      this.currentDraft = undefined;
      await this.restore(published.data);
      this.lastSignature = this.signature(this.capture());
      this.realtimeSaveFailed = false;
      this.update({
        version: published.status.publishedVersion,
        dirty: false,
        local: false,
        newerVersion: 0,
        error: '',
        message: '已加载最新共享版本',
      });
    } catch (error) {
      if (generation === this.generation && !this.stopped) this.fail(error);
    } finally {
      if (generation === this.generation && !this.stopped) {
        this.update({ busy: false });
        this.setReadOnly(this.blocked);
      }
    }
  }
  private async checkUpdates() {
    if (this.reliable) return;
    if (!this.state.ready || this.state.busy || this.stopped) return;
    const generation = this.generation;
    await this.session();
    const result = await this.json(this.segApi('/status'));
    if (this.stopped || generation !== this.generation) return;
    if (result.publishedVersion > this.state.version) {
      this.update({ newerVersion: result.publishedVersion });
      if (!this.state.local && !this.state.dirty) await this.loadLatest();
    }
  }
  private fail(error: any) {
    this.update({ error: error?.message || String(error) });
    if ([401, 403, 404].includes(error?.status) || /账户已切换|登录已过期/.test(error?.message)) {
      this.blocked = true;
      this.setReadOnly(true);
    }
  }
  close() {
    this.realtimeTransition++;
    this.realtimeStopping = false;
    this.recentOpen?.close();
    this.recentOpen = undefined;
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.removeEventListener('medcollab:realtime-preference', this.realtimePreferenceHandler);
    this.stopRealtime();
    this.stopped = true;
    this.generation++;
    clearTimeout(this.timer);
    clearInterval(this.poller);
    clearInterval(this.statsTimer);
    this.statsTimer = undefined;
    this.state.stats = null;
    this.state.statsLoading = false;
    this.state.statsError = '';
    this.state.statsUpdatedAt = '';
    this.subscriptions.splice(0).forEach(f => f());
    this.guard.setReadOnly(false);
    this.guard.clear();
    this.identity = undefined;
    for (const [name, definition] of this.originalCommands)
      if (definition)
        this.runtime.commandsManager.registerCommand('SEGMENTATION', name, definition);
    this.originalCommands.clear();
    for (const [name, definition] of this.originalHistoryCommands)
      this.runtime.commandsManager.registerCommand('CORNERSTONE', name, definition);
    this.originalHistoryCommands.clear();
    this.currentDraft = undefined;
    this.segmentationId = undefined;
    this.segmentColors.clear();
    this.state.ready = false;
    this.state.busy = false;
  }
}
