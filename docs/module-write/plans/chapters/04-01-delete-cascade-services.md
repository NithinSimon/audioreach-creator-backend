### Task 29: Add the shared effective-state container stack-size service prerequisite

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/repositories/module/module.repository.ts`
- Create: `packages/core/src/application/usecase-designer/spf-module/services/container-stack-size.service.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/services/container-stack-size.service.spec.ts`

- [ ] **Step 1: Write failing tests for shared stack-size behavior**

Create the focused service suite with a mocked `UnitOfWork`, `ModuleRepository`, and `ContainerRepository`. Use the current `getPropertyData` and `setPropertyData` names from `ContainerRepository`, and cover all three shared call paths so Delete Module does not grow a private stack-size implementation:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import type {
  ContainerRepository,
  ModuleRepository,
  UnitOfWork,
} from '../../../../../../src/application/ports/persistence/index.js';
import {ContainerStackSizeService} from '../../../../../../src/application/usecase-designer/spf-module/services/container-stack-size.service.js';
import {CONTAINER_PROP_ID_STACK_SIZE} from '../../../../../../src/application/file-operations/shared/constants/spf-ids.js';

describe('ContainerStackSizeService', () => {
  let moduleRepository: jest.Mocked<ModuleRepository>;
  let containerRepository: jest.Mocked<ContainerRepository>;
  let uow: jest.Mocked<UnitOfWork>;
  let service: ContainerStackSizeService;

  beforeEach(() => {
    moduleRepository = {
      getModulesWithStackSizeByContainer: jest.fn(),
    } as unknown as jest.Mocked<ModuleRepository>;
    containerRepository = {
      getPropertyData: jest.fn(),
      setPropertyData: jest.fn(),
    } as unknown as jest.Mocked<ContainerRepository>;
    uow = {
      getModuleRepository: jest.fn(() => moduleRepository),
      getContainerRepository: jest.fn(() => containerRepository),
    } as unknown as jest.Mocked<UnitOfWork>;
    service = new ContainerStackSizeService(uow);
  });

  it('recalculates from one effective module set and writes the numeric maximum', async () => {
    moduleRepository.getModulesWithStackSizeByContainer.mockResolvedValue([
      {moduleSystemId: 103, stackSize: 64},
      {moduleSystemId: 101, stackSize: 0},
      {moduleSystemId: 102, stackSize: 192},
    ]);

    await service.recalculateForContainer(20, 7);

    expect(
      moduleRepository.getModulesWithStackSizeByContainer,
    ).toHaveBeenCalledTimes(1);
    expect(
      moduleRepository.getModulesWithStackSizeByContainer,
    ).toHaveBeenCalledWith(20, 7);
    expect(containerRepository.setPropertyData).toHaveBeenCalledTimes(1);
    expect(containerRepository.setPropertyData).toHaveBeenCalledWith(
      20,
      CONTAINER_PROP_ID_STACK_SIZE,
      expect.any(Uint8Array),
    );
    expect(
      new DataView(
        containerRepository.setPropertyData.mock.calls[0][2].buffer,
      ).getUint32(0, true),
    ).toBe(192);
  });

  it('writes zero when the effective container has no modules', async () => {
    moduleRepository.getModulesWithStackSizeByContainer.mockResolvedValue([]);

    await service.recalculateForContainer(20, 7);

    expect(
      new DataView(
        containerRepository.setPropertyData.mock.calls[0][2].buffer,
      ).getUint32(0, true),
    ).toBe(0);
  });

  it('initializes and compare-and-sets through the same property contract', async () => {
    containerRepository.getPropertyData.mockResolvedValue(
      Uint8Array.from([64, 0, 0, 0]),
    );

    await service.initializeStackSize(20, 32);
    await service.updateOnAdd(20, 128, 7);
    await service.updateOnAdd(20, 16, 7);

    expect(containerRepository.getPropertyData).toHaveBeenCalledTimes(2);
    expect(containerRepository.setPropertyData).toHaveBeenCalledTimes(2);
    expect(
      new DataView(
        containerRepository.setPropertyData.mock.calls[1][2].buffer,
      ).getUint32(0, true),
    ).toBe(128);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="container-stack-size.service.spec.ts"`

Expected: FAIL because `ContainerStackSizeService` and the effective stack-size projection method do not exist.

- [ ] **Step 3: Add the effective read contract and implement the shared service**

Add this method to `ModuleRepository` after `findModulesByContainerId`. It is a set-based effective-state read: active `STAGED` and `UNSTAGED` module creates, deletes, and container moves must be folded before definition stack sizes are joined. The persistence implementation belongs with the module effective-state adapter prerequisite and is not duplicated in this application-services chapter.

```typescript
  /**
   * Returns one row per effective module in the container with its definition's
   * declared stack size. Active creates, deletes, and container moves are folded.
   */
  getModulesWithStackSizeByContainer(
    containerSystemId: number,
    fileSystemId: number,
  ): Promise<Array<{moduleSystemId: number; stackSize: number}>>;
```

