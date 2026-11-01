import React, { useEffect, useRef, useState } from 'react';

type Collaborator = {
  username: string;
  role: 'owner' | 'editor' | 'public';
  isSelf: boolean;
};

const avatarPalette = ['#146b5d', '#2a7f7a', '#3b6ea5', '#7a4e8c', '#b23a48', '#9a6a1e'];

const roleLabel: Record<Collaborator['role'], string> = {
  owner: '所有者',
  editor: '协作者',
  public: '公共访问',
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

/**
 * Cloud-document-style collaborator cluster for the dataset workspace.
 *
 * It only shows accounts that can access this dataset (owner + explicit shares).
 * There is no presence/WebSocket API yet, so it must not claim “online” status.
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
  if (!state.ready || !collaborators.length) return null;

  const visible = collaborators.slice(0, 4);
  const extra = collaborators.length - visible.length;
  const label = `${collaborators.length} 位协作者`;

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
        title="查看可访问此影像集的协作者"
        onClick={() => setOpen(value => !value)}
      >
        <span className="flex -space-x-2">
          {visible.map(collaborator => (
            <span
              key={collaborator.username}
              className={`border-background flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold text-white ${
                collaborator.isSelf ? 'ring-primary ring-2' : ''
              }`}
              style={{ backgroundColor: avatarColor(collaborator.username) }}
              title={`${collaborator.username} · ${roleLabel[collaborator.role]}${collaborator.isSelf ? '（你）' : ''}`}
            >
              {initials(collaborator.username)}
            </span>
          ))}
          {extra > 0 && (
            <span className="border-background bg-muted text-muted-foreground flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold">
              +{extra}
            </span>
          )}
        </span>
        <span className="hidden sm:inline">{label}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="协作者名单"
          className="border-border bg-popover text-popover-foreground absolute right-0 top-full mt-2 w-72 rounded-lg border p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">可访问协作者</span>
            <span className="text-muted-foreground text-xxs">{collaborators.length} 人</span>
          </div>
          <ul className="flex flex-col gap-1">
            {collaborators.map(collaborator => (
              <li
                key={collaborator.username}
                className="hover:bg-muted flex items-center gap-2 rounded-md px-1.5 py-1.5"
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: avatarColor(collaborator.username) }}
                >
                  {initials(collaborator.username)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-xs">
                    {collaborator.username}
                    {collaborator.isSelf ? '（你）' : ''}
                  </span>
                  <span className="text-muted-foreground text-xxs block">
                    {roleLabel[collaborator.role]}
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
          <p className="text-muted-foreground border-border text-xxs mt-2 border-t pt-2 leading-relaxed">
            显示有权限进入该影像集的账号；当前没有实时在线/光标状态，不是“正在编辑”提示。
          </p>
        </div>
      )}
    </div>
  );
}

export default Collaborators;
