<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Auto-Usecase Routing: Requirements

**Date:** 2026-06-01  
**Status:** Frozen  
**Owner:** Nithin Simon

---

## 1. Context

### 1.1 Problem Statement

Manually creating usecases is error-prone and time-consuming when the graph has many
subgraphs with complex connectivity. Users need a way to automatically discover all valid
audio-processing paths (usecases) from a Subgraph graph using a DFS-based routing
algorithm, with the discovered usecases identified by a canonical key-value identifier
(GKV).

### 1.2 What This Builds On

- **UseCase + SubgraphPair schema redesign** (`2026-05-18-usecase-subgraph-schema-redesign.md`):
  A UseCase is a set of Subgraphs + a set of directed subgraph pairs
  (`use_case_subgraph_pairs`). This is the write target for the routing algorithm.
- **SGKV design** (`2026-05-29-sgkv-design.md`): Each Subgraph has zero or more
  SGKV records (`sgkv` table). Each SGKV is a set of ValueDefinition references.
  SGKVs are the source of per-subgraph KV data for the routing algorithm.
- **Edit-session / edit_actions framework**: Pending KV changes (staged or unstaged) are
  tracked in `edit_actions`. The routing algorithm reads these as overlays during the
  session.

### 1.3 Key Decisions Already Made

- Usecase identity = GKV (the union of all KV pairs contributed by each SG in the path).
- The algorithm only **creates** new UCs. It does not delete UCs unless a structural
  component (SG or intra-usecase link) is deleted.
- KV writes to DB (SGKV table) are **additive-only** at commit time; cleanup of
  unreferenced KVs is deferred to download-file time.

---

## 2. Definitions

| Term | Definition |
|------|------------|
| **Subgraph (SG)** | Routing node; logical container of modules. The atomic unit of path construction. |
| **SGKV** | A named set of ValueDefinitions attached to a Subgraph. One SG can have zero or more SGKVs. Source of per-SG KV data. |
| **KV** | A single (Key, Value) pair — i.e., one `ValueDefinition` reference. |
| **KV list** | The set of KV pairs belonging to one SGKV instance. Each Key appears at most once per KV list (enforced by I6). |
| **GKV** | Graph Key-Vector. An unordered set of (Key, Value) pairs where each Key appears exactly once. Derived from one valid SGKV combination across all SGs in a path. Uniquely identifies a UC. |
| **SGKV combination** | An assignment of exactly one SGKV instance per SG in a path. A combination is valid if no Key appears with two different Values across the assigned instances. Each valid combination produces exactly one UC candidate. |
| **UC** | UseCase. A record in `use_cases` consisting of: a GKV, a set of SGs, a set of directed SG pairs, and a connectivity status (Connected or Disconnected). |
| **UC filter** | A map of `Key → Set<Value>` derived from the selected usecases. Used to strip irrelevant KV pairs from SG SGKV data before routing. |
| **Intra-usecase link** | A data link between two different SGs that are both members of the same UC (`link_scope = intra_usecase`). Traversable by the routing algorithm. |
| **Inter-usecase link** | A data link between SGs that belong to different UCs (`link_scope = inter_usecase`). Not traversed by the routing algorithm. |
| **Seed SG** | A SG whose API-input SGKV instances differ from its UC-filtered DB SGKV instances, or which is newly added to the graph, or which has a new or deleted intra-usecase link. Starting point for bidirectional cone identification. |
| **Cone** | The set of SGs reachable from any seed SG via both forward traversal (following intra-usecase link direction) and reverse traversal (against link direction), bounded by the routing scope (FR-CONE-07). Defines which paths the DFS re-evaluates in this session. |
| **Staged / Unstaged** | Edit-session states. New UCs begin as Unstaged. User explicitly stages them before commit. Unstaged UCs are discarded when the edit session ends without a commit. |
| **Connected** | UC status: all SG pairs in the UC have corresponding intra-usecase links present in the graph. |
| **Disconnected** | UC status: one or more SG pairs in the UC no longer have intra-usecase links (e.g., a link was deleted and the user chose to preserve the UC). |
| **Orphan SG** | A SG that is not a member of any UC (Connected, Disconnected, or newly staged). Orphan SGs are an error condition. |
| **Orphan subsystem** | A subsystem that contains no SG that is a member of any valid UC. |

---

## 3. Functional Requirements

### 3.1 Usecase Creation Modes

