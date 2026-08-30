import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HealthClient} from '../../src/health-client.js';

describe('HealthClient', () => {
  it('treats non-loopback endpoint records as non-ready', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arc-health-client-'));
    const endpointPath = path.join(root, 'endpoint.json');
    try {
      await writeFile(
        endpointPath,
        '{"apiBaseUrl":"http://192.168.1.20:3000"}',
      );
      await expect(new HealthClient().isReady(endpointPath)).resolves.toBe(
        false,
      );
    } finally {
      await rm(root, {force: true, recursive: true});
    }
  });
});
