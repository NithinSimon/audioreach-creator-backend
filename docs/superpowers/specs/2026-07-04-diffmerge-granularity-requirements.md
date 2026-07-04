<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# DiffMerge Granularity — Requirements

**Date:** 2026-07-04
**Status:** Draft
**Owner:** Nithin Simon

**Related Documents:**
- `docs/superpowers/specs/2026-06-17-diffmerge-granularity-design.md` — Prior design (superseded by these requirements)
- `docs/modification-framework/modification-framework-design.md` — Session lifecycle, edit_actions table

---

## 1. Scope

These requirements cover:

- The three-way merge workflow for DiffMerge
- Field-level and cross-entity change granularity for selection
- Staging and unstaging of changes
- The change summary API
- Visual diff context on entity GET APIs (both DiffMerge and Designer modes)
- Canvas and tree-view selection UI requirements

**Out of scope:**
- Conflict resolution for DiffMerge
- Undo/redo in DIFF_MERGE session mode
- Any change to TUNING or DISCOVERY_WIZARD mode behaviour
- The diff algorithm itself (owned by the diff-compare tool)

---

## 2. Three-Way Merge Workflow

**REQ-TM-01:** The system must accept three files from the user: Reference (original baseline), Base (file that has evolved from Reference), and Target (file that will receive selected changes).

**REQ-TM-02:** The diff-compare tool computes what changed between Reference and Base, converts the result into a set of logical change units, and submits them to the server for application to the Target file.

**REQ-TM-03:** All change units applied to the Target file's session must start as unselected. Nothing is selected by default on first load.

**REQ-TM-04:** The user reviews proposed changes, selects (stages) the ones they want, and commits. Only selected changes are applied to the Target file at commit time.

**REQ-TM-05:** Unselected changes are discarded when the session ends.

**REQ-TM-06:** Applying a diff to an active session must be idempotent — re-applying clears all existing unselected changes for that session and rewrites them from the new diff result.

---

## 3. Change Granularity

### 3.1 Field-Level Independence

**REQ-CG-01:** In DiffMerge mode, individual field changes on the same entity must be independently selectable. A change to `alias` and a change to `containerSystemId` on the same module must each have their own selection handle — the user can select one without selecting the other.

**REQ-CG-02:** Multiple fields on the same entity can be grouped into a single atomic change unit. All fields in the unit are selected and deselected together; no partial selection within the unit is permitted.

**REQ-CG-03:** The diff-compare tool decides at write time whether fields are independent or grouped as an atomic unit. The server stores and enforces the grouping as provided, without interpreting field semantics.

**REQ-CG-04:** For an atomic field group, the user can see all the field-level old and new values for context, but selection is always all-or-nothing for the group as a whole.

### 3.2 Entity-Level Operations

**REQ-CG-05:** CREATE and DELETE operations on an entity are atomic at the entity level by default — the entity is either fully added or fully removed. The diff-compare tool may override this by providing finer grouping.

**REQ-CG-06:** For a large aggregate being added (e.g. a module with calibration data), some child entities may be independently selectable (user picks 2 of 5 CKVs) while others are mandatory (module core must come with its required calibration). The diff-compare tool signals this distinction at write time.

---

## 4. Atomic Cross-Entity Groups

**REQ-ACG-01:** Multiple entities spanning different tables must be expressible as one atomic selection unit. The user selects or deselects the entire group together — no individual member entity can be independently staged.

*Example: a module being added requires its calibration data; the user cannot select the module without also selecting the required calibration entries.*

**REQ-ACG-02:** The server must enforce cross-entity atomic grouping. Staging a subset of the members of an atomic group — while leaving others unstaged — must be rejected at the server level.

**REQ-ACG-03:** Unstaging any member of an atomic group must unstage all members of the group together.

**REQ-ACG-04:** Within a larger entity aggregate, some child entities may belong to an atomic group while other child entities remain independently selectable. Both can coexist under the same parent.

**REQ-ACG-05:** The grouping of entities into atomic units is determined and encoded by the diff-compare tool at write time. The server stores the grouping definition without needing to interpret business rules.

**REQ-ACG-06:** The UI must not present individual selection controls for entities that are members of an atomic cross-entity group. The group is represented as a single selectable item.

---

## 5. Staging and Unstaging

**REQ-ST-01:** Each independently-selectable change unit must carry a unique identifier that the UI uses to call Stage and Unstage APIs.

**REQ-ST-02:** The Stage API must accept a list of change identifiers and stage all of them atomically in one call.

**REQ-ST-03:** The Unstage API must accept a list of change identifiers and unstage all of them atomically in one call.

**REQ-ST-04:** The Stage API must also accept atomic group identifiers. Staging a group identifier stages all member entities of that group atomically.

**REQ-ST-05:** The Unstage API must accept atomic group identifiers. Unstaging a group identifier unstages all member entities of that group atomically.

