/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {resolveRuntimeConfig} from '../runtime/runtime-config.js';
import {RuntimePaths} from '../runtime/runtime-paths.js';

export function getDatabasePath(runtimePaths?: RuntimePaths): string {
  return (runtimePaths ?? new RuntimePaths(resolveRuntimeConfig().dataDir))
    .databasePath;
}
