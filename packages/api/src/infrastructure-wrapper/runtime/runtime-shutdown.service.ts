/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Injectable} from '@nestjs/common';
import type {INestApplication} from '@nestjs/common';
import {DataSourceProvider} from '../database/providers/data-source-provider.js';
import {EndpointDiscoveryService} from './endpoint-discovery.service.js';
import {ReadinessStateService} from './readiness-state.service.js';

@Injectable()
export class RuntimeShutdownService {
  private stopping = false;
  private application: Pick<INestApplication, 'close'> | undefined;

  constructor(
    private readonly readiness: ReadinessStateService,
    private readonly discovery: EndpointDiscoveryService,
    private readonly dataSourceProvider: DataSourceProvider,
  ) {}

  attachApplication(application: Pick<INestApplication, 'close'>): void {
    this.application = application;
  }

  async shutdown(baseUrl: string): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;

    this.readiness.markShuttingDown();
    await this.discovery.removeIfMatches(baseUrl);
    await this.application?.close();
    await this.dataSourceProvider.destroy();
  }
}
