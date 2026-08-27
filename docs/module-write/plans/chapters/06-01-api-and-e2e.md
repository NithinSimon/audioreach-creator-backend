### Task 40: Add the Delete Module API response DTO

**Package:** `@arc/api`

**Files:**
- Create: `packages/api/src/presentation/rest/modules/spf-module/dto/response/delete-spf-module-response.dto.ts`

- [ ] **Step 1: Create the response DTO from the frozen core result schema**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {DeleteSpfModuleResultSchema} from '@arc/core';
import {createZodDto} from 'nestjs-zod';

/**
 * Public response data for DELETE /spf-modules/:spfModuleSystemId.
 *
 * The core schema owns decimal-string ID serialization and the conditional
 * subsystem-capable response fields. The handler's internal groupId is not
 * part of this DTO.
 */
export class DeleteSpfModuleResponseDto extends createZodDto(
  DeleteSpfModuleResultSchema,
) {}
```

Keep this DTO in a dedicated file. Do not duplicate the nested response fields with `@ApiProperty`, add a `groupId`, or introduce a second API-owned schema; `DeleteSpfModuleResultSchema` from Task 6 is the single response-shape contract for FR-DM-25 through FR-DM-30.

- [ ] **Step 2: Format-check the new DTO**

Run: `pnpm exec prettier --check packages/api/src/presentation/rest/modules/spf-module/dto/response/delete-spf-module-response.dto.ts`

Expected: PASS with no formatting changes required.

- [ ] **Step 3: Build the API package to verify the ESM and package exports resolve**

Run: `pnpm run build:api`

Expected: PASS; `@arc/api` resolves `DeleteSpfModuleResultSchema` through the `@arc/core` export established in Task 39.

- [ ] **Step 4: Re-run the source-schema contract tests used by the API DTO**

Run: `pnpm --filter @arc/core run test:unit:core -- --runInBand --testPathPattern="delete-spf-module-result.schema.spec.ts"`

Expected: PASS for the non-subsystem shape, subsystem-capable shape, and numeric-ID rejection case.

- [ ] **Step 5: Verify the API DTO has no independent or internal fields**

Run: `rg -n "DeleteSpfModuleResultSchema|DeleteSpfModuleResponseDto|groupId|systemId:.*number" packages/api/src/presentation/rest/modules/spf-module/dto/response/delete-spf-module-response.dto.ts`

Expected: the schema import and DTO declaration are present; `groupId` appears only in the explanatory comment and there is no numeric `systemId` declaration.

### Task 41: Add deterministic Delete Module e2e fixtures and fixture discovery

**Package:** `@arc/api`

**Files:**
- Create: `packages/api/tests/e2e/fixtures/deleteModuleNonSubsystem.awsp`
- Create: `packages/api/tests/e2e/fixtures/deleteModuleSubsystem.awsp`
- Create: `packages/api/tests/e2e/spf-module/spf-module-delete.e2e-spec.ts`

- [ ] **Step 1: Write the failing fixture-upload and discovery scaffold**

Create `spf-module-delete.e2e-spec.ts` with the normal `setupE2ETest`/`teardownE2ETest` lifecycle, the same authenticated upload flow used by `spf-module-patch.e2e-spec.ts`, and this explicit complex-test skeleton:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {afterAll, beforeAll, describe, expect, it} from '@jest/globals';
import type {INestApplication} from '@nestjs/common';
import {dirname, join} from 'path';
import request from 'supertest';
import {fileURLToPath} from 'url';
import {setupE2ETest, teardownE2ETest} from '../helpers/e2e-test-setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ACDB_FIXTURE = join(__dirname, '../fixtures/acdb_cal.acdb');
const NON_SUBSYSTEM_FIXTURE = join(
  __dirname,
  '../fixtures/deleteModuleNonSubsystem.awsp',
);
const SUBSYSTEM_FIXTURE = join(
  __dirname,
  '../fixtures/deleteModuleSubsystem.awsp',
);

interface DeletedLinkExpectation {
  systemId: number;
  subsystemLinkSystemIds: number[];
}

interface DeleteFixtureIds {
  targetModuleSystemId: number;
  targetContainerSystemId: number;
  targetSubgraphSystemId?: number;
  importedModuleSystemId?: number;
  dataLinks: DeletedLinkExpectation[];
  controlLinks: DeletedLinkExpectation[];
  unresolvedSubsystemDataLinkSystemIds: number[];
  unresolvedSubsystemControlLinkSystemIds: number[];
  updatedUsecaseSystemIds: number[];
  updatedSubsystems: Array<{
    systemId: number;
    intentsClearedControlPortSystemIds: number[];
  }>;
}

interface ProvisionedFixture {
  projectId: string;
  ids: DeleteFixtureIds;
}

async function uploadProject(
  httpServer: unknown,
  authToken: string,
  awspPath: string,
): Promise<string> {
  const response = await request(httpServer as Parameters<typeof request>[0])
    .post('/arc-api/v1/projects/offline/upload-files')
    .set('Authorization', `Bearer ${authToken}`)
    .attach('acdbFile', ACDB_FIXTURE)
    .attach('workspaceFile', awspPath)
    .timeout(120_000)
    .expect(201);
  return String(response.body.data.projectId);
}

async function discoverFixtureIds(
  httpServer: unknown,
  authToken: string,
  projectId: string,
): Promise<DeleteFixtureIds> {
  // 1. GET the project's UseCases and collect their system IDs.
  // 2. POST those IDs to /usecases/components/query.
  // 3. Resolve modules, containers, subgraphs, links, subsystem-link segments,
  //    subsystems, and ControlPorts by the unique aliases/natural IDs defined
  //    in the fixture contract below.
  // 4. Throw a descriptive Error when any required fixture entity is absent;
  //    never fall back to the first entity in an array.
  // 5. Return generated database system IDs in the exact DeleteFixtureIds shape.
  throw new Error('red fixture-discovery sentinel');
}

async function provisionFixture(
  httpServer: unknown,
  authToken: string,
  awspPath: string,
): Promise<ProvisionedFixture> {
  const projectId = await uploadProject(httpServer, authToken, awspPath);
  return {
    projectId,
    ids: await discoverFixtureIds(httpServer, authToken, projectId),
  };
}

describe('Delete Module e2e fixtures', () => {
  let app: INestApplication;
  let httpServer: unknown;
  let authToken: string;

  beforeAll(async () => {
    const setup = await setupE2ETest();
    app = setup.app;
    httpServer = setup.httpServer;
    authToken = setup.authToken;
  }, 60_000);

  afterAll(async () => {
    await teardownE2ETest(app);
  });

  it.each([
    ['non-subsystem', NON_SUBSYSTEM_FIXTURE],
    ['subsystem-capable', SUBSYSTEM_FIXTURE],
  ])('uploads and discovers the %s fixture', async (_name, awspPath) => {
    const fixture = await provisionFixture(httpServer, authToken, awspPath);
    expect(fixture.projectId).not.toBe('');
    expect(fixture.ids.targetModuleSystemId).toEqual(expect.any(Number));
  }, 180_000);
});
```

