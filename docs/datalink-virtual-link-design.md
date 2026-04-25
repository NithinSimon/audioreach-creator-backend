<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Data Links & Virtual Links: Design Document

**Related Documents:**
- `modification-framework/modification-framework-design.md` — Session lifecycle, `edit_actions` schema, payload strategy
- `read-overlay-design.md` — Read overlay pattern, `EditActionsQueryService`, `OverlayMerge`
- `subgraph-kv-usecase-creation/subgraph-routing-lld.md` — Routing algorithm that consumes actual links

---

## 1) Context & Goals

### The Dual-Representation Problem

A data link between two modules has two visual representations depending on the user's active view mode:

**Flat mode** (subsystems not shown): the link appears as a direct connection between two module nodes. The client identifies it by `data_links.system_id`.

**Subsystem mode** (subsystems shown as opaque blocks): the same underlying connection appears as a chain of *virtual link segments* that cross subsystem boundaries. For example, a link from ModuleA (inside SubsystemX) to ModuleB (inside SubsystemY) appears as three segments:

```
ModuleA → SubsystemX  →  SubsystemX → SubsystemY  →  SubsystemY → ModuleB
```

Each segment is a separate visual element with its own identity. The user can add or delete individual segments.

Multiple users can connect to the same project simultaneously. One user may work in flat mode while another works in subsystem mode on a different usecase (locking prevents two users from editing the same usecase). Both users must be able to add and delete links using IDs that are meaningful in their view, while the server maintains a single consistent source of truth.

### Domain Constraint

**Subsystems are UX metadata, not domain entities.** The final data written to the device contains only actual module-to-module links. Subsystems exist solely to help users organise and navigate large graphs. Virtual link segments exist solely to support the subsystem view. They are derived from or resolved into actual links.

### Goals

1. Store only actual module-to-module links permanently in `data_links`.
2. Store virtual link segments permanently in a new `virtual_link_segments` table, linked to their actual link after resolution.
3. Virtual links are the **source of truth during editing** — actual links are derived from complete virtual chains at resolution time, not staged independently.
4. Both flat-mode and subsystem-mode clients use stable IDs: flat mode uses `data_links.system_id`; subsystem mode uses `virtual_link_segments.system_id`.
5. Incomplete virtual chains are discarded at commit; they never produce actual links.
6. The `auto-create-usecases` routing algorithm always operates on actual links.

---

## 2) Key Concepts

### What is a Virtual Link Segment?

A virtual link segment is a directed connection between two nodes where at least one node is a subsystem. The possible segment types are:

- **Module → Subsystem**: the source is a module inside a subsystem, the destination is the subsystem node itself. This is the "entry" segment of a chain.
- **Subsystem → Subsystem**: both nodes are subsystems. This is a "transit" segment crossing from one subsystem to another.
- **Subsystem → Module**: the source is a subsystem node, the destination is a module inside a subsystem. This is the "exit" segment of a chain.
- **Module → Module**: both nodes are modules. This is a degenerate case — it is identical to an actual link and is treated as a complete single-segment chain.

### What is a Chain?

A chain is a sequence of virtual link segments that forms a complete path from a module node to another module node, passing through zero or more subsystem nodes. A chain is **complete** when:

- The first segment's source node is a module.
- The last segment's destination node is a module.
- Each segment's destination node equals the next segment's source node (the path is connected).

A chain is **incomplete** if any of these conditions are not met — for example, if the user has drawn only part of the path.

### Relationship Between Chains and Actual Links

Each complete chain corresponds to exactly one actual link. The actual link connects the module at the start of the chain to the module at the end of the chain, using the ports at those endpoints.

After resolution, all segments in a chain have their `actual_link_system_id` column set to the `system_id` of the actual link they belong to. This FK is the permanent grouping mechanism — no separate chain ID is needed.

### Port Ownership

Virtual link segments reference the same `data_ports` rows as actual links. A subsystem does not have its own port entities in the DB. Both the source and destination port columns on a virtual link segment reference the port of the module that is the physical endpoint of the connection at that boundary.

