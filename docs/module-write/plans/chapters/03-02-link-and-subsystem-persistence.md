### Task 19: Extend link overlay reads for Delete Module discovery

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/link-overlay-fetcher.ts`
- Test: `packages/infrastructure/persistence/tests/integration/fetchers/link-overlay-fetcher.spec.ts`

- [ ] **Step 1: Write failing effective-graph integration tests**

Extend `link-overlay-fetcher.spec.ts` with a `Delete Module effective link graph` suite. Use the existing database setup and edit-action fixture helpers in that file, and cover these concrete scenarios:

```typescript
describe('Delete Module effective link graph', () => {
  it('returns each connected canonical DataLink once with its resolved subsystem segments', async () => {
    // Seed one link addressed directly by the module node, one addressed through
    // a module-owned DataPort, and one unrelated link. Give the connected link
    // two resolved subsystem_data_links rows.
    // Expect only the two connected canonical links, ordered by systemId, and
    // expect each resolved segment attached to its canonical DataLink once.
  });

  it('returns the complete unresolved subsystem DataLink chain reached from the module', async () => {
    // Seed a null-dataLinkSystemId chain module -> subsystem A -> subsystem B,
    // plus a disconnected unresolved chain. Expect only the reached chain.
  });

  it('applies active STAGED and UNSTAGED creates, updates, and deletes before discovery', async () => {
    // Seed committed links, an active STAGED create, an active UNSTAGED create,
    // an active endpoint move, and active deletes. Expect the resulting graph,
    // not the committed rows, to drive module connectivity.
  });

  it('returns the complete effective subsystem-control topology and endpoint node types', async () => {
    // Seed route segments both related and unrelated to the target module.
    // Expect every effective SubsystemControlLink in the file and a node-type
    // map containing every endpoint node required by intent propagation.
  });
});
```

The fixtures must include both `STAGED` and `UNSTAGED` active rows. Add one superseded or expired edit-action row and assert it has no effect. This proves FR-DM-21 rather than only committed-table behavior.

- [ ] **Step 2: Run the focused fetcher tests and verify they fail**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="link-overlay-fetcher.spec.ts"`

Expected: FAIL because the fetcher does not yet expose canonical domain links, unresolved-chain traversal, or complete subsystem-control route context.

- [ ] **Step 3: Add domain-mapped effective link graph operations**

Extend `LinkOverlayFetcher` with these persistence-internal operations. Keep the existing `fetchDataLinks` and `fetchControlLinks` contracts unchanged for port-count validation callers:

```typescript
async fetchDataLinksConnectedToModule(
  moduleSystemId: number,
  fileSystemId: number,
  sessionId: number,
): Promise<DataLink[]>;

async fetchUnresolvedSubsystemDataLinksFromModule(
  moduleSystemId: number,
  fileSystemId: number,
  sessionId: number,
): Promise<SubsystemDataLink[]>;

async fetchControlLinksConnectedToModule(
  moduleSystemId: number,
  fileSystemId: number,
  sessionId: number,
): Promise<ControlLink[]>;

async fetchUnresolvedSubsystemControlLinksFromModule(
  moduleSystemId: number,
  fileSystemId: number,
  sessionId: number,
): Promise<SubsystemControlLink[]>;

async fetchSubsystemControlRouteContext(
  fileSystemId: number,
  sessionId: number,
): Promise<SubsystemControlRouteContext>;
```

Implement the methods with this exact flow:

```typescript
// 1. Load the effective module Node and its effective DataPort/ControlPort IDs.
// 2. Fold committed rows with every active STAGED and UNSTAGED edit action for
//    the relevant table; omit rows whose final effective operation is DELETE.
// 3. Select canonical links when either endpoint node is moduleSystemId or the
//    endpoint port belongs to the module. Deduplicate by canonical systemId.
// 4. Attach effective subsystem segments whose canonical-link foreign key is
//    one of the selected canonical IDs. A segment attached here must not also
//    be returned by an unresolved-chain method.
// 5. For unresolved segments, restrict to a null canonical-link foreign key and
//    traverse the effective segment graph from the module node or its owned
//    ports. Return the complete reached component and exclude disconnected rows.
// 6. For control route context, return every effective subsystem-control
//    segment in the file and a ReadonlyMap for every endpoint node's NodeType.
// 7. Map persistence rows to the existing @arc/core DataLink, ControlLink,
//    SubsystemDataLink, and SubsystemControlLink entities inside persistence.
// 8. Return duplicate-free arrays ordered by numeric systemId ascending.
```

