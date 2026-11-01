import i18n from '@ohif/i18n';

/**
 *
 * @param {*} servicesManager
 */
async function createReportAsync({
  servicesManager,
  getReport,
  reportType = 'Measurements',
  successMessage,
}: withAppTypes) {
  const { displaySetService, uiNotificationService, uiDialogService } = servicesManager.services;

  try {
    const naturalizedReport = await getReport();

    if (!naturalizedReport) {
      return;
    }

    // addInstances is called by the store command (storeMeasurements/storeSegmentation),
    // so the display set should already exist at this point.
    const displaySet = displaySetService.getMostRecentDisplaySet();

    const displaySetInstanceUID = displaySet.displaySetInstanceUID;

    uiNotificationService.show({
      title: i18n.t('Common:Create Report'),
      message: successMessage ?? i18n.t('Common:{{reportType}} saved successfully', {
        reportType: i18n.t(`Common:${reportType}`, { defaultValue: reportType }),
      }),
      type: 'success',
    });

    return [displaySetInstanceUID];
  } catch (error) {
    uiNotificationService.show({
      title: i18n.t('Common:Create Report'),
      message: i18n.t('Common:Failed to store {{reportType}}. Error: {{message}}', {
        reportType: i18n.t(`Common:${reportType}`, { defaultValue: reportType }),
        message: error.message || i18n.t('Common:Unknown error'),
      }),
      type: 'error',
    });
    throw new Error(`Failed to store ${reportType}. Error: ${error.message || 'Unknown error'}`);
  } finally {
    uiDialogService.hide('loading-dialog');
  }
}

export default createReportAsync;
