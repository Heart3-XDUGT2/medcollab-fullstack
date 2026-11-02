import { DicomMetadataStore } from '@ohif/core';
import i18n from '@ohif/i18n';
import { datasetToDicomBlob } from '@ohif/extension-default/src/utils/dicomWriter';
import { WorkspaceError } from './AnnotationWorkspace';
import type { AnnotationWorkspace } from './AnnotationWorkspace';
import type { Artifact, LaunchContext, OpenCaseRequest, WorkspaceDriver } from './types';

type Runtime = { servicesManager: any; extensionManager: any; commandsManager: any };

export class OHIFWorkspaceDriver implements WorkspaceDriver {
  workspace!: AnnotationWorkspace;
  private pending?: { id: string; context: LaunchContext; resolve: () => void; reject: (error: Error) => void };
  private unsubscribers: (() => void)[] = [];
  private disabledTools = new Map<any, string[]>();
  private readOnly = true;
  private waitTimer?: ReturnType<typeof setTimeout>;

  constructor(private runtime: Runtime) {}

  private libraries() {
    return this.runtime.extensionManager
      .getModuleEntry('@ohif/extension-cornerstone.utilityModule.common')
      .exports.getCornerstoneLibraries();
  }

  validateContext(context: LaunchContext) {
    const definition = this.runtime.extensionManager.getDataSourceDefinition(context.dataSourceId);
    if (!definition) throw new WorkspaceError('UNKNOWN_DATA_SOURCE');
    if (context.sourceManifest.frames.some(frame => frame.frameNumber !== 1))
      throw new WorkspaceError('MULTIFRAME_SOURCE_NOT_VERIFIED');
  }

  async open(request: OpenCaseRequest, context: LaunchContext, sessionId: string) {
    await i18n.changeLanguage(request.locale);
    const ready = new Promise<void>((resolve, reject) => {
      this.pending = { id: sessionId, context, resolve, reject };
      this.waitTimer = setTimeout(() => reject(new WorkspaceError('VIEWER_LOAD_TIMEOUT')), 120_000);
    });
    const query = new URLSearchParams();
    // Presentation options only. Authentication/configuration URLs are never copied.
    const current = new URL(window.location.href);
    for (const [key, value] of current.searchParams) {
      if (['hangingprotocolid', 'stageid', 'usenextviewports', 'viewportrendering'].includes(key.toLowerCase()))
        query.append(key, value);
    }
    query.set('StudyInstanceUIDs', context.sourceManifest.studyInstanceUID);
    query.set('SeriesInstanceUIDs', context.sourceManifest.seriesInstanceUID);
    query.set('workspaceSessionId', sessionId);
    query.set('lng', request.locale);
    this.runtime.commandsManager.runCommand('navigateHistory', {
      to: `/medcollab/${encodeURIComponent(context.dataSourceId)}?${query}${current.hash}`,
      options: { replace: false },
    }, 'DEFAULT');
    await ready;
    const { servicesManager, extensionManager } = this.runtime;
    const { displaySetService, segmentationService, viewportGridService } = servicesManager.services;
    for (const instance of context.version?.instances || []) {
      await extensionManager.getActiveDataSource()[0].retrieve.series.metadata({
        StudyInstanceUID: context.sourceManifest.studyInstanceUID,
        filters: { seriesInstanceUID: [instance.seriesInstanceUID] },
      });
      const displaySet = displaySetService.getActiveDisplaySets()
        .find(ds => ds.SOPInstanceUID === instance.sopInstanceUID);
      if (!displaySet || displaySet.Modality !== 'SEG') throw new WorkspaceError('VERSION_ARTIFACT_NOT_FOUND');
      if (displaySet.referencedSeriesInstanceUID !== context.sourceManifest.seriesInstanceUID)
        throw new WorkspaceError('SOURCE_REFERENCE_MISMATCH');
      await displaySet.load({ headers: {} });
      await segmentationService.addSegmentationRepresentation(viewportGridService.getActiveViewportId(), {
        segmentationId: displaySet.displaySetInstanceUID,
      });
      displaySet.isHydrated = true;
    }
    this.subscribeToChanges(sessionId);
  }

  /** Called only by the dedicated mode after OHIF has initialized its tools. */
  bindMode(sessionId: string | null) {
    if (!this.pending || this.pending.id !== sessionId) return;
    const { cornerstone } = this.libraries();
    const { displaySetService, cornerstoneViewportService, viewportGridService } = this.runtime.servicesManager.services;
    const check = () => {
      const pending = this.pending;
      if (!pending || pending.id !== sessionId) return;
      const m = pending.context.sourceManifest;
      const ds = displaySetService.getActiveDisplaySets().find(ds =>
        ds.SeriesInstanceUID === m.seriesInstanceUID && ds.StudyInstanceUID === m.studyInstanceUID
      );
      if (!ds) return;
      let viewport;
      try { viewport = cornerstoneViewportService.getCornerstoneViewport(viewportGridService.getActiveViewportId()); }
      catch { return; }
      if (!viewport || !viewport.getImageIds?.().length) return;
      const series = DicomMetadataStore.getSeries(m.studyInstanceUID, m.seriesInstanceUID);
      if (!series?.instances?.length) return;
      const instances = new Map(series.instances.map(instance => [instance.SOPInstanceUID, instance]));
      if (instances.size !== m.frames.length || m.frames.some(frame =>
        (instances.get(frame.sopInstanceUID) as any)?.FrameOfReferenceUID !== m.frameOfReferenceUID
      )) {
        pending.reject(new WorkspaceError('SOURCE_MANIFEST_MISMATCH'));
        return;
      }
      const current = viewport.getCurrentImageId?.() || viewport.getImageIds()[0];
      if (!cornerstone.cache.getImage(current)) return;
      clearTimeout(this.waitTimer);
      pending.resolve();
    };
    for (const [service, event] of [
      [displaySetService, displaySetService.EVENTS.DISPLAY_SETS_ADDED],
      [cornerstoneViewportService, cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED],
      [viewportGridService, viewportGridService.EVENTS.VIEWPORTS_READY],
    ]) {
      const { unsubscribe } = service.subscribe(event, check);
      this.unsubscribers.push(unsubscribe);
    }
    cornerstone.eventTarget.addEventListener(cornerstone.Enums.Events.IMAGE_LOADED, check);
    this.unsubscribers.push(() => cornerstone.eventTarget.removeEventListener(cornerstone.Enums.Events.IMAGE_LOADED, check));
    this.setReadOnly(true);
    check();
  }

