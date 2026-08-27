<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Delete Module - Design

**Status:** Draft
**Owner:** Nithin Simon

**Requirements:** [`../requirements/delete-module-requirements.md`](../requirements/delete-module-requirements.md)
**Parent design:** [`../../edit-crud/overall-design.md`](../../edit-crud/overall-design.md)
**Write-path context:** [`../../edit-crud/module-write-path.md`](../../edit-crud/module-write-path.md)

---

## 1. Scope

This document specifies the implementation design for:

```http
DELETE /arc-api/v1/projects/{projectId}/spf-modules/{spfModuleSystemId}
```

The endpoint records an undoable module delete in the active edit session. The operation deletes the requested module aggregate, deletes links connected to that module, deletes the container and/or subgraph only when they become empty, removes UseCase relationships for a deleted subgraph, and updates response summaries so the UI can update its local state.

The initial implementation is enabled only in `Designer` sessions. `DiffMerge` enablement is deferred until the general dependency-selection mechanism can stage and unstage dependent change units.

---

## 2. Architecture Decision

Use a direct transactional pipeline inside `DeleteSpfModuleHandler`, coordinated by a small application service:

```text
SpfModuleController.deleteSpfModule
  -> CommandBus.execute(DeleteSpfModuleCommand, session)
     -> DeleteSpfModuleHandler
        -> ModuleDeletionService
           -> DataLinkDeletionService
           -> ControlLinkDeletionService
           -> ContainerLifecycleService
           -> SubgraphLifecycleService
           -> UseCaseRepository relationship cleanup
```

The handler owns transaction boundaries through `UnitOfWork`, consistent with the existing command pattern.

Core owns business decisions:

- whether the module can be deleted;
- which connected links are part of the cascade;
- whether the container survives and needs stack-size recalculation;
- whether the subgraph survives;
- which UseCase relationships must be removed;
- which subsystem ControlPorts need intent cleanup.

Persistence adapters own translation to edit-actions:

- mapping domain-level operations to `targetTable`, `targetSystemId`, `aggregateId`, and payload shape;
- capturing base versions;
- enumerating owned persistence rows for aggregate deletes;
- generating persistence-only IDs for rows that need edit identity.

The core layer never imports TypeORM, SQL table schemas, or edit-action row classes.

---

## 3. API and Command Shape

### 3.1 Controller

Replace the existing `deleteSpfModule` stub in:

```text
packages/api/src/presentation/rest/modules/spf-module/spf-module.controller.ts
```

The controller:

- uses `@Delete('/:spfModuleSystemId')`;
- uses `@UseGuards(SessionGuard)` for the endpoint;
- parses `projectId` and `spfModuleSystemId` through `ParseIntPipe`;
- constructs `DeleteSpfModuleCommand(spfModuleSystemId)`;
- calls `CommandBus.execute(command, session)`;
- returns the command result through `toApiResult`.

The HTTP response omits the internal `groupId`.

### 3.2 Command

New files:

```text
packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.command.ts
packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.handler.ts
```

Command shape:

```ts
export class DeleteSpfModuleCommand extends BaseCommand {
  static readonly requiresSession = true;
  static readonly allowedModes = [SESSION_MODE.Designer];

  constructor(readonly spfModuleSystemId: number) {
    super();
  }
}
```

Add a TODO beside `allowedModes`:

```ts
// TODO(diff-merge-selection-dependencies): add SessionMode.DiffMerge after
// module-delete registers and stages required dependency closures.
```

---

## 4. Result DTO

Replace the generic `ComponentChangeSummarySchema` stub with a Delete Module-specific zod schema in:

```text
packages/core/src/application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.ts
```

Core DTO shape:

