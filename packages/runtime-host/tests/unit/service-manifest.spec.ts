import {parseServiceManifest} from '../../src/service-manifest.js';

describe('parseServiceManifest', () => {
  it('rejects a service without command and readinessPath', () => {
    expect(() =>
      parseServiceManifest({schemaVersion: 1, services: [{id: 'offline-api'}]}),
    ).toThrow('Service offline-api must define command and readinessPath');
  });
});
