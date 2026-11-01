import React from 'react';
import { Badge, Button, cn } from '@ohif/ui-next';

import {
  BlockAssignmentPanel,
  normalizeBlocks,
  type BlockAssignment as SliceBlockAssignment,
} from '../../../medcollab-workspace/src/blocks';
import { DIVISION_MODE_LABEL, STATUS_META } from '../data/mockCases';
import type { DemoUser, DivisionMode, OpenCaseState, OpenIntent, WorkbenchCase } from '../types';

interface CaseDetailPanelProps {
  caseRecord: WorkbenchCase | null;
  focusedDivision: DivisionMode;
  currentUser: DemoUser;
  openState: OpenCaseState | null;
  onOpen: (intent: OpenIntent) => void;
}

function parseSliceRange(range: string): { start: number; end: number } | null {
  const match = /(\d+)\s*[–-]\s*(\d+)/.exec(range);
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1 && end >= start
    ? { start, end }
    : null;
}

function toSliceBlocks(caseRecord: WorkbenchCase): SliceBlockAssignment[] {
  const blocks = (caseRecord.blocks ?? []).flatMap((block, index) => {
    const range = parseSliceRange(block.sliceRange);
    if (!range) {
      return [];
    }
    const status: SliceBlockAssignment['status'] = block.note?.includes('冲突')
      ? 'review'
      : 'in_progress';
    return [
      {
        id: block.blockId || `block-${index}`,
        start: range.start,
        end: range.end,
        owner: block.ownerName,
        status,
      },
    ];
  });

  try {
    return normalizeBlocks(caseRecord.sliceCount, blocks);
  } catch {
    // Mock data must never take the workbench down; show the raw blocks.
    return blocks;
  }
}

