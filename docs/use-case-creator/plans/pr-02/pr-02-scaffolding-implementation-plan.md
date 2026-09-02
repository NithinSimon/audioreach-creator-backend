# PR-02 Routing Scaffolding Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the landed routing persistence foundation, add the fixed twelve-phase routing scaffold and transaction-owning commands, and publish safe HTTP 501 contracts for automatic, manual, and structural use-case operations.

**Architecture:** Core owns framework-free routing contracts, orchestration, commands, and Zod wire schemas. TypeORM adapters repair overlay and edit-action behavior behind existing UoW ports. NestJS exposes validated Swagger contracts but deliberately does not dispatch the routing commands until later PRs activate their behavior.

**Tech Stack:** TypeScript 5, Node.js ESM/NodeNext, Zod 4, NestJS 11, `nestjs-zod`, TypeORM 0.3, SQLite, Jest 29, Supertest, pnpm workspaces.

**Specification:** `docs/use-case-creator/plans/pr-02/pr-02-scaffolding-design.md`

**Blocking prerequisite:** Handler registration and runtime DI cannot be completed until the subsystem-links work lands an exported `IChainResolver` satisfying `resolveAllChains(uow: UnitOfWork): Promise<Result<void>>`. Tasks 1-10 and 14-16 can proceed first. Before Tasks 11-13, rebase the owning dependency and verify that exact contract. Do not add a duplicate resolver, compatibility adapter, or no-op fallback.

---

### Task 1: Include Session-Created Entities in Filtered Overlay Reads

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/usecase-overlay-fetcher.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/subgraph-overlay-fetcher.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/usecase/use-case.repository.integration.spec.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/subgraph/subgraph.repository.integration.spec.ts`

- [ ] **Step 1: Write failing repository regressions for ID-filtered session CREATEs**

Add tests that stage a `UseCase` or `Subgraph` CREATE whose `newValue` intentionally omits `systemId`, then assert the public repository returns the entity only when its `targetSystemId` is requested.

```typescript
it('returns a session-created usecase from findBySystemIds', async () => {
  const createdId = 9_001;
  await writeCreateAction({
    targetTable: ENTITY_NAMES.UseCase,
    targetSystemId: createdId,
    aggregateId: createdId,
    newValue: {fileSystemId, aliasId: 1, alias: 'session UC', type: null},
  });

  const result = await repository.findBySystemIds(fileSystemId, [createdId]);

  expect(result.map(uc => uc.systemId)).toEqual([createdId]);
});

it('does not return a different session-created usecase', async () => {
  await writeCreateAction({
    targetTable: ENTITY_NAMES.UseCase,
    targetSystemId: 9_002,
    aggregateId: 9_002,
    newValue: {fileSystemId, aliasId: 2, alias: 'other UC', type: null},
  });

  await expect(
    repository.findBySystemIds(fileSystemId, [9_003]),
  ).resolves.toEqual([]);
});
```

Mirror these scenarios through `SubgraphRepository.findByIds`.

- [ ] **Step 2: Run the focused integration tests and verify the missing rows**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/usecase/use-case.repository.integration.spec.ts tests/integration/repositories/subgraph/subgraph.repository.integration.spec.ts
```

Expected: FAIL because the committed-table filter prevents overlay CREATE rows from entering the collection.

- [ ] **Step 3: Filter the effective overlay rather than the committed baseline**

Apply this sequence in both fetchers: use SQL filters only when `sessionId === null`; for overlay reads, load the file baseline, fold all active actions, inject CREATE target IDs through `OverlayMergeImpl`, then apply `matchesEntityFilters` to effective rows.

```typescript
const qb = this.manager
  .getRepository(ENTITY_NAMES.UseCase)
  .createQueryBuilder('uc')
  .where('uc.fileSystemId = :fileSystemId', {fileSystemId});

if (sessionId === null && filters) applyEntityFilters(qb, 'uc', filters);
const baseRows = (await qb.getMany()) as UseCaseBase[];
if (sessionId === null) return baseRows;

const actions = await this.editActionsSvc.getByTable(
  sessionId,
  ENTITY_NAMES.UseCase,
);
const effectiveRows = this.overlay
  .applyToCollection(baseRows, actions)
  .map(result => result.effective);

return filters
  ? effectiveRows.filter(row => matchesEntityFilters(row, filters))
  : effectiveRows;
```

Use the corresponding `Subgraph` entity name, alias, and base type in the subgraph fetcher.

- [ ] **Step 4: Run focused tests and persistence typecheck**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/usecase/use-case.repository.integration.spec.ts tests/integration/repositories/subgraph/subgraph.repository.integration.spec.ts
pnpm --filter @arc/persistence run typecheck
```

Expected: PASS; both repositories include requested session-created rows and exclude non-requested IDs.

---

### Task 2: Hydrate Routing UseCase GKV Data

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/usecase/use-case.repository.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/services/pending-change-writer.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/usecase/use-case.repository.integration.spec.ts`

- [ ] **Step 1: Add failing committed and overlay GKV hydration tests**

Cover committed and overlay `findBySystemIds`/`findAll` reads. Insert category data in one fixture and assert the routing repository intentionally leaves `categories` empty.

```typescript
expect(result[0].keyVector.valueSystemIds).toEqual([
  firstValueDefinitionId,
  secondValueDefinitionId,
]);
expect(result[0].categories).toEqual([]);
```

Add overlay CREATE and DELETE relationship cases so the assertion proves session state is used, not only committed rows. Stage the DELETE through the production `PendingChangeWriter.writeDelete` path, with the GKV relationship identity payload, rather than inserting a synthetic edit-action row directly.

- [ ] **Step 2: Run the use-case repository integration suite and verify empty GKV output**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/usecase/use-case.repository.integration.spec.ts
```

Expected: FAIL because `TypeOrmUsecaseRepository` currently constructs `UsecaseOverlayFetcher` without a GKV fetcher.

- [ ] **Step 3: Preserve GKV relationship identity on delete and inject the routing-required fetcher**

Extend `WriteDeleteSpec` with optional `payload?: Record<string, unknown>` and persist `spec.payload ?? {}` as the DELETE row's `newValue`. This remains backward-compatible for existing deletes, which retain an empty object. When staging a `UsecaseGkvValues` DELETE, provide:

```typescript
payload: {usecaseSystemId, valueDefSystemId},
```

`UsecaseGkvValuesFetcher.fetchMany` must use this identity for DELETE actions, allowing it to remove committed and session-created effective GKV entries. Do not infer relationship identity from a superseded CREATE action because `getByTable` returns only active rows.

Construct one shared edit-action query service and pass `undefined` for categories.

```typescript
const editActionsQueryService = new EditActionsQueryService(manager);
this.ucFetcher = new UsecaseOverlayFetcher(
  manager,
  editActionsQueryService,
  undefined,
  new UsecaseGkvValuesFetcher(manager, editActionsQueryService),
);
```

Do not change `DbQueryServices`; its query-side fetcher continues to include both GKV and categories.

- [ ] **Step 4: Run the focused test and build the package**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/usecase/use-case.repository.integration.spec.ts
pnpm --filter @arc/persistence run build
```

