import fs from 'node:fs/promises';
import dcmjs from 'dcmjs';
import { test, expect, visitStudy, waitForViewportsRendered } from './utils';
import { installOwner2SEGFixture } from './utils/owner2SEGFixture';

const STUDY = '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5';
const SERIES = '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.11';

test('team CT produces a SEG with the actual painted mask and source references', async ({
  page,
  leftPanelPageObject,
  rightPanelPageObject,
  viewportPageObject,
  mainToolbarPageObject,
  DOMOverlayPageObject,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await visitStudy(page, STUDY, 'segmentation', 2000);
    if (await DOMOverlayPageObject.investigationalUse.button.isVisible()) {
      await DOMOverlayPageObject.investigationalUse.click();
    }
    await mainToolbarPageObject.layoutSelection.grid(1, 1).click();
    await leftPanelPageObject.loadSeriesByDescription('Body 3.0 CE');
    await waitForViewportsRendered(page, { timeout: 60_000 });

    await rightPanelPageObject.labelMapSegmentationPanel.addSegmentationButton.click();
    await expect(rightPanelPageObject.labelMapSegmentationPanel.panel.rows).toHaveCount(1);
    await waitForViewportsRendered(page, { timeout: 60_000, waitVolumeLoad: false });
    await rightPanelPageObject.labelMapSegmentationPanel.tools.brush.click();
    await rightPanelPageObject.labelMapSegmentationPanel.tools.brush.setRadius(5);
    const viewport = await viewportPageObject.active;
    await viewport.normalizedDragAt({
      start: { x: 0.45, y: 0.5 },
      end: { x: 0.55, y: 0.5 },
      config: { steps: 8 },
    });
    await waitForViewportsRendered(page, { timeout: 60_000, waitVolumeLoad: false });
    await viewport.pane.screenshot({ path: testInfo.outputPath('painted-viewport.png') });

    const readMask = () => {
      const w = window as any;
      const segmentation = w.services.segmentationService.getSegmentations()[0];
      if (!segmentation) {
        throw new Error('No segmentation was created');
      }
      const { cornerstone, cornerstoneTools } = w.extensionManager
        .getModuleEntry('@ohif/extension-cornerstone.utilityModule.common')
        .exports.getCornerstoneLibraries();
      const images = cornerstoneTools.segmentation.getLabelmapImageIds(segmentation.segmentationId);
      if (!images?.length) {
        throw new Error('No labelmap images are available');
      }
      const painted = images.flatMap((imageId: string) => {
        const image = cornerstone.cache.getImage(imageId);
        const pixels = image.getPixelData();
        const indices: number[] = [];
        for (let i = 0; i < pixels.length; i++) {
          if (pixels[i] !== 0) indices.push(i);
        }
        if (!indices.length) return [];
        return [
          {
            source: cornerstone.metaData.get('instance', image.referencedImageId),
            rows: image.rows,
            columns: image.columns,
            indices,
          },
        ];
      });
      return {
        segmentationId: segmentation.segmentationId,
        labels: Object.entries(segmentation.segments).map(([index, segment]: [string, any]) => ({
          index,
          label: segment.label,
        })),
        painted,
      };
    };
    const before = await page.evaluate(readMask);
    expect(before.painted.length).toBeGreaterThan(0);
    expect(before.painted.every(frame => frame.source.SeriesInstanceUID === SERIES)).toBe(true);

    // The native writer requires all referenced source images in cache. A
    // visible first slice does not mean background series loading has finished.
    await page.evaluate(async segmentationId => {
      const w = window as any;
      const { cornerstone, cornerstoneTools } = w.extensionManager
        .getModuleEntry('@ohif/extension-cornerstone.utilityModule.common')
        .exports.getCornerstoneLibraries();
      const refs = cornerstoneTools.segmentation
        .getLabelmapImageIds(segmentationId)
        .map((id: string) => cornerstone.cache.getImage(id).referencedImageId);
      for (let offset = 0; offset < refs.length; offset += 8) {
        await Promise.all(
          refs
            .slice(offset, offset + 8)
            .map(
              (id: string) =>
                cornerstone.cache.getImage(id) || cornerstone.imageLoader.loadAndCacheImage(id)
            )
        );
      }
    }, before.segmentationId);

    const downloadPromise = page.waitForEvent('download');
    // Exercise the same public command used by the existing export action;
    // business persistence and the workbench bridge are intentionally absent.
    await page.evaluate(segmentationId => {
      (window as any).commandsManager.runCommand('downloadSegmentation', { segmentationId });
    }, before.segmentationId);
    const download = await downloadPromise;
    const exportedPath = testInfo.outputPath('painted-seg.dcm');
    await download.saveAs(exportedPath);
    const bytes = await fs.readFile(exportedPath);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const dicom = dcmjs.data.DicomMessage.readFile(buffer);
    const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicom.dict);
    expect(dataset.Modality).toBe('SEG');
    expect(dataset.StudyInstanceUID).toBe(STUDY);
    expect(dataset.FrameOfReferenceUID).toBe(before.painted[0].source.FrameOfReferenceUID);
    expect(dataset.SegmentationType).toBe('LABELMAP');
    expect(Number(dataset.BitsAllocated)).toBe(8);
    const pixels = dcmjs.utilities.compression.decode(
      dataset.PixelData,
      Number(dataset.Rows),
      Number(dataset.Columns)
    );
    const one = (value: any) => (Array.isArray(value) ? value[0] : value);
    const frameGroups = Array.isArray(dataset.PerFrameFunctionalGroupsSequence)
      ? dataset.PerFrameFunctionalGroupsSequence
      : [dataset.PerFrameFunctionalGroupsSequence];
    const actual = new Map<string, number[]>();
    frameGroups.forEach((group: any, frameIndex: number) => {
      const derivation = one(group.DerivationImageSequence);
      const source = one(derivation.SourceImageSequence);
      const indices: number[] = [];
      const frameLength = Number(dataset.Rows) * Number(dataset.Columns);
      for (let i = 0; i < frameLength; i++) {
        if (pixels[frameIndex * frameLength + i] !== 0) indices.push(i);
      }
      if (indices.length) actual.set(source.ReferencedSOPInstanceUID, indices);
    });
    expect(actual.size).toBe(before.painted.length);
    for (const frame of before.painted) {
      expect(actual.get(frame.source.SOPInstanceUID)).toEqual(frame.indices);
    }

    await installOwner2SEGFixture(page, bytes, dataset, dicom.meta['00020010'].Value[0]);
    // A full navigation discards all previous in-memory segmentation state.
    // Only the exported artifact is made available by the test data source.
    await visitStudy(page, STUDY, 'segmentation', 2000);
    if (await DOMOverlayPageObject.investigationalUse.button.isVisible()) {
      await DOMOverlayPageObject.investigationalUse.click();
    }
    await mainToolbarPageObject.layoutSelection.grid(1, 1).click();
    await leftPanelPageObject.loadSeriesByDescription('Body 3.0 CE');
    expect(
      await page.evaluate(
        () => (window as any).services.segmentationService.getSegmentations().length
      )
    ).toBe(0);
    await leftPanelPageObject.loadSeriesByModality('SEG');
    await expect(DOMOverlayPageObject.viewport.segmentationHydration.locator).toBeVisible({
      timeout: 60_000,
    });
    await DOMOverlayPageObject.viewport.segmentationHydration.yes.click();
    await expect(rightPanelPageObject.labelMapSegmentationPanel.panel.rows).toHaveCount(1);
    await waitForViewportsRendered(page, { timeout: 60_000, waitVolumeLoad: false });
    const after = await page.evaluate(readMask);
    expect(after.labels).toEqual(before.labels);
    expect(after.painted.length).toBe(before.painted.length);
    for (const expected of before.painted) {
      const restored = after.painted.find(
        frame => frame.source.SOPInstanceUID === expected.source.SOPInstanceUID
      );
      expect(restored).toBeDefined();
      expect(restored!.indices).toEqual(expected.indices);
      expect(restored!.source.ImagePositionPatient).toEqual(expected.source.ImagePositionPatient);
      expect(restored!.source.ImageOrientationPatient).toEqual(
        expected.source.ImageOrientationPatient
      );
      expect(restored!.source.PixelSpacing).toEqual(expected.source.PixelSpacing);
    }
    const restoredViewport = await viewportPageObject.active;
    await restoredViewport.pane.screenshot({ path: testInfo.outputPath('restored-viewport.png') });
    expect(errors).toEqual([]);
    await fs.writeFile(
      testInfo.outputPath('source-and-export-summary.json'),
      JSON.stringify(
        {
          sourceStudy: STUDY,
          sourceSeries: SERIES,
          paintedFrames: before.painted.map(frame => ({
            sopInstanceUID: frame.source.SOPInstanceUID,
            paintedVoxelCount: frame.indices.length,
          })),
          exportedSOPClassUID: dataset.SOPClassUID,
          exportedSOPInstanceUID: dataset.SOPInstanceUID,
          exportedFrames: dataset.NumberOfFrames,
          segmentationType: dataset.SegmentationType,
          byteLength: bytes.byteLength,
          reopenedInFreshPage: true,
          restoredMaskMatches: true,
          restoredLabels: after.labels,
          persistence: 'in-memory-test-fixture-not-a-cloud-backend',
        },
        null,
        2
      )
    );
  } finally {
    await testInfo.attach('page-errors', {
      body: JSON.stringify(errors, null, 2),
      contentType: 'application/json',
    });
  }
});
