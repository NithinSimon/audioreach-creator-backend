<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Data Links & Virtual Links: Low-Level Design

**Related Documents:**
- `datalink-virtual-link-design.md` — High-level design, goals, invariants, API contract, ADRs
- `modification-framework/modification-framework-design.md` — `edit_actions` schema, session lifecycle, commit orchestration
- `read-overlay-design.md` — `EditActionsQueryService`, `OverlayMerge`

---

## 1) Table Schemas

### 1.1 `data_links` (existing — no changes)

```sql
CREATE TABLE data_links (
  system_id                   INTEGER      PRIMARY KEY,
  source_node_system_id       INTEGER      NOT NULL,
  destination_node_system_id  INTEGER      NOT NULL,
  source_port_system_id       INTEGER      NOT NULL,
  destination_port_system_id  INTEGER      NOT NULL,
  is_inter_graph              INTEGER      NOT NULL DEFAULT 0,  -- boolean (0/1)
  natural_key_hash            VARCHAR(255) NOT NULL,
  file_system_id              INTEGER      NOT NULL,
  version                     INTEGER      NOT NULL DEFAULT 1,

  FOREIGN KEY (source_node_system_id)      REFERENCES nodes(system_id)      ON DELETE CASCADE,
  FOREIGN KEY (destination_node_system_id) REFERENCES nodes(system_id)      ON DELETE CASCADE,
  FOREIGN KEY (source_port_system_id)      REFERENCES data_ports(system_id) ON DELETE RESTRICT,
  FOREIGN KEY (destination_port_system_id) REFERENCES data_ports(system_id) ON DELETE RESTRICT,
  FOREIGN KEY (file_system_id)             REFERENCES arc_db_files(system_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uk_data_link_file_natural_key
  ON data_links(file_system_id, natural_key_hash);
```

`data_links` stores only actual module-to-module links. Both `source_node_system_id` and `destination_node_system_id` always reference module nodes (never subsystem nodes).

### 1.2 `virtual_link_segments` (new)

```sql
CREATE TABLE virtual_link_segments (
  system_id                   INTEGER  PRIMARY KEY,
  actual_link_system_id       INTEGER,                -- NULL until chain is resolved
  source_node_system_id       INTEGER  NOT NULL,      -- module or subsystem node
  destination_node_system_id  INTEGER  NOT NULL,      -- module or subsystem node
  source_port_system_id       INTEGER  NOT NULL,      -- always a module port (see Port Ownership)
  destination_port_system_id  INTEGER  NOT NULL,      -- always a module port (see Port Ownership)
  file_system_id              INTEGER  NOT NULL,
  version                     INTEGER  NOT NULL DEFAULT 1,

  FOREIGN KEY (actual_link_system_id)      REFERENCES data_links(system_id)    ON DELETE CASCADE,
  FOREIGN KEY (source_node_system_id)      REFERENCES nodes(system_id)         ON DELETE CASCADE,
  FOREIGN KEY (destination_node_system_id) REFERENCES nodes(system_id)         ON DELETE CASCADE,
  FOREIGN KEY (source_port_system_id)      REFERENCES data_ports(system_id)    ON DELETE RESTRICT,
  FOREIGN KEY (destination_port_system_id) REFERENCES data_ports(system_id)    ON DELETE RESTRICT,
  FOREIGN KEY (file_system_id)             REFERENCES arc_db_files(system_id)  ON DELETE CASCADE
);

-- Fetch all segments for a file (primary read pattern)
CREATE INDEX idx_vls_file
  ON virtual_link_segments(file_system_id);

-- Find all segments for an actual link (used in flat-mode delete cascade)
CREATE INDEX idx_vls_actual_link
  ON virtual_link_segments(actual_link_system_id);

-- Enforce one-connection-per-port: a port may have at most one outgoing segment per file
CREATE UNIQUE INDEX uq_vls_source_port_file
  ON virtual_link_segments(source_port_system_id, file_system_id)
  WHERE actual_link_system_id IS NOT NULL;  -- only enforce on committed segments

-- Enforce one-connection-per-port: a port may have at most one incoming segment per file
CREATE UNIQUE INDEX uq_vls_dest_port_file
  ON virtual_link_segments(destination_port_system_id, file_system_id)
  WHERE actual_link_system_id IS NOT NULL;  -- only enforce on committed segments
```

