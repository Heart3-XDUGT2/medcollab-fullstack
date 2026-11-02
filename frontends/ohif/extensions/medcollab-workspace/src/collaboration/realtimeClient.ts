/**
 * WebSocket client for the MedCollab realtime layer.
 *
 * The socket only carries ephemeral presence/activity/mask hints. Drafts and
 * publications remain on the existing HTTP + IndexedDB path and are the source
 * of truth after a reconnect.
 */

export const REALTIME_PREFERENCE_KEY = 'medcollab:realtime:enabled';

export type RealtimeStatus = 'off' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type RealtimeMember = {
  subject: string;
  username: string;
  role: 'leader' | 'uploader' | 'member';
  segmentNumber: number | null;
  color: [number, number, number] | null;
  online: boolean;
  activeSegment: number | null;
  activeLabel: string | null;
  lastSeen: string;
  cursor?: { world: number[] } | null;
};

export type RealtimeActivity = {
  id: string;
  username: string;
  text: string;
  at: string;
};

export type RealtimeSnapshot = {
  status: RealtimeStatus;
  members: RealtimeMember[];
  activities: RealtimeActivity[];
  error: string;
};

type Envelope = {
  v?: number;
  type?: string;
  payload?: Record<string, unknown>;
};

type Options = {
  datasetId: string;
  seriesId: string;
  onState: (snapshot: RealtimeSnapshot) => void;
  clientId?: string;
  onReady?: () => void;
  onEvent?: (type: string, payload: Record<string, any>) => void;
};

const MAX_ACTIVITIES = 20;