The numbered body of `discoverFixtureIds` is the permitted complex-test skeleton: implement each numbered operation against the real query response while executing the plan. Keep all imports ESM-compatible with `.js` extensions for local TypeScript modules.

- [ ] **Step 2: Run the fixture suite and verify it fails before the fixture files exist**

Run: `pnpm --filter @arc/api run test:e2e:api -- --runInBand --testPathPattern="spf-module-delete.e2e-spec.ts"`

Expected: FAIL with `ENOENT` for `deleteModuleNonSubsystem.awsp` or `deleteModuleSubsystem.awsp`.

- [ ] **Step 3: Create both AWSP fixtures with fixed aliases and topology**

Use the repository's real AWSP XML structure and module-definition identities already supported by `acdb_cal.acdb`. Do not hard-code persistence `systemId` values; bulk import generates them, and the test discovers them by the fixed aliases/natural IDs below.

`deleteModuleNonSubsystem.awsp` must contain no Subsystem nodes or subsystem-link segments and must encode this exact graph:

| Fixture identity | Required state |
|---|---|
| `dm-ns-target-module` | Deletable module; sole module in container `dm-ns-target-container` |
| `dm-ns-survivor-module` | Module in a different container in the same editable subgraph |
| `dm-ns-target-container` | Becomes empty and is deleted with the target module |
| `dm-ns-live-subgraph` | Editable; survives because it still owns the survivor module |
| `dm-ns-data-link` | Canonical DataLink between target and survivor modules |
| `dm-ns-control-link` | Canonical ControlLink between target and survivor modules |
| `dm-ns-imported-subgraph` | Marked imported/read-only |
| `dm-ns-imported-module` | Module owned by the imported subgraph |
| `dm-ns-usecase` | Owns the live and imported subgraphs and remains unchanged |

