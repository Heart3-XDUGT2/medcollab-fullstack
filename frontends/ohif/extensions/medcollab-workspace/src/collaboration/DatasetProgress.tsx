import React, { useEffect, useState } from 'react';

function percentText(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100) / 100}%`;
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safe}
    >
      <div
        className="bg-primary h-full rounded-full transition-[width]"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

/**
 * Server-authoritative coverage for the current CT series.
 *
 * The backend counts slices with at least one non-zero mask pixel from accepted
 * collaboration operations. Unsynced IndexedDB edits are deliberately excluded.
 */
export function DatasetProgress({ workspace }) {
  const [, rerender] = useState(0);
  useEffect(() => workspace.subscribe(() => rerender(value => value + 1)), [workspace]);

  const state = workspace.state;
  const stats = state.stats;
  if (!state.ready) return null;

  return (
    <section
      data-cy="dataset-progress"
      aria-label="标注进度"
      className="border-border bg-background/40 flex min-w-0 flex-col gap-2 rounded-md border px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-foreground text-xs font-medium">标注进度</span>
        <span className="text-muted-foreground text-xxs">
          服务器已接受操作 · 不含本机未同步草稿
        </span>
      </div>

      {!stats ? (
        <p
          className="text-muted-foreground text-xs"
          role="status"
        >
          {state.statsLoading ? '进度读取中…' : state.statsError || '进度暂不可用'}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="text-foreground text-xs">
              {stats.progress.annotatedSlices}/{stats.progress.totalSlices} 切片{' '}
              <span className="text-primary ml-1 font-medium">
                {percentText(stats.progress.percent)}
              </span>
            </span>
            {stats.pendingArchive && (
              <span className="bg-highlight/15 text-highlight text-xxs rounded-full px-1.5 py-0.5">
                待归档
              </span>
            )}
          </div>
          <ProgressBar
            value={stats.progress.percent}
            label="当前标注进度"
          />
          <div className="text-muted-foreground text-xxs flex min-w-0 flex-wrap items-center justify-between gap-1">
            <span>
              已归档 {stats.publishedProgress.annotatedSlices}/{stats.publishedProgress.totalSlices}{' '}
              · {percentText(stats.publishedProgress.percent)}
            </span>
            <span>
              序列 {stats.seq} / 归档 {stats.throughSeq} · 版本 {stats.publishedVersion}
            </span>
          </div>
          <ProgressBar
            value={stats.publishedProgress.percent}
            label="已归档进度"
          />
          {state.statsError && (
            <p
              className="text-destructive text-xxs"
              role="alert"
            >
              {state.statsError}
            </p>
          )}
          {stats.archiveError && (
            <p
              className="text-destructive text-xxs"
              role="alert"
            >
              归档：{stats.archiveError}
            </p>
          )}
          {state.statsUpdatedAt && (
            <p className="text-muted-foreground/70 text-xxs">
              更新于 {new Date(state.statsUpdatedAt).toLocaleTimeString('zh-CN')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default DatasetProgress;