Expected: PASS with committed/created/deleted effective GKV values and no added routing-side category query.

---

### Task 3: Stage UseCase GKV Relationship Actions

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/usecase/use-case.repository.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/usecase/use-case.repository.integration.spec.ts`

- [ ] **Step 1: Replace the old create expectation with a complete relationship-action test**

Create a UC with two GKV values, two SGs, and one SG pair. Query `edit_actions` and assert one base action plus two GKV, two membership, and one pair action, all sharing the ambient group ID.

```typescript
expect(actions).toHaveLength(6);
expect(
  actions.filter(action => action.targetTable === ENTITY_NAMES.UsecaseGkvValues),
).toHaveLength(2);
expect(new Set(actions.map(action => action.groupId))).toEqual(
  new Set([writeContext.groupId]),
);
expect(new Set(actions.map(action => action.targetSystemId)).size).toBe(
  actions.length,
);
expect(
  actions
    .filter(action => action.targetTable === ENTITY_NAMES.UsecaseGkvValues)
    .map(action => action.newValue),
).toEqual(
  expect.arrayContaining([
    {usecaseSystemId: uc.systemId, valueDefSystemId: firstValueDefinitionId},
    {usecaseSystemId: uc.systemId, valueDefSystemId: secondValueDefinitionId},
  ]),
);
```

- [ ] **Step 2: Run the test and verify only base/SG/pair actions exist**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/usecase/use-case.repository.integration.spec.ts
```

Expected: FAIL because `create()` omits `UsecaseGkvValues` actions.

- [ ] **Step 3: Stage one GKV CREATE per value with the ambient group ID**

Add this loop after the base UC action and before SG memberships:

```typescript
for (const valueDefSystemId of uc.keyVector.valueSystemIds) {
  const relationshipSystemId = await this.idGeneration.getNextId(
    uc.fileSystemId,
  );
  await this.writer.writeCreate(
    {
      targetTable: ENTITY_NAMES.UsecaseGkvValues,
      targetSystemId: relationshipSystemId,
      aggregateId: uc.systemId,
      payload: {usecaseSystemId: uc.systemId, valueDefSystemId},
      ...options,
    },
    session.sessionId,
    groupId,
    this.manager,
  );
}
```

Do not add adapter-level empty-GKV validation.

- [ ] **Step 4: Run the focused integration test**

Run the Task 3 Step 2 command again.

Expected: PASS; generated relationship target IDs are distinct and every action uses the same transaction/group.

---

### Task 4: Preserve Active Manual Edit Metadata

**Package:** `@arc/core`, `@arc/persistence`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/repositories/usecase/usecase.repository.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/usecase-overlay-fetcher.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/usecase/use-case.repository.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/usecase/use-case.repository.integration.spec.ts`

- [ ] **Step 1: Add failing metadata and null-preservation scenarios**

Cover MANUAL CREATE and UPDATE, exact `changeId`, exact `referencedComponents`, hydrated `usecase.keyVector`, missing payload, missing effective UC, and exclusion of DELETE/AUTO/superseded/other-session rows.

```typescript
expect(result).toEqual([
  {
    changeId: action.changeId,
    usecase: expect.objectContaining({
      systemId: usecaseSystemId,
      keyVector: {valueSystemIds: [valueDefinitionId]},
    }),
    operation: CHANGE_OPERATION.Create,
    referencedComponents: {
      sgSystemIds: [subgraphSystemId],
      dataLinkSystemIds: [dataLinkSystemId],
      controlLinkSystemIds: [],
    },
  },
]);
```

For malformed rows, assert `usecase: null` or `referencedComponents: null` while retaining the row's `changeId` and operation.

- [ ] **Step 2: Run the focused integration test and verify metadata is lost**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/usecase/use-case.repository.integration.spec.ts
```

Expected: FAIL because the current contract returns `UseCase[]` and inner-joins through committed UC rows.

- [ ] **Step 3: Add the core result contract and implement direct action querying**

Add the complete port type:

```typescript
export interface ActiveManualUsecaseEdit {
  readonly changeId: number;
  readonly usecase: UseCase | null;
  readonly operation:
    | typeof CHANGE_OPERATION.Create
    | typeof CHANGE_OPERATION.Update;
  readonly referencedComponents: ReferencedComponents | null;
}

findWithActiveManualEdits(
  fileSystemId: number,
): Promise<ActiveManualUsecaseEdit[]>;
```

Use `EditActionsQueryService.query` with the current `sessionId`, `ENTITY_NAMES.UseCase`, `SOURCE.Manual`, and CREATE/UPDATE operations. Batch-load effective UCs for unique target IDs, preserve one result per exact action, and parse `referencedComponents` only when all three arrays are present and numeric.

```typescript
const actions = await editActions.query({
  sessionId,
  targetTable: ENTITY_NAMES.UseCase,
  source: SOURCE.Manual,
  operations: [CHANGE_OPERATION.Create, CHANGE_OPERATION.Update],
});
const usecases = await this.ucFetcher.getUsecases(
  fileSystemId,
  sessionId,
  [...new Set(actions.map(action => action.targetSystemId))],
);
```

Map missing UCs and malformed dependency payloads to `null`; never silently discard those actions.

- [ ] **Step 4: Run core build and the focused integration suite**

Run:

```bash
pnpm run build:core
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/usecase/use-case.repository.integration.spec.ts
```

Expected: PASS with the new metadata-rich port contract.

---

### Task 5: Compute MDF Scope from Effective Module Topology

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/subgraph-overlay-fetcher.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/fetchers/module-node-overlay-fetcher.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/subgraph/subgraph.repository.integration.spec.ts`
- Test: `packages/infrastructure/persistence/tests/integration/fetchers/module-node-overlay-fetcher.spec.ts`

- [ ] **Step 1: Add failing effective-topology MDF scenarios**

Test the unchanged rule (exactly two modules, IPC_TX `0x7001184`, IPC_RX `0x7001185`) against session module CREATE, DELETE, Node DELETE, move into an SG, move out of an SG, effective definition change, and a session-created candidate SG.

```typescript
expect(
  (await repository.findIsMdfInScope(fileSystemId, [candidateSgId])).map(
    sg => sg.systemId,
  ),
).toEqual([candidateSgId]);
```

For each inverse edit, expect an empty result. In particular, start from a committed MDF pair, stage a DELETE of one module's corresponding `Node` row while its `SpfModule` row remains committed, and assert the SG is no longer in scope.

- [ ] **Step 2: Run the subgraph and module fetcher integration tests**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/subgraph/subgraph.repository.integration.spec.ts tests/integration/fetchers/module-node-overlay-fetcher.spec.ts
```

