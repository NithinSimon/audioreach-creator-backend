/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Issue} from '../../../../shared/issues/issue.js';
import type {SubgraphPair} from '../../../ports/persistence/repositories/shared/links-for-pair.js';

export interface KvResolution {
  readonly sgSystemId: number;
  readonly sgkvSystemId: number;
  readonly valueSystemIds: readonly number[];
}

export interface RoutingSeed {
  readonly subgraphSystemId: number;
}

export interface RoutingCone {
  readonly seedSubgraphSystemId: number;
  readonly subgraphSystemIds: readonly number[];
}

export interface DfsPath {
  readonly subgraphSystemIds: readonly number[];
}

export interface RoutingCombination {
  readonly subgraphSystemIds: readonly number[];
  readonly valueSystemIds: readonly number[];
}

export interface ClassifiedUsecase {
  readonly systemId: number;
  readonly action: 'CREATE' | 'UPDATE' | 'DELETE' | 'NO_OP';
}

export interface OrphanCandidate {
  readonly systemId: number;
  readonly kind: 'SUBGRAPH' | 'SUBSYSTEM' | 'DATA_LINK' | 'CONTROL_LINK';
}

export interface StagedChangeSummary {
  readonly changeId: number;
  readonly systemId: number;
}

export type UsecasePair = SubgraphPair;
export type RoutingIssue = Issue;