Create `container-stack-size.service.ts` as the shared three-path application service. Preserve the exact public signatures below and implement the numbered behavior; use the existing little-endian codec in `packages/core/src/domain/services/container-property/container-stack-size-codec.ts`, not a second encoder inside a deletion service.

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UnitOfWork} from '../../../ports/persistence/unit-of-work.js';

export class ContainerStackSizeService {
  constructor(private readonly uow: UnitOfWork) {}

  async initializeStackSize(
    containerSystemId: number,
    moduleStackSize: number,
  ): Promise<void> {
    // 1. Normalize a missing/non-positive declared size to zero.
    // 2. Skip the write when the normalized value is zero.
    // 3. Encode with the existing container-stack-size codec.
    // 4. Call ContainerRepository.setPropertyData with
    //    CONTAINER_PROP_ID_STACK_SIZE; rely on the ambient WriteContext group.
  }

  async updateOnAdd(
    containerSystemId: number,
    moduleStackSize: number,
    fileSystemId: number,
  ): Promise<void> {
    // 1. Read CONTAINER_PROP_ID_STACK_SIZE through getPropertyData.
    // 2. Decode null as zero with the existing codec.
    // 3. Return without a write when moduleStackSize <= current stack size.
    // 4. Otherwise encode moduleStackSize and call setPropertyData once.
  }

  async recalculateForContainer(
    containerSystemId: number,
    fileSystemId: number,
  ): Promise<void> {
    // 1. Call getModulesWithStackSizeByContainer exactly once.
    // 2. Compute Math.max(0, ...positive declared stack sizes).
    // 3. Encode the maximum with the existing little-endian codec.
    // 4. Call setPropertyData unconditionally, including zero, so removal can
    //    lower a previously larger value.
  }
}
```

The service must not start or commit a transaction and must not generate a `groupId`; the caller's transaction-bound repositories obtain the operation group from `WriteContext`.

- [ ] **Step 4: Run the focused service tests**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="container-stack-size.service.spec.ts"`

Expected: PASS; recalculation performs one bounded effective-state read, writes the maximum or zero, and the other shared methods use the same property repository and codec.

- [ ] **Step 5: Build core and verify the shared service boundary**

Run: `pnpm run build:core && rg -n "getModulesWithStackSizeByContainer|class ContainerStackSizeService|recalculateForContainer|getPropertyData|setPropertyData" packages/core/src/application/ports/persistence/repositories/module/module.repository.ts packages/core/src/application/usecase-designer/spf-module/services/container-stack-size.service.ts`

Expected: the core build passes; the read contract is explicitly effective-state based; stack-size calculation exists only in the shared service and not under `spf-module/delete/services/`.

### Task 30: Implement effective DataLink cascade deletion

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/spf-module/delete/services/data-link-deletion.service.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/data-link-deletion.service.spec.ts`

- [ ] **Step 1: Write failing tests for canonical, resolved, and unresolved DataLink deletion**

Create a focused unit suite around a mocked `DataLinkRepository`. Build real `DataLink` and `SubsystemDataLink` domain instances using the constructors already used by their domain tests, then cover this matrix:

```typescript
describe('DataLinkDeletionService', () => {
  it('deletes each connected canonical link and one complete resolved segment set', async () => {
    // Repository result:
    // - canonical 40 with resolved segments 411 and 412;
    // - duplicate canonical 40 carrying segment 412;
    // - canonical 20 with no resolved segments.
    // Expect deleteDataLink calls for [20, 40] exactly once each and one
    // deleteSubsystemDataLinks([411, 412], fileSystemId) call.
    // Expect deletedLinks ordered as 20 then 40 with duplicate-free segment IDs.
  });

  it('deletes reached unresolved chains separately from canonical segments', async () => {
    // Return unresolved segment IDs [4302, 4301, 4302]. Expect the same single
    // bulk delete call to receive the union of resolved and unresolved IDs, and
    // expect unresolvedSubsystemLinkSystemIds to contain only [4301, 4302].
  });

  it('does not delete subsystem boundary DataPorts', async () => {
    // Expose only the Task 12 DataLinkRepository methods on the mock and assert
    // the operation completes without any module or subsystem port repository.
  });
});
```

Use explicit IDs and assertions in the completed test file; do not replace the matrix with `expect.anything()` checks.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="data-link-deletion.service.spec.ts"`

Expected: FAIL because `DataLinkDeletionService` does not exist.

- [ ] **Step 3: Implement the set-based DataLink deletion service**

Create the service with this complete public contract and implementation shape:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UnitOfWork} from '../../../../ports/persistence/unit-of-work.js';
import type {DeletedLinkProjectionInput} from '../delete-spf-module-result.builder.js';

export interface DataLinkDeletionResult {
  deletedLinks: DeletedLinkProjectionInput[];
  unresolvedSubsystemLinkSystemIds: number[];
}

