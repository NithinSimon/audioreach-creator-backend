/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Injectable} from '@nestjs/common';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {ReadinessStateService} from './readiness-state.service.js';
import {RuntimePaths} from './runtime-paths.js';

export type EndpointRecord = Readonly<{
  schemaVersion: 1;
  apiBaseUrl: string;
}>;

@Injectable()
export class EndpointDiscoveryService {
  constructor(
    private readonly paths: RuntimePaths,
    private readonly readiness: ReadinessStateService,
  ) {}

  async publish(apiBaseUrl: string): Promise<void> {
    if (!this.readiness.isReady()) {
      throw new Error('Cannot publish endpoint before runtime is ready');
    }

    await this.paths.ensureDirectories();
    const endpoint: EndpointRecord = {schemaVersion: 1, apiBaseUrl};
    const temporaryPath = path.join(
      this.paths.runtimeDir,
      `.endpoint-${process.pid}-${Date.now()}.tmp`,
    );
    const file = await fs.open(temporaryPath, 'w', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(endpoint)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.rename(temporaryPath, this.paths.endpointPath);
  }

  async removeIfMatches(apiBaseUrl: string): Promise<void> {
    let contents: string;
    try {
      contents = await fs.readFile(this.paths.endpointPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    let endpoint: EndpointRecord;
    try {
      endpoint = JSON.parse(contents) as EndpointRecord;
    } catch {
      return;
    }

    if (endpoint.apiBaseUrl === apiBaseUrl) {
      await fs.rm(this.paths.endpointPath, {force: true});
    }
  }
}
