<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# PR 1 Plan Handoff: Foundation

**Plan output:** `docs/use-case-creator/plans/pr-01-foundation.md`

**Master handoff:** [`auto-usecase-creator-plan-handoff.md`](./auto-usecase-creator-plan-handoff.md)
**Progress tracker:** [`pr-progress.md`](./pr-progress.md)

**Feature branch:** `use-case-creator` (implementation may be delivered on a topic branch off this feature branch and merged back).

---

## PR summary

**Purpose:** Establish the domain and repository primitives required by the 12-phase Auto Use-Case Creator routing pipeline. Nothing is wired to the routing engine yet — this PR only extends existing aggregates and repositories so that later PRs can consume the new APIs.

**What lands in this PR:**
1. Domain-entity extensions on `DataLink`, `Usecase`, and (verify) `Subgraph`.
2. New `UsecaseType` enum in the domain layer.
3. New port methods on four repository interfaces (`IUsecaseRepository`, `ISubgraphRepository`, `IDataLinkRepository`, `IControlLinkRepository`) with TypeORM adapter implementations.
4. One shared internal helper for `edit_actions` filter re-use across Phases 2 and 4.
5. A migration if any schema column is added.
6. Unit + integration tests per method, per adapter.

**What does not land in this PR:**
- No `RoutingEngine`, no phase stubs, no handler wiring (that is PR 2 — Scaffolding).
- No routing behavior, no HTTP endpoints.
- No cross-aggregate orchestration.

---

## Spec references (writing-plans should read as needed)

| Purpose | Path |
|---|---|
| Overall design | `docs/use-case-creator/design/overall-design.md` |
| LLD1 — PreValidation + KV + Seed + Cone | `docs/use-case-creator/design/lld/lld1-kv-resolution-cone.md` (esp. §3.1 excluded-* propagation, §6.2 FR-KV-02, §6.3 FR-KV-03 IsMdf auto-population) |
| LLD2 — DFS + Combination | `docs/use-case-creator/design/lld/lld2-dfs-core.md` (esp. DfsPath shape context) |
| LLD4 — DeletionScope + DisconnectedTransition | `docs/use-case-creator/design/lld/lld4-deletion-transition.md` (esp. §5.4.b legacy EC UC narrow check consumer of `applyUcFilterToSg`) |
| LLD5 — EC routing overlays | `docs/use-case-creator/design/lld/lld5-ec-routing.md` (§5.1 `DataLink.isEc` semantics; §7 lifecycle; open question E1 on `Subgraph.isMdf`) |
| Core requirements | `docs/use-case-creator/auto-usecase-routing-requirements.md` |
| Extended requirements | `docs/use-case-creator/auto-usecase-routing-requirements-extended.md` (FR-EC-07 legacy compat, FR-COMMIT-01, FR-PREVAL-*) |
| Legacy test mapping | `docs/use-case-creator/design/legacy-test-mapping.md` (informational — no legacy tests are folded in this PR) |
| Alignment review status | `docs/use-case-creator/design/alignment-review-findings-2026-08-14.md` |

**Reference implementation for existing repository shape:** the existing repositories under `packages/core/src/domain/entities/usecase/`, `packages/core/src/domain/entities/subgraph/`, `packages/core/src/domain/entities/data-link/`, and `packages/core/src/domain/entities/control-link/` (or wherever they currently live) together with their TypeORM adapter implementations in `packages/infrastructure/persistence`.

---

## Chapter content (from master handoff — Chapter 1)

**Purpose:** Domain and repo primitives; nothing is wired to the routing engine yet.

### Sections to cover

#### 1. Domain entities

- **`DataLink.isEc: boolean`** — add attribute to the `DataLink` aggregate. The schema column is expected to already exist; **verify** this claim during the plan and, if it does not, include a migration step per the CLAUDE.md migration workflow (single regenerated `initial-create.ts`).
- **`UsecaseType` enum** — introduce `UsecaseType` with three members: `Connected`, `Disconnected`, `EC`. Location: `packages/core/src/domain/entities/usecase/usecase-type.ts` (or the analogous location that matches the existing folder convention).
- **`Usecase.type` field** — add `type: UsecaseType` to the `Usecase` aggregate. Persisted via schema.
- **`Subgraph.isMdf` attribute** — LLD5 open question E1 assumes this exists. **Verify** during this PR; if the field is absent, add it (schema + entity + JSON serialization) and include the migration step in the plan.