Use TypeORM row interfaces only inside the fetcher. Do not export a row type or delete-specific projection to `@arc/core`. Reuse the existing `EditActionsQueryService` and overlay utilities already owned by persistence rather than parsing edit-action JSON in a repository adapter.

- [ ] **Step 4: Run the focused fetcher tests**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="link-overlay-fetcher.spec.ts"`

Expected: PASS; connected canonical links include resolved segments, unresolved traversal excludes unrelated chains, both active statuses affect results, expired rows are ignored, and route context contains the full effective control topology.

- [ ] **Step 5: Build persistence and verify framework boundaries**

Run: `pnpm --filter @arc/persistence run build && rg -n "fetch(Data|Control)LinksConnectedToModule|fetchUnresolvedSubsystem(Data|Control)LinksFromModule|fetchSubsystemControlRouteContext" packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/link-overlay-fetcher.ts`

Expected: the persistence build passes; all five new methods are present; their public results use existing core domain entities; no TypeORM row interface is exported from the fetcher.

### Task 20: Implement effective DataLink reads and delete edit-actions

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/data-link/data-link.repository.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/data-link/data-link.repository.integration.spec.ts`

- [ ] **Step 1: Write failing DataLink adapter tests**

Extend the existing repository integration test with these cases:

```typescript
describe('Delete Module DataLink persistence', () => {
  it('returns effective connected canonical links with resolved subsystem links', async () => {
    // Assert the adapter returns DataLink domain entities from Task 19 and does
    // not expose TypeORM rows or persistence-only field names.
  });

  it('returns only unresolved subsystem chains reached from the module', async () => {
    // Assert connected null-parent segments are returned once and an unrelated
    // unresolved chain remains absent.
  });

  it('records a canonical DataLink DELETE with self aggregate identity', async () => {
    // Set WriteContext groupId = 'delete-module-group'. Assert target table is
    // DataLink, targetSystemId and aggregateId both equal the canonical link ID,
    // source/status follow EditOptions defaults, and groupId is unchanged.
  });

  it('records deduplicated subsystem DataLink DELETEs with per-segment aggregate identity', async () => {
    // Pass [segmentB, segmentA, segmentB]. Assert two DELETE actions ordered by
    // numeric ID; each targetSystemId and aggregateId equals that segment ID.
  });

  it('does not record deletes for absent, already-deleted, or foreign-file links', async () => {
    // Assert fileSystemId is enforced before PendingChangeWriter is called.
  });
});
```

Also assert that no `DataPort` delete action is produced. Boundary-port retention is invariant I-DM-09, even when the deleted segments were their last references.

- [ ] **Step 2: Run the DataLink repository test and verify it fails**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="data-link.repository.integration.spec.ts"`

Expected: FAIL because `TypeOrmDataLinkRepository` currently implements only `getLinksByPortSystemIds` and records no delete edit-actions.

- [ ] **Step 3: Implement the exact DataLinkRepository port**

Keep the existing method and add the Task 12 port methods with these bodies and ownership rules:

```typescript
async findLinksConnectedToModule(
  moduleSystemId: number,
  fileSystemId: number,
): Promise<DataLink[]> {
  return this.linkFetcher.fetchDataLinksConnectedToModule(
    moduleSystemId,
    fileSystemId,
    this.uow.getWriteContext().session.sessionId,
  );
}

