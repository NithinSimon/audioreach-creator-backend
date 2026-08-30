/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EndpointDiscoveryService} from '../../../src/infrastructure-wrapper/runtime/endpoint-discovery.service.js';
import {ReadinessStateService} from '../../../src/infrastructure-wrapper/runtime/readiness-state.service.js';
import {RuntimePaths} from '../../../src/infrastructure-wrapper/runtime/runtime-paths.js';
import {RuntimeShutdownService} from '../../../src/infrastructure-wrapper/runtime/runtime-shutdown.service.js';

describe('graceful runtime shutdown', () => {
  it('removes the endpoint owned by the shutting down process', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arc-runtime-shutdown-'));
    const paths = new RuntimePaths(root);
    const readiness = new ReadinessStateService();
    const discovery = new EndpointDiscoveryService(paths, readiness);
    const baseUrl = 'http://127.0.0.1:43123';

    try {
      readiness.markReady();
      await discovery.publish(baseUrl);
      const shutdown = new RuntimeShutdownService(readiness, discovery, {
        destroy: async () => undefined,
      } as any);
      shutdown.attachApplication({close: async () => undefined} as any);

      await shutdown.shutdown(baseUrl);

      await expect(readFile(paths.endpointPath, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(root, {force: true, recursive: true});
    }
  });
});
