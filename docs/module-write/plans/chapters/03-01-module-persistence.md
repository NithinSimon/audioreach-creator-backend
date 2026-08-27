### Task 15: Add the effective module projection read

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/tests/integration/repositories/module/module.repository.integration.spec.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/module.repository.ts`

- [ ] **Step 1: Write failing integration tests for `findModuleById`**

Extend the existing `TypeOrmModuleRepository (integration)` suite with a `findModuleById` block. Reuse `seedProjectAndFile`, `seedSession`, `seedModule`, `makeWriter`, and `makeRepo`; change `makeUow` to accept an optional `groupId = 'test-group'` so later tests can create independent action groups.

```typescript
describe('findModuleById', () => {
  it('returns the lightweight committed module projection in the requested file', async () => {
    await seedModule(ds);
    const sessionId = await seedSession(ds);
    const repo = makeRepo(qr.manager, sessionId);

    await expect(repo.findModuleById(MODULE_ID, FILE_ID)).resolves.toEqual({
      systemId: MODULE_ID,
      instanceId: 1,
      parentSystemId: undefined,
      definitionSystemId: DEF_ID,
      containerSystemId: CONTAINER_ID,
      subgraphSystemId: SUBGRAPH_ID,
      fileSystemId: FILE_ID,
      alias: 'base-alias',
    });
  });

  it.each([
    ['STAGED', CHANGE_STATUS.Staged],
    ['UNSTAGED', CHANGE_STATUS.Unstaged],
  ])(
    'applies active %s module moves and alias changes',
    async (_label, changeStatus) => {
      // 1. Seed the committed module plus target container/subgraph rows.
      // 2. Use PendingChangeWriter.writeDelta for ENTITY_NAMES.SpfModule with
      //    delta {alias: 'effective-alias', containerSystemId: 301,
      //    subgraphSystemId: 401}; use SOURCE.DiffTool when an explicit
      //    UNSTAGED status is required.
      // 3. Assert findModuleById returns the updated owner IDs and alias while
      //    retaining the committed identity and definition fields.
    },
  );

  it('returns a module created by an earlier active session group', async () => {
    // 1. Seed only the shared container, subgraph, and module definition.
    // 2. Use writer.writeCreate to record Node and SpfModule CREATE actions in
    //    group "create-group" with aggregateId MODULE_ID.
    // 3. Construct the repository with group "delete-group" and assert the
    //    complete SpfModuleBase projection is returned.
  });

  it('returns null after an active module delete and for the same ID in another file', async () => {
    // Assert both cases separately: an active DELETE in this session hides the
    // committed row, and fileSystemId scoping prevents cross-file visibility.
  });
});
```

The tests must exercise both `STAGED` and `UNSTAGED` overlays, FR-DM-05, FR-DM-06, FR-DM-21, and I-DM-07. They must not load ports, CKVs, TKVs, payloads, or module-properties merely to construct `SpfModuleBase`.

- [ ] **Step 2: Run the focused integration test and verify it fails**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="module.repository.integration.spec.ts"`

Expected: FAIL because `TypeOrmModuleRepository.findModuleById` is not implemented.

- [ ] **Step 3: Implement the lightweight effective-state projection**

Add `SpfModuleBase` to the type-only `@arc/core` import in `module.repository.ts`, then add this method beside `findModuleForPatch`:

```typescript
async findModuleById(
  systemId: number,
  fileSystemId: number,
): Promise<SpfModuleBase | null> {
  const sessionId = this.uow.getWriteContext().session.sessionId;
  const moduleNode = await this.moduleNodeFetcher.fetchOne(
    systemId,
    fileSystemId,
    sessionId,
  );

  if (moduleNode === null) return null;

  return {
    systemId: moduleNode.systemId,
    instanceId: moduleNode.instanceId,
    parentSystemId: moduleNode.parentId ?? undefined,
    definitionSystemId: moduleNode.definitionSystemId,
    containerSystemId: moduleNode.containerSystemId,
    subgraphSystemId: moduleNode.subgraphSystemId,
    fileSystemId: moduleNode.fileSystemId,
    alias: moduleNode.alias ?? undefined,
  };
}
```