`deleteModuleSubsystem.awsp` must be subsystem-capable and encode this exact graph:

| Fixture identity | Required state |
|---|---|
| `dm-ss-target-module` | Sole module in container `dm-ss-target-container` and subgraph `dm-ss-target-subgraph` |
| `dm-ss-survivor-module` | Module in a different subgraph, preserving the canonical link's opposite endpoint |
| `dm-ss-target-container` | Deleted after target removal |
| `dm-ss-target-subgraph` | Deleted after target removal |
| `dm-ss-usecase` | References the target subgraph; relationship rows are removed but the UseCase survives |
| `dm-ss-data-link` | Canonical DataLink with two resolved subsystem-link segments |
| `dm-ss-data-link-without-segments` | Canonical DataLink reached by the cascade with no resolved subsystem-link segments |
| `dm-ss-control-link` | Canonical ControlLink with one resolved subsystem-link segment |
| `dm-ss-unresolved-data-segment` | Unresolved subsystem DataLink segment reached by the delete cascade |
| `dm-ss-unresolved-control-segment` | Unresolved subsystem ControlLink segment reached by the delete cascade |
| `dm-ss-subsystem` | Owns the boundary ControlPort whose routed intent becomes isolated |
| `dm-ss-cleared-control-port` | Retained boundary ControlPort whose intents are cleared and reported |

Choose fixed natural IDs in ascending but deliberately non-adjacent order so the response tests can prove numeric sorting. Ensure no unrelated entity shares any `dm-ns-*` or `dm-ss-*` alias.

- [ ] **Step 4: Complete fixture discovery and verify both uploads pass**

Replace the `discoverFixtureIds` throw with the five numbered operations from Step 1. Populate every expected canonical link, nested subsystem-link segment, unresolved segment, UseCase, Subsystem, and cleared ControlPort ID from the query response.

Run: `pnpm --filter @arc/api run test:e2e:api -- --runInBand --testPathPattern="spf-module-delete.e2e-spec.ts"`

Expected: PASS for both fixture-upload cases; all required entities are discoverable by their fixed fixture identities.

- [ ] **Step 5: Validate fixture isolation and formatting**

Run: `rg -n "dm-ns-|dm-ss-" packages/api/tests/e2e/fixtures/deleteModuleNonSubsystem.awsp packages/api/tests/e2e/fixtures/deleteModuleSubsystem.awsp packages/api/tests/e2e/spf-module/spf-module-delete.e2e-spec.ts && pnpm exec prettier --check packages/api/tests/e2e/spf-module/spf-module-delete.e2e-spec.ts`

Expected: each fixture identity appears only in its intended fixture/test mapping, and the TypeScript test scaffold passes Prettier.

### Task 42: Write the complete Delete Module endpoint e2e matrix

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/tests/e2e/spf-module/spf-module-delete.e2e-spec.ts`

- [ ] **Step 1: Add session and DELETE request helpers before adding endpoint cases**

Add these helpers below `provisionFixture`:

```typescript
async function startSession(
  httpServer: unknown,
  authToken: string,
  projectId: string,
  mode: 'DESIGNER' | 'TUNING',
): Promise<void> {
  await request(httpServer as Parameters<typeof request>[0])
    .post(`/arc-api/v1/projects/${projectId}/start-session`)
    .set('Authorization', `Bearer ${authToken}`)
    .send({mode})
    .timeout(30_000)
    .expect(201);
}