**Notes on the unique indices:**
- The unique constraint on `(source_port_system_id, file_system_id)` and `(destination_port_system_id, file_system_id)` is applied only to committed rows (`actual_link_system_id IS NOT NULL`). Pending rows (in `edit_actions`) are validated in application code before insertion.
- The `ON DELETE CASCADE` on `actual_link_system_id` means: when an actual link is deleted from `data_links`, all its virtual segments are automatically deleted from `virtual_link_segments`. This is the committed-state cascade for flat-mode deletes.

---

## 2) `edit_actions` Row Structure

All pending changes to both `data_links` and `virtual_link_segments` are stored in `edit_actions` during a session. The following tables show the exact column values for each operation type.

### 2.1 DataLink CREATE (flat mode — same subsystem)

When the user adds a link between two modules in the same subsystem, only a `DataLink` CREATE is recorded. No virtual segments.

| Column | Value |
|--------|-------|
| `change_id` | Pre-assigned by `IdGenerationPort` |
| `system_id` | Pre-assigned `system_id` for the new actual link (e.g., `L1`) |
| `aggregate_id` | Same as `system_id` (actual links are top-level entities) |
| `session_id` | Active session ID |
| `table_name` | `'DataLink'` |
| `operation` | `'CREATE'` |
| `payload` | Full `DataLinkRow` JSON: `{ systemId, sourceNodeSystemId, destinationNodeSystemId, sourcePortSystemId, destinationPortSystemId, isInterGraph, naturalKeyHash, fileSystemId, version: 1 }` |
| `change_status` | `'STAGED'` |
| `base_version` | `null` (CREATE operations have no base version) |
| `group_id` | `null` (no related changes) |
| `valid_until` | `null` (current version) |

### 2.2 DataLink CREATE + VirtualLinkSegment CREATEs (flat mode — different subsystems)

When the user adds a link between modules in different subsystems, the server creates one `DataLink` row and N `VirtualLinkSegment` rows (one per subsystem boundary crossed). All rows share the same `group_id`.

**DataLink CREATE:**

| Column | Value |
|--------|-------|
| `system_id` | Pre-assigned `system_id` for the actual link (e.g., `L1`) |
| `table_name` | `'DataLink'` |
| `operation` | `'CREATE'` |
| `payload` | Full `DataLinkRow` JSON |
| `change_status` | `'STAGED'` |
| `group_id` | Shared UUID (e.g., `G1`) |

**VirtualLinkSegment CREATE (one per segment, e.g., S1, S2, S3):**

| Column | Value |
|--------|-------|
| `system_id` | Pre-assigned `system_id` for the segment (e.g., `S1`) |
| `aggregate_id` | Same as `system_id` |
| `table_name` | `'VirtualLinkSegment'` |
| `operation` | `'CREATE'` |
| `payload` | Full `VirtualLinkSegmentRow` JSON: `{ systemId: S1, actualLinkSystemId: L1, sourceNodeSystemId, destinationNodeSystemId, sourcePortSystemId, destinationPortSystemId, fileSystemId, version: 1 }` |
| `change_status` | `'STAGED'` |
| `base_version` | `null` |
| `group_id` | Same shared UUID `G1` |

Note: `actualLinkSystemId = L1` is set immediately because the actual link's ID is pre-assigned before the segments are created.

### 2.3 VirtualLinkSegment CREATE (subsystem mode — user draws a segment)

When the user draws a segment in subsystem mode, only a `VirtualLinkSegment` CREATE is recorded. No actual link yet.

