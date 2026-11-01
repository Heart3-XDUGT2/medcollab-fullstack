import React from 'react';
import { Badge, cn } from '@ohif/ui-next';

import type { BlockAssignment } from './types';
import { formatRange } from './range';
import { blockStatusLabel, isCurrentOwner, isUnassigned } from './presentation';

export type BlockBadgeProps = {
  block?: BlockAssignment;
  currentOwner?: string;
};

/**
 * Compact badge for a single block: `我的区块 1–40` for the current owner,
 * `区块 1–40 · B` for someone else, `区块未分配` for gaps/placeholders.
 */
export function BlockBadge({ block, currentOwner }: BlockBadgeProps) {
  if (!block || isUnassigned(block)) {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground max-w-full border-dashed"
        title="当前切片没有负责人"
      >
        区块未分配
      </Badge>
    );
  }

  const mine = isCurrentOwner(block, currentOwner);
  const range = formatRange(block.start, block.end);
  const label = mine ? `我的区块 ${range}` : `区块 ${range} · ${block.owner}`;
  const status = blockStatusLabel(block.status);

  return (
    <Badge
      variant={mine ? 'default' : 'secondary'}
      className={cn('max-w-full truncate', mine && 'ring-primary/60 ring-1')}
      title={`${label}（${status}）`}
      aria-label={`${label}，状态${status}`}
    >
      {label}
    </Badge>
  );
}

export default BlockBadge;
