import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  applyPreferencePatch,
  createAccountStorageKey,
  decodePreferences,
  DEFAULT_HOME_PREFERENCES,
  encodePreferences,
  PREFERENCE_STORAGE_PREFIX,
  preferenceScope,
} from './model';

afterEach(() => vi.unstubAllGlobals());
describe('strict, content-free display schema', () => {
  test('missing data means defaults; booleans false survive a round trip', () => {
    expect(decodePreferences(null)).toEqual({
      preferences: DEFAULT_HOME_PREFERENCES,
      recovered: false,
    });
    const value = applyPreferencePatch(DEFAULT_HOME_PREFERENCES, {
      layout: 'list',
      density: 'compact',
      fields: { owner: false, instances: false, createdAt: false },
    });
    expect(decodePreferences(encodePreferences(value))).toEqual({
      preferences: value,
      recovered: false,
    });
  });
  test.each([
    '',
    '{',
    'null',
    '[]',
    '3',
    '"string"',
    '{"version":0}',
    '{"version":2}',
    JSON.stringify({ version: 1, preferences: { ...DEFAULT_HOME_PREFERENCES, density: 'tiny' } }),
    JSON.stringify({
      version: 1,
      preferences: { ...DEFAULT_HOME_PREFERENCES, groupBy: 'patient' },
    }),
    JSON.stringify({
      version: 1,
      preferences: {
        ...DEFAULT_HOME_PREFERENCES,
        fields: { owner: 'false', instances: true, createdAt: true },
      },
    }),
    JSON.stringify({ version: 1, preferences: { ...DEFAULT_HOME_PREFERENCES, fields: [] } }),
    JSON.stringify({
      version: 1,
      preferences: { ...DEFAULT_HOME_PREFERENCES, datasetName: 'must-not-propagate' },
    }),
    JSON.stringify({
      version: 1,
      preferences: DEFAULT_HOME_PREFERENCES,
      csrfToken: 'must-not-propagate',
    }),
    '{"version":1,"preferences":{"__proto__":{"layout":"list"}}}',
    'x'.repeat(2049),
  ])('invalid, old, future or unrelated payload recovers without propagating data: %s', (raw) => {
    expect(decodePreferences(raw)).toEqual({
      preferences: DEFAULT_HOME_PREFERENCES,
      recovered: true,
    });
  });
  test('partial updates preserve other display fields; unknown keys are refused', () => {
    const current = applyPreferencePatch(DEFAULT_HOME_PREFERENCES, {
      density: 'compact',
      fields: { owner: false },
    });
    const next = applyPreferencePatch(current, { fields: { createdAt: false } });
    expect(next.fields).toEqual({ owner: false, instances: true, createdAt: false });
    expect(next.density).toBe('compact');
    for (const patch of [
      {},
      { density: 'compact' },
      { datasetId: 'no' },
      { fields: { permissions: 'admin' } },
      { layout: 'external-url' },
    ]) {
      expect(applyPreferencePatch(current, patch)).toBe(current);
    }
  });
  test('snapshots and defaults cannot be mutated through a consumer reference', () => {
    const next = decodePreferences(encodePreferences(DEFAULT_HOME_PREFERENCES)).preferences;
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.fields)).toBe(true);
    expect(() => {
      (next.fields as any).owner = false;
    }).toThrow();
    expect(DEFAULT_HOME_PREFERENCES.fields.owner).toBe(true);
  });
  test('serialization has only the versioned display allowlist', () => {
    const raw = encodePreferences(DEFAULT_HOME_PREFERENCES);
    const value = JSON.parse(raw);
    expect(Object.keys(value)).toEqual(['version', 'preferences']);
    expect(Object.keys(value.preferences)).toEqual([
      'layout',
      'density',
      'groupBy',
      'fields',
      'home',
    ]);
    expect(Object.keys(value.preferences.fields)).toEqual(['owner', 'instances', 'createdAt']);
    expect(() =>
      encodePreferences({ ...DEFAULT_HOME_PREFERENCES, issuer: 'not-to-be-saved' } as any)
    ).toThrow();
  });
  test('v1 library choices migrate without replacing saved layout, density or fields', () => {
    const { home, ...legacy } = DEFAULT_HOME_PREFERENCES;
    const result = decodePreferences(
      JSON.stringify({
        version: 1,
        preferences: {
          ...legacy,
          layout: 'list',
          density: 'compact',
          fields: { owner: false, instances: true, createdAt: false },
        },
      })
    );
    expect(result.recovered).toBe(false);
    expect(result.preferences.layout).toBe('list');
    expect(result.preferences.density).toBe('compact');
    expect(result.preferences.fields).toEqual({ owner: false, instances: true, createdAt: false });
    expect(result.preferences.home.defaultEntry).toBe('library');
  });
  test('composition accepts only complete enum ordering and content-free hidden modules', () => {
    const home = DEFAULT_HOME_PREFERENCES.home;
    const result = applyPreferencePatch(DEFAULT_HOME_PREFERENCES, {
      home: {
        ...home,
        defaultEntry: 'library',
        order: [...home.order].reverse(),
        hidden: ['recent'],
      },
    });
    expect(decodePreferences(encodePreferences(result)).preferences).toEqual(result);
    for (const value of [
      { ...home, order: ['continue'] },
      { ...home, order: ['continue', 'continue', 'recent', 'library', 'teams'] },
      { ...home, hidden: ['patient-id'] },
      { ...home, hidden: ['recent', 'recent'] },
      { ...home, datasetId: 'private' },
      { ...home, defaultEntry: 'https://external.test' },
    ]) {
      expect(applyPreferencePatch(result, { home: value })).toBe(result);
      expect(
        decodePreferences(JSON.stringify({ version: 1, preferences: { ...result, home: value } }))
          .recovered
      ).toBe(true);
    }
  });
});
describe('account key derivation', () => {
  test('new work-home default leads with datasets while saved module ordering is unchanged', () => {
    expect(DEFAULT_HOME_PREFERENCES.home.order[0]).toBe('library');
    const previous = {
      ...DEFAULT_HOME_PREFERENCES,
      home: {
        defaultEntry: 'work',
        order: ['continue', 'favorites', 'recent', 'library', 'teams'],
        hidden: ['library'],
      },
    };
    const decoded = decodePreferences(JSON.stringify({ version: 1, preferences: previous }));
    expect(decoded.recovered).toBe(false);
    expect(decoded.preferences.home).toEqual(previous.home);
  });
  test('SHA-256 separates issuers/subjects and ambiguous concatenations without storing them', async () => {
    const identities = [
      { issuer: 'https://identity.example/realm-a', subject: 'account-A' },
      { issuer: 'https://identity.example/realm-b', subject: 'account-A' },
      { issuer: 'https://identity.example/realm-a', subject: 'account-B' },
      { issuer: 'ab', subject: 'c' },
      { issuer: 'a', subject: 'bc' },
    ];
    const keys = await Promise.all(
      identities.map((identity) =>
        createAccountStorageKey(identity, webcrypto.subtle as unknown as SubtleCrypto)
      )
    );
    expect(new Set(keys).size).toBe(identities.length);
    expect(
      await createAccountStorageKey(identities[0], webcrypto.subtle as unknown as SubtleCrypto)
    ).toBe(keys[0]);
    for (const key of keys) {
      expect(key).toMatch(
        new RegExp(`^${PREFERENCE_STORAGE_PREFIX.replaceAll('.', '\\.')}[a-f0-9]{64}$`)
      );
      expect(key).not.toContain('https://');
      expect(key).not.toContain('account-');
    }
  });
  test('no weak or raw-identity key fallback when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    await expect(
      createAccountStorageKey({ issuer: 'issuer', subject: 'subject' })
    ).rejects.toThrow();
  });
  test('demo ignores stale identity and incomplete real identity stays anonymous', () => {
    expect(preferenceScope({ mode: 'demo', identity: { issuer: 'issuer', subject: 'me' } })).toBe(
      'demo'
    );
    expect(preferenceScope({ mode: 'real', identity: null })).toBe('anonymous');
    expect(preferenceScope({ mode: 'real', identity: { issuer: '', subject: 'me' } })).toBe(
      'anonymous'
    );
    expect(preferenceScope({ mode: 'real', identity: { issuer: 'issuer', subject: 'me' } })).toBe(
      'account'
    );
  });
});