export function isRealtimeEnabled(): boolean {
  try {
    return window.localStorage.getItem(REALTIME_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setRealtimeEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(REALTIME_PREFERENCE_KEY, String(enabled));
  } catch {
    // The preference is optional; a blocked localStorage must not break settings.
  }
  window.dispatchEvent(
    new CustomEvent('medcollab:realtime-preference', { detail: Boolean(enabled) })
  );
}

export class RealtimeClient {
  private seq = 0;
  private clientId: string;
  private onlineHandler = () => {
    if (!this.stopped && !this.socket) this.connect();
  };
  private socket?: WebSocket;
  private stopped = true;
  private attempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private presenceTimer?: ReturnType<typeof setInterval>;
  private activeSegment: number | null = null;
  private activeLabel: string | null = null;
  private cursor: { world: number[] } | null = null;
  private snapshot: RealtimeSnapshot = {
    status: 'off',
    members: [],
    activities: [],
    error: '',
  };

  constructor(private options: Options) {
    this.clientId = options.clientId || crypto.randomUUID();
  }

  connect(): void {
    this.destroy(false);
    this.stopped = false;
    window.addEventListener('online', this.onlineHandler);
    if (!isRealtimeEnabled()) {
      this.emit({ status: 'off', members: [], activities: [], error: '' });
      return;
    }

    let url: URL;
    try {
      url = this.websocketUrl();
    } catch {
      this.emit({ status: 'error', members: [], activities: [], error: '实时协作地址无效' });
      return;
    }

    this.emit({ ...this.snapshot, status: 'connecting', error: '' });
    try {
      this.socket = new WebSocket(url);
    } catch {
      this.emit({ status: 'error', members: [], activities: [], error: '无法创建实时连接' });
      return;
    }

    const socket = this.socket;
    this.socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      this.attempts = 0;
      this.emit({ ...this.snapshot, status: 'connected', error: '' });
      this.send('join', {
        clientId: this.clientId,
        protocolVersion: this.options.onReady ? 2 : 1,
        activeSegment: this.activeSegment,
      });
      this.sendPresence();
      this.presenceTimer = setInterval(() => this.sendPresence(), 10_000);
    };
    this.socket.onmessage = event => {
      if (this.socket === socket && !this.stopped) this.handleMessage(event.data);
    };
    this.socket.onerror = () => {
      // close follows; avoid duplicating the error state here.
    };
    this.socket.onclose = event => {
      if (this.socket === socket) this.handleClose(event);
    };
  }

  setActive(segmentNumber: number | null, label: string | null): void {
    this.activeSegment = segmentNumber;
    this.activeLabel = label;
    this.sendPresence();
  }

  setCursor(cursor: { world: number[] } | null): void {
    this.cursor = cursor;
    this.sendPresence();
  }

  preview(points: number[][]): void {
    this.send('stroke-preview', { points });
  }

  destroy(emit = true): void {
    this.stopped = true;
    window.removeEventListener('online', this.onlineHandler);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.presenceTimer);
    this.reconnectTimer = undefined;
    this.presenceTimer = undefined;
    try {
      if (this.socket) {
        this.socket.onclose = null;
        this.socket.onmessage = null;
        this.socket.onopen = null;
      }
      this.socket?.close(1000, 'closed');
    } catch {
      // Ignore a socket already closed by the browser.
    }
    this.socket = undefined;
    if (emit) this.emit({ status: 'off', members: [], activities: [], error: '' });
  }

  private websocketUrl(): URL {
    const configured = (window as any).config?.medcollabRealtime?.url;
    const url = new URL(configured || '/ws/medcollab', window.location.href);
    if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) {
      throw new Error('invalid protocol');
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('datasetId', this.options.datasetId);
    url.searchParams.set('seriesId', this.options.seriesId);
    return url;
  }

  private send(type: string, payload: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(
        JSON.stringify({ v: 1, type, seq: ++this.seq, ts: new Date().toISOString(), payload })
      );
    } catch {
      // A failed send is recovered by the next presence/heartbeat or reconnect.
    }
  }

  private sendPresence(): void {
    this.send('presence', {
      activeSegment: this.activeSegment,
      activeLabel: this.activeLabel,
      cursor: this.cursor,
    });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: Envelope;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const payload = (message.payload || {}) as Record<string, any>;
    if (message.type === 'room-state') {
      const members = Array.isArray(payload.members) ? payload.members.map(normalizeMember) : [];
      this.emit({ status: 'connected', members, activities: this.snapshot.activities, error: '' });
      if (
        payload.protocolVersion === 2 &&
        Array.isArray(payload.capabilities) &&
        payload.capabilities.includes('mask-ops')
      )
        this.options.onReady?.();
      return;
    }
    if (message.type === 'members-state') {
      this.emit({
        ...this.snapshot,
        members: Array.isArray(payload.members) ? payload.members.map(normalizeMember) : [],
      });
      return;
    }
    if (
      message.type === 'mask-committed' ||
      message.type === 'lock-state' ||
      message.type === 'stroke-preview'
    ) {
      this.options.onEvent?.(message.type, payload);
      return;
    }
    if (message.type === 'presence') {
      const next = normalizeMember(payload);
      const members = this.snapshot.members.some(member => member.subject === next.subject)
        ? this.snapshot.members.map(member => (member.subject === next.subject ? next : member))
        : [...this.snapshot.members, next];
      this.emit({ ...this.snapshot, members });
      return;
    }
    if (message.type === 'segment-update') {
      // The mask is deliberately not rendered in this version. Keep the
      // collaborator's active label fresh so the roster does not look stale.
      const subject = payload.subject;
      if (typeof subject === 'string') {
        this.emit({
          ...this.snapshot,
          members: this.snapshot.members.map(member =>
            member.subject === subject
              ? { ...member, activeLabel: member.activeLabel || '正在更新掩膜' }
              : member
          ),
        });
      }
      return;
    }
    if (message.type === 'activity') {
      const activity = normalizeActivity(payload);
      if (!activity) return;
      const activities = [
        activity,
        ...this.snapshot.activities.filter(item => item.id !== activity.id),
      ].slice(0, MAX_ACTIVITIES);
      this.emit({ ...this.snapshot, activities });
      return;
    }
    if (message.type === 'error') {
      const fatal = Boolean(payload.fatal);
      const error = typeof payload.message === 'string' ? payload.message : '实时协作出错';
      this.emit({ ...this.snapshot, status: fatal ? 'error' : this.snapshot.status, error });
      if (fatal) this.destroy(false);
    }
  }

  private handleClose(event: CloseEvent): void {
    clearInterval(this.presenceTimer);
    this.presenceTimer = undefined;
    this.socket = undefined;
    if (this.stopped) return;

    const fatal = [4401, 4403, 4404].includes(event.code);
    if (fatal) {
      this.emit({
        status: 'error',
        members: [],
        activities: this.snapshot.activities,
        error: event.reason || '实时协作鉴权失败',
      });
      return;
    }

    this.emit({
      status: 'disconnected',
      members: [],
      activities: this.snapshot.activities,
      error: '',
    });
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts);
    this.attempts++;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }

  private emit(snapshot: RealtimeSnapshot): void {
    this.snapshot = snapshot;
    this.options.onState(snapshot);
  }
}

function normalizeMember(raw: Record<string, any>): RealtimeMember {
  return {
    subject: String(raw.subject || ''),
    username: String(raw.username || ''),
    role: ['leader', 'uploader', 'member'].includes(raw.role) ? raw.role : 'member',
    segmentNumber: Number.isSafeInteger(raw.segmentNumber) ? raw.segmentNumber : null,
    color:
      Array.isArray(raw.color) && raw.color.length >= 3
        ? [Number(raw.color[0]), Number(raw.color[1]), Number(raw.color[2])]
        : null,
    online: raw.online !== false,
    activeSegment: Number.isSafeInteger(raw.activeSegment) ? raw.activeSegment : null,
    activeLabel: typeof raw.activeLabel === 'string' ? raw.activeLabel : null,
    lastSeen: typeof raw.lastSeen === 'string' ? raw.lastSeen : '',
    cursor: Array.isArray(raw.cursor?.world) && raw.cursor.world.length === 3 ? raw.cursor : null,
  };
}

function normalizeActivity(raw: Record<string, any>): RealtimeActivity | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    username: String(raw.username || '协作者'),
    text: String(raw.text || '更新了标注'),
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
  };
}
