### Task 36: Add the Designer-only Delete Module command contract

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.command.ts`

- [ ] **Step 1: Create the command with the frozen session-mode contract**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {SESSION_MODE, type SessionMode} from '../../../edit-session/session-types.js';
import {BaseCommand} from '../../../shared/base-command.js';

export class DeleteSpfModuleCommand extends BaseCommand {
  static override readonly requiresSession = true;
  static override readonly allowedModes: readonly SessionMode[] = [
    SESSION_MODE.Designer,
  ];

  // TODO(diff-merge-selection-dependencies): add SessionMode.DiffMerge after
  // module-delete registers and stages required dependency closures.
  constructor(public readonly spfModuleSystemId: number) {
    super();
  }
}
```

The command carries only the requested module system ID. `fileSystemId`, `sessionId`, and the operation `groupId` remain authoritative values from the `WriteContext`; accepting them from the caller would weaken FR-DM-03, FR-DM-04, FR-DM-22, and FR-DM-25.

- [ ] **Step 2: Build core to type-check the command contract**

Run: `pnpm run build:core`

Expected: PASS; `DeleteSpfModuleCommand` extends `BaseCommand`, and the static session declarations match the command-bus contract.

- [ ] **Step 3: Verify that initial mode support is Designer-only**

Run: `rg -n "requiresSession|SESSION_MODE\.Designer|SESSION_MODE\.DiffMerge|diff-merge-selection-dependencies" packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.command.ts`

Expected: `requiresSession` is `true`; `Designer` is the sole value in `allowedModes`; `DiffMerge` appears only in the explicit future-enablement TODO required by FR-DM-03 and FR-DM-06A.

- [ ] **Step 4: Verify the command does not accept caller-owned write context**

Run: `rg -n "fileSystemId|sessionId|groupId|clientId" packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.command.ts || true`

Expected: no matches; the constructor accepts only `spfModuleSystemId`.

- [ ] **Step 5: Check formatting and framework independence**

Run: `pnpm exec prettier --check packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.command.ts && rg -n "from ['\"](@nestjs|typeorm|node:)" packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.command.ts || true`

Expected: Prettier passes and the framework-import scan prints nothing.

### Task 37: Implement the successful transactional handler path with a focused unit test

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.handler.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/delete-spf-module.handler.spec.ts`

- [ ] **Step 1: Write the failing happy-path transaction and delegation test**

Create the handler test with a real command, a mocked `UnitOfWork`, and a mocked `ModuleDeletionService`. The response fixture is the non-subsystem arm already defined by `DeleteSpfModuleResult`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import type {UnitOfWork} from '../../../../../../src/application/ports/persistence/unit-of-work.js';
import {DeleteSpfModuleCommand} from '../../../../../../src/application/usecase-designer/spf-module/delete/delete-spf-module.command.js';
import {DeleteSpfModuleHandler} from '../../../../../../src/application/usecase-designer/spf-module/delete/delete-spf-module.handler.js';
import type {DeleteSpfModuleResult} from '../../../../../../src/application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.js';
import type {ModuleDeletionService} from '../../../../../../src/application/usecase-designer/spf-module/delete/services/module-deletion.service.js';

const MODULE_ID = 1001;
const FILE_ID = 7;
const GROUP_ID = 'delete-module-group';
const RESPONSE: DeleteSpfModuleResult = {
  deleted: {
    spfModules: [{systemId: '1001'}],
    subgraphs: [],
    containers: [],
    dataLinks: [],
    controlLinks: [],
  },
  updated: {usecases: []},
};

describe('DeleteSpfModuleHandler', () => {
  let callOrder: string[];
  let uow: jest.Mocked<UnitOfWork>;
  let moduleDeletionService: jest.Mocked<ModuleDeletionService>;
  let handler: DeleteSpfModuleHandler;

  beforeEach(() => {
    callOrder = [];
    uow = {
      startTransaction: jest.fn(async () => {
        callOrder.push('startTransaction');
      }),
      commit: jest.fn(async () => {
        callOrder.push('commit');
      }),
      rollback: jest.fn(),
      isInTransaction: jest.fn(() => true),
      getWriteContext: jest.fn(() => ({
        session: {
          sessionId: 11,
          fileSystemId: FILE_ID,
          mode: 'DESIGNER',
          projectId: '9',
        },
        groupId: GROUP_ID,
      })),
    } as unknown as jest.Mocked<UnitOfWork>;
    moduleDeletionService = {
      deleteModule: jest.fn(async () => {
        callOrder.push('deleteModule');
        return RESPONSE;
      }),
    } as unknown as jest.Mocked<ModuleDeletionService>;
    handler = new DeleteSpfModuleHandler(uow, moduleDeletionService);
  });

  it('runs the cascade inside one handler-owned transaction and returns groupId plus response', async () => {
    await expect(
      handler.handle(new DeleteSpfModuleCommand(MODULE_ID)),
    ).resolves.toEqual({groupId: GROUP_ID, response: RESPONSE});

    expect(moduleDeletionService.deleteModule).toHaveBeenCalledWith({
      moduleSystemId: MODULE_ID,
      fileSystemId: FILE_ID,
    });
    expect(callOrder).toEqual([
      'startTransaction',
      'deleteModule',
      'commit',
    ]);
    expect(uow.rollback).not.toHaveBeenCalled();
  });
});
```