Expected: FAIL because current MDF subqueries inspect committed `spf_modules` before applying SG overlay.

- [ ] **Step 3: Fold effective modules before applying the MDF predicate**

Extend the module overlay fetcher with a collection method that:

```typescript
async fetchEffectiveForSubgraphs(
  fileSystemId: number,
  sessionId: number,
  subgraphSystemIds: readonly number[],
): Promise<SpfModuleBase[]> {
  // 1. Load file-wide committed SPF modules so moves into scope are visible.
  // 2. Fold current-session SpfModule CREATE/UPDATE/DELETE actions.
  // 3. Remove modules whose effective Node row is deleted.
  // 4. Filter by effective subgraphSystemId after folding.
  // 5. Return each effective module once, keyed by systemId.
}
```

In `fetchMdfInScope`, resolve effective candidate SGs, batch-load the effective modules and their definitions, group by SG, then retain groups containing exactly one IPC_TX and one IPC_RX and no third module. Do not add an `isMdf` column or migration.

- [ ] **Step 4: Run focused integration tests and typecheck**

Run the Task 5 Step 2 command, then:

```bash
pnpm --filter @arc/persistence run typecheck
```

Expected: PASS for committed and all effective-overlay MDF scenarios.

---

### Task 6: Add Source-Scoped Session Cleanup

**Package:** `@arc/core`, `@arc/persistence`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/repositories/session/session.repository.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/session/typeorm-session.repository.ts`
- Test: `packages/infrastructure/persistence/tests/integration/repositories/session/typeorm-session.repository.spec.ts`

- [ ] **Step 1: Add failing source-scope, history, and rollback tests**

Insert active and superseded AUTO_ROUTING CREATE/UPDATE/DELETE actions across UC base/GKV/SG/pair tables, MANUAL and DIFF_TOOL controls, and another session. Query the `edit_actions` table directly after cleanup so rows with non-null `validUntil` are included; do not use a helper that returns only active actions.

```typescript
const deleted = await repository.deleteEditActionsBySource(
  sessionId,
  SOURCE.AutoRouting,
);

expect(deleted).toBe(currentSessionAutoActionCount);
expect(await loadActions(sessionId, SOURCE.AutoRouting)).toEqual([]);
expect(await loadActions(sessionId, SOURCE.Manual)).toHaveLength(1);
expect(await loadActions(otherSessionId, SOURCE.AutoRouting)).toHaveLength(1);
```

Start a QueryRunner transaction, perform cleanup, roll back, and assert all AUTO rows are restored.
Also assert the committed `use_cases` and relationship tables are unchanged by the cleanup.

- [ ] **Step 2: Run the session repository integration test**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/session/typeorm-session.repository.spec.ts
```

Expected: FAIL because only `wipeUnstagedForSession` exists and it preserves superseded rows.

- [ ] **Step 3: Add the explicit port and TypeORM delete**

Add this core method:

```typescript
deleteEditActionsBySource(
  sessionId: number,
  source: Source,
): Promise<number>;
```

Implement only the approved predicates:

```typescript
const result = await this.manager
  .createQueryBuilder()
  .delete()
  .from(EditActionSchema)
  .where('sessionId = :sessionId', {sessionId})
  .andWhere('source = :source', {source})
  .execute();
return result.affected ?? 0;
```

Do not filter by operation, table, status, or `validUntil`. Keep `wipeUnstagedForSession` unchanged for its existing lifecycle use.

- [ ] **Step 4: Run focused tests and both package builds**

Run:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/session/typeorm-session.repository.spec.ts
pnpm run build:core
pnpm run build:persistence
```

Expected: PASS; no schema or migration changes are produced.

---

### Task 7: Define Routing Inputs, State, Context, and Outcome

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/contracts/routing-input.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/contracts/routing-state.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/contracts/routing-outcome.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/contracts/routing-context.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/contracts/routing-phase.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/auto-usecase-creator/contracts/routing-contracts.spec.ts`

- [ ] **Step 1: Write behavior tests for copied input and deterministic defaults**

Test that the input factory copies nested request arrays, normalizes omitted exclusions to empty readonly arrays, preserves active-SG order, and that `RoutingContext` initializes every owned collection without retaining a UoW.

```typescript
const sourceCases = [[11], [12, 13]];
const input = createManualRoutingInput({
  selectedUsecaseSystemIds: [21],
  activeSubgraphs: [{systemId: 31, valueSystemIds: sourceCases}],
  graphEdits: emptyGraphEdits(),
  manualTopology: emptyManualTopology(),
});
sourceCases[0].push(99);

expect(input.activeSubgraphs[0].valueSystemIds).toEqual([[11], [12, 13]]);
expect(input.excludedSubgraphSystemIds).toEqual([]);
expect(new RoutingContext(input)).toEqual(
  expect.objectContaining({
    mode: ROUTING_MODE.Manual,
    allUcs: [],
    warnings: [],
    response: null,
  }),
);
```

- [ ] **Step 2: Run the new test and verify modules are absent**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/auto-usecase-creator/contracts/routing-contracts.spec.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement complete framework-free contracts**

Define `ROUTING_MODE`, copied `ActiveSubgraphSelection`, `GraphEditSummary`, `ManualTopology`, and the discriminated `AutoRoutingInput | ManualRoutingInput`. Define named state structures for every context field from specification section 5.2; do not use `any` or store repositories/UoW/ORM rows.

```typescript
export interface AutoRoutingInput extends RoutingInputBase {
  readonly mode: typeof ROUTING_MODE.Auto;
  readonly staleUcs: readonly UseCase[];
}

export interface ManualRoutingInput extends RoutingInputBase {
  readonly mode: typeof ROUTING_MODE.Manual;
  readonly manualTopology: ManualTopology;
}

export interface RoutingPhase {
  run(context: RoutingContext, uow: UnitOfWork): Promise<Result<void>>;
}

export interface UsecaseIdentifierWithChangeInfo {
  readonly systemId: number;
  readonly type: UsecaseType;
  readonly keyVector: KeyVectorInput;
  readonly aliasId?: number;
  readonly alias?: string;
  readonly categories: readonly string[];
  readonly changeId: number;
}

export interface RoutingOutcome {
  readonly created: readonly UsecaseIdentifierWithChangeInfo[];
  readonly updated: readonly UsecaseIdentifierWithChangeInfo[];
  readonly markedForDeletion: readonly UsecaseIdentifierWithChangeInfo[];
  readonly issues: readonly Issue[];
  readonly groupId: string;
}
```

