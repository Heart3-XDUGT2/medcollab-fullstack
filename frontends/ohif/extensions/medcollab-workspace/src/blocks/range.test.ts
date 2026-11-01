import type { BlockAssignment } from './types';
import {
  blockAt,
  coverage,
  formatRange,
  normalizeBlocks,
  UNASSIGNED_OWNER,
  validateBlocks,
} from './range';

function makeBlock(
  spec: Pick<BlockAssignment, 'id' | 'start' | 'end'> & Partial<BlockAssignment>
): BlockAssignment {
  const { id, start, end, ...rest } = spec;

  return {
    id,
    start,
    end,
    owner: id,
    status: 'in_progress',
    ...rest,
  };
}

describe('formatRange', () => {
  it('formats a 1-based inclusive range with an en dash', () => {
    expect(formatRange(1, 40)).toBe('1\u201340');
    expect(formatRange(81, 120)).toBe('81\u2013120');
  });

  it('uses an en dash, not a hyphen', () => {
    expect(formatRange(1, 40)).not.toContain('-');
  });
});

describe('validateBlocks', () => {
  const totalSlices = 120;

  it('accepts adjacent blocks that cover the whole series', () => {
    const blocks = [
      makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' }),
      makeBlock({ id: 'b', start: 41, end: 80, owner: 'B' }),
      makeBlock({ id: 'c', start: 81, end: 120, owner: 'C' }),
    ];

    expect(() => validateBlocks(totalSlices, blocks)).not.toThrow();
  });

  it('allows gaps and explicitly unassigned blocks', () => {
    const blocks = [
      makeBlock({ id: 'b', start: 41, end: 80, owner: 'B' }),
      makeBlock({ id: 'gap', start: 100, end: 110, owner: UNASSIGNED_OWNER, status: 'unassigned' }),
    ];

    expect(() => validateBlocks(totalSlices, blocks)).not.toThrow();
  });

  it('throws when start is greater than end', () => {
    expect(() => validateBlocks(120, [makeBlock({ id: 'bad', start: 40, end: 1 })])).toThrow(
      /after end/
    );
  });

  it('throws when a range starts before slice 1', () => {
    expect(() => validateBlocks(120, [makeBlock({ id: 'bad', start: 0, end: 10 })])).toThrow(
      /outside/
    );
  });

  it('throws when a range ends after totalSlices', () => {
    expect(() => validateBlocks(120, [makeBlock({ id: 'bad', start: 100, end: 121 })])).toThrow(
      /outside/
    );
  });

  it('throws when two ranges overlap, including a shared boundary slice', () => {
    const blocks = [
      makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' }),
      makeBlock({ id: 'b', start: 40, end: 80, owner: 'B' }),
    ];

    expect(() => validateBlocks(120, blocks)).toThrow(/overlap/);
  });

  it('detects overlaps regardless of input order', () => {
    const blocks = [
      makeBlock({ id: 'b', start: 60, end: 80, owner: 'B' }),
      makeBlock({ id: 'a', start: 1, end: 61, owner: 'A' }),
    ];

    expect(() => validateBlocks(120, blocks)).toThrow(/overlap/);
  });

  it('rejects invalid totals and non-integer bounds', () => {
    expect(() => validateBlocks(0, [])).toThrow(/totalSlices/);
    expect(() => validateBlocks(1.5, [])).toThrow(/totalSlices/);
    expect(() => validateBlocks(120, [makeBlock({ id: 'bad', start: 1.5, end: 10 })])).toThrow(
      /integer/
    );
  });
});

