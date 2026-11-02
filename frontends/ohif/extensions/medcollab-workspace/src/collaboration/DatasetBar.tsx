import React, { useEffect, useId, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { isRealtimeEnabled, setRealtimeEnabled } from './realtimeClient';

const expansionPreference = 'medcollab:dataset-bar:expanded';

export function DatasetBar({ workspace }) {
  const [, render] = useState(0);
  const [expanded, setExpanded] = useState(() => {
    try {
      return window.localStorage.getItem(expansionPreference) === 'true';
    } catch {
      return false;
    }
  });
  const detailsId = useId();
  useEffect(() => workspace.subscribe(() => render(n => n + 1)), [workspace]);
  useEffect(() => {
    try {
      window.localStorage.setItem(expansionPreference, String(expanded));
    } catch {
      // The panel can still be toggled when browser storage is unavailable.
    }
  }, [expanded]);
  const state = workspace.state;
  const run = action =>
    Promise.resolve()
      .then(action)
      .catch(error => {
        workspace.state.error = error.message;
        render(n => n + 1);
      });
  return (
    <div
      role="region"
      aria-label="影像保存与同步"
      data-cy="dataset-workspace-bar"
      onKeyDown={event => event.stopPropagation()}
      onKeyUp={event => event.stopPropagation()}
      onKeyPress={event => event.stopPropagation()}
      className="border-border bg-card/95 text-foreground fixed bottom-3 left-1/2 z-50 flex max-w-[96vw] -translate-x-1/2 flex-col gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">保存与同步</span>
        {!isRealtimeEnabled() && (
          <Button
            size="sm"
            variant="outline"
            data-cy="dataset-enable-realtime"
            disabled={!state.ready || state.busy}
            onClick={() => setRealtimeEnabled(true)}
          >
            开启实时协作
          </Button>
        )}
        <span>共享版本：{state.version}</span>
        {state.collaborationReady && (
          <span>
            {state.sliceEditing ? `按切片自动获取编辑权${state.sliceLeaseCount ? ` · 已占用 ${state.sliceLeaseCount} 张` : ''}` : state.canEdit
              ? '你正在编辑'
              : state.editingBy
                ? `${state.editingBy} 正在编辑`
                : '实时观看'}
          </span>
        )}
        <span aria-live="polite">
          {!state.ready
            ? '尚未就绪'
            : state.busy
              ? '处理中…'
              : state.collaborationReady
                ? state.collabConflict
                  ? '本机草稿待处理'
                  : state.pendingOps || state.dirty
                    ? '本机修改待同步'
                    : `已存服务器 · ${state.operationSeq}`
                : state.dirty
                  ? '草稿保存中…'
                  : state.local
                    ? '本机草稿（未发布）'
                    : '已同步'}
        </span>
        {!expanded && state.newerVersion > 0 && <span>有共享更新</span>}
        {!expanded && state.error && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            data-cy="dataset-error-details"
            onClick={() => setExpanded(true)}
          >
            有错误 · 展开查看
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          aria-expanded={expanded}
          aria-controls={detailsId}
          data-cy="dataset-toggle-details"
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? '收起 ▾' : '展开 ▴'}
        </Button>
      </div>
      <div
        id={detailsId}
        hidden={!expanded}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <a href="/home">返回首页</a>
            <span>用户：{state.username || '读取中'}</span>
            {state.collaborationReady && (
              <>
                {!state.sliceEditing && <Button
                  size="sm"
                  variant="outline"
                  disabled={state.canEdit || state.collabConflict}
                  data-cy="dataset-acquire-edit"
                  onClick={() => run(() => workspace.acquireEdit())}
                >
                  申请编辑
                </Button>}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={state.sliceEditing ? !state.sliceLeaseCount : !state.canEdit}
                  data-cy="dataset-release-edit"
                  onClick={() => run(() => workspace.releaseEdit())}
                >
                  {state.sliceEditing ? '释放占用的切片' : '释放编辑权'}
                </Button>
                <span>已归档到操作 {state.archivedThrough}</span>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!state.ready || state.busy || (state.collaborationReady && !state.canEdit)}
              data-cy="dataset-save-draft"
              onClick={() => run(() => workspace.saveDraft())}
            >
              保存本机草稿
            </Button>
            <Button
              size="sm"
              disabled={!state.ready || state.busy}
              data-cy="dataset-publish"
              onClick={() => run(() => workspace.publish())}
            >
              {state.collaborationReady ? '立即生成归档版本' : '保存并发布 / 重试发布'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!state.ready || state.busy}
              data-cy="dataset-export"
              onClick={() => run(() => workspace.exportFile())}
            >
              导出 Labelmap SEG
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!state.ready || state.busy}
              data-cy="dataset-load-latest"
              onClick={() => run(() => workspace.loadLatest())}
            >
              加载共享版本
            </Button>
          </div>
          <p role="status">
            {state.message}
            {state.savedAt ? ` · 本机保存 ${new Date(state.savedAt).toLocaleTimeString()}` : ''}
            {state.newerVersion
              ? ` · 共享版本 ${state.newerVersion} 已更新，请先保留草稿再加载`
              : ''}
          </p>
          <p className="text-muted-foreground">
            {state.collaborationReady
              ? '掩码修改自动存入服务器并同步；SEG 在后台归档。测量和箭头暂不保存。'
              : '草稿仅在当前浏览器；发布后共享。当前保存掩码标签，测量和箭头暂不保存。'}
          </p>
          {state.error && (
            <p
              role="alert"
              className="text-destructive break-words"
            >
              {state.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
