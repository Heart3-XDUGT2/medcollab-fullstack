export type AnnotationProgress = Readonly<{
  totalSlices: number;
  annotatedSlices: number;
  unannotatedSlices: number;
  ratio: number;
  percent: number;
}>;
export type SeriesAnnotationStats = Readonly<{
  datasetId: string;
  seriesId: string;
  progress: AnnotationProgress;
  publishedProgress: AnnotationProgress;
  seq: number;
  throughSeq: number;
  publishedVersion: number;
  pendingArchive: boolean;
  archiveError: string;
}>;
export type DatasetAnnotationStats = Readonly<{
  datasetId: string;
  completionMethod: 'nonempty-mask-slices/ct-slices';
  seriesCount: number;
  progress: AnnotationProgress;
  publishedProgress: AnnotationProgress;
  pendingArchive: boolean;
  series: readonly SeriesAnnotationStats[];
  generatedAt: string;
}>;
export type PersonalAnnotationStats = Readonly<{
  statisticVersion: 1;
  countingMethod: 'accepted-mask-edit-operation';
  scope: 'server-accepted-collaboration-history';
  historyIncluded: boolean;
  totalStrokes: number;
  totalAcceptedOperations: number;
  paintOperations: number;
  eraseOperations: number;
  mixedOperations: number;
  editedSliceCount: number;
  everPaintedSliceCount: number;
  editedDatasetCount: number;
  editedSeriesCount: number;
  firstEditAt: string | null;
  lastEditAt: string | null;
  generatedAt: string;
}>;
export type StatisticsResource =
  | { type: 'dataset'; datasetId: string }
  | { type: 'series'; datasetId: string; seriesId: string }
  | { type: 'personal' };
export type StatisticsData =
  | DatasetAnnotationStats
  | SeriesAnnotationStats
  | PersonalAnnotationStats;
export type StatisticsErrorKind =
  | 'http'
  | 'identity'
  | 'protocol'
  | 'network'
  | 'timeout'
  | 'cancelled';
export class StatisticsError extends Error {
  constructor(
    public readonly kind: StatisticsErrorKind,
    message: string,
    public readonly status = 0,
    public readonly stage: 'session' | 'health' | 'statistics' = 'statistics'
  ) {
    super(message);
    this.name = 'StatisticsError';
  }
}
const bad = (): never => {
  throw new StatisticsError('protocol', '统计响应不符合约定，请稍后重新读取');
};
const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : bad();
const integer = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : bad();
const bool = (value: unknown): boolean => (typeof value === 'boolean' ? value : bad());
const timestamp = (value: unknown): string =>
  typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value))
    ? value
    : bad();
