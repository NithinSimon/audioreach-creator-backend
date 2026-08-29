/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {INestApplication} from '@nestjs/common';
import request from 'supertest';
import {RuntimeInitializerService} from '../../../src/infrastructure-wrapper/runtime/runtime-initializer.service.js';
import {closeTestApp, createTestApp} from '../helpers/test-app.factory.js';

describe('runtime health', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp({initializeRuntime: false});
  });

  afterEach(async () => {
    await closeTestApp(app);
  });

  it('returns 503 before database initialization completes', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({status: 'starting'});
  });

  it('returns 200 after RuntimeInitializerService completes', async () => {
    await app.get(RuntimeInitializerService).initialize();
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({status: 'ready'});
  });

  it('gates non-health routes while not ready', async () => {
    await request(app.getHttpServer())
      .get('/arc-api/v1/projects')
      .expect(503)
      .expect({statusCode: 503, code: 'ARC_RUNTIME_NOT_READY'});
  });
});
