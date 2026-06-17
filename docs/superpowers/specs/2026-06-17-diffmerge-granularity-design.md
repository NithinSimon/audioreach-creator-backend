<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# DiffMerge Field-Level Granularity — Design Spec

**Date:** 2026-06-17
**Status:** Draft
**Owner:** Nithin Simon

**Related Documents:**
- `docs/modification-framework/modification-framework-design.md` — DB schema, session lifecycle, edit_actions table
- `docs/read-overlay-design.md` — Read-overlay pattern
- `docs/superpowers/specs/2026-06-11-modification-framework-design.md` — Module SET APIs and EntityStagingService

---

## 1. Scope

This document covers:

- The DiffMerge use case and why the current modification framework's row-level granularity is insufficient
- The `field_group` column extension to `edit_actions` that enables field-level staging granularity
- How Designer mode and DiffMerge mode each use the modification framework
- The new DiffMerge write API and change summary API
- The `DiffMergeChangeSummaryDto` contract

**Out of scope:**
- Conflict resolution for DiffMerge (deferred)
- Undo/redo in DIFF_MERGE mode
- Any change to DESIGNER, TUNING, or DISCOVERY_WIZARD mode behaviour
- The diff algorithm itself (owned by the diff-compare tool)

---

## 2. Background

### 2.1 The edit_actions Table

The modification framework uses `edit_actions` as a pending-change store. Every change in an active session is written here before being committed to actual tables. Key columns:

| Column | Description |
|---|---|
| `change_id` | Primary key; the client-facing handle for staging operations |
| `system_id` | The entity being changed |
| `aggregate_id` | The aggregate root (enables one-scan read overlay per aggregate) |
| `session_id` | Which active session owns this change |
| `field_group` | **NEW** (§4) — identifies an independently-stageable unit within an entity |
| `operation` | `CREATE` / `UPDATE` / `DELETE` |
| `payload` | JSON: full row for CREATE, partial for UPDATE, empty for DELETE |
| `change_status` | `STAGED` or `UNSTAGED` |
| `base_version` | Entity version at first update; used for optimistic locking at commit |
| `valid_until` | `NULL` = current version; set when superseded (undo/redo chain) |

The critical uniqueness constraint — enforcing one active row per entity per session:

```sql
CREATE UNIQUE INDEX uniq_edit_actions_current
  ON edit_actions(session_id, system_id)
  WHERE valid_until IS NULL;
```

### 2.2 Designer Mode: Accumulated UPDATE Pattern

In DESIGNER mode, users call SET APIs one at a time. Each call routes through `EntityStagingService.stageEntityDelta`, which implements the accumulated UPDATE pattern:

1. Look up the existing active `edit_action` for this entity (if any)
2. If none: INSERT new row with the partial delta and `base_version` from the actual table
3. If existing UPDATE: merge new delta into accumulated payload → supersede old row, INSERT new one
4. If existing CREATE: merge delta into the CREATE payload → supersede, INSERT updated CREATE

Example — user changes `alias` then `containerSystemId` on module M:

```
After alias change:
  C1: system_id=M, op=UPDATE, payload={alias:"Mod2"}, change_status=STAGED, valid_until=NULL

After containerSystemId change:
  C1: valid_until=T1  (superseded)
  C2: system_id=M, op=UPDATE, payload={alias:"Mod2", containerSystemId:200}, change_status=STAGED
```

One active row per entity. One `changeId` covers all pending changes for that entity. All changes are auto-STAGED.

### 2.3 Read Overlay

Both STAGED and UNSTAGED `edit_actions` (where `valid_until IS NULL`) are merged with actual table rows at query time via `OverlayMerge`. The merge rules:

| operation | Result |
|---|---|
| `CREATE` | Deserialise full payload → include as new entity |
| `UPDATE` | Merge partial payload over base row |
| `DELETE` | Exclude from results |
| (none) | Return base row as-is |

`OverlayMerge.applyToSingle` and `applyToCollection` currently assume **at most one** active `edit_action` per entity — guaranteed by the unique constraint in DESIGNER mode.

