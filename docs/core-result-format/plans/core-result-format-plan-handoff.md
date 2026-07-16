# Plan Handoff: Core Result Format

**Spec:** `docs/core-result-format/design/core-result-format-design.md`
**Requirements:** `docs/core-result-format/requirements/core-result-format-requirements.md`
**Plan output:** `docs/core-result-format/plans/core-result-format.md`
**Scope note:** Whole spec, single plan. Prerequisite: PR #85 must merge to `feature/use-case-designer` before plan execution begins.

---

## Batches

### Batch 1 (single chapter, foundation — nothing depends on nothing else)

- **shared/issues/ module** | Design §2, Requirements FR-4 | Start task 1

  Files created under `packages/core/src/shared/issues/`:
  - `severity.ts` — `IssueSeverity`, `IssueCategory`, `deriveCategoryFromSeverity`, `SEVERITY_ORDER` (lifted from current `domain/validation/issue.ts`)
  - `impacted-entity.ts` — `ISSUE_ENTITY_TYPE` (renamed from `VALIDATION_ENTITY_TYPE`), `IssueEntityType`, `ImpactedEntity`
  - `fix-option.ts` — `FixOption`, `ClientInputSpec`, `CLIENT_INPUT_TYPE`, `ClientInputType` (lifted)
  - `issue.ts` — the base `Issue` interface
  - `factories.ts` — `IssueFactory.notFound` / `dbError` / `parseError` / `dataLoss`
  - `index.ts` — barrel re-exports
  - Unit tests: `packages/core/tests/unit/shared/issues/factories.spec.ts`
  - Re-export from `packages/core/src/index.ts`

---

### Batch 2 (parallel, after Batch 1)

