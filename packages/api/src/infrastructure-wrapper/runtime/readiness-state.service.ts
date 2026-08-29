/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Injectable} from '@nestjs/common';

export type ReadinessStatus = 'starting' | 'ready' | 'failed' | 'shutting_down';

@Injectable()
export class ReadinessStateService {
  private status: ReadinessStatus = 'starting';

  current(): ReadinessStatus {
    return this.status;
  }

  isReady(): boolean {
    return this.status === 'ready';
  }

  markReady(): void {
    this.status = 'ready';
  }

  markFailed(): void {
    this.status = 'failed';
  }

  markShuttingDown(): void {
    this.status = 'shutting_down';
  }
}
