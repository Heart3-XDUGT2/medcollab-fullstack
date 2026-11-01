import type { Page } from '@playwright/test';
import dcmjs from 'dcmjs';

/**
 * Expose the actual exported bytes through an in-memory DICOMweb fixture.
 * This exercises OHIF's normal metadata/frame import path in a fresh page.
 * It is deliberately not evidence of remote persistence or STOW support.
 */
export async function installOwner2SEGFixture(
  page: Page,
  bytes: Buffer,
  dataset: any,
  transferSyntaxUID: string
) {
  const root = 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb';
  const seriesPath = `/dicomweb/studies/${dataset.StudyInstanceUID}/series`;
  const instancePath = `${seriesPath}/${dataset.SeriesInstanceUID}/instances/${dataset.SOPInstanceUID}`;
  const metadata = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(dataset);
  // denaturalizeDataset is a Part 10 writer helper and yields string Values
  // even for binary numeric VRs. DICOM JSON requires those as JSON numbers;
  // otherwise the loader correctly sees inconsistent Rows/Columns types.
  const numericVRs = new Set(['US', 'SS', 'UL', 'SL', 'FL', 'FD']);
  const normalizeDicomJSON = (attributes: Record<string, any>) => {
    for (const attribute of Object.values(attributes)) {
      if (attribute?.vr === 'SQ') {
        attribute.Value?.forEach(normalizeDicomJSON);
      } else if (numericVRs.has(attribute?.vr) && attribute.Value) {
        attribute.Value = attribute.Value.map(Number);
      }
    }
  };
  normalizeDicomJSON(metadata);
  metadata['7FE00010'] = {
    vr: 'OB',
    BulkDataURI: `${root}${instancePath.slice('/dicomweb'.length)}/frames`,
  };
  metadata['00083002'] = { vr: 'UI', Value: [transferSyntaxUID] };
  const summary = { ...metadata, '00201209': { vr: 'IS', Value: [1] } };
  delete summary['7FE00010'];
  const frames: ArrayBuffer[] = dataset.PixelData;

  await page.route('**/dicomweb/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === seriesPath) {
      const response = await route.fetch();
      const original = await response.json();
      await route.fulfill({ status: 200, json: [...original, summary] });
      return;
    }
    if (pathname.startsWith(`${seriesPath}/${dataset.SeriesInstanceUID}`)) {
      const match = pathname.match(/\/frames\/(\d+)$/);
      if (match) {
        const frame = frames[Number(match[1]) - 1];
        if (!frame) {
          await route.fulfill({ status: 404 });
          return;
        }
        const boundary = 'owner2-seg-frame';
        const body = Buffer.concat([
          Buffer.from(
            `\r\n--${boundary}\r\nContent-Type: application/octet-stream; transfer-syntax=${transferSyntaxUID}\r\n\r\n`
          ),
          Buffer.from(frame),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        await route.fulfill({
          status: 200,
          contentType: `multipart/related; type="application/octet-stream"; boundary=${boundary}`,
          body,
        });
      } else if (pathname === instancePath) {
        await route.fulfill({ status: 200, contentType: 'application/dicom', body: bytes });
      } else {
        await route.fulfill({ status: 200, json: [metadata] });
      }
      return;
    }
    await route.continue();
  });
}
