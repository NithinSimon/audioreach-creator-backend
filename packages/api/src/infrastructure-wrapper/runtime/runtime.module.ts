/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Global, Module} from '@nestjs/common';
import {resolveRuntimeConfig, type RuntimeConfig} from './runtime-config.js';
import {RuntimePaths} from './runtime-paths.js';
import {ReadinessStateService} from './readiness-state.service.js';
import {EndpointDiscoveryService} from './endpoint-discovery.service.js';

@Global()
@Module({
  providers: [
    {
      provide: 'RUNTIME_CONFIG',
      useFactory: (): RuntimeConfig => resolveRuntimeConfig(),
    },
    {
      provide: RuntimePaths,
      useFactory: (config: RuntimeConfig) => new RuntimePaths(config.dataDir),
      inject: ['RUNTIME_CONFIG'],
    },
    ReadinessStateService,
    EndpointDiscoveryService,
  ],
  exports: [
    'RUNTIME_CONFIG',
    RuntimePaths,
    ReadinessStateService,
    EndpointDiscoveryService,
  ],
})
export class RuntimeModule {}
