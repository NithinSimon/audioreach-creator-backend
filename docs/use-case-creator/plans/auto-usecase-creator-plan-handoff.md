<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Plan Handoff: Auto Use-Case Creator

**Plan output:** `docs/use-case-creator/plans/auto-usecase-creator.md`

**Progress tracker:** [`pr-progress.md`](./pr-progress.md) — dynamic state across sessions; consult this first when resuming.

**Feature summary:** Automatic and manual use-case (UC) creation via a 12-phase
routing pipeline organized into three halves (A: resolve existing-UC fate; B: produce
new UCs; C: validate + emit). Two HTTP endpoints — `create-usecases` (auto) and
`create-manual-usecases` (manual) — both delegate to a shared `RoutingEngine` facade.
EC (Echo Cancellation) routing, MDF transparent-bridge substitution, legacy EC UC
compatibility (FR-EC-07), and SG-level exclusion (FR-API-06) are in scope.

---

## Spec references (writing-plans should read as needed)

| Purpose | Path |
|---|---|
| Overall design | `docs/use-case-creator/design/overall-design.md` |
| LLD1 — PreValidation + KV + Seed + Cone (Phases 1, 4, 5, 6) | `docs/use-case-creator/design/lld/lld1-kv-resolution-cone.md` |
| LLD2 — DFS + Combination (Phases 7, 8) | `docs/use-case-creator/design/lld/lld2-dfs-core.md` |
| LLD4 — DeletionScope + DisconnectedTransition (Phases 2, 3) | `docs/use-case-creator/design/lld/lld4-deletion-transition.md` |
| LLD5 — EC routing overlays (Phases 6, 7, 8, 9) | `docs/use-case-creator/design/lld/lld5-ec-routing.md` |
| Core requirements | `docs/use-case-creator/auto-usecase-routing-requirements.md` |
| Extended requirements (EC, MDF, FR-EC-07, FR-COMMIT-01, FR-PREVAL-*) | `docs/use-case-creator/auto-usecase-routing-requirements-extended.md` |
| Legacy test mapping (65 SGKV-Routing tests → target phases) | `docs/use-case-creator/design/legacy-test-mapping.md` |
| Alignment review status | `docs/use-case-creator/design/alignment-review-findings-2026-08-14.md` |

**Note on selective LLDs:** LLD3 and LLD6 are intentionally folded into the plan
(rule-driven behaviors + DTO/adapter shapes). Overall-design §12 LLD map enumerates
the plan-folded scope.

**Reference implementation for handler shape:**
`packages/core/src/application/usecase-designer/spf-module/patch/patch-spf-module.handler.ts`

---

## Scope note

**In scope for this delivery:** all 10 PRs / chapters listed below cover:
- Full 12-phase routing pipeline for both modes (auto + manual)
- EC routing (FR-EC-01..06 + FR-EC-07 legacy compatibility)
- MDF single-rule (FR-MDF-01) including Scenario 4 transparent-bridge substitution
- Auto Connected→Disconnected transition (FR-STATUS-02(b))
- SG-level exclusion (FR-API-06) as complement to link exclusion (FR-API-05)
- 65 legacy SGKV-Routing tests adapted to the new scheme
- Commit-time safety net contract for edit-crud commit LLD (FR-COMMIT-01)

**Out of scope (deferred):**
- FR-STAGE-01 — orphan handling on `/stage-changes` endpoint (owned by edit-crud stage LLD)
- Nested usecase preservation across sessions
- MDF V2 implicit intermediate subgraphs (base FR-MDF-01 is in scope)

---

## PR / chapter breakdown (10 PRs, ~19,000 lines diff)

Dependencies:
```
PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6
                                       ├→ PR 7 ─┐
                                       ├→ PR 8 ─┤
                                       └→ PR 9 ─┴→ PR 10
```

PRs 7/8/9 run in parallel after PR 6 lands. PR 10 gates on all three.

---

## Batches for writing-plans subagent orchestration

### Batch 1 (single chapter)
- **Foundation** | Domain entities + repo method additions across 4 aggregates | Start task 1

### Batch 2 (after batch 1)
- **Scaffolding** | RoutingEngine facade + phase stubs + handler wiring | Start task 15

### Batch 3 (after batch 2)
- **Half A (Phases 1–3)** | PreValidation + DeletionScope + DisconnectedTransition | Start task 23

### Batch 4 (after batch 3)
- **Half B pt.1 (Phases 4–6)** | KvResolution + SeedDetection + ConeComputation | Start task 40

### Batch 5 (after batch 4)
- **Half B pt.2 (Phases 7–8)** | DfsRouting + CombinationExpansion | Start task 55

### Batch 6 (after batch 5)
- **Half C (Phases 9–12)** | Classification + OrphanValidation + Stager + Response | End-to-end auto routing complete | Start task 70

### Batch 7 (parallel, after batch 6)
- **Manual UC flow** | Phase overrides for manual mode + FR-UC-01 pair discovery | Start task 88
- **EC routing (LLD5)** | Adjacency isEc + boundary DFS + right-side traversal + Bridge + FR-EC-07 legacy compat + Rule C pre-validation | Start task 96
- **MDF single-rule (FR-MDF-01)** | IsMdf attribute + Phase 4 KV rejection + cone/DFS/combination transparency + FR-MDF-01 Scenario 4 transparent bridge (already in LLD4 §5.1) | Start task 114