This test keeps the handler boundary focused. The missing-module, session-created-module, imported-subgraph, effective-state, and validation-before-edit matrices for FR-DM-04 through FR-DM-08 and FR-DM-21 remain in `module-deletion.service.spec.ts` from Task 34, where those decisions are implemented.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module.handler.spec.ts"`

Expected: FAIL because `DeleteSpfModuleHandler` does not exist.

- [ ] **Step 3: Add the minimal successful handler implementation**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UnitOfWork} from '../../../ports/persistence/unit-of-work.js';
import type {CommandHandler} from '../../../orchestration/cqrs/commands/command-handler.js';
import type {DeleteSpfModuleResult} from '../dto/delete-spf-module-result.schema.js';
import type {DeleteSpfModuleCommand} from './delete-spf-module.command.js';
import type {ModuleDeletionService} from './services/module-deletion.service.js';

export interface DeleteSpfModuleInternalResult {
  groupId: string;
  response: DeleteSpfModuleResult;
}

export class DeleteSpfModuleHandler implements CommandHandler<
  DeleteSpfModuleCommand,
  DeleteSpfModuleInternalResult
> {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly moduleDeletionService: ModuleDeletionService,
  ) {}

  async handle(
    command: DeleteSpfModuleCommand,
  ): Promise<DeleteSpfModuleInternalResult> {
    await this.uow.startTransaction();
    const fileSystemId = this.uow.getWriteContext().session.fileSystemId;
    const response = await this.moduleDeletionService.deleteModule({
      moduleSystemId: command.spfModuleSystemId,
      fileSystemId,
    });
    await this.uow.commit();
    return {
      groupId: this.uow.getWriteContext().groupId,
      response,
    };
  }
}
```

`ModuleDeletionService.deleteModule` is the only cascade entry point. It performs the FR-DM-04/FR-DM-05 file-scoped lookup and FR-DM-07 imported-subgraph validation before invoking any edit-producing collaborator, satisfying FR-DM-08, then uses transaction-bound effective-state repositories for FR-DM-21. The handler must not repeat those reads or call a repository directly.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module.handler.spec.ts"`

Expected: PASS; the order is `startTransaction -> deleteModule -> commit`, the service receives the active session's `fileSystemId`, and the returned result contains the ambient operation `groupId` plus the response.

- [ ] **Step 5: Run the handler and cascade-service tests together**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="(delete-spf-module.handler|module-deletion.service).spec.ts"`

Expected: PASS; the handler owns transaction boundaries while `ModuleDeletionService` continues to prove missing/imported validation completes before any delete-operation edit action.

### Task 38: Add conditional rollback, structured logs, and the DiffMerge handler integration TODO

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.handler.ts`
- Modify: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/delete-spf-module.handler.spec.ts`

- [ ] **Step 1: Add failing failure-path and logging tests**

Extend the test imports and fixture with the established framework-free logger and hexadecimal utility:

```typescript
import type {Logger} from '../../../../../../src/shared/types/logger.interface.js';
import {BinaryUtils} from '../../../../../../src/shared/utilities/binary-utils.js';
```

Add `logger` to the suite and pass it to the handler in `beforeEach`:

```typescript
let logger: jest.Mocked<Logger>;

logger = {
  logInfo: jest.fn(),
  logError: jest.fn(),
} as unknown as jest.Mocked<Logger>;
handler = new DeleteSpfModuleHandler(uow, moduleDeletionService, logger);
```

Add these concrete cases:

```typescript
it('logs success with the module ID in hexadecimal', async () => {
  await handler.handle(new DeleteSpfModuleCommand(MODULE_ID));

  const moduleLabel = `SpfModule (${BinaryUtils.toHexString(MODULE_ID)})`;
  expect(logger.logInfo).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      msg: `Deleting ${moduleLabel}`,
      action: 'delete_spf_module_start',
      component: 'DeleteSpfModuleHandler',
      tag: 'delete-spf-module',
      timestamp: expect.any(Date),
    }),
  );
  expect(logger.logInfo).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      msg: `Deleted ${moduleLabel}`,
      action: 'delete_spf_module_success',
      component: 'DeleteSpfModuleHandler',
      tag: 'delete-spf-module',
      timestamp: expect.any(Date),
    }),
  );
});