| Column | Value |
|--------|-------|
| `system_id` | Pre-assigned `system_id` for the segment (e.g., `S1`) |
| `aggregate_id` | Same as `system_id` |
| `table_name` | `'VirtualLinkSegment'` |
| `operation` | `'CREATE'` |
| `payload` | `{ systemId: S1, actualLinkSystemId: null, sourceNodeSystemId, destinationNodeSystemId, sourcePortSystemId, destinationPortSystemId, fileSystemId, version: 1 }` |
| `change_status` | `'STAGED'` |
| `base_version` | `null` |
| `group_id` | `null` (segments are independent until resolved) |

### 2.4 DataLink CREATE (resolution — server creates actual link from complete chain)

When the server resolves a complete virtual chain, it creates a `DataLink` row and updates the segment rows to set `actualLinkSystemId`.

**DataLink CREATE (created by server, not client):**

| Column | Value |
|--------|-------|
| `system_id` | Pre-assigned `system_id` for the actual link (e.g., `L1`) |
| `table_name` | `'DataLink'` |
| `operation` | `'CREATE'` |
| `payload` | Full `DataLinkRow` JSON derived from chain endpoints |
| `change_status` | `'STAGED'` |
| `group_id` | Shared UUID `G1` (links this DataLink to its segments) |

**VirtualLinkSegment UPDATE (server sets `actualLinkSystemId` on each segment):**

| Column | Value |
|--------|-------|
| `system_id` | Segment ID (e.g., `S1`) |
| `table_name` | `'VirtualLinkSegment'` |
| `operation` | `'UPDATE'` |
| `payload` | `{ actualLinkSystemId: L1 }` (partial update — only this field changes) |
| `change_status` | `'STAGED'` |
| `base_version` | Current `version` of the segment's CREATE row |
| `group_id` | Same shared UUID `G1` |

### 2.5 DataLink DELETE (flat mode)

When the user deletes an actual link in flat mode, the server records a DELETE for the actual link and for all its virtual segments. All share the same `group_id`.

**DataLink DELETE:**

| Column | Value |
|--------|-------|
| `system_id` | `L1` |
| `table_name` | `'DataLink'` |
| `operation` | `'DELETE'` |
| `payload` | `{}` |
| `change_status` | `'STAGED'` |
| `base_version` | Current `version` of `L1` in `data_links` |
| `group_id` | Shared UUID `G2` |

**VirtualLinkSegment DELETE (one per segment):**

| Column | Value |
|--------|-------|
| `system_id` | `S1` (or `S2`, `S3`) |
| `table_name` | `'VirtualLinkSegment'` |
| `operation` | `'DELETE'` |
| `payload` | `{}` |
| `change_status` | `'STAGED'` |
| `base_version` | Current `version` of the segment in `virtual_link_segments` |
| `group_id` | Same shared UUID `G2` |

### 2.6 VirtualLinkSegment DELETE (subsystem mode — user deletes a segment)

When the user deletes a virtual segment in subsystem mode, only the segment DELETE is recorded. No cascade at this point.

| Column | Value |
|--------|-------|
| `system_id` | `S2` |
| `table_name` | `'VirtualLinkSegment'` |
| `operation` | `'DELETE'` |
| `payload` | `{}` |
| `change_status` | `'STAGED'` |
| `base_version` | Current `version` of `S2` in `virtual_link_segments` (or in `edit_actions` if pending) |
| `group_id` | `null` (cascade is deferred to resolution time) |

### 2.7 Resolution-triggered cascade (broken chain)

When resolution detects a broken chain (e.g., S2 was deleted), the server records DELETEs for the actual link and the orphaned segments. All share the same `group_id`.

**DataLink DELETE:**

| Column | Value |
|--------|-------|
| `system_id` | `L1` |
| `table_name` | `'DataLink'` |
| `operation` | `'DELETE'` |
| `payload` | `{}` |
| `base_version` | Current `version` of `L1` |
| `group_id` | Shared UUID `G3` |