### Batch 8 (after batch 7)
- **Commit safety net + legacy tests** | FR-COMMIT-01 (a)/(b1)/(b2)/(c)/(d) at `/commit-changes` + adaptation of 65 legacy tests | Start task 122

### Batch 9 (after batch 8)
- **Structural UC replacement API** | FR-UC-UPDATE-01 `PUT /usecases/:usecaseSystemId/structure` | Start task TBD

**Estimated total tasks:** ~150 across all chapters.

---

## Chapter details for writing-plans subagents

### Chapter 1 — Foundation (PR 1)

**Purpose:** Domain and repo primitives; nothing is wired to the routing engine yet.

**Sections to cover:**
- **Domain entities:** add `DataLink.isEc: boolean` attribute (schema column exists); add `UsecaseType` enum `Connected | Disconnected | Ec`; add `Usecase.type` field.
- **UseCase-specific type:** `ReferencedComponents` defined in `UsecaseRepository` port — NOT in `EditOptions` (which is a framework-wide generic and stays unchanged). `ReferencedComponents` is a dedicated optional third param on `create`/`update` for FR-COMMIT-01(d) / ARC-ROUTING-MANUAL-UC-BROKEN-DEPS. Consumed by PR 7 (`create-manual-usecases`) and PR 6 (FR-DUP-04 apply-fix); omitted by Phase 11 AUTO_ROUTING output.
- **Repository extensions** (ports + adapters + one shared internal helper for `edit_actions` filter):
  - `IUsecaseRepository` — three reads (`findBySystemIds`, `findAll`, `findWithActiveManualEdits`) + five writes (`create`, `delete`, `applyStructuralChange`, `changeType`, `reverseDirection`). Reverse lookups done as in-memory filters over `context.allUcs`. `readMode` param on `findBySystemIds` and `findAll`; `READ_MODE.Committed` used by Phase 2 impact detection.
  - `ISubgraphRepository`: `getSgkvs`, `findByIds`, `findIsMdfInScope` (computed from IPC_TX/IPC_RX modules, not a persisted column), `findManualEditsSinceLastRouting`
  - `IDataLinkRepository`: `findIntraUsecaseByFile(excludedIds?)`, `findLinksByPair(excludedIds?)`, `findManualEditsSinceLastRouting`
  - `IControlLinkRepository`: `findIntraUsecaseByFile(excludedIds?)`, `findLinksByPair(excludedIds?)`, `findManualEditsSinceLastRouting`
  - `ISubgraphRepository`: `getSgkvsBySgIds`, `findIsMdfInScope`, `findManualEditsSinceLastRouting`
  - `IDataLinkRepository`: `findIntraUsecaseByFile`, `findLinksByPair`, `findManualEditsSinceLastRouting`
  - `IControlLinkRepository`: `findIntraUsecaseByFile`, `findLinksByPair`, `findManualEditsSinceLastRouting`
- **Shared helper:** `applyUcFilterToSg(sgId, ucFilter, subgraphRepo): SgkvInstance[]` in `@arc/core/application/routing/shared/kv-filter.ts` — used by Phase 2 (LLD4 §5.4.b legacy EC UC narrow check) and Phase 4 (LLD1 §6.2 FR-KV-02).
- **Migration:** regenerate `initial-create.ts` per CLAUDE.md migration workflow if schema changes are needed. Otherwise no migration.
- **Unit tests:** per method, per adapter.

**Est. size:** ~1500–2000 lines including tests.

### Chapter 2 — Scaffolding (PR 2)

**Purpose:** Correct the landed PR 01 foundation and add an empty pipeline. Endpoints
remain 501 until their applicable routing behavior is complete; no no-op HTTP call may
resolve chains or erase AUTO_ROUTING history.

**Sections to cover:**
- Foundation corrections: routing-required UC GKV hydration (category hydration remains
  optional for callers that request it); GKV relationship actions on UC create under the
  same ambient `groupId` as the UC base and other relationships; session-created UC/SG
  support in ID-filtered overlay reads; metadata-rich `findWithActiveManualEdits`;
  effective-module-overlay MDF scope; regression tests.
- Session repository source cleanup that deletes all current-session AUTO_ROUTING rows,
  including active and superseded CREATE/UPDATE/DELETE history for UC base and
  relationships, without touching committed data or other sources.
- Folder: `packages/core/src/application/usecase-designer/auto-usecase-creator/`
- `RoutingEngine` facade class with stubbed `run(input, uow)` returning empty success.
- `RoutingContext`, `RoutingInput`, `RoutingOutcome` data classes with all fields defined (see overall-design §4, LLD1 §4, LLD2 §4, LLD4 §4).
- `RoutingEngine` constructs `RoutingContext` and owns the fixed phase tuple; no separate
  orchestrator class. `Phase` interface is
  `run(context, uow): Promise<Result<void>>`.
