### Task 1: Specify generated UseCase relationship identity

**Package:** `@arc/persistence`

**Files:**
- Test: `packages/infrastructure/persistence/tests/integration/bulk-import/use-case.inserter.spec.ts`

- [ ] **Step 1: Add a failing membership-identity integration test**

Add this test beside the existing `use_case_subgraphs` insertion tests. It uses the current real `UseCaseInserter` and database fixture, and verifies FR-DM-19A without adding persistence identity to the core `UseCase` object:

```typescript
it('generates a distinct persistence identity for each usecase-subgraph row', async () => {
  const uc = buildUseCase(1001, {
    subgraphSystemIds: [SG1_ID, SG2_ID],
  });

  const result = await inserter.insert([uc]);

  expect(result.ok).toBe(true);
  const rows = await dataSource.query(
    `SELECT system_id, usecase_system_id, subgraph_system_id
     FROM use_case_subgraphs
     WHERE usecase_system_id = ?
     ORDER BY subgraph_system_id`,
    [uc.systemId],
  );
  expect(rows).toEqual([
    {
      system_id: expect.any(Number),
      usecase_system_id: uc.systemId,
      subgraph_system_id: SG1_ID,
    },
    {
      system_id: expect.any(Number),
      usecase_system_id: uc.systemId,
      subgraph_system_id: SG2_ID,
    },
  ]);
  expect(rows[0].system_id).not.toBe(rows[1].system_id);
  expect(uc.subgraphSystemIds).toEqual([SG1_ID, SG2_ID]);
});
```

- [ ] **Step 2: Add a failing subgraph-pair identity integration test**

Add this test beside the existing pair insertion tests:

```typescript
it('generates a distinct persistence identity for each usecase-subgraph-pair row', async () => {
  const uc = buildUseCase(1001, {
    subgraphSystemIds: [SG1_ID, SG2_ID, SG3_ID],
    subgraphPairs: [
      {sourceSubgraphSystemId: SG1_ID, destSubgraphSystemId: SG2_ID},
      {sourceSubgraphSystemId: SG2_ID, destSubgraphSystemId: SG3_ID},
    ],
  });

  const result = await inserter.insert([uc]);

  expect(result.ok).toBe(true);
  const rows = await dataSource.query(
    `SELECT system_id, usecase_system_id,
            source_subgraph_system_id, dest_subgraph_system_id
     FROM use_case_subgraph_pairs
     WHERE usecase_system_id = ?
     ORDER BY source_subgraph_system_id`,
    [uc.systemId],
  );
  expect(rows).toEqual([
    {
      system_id: expect.any(Number),
      usecase_system_id: uc.systemId,
      source_subgraph_system_id: SG1_ID,
      dest_subgraph_system_id: SG2_ID,
    },
    {
      system_id: expect.any(Number),
      usecase_system_id: uc.systemId,
      source_subgraph_system_id: SG2_ID,
      dest_subgraph_system_id: SG3_ID,
    },
  ]);
  expect(rows[0].system_id).not.toBe(rows[1].system_id);
  expect(uc.subgraphPairs).toEqual([
    {sourceSubgraphSystemId: SG1_ID, destSubgraphSystemId: SG2_ID},
    {sourceSubgraphSystemId: SG2_ID, destSubgraphSystemId: SG3_ID},
  ]);
});
```

- [ ] **Step 3: Add natural-key uniqueness regression tests**

Add both tests so replacing the composite primary keys cannot accidentally permit duplicate relationships:

```typescript
it('rejects duplicate usecase-subgraph natural relationships', async () => {
  await inserter.insert([
    buildUseCase(1001, {subgraphSystemIds: [SG1_ID]}),
  ]);

  await expect(
    manager.insert('UseCaseSubgraph', {
      systemId: 9001,
      usecaseSystemId: 1001,
      subgraphSystemId: SG1_ID,
    }),
  ).rejects.toThrow();
});

it('rejects duplicate usecase-subgraph-pair natural relationships', async () => {
  await inserter.insert([
    buildUseCase(1001, {
      subgraphSystemIds: [SG1_ID, SG2_ID],
      subgraphPairs: [
        {sourceSubgraphSystemId: SG1_ID, destSubgraphSystemId: SG2_ID},
      ],
    }),
  ]);

  await expect(
    manager.insert('UseCaseSubgraphPair', {
      systemId: 9002,
      usecaseSystemId: 1001,
      sourceSubgraphSystemId: SG1_ID,
      destSubgraphSystemId: SG2_ID,
    }),
  ).rejects.toThrow();
});
```