---

## 3. The DiffMerge Use Case

### 3.1 Three-Way Merge Workflow

DiffMerge is a tool-driven workflow where the user provides three files:

- **Reference** — the original baseline
- **Base** — the file as it has evolved from Reference
- **Target** — the file to receive selected changes

The diff-compare tool:

1. Computes `diff(Reference, Base)` — what changed from Reference to Base
2. Converts the diff into a set of logical change units
3. Opens a `DIFF_MERGE` session on the Target file
4. Applies those change units to Target as **UNSTAGED** `edit_actions`
5. Returns a `DiffMergeChangeSummaryDto` to the client

The DiffMerge UI displays all proposed changes with nothing selected by default. The user reviews, selects (stages) the changes they want, and commits. Unselected changes are discarded at session end.

```
[DiffMerge Tool]
  diff(Reference, Base)
       │
       ▼
[DIFF_MERGE Session on Target]
  write UNSTAGED edit_actions (field_group per logical unit)
       │
       ▼
[DiffMerge UI]
  GET /diff-merge/changes  → shows all proposed changes, nothing selected
       │
  User selects alias change
       ▼
  POST /stage-changes { changeIds: [501] }
       │
  User commits
       ▼
  POST /commit-changes  →  alias updated in Target, containerSystemId unchanged
```

### 3.2 Why the Current Design Breaks Down

If the diff produces two independent changes on `SpfModule M` — `alias` and `containerSystemId` — `stageEntityDelta` merges them into one accumulated row:

```
change_id=C1, system_id=M, payload={alias:"Mod2", containerSystemId:200}, change_status=UNSTAGED
```

One `changeId` covers both fields. The Stage API operates per `changeId`. The user cannot stage the alias change without simultaneously staging the containerSystemId change — **there is no row-level granularity**.

**Root cause:** `uniq_edit_actions_current` enforces one active row per `(session_id, system_id)`. This constraint forces accumulation by making it impossible to hold two active rows for the same entity.

---

## 4. Solution: field_group Discriminator

### 4.1 The Core Change

Add a `field_group TEXT` column to `edit_actions`. When `field_group` is non-null, the uniqueness constraint changes from per-entity to per-`(entity, field_group)`. This allows multiple active rows for the same entity in a session — each representing an independently-stageable unit.

**The server treats `field_group` as an opaque string.** It has no knowledge of field semantics. The diff-compare tool decides what is independent (separate `field_group` per logical unit) and what is atomic (one `field_group` covering multiple fields).

Examples:
- `"alias"` — single-field change; independently stageable
- `"containerSystemId"` — single-field change; independently stageable
- `"paramDefinition"` — multi-field atomic group; all fields staged together under one `changeId`

`field_group` is always `NULL` in DESIGNER mode. The accumulated UPDATE pattern and existing DESIGNER behaviour are entirely unaffected.

### 4.2 Schema Change

```sql
-- Add the new column
ALTER TABLE edit_actions ADD COLUMN field_group TEXT;

-- Drop the existing single constraint
DROP INDEX uniq_edit_actions_current;

-- DESIGNER mode: field_group IS NULL → one active row per entity (same semantics as before)
CREATE UNIQUE INDEX uniq_edit_actions_current_entity
  ON edit_actions(session_id, system_id)
  WHERE valid_until IS NULL AND field_group IS NULL;

-- DIFF_MERGE mode: field_group IS NOT NULL → one active row per (entity, field_group)
CREATE UNIQUE INDEX uniq_edit_actions_current_field_group
  ON edit_actions(session_id, system_id, field_group)
  WHERE valid_until IS NULL AND field_group IS NOT NULL;
```

All existing rows have `field_group = NULL` and continue to hit `uniq_edit_actions_current_entity`. No data migration required.

### 4.3 Supersede Logic Change

`EditActionsService.insertEditAction` currently supersedes any active row for `(session_id, system_id)`. With field-group rows it must scope the supersede to the same `field_group`:

