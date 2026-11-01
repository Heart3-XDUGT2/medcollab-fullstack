/**
 * P1 slice-block division model.
 *
 * All slice ranges are 1-based and inclusive: `{ start: 1, end: 40 }` covers
 * slices 1 through 40 (40 slices). The range is display-only metadata for the
 * collaboration demo; it does not imply backend support for block ownership.
 */

export type BlockStatus = 'unassigned' | 'in_progress' | 'done' | 'review';

export type BlockAssignment = {
  id: string;
  start: number;
  end: number;
  owner: string;
  status: BlockStatus;
  /** Optional owner color override, e.g. `#3B6EA5`. Falls back to the owner palette. */
  color?: string;
};

export type DivisionMode = 'case' | 'series' | 'block' | 'organ';
