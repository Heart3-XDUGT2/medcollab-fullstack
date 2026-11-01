import React from 'react';
import { cn } from '@ohif/ui-next';

import type { BlockAssignment } from './types';
import { formatRange, UNASSIGNED_OWNER } from './range';
import { blockAriaLabel, blockColor, isCurrentOwner, isUnassigned } from './presentation';

export type SliceRangeBarProps = {
  totalSlices: number;
  blocks: BlockAssignment[];
  currentOwner?: string;
  /** Height of the bar in pixels. Defaults to 28. */
  height?: number;
  onSelect?: (block: BlockAssignment) => void;
};

type LegendGroup = {
  key: string;
  owner: string;
  color?: string;
  ranges: string[];
  unassigned: boolean;
};

/** Labels are only rendered when a segment is wide enough to fit them. */
const MIN_LABEL_WIDTH_PERCENT = 14;

function sortBlocks(blocks: readonly BlockAssignment[]): BlockAssignment[] {
  return [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
}

function buildLegend(blocks: readonly BlockAssignment[]): LegendGroup[] {
  const groups: LegendGroup[] = [];
  const byKey = new Map<string, LegendGroup>();

  blocks.forEach(block => {
    const unassigned = isUnassigned(block);
    const key = unassigned ? 'unassigned' : `owner:${block.owner}`;
    let group = byKey.get(key);

    if (!group) {
      group = {
        key,
        owner: unassigned ? UNASSIGNED_OWNER : block.owner,
        color: unassigned ? undefined : blockColor(block),
        ranges: [],
        unassigned,
      };
      byKey.set(key, group);
      groups.push(group);
    }

    group.ranges.push(formatRange(block.start, block.end));
  });

  return groups;
}

/**
 * Horizontal slice-range bar: one segment per block, width proportional to the
 * number of slices it covers. Gaps that are not covered by any block stay
 * visible as the muted track, so unnormalized input is still honest.
 */
export function SliceRangeBar({
  totalSlices,
  blocks,
  currentOwner,
  height = 28,
  onSelect,
}: SliceRangeBarProps) {
  const safeTotal = Number.isFinite(totalSlices) && totalSlices > 0 ? Math.floor(totalSlices) : 0;
  const barHeight = Math.max(16, height);

  if (safeTotal === 0) {
    return (
      <div
        className="border-border bg-muted/20 text-muted-foreground flex w-full min-w-0 items-center justify-center rounded-md border border-dashed px-2 text-xs"
        style={{ height: barHeight }}
      >
        暂无可分配的切片
      </div>
    );
  }

  const ordered = sortBlocks(blocks);
  const legend = buildLegend(ordered);

  return (
    <div className="w-full min-w-0">
      <div
        role="list"
        aria-label={`切片区块分工，共 ${safeTotal} 层`}
        className="border-border bg-muted/20 flex w-full overflow-hidden rounded-md border"
        style={{ height: barHeight }}
      >
        {ordered.length === 0 && (
          <div
            role="listitem"
            aria-label="全部未分配"
            className="text-muted-foreground flex h-full w-full items-center justify-center text-xs"
          >
            全部未分配
          </div>
        )}

        {ordered.map(block => {
          const start = Math.max(1, block.start);
          const end = Math.min(safeTotal, block.end);
          const sliceCount = Math.max(0, end - start + 1);
          const widthPercent = (sliceCount / safeTotal) * 100;
          const showLabel = widthPercent >= MIN_LABEL_WIDTH_PERCENT;
          const unassigned = isUnassigned(block);
          const mine = isCurrentOwner(block, currentOwner);
          const ariaLabel = blockAriaLabel(block);
          const tooltip = onSelect ? `${ariaLabel}，点击选择` : ariaLabel;

          const segmentClassName = cn(
            'flex h-full w-full min-w-0 items-center justify-center overflow-hidden px-1 text-xxs font-medium leading-none transition-colors',
            unassigned
              ? 'border border-dashed border-border bg-muted/30 text-muted-foreground'
              : 'text-white',
            mine && 'font-semibold ring-2 ring-inset ring-highlight',
            onSelect &&
              'cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-highlight'
          );

          const segmentStyle = unassigned ? undefined : { backgroundColor: blockColor(block) };

          const content = showLabel ? (
            <span className="truncate">{formatRange(block.start, block.end)}</span>
          ) : null;

          return (
            <div
              key={block.id}
              role="listitem"
              title={tooltip}
              className="relative min-w-0"
              style={{ flexBasis: `${widthPercent}%`, flexGrow: 0, flexShrink: 0 }}
              {...(onSelect ? {} : { 'aria-label': ariaLabel })}
            >
              {onSelect ? (
                <button
                  type="button"
                  className={segmentClassName}
                  style={segmentStyle}
                  aria-label={ariaLabel}
                  onClick={() => onSelect(block)}
                >
                  {content}
                </button>
              ) : (
                <div
                  className={segmentClassName}
                  style={segmentStyle}
                >
                  {content}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {legend.length > 0 && (
        <ul
          aria-label="区块图例"
          className="text-muted-foreground mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        >
          {legend.map(group => (
            <li
              key={group.key}
              className="flex min-w-0 items-center gap-1"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  group.unassigned && 'border-muted-foreground border border-dashed'
                )}
                style={group.color ? { backgroundColor: group.color } : undefined}
              />
              <span className="shrink-0">{group.owner}</span>
              <span className="text-foreground/80 truncate">{group.ranges.join('、')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SliceRangeBar;