#### FR-UC-01: Manual UC creation
When a user explicitly selects a set of SGs and links and requests UC creation, the
system shall:
1. Apply the same 3-step KV resolution pipeline (FR-KV-01–03) using the provided
   SG→KV map and selected UCs.
2. Apply the same SGKV combination expansion (FR-DFS-05) and conflict detection
   (FR-DFS-06–09) on the user-provided SG set.
3. Create one UC per valid SGKV combination found across the selected SGs.
4. Derive the UC's subgraph-pair set as follows:
   - **Primary:** Extract `(source_sg, dest_sg)` pairs from every intra-usecase
     **data link** provided in the API input (FR-API-04).
   - **Control link exception:** For any SG in the selected set that has no
     intra-usecase data links to any other SG in the UC, intra-usecase **control
     links** provided in the API input may also be used to derive pairs for that SG.
   - Record unique pairs in `use_case_subgraph_pairs`. Every `intra_usecase` link in
     DB whose `(source_sg, dest_sg)` matches a declared pair is automatically part of
     the UC — no per-link explicit assignment is needed.

Manual mode skips DFS path discovery — the user supplies the SGs and links directly,
and the system derives the UC's pair set from those links. Everything from SG-set-known
onward (KV resolution, combination expansion, validation) is identical to auto-routing.

#### FR-UC-02: Auto-routing UC creation
When a user provides an SG→KV map and a set of selected UCs and requests auto-routing,
the system shall run the DFS-based routing algorithm (§3.3) to discover all valid paths,
compute GKVs, and create new UCs for each unique valid path.

---

### 3.2 CreateUCs API Input

