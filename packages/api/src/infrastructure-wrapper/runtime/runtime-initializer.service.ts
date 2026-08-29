/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Injectable} from '@nestjs/common';
import {DataSourceProvider} from '../database/providers/data-source-provider.js';
import {EndpointDiscoveryService} from './endpoint-discovery.service.js';
import {ReadinessStateService} from './readiness-state.service.js';
import {RuntimePaths} from './runtime-paths.js';

@Injectable()
export class RuntimeInitializerService {
  constructor(
    private readonly paths: RuntimePaths,
    private readonly dataSourceProvider: DataSourceProvider,
    private readonly readiness: ReadinessStateService,
    private readonly discovery: EndpointDiscoveryService,
  ) {}

  async initialize(baseUrl = 'http://127.0.0.1:0'): Promise<void> {
    try {
      await this.paths.ensureDirectories();
      await this.dataSourceProvider.getDataSource();
      this.readiness.markReady();
      await this.discovery.publish(baseUrl);
    } catch (error) {
      this.readiness.markFailed();
      throw error;
    }
  }
}
