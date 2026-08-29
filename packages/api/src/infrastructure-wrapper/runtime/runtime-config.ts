/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import * as os from 'node:os';
import path from 'node:path';

export type RuntimeConfig = Readonly<{
  mode: 'development' | 'desktop';
  dataDir: string;
  bindHost: '127.0.0.1' | '::1';
  requestedPort: number;
  serviceId: string;
}>;

export function resolveRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const mode =
    environment.ARC_RUNTIME_MODE === 'desktop' ? 'desktop' : 'development';
  const bindHost = environment.ARC_BIND_HOST ?? '127.0.0.1';
  if (bindHost !== '127.0.0.1' && bindHost !== '::1') {
    throw new Error('ARC_BIND_HOST must be a loopback address');
  }

  const requestedPort = Number(
    environment.ARC_PORT ?? (mode === 'desktop' ? '0' : environment.PORT ?? '3000'),
  );
  if (
    !Number.isInteger(requestedPort) ||
    requestedPort < 0 ||
    requestedPort > 65535
  ) {
    throw new Error('ARC_PORT must be an integer from 0 through 65535');
  }

  return {
    mode,
    dataDir: resolveDefaultDataDir(environment),
    bindHost,
    requestedPort,
    serviceId: environment.ARC_SERVICE_ID ?? 'offline-api',
  };
}

function resolveDefaultDataDir(environment: NodeJS.ProcessEnv): string {
  if (environment.ARC_DATA_DIR) {
    return path.resolve(environment.ARC_DATA_DIR);
  }

  const appName = 'audioreach-creator';
  switch (os.platform()) {
    case 'win32':
      return path.join(
        environment.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
        appName,
      );
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', appName);
    default:
      return path.join(
        environment.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'),
        appName,
      );
  }
}
