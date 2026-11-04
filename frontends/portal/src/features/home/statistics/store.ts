import { abortRace, createStatisticsApi } from './api';
import type { StatisticsIdentity, StatisticsSessionApi } from './api';
import { parseDatasetStatistics, resourceId, StatisticsError } from './contract';
import type { DatasetAnnotationStats, StatisticsData, StatisticsResource } from './contract';

export type StatisticsStatus =
  | 'idle'
  | 'queued'
  | 'loading'
  | 'ready'
  | 'unconfigured'
  | 'unauthenticated'
  | 'unsupported'
  | 'forbidden'
  | 'missing'
  | 'busy'
  | 'error'
  | 'deferred'
  | 'demo-missing';
export type StatisticsSnapshot<T = StatisticsData> = Readonly<{
  status: StatisticsStatus;
  data: T | null;
  stale: boolean;
  error: StatisticsError | null;
  source: 'server' | 'synthetic' | 'none';
  fetchedAt: number | null;
}>;
export type StatisticsAccessIssue = {
  status: 401 | 403 | 404;
  resource: 'account' | 'dataset' | 'series';
  datasetId?: string;
  seriesId?: string;
};
export type StatisticsOptions = {
  mode: 'real' | 'demo' | 'anonymous';
  apiEnabled: boolean;
  identity: StatisticsIdentity | null;
  sessionApi: StatisticsSessionApi;
  scopeSignal?: AbortSignal;
  demoData?: Readonly<Record<string, DatasetAnnotationStats>>;
  fetchImpl?: typeof fetch;
  onAccessIssue?: (issue: StatisticsAccessIssue) => void;
};
type Entry = {
  resource: StatisticsResource;
  snapshot: StatisticsSnapshot;
  interests: number;
  lastUsed: number;
  cooldownUntil: number;
  resumeCancelled?: boolean;
  job?: Job;
};
type Job = {
  key: string;
  entry: Entry;
  generation: number;
  controller: AbortController;
  done: boolean;
};
const MAX_ACTIVE = 2,
  MAX_QUEUED = 16,
  MAX_CACHED = 128,
  FRESH_MS = 30000,
  COOLDOWN_MS = 5000;
const state = (status: StatisticsStatus): StatisticsSnapshot =>
  Object.freeze({
    status,
    data: null,
    stale: false,
    error: null,
    source: 'none',
    fetchedAt: null,
  });
