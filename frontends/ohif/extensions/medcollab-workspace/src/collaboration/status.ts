import type { EditState } from '../types';

/**
 * Pure formatting/parsing helpers for the collaboration status bar.
 *
 * This file deliberately has no React (or @ohif/*) imports so it can run under
 * the extension's node Jest environment. See `status.test.ts`.
 */

export type SaveStatusTone = 'dirty' | 'saving' | 'saved';

export type SaveStatus = {
  label: '未保存' | '保存中…' | '已保存';
  tone: SaveStatusTone;
};

export type BlockRange = {
  start: number;
  end: number;
};

export type WorkspaceErrorInfo = {
  code: string;
  message: string;
  conflict: boolean;
};

/** sessionStorage key populated by the workbench / assignment UI. */
export const BLOCK_RANGE_STORAGE_KEY = 'medcollab.blockRange';

export const CONFLICT_BANNER_TEXT = '编辑权已失效/版本冲突，保留本地内容';

export const PUBLISH_NOT_WIRED_TEXT = '发布接口待接入 Java publish，当前仅界面';

export const DEMO_UNBOUND_TEXT = '未绑定协作病例 · 演示模式';

export const NO_LEASE_TEXT = '无租约';

const CONFLICT_CODES = new Set([
  'LEASE_EXPIRED',
  'LEASE_LOST',
  'CASE_BUSY',
  'CASE_FORBIDDEN',
  'REVISION_MISMATCH',
  'VERSION_MISMATCH',
  'VERSION_CONFLICT',
  'CONFLICT',
  'PUBLISH_CONFLICT',
]);

const pad2 = (value: number) => String(value).padStart(2, '0');

const toTimestamp = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const time = Date.parse(value.trim());
    return Number.isFinite(time) ? time : null;
  }
  return null;
};

/** Shorten an identifier for display; the full value stays available as a title. */
export function shortId(value: unknown, maxLength = 8): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return '';
  }
  const limit = Math.max(1, Math.floor(maxLength));
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function formatRole(
  state: Pick<EditState, 'intent' | 'readOnly'> | null | undefined
): '编辑' | '只读' {
  return state?.intent === 'edit' && !state.readOnly ? '编辑' : '只读';
}

/**
 * Maps adapter state to the three save labels. `saving` wins over `dirty`
 * because the adapter keeps the draft dirty until the receipt is committed.
 */
export function formatSaveState(
  state: Pick<EditState, 'dirty' | 'saving'> | null | undefined
): SaveStatus {
  if (state?.saving) {
    return { label: '保存中…', tone: 'saving' };
  }
  if (state?.dirty) {
    return { label: '未保存', tone: 'dirty' };
  }
  return { label: '已保存', tone: 'saved' };
}

/**
 * Formats the remaining lease time as `租约剩余 mm:ss` (or `h:mm:ss`).
 * Returns null when no usable expiry is available and `租约已到期` when it is past.
 */