#### FR-API-01: SG→SGKV-instances map
The API input shall include a map from SG system-ID to an ordered list of zero or more
SGKV instances. Each SGKV instance is a flat KV list (zero or more (Key, Value) pairs;
each Key appears at most once per instance per I6). A SG mapped to an empty list is
valid and means that SG contributes one empty SGKV instance to routing (no KV pairs
contributed to any path's GKV).

#### FR-API-02: Selected usecase list
The API input shall include a list of existing UC system-IDs that represent the user's
active session context. This list is used to build the UC filter (§3.2) and to determine
which existing UC data to load from DB.

#### FR-API-03: Cone completeness pre-validation
After computing the cone (§3.4), the system shall verify that every SG in the cone is
present in the API's SG map. If any cone SG is absent, the system shall return a
pre-validation error listing the missing SGs. The caller must re-invoke the API with
those SGs included (with KVs or `[]`). This rule applies in all scenarios — there are
no exceptions and no DB fallback.

*Rationale:* The system never uses DB KVs as a routing KV source. The API map is the
sole KV source for routing. A SG absent from the map has no KV data for the algorithm
to use. Providing `[]` is the deliberate way to declare "no KV contribution."

#### FR-API-04: Link list for manual UC creation
When the API is invoked in manual mode (FR-UC-01), the input shall additionally include:
- A list of intra-usecase **data** link system IDs selected by the user (primary source
  of SG pairs).
- Optionally, a list of intra-usecase **control** link system IDs, used to derive SG
  pairs for any SG that has no intra-usecase data links to any other SG in the UC
  (control link exception per FR-UC-01 step 4).

These link lists are not required for auto-routing mode (FR-UC-02).

This section defines how the algorithm derives the effective KV list for each SG before
DFS begins.

#### FR-KV-01: Step 1 — Load SGKV from DB
For every SG referenced in the selected UCs (and for every SG in the API's SG map),
the system shall query the `sgkv` and `sgkv_values` tables to obtain the complete set of
SGKV records. This data is used solely for the seed-detection comparison in Step 2;
it is never used as a routing KV source.

#### FR-KV-02: Step 2 — Apply UC filter
The system shall build a UC filter from the selected UCs: for each UC in the selected
list, extract every (Key, Value) pair from the UC's `gkv_entries`. Build a map
`Key → Set<Value>`. Then, for each SGKV instance of each SG, retain only the KV pairs
where both the Key and the specific Value appear in the UC filter map. Discard non-
matching KV pairs from each instance. If an SGKV instance has no remaining KV pairs
after filtering, that instance is dropped. The result is the **UC-filtered SGKV instance
set** for each SG — zero or more instances, each trimmed to only relevant KV pairs.

*Rationale:* This prevents KVs from unrelated usecases (e.g., `Instance` keys, sample
rates from un-selected UCs) from generating irrelevant new GKV combinations.

The result of this step (the UC-filtered SGKV instance set) is used **solely for seed
detection** in FR-CONE-01. It is never used as a routing KV source.

*Edge case — no selected UCs:* If the selected UC list is empty, no filter is applied.
Step 2 produces an empty baseline for every SG (nothing to filter against). As a result,
every SG in the API map differs from its empty baseline and becomes a seed via
FR-CONE-01. See FR-CONE-05.

#### FR-KV-03: Step 3 — Apply API input (universally mandatory)
For each SG present in the API's SG map, the system shall discard the Step-2 result and
replace it entirely with the SGKV instances from the API input. A SG mapped to an empty
list (`[]`) contributes one empty SGKV instance — the user explicitly declares no KV
contribution for it.

Every SG in the routing scope must appear in the API map. SGs absent from the map are
a pre-validation error (FR-API-03). There is no DB fallback in any scenario. DB KVs
(Steps 1–2) are used only for seed detection comparison — never as a routing KV source.

*Rationale:* The algorithm must know the user's explicit KV intent for every SG it
routes. Absence is ambiguous; `[]` is the intentional "no contribution" signal.

---

### 3.4 Seed and Cone Detection

#### FR-CONE-01: Changed SGs as seeds
After Steps 1–3, a SG is classified as a seed if its Step-3 SGKV instance set (the
API-provided set) differs from its Step-2 UC-filtered instance set (the DB-derived
baseline). The comparison is set-based: if the sets are not equal (by KV content), the
SG is a seed. FR-API-03 guarantees all SGs in the routing scope are in the API input,
so this comparison is always available.

#### FR-CONE-02: New SGs as seeds
A SG that does not appear in any existing UC in the DB is a new SG and is automatically
a seed.

#### FR-CONE-03: New or deleted intra-usecase links as seeds
A new intra-usecase link (a data link with `link_scope = intra_usecase` between two SGs
that do not yet share a `use_case_subgraph_pairs` entry in any UC) acts as a seed for
the cone. A deleted intra-usecase link also acts as a seed. Both the source and
destination SGs of the new or deleted link are treated as seeds.

#### FR-CONE-04: Cone scope — bidirectional
The cone is computed by traversing **both directions** from each seed SG:
- **Forward** — follow intra-usecase links in their declared direction to reach downstream SGs.
- **Reverse** — follow intra-usecase links in reverse to reach upstream SGs.

All SGs reachable in either direction from any seed form the cone. DFS for new UC
discovery (§3.5) runs within the cone only. Existing UCs whose SGs are entirely outside
the cone are not re-evaluated in this routing session.

*Rationale:* A changed SG can be in the middle of a path. The cone must include
upstream SGs (so DFS can traverse through the change) and downstream SGs (so all
paths passing through the change are re-routed).

#### FR-CONE-05: No selected UCs → all API-provided SGs are seeds
When the selected UC list is empty, there is no reference UC to build a UC filter from.
Step 2 therefore produces an empty baseline for every SG. Because every SG in the API
map differs from its empty baseline, FR-CONE-01 classifies every API-provided SG as a
seed. The routing scope is exactly the SGs present in the API map.

This is the empty-canvas case: the user has no prior UC context and is building from
scratch by dragging SGs onto the canvas and adding connections. All SGs they provide
participate in routing as seeds. The same mandatory-API-map rule (FR-API-03) still
applies — a SG absent from the API map is still an error.

*"Full-graph" routing simply means the user selects all existing UCs. That follows the
normal selected-UCs flow with the full UC set — it is not a separate mode.*

#### FR-CONE-06: Out-of-selected-UC-context SG → automatic seed
When the API input includes a SG that is not a member of any selected UC, that SG is
automatically a seed. There is no UC-filtered baseline to compare against for such
SGs; the API-provided SGKV instances are used directly (FR-KV-03 total replace applies,
with an empty UC-filtered set as the replaced value). The SG participates in
bidirectional cone expansion (FR-CONE-04).

*Example: user drags an existing SG from the palette onto the routing canvas. That SG
exists in the DB (possibly in other non-selected UCs) but is not in any selected UC.
The API must include this SG in the SG map (with at least an empty SGKV list). An
empty list is valid; the orphan check (FR-VAL-01) will surface errors if the resulting
paths produce no valid UCs for that SG.*

#### FR-CONE-07: Routing scope boundary — non-deletion scenarios only
In non-deletion scenarios, the routing scope is strictly bounded by:
- The SGs of the selected UCs (loaded from DB via FR-KV-01), and
- Any SGs explicitly present in the API's SG map (including out-of-context SGs per
  FR-CONE-06).

The bidirectional cone expansion (FR-CONE-04) **does not cross this boundary** into SGs
that belong only to non-selected UCs and are absent from the API input. The system does
not proactively scan non-selected UCs for impact.

The algorithm operates only on what the user has selected and explicitly provided.
Impact on unseen items is only surfaced in deletion scenarios (FR-DEL-01), where
deleted components can affect UCs the user has not selected.

*This boundary also means FR-API-03 only checks cone SGs within this bounded scope —
it does not require SGs from non-selected, non-provided UCs.*

---

### 3.5 DFS Routing Algorithm

#### FR-DFS-01: Traversal
The algorithm shall perform DFS from each root SG in the cone. Root SGs are SGs in the
cone with no incoming intra-usecase links from other SGs also in the cone.

#### FR-DFS-02: Traversable links
Only `intra_usecase` data links are traversed. `intra_subgraph` and `inter_usecase` links
are ignored by the traversal. The algorithm stops at any SG connected only via
`inter_usecase` links.

#### FR-DFS-03: Path emission
A new UC candidate is emitted for each path that terminates at a **leaf SG** — a SG with
no outgoing intra-usecase links within the cone. Paths that end at a cycle-detection
point are also emitted as leaf paths.

#### FR-DFS-04: Cycle detection
If the DFS visits a SG already in the current traversal stack (cycle), the path
terminates at that point. The cycle is logged as a warning and the path is emitted as
if the repeated SG were a leaf.

#### FR-DFS-05: SGKV combination expansion
When a SG in the path has multiple SGKV instances available (from DB after UC filter, or
from the API input for SGs covered by FR-KV-03 or FR-CONE-06), the algorithm generates
one UC candidate per valid SGKV combination across the path. A combination assigns
exactly one SGKV instance per SG in the path.

*Example:* Path A→B→C where A has 2 SGKVs (A1, A2) and C has 2 SGKVs (C1, C2), B has
1 SGKV (B1). The algorithm evaluates all 4 combinations: (A1,B1,C1), (A1,B1,C2),
(A2,B1,C1), (A2,B1,C2). Valid ones produce UC candidates.

#### FR-DFS-06: SGKV conflict detection
A SGKV combination is invalid if any Key appears with two **different** Values across
the assigned SGKV instances (from different SGs in the path). Invalid combinations are
silently discarded. A combination where two SGs contribute the **same** (Key, Value)
pair is valid — the pair appears exactly once in the GKV.

*Example:* A has {Kx:Vx1}, C has {Kx:Vx2} → same Key, different Values → conflict,
combination discarded. A has {Kx:Vx1}, C has {Kx:Vx1} → same Key, same Value → valid,
GKV includes {Kx:Vx1} once.

#### FR-DFS-07: GKV aggregation from a valid combination
For each valid combination, the GKV is the union of all KV pairs from each assigned
SGKV instance. Because the combination is conflict-free, each Key appears exactly once
in the resulting GKV.

#### FR-DFS-08: Path-level conflict error
If **all** SGKV combinations for a path produce Key conflicts (no valid combination
exists), the system shall return an error identifying the conflicting SGs and the Key(s)
that cannot be resolved. Routing results are not presented until the user resolves the
conflict (by adjusting SGKV assignments on the conflicting SGs).

#### FR-DFS-09: Empty GKV rejection
A SGKV combination whose resulting GKV is empty (every assigned SGKV instance has an
empty KV list) does not produce a valid UC and is discarded. The path's SGs may become
orphans (see FR-VAL-01).

---

### 3.6 Duplicate GKV Handling

#### FR-DUP-01: Disjoint paths with same GKV — error
If two discovered paths have identical GKVs and share no SG in common (fully disjoint
paths), the system shall return an error. The error identifies both paths and their GKVs.
No new UCs are created until the conflict is resolved (user must adjust KVs on SGs to
break the duplicate).

#### FR-DUP-02: Overlapping paths with same GKV — merge
If two discovered paths have identical GKVs and share at least one SG, the system shall
merge them into a single UC. The merged UC's SG set is the union of both paths' SG sets.
The merged UC's subgraph-pair set is the union of both paths' directed SG pairs.

*Example:* Path A = [SG1→SG3→SG5] and path B = [SG2→SG3→SG5], both GKV = {K:V}.
They share SG3 and SG5. Merged UC = {SG1, SG2, SG3, SG5} with pairs
(SG1,SG3), (SG2,SG3), (SG3,SG5).

#### FR-DUP-03: New path vs existing UC GKV
When a newly routed path has the same GKV as an existing UC already in the DB:
- **(a) Exact match (same SGs, same pairs):** No new UC is created. The existing UC is
  considered valid. This is a no-op.
- **(b) Overlapping (common SG, structural change session):** Merge the new path into
  the existing UC per FR-DUP-02. The existing UC's SG set and pair set are extended.
  This is only permitted in structural-change sessions (new SGs or new links present);
  KV-only sessions cannot produce a different path structure for the same GKV.
- **(c) Disjoint (no common SG):** Error per FR-DUP-01. The new UC cannot be created
  until the GKV conflict with the existing UC is resolved.

---

### 3.7 Validation

#### FR-VAL-01: Orphan SG detection and resolution
After routing, the system shall identify every SG in the routing scope that is not a
member of any UC. Such SGs are orphan SGs. The system shall include all orphan SGs in
the routing result payload so the UI can inform the user.

When a UC discard or stage operation would leave one or more orphan SGs, the operation
is **not blocked**. The system reports the would-be orphan components to the UI, which
presents the user two options:

- **Delete orphans:** Schedule deletion of all components that would become orphaned —
  the orphan SGs, their intra-usecase links, and any subsystems that contain only
  orphaned SGs.
  - For committed components (present in actual DB tables): record a STAGED DELETE in
    `edit_actions`. Applied at commit.
  - For new components (only in `edit_actions`, never committed): remove their
    `edit_actions` entries directly.
- **Decline and continue editing:** Do not delete the orphan components. The user
  continues working in the same edit session — adding connections, assigning KVs, or
  building new UCs — and calls `create-usecases` again once the graph is corrected.
  The commit-time orphan check (I5) is the final hard gate: commit is rejected if any
  orphan components still exist at that point.

*Examples of orphan SGs:*
- A new SG with no KVs assigned in a path that produces no valid UC (empty GKV or
  all-conflict) — no UC was ever created for it.
- A SG that was only part of one newly created UC which the user then discarded.

#### FR-VAL-02: Orphan subsystem check
After routing, any subsystem that contains no SG that is a member of at least one UC
(per the membership definition in FR-VAL-01) is an orphan subsystem. The system shall
return an error listing all orphan subsystems.

#### FR-VAL-03: Orphan intra-usecase link check
After routing, any intra-usecase data link whose source SG and destination SG do not
share a `use_case_subgraph_pairs` entry in at least one UC is an orphan link. The system
shall return an error listing all orphan intra-usecase links. Orphan links arise when
their source or destination SG is an orphan SG, or when two SGs have an intra-usecase
link between them but no routing session has yet created a UC containing both.

#### FR-VAL-04: Pre-validation — deletion UC-scope completeness
When a deletion scenario is detected (see §3.9), the backend checks that every UC
impacted by the deleted component is present in the `selectedUsecases` list. This is
the UC-selection level check. The SG-presence level check is handled by FR-API-03
(cone completeness), which runs only after this UC check passes.

---

### 3.8 UC Lifecycle — Creation and Preservation

#### FR-LIFE-01: Old UCs preserved on KV-only changes
If the only change in a routing session is KV modifications (no SG additions/deletions,
no link additions/deletions), existing UCs in the DB shall not be modified or deleted.
New UCs are created for newly discovered GKV combinations; existing UCs remain in their
current state.

#### FR-LIFE-02: New UCs are Unstaged by default
All UCs created by the routing algorithm begin with `changeStatus = UNSTAGED` in the
edit-session framework. They are not committed until the user explicitly stages them.

#### FR-LIFE-03: Unstaged UCs are discarded on session end
When an edit session ends without a commit (e.g., session timeout), all UNSTAGED UCs
created during that session are discarded automatically.

---

### 3.9 Deletion Scenario

#### FR-DEL-01: Detect all impacted UCs
When one or more components (SG or intra-usecase link) are deleted, the system shall
loop through **all UCs in the DB** and identify every UC that contains the deleted
component. The result is the complete set of impacted UCs.

#### FR-DEL-02: All impacted UCs must be selected — error if not
If any UC in the impacted set is absent from the `selectedUsecases` list, the system
shall return an error listing the **full set of impacted UCs** (both those already
selected and those newly identified). No routing proceeds until all impacted UCs are
selected.

*UI behaviour:* On receiving this error, the UI auto-selects all impacted UCs,
pre-populates each SG's KV instances from DB (UC-filtered for the expanded selection),
and re-presents them to the user. The user may adjust KVs or leave them as-is, then
re-calls the same create-usecases API with the expanded `selectedUsecases` list and all
SGs from all impacted UCs present in the SG map (each with KVs or `[]`).

At all times, every SG in the routing scope must appear in the API's SG map with KVs
or an empty array before routing can begin (FR-API-03).

#### FR-DEL-03: Affected UCs marked for deletion
Once FR-DEL-02 and FR-API-03 both pass, the system shall mark every UC that contained
the deleted component as **pending deletion**. These are presented to the user as "UCs
to be deleted."

#### FR-DEL-04: New UCs created from broken paths
After marking affected UCs for deletion, the routing algorithm runs DFS on the
remaining graph (after the component is removed). New UCs are created for each valid
path in the resulting broken graph. Single-SG paths produce a UC if and only if the SG
has a non-empty effective KV instance set.

#### FR-DEL-05: User option to keep a deletion-marked UC
The user may choose to preserve a UC that is pending deletion. When preserved, the
system shall update that UC's SG set and subgraph-pair set to contain only the
components that still exist in the graph (removing the deleted component's pair entry
and any SGs that became unreachable). The UC's status shall be set to **Disconnected**.

---

### 3.10 Extension Scenario (New SGs/Links)

#### FR-EXT-01: New SGs are seeds and require API map entry
New SGs — those present in the DB but not yet a member of any UC — are identified when
they appear in the API's SG map. The system queries the DB for those SGs' intra-usecase
links to enable DFS traversal. A new SG is automatically a seed (FR-CONE-02). Its
KV instances come from the API input (mandatory per FR-KV-03); no SGKV DB fallback.

#### FR-EXT-02: New paths discovered and presented as Unstaged
The DFS algorithm traverses through new SGs and any new links to discover new paths
that include previously-unrouted SGs. Each discovered path is created as an UNSTAGED
UC and presented to the user for review.

#### FR-EXT-03: User selects which new UCs to stage
After reviewing the discovered Unstaged UCs, the user may stage any subset of them for
commit. The remainder are discarded. If discarding a UC would leave orphan SGs, the
system warns the user per FR-VAL-01 (warn + delete-orphans option, not a block).

---

### 3.11 Stage API — Orphan Handling

#### FR-STAGE-01: Orphan detection after staging
When the user calls the stage API and selects a subset of UCs to keep, the remaining
unstaged UCs are removed from `edit_actions`. If any SG, intra-usecase link, or
subsystem is now **unique to the removed unstaged UCs** (i.e., not referenced by any
committed UC or remaining staged UC), it becomes orphaned.

The system shall detect all such orphaned components and return them to the UI
immediately. The UI presents the same two options as FR-VAL-01:

- **Delete orphans:** Apply FR-VAL-01's deletion mechanism (STAGED DELETE for committed
  components; remove `edit_actions` entry for new components).