The projection above is an application value with numeric IDs and domain types. It is not the existing string-based `UsecaseIdentifierWithChangeInfoDto`; Tasks 14-16 define the wire schemas and future endpoint activation maps between the two.

`RoutingContext` must initialize `allUcs`, all three effective exclusion sets, `markedForDeletion`, `deletionPreservedUcs`, `degradedToDisconnected`, `reconstructionPaths`, `disconnectedTransitions`, `kvResolutions`, `seeds`, `cones`, `dfsPaths`, `combinations`, `ecBridgeCandidates`, `classified`, `orphans`, `warnings`, `stagedChanges`, and nullable `response`.

- [ ] **Step 4: Run the contract tests and core typecheck**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/auto-usecase-creator/contracts/routing-contracts.spec.ts
pnpm --filter @arc/core run typecheck
```

Expected: PASS and no NestJS, TypeORM, or Node.js imports under the feature folder.

---

### Task 8: Add the Twelve Phase Services

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/pre-validation.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/deletion-scope.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/disconnected-transition.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/kv-resolution.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/seed-detection.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/cone-computation.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/dfs-routing.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/combination-expansion.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/classification.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/orphan-validation.service.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/routing-change-stager.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/phases/response-builder.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/auto-usecase-creator/phases/routing-phase-stubs.spec.ts`

- [ ] **Step 1: Write phase ownership and manual-expansion tests**

Assert every phase returns `Result.ok(undefined)`, does not access a mocked repository, and initializes only its owned output. For manual Phase 8, assert ordered Cartesian expansion is real behavior:

```typescript
expect(context.combinations.candidates.map(candidate => candidate.valueSystemIds)).toEqual([
  [11, 21],
  [11, 22],
  [12, 21],
  [12, 22],
]);
```

Assert manual phases 2, 3, 5, 6, and 7 leave their outputs empty, while Phase 8 consumes the filtered ordered input and `manualTopology`.

- [ ] **Step 2: Run the phase test and verify missing classes**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/auto-usecase-creator/phases/routing-phase-stubs.spec.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement explicit phase classes with no persistence behavior**

Use this exact shape for no-op phases, changing only the class name:

```typescript
export class PreValidationService implements RoutingPhase {
  async run(
    _context: RoutingContext,
    _uow: UnitOfWork,
  ): Promise<Result<void>> {
    return Promise.resolve(Result.ok(undefined));
  }
}
```

`CombinationExpansionService` must branch on manual mode, perform deterministic nested expansion in request order, and write `context.combinations`; its auto branch returns the empty default. `ResponseBuilder` must set an empty `RoutingOutcome` with `uow.getWriteContext().groupId`. None of the stubs may allocate IDs, query repositories, or emit edit actions.

- [ ] **Step 4: Run phase tests and core typecheck**

Run the Task 8 Step 2 command, then:

```bash
pnpm --filter @arc/core run typecheck
```

Expected: PASS with manual Phase 8 combinations in deterministic order.

---

### Task 9: Implement the Fixed-Order Routing Engine

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/engine/routing-engine.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/engine/create-routing-engine.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/auto-usecase-creator/engine/routing-engine.spec.ts`

- [ ] **Step 1: Write exact-order, same-context, warning, and failure tests**

Use twelve recording phase objects. Assert exact invocation order, same context and UoW identity, warning continuation, and first-failure short-circuit.

```typescript
expect(calls).toEqual([
  'pre-validation',
  'deletion-scope',
  'disconnected-transition',
  'kv-resolution',
  'seed-detection',
  'cone-computation',
  'dfs-routing',
  'combination-expansion',
  'classification',
  'orphan-validation',
  'routing-change-stager',
  'response-builder',
]);
```

When phase four returns `Result.fail(issue)`, assert phases five through twelve were not called and the same failure is returned.

- [ ] **Step 2: Run the engine test and verify the engine is absent**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/auto-usecase-creator/engine/routing-engine.spec.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement a closed constructor-injected tuple**

```typescript
export class RoutingEngine {
  private readonly phases: readonly RoutingPhase[];

  constructor(
    preValidation: PreValidationService,
    deletionScope: DeletionScopeService,
    disconnectedTransition: DisconnectedTransitionService,
    kvResolution: KvResolutionService,
    seedDetection: SeedDetectionService,
    coneComputation: ConeComputationService,
    dfsRouting: DfsRoutingService,
    combinationExpansion: CombinationExpansionService,
    classification: ClassificationService,
    orphanValidation: OrphanValidationService,
    routingChangeStager: RoutingChangeStager,
    responseBuilder: ResponseBuilder,
  ) {
    this.phases = Object.freeze([
      preValidation,
      deletionScope,
      disconnectedTransition,
      kvResolution,
      seedDetection,
      coneComputation,
      dfsRouting,
      combinationExpansion,
      classification,
      orphanValidation,
      routingChangeStager,
      responseBuilder,
    ]);
  }

  async run(input: RoutingInput, uow: UnitOfWork): Promise<Result<RoutingOutcome>> {
    const context = new RoutingContext(input);
    for (const phase of this.phases) {
      const result = await phase.run(context, uow);
      if (result.kind === RESULT_KIND.Fail) return result;
    }
    return Result.ok(context.response ?? createEmptyRoutingOutcome(
      uow.getWriteContext().groupId,
      context.warnings,
    ));
  }
}
```

`createRoutingEngine()` constructs the twelve concrete services only; it is not another orchestrator and exposes no registration API.

- [ ] **Step 4: Run engine tests and typecheck**

Run the Task 9 Step 2 command, then `pnpm --filter @arc/core run typecheck`.

Expected: PASS; order is fixed and failures short-circuit.

---

### Task 10: Add the Manual Pair-Discovery Contract Scaffold

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/services/manual-pair-discovery.service.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/auto-usecase-creator/services/manual-pair-discovery.service.spec.ts`

- [ ] **Step 1: Write the scaffold handoff test**

Assert the service accepts already filtered ordered SG selections plus explicit data/control exclusions and returns the complete empty topology contract without querying repositories in PR-02.

```typescript
expect(result).toEqual(
  Result.ok({
    pairs: [],
    supportingDataLinkSystemIds: [],
    supportingControlLinkSystemIds: [],
    isolatedSubgraphSystemIds: [31, 32],
  }),
);
```

The isolated list preserves supplied SG order because no links are discovered by the scaffold.

- [ ] **Step 2: Run the focused service test**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/auto-usecase-creator/services/manual-pair-discovery.service.spec.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement the stable PR-07-facing method signature**

