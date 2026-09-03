/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {ControlLink} from '../../../../domain/entities/usecase-data/links/control-link.js';
import type {DataLink} from '../../../../domain/entities/usecase-data/links/data-link.js';
import type {UseCase} from '../../../../domain/entities/usecase-data/usecase/usecase.js';
import type {SubgraphPair} from '../../../ports/persistence/repositories/shared/links-for-pair.js';
import type {Subgraph} from '../../../../domain/entities/usecase-data/subgraph/subgraph.js';

export const ROUTING_MODE = {
  Auto: 'AUTO',
  Manual: 'MANUAL',
} as const;

export type RoutingMode = (typeof ROUTING_MODE)[keyof typeof ROUTING_MODE];

export interface ActiveSubgraphSelection {
  readonly systemId: number;
  readonly valueSystemIds: readonly (readonly number[])[];
}

export interface GraphEditSummary {
  readonly addedSgs: readonly Subgraph[];
  readonly deletedSgs: readonly Subgraph[];
  readonly addedDataLinks: readonly DataLink[];
  readonly deletedDataLinks: readonly DataLink[];
  readonly addedControlLinks: readonly ControlLink[];
  readonly deletedControlLinks: readonly ControlLink[];
}

export interface ManualTopology {
  readonly pairs: readonly SubgraphPair[];
  readonly supportingDataLinkSystemIds: readonly number[];
  readonly supportingControlLinkSystemIds: readonly number[];
  readonly isolatedSubgraphSystemIds: readonly number[];
}

interface RoutingInputBase {
  readonly selectedUsecaseSystemIds: readonly number[];
  readonly activeSubgraphs: readonly ActiveSubgraphSelection[];
  readonly excludedDataLinkSystemIds: readonly number[];
  readonly excludedControlLinkSystemIds: readonly number[];
  readonly excludedSubgraphSystemIds: readonly number[];
  readonly graphEdits: GraphEditSummary;
}

export interface AutoRoutingInput extends RoutingInputBase {
  readonly mode: typeof ROUTING_MODE.Auto;
  readonly staleUcs: readonly UseCase[];
}

export interface ManualRoutingInput extends RoutingInputBase {
  readonly mode: typeof ROUTING_MODE.Manual;
  readonly manualTopology: ManualTopology;
}

export type RoutingInput = AutoRoutingInput | ManualRoutingInput;

export interface RoutingInputInit {
  readonly selectedUsecaseSystemIds: readonly number[];
  readonly activeSubgraphs: readonly ActiveSubgraphSelection[];
  readonly excludedDataLinkSystemIds?: readonly number[];
  readonly excludedControlLinkSystemIds?: readonly number[];
  readonly excludedSubgraphSystemIds?: readonly number[];
  readonly graphEdits: GraphEditSummary;
}

function copySelections(
  selections: readonly ActiveSubgraphSelection[],
): readonly ActiveSubgraphSelection[] {
  return selections.map(selection => ({
    systemId: selection.systemId,
    valueSystemIds: selection.valueSystemIds.map(values => [...values]),
  }));
}

function copyBase(init: RoutingInputInit): RoutingInputBase {
  return {
    selectedUsecaseSystemIds: [...init.selectedUsecaseSystemIds],
    activeSubgraphs: copySelections(init.activeSubgraphs),
    excludedDataLinkSystemIds: [...(init.excludedDataLinkSystemIds ?? [])],
    excludedControlLinkSystemIds: [
      ...(init.excludedControlLinkSystemIds ?? []),
    ],
    excludedSubgraphSystemIds: [
      ...(init.excludedSubgraphSystemIds ?? []),
    ],
    graphEdits: {
      addedSgs: [...init.graphEdits.addedSgs],
      deletedSgs: [...init.graphEdits.deletedSgs],
      addedDataLinks: [...init.graphEdits.addedDataLinks],
      deletedDataLinks: [...init.graphEdits.deletedDataLinks],
      addedControlLinks: [...init.graphEdits.addedControlLinks],
      deletedControlLinks: [...init.graphEdits.deletedControlLinks],
    },
  };
}

export function createAutoRoutingInput(
  init: RoutingInputInit & {readonly staleUcs: readonly UseCase[]},
): AutoRoutingInput {
  return {
    ...copyBase(init),
    mode: ROUTING_MODE.Auto,
    staleUcs: [...init.staleUcs],
  };
}

export function createManualRoutingInput(
  init: RoutingInputInit & {readonly manualTopology: ManualTopology},
): ManualRoutingInput {
  return {
    ...copyBase(init),
    mode: ROUTING_MODE.Manual,
    manualTopology: {
      pairs: [...init.manualTopology.pairs],
      supportingDataLinkSystemIds: [
        ...init.manualTopology.supportingDataLinkSystemIds,
      ],
      supportingControlLinkSystemIds: [
        ...init.manualTopology.supportingControlLinkSystemIds,
      ],
      isolatedSubgraphSystemIds: [
        ...init.manualTopology.isolatedSubgraphSystemIds,
      ],
    },
  };
}

export function emptyGraphEdits(): GraphEditSummary {
  return {
    addedSgs: [],
    deletedSgs: [],
    addedDataLinks: [],
    deletedDataLinks: [],
    addedControlLinks: [],
    deletedControlLinks: [],
  };
}
