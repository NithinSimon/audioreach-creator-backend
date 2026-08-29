/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {ValidationPipe} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import type {Logger} from '@arc/core';
import {setupSwagger} from './presentation/rest/common/services/swagger-service.js';
import {AppModule} from './app.module.js';
import {Tokens} from './presentation/rest/common/utils/index.js';
import {AllExceptionsFilter} from './infrastructure-wrapper/filters/all-exceptions.filter.js';
import {ValidationExceptionFilter} from './infrastructure-wrapper/filters/validation-exception.filter.js';
import {SessionRequiredFilter} from './filters/session-required.filter.js';
import {SessionModeNotAllowedFilter} from './filters/session-mode-not-allowed.filter.js';
import type {AddressInfo} from 'node:net';
import {
  type RuntimeConfig,
} from './infrastructure-wrapper/runtime/runtime-config.js';
import {RuntimeInitializerService} from './infrastructure-wrapper/runtime/runtime-initializer.service.js';
import {RuntimeShutdownService} from './infrastructure-wrapper/runtime/runtime-shutdown.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Enable CORS
  app.enableCors();

  // Register global exception filters
  const logger = app.get<Logger>('LOGGER');
  app.useGlobalFilters(
    new AllExceptionsFilter(logger),
    new ValidationExceptionFilter(logger),
    new SessionRequiredFilter(),
    new SessionModeNotAllowedFilter(),
  );

  const runtimeConfig = app.get<RuntimeConfig>('RUNTIME_CONFIG');

  // Setup Swagger documentation for 'production' only.
  const buildType = process.env.NODE_ENV ?? Tokens.BUILD_DEVELOPMENT;
  if (buildType !== Tokens.BUILD_PRODUCTION) {
    setupSwagger(app);
    logger.logInfo({
      component: 'Bootstrap',
      action: 'setupSwagger',
      msg: 'Swagger documentation configured',
      timestamp: new Date(),
      tag: 'startup',
    });
  }

  const server = await app.listen(
    runtimeConfig.requestedPort,
    runtimeConfig.bindHost,
  );
  const address = server.address() as AddressInfo;
  const host =
    runtimeConfig.bindHost === '::1'
      ? `[${runtimeConfig.bindHost}]`
      : runtimeConfig.bindHost;
  const baseUrl = `http://${host}:${address.port}`;
  await app.get(RuntimeInitializerService).initialize(baseUrl);
  const shutdown = app.get(RuntimeShutdownService);
  shutdown.attachApplication(app);
  const stop = () => {
    void shutdown.shutdown(baseUrl).catch(error => {
      console.error('Failed to shut down application:', error);
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  logger.logInfo({
    component: 'Bootstrap',
    action: 'startup',
    msg: `Application is running on: ${baseUrl}/arc-api/v1`,
    timestamp: new Date(),
    tag: 'startup',
  });
}

try {
  await bootstrap();
} catch (error) {
  // We can't use the logger here since it might not be initialized yet
  console.error('Failed to start application:', error);
  process.exit(1);
}
