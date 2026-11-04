import { describe, expect, test } from 'vitest';
import {
  formatCoverage,
  makeSyntheticDatasetStatistics,
  parseDatasetStatistics,
  parsePersonalStatistics,
  parseProgress,
  parseSeriesStatistics,
  resourceId,
} from './contract';
import { dataset, personal } from './testSupport';

describe('statistics contracts', () => {
  test('distinguishes zero, empty CT and absent publication', () => {
    const zero = dataset('zero', 0, 0);
    expect(formatCoverage(zero.progress)).toBe('0%');
    expect(zero.series[0].publishedVersion).toBe(0);
    const empty = dataset('empty', 0, 0, 0);
    expect(empty.series).toEqual([]);
    expect(formatCoverage(empty.progress)).toBe('无可标注 CT');
    expect(dataset('erased', 0, 3).progress.annotatedSlices).toBe(0);
    expect(
      makeSyntheticDatasetStatistics('published-empty', {
        totalSlices: 10,
        annotatedSlices: 0,
        publishedAnnotatedSlices: 0,
        publishedVersion: 2,
      }).series[0].publishedVersion
    ).toBe(2);
  });
  test.each([
    { totalSlices: -1 },
    { totalSlices: 1.5 },
    { totalSlices: Number.MAX_SAFE_INTEGER + 1 },
    { annotatedSlices: 11 },
    { unannotatedSlices: 4 },
    { ratio: NaN },
    { ratio: -1e-10, annotatedSlices: 0, unannotatedSlices: 10, percent: 0 },
    { ratio: 1 + 1e-10, annotatedSlices: 10, unannotatedSlices: 0, percent: 100 },
    { ratio: 0.5 },
    { percent: 0.4 },
    { percent: 101 },
    { annotatedSlices: '4' },
  ])('rejects malformed progress %j', (patch) => {
    expect(() => parseProgress({ ...dataset().progress, ...patch })).toThrow();
  });
  test('does not display rounded partial coverage as 100% or tiny coverage as zero', () => {
    expect(formatCoverage(dataset('almost', 999999, 0, 1000000).progress)).toBe('<100%');
    expect(formatCoverage(dataset('tiny', 1, 0, 1000000).progress)).toBe('<0.01%');
    expect(formatCoverage(dataset('full', 10, 0).progress)).toBe('100%');
  });
  test('aggregates weighted slices rather than averaging series percentages', () => {
    const a = dataset('d', 1, 1, 2),
      b = dataset('d', 0, 0, 1);
    const total = dataset('d', 1, 1, 3);
    const value = {
      ...total,
      seriesCount: 2,
      series: [a.series[0], { ...b.series[0], seriesId: 'other' }],
    };
    expect(parseDatasetStatistics(value, 'd').progress.percent).toBe(33.33);
    expect(() =>
      parseDatasetStatistics({ ...value, progress: { ...total.progress, percent: 25 } }, 'd')
    ).toThrow();
    expect(() =>
      parseDatasetStatistics({ ...value, series: [a.series[0], a.series[0]] }, 'd')
    ).toThrow();
    expect(() => parseDatasetStatistics({ ...value, seriesCount: 3 }, 'd')).toThrow();
  });
  test.each([
    { seq: 0 },
    { pendingArchive: false },
    { publishedVersion: 0 },
    { datasetId: 'other' },
    { seriesId: 'other' },
    { archiveError: null },
    { throughSeq: 99 },
  ])('rejects inconsistent series %j', (patch) => {
    const value = dataset().series[0];
    expect(() => parseSeriesStatistics({ ...value, ...patch }, 'd', value.seriesId)).toThrow();
  });
  test('binds dataset and strips uncontracted fields from immutable results', () => {
    expect(() => parseDatasetStatistics(dataset(), 'other')).toThrow();
    const value = parseDatasetStatistics({ ...dataset(), token: 'secret' }, 'd');
    expect(value).not.toHaveProperty('token');
    expect(Object.isFrozen(value.series[0].progress)).toBe(true);
    expect(Object.isFrozen(value.series)).toBe(true);
    expect(() => parseDatasetStatistics({ ...dataset(), pendingArchive: false }, 'd')).toThrow();
  });
  test('validates personal operation formula and null timestamps, not physical gestures', () => {
    expect(parsePersonalStatistics(personal()).totalStrokes).toBe(120);
    expect(
      parsePersonalStatistics({
        ...personal(),
        totalStrokes: 0,
        totalAcceptedOperations: 4,
        paintOperations: 0,
        eraseOperations: 0,
        mixedOperations: 0,
        editedSliceCount: 0,
        everPaintedSliceCount: 0,
        editedDatasetCount: 0,
        editedSeriesCount: 0,
        firstEditAt: null,
        lastEditAt: null,
      }).totalAcceptedOperations
    ).toBe(4);
  });
  test.each([
    { totalStrokes: 125 },
    { totalAcceptedOperations: 1 },
    { mixedOperations: 26 },
    { editedSliceCount: 2 },
    { firstEditAt: null },
    { lastEditAt: '2020-01-01' },
    { countingMethod: 'mouse-strokes' },
    { historyIncluded: 'true' },
    { generatedAt: 'invalid' },
  ])('rejects malformed personal statistics %j', (patch) => {
    expect(() => parsePersonalStatistics({ ...personal(), ...patch })).toThrow();
  });
  test.each(['', ' ', '.', '..', '\n', 'x'.repeat(1025)])('rejects unsafe resource ID %j', (id) => {
    expect(() => resourceId(id)).toThrow();
  });
});
