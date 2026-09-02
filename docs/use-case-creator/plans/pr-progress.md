<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# PR Progress Tracker — Auto Use-Case Creator

**Master handoff:** [`auto-usecase-creator-plan-handoff.md`](./auto-usecase-creator-plan-handoff.md)
**Feature branch:** `use-case-creator` (or successor branches per PR)
**Started:** 2026-08-15

**Legend:**
- `Not started` — no plan file exists yet.
- `Plan generated` — writing-plans has produced the per-PR plan; awaiting user review or implementation start.
- `In progress` — implementation underway; per-PR plan file has partial completion.
- `Merged` — PR merged to feature branch; commit SHA recorded.

---

## Status

| PR | Chapter | Status | Plan file | Started | Merged | Commit |
|---|---|---|---|---|---|---|
| 1 | Foundation | Merged | `plans/chapters/01-01-entities-and-helper.md`, `01-02-usecase-repository.md`, `01-03-other-repositories.md` | 2026-08-15 | 2026-08-31 | `ffd51bc` |
| 2 | Scaffolding | Not started | — | — | — | — |
| 3 | Half A (Phases 1–3) | Not started | — | — | — | — |
| 4 | Half B pt.1 — KV + Cone (Phases 4–6) | Not started | — | — | — | — |
| 5 | Half B pt.2 — DFS + Combination (Phases 7–8) | Not started | — | — | — | — |
| 6 | Half C (Phases 9–12) — First end-to-end auto routing | Not started | — | — | — | — |
| 7 | Manual UC flow | Not started | — | — | — | — |
| 8 | EC routing (LLD5) | Not started | — | — | — | — |
| 9 | MDF single-rule (FR-MDF-01) | Not started | — | — | — | — |
| 10 | Commit safety net + legacy tests | Not started | — | — | — | — |
| 11 | Structural UC replacement API | Not started | — | — | — | — |

---

## Dependency graph

```
PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6
                                      ├→ PR 7 ─┐
                                      ├→ PR 8 ─┤
                                      └→ PR 9 ─┴→ PR 10 → PR 11
```

