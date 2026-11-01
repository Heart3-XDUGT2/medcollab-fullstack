import WorkbenchPage from './WorkbenchPage';

const id = '@medcollab/extension-workbench';

/**
 * Adds the private demo route at /workbench. The page is UI-only; see
 * src/data/mockCases.ts for the mock cases and src/WorkbenchPage.tsx for the
 * demo-only open behavior.
 *
 * The customization module must be named `default` (or `global`) so that
 * CustomizationService.init auto-applies it for this extension. A custom name
 * would only be applied when referenced from app config.
 */
const workbenchPageCustomization = {
  'routes.customRoutes': {
    routes: {
      $push: [
        {
          path: '/workbench',
          children: WorkbenchPage,
          private: true,
        },
      ],
    },
  },
};

export default {
  id,
  getCustomizationModule() {
    return [
      {
        name: 'default',
        value: workbenchPageCustomization,
      },
    ];
  },
};

export { id, workbenchPageCustomization };