async findUnresolvedSubsystemLinksFromModule(
  moduleSystemId: number,
  fileSystemId: number,
): Promise<SubsystemDataLink[]> {
  return this.linkFetcher.fetchUnresolvedSubsystemDataLinksFromModule(
    moduleSystemId,
    fileSystemId,
    this.uow.getWriteContext().session.sessionId,
  );
}
```

Implement the write methods with the exact Task 12 signatures as a bounded effective-state lookup followed by `PendingChangeWriter.writeDelete`:

```typescript
async deleteDataLink(
  dataLinkSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void> {
  // 1. Resolve the requested canonical row from effective state in fileSystemId.
  // 2. Return without writing when it is absent after overlay.
  // 3. Record one DELETE with targetTable = ENTITY_NAMES.DataLink and
  //    targetSystemId = aggregateId = dataLinkSystemId.
  // 4. Use sessionId and groupId from uow.getWriteContext(), and forward
  //    EditOptions through the established PendingChangeWriter option mapping.
}

async deleteSubsystemDataLinks(
  subsystemLinkSystemIds: number[],
  fileSystemId: number,
  options?: EditOptions,
): Promise<void> {
  // 1. Deduplicate and sort the requested IDs.
  // 2. Intersect them with effective SubsystemDataLink rows in fileSystemId.
  // 3. Record one DELETE per surviving ID with targetTable =
  //    ENTITY_NAMES.SubsystemDataLink and targetSystemId = aggregateId = ID.
  // 4. Reuse the same ambient sessionId and groupId for every action.
}
```

Inject or reuse the transaction-bound `PendingChangeWriter` and `QueryRunner` through the adapter constructor; Task 22 wires the concrete instances. Do not accept table names, aggregate IDs, sessions, or edit-action payloads from core callers.

- [ ] **Step 4: Run the DataLink repository integration test**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="data-link.repository.integration.spec.ts"`

Expected: PASS; effective reads return domain links, all canonical and subsystem deletes have self aggregate identity and the ambient group ID, duplicate IDs do not create duplicate actions, and no boundary DataPort is deleted.

- [ ] **Step 5: Build persistence and inspect the table mapping boundary**

Run: `pnpm --filter @arc/persistence run build && rg -n "ENTITY_NAMES\.(DataLink|SubsystemDataLink)|writeDelete|findLinksConnectedToModule|findUnresolvedSubsystemLinksFromModule" packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/data-link/data-link.repository.ts`

Expected: the build passes; table and aggregate mapping appears only in the persistence adapter; the method signatures exactly match Task 12 and retain ESM `.js` imports.

### Task 21: Implement effective ControlLink route context and delete edit-actions

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/control-link/control-link.repository.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/control-link/control-link.repository.integration.spec.ts`

- [ ] **Step 1: Write failing ControlLink adapter tests**

Extend the repository integration test with this suite:

```typescript
describe('Delete Module ControlLink persistence', () => {
  it('returns effective connected canonical links with resolved subsystem segments', async () => {
    // Include a direct module endpoint, a module-owned ControlPort endpoint,
    // duplicate matches, and an unrelated canonical link.
  });

  it('returns only unresolved subsystem-control chains reached from the module', async () => {
    // Include a multi-segment reached chain and a disconnected null-parent chain.
  });

  it('returns all effective subsystem-control segments and endpoint NodeTypes', async () => {
    // Include topology unrelated to the target module because intent cleanup
    // must detect surviving routes through the complete file graph.
  });

  it('records canonical and subsystem ControlLink DELETE actions with correct identities', async () => {
    // Assert ControlLink and SubsystemControlLink target tables, self aggregate
    // IDs, one ambient groupId, deduplication, and file scoping.
  });

  it('does not delete subsystem ControlPorts or Intents', async () => {
    // Link persistence only records link deletes. Intent ownership remains with
    // SubsystemRepository and boundary ControlPorts remain untouched.
  });
});
```

Use at least one active `UNSTAGED` segment create and one active `STAGED` segment delete in the topology assertion.

- [ ] **Step 2: Run the ControlLink repository test and verify it fails**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="control-link.repository.integration.spec.ts"`

Expected: FAIL because the adapter lacks the Task 12 discovery, route-context, and delete methods.

- [ ] **Step 3: Implement the exact ControlLinkRepository port**

Add the three reads as direct domain-level delegation to Task 19, always using the active session from `WriteContext`:

```typescript
async findLinksConnectedToModule(
  moduleSystemId: number,
  fileSystemId: number,
): Promise<ControlLink[]>;

async findUnresolvedSubsystemLinksFromModule(
  moduleSystemId: number,
  fileSystemId: number,
): Promise<SubsystemControlLink[]>;

async findSubsystemControlRouteContext(
  fileSystemId: number,
): Promise<SubsystemControlRouteContext>;
```

Implement the write operations with the exact Task 12 signatures and this complete persistence contract:

```typescript
async deleteControlLink(
  controlLinkSystemId: number,
  fileSystemId: number,
  options?: EditOptions,
): Promise<void> {
  // 1. Confirm the canonical link exists in effective state for fileSystemId.
  // 2. Record one PendingChangeWriter DELETE targeting ENTITY_NAMES.ControlLink.
  // 3. Set targetSystemId = aggregateId = controlLinkSystemId.
}

async deleteSubsystemControlLinks(
  subsystemLinkSystemIds: number[],
  fileSystemId: number,
  options?: EditOptions,
): Promise<void> {
  // 1. Deduplicate and sort the IDs, then intersect with effective rows in the file.
  // 2. Record one DELETE per row targeting ENTITY_NAMES.SubsystemControlLink.
  // 3. Set targetSystemId = aggregateId = subsystemLinkSystemId for each row.
  // 4. Use the same WriteContext sessionId and groupId for the complete set.
}
```

The adapter must not call `ControlIntentPropagationService` and must not clear Intents. Its sole route-cleanup responsibility is to expose pre-delete effective topology and record explicit link deletes; core decides which subsystem ports require cleanup, and Task 22 persists that separate aggregate operation.

- [ ] **Step 4: Run the ControlLink repository integration test**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="control-link.repository.integration.spec.ts"`

Expected: PASS; route context contains the complete effective segment graph, deletes use correct table and aggregate identities, unrelated topology survives, and no ControlPort or Intent action is written.

- [ ] **Step 5: Build persistence and verify route context remains domain-shaped**

Run: `pnpm --filter @arc/persistence run build && rg -n "SubsystemControlRouteContext|ENTITY_NAMES\.(ControlLink|SubsystemControlLink)|writeDelete|findSubsystemControlRouteContext" packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/control-link/control-link.repository.ts`

Expected: the build passes; the adapter implements every Task 12 signature; TypeORM row interfaces do not appear in exported method results; table mappings remain local to persistence.

### Task 22: Implement subsystem effective reads, intent deletion, and UnitOfWork wiring

**Package:** `@arc/persistence`, `@arc/api`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/subsystem/subsystem.repository.ts`
- Create: `packages/infrastructure/persistence/tests/integration/repositories/subsystem/subsystem.repository.integration.spec.ts`
- Modify: `packages/api/src/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.ts`

- [ ] **Step 1: Write failing subsystem adapter integration tests**

Create `subsystem.repository.integration.spec.ts` with these scenarios:

```typescript
describe('TypeOrmSubsystemRepository Delete Module operations', () => {
  it('detects subsystems from effective STAGED and UNSTAGED state', async () => {
    // Assert a committed subsystem returns true, a staged or unstaged created
    // subsystem returns true, and a subsystem removed by an active delete does
    // not make hasSubsystems return true.
  });

  it('clears effective Intents from the requested surviving subsystem ControlPorts', async () => {
    // Seed two subsystem-owned ControlPorts with Intents and one module-owned
    // ControlPort. Request duplicates plus the module port. Assert only the
    // effective subsystem-owned Intent rows receive DELETE actions.
  });

  it('uses the owning subsystem as aggregateId for every Intent DELETE', async () => {
    // Assert targetTable = Intent, targetSystemId = intent.systemId,
    // aggregateId = the ControlPort owner subsystem systemId, and every row uses
    // the ambient delete-operation groupId.
  });

  it('retains subsystem ControlPorts after their Intents are cleared', async () => {
    // Assert no ControlPort DELETE action exists and effective ports remain.
  });

  it('ignores absent, already-deleted, and foreign-file ports or Intents', async () => {
    // Assert bounded file-scoped reads prevent cross-file edit actions.
  });
});
```

- [ ] **Step 2: Run the subsystem repository test and verify it fails**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="subsystem.repository.integration.spec.ts"`

Expected: FAIL because `hasSubsystems` and `clearControlPortIntents` are not implemented and the current adapter is not write-context aware.

- [ ] **Step 3: Implement the exact SubsystemRepository contracts**

Retain `subsystemExists` and add the Task 13 methods. Update the adapter constructor so it receives the transaction-bound `UnitOfWork`, `PendingChangeWriter`, and `QueryRunner` dependencies used by other write-capable adapters.

```typescript
async hasSubsystems(fileSystemId: number): Promise<boolean> {
  // Fold committed Node rows with active STAGED and UNSTAGED Node edit actions
  // for the current session, then return true when any effective row in this
  // file has NodeType.Subsystem. Do not fall back to committed-only getCount().
}

async clearControlPortIntents(
  controlPortSystemIds: number[],
  fileSystemId: number,
  options?: EditOptions,
): Promise<void> {
  // 1. Deduplicate and sort controlPortSystemIds; return for an empty set.
  // 2. Resolve effective ControlPort rows in fileSystemId and their effective
  //    owning Node rows. Keep only ports owned by NodeType.Subsystem.
  // 3. Load effective Intent rows for those ports as one bounded set.
  // 4. Record one PendingChangeWriter DELETE per Intent with:
  //      targetTable = ENTITY_NAMES.Intent
  //      targetSystemId = intent.systemId
  //      aggregateId = owning subsystem Node systemId
  // 5. Use the ambient sessionId and groupId and forward EditOptions.
  // 6. Do not write a ControlPort DELETE or mutate subsystem boundary topology.
}
```

Keep TypeORM query rows and the Intent-to-subsystem ownership join private to this adapter. The port accepts ControlPort IDs because core already receives `{subsystemSystemId, controlPortSystemId}` pairs from intent topology analysis; persistence revalidates ownership from effective state before recording the deletes.

- [ ] **Step 4: Wire all three write-capable adapters through TypeOrmUnitOfWork**

Update `TypeOrmUnitOfWork` so `getDataLinkRepository()`, `getControlLinkRepository()`, and `getSubsystemRepository()` construct their adapters with the current transaction's `QueryRunner`, the UnitOfWork instance, and the same UoW-scoped `PendingChangeWriter` used by the other aggregate repositories.

```typescript
getDataLinkRepository(): DataLinkRepository {
  return new TypeOrmDataLinkRepository(
    this.queryRunner,
    this,
    this.pendingChangeWriter,
  );
}

getControlLinkRepository(): ControlLinkRepository {
  return new TypeOrmControlLinkRepository(
    this.queryRunner,
    this,
    this.pendingChangeWriter,
  );
}

getSubsystemRepository(): SubsystemRepository {
  return new TypeOrmSubsystemRepository(
    this.queryRunner,
    this,
    this.pendingChangeWriter,
  );
}
```

Reuse the existing UoW-scoped `pendingChangeWriter` field shown above; do not instantiate a second writer or cache per repository accessor. Update the three adapter constructors consistently and derive `EntityManager` from `queryRunner.manager` for fetchers and queries.

- [ ] **Step 5: Run focused tests and the cross-package build**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="(data-link|control-link|subsystem).repository.integration.spec.ts" && pnpm run build`

Expected: all three adapter suites pass; `@arc/core`, `@arc/persistence`, and `@arc/api` compile; `TypeOrmUnitOfWork` satisfies the Task 14 port contract; every adapter uses one transaction-bound writer and query runner.

### Task 23: Prove the link and subsystem delete write path as one effective-state operation

**Package:** `@arc/persistence`, `@arc/api`

**Files:**
- Create: `packages/infrastructure/persistence/tests/integration/repositories/delete-module/link-and-subsystem-persistence.integration.spec.ts`
- Modify: `packages/infrastructure/persistence/tests/integration/fetchers/link-overlay-fetcher.spec.ts`
- Modify: `packages/infrastructure/persistence/tests/integration/repositories/data-link/data-link.repository.integration.spec.ts`
- Modify: `packages/infrastructure/persistence/tests/integration/repositories/control-link/control-link.repository.integration.spec.ts`
- Modify: `packages/infrastructure/persistence/tests/integration/repositories/subsystem/subsystem.repository.integration.spec.ts`

- [ ] **Step 1: Write the cross-adapter transaction test**

Create the integration test with real SQLite schemas, a real `TypeOrmUnitOfWork`, and a fixed WriteContext. Use this scenario matrix:

```typescript
describe('Delete Module link and subsystem persistence operation', () => {
  it('discovers from effective state and records one atomic set of link and intent deletes', async () => {
    // Effective graph:
    // - one committed canonical DataLink with two resolved subsystem segments;
    // - one UNSTAGED-created canonical ControlLink with one resolved segment;
    // - one reached unresolved subsystem data chain;
    // - one reached unresolved subsystem control chain;
    // - one unrelated unresolved chain of each kind;
    // - subsystem ControlPort Intents that become stale and one Intent justified
    //   by an unrelated surviving route.
    //
    // Execute discovery, canonical deletes, complete segment-set deletes, and
    // clearControlPortIntents through repositories obtained from the same UoW.
    // Commit and assert all produced edit actions share the fixed groupId.
  });

  it('preserves aggregate identity across the shared operation group', async () => {
    // Assert canonical and subsystem link rows use their own system IDs as
    // aggregateId, while Intent rows use their owning subsystem system ID.
  });

  it('leaves no effective dangling link while retaining subsystem boundary ports', async () => {
    // Re-read through the effective fetchers after writes. Assert deleted
    // canonical/resolved/unresolved links are absent, unrelated links remain,
    // and every subsystem DataPort and ControlPort remains effective.
  });

  it('rolls back all link and intent edit-actions when the transaction fails', async () => {
    // Throw after at least one canonical delete and one Intent delete, roll back,
    // and assert no row for the fixed groupId remains visible.
  });
});
```

This test is the persistence proof for FR-DM-10 through FR-DM-13, FR-DM-21 through FR-DM-24, and invariants I-DM-02/I-DM-09. It does not instantiate the future Delete Module handler or application services.

- [ ] **Step 2: Run the new write-path test**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="link-and-subsystem-persistence.integration.spec.ts"`

Expected: PASS after Tasks 19-22; a failure must identify a cross-adapter mismatch in effective discovery, UoW wiring, group identity, aggregate identity, or rollback behavior before application services consume these ports.

- [ ] **Step 3: Verify the exact identity and rollback assertions without bypassing adapters**

Build the fixture exclusively through the existing test database helpers and repository/UoW APIs. Query `edit_actions` only for assertions. The final assertions must verify:

```typescript
expect(new Set(actions.map(action => action.groupId))).toEqual(
  new Set(['delete-module-group']),
);

expect(
  dataLinkDeletes.every(
    action => action.aggregateId === action.targetSystemId,
  ),
).toBe(true);
expect(
  controlLinkDeletes.every(
    action => action.aggregateId === action.targetSystemId,
  ),
).toBe(true);
expect(
  subsystemLinkDeletes.every(
    action => action.aggregateId === action.targetSystemId,
  ),
).toBe(true);
expect(
  intentDeletes.every(
    action =>
      subsystemIdByIntentId.get(action.targetSystemId) === action.aggregateId,
  ),
).toBe(true);
```

Also assert exact target-table counts, duplicate-free target IDs, unrelated chain survival, stale-only Intent deletion, and zero `DataPort`/`ControlPort` delete actions.

- [ ] **Step 4: Run all chapter integration tests**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="(link-overlay-fetcher|data-link.repository|control-link.repository|subsystem.repository|link-and-subsystem-persistence).*(spec|integration.spec).ts"`

Expected: PASS; committed plus active STAGED/UNSTAGED state drives discovery, canonical and unresolved chains are deleted exactly once, route context supports stale-only Intent cleanup, and subsystem boundary ports remain.

- [ ] **Step 5: Run final chapter validation**

Run: `pnpm run build && pnpm run lint && git diff --check -- packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/link-overlay-fetcher.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/data-link/data-link.repository.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/control-link/control-link.repository.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/subsystem/subsystem.repository.ts packages/api/src/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.ts packages/infrastructure/persistence/tests/integration/fetchers/link-overlay-fetcher.spec.ts packages/infrastructure/persistence/tests/integration/repositories/data-link/data-link.repository.integration.spec.ts packages/infrastructure/persistence/tests/integration/repositories/control-link/control-link.repository.integration.spec.ts packages/infrastructure/persistence/tests/integration/repositories/subsystem/subsystem.repository.integration.spec.ts packages/infrastructure/persistence/tests/integration/repositories/delete-module/link-and-subsystem-persistence.integration.spec.ts docs/module-write/plans/chapters/03-02-link-and-subsystem-persistence.md`

Expected: build and lint pass across the workspace; all chapter files have no whitespace errors; core remains free of TypeORM shapes; no subsystem boundary-port deletion, controller, command, handler, structural aggregate, UseCase, or migration work is included in this chapter.

### Commit: Link and Subsystem Persistence

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/link-overlay-fetcher.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/data-link/data-link.repository.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/control-link/control-link.repository.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/subsystem/subsystem.repository.ts \
        packages/api/src/infrastructure-wrapper/persistence/unit-of-work/typeorm-unit-of-work.ts \
        packages/infrastructure/persistence/tests/integration/fetchers/link-overlay-fetcher.spec.ts \
        packages/infrastructure/persistence/tests/integration/repositories/data-link/data-link.repository.integration.spec.ts \
        packages/infrastructure/persistence/tests/integration/repositories/control-link/control-link.repository.integration.spec.ts \
        packages/infrastructure/persistence/tests/integration/repositories/subsystem/subsystem.repository.integration.spec.ts \
        packages/infrastructure/persistence/tests/integration/repositories/delete-module/link-and-subsystem-persistence.integration.spec.ts \
        docs/module-write/plans/chapters/03-02-link-and-subsystem-persistence.md
git commit -m "feat(persistence): add Delete Module link adapters" \
           -m "Add effective link discovery, canonical and subsystem delete actions, routed-control intent cleanup persistence, and transaction-bound UnitOfWork wiring." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
Only execute after confirmation.