- [ ] **Step 4: Add an edit-address lookup assertion**

Extend the membership identity test after the distinct-ID assertions. This proves later delete-action code can resolve one relationship by `targetSystemId` without exposing the identity through the core model:

```typescript
const addressedRows = await dataSource.query(
  `SELECT usecase_system_id, subgraph_system_id
   FROM use_case_subgraphs
   WHERE system_id = ?`,
  [rows[0].system_id],
);
expect(addressedRows).toEqual([
  {
    usecase_system_id: uc.systemId,
    subgraph_system_id: SG1_ID,
  },
]);
```

- [ ] **Step 5: Run the focused test and confirm the prerequisite is absent**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="use-case.inserter"`

Expected: FAIL because SQLite reports that `system_id` does not exist on `use_case_subgraphs` or `use_case_subgraph_pairs`. The existing insertion, sharing, and failure-isolation tests remain unchanged.

### Task 2: Give both relationship schemas persistence-only primary identity

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/use-case-subgraph.schema.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/use-case-subgraph-pair.schema.ts`
- Test: `packages/infrastructure/persistence/tests/integration/bulk-import/use-case.inserter.spec.ts`

- [ ] **Step 1: Replace the membership schema with a generated-ID primary key and natural unique index**

Use this complete schema. `systemId` is persistence-only; the relationship columns remain unique together and retain their existing foreign keys and lookup index:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {EntitySchema} from 'typeorm';
import type {UseCaseRow} from './use-case.js';
import type {SubgraphRow} from './subgraph/subgraph.schema.js';

export interface UseCaseSubgraphRow {
  systemId: number;
  usecaseSystemId: number;
  subgraphSystemId: number;

  useCase?: UseCaseRow;
  subgraph?: SubgraphRow;
}

export const UseCaseSubgraphSchema = new EntitySchema<UseCaseSubgraphRow>({
  name: 'UseCaseSubgraph',
  tableName: 'use_case_subgraphs',
  columns: {
    systemId: {
      name: 'system_id',
      type: 'integer',
      primary: true,
    },
    usecaseSystemId: {
      name: 'usecase_system_id',
      type: 'integer',
    },
    subgraphSystemId: {
      name: 'subgraph_system_id',
      type: 'integer',
    },
  },
  relations: {
    useCase: {
      type: 'many-to-one',
      target: 'UseCase',
      joinColumn: {name: 'usecase_system_id', referencedColumnName: 'systemId'},
      onDelete: 'CASCADE',
    },
    subgraph: {
      type: 'many-to-one',
      target: 'Subgraph',
      joinColumn: {
        name: 'subgraph_system_id',
        referencedColumnName: 'systemId',
      },
      onDelete: 'CASCADE',
    },
  },
  indices: [
    {
      name: 'uq_use_case_subgraphs_relationship',
      columns: ['usecaseSystemId', 'subgraphSystemId'],
      unique: true,
    },
    {
      name: 'idx_use_case_subgraphs_subgraph',
      columns: ['subgraphSystemId'],
    },
  ],
});
```

- [ ] **Step 2: Replace the pair schema with a generated-ID primary key and natural unique index**

Use this complete schema, retaining the existing source/destination relations and lookup indices:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {EntitySchema} from 'typeorm';
import type {UseCaseRow} from './use-case.js';
import type {SubgraphRow} from './subgraph/subgraph.schema.js';

export interface UseCaseSubgraphPairRow {
  systemId: number;
  usecaseSystemId: number;
  sourceSubgraphSystemId: number;
  destSubgraphSystemId: number;

  useCase?: UseCaseRow;
  sourceSubgraph?: SubgraphRow;
  destSubgraph?: SubgraphRow;
}

export const UseCaseSubgraphPairSchema =
  new EntitySchema<UseCaseSubgraphPairRow>({
    name: 'UseCaseSubgraphPair',
    tableName: 'use_case_subgraph_pairs',
    columns: {
      systemId: {
        name: 'system_id',
        type: 'integer',
        primary: true,
      },
      usecaseSystemId: {
        name: 'usecase_system_id',
        type: 'integer',
      },
      sourceSubgraphSystemId: {
        name: 'source_subgraph_system_id',
        type: 'integer',
      },
      destSubgraphSystemId: {
        name: 'dest_subgraph_system_id',
        type: 'integer',
      },
    },
    relations: {
      useCase: {
        type: 'many-to-one',
        target: 'UseCase',
        joinColumn: {
          name: 'usecase_system_id',
          referencedColumnName: 'systemId',
        },
        onDelete: 'CASCADE',
      },
      sourceSubgraph: {
        type: 'many-to-one',
        target: 'Subgraph',
        joinColumn: {
          name: 'source_subgraph_system_id',
          referencedColumnName: 'systemId',
        },
        onDelete: 'CASCADE',
      },
      destSubgraph: {
        type: 'many-to-one',
        target: 'Subgraph',
        joinColumn: {
          name: 'dest_subgraph_system_id',
          referencedColumnName: 'systemId',
        },
        onDelete: 'CASCADE',
      },
    },
    indices: [
      {
        name: 'uq_use_case_subgraph_pairs_relationship',
        columns: [
          'usecaseSystemId',
          'sourceSubgraphSystemId',
          'destSubgraphSystemId',
        ],
        unique: true,
      },
      {
        name: 'idx_use_case_subgraph_pairs_source',
        columns: ['sourceSubgraphSystemId'],
      },
      {
        name: 'idx_use_case_subgraph_pairs_dest',
        columns: ['destSubgraphSystemId'],
      },
    ],
  });
```

