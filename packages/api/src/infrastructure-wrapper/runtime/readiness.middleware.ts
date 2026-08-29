/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Injectable} from '@nestjs/common';
import type {NestMiddleware} from '@nestjs/common';
import type {NextFunction, Request, Response} from 'express';
import {ReadinessStateService} from './readiness-state.service.js';

@Injectable()
export class ReadinessMiddleware implements NestMiddleware {
  constructor(private readonly readiness: ReadinessStateService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (request.path.startsWith('/health/')) {
      next();
      return;
    }

    if (!this.readiness.isReady()) {
      response.status(503).json({
        statusCode: 503,
        code: 'ARC_RUNTIME_NOT_READY',
      });
      return;
    }

    next();
  }
}