```sql
-- field_group IS NULL (DESIGNER mode — unchanged semantics):
UPDATE edit_actions SET valid_until = NOW()
  WHERE session_id = ? AND system_id = ? AND valid_until IS NULL AND field_group IS NULL;

-- field_group = 'alias' (DIFF_MERGE mode):
UPDATE edit_actions SET valid_until = NOW()
  WHERE session_id = ? AND system_id = ? AND valid_until IS NULL AND field_group = 'alias';
```

Each field group maintains its own independent supersede chain. Activating (undo/redo) a row for `field_group = 'alias'` does not touch the `containerSystemId` row.

### 4.4 EntityStagingService: New Write Method

`stageEntityDelta` (DESIGNER mode) accumulates. A new method `stageDiffMergeChange` writes without accumulation with an explicit `field_group`:

```typescript
interface DiffMergeChangeSpec extends BaseEntityStagingSpec {
  fieldGroup: string;                   // required — logical change unit identifier
  delta: Record<string, unknown>;       // partial payload for UPDATE; full for CREATE
  operation: ChangeOperation;
}
```

This method:
1. Does **not** read or accumulate any existing row
2. Calls `EditActionsService.insertEditAction` with `field_group = spec.fieldGroup` and `change_status = UNSTAGED`
3. The supersede query (§4.3) scopes to the same `field_group`

### 4.5 OverlayMerge: Multiple Rows per Entity

`applyToSingle` and `applyToCollection` currently handle at most one active `edit_action` per entity. Both signatures are updated to accept a list of rows per entity:

**`applyToSingle(baseRow, editActions[])`** — merge rules for N rows:
- Any row is `DELETE` → return `null`
- Any row is `CREATE` → deserialise its payload and return
- All rows are `UPDATE` → merge all partial payloads over the base row (ordered by `change_id`)
- No rows → return base row as-is

**`applyToCollection(baseRows, editActions[])`** — group by `systemId`, apply `applyToSingle` per group.

This change is backward-compatible: when exactly one row exists per entity (DESIGNER mode), behaviour is identical to today.

---

## 5. Designer Mode — End to End

This section documents how DESIGNER mode works. **No changes from the existing design.**

```
POST /start-session { mode: "DESIGNER" }

  User: PATCH /spf-modules/M/alias { alias: "Mod2" }
    → EntityStagingService.stageEntityDelta
    → field_group = NULL, change_status = STAGED
    → INSERT C1: { system_id:M, op:UPDATE, payload:{alias:"Mod2"}, field_group:NULL }

  User: PATCH /spf-modules/M/container { containerSystemId: 200 }
    → stageEntityDelta finds C1 (field_group IS NULL)
    → accumulated payload: { alias:"Mod2", containerSystemId:200 }
    → C1 superseded, INSERT C2: { payload:{alias:"Mod2", containerSystemId:200}, field_group:NULL }

  GET /spf-modules/M
    → read overlay: base + C2 payload = { alias:"Mod2", containerSystemId:200 }

POST /commit-changes { commitMessage: "renamed and moved module" }
  → C2 applied: UPDATE spf_modules SET alias='Mod2', container_system_id=200 WHERE system_id=M
  → C2 deleted

POST /end-session
```

Key properties of DESIGNER mode:
- `field_group = NULL` on every row — hits `uniq_edit_actions_current_entity`
- Accumulated UPDATE pattern: one row per entity, all field changes merged
- All changes auto-STAGED; no manual staging required
- Undo/redo via `activate-change` on the superseded version chain

---

## 6. DiffMerge Mode — End to End

### 6.1 Session Lifecycle

```
POST /start-session { mode: "DIFF_MERGE", clientId: "DiffMergeTool" }

POST /diff-merge/apply { diffResult: { ... } }
  → writes UNSTAGED edit_actions with field_group per logical change unit
  → returns DiffMergeChangeSummaryDto

  (User reviews the change summary in the DiffMerge UI — nothing staged yet)

POST /stage-changes { changeIds: [501] }          ← user selects alias change
POST /stage-changes { changeIds: [701, 801, 802] } ← user selects CKV + its payloads

GET /diff-merge/changes                           ← refresh panel after staging

POST /commit-changes { commitMessage: "Apply selected changes from reference" }
  → STAGED rows applied to Target; UNSTAGED rows remain untouched

POST /end-session
  → UNSTAGED edit_actions deleted
```

