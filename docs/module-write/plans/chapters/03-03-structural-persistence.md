# Container, Subgraph, and UseCase Persistence Adapters Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement transaction-bound TypeORM adapters for effective container, subgraph, and UseCase structural persistence used by Delete Module.

**Architecture:** Keep the core repository contracts from Chapter 02-01 unchanged and translate them inside persistence into effective-state reads plus `STAGED` edit actions. Container and subgraph adapters enumerate only rows owned by their aggregate, while the UseCase adapter removes relationship rows by persistence-only `system_id`, preserves UseCase roots, and never infers link ownership from `subgraphId`.

**Tech Stack:** TypeScript, TypeORM, SQLite, Jest 29, ts-jest, pnpm

---

### Task 24: Implement effective container deletion and property updates

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/container/container.repository.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/container/container.repository.integration.spec.ts`

- [ ] **Step 1: Add failing integration tests for container-owned delete actions**

Extend the existing real-repository integration suite with these scenarios. Reuse its `seedProjectAndFile`, `seedSession`, `makeRepo`, transaction setup, and `ENTITY_NAMES` imports; add local seed helpers for `container_property_data` and edit actions. The assertions intentionally inspect edit actions rather than committed rows because Delete Module is an edit-time operation:

```typescript
describe('deleteContainer', () => {
  it('records deletes for the root and every effective owned property row', async () => {
    await seedContainer(ds, {
      systemId: CONTAINER_ID,
      fileSystemId: FILE_ID,
    });
    await seedContainerPropertyData(ds, {
      systemId: 501,
      containerSystemId: CONTAINER_ID,
      propertySystemId: 7001,
      payload: Uint8Array.from([1, 0, 0, 0]),
    });
    const sessionId = await seedSession(ds);
    await seedPropertyCreateAction(ds, {
      sessionId,
      aggregateId: CONTAINER_ID,
      targetSystemId: 502,
      containerSystemId: CONTAINER_ID,
      propertySystemId: 7002,
      changeStatus: CHANGE_STATUS.Unstaged,
    });
    await qr.startTransaction();

    await makeRepo(qr, sessionId, 'delete-group').deleteContainer(
      CONTAINER_ID,
      FILE_ID,
    );
    await qr.commitTransaction();

    const deletes = await findDeleteActions(ds, sessionId, 'delete-group');
    expect(deletes.map(row => ({
      aggregateId: row.aggregate_id,
      targetSystemId: row.target_system_id,
      targetTable: row.target_table,
    }))).toEqual(expect.arrayContaining([
      {
        aggregateId: CONTAINER_ID,
        targetSystemId: CONTAINER_ID,
        targetTable: ENTITY_NAMES.Container,
      },
      {
        aggregateId: CONTAINER_ID,
        targetSystemId: 501,
        targetTable: ENTITY_NAMES.ContainerPropertyData,
      },
      {
        aggregateId: CONTAINER_ID,
        targetSystemId: 502,
        targetTable: ENTITY_NAMES.ContainerPropertyData,
      },
    ]));
    expect(deletes).toHaveLength(3);
  });

  it('does not re-delete an effectively deleted property or touch its definition', async () => {
    await seedContainer(ds, {systemId: CONTAINER_ID, fileSystemId: FILE_ID});
    await seedContainerPropertyData(ds, {
      systemId: 501,
      containerSystemId: CONTAINER_ID,
      propertySystemId: 7001,
      payload: Uint8Array.from([1]),
    });
    const sessionId = await seedSession(ds);
    await seedDeleteAction(ds, {
      sessionId,
      aggregateId: CONTAINER_ID,
      targetSystemId: 501,
      targetTable: ENTITY_NAMES.ContainerPropertyData,
      changeStatus: CHANGE_STATUS.Staged,
    });
    await qr.startTransaction();

    await makeRepo(qr, sessionId, 'delete-group').deleteContainer(
      CONTAINER_ID,
      FILE_ID,
    );
    await qr.commitTransaction();

    const groupRows = await findGroupActions(ds, sessionId, 'delete-group');
    expect(groupRows.map(row => row.target_system_id)).toEqual([CONTAINER_ID]);
    expect(groupRows.some(row =>
      row.target_table === ENTITY_NAMES.ContainerPropertyDefinition,
    )).toBe(false);
  });
});
```

These cases cover FR-DM-15, FR-DM-21 through FR-DM-23, I-DM-03, and I-DM-05. The property CREATE with `UNSTAGED` status proves that effective owned-row enumeration is not limited to staged or committed rows.

FR-DM-14 occupancy is supplied by `ModuleRepository.findModulesByContainerId` in the module-adapter chapter. This adapter must not repeat that query: it receives the lifecycle decision from core, then either deletes the container aggregate or records the surviving stack-size property update.

Update the existing test helper so the requested group is supplied by the UnitOfWork write context, not by inventing an `EditOptions` field:

```typescript
function makeUow(sessionId: number, groupId = 'test-group') {
  return {
    getWriteContext: () => ({
      session: {
        sessionId,
        fileSystemId: FILE_ID,
        mode: SESSION_MODE.Designer,
        projectId: '1',
      },
      groupId,
    }),
  } as UnitOfWork;
}
```

- [ ] **Step 2: Run the focused container repository test and verify the missing method**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="container.repository.integration"`

