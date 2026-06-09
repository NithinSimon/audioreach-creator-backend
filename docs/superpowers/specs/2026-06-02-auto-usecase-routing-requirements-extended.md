<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Auto-Usecase Routing: Extended Requirements

**Date:** 2026-06-02
**Status:** Draft — all contradictions resolved, pending user review
**Owner:** Nithin Simon
**Source docs:** `docs/subgraph-kv-usecase-creation/subgraph-routing-requirements.md`,
`docs/subgraph-kv-usecase-creation/subgraph-routing-lld.md`

**Core requirements:** `docs/superpowers/specs/2026-06-01-auto-usecase-routing-requirements.md`

---

## Purpose

This document extends the frozen core requirements. It captures requirements found in
the source docs that are either:
- **New** — not addressed in core requirements at all (added here as extension FRs)
- **Contradicting** — directly conflicting with a core requirement (all 5 resolved in §10)

Requirements already fully captured in core requirements are omitted (see §11).

---

## 1. EC (Echo Cancellation) Routing

*Deferred in core reqs (Out of Scope). Captured here as the follow-on spec.*

### 1.1 EC Connection Detection

#### FR-EC-01: EC connection identification
The system shall identify intra-usecase data links with `isEc = true` as EC
connections. The `isEc` property already exists on the `DataLink` entity in the DB
schema (`is_ec` column, nullable — set only on `intra_usecase` links). An EC connection
is a distinct link type that triggers special 3-usecase generation (FR-EC-03) rather
than normal DFS continuation.

#### FR-EC-02: EC connection as path boundary
When the DFS traversal encounters an EC connection, it shall treat that connection as a
path boundary: the current path terminates at the left-side SG of the EC connection
(emitting a Left UC candidate even though that SG is not a leaf in the graph), and a
separate EC-specific emission is triggered (FR-EC-03).

*This is an explicit exception to FR-DFS-03's leaf-only emission rule: EC boundaries
trigger intermediate emission. FR-DFS-03 governs all non-EC paths; FR-EC-02 overrides
it at EC connection points.*

### 1.2 Three-Usecase Generation

#### FR-EC-03: Exactly three UCs per EC connection
For each valid EC connection encountered during routing, the system shall generate
exactly three usecases:
- **Left UC (Rx path):** The path from the root subgraph to the subgraph on the left
  side of the EC connection (inclusive).
- **Right UC (Tx path):** The path from the subgraph on the right side of the EC
  connection (inclusive) to the path's leaf subgraph.
- **Bridge UC:** A two-node path containing only the immediate left and right subgraphs
  of the EC connection.

#### FR-EC-04: Bridge UC KV compatibility requirement
A Bridge UC shall only be created if the KV combinations of the left and right
subgraphs are compatible (no Key conflict per FR-DFS-06 of core reqs). If the left
and right subgraphs have conflicting KVs, the EC connection produces no valid Bridge
UC. This is a routing-level error (user resolves by adjusting SGKV assignments on the
conflicting subgraphs, same as FR-DFS-08 of core reqs) — it does not indicate a
broken topology.

#### FR-EC-05: Single EC connection per path
A routing path must contain at most one EC connection. If the DFS traversal encounters
a second EC connection on the same path, the system shall return an error identifying
the path and both EC connections. Multiple EC connections on a single path are not
valid.

### 1.3 EC Usecase Lifecycle

#### FR-EC-06: EC bridge usecase mutation on topology change
When graph changes are evaluated against existing EC bridge UCs:
- If the immediate left and right subgraphs still exist AND the EC connection link
  still exists AND the GKV is unchanged → mark as **UNCHANGED**.
- If the GKV changed but topology is intact → per FR-LIFE-01 (core), the existing EC
  bridge UC is **preserved**. The routing session creates a new EC bridge UC with the
  updated GKV. Both UCs coexist.
- If the left or right subgraph is deleted, or the EC connection link is deleted →
  mark as **DELETED**.

When an EC bridge UC is DELETED due to structural component deletion, it follows the
same deletion workflow as any UC (core reqs FR-DEL-01 through FR-DEL-05): all UCs
containing the deleted component are identified, impacted UCs must be selected by the
user, and the user may choose to preserve the UC as Disconnected (FR-DEL-05).

---

## 2. MDF V2 — Implicit Intermediate Subgraph Support

*Deferred in core reqs (Out of Scope). Captured here as the follow-on spec.*

MDF bridge subgraphs already exist in the DB as real subgraphs. The routing algorithm
traverses paths like `SG_A → MDF_Bridge_SG → SG_C` naturally. The core routing
requirements handle all traversal and pair derivation. The only additional requirement
is how the system treats an `IsMdf = true` subgraph when it appears in a path.

