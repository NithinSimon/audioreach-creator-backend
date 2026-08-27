### Task 6: Define the Delete Module result schema and core type

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.spec.ts`

- [ ] **Step 1: Write the failing schema tests**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, it} from '@jest/globals';
import {DeleteSpfModuleResultSchema} from '../../../../../../src/application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.js';

describe('DeleteSpfModuleResultSchema', () => {
  it('accepts the non-subsystem response shape with subsystem fields omitted', () => {
    const result = DeleteSpfModuleResultSchema.parse({
      deleted: {
        spfModules: [{systemId: '1001'}],
        subgraphs: [],
        containers: [],
        dataLinks: [{systemId: '4001'}],
        controlLinks: [],
      },
      updated: {usecases: []},
    });

    expect(result.deleted.dataLinks[0]).toEqual({systemId: '4001'});
    expect(result.deleted).not.toHaveProperty('unresolvedSubsystemDataLinks');
    expect(result.updated).not.toHaveProperty('subsystems');
  });

  it('accepts the subsystem-capable response shape including empty arrays', () => {
    const result = DeleteSpfModuleResultSchema.parse({
      deleted: {
        spfModules: [{systemId: '1001'}],
        subgraphs: [],
        containers: [],
        dataLinks: [{systemId: '4001', subsystemLinks: []}],
        controlLinks: [
          {
            systemId: '5001',
            subsystemLinks: [{systemId: '5101'}],
          },
        ],
        unresolvedSubsystemDataLinks: [],
        unresolvedSubsystemControlLinks: [{systemId: '5201'}],
      },
      updated: {
        usecases: [],
        subsystems: [
          {
            systemId: '3001',
            intentsClearedControlPorts: [{systemId: '5301'}],
          },
        ],
      },
    });

    expect(result.deleted.controlLinks[0].subsystemLinks).toEqual([
      {systemId: '5101'},
    ]);
    expect(result.updated.subsystems?.[0].intentsClearedControlPorts).toEqual([
      {systemId: '5301'},
    ]);
  });

  it('rejects numeric system IDs at the DTO boundary', () => {
    const result = DeleteSpfModuleResultSchema.safeParse({
      deleted: {
        spfModules: [{systemId: 1001}],
        subgraphs: [],
        containers: [],
        dataLinks: [],
        controlLinks: [],
      },
      updated: {usecases: []},
    });

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result.schema.spec.ts"`

Expected: FAIL because the current stub does not expose the Delete Module-specific nested schema.

- [ ] **Step 3: Replace the stub with the complete zod schema and inferred type**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {z} from 'zod';

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

export type DeleteSpfModuleResult = z.infer<
  typeof DeleteSpfModuleResultSchema
>;
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result.schema.spec.ts"`

Expected: PASS with all three schema scenarios.

- [ ] **Step 5: Build core to verify the inferred type and ESM import compile**

Run: `pnpm run build:core`

Expected: PASS with no TypeScript errors.

### Task 7: Add deterministic Delete Module projection primitives

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module-result.builder.ts`
- Test: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/delete-spf-module-result.builder.spec.ts`

- [ ] **Step 1: Write failing tests for ID serialization, deduplication, sorting, and link grouping**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, expect, it} from '@jest/globals';
import {
  toDeletedIds,
  toDeletedLinks,
} from '../../../../../../src/application/usecase-designer/spf-module/delete/delete-spf-module-result.builder.js';

