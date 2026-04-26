<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Data Links & Virtual Links: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `virtual_link_segments` table, domain entity, TypeORM schema, bulk import support, unified `POST/DELETE /data-links` endpoint, chain resolution algorithm, and `GET /components?showSubsystems` integration.

**Architecture:** Virtual link segments are stored permanently in `virtual_link_segments`. The `DataLink` domain object optionally carries its virtual segments for bulk import. The unified `POST /data-links` endpoint routes to `DataLink` or `VirtualLinkSegment` based on node types (no mode state). Chain resolution runs at `GET /components?showSubsystems=false` or `auto-create-usecases`. All changes flow through `edit_actions` during a session.

**Tech Stack:** TypeScript, NestJS, TypeORM, SQLite, CQRS (command/query bus), `edit_actions` modification framework

---

## File Map

**New files:**
- `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/1745600000000-add-virtual-link-segments.ts`
- `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/Links/virtual-link-segment.ts`
- `packages/core/src/domain/entities/usecase-data/links/virtual-link-segment.ts`
- `packages/core/src/application/usecase-designer/data-link/add-connection.command.ts`
- `packages/core/src/application/usecase-designer/data-link/add-connection.handler.ts`
- `packages/core/src/application/usecase-designer/data-link/delete-connection.command.ts`
- `packages/core/src/application/usecase-designer/data-link/delete-connection.handler.ts`
- `packages/core/src/application/usecase-designer/data-link/chain-resolution.service.ts`
- `packages/core/tests/unit/application/usecase-designer/data-link/add-connection.handler.spec.ts`
- `packages/core/tests/unit/application/usecase-designer/data-link/delete-connection.handler.spec.ts`
- `packages/core/tests/unit/application/usecase-designer/data-link/chain-resolution.service.spec.ts`
- `packages/infrastructure/persistence/tests/integration/crud-operations/virtual-link-segment-inserter.spec.ts`

**Modified files:**
- `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migration-index.ts`
- `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/entity-table-names.ts`
- `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/index.ts`
- `packages/core/src/domain/entities/usecase-data/links/data-link.ts`
- `packages/core/src/index.ts`
- `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/data-link/data-link.inserter.ts`
- `packages/core/src/application/usecase-designer/usecase/get-components/` (query + handler)
- `packages/api/src/presentation/rest/modules/` (data-links controller + DTOs)

---

## Task 1: DB Migration

**Files:**
- Create: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/1745600000000-add-virtual-link-segments.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migration-index.ts`

- [ ] **Step 1: Create the migration file**

```typescript
// packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/1745600000000-add-virtual-link-segments.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */
import type {MigrationInterface, QueryRunner} from 'typeorm';