#### FR-MDF-01: IsMdf subgraph attribute and routing behavior
The Subgraph entity shall have a boolean attribute `IsMdf`. When `IsMdf = true` for a
subgraph:

- **Pass-through:** The subgraph contributes one empty SGKV instance (no KV pairs) to
  all routing paths through it. It does not affect the path's GKV. In the SGKV
  combination expansion (FR-DFS-05 of core reqs), the MDF slot has exactly one choice
  (the empty instance) and therefore does not multiply the number of UC candidates —
  the total combination count equals the product of only the non-MDF SGs' instance
  counts.
- **API map exempt:** The subgraph is exempt from the mandatory API map rule (FR-API-03)
  and the scope boundary rule (FR-CONE-07) of core reqs. It participates in routing
  paths automatically without requiring a user-provided entry in the API's SG map.
- **No KVs allowed:** If the API input provides any SGKV instances for an IsMdf
  subgraph, the system shall return an error. Users must not assign KVs to MDF
  subgraphs (they are typically hidden in the UI for this reason).

*The mechanism for detecting and setting `IsMdf` (e.g., based on the presence of
IPC Tx and IPC Rx modules within the subgraph) is deferred to the MDF V2 feature
implementation. At that point, FR-API-03 and FR-CONE-07 in core requirements will be
formally updated to document this exception.*

---

## 3. Deletion Scenario Extension

*Extends core reqs §3.9 (FR-DEL-01 through FR-DEL-05).*

#### FR-DEL-06: Endpoint-anchored path reconstruction pass
After the main DFS (FR-DEL-04 of core reqs) completes, the system shall perform an
additional reconstruction pass for each UC marked for deletion:

1. Extract the deleted UC's **start SG** (root of its subgraph path) and **end SG**
   (leaf of its subgraph path).
2. If both start and end SGs are still present in the graph (neither was deleted as
   a component): run a bounded DFS from the start SG to the end SG, treating the end
   SG as a forced leaf boundary within this scoped pass.
3. The bounded DFS uses the same API map KVs already provided (mandatory via
   FR-DEL-02 and FR-API-03 of core reqs). No new API input is required.
4. FR-DFS-05 (Cartesian product expansion) and FR-DFS-06 (conflict detection) of
   core reqs apply. Combinations where new SGs' KVs conflict with a required
   combination are silently discarded.
5. Paths discovered in this pass produce additional unstaged UC candidates. FR-DUP-03
   deduplication against main DFS results applies — paths already created by the main
   DFS are not duplicated.
6. If start or end SG was deleted, skip the reconstruction for that UC.

*This enables the system to detect path transformations (e.g., `A→B` becoming
`A→X→B`) in the same API call, without requiring a second user-initiated call.*

*KV conflict limitation:* If the new SG's KVs conflict with a specific old combination,
that reconstruction is discarded (FR-DFS-06). The routing response (FR-IMPACT-03)
shall report which deleted UC GKVs could not be reconstructed. The user may then add
additional SGKV instances to the new SG and re-call the API.

---

## 4. Additional Pre-Validation Rules

*Core reqs have FR-API-03 (cone completeness). The following adds checks that run
before DFS begins.*

#### FR-PREVAL-01: Data link integrity check
Before routing begins, the system shall verify that all intra-usecase data links in the
routing scope reference subgraphs that exist in the DB. A data link pointing to a
non-existent subgraph is a pre-validation ERROR. Routing shall not proceed until the
integrity error is resolved.

#### FR-PREVAL-02: Disconnected subgraph island detection
Before routing begins, the system shall detect subgraphs in the routing scope that
have no intra-usecase data links to any other subgraph in the scope (isolated
subgraphs, or "islands"). Islands shall be reported as a **WARNING**. Routing shall
continue despite this warning. Island subgraphs will subsequently be evaluated by the
orphan check (FR-VAL-01 of core reqs): if an island SG is not a member of any UC
after routing, the system will flag it as an orphan and present the user with the
delete-or-continue-editing option.

---

## 5. Commit Re-Validation

*Core reqs have I5 (orphan-free commit gate). The following adds path re-validation.*

#### FR-COMMIT-01: Path re-validation at commit
Before committing staged changes, the system shall re-validate every **newly created
staged UC** (not existing committed UCs, which are governed by FR-LIFE-01 of core
reqs):
- All subgraphs in the UC's subgraph set must still exist in the DB.
- All subgraph pairs in the UC's pair set must have at least one corresponding
  intra-usecase link still present in the DB.
- If any staged UC fails re-validation, the commit shall be rejected with an error
  identifying the failing UCs.

*Scope clarification:* This check applies only to staged UCs created in the current
edit session. It does not modify or validate existing committed UCs (FR-LIFE-01). It
catches the case where a structural change occurred between the routing call and the
commit call, breaking a newly staged UC's path.