- 12 stub Phase classes returning `Result.ok()`.
- `ManualPairDiscoveryService` contract + empty scaffold; its PR 7 implementation
  filters excluded SGs while preserving relative order, applies explicit link
  exclusions, discovers all-pairs data/control topology, and supplies
  `input.manualTopology`.
- `CreateUsecasesCommand` + `CreateUsecasesHandler` — declare `BaseCommand.requiresSession=true`, `allowedModes=[DESIGNER, DIFF_MERGE]`. Handler shape mirrors `PatchSpfModuleHandler`.
- `CreateManualUsecaseCommand` + `CreateManualUsecaseHandler` — same shape.
- Command registry entries and `@arc/core` exports.
- Final DTO/Swagger shapes prepared, but both controller methods remain 501. Automatic
  dispatch activates in PR 6; manual dispatch activates in PR 7.
- Core-owned Zod schemas, API `createZodDto` wrappers, detailed Swagger metadata, and an
  HTTP 501 controller stub for the structural UC replacement PUT. Its behavior remains
  deferred to PR 11; see
  `docs/use-case-creator/design/update-usecase-structure-stub-design.md`.
- Handler tests cover resolver-before-input ordering, AUTO wipe scope, transaction
  rollback, and failed-Result to `DomainRuleViolationException` conversion.

**Est. size:** ~1000–1500 lines.

### Chapter 3 — Half A: Phases 1, 2, 3 (PR 3)

**LLDs to reference:** LLD1 §5 (Phase 1 PreValidation); LLD4 §5 (Phase 2 DeletionScope with FR-DEL-06 multi-path pair survival, single-path reconstruction with EC-cross narrow check per FR-EC-07 Rule B, transparent bridge substitution per FR-MDF-01, three-priority deletion precedence); LLD4 §6 (Phase 3 DisconnectedTransition with FR-STATUS-04 direction correction Step 1 + coverage Step 2).

**Key sub-tasks to include:**
- Handler-side `graphEdits` assembly (parallel repo calls per overall-design §6).
- Handler-side `staleUcs` query (`findByStatus('Disconnected', ...)`).
- Handler builds `input.excludedSubgraphSystemIds` propagation to `effectiveExcludedSgIds` / `effectiveExcludedDlIds` / `effectiveExcludedClIds` per LLD1 §3.1.
- Phase 2: three-priority impact detection (SG > DL > CL) with `degradedToDisconnected` populated for FR-STATUS-02(b) auto-transitions; transparent-bridge substitution check; FR-DEL-02 fail-fast; topology detection; multi-path survival; single-path bounded-DFS reconstruction with narrow FR-CONE-01 check for legacy EC UCs.
- Phase 3: direction correction with I7 preservation; coverage via direct data-link OR IsMdf bridge intermediate; partial coverage → no transition.

**Priority-5 callout:** LLD4 §5.4.b uses `applyUcFilterToSg` from the shared helper (Chapter 1).

**Est. size:** ~2500–3000 lines.

### Chapter 4 — Half B pt.1: Phases 4, 5, 6 (PR 4)

**LLDs to reference:** LLD1 §6 (Phase 4 KvResolution with FR-KV-02 markedForDeletion exclusion + IsMdf auto-population + FR-API-06 excluded-SG drop); LLD1 §7 (Phase 5 SeedDetection); LLD1 §8 (Phase 6 ConeComputation + FR-API-03).

**Key sub-tasks:**
- Data structures: `SgkvInstance`, `KvResolutions`, `Seeds`, `Cones` in `@arc/core`.
- FR-KV-02 exclusion logic: `filteringUcIds := selectedUcIds \ markedForDeletion.ucSystemIds`.
- FR-KV-03 IsMdf auto-population using `ISubgraphRepository.findIsMdfInScope`.
- Seed detection: FR-CONE-01 KV-changed comparison, FR-CONE-02 new-SG, FR-CONE-03 link-endpoint, FR-CONE-05 empty-selected, FR-CONE-06 out-of-context.
- Cone bidirectional expansion + FR-CONE-07 scope boundary + FR-API-03 completeness check.
- Test scenarios per LLD1 §10.

**Est. size:** ~2000–2500 lines.

### Chapter 5 — Half B pt.2: Phases 7, 8 (PR 5)

**LLDs to reference:** LLD2 §5 (Phase 7 DfsRouting) + LLD2 §6 (Phase 8 CombinationExpansion) with A-slim `DfsPath` shape (single `termination` enum + optional `ecBoundaryLinkId`).

**Key sub-tasks:**
- Adjacency map construction from intra-usecase data-links minus effective-excluded.
- DFS with cycle detection (warning; emit path as leaf per FR-DFS-04).
- Path emission: `termination='natural-leaf'` for normal leaves; `termination='cycle'` for cycle-terminated.
- Combination expansion with early-prune conflict detection (FR-DFS-05/06); GKV aggregation with `keyDefSystemId` sort.
- FR-DFS-08 blocking error when all combinations conflict; FR-DFS-09 empty-GKV silent discard.
- **Note:** LLD2 §5.3 single-SG path emission stays as-is (discards paths with `length < 2`) — per Priority-1 resolution, single-SG UCs are surfaced as orphan warnings by Phase 10, not emitted here.