it('conditionally rolls back, logs the original error, and rethrows it', async () => {
  const failure = new Error('delete write failed');
  moduleDeletionService.deleteModule.mockRejectedValueOnce(failure);

  await expect(
    handler.handle(new DeleteSpfModuleCommand(MODULE_ID)),
  ).rejects.toBe(failure);

  expect(uow.isInTransaction).toHaveBeenCalledTimes(1);
  expect(uow.rollback).toHaveBeenCalledTimes(1);
  expect(uow.commit).not.toHaveBeenCalled();
  expect(logger.logError).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: `Failed to delete SpfModule (${BinaryUtils.toHexString(MODULE_ID)})`,
      action: 'delete_spf_module_failed',
      component: 'DeleteSpfModuleHandler',
      tag: 'delete-spf-module',
      error: failure,
      timestamp: expect.any(Date),
    }),
  );
});

it('does not roll back when no transaction remains active', async () => {
  moduleDeletionService.deleteModule.mockRejectedValueOnce(
    new Error('transaction already closed'),
  );
  uow.isInTransaction.mockReturnValue(false);

  await expect(
    handler.handle(new DeleteSpfModuleCommand(MODULE_ID)),
  ).rejects.toThrow('transaction already closed');

  expect(uow.rollback).not.toHaveBeenCalled();
  expect(uow.commit).not.toHaveBeenCalled();
});
```

Keep the Task 37 call-order assertion. Together, the tests prove commit occurs only after the complete validation-first cascade returns and that every failure path returns no partial success.

- [ ] **Step 2: Run the focused test and verify the new cases fail**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module.handler.spec.ts"`

Expected: FAIL because the Task 37 handler has no logger dependency, no catch block, and no conditional rollback.

- [ ] **Step 3: Replace the handler with the complete transaction, logging, and deferred-dependency implementation**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {UnitOfWork} from '../../../ports/persistence/unit-of-work.js';
import type {CommandHandler} from '../../../orchestration/cqrs/commands/command-handler.js';
import type {DeleteSpfModuleResult} from '../dto/delete-spf-module-result.schema.js';
import type {Logger} from '../../../../shared/types/logger.interface.js';
import {BinaryUtils} from '../../../../shared/utilities/binary-utils.js';
import type {DeleteSpfModuleCommand} from './delete-spf-module.command.js';
import type {ModuleDeletionService} from './services/module-deletion.service.js';

export interface DeleteSpfModuleInternalResult {
  groupId: string;
  response: DeleteSpfModuleResult;
}

export class DeleteSpfModuleHandler implements CommandHandler<
  DeleteSpfModuleCommand,
  DeleteSpfModuleInternalResult
> {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly moduleDeletionService: ModuleDeletionService,
    private readonly logger?: Logger,
  ) {}

  async handle(
    command: DeleteSpfModuleCommand,
  ): Promise<DeleteSpfModuleInternalResult> {
    const moduleLabel = `SpfModule (${BinaryUtils.toHexString(
      command.spfModuleSystemId,
    )})`;

    await this.uow.startTransaction();
    try {
      this.logger?.logInfo({
        msg: `Deleting ${moduleLabel}`,
        action: 'delete_spf_module_start',
        component: 'DeleteSpfModuleHandler',
        tag: 'delete-spf-module',
        timestamp: new Date(),
      });

      const fileSystemId = this.uow.getWriteContext().session.fileSystemId;
      const response = await this.moduleDeletionService.deleteModule({
        moduleSystemId: command.spfModuleSystemId,
        fileSystemId,
      });

      // TODO(diff-merge-selection-dependencies): when DiffMerge is enabled,
      // register required change-unit dependencies and stage the forward closure
      // in this same transaction before commit.

      await this.uow.commit();
      this.logger?.logInfo({
        msg: `Deleted ${moduleLabel}`,
        action: 'delete_spf_module_success',
        component: 'DeleteSpfModuleHandler',
        tag: 'delete-spf-module',
        timestamp: new Date(),
      });
      return {
        groupId: this.uow.getWriteContext().groupId,
        response,
      };
    } catch (error) {
      if (this.uow.isInTransaction()) {
        await this.uow.rollback();
      }
      const loggedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger?.logError({
        msg: `Failed to delete ${moduleLabel}`,
        action: 'delete_spf_module_failed',
        component: 'DeleteSpfModuleHandler',
        tag: 'delete-spf-module',
        error: loggedError,
        timestamp: new Date(),
      });
      throw error;
    }
  }
}
```

The intentional TODO is the exact future integration point from FR-DM-06A and design section 13. Do not add `SessionMode.DiffMerge`, `ChangeSelectionService`, dependency registration, or status staging in this chapter. The ambient `WriteContext` keeps every newly produced action on one operation `groupId` without changing each aggregate's own `aggregateId`, preserving FR-DM-22 and FR-DM-23.

- [ ] **Step 4: Run the focused handler tests**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module.handler.spec.ts"`

