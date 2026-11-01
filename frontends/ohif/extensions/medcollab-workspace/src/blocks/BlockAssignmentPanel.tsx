import React from 'react';
import { cn } from '@ohif/ui-next';

import type { BlockAssignment, BlockStatus } from './types';
import { coverage, formatRange } from './range';
import {
  blockColor,
  blockStatusLabel,
  isCurrentOwner,
  isUnassigned,
  ownerLabel,
} from './presentation';
import { SliceRangeBar } from './SliceRangeBar';

export type BlockAssignmentPanelProps = {
  totalSlices: number;
  blocks: BlockAssignment[];
  currentOwner: string;
  readOnly?: boolean;
  onSelect?: (block: BlockAssignment) => void;
};

const STATUS_PILL_CLASSES: Record<BlockStatus, string> = {
  unassigned: 'border-dashed border-border text-muted-foreground',
  in_progress: 'border-actions-primary/50 bg-actions-primary/10 text-actions-primary',
  done: 'border-customgreen-100/50 bg-customgreen-100/10 text-customgreen-100',
  review: 'border-actions-highlight/50 bg-actions-highlight/10 text-actions-highlight',
};

function sortBlocks(blocks: readonly BlockAssignment[]): BlockAssignment[] {
  return [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Presentational slice-block assignment panel: header with coverage summary and
 * {@link SliceRangeBar}, one row per block, and the boundary/merge reminder.
 * It never fetches data and never mutates the blocks it receives. Gaps are not
 * synthesized here: pass `normalizeBlocks(...)` if unassigned gap rows should
 * be listed.
 */
export function BlockAssignmentPanel({
  totalSlices,
  blocks,
  currentOwner,
  readOnly = false,
  onSelect,
}: BlockAssignmentPanelProps) {
  const ordered = sortBlocks(blocks);
  const { assigned, total, percent } = coverage(blocks, totalSlices);
  const canSelect = Boolean(onSelect) && !readOnly;

  return (
    <section
      aria-label="切片区块分工"
      className="border-border bg-background text-foreground flex w-full min-w-0 flex-col gap-3 rounded-lg border p-3"
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">切片区块分工</h3>
        <span
          className="text-muted-foreground shrink-0 text-sm"
          title={`已覆盖 ${percent}%`}
        >
          已分配 {assigned}/{total} 层
        </span>
      </header>

      <SliceRangeBar
        totalSlices={totalSlices}
        blocks={ordered}
        currentOwner={currentOwner}
        onSelect={canSelect ? onSelect : undefined}
      />

      {ordered.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-md border border-dashed px-2 py-3 text-center text-sm">
          暂无区块分配
        </p>
      ) : (
        <ul
          aria-label="区块列表"
          className="flex min-w-0 flex-col gap-1"
        >
          {ordered.map(block => {
            const unassigned = isUnassigned(block);
            const mine = isCurrentOwner(block, currentOwner);
            const range = formatRange(block.start, block.end);
            const owner = ownerLabel(block);

            return (
              <li
                key={block.id}
                aria-current={mine ? 'true' : undefined}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-sm',
                  mine ? 'border-primary/60 bg-primary/10' : 'border-border bg-muted/20'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-2.5 w-2.5 shrink-0 rounded-full',
                    unassigned && 'border-muted-foreground border border-dashed'
                  )}
                  style={unassigned ? undefined : { backgroundColor: blockColor(block) }}
                />

                <span className="shrink-0 tabular-nums">{range}</span>

                <span
                  className={cn('min-w-0 flex-1 truncate', unassigned && 'text-muted-foreground')}
                  title={owner}
                >
                  {owner}
                </span>

                {mine && (
                  <span className="bg-primary/20 text-xxs text-primary shrink-0 rounded px-1">
                    我
                  </span>
                )}

                <span
                  className={cn(
                    'text-xxs shrink-0 rounded-full border px-1.5 py-0.5',
                    STATUS_PILL_CLASSES[block.status]
                  )}
                >
                  {blockStatusLabel(block.status)}
                </span>

                {canSelect && (
                  <button
                    type="button"
                    className="border-border text-xxs text-foreground hover:bg-muted focus-visible:ring-primary shrink-0 rounded border px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2"
                    aria-label={`选择区块 ${range}`}
                    onClick={() => onSelect(block)}
                  >
                    选择
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-muted-foreground text-xs leading-relaxed">
        边界层由相邻 owner 复核；保存时只写自己区间，发布时保留其他区间
      </p>
    </section>
  );
}

export default BlockAssignmentPanel;
