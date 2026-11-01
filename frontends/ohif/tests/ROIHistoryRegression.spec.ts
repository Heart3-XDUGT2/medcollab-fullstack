import {
  checkForScreenshot,
  expect,
  screenShotPaths,
  test,
  visitStudy,
  waitForViewportsRendered,
} from './utils';
import { press } from './utils/keyboardUtils';

const errors = new WeakMap<object, string[]>();

test.beforeEach(async ({ page, leftPanelPageObject, viewportPageObject, DOMOverlayPageObject }, testInfo) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await visitStudy(
    page,
    '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5',
    'viewer',
    2000
  );
  if (await DOMOverlayPageObject.investigationalUse.button.isVisible()) {
    await DOMOverlayPageObject.investigationalUse.click();
    await expect(DOMOverlayPageObject.investigationalUse.button).toBeHidden();
  }
  await leftPanelPageObject.loadSeriesBySeriesNumber(2);
  const viewport = await viewportPageObject.active;
  await expect(viewport.overlayText.topLeft.locator).toContainText('Body 3.0 CE');
  await waitForViewportsRendered(page);
  const fingerprint = await page.evaluate(() => {
    const w = window as any;
    return {
      historyStart: w.cornerstone.utilities.HistoryMemo.HistoryMemo.prototype.startGroupRecording.toString(),
      arrowCancel: w.cornerstoneTools.ArrowAnnotateTool.prototype._cancelAnnotationGroup?.toString(),
      scripts: performance.getEntriesByType('resource')
        .map(entry => entry.name).filter(name => /\.js(?:\?|$)/.test(name)),
    };
  });
  await testInfo.attach('isolated-runtime-fingerprint', {
    body: JSON.stringify(fingerprint, null, 2),
    contentType: 'application/json',
  });
  expect(fingerprint.historyStart).toContain('groupOwners');
  expect(fingerprint.arrowCancel).toContain('endGroupRecording');
});

test('undo cancels pending arrow text without touching an older annotation or a newer owner', async ({
  page,
  DOMOverlayPageObject,
  mainToolbarPageObject,
  viewportPageObject,
}) => {
  const viewport = await viewportPageObject.active;
  await mainToolbarPageObject.measurementTools.arrowAnnotate.click();
  await viewport.normalizedDragAt({
    start: { x: 0.25, y: 0.25 },
    end: { x: 0.4, y: 0.25 },
    config: { steps: 10 },
  });
  await DOMOverlayPageObject.dialog.input.fillAndSave('Earlier annotation');
  await DOMOverlayPageObject.viewport.measurementTracking.confirm.click();
  await mainToolbarPageObject.measurementTools.arrowAnnotate.click();
  const earlierLines = await viewport.svg('line').count();

  // Hold the real tool's asynchronous text callback without a modal blocking
  // the undo button. All annotation/undo interactions below still use the UI.
  await page.evaluate(() => {
    const w = window as any;
    w.__roiTextCallbacks = [];
    const group = w.cornerstoneTools.ToolGroupManager.getAllToolGroups()
      .find(group => group.getToolInstance('ArrowAnnotate'));
    group.getToolInstance('ArrowAnnotate').configuration.getTextCallback =
      done => w.__roiTextCallbacks.push(done);
  });
  await viewport.normalizedDragAt({
    start: { x: 0.3, y: 0.7 },
    end: { x: 0.45, y: 0.7 },
    config: { steps: 10 },
  });
  await expect(viewport.svg('line')).toHaveCount(earlierLines + 3);
  await mainToolbarPageObject.undo.click();
  await expect(viewport.annotations).toHaveCount(1);
  await expect(viewport.svg('line')).toHaveCount(earlierLines);
  await expect(viewport.nthAnnotation(0).text.locator).toContainText('Earlier annotation');

  await viewport.normalizedDragAt({
    start: { x: 0.45, y: 0.65 },
    end: { x: 0.6, y: 0.65 },
    config: { steps: 10 },
  });
  await page.evaluate(() => (window as any).__roiTextCallbacks[0]('Late cancelled text'));
  await expect(viewport.svg('line')).toHaveCount(earlierLines + 3);
  await page.evaluate(() => (window as any).__roiTextCallbacks[1]('New annotation'));
  await expect(viewport.nthAnnotation(1).text.locator).toContainText('New annotation');
  await mainToolbarPageObject.undo.click();
  await expect(viewport.annotations).toHaveCount(1);
  await expect(viewport.nthAnnotation(0).text.locator).toContainText('Earlier annotation');
  await mainToolbarPageObject.redo.click();
  await expect(viewport.annotations).toHaveCount(2);
  await expect(viewport.nthAnnotation(1).text.locator).toContainText('New annotation');
});

