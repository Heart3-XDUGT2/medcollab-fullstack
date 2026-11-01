import type { BlockAssignment } from './types';

/** Owner name used for slices that nobody has claimed yet. */
export const UNASSIGNED_OWNER = '未分配';

const EN_DASH = '\u2013';

/**
 * Formats a 1-based inclusive range using an en dash: `formatRange(1, 40)` -> `1–40`.
 */
export function formatRange(start: number, end: number): string {
  return `${start}${EN_DASH}${end}`;
}

function assertTotalSlices(totalSlices: number): void {
  if (!Number.isInteger(totalSlices) || totalSlices < 1) {
    throw new RangeError(`totalSlices must be a positive integer, received ${totalSlices}`);
  }
}

function assertIntegerSlice(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer, received ${value}`);
  }
}

/**
 * Validates block ranges against the number of slices in the series.
 *
 * Throws when a range is out of bounds (`< 1` or `> totalSlices`), when
 * `start > end`, or when two ranges overlap. Gaps (unassigned slices) are
 * allowed, and so are blocks explicitly marked `unassigned`.
 */
export function validateBlocks(totalSlices: number, blocks: readonly BlockAssignment[]): void {
  assertTotalSlices(totalSlices);

  blocks.forEach(block => {
    assertIntegerSlice(block.start, `block "${block.id}" start`);
    assertIntegerSlice(block.end, `block "${block.id}" end`);

    if (block.start > block.end) {
      throw new RangeError(`block "${block.id}" has start ${block.start} after end ${block.end}`);
    }

    if (block.start < 1 || block.end > totalSlices) {
      throw new RangeError(
        `block "${block.id}" range ${formatRange(block.start, block.end)} is outside 1${EN_DASH}${totalSlices}`
      );
    }
  });

  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];

    if (current.start <= previous.end) {
      throw new RangeError(
        `blocks "${previous.id}" ${formatRange(previous.start, previous.end)} and ` +
          `"${current.id}" ${formatRange(current.start, current.end)} overlap`
      );
    }
  }
}

function createGapBlock(start: number, end: number): BlockAssignment {
  return {
    id: `gap-${start}-${end}`,
    start,
    end,
    owner: UNASSIGNED_OWNER,
    status: 'unassigned',
  };
}

/**
 * Returns a sorted copy of `blocks` where every gap in `1..totalSlices` is
 * filled with an `unassigned` placeholder block (owner `未分配`). The input is
 * not mutated, and the result never contains overlapping ranges.
 *
 * Throws (via {@link validateBlocks}) when the input itself is invalid.
 */
export function normalizeBlocks(
  totalSlices: number,
  blocks: readonly BlockAssignment[]
): BlockAssignment[] {
  validateBlocks(totalSlices, blocks);

  const sorted = [...blocks]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map(block => ({ ...block }));

  const normalized: BlockAssignment[] = [];
  let nextSlice = 1;

  sorted.forEach(block => {
    if (block.start > nextSlice) {
      normalized.push(createGapBlock(nextSlice, block.start - 1));
    }
    normalized.push(block);
    nextSlice = block.end + 1;
  });

  if (nextSlice <= totalSlices) {
    normalized.push(createGapBlock(nextSlice, totalSlices));
  }

  return normalized;
}

/**
 * Returns the block containing `slice`, or `null` when the slice is in a gap
 * or outside every block range.
 */
export function blockAt(blocks: readonly BlockAssignment[], slice: number): BlockAssignment | null {
  return blocks.find(block => slice >= block.start && slice <= block.end) ?? null;
}

export type BlockCoverage = {
  /** Slices covered by blocks whose status is not `unassigned`. */
  assigned: number;
  total: number;
  /** Rounded percentage, 0-100. */
  percent: number;
};

/**
 * Computes how many slices are assigned to a real owner.
 *
 * Unassigned placeholder blocks (e.g. the gaps produced by
 * {@link normalizeBlocks}) do not count as assigned, so
 * `coverage` is stable whether it receives raw assignments or normalized
 * blocks. Overlapping ranges are defensively merged so slices are counted once.
 */
export function coverage(blocks: readonly BlockAssignment[], totalSlices: number): BlockCoverage {
  const total = Number.isFinite(totalSlices) && totalSlices > 0 ? Math.floor(totalSlices) : 0;

  const ranges = blocks
    .filter(block => block.status !== 'unassigned')
    .map(block => ({
      start: Math.max(1, Math.min(block.start, block.end)),
      end: Math.min(total, Math.max(block.start, block.end)),
    }))
    .filter(range => range.start <= range.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let assigned = 0;
  let currentStart = 0;
  let currentEnd = 0;

  ranges.forEach(range => {
    if (range.start > currentEnd) {
      if (currentEnd > 0) {
        assigned += currentEnd - currentStart + 1;
      }
      currentStart = range.start;
      currentEnd = range.end;
      return;
    }

    currentEnd = Math.max(currentEnd, range.end);
  });

  if (currentEnd > 0) {
    assigned += currentEnd - currentStart + 1;
  }

  assigned = Math.min(assigned, total);

  return {
    assigned,
    total,
    percent: total > 0 ? Math.round((assigned / total) * 100) : 0,
  };
}