export function formatLeaseRemaining(
  expiresAt: string | number | Date | null | undefined,
  now = Date.now()
): string | null {
  const time = toTimestamp(expiresAt);
  if (time === null) {
    return null;
  }
  const remainingMs = time - now;
  if (remainingMs <= 0) {
    return '租约已到期';
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const clock =
    hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
  return `租约剩余 ${clock}`;
}

type LeaseSource = {
  getLease?: () => { expiresAt?: string | number | Date | null } | null | undefined;
  getLeaseExpiry?: () => string | number | Date | null | undefined;
};

/**
 * Best-effort read of a lease expiry. The current adapter's `EditState` does not
 * expose one, so this returns null and the bar shows `无租约`; if the adapter
 * later adds `leaseExpiresAt` or a lease getter it is picked up without edits.
 */
export function readLeaseExpiry(
  state: EditState | null | undefined,
  workspace?: LeaseSource | null
): number | null {
  if (!state?.leaseValid) {
    return null;
  }
  const direct = (state as EditState & { leaseExpiresAt?: unknown }).leaseExpiresAt;
  const directTime = toTimestamp(direct);
  if (directTime !== null) {
    return directTime;
  }
  if (!workspace) {
    return null;
  }
  try {
    if (typeof workspace.getLeaseExpiry === 'function') {
      const time = toTimestamp(workspace.getLeaseExpiry());
      if (time !== null) {
        return time;
      }
    }
    if (typeof workspace.getLease === 'function') {
      const lease = workspace.getLease();
      const time = toTimestamp(lease?.expiresAt);
      if (time !== null) {
        return time;
      }
    }
  } catch {
    // A missing/broken lease accessor must not break the status bar.
    return null;
  }
  return null;
}

const toBlockBoundary = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

const toBlockRange = (start: unknown, end: unknown): BlockRange | null => {
  const first = toBlockBoundary(start);
  const last = toBlockBoundary(end);
  if (first === null || last === null || first < 1 || last < first) {
    return null;
  }
  return { start: first, end: last };
};

/**
 * Parses the block assignment from sessionStorage. Accepts `1-40`, `1–40`,
 * `41 至 80`, `81..120`, a JSON object (`{"start":1,"end":40}`) or a JSON array.
 */
export function parseBlockRange(raw: unknown): BlockRange | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return toBlockRange(parsed[0], parsed[1]);
      }
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        return toBlockRange(
          record.start ?? record.from ?? record.begin,
          record.end ?? record.to ?? record.stop
        );
      }
    } catch {
      // Fall through to the textual range parser.
    }
  }
  const match = /^(\d+)\s*(?:[-–—~]|\.\.|至)\s*(\d+)$/.exec(text);
  return match ? toBlockRange(match[1], match[2]) : null;
}

type StorageLike = {
  getItem: (key: string) => string | null;
};

/** Safe sessionStorage read used by the bar; storage can throw in privacy modes. */
export function readBlockRange(storage?: StorageLike | null): BlockRange | null {
  if (!storage) {
    return null;
  }
  try {
    return parseBlockRange(storage.getItem(BLOCK_RANGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function formatBlockRange(range: BlockRange | null | undefined): string {
  return range ? `我的区块 ${range.start}–${range.end}` : '区块未分配';
}

/** Formats a persisted timestamp for the bar (time only for today, date + time otherwise). */
export function formatPersistedAt(persistedAt: unknown, now = Date.now()): string | null {
  const time = toTimestamp(persistedAt);
  if (time === null) {
    return null;
  }
  const date = new Date(time);
  const current = new Date(now);
  const sameDay =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return sameDay ? clock : `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`;
}

export function isConflictCode(code: unknown): boolean {
  if (typeof code !== 'string') {
    return false;
  }
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  if (CONFLICT_CODES.has(normalized)) {
    return true;
  }
  return /(^|_)(409|423)(_|$)/.test(normalized);
}

export function formatWorkspaceError(error: unknown): WorkspaceErrorInfo {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === 'string' ? candidate.code.trim() : '';
    const message = typeof candidate.message === 'string' ? candidate.message.trim() : '';
    if (code || message) {
      return {
        code: code || 'UNKNOWN',
        message: message && message !== code ? message : '',
        conflict: isConflictCode(code),
      };
    }
  }
  if (typeof error === 'string' && error.trim()) {
    return { code: 'UNKNOWN', message: error.trim(), conflict: false };
  }
  return { code: 'UNKNOWN', message: '', conflict: false };
}

/** `/medcollab` and its child routes are the only paths allowed to show the demo state. */
export function isMedCollabPath(pathname: unknown): boolean {
  return (
    typeof pathname === 'string' &&
    (pathname === '/medcollab' || pathname.startsWith('/medcollab/'))
  );
}

/**
 * Stable signature of the adapter state. Used for event-driven rendering and
 * for clearing transient errors/conflicts only when the session state changes.
 */
export function stateSignature(state: EditState | null | undefined): string {
  if (!state) {
    return '';
  }
  return [
    state.caseId ?? '',
    state.sessionId ?? '',
    state.intent ?? '',
    state.versionId ?? '',
    state.ready ? '1' : '0',
    state.dirty ? '1' : '0',
    state.saving ? '1' : '0',
    state.leaseValid ? '1' : '0',
    state.readOnly ? '1' : '0',
  ].join('|');
}
