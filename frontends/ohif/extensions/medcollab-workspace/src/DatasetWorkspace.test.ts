import { DatasetWorkspace } from './DatasetWorkspace';

jest.mock('./OHIFWorkspaceDriver', () => ({ OHIFWorkspaceDriver: jest.fn() }));

function setup() {
  const segmentationService = {
    getSegmentations: () => [
      {
        segmentationId: 'seg',
        representationData: { Labelmap: {} },
        segments: { 1: { label: '心脏' } },
      },
    ],
    getViewportIdsWithSegmentation: jest.fn(() => ['ct']),
    getSegmentColor: jest.fn(viewport => (viewport === 'ct' ? [20, 120, 240, 255] : null)),
  };
  const libraries = {
    cornerstone: {
      cache: {
        getImage: () => ({
          referencedImageId: 'source',
          getPixelData: () => new Uint8Array([0, 1, 1, 0]),
        }),
      },
      metaData: { get: () => ({ SOPInstanceUID: 'sop', SeriesInstanceUID: 'series' }) },
    },
    cornerstoneTools: { segmentation: { getLabelmapImageIds: () => ['mask'] } },
  };
  const workspace: any = new DatasetWorkspace({
    servicesManager: {
      services: {
        segmentationService,
        viewportGridService: { getActiveViewportId: () => 'empty' },
      },
    },
    extensionManager: {
      getModuleEntry: () => ({ exports: { getCornerstoneLibraries: () => libraries } }),
    },
  });
  workspace.sources = [{ id: 'instance', sopInstanceUid: 'sop', rows: 2, columns: 2 }];
  workspace.selected = { seriesInstanceUID: 'series' };
  return { workspace, segmentationService };
}

test('captures pixels and label color when the active viewport has no segmentation', () => {
  const { workspace } = setup();
  expect(workspace.capture()).toEqual({
    segments: [{ number: 1, label: '心脏', color: [20, 120, 240] }],
    masks: [{ instanceId: 'instance', runs: [1, 2, 1] }],
  });
});

test('preserves the last known color while representations are detached during a layout change', () => {
  const { workspace, segmentationService } = setup();
  const before = workspace.capture();
  segmentationService.getViewportIdsWithSegmentation.mockReturnValue([]);
  expect(workspace.capture()).toEqual(before);
});

test('captures a changed color once the segmentation is displayed again', () => {
  const { workspace, segmentationService } = setup();
  workspace.capture();
  segmentationService.getSegmentColor.mockImplementation(viewport =>
    viewport === 'ct' ? [200, 30, 80, 255] : null
  );
  expect(workspace.capture().segments[0].color).toEqual([200, 30, 80]);
});

test('reports an actionable error if a new label has no available color', () => {
  const { workspace, segmentationService } = setup();
  segmentationService.getViewportIdsWithSegmentation.mockReturnValue([]);
  expect(() => workspace.capture()).toThrow('掩码颜色尚未加载，请等待影像显示完成后重试保存');
});