**VirtualLinkSegment DELETE (for orphaned segments S1 and S3):**

| Column | Value |
|--------|-------|
| `system_id` | `S1` (or `S3`) |
| `table_name` | `'VirtualLinkSegment'` |
| `operation` | `'DELETE'` |
| `payload` | `{}` |
| `base_version` | Current `version` of the segment |
| `group_id` | Same shared UUID `G3` |

---

## 3) DB State Transitions

This section shows the exact state of `data_links`, `virtual_link_segments`, and `edit_actions` before and after each key operation. All examples use the same scenario: ModuleA (in SubsystemX) → ModuleB (in SubsystemY).

### 3.1 Initial state (no links)

```
data_links:            (empty)
virtual_link_segments: (empty)
edit_actions:          (empty)
```

### 3.2 After: User adds link in flat mode (different subsystems)

User calls `POST /data-links { sourceNode: ModuleA, destNode: ModuleB }`.

```
data_links:            (empty — not committed yet)
virtual_link_segments: (empty — not committed yet)

edit_actions:
  C1 | system_id=L1 | table=DataLink         | op=CREATE | payload={full link}   | group=G1
  C2 | system_id=S1 | table=VirtualLinkSegment | op=CREATE | payload={ModuleA→SubX, actualLinkId=L1} | group=G1
  C3 | system_id=S2 | table=VirtualLinkSegment | op=CREATE | payload={SubX→SubY,  actualLinkId=L1} | group=G1
  C4 | system_id=S3 | table=VirtualLinkSegment | op=CREATE | payload={SubY→ModuleB, actualLinkId=L1} | group=G1
```

### 3.3 After: Commit (flat mode add)

```
data_links:
  L1 | source=ModuleA | dest=ModuleB | ...

virtual_link_segments:
  S1 | actual_link_system_id=L1 | source=ModuleA  | dest=SubsystemX | ...
  S2 | actual_link_system_id=L1 | source=SubsystemX | dest=SubsystemY | ...
  S3 | actual_link_system_id=L1 | source=SubsystemY | dest=ModuleB  | ...

edit_actions: (C1–C4 deleted after commit)
```

### 3.4 After: User adds segments in subsystem mode (step by step)

User calls `POST /virtual-links` three times.

```
data_links:            (unchanged — L1 still present from previous commit)
virtual_link_segments: (unchanged — S1, S2, S3 still present)

edit_actions (new session, new chain for a different connection ModuleC→ModuleD):
  C5 | system_id=S4 | table=VirtualLinkSegment | op=CREATE | payload={ModuleC→SubX, actualLinkId=null} | group=null
  C6 | system_id=S5 | table=VirtualLinkSegment | op=CREATE | payload={SubX→SubY,   actualLinkId=null} | group=null
  C7 | system_id=S6 | table=VirtualLinkSegment | op=CREATE | payload={SubY→ModuleD, actualLinkId=null} | group=null
```

### 3.5 After: Resolution (GET /components?showSubsystems=false)

Server traverses the graph, finds complete chain S4→S5→S6, creates actual link L2.

```
data_links:            (unchanged — L1 still present)
virtual_link_segments: (unchanged — S1, S2, S3 still present)

edit_actions (updated):
  C5 | system_id=S4 | table=VirtualLinkSegment | op=CREATE | payload={..., actualLinkId=L2} | group=G2
  C6 | system_id=S5 | table=VirtualLinkSegment | op=CREATE | payload={..., actualLinkId=L2} | group=G2
  C7 | system_id=S6 | table=VirtualLinkSegment | op=CREATE | payload={..., actualLinkId=L2} | group=G2
  C8 | system_id=L2 | table=DataLink           | op=CREATE | payload={full link ModuleC→ModuleD} | group=G2
```

### 3.6 After: Commit (subsystem mode add)

