import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button, Header, Icons, useModal } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { Toolbar } from '../Toolbar/Toolbar';
import HeaderPatientInfo from './HeaderPatientInfo';
import { PatientInfoVisibility } from './HeaderPatientInfo/HeaderPatientInfo';
import { preserveQueryParameters } from '@ohif/app';
import { Types } from '@ohif/core';

/**
 * Customizations can hold plain data as well as components; only render values
 * that React can actually mount (function components, forwardRef, memo, lazy).
 */
const isRenderableComponent = (
  value: unknown
): value is React.ComponentType<{ servicesManager: AppTypes.ServicesManager }> =>
  typeof value === 'function' ||
  (typeof value === 'object' && value !== null && '$$typeof' in (value as object));

function ViewerHeader({ appConfig }: withAppTypes<{ appConfig: AppTypes.Config }>) {
  const { servicesManager, extensionManager, commandsManager } = useSystem();
  const { customizationService } = servicesManager.services;

  const navigate = useNavigate();
  const location = useLocation();

  const onClickReturnButton = async () => {
    const workspace = (servicesManager.services as any).annotationWorkspaceService;
    if (workspace?.getEditState().caseId && !(await workspace.close())) {
      return;
    }
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);

    const dataSourceName = pathname.substring(dataSourceIdx + 1);
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }
    preserveQueryParameters(searchQuery, customizationService);

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  const isDatasetWorkspace = new URLSearchParams(location.search).has('datasetId');
  const datasetWorkspace = (servicesManager.services as any).datasetWorkspaceService;
  const [historyAllowed, setHistoryAllowed] = useState(() =>
    !isDatasetWorkspace || !!datasetWorkspace?.canEditHistory?.()
  );
  useEffect(() => {
    const sync = () => setHistoryAllowed(
      !isDatasetWorkspace || !!datasetWorkspace?.canEditHistory?.()
    );
    sync();
    if (isDatasetWorkspace) return datasetWorkspace?.subscribe(sync);
  }, [datasetWorkspace, isDatasetWorkspace]);
  const homeButtonLabel = isDatasetWorkspace ? '首页' : '工作台';
  const onClickHomeButton = async () => {
    if (!isDatasetWorkspace) {
      navigate('/workbench');
      return;
    }
    const workspace = (servicesManager.services as any).annotationWorkspaceService;
    if (workspace?.getEditState().caseId && !(await workspace.close())) {
      return;
    }
    window.location.assign('/home');
  };

  const { t } = useTranslation();
  const { show } = useModal();

  const AboutModal = customizationService.getCustomization(
    'ohif.aboutModal'
  ) as Types.MenuComponentCustomization;

  const AppearanceModal = customizationService.getCustomization(
    'ohif.appearanceModal'
  ) as Types.MenuComponentCustomization;

  const UserPreferencesModal = customizationService.getCustomization(
    'ohif.userPreferencesModal'
  ) as Types.MenuComponentCustomization;

  const collaborationBarCustomization = customizationService.getCustomization(
    'medcollab.collaborationBar'
  );
  const CollaborationBar = isRenderableComponent(collaborationBarCustomization)
    ? collaborationBarCustomization
    : null;

  const menuOptions = [
    {
      title: AboutModal?.menuTitle ?? t('Header:About'),
      icon: 'info',
      onClick: () =>
        show({
          content: AboutModal,
          title: AboutModal?.title ?? t('AboutModal:About OHIF Viewer'),
          containerClassName: AboutModal?.containerClassName ?? 'max-w-md',
        }),
    },
    {
      title: UserPreferencesModal.menuTitle ?? t('Header:Preferences'),
      icon: 'settings',
      onClick: () =>
        show({
          content: UserPreferencesModal,
          title: UserPreferencesModal.title ?? t('UserPreferencesModal:User preferences'),
          containerClassName:
            UserPreferencesModal?.containerClassName ?? 'flex max-w-4xl p-6 flex-col',
        }),
    },
  ];

  if (AppearanceModal) {
    menuOptions.splice(1, 0, {
      title: AppearanceModal.menuTitle ?? t('Header:Appearance'),
      icon: 'ColorChange',
      onClick: () =>
        show({
          content: AppearanceModal,
          title: AppearanceModal.title ?? t('AppearanceModal:Appearance'),
          containerClassName: AppearanceModal.containerClassName ?? 'max-w-md',
        }),
    });
  }

  if (appConfig.oidc) {
    menuOptions.push({
      title: t('Header:Logout'),
      icon: 'power-off',
      onClick: async () => {
        navigate(`/logout?redirect_uri=${encodeURIComponent(window.location.href)}`);
      },
    });
  }

  return (
    <>
      <Header
        menuOptions={menuOptions}
        isReturnEnabled={!!appConfig.showStudyList}
        onClickReturnButton={onClickReturnButton}
        WhiteLabeling={appConfig.whiteLabeling}
        Secondary={
          <div className="flex h-full items-center gap-1">
            <Toolbar buttonSection="secondary" />
            <Button
              variant="ghost"
              size="sm"
              className="hover:bg-muted text-primary h-7 px-2 text-[13px]"
              title={homeButtonLabel}
              aria-label={homeButtonLabel}
              data-cy="workbench-btn"
              onClick={onClickHomeButton}
            >
              {homeButtonLabel}
            </Button>
          </div>
        }
        PatientInfo={
          appConfig.showPatientInfo !== PatientInfoVisibility.DISABLED && (
            <HeaderPatientInfo
              servicesManager={servicesManager}
              appConfig={appConfig}
            />
          )
        }
        UndoRedo={
          <div className="text-primary flex cursor-pointer items-center">
            <Button
              variant="ghost"
              className="hover:bg-muted"
              data-cy="undo-btn"
              disabled={!historyAllowed}
              title={t('UserPreferencesModal:Undo')}
              aria-label={t('UserPreferencesModal:Undo')}
              onClick={() => {
                commandsManager.run('undo');
              }}
            >
              <Icons.Undo className="" />
            </Button>
            <Button
              variant="ghost"
              className="hover:bg-muted"
              data-cy="redo-btn"
              disabled={!historyAllowed}
              title={t('UserPreferencesModal:Redo')}
              aria-label={t('UserPreferencesModal:Redo')}
              onClick={() => {
                commandsManager.run('redo');
              }}
            >
              <Icons.Redo className="" />
            </Button>
          </div>
        }
      >
        <div className="relative flex justify-center gap-[4px]">
          <Toolbar buttonSection="primary" />
        </div>
      </Header>
      {CollaborationBar && <CollaborationBar servicesManager={servicesManager} />}
    </>
  );
}

export default ViewerHeader;