```ts
const DeletedIdSchema = z.object({
  systemId: z.string(),
});

const DeletedLinkSchema = z.object({
  systemId: z.string(),
  subsystemLinks: z.array(DeletedIdSchema).optional(),
});

const UpdatedSubsystemSchema = z.object({
  systemId: z.string(),
  intentsClearedControlPorts: z.array(DeletedIdSchema),
});

export const DeleteSpfModuleResultSchema = z.object({
  deleted: z.object({
    spfModules: z.array(DeletedIdSchema),
    subgraphs: z.array(DeletedIdSchema),
    containers: z.array(DeletedIdSchema),
    dataLinks: z.array(DeletedLinkSchema),
    controlLinks: z.array(DeletedLinkSchema),
    unresolvedSubsystemDataLinks: z.array(DeletedIdSchema).optional(),
    unresolvedSubsystemControlLinks: z.array(DeletedIdSchema).optional(),
  }),
  updated: z.object({
    usecases: z.array(DeletedIdSchema),
    subsystems: z.array(UpdatedSubsystemSchema).optional(),
  }),
});
```

For non-subsystem-capable files, omit:

- `dataLinks[].subsystemLinks`;
- `controlLinks[].subsystemLinks`;
- `deleted.unresolvedSubsystemDataLinks`;
- `deleted.unresolvedSubsystemControlLinks`;
- `updated.subsystems`.

For subsystem-capable files, include those fields and use empty arrays when a category is unaffected.

API response DTOs in `packages/api` should mirror this schema. System IDs are serialized as decimal strings.

---

## 5. Domain Model Adjustments

### 5.1 `SpfModuleBase`

Delete does not need CKVs, TKVs, payload blobs, or module ports in core to make cascade decisions. It needs only the module's identity and structural owner IDs.

Add a core type in:

```text
packages/core/src/domain/entities/usecase-data/module/spf-module.ts
```

```ts
export interface SpfModuleBaseInit {
  systemId: number;
  instanceId: number;
  parentSystemId?: number;
  definitionSystemId: number;
  containerSystemId: number;
  subgraphSystemId: number;
  fileSystemId: number;
  alias?: string;
}

export interface SpfModuleBase extends SpfModuleBaseInit {}
```

Then make `SpfModuleInit` extend `SpfModuleBaseInit`, and `SpfModule` naturally satisfies `SpfModuleBase`.

Repository methods used for delete can return `SpfModuleBase | null`. Existing full-module reads remain available for operations that need ports, CKV/TKV details, or payload data.

---

## 6. Port Interface Changes

### 6.1 `ModuleRepository`

Extend:

```ts
/**
 * Read methods on this write-side repository return effective state by default:
 * committed rows + active STAGED and UNSTAGED edit-actions for the active session.
 */
findModuleById(
  systemId: number,
  fileSystemId: number,
): Promise<SpfModuleBase | null>;

findModulesByContainerId(
  containerSystemId: number,
  fileSystemId: number,
): Promise<SpfModuleBase[]>;

findModulesBySubgraphId(
  subgraphSystemId: number,
  fileSystemId: number,
): Promise<SpfModuleBase[]>;

deleteModule(
  moduleSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void>;
```

The return type tells callers that these methods return the lightweight base projection, not the full `SpfModule` aggregate.

`deleteModule` records delete actions for the module aggregate and all owned rows that exist in effective state:

- Node;
- SpfModule;
- DataPorts;
- ControlPorts;
- Intents owned by those ControlPorts;
- CKVs, CKV parameter payloads, and CKV value associations;
- module tag mappings, TKVs, TKV parameter payloads, and TKV value associations.

It does not delete shared definition rows. It does not delete `spf_module_properties_data`; that table is expected to be removed.

### 6.2 `DataLinkRepository`

Extend:

```ts
import type {DataLink} from '../../../../../domain/entities/usecase-data/links/data-link.js';
import type {SubsystemDataLink} from '../../../../../domain/entities/usecase-data/links/subsystem-data-link.js';

findLinksConnectedToModule(
  moduleSystemId: number,
  fileSystemId: number,
): Promise<DataLink[]>;

findUnresolvedSubsystemLinksFromModule(
  moduleSystemId: number,
  fileSystemId: number,
): Promise<SubsystemDataLink[]>;

deleteDataLink(
  dataLinkSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void>;

deleteSubsystemDataLinks(
  subsystemLinkSystemIds: number[],
  fileSystemId: number,
  options?: EditOptions,
): Promise<void>;
```

The repository applies effective-state overlay before returning links. It returns existing domain entities rather than delete-specific DTO types. `DataLink.subsystemDataLinks` carries resolved subsystem segments for response reporting and explicit deletion. Unresolved subsystem links are returned separately because they are not attached to a canonical link.

### 6.3 `ControlLinkRepository`

Extend with the same deletion methods as `DataLinkRepository`, plus route context needed for intent cleanup:

```ts
import type {ControlLink} from '../../../../../domain/entities/usecase-data/links/control-link.js';
import type {SubsystemControlLink} from '../../../../../domain/entities/usecase-data/links/subsystem-control-link.js';
import type {NodeType} from '../../../../../domain/entities/usecase-data/node/node.js';

export interface SubsystemControlRouteContext {
  subsystemControlLinks: SubsystemControlLink[];
  nodeTypeBySystemId: ReadonlyMap<number, NodeType>;
}

findLinksConnectedToModule(
  moduleSystemId: number,
  fileSystemId: number,
): Promise<ControlLink[]>;

findUnresolvedSubsystemLinksFromModule(
  moduleSystemId: number,
  fileSystemId: number,
): Promise<SubsystemControlLink[]>;

findSubsystemControlRouteContext(
  fileSystemId: number,
): Promise<SubsystemControlRouteContext>;

deleteControlLink(
  controlLinkSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void>;

deleteSubsystemControlLinks(
  subsystemLinkSystemIds: number[],
  fileSystemId: number,
  options?: EditOptions,
): Promise<void>;
```

`SubsystemControlRouteContext.subsystemControlLinks` contains every effective
`SubsystemControlLink` segment in the file, not every canonical `ControlLink`.
Intent cleanup needs the remaining segment topology to determine whether an
affected component still reaches a module through another route. DataLink
deletion does not need equivalent file-level context because no state is
propagated onto surviving DataPorts.

If `ControlIntentPropagationService` is not present on the implementation branch, do not recreate it as part of this task. Leave a TODO at the integration point and keep the delete path explicit.

### 6.4 `ContainerRepository`

Extend:

```ts
deleteContainer(
  containerSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void>;
```

The adapter records delete actions for the container root and owned `container_property_data` rows that exist in effective state.

### 6.5 `SubgraphRepository`

Extend:

```ts
getSubgraphById(
  systemId: number,
  fileSystemId: number,
): Promise<Subgraph | null>;

deleteSubgraph(
  subgraphSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void>;
```

The adapter records delete actions for the subgraph root and owned `subgraph_property_data`, SGKV, and VCPM rows that exist in effective state.

Subgraph deletion must not discover or delete DataLinks or ControlLinks by `subgraphId`. Link deletion is based only on module or port endpoints.

### 6.6 `UseCaseRepository`

Add a UseCase repository if the current branch does not already expose one through `UnitOfWork`. Do not create a separate `UseCaseRelationshipRepository`.

```ts
export interface UseCaseRepository {
  removeSubgraphReferences(
    subgraphSystemId: number,
    fileSystemId: number,
    options?: EditOptions,
  ): Promise<{affectedUseCaseSystemIds: number[]}>;
}
```

The persistence adapter deletes effective `use_case_subgraphs` rows referencing the subgraph and effective `use_case_subgraph_pairs` rows where the subgraph is either endpoint. UseCases remain.

### 6.7 `SubsystemRepository`

Extend:

```ts
hasSubsystems(fileSystemId: number): Promise<boolean>;

clearControlPortIntents(
  controlPortSystemIds: number[],
  fileSystemId: number,
  options?: EditOptions,
): Promise<void>;
```