  private subscribeToChanges(sessionId: string) {
    const { segmentationService, measurementService } = this.runtime.servicesManager.services;
    for (const [service, names] of [
      [segmentationService, ['SEGMENTATION_ADDED', 'SEGMENTATION_REMOVED', 'SEGMENTATION_MODIFIED', 'SEGMENTATION_DATA_MODIFIED']],
      [measurementService, ['MEASUREMENT_ADDED', 'MEASUREMENT_UPDATED', 'MEASUREMENT_REMOVED', 'MEASUREMENTS_CLEARED']],
    ] as const) {
      for (const name of names) {
        const { unsubscribe } = service.subscribe(service.EVENTS[name], () => this.workspace.markDirty(sessionId));
        this.unsubscribers.push(unsubscribe);
      }
    }
  }

  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
    const { toolGroupService, customizationService } = this.runtime.servicesManager.services;
    if (!toolGroupService) return;
    customizationService.setCustomizations({ 'panelSegmentation.disableEditing': readOnly });
    const safe = new Set(['WindowLevel', 'Pan', 'Zoom', 'StackScroll', 'Magnify',
      'WindowLevelRegion', 'Crosshairs', 'ReferenceLines', 'AdvancedMagnify', 'TrackballRotateTool']);
    for (const id of toolGroupService.getToolGroupIds()) {
      const group = toolGroupService.getToolGroup(id);
      if (readOnly) {
        const names: string[] = this.disabledTools.get(group) || [];
        for (const [name, options] of Object.entries(group.toolOptions) as [string, any][]) {
          if (!safe.has(name) && ['Active', 'Passive'].includes(options.mode)) {
            if (!names.includes(name)) names.push(name);
            group.setToolDisabled(name);
          }
        }
        this.disabledTools.set(group, names);
      } else {
        for (const name of this.disabledTools.get(group) || []) group.setToolPassive(name);
        this.disabledTools.delete(group);
      }
    }
  }

  async captureArtifacts(context: LaunchContext): Promise<Artifact[]> {
    if (this.readOnly) throw new WorkspaceError('EDIT_NOT_ALLOWED');
    const { segmentationService, measurementService } = this.runtime.servicesManager.services;
    if (measurementService.getMeasurements().length) throw new WorkspaceError('MEASUREMENT_SAVE_NOT_IMPLEMENTED');
    const { cornerstone, cornerstoneTools } = this.libraries();
    const source = context.sourceManifest;
    const expectedSOPs = new Set(source.frames.map(frame => frame.sopInstanceUID));
    const segmentations = segmentationService.getSegmentations();
    for (const segmentation of segmentations) {
      const data = segmentation.representationData.Labelmap;
      const segments = Object.keys(segmentation.segments).filter(index => Number(index) > 0);
      if (!data || segments.length !== 1 || segments[0] !== '1' ||
        (data.labelmaps && Object.keys(data.labelmaps).length > 1))
        throw new WorkspaceError('SEGMENTATION_LAYOUT_NOT_VERIFIED');
      const ids = cornerstoneTools.segmentation.getLabelmapImageIds(segmentation.segmentationId);
      const refs = ids.map(id => cornerstone.cache.getImage(id).referencedImageId);
      for (let offset = 0; offset < refs.length; offset += 8) {
        await Promise.all(refs.slice(offset, offset + 8).map(id =>
          cornerstone.cache.getImage(id) || cornerstone.imageLoader.loadAndCacheImage(id)
        ));
      }
      for (const id of refs) {
        const instance = cornerstone.metaData.get('instance', id);
        if (!instance || !expectedSOPs.has(instance.SOPInstanceUID) ||
          instance.SeriesInstanceUID !== source.seriesInstanceUID ||
          instance.FrameOfReferenceUID !== source.frameOfReferenceUID)
          throw new WorkspaceError('SOURCE_REFERENCE_MISMATCH');
      }
    }
    return segmentations.map(segmentation => {
      const generated = this.runtime.commandsManager.runCommand('generateSegmentation', {
        segmentationId: segmentation.segmentationId,
      }, 'SEGMENTATION');
      const dataset = generated.dataset;
      return {
        bytes: datasetToDicomBlob(dataset), format: 'DICOM_SEG',
        sopInstanceUID: dataset.SOPInstanceUID, sopClassUID: dataset.SOPClassUID,
        seriesInstanceUID: dataset.SeriesInstanceUID, sourceManifestId: source.id,
      };
    });
  }

  clear() {
    clearTimeout(this.waitTimer);
    this.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    this.disabledTools.clear();
    this.pending = undefined;
    this.readOnly = true;
  }
}