test.afterEach(async ({ page }, testInfo) => {
  const diagnostic = await page.evaluate(() => {
    const w = window as any;
    const history = w.cornerstone?.utilities.HistoryMemo.DefaultHistoryMemo;
    return history && {
      position: history.position,
      undoAvailable: history.undoAvailable,
      redoAvailable: history.redoAvailable,
      recording: history.isRecordingGrouped,
      owners: history.groupOwners.map(owner => ({ active: owner.active })),
      ring: history.ring.map(item =>
        Array.isArray(item) ? item.map(memo => memo.id) : item?.id),
      annotations: w.cornerstoneTools.annotation.state.getAllAnnotations()
        .map(annotation => ({
          uid: annotation.annotationUID,
          label: annotation.data.label,
          tool: annotation.metadata.toolName,
        })),
    };
  });
  await testInfo.attach('history-diagnostic', {
    body: JSON.stringify(diagnostic, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('page-errors', {
    body: JSON.stringify(errors.get(page), null, 2),
    contentType: 'application/json',
  });
  expect(errors.get(page)).toEqual([]);
});

test('cancelled arrows never return on redo and Livewire keeps earlier history', async ({
  page,
  DOMOverlayPageObject,
  mainToolbarPageObject,
  viewportPageObject,
}) => {
  const viewport = await viewportPageObject.active;
  await mainToolbarPageObject.measurementTools.arrowAnnotate.click();
  await viewport.normalizedDragAt({
    start: { x: 0.25, y: 0.25 },
    end: { x: 0.4, y: 0.25 },
    config: { steps: 10 },
  });
  await DOMOverlayPageObject.dialog.input.fillAndSave('Earlier annotation');
  await DOMOverlayPageObject.viewport.measurementTracking.confirm.click();
  await expect(viewport.annotations).toHaveCount(1);
  await expect(viewport.nthAnnotation(0).text.locator).toContainText('Earlier annotation');

  for (let i = 0; i < 3; i++) {
    await mainToolbarPageObject.measurementTools.arrowAnnotate.click();
    await viewport.normalizedDragAt({
      start: { x: 0.3, y: 0.7 },
      end: { x: 0.45, y: 0.7 },
      config: { steps: 10 },
    });
    if (i === 0) {
      await DOMOverlayPageObject.dialog.input.cancel();
    } else if (i === 1) {
      await press({ page, key: 'Escape' });
    } else {
      await DOMOverlayPageObject.dialog.input.close();
    }
    await expect(DOMOverlayPageObject.dialog.input.locator).toBeHidden();
    await expect(viewport.annotations).toHaveCount(1);
  }

  for (let i = 0; i < 3; i++) {
    await viewport.normalizedDoubleClickAt({ x: 0.32, y: 0.25 });
    await DOMOverlayPageObject.dialog.input.fill('Unaccepted replacement');
    if (i === 0) {
      await DOMOverlayPageObject.dialog.input.cancel();
    } else if (i === 1) {
      await press({ page, key: 'Escape' });
    } else {
      await DOMOverlayPageObject.dialog.input.close();
    }
    await expect(DOMOverlayPageObject.dialog.input.locator).toBeHidden();
    await expect(viewport.nthAnnotation(0).text.locator).toContainText('Earlier annotation');
  }

  // Once cancellation has finished, explicit undo targets the prior completed
  // annotation. Redo must restore only that annotation, never a cancelled arrow.
  await mainToolbarPageObject.undo.click();
  await expect(viewport.annotations).toHaveCount(0);
  await mainToolbarPageObject.redo.click();
  await expect(viewport.annotations).toHaveCount(1);
  await expect(viewport.nthAnnotation(0).text.locator).toContainText('Earlier annotation');

  await mainToolbarPageObject.measurementTools.livewireContour.click();
  await viewport.normalizedClickAt([
    { x: 0.4, y: 0.45 },
    { x: 0.5, y: 0.4 },
    { x: 0.6, y: 0.45 },
    { x: 0.6, y: 0.6 },
    { x: 0.45, y: 0.6 },
    { x: 0.4, y: 0.45 },
  ]);
  await expect(viewport.annotations).toHaveCount(2);

  for (let i = 0; i < 3; i++) {
    await mainToolbarPageObject.undo.click();
    await expect(viewport.annotations).toHaveCount(1);
    await expect(viewport.nthAnnotation(0).text.locator).toContainText('Earlier annotation');
    await mainToolbarPageObject.redo.click();
    await expect(viewport.annotations).toHaveCount(2);
  }
  await checkForScreenshot({
    page,
    locator: viewport.pane,
    screenshotPath: screenShotPaths.roiHistory.livewireAfterArrowCancel,
  });
});

test('switching away from an unfinished arrow leaves freehand and undo usable', async ({
  page,
  DOMOverlayPageObject,
  mainToolbarPageObject,
  viewportPageObject,
}) => {
  const viewport = await viewportPageObject.active;
  await mainToolbarPageObject.measurementTools.arrowAnnotate.click();
  await viewport.normalizedClickAt([{ x: 0.7, y: 0.35 }]);
  await mainToolbarPageObject.panTool.click();
  await expect(viewport.annotations).toHaveCount(0);
  await mainToolbarPageObject.redo.click();
  await expect(viewport.annotations).toHaveCount(0);

  await mainToolbarPageObject.measurementTools.livewireContour.click();
  await viewport.normalizedClickAt([
    { x: 0.4, y: 0.4 },
    { x: 0.5, y: 0.35 },
    { x: 0.6, y: 0.4 },
  ]);
  await expect(viewport.svg('circle')).toHaveCount(3);
  await press({ page, key: 'Escape' });
  await expect(viewport.annotations).toHaveCount(0);

  await mainToolbarPageObject.measurementTools.freehandROI.click();
  const box = await viewport.pane.boundingBox();
  expect(box).not.toBeNull();
  await viewport.normalizedPathDragAt({
    path: [
      { x: 0.35, y: 0.35 },
      { x: 0.6, y: 0.35 },
      { x: 0.6, y: 0.6 },
      { x: 0.35, y: 0.6 },
      { x: 0.35, y: 0.35 + 6 / box!.height },
    ],
    config: { steps: 20, delay: 10 },
  });
  await DOMOverlayPageObject.viewport.measurementTracking.confirm.click();
  await expect(viewport.annotations).toHaveCount(1);
  await expect(viewport.nthAnnotation(0).text.locator).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await mainToolbarPageObject.undo.click();
    await expect(viewport.annotations).toHaveCount(0);
    await mainToolbarPageObject.redo.click();
    await expect(viewport.annotations).toHaveCount(1);
  }
  await checkForScreenshot({
    page,
    locator: viewport.pane,
    screenshotPath: screenShotPaths.roiHistory.freehandAfterArrowSwitch,
  });
});