**Est. size:** ~2000–2500 lines.

### Chapter 6 — Half C: Phases 9, 10, 11, 12 (PR 6) — First end-to-end auto routing

**No dedicated LLD** — plan-folded per overall-design §12. Reference the FRs directly and the classification-and-orphan tables in overall-design.

**Phase 9 (Classification) tasks:**
- **Stale MANUAL edit-action pre-check (FR-DUP-04):** before collision detection runs, validate every `source=MANUAL AND target_table='UseCase' AND operation IN ('CREATE','UPDATE')` edit-action against the effective graph — every `referencedComponents` entry must exist and not be marked for deletion. On any failure, emit blocking `ARC-ROUTING-MANUAL-UC-BROKEN-DEPS` with an autofix option to remove the stale row and halt the pipeline before collision detection.
- Iterate over `context.combinations.candidates` + `context.ecBridgeCandidates` (chapter 8 adds the latter).
- **FR-EC-07 Rule A** (Bridge suppression against legacy EC UC when neither endpoint is KV-changed seed) — see LLD5 §7.1 algorithm.
- **FR-DUP-03(a) exact-match no-op:** newly discovered path has identical GKV + SG set + pair set as an existing DB UC → no new UC, no issue.
- **FR-DUP-03(b1) identity-preserving interior extension silent auto-update:** same GKV, same start SG set, same end SG set, strict-superset SG set, every added interior SG contributes empty SGKV (isMdf / user-supplied `[]` / reconstruction with no new KVs) → UPDATE existing UC in place; staged as `source=AUTO_ROUTING`. Preserve type (legacy EC stays EC).
- **FR-DUP-04 same-GKV user-choice collision detection (unified across all UC types):**
  - Detect collisions between two new candidates (overlapping or disjoint) and between a new candidate and an existing DB UC (overlapping-not-(b1) or disjoint).
  - Applies to `Connected`, `Disconnected`, and `EC` candidates uniformly per I1 unified GKV uniqueness rule — no type-based exemption. FR-EC-07 Rule A Bridge suppression against legacy EC UCs is a separate, pre-Phase-9 concern; once past Rule A, EC Bridge candidates are subject to FR-DUP-04 like any other UC.
  - **Re-run recognition:** before emitting the blocking issue, inspect `source=MANUAL` edit-actions for a match by GKV + SG set + pair set against any of the offered options. If matched, silently apply that resolution (skip prompting).
  - Otherwise, emit blocking `ARC-ROUTING-SAME-GKV-CHOICE-REQUIRED` with 2 or 3 `FixOption` entries carrying `ResolveSameGkvCollisionCommand` payload `{mode, collisionId}`.
- **FR-EC-07 Rule D:** on FR-DUP-03(b1) update-in-place matching a legacy UC in `markedForDeletion`, un-mark it.

**Phase 9 apply-fix pathway (new — folded into plan, delivered in chapter 6):**
- `ResolveSameGkvCollisionCommand` handler: re-run routing pipeline; verify chosen option is still algorithm-generateable against current graph state; emit `ARC-ROUTING-SAME-GKV-CHOICE-STALE` if not.
- On valid choice, materialize as `source=MANUAL` staged edit-actions:
  - `PATH_A` / `PATH_B` (two new paths) → CREATE UseCase with pair set from DFS path.
  - `MERGE` (two new paths) → CREATE UseCase with union of SG sets and pair sets.
  - `KEEP_EXISTING` → no edit-action.
  - `REPLACE_WITH_NEW` → DELETE existing UC + CREATE new UC.
  - `MERGE` (new vs existing DB UC) → UPDATE existing UC (extend SG set + pair set).
- All CREATE and UPDATE edit-actions carry a `referencedComponents: {sgSystemIds, dataLinkSystemIds, controlLinkSystemIds}` payload capturing the components introduced by that edit-action — validated by FR-COMMIT-01(d) at commit and by the Phase 9 pre-check on subsequent `create-usecases` runs.

**Phase 10 (OrphanValidation) tasks:**
- FR-VAL-01: orphan SG detection; emit `ARC-ROUTING-ORPHAN-SUBGRAPH` warning.
- **New for auto workflow:** if orphan SG has non-empty `perSg`, additionally emit `ARC-ROUTING-ORPHAN-SG-HAS-KVS` hint (Priority-1 resolution).
- FR-VAL-02: orphan subsystem detection.
- FR-VAL-03: orphan intra-usecase-link detection (data-link OR control-link).

**Phase 11 (RoutingChangeStager) tasks:**
- Emit `edit_actions` via `IUsecaseRepository` domain-verb methods (`create`, `update`, `delete`, `correctDirection`).
- **FR-EC-07 Rule E**: recompute `Usecase.type` from resulting pair set (EC iff ≥1 isEc pair; Disconnected iff any pair lacks data-link support; else Connected). Include recomputed `type` in `update` call.
- Emit `usecaseRepo.update(uc, {type: 'Disconnected'})` for each entry in `context.degradedToDisconnected` (FR-STATUS-02(b)).
- **Priority 5 — I2 enforcement contract:** every `create`/`update` call that writes to `use_case_subgraph_pairs` must assert both endpoints are in the UC's SG set before persisting.

