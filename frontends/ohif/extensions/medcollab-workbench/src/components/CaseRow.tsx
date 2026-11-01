import React from 'react';
import { Badge, cn } from '@ohif/ui-next';

import { DIVISION_MODE_LABEL, STATUS_META } from '../data/mockCases';
import type { DivisionMode, WorkbenchCase } from '../types';

interface CaseRowProps {
  caseRecord: WorkbenchCase;
  selected: boolean;
  focusedDivision: DivisionMode;
  onSelect: (caseId: string) => void;
}

const shortUserName = (name: string) => name.replace('演示用户 ', '');

function CaseRow({ caseRecord, selected, focusedDivision, onSelect }: CaseRowProps) {
  const status = STATUS_META[caseRecord.status];
  const isFocused = caseRecord.divisionMode === focusedDivision;
  const blockSummary = caseRecord.blocks
    ?.map(block => `${block.sliceRange}/${shortUserName(block.ownerName)}`)
    .join(' · ');
  const showBlocks =
    Boolean(blockSummary) && (focusedDivision === 'block' || caseRecord.divisionMode === 'block');

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`case-row-${caseRecord.caseId}`}
      aria-pressed={selected}
      onClick={() => onSelect(caseRecord.caseId)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(caseRecord.caseId);
        }
      }}
      className={cn(
        'bg-card w-full min-w-0 cursor-pointer rounded border p-3 text-left transition-colors',
        'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-1',
        selected
          ? 'border-primary/60 bg-primary/10'
          : 'border-border hover:border-primary/40 hover:bg-primary/5',
        !selected && isFocused && 'border-primary/30'
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            {caseRecord.caseId}
          </span>
          <span className="text-foreground min-w-0 truncate text-sm font-medium">
            {caseRecord.name}
          </span>
          {isFocused ? (
            <Badge
              variant="outline"
              className="border-primary/40 text-primary px-1.5 py-0.5"
              title="与当前选择的分工方式一致"
            >
              当前分工
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge
            variant="outline"
            className={status.className}
            title={status.description}
          >
            {status.label}
          </Badge>
          <span className="text-muted-foreground text-xs">查看详情 →</span>
        </div>
      </div>

      <dl className="text-muted-foreground mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 text-xs xl:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-muted-foreground/70">模态 / 序列</dt>
          <dd
            className={cn(
              'text-foreground/90 truncate',
              focusedDivision === 'series' && 'text-primary'
            )}
            title={`${caseRecord.modality} · ${caseRecord.seriesDescription}`}
          >
            {caseRecord.modality} · {caseRecord.seriesDescription}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground/70">负责人</dt>
          <dd
            className={cn(
              'text-foreground/90 truncate',
              focusedDivision === 'case' && 'text-primary'
            )}
          >
            {caseRecord.owner.name}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground/70">分工 / 版本</dt>
          <dd className="text-foreground/90 truncate">
            {DIVISION_MODE_LABEL[caseRecord.divisionMode]} · {caseRecord.version}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground/70">更新时间</dt>
          <dd className="text-foreground/90 truncate">{caseRecord.updatedAt}</dd>
        </div>
      </dl>

      {showBlocks ? (
        <div
          className={cn(
            'border-border text-muted-foreground mt-2 truncate border-t pt-2 text-xs',
            focusedDivision === 'block' && 'text-primary'
          )}
          title={blockSummary}
        >
          区块归属：{blockSummary}
          {caseRecord.status === 'conflict' ? (
            <span className="text-destructive ml-2">· 存在归属冲突</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default CaseRow;
