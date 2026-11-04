import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PreferenceSession } from './session';
import type { PreferenceEnvironment } from './session';
import { DEFAULT_HOME_PREFERENCES, encodePreferences, PREFERENCE_STORAGE_PREFIX } from './model';
import type { PreferenceContext } from './model';

const account = (subject = 'A', issuer = 'issuer-one'): PreferenceContext => ({ mode: 'real', identity: { subject, issuer } });
const keyA = PREFERENCE_STORAGE_PREFIX + 'a'.repeat(64);
const keyB = PREFERENCE_STORAGE_PREFIX + 'b'.repeat(64);
const keyC = PREFERENCE_STORAGE_PREFIX + 'c'.repeat(64);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('preference persistence and lifecycle boundaries', () => {
  let values: Map<string, string>;
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
  let environment: PreferenceEnvironment;
  let sessions: PreferenceSession[];
  let listeners: Set<(key: string | null) => void>;
  const make = (context: PreferenceContext) => {
    const session = new PreferenceSession(context, environment);
    sessions.push(session); session.start(); return session;
  };
  beforeEach(() => {
    values = new Map(); sessions = []; listeners = new Set();
    storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn((key: string) => { values.delete(key); }),
    };
    environment = {
      getStorage: vi.fn(() => storage),
      createKey: vi.fn(async identity => identity.issuer === 'issuer-two' ? keyC : identity.subject === 'A' ? keyA : keyB),
      subscribe: vi.fn(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    };
  });
  afterEach(() => sessions.forEach(session => session.dispose()));

  test('real account refresh restores only its own record and keeps raw identity out of storage', async () => {
    const first = make(account()); await flush();
    first.update({ layout: 'list', groupBy: 'source', fields: { owner: false } });
    const saved = values.get(keyA)!;
    expect(saved).not.toContain('issuer-one');
    expect(saved).not.toContain('subject');
    expect(saved).not.toContain('dataset');
    first.dispose();
    const refreshed = make(account()); await flush();
    expect(refreshed.getSnapshot().preferences).toEqual(first.getSnapshot().preferences);
    const other = make(account('B')); await flush();
    expect(other.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
    other.update({ density: 'compact' });
    expect(values.get(keyA)).toBe(saved);
    const sameSubjectOtherIssuer = make(account('A', 'issuer-two')); await flush();
    expect(sameSubjectOtherIssuer.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
  });
  test('new cards default never overwrites an existing valid personal list preference', async () => {
    expect(DEFAULT_HOME_PREFERENCES.layout).toBe('cards');
    values.set(keyA, encodePreferences({ ...DEFAULT_HOME_PREFERENCES, layout: 'list' }));
    const session = make(account()); await flush();
    expect(session.getSnapshot().preferences.layout).toBe('list');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    session.reset();
    expect(session.getSnapshot().preferences.layout).toBe('cards');
    expect(values.has(keyA)).toBe(false);
  });
  test.each(['demo', 'anonymous'] as const)('%s never reads, derives an account key or writes storage', async mode => {
    const session = make({ mode, identity: { issuer: 'issuer-one', subject: 'A' } }); await flush();
    session.update({ layout: 'list', fields: { instances: false } });
    expect(session.getSnapshot().preferences.layout).toBe('list');
    expect(session.getSnapshot().persistence).toBe('ephemeral');
    session.reset();
    expect(session.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
    expect(environment.createKey).not.toHaveBeenCalled();
    expect(environment.getStorage).not.toHaveBeenCalled();
    expect(environment.subscribe).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });
  test('real-without-identity also uses memory only; entering a real account does not inherit it', async () => {
    const anonymous = make({ mode: 'real', identity: null }); await flush();
    anonymous.update({ layout: 'list' });
    anonymous.dispose();
    const real = make(account()); await flush();
    expect(real.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
    expect(values.size).toBe(0);
  });
  test('only issuer and subject are retained even if a caller passes a wider session object', async () => {
    make({ mode: 'real', identity: { issuer: 'issuer-one', subject: 'A', csrfToken: 'never-retain', username: 'not-needed' } as any });
    await flush();
    expect(environment.createKey).toHaveBeenCalledWith({ issuer: 'issuer-one', subject: 'A' });
  });
  test('reset removes only this account preference key and reliably restores defaults on refresh', async () => {
    const session = make(account()); await flush();
    session.update({ layout: 'list' });
    values.set(keyB, 'other account record'); values.set('unrelated', 'untouched');
    session.reset();
    expect(storage.removeItem).toHaveBeenCalledWith(keyA);
    expect(values.get(keyB)).toBe('other account record');
    expect(values.get('unrelated')).toBe('untouched');
    const refreshed = make(account()); await flush();
    expect(refreshed.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
  });
  test('denied storage getter degrades without leaking provider error text or blocking changes', async () => {
    environment.getStorage = vi.fn(() => { throw new Error('private URL must not be shown'); });
    const session = make(account()); await flush();
    session.update({ density: 'compact', fields: { createdAt: false } });
    expect(session.getSnapshot().persistence).toBe('unavailable');
    expect(session.getSnapshot().preferences.density).toBe('compact');
    session.reset();
    expect(session.getSnapshot().resetUnconfirmed).toBe(true);
    expect(session.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
    expect(JSON.stringify(session.getSnapshot())).not.toContain('private URL');
  });
  test('read failures do not throw or propagate stored contents', async () => {
    storage.getItem.mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    const session = make(account()); await flush();
    expect(session.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
    expect(session.getSnapshot().persistence).toBe('unavailable');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  test('quota failure keeps current display immediate and reset can still remove an old saved value', async () => {
    values.set(keyA, encodePreferences(DEFAULT_HOME_PREFERENCES));
    const session = make(account()); await flush();
    storage.setItem.mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    session.update({ layout: 'list' });
    expect(session.getSnapshot().preferences.layout).toBe('list');
    expect(session.getSnapshot().persistence).toBe('unavailable');
    session.reset();
    expect(session.getSnapshot().resetUnconfirmed).toBe(false);
    expect(values.has(keyA)).toBe(false);
  });
  test('failed removal falls back to writing canonical defaults, without touching other keys', async () => {
    const session = make(account()); await flush(); session.update({ layout: 'list' });
    storage.removeItem.mockImplementation(() => { throw new Error('remove denied'); });
    session.reset();
    expect(values.get(keyA)).toBe(encodePreferences(DEFAULT_HOME_PREFERENCES));
    expect(session.getSnapshot().resetUnconfirmed).toBe(false);
    expect(storage.setItem.mock.calls.every(([key]) => key === keyA)).toBe(true);
  });
  test('if both reset operations fail, defaults work now but persistence is explicitly unconfirmed', async () => {
    const session = make(account()); await flush(); session.update({ layout: 'list' });
    const previous = values.get(keyA);
    storage.removeItem.mockImplementation(() => { throw new Error('blocked'); });
    storage.setItem.mockImplementation(() => { throw new Error('blocked'); });
    session.reset();
    expect(session.getSnapshot()).toMatchObject({ preferences: DEFAULT_HOME_PREFERENCES, persistence: 'unavailable', resetUnconfirmed: true });
    expect(values.get(keyA)).toBe(previous);
  });
  test.each(['{broken', '{"version":0}', '{"version":999}', 'x'.repeat(2049)])('damaged or unsupported records recover without automatic overwrite: %s', raw => {
    values.set(keyA, raw);
    const session = make(account());
    return flush().then(() => {
      expect(session.getSnapshot()).toMatchObject({ preferences: DEFAULT_HOME_PREFERENCES, persistence: 'recovered' });
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      session.update({ layout: 'list' });
      expect(values.get(keyA)).toContain('"version":1');
      expect(values.get(keyA)).not.toContain(raw);
    });
  });
  test('a disposed account cannot read/write when key derivation arrives after switching accounts', async () => {
    const delayed = deferred<string>();
    environment.createKey = vi.fn(identity => identity.subject === 'A' ? delayed.promise : Promise.resolve(keyB));
    const old = make(account()); old.update({ layout: 'list' }); old.dispose();
    const current = make(account('B')); await flush();
    current.update({ density: 'compact' });
    delayed.resolve(keyA); await flush();
    old.update({ groupBy: 'source' }); old.reset();
    expect(storage.getItem.mock.calls.every(([key]) => key === keyB)).toBe(true);
    expect(storage.setItem.mock.calls.every(([key]) => key === keyB)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(current.getSnapshot().preferences.layout).toBe('cards');
  });
  test('changes made while loading win over a late saved display snapshot', async () => {
    const delayed = deferred<string>(); environment.createKey = vi.fn(() => delayed.promise);
    values.set(keyA, encodePreferences(DEFAULT_HOME_PREFERENCES));
    const session = make(account());
    session.update({ layout: 'list', density: 'compact' });
    expect(session.getSnapshot().preferences.layout).toBe('list');
    delayed.resolve(keyA); await flush();
    expect(session.getSnapshot().preferences.layout).toBe('list');
    expect(values.get(keyA)).toContain('"density":"compact"');
    expect(storage.getItem).not.toHaveBeenCalled();
  });
  test('reset before async load removes the old key instead of reloading its values', async () => {
    const delayed = deferred<string>(); environment.createKey = vi.fn(() => delayed.promise);
    values.set(keyA, '{"version":1,"preferences":{"layout":"list"}}');
    const session = make(account()); session.reset();
    delayed.resolve(keyA); await flush();
    expect(values.has(keyA)).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(session.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
  });
  test('missing or malformed key derivation never falls back to a raw/global account key', async () => {
    environment.createKey = vi.fn(async () => '/auth/login?subject=A');
    const session = make(account()); await flush(); session.update({ layout: 'list' });
    expect(session.getSnapshot().persistence).toBe('unavailable');
    expect(environment.getStorage).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });
  test('StrictMode-style restart invalidates the first async run and unsubscribes on disposal', async () => {
    const first = deferred<string>(), second = deferred<string>();
    environment.createKey = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const session = make(account()); session.dispose(); session.start();
    second.resolve(keyA); await flush();
    first.resolve(keyB); await flush();
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem).toHaveBeenCalledWith(keyA);
    expect(listeners.size).toBe(1);
    session.dispose();
    expect(listeners.size).toBe(0);
  });
  test('same-account external storage changes re-read only this key and stop after disposal', async () => {
    const session = make(account()); await flush();
    const updated = { ...DEFAULT_HOME_PREFERENCES, density: 'compact' as const };
    values.set(keyA, encodePreferences(updated));
    for (const listener of listeners) listener(keyB);
    expect(session.getSnapshot().preferences.density).toBe('comfortable');
    for (const listener of listeners) listener(keyA);
    expect(session.getSnapshot().preferences.density).toBe('compact');
    values.delete(keyA);
    for (const listener of listeners) listener(null);
    expect(session.getSnapshot().preferences).toBe(DEFAULT_HOME_PREFERENCES);
    const captured = [...listeners];
    session.dispose();
    const calls = storage.getItem.mock.calls.length;
    captured.forEach(listener => listener(keyA));
    expect(storage.getItem.mock.calls.length).toBe(calls);
  });
});