function DetailField({
  label,
  value,
  mono = false,
  highlight = false,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground/70 text-xxs uppercase tracking-wide">{label}</div>
      <div
        title={title ?? value}
        className={cn(
          'text-foreground/90 min-w-0 break-all text-xs',
          mono && 'font-mono',
          highlight && 'text-primary'
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="border-border bg-background/40 min-w-0 rounded border px-2 py-1.5">
      <div className="text-muted-foreground/70 text-xxs">{label}</div>
      <div
        className={cn(
          'text-foreground min-w-0 truncate text-sm tabular-nums',
          highlight && 'text-primary'
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CaseDetailPanel({
  caseRecord,
  focusedDivision,
  currentUser,
  openState,
  onOpen,
}: CaseDetailPanelProps) {
  if (!caseRecord) {
    return (
      <aside className="border-border bg-card text-muted-foreground min-w-0 rounded border px-4 py-10 text-center text-sm">
        未选择演示病例；请从左侧列表选择一行。
      </aside>
    );
  }

  const status = STATUS_META[caseRecord.status];
  const sliceBlocks = toSliceBlocks(caseRecord);
  const hasSourceUID =
    Boolean(caseRecord.studyInstanceUID) && Boolean(caseRecord.seriesInstanceUID);
  const canOpen = Boolean(caseRecord.backendCaseId) || hasSourceUID;
  const activeOpenState = openState?.caseId === caseRecord.caseId ? openState : null;
  const openBlockedReason = !canOpen
    ? '该演示病例没有 Study/Series UID，也没有后端 case ID，无法打开影像。'
    : undefined;

  return (
    <aside
      className="border-border bg-card flex min-w-0 flex-col rounded border"
      aria-label="病例详情"
    >
      <div className="border-border border-b p-3">
        <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className="font-mono">{caseRecord.caseId}</span>
          <Badge
            variant="outline"
            className={status.className}
            title={status.description}
          >
            {status.label}
          </Badge>
          <Badge
            variant="outline"
            className="border-border text-muted-foreground px-1.5 py-0.5"
            title="病例使用的分工方式"
          >
            {DIVISION_MODE_LABEL[caseRecord.divisionMode]}
          </Badge>
        </div>
        <h2
          className="text-foreground mt-1 min-w-0 truncate text-lg"
          title={caseRecord.name}
        >
          {caseRecord.name}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">{caseRecord.description}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-3 p-3">
        <section
          className={cn(
            'border-border min-w-0 rounded border p-2',
            focusedDivision === 'series' ? 'border-primary/50 bg-primary/5' : 'bg-background/30'
          )}
          aria-label="来源影像"
        >
          <h3 className="text-foreground mb-2 text-xs font-medium">来源影像（演示）</h3>
          <div className="flex min-w-0 flex-col gap-2">
            <DetailField
              label="StudyInstanceUID"
              value={caseRecord.studyInstanceUID || '未配置（演示占位）'}
              mono
              highlight={focusedDivision === 'series' && Boolean(caseRecord.studyInstanceUID)}
            />
            <DetailField
              label="SeriesInstanceUID"
              value={caseRecord.seriesInstanceUID || '未配置（演示占位）'}
              mono
              highlight={focusedDivision === 'series' && Boolean(caseRecord.seriesInstanceUID)}
            />
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <Stat
                label="序列数"
                value={`${caseRecord.seriesCount}`}
              />
              <Stat
                label="切片数"
                value={`${caseRecord.sliceCount}`}
              />
              <Stat
                label="版本"
                value={caseRecord.version}
                highlight={focusedDivision === 'case'}
              />
              <Stat
                label="更新时间"
                value={caseRecord.updatedAt}
              />
            </div>
            {!hasSourceUID ? (
              <p className="text-highlight text-xs">
                未配置影像来源：演示占位病例，打开按钮保持禁用。
              </p>
            ) : null}
          </div>
        </section>

        <section
          className={cn(
            'border-border min-w-0 rounded border p-2',
            focusedDivision === 'case' ? 'border-primary/50 bg-primary/5' : 'bg-background/30'
          )}
          aria-label="状态与负责人"
        >
          <h3 className="text-foreground mb-2 text-xs font-medium">状态与负责人（演示）</h3>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <div className="min-w-0">
              <div className="text-muted-foreground/70 text-xxs">当前状态</div>
              <Badge
                variant="outline"
                className={cn('mt-0.5 px-1.5 py-0.5', status.className)}
              >
                {status.label}
              </Badge>
            </div>
            <DetailField
              label="负责人"
              value={caseRecord.owner.name}
              highlight={focusedDivision === 'case'}
            />
          </div>
        </section>

        <section
          className="border-border bg-background/30 min-w-0 rounded border p-2"
          aria-label="协作者"
        >
          <h3 className="text-foreground mb-2 text-xs font-medium">协作者（演示）</h3>
          <ul className="flex min-w-0 flex-col gap-1.5">
            <li className="flex min-w-0 flex-wrap items-center justify-between gap-1">
              <span className="text-foreground/90 min-w-0 truncate text-xs">
                {caseRecord.owner.name}
                <span className="text-muted-foreground">（负责人）</span>
              </span>
              <span className="text-muted-foreground text-xxs">所有者</span>
            </li>
            {caseRecord.collaborators.map(collaborator => (
              <li
                key={collaborator.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-1"
              >
                <span className="text-foreground/90 min-w-0 truncate text-xs">
                  {collaborator.name}
                  <span className="text-muted-foreground"> · {collaborator.role}</span>
                </span>
                <span className="text-muted-foreground text-xxs">{collaborator.access}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="border-border bg-background/30 min-w-0 rounded border p-2"
          aria-label="版本历史"
        >
          <h3 className="text-foreground mb-2 text-xs font-medium">版本历史（演示数据）</h3>
          <ol className="flex min-w-0 flex-col gap-2">
            {caseRecord.versions.map((version, index) => (
              <li
                key={`${version.version}-${version.author}-${index}`}
                className="border-border min-w-0 border-l pl-2"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <span className="text-primary bg-primary/15 text-xxs rounded px-1 font-mono">
                    {version.version}
                  </span>
                  <span className="text-foreground/90 text-xs">{version.author}</span>
                  <span className="text-muted-foreground text-xxs">{version.createdAt}</span>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">{version.note}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className={cn(
            'border-border min-w-0 rounded border p-2',
            focusedDivision === 'block' ? 'border-primary/50 bg-primary/5' : 'bg-background/30'
          )}
          aria-label="区块分工"
        >
          <h3 className="text-foreground mb-2 text-xs font-medium">区块分工（演示）</h3>
          <div
            data-medcollab-slot="block-panel"
            data-testid="block-panel-slot"
          >
            {sliceBlocks.length ? (
              <BlockAssignmentPanel
                totalSlices={caseRecord.sliceCount}
                blocks={sliceBlocks}
                currentOwner={currentUser.name}
                readOnly
              />
            ) : (
              <p className="text-muted-foreground text-xs">该演示病例未使用区块分工。</p>
            )}
          </div>
        </section>

        <section
          className="border-border bg-background/30 min-w-0 rounded border p-2"
          aria-label="操作"
        >
          <h3 className="text-foreground mb-2 text-xs font-medium">操作</h3>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="open-case-button"
              disabled={!canOpen}
              title={openBlockedReason ?? '打开标注（edit 意图）'}
              onClick={() => onOpen('edit')}
            >
              打开标注
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canOpen}
              title={openBlockedReason ?? '只读查看（review 意图）'}
              onClick={() => onOpen('review')}
            >
              只读查看
            </Button>
          </div>

          <p className="text-muted-foreground text-xxs mt-2">演示导航：未接后端，不代表保存成功</p>

          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled
              title="未接 Java 后端，保存不可用；不会伪造保存成功"
            >
              保存草稿（需后端）
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled
              title="未接 Java 后端，发布不可用；不会伪造发布成功"
            >
              发布（需后端）
            </Button>
          </div>

          {activeOpenState?.error ? (
            <div
              role="alert"
              data-testid="open-case-error"
              className="border-destructive/40 bg-destructive/10 text-destructive mt-2 min-w-0 rounded border px-2 py-1.5 text-xs"
            >
              <div className="font-medium">打开失败：{activeOpenState.error.code}</div>
              <div className="mt-0.5 break-all">{activeOpenState.error.message}</div>
            </div>
          ) : null}

          {activeOpenState?.note ? (
            <div
              role="status"
              className="border-highlight/40 bg-highlight/10 text-muted-foreground mt-2 min-w-0 rounded border px-2 py-1.5 text-xs"
            >
              {activeOpenState.note}
            </div>
          ) : null}

          <p className="text-muted-foreground/70 text-xxs mt-2">
            {caseRecord.backendCaseId
              ? `后端 caseId：${caseRecord.backendCaseId}`
              : '当前演示病例没有后端 caseId；打开操作只做 /medcollab 页面跳转。'}
          </p>
        </section>
      </div>
    </aside>
  );
}

export default CaseDetailPanel;
