import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import PreferencesButton from './PreferencesButton';
import { useHomePreferences } from './useHomePreferences';
import type { HomePreferencesModel } from './useHomePreferences';
import { browserPreferenceEnvironment } from './session';
import type { PreferenceEnvironment } from './session';
import { DEFAULT_HOME_PREFERENCES, encodePreferences, PREFERENCE_STORAGE_PREFIX } from './model';
import type { PreferenceContext } from './model';

const keyA = PREFERENCE_STORAGE_PREFIX + 'a'.repeat(64);
const keyB = PREFERENCE_STORAGE_PREFIX + 'b'.repeat(64);
const account = (subject = 'A'): PreferenceContext => ({ mode: 'real', identity: { issuer: 'fixture-issuer', subject } });
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(yes => { resolve = yes; });
  return { promise, resolve };
};

describe('preferences hook and real Radix settings controls', () => {
  let root: Root, host: HTMLDivElement;
  let model: HomePreferencesModel;
  let values: Map<string, string>, environment: PreferenceEnvironment;
  let context: PreferenceContext;
  function Harness({ scope }: { scope: PreferenceContext }) {
    model = useHomePreferences(scope, environment);
    const [search, setSearch] = useState('腹部查找');
    const [selected] = useState('fixture-selected-id');
    return <><input aria-label="fixture search" value={search} onChange={event => setSearch(event.target.value)} /><p data-selected={selected} /><PreferencesButton model={model} /><output>{JSON.stringify(model.preferences)}</output></>;
  }
  async function render(next = context, strict = false) {
    context = next;
    await act(async () => {
      root.render(strict ? <React.StrictMode><Harness scope={context} /></React.StrictMode> : <Harness scope={context} />);
      await pause();
    });
  }
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
  async function open() {
    await act(async () => { (document.querySelector('[aria-label="显示设置"]') as HTMLButtonElement).click(); await pause(); });
  }
  beforeEach(() => {
    context = account(); values = new Map();
    environment = {
      createKey: vi.fn(async identity => identity.subject === 'A' ? keyA : keyB),
      getStorage: vi.fn(() => ({
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      })),
    };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); await pause(); });
    host.remove(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals();
  });
  test('controls update immediately without remounting search/selection and serialize only display choices', async () => {
    await render(); await open();
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog.getAttribute('aria-modal')).not.toBe('true');
    await act(async () => (dialog.querySelector('[type=radio][value=list]') as HTMLInputElement).click());
    await act(async () => (dialog.querySelector('[type=radio][value=compact]') as HTMLInputElement).click());
    await act(async () => Simulate.change(dialog.querySelector('select')!, { target: { value: 'source' } } as any));
    await act(async () => (dialog.querySelector('[type=checkbox]') as HTMLInputElement).click());
    expect(model.preferences).toMatchObject({ layout: 'list', density: 'compact', groupBy: 'source', fields: { owner: false } });
    expect((host.querySelector('[aria-label="fixture search"]') as HTMLInputElement).value).toBe('腹部查找');
    expect(host.querySelector('[data-selected]')?.getAttribute('data-selected')).toBe('fixture-selected-id');
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    const raw = values.get(keyA)!;
    for (const excluded of ['腹部', 'fixture-selected-id', 'fixture-issuer', 'csrf', 'subject', 'auth', 'dataset']) expect(raw).not.toContain(excluded);
    await act(async () => button('恢复默认').click());
    expect(model.preferences).toBe(DEFAULT_HOME_PREFERENCES);
    expect(values.has(keyA)).toBe(false);
    expect(document.querySelector('[role=status]')?.textContent).toContain('已恢复默认');
  });
  test('Escape closes and restores focus to the stable settings trigger', async () => {
    await render(); await open();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await act(async () => { await pause(); });
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[aria-label="显示设置"]'));
  });
  test('identity change paints new defaults before slow loading, closes old controls and rejects old callbacks', async () => {
    await render(); await open();
    await act(async () => model.update({ layout: 'list' }));
    const old = model;
    const slowB = deferred();
    environment.createKey = vi.fn(identity => identity.subject === 'B' ? slowB.promise : Promise.resolve(keyA));
    // Same environment reference: only the actual context changes.
    await render(account('B'));
    expect(model.preferences).toBe(DEFAULT_HOME_PREFERENCES);
    expect(model.persistence).toBe('loading');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await act(async () => { old.update({ density: 'compact' }); old.reset(); });
    expect(values.get(keyA)).toContain('"layout":"list"');
    await act(async () => { slowB.resolve(keyB); await pause(); });
    expect(model.preferences.layout).toBe('rows');
    expect(values.has(keyB)).toBe(false);
  });
  test('equivalent account objects keep the same active preference session', async () => {
    await render();
    await act(async () => model.update({ density: 'compact' }));
    await render({ mode: 'real', identity: { issuer: 'fixture-issuer', subject: 'A' } });
    expect(model.preferences.density).toBe('compact');
    expect(environment.createKey).toHaveBeenCalledTimes(1);
  });
  test('anonymous, demo and real preferences do not inherit each other', async () => {
    await render({ mode: 'anonymous' });
    await act(async () => model.update({ layout: 'list' }));
    await render({ mode: 'demo', identity: account().identity });
    expect(model.preferences).toBe(DEFAULT_HOME_PREFERENCES);
    await act(async () => model.update({ density: 'compact' }));
    await render(account());
    expect(model.preferences).toBe(DEFAULT_HOME_PREFERENCES);
    await act(async () => model.update({ groupBy: 'source' }));
    await render({ mode: 'demo' });
    expect(model.preferences).toBe(DEFAULT_HOME_PREFERENCES);
    await render(account());
    expect(model.preferences.groupBy).toBe('source');
    expect(values.size).toBe(1);
  });
  test('StrictMode keeps a usable controller, not a disposed one', async () => {
    await render(account(), true);
    expect(model.persistence).toBe('local');
    await act(async () => model.update({ layout: 'list' }));
    expect(model.preferences.layout).toBe('list');
    expect(values.get(keyA)).toContain('"layout":"list"');
  });
  test('denied storage does not disable controls and reset failure is not reported as persisted success', async () => {
    environment.getStorage = () => { throw new Error('private-provider-secret'); };
    await render(); await open();
    await act(async () => (document.querySelector('[type=radio][value=list]') as HTMLInputElement).click());
    expect(model.preferences.layout).toBe('list');
    expect(document.querySelector('[role=status]')?.textContent).toContain('未能记住');
    await act(async () => button('恢复默认').click());
    expect(model.preferences).toBe(DEFAULT_HOME_PREFERENCES);
    expect(document.querySelector('[role=status]')?.textContent).toContain('旧偏好未能清除');
    expect(document.body.textContent).not.toContain('private-provider-secret');
  });
  test('real storage events are account-scoped and re-read storage rather than trusting event payload', async () => {
    environment.subscribe = browserPreferenceEnvironment.subscribe;
    await render();
    values.set(keyA, encodePreferences({ ...DEFAULT_HOME_PREFERENCES, density: 'compact' }));
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: keyB, storageArea: localStorage })));
    expect(model.preferences.density).toBe('comfortable');
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: keyA, storageArea: sessionStorage })));
    expect(model.preferences.density).toBe('comfortable');
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: keyA, newValue: 'untrusted text', storageArea: localStorage })));
    expect(model.preferences.density).toBe('compact');
  });
  test('unmount before key derivation cannot access storage later', async () => {
    const delayed = deferred(); environment.createKey = () => delayed.promise;
    await render();
    await act(async () => model.update({ layout: 'list' }));
    await act(async () => root.render(<p>unmounted</p>));
    await act(async () => { delayed.resolve(keyA); await pause(); });
    expect(environment.getStorage).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });
});