const STOPPED = state('idle');
const INVALID = Object.freeze({
  ...state('error'),
  error: new StatisticsError('protocol', '统计资源编号无效'),
});
function keyOf(resource: StatisticsResource): string {
  if (resource.type === 'personal') return '["personal"]';
  return JSON.stringify(
    resource.type === 'dataset'
      ? ['dataset', resourceId(resource.datasetId)]
      : ['series', resourceId(resource.datasetId), resourceId(resource.seriesId)]
  );
}
export class StatisticsModel {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly reportedAccess = new Set<string>();
  private readonly api: ReturnType<typeof createStatisticsApi> | null;
  private scope = new AbortController();
  private queue: Job[] = [];
  private running = new Set<Job>();
  private active = false;
  private closed = false;
  private generation = 0;
  private accountBlocked: StatisticsSnapshot | null = null;
  private scopeStopped = false;
  private supported: boolean | undefined;
  private capabilityPromise: Promise<boolean> | null = null;
  private readonly baseline: StatisticsStatus;
  private readonly options: Omit<StatisticsOptions, 'identity'>;
  private removeParentAbort?: () => void;
  private resumeTimer?: ReturnType<typeof setTimeout>;
  constructor(options: StatisticsOptions) {
    this.options = {
      mode: options.mode,
      apiEnabled: options.apiEnabled,
      sessionApi: options.sessionApi,
      scopeSignal: options.scopeSignal,
      fetchImpl: options.fetchImpl,
      onAccessIssue: options.onAccessIssue,
      demoData: options.mode === 'demo' ? options.demoData : undefined,
    };
    const identity =
      options.mode === 'real' &&
      options.identity &&
      [options.identity.issuer, options.identity.subject].every(
        (value) => typeof value === 'string' && !!value.trim()
      )
        ? { issuer: options.identity.issuer, subject: options.identity.subject }
        : null;
    this.baseline =
      options.mode === 'demo'
        ? 'idle'
        : !options.apiEnabled
          ? 'unconfigured'
          : !identity
            ? 'unauthenticated'
            : 'idle';
    this.api =
      this.baseline === 'idle' && options.mode === 'real' && identity
        ? createStatisticsApi({
            identity,
            sessionApi: options.sessionApi,
            fetchImpl: options.fetchImpl,
          })
        : null;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.closed = false;
    this.generation++;
    this.scopeStopped = false;
    this.scope = new AbortController();
    const abort = () => {
      this.scopeStopped = true;
      this.scope.abort();
      this.cancelAll();
      this.entries.clear();
      this.emitAll();
    };
    this.options.scopeSignal?.addEventListener('abort', abort, { once: true });
    this.removeParentAbort = () => this.options.scopeSignal?.removeEventListener('abort', abort);
    if (this.options.scopeSignal?.aborted) abort();
  }
  dispose() {
    this.active = false;
    this.closed = true;
    this.generation++;
    this.scope.abort();
    this.cancelAll();
    this.removeParentAbort?.();
    this.entries.clear();
    this.reportedAccess.clear();
    this.supported = undefined;
    this.capabilityPromise = null;
  }
  private cancelAll() {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = undefined;
    for (const job of [...this.queue, ...this.running]) job.controller.abort();
    this.queue = [];
    this.running.clear();
  }
  private entry(resource: StatisticsResource): Entry {
    const key = keyOf(resource);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        resource: { ...resource },
        snapshot: state(this.baseline),
        interests: 0,
        lastUsed: Date.now(),
        cooldownUntil: 0,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }
  private prune() {
    if (this.entries.size <= MAX_CACHED) return;
    const inactive = [...this.entries]
      .filter(
        ([, entry]) =>
          entry.interests === 0 && !entry.job && !this.listeners.get(keyOf(entry.resource))?.size
      )
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of inactive) {
      if (this.entries.size <= MAX_CACHED) break;
      this.entries.delete(key);
    }
  }
  private publish(entry: Entry, patch: Partial<StatisticsSnapshot>) {
    entry.snapshot = Object.freeze({ ...entry.snapshot, ...patch });
    for (const listener of this.listeners.get(keyOf(entry.resource)) || []) listener();
  }
  private emitAll() {
    for (const listeners of this.listeners.values()) for (const listener of listeners) listener();
  }
  getSnapshot = (resource: StatisticsResource): StatisticsSnapshot => {
    if (this.closed || this.scopeStopped) return STOPPED;
    if (this.accountBlocked) return this.accountBlocked;
    try {
      return this.entry(resource).snapshot;
    } catch {
      return INVALID;
    }
  };
  subscribe = (resource: StatisticsResource, listener: () => void) => {
    let key: string;
    try {
      key = keyOf(resource);
    } catch {
      return () => {};
    }
    const listeners = this.listeners.get(key) || new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
      this.prune();
    };
  };
  watch = (resource: StatisticsResource) => {
    if (!this.active || this.closed || this.scopeStopped || this.accountBlocked) return () => {};
    let entry: Entry;
    try {
      entry = this.entry(resource);
    } catch {
      return () => {};
    }
    const generation = this.generation;
    entry.interests++;
    entry.lastUsed = Date.now();
    this.enqueue(entry, false);
    return () => {
      if (generation !== this.generation || this.entries.get(keyOf(resource)) !== entry) return;
      entry.interests = Math.max(0, entry.interests - 1);
      entry.lastUsed = Date.now();
      if (!entry.interests && entry.job && !entry.job.done) {
        const job = entry.job;
        entry.job = undefined;
        job.controller.abort();
        this.queue = this.queue.filter((item) => item !== job);
        entry.cooldownUntil = Date.now() + COOLDOWN_MS;
        entry.resumeCancelled = true;
        this.publish(entry, {
          status: entry.snapshot.data ? 'ready' : 'idle',
          stale: !!entry.snapshot.data,
          error: null,
        });
      }
      this.scheduleCancelled();
      this.prune();
    };
  };
  refreshDataset = (datasetId: string) => this.refresh({ type: 'dataset', datasetId });
  refresh = (resource: StatisticsResource) => {
    if (!this.active || this.closed || this.scopeStopped || this.accountBlocked) return;
    try {
      this.enqueue(this.entry(resource), true);
    } catch {
      /* Invalid IDs never become requests. */
    }
  };
  refreshWatched = () => {
    for (const entry of this.entries.values()) if (entry.interests > 0) this.enqueue(entry, true);
  };
  private enqueue(entry: Entry, force: boolean) {
    if (entry.job || !this.active || this.scopeStopped || this.accountBlocked) return;
    if (this.options.mode === 'demo') {
      const source =
        entry.resource.type === 'dataset' &&
        this.options.demoData &&
        Object.prototype.hasOwnProperty.call(this.options.demoData, entry.resource.datasetId)
          ? this.options.demoData[entry.resource.datasetId]
          : undefined;
      if (!source) {
        this.publish(entry, { ...state('demo-missing'), source: 'synthetic' });
        return;
      }
      try {
        const data = parseDatasetStatistics(
          source,
          (entry.resource as { datasetId: string }).datasetId
        );
        this.publish(entry, {
          status: 'ready',
          data,
          source: 'synthetic',
          stale: false,
          error: null,
          fetchedAt: Date.now(),
        });
      } catch {
        this.publish(entry, {
          ...state('error'),
          source: 'synthetic',
          error: new StatisticsError('protocol', '合成统计不符合约定'),
        });
      }
      return;
    }
    if (!this.api) return;
    if (!force && this.supported === false) {
      this.publish(entry, state('unsupported'));
      return;
    }
    if (
      !force &&
      entry.snapshot.status === 'ready' &&
      !entry.snapshot.stale &&
      entry.snapshot.fetchedAt !== null &&
      Date.now() - entry.snapshot.fetchedAt < FRESH_MS
    )
      return;
    if (!force && Date.now() < entry.cooldownUntil) {
      this.scheduleCancelled();
      return;
    }
    if (this.queue.length >= MAX_QUEUED && this.running.size >= MAX_ACTIVE) {
      this.publish(entry, { status: 'deferred', stale: !!entry.snapshot.data });
      return;
    }
    if (force && this.supported === false) this.supported = undefined;
    const job: Job = {
      key: keyOf(entry.resource),
      entry,
      generation: this.generation,
      controller: new AbortController(),
      done: false,
    };
    entry.resumeCancelled = false;
    entry.job = job;
    this.queue.push(job);
    this.publish(entry, { status: 'queued', stale: !!entry.snapshot.data, error: null });
    this.pump();
  }
  // A reappearing consumer resumes once after cancellation, never after a failed read.
  private scheduleCancelled() {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = undefined;
    if (!this.active || this.closed || this.scopeStopped || this.accountBlocked) return;
    const waiting = [...this.entries.values()].filter(
      (entry) => entry.resumeCancelled && entry.interests > 0 && !entry.job
    );
    if (!waiting.length) return;
    const next = Math.min(...waiting.map((entry) => entry.cooldownUntil));
    this.resumeTimer = setTimeout(
      () => {
        this.resumeTimer = undefined;
        for (const entry of waiting) {
          if (
            entry.resumeCancelled &&
            entry.interests > 0 &&
            !entry.job &&
            entry.cooldownUntil <= Date.now()
          ) {
            entry.resumeCancelled = false;
            this.enqueue(entry, false);
          }
        }
        this.scheduleCancelled();
      },
      Math.max(0, next - Date.now())
    );
  }
  private pump() {
    if (!this.active || this.scopeStopped || this.accountBlocked) return;
    while (this.running.size < MAX_ACTIVE && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.controller.signal.aborted || job.generation !== this.generation) continue;
      if (this.supported === false) {
        job.done = true;
        job.entry.job = undefined;
        this.publish(job.entry, state('unsupported'));
        continue;
      }
      this.running.add(job);
      void this.run(job);
    }
  }
  private current(job: Job) {
    return (
      this.active &&
      !this.closed &&
      !this.scopeStopped &&
      !this.accountBlocked &&
      job.generation === this.generation &&
      !job.controller.signal.aborted
    );
  }
  private capability(force = false) {
    if (this.capabilityPromise) return this.capabilityPromise;
    if (!force && this.supported !== undefined) return Promise.resolve(this.supported);
    const generation = this.generation;
    const promise = this.api!.capability(this.scope.signal)
      .then((supported) => {
        if (generation === this.generation && !this.scope.signal.aborted) {
          this.supported = supported;
          if (!supported)
            for (const entry of this.entries.values()) this.publish(entry, state('unsupported'));
        }
        return supported;
      })
      .finally(() => {
        if (this.capabilityPromise === promise) this.capabilityPromise = null;
      });
    this.capabilityPromise = promise;
    return promise;
  }
  private accountFailure(status: 401 | 403) {
    if (this.accountBlocked) return;
    this.accountBlocked = state(status === 401 ? 'unauthenticated' : 'forbidden');
    this.scope.abort();
    this.cancelAll();
    this.entries.clear();
    this.reportedAccess.clear();
    this.emitAll();
    this.notifyAccess({ status, resource: 'account' });
  }
  private reportResource(entry: Entry, status: 403 | 404) {
    if (entry.resource.type === 'personal') return;
    const key = keyOf(entry.resource);
    if (this.reportedAccess.has(key)) return;
    this.reportedAccess.add(key);
    this.notifyAccess({
      status,
      resource: entry.resource.type,
      datasetId: entry.resource.datasetId,
      ...(entry.resource.type === 'series' ? { seriesId: entry.resource.seriesId } : {}),
    });
  }
  private notifyAccess(issue: StatisticsAccessIssue) {
    try {
      this.options.onAccessIssue?.(issue);
    } catch {
      /* Host notifications cannot restart or reject a read. */
    }
  }
  private async run(job: Job) {
    const signal = job.controller.signal;
    const abort = () => job.controller.abort();
    const scopeSignal = this.scope.signal;
    scopeSignal.addEventListener('abort', abort, { once: true });
    this.publish(job.entry, { status: 'loading' });
    try {
      if (!(await abortRace(this.capability(), signal))) {
        if (this.current(job)) {
          job.done = true;
          job.entry.job = undefined;
          this.publish(job.entry, state('unsupported'));
        }
        return;
      }
      if (!this.current(job)) return;
      await this.api!.verifyIdentity(signal);
      if (!this.current(job)) return;
      const data = await this.api!.read(job.entry.resource, signal);
      await this.api!.verifyIdentity(signal);
      if (!this.current(job)) return;
      if (this.supported === false) {
        job.done = true;
        job.entry.job = undefined;
        this.publish(job.entry, state('unsupported'));
        return;
      }
      job.done = true;
      job.entry.job = undefined;
      job.entry.cooldownUntil = 0;
      this.publish(job.entry, {
        status: 'ready',
        data,
        stale: false,
        error: null,
        source: 'server',
        fetchedAt: Date.now(),
      });
    } catch (failure) {
      if (!this.current(job)) return;
      let error =
        failure instanceof StatisticsError
          ? failure
          : new StatisticsError('network', '统计读取未完成');
      const unverifiedNotFound = error.stage === 'statistics' && error.status === 404;
      if (error.kind === 'cancelled') return;
      if (error.kind === 'identity' || error.status === 401) {
        this.accountFailure(error.status === 403 ? 403 : 401);
        return;
      }
      // Confirm the account even after a failed/malformed response before showing a previous value.
      try {
        await this.api!.verifyIdentity(signal);
        if (error.status === 404 && error.stage === 'statistics') {
          const supported = await abortRace(this.capability(true), signal);
          await this.api!.verifyIdentity(signal);
          if (!this.current(job)) return;
          if (!supported) {
            job.done = true;
            job.entry.job = undefined;
            this.publish(job.entry, state('unsupported'));
            return;
          }
        }
      } catch (verification) {
        if (!this.current(job)) return;
        error =
          verification instanceof StatisticsError
            ? verification
            : new StatisticsError('network', '无法确认统计账号', 0, 'session');
        if (error.kind === 'identity' || error.status === 401) {
          this.accountFailure(error.status === 403 ? 403 : 401);
          return;
        }
      }
      if (!this.current(job)) return;
      job.done = true;
      job.entry.job = undefined;
      job.entry.cooldownUntil = Date.now() + COOLDOWN_MS;
      const resourceFailure =
        error.stage === 'statistics' && (error.status === 403 || error.status === 404);
      const status: StatisticsStatus = resourceFailure
        ? error.status === 404
          ? 'missing'
          : 'forbidden'
        : error.status === 423
          ? 'busy'
          : 'error';
      const data =
        resourceFailure || unverifiedNotFound || error.stage === 'session'
          ? null
          : job.entry.snapshot.data;
      this.publish(job.entry, {
        status,
        error,
        data,
        stale: !!data,
        source: data ? job.entry.snapshot.source : 'none',
      });
      if (resourceFailure) this.reportResource(job.entry, error.status as 403 | 404);
    } finally {
      job.done = true;
      scopeSignal.removeEventListener('abort', abort);
      this.running.delete(job);
      if (job.generation === this.generation && job.entry.job === job) job.entry.job = undefined;
      this.pump();
      this.prune();
    }
  }
}
