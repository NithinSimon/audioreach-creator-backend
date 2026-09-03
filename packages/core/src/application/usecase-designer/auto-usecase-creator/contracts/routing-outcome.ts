/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {KeyVectorInput} from '../../../../domain/entities/usecase-data/usecase/usecase.js';
import type {UsecaseType} from '../../../../domain/entities/usecase-data/usecase/usecase-type.js';
import type {Issue} from '../../../../shared/issues/issue.js';

export interface UsecaseIdentifierWithChangeInfo {
  readonly systemId: number;
  readonly type: UsecaseType;
  readonly keyVector: KeyVectorInput;
  readonly aliasId?: number;
  readonly alias?: string;
  readonly categories: readonly string[];
  readonly changeId: number;
}

export interface RoutingOutcome {
  readonly created: readonly UsecaseIdentifierWithChangeInfo[];
  readonly updated: readonly UsecaseIdentifierWithChangeInfo[];
  readonly markedForDeletion: readonly UsecaseIdentifierWithChangeInfo[];
  readonly issues: readonly Issue[];
  readonly groupId: string;
}

export function createEmptyRoutingOutcome(
  groupId: string,
  issues: readonly Issue[] = [],
): RoutingOutcome {
  return {
    created: [],
    updated: [],
    markedForDeletion: [],
    issues: [...issues],
    groupId,
  };
}