```
data_links:
  L1 | source=ModuleA | dest=ModuleB | ...
  L2 | source=ModuleC | dest=ModuleD | ...

virtual_link_segments:
  S1 | actual_link_system_id=L1 | ModuleA → SubsystemX
  S2 | actual_link_system_id=L1 | SubsystemX → SubsystemY
  S3 | actual_link_system_id=L1 | SubsystemY → ModuleB
  S4 | actual_link_system_id=L2 | ModuleC → SubsystemX
  S5 | actual_link_system_id=L2 | SubsystemX → SubsystemY
  S6 | actual_link_system_id=L2 | SubsystemY → ModuleD

edit_actions: (C5–C8 deleted after commit)
```

### 3.7 After: User deletes actual link L1 in flat mode

User calls `DELETE /data-links/L1`.

```
data_links:            (unchanged — L1 still present, not committed yet)
virtual_link_segments: (unchanged — S1, S2, S3 still present)

edit_actions:
  C9  | system_id=L1 | table=DataLink           | op=DELETE | payload={} | base_version=1 | group=G3
  C10 | system_id=S1 | table=VirtualLinkSegment | op=DELETE | payload={} | base_version=1 | group=G3
  C11 | system_id=S2 | table=VirtualLinkSegment | op=DELETE | payload={} | base_version=1 | group=G3
  C12 | system_id=S3 | table=VirtualLinkSegment | op=DELETE | payload={} | base_version=1 | group=G3
```

### 3.8 After: Commit (flat mode delete)

```
data_links:
  L2 | source=ModuleC | dest=ModuleD | ...   (L1 deleted)

virtual_link_segments:
  S4 | actual_link_system_id=L2 | ModuleC → SubsystemX
  S5 | actual_link_system_id=L2 | SubsystemX → SubsystemY
  S6 | actual_link_system_id=L2 | SubsystemY → ModuleD
  (S1, S2, S3 deleted — via ON DELETE CASCADE from L1 deletion)

edit_actions: (C9–C12 deleted after commit)
```

### 3.9 After: User deletes segment S5 in subsystem mode

User calls `DELETE /virtual-links/S5`.

```
data_links:            (unchanged — L2 still present)
virtual_link_segments: (unchanged — S4, S5, S6 still present)

edit_actions:
  C13 | system_id=S5 | table=VirtualLinkSegment | op=DELETE | payload={} | base_version=1 | group=null
```

### 3.10 After: Resolution (GET /components?showSubsystems=false after S5 deleted)

Server re-traverses graph. Chain S4→S5→S6 is broken (S5 deleted). Server records cascade.

```
data_links:            (unchanged — L2 still present)
virtual_link_segments: (unchanged — S4, S5, S6 still present)

edit_actions:
  C13 | system_id=S5 | table=VirtualLinkSegment | op=DELETE | payload={} | group=null  (existing)
  C14 | system_id=L2 | table=DataLink           | op=DELETE | payload={} | base_version=1 | group=G4
  C15 | system_id=S4 | table=VirtualLinkSegment | op=DELETE | payload={} | base_version=1 | group=G4
  C16 | system_id=S6 | table=VirtualLinkSegment | op=DELETE | payload={} | base_version=1 | group=G4
```

### 3.11 After: Commit (subsystem mode delete cascade)

```
data_links:            (empty — L2 deleted)
virtual_link_segments: (empty — S4, S5, S6 deleted via ON DELETE CASCADE from L2 deletion)
edit_actions:          (C13–C16 deleted after commit)
```

---

## 4) Read Overlay Mechanics

### 4.1 Overview

The read overlay pattern (defined in `read-overlay-design.md`) applies to virtual link segments exactly as it does to other entities. The infrastructure layer uses `EditActionsQueryService` to fetch pending changes and `OverlayMerge` to merge them with committed rows.

### 4.2 Subsystem mode read (`showSubsystems=true`)