- [ ] **Step 3: Build persistence to type-check both row contracts**

Run: `pnpm --filter @arc/persistence run build`

Expected: FAIL in `use-case.inserter.ts` because membership and pair rows now require `systemId`.

- [ ] **Step 4: Re-run the focused integration test at the schema boundary**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="use-case.inserter"`

Expected: FAIL with a missing/invalid `system_id` insertion error, proving the schema requires persistence to allocate relationship identity.

- [ ] **Step 5: Confirm no core or API contract was changed**

Run: `git diff --name-only -- packages/core packages/api`

Expected: no output. FR-DM-19A requires these IDs to remain absent from the core `UseCase` entity and public API.

### Task 3: Allocate relationship IDs through the file-scoped generator

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/use-case/use-case.inserter.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/typeorm-bulk-import.repository.ts`
- Test: `packages/infrastructure/persistence/tests/integration/bulk-import/use-case.inserter.spec.ts`

- [ ] **Step 1: Inject the existing ID-generation port into `UseCaseInserter`**

Update the core imports and constructor as follows:

```typescript
import type {
  BulkInsertResult,
  IdGenerationPort,
  UseCase,
} from '@arc/core';
import {okBulkInsert} from '@arc/core';

export class UseCaseInserter {
  constructor(
    private readonly manager: EntityManager,
    private readonly idGeneration: IdGenerationPort,
  ) {}

  // Keep insert(), insertUseCaseRows(), and insertGkvRows() unchanged.
}
```

- [ ] **Step 2: Generate membership IDs before the bounded bulk insert**

Replace `insertSubgraphRows` with this complete implementation. It allocates identities through the existing file-scoped mechanism, then preserves the current batch-first/fallback-on-error behavior:

```typescript
private async insertSubgraphRows(items: UseCase[]): Promise<StepResult> {
  const allRows = await Promise.all(
    items.flatMap(item =>
      item.subgraphSystemIds.map(async subgraphSystemId => ({
        systemId: await this.idGeneration.getNextId(item.fileSystemId),
        usecaseSystemId: item.systemId,
        subgraphSystemId,
      })),
    ),
  );

  if (allRows.length === 0)
    return {rawFailures: [], failedEntityIds: new Set()};

  const rawFailures: RawFailure[] = [];

  try {
    await this.manager.insert(UseCaseSubgraphSchema, allRows);
  } catch {
    for (const row of allRows) {
      try {
        await this.manager.insert(UseCaseSubgraphSchema, row);
      } catch (rowError: unknown) {
        const item = items.find(i => i.systemId === row.usecaseSystemId)!;
        rawFailures.push({
          systemId: item.systemId,
          entityLabel: 'UseCaseSubgraph',
          failedRowJson: `(systemId=${item.systemId}, relationshipSystemId=${row.systemId}, subgraphSystemId=${row.subgraphSystemId}) Row: ${JSON.stringify(row)}`,
          dbError:
            rowError instanceof Error ? rowError.message : String(rowError),
        });
      }
    }
  }

  return {rawFailures, failedEntityIds: new Set()};
}
```

