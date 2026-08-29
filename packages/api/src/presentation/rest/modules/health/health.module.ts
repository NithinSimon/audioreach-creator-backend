/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Module} from '@nestjs/common';
import {RuntimeModule} from '../../../../infrastructure-wrapper/runtime/runtime.module.js';
import {HealthController} from './health.controller.js';

@Module({
  imports: [RuntimeModule],
  controllers: [HealthController],
})
export class HealthModule {}