- **Decline and continue editing:** Leave the orphaned components in place. The user
  continues in the same edit session — making graph changes, re-calling
  `create-usecases`, staging new UCs — until the issue is resolved. The commit-time
  check (I5) is the final gate.

---

### 3.12 KV Persistence at Commit Time

#### FR-KV-COMMIT-01: New KVs added to SGKV at commit
When a routing session is committed, the system shall write any SGKV instances from the
API input that are not already represented in that SG's SGKV DB records as new SGKV
entries.

#### FR-KV-COMMIT-02: Existing SGKVs are not deleted at commit
Existing SGKV records are never deleted at commit time. Another UC (not selected in the
current session) may depend on them. *Rationale:* Consistency across sessions.

#### FR-KV-COMMIT-03: KV cleanup at download-file time
During the download-file workflow, the system shall validate that every SGKV record for
every SG is referenced by at least one committed UC's GKV. SGKV records not referenced
by any UC are removed at this stage.

---

### 3.13 UC Connectivity Status

#### FR-STATUS-01: Connected is the default
Every UC created by the routing algorithm begins with status **Connected**.

#### FR-STATUS-02: Disconnected UCs from preserved deletions
A UC transitions to **Disconnected** only when a user explicitly chooses to preserve
it after a link or SG deletion (FR-DEL-05). Disconnected UCs satisfy the orphan check
(FR-VAL-01) for their member SGs — those SGs are considered "in a valid UC."