Expected: PASS; success commits before returning, active failures roll back once, inactive failures do not roll back, errors are rethrown, and every added log has `msg`, `action`, `component`, `tag`, and `timestamp` with the module ID rendered by `BinaryUtils.toHexString()`. This covers FR-DM-24, FR-DM-25, and NFR-DM-04 at the handler boundary.

- [ ] **Step 5: Verify validation order and transaction ownership across the handler-service boundary**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="(delete-spf-module.handler|module-deletion.service).spec.ts" && rg -n "startTransaction|deleteModule\(|diff-merge-selection-dependencies|commit|isInTransaction|rollback|BinaryUtils\.toHexString" packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.handler.ts`

Expected: PASS; Task 34 still proves module/file/imported-subgraph validation precedes every edit-producing call, while the handler starts one transaction, delegates once, retains the explicit DiffMerge dependency TODO before commit, conditionally rolls back, and logs IDs in hexadecimal.

### Task 39: Export the command contract and wire the complete handler factory into the registry

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/application/orchestration/cqrs/registries/command-handler-registry.ts`
- Test: `packages/core/tests/unit/application/orchestration/cqrs/registries/command-handler-registry.spec.ts`

- [ ] **Step 1: Write the failing registry factory test**

Add these imports to `command-handler-registry.spec.ts`, merging type imports from the same module where appropriate:

```typescript
import type {
  FileSystemPort,
  IdGenerationPort,
  NaturalIdGenerationPort,
  QueryServices,
  UnitOfWork,
} from '@arc/core';
import {
  CommandHandlerRegistry,
  type CommandHandlerDependencies,
} from '../../../../../../src/application/orchestration/cqrs/registries/command-handler-registry.js';
import {DeleteSpfModuleCommand} from '../../../../../../src/application/usecase-designer/spf-module/delete/delete-spf-module.command.js';
import {DeleteSpfModuleHandler} from '../../../../../../src/application/usecase-designer/spf-module/delete/delete-spf-module.handler.js';
```

If `CommandHandlerRegistry` is already imported in the test, replace that import with the combined value/type import above. Add this test inside the existing registry suite:

```typescript
it('creates DeleteSpfModuleHandler for DeleteSpfModuleCommand', () => {
  const dependencies = {
    uow: {} as UnitOfWork,
    idGeneration: {} as IdGenerationPort,
    naturalIdGeneration: {} as NaturalIdGenerationPort,
    fileSystem: {} as FileSystemPort,
    queryServices: {} as QueryServices,
  } satisfies CommandHandlerDependencies;

  const factory = registry.getCommandHandlerFactory(
    new DeleteSpfModuleCommand(1001),
  );

  expect(factory.create(dependencies)).toBeInstanceOf(
    DeleteSpfModuleHandler,
  );
});
```

This is a behavioral registry test: it proves the command constructor is registered and the complete service graph can be instantiated from the registry dependency bag.