```typescript
export class ManualPairDiscoveryService {
  async discover(
    _fileSystemId: number,
    activeSubgraphs: readonly ActiveSubgraphSelection[],
    _excludedDataLinkSystemIds: readonly number[],
    _excludedControlLinkSystemIds: readonly number[],
    _uow: UnitOfWork,
  ): Promise<Result<ManualTopology>> {
    return Promise.resolve(
      Result.ok({
        pairs: [],
        supportingDataLinkSystemIds: [],
        supportingControlLinkSystemIds: [],
        isolatedSubgraphSystemIds: activeSubgraphs.map(sg => sg.systemId),
      }),
    );
  }
}
```

- [ ] **Step 4: Run service tests and core typecheck**

Run the Task 10 Step 2 command, then `pnpm --filter @arc/core run typecheck`.

Expected: PASS with no persistence calls.

---

### Task 11: Verify and Wire the External Chain Resolver Prerequisite

**Package:** `@arc/core`, `@arc/api`

**Files:**
- Modify: `packages/core/src/application/orchestration/cqrs/registries/command-handler-registry.ts`
- Modify: `packages/core/src/application/orchestration/command-bus.ts`
- Modify: `packages/api/src/infrastructure-wrapper/arc-cqrs.module.ts`
- Test: `packages/core/tests/unit/application/orchestration/command-bus-session.spec.ts`

- [ ] **Step 1: Verify the rebased dependency before editing**

Run:

```bash
rg "interface IChainResolver|resolveAllChains" packages
```

Expected: one exported core-facing interface with:

```typescript
export interface IChainResolver {
  resolveAllChains(uow: UnitOfWork): Promise<Result<void>>;
}
```

If the command finds no compatible implementation, stop this task and keep Tasks 12-13 blocked. Do not create a substitute.

- [ ] **Step 2: Add failing CommandBus dependency propagation and command-policy tests**

Construct the bus with a resolver mock and assert the handler factory receives the same instance through `CommandHandlerDependencies`. Exercise both routing commands through the existing session-policy path and assert `DESIGNER`/`DIFF_MERGE` sessions are admitted while a disallowed session mode is rejected before handler creation.

```typescript
expect(factory.create).toHaveBeenCalledWith(
  expect.objectContaining({chainResolver}),
);
```

- [ ] **Step 3: Pass the landed resolver through existing manual DI**

Extend the dependency bag and bus constructor with the exact landed interface:

```typescript
export interface CommandHandlerDependencies {
  readonly uow: UnitOfWork;
  readonly chainResolver: IChainResolver;
  readonly idGeneration: IdGenerationPort;
  readonly naturalIdGeneration: NaturalIdGenerationPort;
  readonly fileSystem: FileSystemPort;
  readonly queryServices: QueryServices;
  readonly workerPool?: WorkerPoolPort;
  readonly logger?: Logger;
  readonly profiler?: ProfilerPort;
}
```

Register/inject the concrete resolver in `ArcCqrsModule` using the runtime token supplied by its owning subsystem-links implementation. Pass that same singleton into `CommandBus`; the resolver must receive the per-command UoW from the handler rather than creating one.

- [ ] **Step 4: Run focused CQRS tests and package builds**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/orchestration/command-bus-session.spec.ts
pnpm run build:core
pnpm run build:api
```

Expected: PASS with one resolver instance propagated through the registry dependency bag.

---

### Task 12: Add Routing Commands and Transaction-Owning Handlers

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/create-usecases/create-usecases.command.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/create-usecases/create-usecases.handler.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/create-manual-usecases/create-manual-usecases.command.ts`
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/create-manual-usecases/create-manual-usecases.handler.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/auto-usecase-creator/create-usecases/create-usecases.handler.spec.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/auto-usecase-creator/create-manual-usecases/create-manual-usecases.handler.spec.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/auto-usecase-creator/create-usecases/create-usecases.command.spec.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/auto-usecase-creator/create-manual-usecases/create-manual-usecases.command.spec.ts`
- Test: `packages/infrastructure/persistence/tests/integration/usecase-designer/auto-usecase-creator/create-usecases.handler.integration.spec.ts`

- [ ] **Step 1: Write handler ordering, failure, cleanup, and transaction tests**

For automatic routing assert:

```typescript
expect(calls).toEqual([
  'startTransaction',
  'resolveAllChains',
  'deleteEditActionsBySource:AUTO_ROUTING',
  'readGraphEdits',
  'readSelectedUsecases',
  'readCommittedUsecasesForStaleUcs',
  'engineRun',
  'applyCachedActions',
  'commit',
]);
```

Assert `readCommittedUsecasesForStaleUcs` calls `UsecaseRepository.findAll(fileSystemId, {readMode: READ_MODE.Committed})`, filters `type === USECASE_TYPE.Disconnected`, and supplies a copied `staleUcs` array independently of `selectedUsecaseSystemIds`. The PR-02 Phase 2 stub must not populate `context.allUcs`; its later implementation owns the committed `allUcs` load. Selected UC reads may use the effective overlay. Test both routing command constructors for deep array copies and their `requiresSession`/allowed-mode static contract. For manual routing assert resolver-before-discovery, SG exclusion filtering with order preservation, explicit link exclusions passed to the injected discovery service, no AUTO cleanup, engine execution, cache flush, and commit. For both handlers assert resolver/engine `FAIL` becomes `DomainRuleViolationException`, rollback precedes rethrow, and later steps are not called. Separately, make the resolver reject/throw and assert rollback occurs before rethrow while cleanup, input reads/discovery, engine execution, and commit are never called.

- [ ] **Step 2: Run the handler tests and verify commands/handlers are absent**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/auto-usecase-creator/create-usecases/create-usecases.handler.spec.ts tests/unit/application/usecase-designer/auto-usecase-creator/create-manual-usecases/create-manual-usecases.handler.spec.ts
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement commands and the complex handler flow**

Both commands extend `BaseCommand`, copy all request arrays, and declare:

```typescript
static override readonly requiresSession = true;
static override readonly allowedModes = [
  SESSION_MODE.Designer,
  SESSION_MODE.DiffMerge,
] as const;
```

Implement each handler with this complete control-flow skeleton:

```typescript
export class CreateUsecasesHandler
  implements CommandHandler<CreateUsecasesCommand, Result<RoutingOutcome>>
{
  constructor(
    private readonly uow: UnitOfWork,
    private readonly chainResolver: IChainResolver,
    private readonly engine: RoutingEngine,
  ) {}

  async handle(command: CreateUsecasesCommand): Promise<Result<RoutingOutcome>> {
    await this.uow.startTransaction();
    try {
      // 1. Resolve all data/control subsystem-link chains with this.uow.
      // 2. Convert resolver FAIL to DomainRuleViolationException.
      // 3. Delete all current-session SOURCE.AutoRouting actions.
      // 4. Read SG/data/control session changes after cleanup.
      // 5. Read selected UCs in the effective overlay. Read all committed UCs,
      //    filter to USECASE_TYPE.Disconnected, and copy them into staleUcs.
      // 6. Construct copied AutoRoutingInput.
      // 7. Run engine.run(input, this.uow).
      // 8. Convert engine FAIL to DomainRuleViolationException.
      // 9. Apply cached actions, commit, and return the successful result.
    } catch (error) {
      if (this.uow.isInTransaction()) await this.uow.rollback();
      throw error;
    }
  }
}
```

The manual handler constructor explicitly receives `ManualPairDiscoveryService` in addition to UoW, resolver, and engine. It uses the same transaction/error sequence but does not clean AUTO actions. It filters excluded SGs before discovery, preserving relative order; passes explicit link exclusions to that injected service; reads graph edits after resolution; and constructs `ManualRoutingInput` with the discovered topology. Neither handler commits a failed result.

Add two real-TypeORM-UoW integration cases with the landed resolver. First, use a fixture whose unresolved subsystem link produces a staged derived-link change. Spy only on `RoutingEngine.run`, execute the handler, and assert the engine input's `graphEdits` contains that change before commit. This proves resolver writes and repository input reads share the same QueryRunner/transaction rather than merely proving mock call order. Second, seed active and superseded current-session AUTO_ROUTING rows, configure the engine to fail, execute the handler, and directly assert rollback restores every pre-existing AUTO row after its cleanup ran.

- [ ] **Step 4: Run handler tests and core typecheck**

Run the Task 12 Step 2 command, then:

```bash
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/usecase-designer/auto-usecase-creator/create-usecases.handler.integration.spec.ts
pnpm --filter @arc/core run typecheck
```

Expected: PASS for success, resolver failure/rejection, engine failure, thrown errors, cleanup distinction, committed stale-UC assembly, command policy/copying, resolver-write visibility, and rollback restoration after AUTO cleanup.

---

### Task 13: Register and Export the Routing Scaffold

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/auto-usecase-creator/index.ts`
- Modify: `packages/core/src/application/orchestration/cqrs/registries/command-handler-registry.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/unit/application/orchestration/cqrs/registries/command-handler-registry.spec.ts`