Keep the existing `findModuleForPatch` behavior unchanged. The adapter returns a core projection and does not expose the fetcher's TypeORM row shape.

- [ ] **Step 4: Run the focused integration test and verify it passes**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="module.repository.integration.spec.ts"`

Expected: PASS for committed, created, moved, deleted, `STAGED`, `UNSTAGED`, and file-scoping scenarios.

- [ ] **Step 5: Build persistence and core to verify the adapter satisfies the port**

Run: `pnpm run build:core && pnpm run build:persistence`

Expected: PASS; `TypeOrmModuleRepository` implements the exact `ModuleRepository.findModuleById(systemId, fileSystemId): Promise<SpfModuleBase | null>` contract with no TypeORM type crossing into `@arc/core`.

### Task 16: Add set-based effective container and subgraph occupancy reads

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/tests/integration/repositories/module/module.repository.integration.spec.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-node-overlay-fetcher.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/module.repository.ts`

- [ ] **Step 1: Write failing occupancy integration tests**

Add one parameterized test matrix for `findModulesByContainerId` and `findModulesBySubgraphId`. The fixture must use at least three module IDs and two owner IDs so filtering errors are observable.

```typescript
describe.each([
  {
    method: 'findModulesByContainerId' as const,
    ownerField: 'containerSystemId' as const,
    originalOwnerId: CONTAINER_ID,
    movedOwnerId: 301,
  },
  {
    method: 'findModulesBySubgraphId' as const,
    ownerField: 'subgraphSystemId' as const,
    originalOwnerId: SUBGRAPH_ID,
    movedOwnerId: 401,
  },
])('$method', ({method, ownerField, originalOwnerId, movedOwnerId}) => {
  it('returns committed modules in deterministic systemId order', async () => {
    // Seed MODULE_ID and MODULE_ID + 1 under originalOwnerId, plus MODULE_ID + 2
    // under movedOwnerId. Expect only the first two SpfModuleBase projections,
    // ordered by systemId ascending.
  });

  it.each([
    ['STAGED', CHANGE_STATUS.Staged],
    ['UNSTAGED', CHANGE_STATUS.Unstaged],
  ])(
    'includes active %s creates and moves and excludes moves and deletes out',
    async (_label, changeStatus) => {
      // 1. Seed one committed module that remains, one moved out, one moved in,
      //    and one deleted module.
      // 2. Record a session-created module under originalOwnerId.
      // 3. Apply the owner-field deltas and delete with the requested status.
      // 4. Expect exactly the remain, move-in, and create IDs in ascending order.
    },
  );

  it('does not return modules from another file with the same owner ID', async () => {
    // Seed the colliding owner and module in a second file and assert exclusion.
  });
});
```

These tests lock FR-DM-14, FR-DM-17, FR-DM-21, and I-DM-07. They must verify the returned objects are `SpfModuleBase` projections and that one repository call retrieves the complete occupancy set.

- [ ] **Step 2: Run the focused integration test and verify it fails**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="module.repository.integration.spec.ts"`

Expected: FAIL because the two occupancy methods and the fetcher's set-based read path do not exist.

- [ ] **Step 3: Extend `ModuleNodeOverlayFetcher` with one set-based effective-file fold**

Refactor the fetcher so `fetchOne` and the new occupancy methods share a private effective-row loader rather than issuing one query per module. Preserve all current projection fields and overlay semantics.

```typescript
export interface ModuleNodeOverlayRow {
  systemId: number;
  instanceId: number;
  parentId: number | null;
  definitionSystemId: number;
  containerSystemId: number;
  subgraphSystemId: number;
  fileSystemId: number;
  alias: string | null;
}

async fetchByContainerId(
  containerSystemId: number,
  fileSystemId: number,
  sessionId: number,
): Promise<ModuleNodeOverlayRow[]> {
  const rows = await this.fetchEffectiveRows(fileSystemId, sessionId);
  return rows
    .filter(row => row.containerSystemId === containerSystemId)
    .sort((left, right) => left.systemId - right.systemId);
}

