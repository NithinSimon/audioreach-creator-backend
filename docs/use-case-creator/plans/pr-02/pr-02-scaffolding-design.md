<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# PR 02 Design: Routing Scaffolding and Foundation Corrections

**Requirements:**
- [`../../auto-usecase-routing-requirements.md`](../../auto-usecase-routing-requirements.md)
- [`../../auto-usecase-routing-requirements-extended.md`](../../auto-usecase-routing-requirements-extended.md)
- [`../../design/overall-design.md`](../../design/overall-design.md)

**Plan output folder:** `docs/use-case-creator/plans/pr-02/`

## 1. Goal

PR 02 establishes a compilable, testable skeleton for automatic and manual use-case
creation. It fixes PR 01 foundation defects that would make later routing behavior
incorrect, introduces the shared routing contracts and ordered 12-phase engine, and
wires both HTTP endpoints through CQRS and handler-owned transactions.

No routing algorithm is implemented in this PR. PRs 03-09 replace the phase stubs with
behavior while preserving the contracts and sequencing established here.

PR 02 also publishes the UI-facing contract and HTTP 501 stub for the structural UC
replacement API in FR-UC-UPDATE-01. Its command, handler, validation, and persistence
behavior remain planned for PR 11 and will reuse manual-flow validation without adding a
routing mode.

## 2. Frozen Requirements

1. Fix the audited PR 01 persistence and overlay defects before adding routing
   scaffolding.
2. Keep the canonical endpoints:
   - `POST /arc-api/v1/projects/:projectId/create-usecases`
   - `POST /arc-api/v1/projects/:projectId/create-manual-usecases`
3. Both requests carry selected UC IDs, active SGKV selections, and data-link,
   control-link, and subgraph exclusions. The auto and manual DTOs remain separate even
   where their fields overlap.
4. Add one shared `RoutingEngine`, immutable mode-specific input, per-request mutable
   context, outcome contract, and twelve phase services in the documented order.
5. Both commands require an active `DESIGNER` or `DIFF_MERGE` session.
6. Each handler owns transaction start, commit, and rollback.
7. Before every automatic run, delete every current-session edit-action whose source is
   `AUTO_ROUTING`, including superseded and active rows. Manual runs do not perform this
   cleanup.
8. Both handlers invoke the external chain resolver before constructing routing input.
   PR 02 cannot be considered complete until the external resolver implementation is
   rebased and wired.
9. Auto response fields are `created`, `updated`, `markedForDeletion`, `issues`, and
   `groupId`. Manual response fields are `created`, `issues`, and `groupId`.
10. Functional endpoints return HTTP 200. PR 02 leaves both controller methods at 501
    until automatic routing is activated in PR 06 and manual routing in PR 07; this
    prevents no-op phase stubs from resolving chains or deleting prior AUTO output.
     Existing session and application error mapping remains authoritative for 403, 422,
     and 500 responses after activation.
11. Publish the structural UC replacement PUT contract using core-owned Zod schemas and
    API `createZodDto` wrappers, but leave its controller method at HTTP 501. Internal
    `usecaseType` is not part of this public response.

## 3. Architecture Decision

### Decision

Use one explicit, fixed-order engine. `RoutingEngine` owns a readonly tuple of twelve
typed phase services and invokes every phase sequentially. A phase that does not apply
to the current mode returns success without mutating its owned output fields.

Each phase implements one small application-layer contract:

```typescript
interface RoutingPhase {
  run(context: RoutingContext, uow: UnitOfWork): Promise<Result<void>>;
}
```

The engine stops on the first blocking failure. Warnings remain in the context and do
not stop execution.

### Alternatives Rejected

- A dynamic middleware registry with priorities and predicates adds extension machinery
  before any phase behavior exists and makes ordering errors easier.
- Separate automatic and manual engines duplicate orchestration and allow their shared
  phase order and error semantics to drift.

### Consequences

- The sequence is obvious in code and directly testable.
- Later PRs can replace individual stubs without changing handlers or controllers.
- Adding a genuinely different workflow later requires a separate application service,
  not another routing mode by default. FR-UC-UPDATE-01 follows this rule.

## 4. Foundation Corrections

These corrections precede scaffold work and receive integration regression tests.

### 4.1 Hydrate Routing-Required UseCase GKV

`TypeOrmUsecaseRepository` must construct `UsecaseOverlayFetcher` with the GKV fetcher
it already supports. `findAll`, `findBySystemIds`, and active-manual-edit reads must
hydrate `UseCase.keyVector`; routing uses it for exact-match and duplicate detection.

Category hydration remains optional. The routing repository does not consume
`UseCase.categories`, so it must not add a category query solely for this workflow.
Query-service callers that need category data continue to provide the category fetcher
explicitly and receive populated categories; callers that omit it knowingly receive an
empty category collection.