- [ ] **Step 1: Add failing registry resolution tests**

```typescript
expect(
  registry.getCommandHandlerFactory(new CreateUsecasesCommand(request)),
).toBeDefined();
expect(
  registry.getCommandHandlerFactory(new CreateManualUsecasesCommand(request)),
).toBeDefined();
```

Create each factory with dependencies and assert it returns the correct handler class with the supplied UoW/resolver. The manual handler unit test from Task 12 injects a mocked `ManualPairDiscoveryService` directly and proves the handler uses that exact constructor dependency.

- [ ] **Step 2: Run the registry test**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/orchestration/cqrs/registries/command-handler-registry.spec.ts
```

Expected: FAIL because neither command is registered.

- [ ] **Step 3: Add manual registrations and public exports**

Register factories that construct one `RoutingEngine` through `createRoutingEngine()`, inject `deps.uow` plus `deps.chainResolver` into both handlers, and inject a constructed `ManualPairDiscoveryService` into the manual handler. Export commands, routing contracts, engine, and manual discovery through the feature barrel, then add:

```typescript
export * from './application/usecase-designer/auto-usecase-creator/index.js';
```

Do not introduce reflection or runtime handler discovery.

- [ ] **Step 4: Run registry tests and build core**

Run the Task 13 Step 2 command, then `pnpm run build:core`.

Expected: PASS and both command factories resolve.

---

### Task 14: Finalize Automatic and Manual Create DTO Contracts

**Package:** `@arc/core`, `@arc/api`

**Files:**
- Modify: `packages/core/src/application/usecase-designer/usecase/dto/usecase-dto.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/api/src/presentation/rest/modules/project/dto/create-usecases-request.dto.ts`
- Modify: `packages/api/src/presentation/rest/modules/project/dto/create-manual-usecases-request.dto.ts`
- Modify: `packages/api/src/presentation/rest/modules/project/dto/create-usecases-response.dto.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/usecase/dto/usecase-dto.spec.ts`

- [ ] **Step 1: Add failing Zod contract tests**

Assert required selected IDs/active SGs, deeply nested `string[][]`, optional exclusions, manual parity, response field renames, required empty arrays including `issues`, group ID, strict rejection of unknown properties at every request-object level, and rejection of unsafe, signed, exponent, fractional, or whitespace-padded IDs.

```typescript
expect(
  CreateManualUsecasesRequestDtoSchema.parse({
    selectedUsecaseSystemIds: [],
    activeSubgraphs: [{systemId: '31', valueSystemIds: [['41'], []]}],
  }),
).toEqual({
  selectedUsecaseSystemIds: [],
  activeSubgraphs: [{systemId: '31', valueSystemIds: [['41'], []]}],
});

expect(
  CreateUsecasesRequestDtoSchema.safeParse({
    selectedUsecaseSystemIds: [],
    activeSubgraphs: [{systemId: '31', valueSystemIds: [['41', 42]]}],
  }).success,
).toBe(false);
```

- [ ] **Step 2: Run the DTO test and verify current schema mismatches**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/usecase/dto/usecase-dto.spec.ts
```

Expected: FAIL because request schemas are not core-owned and response schemas still use `deleted`/`added` without `groupId`.

- [ ] **Step 3: Define core Zod schemas and thin API wrappers**

Add a decimal system-ID schema and separate auto/manual request schemas:

```typescript
const SystemIdStringSchema = z
  .string()
  .regex(/^\d+$/, 'System ID must be a decimal integer string')
  .refine(value => Number.isSafeInteger(Number(value)), {
    message: 'System ID must be a safe integer',
  });

export const SubgraphKvSelectionDtoSchema = z.object({
  systemId: SystemIdStringSchema.describe('System ID of the subgraph'),
  valueSystemIds: z
    .array(z.array(SystemIdStringSchema))
    .describe('Ordered SGKV cases; each inner array is one selected value set'),
});
```

Define both request objects separately with identical approved fields. Add a core-owned `IssueDtoSchema` that mirrors every public field of `Issue` (`code`, `message`, `severity`, optional category/entity/impacted-usecases/fix-options). Use it in the wire schemas themselves, not only in Swagger subclasses:

```typescript
export const CreateUsecasesResponseDtoSchema = z.object({
  created: z.array(UsecaseIdentifierWithChangeInfoDtoSchema),
  updated: z.array(UsecaseIdentifierWithChangeInfoDtoSchema),
  markedForDeletion: z.array(UsecaseIdentifierWithChangeInfoDtoSchema),
  issues: z.array(IssueDtoSchema),
  groupId: z.string(),
});

export const CreateManualUsecasesResponseDtoSchema = z.object({
  created: z.array(UsecaseIdentifierWithChangeInfoDtoSchema),
  issues: z.array(IssueDtoSchema),
  groupId: z.string(),
});
```

