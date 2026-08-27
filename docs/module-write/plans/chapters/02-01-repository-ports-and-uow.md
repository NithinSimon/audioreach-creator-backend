### Task 11: Extend the module repository with effective-state deletion reads

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/repositories/module/module.repository.ts`

- [ ] **Step 1: Import the lightweight module projection alongside the existing aggregate**

Replace the current `SpfModule` import with this type-only import. Keep the existing `SpfModule` import because the create and patch contracts still use the full aggregate:

```typescript
import type {
  SpfModule,
  SpfModuleBase,
} from '../../../../../domain/entities/usecase-data/module/spf-module.js';
```

- [ ] **Step 2: Document the write-side effective-state read contract**

Replace the repository-level comment with:

```typescript
/**
 * Write-side port for the SpfModule aggregate.
 *
 * Read methods return effective state by default: committed rows overlaid with
 * active STAGED and UNSTAGED edit actions visible to the current session.
 * A committed-only read must say so explicitly in its method name.
 *
 * findModuleForPatch must load intents for each control port so the handler
 * can compute intent availability without an extra query.
 */
```

- [ ] **Step 3: Add the scoped module lookup and occupancy contracts**

Add these methods immediately after `findModuleForPatch`. They return the `SpfModuleBase` type established in Task 9 and retrieve each occupancy category as one set, satisfying FR-DM-04, FR-DM-14, FR-DM-17, FR-DM-21, and NFR-DM-03:

```typescript
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
```

- [ ] **Step 4: Add the module aggregate deletion contract**

Add this method after `createModule`. The adapter implemented in a later chapter must record delete actions for the module root and its effective owned rows, while retaining shared definitions and subsystem boundary ports:

```typescript
  /**
   * Records deletion of the module aggregate and effective owned rows.
   * Shared definitions and subsystem boundary ports are not owned by this aggregate.
   */
  deleteModule(
    moduleSystemId: number,
    fileSystemId: number,
    options?: EditOptions,
  ): Promise<void>;
```

- [ ] **Step 5: Build core and verify the contract has no committed-only shortcut**

Run: `pnpm run build:core && rg -n "findModuleById|findModulesByContainerId|findModulesBySubgraphId|deleteModule|findCommitted" packages/core/src/application/ports/persistence/repositories/module/module.repository.ts`

Expected: the core build passes; the output lists the four new methods and no `findCommittedModuleById` method. The repository remains framework-free and every new lookup is file-scoped.

### Task 12: Define effective-state link discovery and bulk deletion ports

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/repositories/data-link/data-link.repository.ts`
- Modify: `packages/core/src/application/ports/persistence/repositories/control-link/control-link.repository.ts`

- [ ] **Step 1: Add existing DataLink domain entity imports**

Ensure these type-only imports are present in `data-link.repository.ts`, merging them with any existing imports from the same modules rather than duplicating import declarations. Do not introduce delete-specific link projections:

```typescript
import type {DataLink} from '../../../../../domain/entities/usecase-data/links/data-link.js';
import type {SubsystemDataLink} from '../../../../../domain/entities/usecase-data/links/subsystem-data-link.js';
```

- [ ] **Step 2: Add effective DataLink discovery and set-based deletion methods**

Add this documentation and these methods inside `DataLinkRepository`:

```typescript
  /**
   * Returns effective canonical links connected to the module or its ports.
   * DataLink.subsystemDataLinks carries resolved route segments.
   */
  findLinksConnectedToModule(
    moduleSystemId: number,
    fileSystemId: number,
  ): Promise<DataLink[]>;

  /** Returns effective unresolved route segments reached from the module. */
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

At repository level, document that unqualified reads return committed state overlaid with active `STAGED` and `UNSTAGED` edit actions for the current session. The plural subsystem deletion method is intentionally set-based for FR-DM-11, FR-DM-11A, FR-DM-21, and NFR-DM-03.

- [ ] **Step 3: Add the control-route context using existing domain entities**

Ensure these imports are present in `control-link.repository.ts`, merging them with existing imports from the same modules, then add the exported context type:

```typescript
import type {ControlLink} from '../../../../../domain/entities/usecase-data/links/control-link.js';
import type {SubsystemControlLink} from '../../../../../domain/entities/usecase-data/links/subsystem-control-link.js';
import type {NodeType} from '../../../../../domain/entities/usecase-data/node/node.js';

export interface SubsystemControlRouteContext {
  subsystemControlLinks: SubsystemControlLink[];
  nodeTypeBySystemId: ReadonlyMap<number, NodeType>;
}
```

`subsystemControlLinks` is the complete effective set of subsystem route segments in the file. It is not a collection of canonical `ControlLink` roots; the complete segment topology is required by `ControlIntentPropagationService.findPortsToClearAfterDeletingLinks` from Task 10.

- [ ] **Step 4: Add effective ControlLink discovery, context, and deletion methods**

Add these methods inside `ControlLinkRepository` and document at repository level that unqualified reads return effective state by default:

```typescript
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