### 4.2 Stage GKV Relationships on Create

`UsecaseRepository.create` must stage the UC's GKV relationship rows from
`uc.keyVector.valueSystemIds`. The base UC action and every GKV, SG-membership, and
SG-pair relationship action use the same `groupId` obtained once from
`uow.getWriteContext()` and are written in the same transaction. Empty GKV remains
invalid at the domain/routing boundary; the adapter does not invent values.

### 4.3 Include Session-Created Entities in Filtered Overlay Reads

ID-filtered UC and SG reads must merge matching session CREATE edit-actions even when
the requested entity has no committed base row. Filtering must apply to the effective
overlay collection rather than using committed rows as an existence gate.

### 4.4 Preserve Manual Edit Metadata

`findWithActiveManualEdits` must query matching active MANUAL UC CREATE/UPDATE actions
without inner-joining through committed UC rows. Its result contract must preserve:

```typescript
interface ActiveManualUsecaseEdit {
  changeId: number;
  usecase: UseCase | null;
  operation: 'CREATE' | 'UPDATE';
  referencedComponents: ReferencedComponents | null;
}
```

This allows Phase 9 to validate the exact dependency payload and distinguish creation
from update. `changeId` identifies the exact action for the later autofix workflow.
Rows whose effective UC or dependency payload is missing remain in the result with a
null field so the later validator can report them rather than silently dropping or
normalizing them.

### 4.5 Compute MDF Scope from Effective Topology

`findIsMdfInScope` must first determine the effective modules inside each candidate SG
after applying the current-session module overlay, including module creates, deletes,
and updates that move a module into or out of the SG. It then resolves those effective
modules' definitions and applies the existing module-composition rule. The current
committed-only module subqueries are insufficient; the MDF rule itself does not change.

### 4.6 Add Source-Scoped Session Cleanup

Add a session-repository operation that deletes all edit-actions for one session and
source. The automatic handler calls it with `AUTO_ROUTING`. The adapter deliberately
does not filter by operation, `validUntil`, or change status: it removes active rows,
superseded historical rows, and CREATE/UPDATE/DELETE actions for UC base and relationship
rows. This affects only uncommitted edit-actions in the current session; it does not
delete committed data or MANUAL/DIFF_TOOL actions. No generic raw persistence access is
exposed to core.

## 5. Routing Contracts

All contracts live in `@arc/core`; they import no NestJS, TypeORM, or Node.js modules.

### 5.1 Mode and Input

Use an `Auto | Manual` routing mode and a discriminated `RoutingInput` union. Both
variants contain required `selectedUsecaseSystemIds: number[]` and
`activeSubgraphs: {systemId: number; valueSystemIds: number[][]}[]`. The three exclusion
lists are optional on the wire and normalized to empty readonly arrays in core. Both
variants also carry repository-derived graph edits. The auto variant additionally
carries stale UCs needed by later phases. Manual `activeSubgraphs` order defines its
synthetic path for deterministic Phase 8 expansion; it does not define graph topology.
The manual variant also carries `manualTopology`, produced server-side by the manual
pair-discovery service, with discovered pairs, supporting link IDs, and isolated SG IDs.
Before discovery, the handler removes explicitly excluded SGs from `activeSubgraphs`
while preserving relative order and passes both explicit link-exclusion sets to the
service. Links incident to a removed SG are therefore excluded implicitly.

Inputs are copied from API DTOs into readonly core values. String IDs are parsed at the
API boundary or command construction boundary; routing works with numeric IDs. The API
mapper preserves request order and does not silently deduplicate IDs. Business-level
duplicate or conflict handling belongs to Phase 1 in PR 03/07, not the PR 02 DTO.

### 5.2 Context

`RoutingContext` is created once per engine run. It defines the complete downstream
surface up front: `input`, `mode`, `allUcs`, effective SG/data-link/control-link
exclusion sets, `markedForDeletion`, `deletionPreservedUcs`,
`degradedToDisconnected`, `reconstructionPaths`, `disconnectedTransitions`,
`kvResolutions`, `seeds`, `cones`, `dfsPaths`, `combinations`,
`ecBridgeCandidates`, `classified`, `orphans`, `warnings`, `stagedChanges`, and
`response`. Collections start empty and each phase owns its documented output field;
only warnings and DFS paths are appendable by multiple phases.

No repository, unit of work, API DTO, ORM row, or chain-resolver result is stored in the
context.

In auto mode, Phase 2 loads `allUcs` from committed state for deletion impact analysis.
In manual mode, Phase 2 remains a no-op and Phase 9 reads effective file-wide UCs from
`UsecaseRepository.findAll` for exact-match idempotency.