#### FR-STATUS-03: Disconnected UCs cannot be created by routing
The routing algorithm never directly creates a Disconnected UC. Disconnected UCs arise
only from user preservation of deletion-affected UCs (FR-DEL-05), or from manual
UC creation (FR-UC-01) when the user explicitly constructs a UC with missing links.

---

## 4. Invariants

**I1 — GKV uniqueness:** No two UCs in the same file may have identical GKVs and
disjoint SG sets. (Two UCs with the same GKV and at least one common SG are merged per
FR-DUP-02.)

**I2 — Subgraph-pair completeness:** Every SG pair (A, B) recorded in a UC's
`use_case_subgraph_pairs` must also have both A and B present in the UC's
`use_case_subgraphs`. (Inherited from schema redesign invariant I1.)

**I3 — GKV derivation:** The GKV stored on a UC equals the union of all KV pairs from
the specific SGKV combination that was active at the time the UC was created or last
re-routed. (Historical record; does not auto-update if SGKVs change after the UC is
created.)

**I4 — No structural deletion for KV changes:** A KV-only change in a routing session
never deletes or modifies an existing UC record.

**I5 — Orphan-free commit:** A commit is invalid if any SG in the routing scope is not
a member of at least one UC with a non-empty GKV. (Extends FR-VAL-01 to commit-gate.)