These contracts cover canonical and unresolved link discovery in bounded sets, explicit route-segment deletion, and the full effective topology needed to clear only stale routed-control intents under FR-DM-10 through FR-DM-13.

- [ ] **Step 5: Build core and verify all link contracts use domain entities and file scope**

Run: `pnpm run build:core && rg -n "DataLink|SubsystemDataLink|ControlLink|SubsystemControlLink|SubsystemControlRouteContext|fileSystemId" packages/core/src/application/ports/persistence/repositories/data-link/data-link.repository.ts packages/core/src/application/ports/persistence/repositories/control-link/control-link.repository.ts`

Expected: the core build passes; both repositories expose file-scoped effective reads and set-based subsystem deletion methods; all result types are existing domain entities, with no delete-specific link type added.

### Task 13: Add structural, UseCase relationship, and subsystem contracts

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/repositories/container/container.repository.ts`
- Modify: `packages/core/src/application/ports/persistence/repositories/subgraph/subgraph.repository.ts`
- Create: `packages/core/src/application/ports/persistence/repositories/usecase/usecase.repository.ts`
- Modify: `packages/core/src/application/ports/persistence/repositories/subsystem/subsystem.repository.ts`

- [ ] **Step 1: Add the container aggregate deletion contract**

Add this method inside `ContainerRepository`:

```typescript
  /** Records deletion of the container root and effective owned property rows. */
  deleteContainer(
    containerSystemId: number,
    fileSystemId: number,
    options?: EditOptions,
  ): Promise<void>;
```

The adapter chapter will implement this as edit actions for the container aggregate only after effective module occupancy is empty; it must not couple container deletion to subgraph deletion.

- [ ] **Step 2: Add effective Subgraph lookup and aggregate deletion contracts**

Ensure this type-only import is present in `subgraph.repository.ts`, merging it with an existing import from the same module if necessary:

```typescript
import type {Subgraph} from '../../../../../domain/entities/usecase-data/subgraph/subgraph.js';
```

Add these methods inside `SubgraphRepository`:

```typescript
  /**
   * Returns effective state for the active session, or null when the subgraph
   * is absent after applying active STAGED and UNSTAGED edit actions.
   */
  getSubgraphById(
    systemId: number,
    fileSystemId: number,
  ): Promise<Subgraph | null>;

  /** Records deletion of the subgraph root and effective owned rows. */
  deleteSubgraph(
    subgraphSystemId: number,
    fileSystemId: number,
    options?: EditOptions,
  ): Promise<void>;
```

The deletion contract covers subgraph-owned property, SGKV, value-association, and VCPM rows. It must not discover or delete links by their `subgraphId`; FR-DM-10 defines link ownership from module or port endpoints.

- [ ] **Step 3: Create the UseCase relationship repository port**

Create `usecase.repository.ts` with the complete framework-free contract:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {EditOptions} from '../../edit-options.js';

/**
 * Write-side port for effective UseCase relationship rows.
 * UseCase aggregate roots are preserved; only relationships are removed.
 */
export interface UseCaseRepository {
  /**
   * Removes effective membership rows and pair rows where the subgraph is
   * either endpoint, returning each affected UseCase system ID once.
   */
  removeSubgraphReferences(
    subgraphSystemId: number,
    fileSystemId: number,
    options?: EditOptions,
  ): Promise<{affectedUseCaseSystemIds: number[]}>;
}
```

Keep both relationship categories behind this single set-based method. Do not create a `UseCaseRelationshipRepository`, and do not expose the persistence-only relationship `systemId` values introduced in Chapter 01-01.

- [ ] **Step 4: Keep intent cleanup on the Subsystem aggregate repository**

Add these methods inside `SubsystemRepository`:

```typescript
  /** Returns whether any subsystem exists in effective file state. */
  hasSubsystems(fileSystemId: number): Promise<boolean>;

  /**
   * Clears Intents from surviving subsystem-owned ControlPorts as one bounded set.
   */
  clearControlPortIntents(
    controlPortSystemIds: number[],
    fileSystemId: number,
    options?: EditOptions,
  ): Promise<void>;
```

`clearControlPortIntents` must remain on `SubsystemRepository`: the surviving ControlPorts and their Intents belong to the Subsystem aggregate, while `ControlLinkRepository` only supplies route topology and link deletion.

- [ ] **Step 5: Build core and inspect the bounded structural contracts**

Run: `pnpm run build:core && rg -n "deleteContainer|getSubgraphById|deleteSubgraph|removeSubgraphReferences|hasSubsystems|clearControlPortIntents|affectedUseCaseSystemIds" packages/core/src/application/ports/persistence/repositories/container/container.repository.ts packages/core/src/application/ports/persistence/repositories/subgraph/subgraph.repository.ts packages/core/src/application/ports/persistence/repositories/usecase/usecase.repository.ts packages/core/src/application/ports/persistence/repositories/subsystem/subsystem.repository.ts`