For a chain `ModuleA → SubsystemX → SubsystemY → ModuleB` where ModuleA's output port is `PA` and ModuleB's input port is `PB`:

- Segment `ModuleA → SubsystemX`: `source_port = PA`, `destination_port = PA`. The subsystem is the destination node, but the port identity is `PA` — the port on ModuleA that faces the SubsystemX boundary.
- Segment `SubsystemX → SubsystemY`: `source_port = PA`, `destination_port = PB`. The source port is the outgoing boundary port of SubsystemX (which is `PA`, ModuleA's port) and the destination port is the incoming boundary port of SubsystemY (which is `PB`, ModuleB's port).
- Segment `SubsystemY → ModuleB`: `source_port = PB`, `destination_port = PB`. The subsystem is the source node, but the port identity is `PB` — the port on ModuleB that faces the SubsystemY boundary.

A practical consequence: the actual link's `source_port_system_id` and `destination_port_system_id` are directly readable from the first and last segments of the chain respectively, without any additional lookup.

---

## 3) Data Design

### `data_links` (existing table — no schema changes)

The existing `data_links` table stores actual module-to-module links. Its schema is unchanged:

| Column | Description |
|--------|-------------|
| `system_id` | Primary key, pre-assigned by `IdGenerationPort` |
| `source_node_system_id` | FK to `nodes` — always a module node |
| `destination_node_system_id` | FK to `nodes` — always a module node |
| `source_port_system_id` | FK to `data_ports` |
| `destination_port_system_id` | FK to `data_ports` |
| `is_inter_graph` | Whether the link crosses subgraph boundaries |
| `natural_key_hash` | Unique hash per file for deduplication |
| `file_system_id` | FK to `arc_db_files` |

No `chain_id` column is added to `data_links`. The grouping between actual links and virtual segments is expressed by the FK on `virtual_link_segments.actual_link_system_id`.

### `virtual_link_segments` (new permanent table)

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `system_id` | INTEGER | NOT NULL | Primary key, pre-assigned by `IdGenerationPort` |
| `actual_link_system_id` | INTEGER | NULL | FK to `data_links(system_id)` ON DELETE CASCADE. Null until the chain is resolved at commit/resolution time. After resolution, all segments in the same chain share the same value here. |
| `source_node_system_id` | INTEGER | NOT NULL | FK to `nodes` — may be a module or subsystem node |
| `destination_node_system_id` | INTEGER | NOT NULL | FK to `nodes` — may be a module or subsystem node |
| `source_port_system_id` | INTEGER | NOT NULL | FK to `data_ports` |
| `destination_port_system_id` | INTEGER | NOT NULL | FK to `data_ports` |
| `file_system_id` | INTEGER | NOT NULL | FK to `arc_db_files` ON DELETE CASCADE |
| `version` | INTEGER | NOT NULL | Incremented on each update; used for optimistic locking |

**Indices:**
- `idx_vls_file` on `(file_system_id)` — fetch all segments for a file
- `idx_vls_actual_link` on `(actual_link_system_id)` — find all segments for an actual link (used for cascade delete)
- `idx_vls_source_port` on `(source_port_system_id, file_system_id)` — enforce the one-connection-per-port constraint
- `idx_vls_dest_port` on `(destination_port_system_id, file_system_id)` — enforce the one-connection-per-port constraint

**The `ON DELETE CASCADE` on `actual_link_system_id`**: when an actual link is deleted from `data_links`, all its virtual segments are automatically deleted from `virtual_link_segments`. This handles the committed-state cascade for flat-mode deletes.

### Entity Names

`VirtualLinkSegment` is added to `ENTITY_NAMES` in `entity-table-names.ts`. This allows `edit_actions.table_name` to reference virtual link segments using the same pattern as all other entities.

---

## 4) Invariants & Constraints

### Invariant 1: One connection per subsystem port