**Phase 12 (ResponseBuilder) tasks:**
- Assemble `CreateUsecasesResponseDto` with `created` / `updated` / `markedForDeletion` / `issues` / `groupId` per swagger definitions in overall-design and legacy DTO snapshot.
- Issue-code namespace per overall-design §8.

**Est. size:** ~2500–3000 lines. **End state: complete end-to-end auto routing for standard scenarios (no EC, no manual, no MDF).**

### Chapter 7 — Manual UC flow (PR 7)

**FRs:** FR-UC-01 including step 4 pair discovery.

**Key sub-tasks:**
- `CreateManualUsecaseHandler` — server-side pair discovery via `IDataLinkRepository.findLinksByPair` iterated over pairs of provided SGs; control-link fallback per FR-UC-01 step 4 with smaller-SG-ID direction rule; isolated SG (no data-link, no control-link) → include in UC with no pairs + emit warning.
- Manual-mode phase no-ops for Phases 2, 3, 5, 6, and 7. Phase 8 expands the ordered
  `activeSubgraphs` synthetic path into one candidate per valid Cartesian SGKV
  combination.
- Phase 4 runs in "resolve provided GKVs" mode; Phase 9 runs partial (idempotency check only — FR-DUP-03(a) exact-match no-op).
- Manual request order controls deterministic Phase 8 expansion only; pair topology is
  the all-pairs `ManualPairDiscoveryService` result. Phase 9 loads effective file-wide
  UCs directly for exact-match idempotency because manual Phase 2 is a no-op.
- Manual pair discovery and Phase 8 both consume `activeSubgraphs` after explicit SG
  exclusion; incident links are implicitly excluded and explicit data/control-link
  exclusions are applied before pair derivation.
- Manual mode may create `type=Connected` or `type=Disconnected` per FR-STATUS-01 depending on pair data-link coverage.

**Est. size:** ~1000–1500 lines.

### Chapter 8 — EC routing (LLD5 — PR 8)

**LLD to reference:** LLD5 entirety (§5.1 FR-EC-01 through §7 lifecycle).

**Key sub-tasks:**
- Adjacency: include `isEc` flag on edges (LLD5 §5.1).
- Phase 7 DFS: EC boundary emits `termination='ec-boundary'` + `ecBoundaryLinkId`; right-side traversal from EC right SG with `(ecLinkId, rightSgSystemId)` deduplication cache (LLD5 §5.2).
- FR-EC-05 single-EC-per-path enforcement inline in DFS (blocking `ARC-ROUTING-EC-05`).
- **FR-EC-07 Rule C** max-1-EC-per-UC pre-validation with `matchesMdfPattern` exception (LLD5 §5.4) — runs in Phase 1 PreValidationService.
- Phase 8: Bridge candidate generation per FR-EC-03; FR-EC-04 KV compatibility (non-blocking warning `ARC-ROUTING-EC-BRIDGE-INCOMPATIBLE`).
- Phase 9: EC bridge dedup by `(ecLinkId, leftSg, rightSg, gkv)`; FR-EC-06 lifecycle (preserve on GKV change, delete on structural change).
- 12 legacy EC tests folded in (T1-017/18, T2-037..045, T2-065 per `legacy-test-mapping.md` §3.12).
- 10 legacy EC UC compatibility tests (T-EC-legacy-a..j from LLD5 §9).
- **Adaptation reminder for T2-038:** legacy expects blocking on Bridge KV conflict; our design (per FR-EC-04 update in extended reqs) makes it a warning. Confirm/update.

**Est. size:** ~2000–2500 lines.

### Chapter 9 — MDF single-rule (FR-MDF-01) (PR 9)

**FRs:** FR-MDF-01 including transparent bridge substitution (already integrated in LLD4 §5.1 for auto flow).

**Key sub-tasks:**
- `Subgraph.isMdf` attribute (may already exist in schema; verify).
- Phase 4 IsMdf KV rejection (LLD1 §6.3 edge case — blocking `ARC-ROUTING-MDF-01`).
- Phase 4 IsMdf auto-population (LLD1 §6.3 algorithm).
- Phase 6 cone: IsMdf SGs exempt from FR-CONE-07 boundary and FR-API-03 completeness.
- Phase 3 FR-STATUS-04 Step 2 coverage: allow IsMdf bridge SGs as valid intermediates.
- Phase 8 Cartesian: IsMdf SGs contribute single empty SGKV instance (no multiplication).
- MDF Scenario 4 tests exercising the transparent bridge substitution path in LLD4 §5.1.

**Est. size:** ~1000–1500 lines.

### Chapter 10 — Commit safety net + legacy tests (PR 10)

**FRs:** FR-COMMIT-01 (a)/(b1)/(b2)/(c)/(d) at `/commit-changes`. Also folds in the remaining legacy test adaptations.