**Step 1: Fetch base rows**
```
SELECT * FROM virtual_link_segments WHERE file_system_id = :fileId
```
Returns all committed virtual segments for the file.

**Step 2: Fetch pending changes**
```
EditActionsQueryService.getByTable(sessionId, ENTITY_NAMES.VirtualLinkSegment)
```
Returns all active `edit_actions` rows for `VirtualLinkSegment` in the current session (`valid_until IS NULL`).

**Step 3: Apply overlay**
```
OverlayMerge.applyToCollection(baseSegments, segmentActions)
```
Merge rules:
- `CREATE` action for a segment not in base → append to result
- `DELETE` action for a segment in base → exclude from result
- `UPDATE` action for a segment in base → merge partial payload over base row
- No action for a segment in base → include as-is

**Result:** The merged collection includes all committed segments plus pending CREATEs, minus pending DELETEs, with pending UPDATEs applied. Segments with `actual_link_system_id = null` (unresolved) are included — they are visible to the user as partial chains.

### 4.3 Flat mode read (`showSubsystems=false`)

**Step 1: Check for unresolved segments**

Query `virtual_link_segments` + `edit_actions` overlay for any segments with `actual_link_system_id = null`. If none, proceed to Step 3 (fast path).

**Step 2: Run chain resolution (slow path)**

See Section 5 for the full algorithm. After resolution, all complete chains have a corresponding `DataLink` CREATE in `edit_actions`. Incomplete chains return `422`.

**Step 3: Fetch base rows**
```
SELECT * FROM data_links WHERE file_system_id = :fileId
```

**Step 4: Fetch pending changes**
```
EditActionsQueryService.getByTable(sessionId, ENTITY_NAMES.DataLink)
```

**Step 5: Apply overlay**
```
OverlayMerge.applyToCollection(baseLinks, linkActions)
```

**Result:** The merged collection includes all committed actual links plus pending CREATEs (including newly resolved ones), minus pending DELETEs.

### 4.4 Pending segments and usecase mapping

Pending virtual segments (in `edit_actions`) cannot be mapped to usecases until `auto-create-usecases` is run. The read overlay returns them as-is, without usecase filtering. This is consistent with how other pending entities (e.g., newly added modules) are returned — they are visible in the session but not yet part of any usecase.

---

## 5) Chain Resolution Algorithm

### 5.1 Inputs

- All virtual link segments for the file: committed rows from `virtual_link_segments` merged with pending `edit_actions` (the overlay result from Section 4.2).
- The active session ID (to write resolution results back to `edit_actions`).

### 5.2 Algorithm

**Phase 1: Build the segment graph**

Construct a directed graph where:
- Each node is a `system_id` from the `nodes` table (either a module or a subsystem node).
- Each edge is a virtual link segment: `(source_node_system_id) → (destination_node_system_id)`.
- Each edge carries the segment's `system_id`, `source_port_system_id`, and `destination_port_system_id`.

**Phase 2: Find all chain start points**

A chain start point is a node that:
- Is a module node (not a subsystem node), AND
- Has at least one outgoing edge in the segment graph.

These are the modules that have virtual segments starting from them.

**Phase 3: Traverse each chain**

For each start point, follow the directed edges:

```
function traverseChain(startNode, graph):
  path = [startNode]
  current = startNode

  while true:
    outgoing = graph.edgesFrom(current)

    if outgoing.length == 0:
      // Dead end
      if isModuleNode(current) and current != startNode:
        // Complete chain: starts and ends at module nodes
        return { complete: true, path, segments: edgesAlongPath(path) }
      else:
        // Incomplete chain: ends at a subsystem node
        return { complete: false, path, segments: edgesAlongPath(path) }

    if outgoing.length > 1:
      // Should not happen if one-connection-per-port constraint is enforced
      // Treat as incomplete chain (ambiguous)
      return { complete: false, path, segments: edgesAlongPath(path) }

    nextNode = outgoing[0].destination
    if nextNode in path:
      // Cycle detected — treat as incomplete
      return { complete: false, path, segments: edgesAlongPath(path) }

    path.append(nextNode)
    current = nextNode
```