describe('Delete Module result projection primitives', () => {
  it('serializes, deduplicates, and numerically sorts system IDs', () => {
    expect(toDeletedIds([20, 3, 20, 11])).toEqual([
      {systemId: '3'},
      {systemId: '11'},
      {systemId: '20'},
    ]);
  });

  it('merges duplicate canonical links and sorts their subsystem segments', () => {
    expect(
      toDeletedLinks(
        [
          {systemId: 40, subsystemLinkSystemIds: [413, 411]},
          {systemId: 20, subsystemLinkSystemIds: []},
          {systemId: 40, subsystemLinkSystemIds: [412, 411]},
        ],
        true,
      ),
    ).toEqual([
      {systemId: '20', subsystemLinks: []},
      {
        systemId: '40',
        subsystemLinks: [
          {systemId: '411'},
          {systemId: '412'},
          {systemId: '413'},
        ],
      },
    ]);
  });

  it('omits subsystemLinks for a non-subsystem projection', () => {
    expect(
      toDeletedLinks(
        [{systemId: 40, subsystemLinkSystemIds: [411]}],
        false,
      ),
    ).toEqual([{systemId: '40'}]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result.builder.spec.ts"`

Expected: FAIL because `delete-spf-module-result.builder.js` does not exist.

- [ ] **Step 3: Implement the pure projection primitives**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {DeleteSpfModuleResult} from '../dto/delete-spf-module-result.schema.js';

export interface DeletedLinkProjectionInput {
  systemId: number;
  subsystemLinkSystemIds: readonly number[];
}

type DeletedId = DeleteSpfModuleResult['deleted']['spfModules'][number];
type DeletedLink = DeleteSpfModuleResult['deleted']['dataLinks'][number];

export function toDeletedIds(systemIds: readonly number[]): DeletedId[] {
  return [...new Set(systemIds)]
    .sort((left, right) => left - right)
    .map(systemId => ({systemId: String(systemId)}));
}

export function toDeletedLinks(
  links: readonly DeletedLinkProjectionInput[],
  includeSubsystemLinks: boolean,
): DeletedLink[] {
  const subsystemLinksByCanonicalId = new Map<number, Set<number>>();

  for (const link of links) {
    let subsystemLinkIds = subsystemLinksByCanonicalId.get(link.systemId);
    if (!subsystemLinkIds) {
      subsystemLinkIds = new Set<number>();
      subsystemLinksByCanonicalId.set(link.systemId, subsystemLinkIds);
    }
    for (const subsystemLinkSystemId of link.subsystemLinkSystemIds) {
      subsystemLinkIds.add(subsystemLinkSystemId);
    }
  }

  return [...subsystemLinksByCanonicalId.entries()]
    .sort(([left], [right]) => left - right)
    .map(([systemId, subsystemLinkSystemIds]) => {
      if (!includeSubsystemLinks) return {systemId: String(systemId)};
      return {
        systemId: String(systemId),
        subsystemLinks: toDeletedIds([...subsystemLinkSystemIds]),
      };
    });
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result.builder.spec.ts"`

Expected: PASS with canonical links and nested segment IDs duplicate-free and numerically sorted.

- [ ] **Step 5: Build core to verify the helper stays framework-independent**

Run: `pnpm run build:core`

Expected: PASS; the helper imports only the core result type.

### Task 8: Assemble subsystem-capable and non-subsystem Delete Module results

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module-result.builder.ts`
- Modify: `packages/core/tests/unit/application/usecase-designer/spf-module/delete/delete-spf-module-result.builder.spec.ts`

- [ ] **Step 1: Extend the builder tests with both response variants and subsystem grouping**

Replace the test import with:

```typescript
import {describe, expect, it} from '@jest/globals';
import {
  buildDeleteSpfModuleResult,
  toDeletedIds,
  toDeletedLinks,
} from '../../../../../../src/application/usecase-designer/spf-module/delete/delete-spf-module-result.builder.js';
import {DeleteSpfModuleResultSchema} from '../../../../../../src/application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.js';
```

Append these scenarios to the test file:

```typescript
describe('buildDeleteSpfModuleResult', () => {
  const commonInput = {
    requestedModuleSystemId: 1001,
    deletedSubgraphSystemIds: [2002, 2001, 2002],
    deletedContainerSystemIds: [],
    deletedDataLinks: [
      {systemId: 4001, subsystemLinkSystemIds: [4102, 4101]},
    ],
    deletedControlLinks: [
      {systemId: 5001, subsystemLinkSystemIds: []},
    ],
    updatedUsecaseSystemIds: [6002, 6001, 6002],
  } as const;

  it('omits every subsystem-specific field for non-subsystem files', () => {
    const result = buildDeleteSpfModuleResult({
      ...commonInput,
      subsystemCapable: false,
    });

    expect(result).toEqual({
      deleted: {
        spfModules: [{systemId: '1001'}],
        subgraphs: [{systemId: '2001'}, {systemId: '2002'}],
        containers: [],
        dataLinks: [{systemId: '4001'}],
        controlLinks: [{systemId: '5001'}],
      },
      updated: {
        usecases: [{systemId: '6001'}, {systemId: '6002'}],
      },
    });
    expect(DeleteSpfModuleResultSchema.parse(result)).toEqual(result);
  });

  it('includes empty subsystem categories and groups cleared ports by subsystem', () => {
    const result = buildDeleteSpfModuleResult({
      ...commonInput,
      subsystemCapable: true,
      unresolvedSubsystemDataLinkSystemIds: [],
      unresolvedSubsystemControlLinkSystemIds: [5202, 5201, 5202],
      intentClearedControlPorts: [
        {subsystemSystemId: 3002, controlPortSystemId: 5303},
        {subsystemSystemId: 3001, controlPortSystemId: 5302},
        {subsystemSystemId: 3001, controlPortSystemId: 5301},
        {subsystemSystemId: 3001, controlPortSystemId: 5302},
      ],
    });

    expect(result.deleted.dataLinks).toEqual([
      {
        systemId: '4001',
        subsystemLinks: [{systemId: '4101'}, {systemId: '4102'}],
      },
    ]);
    expect(result.deleted.controlLinks).toEqual([
      {systemId: '5001', subsystemLinks: []},
    ]);
    expect(result.deleted.unresolvedSubsystemDataLinks).toEqual([]);
    expect(result.deleted.unresolvedSubsystemControlLinks).toEqual([
      {systemId: '5201'},
      {systemId: '5202'},
    ]);
    expect(result.updated.subsystems).toEqual([
      {
        systemId: '3001',
        intentsClearedControlPorts: [
          {systemId: '5301'},
          {systemId: '5302'},
        ],
      },
      {
        systemId: '3002',
        intentsClearedControlPorts: [{systemId: '5303'}],
      },
    ]);
    expect(DeleteSpfModuleResultSchema.parse(result)).toEqual(result);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the new scenarios fail**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result.builder.spec.ts"`

Expected: FAIL because `buildDeleteSpfModuleResult` is not exported.

- [ ] **Step 3: Replace the builder with the complete response assembler**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {DeleteSpfModuleResult} from '../dto/delete-spf-module-result.schema.js';

export interface DeletedLinkProjectionInput {
  systemId: number;
  subsystemLinkSystemIds: readonly number[];
}

export interface IntentClearedControlPortProjectionInput {
  subsystemSystemId: number;
  controlPortSystemId: number;
}

interface DeleteSpfModuleResultBaseInput {
  requestedModuleSystemId: number;
  deletedSubgraphSystemIds: readonly number[];
  deletedContainerSystemIds: readonly number[];
  deletedDataLinks: readonly DeletedLinkProjectionInput[];
  deletedControlLinks: readonly DeletedLinkProjectionInput[];
  updatedUsecaseSystemIds: readonly number[];
}

export interface NonSubsystemDeleteSpfModuleResultInput
  extends DeleteSpfModuleResultBaseInput {
  subsystemCapable: false;
}

export interface SubsystemDeleteSpfModuleResultInput
  extends DeleteSpfModuleResultBaseInput {
  subsystemCapable: true;
  unresolvedSubsystemDataLinkSystemIds: readonly number[];
  unresolvedSubsystemControlLinkSystemIds: readonly number[];
  intentClearedControlPorts: readonly IntentClearedControlPortProjectionInput[];
}

export type DeleteSpfModuleResultInput =
  | NonSubsystemDeleteSpfModuleResultInput
  | SubsystemDeleteSpfModuleResultInput;

type DeletedId = DeleteSpfModuleResult['deleted']['spfModules'][number];
type DeletedLink = DeleteSpfModuleResult['deleted']['dataLinks'][number];
type UpdatedSubsystem = NonNullable<
  DeleteSpfModuleResult['updated']['subsystems']
>[number];

export function toDeletedIds(systemIds: readonly number[]): DeletedId[] {
  return [...new Set(systemIds)]
    .sort((left, right) => left - right)
    .map(systemId => ({systemId: String(systemId)}));
}

export function toDeletedLinks(
  links: readonly DeletedLinkProjectionInput[],
  includeSubsystemLinks: boolean,
): DeletedLink[] {
  const subsystemLinksByCanonicalId = new Map<number, Set<number>>();

  for (const link of links) {
    let subsystemLinkIds = subsystemLinksByCanonicalId.get(link.systemId);
    if (!subsystemLinkIds) {
      subsystemLinkIds = new Set<number>();
      subsystemLinksByCanonicalId.set(link.systemId, subsystemLinkIds);
    }
    for (const subsystemLinkSystemId of link.subsystemLinkSystemIds) {
      subsystemLinkIds.add(subsystemLinkSystemId);
    }
  }

  return [...subsystemLinksByCanonicalId.entries()]
    .sort(([left], [right]) => left - right)
    .map(([systemId, subsystemLinkSystemIds]) => {
      if (!includeSubsystemLinks) return {systemId: String(systemId)};
      return {
        systemId: String(systemId),
        subsystemLinks: toDeletedIds([...subsystemLinkSystemIds]),
      };
    });
}

function toUpdatedSubsystems(
  clearedPorts: readonly IntentClearedControlPortProjectionInput[],
): UpdatedSubsystem[] {
  const controlPortsBySubsystem = new Map<number, Set<number>>();

  for (const clearedPort of clearedPorts) {
    let controlPortIds = controlPortsBySubsystem.get(
      clearedPort.subsystemSystemId,
    );
    if (!controlPortIds) {
      controlPortIds = new Set<number>();
      controlPortsBySubsystem.set(clearedPort.subsystemSystemId, controlPortIds);
    }
    controlPortIds.add(clearedPort.controlPortSystemId);
  }

  return [...controlPortsBySubsystem.entries()]
    .sort(([left], [right]) => left - right)
    .map(([subsystemSystemId, controlPortSystemIds]) => ({
      systemId: String(subsystemSystemId),
      intentsClearedControlPorts: toDeletedIds([...controlPortSystemIds]),
    }));
}

export function buildDeleteSpfModuleResult(
  input: DeleteSpfModuleResultInput,
): DeleteSpfModuleResult {
  const deleted = {
    spfModules: toDeletedIds([input.requestedModuleSystemId]),
    subgraphs: toDeletedIds(input.deletedSubgraphSystemIds),
    containers: toDeletedIds(input.deletedContainerSystemIds),
    dataLinks: toDeletedLinks(
      input.deletedDataLinks,
      input.subsystemCapable,
    ),
    controlLinks: toDeletedLinks(
      input.deletedControlLinks,
      input.subsystemCapable,
    ),
  };
  const updated = {
    usecases: toDeletedIds(input.updatedUsecaseSystemIds),
  };

  if (!input.subsystemCapable) return {deleted, updated};

  return {
    deleted: {
      ...deleted,
      unresolvedSubsystemDataLinks: toDeletedIds(
        input.unresolvedSubsystemDataLinkSystemIds,
      ),
      unresolvedSubsystemControlLinks: toDeletedIds(
        input.unresolvedSubsystemControlLinkSystemIds,
      ),
    },
    updated: {
      ...updated,
      subsystems: toUpdatedSubsystems(input.intentClearedControlPorts),
    },
  };
}
```

- [ ] **Step 4: Run the focused builder tests and verify they pass**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result.builder.spec.ts"`

Expected: PASS; non-subsystem fields are omitted, subsystem fields use empty arrays when unaffected, and all arrays are duplicate-free and numerically sorted.

- [ ] **Step 5: Run the schema and builder tests together**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result.(schema|builder).spec.ts"`

Expected: PASS with every assembled response accepted by `DeleteSpfModuleResultSchema`.

### Task 9: Add the lightweight `SpfModuleBase` projection contract

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/domain/entities/usecase-data/module/spf-module.ts`

- [ ] **Step 1: Replace the module entity file with the complete projection-aware definition**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {TagData} from './entities/spf-module-tag-data.js';
import type {KvData} from '../../common/entities/kv-data.js';
import {CkvCollection} from '../../common/entities/ckv-collection.js';
import {Node, NodeType} from '../node/node.js';
import type {DataPort} from '../node/entities/data-port.js';
import type {ControlPort} from '../node/entities/control-port.js';

export class DuplicateTagExceptionError extends Error {
  constructor(
    readonly idType: 'systemId' | 'tagDefinitionSystemId',
    readonly id: number,
  ) {
    super(`Tag with ${idType} ${id} already exists`);
    this.name = 'DuplicateTagExceptionError';
  }
}

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

export interface SpfModuleInit extends SpfModuleBaseInit {
  dataPorts: DataPort[];
  controlPorts: ControlPort[];
}

export class SpfModule extends Node {
  private readonly tagIds = new Set<string>();
  private readonly ckvCollection = new CkvCollection();

  readonly instanceId: number;
  readonly definitionSystemId: number;
  readonly containerSystemId: number;
  readonly subgraphSystemId: number;
  readonly alias?: string;
  readonly tagDataList: TagData[] = [];

  get ckvs(): readonly KvData[] {
    return this.ckvCollection.ckvs;
  }

  constructor(init: SpfModuleInit) {
    super({
      systemId: init.systemId,
      type: NodeType.Module,
      dataPorts: init.dataPorts,
      controlPorts: init.controlPorts,
      parentId: init.parentSystemId,
      fileSystemId: init.fileSystemId,
    });
    this.instanceId = init.instanceId;
    this.definitionSystemId = init.definitionSystemId;
    this.containerSystemId = init.containerSystemId;
    this.subgraphSystemId = init.subgraphSystemId;
    this.alias = init.alias ?? '';
  }

  addTagData(tagData: TagData) {
    const systemIdKey = `sys:${tagData.systemId}`;
    const tagDefIdKey = `tagDef:${tagData.tagDefinitionSystemId}`;

    if (this.tagIds.has(systemIdKey))
      throw new DuplicateTagExceptionError('systemId', tagData.systemId);
    if (this.tagIds.has(tagDefIdKey))
      throw new DuplicateTagExceptionError(
        'tagDefinitionSystemId',
        tagData.tagDefinitionSystemId,
      );

    this.tagIds.add(systemIdKey);
    this.tagIds.add(tagDefIdKey);
    this.tagDataList.push(tagData);
  }

  /**
   * Check if module has a tag with the given tag definition system ID.
   * Uses O(1) Set lookup for performance.
   *
   * @param tagDefinitionSystemId The tag definition system ID to check
   * @returns true if tag exists, false otherwise
   */
  hasTag(tagDefinitionSystemId: number): boolean {
    const tagDefIdKey = `tagDef:${tagDefinitionSystemId}`;
    return this.tagIds.has(tagDefIdKey);
  }

  addModuleCkv(kvData: KvData) {
    this.ckvCollection.addCkv(kvData);
  }
}
```

The only behavioral-neutral changes are the new base interfaces and `SpfModuleInit extends SpfModuleBaseInit`; the existing class implementation remains byte-for-byte equivalent in behavior.

- [ ] **Step 2: Build core to verify the projection hierarchy compiles**

Run: `pnpm run build:core`

Expected: PASS; TypeScript accepts `SpfModuleInit extends SpfModuleBaseInit` without changing runtime behavior.

- [ ] **Step 3: Run the core unit suite to guard existing module behavior**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand`

Expected: PASS with no regressions in module construction, tag handling, or CKV behavior.

- [ ] **Step 4: Run lint to verify the new exported interfaces follow repository style**

Run: `pnpm run lint`

Expected: PASS with no import-order, formatting, or empty-interface lint error for the design-required `SpfModuleBase` contract.

- [ ] **Step 5: Verify the projection change is limited to type structure**

Run: `git diff --check -- packages/core/src/domain/entities/usecase-data/module/spf-module.ts`

Expected: PASS with no whitespace errors; the constructor and runtime methods remain unchanged.

### Task 10: Add complete-deletion-set control intent topology analysis

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/domain/services/subsystem-control-links/control-intent-propagation.service.ts`
- Modify: `packages/core/tests/unit/domain/services/control-links/control-intent-propagation.service.spec.ts`

- [ ] **Step 1: Add failing tests for bulk route deletion, isolated ports, and surviving anchors**

Extend the service test import with the new input and result types:

```typescript
import {
  ControlIntentPropagationService,
  type ClearInput,
  type ClearResult,
  type FindPortsToClearAfterDeletingLinksInput,
  type FindPortsToClearAfterDeletingLinksResult,
  type PropagateInput,
  type PropagateResult,
} from '../../../../../src/domain/services/subsystem-control-links/control-intent-propagation.service.js';
```

Add this helper after `scl`:

```typescript
type IdentifiedSubsystemControlLinkShape =
  FindPortsToClearAfterDeletingLinksInput['allSubsystemControlLinks'][number];

function identifiedScl(
  systemId: number,
  peerNodeASystemId: number,
  peerNodeBSystemId: number,
  nodeAPortSystemId: number,
  nodeBPortSystemId: number,
): IdentifiedSubsystemControlLinkShape {
  return {
    systemId,
    peerNodeASystemId,
    peerNodeBSystemId,
    nodeAPortSystemId,
    nodeBPortSystemId,
  } as IdentifiedSubsystemControlLinkShape;
}
```

Add the bulk-operation suite before the existing propagation suite:

```typescript
describe('ControlIntentPropagationService.findPortsToClearAfterDeletingLinks', () => {
  it('returns every subsystem port isolated after the complete route is deleted', () => {
    const input: FindPortsToClearAfterDeletingLinksInput = {
      allSubsystemControlLinks: [
        identifiedScl(1, 1, 10, 100, 200),
        identifiedScl(2, 10, 20, 201, 300),
        identifiedScl(3, 20, 2, 301, 400),
      ],
      deletedSubsystemControlLinkSystemIds: [3, 1, 2],
      nodeTypeMap: nodeTypeMap([
        [1, 'module'],
        [10, 'subsystem'],
        [20, 'subsystem'],
        [2, 'module'],
      ]),
    };

    const result: FindPortsToClearAfterDeletingLinksResult =
      ControlIntentPropagationService.findPortsToClearAfterDeletingLinks(input);

    expect(result.portsToClear).toEqual([
      {subsystemSystemId: 10, controlPortSystemId: 200},
      {subsystemSystemId: 10, controlPortSystemId: 201},
      {subsystemSystemId: 20, controlPortSystemId: 300},
      {subsystemSystemId: 20, controlPortSystemId: 301},
    ]);
  });

  it('clears only the isolated side when the other affected side retains a module route', () => {
    const input: FindPortsToClearAfterDeletingLinksInput = {
      allSubsystemControlLinks: [
        identifiedScl(10, 1, 10, 100, 200),
        identifiedScl(11, 10, 20, 201, 300),
      ],
      deletedSubsystemControlLinkSystemIds: [11],
      nodeTypeMap: nodeTypeMap([
        [1, 'module'],
        [10, 'subsystem'],
        [20, 'subsystem'],
      ]),
    };

    const result =
      ControlIntentPropagationService.findPortsToClearAfterDeletingLinks(input);

    expect(result.portsToClear).toEqual([
      {subsystemSystemId: 20, controlPortSystemId: 300},
    ]);
  });

  it('returns no ports when the deletion set is empty or contains no effective segment', () => {
    const link = identifiedScl(20, 1, 10, 100, 200);
    const baseInput = {
      allSubsystemControlLinks: [link],
      nodeTypeMap: nodeTypeMap([
        [1, 'module'],
        [10, 'subsystem'],
      ]),
    };

    expect(
      ControlIntentPropagationService.findPortsToClearAfterDeletingLinks({
        ...baseInput,
        deletedSubsystemControlLinkSystemIds: [],
      }),
    ).toEqual({portsToClear: []});
    expect(
      ControlIntentPropagationService.findPortsToClearAfterDeletingLinks({
        ...baseInput,
        deletedSubsystemControlLinkSystemIds: [999],
      }),
    ).toEqual({portsToClear: []});
  });
});
```

- [ ] **Step 2: Run the focused service test and verify the bulk cases fail**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="control-intent-propagation.service.spec.ts"`

Expected: FAIL because `FindPortsToClearAfterDeletingLinksInput`, `FindPortsToClearAfterDeletingLinksResult`, and `findPortsToClearAfterDeletingLinks` do not exist; the pre-existing `findPortsToClear` tests still compile unchanged once the new exports are added.

- [ ] **Step 3: Implement the bulk pure-service contract without changing the single-segment operation**

Add the entity type import after the existing `NodeType` import:

```typescript
import type {SubsystemControlLink} from '../../entities/usecase-data/subsystem-control-link/subsystem-control-link.js';
```

Add the public bulk-operation contracts after `ClearResult`:

```typescript
export interface FindPortsToClearAfterDeletingLinksInput {
  allSubsystemControlLinks: readonly SubsystemControlLink[];
  deletedSubsystemControlLinkSystemIds: readonly number[];
  nodeTypeMap: ReadonlyMap<number, NodeType>;
}

export interface IntentClearedControlPort {
  subsystemSystemId: number;
  controlPortSystemId: number;
}

export interface FindPortsToClearAfterDeletingLinksResult {
  portsToClear: IntentClearedControlPort[];
}
```

Add this method to `ControlIntentPropagationService` immediately after the existing `findPortsToClear` method. Do not modify or remove `findPortsToClear`; current single-segment callers must retain its existing input and `number[]` result contract.

```typescript
  findPortsToClearAfterDeletingLinks(
    input: FindPortsToClearAfterDeletingLinksInput,
  ): FindPortsToClearAfterDeletingLinksResult {
    const {
      allSubsystemControlLinks,
      deletedSubsystemControlLinkSystemIds,
      nodeTypeMap,
    } = input;
    const deletedSystemIds = new Set(deletedSubsystemControlLinkSystemIds);
    if (deletedSystemIds.size === 0) return {portsToClear: []};

    const deletedLinks = allSubsystemControlLinks.filter(link =>
      deletedSystemIds.has(link.systemId),
    );
    if (deletedLinks.length === 0) return {portsToClear: []};

    const remainingLinks = allSubsystemControlLinks.filter(
      link => !deletedSystemIds.has(link.systemId),
    );
    const {adjacency} = buildNodeGraph(remainingLinks);
    const {nodePortMap: preDeleteNodePortMap} = buildNodeGraph(
      allSubsystemControlLinks,
    );
    const affectedNodes = new Set<number>();
    for (const link of deletedLinks) {
      affectedNodes.add(link.peerNodeASystemId);
      affectedNodes.add(link.peerNodeBSystemId);
    }

    const seenNodes = new Set<number>();
    const portsByIdentity = new Map<string, IntentClearedControlPort>();

    for (const startNode of affectedNodes) {
      if (seenNodes.has(startNode)) continue;
      const {componentNodes, hasModule} = bfsComponent(
        startNode,
        adjacency,
        nodeTypeMap,
      );
      for (const nodeId of componentNodes) seenNodes.add(nodeId);
      if (hasModule) continue;

      for (const subsystemSystemId of componentNodes) {
        if (nodeTypeMap.get(subsystemSystemId) !== NodeType.Subsystem) continue;
        for (const controlPortSystemId of
          preDeleteNodePortMap.get(subsystemSystemId) ?? []) {
          const identity = `${subsystemSystemId}:${controlPortSystemId}`;
          portsByIdentity.set(identity, {
            subsystemSystemId,
            controlPortSystemId,
          });
        }
      }
    }

    return {
      portsToClear: [...portsByIdentity.values()].sort(
        (left, right) =>
          left.subsystemSystemId - right.subsystemSystemId ||
          left.controlPortSystemId - right.controlPortSystemId,
      ),
    };
  },
```

Update only the `nodeTypeMap` parameter type on `bfsComponent` so both the existing mutable-map input and the new readonly-map input compile:

```typescript
function bfsComponent(
  startNode: number,
  adjacency: Map<number, number[]>,
  nodeTypeMap: ReadonlyMap<number, NodeType>,
): {componentNodes: number[]; hasModule: boolean} {
```

- [ ] **Step 4: Run the complete propagation service test file**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="control-intent-propagation.service.spec.ts"`

Expected: PASS for the new bulk-delete cases and every existing `findPortsToClear` and `cascadePropagate` case. The complete-deletion-set test proves that ports are recovered from pre-delete ownership even when no route segment remains.

- [ ] **Step 5: Build core and run all focused chapter tests**

Run: `pnpm run build:core && pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result|control-intent-propagation.service.spec.ts"`

Expected: PASS with ESM `.js` imports resolved, no framework or Node.js imports in core, and deterministic `{subsystemSystemId, controlPortSystemId}` output.

### Commit: Core Types and Intent Topology

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/core/src/application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.ts packages/core/tests/unit/application/usecase-designer/spf-module/dto/delete-spf-module-result.schema.spec.ts packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module-result.builder.ts packages/core/tests/unit/application/usecase-designer/spf-module/delete/delete-spf-module-result.builder.spec.ts packages/core/src/domain/entities/usecase-data/module/spf-module.ts packages/core/src/domain/services/subsystem-control-links/control-intent-propagation.service.ts packages/core/tests/unit/domain/services/control-links/control-intent-propagation.service.spec.ts
git commit -m "feat(core): add delete module result and intent topology" \
           -m "Define deterministic Delete Module result projection, a lightweight module read model, and complete-set routed-control intent cleanup analysis." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