**Key sub-tasks:**
- Extend `/commit-changes` handler (edit-crud commit LLD boundary) with five safety-net checks per FR-COMMIT-01:
  - (a) Direction correction on Disconnected UCs.
  - (b1) Path re-validation for newly staged UCs — status-aware (Connected requires data-link coverage; Disconnected requires I7 pair-link presence).
  - **(b2) Existing-UC invalidation after staged SG/link deletion:** use committed pre-session topology to identify affected existing UCs, then validate them against the effective post-commit graph. If a UC remains stale, reject with HTTP 422 `ARC-COMMIT-ROUTING-REQUIRED`, listing affected UCs/pairs/deleted components and instructing the client to call `create-usecases` before retrying. This is state-based; already normalized or deleted UCs pass without tracking whether routing was invoked.
  - (c) Orphan detection — blocking commit if any SG, intra-usecase link (data or control), or subsystem is orphaned.
  - **(d) Manual UC referential integrity (extended for FR-DUP-04):** query for staged edit-actions where `source = 'MANUAL' AND target_table = 'UseCase' AND operation IN ('CREATE','UPDATE')`; for each found row, read the `referencedComponents` JSON field from its `new_value` payload (`{sgSystemIds: number[], dataLinkSystemIds: number[], controlLinkSystemIds: number[]}`); validate every listed component still exists in the effective post-commit graph and is not in a DELETE edit-action; on failure emit `ARC-COMMIT-MANUAL-UC-BROKEN-DEPS` (blocking, HTTP 422) listing each broken manual UC and its missing components; autofix hint = "delete the failing manual UC edit-action rows." Applies to both `create-manual-usecases` CREATEs and FR-DUP-04 user-choice CREATE/UPDATE edit-actions. DELETE edit-actions are not subject to this check — a DELETE targeting an already-absent UC is silently a no-op.
- **Priority 5 — I7 contract:** commit-time enforcement of pair-link presence is delivered by (b1)/(b2) — every pair must have at least one supporting link in the effective post-commit graph.
- **Priority 5 — I2 assertion at commit:** every persisted pair must have both endpoints in the corresponding UC's SG set. Optional double-check; primary enforcement is Phase 9 / Phase 11 (chapter 6).
- 53 remaining legacy tests folded in (65 total minus 12 EC in chapter 8):
  - Contradiction adaptations: **C1 (cycle→warning)** for T1-004, T2-014, T2-015; **C2 (Disc→Conn)** for T1-016, T2-036, T2-068 (kept legacy); **C3 (mixed-type error)** for T1-035, T1-036 (kept legacy); **C4 (zero-KV prepend→merge)** for T2-047; **T2-020 (single-SG UC → orphan warning + manual-hint)** per Priority-1 resolution.
  - Auto-fix tests (T1-020, T1-024, T2-029, T2-030, T2-031, T2-032) split into (a) routing returns correct warnings, (b) subsequent delete-orphan API call — the latter is edit-crud stage-changes territory, not this feature.

**Est. size:** ~2500–3500 lines.

### Chapter 11 — Structural UC replacement API (PR 11)

**FRs:** FR-UC-UPDATE-01 and FR-COMMIT-01(d).

**Dependencies:** PR 7 provides reusable manual SGKV/GKV validation. PR 10 provides
the commit safety net that protects the resulting MANUAL UPDATE edit-actions. PR 2
already publishes the core/API DTO contract, Swagger metadata, and HTTP 501 route stub.

**Key sub-tasks:**
- Activate the PR 2
  `PUT /arc-api/v1/projects/:projectId/usecases/:usecaseSystemId/structure` stub as a
  separate endpoint from the alias-only PATCH.
- Request fields: required `activeSubgraphs` with exactly one SGKV selection per SG,
  and required `dataLinkSystemIds` containing the exact selected data links.
- Validate overlay-aware existence/file scope, SGKV compatibility, selected-link
  endpoints, and file-wide GKV uniqueness excluding the target UC. Duplicate GKV is
  HTTP 409.
- Derive directed, deduplicated SG pairs from selected data links. Disconnected and
  isolated SGs are valid; no control-link input or discovery occurs.
- Extend `UsecaseRepository.applyStructuralChange` so one atomic group replaces GKV,
  SG membership, and pair relationships, recomputes the internal type from the resulting
  topology, and writes `referencedComponents` with an empty control-link list. The edit
  source is `MANUAL`; provenance is not encoded as a UC type.
- Command requires `DESIGNER` or `DIFF_MERGE`; handler owns transaction boundaries.
- Return HTTP 200 with the effective updated UC and ambient `groupId`.
- Reuse pure validation services from manual creation; do not introduce an Update mode
  into the 12-phase routing pipeline.
- Cover command/handler unit tests, repository and write-path integration tests, and API
  E2E tests, including rollback, missing IDs, invalid SGKV, invalid link endpoints,
  duplicate GKV, disconnected/isolated SG success, and idempotent replacement.

**Est. size:** ~1000–1500 lines including tests.

---

## Cross-cutting notes for writing-plans