export class DataLinkDeletionService {
  constructor(private readonly uow: UnitOfWork) {}

  async deleteForModule(
    moduleSystemId: number,
    fileSystemId: number,
  ): Promise<DataLinkDeletionResult> {
    const repository = this.uow.getDataLinkRepository();
    const connectedLinks = await repository.findLinksConnectedToModule(
      moduleSystemId,
      fileSystemId,
    );
    const unresolvedLinks =
      await repository.findUnresolvedSubsystemLinksFromModule(
        moduleSystemId,
        fileSystemId,
      );

    const subsystemIdsByCanonicalId = new Map<number, Set<number>>();
    for (const link of connectedLinks) {
      const subsystemIds =
        subsystemIdsByCanonicalId.get(link.systemId) ?? new Set<number>();
      for (const segment of link.subsystemDataLinks) {
        subsystemIds.add(segment.systemId);
      }
      subsystemIdsByCanonicalId.set(link.systemId, subsystemIds);
    }

    const deletedLinks = [...subsystemIdsByCanonicalId.entries()]
      .sort(([left], [right]) => left - right)
      .map(([systemId, subsystemIds]) => ({
        systemId,
        subsystemLinkSystemIds: [...subsystemIds].sort(
          (left, right) => left - right,
        ),
      }));
    const unresolvedSubsystemLinkSystemIds = [
      ...new Set(unresolvedLinks.map(link => link.systemId)),
    ].sort((left, right) => left - right);
    const allSubsystemLinkSystemIds = [
      ...new Set([
        ...deletedLinks.flatMap(link => link.subsystemLinkSystemIds),
        ...unresolvedSubsystemLinkSystemIds,
      ]),
    ].sort((left, right) => left - right);

    for (const link of deletedLinks) {
      await repository.deleteDataLink(link.systemId, fileSystemId);
    }
    if (allSubsystemLinkSystemIds.length > 0) {
      await repository.deleteSubsystemDataLinks(
        allSubsystemLinkSystemIds,
        fileSystemId,
      );
    }

    return {deletedLinks, unresolvedSubsystemLinkSystemIds};
  }
}
```

The service consumes effective-state reads from Task 12/Tasks 19–20, never inspects persistence table names, and never deletes a `DataPort`.

- [ ] **Step 4: Run the DataLink deletion tests**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="data-link-deletion.service.spec.ts"`

Expected: PASS; canonical IDs, resolved segments, and reached unresolved segments are each deleted once and returned in deterministic numeric order.

- [ ] **Step 5: Build core and verify bounded repository use**

Run: `pnpm run build:core && rg -n "findLinksConnectedToModule|findUnresolvedSubsystemLinksFromModule|deleteDataLink|deleteSubsystemDataLinks" packages/core/src/application/usecase-designer/spf-module/delete/services/data-link-deletion.service.ts`

Expected: the core build passes; discovery uses two relationship-category reads, subsystem deletion is one set call, and no framework, TypeORM, Node.js, or boundary-port dependency is imported.

### Task 31: Implement ControlLink deletion with one complete-set intent cleanup

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/spf-module/delete/services/control-link-deletion.service.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/control-link-deletion.service.spec.ts`

- [ ] **Step 1: Write failing tests for complete route deletion and stale-intent cleanup**

Create the focused service suite with mocked `ControlLinkRepository` and `SubsystemRepository`, while spying on the existing pure `ControlIntentPropagationService.findPortsToClearAfterDeletingLinks` operation from Task 10. Cover these observable scenarios:

```typescript
describe('ControlLinkDeletionService', () => {
  it('analyzes the complete deletion set once before recording deletes', async () => {
    // Return canonical 50 with resolved segments [511, 512], reached unresolved
    // segments [520, 512], and full pre-delete route context [511, 512, 520, 599].
    // Expect findPortsToClearAfterDeletingLinks to be called exactly once with
    // deletedSubsystemControlLinkSystemIds [511, 512, 520], the complete context,
    // and the exact nodeTypeBySystemId map.
  });

  it('clears surviving subsystem-port intents through SubsystemRepository once', async () => {
    // Make topology analysis return duplicate pairs for subsystem 30/port 531
    // plus subsystem 31/port 532. Expect one
    // clearControlPortIntents([531, 532], fileSystemId) call and duplicate-free
    // pairs in the service result.
  });

  it('retains intents on ports whose remaining component still reaches a module', async () => {
    // Use the real Task 10 topology operation with one deleted branch and one
    // surviving module-anchored route. Assert only the isolated subsystem port
    // is passed to clearControlPortIntents.
  });

  it('does not clear subsystem ControlPorts or call intent cleanup for an empty set', async () => {
    // Return no connected or unresolved links. Assert both deletion sets are
    // empty, clearControlPortIntents is not called, and no port-delete API exists
    // on either repository mock.
  });
});
```

The first scenario is the direct regression for FR-DM-13: calling the topology operation once per segment would produce incorrect results when a complete route is removed.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="control-link-deletion.service.spec.ts"`