### 5.3 Outcome

`RoutingOutcome` is a core application result, not an API response DTO. It contains the
created/updated/deletion-marked `UsecaseIdentifierWithChangeInfo` projections, issues,
and ambient group ID obtained from `uow.getWriteContext()`. Manual mapping intentionally
omits auto-only collections.

The successful wire shape remains the standard `ApiResult` envelope. Its `data` field
contains `{created, updated, markedForDeletion, issues, groupId}` for auto or
`{created, issues, groupId}` for manual; arrays, including `issues`, are present as
empty arrays when empty. A blocking failure has no data payload and is represented by
the existing outer error contract.

## 6. Ordered Phase Skeleton

The engine invokes these services exactly once and in this order:

1. `PreValidationService`
2. `DeletionScopeService`
3. `DisconnectedTransitionService`
4. `KvResolutionService`
5. `SeedDetectionService`
6. `ConeComputationService`
7. `DfsRoutingService`
8. `CombinationExpansionService`
9. `ClassificationService`
10. `OrphanValidationService`
11. `RoutingChangeStager`
12. `ResponseBuilder`

PR 02 stubs return success and initialize only the deterministic empty/default state
owned by the phase. They must not query persistence, allocate entity IDs, or emit edit
actions. Manual mode makes phases 2, 3, 5, 6, and 7 explicit successful no-ops. Phase 8
runs for both modes; in manual mode it expands the ordered `activeSubgraphs` synthetic
path into the requested SGKV Cartesian combinations.

`RoutingEngine` receives the phase instances through explicit constructor dependencies,
builds the tuple internally, and exposes only `run(input, uow)`. It passes the same UoW
to every phase and does not support runtime registration, priorities, or mutable phase
lists. The UoW remains outside `RoutingContext`.

`ManualPairDiscoveryService` is a separate application service rather than a routing
phase. PR 02 establishes its contract and an empty scaffold; PR 07 implements it. It
examines every unordered pair of non-excluded supplied SGs after chain resolution,
discovers non-excluded data links first and control-link fallback where required by
FR-UC-01, derives directed pairs, and identifies isolated SGs. Its result becomes
`RoutingInput.manualTopology`. Phase 8 uses the same filtered `activeSubgraphs` list, so
excluded SGs cannot re-enter combinations. Request order affects combination ordering
only.

## 7. Command and Handler Flow

Create separate `CreateUsecasesCommand` and `CreateManualUsecasesCommand` classes. Both
extend `BaseCommand`, require a session, and allow `DESIGNER` and `DIFF_MERGE`.

The automatic handler flow is:

1. Start the UoW transaction.
2. Invoke the external chain resolver with the same UoW.
3. Delete all current-session `AUTO_ROUTING` edit-actions, including active and
   superseded CREATE/UPDATE/DELETE rows for UC base and relationships.
4. Read graph edits and other repository-derived input after chain resolution.
5. Construct immutable automatic `RoutingInput`.
6. Run the engine.
7. Apply cached actions if required by the existing write path.
8. Commit and return the core outcome.
9. On a failed `Result`, roll back and throw `DomainRuleViolationException` so a failed
   result never reaches `toApiResult` and accidentally becomes HTTP 500.
10. On any thrown error, roll back and preserve the existing error contract.

The manual handler follows the same flow except step 3 is omitted. Before pair
discovery, it applies explicit SG exclusions to `activeSubgraphs` while preserving
relative order; it passes explicit data/control-link exclusions into
`ManualPairDiscoveryService`, then constructs the manual input variant from that
filtered selection and discovered topology.

The command bus continues to create and release the UoW. It does not start or commit the
transaction on the handler's behalf.

## 8. External Chain-Resolver Checkpoint

Chain resolution is owned by the subsystem-links work and is not reimplemented here.
The required core contract is
`IChainResolver.resolveAllChains(uow): Promise<Result<void>>`. A failed result is
converted to `DomainRuleViolationException`, rolls back the transaction, and maps to
HTTP 422. No resolver data is returned; later reads observe its staged writes through
the overlay. Before implementing handler wiring:

1. Rebase the branch containing the external resolver.
2. Verify the landed implementation satisfies this required contract and error
   semantics; if it does not, resolve that incompatibility in the owning dependency.
3. Use the landed symbol directly; do not introduce a second local abstraction.
4. Wire the same resolver instance into both handlers before input assembly.
5. Add tests proving resolver failure rolls back and prevents both AUTO cleanup and
   routing phase execution.

If the dependency is still absent, PR 02 remains blocked. Do not add a compatibility
adapter, duplicate resolver, or silent no-op fallback.

## 9. API Layer

