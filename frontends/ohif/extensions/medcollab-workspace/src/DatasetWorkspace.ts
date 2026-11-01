import { OHIFWorkspaceDriver } from './OHIFWorkspaceDriver';

type Segment = { number: number; label: string; color: number[] };
type Mask = { instanceId: string; runs: number[] };
type Labelmap = { segments: Segment[]; masks: Mask[] };
type Collaborator = {
  username: string;
  role: 'owner' | 'editor' | 'public';
  isSelf: boolean;
};

type Draft = {
  data: Labelmap;
  label: string;
  baseVersion: number;
  sourceFingerprint: string;
  publicationId: string;
  publishAttempted?: boolean;
  updatedAt?: string;
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
  private lastSignature = '';
  private segmentColors = new Map<number, number[]>();

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
    this.guard.setReadOnly(value);
  }

  /**
   * Load the accounts that can access this dataset (owner + explicit shares).
   * This is not a presence feed: the backend has no online/editing status yet.
   */
  private async loadCollaborators(generation: number) {
    try {
      const datasets = await this.json('/api/datasets');
      if (this.stopped || generation !== this.generation) return;
      const dataset = (datasets.items || []).find(item => item.id === this.state.datasetId);
      const self = this.identity?.username || this.state.username;
      const list: Collaborator[] = [];

      if (dataset?.access === 'public') {
        list.push({ username: '所有登录用户', role: 'public', isSelf: false });
      } else if (dataset?.ownerUsername) {
        list.push({
          username: dataset.ownerUsername,
          role: 'owner',
          isSelf: dataset.access === 'owner',
        });
      }

      if (dataset?.access !== 'public') {
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
          role: dataset?.access === 'owner' ? 'owner' : 'editor',
          isSelf: true,
        });
      }

      if (!this.stopped && generation === this.generation) {
        this.update({ collaborators: list, datasetAccess: dataset?.access || '' });
      }
    } catch {
      // Collaborator display is non-critical; never block the workspace on it.
      if (!this.stopped && generation === this.generation) {
        this.update({ collaborators: [] });
      }
    }
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
  }
  async bind() {
    this.close();
    this.stopped = false;
    this.blocked = false;
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
      this.sources = (await this.json(this.api('/segmentation/sources'))).items.filter(
        s => s.seriesId === this.selected.id
      );
      this.fingerprint = this.store().fingerprint(this.sources);
      this.key = this.store().key(
        this.identity,
        this.state.datasetId,
        this.state.seriesId + ':ohif-labelmap'
      );
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
      this.lastSignature = JSON.stringify(this.capture());
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
      this.poller = setInterval(() => this.checkUpdates().catch(error => this.fail(error)), 15000);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
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
    try {
      const signature = JSON.stringify(this.capture());
      if (signature === this.lastSignature) return;
      this.lastSignature = signature;
    } catch (error) {
      this.fail(error);
      this.update({ dirty: true });
      return;
    }
    this.serial++;
    this.update({ dirty: true, local: true, message: '正在自动保存到本机…' });
    clearTimeout(this.timer);
    if (!this.state.error)
      this.timer = setTimeout(() => this.saveDraft().catch(error => this.fail(error)), 700);
  }
  async saveDraft() {
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
      this.update({
        dirty: serial !== this.serial,
        local: true,
        savedAt: record.draft.updatedAt,
        message: '草稿已保存到本机，尚未发布',
      });
    })();
    try {
      await this.saving;
    } finally {
      this.saving = undefined;
    }
  }
  async publish() {
    if (this.state.busy || !this.state.ready) return;
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
      const cleared = await this.store().write(this.key, this.revision, null);
      this.revision = cleared.revision;
      this.currentDraft = undefined;
      this.update({
        version: result.publishedVersion,
        local: false,
        dirty: false,
        newerVersion: 0,
        message: `已发布版本 ${result.publishedVersion}，有权限的用户可读取`,
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
    if (this.currentDraft?.publishAttempted) throw new Error('发布结果待确认，请先重试发布');
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
      this.lastSignature = JSON.stringify(this.capture());
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
    this.stopped = true;
    this.generation++;
    clearTimeout(this.timer);
    clearInterval(this.poller);
    this.subscriptions.splice(0).forEach(f => f());
    this.guard.setReadOnly(false);
    this.guard.clear();
    this.identity = undefined;
    for (const [name, definition] of this.originalCommands)
      if (definition)
        this.runtime.commandsManager.registerCommand('SEGMENTATION', name, definition);
    this.originalCommands.clear();
    this.currentDraft = undefined;
    this.segmentationId = undefined;
    this.segmentColors.clear();
    this.state.ready = false;
    this.state.busy = false;
  }
}