Expected: FAIL because `ControlLinkDeletionService` does not exist.

- [ ] **Step 3: Implement pre-delete topology capture, link deletion, and intent clearing**

Create the service with this public contract. The implementation must preserve the numbered order because intent ownership and connectivity are evaluated from pre-delete effective topology:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UnitOfWork} from '../../../../ports/persistence/unit-of-work.js';
import {
  ControlIntentPropagationService,
  type IntentClearedControlPort,
} from '../../../../../domain/services/subsystem-control-links/control-intent-propagation.service.js';
import type {DeletedLinkProjectionInput} from '../delete-spf-module-result.builder.js';

export interface ControlLinkDeletionResult {
  deletedLinks: DeletedLinkProjectionInput[];
  unresolvedSubsystemLinkSystemIds: number[];
  intentClearedControlPorts: IntentClearedControlPort[];
}

export class ControlLinkDeletionService {
  constructor(private readonly uow: UnitOfWork) {}

  async deleteForModule(
    moduleSystemId: number,
    fileSystemId: number,
  ): Promise<ControlLinkDeletionResult> {
    // 1. Read connected canonical links, reached unresolved segments, and
    //    findSubsystemControlRouteContext(fileSystemId). Each is one bounded
    //    effective-state read from the same transaction-bound UoW; keep the calls
    //    sequential because the repositories share one QueryRunner.
    // 2. Deduplicate canonical IDs. For each canonical link, collect and sort its
    //    resolved subsystemControlLinks system IDs.
    // 3. Deduplicate reached unresolved IDs separately, then form one sorted union
    //    of resolved and unresolved segment IDs.
    // 4. Call ControlIntentPropagationService
    //    .findPortsToClearAfterDeletingLinks exactly once with:
    //      allSubsystemControlLinks: routeContext.subsystemControlLinks
    //      deletedSubsystemControlLinkSystemIds: the complete union
    //      nodeTypeMap: routeContext.nodeTypeBySystemId
    // 5. Record each canonical delete once, then call
    //    deleteSubsystemControlLinks once with the complete non-empty union.
    // 6. Deduplicate returned {subsystemSystemId, controlPortSystemId} pairs by
    //    both IDs and sort by subsystem ID then port ID.
    // 7. If at least one pair remains, call
    //    SubsystemRepository.clearControlPortIntents exactly once with the sorted
    //    unique ControlPort IDs and fileSystemId.
    // 8. Return deletedLinks, unresolvedSubsystemLinkSystemIds, and the sorted
    //    intentClearedControlPorts. Never delete a subsystem ControlPort.
  }
}
```

Do not call the older single-segment `findPortsToClear` operation. Do not recompute topology after any delete action has been recorded.

- [ ] **Step 4: Run the ControlLink deletion tests**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="control-link-deletion.service.spec.ts|control-intent-propagation.service.spec.ts"`

Expected: PASS; the complete deletion set is analyzed once, only stale intents are cleared through `SubsystemRepository`, surviving module-anchored intents remain, and boundary ControlPorts are retained.

- [ ] **Step 5: Build core and inspect the intent-cleanup call sites**

Run: `pnpm run build:core && rg -n "findPortsToClearAfterDeletingLinks|clearControlPortIntents|deleteSubsystemControlLinks|findPortsToClear\(" packages/core/src/application/usecase-designer/spf-module/delete/services/control-link-deletion.service.ts`

Expected: the build passes; one bulk topology call and one bounded intent-clear call are present; the old single-link API is absent from this service.

### Task 32: Implement independent container lifecycle handling

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/spf-module/delete/services/container-lifecycle.service.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/container-lifecycle.service.spec.ts`

- [ ] **Step 1: Write failing tests for empty and surviving containers**

Create a unit suite with mocked `ModuleRepository`, `ContainerRepository`, and `ContainerStackSizeService`:

```typescript
describe('ContainerLifecycleService', () => {
  it('deletes the container when no effective module remains', async () => {
    moduleRepository.findModulesByContainerId.mockResolvedValue([]);

    await expect(service.applyAfterModuleDeletion(20, 7)).resolves.toEqual({
      deletedContainerSystemIds: [20],
    });
    expect(containerRepository.deleteContainer).toHaveBeenCalledWith(20, 7);
    expect(stackSizeService.recalculateForContainer).not.toHaveBeenCalled();
  });

  it('recalculates stack size when effective modules remain', async () => {
    moduleRepository.findModulesByContainerId.mockResolvedValue([
      {
        systemId: 101,
        instanceId: 1,
        definitionSystemId: 501,
        containerSystemId: 20,
        subgraphSystemId: 30,
        fileSystemId: 7,
      },
    ]);

    await expect(service.applyAfterModuleDeletion(20, 7)).resolves.toEqual({
      deletedContainerSystemIds: [],
    });
    expect(containerRepository.deleteContainer).not.toHaveBeenCalled();
    expect(stackSizeService.recalculateForContainer).toHaveBeenCalledWith(
      20,
      7,
    );
  });
});
```

Add a third test proving exactly one occupancy read is made and that the decision does not inspect subgraph occupancy.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="container-lifecycle.service.spec.ts"`

