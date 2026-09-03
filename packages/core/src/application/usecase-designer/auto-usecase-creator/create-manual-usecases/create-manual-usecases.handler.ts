/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {DomainRuleViolationException} from '../../../../shared/exceptions/domain-rule-violation.exception.js';
import {RESULT_KIND} from '../../../shared/result/result.js';
import type {Result} from '../../../shared/result/result.js';
import type {CommandHandler} from '../../../orchestration/cqrs/commands/command-handler.js';
import type {UnitOfWork} from '../../../ports/persistence/unit-of-work.js';
import {createManualRoutingInput} from '../contracts/routing-input.js';
import type {ActiveSubgraphSelection} from '../contracts/routing-input.js';
import type {RoutingOutcome} from '../contracts/routing-outcome.js';
import {createRoutingEngine} from '../engine/create-routing-engine.js';
import {ManualPairDiscoveryService} from '../services/manual-pair-discovery.service.js';
import {SubsystemLinkResolutionService} from '../services/subsystem-link-resolution.service.js';
import {CreateManualUsecasesCommand} from './create-manual-usecases.command.js';

export class CreateManualUsecasesHandler implements CommandHandler<
  CreateManualUsecasesCommand,
  Result<RoutingOutcome>
> {
  private readonly subsystemLinkResolutionService =
    new SubsystemLinkResolutionService();
  private readonly engine = createRoutingEngine();
  private readonly pairDiscovery = new ManualPairDiscoveryService();

  constructor(private readonly uow: UnitOfWork) {}

  async handle(
    command: CreateManualUsecasesCommand,
  ): Promise<Result<RoutingOutcome>> {
    await this.uow.startTransaction();
    try {
      const resolution =
        await this.subsystemLinkResolutionService.resolveAllChains(this.uow);
      if (resolution.kind === RESULT_KIND.Fail) {
        throw new DomainRuleViolationException(resolution.issues);
      }

      const activeSubgraphs = this.filterExcludedSubgraphs(
        command.activeSubgraphs,
        command.excludedSubgraphSystemIds,
      );
      const topology = await this.pairDiscovery.discover(
        command.fileSystemId,
        activeSubgraphs,
        command.excludedDataLinkSystemIds,
        command.excludedControlLinkSystemIds,
        this.uow,
      );
      if (topology.kind === RESULT_KIND.Fail) {
        throw new DomainRuleViolationException(topology.issues);
      }

      const graphEdits = await this.readGraphEdits(command.fileSystemId);
      const input = createManualRoutingInput({
        selectedUsecaseSystemIds: command.selectedUsecaseSystemIds,
        activeSubgraphs,
        excludedDataLinkSystemIds: command.excludedDataLinkSystemIds,
        excludedControlLinkSystemIds: command.excludedControlLinkSystemIds,
        excludedSubgraphSystemIds: command.excludedSubgraphSystemIds,
        graphEdits,
        manualTopology: topology.data,
      });
      const result = await this.engine.run(input, this.uow);
      if (result.kind === RESULT_KIND.Fail) {
        throw new DomainRuleViolationException(result.issues);
      }
      await this.uow.applyCachedActions();
      await this.uow.commit();
      return result;
    } catch (error) {
      if (this.uow.isInTransaction()) await this.uow.rollback();
      throw error;
    }
  }

  private filterExcludedSubgraphs(
    activeSubgraphs: readonly ActiveSubgraphSelection[],
    excludedSubgraphSystemIds: readonly number[],
  ): readonly ActiveSubgraphSelection[] {
    const excluded = new Set(excludedSubgraphSystemIds);
    return activeSubgraphs
      .filter(selection => !excluded.has(selection.systemId))
      .map(selection => ({
        systemId: selection.systemId,
        valueSystemIds: selection.valueSystemIds.map(values => [...values]),
      }));
  }

  private async readGraphEdits(fileSystemId: number) {
    const [subgraphs, dataLinks, controlLinks] = await Promise.all([
      this.uow.getSubgraphRepository().findChangedInSession(fileSystemId),
      this.uow.getDataLinkRepository().findChangedInSession(fileSystemId),
      this.uow.getControlLinkRepository().findChangedInSession(fileSystemId),
    ]);
    return {
      addedSgs: subgraphs.added,
      deletedSgs: subgraphs.deleted,
      addedDataLinks: dataLinks.added,
      deletedDataLinks: dataLinks.deleted,
      addedControlLinks: controlLinks.added,
      deletedControlLinks: controlLinks.deleted,
    };
  }
}