async function endSession(
  httpServer: unknown,
  authToken: string,
  projectId: string,
): Promise<void> {
  await request(httpServer as Parameters<typeof request>[0])
    .post(`/arc-api/v1/projects/${projectId}/end-session`)
    .set('Authorization', `Bearer ${authToken}`)
    .timeout(30_000);
}

function deleteModule(
  httpServer: unknown,
  authToken: string,
  projectId: string,
  moduleSystemId: number | string,
) {
  return request(httpServer as Parameters<typeof request>[0])
    .delete(
      `/arc-api/v1/projects/${projectId}/spf-modules/${moduleSystemId}`,
    )
    .set('Authorization', `Bearer ${authToken}`)
    .timeout(60_000);
}

function asDeletedIds(systemIds: readonly number[]) {
  return [...new Set(systemIds)]
    .sort((left, right) => left - right)
    .map(systemId => ({systemId: String(systemId)}));
}

function asDeletedLinks(
  links: readonly DeletedLinkExpectation[],
  subsystemCapable: boolean,
) {
  return [...links]
    .sort((left, right) => left.systemId - right.systemId)
    .map(link =>
      subsystemCapable
        ? {
            systemId: String(link.systemId),
            subsystemLinks: asDeletedIds(link.subsystemLinkSystemIds),
          }
        : {systemId: String(link.systemId)},
    );
}
```

These helpers keep the assertions independent of bulk-import-generated `systemId` values while still enforcing decimal strings, deduplication, and numeric ordering.

- [ ] **Step 2: Add failing request-gate and error-status cases**

Under a new `describe('DELETE /arc-api/v1/projects/:projectId/spf-modules/:spfModuleSystemId', ...)`, add these concrete cases. Provision a fresh fixture for the effectively-deleted case; the other non-mutating status cases may share one provisioned non-subsystem project.

```typescript
it('returns 403 when there is no active session', async () => {
  const response = await deleteModule(
    httpServer,
    authToken,
    statusFixture.projectId,
    statusFixture.ids.targetModuleSystemId,
  );
  expect(response.status).toBe(403);
});

it('returns 403 when the active session mode is unsupported', async () => {
  await startSession(
    httpServer,
    authToken,
    statusFixture.projectId,
    'TUNING',
  );
  const response = await deleteModule(
    httpServer,
    authToken,
    statusFixture.projectId,
    statusFixture.ids.targetModuleSystemId,
  );
  expect(response.status).toBe(403);
  await endSession(httpServer, authToken, statusFixture.projectId);
});

it('returns 400 for a malformed projectId', async () => {
  const response = await deleteModule(
    httpServer,
    authToken,
    'not-a-project-id',
    1,
  );
  expect(response.status).toBe(400);
});

it('returns 400 for a malformed spfModuleSystemId', async () => {
  await startSession(
    httpServer,
    authToken,
    statusFixture.projectId,
    'DESIGNER',
  );
  const response = await deleteModule(
    httpServer,
    authToken,
    statusFixture.projectId,
    'not-a-module-id',
  );
  expect(response.status).toBe(400);
  await endSession(httpServer, authToken, statusFixture.projectId);
});

it('returns 404 with ENTITY_NOT_FOUND for an absent module', async () => {
  await startSession(
    httpServer,
    authToken,
    statusFixture.projectId,
    'DESIGNER',
  );
  const response = await deleteModule(
    httpServer,
    authToken,
    statusFixture.projectId,
    99_999_999,
  );
  expect(response.status).toBe(404);
  expect(response.body.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({code: 'ENTITY_NOT_FOUND'}),
    ]),
  );
  await endSession(httpServer, authToken, statusFixture.projectId);
});