---

## 6. New Workflows Identified

These workflows are implied by the extended requirements but not explicitly described
in the core requirements. They need to be validated and potentially reflected in the
API design phase.

### W3: EC Connection Routing Trigger
When a user adds an EC connection link (`isEc = true`) between two subgraph domains,
the next `create-usecases` call detects it (FR-EC-01) and generates 3 UCs (Left,
Bridge, Right) instead of a single through-path (FR-EC-03). The user stages the 3 UCs.
Future routing sessions that include those subgraphs treat the EC connection as a path
boundary (FR-EC-02).

### W4: MDF V2 Path Traversal
MDF bridge subgraphs (`IsMdf = true`) already exist in the DB. When routing traverses
a path that includes an MDF bridge SG, it is treated as pass-through — no KV
contribution, no API map entry required (FR-MDF-01). The user does not need to
explicitly include or assign KVs to MDF bridge SGs; the system handles them
transparently.

---

## 7. Contradiction Resolutions

All five contradictions identified during this exercise have been resolved in favour of
the frozen core requirements or through explicit user decisions.

### C-01: GKV Change — RESOLVED (core req correct)
**Resolution:** FR-LIFE-01 applies. When KVs change, the existing UC is **preserved**
alongside the newly created UC. The old UC remains as a historical record.

### C-02: Orphan Intra-Usecase Links — RESOLVED (core req correct)
**Resolution:** FR-VAL-03 applies. Orphan intra-usecase links are an **ERROR**. The
user-facing workflow follows FR-VAL-01: report orphans, offer delete-or-continue.

### C-03: Duplicate Disjoint GKV — RESOLVED (core req correct)
**Resolution:** FR-DUP-01 applies. Two fully disjoint paths with the same GKV are a
**duplicate GKV error**. The LLD's "valid parallel paths" interpretation is superseded.

### C-04: Disconnected UC Deletion Behavior — RESOLVED (core req correct)
**Resolution:** FR-DEL-01 through FR-DEL-05 apply to ALL UCs regardless of type.
A Disconnected UC containing a deleted component follows the same deletion workflow.
The user may choose to preserve it as Disconnected (FR-DEL-05).

### C-05: MDF Implicit Injection — RESOLVED (FR-MDF-01 exemption)
**Resolution:** MDF subgraphs (`IsMdf = true`) are exempt from FR-API-03 and
FR-CONE-07. They are pass-through nodes already present in the DB — DFS traverses
them naturally with no injection needed. Providing KVs for an IsMdf subgraph is an
error. See FR-MDF-01. FR-API-03 and FR-CONE-07 will be formally updated when MDF V2
is implemented.

---

## 8. Already Captured in Core Requirements (Skipped)

| Source Doc Topic | Core Requirement |
|---|---|
| DFS traversal from root SGs to leaves | FR-DFS-01 through FR-DFS-04 |
| UC-filtered KV selection (pair-level) | FR-KV-01, FR-KV-02 |
| Cartesian product / multi-KV expansion | FR-DFS-05 |
| KV conflict detection and pruning | FR-DFS-06, FR-DFS-07, FR-DFS-08 |
| Empty GKV path rejection | FR-DFS-09 |
| Duplicate GKV — overlapping paths merge | FR-DUP-02 |
| Duplicate GKV — disjoint paths error | FR-DUP-01 |
| Orphan SG detection and resolution | FR-VAL-01 |
| Orphan subsystem detection | FR-VAL-02 |
| Deletion scenario (all modes) | FR-DEL-01 through FR-DEL-05 |
| Cone computation (bidirectional) | FR-CONE-04 |
| Seed identification | FR-CONE-01 through FR-CONE-06 |
| Stage/reject workflow | FR-STAGE-01, FR-EXT-03 |
| New UCs start unstaged | FR-LIFE-02 |
| Commit orphan-free gate | I5 |
| Connected/Disconnected UC status | FR-STATUS-01 through FR-STATUS-03 |
| Cycle detection → warning | FR-DFS-04 |
| Single-SG UC from leaf with KVs | FR-DFS-03, FR-DEL-04 |
| Cross-usecase links not traversed | FR-DFS-02 |
| Control links for Disconnected UC pair derivation | FR-UC-01 step 4, FR-API-04 |
| Disconnected UC cannot transition to Connected | Disconnected status is permanent (FR-STATUS-02/03); new links create NEW Connected UCs |
| KV-only changes preserve existing UCs | FR-LIFE-01 |
| Existing UC deletion only via structural change | FR-DEL-01 through FR-DEL-05 |
| End-to-end only in single routing pass | FR-DFS-03 (emit at leaf) |
| Sub-path UC lifecycle (preservation/deletion) | FR-LIFE-01, FR-DEL-01 through FR-DEL-05 |