export class AddVirtualLinkSegments1745600000000 implements MigrationInterface {
  name = 'AddVirtualLinkSegments1745600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "virtual_link_segments" (
        "system_id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
        "version" integer NOT NULL DEFAULT (1),
        "actual_link_system_id" integer,
        "source_node_system_id" integer NOT NULL,
        "destination_node_system_id" integer NOT NULL,
        "source_port_system_id" integer NOT NULL,
        "destination_port_system_id" integer NOT NULL,
        "file_system_id" integer NOT NULL,
        CONSTRAINT "FK_vls_actual_link" FOREIGN KEY ("actual_link_system_id") REFERENCES "data_links" ("system_id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_vls_source_node" FOREIGN KEY ("source_node_system_id") REFERENCES "nodes" ("system_id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_vls_dest_node" FOREIGN KEY ("destination_node_system_id") REFERENCES "nodes" ("system_id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_vls_source_port" FOREIGN KEY ("source_port_system_id") REFERENCES "data_ports" ("system_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_vls_dest_port" FOREIGN KEY ("destination_port_system_id") REFERENCES "data_ports" ("system_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_vls_file" FOREIGN KEY ("file_system_id") REFERENCES "files" ("system_id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(`CREATE INDEX "idx_vls_file" ON "virtual_link_segments" ("file_system_id")`);
    await queryRunner.query(`CREATE INDEX "idx_vls_actual_link" ON "virtual_link_segments" ("actual_link_system_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_vls_source_port_file" ON "virtual_link_segments" ("source_port_system_id", "file_system_id") WHERE "actual_link_system_id" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_vls_dest_port_file" ON "virtual_link_segments" ("destination_port_system_id", "file_system_id") WHERE "actual_link_system_id" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_vls_dest_port_file"`);
    await queryRunner.query(`DROP INDEX "uq_vls_source_port_file"`);
    await queryRunner.query(`DROP INDEX "idx_vls_actual_link"`);
    await queryRunner.query(`DROP INDEX "idx_vls_file"`);
    await queryRunner.query(`DROP TABLE "virtual_link_segments"`);
  }
}
```

- [ ] **Step 2: Register migration in `migration-index.ts`**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */
import {InitialCreate1775463707568} from './migrations/1775463707568-initial-create.js';
import {AddVirtualLinkSegments1745600000000} from './migrations/1745600000000-add-virtual-link-segments.js';

export const migrations = [InitialCreate1775463707568, AddVirtualLinkSegments1745600000000];
```

- [ ] **Step 3: Commit**

```bash
git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/1745600000000-add-virtual-link-segments.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migration-index.ts
git commit -m "feat: add virtual_link_segments migration"
```

---

## Task 2: TypeORM Entity Schema

**Files:**
- Create: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/Links/virtual-link-segment.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/Links/virtual-link-segment.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */
import {BaseColumnSchemaPart} from '../../entity-base.js';
import type {EntityBaseRow} from '../../entity-base.js';
import type {NodeRow} from '../node/node.schema.js';
import type {DataPortRow} from '../node/data-port-info.schema.js';
import type {DataLinkRow} from './data-link.js';
import type {ArcDbFileRow} from '../../project-data/arc-db-file.schema.js';
import {EntitySchema} from 'typeorm';

export interface VirtualLinkSegmentRow extends EntityBaseRow {
  actualLinkSystemId: number | null;
  sourceNodeSystemId: number;
  destinationNodeSystemId: number;
  sourcePortSystemId: number;
  destinationPortSystemId: number;
  fileSystemId: number;
  actualLink?: DataLinkRow | null;
  sourceNode?: NodeRow;
  destinationNode?: NodeRow;
  sourcePort?: DataPortRow;
  destinationPort?: DataPortRow;
  file?: ArcDbFileRow;
}

export const VirtualLinkSegmentSchema = new EntitySchema<VirtualLinkSegmentRow>({
  name: 'VirtualLinkSegment',
  tableName: 'virtual_link_segments',
  columns: {
    ...BaseColumnSchemaPart,
    actualLinkSystemId: {type: 'integer', name: 'actual_link_system_id', nullable: true},
    sourceNodeSystemId: {type: 'integer', name: 'source_node_system_id'},
    destinationNodeSystemId: {type: 'integer', name: 'destination_node_system_id'},
    sourcePortSystemId: {type: 'integer', name: 'source_port_system_id'},
    destinationPortSystemId: {type: 'integer', name: 'destination_port_system_id'},
    fileSystemId: {name: 'file_system_id', type: 'integer', nullable: false},
  },
  relations: {
    actualLink: {
      type: 'many-to-one', target: 'DataLink',
      joinColumn: {name: 'actual_link_system_id', referencedColumnName: 'systemId'},
      onDelete: 'CASCADE', nullable: true,
    },
    sourceNode: {
      type: 'many-to-one', target: 'Node',
      joinColumn: {name: 'source_node_system_id', referencedColumnName: 'systemId'},
      onDelete: 'CASCADE',
    },
    destinationNode: {
      type: 'many-to-one', target: 'Node',
      joinColumn: {name: 'destination_node_system_id', referencedColumnName: 'systemId'},
      onDelete: 'CASCADE',
    },
    sourcePort: {
      type: 'many-to-one', target: 'DataPort',
      joinColumn: {name: 'source_port_system_id', referencedColumnName: 'systemId'},
      onDelete: 'RESTRICT',
    },
    destinationPort: {
      type: 'many-to-one', target: 'DataPort',
      joinColumn: {name: 'destination_port_system_id', referencedColumnName: 'systemId'},
      onDelete: 'RESTRICT',
    },
    file: {
      type: 'many-to-one', target: 'ArcDbFile',
      joinColumn: {name: 'file_system_id', referencedColumnName: 'systemId'},
      onDelete: 'CASCADE',
    },
  },
  indices: [
    {name: 'idx_vls_file', columns: ['fileSystemId']},
    {name: 'idx_vls_actual_link', columns: ['actualLinkSystemId']},
  ],
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/usecase-data/Links/virtual-link-segment.ts
git commit -m "feat: add VirtualLinkSegment TypeORM entity schema"
```

---

## Task 3: Entity Names + Schema Registration

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/entity-table-names.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/index.ts`

- [ ] **Step 1: Add `VirtualLinkSegment` to `ENTITY_NAMES`**

In `entity-table-names.ts`, in the `// ── Link data` section, add after `ControlLink`:

```typescript
DataLink: 'DataLink',
ControlLink: 'ControlLink',
VirtualLinkSegment: 'VirtualLinkSegment',
```

- [ ] **Step 2: Update `entity-schema/index.ts`**

1. Add import (with other Links imports at top):
```typescript
import {VirtualLinkSegmentSchema} from './usecase-data/Links/virtual-link-segment.js';
```

2. Add export (after `DataLinkSchema` export block):
```typescript
export type {VirtualLinkSegmentRow} from './usecase-data/Links/virtual-link-segment.js';
export {VirtualLinkSegmentSchema} from './usecase-data/Links/virtual-link-segment.js';
```

3. In `getAllEntitySchemas()`, add after `DataLinkSchema`:
```typescript
DataLinkSchema,
VirtualLinkSegmentSchema,
```

- [ ] **Step 3: Commit**

```bash
git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/entity-table-names.ts packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/index.ts
git commit -m "feat: register VirtualLinkSegment entity name and schema"
```

---

## Task 4: Domain Entity + Core Exports

**Files:**
- Create: `packages/core/src/domain/entities/usecase-data/links/virtual-link-segment.ts`
- Modify: `packages/core/src/domain/entities/usecase-data/links/data-link.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `VirtualLinkSegment` domain class**

```typescript
// packages/core/src/domain/entities/usecase-data/links/virtual-link-segment.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * A virtual link segment represents one hop in a chain of connections that
 * crosses subsystem boundaries. At least one endpoint is a subsystem node.
 *
 * Segments are the source of truth during editing. Actual module-to-module
 * links (DataLink) are derived from complete chains at resolution time.
 *
 * Port identity: both source and destination ports always reference module
 * ports (data_ports rows belonging to module nodes), never subsystem ports.
 * See docs/datalink-virtual-link-design.md §2 Port Ownership for details.
 */
export class VirtualLinkSegment {
  public systemId: number;
  /** FK to data_links.system_id. Null until the chain is resolved. */
  public actualLinkSystemId: number | null;
  public sourceNodeSystemId: number;
  public destinationNodeSystemId: number;
  /** Always a module port, even when the node is a subsystem. */
  public sourcePortSystemId: number;
  /** Always a module port, even when the node is a subsystem. */
  public destinationPortSystemId: number;
  public fileSystemId: number;

  constructor(
    systemId: number,
    actualLinkSystemId: number | null,
    sourceNodeSystemId: number,
    destinationNodeSystemId: number,
    sourcePortSystemId: number,
    destinationPortSystemId: number,
    fileSystemId: number,
  ) {
    this.systemId = systemId;
    this.actualLinkSystemId = actualLinkSystemId;
    this.sourceNodeSystemId = sourceNodeSystemId;
    this.destinationNodeSystemId = destinationNodeSystemId;
    this.sourcePortSystemId = sourcePortSystemId;
    this.destinationPortSystemId = destinationPortSystemId;
    this.fileSystemId = fileSystemId;
  }
}
```

- [ ] **Step 2: Extend `DataLink` domain class with optional `virtualLinkSegments`**

Full updated `packages/core/src/domain/entities/usecase-data/links/data-link.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */
import {SameNodeException} from './exceptions.js';
import {VirtualLinkSegment} from './virtual-link-segment.js';

export class DataLink {
  public systemId: number;
  public sourceNodeSystemId: number;
  public destinationNodeSystemId: number;
  public sourcePortSystemId: number;
  public destinationPortSystemId: number;
  public isInterGraph: boolean;
  public naturalKeyHash: string;
  public fileSystemId: number;

  /**
   * Virtual link segments for this actual link.
   * Populated when the link crosses subsystem boundaries (different parentId).
   * Used during bulk import to insert segments alongside the actual link.
   * Absent for links within the same subsystem or when no subsystems are defined.
   */
  public virtualLinkSegments?: VirtualLinkSegment[];

  constructor(
    systemId: number,
    sourceNodeSystemId: number,
    destinationNodeSystemId: number,
    sourcePortSystemId: number,
    destinationPortSystemId: number,
    isInterGraph: boolean,
    naturalKeyHash: string,
    fileSystemId: number,
    virtualLinkSegments?: VirtualLinkSegment[],
  ) {
    this.systemId = systemId;
    this.sourceNodeSystemId = sourceNodeSystemId;
    this.destinationNodeSystemId = destinationNodeSystemId;
    this.sourcePortSystemId = sourcePortSystemId;
    this.destinationPortSystemId = destinationPortSystemId;
    this.isInterGraph = isInterGraph;
    this.naturalKeyHash = naturalKeyHash;
    this.fileSystemId = fileSystemId;
    this.virtualLinkSegments = virtualLinkSegments;
    if (this.sourceNodeSystemId == this.destinationNodeSystemId) {
      throw new SameNodeException(sourceNodeSystemId);
    }
  }
}
```

- [ ] **Step 3: Export `VirtualLinkSegment` from core index**

In `packages/core/src/index.ts`, add after the `data-link.js` export:

```typescript
export * from './domain/entities/usecase-data/links/virtual-link-segment.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/domain/entities/usecase-data/links/virtual-link-segment.ts packages/core/src/domain/entities/usecase-data/links/data-link.ts packages/core/src/index.ts
git commit -m "feat: add VirtualLinkSegment domain entity and extend DataLink"
```

---

## Task 5: Update `DataLinkInserter` to insert virtual segments

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/data-link/data-link.inserter.ts`
- Create: `packages/infrastructure/persistence/tests/integration/crud-operations/virtual-link-segment-inserter.spec.ts`

- [ ] **Step 1: Write a failing integration test**

```typescript
// packages/infrastructure/persistence/tests/integration/crud-operations/virtual-link-segment-inserter.spec.ts
// Setup: create nodes (2 module nodes + 1 subsystem node), data ports, and a file in the test DB.

it('inserts virtual link segments alongside data link when virtualLinkSegments is provided', async () => {
  const dataLink = new DataLink(
    0, moduleANodeId, moduleBNodeId, portAId, portBId, false, 'hash-test-vls', fileSystemId,
    [
      new VirtualLinkSegment(0, null, moduleANodeId, subsystemXNodeId, portAId, portAId, fileSystemId),
      new VirtualLinkSegment(0, null, subsystemXNodeId, moduleBNodeId, portBId, portBId, fileSystemId),
    ],
  );

  const result = await inserter.insert([dataLink]);

  expect(result.results[0].success).toBe(true);
  const actualLinkId = result.results[0].idMapping.systemId;

  const segments = await manager.find('VirtualLinkSegment', {where: {actualLinkSystemId: actualLinkId}});
  expect(segments).toHaveLength(2);
});

it('inserts data link without virtual segments when virtualLinkSegments is absent', async () => {
  const dataLink = new DataLink(0, moduleANodeId, moduleBNodeId, portAId, portBId, false, 'hash-no-vls', fileSystemId);
  const result = await inserter.insert([dataLink]);
  expect(result.results[0].success).toBe(true);
  const segments = await manager.find('VirtualLinkSegment', {where: {actualLinkSystemId: result.results[0].idMapping.systemId}});
  expect(segments).toHaveLength(0);
});
```

Run: `pnpm --filter @arc/persistence test -- --testPathPattern=virtual-link-segment-inserter`
Expected: FAIL

- [ ] **Step 2: Add `insertVirtualSegments` to `DataLinkInserter`**

Add import at top of `data-link.inserter.ts`:
```typescript
import type {VirtualLinkSegmentRow} from '../../../entity-schema/index.js';
```

Add private method to the class:
```typescript
private async insertVirtualSegments(
  dataLinks: readonly Omit<DataLink, 'systemId'>[],
  mappingMap: Map<string, number>,
): Promise<void> {
  const segmentRows: Omit<VirtualLinkSegmentRow, 'systemId' | 'creationDate' | 'updateDate' | 'version'>[] = [];

  for (const dataLink of dataLinks) {
    if (!dataLink.virtualLinkSegments?.length) continue;
    const actualLinkSystemId = mappingMap.get(dataLink.naturalKeyHash);
    if (actualLinkSystemId === undefined) continue;

    for (const segment of dataLink.virtualLinkSegments) {
      segmentRows.push({
        actualLinkSystemId,
        sourceNodeSystemId: segment.sourceNodeSystemId,
        destinationNodeSystemId: segment.destinationNodeSystemId,
        sourcePortSystemId: segment.sourcePortSystemId,
        destinationPortSystemId: segment.destinationPortSystemId,
        fileSystemId: segment.fileSystemId,
      });
    }
  }

  if (segmentRows.length > 0) {
    await this.manager.insert('VirtualLinkSegment', segmentRows);
  }
}
```

Call it at the end of `insert()`, after `buildResults`:
```typescript
const bulkResult = this.buildResults(dataLinks, mappings, insertResult);
await this.insertVirtualSegments(dataLinks, mappingMap);
return bulkResult;
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter @arc/persistence test -- --testPathPattern=virtual-link-segment-inserter`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/data-link/data-link.inserter.ts packages/infrastructure/persistence/tests/integration/crud-operations/virtual-link-segment-inserter.spec.ts
git commit -m "feat: insert virtual link segments in DataLinkInserter"
```

---

## Task 6: Add Connection Command

**Files:**
- Create: `packages/core/src/application/usecase-designer/data-link/add-connection.command.ts`
- Create: `packages/core/src/application/usecase-designer/data-link/add-connection.handler.ts`
- Create: `packages/core/tests/unit/application/usecase-designer/data-link/add-connection.handler.spec.ts`

- [ ] **Step 1: Create `AddConnectionCommand`**

```typescript
// packages/core/src/application/usecase-designer/data-link/add-connection.command.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */
import {BaseCommand} from '../../shared/base-command.js';

export class AddConnectionCommand extends BaseCommand {
  constructor(
    public readonly fileSystemId: number,
    public readonly sessionId: number,
    public readonly sourceNodeSystemId: number,
    public readonly destinationNodeSystemId: number,
    public readonly sourcePortSystemId: number,
    public readonly destinationPortSystemId: number,
  ) {
    super();
  }
}

export interface AddConnectionResult {
  systemId: number;
  /** 'DataLink' for actual links, 'VirtualLinkSegment' for virtual segments */
  type: 'DataLink' | 'VirtualLinkSegment';
}
```

- [ ] **Step 2: Write failing unit tests**

```typescript
// packages/core/tests/unit/application/usecase-designer/data-link/add-connection.handler.spec.ts

it('creates DataLink when both nodes are modules in the same subsystem', async () => {
  mockNodeRepo.findById
    .mockResolvedValueOnce({systemId: 1, type: 'module', parentId: 10})
    .mockResolvedValueOnce({systemId: 2, type: 'module', parentId: 10});

  const result = await handler.execute(command);

  expect(result.type).toBe('DataLink');
  expect(mockEditActionsService.insertEditAction).toHaveBeenCalledTimes(1);
  expect(mockEditActionsService.insertEditAction).toHaveBeenCalledWith(
    expect.objectContaining({tableName: 'DataLink', operation: 'CREATE'}),
  );
});

it('creates DataLink + VirtualLinkSegments when modules are in different subsystems', async () => {
  mockNodeRepo.findById
    .mockResolvedValueOnce({systemId: 1, type: 'module', parentId: 10})
    .mockResolvedValueOnce({systemId: 2, type: 'module', parentId: 20});

  const result = await handler.execute(command);

  expect(result.type).toBe('DataLink');
  // DataLink + 3 VirtualLinkSegments (ModuleA→SubX, SubX→SubY, SubY→ModuleB)
  expect(mockEditActionsService.insertEditAction).toHaveBeenCalledTimes(4);
});

it('creates VirtualLinkSegment when destination is a subsystem node', async () => {
  mockNodeRepo.findById
    .mockResolvedValueOnce({systemId: 1, type: 'module', parentId: 10})
    .mockResolvedValueOnce({systemId: 10, type: 'subsystem', parentId: null});

  const result = await handler.execute(command);

  expect(result.type).toBe('VirtualLinkSegment');
  expect(mockEditActionsService.insertEditAction).toHaveBeenCalledWith(
    expect.objectContaining({tableName: 'VirtualLinkSegment', operation: 'CREATE'}),
  );
});

it('rejects when one-connection-per-port constraint is violated', async () => {
  mockNodeRepo.findById
    .mockResolvedValueOnce({systemId: 1, type: 'module', parentId: 10})
    .mockResolvedValueOnce({systemId: 10, type: 'subsystem', parentId: null});
  mockVirtualSegmentRepo.findBySourcePort.mockResolvedValue({systemId: 99});

  await expect(handler.execute(command)).rejects.toThrow(
    'Port already has an outgoing virtual link segment',
  );
});
```

Run: `pnpm --filter @arc/core test -- --testPathPattern=add-connection`
Expected: FAIL

- [ ] **Step 3: Implement `AddConnectionHandler`**

Handler routing logic:

1. Fetch source and dest node types from nodes table (via read overlay)
2. **Both module nodes:**
   - Same `parentId` (or both null) → create `DataLink` `edit_action` only
   - Different `parentId` → create `DataLink` + auto-create `VirtualLinkSegment` `edit_actions` (segments: ModuleA→SubX, SubX→SubY, SubY→ModuleB; all share same `group_id`; `actual_link_system_id` set immediately since ID is pre-assigned)
3. **Either node is subsystem:**
   - Validate one-connection-per-port (check `virtual_link_segments` + `edit_actions` overlay)
   - If violated → throw 422
   - Create `VirtualLinkSegment` `edit_action` with `actual_link_system_id = null`
4. Return `{ systemId, type }`

All `edit_actions` use `operation='CREATE'`, `change_status='STAGED'`. IDs pre-assigned via `IdGenerationPort`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arc/core test -- --testPathPattern=add-connection`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/application/usecase-designer/data-link/ packages/core/tests/unit/application/usecase-designer/data-link/add-connection.handler.spec.ts
git commit -m "feat: add AddConnectionCommand and handler"
```

---

## Task 7: Delete Connection Command

**Files:**
- Create: `packages/core/src/application/usecase-designer/data-link/delete-connection.command.ts`
- Create: `packages/core/src/application/usecase-designer/data-link/delete-connection.handler.ts`
- Create: `packages/core/tests/unit/application/usecase-designer/data-link/delete-connection.handler.spec.ts`

- [ ] **Step 1: Create `DeleteConnectionCommand`**

```typescript
// packages/core/src/application/usecase-designer/data-link/delete-connection.command.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */
import {BaseCommand} from '../../shared/base-command.js';

export class DeleteConnectionCommand extends BaseCommand {
  constructor(
    public readonly fileSystemId: number,
    public readonly sessionId: number,
    /** systemId of either a DataLink or a VirtualLinkSegment */
    public readonly systemId: number,
  ) {
    super();
  }
}
```

- [ ] **Step 2: Write failing unit tests**

```typescript
// packages/core/tests/unit/application/usecase-designer/data-link/delete-connection.handler.spec.ts

it('records DataLink DELETE + VirtualLinkSegment DELETEs when systemId is an actual link', async () => {
  mockDataLinkRepo.findById.mockResolvedValue({systemId: 100, version: 1});
  mockVirtualSegmentRepo.findByActualLinkId.mockResolvedValue([
    {systemId: 201, version: 1},
    {systemId: 202, version: 1},
    {systemId: 203, version: 1},
  ]);

  await handler.execute(new DeleteConnectionCommand(fileId, sessionId, 100));

  expect(mockEditActionsService.insertEditAction).toHaveBeenCalledTimes(4);
  const groupIds = mockEditActionsService.insertEditAction.mock.calls.map((c: any[]) => c[0].groupId);
  expect(new Set(groupIds).size).toBe(1); // all same group_id
});

it('records only VirtualLinkSegment DELETE when systemId is a virtual segment', async () => {
  mockDataLinkRepo.findById.mockResolvedValue(null);
  mockVirtualSegmentRepo.findById.mockResolvedValue({systemId: 201, version: 1});

  await handler.execute(new DeleteConnectionCommand(fileId, sessionId, 201));

  expect(mockEditActionsService.insertEditAction).toHaveBeenCalledTimes(1);
  expect(mockEditActionsService.insertEditAction).toHaveBeenCalledWith(
    expect.objectContaining({tableName: 'VirtualLinkSegment', operation: 'DELETE'}),
  );
});

it('throws NotFoundException when systemId is not found in either table', async () => {
  mockDataLinkRepo.findById.mockResolvedValue(null);
  mockVirtualSegmentRepo.findById.mockResolvedValue(null);

  await expect(handler.execute(new DeleteConnectionCommand(fileId, sessionId, 999))).rejects.toThrow(
    'Connection 999 not found',
  );
});
```

Run: `pnpm --filter @arc/core test -- --testPathPattern=delete-connection`
Expected: FAIL

- [ ] **Step 3: Implement `DeleteConnectionHandler`**

Handler logic:

1. Look up `systemId` in `data_links` (via read overlay)
2. **If found as actual link:**
   - Record `DataLink` DELETE in `edit_actions` (`base_version` = current version)
   - Find all `VirtualLinkSegments` with `actualLinkSystemId = systemId` (from `virtual_link_segments` + overlay)
   - Record `VirtualLinkSegment` DELETE for each
   - All DELETEs share same `group_id`
3. **If not found as actual link**, look up in `virtual_link_segments` (via read overlay)
4. **If found as virtual segment:**
   - Record `VirtualLinkSegment` DELETE in `edit_actions`
   - No immediate cascade — chain breakage detected at resolution time
5. **If not found in either:** throw `NotFoundException`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arc/core test -- --testPathPattern=delete-connection`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/application/usecase-designer/data-link/ packages/core/tests/unit/application/usecase-designer/data-link/delete-connection.handler.spec.ts
git commit -m "feat: add DeleteConnectionCommand and handler"
```

---

## Task 8: Chain Resolution Service

**Files:**
- Create: `packages/core/src/application/usecase-designer/data-link/chain-resolution.service.ts`
- Create: `packages/core/tests/unit/application/usecase-designer/data-link/chain-resolution.service.spec.ts`

- [ ] **Step 1: Write failing unit tests**

```typescript
// packages/core/tests/unit/application/usecase-designer/data-link/chain-resolution.service.spec.ts

it('resolves a complete 3-segment chain to one actual link descriptor', () => {
  const segments = [
    new VirtualLinkSegment(1, null, ModuleA, SubsystemX, PA, PA, fileId),
    new VirtualLinkSegment(2, null, SubsystemX, SubsystemY, PA, PB, fileId),
    new VirtualLinkSegment(3, null, SubsystemY, ModuleB, PB, PB, fileId),
  ];
  const nodeTypes = new Map([[ModuleA, 'module'], [SubsystemX, 'subsystem'], [SubsystemY, 'subsystem'], [ModuleB, 'module']]);

  const result = service.resolveChains(segments, nodeTypes);

  expect(result.completeChains).toHaveLength(1);
  expect(result.completeChains[0].sourceNodeSystemId).toBe(ModuleA);
  expect(result.completeChains[0].destinationNodeSystemId).toBe(ModuleB);
  expect(result.completeChains[0].sourcePortSystemId).toBe(PA);
  expect(result.completeChains[0].destinationPortSystemId).toBe(PB);
  expect(result.incompleteChains).toHaveLength(0);
});

it('returns incomplete chain when segment ends at a subsystem node', () => {
  const segments = [new VirtualLinkSegment(1, null, ModuleA, SubsystemX, PA, PA, fileId)];
  const nodeTypes = new Map([[ModuleA, 'module'], [SubsystemX, 'subsystem']]);

  const result = service.resolveChains(segments, nodeTypes);

  expect(result.completeChains).toHaveLength(0);
  expect(result.incompleteChains).toHaveLength(1);
  expect(result.incompleteChains[0].startNodeSystemId).toBe(ModuleA);
});

it('detects a cycle and treats it as incomplete', () => {
  const segments = [
    new VirtualLinkSegment(1, null, ModuleA, SubsystemX, PA, PA, fileId),
    new VirtualLinkSegment(2, null, SubsystemX, SubsystemY, PA, PB, fileId),
    new VirtualLinkSegment(3, null, SubsystemY, SubsystemX, PB, PA, fileId), // cycle
  ];
  const nodeTypes = new Map([[ModuleA, 'module'], [SubsystemX, 'subsystem'], [SubsystemY, 'subsystem']]);

  const result = service.resolveChains(segments, nodeTypes);

  expect(result.completeChains).toHaveLength(0);
  expect(result.incompleteChains).toHaveLength(1);
});

it('handles two independent complete chains', () => {
  const segments = [
    new VirtualLinkSegment(1, null, ModuleA, SubsystemX, PA, PA, fileId),
    new VirtualLinkSegment(2, null, SubsystemX, ModuleB, PA, PB, fileId),
    new VirtualLinkSegment(3, null, ModuleC, SubsystemY, PC, PC, fileId),
    new VirtualLinkSegment(4, null, SubsystemY, ModuleD, PC, PD, fileId),
  ];
  const nodeTypes = new Map([
    [ModuleA, 'module'], [SubsystemX, 'subsystem'], [ModuleB, 'module'],
    [ModuleC, 'module'], [SubsystemY, 'subsystem'], [ModuleD, 'module'],
  ]);

  const result = service.resolveChains(segments, nodeTypes);

  expect(result.completeChains).toHaveLength(2);
  expect(result.incompleteChains).toHaveLength(0);
});
```

Run: `pnpm --filter @arc/core test -- --testPathPattern=chain-resolution`
Expected: FAIL

- [ ] **Step 2: Implement `ChainResolutionService`**

```typescript
// packages/core/src/application/usecase-designer/data-link/chain-resolution.service.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */
import type {VirtualLinkSegment} from '../../../domain/entities/usecase-data/links/virtual-link-segment.js';

export interface ResolvedChain {
  segments: VirtualLinkSegment[];
  sourceNodeSystemId: number;
  destinationNodeSystemId: number;
  sourcePortSystemId: number;   // first segment's source_port_system_id
  destinationPortSystemId: number; // last segment's destination_port_system_id
}

export interface IncompleteChain {
  startNodeSystemId: number;
  lastNodeSystemId: number;
  segments: VirtualLinkSegment[];
}

export interface ChainResolutionResult {
  completeChains: ResolvedChain[];
  incompleteChains: IncompleteChain[];
}

export class ChainResolutionService {
  /**
   * Traverse virtual link segments and classify chains as complete or incomplete.
   * Algorithm from docs/datalink-virtual-link-lld.md §5.2.
   */
  resolveChains(
    segments: VirtualLinkSegment[],
    nodeTypes: Map<number, 'module' | 'subsystem'>,
  ): ChainResolutionResult {
    // Build adjacency map: sourceNodeSystemId → segment
    const adjacency = new Map<number, VirtualLinkSegment>();
    for (const seg of segments) {
      adjacency.set(seg.sourceNodeSystemId, seg);
    }

    // Find chain start points: module nodes with outgoing edges
    const startPoints = segments
      .map(s => s.sourceNodeSystemId)
      .filter(nodeId => nodeTypes.get(nodeId) === 'module');

    const completeChains: ResolvedChain[] = [];
    const incompleteChains: IncompleteChain[] = [];

    for (const startNodeId of startPoints) {
      const path: VirtualLinkSegment[] = [];
      const visited = new Set<number>();
      let current = startNodeId;

      while (true) {
        if (visited.has(current)) {
          incompleteChains.push({startNodeSystemId: startNodeId, lastNodeSystemId: current, segments: path});
          break;
        }
        visited.add(current);

        const nextSeg = adjacency.get(current);
        if (!nextSeg) {
          if (nodeTypes.get(current) === 'module' && current !== startNodeId) {
            completeChains.push({
              segments: path,
              sourceNodeSystemId: startNodeId,
              destinationNodeSystemId: current,
              sourcePortSystemId: path[0].sourcePortSystemId,
              destinationPortSystemId: path[path.length - 1].destinationPortSystemId,
            });
          } else {
            incompleteChains.push({startNodeSystemId: startNodeId, lastNodeSystemId: current, segments: path});
          }
          break;
        }

        path.push(nextSeg);
        current = nextSeg.destinationNodeSystemId;
      }
    }

    return {completeChains, incompleteChains};
  }
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm --filter @arc/core test -- --testPathPattern=chain-resolution`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/application/usecase-designer/data-link/chain-resolution.service.ts packages/core/tests/unit/application/usecase-designer/data-link/chain-resolution.service.spec.ts
git commit -m "feat: add ChainResolutionService"
```

---

## Task 9: `GET /components?showSubsystems` Integration

**Files:**
- Modify: `packages/core/src/application/usecase-designer/usecase/get-components/` (query + handler)

- [ ] **Step 1: Locate the existing get-components query and handler**

Check `packages/core/src/application/usecase-designer/usecase/get-components/` for the query class and handler class names.

- [ ] **Step 2: Add `showSubsystems` parameter to the existing query**

```typescript
constructor(
  // ... existing params ...
  public readonly showSubsystems: boolean = false,
) {
  super();
}
```

- [ ] **Step 3: Write failing tests for the slow path**

```typescript
it('triggers chain resolution when showSubsystems=false and unresolved segments exist', async () => {
  // arrange: session has VirtualLinkSegment CREATEs with actualLinkSystemId=null
  mockEditActionsService.getByTable.mockResolvedValueOnce([
    {
      tableName: 'VirtualLinkSegment', operation: 'CREATE', systemId: 201,
      payload: JSON.stringify({actualLinkSystemId: null, sourceNodeSystemId: ModuleA, destinationNodeSystemId: SubsystemX, sourcePortSystemId: PA, destinationPortSystemId: PA, fileSystemId: fileId}),
    },
    {
      tableName: 'VirtualLinkSegment', operation: 'CREATE', systemId: 202,
      payload: JSON.stringify({actualLinkSystemId: null, sourceNodeSystemId: SubsystemX, destinationNodeSystemId: ModuleB, sourcePortSystemId: PA, destinationPortSystemId: PB, fileSystemId: fileId}),
    },
  ]);
  mockNodeRepo.findByIds.mockResolvedValue([
    {systemId: ModuleA, type: 'module'}, {systemId: SubsystemX, type: 'subsystem'}, {systemId: ModuleB, type: 'module'},
  ]);

  await handler.execute(new GetComponentsQuery(ucId, fileId, sessionId, false));

  expect(mockEditActionsService.insertEditAction).toHaveBeenCalledWith(
    expect.objectContaining({tableName: 'DataLink', operation: 'CREATE'}),
  );
});

it('returns 422 when showSubsystems=false and incomplete chains exist', async () => {
  mockEditActionsService.getByTable.mockResolvedValueOnce([
    {
      tableName: 'VirtualLinkSegment', operation: 'CREATE', systemId: 201,
      payload: JSON.stringify({actualLinkSystemId: null, sourceNodeSystemId: ModuleA, destinationNodeSystemId: SubsystemX, sourcePortSystemId: PA, destinationPortSystemId: PA, fileSystemId: fileId}),
    },
  ]);
  mockNodeRepo.findByIds.mockResolvedValue([{systemId: ModuleA, type: 'module'}, {systemId: SubsystemX, type: 'subsystem'}]);

  await expect(handler.execute(new GetComponentsQuery(ucId, fileId, sessionId, false))).rejects.toThrow();
});

it('returns virtual segments when showSubsystems=true without triggering resolution', async () => {
  mockVirtualSegmentRepo.findByFile.mockResolvedValue([{systemId: 201, actualLinkSystemId: null}]);

  const result = await handler.execute(new GetComponentsQuery(ucId, fileId, sessionId, true));

  expect(result.virtualLinkSegments).toHaveLength(1);
  expect(mockEditActionsService.insertEditAction).not.toHaveBeenCalled();
});
```

Run: `pnpm --filter @arc/core test -- --testPathPattern=get-components`
Expected: FAIL

- [ ] **Step 4: Implement the `showSubsystems` branching in the handler**

```typescript
if (query.showSubsystems) {
  // Return virtual link segments (virtual_link_segments + edit_actions overlay)
  // Include port context per segment: join data_ports → nodes → spf_modules
  // to get portId + moduleInstanceId for each port
  return this.buildSubsystemModeResponse(query);
} else {
  // Fast path: check for unresolved segments (actualLinkSystemId = null in overlay)
  const unresolvedSegments = await this.getUnresolvedSegments(query.sessionId, query.fileSystemId);

  if (unresolvedSegments.length > 0) {
    // Slow path: run chain resolution
    const nodeTypes = await this.getNodeTypes(unresolvedSegments, query.fileSystemId);
    const resolution = this.chainResolutionService.resolveChains(unresolvedSegments, nodeTypes);

    if (resolution.incompleteChains.length > 0) {
      throw new IncompleteVirtualChainsException(resolution.incompleteChains);
    }

    // Create DataLink + VirtualLinkSegment UPDATE edit_actions for each complete chain
    await this.applyResolution(resolution.completeChains, query.sessionId, query.fileSystemId);
  }

  // Return actual links (data_links + edit_actions overlay for DataLink)
  return this.buildFlatModeResponse(query);
}
```

**Port context for subsystem mode response:** When building the subsystem mode response, for each virtual segment, join `data_ports → nodes → spf_modules` to include:
```typescript
portContext: {
  portSystemId: number,    // unique DB key — used for all write operations
  portId: number,          // port's numeric ID
  moduleInstanceId: number // spf_modules.instance_id (unique per file; client formats as hex)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @arc/core test -- --testPathPattern=get-components`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/application/usecase-designer/usecase/get-components/
git commit -m "feat: add showSubsystems param and chain resolution to GetComponents"
```

---

## Task 10: API Layer — Controller + DTOs

**Files:**
- Modify: `packages/api/src/presentation/rest/modules/` (data-links controller + DTOs)

- [ ] **Step 1: Locate the existing data-links controller**

Check `packages/api/src/presentation/rest/modules/` for the controller that handles `POST /data-links` and `DELETE /data-links/{id}`.

- [ ] **Step 2: Update `POST /data-links` DTO and controller method**

```typescript
// Request DTO
export class AddConnectionRequestDto {
  @IsNumber() sourceNodeSystemId: number;
  @IsNumber() destinationNodeSystemId: number;
  @IsNumber() sourcePortSystemId: number;
  @IsNumber() destinationPortSystemId: number;
}

// Response DTO
export class AddConnectionResponseDto {
  systemId: number;
  type: 'DataLink' | 'VirtualLinkSegment';
}

// Controller method
@Post('data-links')
async addConnection(
  @Param('projectId') projectId: number,
  @Body() dto: AddConnectionRequestDto,
  @Query('sessionId') sessionId: number,
): Promise<AddConnectionResponseDto> {
  const command = new AddConnectionCommand(
    projectId, sessionId,
    dto.sourceNodeSystemId, dto.destinationNodeSystemId,
    dto.sourcePortSystemId, dto.destinationPortSystemId,
  );
  return await this.commandBus.execute(command);
}
```

- [ ] **Step 3: Update `DELETE /data-links/{systemId}` controller method**

```typescript
@Delete('data-links/:systemId')
async deleteConnection(
  @Param('projectId') projectId: number,
  @Param('systemId') systemId: number,
  @Query('sessionId') sessionId: number,
): Promise<void> {
  const command = new DeleteConnectionCommand(projectId, sessionId, systemId);
  await this.commandBus.execute(command);
}
```

- [ ] **Step 4: Update `GET /components` controller method to pass `showSubsystems`**

```typescript
@Get('usecases/:usecaseId/components')
async getComponents(
  @Param('projectId') projectId: number,
  @Param('usecaseId') usecaseId: number,
  @Query('showSubsystems') showSubsystems: boolean = false,
  @Query('sessionId') sessionId: number | null,
): Promise<ComponentsResponseDto> {
  const query = new GetComponentsQuery(usecaseId, projectId, sessionId, showSubsystems);
  return await this.queryBus.execute(query);
}
```

- [ ] **Step 5: Define `VirtualLinkSegmentDto` for subsystem mode response**

```typescript
export class PortContextDto {
  /** Unique DB key — use this for all write operations */
  portSystemId: number;
  /** Port numeric ID (not unique across modules) */
  portId: number;
  /** Module instance ID (unique per file); client formats as hex (e.g. 0x4001) if needed */
  moduleInstanceId: number;
}

export class VirtualLinkSegmentDto {
  systemId: number;
  /** Null if chain not yet resolved */
  actualLinkSystemId: number | null;
  sourceNodeSystemId: number;
  destinationNodeSystemId: number;
  sourcePortContext: PortContextDto;
  destinationPortContext: PortContextDto;
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/presentation/rest/modules/
git commit -m "feat: update data-links controller for unified endpoint and showSubsystems"
```

---

## Task 11: `auto-create-usecases` Chain Resolution

**Files:**
- Modify: `packages/core/src/application/usecase-designer/usecase/` (auto-create-usecases handler)

- [ ] **Step 1: Locate the auto-create-usecases handler**

Check `packages/core/src/application/usecase-designer/usecase/` for the handler that runs the routing algorithm.

- [ ] **Step 2: Add chain resolution before routing**

At the start of the handler's `execute()` method, before running the routing algorithm:

```typescript
// Resolve any pending virtual chains before routing
const unresolvedSegments = await this.getUnresolvedSegments(command.sessionId, command.fileSystemId);
if (unresolvedSegments.length > 0) {
  const nodeTypes = await this.getNodeTypes(unresolvedSegments, command.fileSystemId);
  const resolution = this.chainResolutionService.resolveChains(unresolvedSegments, nodeTypes);
  if (resolution.incompleteChains.length > 0) {
    throw new IncompleteVirtualChainsException(resolution.incompleteChains);
  }
  await this.applyResolution(resolution.completeChains, command.sessionId, command.fileSystemId);
}
// Now run the routing algorithm on actual links (data_links + edit_actions overlay)
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/application/usecase-designer/usecase/
git commit -m "feat: resolve virtual chains before auto-create-usecases routing"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `virtual_link_segments` table | 1 |
| TypeORM entity schema | 2 |
| `ENTITY_NAMES.VirtualLinkSegment` | 3 |
| `VirtualLinkSegment` domain entity | 4 |
| `DataLink.virtualLinkSegments` optional field | 4 |
| Bulk import: segments inserted alongside actual links | 5 |
| Unified `POST /data-links` (routes by node type) | 6 + 10 |
| One-connection-per-port constraint | 6 |
| Unified `DELETE /data-links/{id}` (handles both types) | 7 + 10 |
| Chain resolution algorithm | 8 |
| `GET /components?showSubsystems=false` slow path | 9 |
| `GET /components?showSubsystems=true` returns virtual segments with port context | 9 + 10 |
| Port context: portSystemId + portId + moduleInstanceId | 9 + 10 |
| `auto-create-usecases` resolves chains before routing | 11 |

**Architecture compliance:**
- All commands go through command bus — no direct DB access in controllers ✅
- Domain entities in `packages/core` have no framework dependencies ✅
- `ChainResolutionService` is pure (no DB access, takes segments + nodeTypes as input) ✅
- `VirtualLinkSegment` domain entity has no TypeORM or NestJS imports ✅

**Type consistency:**
- `VirtualLinkSegment` class used consistently in Tasks 4, 5, 6, 7, 8, 9
- `AddConnectionResult.type` is `'DataLink' | 'VirtualLinkSegment'` — matches `AddConnectionResponseDto.type` in Task 10
- `ChainResolutionResult` types (`ResolvedChain`, `IncompleteChain`) defined in Task 8 and consumed in Tasks 9 and 11

---

*End of Plan*