it('returns 404 when the module belongs to another project/file', async () => {
  const foreignFixture = await provisionFixture(
    httpServer,
    authToken,
    NON_SUBSYSTEM_FIXTURE,
  );
  await startSession(
    httpServer,
    authToken,
    statusFixture.projectId,
    'DESIGNER',
  );
  const response = await deleteModule(
    httpServer,
    authToken,
    statusFixture.projectId,
    foreignFixture.ids.targetModuleSystemId,
  );
  expect(response.status).toBe(404);
  expect(response.body.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({code: 'ENTITY_NOT_FOUND'}),
    ]),
  );
  await endSession(httpServer, authToken, statusFixture.projectId);
}, 180_000);

it('returns 404 when the module is already deleted in effective session state', async () => {
  const fixture = await provisionFixture(
    httpServer,
    authToken,
    NON_SUBSYSTEM_FIXTURE,
  );
  await startSession(httpServer, authToken, fixture.projectId, 'DESIGNER');
  await deleteModule(
    httpServer,
    authToken,
    fixture.projectId,
    fixture.ids.targetModuleSystemId,
  ).expect(200);
  const response = await deleteModule(
    httpServer,
    authToken,
    fixture.projectId,
    fixture.ids.targetModuleSystemId,
  );
  expect(response.status).toBe(404);
  expect(response.body.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({code: 'ENTITY_NOT_FOUND'}),
    ]),
  );
  await endSession(httpServer, authToken, fixture.projectId);
}, 180_000);

it('returns 422 and preserves the module when its subgraph is imported', async () => {
  await startSession(
    httpServer,
    authToken,
    statusFixture.projectId,
    'DESIGNER',
  );
  const response = await deleteModule(
    httpServer,
    authToken,
    statusFixture.projectId,
    statusFixture.ids.importedModuleSystemId!,
  );
  expect(response.status).toBe(422);
  expect(response.body.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({code: 'ARC-MOD-SUBGRAPH-IMPORTED'}),
    ]),
  );
  const afterFailure = await discoverFixtureIds(
    httpServer,
    authToken,
    statusFixture.projectId,
  );
  expect(afterFailure.importedModuleSystemId).toBe(
    statusFixture.ids.importedModuleSystemId,
  );
  await endSession(httpServer, authToken, statusFixture.projectId);
});
```

Set up `statusFixture` once in this endpoint `describe` with `provisionFixture(...NON_SUBSYSTEM_FIXTURE)`. Use `try/finally` around every started session in the completed test file so a failed assertion cannot leak an active session into later cases.

- [ ] **Step 3: Add failing Designer success and conditional response-shape cases**

Add one fresh-project test per successful response variant:

```typescript
it('returns the non-subsystem deletion summary in a Designer session', async () => {
  const fixture = await provisionFixture(
    httpServer,
    authToken,
    NON_SUBSYSTEM_FIXTURE,
  );
  await startSession(httpServer, authToken, fixture.projectId, 'DESIGNER');
  const response = await deleteModule(
    httpServer,
    authToken,
    fixture.projectId,
    fixture.ids.targetModuleSystemId,
  );

  expect(response.status).toBe(200);
  expect(response.body).not.toHaveProperty('data.groupId');
  expect(response.body.data).toEqual({
    deleted: {
      spfModules: asDeletedIds([fixture.ids.targetModuleSystemId]),
      subgraphs: [],
      containers: asDeletedIds([fixture.ids.targetContainerSystemId]),
      dataLinks: asDeletedLinks(fixture.ids.dataLinks, false),
      controlLinks: asDeletedLinks(fixture.ids.controlLinks, false),
    },
    updated: {usecases: []},
  });
  expect(response.body.data.deleted).not.toHaveProperty(
    'unresolvedSubsystemDataLinks',
  );
  expect(response.body.data.deleted.dataLinks[0]).not.toHaveProperty(
    'subsystemLinks',
  );
  expect(response.body.data.updated).not.toHaveProperty('subsystems');
  await endSession(httpServer, authToken, fixture.projectId);
}, 180_000);

