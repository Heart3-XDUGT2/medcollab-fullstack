import React from 'react';
import { Badge, Button, Icons } from '@ohif/ui-next';

import type { DemoUser } from '../types';

interface WorkbenchHeaderProps {
  user: DemoUser;
  caseCount: number;
  lastRefreshed: string;
  refreshNote: string;
  onRefresh: () => void;
}

function WorkbenchHeader({
  user,
  caseCount,
  lastRefreshed,
  refreshNote,
  onRefresh,
}: WorkbenchHeaderProps) {
  return (
    <header className="border-border bg-card/60 border-b">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-foreground truncate text-2xl font-normal">MedCollab 协作工作台</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              病例、分工与版本预览 · 前端演示页（仅界面，无后端写入）
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-primary/40 bg-primary/10 text-primary gap-1.5 px-2 py-1"
              title="当前演示用户（mock 数据）"
            >
              <span className="bg-primary inline-block h-1.5 w-1.5 rounded-full" />
              {user.name} · {user.role}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              title="重新载入本地演示数据（不会请求后端）"
            >
              <Icons.Refresh className="mr-1 h-3.5 w-3.5" />
              刷新
            </Button>
          </div>
        </div>

        <div
          role="status"
          className="border-highlight/40 bg-highlight/10 text-foreground flex items-start gap-2 rounded border px-3 py-2 text-sm"
        >
          <span className="text-highlight mt-0.5 shrink-0 text-xs font-medium">演示</span>
          <span className="min-w-0">
            演示数据 · 尚未连接 Java 后端；打开影像只验证页面跳转，保存/发布需后端接通
          </span>
        </div>

        <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>演示病例 {caseCount} 例（全部为 fictional mock 数据）</span>
          <span aria-hidden>·</span>
          <span>最近刷新：{lastRefreshed}</span>
          {refreshNote ? (
            <>
              <span aria-hidden>·</span>
              <span className="text-highlight">{refreshNote}</span>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export default WorkbenchHeader;
