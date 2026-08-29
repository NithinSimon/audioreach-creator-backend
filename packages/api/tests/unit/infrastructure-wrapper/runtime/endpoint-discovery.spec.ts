/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EndpointDiscoveryService} from '../../../../src/infrastructure-wrapper/runtime/endpoint-discovery.service.js';
import {ReadinessStateService} from '../../../../src/infrastructure-wrapper/runtime/readiness-state.service.js';
import {RuntimePaths} from '../../../../src/infrastructure-wrapper/runtime/runtime-paths.js';

describe('EndpointDiscoveryService', () => {
  let paths: RuntimePaths;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(path.join(tmpdir(), 'arc-endpoint-discovery-'));
    paths = new RuntimePaths(testRoot);
    await paths.ensureDirectories();
  });

  afterEach(async () => {
    await rm(testRoot, {force: true, recursive: true});
  });

  it('refuses endpoint publication before readiness and writes complete JSON after readiness', async () => {
    const readiness = new ReadinessStateService();
    const discovery = new EndpointDiscoveryService(paths, readiness);

    await expect(discovery.publish('http://127.0.0.1:43123')).rejects.toThrow(
      'Cannot publish endpoint before runtime is ready',
    );

    readiness.markReady();
    await discovery.publish('http://127.0.0.1:43123');

    await expect(readFile(paths.endpointPath, 'utf8')).resolves.toBe(
      '{"schemaVersion":1,"apiBaseUrl":"http://127.0.0.1:43123"}\n',
    );
  });

  it('does not remove a newer endpoint during older process shutdown', async () => {
    const readiness = new ReadinessStateService();
    const discovery = new EndpointDiscoveryService(paths, readiness);
    await writeFile(
      paths.endpointPath,
      '{"schemaVersion":1,"apiBaseUrl":"http://127.0.0.1:49000"}\n',
    );

    await discovery.removeIfMatches('http://127.0.0.1:43123');

    await expect(readFile(paths.endpointPath, 'utf8')).resolves.toContain('49000');
  });
});