`hasSubsystems` controls whether subsystem-specific response fields are included.
The intent-cleanup service returns each affected ControlPort together with its
owning subsystem, so no additional ownership lookup is required.
`clearControlPortIntents` belongs to this repository because the surviving
ControlPorts and their Intents are owned by the Subsystem aggregate, not by a
ControlLink aggregate.

---

## 7. Persistence Schema Prerequisite

`use_case_subgraphs` and `use_case_subgraph_pairs` need edit-addressable persistence identity before Delete Module can record relationship deletes.

Add a persistence-only `system_id` column to both tables:

```text
use_case_subgraphs.system_id
use_case_subgraph_pairs.system_id
```

Rules:

- Keep existing natural uniqueness constraints on relationship columns.
- Generate relationship `system_id` values in persistence during bulk import using the existing file-scoped ID-generation mechanism available to the persistence/UoW layer.
- Leave core entity builders unchanged: core `UseCase` objects continue to carry relationship natural IDs only.
- Do not expose these generated IDs through the core `UseCase` entity or public API.
- Use the generated IDs only for edit-action addressing, base-version capture, and overlay processing.

This prerequisite should be the first implementation chapter because UseCase relationship deletes depend on it.

---

## 8. Application Services

### 8.1 `ModuleDeletionService`

New file:

```text
packages/core/src/application/usecase-designer/spf-module/delete/services/module-deletion.service.ts
```

Responsibilities:

- load `SpfModuleBase`;
- validate imported-subgraph guard through `SubgraphRepository.getSubgraphById`;
- coordinate link deletion, module deletion, container lifecycle, subgraph lifecycle, and UseCase cleanup;
- build `DeleteSpfModuleResult`;
- sort and deduplicate every response array.

It does not access persistence-specific table names.

### 8.2 `DataLinkDeletionService`

New file:

```text
packages/core/src/application/usecase-designer/spf-module/delete/services/data-link-deletion.service.ts
```

Responsibilities:

- find canonical DataLinks connected to the module;
- find resolved subsystem DataLink segments for those canonical links;
- find unresolved subsystem DataLink chains reached from the deleted module;
- call `DataLinkRepository.deleteDataLink` and `deleteSubsystemDataLinks`;
- return the response summary entries.

It does not remove subsystem DataPorts.

### 8.3 `ControlLinkDeletionService`

New file:

```text
packages/core/src/application/usecase-designer/spf-module/delete/services/control-link-deletion.service.ts
```

Extend the existing pure `ControlIntentPropagationService` with a bulk-delete
operation while retaining its existing single-segment operation for current
callers:

```ts
export interface FindPortsToClearAfterDeletingLinksInput {
  allSubsystemControlLinks: readonly SubsystemControlLink[];
  deletedSubsystemControlLinkSystemIds: readonly number[];
  nodeTypeMap: ReadonlyMap<number, NodeType>;
}

export interface IntentClearedControlPort {
  subsystemSystemId: number;
  controlPortSystemId: number;
}

findPortsToClearAfterDeletingLinks(
  input: FindPortsToClearAfterDeletingLinksInput,
): {portsToClear: IntentClearedControlPort[]};
```

The operation builds the remaining graph by excluding the complete deletion
set. It uses the pre-delete segment set to retain port-to-subsystem ownership
for ports that become fully isolated. It evaluates only components affected by
the deleted segments and clears a subsystem port only when its remaining
component has no module anchor. Returning both IDs avoids a second repository
query solely for response grouping.

Responsibilities:

- find canonical ControlLinks connected to the module;
- find resolved subsystem ControlLink segments for those canonical links;
- find unresolved subsystem ControlLink chains reached from the deleted module;
- call `ControlLinkRepository.deleteControlLink` and `deleteSubsystemControlLinks`;
- compute surviving subsystem ControlPorts whose intents must be cleared using
  `ControlIntentPropagationService.findPortsToClearAfterDeletingLinks`;