Expected: FAIL because `TypeOrmContainerRepository.deleteContainer` is not implemented; no new delete-action assertions pass accidentally against committed-table deletion.

- [ ] **Step 3: Implement container effective-row resolution and aggregate deletion**

Add `deleteContainer` without changing the Chapter 02-01 port signature. Keep TypeORM row shapes and table mapping private to this adapter. Use the active session from `UnitOfWork.getWriteContext()`, include both `STAGED` and `UNSTAGED` actions when folding effective state, and send every write through the existing `PendingChangeWriter` so base-version capture, source, status, and `groupId` follow the established edit framework:

```typescript
async deleteContainer(
  containerSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void> {
  const {session} = this.uow.getWriteContext();
  if (session.fileSystemId !== fileSystemId) return;

  const effectiveContainer = await this.resolveEffectiveContainer(
    containerSystemId,
    fileSystemId,
    session.sessionId,
  );
  if (effectiveContainer === null) return;

  const properties = await this.resolveEffectiveContainerProperties(
    containerSystemId,
    fileSystemId,
    session.sessionId,
  );

  for (const property of properties) {
    await this.writer.writeDelete({
      targetTable: ENTITY_NAMES.ContainerPropertyData,
      targetSystemId: property.systemId,
      aggregateId: containerSystemId,
      options,
    });
  }

  await this.writer.writeDelete({
    targetTable: ENTITY_NAMES.Container,
    targetSystemId: containerSystemId,
    aggregateId: containerSystemId,
    options,
  });
}
```

Implement the two private resolvers with this exact fold:

```typescript
// 1. Load committed rows scoped by file_system_id and owner system ID.
// 2. Load active edit actions for the current session, target table, and IDs.
// 3. Apply actions in edit-action order for both CHANGE_STATUS.Staged and
//    CHANGE_STATUS.Unstaged: CREATE adds, UPDATE patches, DELETE removes.
// 4. Return persistence-local rows containing systemId and payload fields.
// 5. Never load or emit ContainerPropertyDefinition rows.
```

If the current container overlay helper can provide the same result, extend and reuse it instead of duplicating the fold. Do not add TypeORM projections to `@arc/core`.

- [ ] **Step 4: Add the surviving-container property overlay regression test**

Add this test beside the delete tests. It protects FR-DM-16 and I-DM-08 by ensuring the existing generic property writer updates the effective property row instead of creating a duplicate when that row was created earlier in the session:

```typescript
it('updates an effective UNSTAGED property row under the caller group', async () => {
  await seedContainer(ds, {systemId: CONTAINER_ID, fileSystemId: FILE_ID});
  const sessionId = await seedSession(ds);
  await seedPropertyCreateAction(ds, {
    sessionId,
    aggregateId: CONTAINER_ID,
    targetSystemId: 503,
    containerSystemId: CONTAINER_ID,
    propertySystemId: 7003,
    changeStatus: CHANGE_STATUS.Unstaged,
  });
  await qr.startTransaction();

  await makeRepo(qr, sessionId, 'delete-group').setPropertyValue(
    CONTAINER_ID,
    7003,
    Uint8Array.from([64, 0, 0, 0]),
  );
  await qr.commitTransaction();

  const groupRows = await findGroupActions(ds, sessionId, 'delete-group');
  expect(groupRows).toHaveLength(1);
  expect(groupRows[0]).toMatchObject({
    aggregate_id: CONTAINER_ID,
    target_system_id: 503,
    target_table: ENTITY_NAMES.ContainerPropertyData,
    operation: CHANGE_OPERATION.Update,
    change_status: CHANGE_STATUS.Staged,
  });
});
```

Update the adapter's existing property lookup to use the same effective resolver used by `deleteContainer`. Preserve the current `setPropertyValue(containerSystemId, propertySystemId, value, options?)` signature and persistence-owned property-to-row mapping.

- [ ] **Step 5: Run the container tests and persistence build**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="container.repository.integration" && pnpm --filter @arc/persistence run build`

Expected: PASS; container deletion emits root plus effective owned-property deletes with one aggregate ID and caller group, effective property updates target the existing persistence row, and no definition row is deleted.

### Task 25: Implement effective subgraph reads and owned-row deletion

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/subgraph/subgraph.repository.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/entity-table-names.ts`
- Create: `packages/infrastructure/persistence/tests/integration/repositories/subgraph/subgraph.repository.integration.spec.ts`