**I6 — SGKV internal consistency:** Each SGKV instance (from DB or from the API input)
must contain at most one KV pair per Key Definition. An SGKV with two Values for the
same Key is malformed and shall be rejected at write time.

---

## 5. Non-Functional Requirements

**NFR-PERF-01:** The routing algorithm shall complete in under 100ms for a graph of up
to 30 subgraphs with up to 50 intra-usecase links.

**NFR-CONSIST-01:** All UC creation, deletion, and staging writes within a routing
session shall occur within a single database transaction (provided by the edit-session
UnitOfWork).

**NFR-STAT-01:** The routing API is stateless at the HTTP layer. All session state is
held in the `edit_actions` / edit-session tables.

---

## 6. Out of Scope

- **EC (Echo Cancellation) routing** (3-usecase generation for Rx/Tx domain bridges) —
  deferred to a follow-on spec.
- **Nested usecase preservation** across sessions — deferred.
- **MDF V2 implicit intermediate subgraphs** — deferred.
- **UI/UX implementation details** — not part of this spec.
- **Concurrent routing sessions on the same file** — out of scope; single-session model.
- **Control links** — DFS routing is driven by data links only; control links are not
  traversed by the routing algorithm. Their presence in a UC follows the same
  subgraph-pair ownership model. Exception: in manual UC creation (FR-UC-01 step 4),
  control links may be used to derive SG pairs for SGs that have no intra-usecase data
  links.

---

## 7. Open Questions

**OQ-1 — Multi-KV expansion: RESOLVED (2026-06-01)**
Cartesian product model with conflict detection applies (FR-DFS-05 through FR-DFS-09).
GKV cannot contain multiple values for the same Key. Multi-SGKV SGs produce multiple UC
candidates; combinations where any Key has different Values from different SGs are
discarded. If no valid combination exists for a path, it is a path-level conflict error.

**OQ-2 — Routing scope for KV-only changes: RESOLVED (2026-06-01)**
Cone-based DFS (option a). The cone is bidirectional from seed SGs (FR-CONE-04).
DFS runs within the cone only; existing UCs outside the cone are untouched (FR-LIFE-01).
Decision rationale: better performance at scale, clear separation of concerns between
change detection and routing, aligns with NFR-PERF-01, and the user's description of
seed + cone as distinct concepts maps naturally to two separate services.

**OQ-3 — Disconnected UCs and orphan check: RESOLVED (2026-06-01)**
A SG that is a member of any UC — including Disconnected UCs — is not an orphan.
FR-VAL-01 has been updated to explicitly state this. A Disconnected UC satisfies
orphan membership for its SGs.