- [ ] **Step 3: Generate pair IDs before the bounded bulk insert**

Replace `insertSubgraphPairRows` with this complete implementation:

```typescript
private async insertSubgraphPairRows(items: UseCase[]): Promise<StepResult> {
  const allRows = await Promise.all(
    items.flatMap(item =>
      item.subgraphPairs.map(async pair => ({
        systemId: await this.idGeneration.getNextId(item.fileSystemId),
        usecaseSystemId: item.systemId,
        sourceSubgraphSystemId: pair.sourceSubgraphSystemId,
        destSubgraphSystemId: pair.destSubgraphSystemId,
      })),
    ),
  );

  if (allRows.length === 0)
    return {rawFailures: [], failedEntityIds: new Set()};

  const rawFailures: RawFailure[] = [];

  try {
    await this.manager.insert(UseCaseSubgraphPairSchema, allRows);
  } catch {
    for (const row of allRows) {
      try {
        await this.manager.insert(UseCaseSubgraphPairSchema, row);
      } catch (rowError: unknown) {
        const item = items.find(i => i.systemId === row.usecaseSystemId)!;
        rawFailures.push({
          systemId: item.systemId,
          entityLabel: 'UseCaseSubgraphPair',
          failedRowJson: `(systemId=${item.systemId}, relationshipSystemId=${row.systemId}, sourceSg=${row.sourceSubgraphSystemId}, destSg=${row.destSubgraphSystemId}) Row: ${JSON.stringify(row)}`,
          dbError:
            rowError instanceof Error ? rowError.message : String(rowError),
        });
      }
    }
  }

  return {rawFailures, failedEntityIds: new Set()};
}
```

- [ ] **Step 4: Wire the repository and integration fixture to the real ID service**

In `typeorm-bulk-import.repository.ts`, change the existing UseCase insertion method so it passes the repository's existing `this.idGeneration` dependency:

```typescript
insertUseCases(items: readonly UseCase[]): Promise<BulkInsertResult> {
  return new UseCaseInserter(this.manager, this.idGeneration).insert([...items]);
}
```

In `use-case.inserter.spec.ts`, import and instantiate the production registry:

```typescript
import {EntityIdServiceRegistry} from '../../../src/persistence-typeorm-sqllite/repositories/id-generation/entity-id-service-registry.js';

// Inside beforeEach, after manager is assigned and dependencies are created:
inserter = new UseCaseInserter(
  manager,
  new EntityIdServiceRegistry(manager),
);
```

- [ ] **Step 5: Run the focused integration test**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="use-case.inserter"`

Expected: PASS. Membership and pair rows receive distinct numeric IDs, natural relationship duplicates are rejected, shared subgraphs/pairs across different UseCases remain valid, and existing failure isolation still passes. ID allocation performs no relationship lookup query and keeps inserts grouped by relationship category, consistent with NFR-DM-03.

### Task 4: Regenerate the single initial-create migration

**Package:** `@arc/persistence`

**Files:**
- Delete: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/1785297093633-initial-create.ts`
- Create: the single timestamped `initial-create.ts` emitted under `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migration-index.ts`

- [ ] **Step 1: Build before invoking the TypeORM generator**

Run: `pnpm run build`

Expected: PASS. The TypeORM CLI can load the updated compiled entity schemas.

- [ ] **Step 2: Delete the current generated migration**

Run: `rm packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/1785297093633-initial-create.ts`

Expected: the migrations directory contains no `initial-create` migration before generation. This deletion is intentional and required by the repository's pre-release migration workflow.

- [ ] **Step 3: Generate the replacement migration with the fixed name**

Run: `pnpm run migration:gen ./packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/initial-create`

Expected: PASS and exactly one new file matching `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/[0-9]*-initial-create.ts`. Do not hand-write or amend the generated SQL.

- [ ] **Step 4: Apply the two required migration post-processing edits**

