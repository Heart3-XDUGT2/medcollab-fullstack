import { describe, expect, test } from 'vitest';
import { sourceCounts } from './ScopeOverview';
import type { Dataset } from './api';

describe('complete personal collection source counts', () => {
  test('one authorization collection supplies all counts, independent of instances and preview limit', () => {
    const datasets = Array.from({ length: 12 }, (_, index) => ({
      id: `fixture-${index}`,
      access: (['owner', 'shared', 'public'] as const)[index % 3],
      name: 'Synthetic dataset',
      ownerUsername: 'Synthetic account',
      instanceCount: index ? 100000 : 0,
      createdAt: '2026-11-01T00:00:00Z',
    })) satisfies Dataset[];
    const original = JSON.stringify(datasets);
    expect(sourceCounts(datasets)).toEqual({ all: 12, owner: 4, shared: 4, public: 4 });
    expect(JSON.stringify(datasets)).toBe(original);
    expect(sourceCounts(datasets.slice(0, 6)).all).toBe(6);
  });
  test('empty is genuinely zero, not missing content or complete CT coverage', () => {
    expect(sourceCounts([])).toEqual({ all: 0, owner: 0, shared: 0, public: 0 });
  });
});