A subsystem port (a `data_ports` row whose `node_system_id` references a subsystem node) may have at most one incoming virtual link segment and at most one outgoing virtual link segment within a given file.

This is enforced at `POST /virtual-links` time by checking the `virtual_link_segments` table (including the `edit_actions` overlay for the active session) before inserting. If the source port already has an outgoing segment or the destination port already has an incoming segment, the request is rejected with `422`.

**Why this matters:** if a subsystem port were shared between two chains, deleting a segment that uses that port would break both chains and delete two actual links. The one-connection constraint ensures each segment belongs to exactly one chain, so deleting a segment always affects exactly one actual link.

This constraint is also semantically correct for audio signal processing: a physical port carries one signal.

### Invariant 2: Virtual links are the source of truth

Actual links are never staged independently for connections created in subsystem mode. They are always derived from complete virtual chains at resolution time. This means:

- `edit_actions` for subsystem-mode connections contains only `VirtualLinkSegment` CREATE/DELETE operations during editing. A `DataLink` CREATE is only added to `edit_actions` by the server at resolution time (when the chain is found to be complete), never by the client directly.
- `DataLink` CREATE operations in `edit_actions` appear in two cases: (a) flat-mode connections, where the server creates the actual link directly in response to `POST /data-links`; and (b) subsystem-mode connections that have been resolved, where the server creates the actual link as part of the resolution algorithm.

### Invariant 3: Incomplete chains are discarded at commit

If a virtual chain is incomplete at commit time (no complete module-to-module path), its segments are not written to `virtual_link_segments`. The user is warned about discarded segments.

### Invariant 4: `actual_link_system_id` is null until resolution (subsystem-mode segments only)

Virtual link segments created in subsystem mode (via `POST /virtual-links`) have `actual_link_system_id = null` in `edit_actions` until the chain is resolved at `GET /components?showSubsystems=false` or at commit time.

Virtual link segments auto-created by the server when a flat-mode link is added (Workflow B) are an exception: because the actual link's `system_id` is pre-assigned before the segments are created, `actual_link_system_id` is set immediately on those segments. They are never in an unresolved state.

---

## 5) API Design

### Existing endpoints (unchanged behaviour)

**`POST /arc-api/v1/projects/{projectId}/data-links`**
Creates an actual link in flat mode. Behaviour is extended: after creating the `DataLink` `edit_actions` row, the server checks `nodes.parentId` for both endpoints. If they belong to different subsystems, the server automatically creates `VirtualLinkSegment` `edit_actions` rows for the crossing segments. The actual link's pre-assigned `system_id` is written into `actual_link_system_id` on these auto-created segments immediately (since the ID is known at creation time).

**`DELETE /arc-api/v1/projects/{projectId}/data-links/{systemId}`**
Deletes an actual link. Extended behaviour: the server also records `VirtualLinkSegment` DELETE operations in `edit_actions` for all segments in `virtual_link_segments` where `actual_link_system_id = systemId`. Both the actual link DELETE and the segment DELETEs are grouped under the same `group_id` in `edit_actions`.

### New endpoints

**`POST /arc-api/v1/projects/{projectId}/virtual-links`**

Adds a virtual link segment. Request body:
- `sourceNodeSystemId` — node ID (module or subsystem)
- `destinationNodeSystemId` — node ID (module or subsystem)
- `sourcePortSystemId` — port ID
- `destinationPortSystemId` — port ID

Server behaviour:
1. Validates the one-connection-per-port constraint (see Invariant 1). Returns `422` if violated.
2. Pre-assigns a `system_id` via `IdGenerationPort`.
3. Creates a `VirtualLinkSegment` CREATE operation in `edit_actions` with `actual_link_system_id = null`.
4. Returns the new segment's `system_id`.

No chain detection is performed at this point. The server simply stores the segment.

**`DELETE /arc-api/v1/projects/{projectId}/virtual-links/{systemId}`**

Deletes a virtual link segment. The `systemId` may refer to:
- A segment in `virtual_link_segments` (committed in a previous session), or
- A segment in `edit_actions` (added in the current session, not yet committed).

