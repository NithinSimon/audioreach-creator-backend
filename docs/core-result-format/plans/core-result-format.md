# Core Result Format Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the core-layer outcome envelope by introducing a base `Issue` vocabulary in `shared/issues/`, a discriminated-union `Result<T>` in `application/shared/result/`, refactoring `ValidationIssue` to extend `Issue`, and collapsing the API-layer `ApiResult<T>` to `{data?, issues?}`.

**Architecture:** Discriminated-union `Result<T>` (kind: `'ok' | 'partial' | 'fail'`) with `Result` namespace factories. Base `Issue` interface in `packages/core/src/shared/issues/`. `ValidationIssue extends Issue`. Totality-based HTTP boundary — handlers throw `DomainException` for unstructured failures, return `Result<T>` for structured outcomes; controllers use `throwIfFailed()` + `toApiResult()` at the edge with a prefix-matching `http-status-map`.

**Tech Stack:** TypeScript, NestJS, TypeORM, SQLite, Jest

**Prerequisite:** PR #85 must merge to the base branch before executing Batch 1. This plan subsumes PR #85's `ResultIssue`/`ApiIssueItem`/`ApiFixOptionDto` scaffolding — do not attempt to run tasks in parallel with PR #85.

**Spec:** [`docs/core-result-format/design/core-result-format-design.md`](../design/core-result-format-design.md)
**Requirements:** [`docs/core-result-format/requirements/core-result-format-requirements.md`](../requirements/core-result-format-requirements.md)

**Task numbering note:** Tasks are numbered 1-50 with a single gap at Task 13 (chapter 02-02 was scoped to 6 tasks starting at 14 while chapter 02-01 ended at 12). Renumbering is intentionally skipped — task IDs are stable references from the chapter subagent handoff. Executing-plans handles gaps transparently.

---
<!--
Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
SPDX-License-Identifier: BSD-3-Clause
-->

## Chapter 01-01: `shared/issues/` Foundation

**Scope:** Create the new `packages/core/src/shared/issues/` module — the base `Issue` vocabulary that `ValidationIssue` will later extend. Content is lifted from `packages/core/src/domain/validation/issue.ts` verbatim except for the `VALIDATION_ENTITY_TYPE` → `ISSUE_ENTITY_TYPE` rename. Adds the operational `IssueFactory` (Q-F: `notFound`, `dbError`, `parseError`, `dataLoss`). No callers are updated in this chapter — the source file at `domain/validation/issue.ts` stays in place until a later chapter deletes/shrinks it.

**Design references:** design §2.1–§2.7, requirements FR-4.

---

### Task 1: Create `severity.ts`

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/shared/issues/severity.ts`

- [ ] **Step 1: Write the new file**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

export const IssueSeverity = {
  Fatal: 'FATAL',
  Error: 'ERROR',
  Warning: 'WARNING',
} as const;
export type IssueSeverity = (typeof IssueSeverity)[keyof typeof IssueSeverity];

export const IssueCategory = {
  Blocking: 'BLOCKING',
  NonBlocking: 'NON_BLOCKING',
  DataLoss: 'DATA_LOSS', // Data was not inserted into DB during upload
} as const;
export type IssueCategory = (typeof IssueCategory)[keyof typeof IssueCategory];

/**
 * Ordered severity levels from least to most severe.
 * Used to validate that severity overrides are strictly escalating.
 */
export const SEVERITY_ORDER: ReadonlyArray<IssueSeverity> = [
  IssueSeverity.Warning,
  IssueSeverity.Error,
  IssueSeverity.Fatal,
] as const;

/**
 * Maps severity to BLOCKING or NON_BLOCKING.
 * DATA_LOSS is set explicitly by the insertion failure code — not derived from severity.
 */
export function deriveCategoryFromSeverity(
  severity: IssueSeverity,
): IssueCategory {
  return severity === IssueSeverity.Fatal || severity === IssueSeverity.Error
    ? IssueCategory.Blocking
    : IssueCategory.NonBlocking;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm run build:core`
Expected: PASS (no new errors introduced by `severity.ts`).

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/shared/issues/severity.ts
  git commit -m "feat(core): add IssueSeverity, IssueCategory, SEVERITY_ORDER in shared/issues" \
             -m "Lifted verbatim from domain/validation/issue.ts to establish the base issue vocabulary in shared/issues/. Includes deriveCategoryFromSeverity helper. Design §2.2, FR-4.5." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 2: Create `impacted-entity.ts`

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/shared/issues/impacted-entity.ts`

- [ ] **Step 1: Write the new file**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Entity types that can appear in an Issue's impactedEntity.
 * A curated subset of domain entities — only those that validation rules
 * and operational issues actually report against.
 *
 * Renamed from VALIDATION_ENTITY_TYPE because these values are now used by
 * both validation and operational issues (design §2.3, FR-4.5).
 *
 * Defined in core (not infrastructure) to keep the domain layer independent
 * of TypeORM entity names. Add new values here as callers require them.
 */
export const ISSUE_ENTITY_TYPE = {
  SpfModule: 'SpfModule',
  DataLink: 'DataLink',
  ControlLink: 'ControlLink',
  Subgraph: 'Subgraph',
  UseCase: 'UseCase',
  Container: 'Container',
  SpfModuleDefinition: 'SpfModuleDefinition',
} as const;
export type IssueEntityType =
  (typeof ISSUE_ENTITY_TYPE)[keyof typeof ISSUE_ENTITY_TYPE];

export interface ImpactedEntity {
  /** The type of entity that has the issue. */
  entityType: IssueEntityType;
  systemId: number;
  /** Human-readable name for display (e.g., module alias). */
  displayName?: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm run build:core`
Expected: PASS.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/shared/issues/impacted-entity.ts
  git commit -m "feat(core): add ISSUE_ENTITY_TYPE, IssueEntityType, ImpactedEntity in shared/issues" \
             -m "Renamed from VALIDATION_ENTITY_TYPE — the values are now used by both validation and operational issues, so the old name is misleading. Design §2.3, FR-4.5." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 3: Create `fix-option.ts`

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/shared/issues/fix-option.ts`

- [ ] **Step 1: Write the new file**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

export const CLIENT_INPUT_TYPE = {
  Number: 'NUMBER',
  String: 'STRING',
  Boolean: 'BOOLEAN',
} as const;
export type ClientInputType =
  (typeof CLIENT_INPUT_TYPE)[keyof typeof CLIENT_INPUT_TYPE];

export interface ClientInputSpec {
  /**
   * The key in `commandPayload` that the client must fill in.
   * This field is currently `null` in the payload — the client prompts the user
   * and sets this value before calling POST /apply-fix.
   * Example: "sourceModuleInstanceId"
   */
  field: string;

  /**
   * Human-readable label shown to the user in the UI prompt.
   * Example: "Provide source module instance ID"
   */
  label: string;

  /**
   * The input type to render in the UI — determines what kind of value to collect.
   * NUMBER → numeric input, STRING → text input, BOOLEAN → checkbox/toggle.
   */
  type: ClientInputType;
}

export interface FixOption {
  /** e.g. "delete-duplicate-link" */
  id: string;
  description: string;
  commandType: string;
  commandPayload: Record<string, unknown>;
  requiredClientInputs: ClientInputSpec[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm run build:core`
Expected: PASS.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/shared/issues/fix-option.ts
  git commit -m "feat(core): add FixOption, ClientInputSpec, CLIENT_INPUT_TYPE in shared/issues" \
             -m "Lifted verbatim from domain/validation/issue.ts. Design §2.4, FR-4.5." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 4: Create `issue.ts` — the base `Issue` interface

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/shared/issues/issue.ts`

- [ ] **Step 1: Write the new file**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {IssueSeverity, IssueCategory} from './severity.js';
import type {ImpactedEntity} from './impacted-entity.js';
import type {FixOption} from './fix-option.js';

/**
 * Base issue vocabulary. Carried by Result<T>.issues and mirrored on the wire
 * as ApiIssueItem.
 *
 * Operational failures populate {code, message, severity} at minimum.
 * Domain validation issues (ValidationIssue extends Issue) additionally
 * populate category, impactedEntity, impactedUsecases, and fixOptions.
 *
 * Design §2.5, FR-4.1.
 */
export interface Issue {
  code: string;
  message: string;
  severity: IssueSeverity;
  category?: IssueCategory;
  impactedEntity?: ImpactedEntity;
  impactedUsecases?: number[];
  fixOptions?: FixOption[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm run build:core`
Expected: PASS.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/shared/issues/issue.ts
  git commit -m "feat(core): add base Issue interface in shared/issues" \
             -m "Base issue vocabulary carried by Result<T>.issues. Operational failures use it directly; ValidationIssue extends it. Design §2.5, FR-4.1." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 5: Create `factories.ts` — `IssueFactory` for operational issues

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/shared/issues/factories.ts`
- Test:   `packages/core/tests/unit/shared/issues/factories.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/unit/shared/issues/factories.spec.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, it, expect} from '@jest/globals';
import {IssueFactory} from '../../../../src/shared/issues/factories.js';
import {IssueSeverity, IssueCategory} from '../../../../src/shared/issues/severity.js';
import {ISSUE_ENTITY_TYPE} from '../../../../src/shared/issues/impacted-entity.js';
import type {FixOption} from '../../../../src/shared/issues/fix-option.js';