- [ ] **Step 1: Write failing integration tests for effective lookup and owned-row deletion**

Create the repository integration suite with the standard database lifecycle from the existing container test. Instantiate `TypeOrmSubgraphRepository` with a real `PendingChangeWriter`, query-runner manager, and UnitOfWork write context. Use a fixture builder that inserts one subgraph root, one property row, one SGKV graph including its value-association rows, one VCPM graph including dependent rows, and unrelated shared definitions. Add these tests:

```typescript
describe('TypeOrmSubgraphRepository', () => {
  it.each([
    CHANGE_STATUS.Staged,
    CHANGE_STATUS.Unstaged,
  ])('returns a %s CREATE overlay and tombstones a %s DELETE overlay', async status => {
    const sessionId = await seedSession(ds);
    await seedSubgraphCreateAction(ds, {
      sessionId,
      subgraphSystemId: SUBGRAPH_ID,
      fileSystemId: FILE_ID,
      changeStatus: status,
    });
    const repo = makeSubgraphRepo(qr, sessionId);

    expect(await repo.getSubgraphById(SUBGRAPH_ID, FILE_ID)).toMatchObject({
      systemId: SUBGRAPH_ID,
      fileSystemId: FILE_ID,
    });

    await seedDeleteAction(ds, {
      sessionId,
      aggregateId: SUBGRAPH_ID,
      targetSystemId: SUBGRAPH_ID,
      targetTable: ENTITY_NAMES.Subgraph,
      changeStatus: status,
    });
    expect(await repo.getSubgraphById(SUBGRAPH_ID, FILE_ID)).toBeNull();
  });

  it('records deletes for the subgraph root and all effective owned rows', async () => {
    await seedCompleteSubgraphAggregate(ds, {
      subgraphSystemId: SUBGRAPH_ID,
      fileSystemId: FILE_ID,
    });
    const sessionId = await seedSession(ds);
    await seedUnstagedOwnedRowCreate(ds, sessionId, SUBGRAPH_ID);
    await qr.startTransaction();

    await makeSubgraphRepo(qr, sessionId, 'delete-group').deleteSubgraph(
      SUBGRAPH_ID,
      FILE_ID,
    );
    await qr.commitTransaction();

    const deletes = await findDeleteActions(ds, sessionId, 'delete-group');
    expect(new Set(deletes.map(row => row.target_table))).toEqual(new Set([
      ENTITY_NAMES.Subgraph,
      ENTITY_NAMES.SubgraphPropertyData,
      ENTITY_NAMES.SubgraphSgkvData,
      ENTITY_NAMES.SubgraphVcpmData,
    ]));
    expect(deletes.every(row => row.aggregate_id === SUBGRAPH_ID)).toBe(true);
  });

  it('preserves definitions and does not delete links sharing subgraphId', async () => {
    await seedCompleteSubgraphAggregate(ds, {
      subgraphSystemId: SUBGRAPH_ID,
      fileSystemId: FILE_ID,
    });
    await seedLinksWhoseMetadataUsesSubgraphId(ds, SUBGRAPH_ID, FILE_ID);
    const sessionId = await seedSession(ds);
    await qr.startTransaction();

    await makeSubgraphRepo(qr, sessionId, 'delete-group').deleteSubgraph(
      SUBGRAPH_ID,
      FILE_ID,
    );
    await qr.commitTransaction();

    const tables = (await findGroupActions(ds, sessionId, 'delete-group'))
      .map(row => row.target_table);
    expect(tables).not.toContain(ENTITY_NAMES.DataLink);
    expect(tables).not.toContain(ENTITY_NAMES.ControlLink);
    expect(tables).not.toContain(ENTITY_NAMES.SubgraphPropertyDefinition);
    expect(tables).not.toContain(ENTITY_NAMES.VcpmModuleDefinition);
  });
});
```

Define `ENTITY_NAMES.SubgraphSgkvData` and `ENTITY_NAMES.SubgraphVcpmData` from the corresponding TypeORM schema `name`, not the SQL `tableName`. Their rows own the persisted SGKV value-association and VCPM dependent payloads in the current schema, so deleting those effective rows covers the complete aggregate data without targeting shared VCPM definition tables.