#### 2. Repository extensions

Ports live in `@arc/core`; adapter implementations live in `@arc/persistence`. Every method added on a port must have:
- a domain-verb signature (no row shapes leak into `@arc/core`),
- an adapter implementation that produces the correct `edit_actions` row shape when relevant,
- unit tests on the port contract (mocked) and integration tests on the adapter (in-memory SQLite).

**`IUsecaseRepository`** — three reads + five writes (see Chapter 01-02 for the full contract):
- Reads: `findBySystemIds(fileId, ids, {readMode?})`, `findAll(fileId, {readMode?})`, `findWithActiveManualEdits(fileId)`. Reverse lookups (findByContainingSg, findByContainingLink, findByGkv, findLegacyEcUcsContainingPair, findByStatus) are performed as in-memory filters over `context.allUcs` — not port methods.
- Writes: `create(uc, options?, referencedComponents?)`, `delete(uc, options?)`, `applyStructuralChange(uc, delta: StructuralDelta, options?, referencedComponents?)`, `changeType(uc, newType, options?)`, `reverseDirection(uc, currentSourceSg, currentDestSg, options?)`.
- Supporting types (all in the port file, none on the shared `EditOptions`): `READ_MODE` enum + `ReadMode` type; `ReadOptions`; `ReferencedComponents`; `StructuralDelta`; `SubgraphPair`.

**`ISubgraphRepository`** — add:
- `getSgkvsBySgIds(fileId, sgSystemIds: bigint[]): Promise<SgkvInstance[]>`
- `findIsMdfInScope(fileId, sgSystemIds: bigint[]): Promise<Subgraph[]>` (returns the subset whose `isMdf` is true — used by FR-KV-03 auto-population)
- `findManualEditsSinceLastRouting(fileId): Promise<Subgraph[]>` (returns SGs whose entity edits are unstaged and post-date the last routing snapshot — informational query)

**`IDataLinkRepository`** — add:
- `findIntraUsecaseByFile(fileId): Promise<DataLink[]>` (data links whose both endpoints resolve to SGs, excluding subsystem-boundary links)
- `findLinksByPair(fileId, sgA, sgB): Promise<DataLink[]>` (all data links between the two SGs regardless of direction — used by FR-UC-01 step 4 pair discovery and by DFS adjacency)
- `findManualEditsSinceLastRouting(fileId): Promise<DataLink[]>`

**`IControlLinkRepository`** — add:
- `findIntraUsecaseByFile(fileId): Promise<ControlLink[]>`
- `findLinksByPair(fileId, sgA, sgB): Promise<ControlLink[]>` (used by FR-UC-01 step 4 fallback + FR-STATUS-04 direction retention)
- `findManualEditsSinceLastRouting(fileId): Promise<ControlLink[]>`

#### 3. Shared internal helper

`applyUcFilterToSg(sgId: bigint, ucFilter: UcFilter, subgraphRepo: ISubgraphRepository): Promise<SgkvInstance[]>` — location: `packages/core/src/application/routing/shared/kv-filter.ts` (folder may need creating).

Consumers:
- Phase 2 (LLD4 §5.4.b) legacy EC UC narrow check.
- Phase 4 (LLD1 §6.2) FR-KV-02 markedForDeletion exclusion.

The helper is stateless and pure — it consults the repo, applies the UC filter (a set of `ucSystemId`s to exclude), and returns the resulting `SgkvInstance[]`. Include unit tests using a stub `ISubgraphRepository`.

#### 4. Migration

Per CLAUDE.md **Database Migration Workflow**:
- If any schema column is added (`Usecase.type`, `Subgraph.isMdf`, or verified-absent `DataLink.isEc`), **regenerate** `initial-create.ts` end-to-end (delete → build → `pnpm run migration:gen` → post-process for copyright header + `import type` → update `migration-index.ts`).
- Do not hand-write migration files.
- If no schema changes are needed after verification, explicitly note that in the plan (no-op step) so a reviewer can confirm.