Expected: FAIL because `ContainerLifecycleService` does not exist.

- [ ] **Step 3: Implement the lifecycle service using effective occupancy**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UnitOfWork} from '../../../../ports/persistence/unit-of-work.js';
import type {ContainerStackSizeService} from '../../services/container-stack-size.service.js';

export interface ContainerLifecycleResult {
  deletedContainerSystemIds: number[];
}

export class ContainerLifecycleService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly stackSizeService: ContainerStackSizeService,
  ) {}

  async applyAfterModuleDeletion(
    containerSystemId: number,
    fileSystemId: number,
  ): Promise<ContainerLifecycleResult> {
    const modules = await this.uow
      .getModuleRepository()
      .findModulesByContainerId(containerSystemId, fileSystemId);

    if (modules.length === 0) {
      await this.uow
        .getContainerRepository()
        .deleteContainer(containerSystemId, fileSystemId);
      return {deletedContainerSystemIds: [containerSystemId]};
    }

    await this.stackSizeService.recalculateForContainer(
      containerSystemId,
      fileSystemId,
    );
    return {deletedContainerSystemIds: []};
  }
}
```

This service is called only after the module delete action is recorded, so `findModulesByContainerId` observes the deleted module as absent while still including other active `STAGED` and `UNSTAGED` creates and moves.

- [ ] **Step 4: Run the container lifecycle tests**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="container-lifecycle.service.spec.ts|container-stack-size.service.spec.ts"`

Expected: PASS; empty containers are deleted, surviving containers are recalculated through the shared service, and the two structural decisions remain independent.

- [ ] **Step 5: Build core and verify stack logic is not duplicated**

Run: `pnpm run build:core && rg -n "findModulesByContainerId|deleteContainer|recalculateForContainer|Math\.max|CONTAINER_PROP_ID_STACK_SIZE" packages/core/src/application/usecase-designer/spf-module/delete/services/container-lifecycle.service.ts`

Expected: the build passes; the lifecycle service contains the occupancy branch and shared-service call, while no stack-size calculation or property encoding appears in the deletion folder.

### Task 33: Implement empty-subgraph deletion and UseCase relationship cleanup

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/spf-module/delete/services/subgraph-lifecycle.service.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/subgraph-lifecycle.service.spec.ts`

- [ ] **Step 1: Write failing tests for surviving and empty subgraphs**

Create a unit suite with mocked `ModuleRepository`, `SubgraphRepository`, and `UseCaseRepository`:

```typescript
describe('SubgraphLifecycleService', () => {
  it('preserves a subgraph that still has an effective module', async () => {
    moduleRepository.findModulesBySubgraphId.mockResolvedValue([
      {
        systemId: 102,
        instanceId: 2,
        definitionSystemId: 502,
        containerSystemId: 21,
        subgraphSystemId: 30,
        fileSystemId: 7,
      },
    ]);

    await expect(service.applyAfterModuleDeletion(30, 7)).resolves.toEqual({
      deletedSubgraphSystemIds: [],
      affectedUseCaseSystemIds: [],
    });
    expect(subgraphRepository.deleteSubgraph).not.toHaveBeenCalled();
    expect(useCaseRepository.removeSubgraphReferences).not.toHaveBeenCalled();
  });

  it('deletes an empty subgraph and returns duplicate-free affected UseCase IDs', async () => {
    moduleRepository.findModulesBySubgraphId.mockResolvedValue([]);
    useCaseRepository.removeSubgraphReferences.mockResolvedValue({
      affectedUseCaseSystemIds: [602, 601, 602],
    });

    await expect(service.applyAfterModuleDeletion(30, 7)).resolves.toEqual({
      deletedSubgraphSystemIds: [30],
      affectedUseCaseSystemIds: [601, 602],
    });
    expect(subgraphRepository.deleteSubgraph).toHaveBeenCalledWith(30, 7);
    expect(useCaseRepository.removeSubgraphReferences).toHaveBeenCalledWith(
      30,
      7,
    );
  });
});
```

Add an assertion that no UseCase delete method is called or required; only relationship removal is in scope.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="subgraph-lifecycle.service.spec.ts"`

Expected: FAIL because `SubgraphLifecycleService` does not exist.

- [ ] **Step 3: Implement independent subgraph and UseCase lifecycle handling**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UnitOfWork} from '../../../../ports/persistence/unit-of-work.js';

export interface SubgraphLifecycleResult {
  deletedSubgraphSystemIds: number[];
  affectedUseCaseSystemIds: number[];
}

export class SubgraphLifecycleService {
  constructor(private readonly uow: UnitOfWork) {}

