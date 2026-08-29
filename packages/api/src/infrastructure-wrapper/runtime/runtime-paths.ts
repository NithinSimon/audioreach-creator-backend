/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';

export class RuntimePaths {
  constructor(readonly dataDir: string) {}

  get databasePath(): string {
    return path.join(this.dataDir, 'database.db');
  }

  get runtimeDir(): string {
    return path.join(this.dataDir, 'runtime');
  }

  get endpointPath(): string {
    return path.join(this.runtimeDir, 'endpoint.json');
  }

  get logsDir(): string {
    return path.join(this.dataDir, 'logs');
  }

  async ensureDirectories(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.dataDir, {recursive: true}),
      fs.mkdir(this.runtimeDir, {recursive: true}),
      fs.mkdir(this.logsDir, {recursive: true}),
    ]);
  }
}
