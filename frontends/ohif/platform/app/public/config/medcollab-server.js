// Deployment-owned same-origin configuration. Dataset id is a scope, never an upstream URL.
const dataset = new URLSearchParams(location.search).get('datasetId') || '';
const root = '/api/datasets/' + encodeURIComponent(dataset) + '/dicomweb';
window.config = {
  name: 'MedCollab server',
  routerBasename: '/imaging',
  extensions: [],
  modes: [],
  showStudyList: false,
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'span',
        {
          'data-cy': 'medcollab-brand',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: '#182524',
            whiteSpace: 'nowrap',
          },
        },
        React.createElement('img', {
          src: '/brand/medcollab-mark.svg',
          alt: '',
          width: 25,
          height: 28,
        }),
        React.createElement(
          'span',
          { style: { fontSize: '18px', fontWeight: 650, lineHeight: '28px' } },
          'MedCollab'
        )
      );
    },
  },
  maxNumberOfWebWorkers: 3,
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: true,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  customizationService: {},
  defaultDataSourceName: 'medcollab',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'medcollab',
      configuration: {
        friendlyName: 'MedCollab 数据集',
        name: 'medcollab',
        qidoRoot: root,
        wadoRoot: root,
        wadoUriRoot: root,
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: false,
        dicomUploadEnabled: false,
        staticWado: false,
        singlepart: 'bulkdata,video',
        bulkDataURI: { enabled: true, relativeResolution: 'studies' },
        segmentation: { store: { mode: 'labelmap', transferSyntaxUID: '1.2.840.10008.1.2.1' } },
      },
    },
  ],
};