  async applyAfterModuleDeletion(
    subgraphSystemId: number,
    fileSystemId: number,
  ): Promise<SubgraphLifecycleResult> {
    const modules = await this.uow
      .getModuleRepository()
      .findModulesBySubgraphId(subgraphSystemId, fileSystemId);

    if (modules.length > 0) {
      return {
        deletedSubgraphSystemIds: [],
        affectedUseCaseSystemIds: [],
      };
    }

    await this.uow
      .getSubgraphRepository()
      .deleteSubgraph(subgraphSystemId, fileSystemId);
    const {affectedUseCaseSystemIds} = await this.uow
      .getUseCaseRepository()
      .removeSubgraphReferences(subgraphSystemId, fileSystemId);

    return {
      deletedSubgraphSystemIds: [subgraphSystemId],
      affectedUseCaseSystemIds: [...new Set(affectedUseCaseSystemIds)].sort(
        (left, right) => left - right,
      ),
    };
  }
}
```

Do not inspect link `subgraphId` values and do not delete a UseCase root. The repository owns persistence-only relationship identities; this service handles only domain IDs.

- [ ] **Step 4: Run the subgraph lifecycle tests**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="subgraph-lifecycle.service.spec.ts"`

Expected: PASS; effective occupancy controls subgraph deletion, both relationship categories are removed through one repository call, and affected UseCase IDs are returned once in numeric order.

- [ ] **Step 5: Build core and verify aggregate boundaries**

Run: `pnpm run build:core && rg -n "findModulesBySubgraphId|deleteSubgraph|removeSubgraphReferences|deleteUseCase|DataLink|ControlLink" packages/core/src/application/usecase-designer/spf-module/delete/services/subgraph-lifecycle.service.ts`

Expected: the build passes; only the three intended repository methods appear, with no UseCase-root delete and no link ownership inference.

### Task 34: Orchestrate validation-first module cascade deletion

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/spf-module/delete/services/module-deletion.service.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/module-deletion.service.spec.ts`

- [ ] **Step 1: Write failing tests for validation ordering and cascade coordination**

Create the service test with mocks for the transaction-bound repositories and all four child services. The fixture must record call order in a shared string array. Cover this matrix:

```typescript
describe('ModuleDeletionService validation and cascade orchestration', () => {
  it('fails a missing effective module before any delete edit-action is requested', async () => {
    // findModuleById returns null. Assert the failure carries
    // IssueFactory.notFound(ISSUE_ENTITY_TYPE.SpfModule, moduleSystemId), and
    // every child service plus deleteModule/deleteContainer/deleteSubgraph/
    // removeSubgraphReferences/clearControlPortIntents remains uncalled.
  });

  it('rejects an imported effective subgraph before any delete edit-action is requested', async () => {
    // findModuleById returns SpfModuleBase; getSubgraphById returns isImported=true.
    // Assert DomainRuleViolationException contains ARC-MOD-SUBGRAPH-IMPORTED and
    // all delete-capable collaborators remain uncalled.
  });

  it('deletes a session-created module through the normal effective-state path', async () => {
    // Return a SpfModuleBase representing an active earlier-session CREATE.
    // Assert the service invokes ModuleRepository.deleteModule under the current
    // request group and never attempts to cancel, rewrite, or reuse the CREATE
    // group's identity.
  });

  it('completes every validation read before the first delete service call', async () => {
    // Record calls for findModuleById, getSubgraphById, hasSubsystems,
    // dataLinks.deleteForModule, controlLinks.deleteForModule, deleteModule,
    // containerLifecycle, and subgraphLifecycle. Assert the first three entries
    // are validation/capability reads and no edit-producing call precedes them.
  });

  it('records module deletion before effective container and subgraph occupancy reads', async () => {
    // Assert deleteModule occurs before both lifecycle service calls so their
    // effective-state reads exclude the requested module.
  });
});
```

Use module ID `1001`, container ID `2001`, subgraph ID `3001`, and file ID `7` consistently so failure messages and assertions are concrete.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="module-deletion.service.spec.ts"`

Expected: FAIL because `ModuleDeletionService` does not exist.

- [ ] **Step 3: Implement validation-first orchestration and an internal numeric summary**

Create the service with the following dependencies and method contract. This task intentionally returns `DeleteSpfModuleResultInput`, the numeric projection input from Task 8; Task 35 applies the public response builder after the orchestration tests are green.

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UnitOfWork} from '../../../../ports/persistence/unit-of-work.js';
import type {DeleteSpfModuleResultInput} from '../delete-spf-module-result.builder.js';
import type {ContainerLifecycleService} from './container-lifecycle.service.js';
import type {ControlLinkDeletionService} from './control-link-deletion.service.js';
import type {DataLinkDeletionService} from './data-link-deletion.service.js';
import type {SubgraphLifecycleService} from './subgraph-lifecycle.service.js';

export interface DeleteModuleInput {
  moduleSystemId: number;
  fileSystemId: number;
}