async fetchBySubgraphId(
  subgraphSystemId: number,
  fileSystemId: number,
  sessionId: number,
): Promise<ModuleNodeOverlayRow[]> {
  const rows = await this.fetchEffectiveRows(fileSystemId, sessionId);
  return rows
    .filter(row => row.subgraphSystemId === subgraphSystemId)
    .sort((left, right) => left.systemId - right.systemId);
}
```

Implement `fetchEffectiveRows(fileSystemId, sessionId)` by preserving the fetcher's existing TypeORM selection and overlay utilities:

1. Select all committed module/node scalar rows for the requested file in one query.
2. Load active `STAGED` and `UNSTAGED` actions for `ENTITY_NAMES.Node` and `ENTITY_NAMES.SpfModule` for the session.
3. Fold CREATE, UPDATE, and DELETE actions in action order so creates and owner moves participate and deletes disappear.
4. Join the effective Node and SpfModule halves by same `systemId`; reject incomplete pairs from the returned projection.
5. Return only the fetcher's persistence-internal scalar row type. Do not import `SpfModuleBase` into the fetcher.

- [ ] **Step 4: Delegate the repository occupancy methods to the fetcher**

Add a private mapper in `module.repository.ts` and use it from all three lightweight reads:

```typescript
private toSpfModuleBase(moduleNode: ModuleNodeOverlayRow): SpfModuleBase {
  return {
    systemId: moduleNode.systemId,
    instanceId: moduleNode.instanceId,
    parentSystemId: moduleNode.parentId ?? undefined,
    definitionSystemId: moduleNode.definitionSystemId,
    containerSystemId: moduleNode.containerSystemId,
    subgraphSystemId: moduleNode.subgraphSystemId,
    fileSystemId: moduleNode.fileSystemId,
    alias: moduleNode.alias ?? undefined,
  };
}

async findModulesByContainerId(
  containerSystemId: number,
  fileSystemId: number,
): Promise<SpfModuleBase[]> {
  const sessionId = this.uow.getWriteContext().session.sessionId;
  const rows = await this.moduleNodeFetcher.fetchByContainerId(
    containerSystemId,
    fileSystemId,
    sessionId,
  );
  return rows.map(row => this.toSpfModuleBase(row));
}

async findModulesBySubgraphId(
  subgraphSystemId: number,
  fileSystemId: number,
): Promise<SpfModuleBase[]> {
  const sessionId = this.uow.getWriteContext().session.sessionId;
  const rows = await this.moduleNodeFetcher.fetchBySubgraphId(
    subgraphSystemId,
    fileSystemId,
    sessionId,
  );
  return rows.map(row => this.toSpfModuleBase(row));
}
```

Export the fetcher's effective scalar row as `ModuleNodeOverlayRow` so the adapter mapper is typed without importing a TypeORM entity schema. Update Task 15's `findModuleById` to call the same mapper.

- [ ] **Step 5: Run the focused tests and bounded-read verification**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="module.repository.integration.spec.ts" && pnpm run build:persistence && rg -n "findModulesByContainerId|findModulesBySubgraphId|fetchByContainerId|fetchBySubgraphId" packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/module.repository.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-node-overlay-fetcher.ts`

Expected: PASS; both occupancy reads include active `STAGED` and `UNSTAGED` creates/moves, exclude effective deletes/moves out, remain file-scoped, and use the shared set-based fold rather than calling `fetchOne` in a loop.

### Task 17: Record delete actions for the effective module aggregate

**Package:** `@arc/persistence`