Server behaviour:
1. Records a `VirtualLinkSegment` DELETE operation in `edit_actions`.
2. Does **not** immediately cascade to the actual link. Chain breakage is detected at resolution time (commit or `GET /components?showSubsystems=false`).

### Modified endpoint

**`GET /arc-api/v1/projects/{projectId}/usecases/{usecaseId}/components?showSubsystems={bool}`**

The existing `GET /components` endpoint gains a `showSubsystems` query parameter (boolean, default `false`).

**When `showSubsystems=true`:**
- Returns subsystem nodes, virtual link segments, and modules as separate items.
- Virtual link segments are returned from `virtual_link_segments` with the `edit_actions` overlay applied (pending CREATEs included, pending DELETEs excluded).
- No resolution is triggered. The response reflects the current pending state exactly.
- Pending virtual segments that have `actual_link_system_id = null` are included — they are unresolved but visible.

**When `showSubsystems=false`:**
- The server must return actual links with stable `system_id` values.
- **Fast path**: if all virtual link segments in the current view (from `virtual_link_segments` + `edit_actions` overlay) already have `actual_link_system_id` set, the server returns actual links directly. No side effects.
- **Slow path**: if any segments have `actual_link_system_id = null`, the server internally runs the chain resolution algorithm:
  - Traverses the virtual segment graph to find complete chains.
  - For each complete chain: pre-assigns a `system_id` for the actual link, creates a `DataLink` CREATE operation in `edit_actions` (STAGED), and sets `actual_link_system_id` on the corresponding `VirtualLinkSegment` `edit_actions` rows.
  - If incomplete chains remain after resolution: returns `422` with the list of incomplete chain endpoint pairs (source module port, destination module port) so the client can inform the user which virtual links need to be completed or deleted before switching to flat mode.
  - If all chains are resolved: returns actual links including the newly resolved ones.

The resolved actual links are staged immediately (not unstaged). The rationale: the user has already implicitly approved the connection by completing the virtual chain. Resolution is materialising what they already drew.

---

## 6) Workflows

### Workflow A: Add a link in flat mode — both modules in the same subsystem

The user creates a link between ModuleA and ModuleB, both of which are inside SubsystemX.

1. Client calls `POST /data-links` with ModuleA and ModuleB as endpoints.
2. Server creates a `DataLink` CREATE operation in `edit_actions`.
3. Server checks `nodes.parentId` for both modules: same subsystem → no boundary crossing.
4. No virtual segments are created.
5. At commit: the actual link is written to `data_links`. No rows in `virtual_link_segments`.

### Workflow B: Add a link in flat mode — modules in different subsystems

The user creates a link between ModuleA (inside SubsystemX) and ModuleB (inside SubsystemY).

1. Client calls `POST /data-links` with ModuleA and ModuleB as endpoints. The actual link's `system_id` is pre-assigned (e.g., `L1`).
2. Server creates a `DataLink` CREATE operation in `edit_actions` for `L1`.
3. Server checks `nodes.parentId`: different subsystems → boundary crossing detected.
4. Server auto-creates three `VirtualLinkSegment` CREATE operations in `edit_actions`:
   - Segment S1: `ModuleA → SubsystemX` (source port = ModuleA's output port, dest port = ModuleA's output port)
   - Segment S2: `SubsystemX → SubsystemY` (source port = ModuleA's output port, dest port = ModuleB's input port)
   - Segment S3: `SubsystemY → ModuleB` (source port = ModuleB's input port, dest port = ModuleB's input port)
   - All three have `actual_link_system_id = L1` (already known).
5. At commit: `L1` is written to `data_links`; S1, S2, S3 are written to `virtual_link_segments` with `actual_link_system_id = L1`.

### Workflow C: Add a link in subsystem mode — step by step

The user is in subsystem mode and draws a connection from ModuleA (inside SubsystemX) to ModuleB (inside SubsystemY) by drawing three segments.

