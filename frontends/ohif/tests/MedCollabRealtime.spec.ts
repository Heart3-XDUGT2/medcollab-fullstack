import { test as ohifTest, expect, waitForViewportsRendered } from './utils';
import { ViewportPageObject, MainToolbarPageObject } from './pages';
import { MedCollabWorkspacePageObject } from './pages/MedCollabWorkspacePageObject';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const runtime = process.env.MEDCOLLAB_E2E_RUNTIME || '';
const test = ohifTest.extend<{
  workspace: MedCollabWorkspacePageObject;
  peer: {
    workspace: MedCollabWorkspacePageObject;
    viewports: ViewportPageObject;
    toolbar: MainToolbarPageObject;
  };
}>({
  context: async ({ browser }, use) => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
  workspace: async ({ page }, use) => {
    await use(new MedCollabWorkspacePageObject(page));
  },
  peer: async ({ browser }, use) => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    try {
      await use({
        workspace: new MedCollabWorkspacePageObject(page),
        viewports: new ViewportPageObject(page),
        toolbar: new MainToolbarPageObject(page),
      });
    } finally {
      await context.close();
    }
  },
});

test.skip(
  process.env.MEDCOLLAB_E2E_ENABLED !== '1' || !runtime,
  'Requires isolated QA runtime and temporary accounts.'
);