**Files:**
- Create: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-owned-row-overlay-fetcher.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/module.repository.ts`
- Modify: `packages/infrastructure/persistence/tests/integration/repositories/module/module.repository.integration.spec.ts`

- [ ] **Step 1: Write failing aggregate-deletion integration tests**

Add a `deleteModule` suite with a complete committed module fixture and active-session variants. Because the fixture spans many tables, use the plan-format complex-test skeleton and implement each numbered setup directly in the test file.

```typescript
describe('deleteModule', () => {
  it('records child-first DELETE actions for every effective module-owned row', async () => {
    // 1. Seed Node + SpfModule; DataPort; ControlPort + Intent; CKV +
    //    ckv_parameter_payload + ckv_values; module_tag_id_map + TKV +
    //    tkv_parameter_payload + tkv_values. Give every row a distinct systemId.
    // 2. Start the transaction and call deleteModule(MODULE_ID, FILE_ID).
    // 3. Commit and select active edit_actions for sessionId and groupId.
    // 4. Assert the exact (target_table, target_system_id) set contains every
    //    owned row once and has no duplicates.
    // 5. Assert every row has aggregate_id MODULE_ID, operation DELETE,
    //    change_status STAGED, source MANUAL, and group_id "delete-group".
  });

  it('includes active STAGED and UNSTAGED owned-row creates and skips rows already deleted', async () => {
    // 1. Seed the committed aggregate.
    // 2. In earlier groups, create one DataPort and one CKV payload, one STAGED
    //    and one UNSTAGED, and delete one committed Intent.
    // 3. Run deleteModule in "delete-group".
    // 4. Assert DELETE actions are written for both created rows and not written
    //    again for the already absent Intent.
  });

  it('records a separate delete group for a session-created module', async () => {
    // 1. Record Node, SpfModule, and owned child CREATE actions in "create-group".
    // 2. Call deleteModule from a repository whose WriteContext uses
    //    "delete-group".
    // 3. Assert the CREATE actions remain active in create-group and matching
    //    DELETE actions are active in delete-group, so undoing delete restores
    //    the session-created aggregate as required by FR-DM-06.
  });

  it('preserves shared definitions and never targets module-properties', async () => {
    // Seed module, parameter, tag, key/value, property, and container-type
    // definition rows referenced by the aggregate. After deleteModule, assert
    // no edit_action targets any definition table or SpfModulePropertiesData.
  });

  it('does not delete colliding IDs or owned rows from another file', async () => {
    // Seed a second file with independent module-owned rows and assert that only
    // rows owned by MODULE_ID in FILE_ID receive DELETE actions.
  });
});
```

The expected delete set is exactly: Node; SpfModule; DataPort; ControlPort; Intent; CKV, CKV parameter payload, and CKV value-association rows; module tag mappings; TKV, TKV parameter payload, and TKV value-association rows. Shared definitions and `spf_module_properties_data` are excluded under FR-DM-09, I-DM-01, and I-DM-05.

- [ ] **Step 2: Run the focused integration test and verify it fails**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="module.repository.integration.spec.ts"`

Expected: FAIL because `deleteModule` and effective owned-row discovery are not implemented.

- [ ] **Step 3: Implement persistence-owned effective child enumeration**

Create `module-owned-row-overlay-fetcher.ts` with this public contract and persistence-only result shape:

```typescript
import type {EntityManager} from 'typeorm';
import type {EditActionsQueryService} from '../queries/edit-session/edit-actions-query-service.js';

export interface ModuleOwnedRows {
  readonly nodeSystemIds: readonly number[];
  readonly moduleSystemIds: readonly number[];
  readonly dataPortSystemIds: readonly number[];
  readonly controlPortSystemIds: readonly number[];
  readonly intentSystemIds: readonly number[];
  readonly ckvSystemIds: readonly number[];
  readonly ckvParameterPayloadSystemIds: readonly number[];
  readonly ckvValueSystemIds: readonly number[];
  readonly moduleTagMapSystemIds: readonly number[];
  readonly tkvSystemIds: readonly number[];
  readonly tkvParameterPayloadSystemIds: readonly number[];
  readonly tkvValueSystemIds: readonly number[];
}

export class ModuleOwnedRowOverlayFetcher {
  constructor(
    private readonly manager: EntityManager,
    private readonly editActionsQueryService: EditActionsQueryService,
  ) {}

  async fetch(
    moduleSystemId: number,
    fileSystemId: number,
    sessionId: number,
  ): Promise<ModuleOwnedRows> {
    // 1. Query committed IDs in bounded sets using the real ownership columns:
    //    module/node by systemId + file; ports by nodeSystemId; intents through
    //    the module ControlPorts; CKV children through ckvSystemId; TKV children
    //    through moduleTagIdMapSystemId. Include file predicates wherever the
    //    schema carries fileSystemId and constrain joins through the module.
    // 2. Load active STAGED and UNSTAGED edit actions for the twelve owned table
    //    mappings using EditActionsQueryService, restricted to
    //    aggregateId === moduleSystemId.
    // 3. Fold CREATE and DELETE actions in action order. Include session-created
    //    rows whose payload ownership points to this module aggregate; remove
    //    rows hidden by an active DELETE. UPDATE actions retain identity.
    // 4. Return unique numeric IDs sorted ascending in every collection.
    // 5. Do not query, return, or map SpfModulePropertiesData or any definition
    //    table. Do not return TypeORM rows or edit-action payloads to core.
  }
}
```

