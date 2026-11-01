import { AnnotationWorkspace } from './AnnotationWorkspace';
import { OHIFWorkspaceDriver } from './OHIFWorkspaceDriver';
import { CollaborationBar } from './collaboration/CollaborationBar';
import { DatasetWorkspace } from './DatasetWorkspace';

const id = '@medcollab/extension-workspace';
const drivers = new WeakMap<object, OHIFWorkspaceDriver>();

/**
 * Registered as a customization so the viewer header can render it without
 * importing this extension directly (which would create a circular dependency).
 *
 * `default` is the slot `CustomizationService.init` merges automatically; the
 * `medcollabCollaboration` alias keeps an explicit module entry available for
 * modes that want to reference it by name.
 */
export function getCustomizationModule() {
  const value = { 'medcollab.collaborationBar': CollaborationBar };
  return [
    { name: 'default', value },
    { name: 'medcollabCollaboration', value },
  ];
}

export default {
  id,
  preRegistration(runtime) {
    const driver = new OHIFWorkspaceDriver(runtime);
    const workspace = new AnnotationWorkspace(driver, () => crypto.randomUUID());
    driver.workspace = workspace;
    drivers.set(runtime.servicesManager, driver);
    runtime.servicesManager.registerService({
      name: 'annotationWorkspaceService',
      create: () => workspace,
    });
    const datasetWorkspace = new DatasetWorkspace(runtime);
    runtime.servicesManager.registerService({
      name: 'datasetWorkspaceService',
      create: () => datasetWorkspace,
    });
    window.addEventListener('beforeunload', event => {
      const state = workspace.getEditState();
      if (
        state.dirty ||
        state.saving ||
        datasetWorkspace.state.dirty ||
        datasetWorkspace.state.busy
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  },
  getUtilityModule({ servicesManager }) {
    return [
      {
        name: 'workspace',
        exports: {
          getWorkspace: () => servicesManager.services.annotationWorkspaceService,
          getDatasetWorkspace: () => servicesManager.services.datasetWorkspaceService,
          bindMode: (sessionId: string | null) => drivers.get(servicesManager)?.bindMode(sessionId),
        },
      },
    ];
  },
  getCustomizationModule,
};

export { AnnotationWorkspace, WorkspaceError } from './AnnotationWorkspace';
export type * from './types';