- call `SubsystemRepository.clearControlPortIntents`;
- return deleted link entries and `updated.subsystems[].intentsClearedControlPorts`.

It does not remove subsystem ControlPorts.

### 8.4 `ContainerLifecycleService`

New file:

```text
packages/core/src/application/usecase-designer/spf-module/delete/services/container-lifecycle.service.ts
```

Responsibilities:

- after excluding the deleted module, query effective modules in the affected container;
- if none remain, call `ContainerRepository.deleteContainer`;
- if modules remain, call `ContainerStackSizeService.recalculateForContainer`.

`ContainerStackSizeService` is the shared application service specified by
`add-module-design.md`. If it is absent on the implementation branch, implement
that shared service and its required effective-state repository reads as a
prerequisite to this lifecycle service; do not duplicate stack-size logic in
Delete Module.

Container deletion and subgraph deletion are independent. A container should not be deleted just because its subgraph is deleted unless its own effective occupancy is empty.

### 8.5 `SubgraphLifecycleService`

New file:

```text
packages/core/src/application/usecase-designer/spf-module/delete/services/subgraph-lifecycle.service.ts
```

Responsibilities:

- after excluding the deleted module, query effective modules in the affected subgraph;
- if none remain, call `SubgraphRepository.deleteSubgraph`;
- if deleted, call `UseCaseRepository.removeSubgraphReferences`;
- return deleted subgraph and affected UseCase IDs.

It does not remove UseCase rows.

---

## 9. Handler Flow

```ts
async handle(command: DeleteSpfModuleCommand): Promise<DeleteSpfModuleInternalResult> {
  await this.uow.startTransaction();
  try {
    const fileSystemId = this.uow.getWriteContext().session.fileSystemId;

    const result = await this.moduleDeletionService.deleteModule({
      moduleSystemId: command.spfModuleSystemId,
      fileSystemId,
    });

    // TODO(diff-merge-selection-dependencies): when DiffMerge is enabled,
    // register required change-unit dependencies and stage the forward closure
    // in this same transaction.

    await this.uow.commit();
    return {
      groupId: this.uow.getWriteContext().groupId,
      response: result,
    };
  } catch (err) {
    await this.uow.rollback();
    throw err;
  }
}
```

Detailed operation sequence:

1. Resolve `fileSystemId` from the active session in `WriteContext`, following existing write-command conventions.
2. Load the requested module through `ModuleRepository.findModuleById`.
3. If missing, fail with `IssueFactory.notFound(ISSUE_ENTITY_TYPE.SpfModule, spfModuleSystemId)`.
4. Load its subgraph and reject imported/read-only subgraphs with `ARC-MOD-SUBGRAPH-IMPORTED`.
5. Delete connected DataLinks and their subsystem DataLink segments.
6. Delete connected ControlLinks and their subsystem ControlLink segments.
7. Clear routed-control intents from surviving subsystem ControlPorts affected by deleted control routes.
8. Call `ModuleRepository.deleteModule`.
9. Evaluate the module's container occupancy and either call `ContainerRepository.deleteContainer` or recalculate its stack size.
10. Evaluate the module's subgraph occupancy and, when empty, call `SubgraphRepository.deleteSubgraph` and remove UseCase relationships.
11. Return the deterministic response summary.

Discovery and writes happen in one transaction. Validation happens before any delete-operation edit action is recorded.

---

## 10. Effective-State Reads

All decisions are made from effective state:

```text
committed rows + active edit_actions rows with changeStatus STAGED or UNSTAGED
```

This applies to module existence, ports, links, subsystem route segments, container/subgraph occupancy, UseCase relationships, and routed-control intent cleanup.