Expand the existing request DTOs with nested validation for all required fields. The
manual DTO gains selected UC IDs and subgraph exclusions so both approved contracts are
represented. Selected UC IDs and active subgraphs are required arrays. Exclusion arrays
are optional and default to empty in core. `SubgraphKvSelectionDto.valueSystemIds`
remains `string[][]`; malformed IDs and malformed nested arrays fail DTO validation,
while business-level empty/duplicate rules remain Phase 1 concerns.

PR 02 prepares final Swagger/DTO contracts but leaves both controller methods returning
`NotImplementedException`. This prevents the no-op scaffold from performing chain
resolution or AUTO cleanup. PR 06 activates automatic command dispatch; PR 07 activates
manual command dispatch. Once active, each method:

- uses `SessionGuard` and `@ArcSession()`;
- parses project/body IDs without business logic;
- dispatches through `CommandBus` with the active session;
- maps the core outcome to the distinct automatic/manual response DTO;
- declares HTTP 200 and Swagger request/response/error metadata.

PR 02 additionally adds the contract-only
`PUT /arc-api/v1/projects/:projectId/usecases/:usecaseSystemId/structure` endpoint defined
in `docs/use-case-creator/design/update-usecase-structure-stub-design.md`. Its request and
response schemas are owned by `@arc/core` and reused by API `createZodDto` wrappers.
Swagger documents the future 200/400/403/404/409/422 behavior and current 501 response.
The method body only throws `NotImplementedException`; PR 11 adds CQRS and persistence
behavior.

Both handlers are registered in `CommandHandlerRegistry`, and their commands, outcomes,
and shared routing contracts are exported through `@arc/core`. `RoutingEngine` owns
context construction and phase sequencing; there is no separate orchestrator class.
All new core files live under
`packages/core/src/application/usecase-designer/auto-usecase-creator/`.

## 10. Error and Transaction Semantics

- Missing or disallowed session: existing guard/command-bus 403 behavior.
- Malformed DTO or numeric ID: 400 through API validation/mapping.
- Routing/domain blocking issue: failed `Result`, rollback, mapped to 422.
- Chain resolver or persistence failure: rollback and existing infrastructure error
  mapping; no partial edit-actions survive.
- A warning-only outcome commits and returns HTTP 200 with `issues`.
- A failed phase prevents every later phase from running.
- PR 02 HTTP calls remain 501 and cannot reach these mutating handler paths.

## 11. Verification Strategy

### Foundation Integration Tests

- UC reads used by routing hydrate GKV in committed and overlay modes; category fetching
  remains optional and is not added to the routing repository path.
- UC create stages base, GKV, SG-membership, and SG-pair actions under one group.
- ID-filtered UC and SG reads return session-created entities.
- Active manual CREATE/UPDATE reads include session-created UCs, operation, and exact
  `referencedComponents`; missing UC/payload cases retain `changeId` and surface null.
- MDF detection reacts to session-created and session-deleted module topology.
- AUTO cleanup removes active and superseded AUTO_ROUTING CREATE/UPDATE/DELETE rows only
  for the current session, including UC relationship rows, and preserves committed data,
  MANUAL/DIFF_TOOL actions, and other-session rows.

### Core Unit Tests

- Context defaults and input immutability.
- Exact 12-phase order.
- Blocking failure short-circuits subsequent phases.
- Warnings continue through later phases.
- Manual no-op phase behavior.
- Manual pair-discovery scaffold output and handoff into `RoutingInput.manualTopology`.
- Automatic/manual handler success, rollback, resolver ordering, cleanup distinction,
  input assembly timing, and outcome propagation.
- Registry-based dispatch resolves each command to its handler.
- Resolver writes are visible to repository reads performed during input assembly.
- Rollback after cleanup restores the prior AUTO_ROUTING rows.

### API E2E Tests

- PR 02 endpoints remain 501 and do not dispatch commands or mutate edit-actions.
- DTO tests cover omitted versus empty optional exclusions and malformed nested IDs.
- Swagger generation exposes the structural-update PUT request/response contract, and a
  controller test proves its stub returns 501 without dispatching a command.
- Final HTTP 200/403/422 response and dispatch tests are assigned to PR 06 (auto) and
  PR 07 (manual), when each endpoint becomes functional.

Run the focused package suites during development, then finish with `pnpm run build`,
`pnpm test -- --runInBand`, and `pnpm run lint`.

## 12. Scope Boundaries

PR 02 does not implement routing rules, commit safety checks, SGKV commit persistence,
EC/MDF algorithms, same-GKV resolution, orphan autofix, or structural UC replacement
behavior. It publishes only the structural replacement API contract and 501 stub. It
does not modify database schemas or regenerate the initial migration.

Generated `dist/` files are not edited. Core remains framework- and Node-free, all
writes stay behind UoW repositories, and all source imports retain `.js` extensions.
