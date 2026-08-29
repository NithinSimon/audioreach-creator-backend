/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RuntimePaths} from '../../../../src/infrastructure-wrapper/runtime/runtime-paths.js';

describe('RuntimePaths', () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(path.join(tmpdir(), 'arc-runtime-paths-'));
  });

  afterEach(async () => {
    await rm(testRoot, {force: true, recursive: true});
  });

  it('creates the runtime and log directories before SQLite is opened', async () => {
    const paths = new RuntimePaths(path.join(testRoot, 'nested', 'data'));
    await paths.ensureDirectories();

    await expect(stat(paths.runtimeDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(stat(paths.logsDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });
});