test('two CT viewers show every committed stroke after display events and after reconnecting', async ({
  page,
  workspace,
  peer,
  viewportPageObject,
  mainToolbarPageObject,
}) => {
  const fixture = JSON.parse(await readFile(path.join(runtime, 'accounts.json'), 'utf8'));
  expect(new URL(fixture.origin).port).not.toBe('8080');
  const evidence = path.join(runtime, 'evidence');
  await mkdir(evidence, { recursive: true });
  await workspace.login(fixture.origin, fixture.users[0]);
  await peer.workspace.login(fixture.origin, fixture.users[1]);
  const launch = await (
    await page.request.get(fixture.origin + '/api/datasets/qa-broadcast/workspace')
  ).json();
  const series = launch.series[0];
  expect(series.instanceCount).toBeGreaterThan(1);
  const query = new URLSearchParams({
    datasetId: 'qa-broadcast',
    seriesId: series.id,
    StudyInstanceUIDs: series.studyInstanceUID,
    SeriesInstanceUIDs: series.seriesInstanceUID,
  });
  const url = fixture.origin + '/imaging/medcollab/medcollab?' + query;
  await Promise.all([workspace.open(url), peer.workspace.open(url)]);
  await expect(workspace.bar).toContainText('按切片自动获取编辑权');
  const cleared = await page.evaluate(async () => {
    const w = (window as any).services.datasetWorkspaceService;
    if (!w.capture().masks.length) return null;
    await w.reliable.acquireSlices(w.sources.map(s => s.id));
    const seq = w.state.operationSeq;
    const { cornerstone, cornerstoneTools } = w.libraries();
    for (const id of cornerstoneTools.segmentation.getLabelmapImageIds(w.segmentationId))
      cornerstone.cache.getImage(id).getPixelData().fill(0);
    cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(w.segmentationId);
    return seq;
  });
  if (cleared !== null) { await workspace.waitSynced(cleared + 1); await peer.workspace.waitSynced(cleared + 1); }
  await mainToolbarPageObject.layoutSelection.MPR.click();
  await peer.toolbar.layoutSelection.MPR.click();
  await waitForViewportsRendered(page, { timeout: 30000 });
  await waitForViewportsRendered(peer.workspace.page, { timeout: 30000 });
  await workspace.brush.click();
  const viewport = await viewportPageObject.active;
  const peerViewport = await peer.viewports.active;
  const canvas = viewport.pane.locator('canvas.cornerstone-canvas').first();
  const peerCanvas = peerViewport.pane.locator('canvas.cornerstone-canvas').first();
  const checks: object[] = [];
  let prior = 0;
  let finalViews: number[][] = [];
  for (let i = 1; i <= 3; i++) {
    const before = await page.evaluate(() => (window as any).services.datasetWorkspaceService.state.operationSeq);
    // Reproduce the observer's active-label/presentation event before the next broadcast.
    await peer.workspace.page.evaluate(() => {
      const w = (window as any).services.datasetWorkspaceService;
      w.libraries().cornerstoneTools.segmentation.triggerSegmentationEvents.triggerSegmentationModified(
        w.segmentationId
      );
    });
    await viewport.normalizedDragAt({
      start: { x: 0.35 + i * 0.07, y: 0.38 + i * 0.08 },
      end: { x: 0.42 + i * 0.07, y: 0.42 + i * 0.08 },
    });
    await page.mouse.move(5, 5);
    await peer.workspace.page.mouse.move(5, 5);
    await workspace.waitSynced(before + 1);
    const seq = await page.evaluate(
      () => (window as any).services.datasetWorkspaceService.state.operationSeq
    );
    await peer.workspace.waitSynced(seq);
    await waitForViewportsRendered(page);
    await waitForViewportsRendered(peer.workspace.page);
    const drawn = await workspace.paintedPixels(
      canvas,
      path.join(evidence, 'editor-' + i + '.png')
    );
    expect(drawn.length).toBeGreaterThan(prior);
    await expect(async () => {
      expect(await peer.workspace.paintedPixels(peerCanvas, path.join(evidence, 'observer-' + i + '.png'))).toEqual(drawn);
    }).toPass({ timeout: 10000 });
    await peer.workspace.paintedPixels(peerCanvas, path.join(evidence, 'observer-' + i + '.png'));
    const viewCount = await workspace.renderedCanvases.count();
    expect(viewCount).toBe(3);
    finalViews = [];
    for (let view = 0; view < viewCount; view++) {
      const expected = await workspace.paintedPixels(workspace.renderedCanvases.nth(view), path.join(evidence, `editor-${i}-view-${view}.png`));
      await expect(async () => {
        expect(await peer.workspace.paintedPixels(peer.workspace.renderedCanvases.nth(view), path.join(evidence, `observer-${i}-view-${view}.png`))).toEqual(expected);
      }).toPass({timeout:10000});
      finalViews.push(expected);
    }
    checks.push({ stroke: i, seq, paintedPixels: drawn.length, renderedMasksEqual: true, matchedMPRViews: viewCount });
    prior = drawn.length;
  }
  await expect(peer.workspace.bar).not.toContainText('本机草稿待处理');
  await expect(peer.workspace.bar).not.toContainText('存在差异');
  await peer.workspace.page.reload();
  await peer.workspace.page.waitForFunction(
    () => (window as any).services?.datasetWorkspaceService.reliable?.initialized,
    null,
    { timeout: 120000 }
  );
  await peer.workspace.waitSynced(3);
  await expect(peer.workspace.bar).not.toContainText('本机草稿待处理');
  await peer.toolbar.layoutSelection.MPR.click();
  await waitForViewportsRendered(peer.workspace.page);
  for (let view = 0; view < finalViews.length; view++) {
    await expect(async () => {
      expect(await peer.workspace.paintedPixels(peer.workspace.renderedCanvases.nth(view), path.join(evidence, `observer-reloaded-view-${view}.png`))).toEqual(finalViews[view]);
    }).toPass({timeout:10000});
  }
  await writeFile(
    path.join(runtime, 'verification.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        isolatedDatabase: true,
        realCT: true,
        independentAccounts: 2,
        checks,
        reloadRecovered: true,
      },
      null,
      2
    )
  );
  await workspace.releaseIfHeld();
});

