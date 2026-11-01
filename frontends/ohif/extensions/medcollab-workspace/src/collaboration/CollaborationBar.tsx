import React, { useCallback, useEffect, useState } from 'react';

import { Badge, Button, Icons } from '@ohif/ui-next';
import { DatasetBar } from './DatasetBar';

import type { DraftReceipt, EditState, WorkspaceEvent } from '../types';
import {
  BLOCK_RANGE_STORAGE_KEY,
  CONFLICT_BANNER_TEXT,
  DEMO_UNBOUND_TEXT,
  NO_LEASE_TEXT,
  PUBLISH_NOT_WIRED_TEXT,
  type BlockRange,
  formatBlockRange,
  formatLeaseRemaining,
  formatPersistedAt,
  formatRole,
  formatSaveState,
  formatWorkspaceError,
  isConflictCode,
  isMedCollabPath,
  readBlockRange,
  readLeaseExpiry,
  shortId,
  stateSignature,
} from './status';

/**
 * The subset of `AnnotationWorkspace` the bar relies on. Everything is optional
 * because the service may not exist (returns null) or an older adapter may be
 * missing `publishDraft` (surfaced as a `待接入` note, never as fake success).
 */
type WorkspaceLike = {
  getEditState?: () => EditState;
  subscribe?: (listener: (event: WorkspaceEvent) => void) => (() => void) | void;
  saveDraft?: () => Promise<DraftReceipt>;
  publishDraft?: () => Promise<unknown>;
  getLease?: () => { expiresAt?: string | number | Date | null } | null | undefined;
  getLeaseExpiry?: () => string | number | Date | null | undefined;
};

export type CollaborationBarProps = {
  servicesManager: AppTypes.ServicesManager;
  /** Optional override for embedded/tests usage; defaults to window.location.pathname. */
  pathname?: string;
};

const getWorkspace = (servicesManager: AppTypes.ServicesManager): WorkspaceLike | undefined => {
  const services = (servicesManager as unknown as { services?: Record<string, unknown> })?.services;
  const workspace = services?.annotationWorkspaceService;
  return workspace && (typeof workspace === 'object' || typeof workspace === 'function')
    ? (workspace as WorkspaceLike)
    : undefined;
};

const readState = (workspace?: WorkspaceLike): EditState | null => {
  if (typeof workspace?.getEditState !== 'function') {
    return null;
  }
  try {
    return workspace.getEditState();
  } catch {
    // A broken adapter should not take down the viewer header.
    return null;
  }
};

const readSessionBlockRange = (): BlockRange | null => {
  try {
    return typeof window === 'undefined' ? null : readBlockRange(window.sessionStorage);
  } catch {
    return null;
  }
};

const saveToneClassName: Record<string, string> = {
  dirty: 'bg-red-500',
  saving: 'bg-highlight',
  saved: 'bg-customgreen-100',
};

const errorText = (action: '保存' | '发布', error: unknown): string => {
  const info = formatWorkspaceError(error);
  const detail = info.message ? `${info.code} · ${info.message}` : info.code;
  return `${action}失败：${detail}`;
};

/**
 * Floating collaboration status bar for the MedCollab viewer.
 *
 * It renders adapter state only. When no case/session is bound it hides itself,
 * except on `/medcollab` where a slim demo state is shown. Save/publish actions
 * call the real adapter methods; success labels are driven by adapter events and
 * the resolved promise, never optimistically.
 */
export function CollaborationBar(props: CollaborationBarProps) {
  if (new URLSearchParams(window.location.search).has('datasetId')) {
    const workspace = (props.servicesManager.services as any).datasetWorkspaceService;
    return workspace ? <DatasetBar workspace={workspace} /> : null;
  }
  return <LegacyCollaborationBar {...props} />;
}