### 6.2 Apply Diff

`POST /diff-merge/apply` receives the diff result from the diff-compare tool and writes each logical change unit to the active DIFF_MERGE session.

For each change unit:

| Unit type | DB write |
|---|---|
| Independent field UPDATE (e.g. `alias`) | One `edit_action` row: `field_group="alias"`, `op=UPDATE`, `payload={alias:"Mod2"}`, `change_status=UNSTAGED` |
| Atomic multi-field UPDATE (e.g. `paramDefinition`) | One row: `field_group="paramDefinition"`, `op=UPDATE`, `payload={all changed fields}`, `change_status=UNSTAGED` |
| Entity CREATE | One row: `field_group="<entityType>"`, `op=CREATE`, `payload=full row`, `change_status=UNSTAGED` |
| Entity DELETE | One row: `field_group="<entityType>"`, `op=DELETE`, `payload={}`, `change_status=UNSTAGED` |

`base_version` is captured from the Target file's actual table (same as DESIGNER mode). After writing all rows the endpoint constructs and returns `DiffMergeChangeSummaryDto` (§8).

The apply endpoint is idempotent: calling it again on an active session clears all existing UNSTAGED changes before re-writing.

### 6.3 Stage and Unstage

The existing Stage and Unstage APIs are **unchanged in contract**:

```
POST /stage-changes   { changeIds: number[] }
POST /unstage-changes { changeIds: number[] }
```

`changeIds` in the request can be:
- A single `ChangeUnitDto.changeId` — stage one logical unit
- `ChangeNodeDto.changeIds` — stage an entire entity or subtree in one call

The server updates `change_status` for all provided `changeId` values atomically.

### 6.4 Read Overlay in DiffMerge Mode

The read overlay is **unchanged**: both STAGED and UNSTAGED active `edit_actions` are merged with actual table data. The existing get APIs (e.g. `GET /subgraphs`, `POST /spf-modules/query`) return the Target file's data as it would look if **all** proposed changes were applied — a full preview regardless of staging state.

As the user stages and unstages individual change units, read API results do not change. The staging state only determines what gets committed.

### 6.5 Commit

Commit behaviour is **unchanged**. Only `change_status = STAGED` rows are applied. For an entity with multiple field-group rows, only the staged ones take effect:

```
SpfModule M:
  C1: field_group="alias",            change_status=STAGED   → applied
  C2: field_group="containerSystemId", change_status=UNSTAGED → skipped

Commit result:
  UPDATE spf_modules SET alias = 'Mod2' WHERE system_id = 100
  (containerSystemId remains unchanged in Target)
```

Multiple STAGED partial UPDATE rows for the same entity are each applied independently in `change_id` order. The diff-compare tool guarantees no field appears in two field groups — payloads never overlap.

---

## 7. API Layer

### 7.1 Apply Diff API (new)

```
POST /arc-api/v1/projects/:projectId/diff-merge/apply
Session mode required: DIFF_MERGE

Body: {
  diffResult: DiffResult    // external contract owned by the diff-compare tool
}

Response: DiffMergeChangeSummaryDto
```

### 7.2 Get Change Summary API (new)

```
GET /arc-api/v1/projects/:projectId/diff-merge/changes
Session mode required: DIFF_MERGE

Response: DiffMergeChangeSummaryDto
```

Returns the current state of all pending changes in the session with up-to-date `status` per unit. Shape is identical to the apply-diff response; this endpoint reflects changes after staging/unstaging operations.

### 7.3 Stage / Unstage APIs (unchanged)

```
POST /arc-api/v1/projects/:projectId/stage-changes
Body: { changeIds: number[] }

POST /arc-api/v1/projects/:projectId/unstage-changes
Body: { changeIds: number[] }
```

