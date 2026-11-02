import { DatasetWorkspace } from './DatasetWorkspace';
import { EDIT_LEASE_REQUIRED_MESSAGE } from './collaboration/reliableCollaboration';
import { ReliableCollaboration } from './collaboration/reliableCollaboration';

jest.mock('./OHIFWorkspaceDriver', () => ({ OHIFWorkspaceDriver: jest.fn() }));

function setup() {
  const pixels = new Uint8Array([0, 1, 1, 0]);
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
          getPixelData: () => pixels,
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
  return { workspace, segmentationService, pixels };
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

test('clears a previous edit-permission error after acquiring the editing lease', async () => {
  const { workspace } = setup();
  workspace.state.error = EDIT_LEASE_REQUIRED_MESSAGE;
  workspace.reliable = { acquire: jest.fn(async () => {}), canEdit: true };
  await workspace.acquireEdit();
  expect(workspace.reliable.acquire).toHaveBeenCalledTimes(1);
  expect(workspace.state.error).toBe('');
});

test('keeps an unrelated error visible when the editing lease is acquired', async () => {
  const { workspace } = setup();
  workspace.state.error = '导出失败';
  workspace.reliable = { acquire: jest.fn(async () => {}), canEdit: true };
  await workspace.acquireEdit();
  expect(workspace.state.error).toBe('导出失败');
});

test('successful local queueing clears a stale edit-permission error', async () => {
  const { workspace } = setup();
  workspace.stopped = false;
  workspace.state.dirty = true;
  workspace.state.error = EDIT_LEASE_REQUIRED_MESSAGE;
  workspace.reliable = { enqueue: jest.fn(async () => {}) };
  await workspace.saveDraft();
  expect(workspace.reliable.enqueue).toHaveBeenCalledTimes(1);
  expect(workspace.state.dirty).toBe(false);
  expect(workspace.state.error).toBe('');
});

test('a remote slice arriving during local disk persistence does not become a new local edit', async () => {
  const { workspace } = setup();
  workspace.stopped = false;
  workspace.state.ready = true;
  workspace.state.dirty = true;
  const initial = workspace.capture();
  let finish!: () => void;
  workspace.reliable = { queuedData: initial, enqueue: jest.fn(() => new Promise<void>(resolve => { finish=resolve; })) };
  const saving = workspace.saveDraft();
  const merged = { ...initial, masks: [...initial.masks,{instanceId:'other-slice',runs:[0,2,1]}] };
  workspace.reliable.queuedData = merged;
  jest.spyOn(workspace,'capture').mockReturnValue(merged);
  finish();await saving;
  workspace.changed();
  expect(workspace.state.dirty).toBe(false);
  expect(workspace.timer).toBeUndefined();
});

test('viewer display and active-label events do not mark unchanged masks as local edits', () => {
  const { workspace } = setup();
  workspace.stopped = false;
  workspace.state.ready = true;
  workspace.lastSignature = JSON.stringify(workspace.capture());
  workspace.reliable = { enqueue: jest.fn() };
  workspace.changed();
  expect(workspace.state.dirty).toBe(false);
  expect(workspace.timer).toBeUndefined();
  expect(workspace.reliable.enqueue).not.toHaveBeenCalled();
});

test('a display-only dirty flag cannot block a committed update arriving before the save timer', async () => {
  const { workspace } = setup();
  workspace.stopped = false;
  workspace.state.ready = true;
  workspace.state.canEdit = true;
  workspace.lastSignature = JSON.stringify(workspace.capture());
  workspace.reliable = {};
  workspace.changed();
  expect(workspace.state.dirty).toBe(true);
  expect(workspace.hasUnqueuedChanges()).toBe(false);
  expect(workspace.state.dirty).toBe(false);
  expect(workspace.timer).toBeUndefined();
});

test('actual unsaved pixels still block remote overwrite', () => {
  const { workspace, pixels } = setup();
  workspace.lastSignature = JSON.stringify(workspace.capture());
  pixels[0] = 1;
  workspace.state.dirty = true;
  expect(workspace.hasUnqueuedChanges()).toBe(true);
  expect(workspace.state.dirty).toBe(true);
});

test('a viewer applies successive broadcasts despite display-only events between updates', async () => {
  const { workspace, pixels } = setup();
  workspace.stopped = false;
  workspace.state.ready = true;
  const initial = workspace.capture();
  workspace.lastSignature = JSON.stringify(initial);
  const states = jest.fn();
  const request = jest.fn(async (tail: string) => {
    if (tail.startsWith('/state'))
      return {
        seq: 0,
        data: initial,
        lease: null,
        throughSeq: 0,
        publishedVersion: 0,
        archiveError: '',
      };
    throw new Error('Unexpected request: ' + tail);
  });
  const client = new ReliableCollaboration({
    clientId: 'viewer-client-001',
    privateDraft: false,
    request,
    persist: async () => {},
    replace: async () => {},
    apply: async operation => {
      for (const mask of operation.masks)
        for (let i = 0; i < mask.runs.length; i += 3)
          pixels.fill(mask.runs[i + 2], mask.runs[i], mask.runs[i] + mask.runs[i + 1]);
      workspace.lastSignature = JSON.stringify(workspace.capture());
      // OHIF emits additional presentation events after updating the image cache.
      workspace.changed();
    },
    hasUnqueuedChanges: () => workspace.hasUnqueuedChanges(),
    onState: states,
  });
  workspace.reliable = client;
  try {
    await client.connect();
    workspace.changed();
    for (const [seq, start] of [
      [1, 0],
      [2, 3],
    ]) {
      client.receive({
        seq,
        clientOpId: 'remote-operation-' + seq,
        subject: 'editor',
        username: 'editor',
        operation: {
          clientOpId: 'remote-operation-' + seq,
          baseSeq: seq - 1,
          segments: initial.segments,
          masks: [{ instanceId: 'instance', runs: [start, 1, 1] }],
        },
      });
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(Array.from(pixels)).toEqual([1, 1, 1, 1]);
    expect(states.mock.calls.at(-1)[0].conflict).toBe(false);
    expect(states.mock.calls.at(-1)[0].seq).toBe(2);
    expect(workspace.state.dirty).toBe(false);
  } finally {
    client.stop();
    clearTimeout(workspace.timer);
  }
});
