import {
  applyPreferencePatch, createAccountStorageKey, decodePreferences, DEFAULT_HOME_PREFERENCES,
  encodePreferences, PREFERENCE_STORAGE_PREFIX, preferenceScope,
} from './model';
import type { HomePreferencePatch, HomePreferences, PersistenceState, PreferenceContext, PreferenceScope } from './model';

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PreferenceEnvironment = {
  getStorage: () => PreferenceStorage | null;
  createKey: (identity: { issuer: string; subject: string }) => Promise<string>;
  subscribe?: (listener: (key: string | null) => void) => () => void;
};
export type PreferenceSnapshot = Readonly<{
  preferences: HomePreferences;
  scope: PreferenceScope;
  persistence: PersistenceState;
  resetUnconfirmed: boolean;
}>;
export const browserPreferenceEnvironment: PreferenceEnvironment = {
  getStorage: () => typeof window === 'undefined' ? null : window.localStorage,
  createKey: createAccountStorageKey,
  subscribe(listener) {
    if (typeof window === 'undefined') return () => {};
    const handler = (event: StorageEvent) => {
      try { if (event.storageArea === window.localStorage) listener(event.key); } catch { /* Storage may be disabled after mounting. */ }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  },
};

/** One mounted identity context. No shared account cache or deferred write queue. */
export class PreferenceSession {
  private snapshot: PreferenceSnapshot;
  private readonly identity: { issuer: string; subject: string } | null;
  private readonly listeners = new Set<() => void>();
  private active = false;
  private disposed = false;
  private generation = 0;
  private revision = 0;
  private pendingReset = false;
  private key: string | null = null;
  private storage: PreferenceStorage | null = null;
  private unsubscribe?: () => void;

  constructor(context: PreferenceContext, private readonly environment = browserPreferenceEnvironment) {
    const scope = preferenceScope(context);
    this.identity = scope === 'account' && context.identity
      ? { issuer: context.identity.issuer, subject: context.identity.subject } : null;
    this.snapshot = Object.freeze({
      preferences: DEFAULT_HOME_PREFERENCES, scope,
      persistence: scope === 'account' ? 'loading' : 'ephemeral', resetUnconfirmed: false,
    });
  }
  getSnapshot = (): PreferenceSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: Partial<PreferenceSnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...next });
    for (const listener of this.listeners) listener();
  }
  start() {
    if (this.active) return;
    this.active = true; this.disposed = false;
    const generation = ++this.generation;
    if (this.identity) {
      this.publish({ persistence: 'loading' });
      void this.initialize(generation);
    }
  }
  dispose() {
    this.active = false; this.disposed = true; this.generation++;
    this.key = null; this.storage = null;
    this.unsubscribe?.(); this.unsubscribe = undefined;
  }
  private isCurrent(generation: number) { return this.active && !this.disposed && generation === this.generation; }
  private async initialize(generation: number) {
    try {
      const key = await this.environment.createKey(this.identity!);
      if (!this.isCurrent(generation)) return;
      if (!key.startsWith(PREFERENCE_STORAGE_PREFIX) || !/^[a-f0-9]{64}$/.test(key.slice(PREFERENCE_STORAGE_PREFIX.length))) throw new Error();
      this.key = key;
      this.storage = this.environment.getStorage();
      if (!this.storage) throw new Error();
      if (this.environment.subscribe) this.unsubscribe = this.environment.subscribe(eventKey => {
        if (this.isCurrent(generation) && (eventKey === null || eventKey === this.key)) this.read();
      });
      // An interaction made before async key derivation wins over an older saved value.
      if (this.revision > 0) {
        if (this.pendingReset) this.resetStorage();
        else this.persist();
      } else this.read();
    } catch {
      if (this.isCurrent(generation)) {
        this.publish({ persistence: 'unavailable', resetUnconfirmed: this.pendingReset });
      }
    }
  }
  private read() {
    if (!this.active || this.disposed || !this.key || !this.storage) return;
    try {
      const decoded = decodePreferences(this.storage.getItem(this.key));
      this.pendingReset = false;
      this.publish({ preferences: decoded.preferences, persistence: decoded.recovered ? 'recovered' : 'local', resetUnconfirmed: false });
    } catch { this.publish({ persistence: 'unavailable' }); }
  }
  private persist() {
    if (!this.active || this.disposed || !this.key || !this.storage) return;
    try {
      this.storage.setItem(this.key, encodePreferences(this.snapshot.preferences));
      this.pendingReset = false;
      this.publish({ persistence: 'local', resetUnconfirmed: false });
    } catch { this.publish({ persistence: 'unavailable', resetUnconfirmed: false }); }
  }
  update = (patch: HomePreferencePatch) => {
    if (this.disposed) return;
    const preferences = applyPreferencePatch(this.snapshot.preferences, patch);
    if (preferences === this.snapshot.preferences) return;
    this.revision++; this.pendingReset = false;
    this.publish({ preferences, resetUnconfirmed: false });
    this.persist();
  };
  reset = () => {
    if (this.disposed) return;
    this.revision++; this.pendingReset = true;
    this.publish({
      preferences: DEFAULT_HOME_PREFERENCES,
      resetUnconfirmed: this.snapshot.scope === 'account' && this.snapshot.persistence === 'unavailable',
    });
    this.resetStorage();
  };
  private resetStorage() {
    if (!this.active || this.disposed || !this.key || !this.storage) return;
    try {
      this.storage.removeItem(this.key);
      this.pendingReset = false;
      this.publish({ persistence: 'local', resetUnconfirmed: false });
    } catch {
      // Some storage implementations reject removal but still allow replacement.
      try {
        this.storage.setItem(this.key, encodePreferences(DEFAULT_HOME_PREFERENCES));
        this.pendingReset = false;
        this.publish({ persistence: 'local', resetUnconfirmed: false });
      } catch { this.publish({ persistence: 'unavailable', resetUnconfirmed: true }); }
    }
  }
}