- [ ] **Step 2: Run the new subgraph repository suite and verify it fails**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="subgraph.repository.integration"`

Expected: FAIL because `deleteSubgraph` and the complete persistence table mapping are absent or incomplete, and because `getSubgraphById` does not yet guarantee both `STAGED` and `UNSTAGED` overlay behavior.

- [ ] **Step 3: Route `getSubgraphById` through the existing overlay fetcher**

Implement the exact Chapter 02-01 signature and preserve the domain return type:

```typescript
async getSubgraphById(
  systemId: number,
  fileSystemId: number,
): Promise<Subgraph | null> {
  const {session} = this.uow.getWriteContext();
  if (session.fileSystemId !== fileSystemId) return null;

  return this.subgraphOverlayFetcher.fetchOne(
    systemId,
    fileSystemId,
    session.sessionId,
  );
}
```

Construct or retain `SubgraphOverlayFetcher` inside the adapter from the same transaction-bound manager and `EditActionsQueryService` used by the writer. Extend the fetcher's active-action filter only if needed so both `CHANGE_STATUS.Staged` and `CHANGE_STATUS.Unstaged` participate. Do not add an `effective` suffix to the method name and do not return TypeORM rows through the core port.

- [ ] **Step 4: Implement ordered subgraph-owned deletion without link discovery**

Add the adapter method with the exact port signature:

```typescript
async deleteSubgraph(
  subgraphSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void> {
  const {session} = this.uow.getWriteContext();
  if (session.fileSystemId !== fileSystemId) return;

  const ownedRows = await this.resolveEffectiveOwnedRows({
    subgraphSystemId,
    fileSystemId,
    sessionId: session.sessionId,
  });

  for (const row of ownedRows.childrenFirst) {
    await this.writer.writeDelete({
      targetTable: row.targetTable,
      targetSystemId: row.systemId,
      aggregateId: subgraphSystemId,
      options,
    });
  }

  if (ownedRows.rootExists) {
    await this.writer.writeDelete({
      targetTable: ENTITY_NAMES.Subgraph,
      targetSystemId: subgraphSystemId,
      aggregateId: subgraphSystemId,
      options,
    });
  }
}
```

Implement `resolveEffectiveOwnedRows` as a persistence-local helper with this ownership and ordering contract:

```typescript
interface EffectiveSubgraphOwnedRows {
  rootExists: boolean;
  childrenFirst: Array<{
    systemId: number;
    targetTable: string;
  }>;
}

// 1. Resolve the effective root through SubgraphOverlayFetcher.
// 2. Fold committed plus active STAGED/UNSTAGED actions for property rows.
// 3. Fold SGKV roots, then their parameter/value-association descendants.
// 4. Fold VCPM roots, then every instance/dependent data row.
// 5. Return descendants before their owning row and the subgraph root last.
// 6. Exclude all definition tables, UseCase relations, DataLinks, and ControlLinks.
```

This satisfies FR-DM-18, FR-DM-21 through FR-DM-23, I-DM-03, and I-DM-05. Link deletion remains exclusively endpoint-driven in the link adapters and application services.

FR-DM-17 occupancy is supplied by `ModuleRepository.findModulesBySubgraphId` in the module-adapter chapter. `TypeOrmSubgraphRepository` is responsible only for the effective subgraph read and the deletion requested after core determines that occupancy is empty.

- [ ] **Step 5: Run focused subgraph and overlay verification**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="subgraph.repository.integration|subgraph-overlay-fetcher" && pnpm --filter @arc/persistence run build`

Expected: PASS; subgraph lookup observes both active statuses, aggregate deletion records one caller group with the subgraph aggregate ID, all effective owned rows are covered, shared definitions survive, and no link action is inferred from `subgraphId`.

### Task 26: Implement UseCase relationship removal by persistence identity

**Package:** `@arc/persistence`

**Files:**
- Create: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/usecase/usecase.repository.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/entity-table-names.ts`
- Create: `packages/infrastructure/persistence/tests/integration/repositories/usecase/usecase.repository.integration.spec.ts`

- [ ] **Step 1: Write failing relationship-removal integration tests**

Create a real-adapter suite using the standard persistence integration database and a transaction-bound `PendingChangeWriter`. Import `UseCaseSchema` for root-preservation assertions. Seed two UseCase roots, membership rows, and pair rows with the persistence-only `system_id` columns introduced in Tasks 1–5. Add this complete behavior matrix:

```typescript
describe('removeSubgraphReferences', () => {
  it('deletes effective memberships and both pair endpoints by relationship systemId', async () => {
    await seedUseCaseGraph(ds, {
      fileSystemId: FILE_ID,
      deletedSubgraphSystemId: SUBGRAPH_ID,
    });
    const sessionId = await seedSession(ds);
    await seedUnstagedRelationshipCreate(ds, {
      sessionId,
      relationshipSystemId: 901,
      useCaseSystemId: USECASE_B_ID,
      subgraphSystemId: SUBGRAPH_ID,
    });
    await qr.startTransaction();

    const result = await makeUseCaseRepo(qr, sessionId, 'delete-group')
      .removeSubgraphReferences(SUBGRAPH_ID, FILE_ID);
    await qr.commitTransaction();

    expect(result).toEqual({
      affectedUseCaseSystemIds: [USECASE_A_ID, USECASE_B_ID],
    });
    const deletes = await findDeleteActions(ds, sessionId, 'delete-group');
    expect(deletes.map(row => ({
      aggregateId: row.aggregate_id,
      targetSystemId: row.target_system_id,
      targetTable: row.target_table,
    }))).toEqual(expect.arrayContaining([
      {
        aggregateId: USECASE_A_ID,
        targetSystemId: MEMBERSHIP_SYSTEM_ID,
        targetTable: ENTITY_NAMES.UseCaseSubgraph,
      },
      {
        aggregateId: USECASE_A_ID,
        targetSystemId: SOURCE_PAIR_SYSTEM_ID,
        targetTable: ENTITY_NAMES.UseCaseSubgraphPair,
      },
      {
        aggregateId: USECASE_B_ID,
        targetSystemId: DEST_PAIR_SYSTEM_ID,
        targetTable: ENTITY_NAMES.UseCaseSubgraphPair,
      },
      {
        aggregateId: USECASE_B_ID,
        targetSystemId: 901,
        targetTable: ENTITY_NAMES.UseCaseSubgraph,
      },
    ]));
  });

  it('excludes already deleted relationships and returns each UseCase once', async () => {
    await seedUseCaseGraph(ds, {
      fileSystemId: FILE_ID,
      deletedSubgraphSystemId: SUBGRAPH_ID,
    });
    const sessionId = await seedSession(ds);
    await seedRelationshipDeleteAction(ds, {
      sessionId,
      relationshipSystemId: MEMBERSHIP_SYSTEM_ID,
      useCaseSystemId: USECASE_A_ID,
      changeStatus: CHANGE_STATUS.Unstaged,
    });
    await qr.startTransaction();

    const result = await makeUseCaseRepo(qr, sessionId, 'delete-group')
      .removeSubgraphReferences(SUBGRAPH_ID, FILE_ID);
    await qr.commitTransaction();

    expect(result.affectedUseCaseSystemIds).toEqual([
      USECASE_A_ID,
      USECASE_B_ID,
    ]);
    const groupRows = await findGroupActions(ds, sessionId, 'delete-group');
    expect(groupRows.some(row =>
      row.target_system_id === MEMBERSHIP_SYSTEM_ID,
    )).toBe(false);
  });

  it('preserves UseCase roots even when all relationships are removed', async () => {
    await seedUseCaseGraph(ds, {
      fileSystemId: FILE_ID,
      deletedSubgraphSystemId: SUBGRAPH_ID,
    });
    const sessionId = await seedSession(ds);
    await qr.startTransaction();

    await makeUseCaseRepo(qr, sessionId, 'delete-group').removeSubgraphReferences(
      SUBGRAPH_ID,
      FILE_ID,
    );
    await qr.commitTransaction();

    const groupRows = await findGroupActions(ds, sessionId, 'delete-group');
    expect(groupRows.some(row => row.target_table === ENTITY_NAMES.UseCase))
      .toBe(false);
    const useCases = await getTestRepository(UseCaseSchema).find({
      order: {systemId: 'ASC'},
    });
    expect(useCases.map(useCase => ({systemId: useCase.systemId}))).toEqual([
      {systemId: USECASE_A_ID},
      {systemId: USECASE_B_ID},
    ]);
  });
});
```

The fixture must include a pair where the deleted subgraph is the source and a different pair where it is the destination. Keep `affectedUseCaseSystemIds` sorted ascending so the adapter result is deterministic before response projection.

- [ ] **Step 2: Run the UseCase repository suite and verify the adapter is absent**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="usecase.repository.integration"`

Expected: FAIL because `TypeOrmUseCaseRepository` and the two relationship target-table mappings do not exist.

- [ ] **Step 3: Add persistence-owned relationship table mappings**

Extend `ENTITY_NAMES` with the TypeORM schema names established in Tasks 1–5:

```typescript
UseCaseSubgraph: 'UseCaseSubgraph',
UseCaseSubgraphPair: 'UseCaseSubgraphPair',
```

These values are persistence implementation details used by `edit_actions.target_table`. Do not add them to `@arc/core`, the `UseCase` domain entity, or any API DTO.

- [ ] **Step 4: Implement the UseCase adapter with effective relationship folding**

Create the adapter with the exact Chapter 02-01 contract and the same constructor dependencies used by the container and subgraph write adapters:

```typescript
export class TypeOrmUseCaseRepository implements UseCaseRepository {
  constructor(
    private readonly writer: PendingChangeWriter,
    private readonly manager: EntityManager,
    private readonly uow: UnitOfWork,
  ) {}

  async removeSubgraphReferences(
    subgraphSystemId: number,
    fileSystemId: number,
    options?: EditOptions,
  ): Promise<{affectedUseCaseSystemIds: number[]}> {
    const {session} = this.uow.getWriteContext();
    if (session.fileSystemId !== fileSystemId) {
      return {affectedUseCaseSystemIds: []};
    }

    const relationships = await this.resolveEffectiveRelationships(
      subgraphSystemId,
      fileSystemId,
      session.sessionId,
    );

    for (const relationship of relationships) {
      await this.writer.writeDelete({
        targetTable: relationship.targetTable,
        targetSystemId: relationship.systemId,
        aggregateId: relationship.useCaseSystemId,
        options,
      });
    }

    return {
      affectedUseCaseSystemIds: [
        ...new Set(relationships.map(row => row.useCaseSystemId)),
      ].sort((a, b) => a - b),
    };
  }
}
```

Implement the persistence-local resolver with this exact contract:

```typescript
interface EffectiveUseCaseRelationshipRow {
  systemId: number;
  useCaseSystemId: number;
  targetTable:
    | typeof ENTITY_NAMES.UseCaseSubgraph
    | typeof ENTITY_NAMES.UseCaseSubgraphPair;
}

// 1. Load committed use_case_subgraphs rows for subgraph_system_id.
// 2. Load committed use_case_subgraph_pairs rows where source OR destination
//    equals subgraphSystemId.
// 3. Overlay active STAGED and UNSTAGED CREATE/UPDATE/DELETE actions by the
//    persistence-only relationship system_id.
// 4. Include a pair when either effective endpoint equals subgraphSystemId.
// 5. Exclude tombstoned rows and de-duplicate by targetTable + systemId.
// 6. Never emit a delete for ENTITY_NAMES.UseCase.
```

This preserves UseCase roots under FR-DM-19, FR-DM-19A, FR-DM-20, FR-DM-21 through FR-DM-23, and I-DM-04. The relationship row's owning UseCase supplies `aggregateId`; the shared request group comes from `options`.

- [ ] **Step 5: Run the UseCase tests and verify core/API isolation**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="usecase.repository.integration|use-case.inserter" && pnpm --filter @arc/persistence run build && rg -n "UseCaseSubgraph|UseCaseSubgraphPair" packages/core/src packages/api/src || true`

Expected: persistence tests and build pass; relationship delete actions use generated relationship IDs, affected UseCases are deduplicated, UseCase roots remain, and the final grep prints no persistence-only relationship type or table mapping from core or API source.

### Task 27: Add the structural effective-state and rollback regression matrix

**Package:** `@arc/persistence`

**Files:**
- Create: `packages/infrastructure/persistence/tests/integration/repositories/structural-persistence.integration.spec.ts`

- [ ] **Step 1: Add a failing cross-adapter effective-state matrix**

Create one focused integration suite using a single query runner and one active Designer session. Instantiate the real container, subgraph, and UseCase adapters with the same `PendingChangeWriter` and write context. Add table-driven tests that run once for `CHANGE_STATUS.Staged` and once for `CHANGE_STATUS.Unstaged`:

```typescript
it.each([
  CHANGE_STATUS.Staged,
  CHANGE_STATUS.Unstaged,
])('folds %s structural creates, patches, moves, and deletes', async status => {
  await seedCommittedStructuralGraph(ds, FILE_ID);
  const sessionId = await seedSession(ds);
  await seedStructuralOverlay(ds, {
    sessionId,
    status,
    containerPropertyCreateId: 801,
    subgraphCreateId: 802,
    relationshipCreateId: 803,
  });
  const repos = makeStructuralRepos(qr, sessionId, 'delete-group');
  await qr.startTransaction();

  await repos.container.setPropertyValue(
    CONTAINER_ID,
    STACK_SIZE_PROPERTY_SYSTEM_ID,
    Uint8Array.from([96, 0, 0, 0]),
  );
  const subgraph = await repos.subgraph.getSubgraphById(
    CREATED_SUBGRAPH_ID,
    FILE_ID,
  );
  const usecases = await repos.usecase.removeSubgraphReferences(
    DELETED_SUBGRAPH_ID,
    FILE_ID,
  );
  await qr.commitTransaction();

  expect(subgraph?.systemId).toBe(CREATED_SUBGRAPH_ID);
  expect(usecases.affectedUseCaseSystemIds).toEqual([
    USECASE_A_ID,
    USECASE_B_ID,
  ]);
  const groupRows = await findGroupActions(ds, sessionId, 'delete-group');
  expect(groupRows.find(row =>
    row.target_table === ENTITY_NAMES.ContainerPropertyData,
  )?.target_system_id).toBe(801);
  expect(groupRows.find(row =>
    row.target_table === ENTITY_NAMES.UseCaseSubgraph,
  )?.target_system_id).toBe(803);
});
```

`seedStructuralOverlay` must include: a created container property followed by a patch, a created subgraph, a deleted committed subgraph, a created UseCase membership, a deleted committed membership, and an unrelated relationship in another file. This directly exercises the structural subset of FR-DM-21 and I-DM-07.

- [ ] **Step 2: Add file-scope and idempotent-effective-delete assertions**

Add this test to the same suite:

```typescript
it('keeps structural reads file-scoped and skips already absent effective rows', async () => {
  await seedSameSystemIdsInTwoFiles(ds, FILE_ID, OTHER_FILE_ID);
  const sessionId = await seedSession(ds);
  await seedActiveStructuralDeletes(ds, {
    sessionId,
    containerSystemId: CONTAINER_ID,
    subgraphSystemId: SUBGRAPH_ID,
    membershipSystemId: MEMBERSHIP_SYSTEM_ID,
  });
  const repos = makeStructuralRepos(qr, sessionId, 'delete-group');
  await qr.startTransaction();

  await repos.container.deleteContainer(CONTAINER_ID, FILE_ID);
  await repos.subgraph.deleteSubgraph(SUBGRAPH_ID, FILE_ID);
  const result = await repos.usecase.removeSubgraphReferences(
    SUBGRAPH_ID,
    FILE_ID,
  );
  await qr.commitTransaction();

  expect(await findGroupActions(ds, sessionId, 'delete-group')).toEqual([]);
  expect(result).toEqual({affectedUseCaseSystemIds: []});
  expect(await findCommittedStructuralRows(ds, OTHER_FILE_ID)).toHaveLength(3);
});
```

The adapters are not public idempotency endpoints, but skipping rows already absent from effective state prevents duplicate delete actions during one transaction and protects file scoping under FR-DM-04 and FR-DM-21.

- [ ] **Step 3: Run the matrix and verify at least one overlay branch fails**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="structural-persistence.integration"`

Expected: FAIL until all three adapters consistently fold `STAGED` and `UNSTAGED` rows, target effective persistence IDs, and enforce `fileSystemId` scope.

- [ ] **Step 4: Add transaction rollback coverage for grouped structural writes**

Add a test that deliberately rolls back after all three adapters have recorded actions. This verifies adapter writes remain bound to the handler-owned query runner required by FR-DM-22 through FR-DM-24:

```typescript
it('rolls back the complete structural edit-action group with the query runner', async () => {
  await seedCommittedStructuralGraph(ds, FILE_ID);
  const sessionId = await seedSession(ds);
  const repos = makeStructuralRepos(qr, sessionId, 'delete-group');
  await qr.startTransaction();

  await repos.container.deleteContainer(CONTAINER_ID, FILE_ID);
  await repos.subgraph.deleteSubgraph(SUBGRAPH_ID, FILE_ID);
  await repos.usecase.removeSubgraphReferences(SUBGRAPH_ID, FILE_ID);
  await qr.rollbackTransaction();

  expect(await findGroupActions(ds, sessionId, 'delete-group')).toEqual([]);
});
```

Do not add transaction control to any repository. The command handler remains responsible for start, commit, and rollback; this test proves the adapters participate in that transaction.

- [ ] **Step 5: Run all structural persistence integration tests**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="container.repository.integration|subgraph.repository.integration|usecase.repository.integration|structural-persistence.integration|subgraph-overlay-fetcher|use-case.inserter"`

Expected: PASS for both change statuses, file scoping, effective tombstones, relationship identity, shared-definition preservation, UseCase preservation, and transaction rollback. No test expects a DataLink or ControlLink delete based only on `subgraphId`.

### Task 28: Wire structural adapters into exports and TypeOrmUnitOfWork

**Package:** `@arc/persistence`, `@arc/api`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/index.ts`
- Modify: `packages/infrastructure/persistence/src/index.ts`
- Modify: `packages/api/src/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.ts`
- Modify: `packages/api/tests/unit/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.spec.ts`

- [ ] **Step 1: Add a failing UnitOfWork adapter-accessor test**

Extend the existing `TypeOrmUnitOfWork` unit suite with an assertion for every structural repository. Follow the suite's current QueryRunner and dependency mocks, and assert concrete adapter types rather than mocking the repository ports:

```typescript
it('returns transaction-bound structural persistence adapters', () => {
  const uow = makeTypeOrmUnitOfWork();

  expect(uow.getContainerRepository()).toBeInstanceOf(
    TypeOrmContainerRepository,
  );
  expect(uow.getSubgraphRepository()).toBeInstanceOf(
    TypeOrmSubgraphRepository,
  );
  expect(uow.getUseCaseRepository()).toBeInstanceOf(
    TypeOrmUseCaseRepository,
  );
});
```

Add a second assertion using the suite's repository-construction spies or captured constructor dependencies to prove all three receive the active QueryRunner manager and the UnitOfWork's shared `PendingChangeWriter`. This is the wiring boundary for FR-DM-22 through FR-DM-24.

- [ ] **Step 2: Run the UnitOfWork test and verify the UseCase accessor fails**

Run: `pnpm --filter @arc/api run test:unit -- --runInBand --testPathPattern="typeorm-unit-of-work"`

Expected: FAIL because `getUseCaseRepository()` is not implemented or `TypeOrmUseCaseRepository` is not exported from `@arc/persistence`.

- [ ] **Step 3: Export the three concrete adapters from persistence**

Add ESM exports to the SQLite persistence barrel, preserving any existing container and subgraph exports and adding the UseCase adapter:

```typescript
export {TypeOrmContainerRepository} from './repositories/container/container.repository.js';
export {TypeOrmSubgraphRepository} from './repositories/subgraph/subgraph.repository.js';
export {TypeOrmUseCaseRepository} from './repositories/usecase/usecase.repository.js';
```

Re-export the same concrete adapters from `packages/infrastructure/persistence/src/index.ts` through its existing SQLite barrel export pattern. Export implementation classes only; do not export TypeORM row interfaces as core-facing contracts.

- [ ] **Step 4: Implement transaction-bound structural accessors in TypeOrmUnitOfWork**

Keep existing container and subgraph accessor behavior, and add the exact core accessor introduced in Task 14:

```typescript
getUseCaseRepository(): UseCaseRepository {
  return new TypeOrmUseCaseRepository(
    this.pendingChangeWriter,
    this.queryRunner.manager,
    this,
  );
}
```

Ensure `getContainerRepository()` and `getSubgraphRepository()` use the same constructor ordering and shared objects:

```typescript
getContainerRepository(): ContainerRepository {
  return new TypeOrmContainerRepository(
    this.pendingChangeWriter,
    this.queryRunner.manager,
    this,
  );
}

getSubgraphRepository(): SubgraphRepository {
  return new TypeOrmSubgraphRepository(
    this.pendingChangeWriter,
    this.queryRunner.manager,
    this,
  );
}
```

Use type-only imports for `ContainerRepository`, `SubgraphRepository`, and `UseCaseRepository` from `@arc/core`, and runtime imports for the concrete adapters from `@arc/persistence`. All source imports must retain `.js` extensions for relative ESM paths.

- [ ] **Step 5: Run chapter validation and inspect scope**

Run: `pnpm --filter @arc/persistence run build && pnpm --filter @arc/api run build && pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="container.repository.integration|subgraph.repository.integration|usecase.repository.integration|structural-persistence.integration|subgraph-overlay-fetcher|use-case.inserter" && pnpm --filter @arc/api run test:unit -- --runInBand --testPathPattern="typeorm-unit-of-work" && pnpm run lint && git diff --check -- packages/infrastructure/persistence packages/api/src/infrastructure-wrapper/persistence/unit-of-work packages/api/tests/unit/infrastructure-wrapper/persistence/unit-of-work docs/module-write/plans/chapters/03-03-structural-persistence.md`

Expected: both packages build; focused persistence and UnitOfWork tests pass; lint and whitespace checks pass. The diff contains structural adapters, persistence-owned mappings, tests, exports, and UnitOfWork wiring only: no core port signature changes, no schema or migration duplication from Tasks 1–5, no UseCase root deletion, and no DataLink/ControlLink deletion inferred from subgraph IDs.

### Commit: Structural Persistence Adapters

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/container/container.repository.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/subgraph/subgraph.repository.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/usecase/usecase.repository.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/entity-table-names.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/index.ts \
        packages/infrastructure/persistence/src/index.ts \
        packages/infrastructure/persistence/tests/integration/repositories/container/container.repository.integration.spec.ts \
        packages/infrastructure/persistence/tests/integration/repositories/subgraph/subgraph.repository.integration.spec.ts \
        packages/infrastructure/persistence/tests/integration/repositories/usecase/usecase.repository.integration.spec.ts \
        packages/infrastructure/persistence/tests/integration/repositories/structural-persistence.integration.spec.ts \
        packages/api/src/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.ts \
        packages/api/tests/unit/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.spec.ts \
        docs/module-write/plans/chapters/03-03-structural-persistence.md
git commit -m "feat(persistence): add structural delete adapters" \
           -m "Implement effective container, subgraph, and UseCase relationship persistence with transaction-bound UnitOfWork wiring." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
Only execute after confirmation.