function LegacyCollaborationBar({ servicesManager, pathname }: CollaborationBarProps) {
  const workspace = getWorkspace(servicesManager);

  const [state, setState] = useState<EditState | null>(() => readState(workspace));
  const [lastReceipt, setLastReceipt] = useState<DraftReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ code: string; signature: string } | null>(null);
  const [blockRange, setBlockRange] = useState<BlockRange | null>(() => readSessionBlockRange());
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Subscribe to adapter events; `getEditState()` remains the source of truth.
  useEffect(() => {
    if (!workspace) {
      return;
    }

    const sync = () => {
      const next = readState(workspace);
      setState(previous => (stateSignature(previous) === stateSignature(next) ? previous : next));
      const nextBlockRange = readSessionBlockRange();
      setBlockRange(previous =>
        previous?.start === nextBlockRange?.start && previous?.end === nextBlockRange?.end
          ? previous
          : nextBlockRange
      );
    };

    const handleEvent = (event: WorkspaceEvent) => {
      if (event?.type === 'closed') {
        // `closed` is emitted just before the adapter clears its session, so
        // resync on the next microtask to pick up the empty state.
        setState(null);
        setLastReceipt(null);
        setError(null);
        setNotice(null);
        setConflict(null);
        queueMicrotask(sync);
        return;
      }

      sync();

      if (event.type === 'saveSucceeded') {
        setLastReceipt(event.receipt ?? null);
        setError(null);
        setNotice(null);
        setConflict(null);
      } else if (event.type === 'saveFailed') {
        const code = event.errorCode || 'SAVE_FAILED';
        setError(`保存失败：${code}`);
        if (isConflictCode(code)) {
          setConflict({ code, signature: stateSignature(event.state) });
        }
      } else if (event.type === 'leaseLost') {
        const code = event.errorCode || 'LEASE_EXPIRED';
        setConflict({ code, signature: stateSignature(event.state) });
      }
    };

    let unsubscribe: (() => void) | undefined;
    try {
      const result = workspace.subscribe?.(handleEvent);
      if (typeof result === 'function') {
        unsubscribe = result;
      }
    } catch {
      // Subscription failures must not break the viewer.
    }

    sync();

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // Ignore unsubscribe failures during unmount.
      }
    };
  }, [workspace]);

  // Lease countdown only needs a timer when the adapter actually exposes an expiry.
  const leaseExpiry = readLeaseExpiry(state, workspace);
  useEffect(() => {
    if (leaseExpiry === null) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [leaseExpiry]);

  // Clear transient messages only when the session/state actually changes;
  // an active conflict banner stays until editing is restored or the case changes.
  useEffect(() => {
    setError(null);
    setNotice(null);
    setLastReceipt(null);
  }, [state?.sessionId]);

  useEffect(() => {
    if (!conflict) {
      return;
    }
    // The banner is not manually dismissible: it clears only when the adapter
    // state changes (new session, recovery of edit rights, new save attempt).
    if (stateSignature(state) !== conflict.signature) {
      setConflict(null);
    }
  }, [conflict, state]);

  const onSave = useCallback(async () => {
    const saveDraft = workspace?.saveDraft;
    if (typeof saveDraft !== 'function') {
      setError('保存失败：SAVE_NOT_AVAILABLE');
      return;
    }
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const receipt = await saveDraft.call(workspace);
      // Only reflect success after the adapter's promise resolves.
      if (receipt) {
        setLastReceipt(receipt);
      }
      setConflict(null);
    } catch (caught) {
      const info = formatWorkspaceError(caught);
      setError(errorText('保存', caught));
      if (info.conflict) {
        setConflict({ code: info.code, signature: stateSignature(readState(workspace)) });
      }
    } finally {
      setBusy(null);
      setState(readState(workspace));
    }
  }, [workspace]);

  const onPublish = useCallback(async () => {
    const publishDraft = workspace?.publishDraft;
    if (typeof publishDraft !== 'function') {
      // The current adapter has no publish method and the Java publish API is
      // not wired yet: say so instead of pretending to publish.
      setError(null);
      setNotice(PUBLISH_NOT_WIRED_TEXT);
      return;
    }
    setBusy('publish');
    setError(null);
    setNotice(null);
    try {
      await publishDraft.call(workspace);
      // No success text: version/lease state is owned by the adapter and events.
    } catch (caught) {
      const info = formatWorkspaceError(caught);
      setError(errorText('发布', caught));
      if (info.conflict) {
        setConflict({ code: info.code, signature: stateSignature(readState(workspace)) });
      }
    } finally {
      setBusy(null);
      setState(readState(workspace));
    }
  }, [workspace]);

  if (!workspace) {
    return null;
  }

  const currentPath = pathname ?? (typeof window === 'undefined' ? '' : window.location.pathname);
  const hasSession = Boolean(state?.caseId && state?.sessionId);

  if (!hasSession) {
    // `/medcollab` may be opened before a case is bound (demo/no-backend mode).
    if (!isMedCollabPath(currentPath)) {
      return null;
    }
    return (
      <div
        role="status"
        aria-live="polite"
        className="border-border bg-background/95 text-foreground pointer-events-auto fixed bottom-3 left-1/2 z-50 flex w-max max-w-[min(96vw,60rem)] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-xl backdrop-blur"
        data-cy="medcollab-collaboration-bar-demo"
      >
        <span
          className="bg-highlight h-2 w-2 shrink-0 rounded-full"
          aria-hidden="true"
        />
        <span>{DEMO_UNBOUND_TEXT}</span>
      </div>
    );
  }

  const role = formatRole(state);
  const saveStatus = formatSaveState(state);
  const persistedAt =
    lastReceipt?.persistedAt ??
    (state as (EditState & { persistedAt?: unknown }) | null)?.persistedAt;
  const persistedLabel = formatPersistedAt(persistedAt, now);
  const leaseLabel =
    state.leaseValid && leaseExpiry !== null
      ? (formatLeaseRemaining(leaseExpiry, now) ?? NO_LEASE_TEXT)
      : NO_LEASE_TEXT;
  const blockLabel = formatBlockRange(blockRange);
  const derivedConflict =
    state.ready && state.intent === 'edit' && state.readOnly && state.sessionId
      ? { code: 'LEASE_EXPIRED', signature: stateSignature(state) }
      : null;
  const activeConflict = conflict ?? derivedConflict;
  const actionsDisabled = Boolean(busy) || Boolean(state.saving) || state.readOnly || !state.ready;
  const saveTitle = state.readOnly
    ? '当前为只读会话，无法保存'
    : '保存当前草稿（调用适配器 saveDraft）';
  const publishTitle =
    typeof workspace.publishDraft === 'function'
      ? '发布当前草稿'
      : '发布接口待接入 Java publish，当前仅界面';

  return (
    <div
      role="region"
      aria-label="协作状态"
      className="border-border bg-background/95 text-foreground pointer-events-auto fixed bottom-3 left-1/2 z-50 flex w-max max-w-[min(96vw,60rem)] -translate-x-1/2 flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs shadow-xl backdrop-blur"
      data-cy="medcollab-collaboration-bar"
    >
      {activeConflict && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded border border-red-500/60 bg-red-900/80 px-2 py-1 text-[11px] text-red-200"
        >
          <Icons.AlertOutline className="h-3.5 w-3.5 shrink-0 text-red-300" />
          <span>{CONFLICT_BANNER_TEXT}</span>
          {activeConflict.code && (
            <span className="text-red-300/80">（{activeConflict.code}）</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex max-w-[14rem] items-center gap-1">
          <span className="text-muted-foreground">病例</span>
          <span
            className="truncate font-medium"
            title={state.caseId ?? ''}
          >
            {shortId(state.caseId, 16) || '—'}
          </span>
        </span>

        <span
          className="text-muted-foreground inline-flex items-center gap-1"
          title={state.sessionId ?? ''}
        >
          会话
          <span className="text-foreground">{shortId(state.sessionId, 8) || '—'}</span>
        </span>

        <Badge
          variant={role === '编辑' ? 'default' : 'secondary'}
          className={
            role === '编辑'
              ? 'border-customgreen-100/40 bg-customgreen-100/20 text-customgreen-100'
              : 'border-border bg-muted text-muted-foreground'
          }
          aria-label={`当前角色：${role}`}
          title={`当前角色：${role}`}
        >
          {role}
        </Badge>

        <span
          className="inline-flex items-center gap-1.5"
          aria-live="polite"
          title={saveStatus.tone === 'saved' ? '当前没有未保存的更改' : saveStatus.label}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${saveToneClassName[saveStatus.tone]}`}
            aria-hidden="true"
          />
          <span>{saveStatus.label}</span>
          {persistedLabel && (
            <span className="text-muted-foreground">· 最近保存 {persistedLabel}</span>
          )}
        </span>

        {state.versionId && (
          <span
            className="text-muted-foreground inline-flex items-center gap-1"
            title={state.versionId}
          >
            版本
            <span className="text-foreground">{shortId(state.versionId, 10)}</span>
          </span>
        )}

        <span
          className="text-muted-foreground inline-flex items-center gap-1"
          title="编辑租约"
        >
          {leaseLabel}
        </span>

        <Badge
          variant="outline"
          className="border-border text-foreground"
          title={`sessionStorage.${BLOCK_RANGE_STORAGE_KEY}`}
          aria-label={blockLabel}
        >
          {blockLabel}
        </Badge>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="border-border bg-muted text-foreground hover:bg-muted h-6 px-2 text-[11px] hover:text-white"
            onClick={onSave}
            disabled={actionsDisabled}
            aria-label="保存草稿"
            title={saveTitle}
            data-cy="medcollab-save-draft"
          >
            <Icons.Clipboard className="mr-1 h-3 w-3" />
            保存草稿
          </Button>
          <Button
            variant="default"
            size="sm"
            className="bg-actions-primary hover:bg-actions-highlight h-6 px-2 text-[11px] text-white"
            onClick={onPublish}
            disabled={actionsDisabled}
            aria-label="发布"
            title={publishTitle}
            data-cy="medcollab-publish"
          >
            <Icons.Upload className="mr-1 h-3 w-3" />
            发布
          </Button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="max-w-full break-words text-[11px] text-red-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="text-highlight max-w-full break-words text-[11px]"
        >
          {notice}
        </p>
      )}
    </div>
  );
}

export default CollaborationBar;