Arrays remain required even when empty. Keep `ApiIssueItem[]` property decorators only to improve Swagger metadata; they must describe, not replace, the Zod contract. Replace legacy class-validator request classes with `createZodDto` wrappers around the core schemas.

Call `.strict()` on every request object: both top-level create requests, `SubgraphKvSelectionDtoSchema`, `StructuralSubgraphKvSelectionDtoSchema`, the structural request, and the structural path-parameter schema introduced in Task 16. This preserves the existing API-wide `forbidNonWhitelisted` behavior when the hybrid pipe routes a `createZodDto` class to Zod. Add a complete `IssueDtoSchema` test that includes every optional wire field and add a Swagger assertion for its nested optional fields.

- [ ] **Step 4: Run DTO tests and build core/API**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/usecase/dto/usecase-dto.spec.ts
pnpm run build:core
pnpm run build:api
```

Expected: PASS with no `class-validator` imports in the converted routing DTO files.

---

### Task 15: Publish Safe 501 Create-UseCase Endpoints

**Package:** `@arc/api`

**Files:**
- Create: `packages/api/src/presentation/rest/common/pipes/hybrid-validation.pipe.ts`
- Modify: `packages/api/src/main.ts`
- Modify: `packages/api/src/presentation/rest/modules/project/project.controller.ts`
- Modify: `packages/api/tests/e2e/helpers/test-app.factory.ts`
- Test: `packages/api/tests/e2e/project/create-usecases.e2e-spec.ts`

- [ ] **Step 1: Add E2E tests for validation and non-dispatching 501 behavior**

Cover valid auto/manual bodies returning 501, malformed nested IDs returning 400, unsafe/signed/exponent/fractional/whitespace-padded IDs returning 400, unknown request properties returning 400, missing manual selected IDs returning 400, and omitted versus explicit-empty exclusions. Override/mock `CommandBus.execute` and assert it is not called by either stub. Snapshot relevant current-session `edit_actions` before each valid call and assert the rows are identical afterward. Add one request through an existing class-validator DTO and assert its whitelist validation still works; this prevents the Zod integration from silently disabling legacy validation.

```typescript
await request(httpServer)
  .post(`/arc-api/v1/projects/${projectId}/create-usecases`)
  .set('Authorization', `Bearer ${authToken}`)
  .send(validAutoRequest)
  .expect(HttpStatus.NOT_IMPLEMENTED);

expect(commandBus.execute).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused E2E test**

Run:

```bash
pnpm --filter @arc/api run test:e2e -- --runInBand --runTestsByPath tests/e2e/project/create-usecases.e2e-spec.ts
```

Expected: FAIL because the current global class-validator pipe rejects `createZodDto` fields as non-whitelisted before route-level Zod validation can run.

- [ ] **Step 3: Route Zod and class-validator DTOs through one global pipe**

Implement a global bridge because sequential global/method pipes would make the existing whitelist reject Zod DTO properties first:

```typescript
@Injectable()
export class HybridValidationPipe implements PipeTransform {
  private readonly classValidatorPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  private readonly zodPipe = new ZodValidationPipe();

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    return isZodDto(metadata.metatype)
      ? this.zodPipe.transform(value, metadata)
      : this.classValidatorPipe.transform(value, metadata);
  }
}
```

Import `isZodDto` from `nestjs-zod/dto`. Replace the `ValidationPipe` construction in both `main.ts` and both test-app factory functions with `new HybridValidationPipe()`.

- [ ] **Step 4: Keep both methods as explicit safe stubs with final metadata**

Add `@HttpCode(HttpStatus.OK)`, correct operation descriptions, and document 200/400/403/404/422/500/501. Rely on the global hybrid pipe rather than stacking a method-level Zod pipe. Keep method bodies exactly mutator-free:

```typescript
createUsecases(
  @Param('projectId') _projectId: string,
  @Body() _body: CreateUsecasesRequestDto,
): ApiResult<CreateUsecasesResponseDto> {
  throw new NotImplementedException('createUsecases is not implemented yet');
}
```

Do not add `SessionGuard`, call `CommandBus`, resolve chains, or perform AUTO cleanup in PR-02. Repeat the same safety for manual creation.

- [ ] **Step 5: Run the focused E2E test and API build**

Run the Task 15 Step 2 command, then `pnpm run build:api`.

Expected: valid requests return 501; malformed contracts return 400 before the method; existing class-validator DTOs retain their behavior; no command is dispatched; and edit actions remain unchanged.

---

### Task 16: Add the Structural Update Zod Contract and 501 Stub

**Package:** `@arc/core`, `@arc/api`

**Files:**
- Modify: `packages/core/src/application/usecase-designer/usecase/dto/usecase-dto.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/api/src/presentation/rest/modules/usecase/dto/request/update-usecase-structure-params.dto.ts`
- Create: `packages/api/src/presentation/rest/modules/usecase/dto/request/update-usecase-structure-request.dto.ts`
- Create: `packages/api/src/presentation/rest/modules/usecase/dto/response/update-usecase-structure-response.dto.ts`
- Modify: `packages/api/src/presentation/rest/modules/usecase/usecase.controller.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/usecase/dto/usecase-dto.spec.ts`
- Test: `packages/api/tests/e2e/usecase/update-usecase-structure.e2e-spec.ts`

- [ ] **Step 1: Add failing core contract and API stub tests**

Test that structural `valueSystemIds` is a flat `string[]`, `activeSubgraphs` is non-empty, `dataLinkSystemIds` is required but may be empty, request objects reject unknown properties, and the response nests `{usecase, groupId}` without `usecaseType`.

```typescript
const parsed = UpdateUsecaseStructureResponseDtoSchema.parse({
  usecase: {
    systemId: '51',
    keyValuePairs: [],
    changeId: '61',
    subgraphSystemIds: ['71'],
    subgraphPairs: [],
  },
  groupId: 'routing-group',
});
expect(parsed.usecase).not.toHaveProperty('usecaseType');
```

Add E2E cases for valid body -> 501, malformed nested/body shapes -> 400, malformed and unsafe `:usecaseSystemId` values -> 400, and unchanged edit actions after the valid 501 call. Assert neither `CommandBus.execute` nor any persistence mutator runs, and the existing alias PATCH route remains registered independently.

- [ ] **Step 2: Run the core DTO and structural E2E tests**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --runTestsByPath tests/unit/application/usecase-designer/usecase/dto/usecase-dto.spec.ts
pnpm --filter @arc/api run test:e2e -- --runInBand --runTestsByPath tests/e2e/usecase/update-usecase-structure.e2e-spec.ts
```

Expected: FAIL because the schemas, wrappers, and PUT route do not exist.

- [ ] **Step 3: Implement core schemas, wrappers, and the documented stub**

Define dedicated structural schemas:

```typescript
export const StructuralSubgraphKvSelectionDtoSchema = z.object({
  systemId: SystemIdStringSchema,
  valueSystemIds: z.array(SystemIdStringSchema),
});

