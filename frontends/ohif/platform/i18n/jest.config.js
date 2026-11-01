const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  displayName: '@ohif/i18n',
  testEnvironment: 'node',
  moduleFileExtensions: [...base.moduleFileExtensions, 'json'],
};