1. Client calls `POST /virtual-links` for segment `ModuleA → SubsystemX`. Server stores S1 in `edit_actions` with `actual_link_system_id = null`. Returns `system_id = S1`.
2. Client calls `POST /virtual-links` for segment `SubsystemX → SubsystemY`. Server stores S2 in `edit_actions` with `actual_link_system_id = null`. Returns `system_id = S2`.
3. Client calls `POST /virtual-links` for segment `SubsystemY → ModuleB`. Server stores S3 in `edit_actions` with `actual_link_system_id = null`. Returns `system_id = S3`.
4. No actual link exists yet. The chain is complete but unresolved.
5. When the user calls `GET /components?showSubsystems=false` (or at commit), the server detects the complete chain S1→S2→S3, creates actual link `L1` in `edit_actions` (STAGED), and sets `actual_link_system_id = L1` on S1, S2, S3.

### Workflow D: Add a link in subsystem mode — nested subsystems

ModuleA is inside SubsystemX, which is itself inside SubsystemZ. ModuleB is inside SubsystemY.

The user draws four segments:
- `ModuleA → SubsystemX`
- `SubsystemX → SubsystemZ`
- `SubsystemZ → SubsystemY`
- `SubsystemY → ModuleB`

The chain traversal at resolution time finds the complete path ModuleA → SubsystemX → SubsystemZ → SubsystemY → ModuleB and creates one actual link. Nesting depth is handled naturally — it just produces more segments in the chain.

### Workflow E: Delete a link in flat mode

The user deletes actual link `L1` (ModuleA → ModuleB), which has virtual segments S1, S2, S3 in `virtual_link_segments`.

1. Client calls `DELETE /data-links/L1`.
2. Server records a `DataLink` DELETE operation in `edit_actions` for `L1`.
3. Server queries `virtual_link_segments` for all rows where `actual_link_system_id = L1` → finds S1, S2, S3.
4. Server records `VirtualLinkSegment` DELETE operations in `edit_actions` for S1, S2, S3.
5. All four DELETE operations share the same `group_id` in `edit_actions`.
6. At commit: `L1` is deleted from `data_links`. The `ON DELETE CASCADE` on `virtual_link_segments.actual_link_system_id` automatically deletes S1, S2, S3 from `virtual_link_segments`.

### Workflow F: Delete a virtual link segment in subsystem mode (committed segment)

The user deletes segment S2 (`SubsystemX → SubsystemY`), which is in `virtual_link_segments` with `actual_link_system_id = L1`.

1. Client calls `DELETE /virtual-links/S2`.
2. Server records a `VirtualLinkSegment` DELETE operation in `edit_actions` for S2.
3. No immediate cascade. The actual link `L1` is not touched yet.
4. At resolution time (next `GET /components?showSubsystems=false` or commit): the server re-traverses the virtual segment graph. The chain is now broken (S1 ends at SubsystemX, but S2 is deleted, so there is no path from SubsystemX to SubsystemY). The server records a `DataLink` DELETE operation in `edit_actions` for `L1`. The server also records `VirtualLinkSegment` DELETE operations in `edit_actions` for S1 and S3 (they are now orphaned — part of a broken chain with no corresponding actual link). All three DELETE operations share the same `group_id`.
5. At commit: `L1` is deleted from `data_links`; S1, S2, S3 are deleted from `virtual_link_segments`.

### Workflow G: Delete a virtual link segment in subsystem mode (pending segment, not yet committed)

The user added segment S2 in the current session (it is in `edit_actions` as a CREATE, not yet in `virtual_link_segments`). The user then deletes it.