PRs 7, 8, 9 can be worked on in parallel after PR 6 lands (but per the user's workflow, they will still be done one at a time). PR 10 gates on all three.
PR 11 depends on PR 7's reusable manual GKV validation and PR 10's commit safety net.

---

## Session log

- **2026-08-15** — Master handoff + progress tracker created. Awaiting PR 1 plan generation.
- **2026-08-15** — PR 1 plan generated (3 chapter files, Tasks 1–25). Awaiting user review.
- **2026-08-18** — **Design update:** new FR-LIFE-04 (wipe AUTO_ROUTING at start of every `create-usecases` call); manual UC edit-actions use `source = MANUAL` (no separate MANUAL_UC enum value — distinguished via `target_table='UseCase' AND operation='CREATE'`); new FR-COMMIT-01(d) (manual UC referential integrity via `referencedComponents` payload; blocking `ARC-COMMIT-MANUAL-UC-BROKEN-DEPS` at commit, autofix removes manual UC edit-actions). No edit-time cross-handler checks. **Impact:** PR 2 (Scaffolding) handler must include the AUTO_ROUTING wipe pre-step; PR 7 (Manual UC flow) must populate `referencedComponents` with source=MANUAL; PR 10 (Commit safety net) must implement FR-COMMIT-01(d) querying `source=MANUAL AND target_table=UseCase AND operation=CREATE`.
- **2026-08-19** — **PR 1 amendment for FR-DUP-04 support:** independent Sonnet review flagged one compile-breaking gap (missing `IUsecaseRepository.findByGkv`) and two shape improvements (extend `EditOptions.referencedComponents`, add `IUsecaseRepository.findManualEditsSinceLastRouting` for parity). All three applied to chapter 01-02: (a) new Task 9 Step 0 extends `EditOptions`; (b) Task 9 port grows from 8 to 10 methods; (c) new Task 13a implements `findByGkv` with GKV order-insensitive equality; (d) new Task 17a implements `findManualEditsSinceLastRouting` on `IUsecaseRepository`. Master handoff Chapter 1 section updated. PR 1 status remains "Plan generated"; user to review updated chapter files before starting implementation.
- **2026-08-19** — **PR 1 alignment audit (independent Sonnet reviewer):** identified 5 P1 gaps and 3 P2 gaps against the current requirements/LLDs after the FR-DUP-04 EC-exemption correction. All fixed in the same session:
  - P1-1: added `IUsecaseRepository.findBySystemId` (LLD4 §5.4) and `IUsecaseRepository.findBySystemIds` (LLD1 §6.2). Added `ISubgraphRepository.findByIds` (LLD1 §5.1 FR-PREVAL-01). New Task 10a in chapter 01-02 implements findBySystemId/findBySystemIds. New Task 17a in chapter 01-03 implements findByIds.
  - P1-2: added optional `excludedIds` parameter to `DataLinkRepository.findLinksByPair`, `DataLinkRepository.findIntraUsecaseByFile`, `ControlLinkRepository.findLinksByPair`, `ControlLinkRepository.findIntraUsecaseByFile` (LLD4 §3 contract).
  - P1-3: **rewrote `UcFilter` and `applyUcFilterToSg` semantics**. Old design used systemId-based Sgkv exclusion; correct design (per LLD1 §6.2 FR-KV-02 and LLD4 §5.4.b) uses `Map<KeyDefSystemId, Set<ValueDefSystemId>>` filter with `(keyDef, valueDef)` pair-membership retention. Helper now accepts a `valueDefToKeyDef` lookup callback. Tests fully rewritten. New signature: `applyUcFilterToSg(fileSystemId, sgSystemId, ucFilter, valueDefToKeyDef, source)`.
  - P1-4/5/6: aligned LLD arg-orders to codebase convention (`fileSystemId` first). Updated LLD1 pseudocode (`getSgkvsBySgIds`, `findIsMdfInScope`, `findByIds`, `findBySystemIds`) and LLD5 §7.1 (`findByGkv`) to match the port declarations in chapters 01-02/01-03.
  - P2-7: `findLegacyEcUcsContainingPair` filter semantics changed from pair-set membership to SG-set membership + `type=EC` + `SG count > 2`. Adapter SQL and tests updated in chapter 01-02 Task 13.
  - P2-8/9: added cantor-pairing contract note and `fieldGroup → field_path` mapping note to chapter 01-02 preface for downstream implementer clarity.
  - P3: fixed test describe reference "LLD5 open question E1" → "LLD5 §7 EC bridge + isMdf".
  Port method counts: `IUsecaseRepository` grew from 10 → 12 methods; `SubgraphRepository` grew from 3 → 4 methods. `EditOptions.referencedComponents` unchanged. No new tasks in chapter 01-01. PR 1 status remains "Plan generated"; user to review updated chapter files before starting implementation.
- **2026-08-21** — **PR 1 chapter 01-01 and 01-03 design corrections (user review):**
  1. Task 2 (UsecaseType): removed standalone test spec; key stays `Ec` (legacy key preserved); no call-site patches needed.
  2. Task 4 (Subgraph.isMdf): **REMOVED** — not a domain concept. `findIsMdfInScope` computes MDF from module composition (IPC_TX `0x7001184` + IPC_RX `0x7001185`, exactly 2 modules). No entity change, no migration column.
  3. Task 5: migration scope narrowed to UsecaseType CHECK constraint only.
  4. Folder: `routing` → `auto-usecase-creator` in all paths.
  5. **`getSgkvsBySgIds` → `getSgkvs` with `SgkvEntry` query model**: `SgkvEntry {sgSystemId, sgkvSystemId, keyValues: [{keyDefSystemId, valueDefSystemId}]}` defined in `kv-filter.ts`. Adapter joins `sgkv → sgkv_values → value_definitions`. No separate `ValueDefToKeyDef` callback. `applyUcFilterToSg` simplified to 4 params.
  6. `findIsMdfInScope` test and implementation updated: queries `spf_modules JOIN spf_module_definitions` instead of `is_mdf` column.
  PR 1 status: "Plan generated" (updated). All 3 chapter files updated.
- **2026-08-21** — **PR 1 chapter 01-02 — architectural rewrite (user review, points 1/2/3):**
  1. **Point 1 — Read methods collapsed (CQRS write-side hygiene).** Dropped 6 read methods (`findByStatus`, `findBySystemId`, `findByContainingSg`, `findByContainingLink`, `findLegacyEcUcsContainingPair`, `findByGkv`). Kept 3 (`findBySystemIds`, `findAll`, `findWithActiveManualEdits`). Reverse lookups are performed by routing as in-memory filters over `context.allUcs` (populated at Phase 2 via `findAll(readMode=Committed)`). LLD1 §, LLD4 §5, and LLD5 §7.1 pseudocode updated to reflect the new in-memory-filter pattern.
  2. **Point 2 — `readMode` explicit for pre-session reads (Lever B).** Added `READ_MODE` object literal (`Overlay | Committed`) and `ReadMode` type in the port file. `findBySystemIds` and `findAll` accept `{readMode?: ReadMode}` (default `Overlay`). Phase 2 impact detection uses `READ_MODE.Committed` to see pre-session base-table state — necessary because delete-crud handlers cascade to UC junctions (existing contract), so overlay reads would hide impacted UCs. Overlay stays self-consistent for all other consumers (including the query-side API pipeline).
  3. **Point 3 — Write methods per operation (Option D).** Dropped `update(uc, patch)` and `UsecaseFields`. Replaced with per-verb methods: `applyStructuralChange(uc, delta, options?, referencedComponents?)` handles atomic multi-row mutations (SG set + pair set + optional type + optional un-mark from deletion), `changeType(uc, newType, options?)` handles type-only mutations, `reverseDirection(uc, currentSourceSg, currentDestSg, options?)` handles FR-STATUS-04 Step 1 pair reversal (always a flip; no `newDirection` param). `StructuralDelta` type defined in port file. `alias`/`aliasId` fields are no longer on any repo method — those are user-facing labels updated through dedicated handlers, not routing's concern.
  4. **Chapter 01-02 rewritten wholesale.** Nine tasks (Task 9 scaffold + Tasks 10-17 per-method implementations). Overall-design §6 ports table + IUsecaseRepository interface signature updated. LLD1, LLD4 §5, LLD5 §7.1 updated to use in-memory filters over `context.allUcs`. Plan handoff Chapter 1 section + pr-01-foundation-handoff.md IUsecaseRepository section updated.
  5. **Follow-up renames (same session):** `Pair` → `SubgraphPair` (interface-only rename; `UseCaseSubgraphPair` entity name unchanged). `PairDirection` type removed (dead code — direction is encoded via source/dest field order in the emitted `new_value`, not via an `AB`/`BA` discriminator). `findAllInFile` → `findAll`. `findManualEditsSinceLastRouting` → `findWithActiveManualEdits` (UsecaseRepository only; sibling repos keep the old name because their semantic is diff-since-last-routing for graphEdits, not a Phase 9 pre-check). Fixed prior error: MANUAL edits resolve to `changeStatus=STAGED` per REQ-EA-05 (not UNSTAGED); the port query filters only by `source='MANUAL' AND valid_until IS NULL`. Converted raw SQL in `findWithActiveManualEdits` to TypeORM QueryBuilder for consistency with sibling repos.
  6. **Interim MANUAL staging policy (2-week open decision).** Requirements say manual UC creation should always be STAGED, but there's a counter-argument: manual workflow may yield multiple candidates (FR-DUP-04-style collision) that the user picks from — implying UNSTAGED with user review. Decision pending in ~2 weeks. **Interim:** treat MANUAL → **UNSTAGED** in Chapter 01-02 tests and downstream reasoning. Impact is minimal because the port surface is source-agnostic — resolution rule lives in `PendingChangeWriter` (framework infra, one-line change either way). Chapter 01-02 preface Design Note + interface JSDoc + Task 12 seedUcEditAction test seeds updated to reflect interim UNSTAGED. **Downstream flag recorded:** if MANUAL stays UNSTAGED, FR-COMMIT-01(d) must ALSO fire at stage-time (not only commit-time) for MANUAL UC rows — Chapter 10 + stage/unstage LLD to handle.
  7. **Edit-crud framework alignment note (`docs/edit-crud/overall-design.md`).** Reviewed future edit-crud design. Chapter 01-02 is **directionally aligned** but has three structural gaps that we're intentionally deferring to when edit-crud LLD1 lands: (a) AUTO_ROUTING writes should be per-slot `fieldPath` (scalar column name) rather than accumulator/delta shape — routing produces independently-selectable rows per §7 table; (b) `referencedComponents` should be its own `fieldPath="referencedComponents"` row rather than merged into base CREATE/UPDATE payload — decouples FR-COMMIT-01(d) reader from base-row shape; (c) `readMode` is a routing-invented concept not yet in the edit-crud framework — extending here pragmatically, may migrate to framework-level API later. Port SURFACE (`create`, `applyStructuralChange`, etc.) is unaffected — adapter internals migrate when edit-crud table reshape lands. Also confirmed: routing's input path stays `graphEdits` (domain-typed `{addedSgs, deletedSgs, ...}` from sibling repos) — NOT the generic `diffEntity` from edit-crud §12, which is the wrong abstraction level for seed detection (adds a translation layer without adding information; deletions require a special path either way because overlay hides deleted entities).
  8. **Chapter 01-03 raw SQL → TypeORM QueryBuilder conversion.** Converted all 10 `manager.query(...)` raw-SQL blocks in Chapter 01-03 to TypeORM QueryBuilder for consistency with Chapter 01-02 (`findWithActiveManualEdits`), sibling-repo convention, dialect portability, and type safety. Performance is neutral — QueryBuilder generates equivalent SQL. Categories: 5 simple SELECTs (`findByIds` × 1, `findIntraUsecaseByFile` × 2, `findLinksByPair` × 2), 3 JOIN queries (`findManualEditsSinceLastRouting` × 3), 1 LEFT JOIN aggregation (`getSgkvs`), 1 with subqueries + EXISTS (`findIsMdfInScope` — uses QueryBuilder's raw SQL fragments in `.andWhere()` for the subquery and EXISTS clauses). **Note on sibling `findManualEditsSinceLastRouting` methods:** these still filter `change_status='UNSTAGED'` — needs review if MANUAL staging policy changes (see item 6). Filter is on MANUAL-source graph-edit rows (SG/DataLink/ControlLink CREATE/DELETE) which are a different domain from MANUAL UC edits; the UNSTAGED-only filter may still be correct for graph edits even if MANUAL UC becomes STAGED. Flagged for confirmation at ~2-week decision point.
- **2026-08-31** — **PR 1 merged to main.** Foundation implementation landed in `290a9b2`; relationship-target and structural-type fixes landed in final commit `ffd51bc`. The PR 2 branch was rebased onto this completed state.
- **2026-09-01** — **New structural-update and direct-commit requirements:** added FR-UC-UPDATE-01 for a separate `PUT /usecases/:usecaseSystemId/structure` endpoint (single explicit SGKV per SG, exact data-link IDs, disconnected structures allowed, duplicate GKV returns 409, updated UC + groupId response). Added FR-COMMIT-01(b2): state-based re-validation of existing UCs affected by staged SG/link deletions; stale UCs block commit with `ARC-COMMIT-ROUTING-REQUIRED` and direct the client to run `create-usecases`. Added PR 11 to the implementation roadmap. The original decisions to keep its contract entirely outside PR 2 and to encode manual provenance as a UC type were superseded on 2026-09-02.
- **2026-09-01** — **PR 2 endpoint safety decision:** commands, handlers, engine, phase stubs, DTOs, Swagger contracts, registry entries, and tests land in PR 2, but both HTTP methods remain 501 while phases are no-ops. Auto dispatch activates in PR 6 and manual dispatch in PR 7, preventing scaffold calls from resolving chains or deleting prior AUTO_ROUTING output while returning a misleading empty 200.
- **2026-09-02** — **Structural-update contract sequencing:** PR 2 now also publishes the core-Zod request/response schemas, API DTO wrappers, detailed Swagger contract, and HTTP 501 stub for `PUT /usecases/:usecaseSystemId/structure`. The response nests the public UC snapshot under `usecase`, keeps `groupId` as operation metadata, and omits internal `usecaseType`. PR 11 remains responsible for command, handler, validation, persistence, and endpoint activation.

---

## Resume protocol (for any new session)

Paste this at session start:

> "Read `docs/use-case-creator/plans/pr-progress.md` and continue the next unfinished PR per the master handoff in the same folder."

The agent will:
1. Read this file → identify the next PR (first row with status ≠ `Merged`).
2. Branch on status:
   - **`Not started`** → extract chapter content from master handoff → write `pr-NN-<name>-handoff.md` → invoke writing-plans skill → produce `pr-NN-<name>.md` → update this tracker to `Plan generated` → pause for your review.
   - **`Plan generated`** → offer to start implementation (or accept edits to plan first).
   - **`In progress`** → read the plan file's checkbox state → resume at the next unchecked task.
3. When you confirm a PR merged with `"PR N merged, commit <sha>"`, agent updates this tracker: status→`Merged`, dates + commit recorded. Stops; waits for your "continue next PR."

---

## Notes across PRs

*Populated as each PR completes. Use this section to record cross-cutting decisions or deviations made during implementation that might affect subsequent PRs.*

- **PR 1:** Foundation is available from final commit `ffd51bc` (`290a9b2` implementation plus the follow-up fix). PR 2 can build directly on the repository ports, routing KV helper, entity/schema changes, and integration coverage now present on main.
