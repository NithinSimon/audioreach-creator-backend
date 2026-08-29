/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {ReadinessStateService} from '../../../../src/infrastructure-wrapper/runtime/readiness-state.service.js';

describe('ReadinessStateService', () => {
  it('tracks the runtime lifecycle', () => {
    const readiness = new ReadinessStateService();

    expect(readiness.current()).toBe('starting');
    readiness.markReady();
    expect(readiness.isReady()).toBe(true);
    readiness.markShuttingDown();
    expect(readiness.current()).toBe('shutting_down');
  });
});