Repository method names should not mention `effective` or `staged` unless they intentionally depart from the default. In write-side repositories, read methods return effective state by default. Committed-only methods, if ever needed, must say so explicitly, for example `findCommittedModuleById`. Delete Module adds no committed-only module read methods.

For the initial `Designer` implementation, all new delete-operation edit actions are recorded as `STAGED`. That default does not change the read rule above.

---

## 11. Subsystem Link and Intent Handling

For subsystem-capable files:

- deleted canonical links report resolved subsystem segments under `subsystemLinks`;
- deleted unresolved subsystem segments report under `deleted.unresolvedSubsystemDataLinks` or `deleted.unresolvedSubsystemControlLinks`;
- subsystem boundary DataPorts and ControlPorts remain present;
- only stale routed-control intents are cleared;
- affected subsystem ControlPorts are grouped under `updated.subsystems[].intentsClearedControlPorts`.

Control intent cleanup flow:

1. Capture effective subsystem ControlLinks before deletes.
2. Identify the complete set of segments deleted by this operation.
3. Call `ControlIntentPropagationService.findPortsToClearAfterDeletingLinks`
   once with the pre-delete topology and the complete deletion set.
4. Deduplicate the returned subsystem and ControlPort pairs.
5. Delete the intents owned by those surviving subsystem ControlPorts through
   `SubsystemRepository.clearControlPortIntents`.
6. Group the returned pairs directly under
   `updated.subsystems[].intentsClearedControlPorts`.

Data routes do not require intent cleanup.

---

## 12. Response Construction

Build the response from service outputs, not by reading `edit_actions` after the fact. This keeps the public contract domain-oriented and independent of persistence table layout.

Ordering rule:

- `deleted.spfModules` always contains exactly the requested module ID;
- sort every array by numeric `systemId` ascending;
- remove duplicates before serialization;
- serialize all IDs as decimal strings at the DTO boundary.

Example subsystem-capable response:

```json
{
  "deleted": {
    "spfModules": [{"systemId": "1001"}],
    "subgraphs": [{"systemId": "2001"}],
    "containers": [],
    "dataLinks": [
      {
        "systemId": "4001",
        "subsystemLinks": [{"systemId": "4101"}]
      }
    ],
    "controlLinks": [
      {
        "systemId": "5001",
        "subsystemLinks": [{"systemId": "5101"}]
      }
    ],
    "unresolvedSubsystemDataLinks": [],
    "unresolvedSubsystemControlLinks": [{"systemId": "5201"}]
  },
  "updated": {
    "usecases": [{"systemId": "6001"}],
    "subsystems": [
      {
        "systemId": "3001",
        "intentsClearedControlPorts": [{"systemId": "5301"}]
      }
    ]
  }
}
```

---

## 13. DiffMerge Dependency Selection

The delete pipeline should be implemented so it can later plug into a general dependency selector without rewriting cascade logic.

Initial implementation:

- `DeleteSpfModuleCommand.allowedModes = [Designer]`;
- every edit action produced by the request is `STAGED`;
- no attempt is made to stage pre-existing `UNSTAGED` dependency changes;
- leave a TODO at the handler after cascade discovery and before commit.

Future mechanism:

- use `ChangeSelectionService` from `docs/edit-crud/design/change-selection-dependencies-design.md`;
- call `stage({sessionId, groupIds: [deleteGroupId]}, uow)` before commit;
- let dependency rules derive required existing changes from pending history and domain relationships;
- let `IChangeStatusRepository` update only the exact `changeId` values returned by the planner.

For module deletion in a `DiffMerge` session, the dependency builder would derive required change units from effective-state cascade results. Example:

- an unstaged DiffMerge-created DataLink connected to the module is effective;
- the user deletes the module manually;
- the delete operation records its own `STAGED` delete actions;
- the dependency service records that the module-delete group requires the DataLink create change unit;
- staging the module-delete group auto-stages that DataLink create, then the delete action removes it in effective state;
- unstaging the DataLink create later auto-unstages the module-delete group because the delete depends on it.