**Phase 4: Process complete chains**

For each complete chain:

1. Extract the actual link endpoints:
   - `sourceNodeSystemId` = first segment's `source_node_system_id` (a module node)
   - `destinationNodeSystemId` = last segment's `destination_node_system_id` (a module node)
   - `sourcePortSystemId` = first segment's `source_port_system_id`
   - `destinationPortSystemId` = last segment's `destination_port_system_id`

2. Pre-assign a `system_id` for the actual link via `IdGenerationPort`.

3. Compute `naturalKeyHash` from `(sourcePortSystemId, destinationPortSystemId)`.

4. Create a `DataLink` CREATE operation in `edit_actions` (STAGED).

5. For each segment in the chain, create a `VirtualLinkSegment` UPDATE operation in `edit_actions` setting `actualLinkSystemId` to the new actual link's `system_id`.

6. Group all these operations under the same `group_id`.

**Phase 5: Process incomplete chains**

For each incomplete chain, collect the start node and the last node reached. Return these as error details in the `422` response.

If the incomplete chain contains segments that were previously part of a complete chain (i.e., their `actual_link_system_id` is set), the server must also:
1. Create a `DataLink` DELETE operation in `edit_actions` for the actual link.
2. Create `VirtualLinkSegment` DELETE operations for all orphaned segments (those in the chain that are not the deleted segment itself).
3. Group these under the same `group_id`.

### 5.3 Complexity

- Graph construction: O(n) where n = number of segments for the file.
- Chain traversal: O(n) total across all chains (each segment is visited at most once).
- For typical use cases (a few segments per chain, a few chains per file), this is negligible.

---

## 6) Commit Orchestration

### 6.1 Pre-commit: Discard incomplete chains

Before the commit transaction begins, the server identifies all `VirtualLinkSegment` CREATE operations in `edit_actions` that have `actualLinkSystemId = null`. These belong to incomplete chains.

For each such segment:
- Remove it from the staged changes (set `change_status = 'DISCARDED'` or delete the row).
- Warn the user: "N virtual link segment(s) were discarded because they did not form complete connections."

### 6.2 Topological order within the commit transaction

The commit applies staged `edit_actions` in the following order to respect FK dependencies:

**DELETEs (reverse dependency order):**
1. `VirtualLinkSegment` DELETEs — remove segments before their actual links
2. `DataLink` DELETEs — remove actual links (triggers `ON DELETE CASCADE` on `virtual_link_segments`)

**CREATEs (forward dependency order):**
3. `DataLink` CREATEs — create actual links first
4. `VirtualLinkSegment` CREATEs — create segments after their actual links (FK `actual_link_system_id` must exist)

**UPDATEs (any order):**
5. `VirtualLinkSegment` UPDATEs — update `actual_link_system_id` on segments

### 6.3 Optimistic locking

For UPDATE and DELETE operations, the server checks `base_version` against the current `version` in the actual table. If they differ, a conflict is detected and the commit is rejected.

For `VirtualLinkSegment` DELETEs triggered by flat-mode delete (Section 2.5), the `base_version` is set to the current `version` of the segment at the time the flat-mode delete is recorded. If another session modifies the segment between the flat-mode delete and the commit, the conflict is detected.

### 6.4 `ON DELETE CASCADE` behaviour at commit

When a `DataLink` DELETE is applied to `data_links`, the DB's `ON DELETE CASCADE` on `virtual_link_segments.actual_link_system_id` automatically deletes all virtual segments for that link from `virtual_link_segments`. This means the server does not need to explicitly apply the `VirtualLinkSegment` DELETE operations for segments that are cascade-deleted — they are handled by the DB.