### 7.4 Existing Get APIs (unchanged)

All existing entity get APIs return clean DTOs with no change metadata. They continue to use the read overlay and work identically in DIFF_MERGE sessions. The DiffMerge UI uses these to show the current effective state of the Target file.

---

## 8. Change Summary DTO

### 8.1 Types

```typescript
interface DiffMergeChangeSummaryDto {
  sessionId: number;
  aggregates: ChangeNodeDto[];
}

/**
 * One node per entity. The same entity never appears more than once in the tree
 * regardless of how many independent change units it has.
 *
 * changeIds is a pre-computed roll-up of all independently-stageable changeIds
 * in this subtree — pass directly to Stage/Unstage to act on the whole subtree.
 */
interface ChangeNodeDto {
  entityType: string;                           // "SpfModule", "Ckv", "ParameterPayload", …
  systemId: number;
  displayName: string;                          // human-readable label (alias, name, etc.)
  operation: "CREATE" | "UPDATE" | "DELETE";
  changeIds: number[];                          // own unit changeIds + all descendant changeIds
  status: "STAGED" | "UNSTAGED" | "PARTIAL";   // PARTIAL = some staged, some not
  changeUnits: ChangeUnitDto[];                 // independently-stageable units for this entity
  childChanges: ChangeNodeDto[];                // child entities — same shape, recursive
}

/**
 * One independently-stageable unit. Maps 1:1 to one edit_action row (one field_group).
 * All fields in a unit are staged and unstaged atomically with this changeId.
 */
interface ChangeUnitDto {
  changeId: number;
  status: "STAGED" | "UNSTAGED";
  fields: FieldChangeDto[];
}

/**
 * A single field comparison. No changeId — always atomic with the parent ChangeUnitDto.
 */
interface FieldChangeDto {
  fieldName: string;
  oldValue: unknown | null;   // null for CREATE
  newValue: unknown | null;   // null for DELETE
}
```

### 8.2 Design Rules

**One entity, one node.** `(entityType, systemId)` uniquely identifies a node. `SpfModule M` with two independent field changes has one node with two entries in `changeUnits` — not two separate nodes.

**changeUnits maps to DB field_group.** Each `ChangeUnitDto.changeId` corresponds to one `edit_action` row (one `field_group`). Independent fields → multiple `changeUnits` on the same node. Atomic group → one `changeUnit` with multiple `fields`.

**fields is informational only.** `FieldChangeDto` has no `changeId`. Staging is per `changeUnit`, never per individual field.

**changeIds roll-up:**
```
node.changeIds = deduplicate([
  ...node.changeUnits.map(u => u.changeId),
  ...node.childChanges.flatMap(c => c.changeIds)
])
```

**status derivation:**
- All `changeIds` in subtree STAGED → `STAGED`
- None STAGED → `UNSTAGED`
- Mix → `PARTIAL`

**oldValue source.** Derived server-side from the Target file's actual table at query time. The diff-compare tool does not need to pass old values in the write request.

**atomic groups.** When multiple fields must always be staged together (e.g. `paramDefinition`), the tool writes them as one `edit_action` row with a single `field_group`. They appear as one `changeUnit` with multiple `fields`. Staging `changeId=503` stages all fields in that unit atomically.

**CREATE children.** For a large aggregate being added (e.g. a module with 5 CKVs), each independently-selectable CKV appears as a child `ChangeNodeDto` with its own `changeUnit`. The user stages 2 of 5 CKV nodes to bring only those CKVs into the Target file.

### 8.3 Example

Module `Mod1` has two independent structural field changes, plus a CKV with an updated name whose child `ParameterPayload` table has one row updated (P1) and one row newly created (P2):