export const UpdateUsecaseStructureRequestDtoSchema = z.object({
  activeSubgraphs: z.array(StructuralSubgraphKvSelectionDtoSchema).min(1),
  dataLinkSystemIds: z.array(SystemIdStringSchema),
}).strict();

export const UpdateUsecaseStructureParamsDtoSchema = z.object({
  usecaseSystemId: SystemIdStringSchema,
}).strict();

export const UsecaseStructurePairDtoSchema = z.object({
  sourceSubgraphSystemId: SystemIdStringSchema,
  destSubgraphSystemId: SystemIdStringSchema,
});

export const UpdatedUsecaseStructureDtoSchema =
  UsecaseIdentifierWithChangeInfoDtoSchema.omit({usecaseType: true}).extend({
    subgraphSystemIds: z.array(SystemIdStringSchema),
    subgraphPairs: z.array(UsecaseStructurePairDtoSchema),
  });

export const UpdateUsecaseStructureResponseDtoSchema = z.object({
  usecase: UpdatedUsecaseStructureDtoSchema,
  groupId: z.string(),
});
```

Create thin `createZodDto` API wrappers for both body and parameters. Bind the parameter wrapper with `@Param() _params: UpdateUsecaseStructureParamsDto` so the global hybrid pipe validates the path ID before the controller method. Add `@Put(':usecaseSystemId/structure')`, parameter docs, and `ApiDocumentationWithExample` responses for 200/400/403/404/409/422/501. The global hybrid pipe added in Task 15 performs Zod validation. The method body only throws `NotImplementedException`; do not inject `CommandBus` or expose internal `usecaseType`.

- [ ] **Step 4: Run focused tests and package builds**

Run the Task 16 Step 2 commands, then:

```bash
pnpm run build:core
pnpm run build:api
```

Expected: PASS; valid structural requests reach 501 and invalid payloads return 400.

---

### Task 17: Regenerate and Assert the Swagger Contract

**Package:** `@arc/api`

**Files:**
- Modify (generated): `docs/swagger-api.json`
- Test: `packages/api/tests/e2e/project/create-usecases.e2e-spec.ts`
- Test: `packages/api/tests/e2e/usecase/update-usecase-structure.e2e-spec.ts`

- [ ] **Step 1: Add Swagger-document assertions to the focused tests**

Assert the generated/in-memory OpenAPI document contains all three paths, explicit 501 responses, corrected create response names, strict request-object `additionalProperties: false`, structural flat `valueSystemIds`, nested `usecase`, `groupId`, no structural `usecaseType`, and every optional `IssueDtoSchema` field.

```typescript
expect(
  document.paths[
    '/arc-api/v1/projects/{projectId}/usecases/{usecaseSystemId}/structure'
  ]?.put?.responses,
).toHaveProperty('501');
expect(
  (
    document.components?.schemas?.UpdateUsecaseStructureResponseDto as SchemaObject
  )?.properties?.usecase,
).not.toHaveProperty('usecaseType');
```

Resolve the nested `usecase` property's inline schema (or its `$ref`, if generation changes) before asserting its `properties`; do not assume `UpdatedUsecaseStructureDtoSchema` becomes a named OpenAPI component because no DTO class is created for that nested schema.

- [ ] **Step 2: Run API tests before regeneration**

Run:

```bash
pnpm --filter @arc/api run test:e2e -- --runInBand --runTestsByPath tests/e2e/project/create-usecases.e2e-spec.ts tests/e2e/usecase/update-usecase-structure.e2e-spec.ts
```

Expected: FAIL if any DTO is not registered or any response metadata is missing.

- [ ] **Step 3: Generate Swagger from source**

Run:

```bash
pnpm run generate:swagger
```

Expected: `docs/swagger-api.json` is regenerated by `packages/api/src/scripts/generate-swagger.ts`; do not hand-edit it.

- [ ] **Step 4: Re-run tests and inspect contract-only diffs**

Run:

```bash
pnpm --filter @arc/api run test:e2e -- --runInBand --runTestsByPath tests/e2e/project/create-usecases.e2e-spec.ts tests/e2e/usecase/update-usecase-structure.e2e-spec.ts
git diff -- docs/swagger-api.json
git diff --check
```

Expected: PASS. Review the scoped Swagger diff and confirm changes are limited to the intended routing/structural contracts; `git diff --check` verifies whitespace only and is not a substitute for that review.

---

### Task 18: Complete Cross-Package Verification

**Package:** workspace

**Files:**
- Modify: `docs/use-case-creator/plans/pr-progress.md`

- [ ] **Step 1: Preserve the existing documentation worktree before verification updates**

Run:

```bash
git status --short
git diff --cached -- docs/use-case-creator/plans/pr-progress.md
git diff -- docs/use-case-creator/plans/pr-progress.md
```

Expected: identify all pre-existing staged and unstaged progress-document changes. Do not reset, checkout, overwrite, or blanket-stage documentation. If the verified PR-02 progress entry would overlap an existing user-authored hunk, stop and ask for direction; otherwise append only the verified fact after preserving all prior content.

- [ ] **Step 2: Run focused core and persistence suites**

Run:

```bash
pnpm --filter @arc/core run test:unit -- --runInBand --testPathPattern=tests/unit/application/usecase-designer/auto-usecase-creator
pnpm --filter @arc/persistence run test:integration -- --runInBand --runTestsByPath tests/integration/repositories/usecase/use-case.repository.integration.spec.ts tests/integration/repositories/subgraph/subgraph.repository.integration.spec.ts tests/integration/repositories/session/typeorm-session.repository.spec.ts tests/integration/usecase-designer/auto-usecase-creator/create-usecases.handler.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run all workspace builds and tests**

Run:

```bash
pnpm run build
pnpm test -- -- --runInBand
```

Expected: PASS across `@arc/core`, `@arc/persistence`, and `@arc/api`.

- [ ] **Step 4: Run lint and formatting checks**

Run:

```bash
pnpm run lint
pnpm run format:check
git diff --check
```

Expected: PASS with no ESM imports missing `.js`, no framework/Node imports in core, and no whitespace errors.

- [ ] **Step 5: Update progress with verified facts**

Mark PR-02 complete only if the external resolver is landed, both handlers are wired, every check above passes, and all three HTTP methods remain intentional 501 stubs. Otherwise record the exact unresolved resolver dependency and completed task range without claiming PR completion.

```markdown
- **PR 2:** implementation complete; auto/manual activation remains assigned to PR 6/7 and structural activation to PR 11.
```

Use the completion line only when every prerequisite and verification condition is satisfied. Do not stage this file as part of this task; leave staging decisions to the user.
