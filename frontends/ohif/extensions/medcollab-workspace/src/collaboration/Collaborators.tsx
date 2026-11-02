import React, { useEffect, useRef, useState } from 'react';

import type { RealtimeMember } from './realtimeClient';

type CollaboratorRole = 'owner' | 'editor' | 'public' | 'leader' | 'uploader' | 'member';

type Collaborator = {
  username: string;
  role: CollaboratorRole;
  isSelf: boolean;
};

type ViewCollaborator = Collaborator & {
  online: boolean;
  activeLabel: string | null;
};

const avatarPalette = ['#146b5d', '#2a7f7a', '#3b6ea5', '#7a4e8c', '#b23a48', '#9a6a1e'];

const roleLabel: Record<CollaboratorRole, string> = {
  owner: '所有者',
  editor: '协作者',
  public: '公共访问',
  leader: '组长',
  uploader: '上传者',
  member: '组员',
};

function initials(name: string): string {
  const chars = Array.from((name || '?').trim());
  return chars.slice(0, 2).join('').toUpperCase();
}

function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return avatarPalette[hash % avatarPalette.length];
}

function formatActivityTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function statusText(state: any): string {
  switch (state.realtimeStatus) {
    case 'connected':
      return '实时协作已连接';
    case 'connecting':
      return '实时协作连接中…';
    case 'disconnected':
      return '实时协作重连中…';
    case 'error':
      return `实时协作未连接${state.realtimeError ? `：${state.realtimeError}` : ''}`;
    default:
      return '实时协作未开启（设置中可开启）';
  }
}

/**
 * Cloud-document-style collaborator cluster for the dataset workspace.
 *
 * The static list always shows who can access the dataset. When the realtime
 * WebSocket is enabled and connected, it also shows who is online, which label
 * they are editing, and recent activity. It never invents presence data.
 */
export function Collaborators({ workspace }) {
  const [, rerender] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => workspace.subscribe(() => rerender(value => value + 1)), [workspace]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const state = workspace.state;
  const collaborators: Collaborator[] = state.collaborators || [];
  const onlineMembers: RealtimeMember[] = state.onlineMembers || [];
  if (!state.ready || (!collaborators.length && !onlineMembers.length)) return null;

  const onlineByName = new Map(onlineMembers.map(member => [member.username, member]));
  const merged: Collaborator[] = [...collaborators];
  for (const member of onlineMembers) {
    if (!merged.some(collaborator => collaborator.username === member.username)) {
      merged.push({ username: member.username, role: member.role, isSelf: false });
    }
  }

  const view: ViewCollaborator[] = merged.map(collaborator => {
    const online = onlineByName.get(collaborator.username);
    return {
      ...collaborator,
      online: Boolean(online),
      activeLabel: online?.activeLabel || null,
    };
  });
  const onlineCount = view.filter(collaborator => collaborator.online).length;
  const connected = state.realtimeStatus === 'connected';
  const label = connected ? `${onlineCount} 人在线` : `${view.length} 位协作者`;
  const visible = view.slice(0, 4);
  const extra = view.length - visible.length;
  const activities = (state.activities || []).slice(0, 5);

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto fixed right-[19.5rem] top-14 z-50"
      data-cy="dataset-collaborators"
    >
      <button
        type="button"
        className="border-border bg-card/95 text-foreground hover:bg-muted flex items-center gap-2 rounded-full border px-2 py-1 text-xs shadow-md backdrop-blur"
        aria-expanded={open}
        aria-label={`${label}，查看名单`}
        title={statusText(state)}
        onClick={() => setOpen(value => !value)}
      >
        <span className="flex -space-x-2">
          {visible.map(collaborator => (
            <span
              key={collaborator.username}
              className={`border-background relative flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold text-white ${
                collaborator.isSelf ? 'ring-primary ring-2' : ''
              }`}
              style={{ backgroundColor: avatarColor(collaborator.username) }}
              title={`${collaborator.username} · ${roleLabel[collaborator.role]}${
                collaborator.online ? ' · 在线' : ''
              }${collaborator.activeLabel ? ` · ${collaborator.activeLabel}` : ''}${
                collaborator.isSelf ? '（你）' : ''
              }`}
            >
              {initials(collaborator.username)}
              {collaborator.online && (
                <span className="border-background bg-customgreen-100 absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border" />
              )}
            </span>
          ))}
          {extra > 0 && (
            <span className="border-background bg-muted text-muted-foreground flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold">
              +{extra}
            </span>
          )}
        </span>
        <span className="hidden sm:inline">{label}</span>
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${
            connected ? 'bg-customgreen-100' : 'bg-muted-foreground/40'
          }`}
        />
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="协作者名单"
          className="border-border bg-popover text-popover-foreground absolute right-0 top-full mt-2 w-80 rounded-lg border p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">可访问协作者</span>
            <span className="text-muted-foreground text-xxs">
              {view.length} 人{connected ? ` · ${onlineCount} 在线` : ''}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {view.map(collaborator => (
              <li
                key={collaborator.username}
                className="hover:bg-muted flex items-center gap-2 rounded-md px-1.5 py-1.5"
              >
                <span
                  className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: avatarColor(collaborator.username) }}
                >
                  {initials(collaborator.username)}
                  {collaborator.online && (
                    <span className="border-popover bg-customgreen-100 absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-xs">
                    {collaborator.username}
                    {collaborator.isSelf ? '（你）' : ''}
                  </span>
                  <span className="text-muted-foreground text-xxs block truncate">
                    {roleLabel[collaborator.role]}
                    {collaborator.online ? ' · 在线' : ''}
                    {collaborator.activeLabel ? ` · 正在标注 ${collaborator.activeLabel}` : ''}
                  </span>
                </span>
                {collaborator.isSelf && (
                  <span className="bg-primary/10 text-primary text-xxs rounded-full px-1.5 py-0.5">
                    我
                  </span>
                )}
              </li>
            ))}
          </ul>

          {activities.length > 0 && (
            <div className="border-border mt-2 border-t pt-2">
              <div className="text-foreground mb-1 text-xs font-medium">协作动态</div>
              <ul className="flex flex-col gap-1">
                {activities.map(activity => (
                  <li
                    key={activity.id}
                    className="text-muted-foreground text-xxs flex items-start gap-2"
                  >
                    <span className="bg-primary mt-1 h-1.5 w-1.5 shrink-0 rounded-full" />
                    <span className="min-w-0 flex-1 truncate">
                      {activity.username}：{activity.text}
                    </span>
                    <span className="shrink-0">{formatActivityTime(activity.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-muted-foreground border-border text-xxs mt-2 border-t pt-2 leading-relaxed">
            {statusText(state)}
            <br />
            静态名单来自数据集/团队成员；在线状态只来自实时连接，没有连接时不显示在线。
          </p>
        </div>
      )}
    </div>
  );
}

export default Collaborators;
