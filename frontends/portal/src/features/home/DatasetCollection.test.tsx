import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import DatasetCollection from './DatasetCollection';
import type { Dataset } from './api';

const datasets: Dataset[] = [
  {
    id: 'a',
    name: '腹部资料',
    access: 'owner',
    ownerUsername: '创建者甲',
    instanceCount: 0,
    createdAt: '2026-11-01T02:00:00Z',
  },
  {
    id: 'b',
    name: '跨中心联合研究的较长中文资料名称',
    access: 'shared',
    ownerUsername: '创建者乙',
    instanceCount: 1248,
    createdAt: '2026-10-31T02:00:00Z',
  },
];

describe('dataset presentation without business-state ownership', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const props = () => ({
    datasets,
    layout: 'cards' as const,
    density: 'comfortable' as const,
    grouped: false,
    fields: { owner: true, instances: true, createdAt: true },
    selectedId: 'b',
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onAction: vi.fn(),
    registerTrigger: vi.fn(),
  });
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  test.each(['cards', 'list'] as const)(
    '%s renders the same identities, honest zero and creation dates',
    (layout) => {
      const values = { ...props(), layout };
      act(() => root.render(<DatasetCollection {...values} />));
      expect(host.querySelectorAll('[data-cy="home-dataset-row"]')).toHaveLength(2);
      expect(host.textContent).toContain('我拥有的');
      expect(host.textContent).toContain('与我共享');
      expect(host.textContent).toContain('1,248');
      expect(host.textContent).toContain('0');
      expect(host.querySelector('time')?.getAttribute('datetime')).toBe(datasets[0].createdAt);
      expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
      const selectors = host.querySelectorAll<HTMLButtonElement>('[data-cy="home-dataset-select"]');
      act(() => selectors[1].click());
      expect(values.onSelect).toHaveBeenCalledWith('b', selectors[1]);
      act(() => host.querySelector<HTMLButtonElement>('[data-cy="home-row-open"]')!.click());
      expect(values.onOpen).toHaveBeenCalledWith(datasets[0]);
    }
  );

  test.each(['cards', 'list'] as const)(
    '%s can hide optional fields while keeping name, source and actions',
    (layout) => {
      act(() =>
        root.render(
          <DatasetCollection
            {...props()}
            layout={layout}
            fields={{ owner: false, instances: false, createdAt: false }}
          />
        )
      );
      expect(host.textContent).not.toContain('创建者甲');
      expect(host.textContent).not.toContain('1,248');
      expect(host.querySelector('time')).toBeNull();
      expect(host.textContent).toContain('腹部资料');
      expect(host.textContent).toContain('与我共享');
      expect(host.querySelectorAll('[data-cy="home-row-open"]')).toHaveLength(2);
    }
  );

  test('grouping and presentation changes do not mutate input or selection', () => {
    const original = JSON.stringify(datasets);
    const values = props();
    act(() => root.render(<DatasetCollection {...values} grouped />));
    expect(host.querySelectorAll('.mc-resource-index-section')).toHaveLength(2);
    act(() =>
      root.render(<DatasetCollection {...values} layout="list" density="compact" grouped />)
    );
    expect(host.querySelectorAll('.mc-resource-table-group')).toHaveLength(2);
    expect(host.querySelector('[aria-pressed="true"] strong')?.textContent).toBe(datasets[1].name);
    expect(values.onOpen).not.toHaveBeenCalled();
    expect(values.onAction).not.toHaveBeenCalled();
    expect(JSON.stringify(datasets)).toBe(original);
  });
  test('each source heading scopes only its actual tbody resource group', () => {
    act(() => root.render(<DatasetCollection {...props()} layout="list" grouped />));
    const bodies = [...host.querySelectorAll('tbody')];
    expect(bodies).toHaveLength(2);
    expect(bodies[0].querySelector('th[scope="rowgroup"]')?.textContent).toContain('我拥有的');
    expect(bodies[1].querySelector('th[scope="rowgroup"]')?.textContent).toContain('与我共享');
    bodies.forEach((body, index) => {
      expect(body.querySelectorAll('[data-cy="home-dataset-row"]')).toHaveLength(1);
      expect(body.querySelector('[data-cy="home-dataset-select"] strong')?.textContent).toBe(
        datasets[index].name
      );
    });
  });
});