describe('IssueFactory', () => {
  describe('notFound', () => {
    it('should produce an ENTITY_NOT_FOUND issue with severity Error', () => {
      const issue = IssueFactory.notFound(ISSUE_ENTITY_TYPE.SpfModule, 42);

      expect(issue.code).toBe('ENTITY_NOT_FOUND');
      expect(issue.message).toBe('SpfModule not found (systemId: 42)');
      expect(issue.severity).toBe(IssueSeverity.Error);
      expect(issue.impactedEntity).toEqual({
        entityType: ISSUE_ENTITY_TYPE.SpfModule,
        systemId: 42,
      });
    });

    it('should include displayName in impactedEntity when provided', () => {
      const issue = IssueFactory.notFound(
        ISSUE_ENTITY_TYPE.DataLink,
        7,
        'MicToSpeaker',
      );

      expect(issue.impactedEntity).toEqual({
        entityType: ISSUE_ENTITY_TYPE.DataLink,
        systemId: 7,
        displayName: 'MicToSpeaker',
      });
    });

    it('should omit displayName when not provided', () => {
      const issue = IssueFactory.notFound(ISSUE_ENTITY_TYPE.Container, 3);

      expect(issue.impactedEntity).not.toHaveProperty('displayName');
    });
  });

  describe('dbError', () => {
    it('should produce a DB_QUERY_FAILED issue with severity Error', () => {
      const issue = IssueFactory.dbError('connection timeout');

      expect(issue.code).toBe('DB_QUERY_FAILED');
      expect(issue.message).toBe('connection timeout');
      expect(issue.severity).toBe(IssueSeverity.Error);
      expect(issue.impactedEntity).toBeUndefined();
    });

    it('should attach impactedEntity when provided', () => {
      const issue = IssueFactory.dbError('row missing', {
        entityType: ISSUE_ENTITY_TYPE.Subgraph,
        systemId: 11,
      });

      expect(issue.impactedEntity).toEqual({
        entityType: ISSUE_ENTITY_TYPE.Subgraph,
        systemId: 11,
      });
    });
  });

  describe('parseError', () => {
    it('should produce an issue with the caller-supplied code and message', () => {
      const issue = IssueFactory.parseError(
        'ACDB_CHUNK_MALFORMED',
        'chunk size mismatch',
      );

      expect(issue.code).toBe('ACDB_CHUNK_MALFORMED');
      expect(issue.message).toBe('chunk size mismatch');
      expect(issue.severity).toBe(IssueSeverity.Error);
      expect(issue.impactedEntity).toBeUndefined();
      expect(issue.category).toBeUndefined();
    });
  });

  describe('dataLoss', () => {
    it('should produce a Warning + DATA_LOSS issue with impactedEntity', () => {
      const issue = IssueFactory.dataLoss(
        'ARC-INSERT-MOD-001',
        'duplicate instance id',
        {
          entityType: ISSUE_ENTITY_TYPE.SpfModule,
          systemId: 99,
          displayName: 'AudioMixer',
        },
      );

      expect(issue.code).toBe('ARC-INSERT-MOD-001');
      expect(issue.message).toBe('duplicate instance id');
      expect(issue.severity).toBe(IssueSeverity.Warning);
      expect(issue.category).toBe(IssueCategory.DataLoss);
      expect(issue.impactedEntity).toEqual({
        entityType: ISSUE_ENTITY_TYPE.SpfModule,
        systemId: 99,
        displayName: 'AudioMixer',
      });
      expect(issue.fixOptions).toBeUndefined();
    });

    it('should attach non-empty fixOptions when provided', () => {
      const fixOptions: FixOption[] = [
        {
          id: 'delete-duplicate',
          description: 'Delete the duplicate',
          commandType: 'DELETE_MODULE',
          commandPayload: {systemId: 99},
          requiredClientInputs: [],
        },
      ];

      const issue = IssueFactory.dataLoss(
        'ARC-INSERT-MOD-001',
        'duplicate instance id',
        {entityType: ISSUE_ENTITY_TYPE.SpfModule, systemId: 99},
        fixOptions,
      );

      expect(issue.fixOptions).toEqual(fixOptions);
    });

    it('should omit fixOptions when an empty array is provided', () => {
      const issue = IssueFactory.dataLoss(
        'ARC-INSERT-MOD-002',
        'missing definition',
        {entityType: ISSUE_ENTITY_TYPE.SpfModule, systemId: 12},
        [],
      );

      expect(issue.fixOptions).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/core run test:core -- --testPathPattern="shared/issues/factories.spec.ts"`
Expected: FAIL with "Cannot find module '../../../../src/shared/issues/factories.js'" (module does not yet exist).

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/shared/issues/factories.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Issue} from './issue.js';
import {IssueSeverity, IssueCategory} from './severity.js';
import type {IssueEntityType, ImpactedEntity} from './impacted-entity.js';
import type {FixOption} from './fix-option.js';

/**
 * Factory functions for constructing operational Issues.
 *
 * Named IssueFactory (not Issue.notFound) because Issue is a type — TypeScript
 * cannot attach static methods to an interface.
 *
 * Ship-in-v1 set: notFound, dbError, parseError, dataLoss. Extend as new
 * operational categories emerge. Design §2.6, FR-4.6.
 */
export const IssueFactory = {
  notFound(
    entityType: IssueEntityType,
    systemId: number,
    displayName?: string,
  ): Issue {
    return {
      code: 'ENTITY_NOT_FOUND',
      message: `${entityType} not found (systemId: ${systemId})`,
      severity: IssueSeverity.Error,
      impactedEntity: {
        entityType,
        systemId,
        ...(displayName && {displayName}),
      },
    };
  },

  dbError(message: string, impactedEntity?: ImpactedEntity): Issue {
    return {
      code: 'DB_QUERY_FAILED',
      message,
      severity: IssueSeverity.Error,
      ...(impactedEntity && {impactedEntity}),
    };
  },

  parseError(code: string, message: string): Issue {
    return {
      code,
      message,
      severity: IssueSeverity.Error,
    };
  },

  dataLoss(
    code: string,
    message: string,
    impactedEntity: ImpactedEntity,
    fixOptions?: FixOption[],
  ): Issue {
    return {
      code,
      message,
      severity: IssueSeverity.Warning,
      category: IssueCategory.DataLoss,
      impactedEntity,
      ...(fixOptions && fixOptions.length > 0 && {fixOptions}),
    };
  },
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/core run test:core -- --testPathPattern="shared/issues/factories.spec.ts"`
Expected: PASS (all `IssueFactory` describe blocks green — `notFound`, `dbError`, `parseError`, `dataLoss`).

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/shared/issues/factories.ts packages/core/tests/unit/shared/issues/factories.spec.ts
  git commit -m "feat(core): add IssueFactory (notFound, dbError, parseError, dataLoss)" \
             -m "Operational Issue factories replacing ad-hoc {code, message, severity} literals. Design §2.6, FR-4.6, Q-F." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 6: Create the `shared/issues/` barrel

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/shared/issues/index.ts`

- [ ] **Step 1: Write the new file**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

export * from './severity.js';
export * from './impacted-entity.js';
export * from './fix-option.js';
export * from './issue.js';
export * from './factories.js';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm run build:core`
Expected: PASS.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/shared/issues/index.ts
  git commit -m "feat(core): add shared/issues barrel" \
             -m "Barrel re-export for the new base Issue vocabulary. Design §2.7." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 7: Re-export `shared/issues` from the core package root

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the re-export**

Add the following block to `packages/core/src/index.ts`. Place it directly above the existing `// Validation framework — domain types` block so the new base vocabulary is visible before the validation types that will later depend on it:

```typescript
// Shared Issue vocabulary — base type for Result<T>.issues (design §2, FR-4)
export * from './shared/issues/index.js';
```

The surrounding context after edit looks like:

```typescript
// TODO: These items should be moved to shared
// AWSP serializer v1 - configuration types (MODULE_PORT_STRATEGIES, PROCESSOR_DOMAINS, etc.)
export * from './application/file-operations/shared/awsp-serializers/v1/configuration/index.js';

// Shared Issue vocabulary — base type for Result<T>.issues (design §2, FR-4)
export * from './shared/issues/index.js';
```

Note: `domain/validation/issue.ts` still exports its own `IssueSeverity`, `IssueCategory`, `SEVERITY_ORDER`, `deriveCategoryFromSeverity`, `VALIDATION_ENTITY_TYPE`, `ValidationEntityType`, `ImpactedEntity`, `FixOption`, `ClientInputSpec`, `CLIENT_INPUT_TYPE`, `ClientInputType` — these are the *same* string-valued const objects and interfaces. Because barrel wildcard exports in TypeScript surface a symbol only if it is unambiguous, adding the `shared/issues` re-export while the validation module still exports identical names would trigger duplicate-export errors at consumers of `@arc/core`. To keep this chapter self-contained and non-breaking, the *identically named* exports in `domain/validation/issue.ts` will be dropped in a later chapter that shrinks `ValidationIssue` (design §4.1, FR-4.4). Until then, this chapter avoids the collision by placing the new `shared/issues` re-export **before** the `domain/validation/issue.js` re-export in `index.ts` — wildcard re-exports later in the file cannot shadow earlier ones, but they *do* re-export the same names. Verify at Step 2 that no duplicate-export error appears; if one does, this chapter is unblocked only after `domain/validation/issue.ts` is shrunk (see chapter for §4.1).

If the build reports duplicate exports, the fallback is a **named re-export** that avoids the collision entirely — replace the wildcard line with the following explicit list, which only surfaces symbols unique to `shared/issues`:

```typescript
// Shared Issue vocabulary — base type for Result<T>.issues (design §2, FR-4)
export type {Issue} from './shared/issues/issue.js';
export {IssueFactory} from './shared/issues/factories.js';
export {ISSUE_ENTITY_TYPE} from './shared/issues/impacted-entity.js';
export type {IssueEntityType} from './shared/issues/impacted-entity.js';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm run build:core`
Expected: PASS. If a duplicate-export error is reported, apply the named-re-export fallback shown in Step 1.

- [ ] **Step 3: Run the full core unit test suite**

Run: `pnpm --filter @arc/core run test:core`
Expected: PASS. All existing tests still green; new `factories.spec.ts` also green.

- [ ] **Step 4: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/index.ts
  git commit -m "feat(core): re-export shared/issues from @arc/core root" \
             -m "Exposes Issue, IssueFactory, ISSUE_ENTITY_TYPE, IssueEntityType and related types to cross-package consumers so upcoming Result<T> and API-layer chapters can import from @arc/core. Design §2.7." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.
<!--
Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
SPDX-License-Identifier: BSD-3-Clause
-->

## Chapter 02-01: `Result<T>` — the outcome envelope

**Scope:** Replace the current class-based `Result<T>` (`packages/core/src/application/shared/Result/operation-result.ts`) with a tagged **discriminated union** plus a `Result` namespace of factory functions (`ok`, `partial`, `fail`) at the new lowercase path `packages/core/src/application/shared/result/result.ts`. Delete the two placeholder types (`shared/types/operation-result.ts`, `shared/types/api-result.ts`). Wire the new module through the package barrel.

**Runtime invariants** (design §3.2, requirements FR-3, I-1, I-2, I-3):

- `Result.partial(data, issues)` throws if `issues` is empty — call `Result.ok` for issue-free success.
- `Result.fail(...issues)` throws if no issues are passed.
- `Result.ok(data, issues?)` coerces an empty-array `issues` argument to a variant without the `issues` field so consumers never see a synthetic empty array.

**No predicate helpers.** Consumers use `result.kind === 'fail'` / `'partial'` / `'ok'` for exhaustive narrowing (design §3.2, FR-3).

**Callers not migrated in this chapter.** The seven query-service ports, the two query handlers (`query-spf-modules.handler.ts`, `query-containers.handler.ts`), `ProjectRepository`, and the three upload-file files (`upload-file.handler.ts`, `upload-file-orchestrator.ts`, `issue-collection.ts`) still import from the paths deleted in Tasks 11–12. Those import sites are updated in Chapter 03-xx (validation refactor) and Chapter 04-xx (core callers) per design §8 "Batch 4 — Core callers". Because this refactor is a **big-bang single PR** (M-1), intermediate commits within the chapter are expected not to typecheck end-to-end; each task below runs the focused unit test rather than the full workspace build.

**Design references:** design §3.1–§3.4, requirements FR-2, FR-3, FR-5, I-1, I-2, I-3, I-5, I-6.

**Depends on:** Chapter 01-01 (Tasks 1–7). This chapter imports `Issue` from `packages/core/src/shared/issues/index.js`.

---

### Task 8: TDD the `Result<T>` discriminated union and `Result` namespace factories

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/application/shared/result/result.ts`
- Test:   `packages/core/tests/unit/application/shared/result/result.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/unit/application/shared/result/result.spec.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {describe, it, expect} from '@jest/globals';
import {Result} from '../../../../../src/application/shared/result/result.js';
import type {Issue} from '../../../../../src/shared/issues/issue.js';
import {IssueSeverity} from '../../../../../src/shared/issues/severity.js';

const errIssue: Issue = {
  code: 'TEST_ERROR',
  message: 'test error',
  severity: IssueSeverity.Error,
};

const warnIssue: Issue = {
  code: 'TEST_WARN',
  message: 'test warning',
  severity: IssueSeverity.Warning,
};

describe('Result<T>', () => {
  describe('Result.ok', () => {
    it('produces an ok variant with data and no issues field when called without issues', () => {
      const result = Result.ok(42);

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.data).toBe(42);
      }
      expect('issues' in result).toBe(false);
    });

    it('produces an ok variant with data and issues when non-empty warnings are supplied', () => {
      const result = Result.ok(42, [warnIssue]);

      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.data).toBe(42);
        expect(result.issues).toEqual([warnIssue]);
      }
    });

    it('omits the issues field entirely when an empty array is passed', () => {
      const result = Result.ok('payload', []);

      expect(result.kind).toBe('ok');
      expect('issues' in result).toBe(false);
    });
  });

  describe('Result.partial', () => {
    it('produces a partial variant with data and non-empty issues', () => {
      const result = Result.partial([1, 2], [errIssue]);

      expect(result.kind).toBe('partial');
      if (result.kind === 'partial') {
        expect(result.data).toEqual([1, 2]);
        expect(result.issues).toEqual([errIssue]);
      }
    });

    it('throws when issues is empty', () => {
      expect(() => Result.partial([1, 2], [])).toThrow(
        /Result\.partial\(\) requires at least one issue/,
      );
    });
  });

  describe('Result.fail', () => {
    it('produces a fail variant carrying the supplied issues', () => {
      const result = Result.fail(errIssue, warnIssue);

      expect(result.kind).toBe('fail');
      if (result.kind === 'fail') {
        expect(result.issues).toEqual([errIssue, warnIssue]);
      }
    });

    it('throws when no issues are supplied', () => {
      expect(() => Result.fail()).toThrow(
        /Result\.fail\(\) requires at least one issue/,
      );
    });
  });

  describe('discriminated-union narrowing', () => {
    it('narrows the ok variant so data is accessible', () => {
      const result: Result<number> = Result.ok(7);

      if (result.kind === 'ok') {
        // Compile-time: result.data has type `number`.
        const value: number = result.data;
        expect(value).toBe(7);
      } else {
        throw new Error('expected ok variant');
      }
    });

    it('narrows the partial variant so both data and issues are accessible', () => {
      const result: Result<string> = Result.partial('hello', [errIssue]);

      if (result.kind === 'partial') {
        const value: string = result.data;
        const issues: readonly Issue[] = result.issues;
        expect(value).toBe('hello');
        expect(issues).toEqual([errIssue]);
      } else {
        throw new Error('expected partial variant');
      }
    });

    it('prevents data access on the fail variant at compile time', () => {
      const result: Result<number> = Result.fail<number>(errIssue);

      if (result.kind === 'fail') {
        // The following line MUST fail to typecheck. If the union is written
        // correctly, `data` is not a property of the fail variant.
        // @ts-expect-error - 'data' does not exist on the 'fail' variant of Result<T>
        const forbidden = result.data;
        // Runtime: property is genuinely absent.
        expect(forbidden).toBeUndefined();
      } else {
        throw new Error('expected fail variant');
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="application/shared/result/result.spec.ts"`
Expected: FAIL with `Cannot find module '../../../../../src/application/shared/result/result.js' from 'tests/unit/application/shared/result/result.spec.ts'` (implementation file does not yet exist).

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/application/shared/result/result.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Issue} from '../../../shared/issues/index.js';

/**
 * Outcome envelope for query and command handlers.
 *
 * Three tagged variants:
 *   ok       — data produced; optional non-blocking issues (warnings)
 *   partial  — data produced with per-item or per-field ERROR/FATAL issues
 *   fail     — no data; outcome expressed as structured issues (validation
 *              rejection with fixOptions, request-shape rejection with hints).
 *              Handlers throw a DomainException for unstructured total failures.
 *
 * Design §3.1, FR-2, FR-3, I-1, I-5, I-6.
 */
export type Result<T> =
  | {readonly kind: 'ok'; readonly data: T; readonly issues?: readonly Issue[]}
  | {readonly kind: 'partial'; readonly data: T; readonly issues: readonly Issue[]}
  | {readonly kind: 'fail'; readonly issues: readonly Issue[]};

/**
 * Factory namespace for constructing Result<T> values.
 *
 * Named Result (same as the type) because TypeScript allows a value and a type
 * to share a name — call-sites read `Result.ok(...)` / `Result.fail(...)`.
 *
 * Runtime invariants (design §3.2, FR-3.2, FR-3.3, I-2, I-3):
 *   - partial() throws if issues is empty (use ok() for issue-free success)
 *   - fail() throws if no issues are supplied
 *   - ok() with an empty issues array returns a variant with no issues field
 *     so consumers never see a synthetic empty array
 *
 * No predicate helpers (isOk / isFail / isPartial) — the `kind` discriminant
 * is self-documenting and exhaustive (FR-3, design §3.2).
 */
export const Result = {
  ok<T>(data: T, issues?: readonly Issue[]): Result<T> {
    if (issues && issues.length > 0) {
      return {kind: 'ok', data, issues};
    }
    return {kind: 'ok', data};
  },

  partial<T>(data: T, issues: readonly Issue[]): Result<T> {
    if (issues.length === 0) {
      throw new Error(
        'Result.partial() requires at least one issue — use Result.ok() for issue-free success',
      );
    }
    return {kind: 'partial', data, issues};
  },

  fail<T = never>(...issues: readonly Issue[]): Result<T> {
    if (issues.length === 0) {
      throw new Error('Result.fail() requires at least one issue');
    }
    return {kind: 'fail', issues};
  },
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="application/shared/result/result.spec.ts"`
Expected: PASS. All describe blocks green — `Result.ok`, `Result.partial`, `Result.fail`, `discriminated-union narrowing` (including the `@ts-expect-error`-guarded compile-time narrowing test on the `fail` variant).

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/shared/result/result.ts packages/core/tests/unit/application/shared/result/result.spec.ts
  git commit -m "feat(core): add Result<T> discriminated union and Result namespace factories" \
             -m "Introduces the new outcome envelope at application/shared/result/result.ts as a tagged union with ok/partial/fail variants and a Result namespace exposing ok(), partial(), fail() factories. Enforces runtime invariants (partial and fail throw on empty issues; ok coerces an empty issues array to no issues field) and compile-time narrowing (data is inaccessible on the fail variant). Design §3.1-§3.2, FR-2, FR-3, I-1, I-2, I-3, I-5, I-6." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 9: Re-export the new `Result` module from the core package barrel

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/index.ts`

Adds the new `application/shared/result/result.js` re-export and removes the old capital-`R` re-export in the same edit so `import {Result} from '@arc/core'` resolves unambiguously to the new discriminated-union module. This closes the naming collision between the deprecated `Result` class and the new `Result` union+namespace before Task 10 physically removes the old file.

- [ ] **Step 1: Replace the old Result re-export with the new one**

In `packages/core/src/index.ts`, find the block:

```typescript
export * from './shared/types/operation-result.js';
export * from './domain/entities/definitions/common/types/param-type.js';
export * from './application/shared/Result/operation-result.js';
export * from './shared/types/api-result.js';
```

Replace it with:

```typescript
export * from './shared/types/operation-result.js';
export * from './domain/entities/definitions/common/types/param-type.js';
// New Result<T> discriminated union + namespace (design §3, FR-2, FR-3).
// Replaces the previous class-based Result exported from application/shared/Result/.
export * from './application/shared/result/result.js';
export * from './shared/types/api-result.js';
```

Rationale for edit shape: `shared/types/operation-result.js` and `shared/types/api-result.js` are removed in Tasks 11 and 12 respectively; leaving those two lines here for now keeps this task's diff limited to the single Result-related swap. Cross-file coupling is avoided.

- [ ] **Step 2: Run the Result unit test through the barrel**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="application/shared/result/result.spec.ts"`
Expected: PASS. The spec imports from the source path directly (not the barrel), so this run confirms the barrel swap did not regress the spec that already passed in Task 8.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/index.ts
  git commit -m "refactor(core): route @arc/core Result export to the new discriminated union" \
             -m "Swaps the barrel re-export from application/shared/Result/operation-result.js (deprecated class) to application/shared/result/result.js (new union + namespace). No other symbols are affected in this commit; consumers importing Result from @arc/core continue to compile, now against the new type. Design §3, FR-2." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 10: Delete the legacy `application/shared/Result/` folder (folder rename)

**Package:** `@arc/core`

**Files:**
- Delete: `packages/core/src/application/shared/Result/operation-result.ts`
- Delete: `packages/core/src/application/shared/Result/` (empty folder)

Completes the folder rename from capital-`R` `Result/` to lowercase `result/`. Callers that still import from `../../../shared/Result/operation-result.js` (7 query-service ports, 2 query handlers) are migrated in Chapter 04-xx (Batch 4 — Core callers) per design §8. Because M-1 mandates a big-bang PR, intermediate commits within the chapter are not required to typecheck end-to-end; the focused Result unit test is what gates this task.

- [ ] **Step 1: Delete the old file**

Run:

```bash
rm packages/core/src/application/shared/Result/operation-result.ts
rmdir packages/core/src/application/shared/Result
```

On Windows shells:

```bash
del "packages\core\src\application\shared\Result\operation-result.ts"
rmdir "packages\core\src\application\shared\Result"
```

- [ ] **Step 2: Verify the new Result module is still reachable**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="application/shared/result/result.spec.ts"`
Expected: PASS. The deletion removes the deprecated class but leaves the new `application/shared/result/result.ts` intact.

Note: `pnpm run build:core` is expected to **fail** at this point because 9 downstream files still import from the deleted path. Those imports are updated in Chapter 04-xx. Do not attempt to fix them here.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add -A packages/core/src/application/shared/Result packages/core/src/application/shared/result
  git commit -m "refactor(core): delete legacy Result class, complete folder rename to result/" \
             -m "Removes packages/core/src/application/shared/Result/operation-result.ts (capital-R folder), completing the rename to the lowercase application/shared/result/ folder created in Task 8. Downstream import sites (query services, query handlers) still reference the deleted path and will be migrated in Batch 4 of the big-bang PR (M-1). Design §3.4." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 11: Delete the `shared/types/operation-result.ts` placeholder

**Package:** `@arc/core`

**Files:**
- Delete: `packages/core/src/shared/types/operation-result.ts`
- Modify: `packages/core/src/index.ts`

Removes the placeholder discriminated-union `OperationResult<T>` (used only by `ProjectRepository`). The single caller is migrated to the new `Result<T>` in Chapter 04-xx per design §8.

- [ ] **Step 1: Delete the file and its barrel re-export**

Delete the source file:

```bash
rm packages/core/src/shared/types/operation-result.ts
```

Windows:

```bash
del "packages\core\src\shared\types\operation-result.ts"
```

In `packages/core/src/index.ts`, remove the line:

```typescript
export * from './shared/types/operation-result.js';
```

The surrounding context after edit reads:

```typescript
export * from './shared/types/branded-ids.js';
export * from './domain/entities/definitions/common/types/param-type.js';
// New Result<T> discriminated union + namespace (design §3, FR-2, FR-3).
// Replaces the previous class-based Result exported from application/shared/Result/.
export * from './application/shared/result/result.js';
export * from './shared/types/api-result.js';
```

- [ ] **Step 2: Verify the Result unit test still passes**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="application/shared/result/result.spec.ts"`
Expected: PASS. The Result spec has no dependency on the deleted placeholder.

Note: `pnpm run build:core` remains expected-fail — `project.repository.ts` still imports `OperationResult`. Migration in Chapter 04-xx.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/index.ts packages/core/src/shared/types/operation-result.ts
  git commit -m "refactor(core): delete OperationResult<T> placeholder" \
             -m "Removes packages/core/src/shared/types/operation-result.ts and its barrel re-export. The single caller (ProjectRepository) is migrated to the new Result<T> in Batch 4 of the big-bang PR (M-1). Design §3.4, requirements §5 (M-3 Deleted)." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 12: Delete the `shared/types/api-result.ts` placeholder (PR #85 core-side ResultIssue)

**Package:** `@arc/core`

**Files:**
- Delete: `packages/core/src/shared/types/api-result.ts`
- Modify: `packages/core/src/index.ts`

Removes the `ResultError` / `ResultWarning` transport types introduced by PR #85 on the core side. Both are subsumed by the base `Issue` vocabulary in `shared/issues/` (Chapter 01-01). Callers (`upload-file.handler.ts`, `upload-file-orchestrator.ts`, `issue-collection.ts`) are migrated to `Issue` in later chapters per design §4 / §8.

- [ ] **Step 1: Delete the file and its barrel re-export**

Delete the source file:

```bash
rm packages/core/src/shared/types/api-result.ts
```

Windows:

```bash
del "packages\core\src\shared\types\api-result.ts"
```

In `packages/core/src/index.ts`, remove the line:

```typescript
export * from './shared/types/api-result.js';
```

The surrounding context after edit reads:

```typescript
export * from './domain/entities/definitions/common/types/param-type.js';
// New Result<T> discriminated union + namespace (design §3, FR-2, FR-3).
// Replaces the previous class-based Result exported from application/shared/Result/.
export * from './application/shared/result/result.js';

// Shared Change Types
export * from './application/shared/change-vocabulary.js';
```

- [ ] **Step 2: Verify the Result unit test still passes**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="application/shared/result/result.spec.ts"`
Expected: PASS.

Note: `pnpm run build:core` remains expected-fail — three upload-file files still import `ResultError` / `ResultWarning`. Migration in Chapter 03-xx / 04-xx.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/index.ts packages/core/src/shared/types/api-result.ts
  git commit -m "refactor(core): delete ResultError/ResultWarning core-side transport types" \
             -m "Removes packages/core/src/shared/types/api-result.ts and its barrel re-export. The ResultError and ResultWarning shapes from PR #85 are subsumed by the base Issue vocabulary in packages/core/src/shared/issues/. Upload-file callers are migrated to Issue in subsequent chapters of the big-bang PR (M-1, M-2). Design §3.4, requirements §5 (M-3 Deleted)." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@example.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.
<!--
Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
SPDX-License-Identifier: BSD-3-Clause
-->

## Chapter 02-02: Validation framework field rename

**Scope:** Refactor `packages/core/src/domain/validation/` and `packages/core/src/application/validation/` to consume the new `shared/issues/` module created in chapter 01-01. Shrink `ValidationIssue` to `extends Issue { name; defaultSeverity }`. Rename fields: `description → message`, `effectiveSeverity → severity`, `VALIDATION_ENTITY_TYPE → ISSUE_ENTITY_TYPE`, `ValidationEntityType → IssueEntityType`. Behavioural edit: `preference-enforcer` now sets the `severity` key (previously `effectiveSeverity`), and rule authors seed `severity = defaultSeverity` at construction so the field is always populated. All logic (severity escalation via `SEVERITY_ORDER`, category derivation) is unchanged.

**Design references:** design §4.1–§4.4, requirements FR-4.4.

**Note on build states:** This chapter is a coordinated big-bang rename across ~10 files. Intermediate tasks intentionally leave the TypeScript project in a non-compiling state. Only the final task in this chapter runs `pnpm run build:core` and the validation test suite to confirm green.

---

### Task 14: Shrink `domain/validation/issue.ts`

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/domain/validation/issue.ts` (shrink from ~120 LOC to ~15 LOC)

- [ ] **Step 1: Replace the file contents**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Issue, IssueSeverity} from '../../shared/issues/index.js';

/**
 * Rule-produced issue extending the base Issue vocabulary.
 *
 * Fields inherited from Issue:
 *   code, message, severity, category?, impactedEntity?,
 *   impactedUsecases?, fixOptions?
 *
 * Rules populate every base field unconditionally (though they are optional
 * on the base type to accommodate operational Issues that do not have them).
 */
export interface ValidationIssue extends Issue {
  /** Rule name — e.g. "Missing Module Definition". Only meaningful for rule outputs. */
  name: string;
  /** Rule's built-in severity before user preferences applied. Internal only — never on the wire. */
  defaultSeverity: IssueSeverity;
}
```

- [ ] **Step 2: Confirm the removed re-exports are supplied by `shared/issues/`**

The following names previously exported from `domain/validation/issue.ts` are now imported by consumers from `packages/core/src/shared/issues/index.js` (created in chapter 01-01):

`IssueSeverity`, `IssueCategory`, `deriveCategoryFromSeverity`, `SEVERITY_ORDER`, `ISSUE_ENTITY_TYPE`, `IssueEntityType`, `ImpactedEntity`, `FixOption`, `ClientInputSpec`, `CLIENT_INPUT_TYPE`, `ClientInputType`.

Do not run `pnpm run build:core` yet — subsequent tasks in this chapter update the consumers.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/domain/validation/issue.ts
  git commit -m "refactor(core): shrink ValidationIssue to extend base Issue" \
             -m "ValidationIssue now extends Issue from shared/issues/ and keeps only the rule-specific fields name and defaultSeverity. All enum/type exports move to shared/issues/. Consumer imports and field references are updated in follow-up commits. Design §4.1, FR-4.4." \
             -m "Signed-off-by: Nithin Simon <nsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 15: Update remaining `domain/validation/` files

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/domain/validation/validation-rule.ts`
- Modify: `packages/core/src/domain/validation/validation-context.ts`
- Modify: `packages/core/src/domain/validation/validation-preferences.ts`
- Modify: `packages/core/src/domain/validation/validation-report.ts`

- [ ] **Step 1: Replace `validation-rule.ts` — imports move to `shared/issues/`, enum type renamed**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {IssueSeverity, IssueEntityType} from '../../shared/issues/index.js';
import type {ValidationIssue} from './issue.js';
import type {
  BaseValidationContext,
  FileValidationContext,
} from './validation-context.js';

/**
 * Validation rule groups — define which set of rules runs in each context.
 *
 * Rules declare which groups they belong to via `readonly groups`.
 * The engine filters rules by group at runtime.
 *
 * Group descriptions:
 *   FULL        — All rules; comprehensive check (file open, on-demand validate)
 *   COMMIT      — Lightweight subset; structural integrity check before commit
 *   UPLOAD_FILE — Rules specific to file upload/open
 *   SAVE_FILE   — Rules specific to file save
 *   MULTI_DSP   — Rules for multi-DSP configurations
 */
export const VALIDATION_RULE_GROUP = {
  Commit: 'COMMIT',
  UploadFile: 'UPLOAD_FILE',
  SaveFile: 'SAVE_FILE',
} as const;
export type ValidationRuleGroup =
  (typeof VALIDATION_RULE_GROUP)[keyof typeof VALIDATION_RULE_GROUP];

/**
 * Interface for a validation rule.
 *
 * Rules are typed to a specific context profile (TContext) — the subset of
 * FileValidationContext they actually need. TypeScript enforces at compile time
 * that the rule only accesses fields declared in its profile.
 *
 * The engine always passes FileValidationContext (which extends all profiles),
 * so any profile-typed rule is safely callable by the engine.
 *
 * @example
 * // Rule typed to LinkValidationContext — can only access link-related fields
 * class DuplicateDataLinkRule implements IValidationRule<LinkValidationContext> {
 *   validate(context: LinkValidationContext): ValidationIssue[] { ... }
 * }
 */
export interface ValidationRule<
  TContext extends BaseValidationContext = FileValidationContext,
> {
  readonly code: string; // Matches the issue code this rule produces
  readonly defaultSeverity: IssueSeverity;
  readonly groups: ValidationRuleGroup[]; // Which groups this rule participates in
  /**
   * Entity types this rule needs to validate.
   * Used by ValidationContextBuilder.fromDb() to load only the required DB tables,
   * avoiding unnecessary queries when running a subset of rules (e.g., COMMIT group).
   *
   * The context builder maps each entity type to its DB query and derived index maps:
   *   SpfModule           → modules + modulesBySystemId + modulesBySubgraphId
   *   DataLink            → dataLinks
   *   ControlLink         → controlLinks
   *   UseCase             → usecases + usecasesByModuleId
   *   Subgraph            → subgraphs + subgraphsBySystemId
   *   SpfModuleDefinition → definitions
   */
  readonly requiredEntityTypes: ReadonlyArray<IssueEntityType>;
  validate(context: TContext): ValidationIssue[];
}
```

- [ ] **Step 2: Update the import in `validation-context.ts`**

Change the top-of-file import block. The existing file has no reference to the moved enums, so only the `ValidationPreferences` import stays; nothing else needs editing. Verify by reading the file — if it still compiles logically it needs no edits. (`validation-context.ts` currently imports `ValidationPreferences` only, so no change is required.) Mark this step complete with **NO EDIT** if that is confirmed.

- [ ] **Step 3: Replace the import in `validation-preferences.ts`**

Old:
```typescript
import type {IssueSeverity} from './issue.js';
```

New:
```typescript
import type {IssueSeverity} from '../../shared/issues/index.js';
```

Rest of file unchanged.

- [ ] **Step 4: Replace `validation-report.ts`**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {IssueCategory} from '../../shared/issues/index.js';
import type {IssueSeverity} from '../../shared/issues/index.js';
import type {ValidationIssue} from './issue.js';

export interface ValidationSummary {
  total: number;
  bySeverity: Record<IssueSeverity, number>; // counts by effective severity
  blocking: number;
  nonBlocking: number;
  dataLoss: number; // count of DATA_LOSS category issues
}

export class ValidationReport {
  readonly issues: ReadonlyArray<ValidationIssue>;
  readonly blockedSave: boolean;
  readonly summary: ValidationSummary;

  constructor(issues: ValidationIssue[]) {
    this.issues = issues;
    this.blockedSave = issues.some(i => i.category === IssueCategory.Blocking);
    this.summary = this.buildSummary(issues);
  }

  private buildSummary(issues: ValidationIssue[]): ValidationSummary {
    const bySeverity: Record<IssueSeverity, number> = {
      FATAL: 0,
      ERROR: 0,
      WARNING: 0,
    };
    let blocking = 0;
    let nonBlocking = 0;
    let dataLoss = 0;
    for (const issue of issues) {
      bySeverity[issue.severity]++;
      if (issue.category === IssueCategory.Blocking) blocking++;
      else if (issue.category === IssueCategory.DataLoss) dataLoss++;
      else nonBlocking++;
    }
    return {total: issues.length, bySeverity, blocking, nonBlocking, dataLoss};
  }
}
```

Note the two behavioural touches from the rename:
- `issue.effectiveSeverity` → `issue.severity`
- `issue.category === IssueCategory.Blocking` still holds — `category` is optional on the base `Issue` but every `ValidationIssue` produced by rules or the `preference-enforcer` populates it. This ternary is unchanged.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/domain/validation/validation-rule.ts \
          packages/core/src/domain/validation/validation-preferences.ts \
          packages/core/src/domain/validation/validation-report.ts
  git commit -m "refactor(core): update domain/validation imports to shared/issues" \
             -m "Point validation-rule, validation-preferences, validation-report at the new shared/issues/ module. Rename IssueEntityType, and update validation-report to read the renamed severity field. Design §4.1-§4.2, FR-4.4-FR-4.5." \
             -m "Signed-off-by: Nithin Simon <nsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 16: Rename fields in `missing-definition.rule.ts`

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/domain/validation/rules/module/missing-definition.rule.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {
  IssueSeverity,
  ISSUE_ENTITY_TYPE,
  deriveCategoryFromSeverity,
} from '../../../../shared/issues/index.js';
import type {ValidationIssue} from '../../issue.js';
import type {ValidationRule} from '../../validation-rule.js';
import {VALIDATION_RULE_GROUP} from '../../validation-rule.js';
import type {ModuleValidationContext} from '../../validation-context.js';
import {BinaryUtils} from '../../../../shared/utilities/binary-utils.js';

/**
 * ARC-MOD-001 — Missing Module Definition (This is stub created for reference)
 *
 * Checks that every SpfModule in the file references a definition that is
 * present in the loaded ACDB (definitions map). A module with a missing
 * definition cannot be configured or saved — this is a BLOCKING error.
 *
 * Groups: UPLOAD_FILE (run on file open), COMMIT (run before commit)
 */
export class MissingDefinitionRule implements ValidationRule<ModuleValidationContext> {
  readonly code = 'ARC-MOD-001';
  readonly defaultSeverity = IssueSeverity.Error;
  readonly groups = [
    VALIDATION_RULE_GROUP.UploadFile,
    VALIDATION_RULE_GROUP.Commit,
  ];
  readonly requiredEntityTypes = [
    ISSUE_ENTITY_TYPE.SpfModule,
    ISSUE_ENTITY_TYPE.SpfModuleDefinition,
  ] as const;

  validate(context: ModuleValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const module of context.modules) {
      if (!context.definitions.has(module.definitionSystemId)) {
        const impactedUsecases = (
          context.usecasesByModuleId.get(module.systemId) ?? []
        ).map(uc => uc.systemId);

        issues.push({
          code: this.code,
          name: 'Missing Module Definition',
          message:
            `Module '${module.alias ?? 'unknown'}' ` +
            `(${BinaryUtils.toHexString(module.systemId)}) references ` +
            `definition ${BinaryUtils.toHexString(module.definitionSystemId)} ` +
            `which is not present in the loaded ACDB.`,
          defaultSeverity: this.defaultSeverity,
          severity: this.defaultSeverity, // seed with default; preference-enforcer may escalate
          category: deriveCategoryFromSeverity(this.defaultSeverity),
          fixOptions: [],
          impactedEntity: {
            entityType: ISSUE_ENTITY_TYPE.SpfModule,
            systemId: module.systemId,
            displayName: module.alias,
          },
          impactedUsecases,
        });
      }
    }

    return issues;
  }
}
```

Changes vs. previous file:
- Import block switched from `../../issue.js` to `../../../../shared/issues/index.js` for enums + `deriveCategoryFromSeverity`.
- `VALIDATION_ENTITY_TYPE` → `ISSUE_ENTITY_TYPE`.
- Issue field `description` → `message`.
- Issue field `effectiveSeverity` renamed to `severity` and populated at construction (seeded with `defaultSeverity`).

- [ ] **Step 2: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/domain/validation/rules/module/missing-definition.rule.ts
  git commit -m "refactor(core): rename issue fields in MissingDefinitionRule" \
             -m "Rule now emits issues with the renamed base Issue fields (message, severity) and seeds severity=defaultSeverity at construction. Enum imports updated to shared/issues/. Design §4.4, FR-4.4." \
             -m "Signed-off-by: Nithin Simon <nsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 17: Preference-enforcer behavioural edit (TDD)

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/validation/preference-enforcer.ts`
- Test: `packages/core/tests/unit/application/validation/preference-enforcer.spec.ts`

- [ ] **Step 1: Rewrite the failing test file**

Replace `packages/core/tests/unit/application/validation/preference-enforcer.spec.ts` with:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {applyPreferences} from '../../../../src/application/validation/preference-enforcer.js';
import {
  IssueCategory,
  IssueSeverity,
  ISSUE_ENTITY_TYPE,
} from '../../../../src/shared/issues/index.js';
import {
  EMPTY_PREFERENCES,
  buildSuppressionKey,
} from '../../../../src/domain/validation/validation-preferences.js';
import type {ValidationIssue} from '../../../../src/domain/validation/issue.js';
import type {ValidationPreferences} from '../../../../src/domain/validation/validation-preferences.js';

function makeIssue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    code: 'ARC-TEST-001',
    name: 'Test',
    message: 'Test',
    defaultSeverity: IssueSeverity.Warning,
    severity: IssueSeverity.Warning,
    category: IssueCategory.NonBlocking,
    fixOptions: [],
    impactedEntity: {entityType: ISSUE_ENTITY_TYPE.SpfModule, systemId: 1},
    impactedUsecases: [],
    ...overrides,
  };
}

describe('applyPreferences', () => {
  it('should return issue unchanged when no override exists (fast path)', () => {
    const issue = makeIssue();
    const result = applyPreferences(issue, EMPTY_PREFERENCES);
    expect(result).toBe(issue); // same reference — not a copy
  });

  it('should return DATA_LOSS issue unchanged regardless of preferences', () => {
    const issue = makeIssue({category: IssueCategory.DataLoss});
    const prefs: ValidationPreferences = {
      overrides: {'ARC-TEST-001': {disabled: true}},
      suppressions: {},
    };
    const result = applyPreferences(issue, prefs);
    expect(result).toBe(issue); // DATA_LOSS always returned as-is
  });

  it('should return null when NON_BLOCKING issue is disabled globally', () => {
    const issue = makeIssue();
    const prefs: ValidationPreferences = {
      overrides: {'ARC-TEST-001': {disabled: true}},
      suppressions: {},
    };
    expect(applyPreferences(issue, prefs)).toBeNull();
  });

  it('should NOT disable a BLOCKING issue', () => {
    const issue = makeIssue({
      defaultSeverity: IssueSeverity.Error,
      severity: IssueSeverity.Error,
      category: IssueCategory.Blocking,
    });
    const prefs: ValidationPreferences = {
      overrides: {'ARC-TEST-001': {disabled: true}},
      suppressions: {},
    };
    expect(applyPreferences(issue, prefs)).not.toBeNull();
  });

  it('should escalate severity when override is strictly higher', () => {
    const issue = makeIssue({
      defaultSeverity: IssueSeverity.Warning,
      severity: IssueSeverity.Warning,
    });
    const prefs: ValidationPreferences = {
      overrides: {'ARC-TEST-001': {severityOverride: IssueSeverity.Error}},
      suppressions: {},
    };
    const result = applyPreferences(issue, prefs);
    expect(result?.severity).toBe(IssueSeverity.Error);
    expect(result?.category).toBe(IssueCategory.Blocking);
  });

  it('should silently ignore downgrade attempt', () => {
    const issue = makeIssue({
      defaultSeverity: IssueSeverity.Error,
      severity: IssueSeverity.Error,
      category: IssueCategory.Blocking,
    });
    const prefs: ValidationPreferences = {
      overrides: {'ARC-TEST-001': {severityOverride: IssueSeverity.Warning}},
      suppressions: {},
    };
    const result = applyPreferences(issue, prefs);
    expect(result?.severity).toBe(IssueSeverity.Error); // unchanged
    expect(result?.category).toBe(IssueCategory.Blocking);
  });

  it('should suppress a specific NON_BLOCKING issue instance', () => {
    const issue = makeIssue({
      impactedEntity: {
        entityType: ISSUE_ENTITY_TYPE.DataLink,
        systemId: 8388625,
      },
    });
    const key = buildSuppressionKey(
      'ARC-TEST-001',
      ISSUE_ENTITY_TYPE.DataLink,
      8388625,
    );
    const prefs: ValidationPreferences = {
      overrides: {},
      suppressions: {[key]: {reason: 'Expected for non-concurrent usecases'}},
    };
    expect(applyPreferences(issue, prefs)).toBeNull();
  });

  it('should NOT suppress a BLOCKING issue instance', () => {
    const issue = makeIssue({
      defaultSeverity: IssueSeverity.Error,
      severity: IssueSeverity.Error,
      category: IssueCategory.Blocking,
      impactedEntity: {
        entityType: ISSUE_ENTITY_TYPE.SpfModule,
        systemId: 1,
      },
    });
    const key = buildSuppressionKey(
      'ARC-TEST-001',
      ISSUE_ENTITY_TYPE.SpfModule,
      1,
    );
    const prefs: ValidationPreferences = {
      overrides: {},
      suppressions: {[key]: {}},
    };
    expect(applyPreferences(issue, prefs)).not.toBeNull();
  });

  it('should return issue as-is when escalated to BLOCKING (cannot suppress/disable)', () => {
    const issue = makeIssue({
      defaultSeverity: IssueSeverity.Warning,
      severity: IssueSeverity.Warning,
      category: IssueCategory.NonBlocking,
    });
    const key = buildSuppressionKey(
      'ARC-TEST-001',
      ISSUE_ENTITY_TYPE.SpfModule,
      1,
    );
    const prefs: ValidationPreferences = {
      overrides: {
        'ARC-TEST-001': {severityOverride: IssueSeverity.Error, disabled: true},
      },
      suppressions: {[key]: {}},
    };
    // Escalated to ERROR → BLOCKING → suppression and disable are ignored
    const result = applyPreferences(issue, prefs);
    expect(result).not.toBeNull();
    expect(result?.severity).toBe(IssueSeverity.Error);
    expect(result?.category).toBe(IssueCategory.Blocking);
  });

  it('should return issue unchanged when no override and no suppression (fast path)', () => {
    const issue = makeIssue();
    const prefs: ValidationPreferences = {
      overrides: {'OTHER-CODE': {disabled: true}}, // different code
      suppressions: {},
    };
    const result = applyPreferences(issue, prefs);
    expect(result).toBe(issue); // fast path — same reference
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="preference-enforcer.spec"`
Expected: FAIL with TypeScript errors reporting `Property 'effectiveSeverity' does not exist on type 'ValidationIssue'` or runtime `expect(result?.severity).toBe(...)` receiving `undefined` (the current implementation still writes `effectiveSeverity`, not `severity`).

- [ ] **Step 3: Rewrite `preference-enforcer.ts` to set the `severity` field**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {
  IssueCategory,
  SEVERITY_ORDER,
  deriveCategoryFromSeverity,
} from '../../shared/issues/index.js';
import type {ValidationIssue} from '../../domain/validation/issue.js';
import {buildSuppressionKey} from '../../domain/validation/validation-preferences.js';
import type {ValidationPreferences} from '../../domain/validation/validation-preferences.js';

/**
 * Applies user preferences to a raw issue produced by a rule.
 *
 * Order of checks:
 * 1. DATA_LOSS issues — always returned as-is (cannot be suppressed or disabled)
 * 2. Fast path — if no code override AND no instance suppression, return as-is
 * 3. Apply severity override first (once) to determine effective severity/category
 * 4. BLOCKING (original or escalated) — return with new severity; cannot suppress/disable
 * 5. NON_BLOCKING — check instance suppression, then global disable
 *
 * Returns null if the issue should be hidden from the report.
 *
 * Behavioural note: the returned issue populates the base Issue `severity`
 * field (renamed from the pre-refactor `effectiveSeverity`). Rules already
 * seed `severity = defaultSeverity` at construction, so the field is always
 * present on the input issue.
 */
export function applyPreferences(
  issue: ValidationIssue,
  preferences: ValidationPreferences,
): ValidationIssue | null {
  // 1. DATA_LOSS: always shown, no preferences apply
  if (issue.category === IssueCategory.DataLoss) return issue;

  // 2. Fast path: no code override and no instance suppression for this entity
  const pref = preferences.overrides[issue.code];
  const entityType = issue.impactedEntity?.entityType ?? '';
  const systemId = issue.impactedEntity?.systemId ?? 0;
  const suppressionKey = buildSuppressionKey(issue.code, entityType, systemId);
  if (!pref && !preferences.suppressions?.[suppressionKey]) return issue;

  // 3. Apply severity override once to determine effective severity/category
  let effectiveSeverity = issue.defaultSeverity;
  let effectiveCategory: IssueCategory | undefined = issue.category;

  if (pref?.severityOverride) {
    const defaultIdx = SEVERITY_ORDER.indexOf(issue.defaultSeverity);
    const overrideIdx = SEVERITY_ORDER.indexOf(pref.severityOverride);
    if (overrideIdx > defaultIdx) {
      effectiveSeverity = pref.severityOverride;
      effectiveCategory = deriveCategoryFromSeverity(effectiveSeverity);
    }
  }

  // 4. BLOCKING (original or escalated via severity override): cannot suppress or disable
  if (effectiveCategory === IssueCategory.Blocking) {
    return effectiveSeverity === issue.defaultSeverity
      ? issue
      : {...issue, severity: effectiveSeverity, category: effectiveCategory};
  }

  // 5. NON_BLOCKING: check instance suppression then global disable
  if (preferences.suppressions?.[suppressionKey]) return null;
  if (pref?.disabled) return null;

  // Return with effective severity/category (may be unchanged)
  return effectiveSeverity === issue.defaultSeverity
    ? issue
    : {...issue, severity: effectiveSeverity, category: effectiveCategory};
}
```

Changes vs. previous:
- Imports of `IssueCategory`, `SEVERITY_ORDER`, `deriveCategoryFromSeverity` switched from `domain/validation/issue.js` to `shared/issues/index.js`.
- Returned object sets `severity` (previously `effectiveSeverity`).
- `impactedEntity` is now optional on the base `Issue`, so entity/systemId destructuring uses `?.` with safe fallbacks — rule outputs always populate it, so this is defensive only.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="preference-enforcer.spec"`
Expected: PASS (all assertions on `result?.severity` and `result?.category` hold; DATA_LOSS bypass, escalation, downgrade-ignore, suppression, and disable paths still behave identically to before the rename).

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/validation/preference-enforcer.ts \
          packages/core/tests/unit/application/validation/preference-enforcer.spec.ts
  git commit -m "refactor(core): preference-enforcer writes renamed severity field" \
             -m "applyPreferences now sets the base Issue severity key on the returned object (previously effectiveSeverity). Rules seed severity=defaultSeverity at construction so the field is always populated. Severity escalation via SEVERITY_ORDER and category derivation are unchanged; test coverage confirms all preference paths still behave identically. Design §4.3, FR-4.4." \
             -m "Signed-off-by: Nithin Simon <nsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 18: Update remaining `application/validation/` imports

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/validation/validation-engine.ts`
- Modify: `packages/core/src/application/validation/validation-orchestrator.ts` (no code change expected — verify only)
- Modify: `packages/core/src/application/validation/validation-context-builder.ts`
- Modify: `packages/core/src/application/validation/commands/update-validation-preferences.handler.ts` (import path for `SEVERITY_ORDER`)

- [ ] **Step 1: Replace `validation-engine.ts`**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {ValidationReport} from '../../domain/validation/validation-report.js';
import type {
  ValidationRule,
  ValidationRuleGroup,
} from '../../domain/validation/validation-rule.js';
import type {FileValidationContext} from '../../domain/validation/validation-context.js';
import type {IssueEntityType} from '../../shared/issues/index.js';
import type {ValidationIssue} from '../../domain/validation/issue.js';
import {applyPreferences} from './preference-enforcer.js';

/**
 * Runs all applicable validation rules against the provided context,
 * applies user preferences to each issue, and returns a ValidationReport.
 *
 * Rules are stored as ValidationRule<FileValidationContext> — safe because
 * FileValidationContext extends all context profiles, so any profile-typed
 * rule is assignable here.
 */
export class ValidationEngine {
  constructor(
    private readonly rules: ReadonlyArray<
      ValidationRule<FileValidationContext>
    >,
  ) {}

  /**
   * Returns the union of requiredEntityTypes across all rules in the given group.
   * Pass this to ValidationContextBuilder.fromDb() to load only the needed DB tables.
   */
  getRequiredEntityTypes(
    group: ValidationRuleGroup,
  ): Set<IssueEntityType> {
    return new Set(
      this.rules
        .filter(r => r.groups.includes(group))
        .flatMap(r => [...r.requiredEntityTypes]),
    );
  }

  run(
    context: FileValidationContext,
    group: ValidationRuleGroup,
  ): ValidationReport {
    const applicableRules = this.rules.filter(r => r.groups.includes(group));
    const issues: ValidationIssue[] = [];

    for (const rule of applicableRules) {
      const ruleIssues = rule.validate(context);
      for (const issue of ruleIssues) {
        const resolved = applyPreferences(issue, context.preferences);
        if (resolved !== null) {
          issues.push(resolved);
        }
      }
    }

    return new ValidationReport(issues);
  }
}
```

Only change: `ValidationEntityType` type import replaced by `IssueEntityType` from `shared/issues/`. Return type of `getRequiredEntityTypes` updated.

- [ ] **Step 2: Verify `validation-orchestrator.ts` — NO EDIT**

Read the file. It does not import from `domain/validation/issue.js` and does not reference any renamed fields — it only orchestrates `ValidationEngine` and `ValidationContextBuilder`. Mark this step complete with **NO EDIT**.

- [ ] **Step 3: Replace `validation-context-builder.ts`**

Replace the two-line import block near the top:

Old:
```typescript
import {VALIDATION_ENTITY_TYPE} from '../../domain/validation/issue.js';
import type {ValidationEntityType} from '../../domain/validation/issue.js';
```

New:
```typescript
import {ISSUE_ENTITY_TYPE} from '../../shared/issues/index.js';
import type {IssueEntityType} from '../../shared/issues/index.js';
```

Then replace-all `VALIDATION_ENTITY_TYPE` → `ISSUE_ENTITY_TYPE` and `ValidationEntityType` → `IssueEntityType` inside the file. The six `requiredEntityTypes.has(VALIDATION_ENTITY_TYPE.<X>)` guards inside `fromDb()` become `requiredEntityTypes.has(ISSUE_ENTITY_TYPE.<X>)`. The `ReadonlySet<ValidationEntityType>` parameter type becomes `ReadonlySet<IssueEntityType>`. No other logic changes.

- [ ] **Step 4: Update the import in `update-validation-preferences.handler.ts`**

Old (line 9):
```typescript
import {SEVERITY_ORDER} from '../../../domain/validation/issue.js';
```

New:
```typescript
import {SEVERITY_ORDER} from '../../../shared/issues/index.js';
```

If the same file also imports `IssueSeverity` from `domain/validation/issue.js`, redirect that too:

```typescript
import {IssueSeverity} from '../../../shared/issues/index.js';
```

Verify by reading the file; edit only the import lines that reference the moved names. No behavioural changes.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/validation/validation-engine.ts \
          packages/core/src/application/validation/validation-context-builder.ts \
          packages/core/src/application/validation/commands/update-validation-preferences.handler.ts
  git commit -m "refactor(core): update application/validation imports to shared/issues" \
             -m "Rewire ValidationEngine, ValidationContextBuilder, and UpdateValidationPreferencesHandler to import IssueEntityType, ISSUE_ENTITY_TYPE, and SEVERITY_ORDER from shared/issues/. Purely mechanical rename; no behavioural change. Design §4.1, FR-4.5." \
             -m "Signed-off-by: Nithin Simon <nsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 19: Update remaining unit tests and verify green build

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/tests/unit/domain/validation/rules/missing-definition.rule.spec.ts`
- Modify: `packages/core/tests/unit/application/validation/validation-engine.spec.ts`
- Modify: `packages/core/tests/unit/application/validation/validation-orchestrator.spec.ts`
- Modify: `packages/core/tests/unit/domain/validation/validation-report.spec.ts`

- [ ] **Step 1: Replace `missing-definition.rule.spec.ts`**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {MissingDefinitionRule} from '../../../../../src/domain/validation/rules/module/missing-definition.rule.js';
import {
  IssueCategory,
  IssueSeverity,
  ISSUE_ENTITY_TYPE,
} from '../../../../../src/shared/issues/index.js';
import {VALIDATION_RULE_GROUP} from '../../../../../src/domain/validation/validation-rule.js';
import {EMPTY_PREFERENCES} from '../../../../../src/domain/validation/validation-preferences.js';
import type {ModuleValidationContext} from '../../../../../src/domain/validation/validation-context.js';
import type {SpfModule} from '../../../../../src/domain/entities/usecase-data/module/spf-module.js';
import type {SpfModuleDefinition} from '../../../../../src/domain/entities/definitions/spf-module/aggregate/spf-module-definitions.js';

function makeContext(
  modules: Partial<SpfModule>[],
  definitions: Map<number, Partial<SpfModuleDefinition>>,
  usecasesByModuleId: Map<number, any[]> = new Map(),
): ModuleValidationContext {
  return {
    fileSystemId: 1,
    preferences: EMPTY_PREFERENCES,
    modules: modules as SpfModule[],
    definitions: definitions as Map<number, SpfModuleDefinition>,
    modulesBySystemId: new Map(modules.map(m => [m.systemId!, m as SpfModule])),
    usecasesByModuleId,
  };
}

describe('MissingDefinitionRule', () => {
  const rule = new MissingDefinitionRule();

  it('should have code ARC-MOD-001', () => {
    expect(rule.code).toBe('ARC-MOD-001');
  });

  it('should be in UPLOAD_FILE and COMMIT groups', () => {
    expect(rule.groups).toContain(VALIDATION_RULE_GROUP.UploadFile);
    expect(rule.groups).toContain(VALIDATION_RULE_GROUP.Commit);
  });

  it('should require SpfModule and SpfModuleDefinition entity types', () => {
    expect(rule.requiredEntityTypes).toContain(ISSUE_ENTITY_TYPE.SpfModule);
    expect(rule.requiredEntityTypes).toContain(
      ISSUE_ENTITY_TYPE.SpfModuleDefinition,
    );
  });

  it('should return no issues when all modules have definitions', () => {
    const defId = 100;
    const context = makeContext(
      [{systemId: 1, definitionSystemId: defId}],
      new Map([[defId, {systemId: defId}]]),
    );
    expect(rule.validate(context)).toHaveLength(0);
  });

  it('should return ERROR issue when module references missing definition', () => {
    const context = makeContext(
      [{systemId: 1, definitionSystemId: 999, alias: 'TestModule'}],
      new Map(),
    );
    const issues = rule.validate(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('ARC-MOD-001');
    expect(issues[0].severity).toBe(IssueSeverity.Error);
    expect(issues[0].category).toBe(IssueCategory.Blocking);
    expect(issues[0].impactedEntity?.entityType).toBe(
      ISSUE_ENTITY_TYPE.SpfModule,
    );
    expect(issues[0].impactedEntity?.systemId).toBe(1);
    expect(issues[0].impactedEntity?.displayName).toBe('TestModule');
  });

  it('should return one issue per module with missing definition', () => {
    const context = makeContext(
      [
        {systemId: 1, definitionSystemId: 999},
        {systemId: 2, definitionSystemId: 888},
      ],
      new Map(),
    );
    expect(rule.validate(context)).toHaveLength(2);
  });

  it('should not return issue for modules whose definition exists', () => {
    const context = makeContext(
      [
        {systemId: 1, definitionSystemId: 100},
        {systemId: 2, definitionSystemId: 999}, // missing
      ],
      new Map([[100, {systemId: 100}]]),
    );
    const issues = rule.validate(context);
    expect(issues).toHaveLength(1);
    expect(issues[0].impactedEntity?.systemId).toBe(2);
  });

  it('should populate impactedUsecases from usecasesByModuleId', () => {
    const usecasesByModuleId = new Map([
      [1, [{systemId: 101} as any, {systemId: 102} as any]],
    ]);
    const context = makeContext(
      [{systemId: 1, definitionSystemId: 999}],
      new Map(),
      usecasesByModuleId,
    );
    const issues = rule.validate(context);
    expect(issues[0].impactedUsecases).toEqual([101, 102]);
  });

  it('should return empty impactedUsecases when module is in no usecases', () => {
    const context = makeContext(
      [{systemId: 1, definitionSystemId: 999}],
      new Map(),
    );
    const issues = rule.validate(context);
    expect(issues[0].impactedUsecases).toEqual([]);
  });
});
```

Changes: imports moved to `shared/issues/`; `VALIDATION_ENTITY_TYPE` → `ISSUE_ENTITY_TYPE`; assertion on `issues[0].effectiveSeverity` → `issues[0].severity`; `impactedEntity` access uses `?.` since it is now optional on the base `Issue`.

- [ ] **Step 2: Update `validation-engine.spec.ts`**

Apply three edits at the top of the file and inside `makeIssue`:

Old imports:
```typescript
import {
  IssueCategory,
  IssueSeverity,
  VALIDATION_ENTITY_TYPE,
} from '../../../../src/domain/validation/issue.js';
import type {ValidationEntityType} from '../../../../src/domain/validation/issue.js';
```

New imports:
```typescript
import {
  IssueCategory,
  IssueSeverity,
  ISSUE_ENTITY_TYPE,
} from '../../../../src/shared/issues/index.js';
import type {IssueEntityType} from '../../../../src/shared/issues/index.js';
```

Replace the `makeIssue` helper body:

```typescript
function makeIssue(code: string): ValidationIssue {
  return {
    code,
    name: code,
    message: code,
    defaultSeverity: IssueSeverity.Warning,
    severity: IssueSeverity.Warning,
    category: IssueCategory.NonBlocking,
    fixOptions: [],
    impactedEntity: {entityType: ISSUE_ENTITY_TYPE.SpfModule, systemId: 1},
    impactedUsecases: [],
  };
}
```

Rename the `makeRule` parameter type from `ValidationEntityType[]` to `IssueEntityType[]`. Any remaining literal uses of `VALIDATION_ENTITY_TYPE.<X>` in the file body must be replace-all to `ISSUE_ENTITY_TYPE.<X>`.

- [ ] **Step 3: Update `validation-orchestrator.spec.ts`**

At the top of the fake-issue factory inside this spec, rename the two literal fields:

- `description: ''` → `message: ''`
- `effectiveSeverity: IssueSeverity.Warning` → `severity: IssueSeverity.Warning`

If the file imports enums from `domain/validation/issue.js`, redirect those imports to `shared/issues/index.js` as well. No other logic changes.

- [ ] **Step 4: Update `validation-report.spec.ts`**

Same edits as the orchestrator spec, applied to every `makeIssue` call:

- Every `description: '<value>'` → `message: '<value>'`
- Every `effectiveSeverity: IssueSeverity.<X>` → `severity: IssueSeverity.<X>`

Redirect enum imports from `domain/validation/issue.js` to `shared/issues/index.js` if present.

- [ ] **Step 5: Run the full validation build + test suite**

Run:
```bash
pnpm run build:core
pnpm --filter @arc/core run test:unit:core -- --testPathPattern="validation"
```

Expected:
- Build: PASS (all TypeScript type errors from the field/enum rename resolved).
- Tests: PASS for all validation specs (`preference-enforcer.spec`, `missing-definition.rule.spec`, `validation-engine.spec`, `validation-orchestrator.spec`, `validation-report.spec`, `acknowledge-data-loss.handler.spec`).

If any consumer outside this chapter still references `description`, `effectiveSeverity`, `VALIDATION_ENTITY_TYPE`, or `ValidationEntityType` and now fails to compile, capture the file paths in the commit body — those files belong to a later chapter (04 or 05) and are picked up there. Do not fix them here unless they are the four spec files listed for this task.

- [ ] **Step 6: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/tests/unit/domain/validation/rules/missing-definition.rule.spec.ts \
          packages/core/tests/unit/application/validation/validation-engine.spec.ts \
          packages/core/tests/unit/application/validation/validation-orchestrator.spec.ts \
          packages/core/tests/unit/domain/validation/validation-report.spec.ts
  git commit -m "test(core): update validation specs to new issue field names" \
             -m "Rename description->message, effectiveSeverity->severity, and VALIDATION_ENTITY_TYPE->ISSUE_ENTITY_TYPE across validation unit tests. Full core build and validation test suite verified green after the field rename. Design §4.4, FR-4.4." \
             -m "Signed-off-by: Nithin Simon <nsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.
### Task 20: Insert-failure catalog

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/domain/validation/insert-failures/insert-failure-codes.ts`
- Create: `packages/core/src/domain/validation/insert-failures/index.ts`

**Depends on:** Chapter 01-01 (`shared/issues/` exports `ISSUE_ENTITY_TYPE`) and Chapter 02-02 (`ValidationIssue` shape).

- [ ] **Step 1: Create the catalog file**

```typescript
// packages/core/src/domain/validation/insert-failures/insert-failure-codes.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {ISSUE_ENTITY_TYPE, type IssueEntityType} from '../../../shared/issues/index.js';

/**
 * Catalog of named insert-failure templates.
 *
 * Every entry maps a symbolic type to a stable `code` (grep-able as `ARC-INSERT-*`),
 * a human-readable rule `name` (surfaced in DATA_LOSS acknowledgment UI), and the
 * `entityType` the failure impacts. All entries produce WARNING-severity DATA_LOSS
 * ValidationIssues via `newInsertFailureIssue()`.
 *
 * Extend this catalog rather than fabricating one-off issue literals in bulk-inserters.
 */
export const INSERT_FAILURE = {
  ModuleDuplicateInstanceId: {
    code: 'ARC-INSERT-MOD-001',
    name: 'Module Insert Failed — Duplicate Instance ID',
    entityType: ISSUE_ENTITY_TYPE.SpfModule,
  },
  ModuleMissingDefinition: {
    code: 'ARC-INSERT-MOD-002',
    name: 'Module Insert Failed — Missing Definition',
    entityType: ISSUE_ENTITY_TYPE.SpfModule,
  },
  DataLinkDuplicate: {
    code: 'ARC-INSERT-LINK-001',
    name: 'Data Link Insert Failed — Duplicate',
    entityType: ISSUE_ENTITY_TYPE.DataLink,
  },
} as const satisfies Record<string, {code: string; name: string; entityType: IssueEntityType}>;

export type InsertFailureType = keyof typeof INSERT_FAILURE;
```

- [ ] **Step 2: Create the barrel**

```typescript
// packages/core/src/domain/validation/insert-failures/index.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

export * from './insert-failure-codes.js';
export * from './insert-failure.factory.js';
```

- [ ] **Step 3: Verify the file compiles**

Run: `pnpm --filter @arc/core run build`
Expected: PASS — no compile errors from the new file. (`insert-failure.factory.js` is created in Task 21; expect the barrel to fail resolution until Task 21 lands. Skip barrel export until then, or keep the incomplete barrel — the build failure is temporary within this chapter.)

- [ ] **Step 4: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/domain/validation/insert-failures/insert-failure-codes.ts \
          packages/core/src/domain/validation/insert-failures/index.ts
  git commit -m "feat(core): add INSERT_FAILURE catalog for bulk-inserter DATA_LOSS issues" \
             -m "Introduces stable ARC-INSERT-* codes and a symbolic InsertFailureType so bulk-inserters can build DATA_LOSS ValidationIssues via a factory instead of ad-hoc literals." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 21: `newInsertFailureIssue()` factory + unit tests

**Package:** `@arc/core`

**Files:**
- Create: `packages/core/src/domain/validation/insert-failures/insert-failure.factory.ts`
- Test: `packages/core/tests/unit/domain/validation/insert-failures/insert-failure.factory.spec.ts`

**Depends on:** Task 20 (catalog), Chapter 02-02 (`ValidationIssue` shape).

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/tests/unit/domain/validation/insert-failures/insert-failure.factory.spec.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {newInsertFailureIssue} from '../../../../../src/domain/validation/insert-failures/insert-failure.factory.js';
import {INSERT_FAILURE} from '../../../../../src/domain/validation/insert-failures/insert-failure-codes.js';
import {
  ISSUE_ENTITY_TYPE,
  IssueSeverity,
  IssueCategory,
} from '../../../../../src/shared/issues/index.js';

describe('newInsertFailureIssue', () => {
  it('produces a WARNING/DATA_LOSS ValidationIssue for ModuleDuplicateInstanceId', () => {
    const issue = newInsertFailureIssue(
      'ModuleDuplicateInstanceId',
      42,
      'UNIQUE constraint failed on instance_id',
      'MyModule',
    );

    expect(issue.code).toBe(INSERT_FAILURE.ModuleDuplicateInstanceId.code);
    expect(issue.name).toBe(INSERT_FAILURE.ModuleDuplicateInstanceId.name);
    expect(issue.message).toBe(
      `${INSERT_FAILURE.ModuleDuplicateInstanceId.name}: UNIQUE constraint failed on instance_id`,
    );
    expect(issue.severity).toBe(IssueSeverity.Warning);
    expect(issue.defaultSeverity).toBe(IssueSeverity.Warning);
    expect(issue.category).toBe(IssueCategory.DataLoss);
    expect(issue.impactedEntity).toEqual({
      entityType: ISSUE_ENTITY_TYPE.SpfModule,
      systemId: 42,
      displayName: 'MyModule',
    });
    expect(issue.impactedUsecases).toEqual([]);
    expect(issue.fixOptions).toBeUndefined();
  });

  it('produces the correct entityType for ModuleMissingDefinition', () => {
    const issue = newInsertFailureIssue(
      'ModuleMissingDefinition',
      100,
      'FOREIGN KEY constraint failed on definition_system_id',
    );

    expect(issue.code).toBe(INSERT_FAILURE.ModuleMissingDefinition.code);
    expect(issue.name).toBe(INSERT_FAILURE.ModuleMissingDefinition.name);
    expect(issue.impactedEntity?.entityType).toBe(ISSUE_ENTITY_TYPE.SpfModule);
    expect(issue.impactedEntity?.systemId).toBe(100);
    expect(issue.impactedEntity?.displayName).toBeUndefined();
    expect(issue.severity).toBe(IssueSeverity.Warning);
    expect(issue.category).toBe(IssueCategory.DataLoss);
  });

  it('produces the correct entityType for DataLinkDuplicate and honours fixOptions', () => {
    const fixOptions = [
      {
        id: 'delete-duplicate',
        description: 'Delete the duplicate data link',
        commandType: 'DELETE_DATA_LINK',
        commandPayload: {systemId: 7},
        requiredClientInputs: [],
      },
    ];

    const issue = newInsertFailureIssue(
      'DataLinkDuplicate',
      7,
      'duplicate (source, dest) pair rejected',
      undefined,
      fixOptions,
    );

    expect(issue.code).toBe(INSERT_FAILURE.DataLinkDuplicate.code);
    expect(issue.impactedEntity).toEqual({
      entityType: ISSUE_ENTITY_TYPE.DataLink,
      systemId: 7,
    });
    expect(issue.fixOptions).toEqual(fixOptions);
    expect(issue.category).toBe(IssueCategory.DataLoss);
    expect(issue.severity).toBe(IssueSeverity.Warning);
  });

  it('omits fixOptions when the array is empty', () => {
    const issue = newInsertFailureIssue(
      'DataLinkDuplicate',
      7,
      'detail',
      undefined,
      [],
    );

    expect(issue.fixOptions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/core run test:unit -- --testPathPattern="insert-failure.factory.spec"`
Expected: FAIL with `Cannot find module '.../insert-failure.factory.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/domain/validation/insert-failures/insert-failure.factory.ts
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {ValidationIssue} from '../issue.js';
import type {FixOption} from '../../../shared/issues/index.js';
import {IssueSeverity, IssueCategory} from '../../../shared/issues/index.js';
import {INSERT_FAILURE, type InsertFailureType} from './insert-failure-codes.js';

/**
 * Build a WARNING/DATA_LOSS ValidationIssue from an insert-failure catalog entry.
 *
 * The produced issue is:
 *   - severity=WARNING, defaultSeverity=WARNING (so preference-enforcer treats it uniformly)
 *   - category=DATA_LOSS (drives acknowledgment gate + files.data_loss_issues storage)
 *   - impactedEntity populated from the catalog entry's entityType + caller's systemId
 *   - fixOptions omitted when empty/undefined (structural equivalence with Issue base type)
 *
 * @param type         Symbolic catalog key (grep-able).
 * @param systemId     The failing entity's aggregate systemId (log in hex via BinaryUtils.toHexString elsewhere).
 * @param detail       Raw DB error detail — appended to the catalog's rule name.
 * @param displayName  Optional human-readable identifier (module alias, link name).
 * @param fixOptions   Optional client-actionable fix templates.
 */
export function newInsertFailureIssue(
  type: InsertFailureType,
  systemId: number,
  detail: string,
  displayName?: string,
  fixOptions?: FixOption[],
): ValidationIssue {
  const spec = INSERT_FAILURE[type];
  return {
    code: spec.code,
    name: spec.name,
    message: `${spec.name}: ${detail}`,
    defaultSeverity: IssueSeverity.Warning,
    severity: IssueSeverity.Warning,
    category: IssueCategory.DataLoss,
    impactedEntity: {
      entityType: spec.entityType,
      systemId,
      ...(displayName !== undefined && {displayName}),
    },
    impactedUsecases: [],
    ...(fixOptions && fixOptions.length > 0 && {fixOptions}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/core run test:unit -- --testPathPattern="insert-failure.factory.spec"`
Expected: PASS — four tests green.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/domain/validation/insert-failures/insert-failure.factory.ts \
          packages/core/tests/unit/domain/validation/insert-failures/insert-failure.factory.spec.ts
  git commit -m "feat(core): add newInsertFailureIssue() factory + unit tests" \
             -m "Every catalog entry produces a WARNING/DATA_LOSS ValidationIssue with the correct entityType, name-prefixed message, and optional displayName/fixOptions." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 22: Shrink `IssueCollector` to a thin `Issue[]` accumulator

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/file-operations/upload-file/types/issue-collection.ts`
- Test: `packages/core/tests/unit/application/file-operations/upload-file/types/issue-collection.spec.ts`

**Depends on:** Chapter 01-01 (`shared/issues/` exports `Issue`, `IssueSeverity`).

Design §4.6 mandates:
- Rename accumulated type from `EntityBuildIssue` to base `Issue`.
- Remove `formatForApi()` — callers of the collector output flow directly into `Result.partial(data, collector.getIssues())`.
- `getIssues(): readonly Issue[]`.
- Preserve `addIssue/addIssues/hasIssues/getIssueCount/clear` — call sites in entity-builders and orchestrator still rely on them.
- Drop the local `ISSUE_SEVERITY` / `ENTITY_TYPES` / `EntityBuildIssue` re-declarations (superseded by `shared/issues/`).
- Keep `BuildResult<T>` but retype its `issues` field as `Issue[]` and drop the derived `successCount / errorCount / warningCount` counters (call sites in the orchestrator only read `errorCount` / `warningCount` for log messages — replace those with live severity filters or drop the log detail).

- [ ] **Step 1: Rewrite the test file to assert the new shape**

Replace the entire contents of `packages/core/tests/unit/application/file-operations/upload-file/types/issue-collection.spec.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {IssueCollector} from '../../../../../../src/application/file-operations/upload-file/types/issue-collection.js';
import type {Issue} from '../../../../../../src/shared/issues/index.js';
import {
  IssueSeverity,
  ISSUE_ENTITY_TYPE,
} from '../../../../../../src/shared/issues/index.js';

describe('IssueCollector', () => {
  let collector: IssueCollector;

  beforeEach(() => {
    collector = new IssueCollector();
  });

  const errorIssue: Issue = {
    code: 'ARC-INSERT-MOD-001',
    message: 'Module insert failed',
    severity: IssueSeverity.Error,
    impactedEntity: {entityType: ISSUE_ENTITY_TYPE.SpfModule, systemId: 1},
  };

  const warningIssue: Issue = {
    code: 'ARC-INSERT-LINK-001',
    message: 'Data link duplicate',
    severity: IssueSeverity.Warning,
    impactedEntity: {entityType: ISSUE_ENTITY_TYPE.DataLink, systemId: 2},
  };

  it('adds a single Issue', () => {
    collector.addIssue(errorIssue);
    expect(collector.getIssueCount()).toBe(1);
    expect(collector.getIssues()).toEqual([errorIssue]);
  });

  it('adds many Issues', () => {
    collector.addIssues([errorIssue, warningIssue]);
    expect(collector.getIssueCount()).toBe(2);
    expect(collector.getIssues()).toEqual([errorIssue, warningIssue]);
  });

  it('reports hasIssues correctly', () => {
    expect(collector.hasIssues()).toBe(false);
    collector.addIssue(errorIssue);
    expect(collector.hasIssues()).toBe(true);
  });

  it('clear() empties the accumulator', () => {
    collector.addIssues([errorIssue, warningIssue]);
    collector.clear();
    expect(collector.getIssueCount()).toBe(0);
    expect(collector.getIssues()).toEqual([]);
  });

  it('getIssues returns a defensive copy', () => {
    collector.addIssue(errorIssue);
    const first = collector.getIssues();
    const second = collector.getIssues();
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('does not expose formatForApi', () => {
    expect(
      (collector as unknown as {formatForApi?: unknown}).formatForApi,
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/core run test:unit -- --testPathPattern="issue-collection.spec"`
Expected: FAIL — compile errors on `EntityBuildIssue`, `ISSUE_SEVERITY`, `ENTITY_TYPES` imports (still present in the old `issue-collection.ts`).

- [ ] **Step 3: Rewrite `issue-collection.ts`**

Replace the entire contents of `packages/core/src/application/file-operations/upload-file/types/issue-collection.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Issue} from '../../../../shared/issues/index.js';

/**
 * Result of building entities with issue collection.
 *
 * `issues` is a flat list of base `Issue`s (ValidationIssue is structurally
 * assignable to Issue, so validation-shaped entries flow through without
 * translation). Downstream consumers hand this straight to `Result.partial(data, issues)`.
 */
export interface BuildResult<T> {
  entities: T[];
  issues: Issue[];
}

/**
 * Thin `Issue[]` accumulator used across the upload pipeline.
 *
 * Callers construct concrete Issues via:
 *   - `newInsertFailureIssue(...)` in `domain/validation/insert-failures/` (DATA_LOSS)
 *   - `IssueFactory.parseError(...)`, `IssueFactory.dbError(...)` in `shared/issues/`
 *   - direct object literals for validation rule outputs (ValidationIssue extends Issue)
 *
 * `formatForApi()` from the pre-refactor collector is removed — the collector
 * output is consumed by `Result.partial(data, collector.getIssues())` and the API
 * mapper (`toApiIssueItems`) does the wire-format projection.
 */
export class IssueCollector {
  private issues: Issue[] = [];

  addIssue(issue: Issue): void {
    this.issues.push(issue);
  }

  addIssues(issues: readonly Issue[]): void {
    this.issues.push(...issues);
  }

  getIssues(): readonly Issue[] {
    return [...this.issues];
  }

  hasIssues(): boolean {
    return this.issues.length > 0;
  }

  getIssueCount(): number {
    return this.issues.length;
  }

  clear(): void {
    this.issues = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/core run test:unit -- --testPathPattern="issue-collection.spec"`
Expected: PASS — six tests green.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/file-operations/upload-file/types/issue-collection.ts \
          packages/core/tests/unit/application/file-operations/upload-file/types/issue-collection.spec.ts
  git commit -m "refactor(core): shrink IssueCollector to Issue[] accumulator" \
             -m "Removes formatForApi(), the local ISSUE_SEVERITY/ENTITY_TYPES enums, and the EntityBuildIssue type in favour of the shared Issue vocabulary. Callers now hand collector.getIssues() straight to Result.partial()." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 23: Update entity-builder call sites to the new collector API

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/file-operations/upload-file/services/entity-builders/container-builder.ts`
- Modify: `packages/core/src/application/file-operations/upload-file/services/entity-builders/subgraph-builder.ts`
- Modify: `packages/core/src/application/file-operations/upload-file/services/entity-builders/spf-module-builder.ts`
- Modify: `packages/core/src/application/file-operations/upload-file/services/entity-builders/spf-module-definition-builder.ts`
- Modify: `packages/core/src/application/file-operations/upload-file/services/entity-builders/driver-module-builder.ts`
- Modify: `packages/core/src/application/file-operations/upload-file/services/entity-builders/driver-module-definition-builder.ts`
- Modify: `packages/core/src/application/file-operations/upload-file/services/entity-builders/vcpm-module-definition-builder.ts`
- Modify: `packages/core/src/application/file-operations/upload-file/services/entity-builders/key-definition-builder.ts`

**Depends on:** Task 22 (collector shape), Chapter 01-01 (`shared/issues/` factories).

Entity builders today call `IssueCollector.addError/addWarning({code, message, entityType})`. Those helper methods were removed in Task 22. Replace each call with a base `Issue` literal (or an `IssueFactory.parseError(...)` call for parse-time failures) whose `severity` is set explicitly, and whose `impactedEntity` uses `ISSUE_ENTITY_TYPE` from `@arc/core/shared/issues`.

- [ ] **Step 1: Replace all `addError` / `addWarning` calls in each builder**

For every builder listed above, apply the mechanical rewrite pattern:

```typescript
// BEFORE
issues.push({
  severity: ISSUE_SEVERITY.ERROR,
  code: ERROR_CODES.INVALID_ENTITY_DATA,
  message: `SpfModule with id ${id} missing definition`,
  entityType: ENTITY_TYPES.SPF_MODULE,
});
```

```typescript
// AFTER
issues.push({
  code: 'ARC-BUILD-MOD-001',                    // or reuse ERROR_CODES.* string if the code catalog is retained; agree code prefix during execution
  message: `SpfModule with id ${id} missing definition`,
  severity: IssueSeverity.Error,
  impactedEntity: {
    entityType: ISSUE_ENTITY_TYPE.SpfModule,
    systemId,                                   // populate from builder context
  },
});
```

Delete the old `import {ISSUE_SEVERITY, ENTITY_TYPES, EntityBuildIssue} from '../types/issue-collection.js';` lines and replace with:

```typescript
import {IssueSeverity, ISSUE_ENTITY_TYPE, type Issue} from '../../../../shared/issues/index.js';
```

For builders that push warnings for skipped/malformed source data (e.g., missing optional chunk), prefer:

```typescript
issues.push(IssueFactory.parseError('PARSE_ERROR', `<explanation>`));
```

- [ ] **Step 2: Update each builder's `BuildResult<T>` return statement**

`BuildResult<T>` no longer has `successCount/errorCount/warningCount`. Drop those fields from every `return { entities, issues, ... }` in the builders. Verify by running:

```bash
grep -rn "successCount\|errorCount\|warningCount" packages/core/src/application/file-operations/upload-file/
```
Expected after edits: only matches in test files or the orchestrator's log-message templates (updated in Task 24).

- [ ] **Step 3: Build core**

Run: `pnpm --filter @arc/core run build`
Expected: PASS — no unresolved imports or type errors from any builder.

- [ ] **Step 4: Run affected unit tests**

Run: `pnpm --filter @arc/core run test:unit -- --testPathPattern="entity-builders"`
Expected: PASS (or, where old assertions checked `severity: 'error'` string literals, update the assertion to `IssueSeverity.Error`).

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/file-operations/upload-file/services/entity-builders/
  git commit -m "refactor(core): migrate entity builders to shared Issue vocabulary" \
             -m "Replaces addError/addWarning calls and local ISSUE_SEVERITY/ENTITY_TYPES enums with base Issue literals + IssueFactory.parseError. Drops derived count fields from BuildResult." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 24: Route `BulkInsertResult` failures through `newInsertFailureIssue()`

**Package:** `@arc/core` + `@arc/persistence`

**Files:**
- Modify: `packages/core/src/application/file-operations/upload-file/services/upload-file-orchestrator.ts`
- Modify: `packages/core/src/application/file-operations/upload-file/upload-file.handler.ts`
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/common/group-raw-failures.ts` (optional — see Step 3)

**Depends on:** Tasks 20–23, Chapter 01-01 (`shared/issues/`), Chapter 02-02 (`ValidationIssue`).

Today, `UploadFileOrchestrator.collectInsertionErrors(insertResult, entityType)` only logs — it never populates `this.dataLossIssues`. The pre-existing bulk-inserter path (`groupRawFailures` in `@arc/persistence`) produces `BulkInsertError[]` (message + details strings). Design §4.7 requires each aggregate-level failure to be converted to a `ValidationIssue` produced by `newInsertFailureIssue()` and pushed into `dataLossIssues` for `files.data_loss_issues` storage.

Two-step mapping:
1. In the orchestrator, translate each `BulkInsertError` into a `ValidationIssue` via the catalog factory using the `entityType` label passed to `collectInsertionErrors` (which already carries the source entity kind).
2. Log lines from `insertResult.errors.map(e => e.message)` — unchanged.

The orchestrator does not have access to the failed row's `systemId` in the current `BulkInsertError` shape (`{message, details}`). Add a `systemId?: number` field to `BulkInsertError` and thread it through `groupRawFailures.ts` (Step 3). The systemId is already the key of the `byAggregate` map — expose it on each returned error.

- [ ] **Step 1: Extend `BulkInsertError` with `systemId`**

Edit `packages/core/src/application/ports/persistence/repositories/bulk-import/bulk-insert-result-types.ts`:

```typescript
export type BulkInsertError = {
  readonly systemId: number;
  readonly message: string;
  readonly details: string;
};
```

- [ ] **Step 2: Populate `systemId` in `groupRawFailures`**

Edit `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/common/group-raw-failures.ts`:

```typescript
const errors = [...byAggregate.entries()].map(([systemId, lines]) => ({
  systemId,
  message: `Failed to insert ${describeAggregate(aggregateById.get(systemId)!)}`,
  details: lines.join('\n'),
}));
```

- [ ] **Step 3: Add a mapping from `entityType` label → `InsertFailureType`**

Inside `upload-file-orchestrator.ts`, add a small helper (private method or module-local const) that maps the orchestrator's existing entity-type label strings (`'SpfModule'`, `'DataLink'`, etc.) to the appropriate `InsertFailureType` catalog key. When the label maps to no known type, fall back to `'ModuleDuplicateInstanceId'`-style generic templates already in the catalog only if the entity matches; otherwise skip DATA_LOSS conversion (the log-only path remains for entity types not yet in the catalog):

```typescript
// upload-file-orchestrator.ts (near the top of the class, after the imports)
import {newInsertFailureIssue} from '../../../../domain/validation/insert-failures/insert-failure.factory.js';
import type {InsertFailureType} from '../../../../domain/validation/insert-failures/insert-failure-codes.js';
import type {BulkInsertError} from '../../../ports/persistence/repositories/bulk-import/bulk-insert-result-types.js';

/**
 * Heuristic label→catalog resolver. Extend as new catalog entries land.
 * `null` means "no DATA_LOSS conversion for this entity yet — log only".
 */
private resolveInsertFailureType(
  entityType: string,
  errorDetail: string,
): InsertFailureType | null {
  if (entityType === 'SpfModule') {
    if (errorDetail.includes('FOREIGN KEY') && errorDetail.includes('definition')) {
      return 'ModuleMissingDefinition';
    }
    return 'ModuleDuplicateInstanceId';
  }
  if (entityType === 'DataLink') {
    return 'DataLinkDuplicate';
  }
  return null;
}
```

- [ ] **Step 4: Rewrite `collectInsertionErrors` to append DATA_LOSS issues**

```typescript
private collectInsertionErrors(
  insertResult: BulkInsertResult,
  entityType: string,
): void {
  if (insertResult.ok) return;

  for (const err of insertResult.errors) {
    const failureType = this.resolveInsertFailureType(entityType, err.details);
    if (failureType !== null) {
      this.dataLossIssues.push(
        newInsertFailureIssue(failureType, err.systemId, err.details),
      );
    }
  }

  this.logger?.logError({
    msg: `Insertion errors for ${entityType}: ${insertResult.errors.length} failures`,
    timestamp: new Date(),
    action: 'insertion_errors_collected',
    component: 'UploadFileOrchestrator',
    tag: 'database-persistence',
    error: new Error(
      insertResult.errors.map(e => `${e.message}: ${e.details}`).join('\n'),
    ),
  });
}
```

- [ ] **Step 5: Update `UploadOrchestratorResult` to shed `errors`/`warnings` legacy fields**

Edit the exported `UploadOrchestratorResult` in `upload-file-orchestrator.ts`:

```typescript
export interface UploadOrchestratorResult {
  success: boolean;
  issues: readonly Issue[];         // was: errors, warnings
  dataLossIssues: ValidationIssue[];
  headerData?: AcdbHeaderData;
}
```

Update the tail of `orchestrate()`:

```typescript
// remove: const formattedIssues = this.issueCollector.formatForApi();
return {
  success: !(
    this.dataLossIssues.length > 0 || this.issueCollector.hasIssues()
  ),
  issues: this.issueCollector.getIssues(),
  dataLossIssues: [...this.dataLossIssues],
  headerData: this.extractHeaderData(),
};
```

Delete the now-unused import of `ResultError`/`ResultWarning` from `shared/types/api-result.js` and the commented-out `ERROR_CODES` block.

- [ ] **Step 6: Update `UploadFileHandler` to consume `issues`**

In `packages/core/src/application/file-operations/upload-file/upload-file.handler.ts`:

- Replace `ResultError`/`ResultWarning` imports with `import type {Issue} from '../../../shared/issues/index.js';`
- Change `UploadFileResult`:

  ```typescript
  export type UploadFileResult = {
    projectId: string;
    projectName: string;
    projectDescription: string;
    issues?: readonly Issue[];        // was: errors, warnings
    openStatus: FileOpenStatus;
    validationReport: ValidationReport | null;
  };
  ```

- Replace the trailing return object with:

  ```typescript
  return {
    projectId: project.systemId.toString(),
    projectName: project.name,
    projectDescription: project.description,
    ...(uploadResult.issues.length > 0 && {issues: uploadResult.issues}),
    openStatus: finalStatus,
    validationReport: null,
  };
  ```

- [ ] **Step 7: Build and run tests**

Run: `pnpm --filter @arc/core run build && pnpm --filter @arc/persistence run build`
Expected: PASS.

Run: `pnpm --filter @arc/core run test:unit && pnpm --filter @arc/persistence run test:integration -- --testPathPattern="bulk-import"`
Expected: PASS. Integration tests that assert on `BulkInsertError` shape must now include `systemId` — update those assertions.

Downstream API-layer / controller consumers of `UploadFileResult.errors` / `.warnings` will fail to compile — this is expected. Chapter 05 (API layer) updates them; leave them broken here, or add temporary local mappings in the affected controllers only if a subsequent chapter has not yet landed at execution time.

- [ ] **Step 8: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/ports/persistence/repositories/bulk-import/bulk-insert-result-types.ts \
          packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/bulk-import/common/group-raw-failures.ts \
          packages/core/src/application/file-operations/upload-file/services/upload-file-orchestrator.ts \
          packages/core/src/application/file-operations/upload-file/upload-file.handler.ts
  git commit -m "refactor(core): route bulk-insert failures through newInsertFailureIssue()" \
             -m "Adds systemId to BulkInsertError, maps each aggregate failure to a catalog-backed DATA_LOSS ValidationIssue, and switches UploadOrchestrator/UploadFileHandler to expose Issue[] instead of legacy errors/warnings arrays." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.
### Task 25: Rewrite the seven query-service port files to the new `Result<T>` import path, and change `SpfModuleQueryService.findOne` to throw

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/query-services/spf-module/spf-module-query-service.ts` (import path + `findOne` signature + doc comment)
- Modify: `packages/core/src/application/ports/persistence/query-services/container/container-query-service.ts` (import path only)
- Modify: `packages/core/src/application/ports/persistence/query-services/node/node-query-service.ts` (import path only)
- Modify: `packages/core/src/application/ports/persistence/query-services/key-value/key-value-definition-query-service.ts` (import path only)
- Modify: `packages/core/src/application/ports/persistence/query-services/spf-module-definition/spf-module-definition-query-service.ts` (import path only)
- Modify: `packages/core/src/application/ports/persistence/query-services/spf-module/tuning/spf-tuning-config-service.ts` (import path only)
- Modify: `packages/core/src/application/ports/persistence/query-services/spf-module/tuning/tuning-config-read-model.ts` (verify — no `Result` import today, so no-op; leave file untouched if grep confirms)
- Modify: `packages/core/src/application/ports/persistence/query-services/spf-module/ckv/ckv-query-service.ts` (verify — no `Result` import today, so no-op; leave file untouched if grep confirms)

- [ ] **Step 1: Verify which port files still import from the old `Result/` folder**

Run: `pnpm --filter @arc/core exec grep -rn "shared/Result/operation-result" packages/core/src/application/ports/persistence/query-services/`
Expected: Six matches — one per file listed above (excluding `tuning-config-read-model.ts` and `ckv/ckv-query-service.ts`, which have no `Result` import and can be skipped in this task).

- [ ] **Step 2: Rewrite `spf-module-query-service.ts` — new import path, new `findOne` signature, updated doc**

Replace the entire file body (imports + interface) with:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {SpfModuleReadModel} from './spf-module-read-model.js';
import type {NodeQueryService} from '../node/node-query-service.js';
import type {SpfTuningConfigService} from './tuning/spf-tuning-config-service.js';
import type {Result} from '../../../../shared/result/result.js';
import type {CkvQueryService} from './ckv/ckv-query-service.js';

export interface SpfModuleQueryService {
  readonly ckvQueryService: CkvQueryService;

  /**
   * Returns a single SPF module with ports and definition capabilities.
   * Overlay always applied.
   *
   * Behaviour (FR-1.4):
   *   - Throws `ResourceNotFoundException` when the module does not exist.
   *   - Throws (or rethrows) on any other total failure (DB error, definition failure).
   *   - Never returns `Result.fail` — this method is not `Result`-shaped.
   */
  findOne(
    spfModuleSystemId: number,
    fileSystemId: number,
  ): Promise<SpfModuleReadModel>;

  /**
   * Returns SPF modules for the given system IDs.
   * Overlay always applied.
   * Unknown IDs are silently omitted — partial result.
   * Empty input returns `Result.fail(INVALID_INPUT)` — an empty request is a caller bug.
   */
  findMany(
    systemIds: number[],
    fileSystemId: number,
  ): Promise<Result<SpfModuleReadModel[]>>;

  // Sub-services — reusable directly by handlers that need only ports for a specific node
  readonly nodeQueryService: NodeQueryService;
  readonly spfTuningConfigService: SpfTuningConfigService;
}
```

- [ ] **Step 3: Rewrite the import line in each of the other five ports**

For each of:
- `container/container-query-service.ts`
- `node/node-query-service.ts`
- `key-value/key-value-definition-query-service.ts`
- `spf-module-definition/spf-module-definition-query-service.ts`
- `spf-module/tuning/spf-tuning-config-service.ts`

change the import line

```typescript
import type {Result} from '../../../../shared/Result/operation-result.js';
```
(or the equivalent relative depth — `spf-tuning-config-service.ts` has one extra `../`) to

```typescript
import type {Result} from '../../../../shared/result/result.js';
```
(again preserving the file's original relative depth — `spf-tuning-config-service.ts` uses `../../../../../shared/result/result.js`).

No other lines change in those five files.

- [ ] **Step 4: Build @arc/core**

Run: `pnpm --filter @arc/core run build`
Expected: FAIL — compile errors at every call site that still spells `.isFailure`, `.errors`, `.warnings`, `.data`, or treats `findOne`'s return as a `Result`. This is intentional — those call sites are fixed in the tasks that follow.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/ports/persistence/query-services/spf-module/spf-module-query-service.ts \
          packages/core/src/application/ports/persistence/query-services/container/container-query-service.ts \
          packages/core/src/application/ports/persistence/query-services/node/node-query-service.ts \
          packages/core/src/application/ports/persistence/query-services/key-value/key-value-definition-query-service.ts \
          packages/core/src/application/ports/persistence/query-services/spf-module-definition/spf-module-definition-query-service.ts \
          packages/core/src/application/ports/persistence/query-services/spf-module/tuning/spf-tuning-config-service.ts
  git commit -m "refactor(core): repoint query-service ports at new Result<T>; findOne throws" \
             -m "Switches seven port files to import Result from application/shared/result/result.js. Redefines SpfModuleQueryService.findOne to return SpfModuleReadModel and throw ResourceNotFoundException on missing modules (FR-1.4), replacing the Result.fail(ENTITY_NOT_FOUND) contract that split not-found handling across two code paths." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 26: `DbSpfModuleQueryService.findOne` — throw `ResourceNotFoundException` instead of returning `Result.fail`

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/queries/spf-module/db-spf-module-query-service.ts` (`findOne` only; `findMany` unchanged aside from its own `Result` shape flowing through Task 27's downstream changes — actual `Result.fail`/`Result.ok` usage in `findMany` and helpers is already covered by chapter 02-01's `Result<T>` refactor)

- [ ] **Step 1: Rewrite `findOne` to unwrap `findMany` and throw when the module is missing**

Replace the current `findOne` body (currently lines 86-101) with:

```typescript
async findOne(
  spfModuleSystemId: number,
  fileSystemId: number,
): Promise<SpfModuleReadModel> {
  const result = await this.findMany([spfModuleSystemId], fileSystemId);

  if (result.kind === 'fail') {
    // Preserve underlying issue message for observability, but present as a
    // domain exception per FR-1.4 — findOne never returns Result.
    const message = result.issues[0]?.message ?? 'Failed to load SPF module';
    throw new ResourceNotFoundException(
      `SpfModule not found for systemId=${spfModuleSystemId}: ${message}`,
    );
  }

  const module = result.data[0];
  if (!module) {
    throw new ResourceNotFoundException(
      `SpfModule not found for systemId=${spfModuleSystemId}`,
    );
  }
  return module;
}
```

- [ ] **Step 2: Add the `ResourceNotFoundException` import**

Update the top-of-file `@arc/core` import block:

```typescript
import {
  type SpfModuleQueryService,
  type SpfModuleReadModel,
  type NodeQueryService,
  type SpfTuningConfigService,
  type SpfModuleDefinitionQueryService,
  type CkvQueryService,
  type KeyValueDefQueryService,
  Result,
  ResourceNotFoundException,
  ERROR_CODES,
  CONFIGURATION_INCLUDES,
} from '@arc/core';
```

(`ResourceNotFoundException` is re-exported from `@arc/core/src/shared/exceptions/`. If the barrel does not yet re-export it, add the export there as part of this step.)

- [ ] **Step 3: Verify no other call site in `@arc/persistence` treats `findOne` as a `Result`**

Run: `pnpm --filter @arc/persistence exec grep -rn "spfModuleQueryService.findOne\|SpfModuleQueryService.findOne" packages/infrastructure/persistence/src/`
Expected: Zero matches — nothing in the persistence package calls `findOne` today.

- [ ] **Step 4: Build @arc/persistence**

Run: `pnpm --filter @arc/persistence run build`
Expected: PASS. TypeScript now sees `findOne` as returning `Promise<SpfModuleReadModel>`.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/infrastructure/persistence/src/persistence-typeorm-sqllite/queries/spf-module/db-spf-module-query-service.ts
  git commit -m "refactor(persistence): DbSpfModuleQueryService.findOne throws on not-found" \
             -m "Implements FR-1.4: findOne now throws ResourceNotFoundException when the module is absent (or when the underlying findMany failed), instead of returning Result.fail(ENTITY_NOT_FOUND). Aligns implementation with the port signature updated in Task 25." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 27: Rewrite `SpfModuleQueryHandler` — new `Result<T>` access pattern for `findMany` + inner `Result` maps

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/usecase-designer/spf-module/query/query-spf-modules.handler.ts`
- Test: none exists today — no matching unit spec found under `packages/core/tests/unit/application/usecase-designer/spf-module/query/`. Do not create one — coverage stays where it was (integration + e2e). If chapter 05 (API layer) later adds a unit test, it will follow the new access pattern by construction.

- [ ] **Step 1: Rewrite the handler and its `SpfModuleDetailedReadModel` doc**

Replace the file with:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {QueryHandler} from '../../../orchestration/cqrs/queries/query-handler.js';
import type {QueryServices} from '../../../ports/persistence/query-services/query-services.js';
import type {SpfModuleReadModel} from '../../../ports/persistence/query-services/spf-module/spf-module-read-model.js';
import type {
  CkvReadModel,
  TagReadModel,
} from '../../../ports/persistence/query-services/spf-module/tuning/tuning-config-read-model.js';
import type {SpfModulesQuery as SpfModuleQuery} from './query-spf-modules.query.js';
import {Result} from '../../../shared/result/result.js';
import {CONFIGURATION_INCLUDES} from '../../../ports/persistence/query-services/configuration-includes.js';

export interface SpfModuleDetailedReadModel {
  modules: SpfModuleReadModel[];
  // Present when includeCkvs/includeTags=true — one entry per requested module,
  // regardless of outcome. `kind === 'ok'` with data `[]` means the module
  // genuinely has none; `kind === 'fail'` means loading that module's data
  // errored. Callers must switch on `.kind` per entry rather than inferring
  // from absence.
  ckvsByModule?: Map<number, Result<CkvReadModel[]>>;
  tagsByModule?: Map<number, Result<TagReadModel[]>>;
}

/**
 * Handles SpfModulesQuery.
 *
 * Step 1: Resolve projectId → fileSystemId via ProjectQueryService
 * Step 2: Load SPF modules via SpfModuleQueryService.findMany()
 * Step 3: Load CKVs and tags in parallel across all modules — one call per module per concern
 *
 * Unknown systemIds are silently omitted — partial result.
 * Per-module CKV/tag failures are captured as `Result.fail` entries in
 * ckvsByModule/tagsByModule — every requested module gets an entry either way.
 */
export class SpfModuleQueryHandler implements QueryHandler<
  SpfModuleQuery,
  Promise<Result<SpfModuleDetailedReadModel>>
> {
  constructor(private readonly queryServices: QueryServices) {}

  async handle(
    query: SpfModuleQuery,
  ): Promise<Result<SpfModuleDetailedReadModel>> {
    // Step 1 — resolve projectId → fileSystemId
    const fileSystemId =
      await this.queryServices.projectQueryService.getFileIdByProjectId(
        query.projectId,
      );

    // Step 2 — load modules
    const modulesResult =
      await this.queryServices.spfModuleQueryService.findMany(
        query.systemIds,
        fileSystemId,
      );

    if (modulesResult.kind === 'fail') {
      // Propagate underlying issues verbatim — the port has already produced
      // Issue objects with codes/messages; there is nothing for this handler
      // to add.
      return Result.fail(...modulesResult.issues);
    }

    const modules = modulesResult.data;

    if (modules.length === 0 || (!query.includeCkvs && !query.includeTags)) {
      return Result.ok({modules});
    }

    // Step 3 — load CKVs and tags in parallel across all modules
    // Independent collections — each loads and fails independently per module
    const [ckvsByModule, tagsByModule] = await Promise.all([
      query.includeCkvs
        ? this.loadCkvsForModules(modules, fileSystemId)
        : undefined,
      query.includeTags
        ? this.loadTagsForModules(modules, fileSystemId)
        : undefined,
    ]);

    return Result.ok({modules, ckvsByModule, tagsByModule});
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async loadCkvsForModules(
    modules: SpfModuleReadModel[],
    fileSystemId: number,
  ): Promise<Map<number, Result<CkvReadModel[]>>> {
    const entries = await Promise.all(
      modules.map(async m => {
        const result =
          await this.queryServices.spfTuningConfigService.getModuleCkvs(
            m.systemId,
            fileSystemId,
          );
        return [m.systemId, result] as [number, Result<CkvReadModel[]>];
      }),
    );
    return new Map(entries);
  }

  private async loadTagsForModules(
    modules: SpfModuleReadModel[],
    fileSystemId: number,
  ): Promise<Map<number, Result<TagReadModel[]>>> {
    const entries = await Promise.all(
      modules.map(async m => {
        const result =
          await this.queryServices.spfTuningConfigService.getModuleTags(
            m.systemId,
            fileSystemId,
            CONFIGURATION_INCLUDES.Summary,
          );
        return [m.systemId, result] as [number, Result<TagReadModel[]>];
      }),
    );
    return new Map(entries);
  }
}
```

- [ ] **Step 2: Confirm no other core files under `usecase-designer/spf-module/query/` still spell the old access pattern**

Run: `pnpm --filter @arc/core exec grep -rn "\.isFailure\|\.isSuccess\|modulesResult\.errors" packages/core/src/application/usecase-designer/spf-module/query/`
Expected: Zero matches.

- [ ] **Step 3: Build @arc/core**

Run: `pnpm --filter @arc/core run build`
Expected: PASS locally for this handler; other unmodified call sites (`get-ckv-cal-data.handler.ts`, container handler) still fail. Those are fixed in Task 28.

- [ ] **Step 4: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/usecase-designer/spf-module/query/query-spf-modules.handler.ts
  git commit -m "refactor(core): SpfModuleQueryHandler uses discriminated Result<T>" \
             -m "Rewrites the handler to switch on modulesResult.kind and propagate modulesResult.issues directly. Doc comment on SpfModuleDetailedReadModel updated to describe the new kind-based inspection contract for per-module ckvs/tags maps." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 28: Update the remaining core-layer callers — `ContainerQueryHandler`, `GetCkvCalibrationDataHandler`, and its unit test

**Package:** `@arc/core`

**Files:**
- Modify: `packages/core/src/application/usecase-designer/container/query/query-containers.handler.ts` (import path only — the handler passes `Result<T>` straight through)
- Modify: `packages/core/src/application/usecase-designer/spf-module/get-cal-data/get-ckv-cal-data.handler.ts` (remove the old `spfModuleResult.isFailure` guard — `findOne` now throws directly)
- Modify: `packages/core/tests/unit/application/usecase-designer/spf-module/get-cal-data/get-ckv-cal-data.handler.spec.ts` (rewrite `Result.fail(...)`/`isFailure` fixtures to reflect that `findOne` throws)

- [ ] **Step 1: `query-containers.handler.ts` — swap `Result` import path only**

Change the import line

```typescript
import type {Result} from '../../../shared/Result/operation-result.js';
```
to

```typescript
import type {Result} from '../../../shared/result/result.js';
```

No other changes — the handler already just returns `containerQueryService.findAll(...)` unchanged.

- [ ] **Step 2: `get-ckv-cal-data.handler.ts` — collapse the `isFailure`/`!spfModule` branch**

Replace the current Step 2 block (which currently reads):

```typescript
const spfModuleResult =
  await this.queryServices.spfModuleQueryService.findOne(
    query.spfModuleSystemId,
    fileSystemId,
  );

if (spfModuleResult.isFailure) {
  throw new ResourceNotFoundException(
    spfModuleResult.errors?.[0]?.message ??
      `SpfModule with systemId ${query.spfModuleSystemId} not found`,
  );
}

const spfModule = spfModuleResult.data;

if (!spfModule) {
  throw new ResourceNotFoundException(
    `SpfModule with systemId ${query.spfModuleSystemId} not found`,
  );
}
```

with:

```typescript
// findOne throws ResourceNotFoundException on missing / underlying failure (FR-1.4)
const spfModule =
  await this.queryServices.spfModuleQueryService.findOne(
    query.spfModuleSystemId,
    fileSystemId,
  );
```

`ResourceNotFoundException` is still imported by the handler (needed for the `!ckv` guard below the block), so no import changes are required.

- [ ] **Step 3: Rewrite the affected fixtures in `get-ckv-cal-data.handler.spec.ts`**

For every test that currently sets up

```typescript
mockSpfModuleQueryService.findOne.mockResolvedValue(Result.fail({...}));
// or
mockSpfModuleQueryService.findOne.mockResolvedValue(Result.ok(mockModule));
```

rewrite to the new signature:

```typescript
// success case
mockSpfModuleQueryService.findOne.mockResolvedValue(mockModule);

// not-found case
mockSpfModuleQueryService.findOne.mockRejectedValue(
  new ResourceNotFoundException(
    `SpfModule not found for systemId=${systemId}`,
  ),
);
```

For each affected test assertion:
- Replace `expect(...).rejects.toThrow(ResourceNotFoundException)` — this contract is unchanged when the module is missing.
- Delete any assertion that mocked `findOne` to a `Result.fail` in order to test that the handler translated `Result.fail` into `ResourceNotFoundException`. That transformation now lives in `DbSpfModuleQueryService.findOne` — no handler-level translation to exercise.

- [ ] **Step 4: Run the unit test file to confirm it passes**

Run: `pnpm --filter @arc/core run test:unit:core -- --testPathPattern="get-ckv-cal-data.handler.spec"`
Expected: PASS.

- [ ] **Step 5: Build @arc/core**

Run: `pnpm --filter @arc/core run build`
Expected: PASS. All core-layer callers of `spfModuleQueryService.findOne` now consume the throw-based signature. `.isFailure` is gone from `packages/core/src/`.

Verify: `pnpm --filter @arc/core exec grep -rn "\.isFailure\|\.isSuccess" packages/core/src/`
Expected: Zero matches (this is the last core-side residue of the old shape).

- [ ] **Step 6: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/usecase-designer/container/query/query-containers.handler.ts \
          packages/core/src/application/usecase-designer/spf-module/get-cal-data/get-ckv-cal-data.handler.ts \
          packages/core/tests/unit/application/usecase-designer/spf-module/get-cal-data/get-ckv-cal-data.handler.spec.ts
  git commit -m "refactor(core): migrate ContainerQueryHandler + GetCkvCalibrationDataHandler to new Result<T>" \
             -m "Repoints container handler at application/shared/result/. Collapses the isFailure/null-guard block in GetCkvCalibrationDataHandler now that findOne throws directly. Test fixtures switched from Result.fail/ok wrappers to plain resolve/reject." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 29: Migrate `ProjectRepository` port and `TypeOrmProjectRepository` implementation from `OperationResult<T>` to `Result<T>`

**Package:** `@arc/core` + `@arc/persistence`

**Files:**
- Modify: `packages/core/src/application/ports/persistence/repositories/project/project.repository.ts` (drop `OperationResult`, adopt `Result`)
- Modify: `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/project/typeorm-project.repository.ts` (return `Result.ok(...)` / `Result.fail(...)`)
- Delete (or leave for chapter 06 cleanup — plan choice): `packages/core/src/shared/types/operation-result.ts`. Per the design doc §3.4 the placeholder file is deleted in Batch 2 (chapter 02-01). If it is still present when this task runs, delete it now and update the `shared/types/index.ts` barrel to drop the re-export. Otherwise this bullet is a no-op.

- [ ] **Step 1: Rewrite the port**

Replace `project.repository.ts` with:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {
  ArcDbFile,
  ArcDbFileInit,
  FileOpenStatus,
} from '../../../../../domain/entities/usecase-data/project/arc-db-file.js';
import type {Project} from '../../../../../domain/entities/usecase-data/project/project.js';
import type {ValidationIssue} from '../../../../../domain/validation/issue.js';
import type {Result} from '../../../../shared/result/result.js';

export interface ProjectCreationResult {
  project: Project;
  file: ArcDbFile;
}

export interface FileHeaderData {
  headerVersion: number;
  acdbVersionMajor: number;
  acdbVersionMinor: number;
  acdbVersionRevision: number;
  acdbVersionCplInfo: number;
  codecInfos: string;
  modifiedDate: number;
  oemInfo: string;
}

export interface ProjectRepository {
  /**
   * Insert a new offline project and its initial file in a single operation.
   * Both rows are covered by the caller's active transaction.
   * Returns `Result.fail(...)` (never throws) so the caller can manage rollback explicitly.
   * DB errors surface as an Issue with `code: 'DB_ERROR'` (see IssueFactory.dbError).
   */
  createOfflineProject(
    projectName: string,
    projectDescription: string,
    file: Omit<ArcDbFileInit, 'systemId'>,
  ): Promise<Result<ProjectCreationResult>>;

  /**
   * Update open_status and data_loss_issues for a file after bulk-insert.
   * Always called by the upload handler after Phase 2, regardless of whether
   * there are data loss issues. Transitions the file out of LOADING state.
   */
  updateFileStatus(
    fileSystemId: number,
    openStatus: FileOpenStatus,
    dataLossIssues: ValidationIssue[],
  ): Promise<void>;

  deleteProject(systemId: number): Promise<void>;

  /**
   * Update ACDB header metadata for a file after parsing.
   * Called by the upload handler after successfully parsing the ACDB header.
   */
  updateFileHeader(
    fileSystemId: number,
    headerData: FileHeaderData,
  ): Promise<void>;
}
```

- [ ] **Step 2: Rewrite `TypeOrmProjectRepository.createOfflineProject` to produce `Result<T>`**

In `typeorm-project.repository.ts`:

Update the `@arc/core` import block — drop `OperationResult`, add `Result` and `IssueFactory`:

```typescript
import {
  ArcDbFile,
  IssueFactory,
  Project,
  PROJECT_TYPE,
  Result,
  type ArcDbFileInit,
  type FileHeaderData,
  type FileOpenStatus,
  type ProjectCreationResult,
  type ProjectRepository,
  type ValidationIssue,
} from '@arc/core';
```

Rewrite `createOfflineProject`:

```typescript
async createOfflineProject(
  projectName: string,
  projectDescription: string,
  file: Omit<ArcDbFileInit, 'systemId'>,
): Promise<Result<ProjectCreationResult>> {
  try {
    const projectRow = await this.manager.save(ProjectSchema, {
      name: projectName,
      description: projectDescription,
      type: PROJECT_TYPE.OFFLINE,
    });

    const fileRow = await this.manager.save(ArcDbFileSchema, {
      description: file.description,
      metadata: file.metadata,
      fileName: file.fileName,
      isTarget: file.isTarget,
      openStatus: file.openStatus,
      dataLossIssues: null,
      projectSystemId: projectRow.systemId,
      lastReservedId: 0,
    });

    return Result.ok({
      project: new Project(
        projectRow.systemId,
        projectRow.name,
        projectRow.description,
        PROJECT_TYPE.OFFLINE,
      ),
      file: new ArcDbFile({
        systemId: fileRow.systemId,
        description: file.description,
        metadata: file.metadata,
        fileName: file.fileName,
        isTarget: Boolean(fileRow.isTarget),
        openStatus: fileRow.openStatus,
        dataLossIssues: [],
      }),
    });
  } catch (error) {
    return Result.fail(
      IssueFactory.dbError(
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}
```

The other three methods (`updateFileStatus`, `deleteProject`, `updateFileHeader`) already return `Promise<void>` and stay verbatim.

- [ ] **Step 3: Update any core callers of `createOfflineProject` that pattern-match on `result.success`**

Run: `pnpm --filter @arc/core exec grep -rn "createOfflineProject" packages/core/src/`
Expected: Matches only in `open-file.handler.ts` (Phase 1 of the upload flow). For each match, replace:

```typescript
if (!result.success) { ... use result.errorMessage ... }
```

with:

```typescript
if (result.kind === 'fail') { ... use result.issues ... }
```

and replace `result.data.project` / `result.data.file` accesses — these are unchanged because both `ok` and `fail` variants of `Result<T>` still expose `data` only on the success side (already narrowed by the `kind === 'fail'` check above).

If the caller previously wrapped `errorMessage` into an `OperationResult`-shaped outcome for its own return value, replace with `Result.fail(...result.issues)` — no message reshaping needed.

- [ ] **Step 4: Delete the placeholder `OperationResult<T>` file if still present**

```bash
rm -f packages/core/src/shared/types/operation-result.ts
```

Update `packages/core/src/shared/types/index.ts` (or whichever barrel re-exports it) to drop the line

```typescript
export * from './operation-result.js';
```

If no barrel currently re-exports it, this step is a no-op.

- [ ] **Step 5: Build both packages**

Run: `pnpm --filter @arc/core run build && pnpm --filter @arc/persistence run build`
Expected: PASS. If any other file still spells `OperationResult`, TypeScript will flag it — chase down and rewrite to `Result<T>` in the same commit; the type is being retired wholesale.

Verify: `pnpm --filter @arc/core exec grep -rn "OperationResult" packages/`
Expected: Zero matches after this task (the type is gone from the codebase).

- [ ] **Step 6: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/core/src/application/ports/persistence/repositories/project/project.repository.ts \
          packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/project/typeorm-project.repository.ts \
          packages/core/src/application/file-operations/upload-file/open-file.handler.ts \
          packages/core/src/shared/types/
  git commit -m "refactor(core,persistence): retire OperationResult<T>; ProjectRepository speaks Result<T>" \
             -m "ProjectRepository.createOfflineProject now returns Result<ProjectCreationResult>. TypeOrmProjectRepository maps DB errors through IssueFactory.dbError. OpenFileHandler switches to result.kind === 'fail' / result.issues. Removes packages/core/src/shared/types/operation-result.ts and any barrel re-exports so the legacy shape cannot leak back in." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 30: Update the `TypeOrmProjectRepository` integration test to the new `Result<T>` access pattern

**Package:** `@arc/persistence`

**Files:**
- Modify: `packages/infrastructure/persistence/tests/integration/crud-operations/typeorm-project-repository.spec.ts`

Test-pattern reference for this task (skeleton-only per plan-format.md §"Skeleton Format for Complex Handlers and Tests" — the spec has ~15 test cases, all mechanically identical rewrites; showing every one inflates the plan without adding information).

- [ ] **Step 1: Rewrite each success-path assertion**

For every `it(...)` block that currently spells:

```typescript
expect(result.success).toBe(true);
if (!result.success) return;
expect(result.data.project.systemId).toBeGreaterThan(0);
// ... further result.data.* assertions ...
```

rewrite to:

```typescript
expect(result.kind).toBe('ok');
if (result.kind !== 'ok') return;
expect(result.data.project.systemId).toBeGreaterThan(0);
// ... further result.data.* assertions (unchanged — data still lives at .data)
```

Rationale: the `if (result.kind !== 'ok') return` narrows TypeScript to the `ok` variant, so `.data` typechecks below. Do the same rewrite in every `createOfflineProject` call inside the file — this affects the tests for `updateFileStatus`, `deleteProject`, `updateFileHeader` as well because they call `createOfflineProject` in setup.

- [ ] **Step 2: Rewrite the failure-path assertion in the duplicate-name test**

The block

```typescript
expect(result.success).toBe(false);
if (result.success) return;
expect(result.errorMessage).toBeTruthy();
```

becomes:

```typescript
expect(result.kind).toBe('fail');
if (result.kind !== 'fail') return;
expect(result.issues).toHaveLength(1);
expect(result.issues[0].code).toBe('DB_ERROR');
expect(result.issues[0].message).toBeTruthy();
```

(`DB_ERROR` is the code seeded by `IssueFactory.dbError` from Task 29 Step 2. If chapter 02-01 chose a different code string, use that instead — the failure path is otherwise identical.)

- [ ] **Step 3: Run the integration test**

Run: `pnpm --filter @arc/persistence run test:persistence -- --testPathPattern="typeorm-project-repository.spec"`
Expected: PASS on all ~15 cases in the file.

- [ ] **Step 4: Run the full persistence-package test sweep for a regression check**

Run: `pnpm --filter @arc/persistence run test:persistence`
Expected: PASS. If any other integration spec spells `.isFailure` / `.errors` / `.warnings` / `result.success`, TypeScript compilation of the test will fail — rewrite in this same commit using the pattern in Steps 1-2. Grep first:

```bash
pnpm --filter @arc/persistence exec grep -rn "\.isFailure\|\.isSuccess\|result\.success\|result\.errorMessage" packages/infrastructure/persistence/tests/
```

Expected: Zero matches after edits.

- [ ] **Step 5: Full unit + integration sweep across both packages**

Run: `pnpm --filter @arc/core run test:unit:core && pnpm --filter @arc/persistence run test:persistence`
Expected: PASS. This is the last chapter that touches the `Result` access pattern in core + persistence; downstream chapters (04-*, 05-*) work only on the API layer and Swagger.

- [ ] **Step 6: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/infrastructure/persistence/tests/integration/crud-operations/typeorm-project-repository.spec.ts
  git commit -m "test(persistence): migrate ProjectRepository integration tests to Result<T>" \
             -m "Rewrites .success / .errorMessage assertions to .kind / .issues[0].code checks. Failure-path test now asserts IssueFactory.dbError-shaped Issue with code DB_ERROR. Success-path tests use a kind !== 'ok' early-return to narrow TypeScript before accessing .data." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.
<!--
Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
SPDX-License-Identifier: BSD-3-Clause
-->

## Chapter 04-01: API-layer DTOs — collapse `ApiResult<T>` and align issue DTOs to the base `Issue` shape

**Scope:** Rewrite the API-layer response DTOs under `packages/api/src/presentation/rest/common/dto/api-response/` so they mirror the new core `Issue` / `Result<T>` shapes established in chapters 01-01 (`shared/issues/`) and 02-01 (`Result<T>`). Concretely:

- Collapse `ApiResult<T>` to two fields: `{data?, issues?}`. Drop `errors[]`, `warnings[]`, `success`, `message`.
- Align (or newly write) `ApiIssueItem` + `ApiImpactedEntityDto` so they mirror base `Issue`; align `ApiFixOptionDto` naming and enum imports.
- Align the `enums/` folder — the API layer re-declares enums for Swagger `$ref` schemas (per FR-4.9 — cannot import `@arc/core` value enums into API DTOs). Constant names must match core (`ISSUE_ENTITY_TYPE`, `CLIENT_INPUT_TYPE`, `IssueSeverity`, `IssueCategory`).
- Rewrite `api-issue-item.mapper.ts` so its parameter type is `Issue` from `@arc/core` (NOT PR #85's `ResultIssue` — that transport type is subsumed).
- Delete the retired `api-error-item.dto.ts` / `api-warning-item.dto.ts`.
- Add a mapper unit test.
- Prune `usecase-api-examples.ts` of references to the retired DTOs.

**PR #85 relationship.** This chapter LANDS AFTER PR #85. PR #85 introduces `api-issue-item.dto.ts`, `api-fix-option.dto.ts`, the `enums/` folder, and an initial `api-issue-item.mapper.ts`. When the executing engineer starts these tasks, those files should already exist on the branch. Where PR #85's file already matches design §6 exactly, the task is a no-op — the verify step confirms and the commit is skipped. Where the file needs adjustment (parameter type in the mapper, enum constant name, dropped fields on the DTO), the task rewrites.

**Design references:** design §6.1–§6.5, requirements FR-4.9, FR-2.3, FR-4.8, NFR-4.

**Dependencies:** chapters 01-01 (tasks 1–7 — `shared/issues/` module) and 02-01 (tasks 8–12 — `Result<T>`) must be complete. Chapter 03-02's caller updates (tasks 25–30) are only required for downstream controller wiring in later chapters; they do not gate this chapter's tasks.

---

### Task 31: Collapse `ApiResult<T>` to `{data?, issues?}`

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/common/dto/api-response/api-result.dto.ts` (full rewrite — 5 fields → 2 fields)

- [ ] **Step 1: Rewrite `api-result.dto.ts`**

Replace the entire file with:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {ApiProperty} from '@nestjs/swagger';
import {ApiIssueItem} from './api-issue-item.dto.js';

/**
 * Wire envelope for successful command / query outcomes.
 *
 * Two fields only (design §6.1):
 *   data   — the successful payload (may be omitted for void commands)
 *   issues — non-blocking (WARNING) or per-item (ERROR/FATAL for `partial`)
 *            structured issues; omitted when the outcome is a complete success
 *
 * The retired `success` / `message` fields were noise — HTTP status conveys
 * complete-vs-partial (200 vs 207) and clients can derive booleans from
 * `issues[]` if they need them. Failures no longer travel on `ApiResult` at
 * all — they surface as `ErrorResponse` via `AllExceptionsFilter`.
 */
export class ApiResult<T> {
  @ApiProperty({required: false})
  data?: T;

  @ApiProperty({type: [ApiIssueItem], required: false})
  issues?: ApiIssueItem[];
}
```

- [ ] **Step 2: Build @arc/api**

Run: `pnpm --filter @arc/api run build`
Expected: FAIL — every controller or helper still referencing `result.errors`, `result.warnings`, `result.success`, or `result.message` will fail to compile. That is intentional; downstream chapters (04-*, 05-*) fix those call sites. Only errors originating from **this file** should be about the deleted fields; if the mapper or interceptor also break, defer their fixes to their own tasks.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/dto/api-response/api-result.dto.ts
  git commit -m "refactor(api): collapse ApiResult<T> to {data?, issues?}" \
             -m "Drops success/message and the errors[]/warnings[] split in favour of a single issues[] carrying the unified Issue shape. HTTP status conveys complete-vs-partial. Failures now surface as ErrorResponse via AllExceptionsFilter and never travel on ApiResult. Design §6.1, FR-2.3." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 32: Align the `enums/` folder — verify names match core

**Package:** `@arc/api`

**Files:**
- Modify (or verify no-op): `packages/api/src/presentation/rest/common/dto/api-response/enums/issue-entity-type.enum.ts`
- Verify (likely no-op): `packages/api/src/presentation/rest/common/dto/api-response/enums/issue-severity.enum.ts`
- Verify (likely no-op): `packages/api/src/presentation/rest/common/dto/api-response/enums/issue-category.enum.ts`
- Verify (likely no-op): `packages/api/src/presentation/rest/common/dto/api-response/enums/client-input-type.enum.ts`

These enums are the API layer's re-declared copy of core's issue enums, kept for Swagger `$ref` schema generation (FR-4.9 — `class-validator`-free enums cannot be imported by value from `@arc/core` into API decorators without pulling core into the compiled emit for Swagger). Values must match core string-for-string.

- [ ] **Step 1: Confirm the `enums/` folder exists and inspect current file names**

Run: `ls packages/api/src/presentation/rest/common/dto/api-response/enums/`
Expected (post-PR-#85): `issue-entity-type.enum.ts`, `issue-severity.enum.ts`, `issue-category.enum.ts`, `client-input-type.enum.ts`.

If the folder does not yet exist (PR #85 not landed), create it now — chapter execution assumes PR #85 is merged; halt and escalate to the plan author.

- [ ] **Step 2: Rewrite `issue-entity-type.enum.ts` — constant name must be `ISSUE_ENTITY_TYPE`**

Replace the file with:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * API-layer re-declaration of core's ISSUE_ENTITY_TYPE. Values must match
 * `packages/core/src/shared/issues/impacted-entity.ts` string-for-string.
 *
 * Kept as a separate declaration because Swagger's @ApiProperty({enum, enumName})
 * decorator emits a $ref schema keyed off the object identity — importing the
 * core enum by value would leak @arc/core into the Nest emit. See FR-4.9.
 */
export const ISSUE_ENTITY_TYPE = {
  SpfModule: 'SpfModule',
  DataLink: 'DataLink',
  ControlLink: 'ControlLink',
  Subgraph: 'Subgraph',
  UseCase: 'UseCase',
  Container: 'Container',
  SpfModuleDefinition: 'SpfModuleDefinition',
} as const;
export type IssueEntityType =
  (typeof ISSUE_ENTITY_TYPE)[keyof typeof ISSUE_ENTITY_TYPE];
```

If PR #85 shipped this file with the constant named `VALIDATION_ENTITY_TYPE` (or `ISSUE_ENTITY_TYPE_ENUM`, or any other spelling), the rewrite renames to `ISSUE_ENTITY_TYPE`. If PR #85 already used `ISSUE_ENTITY_TYPE`, this step is a no-op — skip to Step 3.

- [ ] **Step 3: Verify the other three enum files**

For each of `issue-severity.enum.ts`, `issue-category.enum.ts`, `client-input-type.enum.ts`:

1. Confirm the exported constant name matches core exactly:
   - `IssueSeverity` (values `FATAL`, `ERROR`, `WARNING`)
   - `IssueCategory` (values `BLOCKING`, `NON_BLOCKING`, `DATA_LOSS`)
   - `CLIENT_INPUT_TYPE` (values `NUMBER`, `STRING`, `BOOLEAN`)
2. Confirm the exported type alias name matches core (`IssueSeverity`, `IssueCategory`, `ClientInputType`).
3. Confirm values are byte-for-byte identical to `packages/core/src/shared/issues/severity.ts` and `packages/core/src/shared/issues/fix-option.ts`.

If any drift is found, rewrite the file with the correct names/values using the same `as const` + `keyof typeof` pattern shown in Step 2. If everything matches, no changes needed.

- [ ] **Step 4: Grep for stale references**

Run: `pnpm --filter @arc/api exec grep -rn "VALIDATION_ENTITY_TYPE\|ValidationEntityType" packages/api/src/`
Expected: Zero matches (all references now use `ISSUE_ENTITY_TYPE` / `IssueEntityType`).

- [ ] **Step 5: Build @arc/api**

Run: `pnpm --filter @arc/api run build`
Expected: PASS for enum files themselves. Errors from consumers (`api-issue-item.dto.ts`, mapper) are addressed by Tasks 33 and 35.

- [ ] **Step 6: Commit** *(skip if all four files were no-ops)*

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/dto/api-response/enums/
  git commit -m "refactor(api): align enums/ constant names with core shared/issues" \
             -m "Renames VALIDATION_ENTITY_TYPE → ISSUE_ENTITY_TYPE (and any other drifted constants) so the API-layer re-declaration matches @arc/core string-for-string. Values are unchanged. FR-4.9." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 33: Rewrite `api-issue-item.dto.ts` — mirror base `Issue`, declare `ApiImpactedEntityDto`

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/common/dto/api-response/api-issue-item.dto.ts` (full rewrite — verify no-op vs PR #85 field-by-field)

The DTO must structurally mirror core `Issue` (all seven fields — `code`, `message`, `severity`, `category?`, `impactedEntity?`, `impactedUsecases?`, `fixOptions?`). Enum values are imported from the local `enums/` folder (Task 32) so Swagger emits `$ref` schemas keyed on those objects.

- [ ] **Step 1: Rewrite the file**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {ApiProperty} from '@nestjs/swagger';
import {
  ISSUE_ENTITY_TYPE,
  type IssueEntityType,
} from './enums/issue-entity-type.enum.js';
import {
  IssueSeverity as IssueSeverityEnum,
  type IssueSeverity,
} from './enums/issue-severity.enum.js';
import {
  IssueCategory as IssueCategoryEnum,
  type IssueCategory,
} from './enums/issue-category.enum.js';
import {ApiFixOptionDto} from './api-fix-option.dto.js';

/**
 * Nested DTO for the impacted-entity field on ApiIssueItem.
 *
 * Structurally mirrors core `ImpactedEntity` from
 * `packages/core/src/shared/issues/impacted-entity.ts`.
 */
export class ApiImpactedEntityDto {
  @ApiProperty({
    description: 'The type of entity this issue applies to.',
    enum: ISSUE_ENTITY_TYPE,
    enumName: 'IssueEntityType',
  })
  entityType!: IssueEntityType;

  @ApiProperty({
    description: 'System-level identifier of the impacted entity.',
    type: 'number',
  })
  systemId!: number;

  @ApiProperty({
    description: 'Human-readable name for display (e.g., module alias).',
    required: false,
    type: 'string',
  })
  displayName?: string;
}

/**
 * Wire representation of a single structured issue, carried by
 * `ApiResult<T>.issues[]`.
 *
 * Structurally mirrors core `Issue` (design §6.2, FR-4.1). The mapper
 * `toApiIssueItem` performs a field-for-field projection — extra fields
 * on `ValidationIssue` (`name`, `defaultSeverity`) are deliberately not
 * projected so the wire shape stays purely `Issue`.
 */
export class ApiIssueItem {
  @ApiProperty({
    description:
      'Machine-readable issue code. Validation rules use ARC-{ENTITY}-{SEQ}; ' +
      'operational codes are descriptive constants (ENTITY_NOT_FOUND, DB_QUERY_FAILED, PARSE_ERROR).',
    type: 'string',
  })
  code!: string;

  @ApiProperty({
    description: 'Human-readable message describing the issue.',
    type: 'string',
  })
  message!: string;

  @ApiProperty({
    description: 'Severity of the issue.',
    enum: IssueSeverityEnum,
    enumName: 'IssueSeverity',
  })
  severity!: IssueSeverity;

  @ApiProperty({
    description:
      'Optional broader classification (BLOCKING / NON_BLOCKING / DATA_LOSS). ' +
      'Populated by validation issues; typically absent on operational issues.',
    enum: IssueCategoryEnum,
    enumName: 'IssueCategory',
    required: false,
  })
  category?: IssueCategory;

  @ApiProperty({
    description: 'The entity this issue applies to, if any.',
    type: ApiImpactedEntityDto,
    required: false,
  })
  impactedEntity?: ApiImpactedEntityDto;

  @ApiProperty({
    description: 'Use-case systemIds affected by this issue, if any.',
    type: [Number],
    required: false,
  })
  impactedUsecases?: number[];

  @ApiProperty({
    description: 'Client-actionable fix options, if any.',
    type: [ApiFixOptionDto],
    required: false,
  })
  fixOptions?: ApiFixOptionDto[];
}
```

If PR #85's `api-issue-item.dto.ts` already matches this file field-for-field (including the co-declared `ApiImpactedEntityDto`), this step is a no-op — record "already at target state" in the commit message and skip Step 3. Most likely differences:
- Missing `impactedEntity` / `impactedUsecases` / `fixOptions` fields (PR #85 may have shipped only a subset).
- Enum decorators keyed on `VALIDATION_ENTITY_TYPE` instead of `ISSUE_ENTITY_TYPE` — pick up Task 32's rename.
- `ApiImpactedEntityDto` declared in a separate file — move it inline here to keep the DTO surface flat.

- [ ] **Step 2: Build @arc/api**

Run: `pnpm --filter @arc/api run build`
Expected: PASS. The mapper (Task 35) currently references old shapes; if TypeScript flags it, that's addressed by Task 35.

- [ ] **Step 3: Commit** *(skip if Step 1 was a no-op)*

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/dto/api-response/api-issue-item.dto.ts
  git commit -m "refactor(api): ApiIssueItem mirrors core Issue; inline ApiImpactedEntityDto" \
             -m "Full seven-field Issue projection on the wire — code, message, severity, category?, impactedEntity?, impactedUsecases?, fixOptions?. ApiImpactedEntityDto declared alongside so the DTO surface stays flat. Enum @ApiProperty decorators use the aligned enums/ constants (Task 32). Design §6.2, FR-4.1, FR-4.9." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 34: Verify `api-fix-option.dto.ts` from PR #85 matches design §6.3

**Package:** `@arc/api`

**Files:**
- Verify (likely no-op): `packages/api/src/presentation/rest/common/dto/api-response/api-fix-option.dto.ts`

PR #85 introduces this file. Design §6.3 says the file is unchanged from PR #85. This task exists only to prove that assumption on the executing engineer's branch.

- [ ] **Step 1: Open the file and verify field shape**

The DTO must declare exactly these fields on `ApiFixOptionDto`:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | e.g. `"delete-duplicate-link"` |
| `description` | `string` | Human-readable description |
| `commandType` | `string` | Discriminator for the fix-command dispatcher |
| `commandPayload` | `Record<string, unknown>` | Prefilled fields (with `null` placeholders for client-input fields) |
| `requiredClientInputs` | `ApiClientInputSpecDto[]` | Fields the client must fill in |

And `ApiClientInputSpecDto` (declared in the same file) must have:

| Field | Type | Notes |
|---|---|---|
| `field` | `string` | Key in `commandPayload` the client fills in |
| `label` | `string` | UI prompt label |
| `type` | `ClientInputType` | Imported from `./enums/client-input-type.enum.js` |

The `type` field must use the API-layer's `CLIENT_INPUT_TYPE` enum for its `@ApiProperty` decorator (design §6.3, FR-4.9).

- [ ] **Step 2: If drift found, rewrite the file**

Rewrite content (only if verification fails):

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {ApiProperty} from '@nestjs/swagger';
import {
  CLIENT_INPUT_TYPE,
  type ClientInputType,
} from './enums/client-input-type.enum.js';

/**
 * Client-input specification for a fix option. Mirrors core `ClientInputSpec`
 * from `packages/core/src/shared/issues/fix-option.ts`.
 */
export class ApiClientInputSpecDto {
  @ApiProperty({
    description:
      'Key in commandPayload the client must fill in before dispatching the fix.',
    type: 'string',
  })
  field!: string;

  @ApiProperty({
    description: 'UI prompt label shown to the user.',
    type: 'string',
  })
  label!: string;

  @ApiProperty({
    description: 'Input type the UI should render.',
    enum: CLIENT_INPUT_TYPE,
    enumName: 'ClientInputType',
  })
  type!: ClientInputType;
}

/**
 * Client-actionable fix option carried by ApiIssueItem.fixOptions[]. Mirrors
 * core `FixOption` from `packages/core/src/shared/issues/fix-option.ts`.
 */
export class ApiFixOptionDto {
  @ApiProperty({
    description: 'Stable identifier — e.g. "delete-duplicate-link".',
    type: 'string',
  })
  id!: string;

  @ApiProperty({
    description: 'Human-readable description of the fix.',
    type: 'string',
  })
  description!: string;

  @ApiProperty({
    description: 'Discriminator consumed by the fix-command dispatcher.',
    type: 'string',
  })
  commandType!: string;

  @ApiProperty({
    description:
      'Prefilled command payload — fields the client must fill in are set to null.',
    type: 'object',
    additionalProperties: true,
  })
  commandPayload!: Record<string, unknown>;

  @ApiProperty({
    description: 'Fields the client must fill in before dispatching.',
    type: [ApiClientInputSpecDto],
  })
  requiredClientInputs!: ApiClientInputSpecDto[];
}
```

- [ ] **Step 3: Build @arc/api**

Run: `pnpm --filter @arc/api run build`
Expected: PASS.

- [ ] **Step 4: Commit** *(skip if Step 1 verified no drift)*

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/dto/api-response/api-fix-option.dto.ts
  git commit -m "refactor(api): align ApiFixOptionDto with design §6.3" \
             -m "Verifies (and, where drifted, restores) the shape shipped by PR #85: ApiFixOptionDto and ApiClientInputSpecDto with the CLIENT_INPUT_TYPE enum decorator. Design §6.3." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 35: Rewrite `api-issue-item.mapper.ts` — parameter type is `Issue`, not `ResultIssue`

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/common/dto/api-response/api-issue-item.mapper.ts` (full rewrite)

Design §6.4 and FR-4.8: the mapper projects **base `Issue` fields only**. Extra fields on `ValidationIssue` (`name`, `defaultSeverity`) are naturally dropped because they do not appear on `Issue`. PR #85's mapper was keyed on `ResultIssue` — the type is retired; parameter type becomes `Issue` from `@arc/core`.

- [ ] **Step 1: Rewrite the mapper**

Replace the file with:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Issue} from '@arc/core';
import {ApiFixOptionDto} from './api-fix-option.dto.js';
import {
  ApiImpactedEntityDto,
  ApiIssueItem,
} from './api-issue-item.dto.js';

/**
 * Project a core `Issue` to its API-layer wire shape.
 *
 * Field-for-field projection (design §6.4, FR-4.8). Extra fields present on
 * subtypes such as `ValidationIssue` (`name`, `defaultSeverity`) are naturally
 * dropped — they do not appear on the base `Issue` interface and therefore
 * do not appear here.
 */
export function toApiIssueItem(issue: Issue): ApiIssueItem {
  const dto = new ApiIssueItem();
  dto.code = issue.code;
  dto.message = issue.message;
  dto.severity = issue.severity;
  if (issue.category !== undefined) dto.category = issue.category;
  if (issue.impactedEntity !== undefined) {
    const nested = new ApiImpactedEntityDto();
    nested.entityType = issue.impactedEntity.entityType;
    nested.systemId = issue.impactedEntity.systemId;
    if (issue.impactedEntity.displayName !== undefined) {
      nested.displayName = issue.impactedEntity.displayName;
    }
    dto.impactedEntity = nested;
  }
  if (issue.impactedUsecases !== undefined) {
    dto.impactedUsecases = [...issue.impactedUsecases];
  }
  if (issue.fixOptions !== undefined && issue.fixOptions.length > 0) {
    dto.fixOptions = issue.fixOptions.map(fo => {
      const foDto = new ApiFixOptionDto();
      foDto.id = fo.id;
      foDto.description = fo.description;
      foDto.commandType = fo.commandType;
      foDto.commandPayload = fo.commandPayload;
      foDto.requiredClientInputs = fo.requiredClientInputs.map(spec => ({
        field: spec.field,
        label: spec.label,
        type: spec.type,
      }));
      return foDto;
    });
  }
  return dto;
}

/**
 * Convenience wrapper — projects an optional readonly array of `Issue`,
 * returning `undefined` for empty or missing input so `ApiResult<T>.issues`
 * stays absent rather than serialising `[]` on the wire (design §6.4).
 */
export function toApiIssueItems(
  issues?: readonly Issue[],
): ApiIssueItem[] | undefined {
  if (!issues || issues.length === 0) return undefined;
  return issues.map(toApiIssueItem);
}
```

- [ ] **Step 2: Verify `Issue` is re-exported from `@arc/core`**

Run: `pnpm --filter @arc/core exec grep -n "export.*from.*shared/issues" packages/core/src/index.ts`
Expected: A single line re-exporting the `shared/issues/` barrel (created in chapter 01-01, Task 7). If missing, add:

```typescript
export * from './shared/issues/index.js';
```

- [ ] **Step 3: Build @arc/api**

Run: `pnpm --filter @arc/api run build`
Expected: PASS. The mapper compiles against `Issue` from `@arc/core` and the DTOs from Tasks 31/33/34.

- [ ] **Step 4: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/dto/api-response/api-issue-item.mapper.ts
  git commit -m "refactor(api): api-issue-item.mapper accepts core Issue directly" \
             -m "Retires PR #85's ResultIssue-parameter contract in favour of Issue from @arc/core. Field-for-field projection to ApiIssueItem; ValidationIssue's extra name/defaultSeverity fields are naturally dropped. toApiIssueItems returns undefined for empty input so ApiResult.issues stays absent on complete-success responses. Design §6.4, FR-4.8." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 36: Unit test for `api-issue-item.mapper.ts`

**Package:** `@arc/api`

**Files:**
- Create: `packages/api/tests/unit/presentation/rest/common/dto/api-response/api-issue-item.mapper.spec.ts`

Five cases (design §6.4 acceptance surface): operational `Issue` projection, full `ValidationIssue` projection with extras dropped, `undefined`/empty-array short-circuit, `fixOptions[]` mapping, and nested `impactedEntity` projection.

- [ ] **Step 1: Write the failing test**

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {
  CLIENT_INPUT_TYPE,
  ISSUE_ENTITY_TYPE,
  IssueCategory,
  IssueSeverity,
  type Issue,
  type ValidationIssue,
} from '@arc/core';
import {
  toApiIssueItem,
  toApiIssueItems,
} from '../../../../../../../src/presentation/rest/common/dto/api-response/api-issue-item.mapper.js';
import {ApiImpactedEntityDto} from '../../../../../../../src/presentation/rest/common/dto/api-response/api-issue-item.dto.js';

describe('api-issue-item.mapper', () => {
  describe('toApiIssueItem', () => {
    it('projects an operational Issue with only code/message/severity', () => {
      const issue: Issue = {
        code: 'ENTITY_NOT_FOUND',
        message: 'SpfModule not found (systemId: 42)',
        severity: IssueSeverity.Error,
      };

      const dto = toApiIssueItem(issue);

      expect(dto.code).toBe('ENTITY_NOT_FOUND');
      expect(dto.message).toBe('SpfModule not found (systemId: 42)');
      expect(dto.severity).toBe(IssueSeverity.Error);
      expect(dto.category).toBeUndefined();
      expect(dto.impactedEntity).toBeUndefined();
      expect(dto.impactedUsecases).toBeUndefined();
      expect(dto.fixOptions).toBeUndefined();
    });

    it('projects a full ValidationIssue and drops name/defaultSeverity', () => {
      const rule: ValidationIssue = {
        code: 'ARC-MOD-001',
        name: 'Missing Module Definition',
        message: "Module 'PCM Decoder' references missing definition 0x07010105",
        severity: IssueSeverity.Error,
        defaultSeverity: IssueSeverity.Error,
        category: IssueCategory.Blocking,
        impactedEntity: {
          entityType: ISSUE_ENTITY_TYPE.SpfModule,
          systemId: 1001,
          displayName: 'PCM Decoder',
        },
        impactedUsecases: [101, 102],
        fixOptions: [],
      };

      const dto = toApiIssueItem(rule);

      // Base fields project through
      expect(dto.code).toBe('ARC-MOD-001');
      expect(dto.severity).toBe(IssueSeverity.Error);
      expect(dto.category).toBe(IssueCategory.Blocking);
      expect(dto.impactedUsecases).toEqual([101, 102]);
      // ValidationIssue-only fields are absent
      expect((dto as unknown as {name?: unknown}).name).toBeUndefined();
      expect(
        (dto as unknown as {defaultSeverity?: unknown}).defaultSeverity,
      ).toBeUndefined();
      // Empty fixOptions collapses — mapper omits when length === 0
      expect(dto.fixOptions).toBeUndefined();
    });

    it('projects impactedEntity as a nested ApiImpactedEntityDto instance', () => {
      const issue: Issue = {
        code: 'DB_QUERY_FAILED',
        message: 'boom',
        severity: IssueSeverity.Error,
        impactedEntity: {
          entityType: ISSUE_ENTITY_TYPE.Container,
          systemId: 601,
        },
      };

      const dto = toApiIssueItem(issue);

      expect(dto.impactedEntity).toBeInstanceOf(ApiImpactedEntityDto);
      expect(dto.impactedEntity?.entityType).toBe(ISSUE_ENTITY_TYPE.Container);
      expect(dto.impactedEntity?.systemId).toBe(601);
      expect(dto.impactedEntity?.displayName).toBeUndefined();
    });

    it('projects fixOptions with client-input specs', () => {
      const issue: Issue = {
        code: 'ARC-INSERT-LINK-001',
        message: 'Duplicate data link',
        severity: IssueSeverity.Warning,
        category: IssueCategory.DataLoss,
        impactedEntity: {
          entityType: ISSUE_ENTITY_TYPE.DataLink,
          systemId: 4001,
        },
        fixOptions: [
          {
            id: 'delete-duplicate-link',
            description: 'Delete the duplicate link',
            commandType: 'DELETE_LINK',
            commandPayload: {linkId: 4001},
            requiredClientInputs: [
              {
                field: 'confirm',
                label: 'Confirm deletion',
                type: CLIENT_INPUT_TYPE.Boolean,
              },
            ],
          },
        ],
      };

      const dto = toApiIssueItem(issue);

      expect(dto.fixOptions).toHaveLength(1);
      expect(dto.fixOptions?.[0].id).toBe('delete-duplicate-link');
      expect(dto.fixOptions?.[0].commandPayload).toEqual({linkId: 4001});
      expect(dto.fixOptions?.[0].requiredClientInputs).toEqual([
        {field: 'confirm', label: 'Confirm deletion', type: CLIENT_INPUT_TYPE.Boolean},
      ]);
    });
  });

  describe('toApiIssueItems', () => {
    it('returns undefined for undefined input', () => {
      expect(toApiIssueItems(undefined)).toBeUndefined();
    });

    it('returns undefined for empty array input', () => {
      expect(toApiIssueItems([])).toBeUndefined();
    });

    it('maps a non-empty readonly array element-wise', () => {
      const issues: readonly Issue[] = [
        {code: 'A', message: 'a', severity: IssueSeverity.Warning},
        {code: 'B', message: 'b', severity: IssueSeverity.Error},
      ];

      const dtos = toApiIssueItems(issues);

      expect(dtos).toHaveLength(2);
      expect(dtos?.[0].code).toBe('A');
      expect(dtos?.[1].severity).toBe(IssueSeverity.Error);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it passes (mapper is already implemented in Task 35)**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="api-issue-item.mapper.spec"`
Expected: PASS (all seven `it(...)` cases green).

If any case fails, the failure is either in Task 35's mapper (fix there) or in Task 33's DTO (fix there) — do not paper over with a test change.

- [ ] **Step 3: Run the full API unit test suite for regression**

Run: `pnpm --filter @arc/api run test:unit:api`
Expected: PASS. Any pre-existing test still spelling `ApiErrorItem` / `ApiWarningItem` will fail here — those are addressed by Task 37 which deletes the DTOs.

- [ ] **Step 4: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/tests/unit/presentation/rest/common/dto/api-response/api-issue-item.mapper.spec.ts
  git commit -m "test(api): cover api-issue-item.mapper projection behaviour" \
             -m "Seven cases: minimal operational Issue projection, full ValidationIssue projection with name/defaultSeverity dropped, nested ApiImpactedEntityDto shape, fixOptions with client-input specs, undefined/empty-array short-circuit, non-empty array mapping. Guards design §6.4 and FR-4.8." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 37: Delete `api-error-item.dto.ts` / `api-warning-item.dto.ts` and clean up example providers

**Package:** `@arc/api`

**Files:**
- Delete: `packages/api/src/presentation/rest/common/dto/api-response/api-error-item.dto.ts`
- Delete: `packages/api/src/presentation/rest/common/dto/api-response/api-warning-item.dto.ts`
- Modify: `packages/api/src/presentation/rest/common/swagger-doc/dto-examples/usecase-api-examples.ts` (remove any imports/references to the deleted DTOs; add `ApiIssueItem` example if the file already contains an `ApiResult` example)
- Verify: any barrel `index.ts` under `api-response/` — drop `export * from './api-error-item.dto.js'` / `'./api-warning-item.dto.js'` if present

- [ ] **Step 1: Grep for all remaining references to the retired DTOs across `packages/api`**

Run: `pnpm --filter @arc/api exec grep -rn "ApiErrorItem\|ApiWarningItem\|api-error-item\|api-warning-item" packages/api/src/ packages/api/tests/`
Expected: All matches must be in files we are about to edit — chiefly `usecase-api-examples.ts` and possibly a barrel `index.ts`. If any live in a controller or interceptor, halt and route to chapters 04-* / 05-* (those chapters own controller migration).

- [ ] **Step 2: Delete the two DTO files**

```bash
rm packages/api/src/presentation/rest/common/dto/api-response/api-error-item.dto.ts
rm packages/api/src/presentation/rest/common/dto/api-response/api-warning-item.dto.ts
```

- [ ] **Step 3: Drop barrel re-exports**

If `packages/api/src/presentation/rest/common/dto/api-response/index.ts` exists, open it and remove the two lines:

```typescript
export * from './api-error-item.dto.js';
export * from './api-warning-item.dto.js';
```

If no such barrel exists (files were previously imported directly), skip this step.

- [ ] **Step 4: Prune `usecase-api-examples.ts`**

Open `packages/api/src/presentation/rest/common/swagger-doc/dto-examples/usecase-api-examples.ts` and remove any `ApiErrorItem` / `ApiWarningItem` import lines and any example provider block that constructs those DTOs. If the file previously exposed an example provider returning an `ApiResult` populated with `errors`/`warnings`, replace the populated-issue array with an `ApiIssueItem` example along these lines:

```typescript
import {ApiIssueItem} from '../../dto/api-response/api-issue-item.dto.js';
import {IssueSeverity} from '../../dto/api-response/enums/issue-severity.enum.js';

// ...inside the affected example provider:
const warningIssue = new ApiIssueItem();
warningIssue.code = 'ARC-INSERT-MOD-002';
warningIssue.message =
  "Module 'PCM Decoder' skipped — missing definition 0x07010105";
warningIssue.severity = IssueSeverity.Warning;
```

If the current file (per the read of the example provider) does not reference `ApiErrorItem` / `ApiWarningItem` at all, this step is a no-op — the file already carries only usecase/component examples and needs no `ApiIssueItem` example added here (design §6 leaves example curation to a follow-up).

- [ ] **Step 5: Build @arc/api**

Run: `pnpm --filter @arc/api run build`
Expected: PASS. TypeScript resolves every import; no reference to the deleted DTOs remains.

- [ ] **Step 6: Run the full API unit test suite**

Run: `pnpm --filter @arc/api run test:unit:api`
Expected: PASS. Mapper spec from Task 36 stays green; any other spec that imported the retired DTOs was flagged in Step 1 and is now fixed.

- [ ] **Step 7: Regenerate Swagger (spot-check only — full regen lives in chapter 06)**

Run: `pnpm run generate:swagger`
Expected: Success. Inspect `docs/swagger-api.json` for absence of `ApiErrorItem` / `ApiWarningItem` schemas and presence of `ApiIssueItem` / `ApiImpactedEntityDto` / `ApiFixOptionDto` / `ApiClientInputSpecDto` — plus `enum` schemas named `IssueSeverity`, `IssueCategory`, `IssueEntityType`, `ClientInputType` (from Task 33's `enumName` decorators).

This is a visual spot-check — an authoritative regen with commit of `docs/swagger-api.json` lands in chapter 06.

- [ ] **Step 8: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add -A packages/api/src/presentation/rest/common/dto/api-response/ \
          packages/api/src/presentation/rest/common/swagger-doc/dto-examples/usecase-api-examples.ts
  git commit -m "refactor(api): remove ApiErrorItem/ApiWarningItem; prune stale swagger examples" \
             -m "Retires the errors[]/warnings[] wire shape completely — the collapsed ApiResult<T> (Task 31) speaks only issues[] typed as ApiIssueItem. Barrel re-exports and example providers cleaned up so no dangling reference to the deleted DTOs remains. Swagger regen deferred to chapter 06. Design §6.5." \
             -m "Signed-off-by: Nithin Simon <nithinsimon@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

*End of chapter 04-01.*
### Task 38: Build the HTTP-status code map (`http-status-map.ts`)

**Package:** `@arc/api`

**Files:**
- Create: `packages/api/src/presentation/rest/common/result/http-status-map.ts`
- Test: `packages/api/tests/unit/presentation/rest/common/result/http-status-map.spec.ts`

Design refs: §5.2, FR-6.4. This map is a plain function of `code -> HttpStatus` — no NestJS runtime, no DI. It powers `throwIfFailed()` (Task 39). Exact map for the six operational codes; prefix map for the open set of `ARC-INSERT-*` (DATA_LOSS insert failures) and `ARC-*` (validation rules). Fallback is `500`.

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/unit/presentation/rest/common/result/http-status-map.spec.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {HttpStatus} from '@nestjs/common';
import {resolveHttpStatus} from '../../../../../../src/presentation/rest/common/result/http-status-map.js';

describe('resolveHttpStatus', () => {
  describe('exact code lookups (§5.2)', () => {
    it('maps ENTITY_NOT_FOUND to 404', () => {
      expect(resolveHttpStatus('ENTITY_NOT_FOUND')).toBe(HttpStatus.NOT_FOUND);
    });

    it('maps DB_QUERY_FAILED to 500', () => {
      expect(resolveHttpStatus('DB_QUERY_FAILED')).toBe(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it('maps PARSE_ERROR to 400', () => {
      expect(resolveHttpStatus('PARSE_ERROR')).toBe(HttpStatus.BAD_REQUEST);
    });

    it('maps PARAM_PAYLOAD_NOT_FOUND to 404', () => {
      expect(resolveHttpStatus('PARAM_PAYLOAD_NOT_FOUND')).toBe(
        HttpStatus.NOT_FOUND,
      );
    });

    it('maps SESSION_NOT_OPEN to 403', () => {
      expect(resolveHttpStatus('SESSION_NOT_OPEN')).toBe(HttpStatus.FORBIDDEN);
    });

    it('maps SESSION_MODE_NOT_ALLOWED to 403', () => {
      expect(resolveHttpStatus('SESSION_MODE_NOT_ALLOWED')).toBe(
        HttpStatus.FORBIDDEN,
      );
    });
  });

  describe('prefix map', () => {
    it('maps ARC-INSERT-* to 422 (DATA_LOSS insert failures)', () => {
      expect(resolveHttpStatus('ARC-INSERT-MOD-001')).toBe(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
      expect(resolveHttpStatus('ARC-INSERT-LINK-001')).toBe(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    });

    it('maps ARC-* (non-INSERT) to 422 (validation rules)', () => {
      expect(resolveHttpStatus('ARC-MOD-001')).toBe(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
      expect(resolveHttpStatus('ARC-LINK-042')).toBe(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    });

    it('ARC-INSERT- match wins over ARC- match (ordering)', () => {
      // Same target status today (422), but ordering must remain stable if
      // ARC-INSERT-* is ever moved to a different status.
      expect(resolveHttpStatus('ARC-INSERT-XYZ-999')).toBe(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    });
  });

  describe('fallback', () => {
    it('falls back to 500 for an unmapped code', () => {
      expect(resolveHttpStatus('SOMETHING_UNKNOWN')).toBe(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it('falls back to 500 for an empty string code', () => {
      expect(resolveHttpStatus('')).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="result/http-status-map.spec.ts"`
Expected: FAIL with `Cannot find module '.../result/http-status-map.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/api/src/presentation/rest/common/result/http-status-map.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {HttpStatus} from '@nestjs/common';

/**
 * Exact-match code -> HTTP status. Operational codes from `IssueFactory`
 * and session/parameter codes live here. Design §5.2.
 */
const EXACT_CODE_MAP = new Map<string, HttpStatus>([
  ['ENTITY_NOT_FOUND', HttpStatus.NOT_FOUND], // 404
  ['DB_QUERY_FAILED', HttpStatus.INTERNAL_SERVER_ERROR], // 500
  ['PARSE_ERROR', HttpStatus.BAD_REQUEST], // 400
  ['PARAM_PAYLOAD_NOT_FOUND', HttpStatus.NOT_FOUND], // 404
  ['SESSION_NOT_OPEN', HttpStatus.FORBIDDEN], // 403
  ['SESSION_MODE_NOT_ALLOWED', HttpStatus.FORBIDDEN], // 403
]);

/**
 * Prefix-match table. Iterated in order — first match wins.
 *
 * `ARC-INSERT-*` is listed before `ARC-*` so future divergence
 * (e.g. moving DATA_LOSS to a different status) is a one-line change.
 */
const PREFIX_MAP: ReadonlyArray<[string, HttpStatus]> = [
  ['ARC-INSERT-', HttpStatus.UNPROCESSABLE_ENTITY], // 422 — DATA_LOSS
  ['ARC-', HttpStatus.UNPROCESSABLE_ENTITY], // 422 — validation rules
];

/**
 * Resolves a `Result.fail` primary issue code to an HTTP status.
 * Unmapped codes fall back to 500 Internal Server Error.
 *
 * Called by `throwIfFailed()` at the HTTP boundary. Not used elsewhere.
 */
export function resolveHttpStatus(code: string): HttpStatus {
  const exact = EXACT_CODE_MAP.get(code);
  if (exact !== undefined) return exact;
  for (const [prefix, status] of PREFIX_MAP) {
    if (code.startsWith(prefix)) return status;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="result/http-status-map.spec.ts"`
Expected: PASS — all 10 assertions green.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/result/http-status-map.ts \
          packages/api/tests/unit/presentation/rest/common/result/http-status-map.spec.ts
  git commit -m "feat(api): add resolveHttpStatus for issue-code to HTTP mapping" \
             -m "Introduces the exact-match + prefix-match table used by throwIfFailed() at the HTTP boundary. ARC-INSERT-* and ARC-* validation codes both resolve to 422; six operational codes have exact mappings; unmapped codes fall back to 500 (§5.2)." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 39: Implement `throwIfFailed<T>()` — the explicit unwrap helper

**Package:** `@arc/api`

**Files:**
- Create: `packages/api/src/presentation/rest/common/result/throw-if-failed.ts`
- Test: `packages/api/tests/unit/presentation/rest/common/result/throw-if-failed.spec.ts`

Design refs: §5.1, FR-6.4. `throwIfFailed` is deliberately a **named function** (not an interceptor) — it appears in stack traces, is grep-able, and TypeScript narrows the argument via `asserts` so subsequent code can access `.data`. On a `'fail'` result it throws `HttpException` with the payload `{statusCode, errorCode, message, issues}`; the caught exception is later reshaped by `AllExceptionsFilter` (Task 43) into the top-level `ErrorResponse.issues` field.

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/unit/presentation/rest/common/result/throw-if-failed.spec.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {HttpException, HttpStatus} from '@nestjs/common';
import type {Issue, Result} from '@arc/core';
import {IssueSeverity} from '@arc/core';
import {throwIfFailed} from '../../../../../../src/presentation/rest/common/result/throw-if-failed.js';

describe('throwIfFailed', () => {
  it('does not throw when the result is ok', () => {
    const result: Result<number> = {kind: 'ok', data: 42};
    expect(() => throwIfFailed(result)).not.toThrow();
  });

  it('does not throw when the result is ok with WARNING-severity issues', () => {
    const warning: Issue = {
      code: 'ARC-INSERT-MOD-002',
      message: 'Module dropped',
      severity: IssueSeverity.Warning,
    };
    const result: Result<number> = {kind: 'ok', data: 42, issues: [warning]};
    expect(() => throwIfFailed(result)).not.toThrow();
  });

  it('does not throw when the result is partial', () => {
    const errorIssue: Issue = {
      code: 'ENTITY_NOT_FOUND',
      message: 'Module 5 not found',
      severity: IssueSeverity.Error,
    };
    const result: Result<number[]> = {
      kind: 'partial',
      data: [1, 2, 3],
      issues: [errorIssue],
    };
    expect(() => throwIfFailed(result)).not.toThrow();
  });

  it('throws HttpException with mapped status when the result is fail', () => {
    const issue: Issue = {
      code: 'ENTITY_NOT_FOUND',
      message: 'Project 7 not found',
      severity: IssueSeverity.Error,
    };
    const result: Result<never> = {kind: 'fail', issues: [issue]};

    expect(() => throwIfFailed(result)).toThrow(HttpException);
    try {
      throwIfFailed(result);
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.NOT_FOUND);
      const payload = ex.getResponse() as Record<string, unknown>;
      expect(payload).toEqual({
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: 'ENTITY_NOT_FOUND',
        message: 'Project 7 not found',
        issues: [issue],
      });
    }
  });

  it('uses the first issue as the primary for status + code + message', () => {
    const first: Issue = {
      code: 'ARC-MOD-001',
      message: 'Missing definition',
      severity: IssueSeverity.Error,
    };
    const second: Issue = {
      code: 'DB_QUERY_FAILED',
      message: 'Timeout',
      severity: IssueSeverity.Error,
    };
    const result: Result<never> = {kind: 'fail', issues: [first, second]};

    try {
      throwIfFailed(result);
      fail('expected throw');
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      const payload = ex.getResponse() as Record<string, unknown>;
      expect(payload.errorCode).toBe('ARC-MOD-001');
      expect(payload.message).toBe('Missing definition');
      expect(payload.issues).toEqual([first, second]);
    }
  });

  it('falls back to 500 for an unmapped code', () => {
    const issue: Issue = {
      code: 'MYSTERY_CODE',
      message: 'Unmapped',
      severity: IssueSeverity.Error,
    };
    const result: Result<never> = {kind: 'fail', issues: [issue]};

    try {
      throwIfFailed(result);
      fail('expected throw');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="result/throw-if-failed.spec.ts"`
Expected: FAIL with `Cannot find module '.../throw-if-failed.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/api/src/presentation/rest/common/result/throw-if-failed.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {HttpException} from '@nestjs/common';
import type {Result} from '@arc/core';
import {resolveHttpStatus} from './http-status-map.js';

/**
 * Throws a mapped `HttpException` when a `Result<T>` is a failure;
 * narrows `Result<T>` to the non-failure variant otherwise (design §5.1).
 *
 * The thrown exception's payload is `{statusCode, errorCode, message, issues}` —
 * `AllExceptionsFilter` then reshapes it into the top-level `ErrorResponse` on the wire.
 *
 * Intentionally a **named function**, not an interceptor:
 *   - Appears in stack traces (grep-able boundary).
 *   - Two-line usage in each controller keeps control-flow explicit.
 *   - `asserts` return type gives compile-time narrowing at the call site.
 */
export function throwIfFailed<T>(
  result: Result<T>,
): asserts result is Exclude<Result<T>, {kind: 'fail'}> {
  if (result.kind !== 'fail') return;

  const primary = result.issues[0];
  const status = resolveHttpStatus(primary.code);
  throw new HttpException(
    {
      statusCode: status,
      errorCode: primary.code,
      message: primary.message,
      issues: result.issues,
    },
    status,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="result/throw-if-failed.spec.ts"`
Expected: PASS — all six cases green.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/result/throw-if-failed.ts \
          packages/api/tests/unit/presentation/rest/common/result/throw-if-failed.spec.ts
  git commit -m "feat(api): add throwIfFailed for explicit Result unwrap" \
             -m "Named function (not interceptor) so it appears in stack traces and can be grepped. Uses HttpException with {statusCode, errorCode, message, issues} payload; status resolved via resolveHttpStatus. TypeScript asserts narrows Result<T> to non-fail at call sites (§5.1)." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 40: Implement `toApiResult<T>()` — the success-shape projector

**Package:** `@arc/api`

**Files:**
- Create: `packages/api/src/presentation/rest/common/result/to-api-result.ts`
- Test: `packages/api/tests/unit/presentation/rest/common/result/to-api-result.spec.ts`

Design refs: §5.3, §6.1, FR-2.3. Simple field projection from the non-fail variants of `Result<T>` to the `ApiResult<T>` DTO. Depends on `ApiResult`, `ApiIssueItem`, and `toApiIssueItems` from Chapter 04-01. When `issues` is `undefined` or empty, the field is omitted from the output.

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/unit/presentation/rest/common/result/to-api-result.spec.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Issue, Result} from '@arc/core';
import {IssueSeverity} from '@arc/core';
import {toApiResult} from '../../../../../../src/presentation/rest/common/result/to-api-result.js';

describe('toApiResult', () => {
  it("projects an 'ok' result without issues to {data} only (no issues field)", () => {
    const result: Exclude<Result<number>, {kind: 'fail'}> = {
      kind: 'ok',
      data: 42,
    };
    const api = toApiResult(result);
    expect(api).toEqual({data: 42});
    expect('issues' in api).toBe(false);
  });

  it("projects an 'ok' result with WARNING issues to {data, issues[]}", () => {
    const warning: Issue = {
      code: 'ARC-INSERT-MOD-002',
      message: 'Module dropped',
      severity: IssueSeverity.Warning,
    };
    const result: Exclude<Result<number>, {kind: 'fail'}> = {
      kind: 'ok',
      data: 7,
      issues: [warning],
    };
    const api = toApiResult(result);
    expect(api.data).toBe(7);
    expect(api.issues).toBeDefined();
    expect(api.issues).toHaveLength(1);
    expect(api.issues![0].code).toBe('ARC-INSERT-MOD-002');
    expect(api.issues![0].severity).toBe(IssueSeverity.Warning);
  });

  it("projects a 'partial' result with ERROR issues to {data, issues[]}", () => {
    const errorIssue: Issue = {
      code: 'ENTITY_NOT_FOUND',
      message: 'Module 9 not found',
      severity: IssueSeverity.Error,
    };
    const result: Exclude<Result<number[]>, {kind: 'fail'}> = {
      kind: 'partial',
      data: [1, 2, 3],
      issues: [errorIssue],
    };
    const api = toApiResult(result);
    expect(api.data).toEqual([1, 2, 3]);
    expect(api.issues).toHaveLength(1);
    expect(api.issues![0].code).toBe('ENTITY_NOT_FOUND');
  });

  it("projects an 'ok' result with an empty issues array to {data} only", () => {
    // Guard: Result.ok() should never construct this shape, but the projector
    // must not emit an empty issues[] on the wire even if it happens.
    const result: Exclude<Result<string>, {kind: 'fail'}> = {
      kind: 'ok',
      data: 'hello',
      issues: [],
    };
    const api = toApiResult(result);
    expect(api).toEqual({data: 'hello'});
    expect('issues' in api).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="result/to-api-result.spec.ts"`
Expected: FAIL with `Cannot find module '.../to-api-result.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/api/src/presentation/rest/common/result/to-api-result.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {Result} from '@arc/core';
import type {ApiResult} from '../dto/api-response/api-result.dto.js';
import {toApiIssueItems} from '../dto/api-response/api-issue-item.mapper.js';

/**
 * Projects the non-fail variants of `Result<T>` to the `ApiResult<T>` wire DTO.
 *
 * Callers must have already run `throwIfFailed()` — the input type enforces this.
 * When `result.issues` is absent or empty, the `issues` field is omitted from
 * the output body (the wire contract in §7 disallows empty `issues[]`).
 */
export function toApiResult<T>(
  result: Exclude<Result<T>, {kind: 'fail'}>,
): ApiResult<T> {
  return {
    data: result.data,
    ...(result.issues &&
      result.issues.length > 0 && {issues: toApiIssueItems(result.issues)}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="result/to-api-result.spec.ts"`
Expected: PASS — all four cases green.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/result/to-api-result.ts \
          packages/api/tests/unit/presentation/rest/common/result/to-api-result.spec.ts
  git commit -m "feat(api): add toApiResult projector for Result to ApiResult" \
             -m "Field-for-field projection from the non-fail variants of Result<T> to the ApiResult<T> DTO. The issues field is omitted when absent or empty, per the wire contract in §7." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 41: Add barrel `index.ts` for the new HTTP-boundary helpers

**Package:** `@arc/api`

**Files:**
- Create: `packages/api/src/presentation/rest/common/result/index.ts`

Single re-export point so controllers can `import {throwIfFailed, toApiResult} from '.../common/result/index.js'`. `resolveHttpStatus` is also re-exported — it's not called by controllers but tests and e2e specs benefit from a single import path.

- [ ] **Step 1: Create the barrel**

Create `packages/api/src/presentation/rest/common/result/index.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

export {throwIfFailed} from './throw-if-failed.js';
export {toApiResult} from './to-api-result.js';
export {resolveHttpStatus} from './http-status-map.js';
```

- [ ] **Step 2: Run the full @arc/api unit suite to verify build**

Run: `pnpm --filter @arc/api run test:unit:api`
Expected: PASS — all suites green. The barrel adds no new tests, but tsc must resolve every re-export.

- [ ] **Step 3: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/result/index.ts
  git commit -m "feat(api): add barrel export for HTTP-boundary result helpers" \
             -m "Single import point for controllers and tests — throwIfFailed, toApiResult, and resolveHttpStatus. Keeps controller import lists short and grep-able." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 42: Rewrite `PartialSuccessInterceptor` — filter `issues[]` by severity, not `errors[]`

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/common/interceptors/partial-success.interceptor.ts`
- Create: `packages/api/tests/unit/presentation/rest/common/interceptors/partial-success.interceptor.spec.ts`

Design refs: §5.4, FR-6.2, FR-6.3. Interceptor logic changes from checking `body.errors[]` non-empty to checking `body.issues[]` for at least one severity ≥ ERROR. WARNING-only stays 200; ERROR/FATAL upgrades to 207. Empty `issues[]` and absent `issues` field both stay 200.

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/unit/presentation/rest/common/interceptors/partial-success.interceptor.spec.ts`:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {jest} from '@jest/globals';
import {HttpStatus} from '@nestjs/common';
import {of} from 'rxjs';
import {lastValueFrom} from 'rxjs';
import {IssueSeverity} from '@arc/core';
import {PartialSuccessInterceptor} from '../../../../../../src/presentation/rest/common/interceptors/partial-success.interceptor.js';

describe('PartialSuccessInterceptor', () => {
  let interceptor: PartialSuccessInterceptor;
  let mockResponse: {status: jest.Mock};
  let mockContext: {
    switchToHttp: () => {
      getResponse: () => typeof mockResponse;
    };
  };

  beforeEach(() => {
    interceptor = new PartialSuccessInterceptor();
    mockResponse = {status: jest.fn().mockReturnThis()};
    mockContext = {
      switchToHttp: () => ({getResponse: () => mockResponse}),
    };
  });

  async function run(body: unknown): Promise<unknown> {
    const handler = {handle: () => of(body)};
    return lastValueFrom(interceptor.intercept(mockContext as any, handler));
  }

  it('keeps status 200 when the body has no issues field', async () => {
    await run({data: [1, 2, 3]});
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('keeps status 200 when issues[] is empty', async () => {
    await run({data: [1, 2, 3], issues: []});
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('keeps status 200 when issues only contain WARNING severity', async () => {
    await run({
      data: [1, 2, 3],
      issues: [
        {code: 'ARC-INSERT-MOD-002', message: 'dropped', severity: IssueSeverity.Warning},
      ],
    });
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('upgrades to 207 Multi-Status when at least one ERROR-severity issue is present', async () => {
    await run({
      data: [1, 2],
      issues: [
        {code: 'ENTITY_NOT_FOUND', message: 'missing', severity: IssueSeverity.Error},
      ],
    });
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.MULTI_STATUS);
  });

  it('upgrades to 207 when at least one FATAL-severity issue is present', async () => {
    await run({
      data: [],
      issues: [
        {code: 'DB_QUERY_FAILED', message: 'boom', severity: IssueSeverity.Fatal},
      ],
    });
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.MULTI_STATUS);
  });

  it('upgrades to 207 when issues[] has mixed WARNING + ERROR', async () => {
    await run({
      data: [1],
      issues: [
        {code: 'ARC-INSERT-MOD-002', message: 'dropped', severity: IssueSeverity.Warning},
        {code: 'ENTITY_NOT_FOUND', message: 'missing', severity: IssueSeverity.Error},
      ],
    });
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.MULTI_STATUS);
  });

  it('ignores non-object bodies (null, primitive)', async () => {
    await run(null);
    await run('a string');
    await run(42);
    expect(mockResponse.status).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="partial-success.interceptor.spec.ts"`
Expected: FAIL — the "keeps 200 when issues only contain WARNING severity" and mixed-severity cases fail against the current `errors[]`-based logic (or all cases fail because the current interceptor never inspects `issues[]`).

- [ ] **Step 3: Rewrite the interceptor**

Replace the contents of `packages/api/src/presentation/rest/common/interceptors/partial-success.interceptor.ts` with:

```typescript
/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {Injectable, HttpStatus} from '@nestjs/common';
import type {
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import type {Response} from 'express';
import {IssueSeverity} from '@arc/core';
import type {ApiIssueItem} from '../dto/api-response/api-issue-item.dto.js';

/**
 * Interceptor that automatically upgrades the HTTP status code from 200 to 207 (Multi-Status)
 * when a bulk response contains at least one ERROR or FATAL severity issue.
 *
 * Logic (§5.4, FR-6.2/FR-6.3):
 * - If the response body's `issues[]` contains any severity >= ERROR, status is set to 207.
 * - WARNING-only issues (e.g. DATA_LOSS insert failures on an otherwise-successful upload) keep 200.
 * - Absent or empty `issues` keeps the default 200.
 *
 * Usage:
 * Apply to bulk-query controllers via @UseInterceptors(PartialSuccessInterceptor).
 *
 * @see RFC 4918 — 207 Multi-Status
 */
@Injectable()
export class PartialSuccessInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((responseBody: unknown) => {
        if (this.isPartialSuccess(responseBody)) {
          const response = context.switchToHttp().getResponse<Response>();
          response.status(HttpStatus.MULTI_STATUS);
        }
        return responseBody;
      }),
    );
  }

  /**
   * Determines if the response represents a partial success scenario:
   * the response has an `issues[]` array containing at least one ERROR or FATAL entry.
   *
   * WARNING-only responses stay 200 — see §5.4 and FR-6.2.
   */
  private isPartialSuccess(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false;
    const response = body as Record<string, unknown>;
    if (!('issues' in response) || !Array.isArray(response.issues)) return false;
    return (response.issues as ApiIssueItem[]).some(
      (i) =>
        i.severity === IssueSeverity.Error ||
        i.severity === IssueSeverity.Fatal,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="partial-success.interceptor.spec.ts"`
Expected: PASS — all seven cases green.

- [ ] **Step 5: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/presentation/rest/common/interceptors/partial-success.interceptor.ts \
          packages/api/tests/unit/presentation/rest/common/interceptors/partial-success.interceptor.spec.ts
  git commit -m "refactor(api): upgrade PartialSuccessInterceptor to issues[] severity filter" \
             -m "Replaces the errors[] non-empty check with an issues[] scan for severity >= ERROR. WARNING-only responses now stay 200; ERROR/FATAL trigger 207 (§5.4)." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.

---

### Task 43: Extend `AllExceptionsFilter` to propagate `issues[]` from HttpException payloads

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/infrastructure-wrapper/filters/all-exceptions.filter.ts` (lines 53–68, plus response builder at lines 88–101)
- Modify: `packages/api/tests/unit/infrastructure-wrapper/filters/all-exceptions.filter.spec.ts` (add one case)

Design refs: §5.5, FR-6.4. Small delta only. When the caught exception is an `HttpException` whose payload contains an `issues[]` array (populated by `throwIfFailed`), promote that array to a top-level `errorResponse.issues` field. This gives failed-Result responses the same top-level `issues[]` shape as partial-success responses (§7). Non-HttpException exceptions are untouched; `details` propagation is preserved.

- [ ] **Step 1: Add the failing test case**

Append the following block to `packages/api/tests/unit/infrastructure-wrapper/filters/all-exceptions.filter.spec.ts` (inside the `describe('AllExceptionsFilter', ...)` block, after the existing three cases):

```typescript
  it('propagates issues[] from HttpException payload to top-level errorResponse.issues', () => {
    // Simulate the payload shape produced by throwIfFailed().
    const {HttpException} = jest.requireActual('@nestjs/common');
    const issues = [
      {
        code: 'ENTITY_NOT_FOUND',
        message: 'Module 5 not found',
        severity: 'ERROR',
      },
    ];
    const exception = new HttpException(
      {
        statusCode: 404,
        errorCode: 'ENTITY_NOT_FOUND',
        message: 'Module 5 not found',
        issues,
      },
      404,
    );

    filter.catch(exception, mockHost as any);
    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        errorCode: 'ENTITY_NOT_FOUND',
        message: 'Module 5 not found',
        issues,
      }),
    );
  });

  it('does not add issues field when HttpException payload has no issues[]', () => {
    const {HttpException} = jest.requireActual('@nestjs/common');
    const exception = new HttpException(
      {statusCode: 400, errorCode: 'BAD_REQUEST', message: 'bad'},
      400,
    );

    filter.catch(exception, mockHost as any);
    const jsonBody = mockResponse.json.mock.calls[0][0] as Record<string, unknown>;
    expect('issues' in jsonBody).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="all-exceptions.filter.spec.ts"`
Expected: FAIL — the "propagates issues[]" case fails because the current filter never inspects the payload's `issues` field; the built `errorResponse` omits it.

- [ ] **Step 3: Update the filter to capture and propagate `issues[]`**

Edit `packages/api/src/infrastructure-wrapper/filters/all-exceptions.filter.ts` in two places.

First, in the `else if (exception instanceof HttpException)` branch (currently lines 53–63), capture the `issues[]` array alongside `errorCode` and `details`. Replace the local variable declarations near the top of `catch` (lines 42–44) with:

```typescript
    let status: number;
    let errorCode: string | undefined;
    let details: unknown;
    let issues: unknown[] | undefined;
```

Then replace the `HttpException` branch body (lines 53–63) with:

```typescript
    } else if (exception instanceof HttpException) {
      // NestJS built-in HTTP exceptions (from controllers, guards, pipes,
      // and throwIfFailed at the Result boundary).
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'object' && exResponse != null) {
        const resp = exResponse as Record<string, unknown>;
        errorCode = (resp.errorCode as string) ?? exception.name;
        details = resp.details;
        if (Array.isArray(resp.issues)) {
          issues = resp.issues as unknown[];
        }
      } else {
        errorCode = exception.name;
      }
    } else {
```

Finally, after the existing `if (details !== undefined) { errorResponse.details = details; }` block (around line 99–101), append:

```typescript
    if (issues !== undefined) {
      errorResponse.issues = issues;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arc/api run test:unit:api -- --testPathPattern="all-exceptions.filter.spec.ts"`
Expected: PASS — original three cases still green, plus the two new cases (`issues[]` propagation, absent-`issues[]` produces no field).

- [ ] **Step 5: Run the full @arc/api unit suite as a smoke check**

Run: `pnpm --filter @arc/api run test:unit:api`
Expected: PASS — the interceptor + filter + new result helpers all coexist. This is the final chapter 04-02 sanity check before commit.

- [ ] **Step 6: Commit**

  Use the `commit` skill to draft the commit message. Show the proposed message
  and the exact commands to the user and **wait for explicit confirmation** before
  running anything:

  ```bash
  git add packages/api/src/infrastructure-wrapper/filters/all-exceptions.filter.ts \
          packages/api/tests/unit/infrastructure-wrapper/filters/all-exceptions.filter.spec.ts
  git commit -m "feat(api): propagate HttpException payload issues[] to ErrorResponse top-level" \
             -m "When throwIfFailed throws HttpException with an issues[] payload, AllExceptionsFilter now surfaces the array at the top of ErrorResponse (not buried in details). Failed-Result responses and partial-success responses now share the same top-level issues[] wire shape (§5.5, §7)." \
             -m "Signed-off-by: Nithin Simon <nithin.simon@qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.**
  Only execute after confirmation.
<!--
Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
SPDX-License-Identifier: BSD-3-Clause
-->

## Chapter 05-01 — Controller migration, Swagger regen, E2E tests

**Depends on:** Tasks 31-37 (chapter 04-01, `ApiResult<T>` / `ApiIssueItem`) and Tasks 38-43 (chapter 04-02, `throwIfFailed` / `toApiResult` / `http-status-map` / `PartialSuccessInterceptor` / `AllExceptionsFilter`).

**Migration pattern.** Every controller handler that consumes `queryBus` / `commandBus` output adopts the two-line boilerplate from design §5.6:

```typescript
const result = await this.queryBus.execute(new GetFooQuery(id));
throwIfFailed(result);
return toApiResult(result);
```

Handlers that currently return an ad-hoc `{data, success, message, errors, warnings}` object are rewritten to construct `Result.ok(...)` (or accept a `Result<T>` from the bus) and pass it through `toApiResult()`. Handlers that already throw `NotImplementedException` / `BadRequestException` unconditionally are **not** touched — they never reach the return statement. Handlers whose return type is `void` (e.g. `deleteProject`) are also untouched.

Chapter delivers **six commits (A-F)** that migrate all 15 controllers, plus **Task G** — the final CI gate that closes out the entire refactor.

---

### Task 44: Controller migration — Group A (implemented endpoints, TDD)

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/modules/project/project.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/usecase/usecase.controller.ts`
- Modify: `packages/api/tests/e2e/project/upload-file.e2e-spec.ts` (existing test — update assertions from `body.success` / `body.message` to new shape)

**Scope.** These three endpoints have live handler wiring and are exercised by an E2E test. Migrated first because their behaviour is the ground truth for the pattern.

Endpoints in scope:
- `ProjectController.createProjectFromFiles` — `POST /arc-api/v1/projects/offline/upload-files`
- `UseCaseController.getAllUsecases` — `GET /arc-api/v1/projects/:projectId/usecases`
- `UseCaseController.queryUsecaseComponents` — `POST /arc-api/v1/projects/:projectId/usecases/components/query`

- [ ] **Step 1: Update `upload-file.e2e-spec.ts` — flip existing assertions to new shape (failing test)**

  Replace assertions on `body.success` / `body.message` / `body.data.projectId` with assertions on the new `{data, issues?}` shape. This turns the existing green E2E into a red one until the controllers migrate.

  Change these three assertion blocks (search for exact strings):

  Block 1 — upload response (around line 48-55):
  ```typescript
  // OLD
  expect(response.body.success).toBe(true);
  expect(response.body.message).toBe('The file has been opened successfully');

  // NEW
  expect(response.body).toBeDefined();
  expect(response.body.data).toBeDefined();
  expect(response.body.data.projectId).toBeDefined();
  expect(response.body.data.projectType).toBe('OFFLINE');
  expect(response.body.data.sessionMode).toBe('DESIGNER');
  expect(response.body).not.toHaveProperty('success');
  expect(response.body).not.toHaveProperty('message');
  ```

  Block 2 — get-all-usecases response (around line 69-73):
  ```typescript
  // OLD
  expect(usecasesResponse.body.success).toBe(true);
  expect(usecasesResponse.body.message).toBe('Usecases retrieved successfully');
  expect(usecasesResponse.body.data).toBeDefined();
  expect(Array.isArray(usecasesResponse.body.data)).toBe(true);

  // NEW
  expect(usecasesResponse.body.data).toBeDefined();
  expect(Array.isArray(usecasesResponse.body.data)).toBe(true);
  expect(usecasesResponse.body).not.toHaveProperty('success');
  expect(usecasesResponse.body).not.toHaveProperty('message');
  ```

  Block 3 — components response (around line 137-143). Note the route in this test is the legacy `/usecases/getComponents/` — replace with the new `/usecases/components/query`:
  ```typescript
  // OLD
  const componentsResponse = await request(httpServer)
    .post(`/arc-api/v1/projects/${projectId}/usecases/getComponents/`)
    ...
  expect(componentsResponse.body.success).toBe(true);
  expect(componentsResponse.body.message).toBe('Components retrieved successfully');
  expect(componentsResponse.body.data).toBeDefined();
  expect(Array.isArray(componentsResponse.body.data)).toBe(true);
  expect(componentsResponse.body.data.length).toBe(1);

  // NEW
  const componentsResponse = await request(httpServer)
    .post(`/arc-api/v1/projects/${projectId}/usecases/components/query`)
    ...
  expect(componentsResponse.body.data).toBeDefined();
  expect(componentsResponse.body.data.spfModules).toBeDefined();
  expect(componentsResponse.body).not.toHaveProperty('success');
  expect(componentsResponse.body).not.toHaveProperty('message');
  ```

  Also update lines 146-154 which currently index into `body.data[0]` — with the new pattern `body.data` is a single `ComponentCollectionDto`, not an array (matching the controller's declared return type `ApiResult<ComponentCollectionDto>`):
  ```typescript
  // OLD
  const componentsData = componentsResponse.body.data[0];

  // NEW
  const componentsData = componentsResponse.body.data;
  ```

- [ ] **Step 2: Run E2E to verify it fails**

  Run: `pnpm --filter @arc/api run test:e2e:api -- --testPathPattern="upload-file.e2e-spec.ts"`
  Expected: FAIL with something like `Expected undefined to be true (body.success)` or `Expected body not to have property 'success'`.

- [ ] **Step 3: Migrate `ProjectController.createProjectFromFiles`**

  Two edits in `packages/api/src/presentation/rest/modules/project/project.controller.ts`:

  Edit 1 — imports (top of file, add alongside existing `ApiResult` import at line 62):
  ```typescript
  import {ApiResult} from '../../common/dto/api-response/api-result.dto.js';
  import {toApiResult} from '../../common/result/to-api-result.js';
  import {Result} from '@arc/core';
  ```

  Edit 2 — replace the return block at lines 268-287 (the `projectResponse` construction) with:
  ```typescript
  const projectdetails: ProjectInfoResponseDto = {
    projectId: result.projectId,
    name: result.projectName,
    description: result.projectDescription,
    projectType: ProjectType.Offline,
    sessionMode: SessionMode.Designer,
  };

  // UploadFileResult carries `errors` and `warnings` today. Once the OpenFile
  // handler is migrated to return Result<UploadFileResult> (chapter 03-02),
  // this wrap collapses to `return toApiResult(result);`. For now, adapt the
  // legacy shape to the new envelope so the wire contract is correct.
  const legacyIssues = [
    ...(result.errors ?? []),
    ...(result.warnings ?? []),
  ];
  const resultEnvelope = legacyIssues.length > 0
    ? Result.partial(projectdetails, legacyIssues)
    : Result.ok(projectdetails);
  return toApiResult(resultEnvelope);
  ```

  Note: `UploadFileResult.errors` / `.warnings` are already `Issue[]` after chapter 03-02 (task 24-30). The legacy fields disappear entirely once `OpenFileHandler` returns a `Result<T>`; this task keeps the wrap self-contained.

- [ ] **Step 4: Migrate `UseCaseController.getAllUsecases`**

  Two edits in `packages/api/src/presentation/rest/modules/usecase/usecase.controller.ts`:

  Edit 1 — add imports:
  ```typescript
  import {throwIfFailed} from '../../common/result/throw-if-failed.js';
  import {toApiResult} from '../../common/result/to-api-result.js';
  import {Result} from '@arc/core';
  ```

  Edit 2 — replace the body of `getAllUsecases` (lines 173-204) with the pattern. The `queryBus.execute` currently returns `UseCaseReadModel[]` (unwrapped); chapter 03-02 changed the handler to return `Result<UseCaseReadModel[]>`. Post-chapter-03-02, the body is:
  ```typescript
  async getAllUsecases(
    @Param('projectId') projectId: string,
    @Query('filter') filterExpression?: string,
  ): Promise<ApiResult<UsecaseDto[]>> {
    if (filterExpression) {
      console.log('Filter expression provided but not yet implemented:', filterExpression);
    }

    const query = new GetAllUseCasesQuery(Number.parseInt(projectId), 'client-id');
    const result = await this.queryBus.execute<Result<UseCaseReadModel[]>>(query);
    throwIfFailed(result);

    const transformed = this.transformToUsecaseDtos(result.data);
    // Preserve any partial-success issues from the handler.
    const mapped = result.issues && result.issues.length > 0
      ? Result.partial(transformed, [...result.issues])
      : Result.ok(transformed);
    return toApiResult(mapped);
  }
  ```

- [ ] **Step 5: Migrate `UseCaseController.queryUsecaseComponents`**

  Replace the body of `queryUsecaseComponents` (lines 572-625) with:
  ```typescript
  async queryUsecaseComponents(
    @Param('projectId') projectId: string,
    @Body() usecaseSystemIds: SystemIdsRequestDto,
  ): Promise<ApiResult<ComponentCollectionDto>> {
    if (!usecaseSystemIds?.systemIds || usecaseSystemIds.systemIds.length === 0) {
      throw new BadRequestException('systemIds array is required and cannot be empty');
    }

    const systemIds = usecaseSystemIds.systemIds.map(id => {
      const parsed = Number.parseInt(id, 10);
      if (Number.isNaN(parsed)) {
        throw new BadRequestException(`Invalid use case system ID: ${id}`);
      }
      return parsed;
    });

    const parsedProjectId = Number.parseInt(projectId, 10);
    if (Number.isNaN(parsedProjectId)) {
      throw new BadRequestException(`Invalid project ID: ${projectId}`);
    }

    const query = new GetComponentsQuery(systemIds, 'client-id', parsedProjectId);
    const result = await this.queryBus.execute<Result<UseCaseComponentsReadModel>>(query);
    throwIfFailed(result);

    const dto = this.transformToComponentCollectionDto(result.data);
    const mapped = result.issues && result.issues.length > 0
      ? Result.partial(dto, [...result.issues])
      : Result.ok(dto);
    return toApiResult(mapped);
  }
  ```

- [ ] **Step 6: Run tests to verify green**

  Run: `pnpm --filter @arc/api run test:e2e:api -- --testPathPattern="upload-file.e2e-spec.ts"`
  Expected: PASS.

  Also: `pnpm --filter @arc/api run test:unit:api` — Expected: PASS (no unit regressions from the controller changes).

- [ ] **Step 7: Commit**

  Use the `commit` skill to draft the commit message. Show it and the exact commands and **wait for explicit confirmation** before running.

  ```bash
  git add packages/api/src/presentation/rest/modules/project/project.controller.ts \
          packages/api/src/presentation/rest/modules/usecase/usecase.controller.ts \
          packages/api/tests/e2e/project/upload-file.e2e-spec.ts
  git commit -m "refactor(api): migrate project & usecase controllers to Result envelope" \
             -m "Adopts throwIfFailed + toApiResult pattern in the three implemented endpoints. Drops legacy {success,message,errors,warnings} fields in favour of {data, issues?}. Updates upload-file E2E to match new wire shape." \
             -m "Signed-off-by: Nithin Simon <nithins@qti.qualcomm.com>"
  ```

  **STOP — do not run `git commit` until the user explicitly approves the message.** Only execute after confirmation.

---

### Task 45: Controller migration — Group B (mechanical, controllers with route handlers)

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/modules/subsystem/subsystem.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/subgraph/subgraph.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/spf-module/spf-module.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/container/container.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/usecase-category/usecase-category.controller.ts`

**Scope.** These controllers have declared routes but every handler currently throws `NotImplementedException` (or a similar `BadRequestException`/`DomainException`). No behavioural change is possible without a live handler. What changes is:
1. **Return-type declarations** already say `Promise<ApiResult<T>>` — leave those.
2. **Any `return {data, success, message, ...}` literal** left over from previous drafts must be rewritten to `return toApiResult(Result.ok(...))`. Grep shows a handful of these still linger (see Step 1).
3. **Import cleanup:** if the controller imported `ApiErrorItem` / `ApiWarningItem` (deleted in chapter 04-01), remove those imports.

This is bulk mechanical work. Use the skeleton format per design §5.6 rather than showing full code for each file.

- [ ] **Step 1: Enumerate legacy shapes to fix**

  Run: `pnpm exec grep -rn --include='*.controller.ts' 'success:\s*true\|success:\s*false\|message:\s*'"'"'' packages/api/src/presentation/rest/modules/{subsystem,subgraph,spf-module,container,usecase-category}/`

  For every hit — replace the object literal with the `toApiResult(Result.ok(...))` pattern.

- [ ] **Step 2: Enumerate deleted-DTO imports**

  Run: `pnpm exec grep -rn --include='*.controller.ts' 'ApiErrorItem\|ApiWarningItem' packages/api/src/presentation/rest/modules/{subsystem,subgraph,spf-module,container,usecase-category}/`

  Every hit must be deleted (import + any type reference).

- [ ] **Step 3: Apply the pattern per handler**

  For each of the 5 files, for each handler method:
  - If the method body is only `throw new NotImplementedException(...)` — do nothing.
  - If the method body is `return { data: X, success: true, message: 'Y' }` — replace with:
    ```typescript
    return toApiResult(Result.ok(X));
    ```
  - If the method body calls `this.queryBus.execute(...)` or `this.commandBus.execute(...)` and returns `ApiResult<T>` — add:
    ```typescript
    const result = await this.[queryBus|commandBus].execute<Result<T>>(new XxxQuery(...));
    throwIfFailed(result);
    return toApiResult(result);
    ```

  At the top of each file, add imports (only if used):
  ```typescript
  import {toApiResult} from '../../common/result/to-api-result.js';
  import {throwIfFailed} from '../../common/result/throw-if-failed.js';
  import {Result} from '@arc/core';
  ```

- [ ] **Step 4: Build and unit-test**

  Run: `pnpm run build:api && pnpm --filter @arc/api run test:unit:api`
  Expected: PASS. Any red is either a stale import (delete it) or a `Result` generic-parameter mismatch (fix the `<T>` on `queryBus.execute<Result<T>>`).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/api/src/presentation/rest/modules/subsystem/subsystem.controller.ts \
          packages/api/src/presentation/rest/modules/subgraph/subgraph.controller.ts \
          packages/api/src/presentation/rest/modules/spf-module/spf-module.controller.ts \
          packages/api/src/presentation/rest/modules/container/container.controller.ts \
          packages/api/src/presentation/rest/modules/usecase-category/usecase-category.controller.ts
  git commit -m "refactor(api): migrate group-B controllers to Result envelope" \
             -m "Applies throwIfFailed + toApiResult pattern across subsystem, subgraph, spf-module, container, and usecase-category controllers. Removes lingering {success,message} literals and dead ApiErrorItem/ApiWarningItem imports. All handlers in these controllers currently throw NotImplementedException, so behaviour is unchanged." \
             -m "Signed-off-by: Nithin Simon <nithins@qti.qualcomm.com>"
  ```

  **STOP — wait for confirmation.**

---

### Task 46: Controller migration — Group C (remaining controllers)

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/modules/control-link/control-link.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/driver-module/driver-module.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/authentication/authentication.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/data-link/data-link.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/definition/spf-custom-module-schema/spf-custom-module-schema.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/definition/module-definition/module-definition.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/definition/property-definition/property-definition.controller.ts`
- Modify: `packages/api/src/presentation/rest/modules/definition/key-definition/key-definition.controller.ts`

**Scope.** Same mechanical pattern as Task 45, applied to the remaining eight controllers. All handlers currently throw `NotImplementedException`.

Note the four `definition/*` controllers are the largest — each has 5+ endpoints. Use the skeleton format from `plan-format.md` §"Skeleton Format for Complex Handlers and Tests": for each such controller, follow the same three-rule replacement (throw → leave, `{success,message}` literal → `toApiResult(Result.ok(...))`, `bus.execute` return → `throwIfFailed` + `toApiResult`).

- [ ] **Step 1: Enumerate legacy shapes and dead imports across all 8 files**

  Run the same two greps from Task 45 Steps 1-2, restricted to these eight files.

- [ ] **Step 2: Apply the pattern per handler across all 8 files**

  Same three rules as Task 45 Step 3. Add the three imports at the top of every file that needs them.

- [ ] **Step 3: Build and unit-test**

  Run: `pnpm run build:api && pnpm --filter @arc/api run test:unit:api`
  Expected: PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/api/src/presentation/rest/modules/control-link/control-link.controller.ts \
          packages/api/src/presentation/rest/modules/driver-module/driver-module.controller.ts \
          packages/api/src/presentation/rest/modules/authentication/authentication.controller.ts \
          packages/api/src/presentation/rest/modules/data-link/data-link.controller.ts \
          packages/api/src/presentation/rest/modules/definition/spf-custom-module-schema/spf-custom-module-schema.controller.ts \
          packages/api/src/presentation/rest/modules/definition/module-definition/module-definition.controller.ts \
          packages/api/src/presentation/rest/modules/definition/property-definition/property-definition.controller.ts \
          packages/api/src/presentation/rest/modules/definition/key-definition/key-definition.controller.ts
  git commit -m "refactor(api): migrate group-C controllers to Result envelope" \
             -m "Applies throwIfFailed + toApiResult pattern across the remaining eight controllers (control-link, driver-module, authentication, data-link, and four definition/* controllers). All handlers currently throw NotImplementedException, so behaviour is unchanged." \
             -m "Signed-off-by: Nithin Simon <nithins@qti.qualcomm.com>"
  ```

  **STOP — wait for confirmation.**

---

### Task 47: Swagger decorator update

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/src/presentation/rest/common/swagger-doc/swagger.decorator.ts`

**Scope.** The decorator references only `ApiResult` at the value level (line 20, 76, 252, 391) — those still resolve after chapter 04-01 because `ApiResult` is retained (with its shape collapsed to `{data?, issues?}`). No `ApiErrorItem` / `ApiWarningItem` references exist here. **Confirmed by reading the file end-to-end.** Only two touches remain:

1. If chapter 04-01 added an `ApiIssueItem` DTO that this decorator should register in `ApiExtraModels` alongside `ApiResult` (so the auto-generated Swagger `allOf` produces `$ref`s for the `issues[]` schema), add it.
2. Update the `wrapInApiResult` schema comment in `generateWrappedResponseSchema` — it currently produces `{allOf: [{$ref: ApiResult}, {properties: {data}}]}`. The collapsed `ApiResult` still supports this shape, so no shape change is required. But do add a JSDoc note that the wrapped schema now also carries an optional `issues[]` field.

- [ ] **Step 1: Add `ApiIssueItem` import + `ApiExtraModels` registration**

  In `swagger.decorator.ts`, replace the import block at line 20:
  ```typescript
  import {ApiResult} from '../dto/api-response/api-result.dto.js';
  import {ApiIssueItem} from '../dto/api-response/api-issue-item.dto.js';
  ```

  Replace the registration line at line 76:
  ```typescript
  const allDtoTypes = [ApiResult, ApiIssueItem, ...dtoTypes];
  ```

- [ ] **Step 2: Update JSDoc on `generateWrappedResponseSchema`**

  Replace the doc comment at line 236-238 with:
  ```typescript
  /**
   * Generates ApiResult wrapper schema for response.
   *
   * Produces `{allOf: [ApiResult, {properties: {data}}]}`. The `ApiResult` base
   * schema contributes the optional `issues[]` field automatically, so partial-
   * success (207) responses render correctly in Swagger UI without a per-
   * endpoint schema override.
   */
  ```

- [ ] **Step 3: Build to confirm no regressions**

  Run: `pnpm run build:api`
  Expected: PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/api/src/presentation/rest/common/swagger-doc/swagger.decorator.ts
  git commit -m "docs(api): register ApiIssueItem in swagger decorator" \
             -m "The ApiDocumentationWithExample decorator now includes ApiIssueItem in ApiExtraModels so the auto-generated schema resolves issues[] $refs. Adds a JSDoc note that the wrapped ApiResult schema now carries an optional issues[] field for partial-success responses." \
             -m "Signed-off-by: Nithin Simon <nithins@qti.qualcomm.com>"
  ```

  **STOP — wait for confirmation.**

---

### Task 48: Swagger regeneration

**Package:** `@arc/api`

**Files:**
- Modify: `docs/swagger-api.json` (regenerated artefact)

**Scope.** Regenerate the checked-in Swagger JSON so downstream consumers see the new `{data?, issues?}` shape and the removed `success` / `message` / `errors` / `warnings` fields.

- [ ] **Step 1: Regenerate**

  Run: `pnpm run generate:swagger`
  Expected: `docs/swagger-api.json` updated. No stderr output beyond normal Swagger CLI logs.

- [ ] **Step 2: Sanity-check the diff**

  Run: `git diff --stat docs/swagger-api.json`
  Expected: a non-trivial diff (touched by every controller migration). If the diff is zero-lines, the regen command silently produced no output — investigate before committing.

  Run: `pnpm exec grep -c 'ApiErrorItem\|ApiWarningItem' docs/swagger-api.json`
  Expected: `0`. Any remaining references indicate a controller was missed in Tasks 44-46.

  Run: `pnpm exec grep -c 'ApiIssueItem' docs/swagger-api.json`
  Expected: non-zero (the new issue-item schema appears at least in the `components.schemas` block).

- [ ] **Step 3: Commit**

  ```bash
  git add docs/swagger-api.json
  git commit -m "docs(api): regenerate swagger-api.json for Result-envelope shape" \
             -m "Regenerated after controller migration. Drops ApiErrorItem/ApiWarningItem schemas and the {success,message,errors,warnings} response fields. Adds ApiIssueItem schema and the collapsed {data?, issues?} ApiResult shape." \
             -m "Signed-off-by: Nithin Simon <nithins@qti.qualcomm.com>"
  ```

  **STOP — wait for confirmation.**

---

### Task 49: E2E tests — three response-shape cases

**Package:** `@arc/api`

**Files:**
- Modify: `packages/api/tests/e2e/project/upload-file.e2e-spec.ts` (add cases 2 and 3)

**Scope.** Add three E2E cases covering the full wire contract from design §7. Cases 1 (complete success 200) and 2 (partial success 207 with `issues[]`) exercise the `ApiResult` shape; case 3 (thrown exception → `ErrorResponse`) exercises the exception path.

Case 1 is already covered by the existing "should successfully open acdb and awsp files" test (updated in Task 44 Step 1) once we assert on HTTP status. This task adds cases 2 and 3.

- [ ] **Step 1: Add HTTP-status assertion to case 1 (complete success)**

  Inside the existing test, right after `expect(usecasesResponse.body.data).toBeDefined();`, add:
  ```typescript
  expect(usecasesResponse.status).toBe(200);
  expect(usecasesResponse.body).not.toHaveProperty('issues');
  ```

- [ ] **Step 2: Add case 2 — partial success (207)**

  Append this `it` block inside the top-level `describe`:
  ```typescript
  it('returns 207 Multi-Status with issues[] when getComponents partially fails', async () => {
    // 1. Upload files to create a project (reuse fixtures).
    const acdbPath = join(__dirname, '../fixtures/acdb_cal.acdb');
    const awspPath = join(__dirname, '../fixtures/workspaceFileXml.awsp');

    const uploadRes = await request(httpServer)
      .post('/arc-api/v1/projects/offline/upload-files')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('acdbFile', acdbPath)
      .attach('workspaceFile', awspPath)
      .expect(201);
    const projectId = uploadRes.body.data.projectId;

    // 2. Request one real + one bogus usecase id — GetComponentsHandler returns
    //    Result.partial(data, [notFound]) for the bogus one.
    //    Real ID is discovered from getAllUsecases; bogus ID = -1.
    const usecasesRes = await request(httpServer)
      .get(`/arc-api/v1/projects/${projectId}/usecases/`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const realId =
      usecasesRes.body.data[0]?.usecases?.[0]?.systemId ??
      usecasesRes.body.data[0]?.systemId;
    expect(realId).toBeDefined();

    const componentsRes = await request(httpServer)
      .post(`/arc-api/v1/projects/${projectId}/usecases/components/query`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({systemIds: [String(realId), '-1']})
      .expect(207);

    expect(componentsRes.body.data).toBeDefined();
    expect(componentsRes.body.data.spfModules).toBeDefined();
    expect(componentsRes.body.issues).toBeDefined();
    expect(Array.isArray(componentsRes.body.issues)).toBe(true);
    expect(componentsRes.body.issues.length).toBeGreaterThan(0);
    expect(
      componentsRes.body.issues.some(
        (i: {severity: string}) => i.severity === 'ERROR' || i.severity === 'FATAL',
      ),
    ).toBe(true);
    // ErrorResponse fields must NOT appear on partial-success bodies.
    expect(componentsRes.body).not.toHaveProperty('statusCode');
    expect(componentsRes.body).not.toHaveProperty('errorCode');
  }, 350000);
  ```

- [ ] **Step 3: Add case 3 — thrown domain exception (`ErrorResponse` shape)**

  Append this `it` block:
  ```typescript
  it('returns 404 ErrorResponse when project does not exist', async () => {
    const bogusProjectId = 999_999_999;

    const res = await request(httpServer)
      .get(`/arc-api/v1/projects/${bogusProjectId}/usecases/`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    // ErrorResponse shape from AllExceptionsFilter — no `data` field.
    expect(res.body.statusCode).toBe(404);
    expect(res.body.errorCode).toBeDefined();
    expect(res.body.message).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.path).toContain(`/projects/${bogusProjectId}/usecases`);
    expect(res.body).not.toHaveProperty('data');
    // issues[] is optional here — present iff the handler threw with structured issues.
  }, 30000);
  ```

- [ ] **Step 4: Run all three cases**

  Run: `pnpm --filter @arc/api run test:e2e:api -- --testPathPattern="upload-file.e2e-spec.ts"`
  Expected: PASS on all three tests.

  If case 2 fails because `GetComponentsHandler` throws `EntityNotFoundException` instead of returning `Result.partial(...)` for the bogus id, that's a chapter 03-02 regression — fix in the handler, not by weakening the assertion. Design §5.6.3 and requirement FR-6.3 mandate partial-success semantics for multi-item queries.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/api/tests/e2e/project/upload-file.e2e-spec.ts
  git commit -m "test(api): add E2E cases for 207 partial success and 404 ErrorResponse" \
             -m "Covers the full wire contract from core-result-format §7: complete success (200 with {data}), partial success (207 with {data, issues[]}), and thrown domain exception (404 ErrorResponse shape, no data field)." \
             -m "Signed-off-by: Nithin Simon <nithins@qti.qualcomm.com>"
  ```

  **STOP — wait for confirmation.**

---

### Task 50: Final CI gate (refactor completion signal)

**Package:** monorepo root

**Files:** none — this task gates on green tooling only.

**Scope.** This is the completion signal for the entire Core Result Format refactor. It runs the full monorepo build, test, and lint suites. Any red here means the refactor is not done; investigate and fix before considering the plan closed.

- [ ] **Step 1: Full build**

  Run: `pnpm run build`
  Expected: All Turbo tasks green. Zero TypeScript errors across `@arc/core`, `@arc/api`, `@arc/persistence`, `@arc/fs`. If red: any remaining reference to `Result.isFailure` / `.errors` / `.warnings` / `ApiErrorItem` / `ApiWarningItem` / `OperationResult` indicates an unmigrated call site — fix in place, do not weaken the type.

- [ ] **Step 2: Full test suite**

  Run: `pnpm test`
  Expected: All unit + integration + E2E green. If red: the failure message will point at either a `.kind === 'fail'` narrowing gap (fix the type on `queryBus.execute<Result<T>>`) or a stale assertion checking `body.success` / `body.message` (update to the new shape).

- [ ] **Step 3: Lint**

  Run: `pnpm run lint`
  Expected: Zero errors. Warnings tolerated only if they pre-date this refactor. If any lint rule fires on the new files (`throw-if-failed.ts`, `to-api-result.ts`, `http-status-map.ts`, `result.ts`, `issues/*`) — fix in place.

- [ ] **Step 4: Sanity check — no stale imports**

  Run each grep. Every one must return zero hits:

  ```bash
  pnpm exec grep -rn --include='*.ts' 'ApiErrorItem\|ApiWarningItem' packages/
  pnpm exec grep -rn --include='*.ts' 'OperationResult<' packages/
  pnpm exec grep -rn --include='*.ts' '\.isFailure\b\|\.isSuccess\b' packages/
  pnpm exec grep -rn --include='*.ts' "from '.*Result/operation-result" packages/
  ```

  Expected: all four commands print nothing. Any hit indicates a stale reference — either delete the file or update the import.

- [ ] **Step 5: Final commit (empty commit marking the milestone) — OPTIONAL**

  If the previous four steps produced no changes and the user wants a marker commit closing the refactor:

  ```bash
  git commit --allow-empty \
             -m "chore(core-result-format): refactor complete — CI green on 05-01" \
             -m "Marks the completion of the Core Result Format refactor. All handlers now return Result<T>; all controllers unwrap via throwIfFailed + toApiResult; the wire contract is {data?, issues?} for success and ErrorResponse for failure. Full build + test + lint green." \
             -m "Signed-off-by: Nithin Simon <nithins@qti.qualcomm.com>"
  ```

  **STOP — wait for confirmation.** Skip this step if the user does not want a marker commit.

---

**End of chapter 05-01.**