export class ModuleDeletionService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly dataLinkDeletionService: DataLinkDeletionService,
    private readonly controlLinkDeletionService: ControlLinkDeletionService,
    private readonly containerLifecycleService: ContainerLifecycleService,
    private readonly subgraphLifecycleService: SubgraphLifecycleService,
  ) {}

  async deleteModule(
    input: DeleteModuleInput,
  ): Promise<DeleteSpfModuleResultInput> {
    // 1. VALIDATE: call ModuleRepository.findModuleById with both IDs. This
    //    file-scoped effective lookup enforces project/file ownership and accepts
    //    session-created modules. If null,
    //    fail through the existing core 404 exception path carrying
    //    IssueFactory.notFound(ISSUE_ENTITY_TYPE.SpfModule, moduleSystemId).
    // 2. VALIDATE: call SubgraphRepository.getSubgraphById using the module's
    //    effective subgraphSystemId. Treat a missing subgraph as not found.
    // 3. VALIDATE: if subgraph.isImported, throw DomainRuleViolationException
    //    containing the established ARC-MOD-SUBGRAPH-IMPORTED issue.
    // 4. READ ONLY: call SubsystemRepository.hasSubsystems(fileSystemId). No
    //    delete-producing collaborator may run before steps 1-3 complete.
    // 5. Call DataLinkDeletionService.deleteForModule and
    //    ControlLinkDeletionService.deleteForModule. Their reads and writes use
    //    the same transaction-bound UnitOfWork and ambient groupId.
    // 6. Call ModuleRepository.deleteModule(moduleSystemId, fileSystemId) once.
    // 7. Call ContainerLifecycleService.applyAfterModuleDeletion with the
    //    effective module.containerSystemId.
    // 8. Call SubgraphLifecycleService.applyAfterModuleDeletion with the
    //    effective module.subgraphSystemId.
    // 9. Assemble and return the correct DeleteSpfModuleResultInput union arm:
    //    common fields come from all service outputs; when hasSubsystems=false,
    //    omit every subsystem-only input field; when true, include both
    //    unresolved arrays and intentClearedControlPorts, including empty arrays.
  }
}
```

This service does not start, commit, or roll back a transaction. It assumes the command handler owns the transaction and does not generate or accept a `groupId`; every repository write receives the handler's ambient `WriteContext` group.

- [ ] **Step 4: Run the module orchestration tests**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="module-deletion.service.spec.ts"`

Expected: PASS; missing/imported validation failures produce zero edit-capable calls, successful orchestration deletes links before the module and runs both independent lifecycle decisions after the module delete.

- [ ] **Step 5: Run all service tests before response projection**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="(container-stack-size|data-link-deletion|control-link-deletion|container-lifecycle|subgraph-lifecycle|module-deletion).service.spec.ts"`

Expected: PASS; each service consumes only core ports and all validation ordering, complete-set intent cleanup, occupancy, and aggregate-boundary assertions are green.

### Task 35: Build the deterministic Delete Module response and add the focused cascade regression matrix

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/usecase-designer/spf-module/delete/services/module-deletion.service.ts`
- Modify: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/module-deletion.service.spec.ts`

- [ ] **Step 1: Add failing response-shape, sorting, and deduplication tests**

Extend the `ModuleDeletionService` suite with two complete success cases. Child services deliberately return duplicate and out-of-order IDs so the test proves the public result comes from Task 8's builder rather than repository iteration order:

```typescript
describe('ModuleDeletionService response construction', () => {
  it('returns the non-subsystem shape with every subsystem field omitted', async () => {
    // hasSubsystems=false.
    // Data links: canonical IDs [40, 20, 40], with arbitrary resolved IDs.
    // Control links: canonical ID [50], with arbitrary resolved IDs.
    // Structural results: container [70], no subgraph, UseCases [92, 91, 92].
    // Expect exactly:
    // deleted.spfModules [{systemId:'1001'}]
    // deleted.containers [{systemId:'70'}]
    // deleted.dataLinks [{systemId:'20'}, {systemId:'40'}]
    // deleted.controlLinks [{systemId:'50'}]
    // updated.usecases [{systemId:'91'}, {systemId:'92'}]
    // and no subsystemLinks, unresolved arrays, or updated.subsystems keys.
  });

  it('returns the subsystem-capable shape with deterministic nested arrays', async () => {
    // hasSubsystems=true.
    // Include duplicate canonical links, resolved segment IDs, unresolved IDs,
    // and intent-cleared pairs spanning subsystems 31 and 30.
    // Assert every top-level and nested array is duplicate-free and numerically
    // ascending, resolved segments stay under their canonical link, unresolved
    // segments stay in their separate arrays, and cleared ports are grouped by
    // owning subsystem. Assert empty subsystem categories are present as [].
  });
});
```

Also assert `deleted.spfModules` contains exactly one entry even when child outputs contain the requested ID, and validate both results with `DeleteSpfModuleResultSchema.parse(result)`.

- [ ] **Step 2: Run the response tests and verify they fail**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="module-deletion.service.spec.ts"`

