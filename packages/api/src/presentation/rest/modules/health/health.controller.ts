/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Controller, Get, Res} from '@nestjs/common';
import type {Response} from 'express';
import {ReadinessStateService} from '../../../../infrastructure-wrapper/runtime/readiness-state.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessStateService) {}

  @Get('live')
  live(@Res() response: Response): void {
    const status = this.readiness.current();
    response.status(status === 'shutting_down' ? 503 : 200).json({status});
  }

  @Get('ready')
  ready(@Res() response: Response): void {
    const status = this.readiness.current();
    response.status(status === 'ready' ? 200 : 503).json({status});
  }
}
