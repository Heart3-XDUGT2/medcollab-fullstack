import segmentationMode, { modeInstance as segmentationInstance } from '@ohif/mode-segmentation';

const id = '@medcollab/mode-workspace';
const utilityId = '@medcollab/extension-workspace.utilityModule.workspace';

function initReadOnlyTools({ extensionManager, toolGroupService }) {
  const { toolNames, Enums } = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  ).exports;
  const tools = {
    active: [
      { toolName: toolNames.WindowLevel, bindings: [{ mouseButton: Enums.MouseBindings.Primary }] },
      { toolName: toolNames.Pan, bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }] },
      { toolName: toolNames.Zoom, bindings: [{ mouseButton: Enums.MouseBindings.Secondary }] },
      { toolName: toolNames.StackScroll, bindings: [{ mouseButton: Enums.MouseBindings.Wheel }] },
    ],
  };
  toolGroupService.createToolGroupAndAddTools('default', tools);
  toolGroupService.createToolGroupAndAddTools('mpr', tools);
  toolGroupService.createToolGroupAndAddTools('volume3d', {
    active: [
      {
        toolName: toolNames.TrackballRotateTool,
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      { toolName: toolNames.Zoom, bindings: [{ mouseButton: Enums.MouseBindings.Secondary }] },
    ],
  });
}

export default {
  ...segmentationMode,
  id,
  extensionDependencies: {
    ...segmentationMode.extensionDependencies,
    '@medcollab/extension-workspace': '0.1.0',
  },
  modeInstance: {
    ...segmentationInstance,
    id,
    routeName: 'medcollab',
    displayName: 'MedCollab',
    hide: true,
    routes: segmentationInstance.routes.map(route => ({
      ...route,
      layoutInstance: {
        ...route.layoutInstance,
        props: {
          ...route.layoutInstance.props,
          rightPanels: [route.layoutInstance.props.rightPanels[0]],
        },
      },
    })),
    onModeEnter(ctx) {
      if (new URLSearchParams(window.location.search).has('datasetId')) {
        this.initToolGroups = segmentationInstance.initToolGroups;
        segmentationInstance.onModeEnter.call(this, ctx);
        ctx.extensionManager
          .getModuleEntry(utilityId)
          .exports.getDatasetWorkspace()
          .setReadOnly(true);
        return;
      }
      const workspace = ctx.extensionManager.getModuleEntry(utilityId).exports.getWorkspace();
      const state = workspace.getEditState();
      this.initToolGroups =
        state.intent === 'edit' && state.leaseValid
          ? segmentationInstance.initToolGroups
          : initReadOnlyTools;
      segmentationInstance.onModeEnter.call(this, ctx);
      ctx.servicesManager.services.customizationService.setCustomizations({
        'panelSegmentation.disableEditing': true,
      });
    },
    onSetupRouteComplete({ extensionManager }) {
      if (new URLSearchParams(window.location.search).has('datasetId')) {
        extensionManager.getModuleEntry(utilityId).exports.getDatasetWorkspace().bind();
        return;
      }
      extensionManager
        .getModuleEntry(utilityId)
        .exports.bindMode(new URLSearchParams(window.location.search).get('workspaceSessionId'));
    },
    onModeExit(ctx) {
      ctx.extensionManager.getModuleEntry(utilityId).exports.getDatasetWorkspace().close();
      segmentationInstance.onModeExit.call(this, ctx);
    },
  },
};