test('different CT slices can be drawn concurrently and the same slice rejects the second editor', async ({
  page, workspace, peer, viewportPageObject,
}) => {
  const fixture = JSON.parse(await readFile(path.join(runtime, 'accounts.json'), 'utf8'));
  await workspace.login(fixture.origin, fixture.users[0]);
  await peer.workspace.login(fixture.origin, fixture.users[1]);
  const launch = await (await page.request.get(fixture.origin + '/api/datasets/qa-broadcast/workspace')).json();
  const series = launch.series[0];
  const url = fixture.origin + '/imaging/medcollab/medcollab?' + new URLSearchParams({
    datasetId: 'qa-broadcast', seriesId: series.id,
    StudyInstanceUIDs: series.studyInstanceUID, SeriesInstanceUIDs: series.seriesInstanceUID,
  });
  await Promise.all([workspace.open(url),peer.workspace.open(url)]);
  await expect(workspace.bar).toContainText('按切片自动获取编辑权');
  const a = await viewportPageObject.active;
  const b = await peer.viewports.active;
  await a.sliceNavigation.toSlice(40);
  await b.sliceNavigation.toSlice(90);
  await workspace.brush.click();
  await peer.workspace.brush.click();
  const before = await page.evaluate(() => (window as any).services.datasetWorkspaceService.state.operationSeq);
  await Promise.all([
    a.normalizedDragAt({ start:{x:0.43,y:0.47},end:{x:0.56,y:0.54} }),
    b.normalizedDragAt({ start:{x:0.52,y:0.49},end:{x:0.63,y:0.53} }),
  ]);
  await Promise.all([workspace.waitSynced(before+2),peer.workspace.waitSynced(before+2)]);
  await page.mouse.move(5,5);await peer.workspace.page.mouse.move(5,5);
  const evidence = path.join(runtime,'evidence');
  const canvasA = a.pane.locator('canvas.cornerstone-canvas').first();
  const canvasB = b.pane.locator('canvas.cornerstone-canvas').first();
  const pixels40 = await workspace.paintedPixels(canvasA,path.join(evidence,'concurrent-editor-slice40.png'));
  const pixels90 = await peer.workspace.paintedPixels(canvasB,path.join(evidence,'concurrent-peer-slice90.png'));
  expect(pixels40.length).toBeGreaterThan(100);
  expect(pixels90.length).toBeGreaterThan(100);
  await b.sliceNavigation.toSlice(40);
  await expect(async () => expect(await peer.workspace.paintedPixels(canvasB)).toEqual(pixels40)).toPass({timeout:10000});
  await b.normalizedDragAt({start:{x:0.36,y:0.44},end:{x:0.45,y:0.55}});
  await expect(peer.workspace.bar).toContainText('正在编辑，可切换到其他切片');
  await peer.workspace.page.mouse.move(5,5);
  expect(await peer.workspace.paintedPixels(canvasB,path.join(evidence,'same-slice-blocked.png'))).toEqual(pixels40);
  await expect(peer.workspace.bar).not.toContainText('本机草稿待处理');
  await a.sliceNavigation.toSlice(90);
  await expect(async () => expect(await workspace.paintedPixels(canvasA,path.join(evidence,'concurrent-editor-sees-slice90.png'))).toEqual(pixels90)).toPass({timeout:10000});
  await b.sliceNavigation.toSlice(91);
  const seq = await page.evaluate(() => (window as any).services.datasetWorkspaceService.state.operationSeq);
  await b.normalizedDragAt({start:{x:0.5,y:0.46},end:{x:0.58,y:0.56}});
  await peer.workspace.waitSynced(seq+1);
  await expect(peer.workspace.bar).not.toContainText('正在编辑，可切换到其他切片');
  await workspace.releaseIfHeld();
  await peer.workspace.releaseIfHeld();
  await peer.workspace.page.reload();
  await peer.workspace.page.waitForFunction(() => (window as any).services?.datasetWorkspaceService.reliable?.initialized,null,{timeout:120000});
  const reloaded = await peer.viewports.active;
  await reloaded.sliceNavigation.toSlice(40);
  await expect(async () => expect(await peer.workspace.paintedPixels(reloaded.pane.locator('canvas.cornerstone-canvas').first(),path.join(evidence,'concurrent-reloaded-slice40.png'))).toEqual(pixels40)).toPass({timeout:10000});
  await writeFile(path.join(runtime,'slice-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),
    realCT:true,independentAccounts:2,concurrentSlices:[40,90],sameSliceBlocked:true,
    anotherSliceStillWritable:true,bothMasksVisible:true,reloadRecovered:true},null,2));
});
