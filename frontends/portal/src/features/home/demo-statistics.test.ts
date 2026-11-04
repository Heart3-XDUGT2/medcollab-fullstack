import { describe, expect, test } from 'vitest';
import { createDemoLibrary } from './demo';
import { demoStatistics } from './demo-statistics';

describe('illustrative datasets and independently specified CT counts agree', () => {
  test('supported single-frame CT never exceeds the dataset total; empty/MR resources have no supported CT', () => {
    const datasets = createDemoLibrary().list();
    expect(Object.keys(demoStatistics).sort()).toEqual(
      datasets.map((dataset) => dataset.id).sort()
    );
    for (const dataset of datasets) {
      const value = demoStatistics[dataset.id];
      // This is a fixture sanity bound, not the real coverage denominator formula.
      expect(value.progress.totalSlices).toBeLessThanOrEqual(dataset.instanceCount);
      if (dataset.instanceCount === 0 || ['demo-brain-mr', 'demo-spine-mr'].includes(dataset.id)) {
        expect(value.progress.totalSlices).toBe(0);
        expect(value.progress.annotatedSlices).toBe(0);
        expect(value.publishedProgress.annotatedSlices).toBe(0);
        expect(value.series).toHaveLength(0);
      }
      expect(value.progress.totalSlices).toBe(value.publishedProgress.totalSlices);
      expect(value.progress.annotatedSlices).toBeLessThanOrEqual(value.progress.totalSlices);
      expect(value.publishedProgress.annotatedSlices).toBeLessThanOrEqual(
        value.publishedProgress.totalSlices
      );
    }
    expect(demoStatistics['demo-abdomen-first'].progress.totalSlices).toBe(300);
    expect(datasets.find((dataset) => dataset.id === 'demo-abdomen-first')!.instanceCount).toBe(
      1248
    );
  });
});