This is a complex-fetcher skeleton: implement each numbered operation in the method body. Keep the table-to-owner-column and table-to-`ENTITY_NAMES` mapping private to this persistence file.

- [ ] **Step 4: Implement `deleteModule` with child-first edit-action writes**

Instantiate `ModuleOwnedRowOverlayFetcher` beside the existing fetchers in `TypeOrmModuleRepository`. Implement `deleteModule` using the ambient `WriteContext` and `PendingChangeWriter.writeDelete`:

```typescript
async deleteModule(
  moduleSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void> {
  const {session, groupId} = this.uow.getWriteContext();
  const owned = await this.moduleOwnedRowFetcher.fetch(
    moduleSystemId,
    fileSystemId,
    session.sessionId,
  );

  const deleteSet: ReadonlyArray<{
    targetTable: string;
    targetSystemIds: readonly number[];
  }> = [
    {targetTable: ENTITY_NAMES.CkvParameterPayload, targetSystemIds: owned.ckvParameterPayloadSystemIds},
    {targetTable: ENTITY_NAMES.CkvValues, targetSystemIds: owned.ckvValueSystemIds},
    {targetTable: ENTITY_NAMES.Ckv, targetSystemIds: owned.ckvSystemIds},
    {targetTable: ENTITY_NAMES.TkvParameterPayload, targetSystemIds: owned.tkvParameterPayloadSystemIds},
    {targetTable: ENTITY_NAMES.TkvValues, targetSystemIds: owned.tkvValueSystemIds},
    {targetTable: ENTITY_NAMES.Tkv, targetSystemIds: owned.tkvSystemIds},
    {targetTable: ENTITY_NAMES.ModuleTagIdMap, targetSystemIds: owned.moduleTagMapSystemIds},
    {targetTable: ENTITY_NAMES.Intent, targetSystemIds: owned.intentSystemIds},
    {targetTable: ENTITY_NAMES.DataPort, targetSystemIds: owned.dataPortSystemIds},
    {targetTable: ENTITY_NAMES.ControlPort, targetSystemIds: owned.controlPortSystemIds},
    {targetTable: ENTITY_NAMES.SpfModule, targetSystemIds: owned.moduleSystemIds},
    {targetTable: ENTITY_NAMES.Node, targetSystemIds: owned.nodeSystemIds},
  ];

  for (const {targetTable, targetSystemIds} of deleteSet) {
    for (const targetSystemId of targetSystemIds) {
      await this.writer.writeDelete(
        {
          targetTable,
          targetSystemId,
          aggregateId: moduleSystemId,
          ...options,
        },
        session.sessionId,
        groupId,
        this.manager,
      );
    }
  }
}
```

Use these existing `ENTITY_NAMES` keys and do not introduce raw strings. The nested loops are acceptable for writer calls because the discovery is set-based and each owned row must receive its own edit action and base-version capture. Do not call repositories for shared definitions.