describe('normalizeBlocks', () => {
  it('sorts blocks and fills head, middle and tail gaps with unassigned blocks', () => {
    const c = makeBlock({ id: 'c', start: 81, end: 120, owner: 'C', status: 'done' });
    const a = makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' });
    const blocks = [c, a];

    const normalized = normalizeBlocks(120, blocks);

    expect(normalized.map(block => block.id)).toEqual(['a', 'gap-41-80', 'c']);
    expect(normalized.map(block => formatRange(block.start, block.end))).toEqual([
      '1\u201340',
      '41\u201380',
      '81\u2013120',
    ]);

    const gap = normalized[1];
    expect(gap.owner).toBe(UNASSIGNED_OWNER);
    expect(gap.status).toBe('unassigned');
    expect(gap.color).toBeUndefined();
  });

  it('appends a trailing gap when the last block does not reach totalSlices', () => {
    const normalized = normalizeBlocks(100, [
      makeBlock({ id: 'a', start: 50, end: 60, owner: 'A' }),
    ]);

    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toMatchObject({ start: 1, end: 49, status: 'unassigned' });
    expect(normalized[1]).toMatchObject({ start: 50, end: 60, owner: 'A' });
    expect(normalized[2]).toMatchObject({ start: 61, end: 100, status: 'unassigned' });
  });

  it('does not add gaps when blocks cover the whole series', () => {
    const normalized = normalizeBlocks(40, [makeBlock({ id: 'a', start: 1, end: 40 })]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe('a');
  });

  it('does not mutate or reuse the input array/objects', () => {
    const c = makeBlock({ id: 'c', start: 81, end: 120, owner: 'C' });
    const a = makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' });
    const blocks = [c, a];

    const normalized = normalizeBlocks(120, blocks);

    expect(blocks.map(block => block.id)).toEqual(['c', 'a']);
    expect(normalized[0]).not.toBe(a);
    expect(normalized[2]).not.toBe(c);
    expect(normalized.map(block => block.id)).toEqual(['a', 'gap-41-80', 'c']);
  });

  it('rejects overlapping input through validation', () => {
    const blocks = [
      makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' }),
      makeBlock({ id: 'b', start: 30, end: 80, owner: 'B' }),
    ];

    expect(() => normalizeBlocks(120, blocks)).toThrow(/overlap/);
  });
});

describe('blockAt', () => {
  const blocks = [
    makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' }),
    makeBlock({ id: 'c', start: 81, end: 120, owner: 'C' }),
  ];

  it('returns the block containing a slice, including its boundaries', () => {
    expect(blockAt(blocks, 1)?.id).toBe('a');
    expect(blockAt(blocks, 40)?.id).toBe('a');
    expect(blockAt(blocks, 81)?.id).toBe('c');
    expect(blockAt(blocks, 120)?.id).toBe('c');
  });

  it('returns null for gaps and out-of-series slices', () => {
    expect(blockAt(blocks, 60)).toBeNull();
    expect(blockAt(blocks, 0)).toBeNull();
    expect(blockAt(blocks, 121)).toBeNull();
    expect(blockAt([], 1)).toBeNull();
  });
});

describe('coverage', () => {
  it('returns zero coverage for no blocks', () => {
    expect(coverage([], 120)).toEqual({ assigned: 0, total: 120, percent: 0 });
  });

  it('counts assigned slices and rounds the percentage', () => {
    const blocks = [
      makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' }),
      makeBlock({ id: 'b', start: 41, end: 80, owner: 'B' }),
    ];

    expect(coverage(blocks, 120)).toEqual({ assigned: 80, total: 120, percent: 67 });
  });

  it('reports full coverage when every slice is assigned', () => {
    const blocks = [makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' })];

    expect(coverage(blocks, 40)).toEqual({ assigned: 40, total: 40, percent: 100 });
  });

  it('ignores unassigned gap blocks produced by normalizeBlocks', () => {
    const raw = [makeBlock({ id: 'a', start: 1, end: 40, owner: 'A' })];
    const normalized = normalizeBlocks(120, raw);

    expect(coverage(normalized, 120)).toEqual({ assigned: 40, total: 120, percent: 33 });
  });

  it('counts overlapping ranges once', () => {
    const blocks = [
      makeBlock({ id: 'a', start: 1, end: 10, owner: 'A' }),
      makeBlock({ id: 'b', start: 5, end: 20, owner: 'B' }),
    ];

    expect(coverage(blocks, 20)).toEqual({ assigned: 20, total: 20, percent: 100 });
  });

  it('clamps slices outside the series and handles a zero total', () => {
    expect(coverage([makeBlock({ id: 'a', start: 5, end: 20, owner: 'A' })], 10)).toEqual({
      assigned: 6,
      total: 10,
      percent: 60,
    });
    expect(coverage([makeBlock({ id: 'a', start: 1, end: 10, owner: 'A' })], 0)).toEqual({
      assigned: 0,
      total: 0,
      percent: 0,
    });
  });
});