export function resourceId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value === '.' ||
    value === '..' ||
    value.length > 1024 ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new StatisticsError('protocol', '缺少有效的统计资源编号');
  return value;
}
export function parseProgress(value: unknown): AnnotationProgress {
  const v = obj(value);
  const totalSlices = integer(v.totalSlices),
    annotatedSlices = integer(v.annotatedSlices),
    unannotatedSlices = integer(v.unannotatedSlices);
  const ratio = totalSlices === 0 ? 0 : annotatedSlices / totalSlices;
  const percent = Math.round(ratio * 10000) / 100;
  if (
    annotatedSlices > totalSlices ||
    unannotatedSlices !== totalSlices - annotatedSlices ||
    typeof v.ratio !== 'number' ||
    !Number.isFinite(v.ratio) ||
    v.ratio < 0 ||
    v.ratio > 1 ||
    Math.abs(v.ratio - ratio) > 1e-9 ||
    typeof v.percent !== 'number' ||
    !Number.isFinite(v.percent) ||
    v.percent < 0 ||
    v.percent > 100 ||
    Math.abs(v.percent - percent) > 1e-7
  )
    bad();
  return Object.freeze({ totalSlices, annotatedSlices, unannotatedSlices, ratio, percent });
}
export function parseSeriesStatistics(
  value: unknown,
  datasetId: string,
  seriesId: string
): SeriesAnnotationStats {
  const v = obj(value);
  if (v.datasetId !== datasetId || v.seriesId !== seriesId) bad();
  const progress = parseProgress(v.progress),
    publishedProgress = parseProgress(v.publishedProgress);
  const seq = integer(v.seq),
    throughSeq = integer(v.throughSeq),
    publishedVersion = integer(v.publishedVersion);
  const pendingArchive = bool(v.pendingArchive);
  if (
    progress.totalSlices !== publishedProgress.totalSlices ||
    throughSeq > seq ||
    pendingArchive !== seq > throughSeq ||
    (publishedVersion === 0 && publishedProgress.annotatedSlices !== 0) ||
    typeof v.archiveError !== 'string' ||
    v.archiveError.length > 4096
  )
    bad();
  return Object.freeze({
    datasetId,
    seriesId,
    progress,
    publishedProgress,
    seq,
    throughSeq,
    publishedVersion,
    pendingArchive,
    archiveError: v.archiveError as string,
  });
}
function sum(values: readonly number[]): number {
  const result = values.reduce((total, value) => total + value, 0);
  return integer(result);
}
export function parseDatasetStatistics(value: unknown, datasetId: string): DatasetAnnotationStats {
  const v = obj(value);
  if (
    v.datasetId !== datasetId ||
    v.completionMethod !== 'nonempty-mask-slices/ct-slices' ||
    !Array.isArray(v.series)
  )
    bad();
  const series = (v.series as unknown[]).map((item) =>
    parseSeriesStatistics(item, datasetId, resourceId(obj(item).seriesId))
  );
  const seriesCount = integer(v.seriesCount),
    pendingArchive = bool(v.pendingArchive);
  const progress = parseProgress(v.progress),
    publishedProgress = parseProgress(v.publishedProgress);
  if (
    seriesCount !== series.length ||
    new Set(series.map((item) => item.seriesId)).size !== seriesCount ||
    (progress.totalSlices === 0 && seriesCount !== 0) ||
    progress.totalSlices !== sum(series.map((item) => item.progress.totalSlices)) ||
    progress.annotatedSlices !== sum(series.map((item) => item.progress.annotatedSlices)) ||
    publishedProgress.totalSlices !==
      sum(series.map((item) => item.publishedProgress.totalSlices)) ||
    publishedProgress.annotatedSlices !==
      sum(series.map((item) => item.publishedProgress.annotatedSlices)) ||
    progress.totalSlices !== publishedProgress.totalSlices ||
    pendingArchive !== series.some((item) => item.pendingArchive)
  )
    bad();
  return Object.freeze({
    datasetId,
    completionMethod: 'nonempty-mask-slices/ct-slices',
    seriesCount,
    progress,
    publishedProgress,
    pendingArchive,
    series: Object.freeze(series),
    generatedAt: timestamp(v.generatedAt),
  });
}
export function parsePersonalStatistics(value: unknown): PersonalAnnotationStats {
  const v = obj(value);
  if (
    v.statisticVersion !== 1 ||
    v.countingMethod !== 'accepted-mask-edit-operation' ||
    v.scope !== 'server-accepted-collaboration-history'
  )
    bad();
  const totalStrokes = integer(v.totalStrokes),
    totalAcceptedOperations = integer(v.totalAcceptedOperations);
  const paintOperations = integer(v.paintOperations),
    eraseOperations = integer(v.eraseOperations),
    mixedOperations = integer(v.mixedOperations);
  const editedSliceCount = integer(v.editedSliceCount),
    everPaintedSliceCount = integer(v.everPaintedSliceCount);
  const editedDatasetCount = integer(v.editedDatasetCount),
    editedSeriesCount = integer(v.editedSeriesCount);
  const firstEditAt = v.firstEditAt === null ? null : timestamp(v.firstEditAt);
  const lastEditAt = v.lastEditAt === null ? null : timestamp(v.lastEditAt);
  if (
    totalAcceptedOperations < totalStrokes ||
    mixedOperations > Math.min(paintOperations, eraseOperations) ||
    totalStrokes !== paintOperations + eraseOperations - mixedOperations ||
    !Number.isSafeInteger(paintOperations + eraseOperations) ||
    everPaintedSliceCount > editedSliceCount ||
    editedDatasetCount > editedSeriesCount ||
    editedSeriesCount > editedSliceCount ||
    (totalStrokes === 0 &&
      (editedSliceCount !== 0 || firstEditAt !== null || lastEditAt !== null)) ||
    (totalStrokes > 0 &&
      (firstEditAt === null ||
        lastEditAt === null ||
        Date.parse(firstEditAt) > Date.parse(lastEditAt)))
  )
    bad();
  return Object.freeze({
    statisticVersion: 1,
    countingMethod: 'accepted-mask-edit-operation',
    scope: 'server-accepted-collaboration-history',
    historyIncluded: bool(v.historyIncluded),
    totalStrokes,
    totalAcceptedOperations,
    paintOperations,
    eraseOperations,
    mixedOperations,
    editedSliceCount,
    everPaintedSliceCount,
    editedDatasetCount,
    editedSeriesCount,
    firstEditAt,
    lastEditAt,
    generatedAt: timestamp(v.generatedAt),
  });
}
export function formatCoverage(progress: AnnotationProgress): string {
  if (progress.totalSlices === 0) return '无可标注 CT';
  if (progress.annotatedSlices === progress.totalSlices) return '100%';
  if (progress.annotatedSlices === 0) return '0%';
  if (progress.percent >= 100) return '<100%';
  if (progress.percent === 0) return '<0.01%';
  return (
    new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(progress.percent) + '%'
  );
}
export function makeSyntheticDatasetStatistics(
  datasetId: string,
  counts: {
    totalSlices: number;
    annotatedSlices: number;
    publishedAnnotatedSlices: number;
    publishedVersion?: number;
    pendingArchive?: boolean;
    archiveError?: string;
  }
): DatasetAnnotationStats {
  resourceId(datasetId);
  const make = (annotatedSlices: number): AnnotationProgress => {
    const ratio = counts.totalSlices === 0 ? 0 : annotatedSlices / counts.totalSlices;
    return {
      totalSlices: counts.totalSlices,
      annotatedSlices,
      unannotatedSlices: counts.totalSlices - annotatedSlices,
      ratio,
      percent: Math.round(ratio * 10000) / 100,
    };
  };
  const progress = make(counts.annotatedSlices),
    publishedProgress = make(counts.publishedAnnotatedSlices);
  const pending =
    counts.pendingArchive ?? counts.annotatedSlices !== counts.publishedAnnotatedSlices;
  const version = counts.publishedVersion ?? (counts.publishedAnnotatedSlices > 0 ? 1 : 0);
  const throughSeq = version > 0 ? 1 : 0;
  const series =
    counts.totalSlices === 0
      ? []
      : [
          {
            datasetId,
            seriesId: datasetId + '-synthetic-series',
            progress,
            publishedProgress,
            seq: throughSeq + (pending ? 1 : 0),
            throughSeq,
            publishedVersion: version,
            pendingArchive: pending,
            archiveError: counts.archiveError || '',
          },
        ];
  return parseDatasetStatistics(
    {
      datasetId,
      completionMethod: 'nonempty-mask-slices/ct-slices',
      seriesCount: series.length,
      progress,
      publishedProgress,
      pendingArchive: series.length > 0 && pending,
      series,
      generatedAt: new Date().toISOString(),
    },
    datasetId
  );
}
