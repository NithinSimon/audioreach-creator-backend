/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {resolveRuntimeConfig} from '../../../../src/infrastructure-wrapper/runtime/runtime-config.js';

describe('resolveRuntimeConfig', () => {
  it('rejects a non-loopback bind host', () => {
    expect(() =>
      resolveRuntimeConfig({
        ARC_BIND_HOST: '192.168.1.20',
        ARC_DATA_DIR: '/tmp/arc-data',
      }),
    ).toThrow('ARC_BIND_HOST must be a loopback address');
  });

  it('uses port zero only in desktop runtime mode', () => {
    expect(
      resolveRuntimeConfig({
        ARC_RUNTIME_MODE: 'desktop',
        ARC_DATA_DIR: '/tmp/arc-data',
      }).requestedPort,
    ).toBe(0);
    expect(resolveRuntimeConfig({PORT: '4100'}).requestedPort).toBe(4100);
  });
});