Expected: FAIL because Task 34 returns the numeric `DeleteSpfModuleResultInput` rather than the serialized, sorted, duplicate-free `DeleteSpfModuleResult`.

- [ ] **Step 3: Route the internal summary through the existing result builder**

Import the exact Task 6/Task 8 types and builder:

```typescript
import type {DeleteSpfModuleResult} from '../../dto/delete-spf-module-result.schema.js';
import {
  buildDeleteSpfModuleResult,
  type DeleteSpfModuleResultInput,
} from '../delete-spf-module-result.builder.js';
```

Change the public method return type and final projection only:

```typescript
  async deleteModule(
    input: DeleteModuleInput,
  ): Promise<DeleteSpfModuleResult> {
    // Keep Tasks 34 steps 1-8 unchanged and preserve validation-before-write order.
    const commonSummary = {
      requestedModuleSystemId: input.moduleSystemId,
      deletedSubgraphSystemIds:
        subgraphResult.deletedSubgraphSystemIds,
      deletedContainerSystemIds:
        containerResult.deletedContainerSystemIds,
      deletedDataLinks: dataLinkResult.deletedLinks,
      deletedControlLinks: controlLinkResult.deletedLinks,
      updatedUsecaseSystemIds:
        subgraphResult.affectedUseCaseSystemIds,
    };
    const summary: DeleteSpfModuleResultInput = subsystemCapable
      ? {
          ...commonSummary,
          subsystemCapable: true,
          unresolvedSubsystemDataLinkSystemIds:
            dataLinkResult.unresolvedSubsystemLinkSystemIds,
          unresolvedSubsystemControlLinkSystemIds:
            controlLinkResult.unresolvedSubsystemLinkSystemIds,
          intentClearedControlPorts:
            controlLinkResult.intentClearedControlPorts,
        }
      : {
          ...commonSummary,
          subsystemCapable: false,
        };
    return buildDeleteSpfModuleResult(summary);
  }
```

Do not add local sorting, string conversion, link grouping, or subsystem grouping to `ModuleDeletionService`. `buildDeleteSpfModuleResult` is the single response normalization boundary and already owns decimal serialization, numeric sorting, and duplicate removal.

- [ ] **Step 4: Run the complete focused core test set**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result|control-intent-propagation|container-stack-size|data-link-deletion|control-link-deletion|container-lifecycle|subgraph-lifecycle|module-deletion"`

Expected: PASS; both response variants satisfy the zod schema, every array is deterministic and duplicate-free, stale-only intent cleanup remains correct, subsystem boundary ports remain untouched, empty structural owners are removed, surviving stack size is recalculated, and UseCases are preserved.

- [ ] **Step 5: Run final chapter validation**

Run: `pnpm run build:core && pnpm run lint && rg -n "from ['\"](@nestjs|typeorm|node:)" packages/core/src/application/usecase-designer/spf-module/delete/services packages/core/src/application/usecase-designer/spf-module/services/container-stack-size.service.ts || true && git diff --check -- packages/core/src/application/ports/persistence/repositories/module/module.repository.ts packages/core/src/application/usecase-designer/spf-module/services packages/core/src/application/usecase-designer/spf-module/delete/services packages/core/tests/unit/application/usecase-designer/spf-module/services packages/core/tests/unit/application/usecase-designer/spf-module/delete/services docs/module-write/plans/chapters/04-01-delete-cascade-services.md`

Expected: core build and lint pass; the framework-import grep prints nothing; all chapter tests pass; no command, handler, registry, controller, persistence adapter, migration, or API file is changed.

### Commit: Delete Cascade Application Services

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/core/src/application/ports/persistence/repositories/module/module.repository.ts \
        packages/core/src/application/usecase-designer/spf-module/services/container-stack-size.service.ts \
        packages/core/src/application/usecase-designer/spf-module/delete/services/data-link-deletion.service.ts \
        packages/core/src/application/usecase-designer/spf-module/delete/services/control-link-deletion.service.ts \
        packages/core/src/application/usecase-designer/spf-module/delete/services/container-lifecycle.service.ts \
        packages/core/src/application/usecase-designer/spf-module/delete/services/subgraph-lifecycle.service.ts \
        packages/core/src/application/usecase-designer/spf-module/delete/services/module-deletion.service.ts \
        packages/core/tests/unit/application/usecase-designer/spf-module/services/container-stack-size.service.spec.ts \
        packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/data-link-deletion.service.spec.ts \
        packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/control-link-deletion.service.spec.ts \
        packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/container-lifecycle.service.spec.ts \
        packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/subgraph-lifecycle.service.spec.ts \
        packages/core/tests/unit/application/usecase-designer/spf-module/delete/services/module-deletion.service.spec.ts \
        docs/module-write/plans/chapters/04-01-delete-cascade-services.md
git commit -m "feat(core): add delete module cascade services" \
           -m "Coordinate effective-state link cleanup, structural lifecycle decisions, stack-size recalculation, and deterministic Delete Module response construction." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