This mechanism is intentionally outside the initial Delete Module implementation.

---

## 14. Error Handling

Use existing structured result conventions:

- missing module: `IssueFactory.notFound(ISSUE_ENTITY_TYPE.SpfModule, spfModuleSystemId)` mapped to HTTP 404;
- imported subgraph: `ARC-MOD-SUBGRAPH-IMPORTED` mapped to HTTP 422;
- session missing or mode not allowed: `SessionGuard`/`CommandBus` mapped to HTTP 403;
- unexpected persistence failure: rollback and let the common exception filter map the error.

No partial response is returned after a failed transaction.

---

## 15. Tests

### 15.1 Core unit tests

Cover:

- missing module returns 404-style failure;
- imported subgraph returns `ARC-MOD-SUBGRAPH-IMPORTED`;
- connected data/control links are deleted;
- subsystem-capable and non-subsystem response shapes differ correctly;
- subsystem boundary ports are retained;
- control intents are cleared and reported;
- deleting a complete control route clears intents from ports that become fully
  isolated;
- ports that retain an effective route to another module keep their intents;
- empty container is deleted;
- surviving container stack size is recalculated;
- empty subgraph is deleted and UseCase relationships are removed;
- UseCases remain even when emptied.

### 15.2 Persistence integration tests

Cover:

- `use_case_subgraphs.system_id` and `use_case_subgraph_pairs.system_id` are generated during bulk import;
- relationship delete actions can target those generated IDs;
- effective-state link, subsystem-link, module occupancy, and UseCase relationship queries include active `STAGED` and `UNSTAGED` rows;
- aggregate delete repositories record deletes for owned rows while preserving shared definitions;
- module-properties rows are not expected.

### 15.3 API e2e tests

Cover:

- route succeeds in a Designer session;
- route fails without an active session;
- route fails in unsupported session modes until DiffMerge is enabled;
- route returns 404 for a missing/effectively deleted module;
- route returns 422 for an imported subgraph;
- response fields match subsystem-capable and non-subsystem-capable files.

---

## 16. Implementation Sequence

1. Add persistence-only `system_id` columns to UseCase relationship schemas, update bulk import ID generation, regenerate the single `initial-create` migration.
2. Add core DTO schema for Delete Module response and matching API response DTO.
3. Add `SpfModuleBase` and effective-state-by-default repository methods.
4. Add repository delete methods for module, link, container, subgraph, and UseCase relationships.
5. Implement delete application services and focused unit tests.
6. Wire `DeleteSpfModuleCommand`, handler registration, controller route, and Swagger metadata.
7. Add persistence integration tests.
8. Add API e2e coverage.

---

## 17. Requirements Traceability

| Requirement | Design coverage |
|-------------|-----------------|
| FR-DM-01 to FR-DM-05 | Sections 3, 9, 14 |
| FR-DM-06, FR-DM-06A | Sections 3.2, 10, 13 |
| FR-DM-07, FR-DM-08 | Sections 9, 14 |
| FR-DM-09 to FR-DM-13 | Sections 5, 6, 8, 9, 11 |
| FR-DM-14 to FR-DM-16 | Sections 6.4, 8.4, 9 |
| FR-DM-17 to FR-DM-20 | Sections 6.5, 6.6, 7, 8.5, 9 |
| FR-DM-21 to FR-DM-25 | Sections 9, 10, 13 |
| FR-DM-26 to FR-DM-30 | Sections 4, 11, 12 |
| Invariants | Sections 8 to 13 |
| Non-functional requirements | Sections 10, 14, 15 |

---

## 18. Open Implementation TODOs

- Add `SessionMode.DiffMerge` after the general change-selection dependency mechanism is implemented.
- Add dependency registration/staging at the handler integration point for DiffMerge.
- If `ControlIntentPropagationService` is absent on the implementation branch, leave a TODO rather than reimplementing it in this task.
