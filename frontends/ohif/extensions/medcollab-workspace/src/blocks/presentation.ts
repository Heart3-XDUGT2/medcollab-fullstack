import type { BlockAssignment, BlockStatus, DivisionMode } from './types';
import { formatRange, UNASSIGNED_OWNER } from './range';

/**
 * Small deterministic palette for owner colors. Kept dark enough for white
 * segment text and stable across renders so the same owner always maps to the
 * same color.
 */
export const OWNER_PALETTE = [
  '#3B6EA5',
  '#2F7D5B',
  '#7A4E8C',
  '#B23A48',
  '#2A7F7A',
  '#9A6A1E',
  '#8C4A2F',
  '#4A5568',
] as const;

export const BLOCK_STATUS_LABELS: Record<BlockStatus, string> = {
  unassigned: '未分配',
  in_progress: '标注中',
  done: '已完成',
  review: '待复核',
};

export const DIVISION_MODE_LABELS: Record<DivisionMode, string> = {
  case: '按病例',
  series: '按序列',
  block: '按切片区块',
  organ: '按器官',
};

export function blockStatusLabel(status: BlockStatus): string {
  return BLOCK_STATUS_LABELS[status] ?? BLOCK_STATUS_LABELS.unassigned;
}

function hashOwner(owner: string): number {
  let hash = 0;

  for (let i = 0; i < owner.length; i++) {
    hash = (hash * 31 + owner.charCodeAt(i)) >>> 0;
  }

  return hash;
}

/** Deterministic owner color: same owner name always yields the same color. */
export function ownerColor(owner: string): string {
  const key = (owner ?? '').trim();

  if (!key) {
    return OWNER_PALETTE[0];
  }

  return OWNER_PALETTE[hashOwner(key) % OWNER_PALETTE.length];
}

/** `block.color` when provided, otherwise the deterministic owner color. */
export function blockColor(block: BlockAssignment): string {
  const custom = (block.color ?? '').trim();

  return custom || ownerColor(block.owner);
}

export function isUnassigned(block: BlockAssignment): boolean {
  return block.status === 'unassigned' || !block.owner || block.owner === UNASSIGNED_OWNER;
}

export function isCurrentOwner(block: BlockAssignment, currentOwner?: string): boolean {
  return Boolean(currentOwner) && block.owner === currentOwner && !isUnassigned(block);
}

/** Owner name to render in rows/legends, collapsing placeholders to `未分配`. */
export function ownerLabel(block: BlockAssignment): string {
  return isUnassigned(block) ? UNASSIGNED_OWNER : block.owner;
}

/** `区块 1–40，负责人 A，状态标注中` */
export function blockAriaLabel(block: BlockAssignment): string {
  return `区块 ${formatRange(block.start, block.end)}，负责人 ${ownerLabel(block)}，状态${blockStatusLabel(block.status)}`;
}