- **Result<T> type + factories** | Design §3, Requirements FR-2/FR-3/FR-5 | Start task 8

  Files:
  - Create `packages/core/src/application/shared/result/result.ts` (discriminated union + `Result` namespace)
  - Delete `packages/core/src/application/shared/Result/operation-result.ts` (old capitalized folder, capital-R rename)
  - Delete `packages/core/src/shared/types/operation-result.ts` (placeholder)
  - Delete `packages/core/src/shared/types/api-result.ts` (PR #85 core-side — subsumed)
  - Unit tests: `packages/core/tests/unit/application/shared/result/result.spec.ts` (factory invariants, empty-issue rejection, `@ts-expect-error` narrowing tests)
  - Re-export from `packages/core/src/index.ts`

- **Validation framework field rename** | Design §4.1–§4.4 | Start task 13

  Files touched (~10):
  - `packages/core/src/domain/validation/issue.ts` (shrunk to `ValidationIssue extends Issue`)
  - `validation-rule.ts`, `validation-context.ts`, `validation-preferences.ts`, `validation-report.ts` — import updates only
  - `packages/core/src/application/validation/`:
    - `preference-enforcer.ts` — the one behavioural edit (`effectiveSeverity` key → `severity`)
    - `validation-engine.ts`, `validation-orchestrator.ts`, `validation-context-builder.ts` — import updates
  - `packages/core/src/domain/validation/rules/module/missing-definition.rule.ts` — new field names in output
  - Existing unit tests updated for renamed fields (~5-6 spec files)

---

### Batch 3 (parallel, after Batch 2)

- **Insert-failure catalog + IssueCollector rewrite + bulk-inserter call sites** | Design §4.5–§4.7 | Start task 19

  Files:
  - Create `packages/core/src/domain/validation/insert-failures/insert-failure-codes.ts` (`INSERT_FAILURE` catalog + `InsertFailureType`)
  - Create `packages/core/src/domain/validation/insert-failures/insert-failure.factory.ts` (`newInsertFailureIssue()`)
  - Update `packages/core/src/application/file-operations/upload-file/types/issue-collection.ts` — `IssueCollector` accumulates `Issue[]`; delete `formatForApi()`
  - Update bulk-inserter call sites (in `packages/infrastructure/persistence/`) that fabricate synthetic validation issues today — replace with `newInsertFailureIssue(...)`
  - Unit tests: `packages/core/tests/unit/domain/validation/insert-failures/insert-failure.factory.spec.ts`
  - Update `issue-collection.spec.ts` for new `Issue[]` return shape

- **Query services + query handlers + ProjectRepository migration** | Design §8 Batch 4 | Start task 24

  Files:
  - 7 query service ports under `packages/core/src/application/ports/persistence/query-services/`:
    - `spf-module/spf-module-query-service.ts` (also fix `findOne` to throw per FR-1.4)
    - `container/container-query-service.ts`
    - `node/node-query-service.ts`
    - `key-value/key-value-definition-query-service.ts`
    - `spf-module-definition/spf-module-definition-query-service.ts`
    - `spf-module/tuning/spf-tuning-config-service.ts`
    - `spf-module/tuning/tuning-config-read-model.ts` (import updates)
    - `spf-module/ckv/ckv-query-service.ts`
  - 2 query handlers:
    - `packages/core/src/application/usecase-designer/spf-module/query/query-spf-modules.handler.ts` (access-pattern rewrite: `.isFailure` → `.kind === 'fail'`)
    - `packages/core/src/application/usecase-designer/container/query/query-containers.handler.ts`
  - `packages/core/src/application/ports/persistence/repositories/project/project.repository.ts` — drop `OperationResult<T>`, use `Result<T>`
  - Update the `findOne` implementation in `packages/infrastructure/persistence/` for the throw-instead-of-Result.fail change
  - Corresponding integration tests updated for new access patterns

---

### Batch 4 (parallel, after Batch 2 — can run alongside Batch 3)

- **API DTOs** | Design §6 | Start task 34

  Files under `packages/api/src/presentation/rest/common/dto/api-response/`:
  - `api-result.dto.ts` — collapsed to `{data?, issues?}` (2 fields; drop `success`, `message`)
  - `api-issue-item.dto.ts` — imports from `@arc/core` (enums now in `shared/issues/`); rename `VALIDATION_ENTITY_TYPE` refs to `ISSUE_ENTITY_TYPE`
  - `api-fix-option.dto.ts` — unchanged from PR #85
  - `api-issue-item.mapper.ts` — parameter type `Issue` (not `ResultIssue`)
  - `enums/issue-entity-type.enum.ts` — rename constant to match core
  - Delete `api-error-item.dto.ts`, `api-warning-item.dto.ts`
  - Update Swagger dto-examples

- **HTTP boundary helpers** | Design §5 | Start task 41

  New files under `packages/api/src/presentation/rest/common/result/`:
  - `throw-if-failed.ts` — `throwIfFailed<T>(result)` with `asserts` narrowing
  - `http-status-map.ts` — `EXACT_CODE_MAP` + `PREFIX_MAP` + `resolveHttpStatus(code)`
  - `to-api-result.ts` — `toApiResult<T>(result)` (Result → ApiResult projection)
  - `index.ts` — barrel

  Updates:
  - `packages/api/src/presentation/rest/common/interceptors/partial-success.interceptor.ts` — check `issues[]` filtered by severity ≥ ERROR
  - `packages/api/src/infrastructure-wrapper/filters/all-exceptions.filter.ts` — propagate `HttpException` payload `issues[]` to top-level `ErrorResponse`
  - Unit tests: `packages/api/tests/unit/infrastructure-wrapper/filters/all-exceptions.filter.spec.ts` (add `issues[]` propagation case)

---

### Batch 5 (sequential, after Batches 3 + 4)

- **Controller migration + Swagger regen + E2E tests + final CI** | Design §5.6, §6, §9 | Start task 47

  Files:
  - Update ~16 controllers using `ApiResult<T>` to adopt `throwIfFailed(result); return toApiResult(result);` pattern:
    - `usecase-category.controller.ts`, `usecase.controller.ts`, `subsystem.controller.ts`, `subgraph.controller.ts`, `spf-module.controller.ts`, `container.controller.ts`, `control-link.controller.ts`, `driver-module.controller.ts`, `project.controller.ts`, `authentication.controller.ts`, `data-link.controller.ts`, `spf-custom-module-schema.controller.ts`, `module-definition.controller.ts`, `property-definition.controller.ts`, `key-definition.controller.ts`, plus `swagger-doc/swagger.decorator.ts`
  - Regenerate Swagger: `pnpm run generate:swagger` → updates `docs/swagger-api.json`
  - E2E tests: add three cases (200 complete, 207 partial, thrown domain exception ErrorResponse) — in `packages/api/tests/e2e/`
  - Full `pnpm run build && pnpm test && pnpm run lint` gate

---

## Notes for writing-plans

- **Migration is atomic — big-bang per FR M-1.** Do not merge partial batches. The plan produces a single PR.
- **Prerequisite:** PR #85 (`feat(api): add APIs for modification summary and update ApiResult`) must land on the base branch first. If PR #85 has not merged when this plan executes, halt at Batch 1 and surface for user action.
- **Validation framework churn is mechanical.** Batch 2's validation rename chapter should be reviewable as a single commit within the PR — isolate it so reviewers can focus on the rename.
- **The one behavioural edit is in `preference-enforcer.ts` (Batch 2)** — the severity key rename (`effectiveSeverity` → `severity`). Existing preference-enforcer unit tests cover the behavior; verify they pass with the renamed key.
- **`SpfModuleQueryService.findOne` behavior change (Batch 3)** — currently returns `Result.fail(ENTITY_NOT_FOUND)`, must throw `ResourceNotFoundException`. Fixes FR-1.4 inconsistency. Callers in `query-spf-modules.handler.ts` need updating.
- **Test cadence:** each batch commit should have its tests pass. The batches are structured so type-check passes at every batch boundary (no half-migrated state that fails compilation).
