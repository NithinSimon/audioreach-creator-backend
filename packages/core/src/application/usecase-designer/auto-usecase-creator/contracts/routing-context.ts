/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UseCase} from '../../../../domain/entities/usecase-data/usecase/usecase.js';
import type {Issue} from '../../../../shared/issues/issue.js';
import type {RoutingInput, RoutingMode} from './routing-input.js';
import type {RoutingOutcome} from './routing-outcome.js';
import type {
  ClassifiedUsecase,
  DfsPath,
  KvResolution,
  OrphanCandidate,
  RoutingCombination,
  RoutingCone,
  RoutingSeed,
  StagedChangeSummary,
} from './routing-state.js';

export class RoutingContext {
  readonly input: RoutingInput;
  readonly mode: RoutingMode;
  readonly allUcs: UseCase[] = [];
  readonly excludedDataLinkSystemIds: Set<number>;
  readonly excludedControlLinkSystemIds: Set<number>;
  readonly excludedSubgraphSystemIds: Set<number>;
  readonly markedForDeletion: UseCase[] = [];
  readonly deletionPreservedUcs: UseCase[] = [];
  readonly degradedToDisconnected: UseCase[] = [];
  readonly reconstructionPaths: DfsPath[] = [];
  readonly disconnectedTransitions: UseCase[] = [];
  readonly kvResolutions: KvResolution[] = [];
  readonly seeds: RoutingSeed[] = [];
  readonly cones: RoutingCone[] = [];
  readonly dfsPaths: DfsPath[] = [];
  readonly combinations: {candidates: RoutingCombination[]} = {
    candidates: [],
  };
  readonly ecBridgeCandidates: RoutingCombination[] = [];
  readonly classified: ClassifiedUsecase[] = [];
  readonly orphans: OrphanCandidate[] = [];
  readonly warnings: Issue[] = [];
  readonly stagedChanges: StagedChangeSummary[] = [];
  response: RoutingOutcome | null = null;

  constructor(input: RoutingInput) {
    this.input = input;
    this.mode = input.mode;
    this.excludedDataLinkSystemIds = new Set(
      input.excludedDataLinkSystemIds,
    );
    this.excludedControlLinkSystemIds = new Set(
      input.excludedControlLinkSystemIds,
    );
    this.excludedSubgraphSystemIds = new Set(
      input.excludedSubgraphSystemIds,
    );
  }

}