1. Client calls `DELETE /virtual-links/S2`.
2. Server supersedes the CREATE operation for S2 in `edit_actions` (sets `valid_until` on the CREATE row, per the modification framework's versioning pattern).
3. S2 is effectively removed from the pending state.
4. At resolution time: the chain is incomplete (S1 and S3 exist but S2 is gone). No actual link is created. S1 and S3 are discarded.

### Workflow H: Switch from subsystem mode to flat mode — incomplete chain

The user has drawn only segment S1 (`ModuleA → SubsystemX`) and tries to switch to flat mode by calling `GET /components?showSubsystems=false`.

1. Server runs the slow path: traverses the virtual segment graph.
2. S1 is a dead end — SubsystemX has no outgoing segment. The chain is incomplete.
3. Server returns `422` with the incomplete chain details: "Incomplete virtual link starting at ModuleA (port P1). Please complete or delete this connection before switching to flat mode."
4. The user deletes S1 via `DELETE /virtual-links/S1`.
5. The user calls `GET /components?showSubsystems=false` again.
6. No incomplete chains remain. The server returns the flat-mode view successfully.

### Workflow I: Switch from subsystem mode to flat mode — complete chain

The user has drawn the full chain S1→S2→S3 and calls `GET /components?showSubsystems=false`.

1. Server runs the slow path: traverses the virtual segment graph.
2. Finds complete chain: ModuleA → SubsystemX → SubsystemY → ModuleB.
3. Pre-assigns `system_id = L1` for the actual link.
4. Creates a `DataLink` CREATE operation in `edit_actions` (STAGED) for `L1`.
5. Updates S1, S2, S3 in `edit_actions` to set `actual_link_system_id = L1`.
6. Returns the flat-mode view including `L1` with its stable `system_id`.
7. The user can now delete `L1` using `DELETE /data-links/L1` (flat mode delete, Workflow E).

### Workflow J: Read overlay during a session

During an active session, the read overlay for links works as follows:

**Subsystem mode (`showSubsystems=true`):**
- Base rows: all rows from `virtual_link_segments` for the file.
- Overlay: apply `edit_actions` for `VirtualLinkSegment` (CREATEs add new segments, DELETEs remove them, UPDATEs merge partial payloads).
- Pending segments with `actual_link_system_id = null` are included — they are unresolved but visible to the user.
- No usecase filtering is applied to pending segments. Pending virtual links cannot be mapped to usecases until `auto-create-usecases` is run.

**Flat mode (`showSubsystems=false`):**
- Base rows: all rows from `data_links` for the file.
- Overlay: apply `edit_actions` for `DataLink` (CREATEs add new links, DELETEs remove them).
- Resolved actual links (created during the slow path of this request) are included via the `edit_actions` overlay.

### Workflow K: `auto-create-usecases` integration

The routing algorithm in `auto-create-usecases` operates on actual links. Before running the algorithm, the server ensures all virtual chains are resolved:

1. Server runs the chain resolution algorithm (same as the slow path of `GET /components?showSubsystems=false`).
2. If incomplete chains exist: returns `422` — the user must fix them before routing can proceed.
3. If all chains are resolved: the routing algorithm reads actual links from `data_links` + `edit_actions` overlay (standard read overlay pattern) and proceeds normally.

### Workflow L: Commit

At commit time, the server applies all staged `edit_actions` to the actual tables:

1. `DataLink` CREATE operations → written to `data_links`.
2. `VirtualLinkSegment` CREATE operations with `actual_link_system_id` set → written to `virtual_link_segments`.
3. `VirtualLinkSegment` CREATE operations with `actual_link_system_id = null` (incomplete chains) → discarded. Not written to `virtual_link_segments`. The user is warned.
4. `DataLink` DELETE operations → deleted from `data_links`. `ON DELETE CASCADE` removes corresponding `virtual_link_segments` rows.
5. `VirtualLinkSegment` DELETE operations → deleted from `virtual_link_segments`.

After commit, `data_links` and `virtual_link_segments` are in sync: every actual link that was created via subsystem mode has corresponding virtual segments with `actual_link_system_id` set.

---

## 7) Multi-User Scenarios

Users are locked at the usecase level — two users cannot edit the same usecase simultaneously. This prevents direct conflicts on the same link.

**User A (flat mode) and User B (subsystem mode) on different usecases:**
- User A deletes actual link `L1` (in UseCase1). This is recorded in `edit_actions` for User A's session.
- User B adds virtual segments for a new connection in UseCase2. These are recorded in `edit_actions` for User B's session.
- No conflict. Each session's `edit_actions` is scoped to that session.

**Consistency after commit:**
- When User A commits, `L1` is deleted from `data_links` and its virtual segments are cascade-deleted from `virtual_link_segments`.
- When User B later opens the project in subsystem mode, the deleted link is gone from both views.

---

## 8) Architecture Decision Records (ADRs)

### ADR-VL-001: Virtual links as permanent DB rows (not session-scoped)

**Context:** Virtual link segments need to be visible to any user who opens the project in subsystem mode, including after a session ends.

**Decision:** `virtual_link_segments` is a permanent table, not a session-scoped table. Segments are written at commit time and persist until explicitly deleted.

**Alternatives considered:**
- Session-scoped table (deleted when session ends): segments would be lost after commit, requiring re-derivation from actual links + node hierarchy on every subsystem-mode open. This adds server complexity and loses the user's explicit segment layout.
- Derive at read time only (no permanent storage): same problem as session-scoped, plus the derivation logic must run on every read.

**Rationale:** Permanent storage is the simplest approach that preserves the user's intent. The segments are small rows and the table is not expected to grow large.

**Status:** Accepted

---

### ADR-VL-002: Virtual links as source of truth; actual links derived at resolution

**Context:** When a user adds connections in subsystem mode, the server receives virtual segments one at a time. The actual link can only be determined when the chain is complete.

**Decision:** Virtual link segments are the source of truth during editing. Actual links are derived from complete chains at resolution time (`GET /components?showSubsystems=false` or commit). Actual links are never staged independently for subsystem-mode connections.

**Alternatives considered:**
- Stage actual links immediately when chain is complete (detect completion on every `POST /virtual-links`): adds O(n) graph traversal on every add call; creates a tight coupling between add and chain detection.
- Client-owned virtual links (client translates to actual links before calling API): pushes all chain management to the client; client must buffer partial chains across interactions; error-prone.

**Rationale:** Deferring resolution to a well-defined point (flat-mode read or commit) keeps the server simple during editing and avoids premature chain detection. The client has full data and can show the user the partial chain state without server involvement.

**Status:** Accepted

---

### ADR-VL-003: Resolution triggered by `GET /components?showSubsystems=false`

**Context:** There is no explicit "switch mode" API call. The mode switch is a client-side UI action. The server needs a trigger point for chain resolution.

**Decision:** Resolution is triggered implicitly when the client requests the flat-mode view (`GET /components?showSubsystems=false`). If unresolved segments exist, the server runs the resolution algorithm as a side effect of the GET request. If incomplete chains are found, the request returns `422`.

**Alternatives considered:**
- Separate `POST /resolve-virtual-links` endpoint: semantically cleaner (POST for side effects) but adds an extra round-trip and a new endpoint that clients must call explicitly before switching modes.
- Resolution only at commit: the flat-mode user would not see newly resolved actual links until commit, making the session state inconsistent.

**Trade-off:** The GET has a write side effect (creates `edit_actions` rows). This violates HTTP safety semantics. This is accepted as a pragmatic trade-off: the resolution is idempotent and deterministic, and it is triggered by an explicit user action (mode switch).

**Status:** Accepted

---

### ADR-VL-004: One-connection-per-subsystem-port constraint

**Context:** If a subsystem port is shared between two chains, deleting a segment that uses that port would break both chains and delete two actual links unexpectedly.

**Decision:** A subsystem port may have at most one incoming and one outgoing virtual link segment within a file. This is enforced at `POST /virtual-links` time.

**Rationale:** This constraint is also semantically correct for audio signal processing — a physical port carries one signal. Enforcing it at the API level prevents ambiguous chain membership and ensures that deleting a segment always affects exactly one actual link.

**Status:** Accepted

---

### ADR-VL-005: No `chain_id` column

**Context:** An earlier design iteration used a `chain_id` UUID to group virtual segments belonging to the same chain.

**Decision:** No `chain_id` column. The `actual_link_system_id` FK on `virtual_link_segments` is sufficient to group segments after resolution. During the session, segments are individual rows; the server traverses the graph at resolution time to find complete chains.

**Rationale:** `chain_id` would need to be managed by either the client or the server during the session, adding complexity. Since the one-connection-per-port constraint ensures each segment belongs to at most one chain, graph traversal at resolution time is unambiguous and O(n) where n is the number of segments (typically small).

**Status:** Accepted

---

## 9) Integration with Modification Framework

Virtual link segments integrate with the existing modification framework as follows:

**`edit_actions` usage:**
- `table_name = 'VirtualLinkSegment'` for virtual link segment operations.
- `operation = 'CREATE'` when a segment is added.
- `operation = 'DELETE'` when a segment is deleted.
- `system_id` = the segment's pre-assigned `system_id`.
- `aggregate_id` = the segment's own `system_id` (segments are top-level entities, not children of an aggregate).
- `payload` = full segment row for CREATE; `{}` for DELETE.
- `base_version` = null for CREATE; the segment's current `version` for DELETE (optimistic locking).

**Read overlay:**
- `EditActionsQueryService.getByTable(sessionId, ENTITY_NAMES.VirtualLinkSegment)` fetches all pending segment changes.
- `OverlayMerge.applyToCollection(baseSegments, segmentActions)` merges them with committed segments.

**Commit orchestration:**
- Virtual link segment CREATEs and DELETEs are applied in the same topological order as other entities.
- Incomplete chain segments (CREATEs with `actual_link_system_id = null` at commit time) are discarded before the commit transaction begins.
- The actual link CREATE (for resolved chains) is applied before the virtual segment CREATEs (forward dependency order: actual link must exist before segments reference it via FK).

**Undo/redo:**
- The `valid_until` mechanism in `edit_actions` handles undo/redo for virtual segments.
- Undoing a segment add restores the previous state (the CREATE is superseded).
- Undoing a segment delete restores the segment (the DELETE is superseded).
- If undoing a segment add causes a previously complete chain to become incomplete, the corresponding actual link CREATE (if it was created during resolution) is also superseded. These operations should share a `group_id` so they are undone together.

---

## 10) Scenario Reference Table

| Scenario | Client action | Server action | Resolution point |
|----------|--------------|---------------|-----------------|
| Add link, flat mode, same subsystem | `POST /data-links` | Create DataLink in `edit_actions`; no virtual segments | Commit |
| Add link, flat mode, different subsystems | `POST /data-links` | Create DataLink + VirtualLinkSegments in `edit_actions`; `actual_link_system_id` set immediately | Commit |
| Add segment, subsystem mode | `POST /virtual-links` | Create VirtualLinkSegment in `edit_actions`; `actual_link_system_id = null` | Deferred |
| Delete link, flat mode | `DELETE /data-links/{id}` | Delete DataLink + all VirtualLinkSegments for that link in `edit_actions` | Commit |
| Delete segment, subsystem mode (committed) | `DELETE /virtual-links/{id}` | Delete VirtualLinkSegment in `edit_actions`; no immediate cascade | Resolution time |
| Delete segment, subsystem mode (pending) | `DELETE /virtual-links/{id}` | Supersede the CREATE in `edit_actions` | N/A |
| Switch to flat mode, complete chain | `GET /components?showSubsystems=false` | Resolve chains; create DataLink in `edit_actions` (STAGED); set `actual_link_system_id` | Immediate (slow path) |
| Switch to flat mode, incomplete chain | `GET /components?showSubsystems=false` | Return `422` with incomplete chain details | Blocked |
| Read in subsystem mode | `GET /components?showSubsystems=true` | Return VirtualLinkSegments with overlay; no resolution | N/A |
| Commit | `POST /commit-changes` | Apply all staged changes; discard incomplete chains | Commit |

---

*End of Document*