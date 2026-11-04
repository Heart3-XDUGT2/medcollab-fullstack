import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { StatisticsModel } from './store';
import type { StatisticsOptions, StatisticsSnapshot } from './store';
import type {
  DatasetAnnotationStats,
  PersonalAnnotationStats,
  SeriesAnnotationStats,
  StatisticsResource,
} from './contract';

export function useAnnotationStatistics(options: StatisticsOptions): StatisticsModel {
  const callback = useRef(options.onAccessIssue);
  callback.current = options.onAccessIssue;
  const issuer = options.mode === 'real' ? options.identity?.issuer : undefined;
  const subject = options.mode === 'real' ? options.identity?.subject : undefined;
  const demoData = options.mode === 'demo' ? options.demoData : undefined;
  const sessionReader = options.sessionApi.getSession;
  const model = useMemo(
    () =>
      new StatisticsModel({
        mode: options.mode,
        apiEnabled: options.apiEnabled,
        identity: issuer && subject ? { issuer, subject } : null,
        scopeSignal: options.scopeSignal,
        sessionApi: { getSession: (signal) => sessionReader(signal) },
        demoData,
        fetchImpl: options.fetchImpl,
        onAccessIssue: (issue) => callback.current?.(issue),
      }),
    [
      options.mode,
      options.apiEnabled,
      issuer,
      subject,
      options.scopeSignal,
      sessionReader,
      demoData,
      options.fetchImpl,
    ]
  );
  useLayoutEffect(() => {
    model.start();
    return () => model.dispose();
  }, [model]);
  return model;
}
function useResource<T>(model: StatisticsModel, resource: StatisticsResource, enabled: boolean) {
  const subscribe = useCallback(
    (listener: () => void) => model.subscribe(resource, listener),
    [model, resource]
  );
  const snapshot = useCallback(
    () => model.getSnapshot(resource) as StatisticsSnapshot<T>,
    [model, resource]
  );
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => (enabled ? model.watch(resource) : undefined), [model, resource, enabled]);
  const refresh = useCallback(() => model.refresh(resource), [model, resource]);
  return useMemo(() => ({ ...value, refresh }), [value, refresh]);
}
export function useDatasetStatistics(
  model: StatisticsModel,
  datasetId: string,
  options: { enabled?: boolean } = {}
) {
  const resource = useMemo<StatisticsResource>(() => ({ type: 'dataset', datasetId }), [datasetId]);
  return useResource<DatasetAnnotationStats>(model, resource, options.enabled !== false);
}
export function useSeriesStatistics(
  model: StatisticsModel,
  datasetId: string,
  seriesId: string,
  options: { enabled?: boolean } = {}
) {
  const resource = useMemo<StatisticsResource>(
    () => ({ type: 'series', datasetId, seriesId }),
    [datasetId, seriesId]
  );
  return useResource<SeriesAnnotationStats>(model, resource, options.enabled !== false);
}
export function usePersonalStatistics(model: StatisticsModel, options: { enabled?: boolean } = {}) {
  const resource = useMemo<StatisticsResource>(() => ({ type: 'personal' }), []);
  return useResource<PersonalAnnotationStats>(model, resource, options.enabled !== false);
}