- [ ] **Step 5: Run deletion tests and inspect the persistence boundary**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="module.repository.integration.spec.ts" && pnpm run build:persistence && rg -n "SpfModulePropertiesData|Definition|writeDelete|aggregateId" packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/module.repository.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-owned-row-overlay-fetcher.ts`

Expected: PASS; every effective owned row receives one delete action under `aggregateId = moduleSystemId` and the ambient `groupId`; active prior CREATE groups remain intact; shared definitions and module-properties never appear in the delete mapping.

### Task 18: Validate adapter and UnitOfWork wiring as one transaction-bound repository

**Package:** `@arc/api`, `@arc/persistence`

**Files:**
- Verify: `packages/api/src/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.ts`
- Verify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/index.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/module/module.repository.integration.spec.ts`

- [ ] **Step 1: Add the final transaction-bound integration scenario**

Add one test that performs discovery and deletion through the same transaction-scoped repository instance:

```typescript
it('uses one WriteContext for effective discovery and every delete action', async () => {
  // 1. Seed a committed module and an earlier active module-child CREATE action.
  // 2. Start qr transaction, create the repository with sessionId and
  //    groupId "delete-group", then call findModuleById,
  //    findModulesByContainerId, findModulesBySubgraphId, and deleteModule.
  // 3. Before commit, query through qr.manager and assert every newly written
  //    DELETE row has the same session_id and group_id.
  // 4. Commit; recreate the repository with the same session and assert
  //    findModuleById returns null and both occupancy reads exclude MODULE_ID.
  // 5. Assert the earlier CREATE action remains associated with its original
  //    group, proving the delete is a separate undoable operation.
});
```

This test covers FR-DM-22 through FR-DM-24 without moving transaction ownership into the adapter. Rollback behavior remains the command handler's responsibility; the repository only uses the manager and `WriteContext` supplied by its `UnitOfWork`.

- [ ] **Step 2: Run the focused integration suite and verify the scenario passes**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="module.repository.integration.spec.ts"`

Expected: PASS; effective reads and delete writes observe the same transaction and session context.

- [ ] **Step 3: Verify the existing UnitOfWork wiring needs no new accessor or dependency**

Inspect `TypeOrmUnitOfWork.getModuleRepository()` and retain this construction:

```typescript
getModuleRepository(): ModuleRepository {
  return new TypeOrmModuleRepository(
    this.getPendingChangeWriter(),
    this.queryRunner.manager,
    this,
  );
}
```

No new core port, repository accessor, NestJS provider, or persistence barrel export is required: `TypeOrmModuleRepository` is already exported and receives the transaction-bound manager, writer, and `UnitOfWork`. Keep this constructor signature and keep fetcher construction internal to the adapter.

- [ ] **Step 4: Build both packages to enforce adapter and UoW conformance**

Run: `pnpm run build:persistence && pnpm run build:api`

Expected: PASS; the expanded `ModuleRepository` interface is fully implemented, `TypeOrmUnitOfWork` still returns the concrete adapter, and all imports use ESM `.js` extensions.

- [ ] **Step 5: Run chapter-level validation**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="module.repository.integration.spec.ts" && pnpm run lint && git diff --check -- packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-node-overlay-fetcher.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-owned-row-overlay-fetcher.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/module.repository.ts packages/infrastructure/persistence/tests/integration/repositories/module/module.repository.integration.spec.ts packages/api/src/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.ts docs/module-write/plans/chapters/03-01-module-persistence.md`

Expected: all focused integration tests, builds, and lint pass; `git diff --check` reports no whitespace errors. The diff contains no core, controller, handler, link, container, subgraph, UseCase, subsystem, migration, definition-delete, or module-properties implementation.

### Commit: Module Aggregate Persistence

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-node-overlay-fetcher.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-owned-row-overlay-fetcher.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/module.repository.ts \
        packages/infrastructure/persistence/tests/integration/repositories/module/module.repository.integration.spec.ts \
        docs/module-write/plans/chapters/03-01-module-persistence.md
git commit -m "feat(persistence): implement module aggregate deletion" \
           -m "Add effective module occupancy reads and record delete actions for module-owned rows while preserving shared definitions." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
Only execute after confirmation.