**Boundary rules to enforce in every chapter:**
- `@arc/core` has zero framework imports (only `zod` + `uuid`).
- Row shapes (`field_path`/`new_value` on `edit_actions`) stay in adapters. Domain-verb repo methods only in `@arc/core`.
- CQRS: handlers own tx boundary. `Result<T>` for structured outcomes; exceptions only for infra failures.
- All routing writes: `source=AUTO_ROUTING`, `changeStatus=UNSTAGED`. SGKV persistence deferred to commit-time (FR-KV-COMMIT-01).

**Invariants for cross-chapter test coverage:**
- I1 (GKV uniqueness) — Phase 9 Classification (chapter 6).
- I2 (subgraph-pair completeness) — Phase 9 emit + Phase 11 assert (chapter 6, callout in chapter 10).
- I3 (GKV derivation) — Phase 9 Classification (chapter 6).
- I4 (no structural deletion for KV changes) — Phase 2 DeletionScope (chapter 3).
- I5 (orphan-free commit) — Phase 10 warning (chapter 6) + FR-COMMIT-01(c) blocking (chapter 10).
- I6 (SGKV internal consistency) — Phase 4 KvResolution (chapter 4).
- I7 (pair-link presence) — Phase 7 DFS (chapter 5) + Phase 2 DeletionScope (chapter 3) + FR-COMMIT-01 (chapter 10).

**Legacy test citation convention:** every test task in the plan should cite the
corresponding legacy test ID (e.g., "T2-020") in the task description so
implementation reviewers can verify legacy behavior preservation. See
`legacy-test-mapping.md` for the full mapping.

**Contradiction adaptation reminders for test tasks:**
| Legacy ID | Adaptation |
|---|---|
| T1-004, T2-014, T2-015 | Cycle → WARNING not blocking (C1) |
| T2-047 | Zero-KV prepend → FR-DUP-03(b1) identity-preserving interior extension silent auto-update, not new UC (C4) |
| T2-020 | Single-SG UCs → orphan warning + `ARC-ROUTING-ORPHAN-SG-HAS-KVS` hint, not auto-emitted UCs (Priority-1 resolution) |
| T2-038 | Bridge KV conflict → WARNING not blocking (FR-EC-04 updated) |

**Design decisions that need to surface as tasks in every affected chapter:**
- **FR-KV-02 markedForDeletion exclusion** (Chapter 4) — feeds Priority-1 semantics.
- **FR-EC-07 Rule A Bridge suppression** (Chapter 6 + Chapter 8) — Phase 9 dedup checks seed status + legacy coverage.
- **FR-EC-07 Rule B cross-EC reconstruction** (Chapter 3) — LLD4 §5.4.b narrow FR-CONE-01 check via shared `applyUcFilterToSg` helper.
- **FR-STATUS-02(b) auto-transition** (Chapter 3 populates, Chapter 6 emits) — `context.degradedToDisconnected` flow.
- **FR-API-06 SG exclusion** (Chapter 1 for handler input, Chapter 4 for effective-exclusion propagation) — LLD1 §3.1.
- **MDF Scenario 4 transparent bridge substitution** (Chapter 3) — LLD4 §5.1 transparent-bridge check.

---

## Open items surfaced but not blocking

- **2026-08-21 open decision — MANUAL UC staging policy (~2 weeks to resolve):**
  - **Question:** should manual UC creation produce STAGED rows (user accepts immediately) or UNSTAGED rows (user reviews multiple candidates first)? Requirements currently say STAGED (REQ-EA-05); counter-argument is that manual workflow may yield multiple candidates the user picks from — implying UNSTAGED with review.
  - **Interim (Chapter 01-02 and downstream reasoning):** treat MANUAL → **UNSTAGED**. Port surface is source-agnostic; resolution rule lives in `PendingChangeWriter` (framework infra) — one-line change to flip either way.
  - **Downstream impact if MANUAL stays UNSTAGED:** FR-COMMIT-01(d) integrity check must ALSO fire at stage-time (not only commit-time) for MANUAL UC rows — Chapter 10 (commit safety net) + stage/unstage LLD need to handle. Recorded.

- **Priority 5 items** (I2 concrete enforcement, I7 commit-time contract) are cited above in the chapter details. They must NOT be forgotten.
- **`Subgraph.isMdf` schema attribute** — LLD5 open question E1 assumes it exists; verify during Chapter 1 and add migration if needed.
- **T2-038 EC Bridge KV conflict semantics** — legacy blocks; our design warns. Confirm at plan review that FR-EC-04's updated non-blocking wording is correct for this codebase.
- **2026-08-18 design update — FR-LIFE-04, manual UC `referencedComponents`, FR-COMMIT-01(d):**
  - **Decision: no `MANUAL_UC` source value.** Manual UC creation uses `source = MANUAL` (same as graph edits). It is distinguished where needed via `target_table = 'UseCase' AND operation = 'CREATE'` — no separate enum value required.
  - PR 1 (Foundation): no source enum change needed (confirmed plan is correct as-is).
  - PR 2 (Scaffolding): `CreateUsecasesHandler.handle` includes a pre-step (right after chain-resolver) that deletes all session `edit_actions` where `source = AUTO_ROUTING`. `CreateManualUsecaseHandler` does NOT perform this wipe.
  - PR 7 (Manual UC flow): the manual UC edit-action payload includes a `referencedComponents: {sgSystemIds: number[]; dataLinkSystemIds: number[]; controlLinkSystemIds: number[]}` field populated at creation time. Source = `MANUAL` (same as graph edits).
  - PR 10 (Commit safety net): implement FR-COMMIT-01(d) — query `source = 'MANUAL' AND target_table = 'UseCase' AND operation = 'CREATE'` to find manual UC edit-actions; validate `referencedComponents` against post-commit graph; emit `ARC-COMMIT-MANUAL-UC-BROKEN-DEPS` blocking issue; autofix removes the flagged edit-action rows.