- [ ] **Step 2: Run the registry test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="command-handler-registry.spec.ts"`

Expected: FAIL with `CommandHandlerNotFoundException` for `DeleteSpfModuleCommand`.

- [ ] **Step 3: Add public exports and register the exact delete-service dependency graph**

Append the command and handler result contracts to `packages/core/src/index.ts` alongside the other module-write exports:

```typescript
export {DeleteSpfModuleCommand} from './application/usecase-designer/spf-module/delete/delete-spf-module.command.js';
export type {DeleteSpfModuleInternalResult} from './application/usecase-designer/spf-module/delete/delete-spf-module.handler.js';
export {
  DeleteSpfModuleResultSchema,
  type DeleteSpfModuleResult,
} from './application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.js';
```

Add these ESM imports to `command-handler-registry.ts` beside the existing SPF module command imports:

```typescript
import {DeleteSpfModuleCommand} from '../../../usecase-designer/spf-module/delete/delete-spf-module.command.js';
import {DeleteSpfModuleHandler} from '../../../usecase-designer/spf-module/delete/delete-spf-module.handler.js';
import {ContainerLifecycleService} from '../../../usecase-designer/spf-module/delete/services/container-lifecycle.service.js';
import {ControlLinkDeletionService} from '../../../usecase-designer/spf-module/delete/services/control-link-deletion.service.js';
import {DataLinkDeletionService} from '../../../usecase-designer/spf-module/delete/services/data-link-deletion.service.js';
import {ModuleDeletionService} from '../../../usecase-designer/spf-module/delete/services/module-deletion.service.js';
import {SubgraphLifecycleService} from '../../../usecase-designer/spf-module/delete/services/subgraph-lifecycle.service.js';
import {ContainerStackSizeService} from '../../../usecase-designer/spf-module/services/container-stack-size.service.js';
```

Register the factory immediately after the existing `PatchSpfModuleCommand` registration:

```typescript
this.commandHandlerFactories.set(DeleteSpfModuleCommand, {
  create: deps => {
    const containerStackSizeService = new ContainerStackSizeService(deps.uow);
    const moduleDeletionService = new ModuleDeletionService(
      deps.uow,
      new DataLinkDeletionService(deps.uow),
      new ControlLinkDeletionService(deps.uow),
      new ContainerLifecycleService(deps.uow, containerStackSizeService),
      new SubgraphLifecycleService(deps.uow),
    );
    return new DeleteSpfModuleHandler(
      deps.uow,
      moduleDeletionService,
      deps.logger,
    );
  },
});
```

Use only the service names and constructors established in Task 29 and Tasks 30–34. Do not instantiate repositories outside `UnitOfWork`, generate a `groupId`, or add the future `ChangeSelectionService` dependency here; those would violate FR-DM-21 through FR-DM-24 or prematurely enable FR-DM-06A.

- [ ] **Step 4: Run the registry test and build the public core surface**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="command-handler-registry.spec.ts|delete-spf-module.handler.spec.ts" && pnpm run build:core`

Expected: PASS; the registry resolves `DeleteSpfModuleCommand`, constructs `DeleteSpfModuleHandler` with the complete cascade graph and optional logger, and the root package exports the command plus internal/public result types.

- [ ] **Step 5: Run final chapter validation and scope checks**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="(delete-spf-module.handler|module-deletion.service|command-handler-registry).spec.ts" && pnpm run lint && rg -n "DeleteSpfModule(Command|Handler|InternalResult|ResultSchema)|ModuleDeletionService|ContainerStackSizeService|diff-merge-selection-dependencies" packages/core/src/index.ts packages/core/src/application/orchestration/cqrs/registries/command-handler-registry.ts packages/core/src/application/usecase-designer/spf-module/delete packages/core/tests/unit/application/usecase-designer/spf-module/delete packages/core/tests/unit/application/orchestration/cqrs/registries/command-handler-registry.spec.ts && rg -n "from ['\"](@nestjs|typeorm|node:)" packages/core/src/application/usecase-designer/spf-module/delete packages/core/src/application/orchestration/cqrs/registries/command-handler-registry.ts || true && git diff --check -- packages/core/src/index.ts packages/core/src/application/orchestration/cqrs/registries/command-handler-registry.ts packages/core/src/application/usecase-designer/spf-module/delete packages/core/tests/unit/application/usecase-designer/spf-module/delete packages/core/tests/unit/application/orchestration/cqrs/registries/command-handler-registry.spec.ts docs/module-write/plans/chapters/05-01-command-handler-registry.md`

Expected: all focused tests, core build, and lint pass; the framework-import scan prints nothing; both intentional DiffMerge TODOs remain; all handler logs carry the required structured fields and hexadecimal module ID; the registered `BaseCommand` path satisfies NFR-DM-02 and the focused command/handler checks satisfy this chapter's NFR-DM-05 responsibility; `git diff --check` reports no whitespace errors; no controller, API DTO, persistence adapter, migration, or API test file is changed.

### Commit: Delete Command and Handler Wiring

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.command.ts \
        packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.handler.ts \
        packages/core/tests/unit/application/usecase-designer/spf-module/delete/delete-spf-module.handler.spec.ts \
        packages/core/src/application/orchestration/cqrs/registries/command-handler-registry.ts \
        packages/core/tests/unit/application/orchestration/cqrs/registries/command-handler-registry.spec.ts \
        packages/core/src/index.ts \
        docs/module-write/plans/chapters/05-01-command-handler-registry.md
git commit -m "feat(core): wire delete module command handler" \
           -m "Add the Designer-only Delete Module command, transactional handler, structured logging, public exports, and registry service composition." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