```json
{
  "sessionId": 42,
  "aggregates": [
    {
      "entityType": "SpfModule",
      "systemId": 100,
      "displayName": "Mod1",
      "operation": "UPDATE",
      "changeIds": [501, 502, 701, 801, 802],
      "status": "PARTIAL",
      "changeUnits": [
        {
          "changeId": 501,
          "status": "STAGED",
          "fields": [
            { "fieldName": "alias", "oldValue": "Mod1", "newValue": "Mod2" }
          ]
        },
        {
          "changeId": 502,
          "status": "UNSTAGED",
          "fields": [
            { "fieldName": "containerSystemId", "oldValue": 100, "newValue": 200 }
          ]
        }
      ],
      "childChanges": [
        {
          "entityType": "Ckv",
          "systemId": 901,
          "displayName": "gain_ckv",
          "operation": "UPDATE",
          "changeIds": [701, 801, 802],
          "status": "UNSTAGED",
          "changeUnits": [
            {
              "changeId": 701,
              "status": "UNSTAGED",
              "fields": [
                { "fieldName": "name", "oldValue": "gain_v1", "newValue": "gain_v2" }
              ]
            }
          ],
          "childChanges": [
            {
              "entityType": "ParameterPayload",
              "systemId": 1001,
              "displayName": "P1",
              "operation": "UPDATE",
              "changeIds": [801],
              "status": "UNSTAGED",
              "changeUnits": [
                {
                  "changeId": 801,
                  "status": "UNSTAGED",
                  "fields": [
                    { "fieldName": "payload", "oldValue": "base64_old...", "newValue": "base64_new..." }
                  ]
                }
              ],
              "childChanges": []
            },
            {
              "entityType": "ParameterPayload",
              "systemId": 1002,
              "displayName": "P2",
              "operation": "CREATE",
              "changeIds": [802],
              "status": "UNSTAGED",
              "changeUnits": [
                {
                  "changeId": 802,
                  "status": "UNSTAGED",
                  "fields": [
                    { "fieldName": "payload", "oldValue": null, "newValue": "base64_new..." }
                  ]
                }
              ],
              "childChanges": []
            }
          ]
        }
      ]
    }
  ]
}
```

**Staging operations this DTO enables:**

| Goal | API call |
|---|---|
| Stage alias only | `Stage([501])` |
| Stage containerSystemId only | `Stage([502])` |
| Stage both structural fields | `Stage([501, 502])` |
| Stage CKV name change only | `Stage([701])` |
| Stage P1 payload update | `Stage([801])` |
| Stage CKV + all its payloads | `Stage([701, 801, 802])` |
| Stage everything | `Stage([501, 502, 701, 801, 802])` |

---

## 9. Impact Summary

### What Changes

| Component | Change |
|---|---|
| `edit_actions` schema | Add `field_group TEXT NULL`; replace one unique index with two partial indexes (§4.2) |
| `EditActionsService.insertEditAction` | Supersede query scoped to same `field_group` (§4.3) |
| `EntityStagingService` | New `stageDiffMergeChange` method — no accumulation, writes with `field_group`, always `UNSTAGED` (§4.4) |
| `OverlayMerge.applyToSingle` | Signature changes to accept `editActions[]`; handles N UPDATE rows per entity (§4.5) |
| `OverlayMerge.applyToCollection` | Groups by `systemId`; applies merged result per group (§4.5) |
| New: `POST /diff-merge/apply` | Writes UNSTAGED field-group changes, returns change summary (§7.1) |
| New: `GET /diff-merge/changes` | Returns current change summary with live staged/unstaged state (§7.2) |

### What Does Not Change

| Component | Reason |
|---|---|
| DESIGNER mode behaviour | `field_group = NULL` rows hit the original constraint; accumulation unchanged |
| Stage / Unstage API contract | Already operates per `changeId` and accepts lists |
| Commit logic | Already applies partial payloads per STAGED row independently |
| All existing get APIs | Return clean entity DTOs; overlay handles N rows transparently |
| Session lifecycle (start, commit, end-session) | Unchanged |
| `groupId` semantics | Still used for undo/redo atomicity; orthogonal to `field_group` |
| `base_version` and optimistic locking | Unchanged; captured per field-group row at first write |

---

*End of Document*