- **2026-08-19 design update — FR-DUP-04 same-GKV user-choice collision handling supersedes FR-DUP-01, FR-DUP-02, FR-DUP-TYPE-01:**
  - **Rule:** two silent branches remain (FR-DUP-03(a) exact-match no-op, FR-DUP-03(b1) identity-preserving interior extension silent auto-update). All other same-GKV collisions surface a blocking `ARC-ROUTING-SAME-GKV-CHOICE-REQUIRED` issue with FixOptions letting the user choose. Applies to all UC types (`Connected`/`Disconnected`/`EC`) per I1 unified GKV uniqueness rule — no type-based exemption. (Correction 2026-08-19: earlier draft made EC exempt; the exemption has been removed. EC UCs share the file-wide "one path per GKV" invariant.)
  - PR 6 (Half C — Phase 9 Classification): implement FR-DUP-03(a)/(b1) silent branches, FR-DUP-04 collision detection with fix-option emission, re-run recognition via `source=MANUAL` edit-action match by GKV+SG+pair, Phase 9 pre-check for stale MANUAL edit-actions emitting `ARC-ROUTING-MANUAL-UC-BROKEN-DEPS`, `ResolveSameGkvCollisionCommand` apply-fix handler (with `ARC-ROUTING-SAME-GKV-CHOICE-STALE` error path).
  - PR 10 (Commit safety net): FR-COMMIT-01(d) extended to cover `operation IN ('CREATE','UPDATE')` edit-actions (includes FR-DUP-04 UPDATE materializations from the `MERGE` (new vs existing DB UC) option). DELETE edit-actions (from `REPLACE_WITH_NEW`) are not subject to referentialComponents validation — a DELETE targeting an already-absent UC is silently a no-op.
  - Error namespace: retire `ARC-ROUTING-DUP-01` and `ARC-ROUTING-DUP-TYPE-01`; add `ARC-ROUTING-SAME-GKV-CHOICE-REQUIRED`, `ARC-ROUTING-SAME-GKV-CHOICE-STALE`, `ARC-ROUTING-MANUAL-UC-BROKEN-DEPS`.
  - LLDs: LLD4 §5.1/§5.4.b + LLD5 §7.1 cross-refs updated from FR-DUP-03(b) to FR-DUP-03(b1).

---

## Per-PR generation workflow (session-independent)

This feature is delivered as a sequence of eleven PRs, worked on one at a time. Plans are generated per-PR on demand (not all up front) so each session can pick up exactly where the last one stopped.

**Files involved:**

| File | Role |
|---|---|
| `auto-usecase-creator-plan-handoff.md` (this file) | Static master handoff — the 10-PR map. Doesn't change unless design changes. |
| `pr-progress.md` | Dynamic state tracker — which PRs are done, which are in progress. Consult first when resuming. |
| `pr-XX-<name>-handoff.md` | Mini-handoff for one PR, extracted from this file. Created just before generating that PR's plan. |
| `pr-XX-<name>.md` | The actual TDD implementation plan for one PR. Written by the writing-plans skill. |

**Per-PR agent workflow:**

1. Read `pr-progress.md` → identify next PR (call it PR N).
2. Extract Chapter N content from this master handoff (chapter details, LLD references, sub-tasks, size estimate, cross-cutting notes relevant to that PR).
3. Write `pr-NN-<name>-handoff.md` — a mini-handoff containing:
   - Only Chapter N's description
   - "Spec references" list (from this master)
   - Cross-cutting notes relevant to this PR (boundary rules, invariants owned by this chapter, legacy test citation reminders, contradiction adaptations for this PR's tests)
   - Batches section with a single batch containing just Chapter N
4. Invoke writing-plans skill: `"Use the writing-plans skill. Handoff file: docs/use-case-creator/plans/pr-NN-<name>-handoff.md"`.
5. Skill produces `pr-NN-<name>.md` — verbose TDD-structured plan (~30–50 tasks depending on chapter size).
6. Update `pr-progress.md`: status → `Plan generated`, plan-file link populated.
7. Present plan to the user for approval; pause for review or implementation start.

**Resume prompt for new sessions:**

Paste at the start of any session to resume work:

> Read `docs/use-case-creator/plans/pr-progress.md` and continue the next unfinished PR per the master handoff in the same folder.

The agent handles the rest.

**When a PR merges:**

Tell the agent: `"PR N merged, commit <sha>"`. Agent updates `pr-progress.md` with the commit SHA and merge date, marks the row `Merged`, and stops (waits for "continue next PR" before generating the next plan).