However, the `VirtualLinkSegment` DELETE operations are still recorded in `edit_actions` (for audit trail and undo/redo purposes). The commit orchestrator should apply them in the correct order (segments before actual link) to avoid FK constraint violations during the commit transaction.

---

## 7) Cascade Behaviour Summary

| Trigger | Mechanism | Scope |
|---------|-----------|-------|
| Actual link deleted from `data_links` | `ON DELETE CASCADE` on `virtual_link_segments.actual_link_system_id` | All committed virtual segments for that link |
| File deleted from `arc_db_files` | `ON DELETE CASCADE` on `data_links.file_system_id` and `virtual_link_segments.file_system_id` | All actual links and virtual segments for the file |
| Node deleted from `nodes` | `ON DELETE CASCADE` on `data_links.source_node_system_id` / `destination_node_system_id` and `virtual_link_segments.source_node_system_id` / `destination_node_system_id` | All actual links and virtual segments referencing that node |
| Flat-mode delete (pending) | Application code records `edit_actions` DELETEs for actual link + all its segments | Pending state only; committed state handled by DB cascade at commit time |
| Subsystem-mode delete (pending) | Application code records `edit_actions` DELETE for the segment only; cascade to actual link deferred to resolution time | Pending state only |

---

## 8) One-Connection-Per-Port Enforcement

### 8.1 At `POST /virtual-links` time

Before inserting a new virtual segment, the server checks:

1. **Source port outgoing constraint:** Is there already a virtual segment (in `virtual_link_segments` OR in `edit_actions` as a pending CREATE) with `source_port_system_id = newSegment.sourcePortSystemId` and `file_system_id = newSegment.fileSystemId`?

2. **Destination port incoming constraint:** Is there already a virtual segment with `destination_port_system_id = newSegment.destinationPortSystemId` and `file_system_id = newSegment.fileSystemId`?

If either check fails, return `422 Unprocessable Entity` with a message identifying the conflicting port.

### 8.2 Why pending segments must also be checked

The unique indices on `virtual_link_segments` only cover committed rows. Pending segments in `edit_actions` are not covered by DB-level constraints. The application must check both the committed table and the `edit_actions` overlay before inserting.

This is the same pattern used for other uniqueness constraints in the modification framework (e.g., checking `naturalKeyHash` uniqueness for data links).

---

## 9) Port Identity in Virtual Segments

As described in the design document (Section 2, Port Ownership), virtual link segments do not introduce new port entities. Both `source_port_system_id` and `destination_port_system_id` always reference existing `data_ports` rows that belong to module nodes.

The mapping for a chain `ModuleA (port PA) → SubsystemX → SubsystemY → ModuleB (port PB)`:

| Segment | `source_node` | `dest_node` | `source_port` | `dest_port` |
|---------|--------------|------------|--------------|------------|
| S1 | ModuleA | SubsystemX | PA | PA |
| S2 | SubsystemX | SubsystemY | PA | PB |
| S3 | SubsystemY | ModuleB | PB | PB |

**Consequence for chain resolution:** The actual link's endpoints are extracted directly from the first and last segments:
- `sourcePortSystemId` = S1's `source_port_system_id` = PA
- `destinationPortSystemId` = S3's `destination_port_system_id` = PB

No additional lookup is needed.

**Consequence for the one-connection-per-port constraint:** The constraint is checked on `source_port_system_id` and `destination_port_system_id`. Since PA appears as both `source_port` of S1 and `source_port` of S2, and PB appears as both `dest_port` of S2 and `dest_port` of S3, the constraint must be applied carefully:

- For S1: check that PA has no other outgoing segment (as source port).
- For S2: check that PA has no other outgoing segment AND PB has no other incoming segment.
- For S3: check that PB has no other incoming segment.

The constraint prevents a port from being the source of two different segments or the destination of two different segments. It does not prevent a port from appearing as both source and destination in different segments of the same chain (which is the normal case for transit segments like S2).

---

*End of Document*