it('returns grouped subsystem details for a subsystem-capable file', async () => {
  const fixture = await provisionFixture(
    httpServer,
    authToken,
    SUBSYSTEM_FIXTURE,
  );
  await startSession(httpServer, authToken, fixture.projectId, 'DESIGNER');
  const response = await deleteModule(
    httpServer,
    authToken,
    fixture.projectId,
    fixture.ids.targetModuleSystemId,
  );

  expect(response.status).toBe(200);
  expect(response.body).not.toHaveProperty('data.groupId');
  expect(response.body.data).toEqual({
    deleted: {
      spfModules: asDeletedIds([fixture.ids.targetModuleSystemId]),
      subgraphs: asDeletedIds([fixture.ids.targetSubgraphSystemId!]),
      containers: asDeletedIds([fixture.ids.targetContainerSystemId]),
      dataLinks: asDeletedLinks(fixture.ids.dataLinks, true),
      controlLinks: asDeletedLinks(fixture.ids.controlLinks, true),
      unresolvedSubsystemDataLinks: asDeletedIds(
        fixture.ids.unresolvedSubsystemDataLinkSystemIds,
      ),
      unresolvedSubsystemControlLinks: asDeletedIds(
        fixture.ids.unresolvedSubsystemControlLinkSystemIds,
      ),
    },
    updated: {
      usecases: asDeletedIds(fixture.ids.updatedUsecaseSystemIds),
      subsystems: [...fixture.ids.updatedSubsystems]
        .sort((left, right) => left.systemId - right.systemId)
        .map(subsystem => ({
          systemId: String(subsystem.systemId),
          intentsClearedControlPorts: asDeletedIds(
            subsystem.intentsClearedControlPortSystemIds,
          ),
        })),
    },
  });
  await endSession(httpServer, authToken, fixture.projectId);
}, 180_000);
```

The subsystem fixture must include at least one canonical link whose `subsystemLinks` is non-empty and one whose `subsystemLinks` is `[]`. Keep the explicit unresolved arrays and `updated.subsystems` assertions even when a fixture category is empty, because FR-DM-29 requires those keys for every subsystem-capable response.

- [ ] **Step 4: Run the endpoint matrix and verify the controller stub is red**

Run: `pnpm --filter @arc/api run test:e2e:api -- --runInBand --testPathPattern="spf-module-delete.e2e-spec.ts"`

Expected: FAIL because the current `deleteSpfModule` method has no `SessionGuard`/`ParseIntPipe`, throws `NotImplementedException`, and never invokes `DeleteSpfModuleCommand`.

- [ ] **Step 5: Type-check and format the complete e2e suite before production changes**

Run: `pnpm exec prettier --check packages/api/tests/e2e/spf-module/spf-module-delete.e2e-spec.ts && pnpm run build:api`

Expected: Prettier and the API build pass; the only failure remains the intentionally red runtime endpoint matrix.

### Task 43: Replace the controller stub and document the Delete Module HTTP contract

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/modules/spf-module/spf-module.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/spf-module/dto/response/spf-module-response.dto.ts`
- Modify: `packages/api/tests/e2e/spf-module/spf-module-delete.e2e-spec.ts`

- [ ] **Step 1: Update controller imports and Swagger model registration**

Add the exact core contracts to the existing `@arc/core` import:

```typescript
DeleteSpfModuleCommand,
type DeleteSpfModuleInternalResult,
```

Add the dedicated API response import:

```typescript
import {DeleteSpfModuleResponseDto} from './dto/response/delete-spf-module-response.dto.js';
```

Remove `RemoveSpfModuleResponseDto` from the grouped `spf-module-response.dto.js` import and from `@ApiExtraModels(...)`. Add `DeleteSpfModuleResponseDto` to `@ApiExtraModels(...)` beside the other SPF module response DTOs.

- [ ] **Step 2: Replace the delete stub with the guarded command adapter and complete Swagger metadata**

Replace the existing `deleteSpfModule` decorators and method with:

```typescript
/**
 * Delete an SPF module and return the deterministic cascade summary.
 */
@Delete('/:spfModuleSystemId')
@ApiParam({
  name: 'spfModuleSystemId',
  required: true,
  type: String,
  description: 'Decimal system ID of the SPF module',
  example: '12345',
})
@ApiDocumentationWithExample({
  summary: 'Delete an SPF module',
  description:
    'Deletes an SPF module in the active Designer session and returns the ' +
    'module, structural entities, links, and affected entities changed by ' +
    'the atomic cascade. Internal operation group IDs are not returned.',
  responses: [
    {
      status: HttpStatus.OK,
      description: 'SPF module deleted successfully',
      dto: DeleteSpfModuleResponseDto,
    },
    {
      status: HttpStatus.BAD_REQUEST,
      description: 'projectId or spfModuleSystemId is not a decimal integer',
    },
    {
      status: HttpStatus.FORBIDDEN,
      description: 'No active session or the session mode is not supported',
    },
    {
      status: HttpStatus.NOT_FOUND,
      description:
        'SPF module was not found in the active project/file effective state',
    },
    {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      description: 'The SPF module belongs to an imported subgraph',
    },
  ],
})
@UseGuards(SessionGuard)
async deleteSpfModule(
  @Param('projectId', ParseIntPipe) _projectId: number,
  @Param('spfModuleSystemId', ParseIntPipe) spfModuleSystemId: number,
  @ArcSession() session: ActiveSession,
): Promise<ApiResult<DeleteSpfModuleResponseDto>> {
  const result =
    await this.commandBus.execute<DeleteSpfModuleInternalResult>(
      new DeleteSpfModuleCommand(spfModuleSystemId),
      session,
    );

  return toApiResult(Result.ok(result.response));
}
```

`_projectId` is intentionally parsed but not passed into the command: the active session's write context remains authoritative for project/file scope. The controller contains no cascade logic, no direct repository call, and no log call. Wrapping only `result.response` with `Result.ok` preserves the common `ApiResult` envelope while omitting internal `groupId`.

- [ ] **Step 3: Remove the obsolete generic delete-response stub**

In `spf-module-response.dto.ts`, remove:

```typescript
import {DeleteSpfModuleResultSchema} from '@arc/core';
import {createZodDto} from 'nestjs-zod';
```

Then remove the complete `RemoveSpfModuleResponseDto` declaration and its stale cascade comment. Keep all unrelated CKV/TKV response DTOs unchanged.

- [ ] **Step 4: Run the complete Delete Module e2e suite**

Run: `pnpm --filter @arc/api run test:e2e:api -- --runInBand --testPathPattern="spf-module-delete.e2e-spec.ts"`

Expected: PASS for Designer success, no session, unsupported mode, both malformed path parameters, absent/cross-project/effectively deleted modules, imported subgraph, non-subsystem response, and subsystem-capable response. The success bodies contain decimal-string IDs and no `groupId`.

- [ ] **Step 5: Build, lint, and inspect the API-only implementation boundary**

Run: `pnpm run build:api && pnpm run lint && rg -n "DeleteSpfModule(Command|InternalResult|ResponseDto)|ParseIntPipe|SessionGuard|ArcSession|Result\.ok\(result\.response\)" packages/api/src/presentation/rest/modules/spf-module/spf-module.controller.ts packages/api/src/presentation/rest/modules/spf-module/dto/response/delete-spf-module-response.dto.ts && rg -n "console\.log|NotImplementedException|groupId" packages/api/src/presentation/rest/modules/spf-module/spf-module.controller.ts | tail -20`

Expected: build and lint pass; the delete method has the command, both pipes, guard, session injection, and response-only mapping; no delete-method `console.log`, `NotImplementedException`, or public `groupId` remains. Unrelated controller stubs may still contain `NotImplementedException` elsewhere in the file.

### Task 44: Regenerate Swagger and run final repository verification

**Package:** repository-wide

**Files:**
- Modify: `docs/swagger-api.json`

- [ ] **Step 1: Regenerate Swagger from the implemented controller metadata**

Run: `pnpm run generate:swagger`

Expected: PASS and `docs/swagger-api.json` is regenerated from the current controller/DTO metadata.

- [ ] **Step 2: Validate the generated DELETE operation structurally**

Run:

```bash
node --input-type=module -e "
import {readFileSync} from 'node:fs';
const document = JSON.parse(readFileSync('docs/swagger-api.json', 'utf8'));
const path = '/arc-api/v1/projects/{projectId}/spf-modules/{spfModuleSystemId}';
const operation = document.paths?.[path]?.delete;
if (!operation) throw new Error('Delete Module operation is missing');
for (const status of ['200', '400', '403', '404', '422']) {
  if (!operation.responses?.[status]) throw new Error('Missing response ' + status);
}
if (operation.responses?.['207']) throw new Error('Atomic DELETE must not document 207');
if (operation.requestBody) throw new Error('DELETE endpoint must not document a body');
const dto = document.components?.schemas?.DeleteSpfModuleResponseDto;
if (!dto) throw new Error('DeleteSpfModuleResponseDto schema is missing');
const deleted = dto.properties?.deleted?.properties;
const updated = dto.properties?.updated?.properties;
for (const field of ['spfModules', 'subgraphs', 'containers', 'dataLinks', 'controlLinks']) {
  if (!deleted?.[field]) throw new Error('Missing deleted.' + field);
}
if (!updated?.usecases) throw new Error('Missing updated.usecases');
if (dto.properties?.groupId) throw new Error('groupId leaked into the public schema');
"
```

Expected: exit code 0; the route documents 200/400/403/404/422, no 207 or request body, the Delete Module response schema is present, and `groupId` is absent.

- [ ] **Step 3: Re-run the focused API contract verification**

Run: `pnpm --filter @arc/api run test:e2e:api -- --runInBand --testPathPattern="spf-module-delete.e2e-spec.ts" && pnpm run build:api`

Expected: PASS; generated Swagger work did not alter runtime behavior or API compilation.

- [ ] **Step 4: Run repository-level build and lint**

Run: `pnpm run build && pnpm run lint`

Expected: PASS across `@arc/core`, `@arc/api`, persistence, and filesystem packages with no ESM-extension, type, or lint regressions.

- [ ] **Step 5: Run the full test suite and final scope checks**

Run: `pnpm test && git diff --check && rg -n "BinaryUtils\.toHexString|delete_spf_module_(start|success|failed)" packages/core/src/application/usecase-designer/spf-module/delete/delete-spf-module.handler.ts && rg -n "RemoveSpfModuleResponseDto|Delete SPF module functionality is not implemented" packages/api/src packages/api/tests docs/swagger-api.json || true`

Expected: all unit, integration, and e2e tests pass; `git diff --check` reports no whitespace errors; the existing Delete Module handler still uses hexadecimal structured logging for start/success/failure; the legacy delete DTO/stub scan prints nothing. The final diff contains only the API response DTO, controller, generated Swagger, Delete Module e2e fixtures/tests, and this chapter; it contains no persistence or core service implementation changes.

### Commit: Delete Module API and End-to-End Coverage

Use the `commit` skill to draft the commit message. Show the proposed message
and the exact commands to the user and **wait for explicit confirmation** before
running anything:

```bash
git add packages/api/src/presentation/rest/modules/spf-module/dto/response/delete-spf-module-response.dto.ts \
        packages/api/src/presentation/rest/modules/spf-module/dto/response/spf-module-response.dto.ts \
        packages/api/src/presentation/rest/modules/spf-module/spf-module.controller.ts \
        packages/api/tests/e2e/fixtures/deleteModuleNonSubsystem.awsp \
        packages/api/tests/e2e/fixtures/deleteModuleSubsystem.awsp \
        packages/api/tests/e2e/spf-module/spf-module-delete.e2e-spec.ts \
        docs/swagger-api.json \
        docs/module-write/plans/chapters/06-01-api-and-e2e.md
git commit -m "feat(api): add delete module endpoint" \
           -m "Expose the Designer-session Delete Module command through the guarded REST controller, publish its conditional response schema, regenerate Swagger, and cover status and response variants end to end." \
           -m "Signed-off-by: [Name] <[email]>"
```

**STOP — do not run `git commit` until the user explicitly approves the message.**
