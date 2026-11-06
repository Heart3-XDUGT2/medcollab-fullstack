import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import DatasetCoverage from './DatasetCoverage';
import { useAnnotationStatistics } from './hooks';
import { StatisticsModel } from './store';
import type { StatisticsOptions } from './store';
import { makeSyntheticDatasetStatistics } from './contract';
import {
  dataset,
  deferred,
  flush,
  identity,
  json,
  normalFetch,
  realOptions,
  resource,
  session,
} from './testSupport';

let host: HTMLDivElement, root: Root;
const models: StatisticsModel[] = [];
function render(ui: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(ui));
}
async function settle() {
  await act(async () => {
    await flush();
  });
}
function demo(data = dataset()) {
  const model = new StatisticsModel(
    realOptions(normalFetch(), { mode: 'demo', demoData: { [data.datasetId]: data } })
  );
  models.push(model);
  model.start();
  return model;
}
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  models.splice(0).forEach((model) => model.dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
class ViewportObserver {
  static instances: ViewportObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: IntersectionObserverCallback) {
    ViewportObserver.instances.push(this);
  }
  set(near: boolean) {
    this.callback(
      [{ isIntersecting: near } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

describe('statistics React lifecycle and presentation', () => {
  test('desk draws current and archive from the same snapshot without inferring pending from counts', async () => {
    const model = demo(makeSyntheticDatasetStatistics('d', {
      totalSlices: 10, annotatedSlices: 4, publishedAnnotatedSlices: 3, pendingArchive: false,
    }));
    render(<DatasetCoverage model={model} datasetId="d" variant="desk" showArchive active />);
    await settle();
    expect((host.querySelector('.mc-desk-coverage-track > span') as HTMLElement).style.width).toBe('40%');
    expect((host.querySelector('.mc-desk-coverage-track > i') as HTMLElement).style.left).toBe('30%');
    expect(host.querySelector('summary')!.textContent).toContain('4 / 10 帧');
    expect(host.querySelector('summary')!.textContent).toContain('已归档 3 / 10 帧');
    expect(host.querySelector('summary')!.textContent).toContain('无待归档操作');
    act(() => root.render(<DatasetCoverage model={demo(dataset('d', 0, 0, 0))} datasetId="d" variant="desk" active />));
    await settle();
    expect(host.querySelector('.mc-desk-coverage-track')).toBeNull();
    expect(host.querySelector('summary')!.textContent).toContain('无可标注 CT');
  });
  test('compact starts with readable coverage summary and opt-in complete details', async () => {
    const fetchImpl = normalFetch();
    function Page() {
      const model = useAnnotationStatistics(realOptions(fetchImpl));
      return <DatasetCoverage model={model} datasetId="d" active />;
    }
    render(<Page />);
    await settle();
    const disclosure = host.querySelector('details')!;
    const summary = disclosure.querySelector('summary')!;
    expect(disclosure.open).toBe(false);
    expect(summary.textContent).toContain('共享画布 40%');
    expect(summary.textContent).toContain('已归档 30%');
    expect(summary.textContent).toContain('待归档');
    expect(summary.textContent).not.toContain('4 / 10');
    const readsBefore = fetchImpl.mock.calls.length;
    act(() => summary.click());
    expect(disclosure.open).toBe(true);
    expect(disclosure.textContent).toContain('4 / 10 帧');
    expect(disclosure.textContent).toContain('3 / 10 帧');
    expect(disclosure.textContent).toContain('不代表医学质量或审核结论');
    expect(disclosure.querySelector('button')?.getAttribute('aria-label')).toBe('重新读取统计');
    act(() => summary.click());
    await settle();
    expect(disclosure.open).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(readsBefore);
  });
  test('compact keeps no-CT, unpublished, synthetic and archive-error meanings in summary', async () => {
    const model = demo(dataset('d', 0, 0, 0));
    render(<DatasetCoverage model={model} datasetId="d" active />);
    await settle();
    expect(host.querySelector('summary')!.textContent).toContain('无可标注 CT');
    expect(host.querySelector('summary')!.textContent).toContain('合成示例');
    const noPublication = demo(dataset('d', 4, 0));
    act(() => root.render(<DatasetCoverage model={noPublication} datasetId="d" active />));
    await settle();
    expect(host.querySelector('summary')!.textContent).toContain('尚未发布 SEG');
    expect(host.querySelector('summary')!.textContent).not.toContain('已归档 0%');
    const failedData = dataset();
    const failed = demo({
      ...failedData,
      series: [{ ...failedData.series[0], archiveError: 'PRIVATE' }],
    });
    act(() => root.render(<DatasetCoverage model={failed} datasetId="d" active />));
    await settle();
    expect(host.querySelector('summary')!.textContent).toContain('归档异常');
    expect(host.querySelector('summary')!.textContent).not.toContain('PRIVATE');
  });
  test('detail remains fully expanded with no disclosure or summary-only presentation', async () => {
    render(<DatasetCoverage model={demo()} datasetId="d" variant="detail" active />);
    await settle();
    expect(host.querySelector('details')).toBeNull();
    expect(host.querySelector('.mc-coverage-heading')!.textContent).toContain('CT 帧覆盖率');
    expect(host.textContent).toContain('4 / 10 帧');
    expect(host.textContent).toContain('统计生成于');
  });
  test('StrictMode and duplicate dataset controls share the live model', async () => {
    const fetchImpl = normalFetch();
    function Page() {
      const model = useAnnotationStatistics(realOptions(fetchImpl));
      return (
        <>
          <DatasetCoverage model={model} datasetId="d" variant="desk" showArchive active />
          <DatasetCoverage model={model} datasetId="d" variant="desk" active />
        </>
      );
    }
    render(
      <StrictMode>
        <Page />
      </StrictMode>
    );
    await settle();
    expect(host.querySelectorAll('[data-status="ready"]')).toHaveLength(2);
    expect(
      fetchImpl.mock.calls.filter(([path]) => String(path).includes('annotation-stats'))
    ).toHaveLength(1);
    expect(host.textContent).toContain('4 / 10 帧');
    expect(host.textContent).toContain('3 / 10 帧');
    expect(host.textContent).toContain('有操作待归档');
  });
  test('default waits for viewport, leaves cancel interest; active=false never reads', async () => {
    ViewportObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', ViewportObserver);
    const fetchImpl = normalFetch();
    function Page() {
      const model = useAnnotationStatistics(realOptions(fetchImpl));
      return (
        <>
          <DatasetCoverage model={model} datasetId="d" />
          <DatasetCoverage model={model} datasetId="hidden" active={false} />
        </>
      );
    }
    render(<Page />);
    await settle();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ViewportObserver.instances).toHaveLength(1);
    act(() => ViewportObserver.instances[0].set(true));
    await settle();
    expect(
      fetchImpl.mock.calls.filter(([path]) => String(path).includes('annotation-stats'))
    ).toHaveLength(1);
    expect(host.querySelectorAll('button')).toHaveLength(1);
  });
  test('viewport leave and quick return resumes a cancelled read after one cooldown', async () => {
    vi.useFakeTimers();
    ViewportObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', ViewportObserver);
    const late = deferred<Response>();
    let count = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (path) =>
      path === '/api/health'
        ? json({ annotationStatsApi: 'v1' })
        : ++count === 1
          ? late.promise
          : json(dataset())
    );
    function Page() {
      const model = useAnnotationStatistics(realOptions(fetchImpl));
      return <DatasetCoverage model={model} datasetId="d" />;
    }
    render(<Page />);
    const observer = ViewportObserver.instances[0];
    act(() => observer.set(true));
    await settle();
    act(() => observer.set(false));
    await settle();
    act(() => observer.set(true));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
    });
    expect(count).toBe(2);
    expect(host.querySelector('[data-status="ready"]')).not.toBeNull();
    late.resolve(json(dataset('d', 9)));
    await settle();
    expect(host.textContent).toContain('4 / 10 帧');
    expect(host.textContent).not.toContain('9 / 10 帧');
  });
  test('changing account never paints previous account values; callbacks do not reset model', async () => {
    const getSession = vi.fn(session),
      fetchImpl = normalFetch();
    let latest: StatisticsModel | undefined;
    function Page({
      account = identity,
      callback = () => {},
    }: {
      account?: typeof identity;
      callback?: StatisticsOptions['onAccessIssue'];
    }) {
      const model = useAnnotationStatistics(
        realOptions(fetchImpl, {
          identity: account,
          sessionApi: { getSession },
          onAccessIssue: callback,
        })
      );
      latest = model;
      return <DatasetCoverage model={model} datasetId="d" active />;
    }
    render(<Page />);
    await settle();
    const first = latest;
    act(() => root.render(<Page callback={vi.fn()} />));
    await settle();
    expect(latest).toBe(first);
    expect(host.textContent).toContain('4 / 10 帧');
    const late = deferred<Awaited<ReturnType<typeof session>>>();
    getSession.mockImplementation(() => late.promise);
    act(() => root.render(<Page account={{ ...identity, subject: 'next' }} />));
    expect(latest).not.toBe(first);
    expect(host.textContent).not.toContain('4 / 10 帧');
    expect(first!.getSnapshot(resource()).data).toBeNull();
    late.resolve({ loggedIn: true, ...identity, subject: 'next' });
    await settle();
  });
  test('demo and empty CT states are explicit; archive errors are not raw server strings', async () => {
    const model = demo(dataset('d', 0, 0, 0));
    render(<DatasetCoverage model={model} datasetId="d" variant="detail" active />);
    await settle();
    expect(host.textContent).toContain('合成示例');
    expect(host.textContent).toContain('覆盖率不适用');
    expect(host.textContent).not.toContain('100%');
    const withError = dataset();
    const failed = demo({
      ...withError,
      series: [{ ...withError.series[0], archiveError: 'PRIVATE PATH <script>' }],
    });
    act(() => root.render(<DatasetCoverage model={failed} datasetId="d" active />));
    await settle();
    expect(host.textContent).toContain('归档异常');
    expect(host.textContent).not.toContain('PRIVATE');
  });
  test('manual reread preserves old counts visibly and uses a real keyboard button', async () => {
    const fetchImpl = normalFetch(),
      late = deferred<Response>();
    function Page() {
      const model = useAnnotationStatistics(realOptions(fetchImpl));
      return <DatasetCoverage model={model} datasetId="d" active variant="detail" />;
    }
    render(<Page />);
    await settle();
    fetchImpl.mockImplementationOnce(() => late.promise);
    const button = host.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('重新读取统计');
    act(() => button.click());
    await settle();
    expect(host.textContent).toContain('4 / 10 帧');
    expect(host.textContent).toContain('暂显示上次结果');
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    late.resolve(json({}, 423));
    await settle();
    expect(host.textContent).toContain('上次结果，尚未更新');
    expect(host.textContent).toContain('统计版本正在变化');
  });
  test('changing dataset under the same DOM element needs its own viewport signal', async () => {
    ViewportObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', ViewportObserver);
    const fetchImpl = normalFetch();
    function Page({ id }: { id: string }) {
      const model = useAnnotationStatistics(realOptions(fetchImpl));
      return <DatasetCoverage model={model} datasetId={id} />;
    }
    render(<Page id="d" />);
    act(() => ViewportObserver.instances[0].set(true));
    await settle();
    act(() => root.render(<Page id="other" />));
    await settle();
    expect(fetchImpl.mock.calls.some(([path]) => String(path).includes('/other/'))).toBe(false);
    act(() => ViewportObserver.instances[1].set(true));
    await settle();
    expect(fetchImpl.mock.calls.some(([path]) => String(path).includes('/other/'))).toBe(true);
  });
});