#### 5. Unit and integration tests

- Unit tests per port method (mocked adapters).
- Integration tests per adapter method against in-memory SQLite fixture data.
- Adapter tests must round-trip the emitted `edit_actions` row shape (verify `field_path`, `new_value`, and any `entity_kind`/`entity_id`/`change_status`/`source` columns match the existing convention).
- Domain-entity tests: enum serialization for `UsecaseType`, JSON schema round-trip for new fields.
- Shared helper: unit tests for the include/exclude filter behavior with representative UC filter sets.

**Estimated size:** ~1500–2000 lines including tests.

---

## Cross-cutting notes relevant to this PR

**Boundary rules to enforce:**
- `@arc/core` has zero framework imports (only `zod` + `uuid`). No `class-validator` / `class-transformer` (see CLAUDE.md §"Known Issues / Open TODOs" item 6 — they are being removed).
- Row shapes (`field_path`/`new_value` on `edit_actions`) stay in adapters. Ports expose only domain-verb methods.
- CQRS layering is untouched by this PR (no new handlers, no `RoutingEngine`) — later PRs own that.
- All routing writes will eventually use `source=AUTO_ROUTING`, `changeStatus=UNSTAGED`; the new domain-verb methods (`create`, `update`, `delete`, `correctDirection`) must accept a `source` argument (or be shaped to be called from within a routing context that sets it). Confirm the existing convention for `source` on `edit_actions` and follow it.
- ESM: all local imports carry the `.js` suffix per CLAUDE.md.

**Invariants supported by this PR (owned/asserted later):**
- I2 (subgraph-pair completeness) — Chapter 6 owns the assertion; the domain-verb `create`/`update` methods introduced here are the surface where the assertion will be added in Chapter 6. Their signatures should not preclude that assertion.
- I7 (pair-link presence) — Chapters 5 and 10 own the assertion; likewise, the domain-verb methods here are the emission surface for pair edits.

**FR-API-06 (SG-level exclusion) — Chapter 1 role:** the handler DTO input signature that carries `excludedSubgraphSystemIds` is scaffolded in Chapter 2. This PR's responsibility is only to ensure the underlying `Usecase` / `DataLink` / `ControlLink` domain entities are queryable by SG in ways that let a later phase filter them (which the new `findByContainingSg` / `findByContainingLink` / `findLinksByPair` methods enable).

**Open items to resolve in this PR:**
- **`Subgraph.isMdf` attribute** — LLD5 open question E1. Verify presence; add if missing.
- **`DataLink.isEc` schema column** — assumed to exist; verify. Add migration only if absent.
- **Existing `Usecase` type/status representation** — the plan should read the current `Usecase` entity to determine whether `type` is a brand-new column or overlaps an existing `status` column. If overlap, propose a naming convention that keeps the two concepts distinct without breaking existing queries.

**Legacy test citation convention:** not applicable to this PR (no legacy tests are folded in until Chapters 8 and 10). Contradiction adaptations likewise do not apply here.

---

## Batches for writing-plans subagent orchestration

### Batch 1 (single chapter)

- **Foundation** — Domain entities + repo method additions across 4 aggregates | Start task 1

**Estimated total tasks for this PR:** ~15 tasks (per master handoff task budget). TDD structure: for each repo method, one test task precedes one implementation task; shared helper and domain enum each get their own paired tasks; migration (if any) is its own task; a final wrap-up task verifies the build passes and all new tests are green.

---

## Deliverable contract for writing-plans

Produce `docs/use-case-creator/plans/pr-01-foundation.md` with:
- Task-by-task TDD structure per the master handoff's expectations (write failing test → implement → confirm green).
- Every task cites the exact file path it touches (`packages/core/...` or `packages/infrastructure/persistence/...`).
- Every task includes the complete code diff, not summaries.
- A commit checkpoint after each cohesive slice (per-repo method group, shared helper, domain enum, migration).
- Explicit verification steps: `pnpm run build`, `pnpm --filter @arc/core run test:unit:core`, `pnpm test` (or the equivalent per-package integration test).
- A final task confirming CLAUDE.md conventions have been respected (ESM `.js` imports, zero framework deps in core, structured logging with hex IDs where relevant).