Expected: the core build passes; every new method is file-scoped, relationship and intent mutations accept or return sets rather than requiring one call per row, and `clearControlPortIntents` appears only on `SubsystemRepository` among these new contracts.

### Task 14: Export the ports and expose them through UnitOfWork

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/index.ts`
- Modify: `packages/core/src/application/ports/persistence/unit-of-work.ts`

- [ ] **Step 1: Import the new UseCase repository into UnitOfWork**

Add this type-only ESM import beside the other repository imports in `unit-of-work.ts`:

```typescript
import type {UseCaseRepository} from './repositories/usecase/usecase.repository.js';
```

- [ ] **Step 2: Make the transaction-bound effective-state contract explicit on UnitOfWork**

Add these bullets to the `UnitOfWork` lifecycle documentation before the existing `NOTE` paragraph:

```typescript
 * - Repository accessors return adapters bound to this UnitOfWork transaction.
 * - Unqualified write-side repository reads resolve effective state by default:
 *   committed rows plus active STAGED and UNSTAGED actions from WriteContext.
 * - Committed-only reads, if introduced later, must be named explicitly.
```

This documents that cascade discovery and edit-action recording share the handler-owned transaction required by FR-DM-21 through FR-DM-24; it does not move transaction control into a repository or bus.

- [ ] **Step 3: Add the missing UseCase accessor and retain all aggregate accessors**

Replace the module write-path accessor block with this complete contract:

```typescript
  // Module write path (LLD2)
  getModuleRepository(): ModuleRepository;
  getContainerRepository(): ContainerRepository;
  getModuleDefinitionRepository(): ModuleDefinitionRepository;
  getDataLinkRepository(): DataLinkRepository;
  getControlLinkRepository(): ControlLinkRepository;
  getSubgraphRepository(): SubgraphRepository;
  getUseCaseRepository(): UseCaseRepository;
  getSubsystemRepository(): SubsystemRepository;
  getPropertyDefinitionsRepository(): PropertyDefinitionsRepository;
```

The listed Delete Module repositories are all reachable from the same `UnitOfWork`; `getUseCaseRepository` is the only new accessor because the other six repositories are already exposed.

- [ ] **Step 4: Export every Delete Module repository contract from the persistence barrel**

Append these type-only exports to `packages/core/src/application/ports/persistence/index.ts`:

```typescript
export type {ModuleRepository} from './repositories/module/module.repository.js';
export type {DataLinkRepository} from './repositories/data-link/data-link.repository.js';
export type {
  ControlLinkRepository,
  SubsystemControlRouteContext,
} from './repositories/control-link/control-link.repository.js';
export type {ContainerRepository} from './repositories/container/container.repository.js';
export type {SubgraphRepository} from './repositories/subgraph/subgraph.repository.js';
export type {UseCaseRepository} from './repositories/usecase/usecase.repository.js';
export type {SubsystemRepository} from './repositories/subsystem/subsystem.repository.js';
```

Do not add TypeORM, NestJS, or Node.js imports. These exports expose core ports and the route-context contract only.

- [ ] **Step 5: Run final chapter validation**

Run: `pnpm run build:core && pnpm run lint && rg -n "get(Module|DataLink|ControlLink|Container|Subgraph|UseCase|Subsystem)Repository|SubsystemControlRouteContext" packages/core/src/application/ports/persistence/unit-of-work.ts packages/core/src/application/ports/persistence/index.ts && git diff --check -- packages/core/src/application/ports/persistence docs/module-write/plans/chapters/02-01-repository-ports-and-uow.md`

Expected: core build and lint pass; `UnitOfWork` exposes all seven repositories; the persistence barrel exports all seven ports plus `SubsystemControlRouteContext`; `git diff --check` reports no whitespace errors. No adapter, application service, handler, controller, migration, or API file is changed in this chapter.

### Commit: Repository Ports and UnitOfWork Contracts

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/core/src/application/ports/persistence/repositories/module/module.repository.ts \
        packages/core/src/application/ports/persistence/repositories/data-link/data-link.repository.ts \
        packages/core/src/application/ports/persistence/repositories/control-link/control-link.repository.ts \
        packages/core/src/application/ports/persistence/repositories/container/container.repository.ts \
        packages/core/src/application/ports/persistence/repositories/subgraph/subgraph.repository.ts \
        packages/core/src/application/ports/persistence/repositories/usecase/usecase.repository.ts \
        packages/core/src/application/ports/persistence/repositories/subsystem/subsystem.repository.ts \
        packages/core/src/application/ports/persistence/unit-of-work.ts \
        packages/core/src/application/ports/persistence/index.ts \
        docs/module-write/plans/chapters/02-01-repository-ports-and-uow.md
git commit -m "feat(core): define Delete Module repository ports" \
           -m "Add effective-state cascade contracts and expose every participating aggregate repository through UnitOfWork." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
Only execute after confirmation.