**REQ-ST-06:** The read overlay must always include both staged and unstaged pending changes. The user sees a full preview of what the Target file would look like with all proposed changes applied, regardless of which have been selected.

**REQ-ST-07:** Only staged (selected) changes are applied to the Target file at commit time. Unstaged changes are not applied and are discarded at session end.

---

## 6. Change Summary API

**REQ-CS-01:** A dedicated API must return a summary of all proposed changes in the current DiffMerge session with their current selection state.

**REQ-CS-02:** The change summary must present changes in a hierarchical structure, with child entities nested under their aggregate root.

**REQ-CS-03:** The change summary must clearly distinguish between independently-selectable change units and atomic cross-entity groups.

**REQ-CS-04:** For each change unit, the summary must include: the entity type, entity identifier, operation (CREATE / UPDATE / DELETE), current selection status, and field-level changes with old and new values.

**REQ-CS-05:** For each field-level change, the old value (committed state) and new value (proposed state) must be provided. For CREATE, old value is absent. For DELETE, new value is absent.

**REQ-CS-06:** Atomic cross-entity groups must be represented as a single entry in the summary. Member entities are shown as informational detail but are not individually selectable.

**REQ-CS-07:** Each entity node in the summary must expose an aggregated selection status: fully selected, fully unselected, or partially selected (some descendants selected, some not).

**REQ-CS-08:** Each entity node in the summary must provide a pre-computed roll-up of all change identifiers for itself and all its descendants. The UI can use this to select or deselect an entire subtree in a single API call.

**REQ-CS-09:** The apply-diff API must return the full change summary immediately upon applying the diff, so the UI can render the selection panel without a separate round-trip.

**REQ-CS-10:** A separate API must allow the client to retrieve the current change summary at any time to refresh the selection panel after staging or unstaging operations.

---

## 7. Visual Diff in Entity Views

**REQ-VD-01:** All entity GET APIs must support an optional mode where diff context is returned alongside entity data. Without opting in, the response is identical to today — clean entity data with no change metadata.

**REQ-VD-02:** When diff context is requested, the response must identify which fields on the entity have pending changes and provide old and new values for each changed field.

**REQ-VD-03:** Old values must be derived from the committed state of the Target file at query time. The diff-compare tool does not need to supply them.

**REQ-VD-04:** For CREATE operations, old values are absent (entity did not exist in the committed state).

**REQ-VD-05:** For DELETE operations, new values are absent (entity is being removed).

**REQ-VD-06:** Diff context must work in both Designer and DiffMerge session modes using the same opt-in mechanism and the same response structure.

**REQ-VD-07:** When an entity response includes embedded child entities (e.g. ports within a module), each child must carry its own diff context independently.

**REQ-VD-08:** Entities that are members of an atomic cross-entity group must carry a signal in their diff context indicating they belong to a group. The UI uses this to suppress individual selection controls and display a group indicator instead.

**REQ-VD-09:** The diff context must carry enough information to support selection operations directly from the entity view — not only for visual rendering. Specifically, it must expose the identifiers needed to call Stage and Unstage for that entity's changes and for any atomic groups it belongs to.

---

## 8. Canvas and Tree-View Selection

**REQ-CV-01:** In DiffMerge mode, the graph canvas must display a selection control near each entity (e.g., a checkbox next to a module box). Activating it selects or deselects all changes for that entity and all its descendants in one action.

**REQ-CV-02:** A tree-view representation of the entity hierarchy must be supported, with selection controls at each level of the hierarchy.

**REQ-CV-03:** Field-level selection (selecting one field change at a time) must be supported in the tree view.

**REQ-CV-04:** Selecting an entity-level control in the canvas or tree must select all independently-selectable changes for that entity and its entire descendant subtree.

**REQ-CV-05:** Selecting the control for an atomic cross-entity group must stage all member entities of the group together. Selecting any one member's group control has the same effect as selecting any other member's — the entire group is selected.

**REQ-CV-06:** The entity GET API with diff context must serve as the data source for both the canvas and tree-view — the same API that provides field colour data must also provide the identifiers needed for staging.

**REQ-CV-07:** The same entity DTO and GET endpoint used in Designer mode must be reusable in DiffMerge mode for diff-aware rendering. No separate DiffMerge-specific entity view endpoint is required.

---

## 9. Designer Mode Pending Changes

**REQ-DM-01:** In Designer mode, entity GET APIs with diff context must show which fields have pending (uncommitted) changes, including the committed (old) value and the current pending (new) value for each changed field.

**REQ-DM-02:** In Designer mode, all pending changes are implicitly fully selected at all times. There are no selection controls in Designer mode — the diff context is informational only.

**REQ-DM-03:** In Designer mode, multiple field changes on the same entity are accumulated into a single change unit — they appear together, not as independently-selectable items.

**REQ-DM-04:** The diff context structure returned in Designer mode must use the same schema as DiffMerge mode. The difference in behaviour (single accumulated unit vs multiple independent units) is expressed through the content of the response, not through a different structure.

---

*End of Document*
