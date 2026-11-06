import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, test, vi } from 'vitest';
import { ApiError, createHomeApi, type Dataset, type HomeApi } from './api';
import DeleteDatasetPanel from './DeleteDatasetPanel';

const identity = { issuer: 'https://accounts.example.test', subject: 'alice' };
const config = { apiEnabled: true, authOrigin: null, logoutOrigins: [], workspacePath: null, publicSamplePath: null };
const session = { loggedIn: true, username: 'alice', ...identity, csrfHeaderName: 'X-FRESH-CSRF', csrfToken: 'fixture' };
const response = (value: unknown, status = 200) => ({ status, json: async () => value });
const dataset: Dataset = { id: 'fixture-dataset', name: '合成影像', access: 'owner', ownerUsername: 'alice', instanceCount: 1, createdAt: '2026-11-06T00:00:00Z', canDelete: true };

describe('personal deletion and unsupported import boundary', () => {
  test('DELETE gets a fresh session, retains CSRF and never retries an unknown result', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(session)).mockRejectedValueOnce(new TypeError('offline'));
    const api = createHomeApi(config, fetcher as any);
    await expect(api.deleteDataset(dataset.id, identity)).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe('/api/datasets/fixture-dataset');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'DELETE', credentials: 'same-origin', headers: { 'X-FRESH-CSRF': 'fixture' } });
  });
  test('account switch prevents DELETE even if the UI had permission', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ ...session, subject: 'bob' }));
    await expect(createHomeApi(config, fetcher as any).deleteDataset(dataset.id, identity)).rejects.toMatchObject({ kind: 'identity-changed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test('the import adapter rejects NIfTI without fetching a session or uploading', async () => {
    const fetcher = vi.fn();
    await expect(createHomeApi(config, fetcher as any).importFile(dataset.id, new File(['x'], 'CT.NII.GZ'), identity)).rejects.toMatchObject({ status: 415 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('unknown deletion blocks repeat confirmation and does not report success', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const remove = vi.fn().mockRejectedValue(new ApiError('network', 0));
    const onDeleted = vi.fn();
    try {
      await act(async () => root.render(<DeleteDatasetPanel dataset={dataset} api={{ deleteDataset: remove } as unknown as HomeApi} identity={identity} scopeSignal={new AbortController().signal} onBusyChange={() => {}} onDeleted={onDeleted} onClose={() => {}} onBlocked={() => {}} />));
      await act(async () => host.querySelector<HTMLButtonElement>('[data-cy="home-delete-confirm"]')!.click());
      expect(host.textContent).toContain('删除结果尚未确认');
      expect(host.querySelector<HTMLButtonElement>('[data-cy="home-delete-confirm"]')!.disabled).toBe(true);
      expect(remove).toHaveBeenCalledTimes(1); expect(onDeleted).not.toHaveBeenCalled();
    } finally { act(() => root.unmount());host.remove(); }
  });
});
