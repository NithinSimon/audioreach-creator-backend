/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {RuntimeShutdownService} from '../../../../src/infrastructure-wrapper/runtime/runtime-shutdown.service.js';

describe('RuntimeShutdownService', () => {
  it('marks shutdown, removes its endpoint, closes app resources, then destroys SQLite', async () => {
    const calls: string[] = [];
    const service = new RuntimeShutdownService(
      {markShuttingDown: () => calls.push('state')} as any,
      {removeIfMatches: async () => calls.push('endpoint')} as any,
      {destroy: async () => calls.push('database')} as any,
    );
    service.attachApplication({close: async () => calls.push('app')} as any);

    await service.shutdown('http://127.0.0.1:43123');

    expect(calls).toEqual(['state', 'endpoint', 'app', 'database']);
  });
});