Open the generated migration and add this header before the import:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */
```

Change the generated import to:

```typescript
import type {MigrationInterface, QueryRunner} from 'typeorm';
```

Then print the exact two statements required by `migration-index.ts` from the generated file:

```bash
migration_file=$(find packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations -maxdepth 1 -name '*-initial-create.ts' -print -quit)
migration_base=$(basename "$migration_file" .ts)
migration_class=$(sed -n 's/^export class \(InitialCreate[0-9][0-9]*\).*/\1/p' "$migration_file")
printf "import {%s} from './migrations/%s.js';\n\nexport const migrations = [%s];\n" "$migration_class" "$migration_base" "$migration_class"
```

Use `apply_patch` to replace the complete contents of `migration-index.ts` with the two statements printed by this command. The imported class, filename, and exported array entry must therefore use the same concrete generated timestamp.

- [ ] **Step 5: Validate the generated migration and index**

Run:

```bash
test "$(find packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations -maxdepth 1 -name '*-initial-create.ts' | wc -l)" -eq 1
rg -n 'use_case_subgraphs|use_case_subgraph_pairs|system_id|uq_use_case_subgraphs_relationship|uq_use_case_subgraph_pairs_relationship' packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/*-initial-create.ts
rg -n 'import type \{MigrationInterface, QueryRunner\}|InitialCreate[0-9]+' packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/*-initial-create.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migration-index.ts
```

Expected: one migration file exists; both relationship tables contain `system_id`; both natural unique indices are present; the migration uses a type-only TypeORM import; and `migration-index.ts` references the new class. No migration SQL was written manually.

### Task 5: Run focused persistence verification

**Package:** `@arc/persistence`

**Files:**
- Verify: `packages/infrastructure/persistence/tests/integration/bulk-import/use-case.inserter.spec.ts`
- Verify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/use-case-subgraph.schema.ts`
- Verify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/use-case-subgraph-pair.schema.ts`
- Verify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/use-case/use-case.inserter.ts`
- Verify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/typeorm-bulk-import.repository.ts`
- Verify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migration-index.ts`
- Verify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/*-initial-create.ts`

- [ ] **Step 1: Run the focused UseCase bulk-import integration suite**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand --testPathPattern="use-case.inserter"`

Expected: PASS, including generated membership/pair identity, direct `system_id` lookup, retained natural uniqueness, shared-relationship behavior, and failure isolation.

- [ ] **Step 2: Run the complete persistence integration suite**

Run: `pnpm --filter @arc/persistence run test:integration -- --runInBand`

Expected: PASS. Existing schema, import, edit-session, repository, and query behavior has no regression.

- [ ] **Step 3: Build all packages against the regenerated migration**

Run: `pnpm run build`

Expected: PASS for the full workspace.

- [ ] **Step 4: Confirm the migration is discoverable**

Run: `pnpm run migration:show`

Expected: PASS and the newly generated `InitialCreate` class is listed through `migration-index.ts`.

- [ ] **Step 5: Audit chapter scope and requirement boundaries**

Run:

```bash
git diff --check
git diff --name-only
git diff -- packages/core packages/api
```

Expected: `git diff --check` reports no whitespace errors; changed files are limited to the two relationship schemas, UseCase bulk-import wiring/inserter, focused integration test, regenerated migration, migration index, and this chapter; the final command has no output. This confirms the chapter adds only persistence identity and does not implement FR-DM-19 deletion, remove UseCase roots under FR-DM-20, expose IDs through core/API, or pre-empt the later effective-state and transactional work required by FR-DM-21 through FR-DM-24 and NFR-DM-05.

### Commit: UseCase Relationship Persistence Identity

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/use-case-subgraph.schema.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/use-case-subgraph-pair.schema.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/use-case/use-case.inserter.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/typeorm-bulk-import.repository.ts \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations \
        packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migration-index.ts \
        packages/infrastructure/persistence/tests/integration/bulk-import/use-case.inserter.spec.ts \
        docs/module-write/plans/chapters/01-01-usecase-relationship-identity.md
git commit -m "feat(persistence): add UseCase relationship identities" \
           -m "Generate file-scoped IDs for UseCase relationship rows so delete edit actions can address them while preserving natural uniqueness." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
Only execute after confirmation.
