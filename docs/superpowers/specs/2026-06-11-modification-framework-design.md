<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Modification Framework — Design Spec

**Date:** 2026-06-11
**Status:** Frozen
**Owner:** Nithin Simon

**Related Documents:**
- `docs/modification-framework/modification-framework-design.md` — DB schema, session lifecycle, edit_actions table (frozen)
- `docs/read-overlay-design.md` — Read-overlay pattern (separate LLD)
- `docs/superpowers/specs/2026-06-01-auto-usecase-routing-requirements.md` — Routing context

---

## 1. Scope

This document covers the design of the **write path** for module SET APIs and the Add Module API — the first implementation of any API that modifies data through the edit_actions framework.

**In scope:**
- Module structural fields: `alias`, `containerSystemId`
- Module ports: `DataPort` and `ControlPort` — create and rename
- Add Module: three creation variants with auto-created Subgraph and Container

**Out of scope:**
- `cal-data` (CKV parameter payloads) and `tag-data` (TKV parameter payloads) — separate LLD
- Read overlay and read query design — separate LLD
- Commit, undo/redo API implementation — covered in modification-framework-design.md
- Delete Module and last-module cascade delete — separate LLD

---

## 2. Frozen Constraints

- **DB schema**: `edit_actions`, `project_sessions`, `session_commits` — no changes
- **CQRS framework**: `CommandBus`, `QueryBus`, `BaseCommand`, handler registries — no changes
- **Session lifecycle**: `SessionModeGuard`, start/end session APIs — no changes
- **`EditActionsService`**: existing supersede + insert utility — no changes, used as-is

---

## 3. Requirements (Frozen)

### 3.1 Session and Mode Gate

**REQ-SESS-01:** All SET API calls require an active `project_sessions` row (`status = ACTIVE`) for the file. No active session → `403 Forbidden`.

**REQ-SESS-02:** All module structural and port SET operations require `DESIGNER` session mode. Wrong mode → `403 Forbidden`.

### 3.2 Module as Aggregate Root

**REQ-AGG-01:** Every `edit_action` for any module-owned entity must carry `aggregateId = moduleSystemId`. This applies to:

| Entity | Table | `aggregateId` value | Source |
|--------|-------|---------------------|--------|
| `SpfModule` | `spf_modules` | `module.systemId` | self |
| `Node` | `nodes` | `module.systemId` | 1:1 relation — `node.systemId = module.systemId` |
| `DataPort` | `data_ports` | `module.systemId` | `moduleSystemId` parameter; domain `DataPort` has no `nodeSystemId` field |
| `ControlPort` | `control_ports` | `module.systemId` | `moduleSystemId` parameter; domain `ControlPort` has `nodeSystemId` but repo uses explicit parameter for consistency |

*Rationale:* `aggregateId` enables the read-overlay to retrieve all pending changes for a module and its children in a single indexed scan (via `idx_edit_actions_agg_active`). Correct assignment on write is what makes that scan possible.

**REQ-AGG-02:** All writes to `edit_actions` for module-owned entities must go through `ModuleEditRepository`. No other code path may write `edit_actions` rows with `aggregateId = moduleSystemId`.

### 3.3 Edit Action Write Rules

**REQ-EA-01 — Auto-staged:** All user-initiated SET calls produce `changeStatus = STAGED`. No separate staging call required.

**REQ-EA-02 — Supersede pattern:** Before inserting a new `edit_action` for an entity, the existing current row matching `(sessionId, systemId, validUntil IS NULL)` is superseded by setting `validUntil = NOW()`. The superseded row is retained for undo/redo.

**REQ-EA-03 — Accumulated UPDATE payload:** When a new UPDATE is written for an entity that already has an active UPDATE edit_action in the same session, the new row's payload must contain the **accumulated union** of all pending field changes — not just the new delta.

```
Base: { alias:"Mod1", containerId:100, version:1 }

Edit 1 → alias change:   payload = { alias:"Mod2" }
Edit 2 → container change:
  Read Edit 1 payload → { alias:"Mod2" }
  Merge new delta     → { alias:"Mod2", containerId:200 }    ← accumulated

Overlay:        base + { alias:"Mod2", containerId:200 }  ✓
Undo to Edit 1: base + { alias:"Mod2" }                   ✓  containerId reverts
```

**REQ-EA-04 — baseVersion: captured once, preserved across superseding:**
- First UPDATE/DELETE of a committed entity: `baseVersion = entity.version` from actual table
- Entity created this session (has active CREATE): `baseVersion = null`
- All subsequent superseding cycles for the same entity carry the same `baseVersion`
- Commit-time conflict: `actual.version ≠ edit_action.baseVersion` → reject

**REQ-EA-05 — CREATE payload carries in-session field changes:**
When a SET call targets an entity whose only `edit_action` is a CREATE (not yet committed):
- Merge changed fields into the CREATE payload
- Supersede old CREATE, insert new CREATE with updated payload
- Operation stays `CREATE`; `baseVersion` stays `null`

### 3.4 Scenario Requirements

**REQ-SC1: Simple entity modification (first edit in session)**
No active edit_action exists. Read `entity.version` from actual table → INSERT UPDATE with delta payload and that `baseVersion`.

**REQ-SC2A: Same entity modified multiple times in one session**
Each new SET call on the same entity supersedes the prior row and writes an accumulated payload. `baseVersion` is preserved from the first modification. Every superseded row is retained (version chain for undo/redo).

**REQ-SC2B: Multiple fields of same module changed in sequence**
The second SET call on the same module reads the active edit_action payload (e.g., `{alias:"Mod2"}`), merges the new delta (e.g., `{containerId:200}`), and inserts the accumulated result (`{alias:"Mod2", containerId:200}`). Both pending changes remain visible in the overlay simultaneously.

### 3.5 groupId Rules

**REQ-GID-01:** Single-field SET operations (rename module, rename port) set `groupId = null`.

**REQ-GID-02:** Multi-entity atomic operations (e.g., creating module + node + initial ports in one handler) share a single UUID `groupId` across all produced edit_actions. The command handler generates the UUID and passes it to all relevant repository calls.

**REQ-GID-03:** `groupId` is orthogonal to `aggregateId`. `aggregateId` scopes read-overlay queries; `groupId` scopes undo/redo atomicity.

### 3.6 Port Requirements

**REQ-PORT-01:** DataPort and ControlPort modifications follow the same edit_action rules as module structural modifications, with `aggregateId = port.nodeSystemId = moduleSystemId`.

**REQ-PORT-02:** When a new DataPort or ControlPort is created via SET API, a CREATE edit_action is written: `operation = CREATE`, full row payload, `baseVersion = null`, `aggregateId = moduleSystemId`. Subsequent SET calls on that port in the same session apply REQ-EA-05.

### 3.7 Add Module Requirements

**REQ-ADD-01 — Three creation variants:**
The existing `POST /spf-modules` endpoint (`BaseSpfModuleRequest`) covers all variants via optional `subgraphId` and `containerId`. No new endpoint or DTO fields are needed for the three variants themselves.

| Variant | `subgraphId` | `containerId` | Entities staged as CREATE |
|---------|-------------|---------------|--------------------------|
| Empty canvas | absent | absent | Subgraph + SubgraphPropertyData rows + Container + ContainerPropertyData rows + Module + Node + Ports |
| Existing subgraph, no container | provided | absent | Container + ContainerPropertyData rows + Module + Node + Ports |
| Existing subgraph and container | provided | provided | Module + Node + Ports only |

**REQ-ADD-02 — Port auto-creation from definition:**
The server looks up `SpfModuleDefinition` using `(moduleId, procId)` from the request. All static ports in `definition.dataPortGroups` become `DataPort` CREATE edit_actions. All `definition.staticControlPorts` become `ControlPort` CREATE edit_actions. Dynamic ports are not created at add time. If no matching definition is found → `404`.

**REQ-ADD-03 — Mandatory groupId:**
All edit_actions produced by one Add Module call — across all created entities and all aggregates — must share a single `groupId`. This is required (not optional): the entire add must be reversible as one undo step, including any auto-created Subgraph and Container.

**REQ-ADD-04 — Independent aggregate roots for Subgraph and Container:**
Subgraph and Container are their own aggregate roots with their own `aggregateId`. All entities created in a single Add Module call share one `groupId` despite having different `aggregateId` values.

| Created entity | `aggregateId` |
|---------------|--------------|
| Subgraph, SubgraphPropertyData rows | `subgraphSystemId` |
| Container, ContainerPropertyData rows | `containerSystemId` |
| Module, Node, DataPort, ControlPort | `moduleSystemId` |

**REQ-ADD-05 — Auto-created Subgraph default name:**
When a new Subgraph is created (Variant 1), the server generates a default name. The exact format is an implementation detail. The name can be changed later via a rename API.

**REQ-ADD-06 — Auto-created Container type:**
`Container.containerTypeSystemId` is set to the first entry in `SpfModuleDefinition.containerTypesSystemIds`. The FK is available directly from the definition — no separate lookup needed. The read side resolves the type name by joining `containers → container_types`.

**REQ-ADD-07 — Default property data for auto-created Subgraph and Container:**
When a Subgraph is auto-created, `subgraph_property_data` rows are staged as CREATE edit_actions using default payloads sourced from subgraph property definitions. When a Container is auto-created, `container_property_data` rows are staged the same way from container property definitions. These property rows carry `aggregateId = subgraphSystemId` or `aggregateId = containerSystemId` respectively.

**REQ-ADD-08 — Last-module cascade delete (requirement only; design deferred):**
When the last module referencing a Subgraph is deleted, that Subgraph and its property data are also staged for DELETE. Same rule for Container. Design for this is deferred to the delete module LLD.

---

## 4. Architecture Overview

```
packages/api
  SpfModuleController          ← PATCH/POST endpoints per field
  SessionModeGuard             ← validates active session + DESIGNER mode

packages/core
  Commands (one per SET operation):
    SetModuleAliasCommand / Handler
    SetModuleContainerCommand / Handler
    AddDataPortCommand / Handler
    AddControlPortCommand / Handler
    AddModuleCommand / Handler          ← covers all three variants
  Port interface:
    IModuleEditRepository      ← domain types only; no row types

packages/infrastructure/persistence
  EntityStagingService         ← NEW: find + accumulate + baseVersion + supersede + insert
  ModuleEditRepository         ← maps domain → delta/payload, assigns aggregateId/tableName
  EditActionsService           ← EXISTING: supersede + insert (unchanged)
```

**Dependency rule:** `packages/core` imports zero infrastructure types. `packages/infrastructure` imports domain types from `packages/core`. The boundary is enforced at the port interface.

---

## 5. EntityStagingService (new, infrastructure)

The single place where the accumulate-then-supersede pattern is implemented. Used by all aggregate edit repositories — not just module. Defined in `packages/infrastructure/persistence`.

### 5.1 Interface

```typescript
interface BaseEntityStagingSpec {
  systemId:    number;
  aggregateId: number;
  tableName:   EntityName;
  sessionId:   number;
  groupId?:    string | null;
}

interface EntityStagingSpec extends BaseEntityStagingSpec {
  delta:   Record<string, unknown>;   // partial — only changed fields
}

interface EntityCreateSpec extends BaseEntityStagingSpec {
  payload: Record<string, unknown>;   // full row
}
```

### 5.2 `stageEntityDelta` — for SET operations

```
1. SELECT active edit_action WHERE sessionId=? AND systemId=? AND validUntil IS NULL
   → uses idx_edit_actions_entity_active

2. if no existing row:
     baseVersion = SELECT version FROM <tableName> WHERE system_id = systemId
     if baseVersion IS NULL → entity not found → throw EntityNotFoundException
     operation = UPDATE
     payload   = delta

3. if existing.operation = CREATE:
     operation   = CREATE
     payload     = { ...existing.payload, ...delta }   ← merge into CREATE
     baseVersion = null

4. if existing.operation = UPDATE:
     operation   = UPDATE
     payload     = { ...existing.payload, ...delta }   ← accumulate
     baseVersion = existing.baseVersion                ← preserved, never changed

5. call EditActionsService.insertEditAction(assembled row)
   (EditActionsService handles: supersede existing + INSERT new — unchanged)
```

### 5.3 `stageEntityCreate` — for new entity creation

```
1. No existence check — systemId was pre-assigned by IdGenerationPort
2. Directly call EditActionsService.insertEditAction with:
   operation = CREATE, payload = full row, baseVersion = null
```

`EntityStagingService` is constructed per-request with the transaction's `QueryRunner`, identical to how `EditActionsService` works today.

### 5.4 Why shared, not per-aggregate

The accumulation rules (accumulated payload, `baseVersion` captured once, CREATE vs UPDATE case) are identical for every aggregate. Centralising them in `EntityStagingService` means the invariants are proven once and reused by `ModuleEditRepository`, `SubgraphEditRepository`, `ContainerEditRepository`, and any future aggregate. One bug fix or invariant change propagates everywhere.

---

## 6. IModuleEditRepository Port (core)

Domain types only. No row types cross this boundary.

```typescript
// packages/core/src/application/ports/persistence/repositories/module/
//   module-edit.repository.ts

export interface IModuleEditRepository {

  // ── Existence check (read within write transaction) ───────────────────────

  moduleExists(
    systemId:     number,
    fileSystemId: number
  ): Promise<boolean>;

  // ── Module root ───────────────────────────────────────────────────────────
  // Each method = one domain operation, not a batch delta spec.

  stageModuleRename(
    moduleSystemId: number,
    newAlias:       string,
    sessionId:      number,
    groupId?:       string | null
  ): Promise<void>;

  stageModuleContainerChange(
    moduleSystemId:    number,
    containerSystemId: number,
    sessionId:         number,
    groupId?:          string | null
  ): Promise<void>;

  // ── Data ports ────────────────────────────────────────────────────────────
  // Port names are read-only on module ports; only creation is supported here.

  stageDataPortCreate(
    port:           DataPort,       // full domain object; systemId pre-assigned by caller
    moduleSystemId: number,         // aggregateId source; DataPort has no nodeSystemId field
    sessionId:      number,
    groupId?:       string | null
  ): Promise<void>;

  // ── Control ports ─────────────────────────────────────────────────────────
  // Port names are read-only on module ports; only creation is supported here.

  stageControlPortCreate(
    port:           ControlPort,    // full domain object; caller sets port.nodeSystemId
    moduleSystemId: number,
    sessionId:      number,
    groupId?:       string | null
  ): Promise<void>;

  // ── Module + all children (atomic creation) ───────────────────────────────

  stageModuleCreate(
    module:    SpfModule,   // carries dataPorts and controlPorts via Node base class
    sessionId: number,
    groupId:   string       // required — module is always created with node and ports atomically
  ): Promise<void>;
}
```

**Design rationale — separate methods per operation:**
Each method name is a domain verb (`stageModuleRename`, `stageModuleContainerChange`) not a generic delta applicator. This mirrors the one-command-per-operation decision at the command layer. A rename and a container change are different domain concepts even if the infrastructure treats them similarly. The scalar parameter (e.g., `newAlias: string`) is simpler and more expressive than an object wrapper (`Pick<SpfModule, 'alias'>`), which adds no value for a single-field operation.

**Design rationale — `Pick<SpfModule, ...>` vs scalar:**
`Pick<SpfModule, 'alias'>` would be appropriate if multiple fields were always updated together as one domain concept. For single-field operations, a direct scalar is correct. If a future operation changes two fields as one atomic domain concept (e.g., "move module" changes both `containerSystemId` and `subgraphSystemId`), a `Pick<SpfModule, 'containerSystemId' | 'subgraphSystemId'>` would be appropriate for that specific combined method.

---

## 7. UnitOfWork (core — add one accessor)

```typescript
export interface UnitOfWork {
  // ... existing methods ...
  getModuleEditRepository(): IModuleEditRepository;
}
```

The implementation returns a `ModuleEditRepository` instance scoped to the current `QueryRunner`.

---

## 8. Commands and Handlers (core)

### 8.1 Folder structure

```
packages/core/src/application/module/
  set-alias/
    set-module-alias.command.ts
    set-module-alias.handler.ts
  set-container/
    set-module-container.command.ts
    set-module-container.handler.ts
  add-data-port/
    add-data-port.command.ts
    add-data-port.handler.ts
  add-control-port/
    add-control-port.command.ts
    add-control-port.handler.ts
  add-module/
    add-module.command.ts
    add-module.handler.ts
```

### 8.2 Representative handler — SetModuleAliasHandler

```typescript
export class SetModuleAliasHandler implements CommandHandler<SetModuleAliasCommand> {
  async handle(command: SetModuleAliasCommand, uow: UnitOfWork): Promise<void> {
    await uow.startTransaction();
    try {
      const repo = uow.getModuleEditRepository();

      const exists = await repo.moduleExists(
        command.moduleSystemId,
        command.fileSystemId
      );
      if (!exists) throw new EntityNotFoundException('SpfModule', command.moduleSystemId);

      await repo.stageModuleRename(
        command.moduleSystemId,
        command.newAlias,
        command.sessionId
      );

      await uow.commit();
    } catch (e) {
      await uow.rollback();
      throw e;
    }
  }
}
```

**Handler responsibilities:**
1. Start transaction
2. Validate entity exists via port (no DB knowledge in handler)
3. Call exactly one repository method
4. Commit

**Handler must NOT:**
- Reference SQL, TypeORM, or row types
- Know about `edit_actions`, payloads, or `baseVersion`
- Perform field mapping

### 8.3 Handler with groupId — AddDataPortHandler

```typescript
export class AddDataPortHandler implements CommandHandler<AddDataPortCommand> {
  async handle(command: AddDataPortCommand, uow: UnitOfWork): Promise<void> {
    await uow.startTransaction();
    try {
      const repo = uow.getModuleEditRepository();

      const moduleExists = await repo.moduleExists(
        command.moduleSystemId,
        command.fileSystemId
      );
      if (!moduleExists) throw new EntityNotFoundException('SpfModule', command.moduleSystemId);

      const portSystemId = uow.idPort.getNextId(command.fileSystemId);

      // DataPort has no nodeSystemId field — the repo derives it from moduleSystemId
      const port = new DataPort({
        systemId:   portSystemId,
        dataPortId: command.dataPortId,
        portIoType: command.portIoType,
        isStatic:   command.isStatic,
        name:       command.name,
      });

      await repo.stageDataPortCreate(port, command.moduleSystemId, command.sessionId);

      await uow.commit();
    } catch (e) {
      await uow.rollback();
      throw e;
    }
  }
}
```

### 8.4 ControlPort distinction — AddControlPortHandler

`ControlPort` domain class carries `nodeSystemId` (unlike `DataPort`). The handler must set it before passing to the repo. The repo still receives `moduleSystemId` as an explicit parameter for `aggregateId` assignment — using the domain object's field for that would couple the repo to ControlPort's internal structure.

```typescript
export class AddControlPortHandler implements CommandHandler<AddControlPortCommand> {
  async handle(command: AddControlPortCommand, uow: UnitOfWork): Promise<void> {
    await uow.startTransaction();
    try {
      const repo = uow.getModuleEditRepository();

      const moduleExists = await repo.moduleExists(
        command.moduleSystemId,
        command.fileSystemId
      );
      if (!moduleExists) throw new EntityNotFoundException('SpfModule', command.moduleSystemId);

      const portSystemId = uow.idPort.getNextId(command.fileSystemId);

      // ControlPort has nodeSystemId — handler sets it to moduleSystemId (1:1 relation)
      const port = new ControlPort({
        systemId:        portSystemId,
        portId:          command.portId,
        isStatic:        command.isStatic,
        name:            command.name,
        nodeSystemId:    command.moduleSystemId,   // ← explicit: node.systemId = module.systemId
        intentSystemIds: [],
      });

      await repo.stageControlPortCreate(port, command.moduleSystemId, command.sessionId);

      await uow.commit();
    } catch (e) {
      await uow.rollback();
      throw e;
    }
  }
}
```

---

## 9. ModuleEditRepository (infrastructure)

Not thin — owns mapping responsibility: translates domain types to the delta/payload records that `EntityStagingService` stores, and derives infrastructure-only FK fields absent from domain objects.

```typescript
// packages/infrastructure/persistence/.../repositories/module-edit.repository.ts

export class ModuleEditRepository implements IModuleEditRepository {

  constructor(
    private readonly stagingService: EntityStagingService,
    private readonly qr: QueryRunner,
  ) {}

  // ── Existence check ───────────────────────────────────────────────────────

  async moduleExists(systemId, fileSystemId): Promise<boolean> {
    const row = await this.qr.manager
      .createQueryBuilder()
      .select('1')
      .from(ENTITY_NAMES.SpfModule, 'm')
      .where('m.systemId = :systemId AND m.fileSystemId = :fileSystemId',
             { systemId, fileSystemId })
      .getRawOne();
    return !!row;
  }

  // ── Module root ───────────────────────────────────────────────────────────

  async stageModuleRename(moduleSystemId, newAlias, sessionId, groupId?) {
    // domain 'alias' maps directly to TypeORM entity field 'alias'
    await this.stagingService.stageEntityDelta({
      systemId: moduleSystemId, aggregateId: moduleSystemId,
      tableName: ENTITY_NAMES.SpfModule,
      delta: { alias: newAlias },
      sessionId, groupId,
    });
  }

  async stageModuleContainerChange(moduleSystemId, containerSystemId, sessionId, groupId?) {
    await this.stagingService.stageEntityDelta({
      systemId: moduleSystemId, aggregateId: moduleSystemId,
      tableName: ENTITY_NAMES.SpfModule,
      delta: { containerSystemId },
      sessionId, groupId,
    });
  }

  // ── Data ports (create only — names are read-only on module ports) ─────────

  async stageDataPortCreate(port, moduleSystemId, sessionId, groupId?) {
    // Domain DataPort has no nodeSystemId field — repo derives it from moduleSystemId
    const payload: Record<string, unknown> = {
      systemId:     port.systemId,
      dataPortId:   port.dataPortId,
      portIoType:   port.portIoType,
      isStatic:     port.isStatic,
      name:         port.name,
      nodeSystemId: moduleSystemId,   // ← infrastructure FK, not in domain
    };
    await this.stagingService.stageEntityCreate({
      systemId: port.systemId, aggregateId: moduleSystemId,
      tableName: ENTITY_NAMES.DataPort, payload, sessionId, groupId,
    });
  }

  // ── Control ports (create only — names are read-only on module ports) ──────

  async stageControlPortCreate(port, moduleSystemId, sessionId, groupId?) {
    // ControlPort domain object has nodeSystemId set by the handler (= moduleSystemId).
    // moduleSystemId parameter is still used explicitly for aggregateId — consistent with DataPort.
    const payload: Record<string, unknown> = {
      systemId:     port.systemId,
      portId:       port.portId,
      isStatic:     port.isStatic,
      name:         port.name,
      nodeSystemId: port.nodeSystemId,   // populated by handler before this call
    };
    await this.stagingService.stageEntityCreate({
      systemId: port.systemId, aggregateId: moduleSystemId,
      tableName: ENTITY_NAMES.ControlPort, payload, sessionId, groupId,
    });
  }
```

**Mapping notes:**
- `SpfModule` domain field names (`alias`, `containerSystemId`) match their TypeORM entity field names exactly — no renaming needed in the delta
- `DataPort` has no `nodeSystemId` in the domain — repo adds it to the CREATE payload from `moduleSystemId`
- `ControlPort` has `nodeSystemId` in the domain — handler sets it before calling `stageControlPortCreate`; repo reads it from the domain object
- Port names are read-only on module ports; no rename methods exist on this repository
- TypeORM handles camelCase → snake_case column mapping at commit time (`containerSystemId` → `container_system_id`)

---

## 10. API Layer

> **Note:** Full API design — endpoint paths, request/response DTOs, validation decorators, and `SessionModeGuard` wiring — is owned by a separate API LLD. This section only identifies which commands each operation maps to, so the API LLD has the contract it needs.

### 10.1 Operations and their commands

| Operation | Command dispatched | Session mode required |
|-----------|-------------------|----------------------|
| Set module alias | `SetModuleAliasCommand` | `DESIGNER` |
| Set module container | `SetModuleContainerCommand` | `DESIGNER` |
| Add data port to module | `AddDataPortCommand` | `DESIGNER` |
| Add control port to module | `AddControlPortCommand` | `DESIGNER` |
| Add module (all three variants) | `AddModuleCommand` | `DESIGNER` |

Each operation maps to exactly one command. The controller dispatches the matching command and returns the result. DTOs, path parameters, and response shapes are defined in the API LLD.

### 10.2 Session mode enforcement

All operations in the table above require `DESIGNER` session mode. The `SessionModeGuard` in `packages/api` enforces this — details are in the API LLD and the existing modification-framework-design.md.

---

## 11. Separation of Concerns

| Layer | Owns | Must NOT contain |
|-------|------|-----------------|
| `packages/api` | DTOs, request parsing, `SessionModeGuard` dispatch | Domain models, row types, SQL |
| `packages/core` handler | Entity existence validation via port, ID pre-assignment, single repo call | SQL, TypeORM, row types, payload logic |
| `packages/core` port interface | Domain types (`DataPort`, `ControlPort`), scalar parameters | Infrastructure row types |
| `packages/infrastructure` repo | Domain → delta/payload mapping, FK derivation, `aggregateId`/`tableName` assignment | Command bus, session mode rules |
| `EntityStagingService` | find + accumulate + baseVersion + supersede + insert | Domain models, aggregate identity rules |
| `EditActionsService` | supersede existing row + INSERT new row | Accumulation, baseVersion resolution |

---

## 12. End-to-End Traces

### Scenario 1 — First edit in session (alias change, no prior edit_action)

```
PATCH /spf-modules/M/alias  body:{ alias:"Mod2" }

SessionModeGuard: active session found, mode=DESIGNER ✓

SetModuleAliasHandler:
  moduleExists(M, fileId) → true
  stageModuleRename(M, "Mod2", sessionId)
    → ModuleEditRepository.stageModuleRename
      → EntityStagingService.stageEntityDelta({ systemId:M, delta:{alias:"Mod2"} })
          findCurrentEditAction(sessionId, M) → null
          getEntityVersion('spf_modules', M) → version=1
          operation=UPDATE, payload={alias:"Mod2"}, baseVersion=1
        → EditActionsService.insertEditAction
            no existing row to supersede
            INSERT edit_action: { systemId:M, aggId:M, op:UPDATE,
                                  payload:{alias:"Mod2"}, baseVer:1,
                                  changeStatus:STAGED, validUntil:NULL }
  commit()
```

### Scenario 2a — Same entity modified multiple times in one session

```
Session active. Port P (DataPort, systemId=501) under module M.

─── PATCH /data-ports/501/name  body:{ name:"left-in" } ────────────────────────
  RenameDataPortHandler:
    dataPortExists(501, M) → true
    stageDataPortRename(501, M, "left-in", sessionId)
      → EntityStagingService.stageEntityDelta({ systemId:501, delta:{name:"left-in"} })
          findCurrentEditAction(sessionId, 501) → null
          getEntityVersion('data_ports', 501) → version=2
          INSERT C1: { systemId:501, aggId:M, op:UPDATE,
                       payload:{name:"left-in"}, baseVer:2, validUntil:NULL }

─── PATCH /data-ports/501/name  body:{ name:"audio-left-in" } ──────────────────
  RenameDataPortHandler:
    stageDataPortRename(501, M, "audio-left-in", sessionId)
      → EntityStagingService.stageEntityDelta({ systemId:501, delta:{name:"audio-left-in"} })
          findCurrentEditAction(sessionId, 501) → C1 { op:UPDATE, payload:{name:"left-in"}, baseVer:2 }
          accumulated payload: { name:"audio-left-in" }   ← single field, replaced
          baseVersion: 2                                  ← preserved
          → EditActionsService:
              UPDATE C1 SET validUntil=NOW()              ← supersede
              INSERT C2: { systemId:501, aggId:M, op:UPDATE,
                           payload:{name:"audio-left-in"}, baseVer:2, validUntil:NULL }

Version chain: C1 (validUntil=T1), C2 (validUntil=NULL, current)
Undo: client activates C1 → C2.validUntil=NOW(), C1.validUntil=NULL → name="left-in" ✓
```

### Scenario 2b — Multiple fields of same module in sequence

```
Base spf_modules row: { systemId:M, alias:"Mod1", containerSystemId:100, version:1 }

─── PATCH /spf-modules/M/alias  body:{ alias:"Mod2" } ─────────────────────────
  EntityStagingService.stageEntityDelta({ systemId:M, delta:{alias:"Mod2"} })
    findCurrentEditAction(sessionId, M) → null
    getEntityVersion → version=1
    INSERT C1: { systemId:M, op:UPDATE, payload:{alias:"Mod2"},
                 baseVer:1, validUntil:NULL }

─── (other unrelated API calls on different entities) ──────────────────────────

─── PATCH /spf-modules/M/container  body:{ containerSystemId:200 } ────────────
  EntityStagingService.stageEntityDelta({ systemId:M, delta:{containerSystemId:200} })
    findCurrentEditAction(sessionId, M) → C1 { op:UPDATE, payload:{alias:"Mod2"}, baseVer:1 }
    accumulated: { alias:"Mod2", containerSystemId:200 }    ← prior change preserved
    baseVersion: 1                                          ← unchanged
    → EditActionsService:
        UPDATE C1 SET validUntil=NOW()
        INSERT C2: { systemId:M, op:UPDATE,
                     payload:{alias:"Mod2", containerSystemId:200},
                     baseVer:1, validUntil:NULL }

Read overlay: base + { alias:"Mod2", containerSystemId:200 }  ✓

Undo (activate C1):
  C2.validUntil = NOW()
  C1.validUntil = NULL
  Overlay: base + { alias:"Mod2" } → containerSystemId reverts to 100  ✓
```

---

## 13. Commit Behaviour (summary)

At commit time, each STAGED UPDATE applies the accumulated partial payload:

```sql
UPDATE <table> SET <payload fields> WHERE system_id = <systemId>
```

TypeORM handles camelCase → snake_case mapping. The accumulated payload contains only the fields that changed — this is still a partial UPDATE, not a full row replacement.

Conflict check per entity: if `actual.version ≠ edit_action.baseVersion` → commit rejected with conflict list.

Commit ordering within a transaction: DELETEs first (reverse dependency), UPDATEs, CREATEs last (forward dependency).

After commit: STAGED edit_actions deleted. Superseded rows (with `validUntil` set) also deleted — version history is only needed during the session.

---

## 14. Add Module — New Port Interfaces (core)

### 14.1 Definition Read Port

Returns the raw `SpfModuleDefinition`. Deciding which container type to use from `definition.containerTypesSystemIds` is a business rule — it belongs in the handler, not here.

```typescript
// packages/core/src/application/ports/persistence/repositories/module/
//   module-definition-read.repository.ts

export interface IModuleDefinitionReadRepository {
  findByModuleIdAndProcId(
    moduleId:     number,   // maps to SpfModuleDefinition.moduleDefinitionId
    procId:       number,   // processor ID used to identify the matching definition
    fileSystemId: number
  ): Promise<SpfModuleDefinition | null>;
}
```

### 14.2 Container Type Read Port

~~`IContainerTypeReadRepository`~~ — removed. `Container.type` is not consumed by any active business logic and is set to `""` in the current upload path (existing TODO). The field is out of scope for this LLD. No name lookup is performed during AddModule.

### 14.2 ISubgraphEditRepository

```typescript
// packages/core/src/application/ports/persistence/repositories/subgraph/
//   subgraph-edit.repository.ts

export interface ISubgraphEditRepository {

  subgraphExists(
    systemId:     number,
    fileSystemId: number
  ): Promise<boolean>;

  stageSubgraphCreate(
    subgraph:  Subgraph,
    sessionId: number,
    groupId:   string    // required — subgraph is always created as part of a multi-entity group
  ): Promise<void>;

  // TODO: stageSubgraphPropertyDefaults(subgraphSystemId, sessionId, groupId)
  //       Reads subgraph property definitions and stages CREATE edit_actions with default payloads.
  //       Requires a read port for subgraph property definitions. Deferred — no DTO defined yet.
}
```

### 14.3 IContainerEditRepository

```typescript
// packages/core/src/application/ports/persistence/repositories/container/
//   container-edit.repository.ts

export interface IContainerEditRepository {

  containerExists(
    systemId:     number,
    fileSystemId: number
  ): Promise<boolean>;

  stageContainerCreate(
    container: Container,
    sessionId: number,
    groupId:   string    // required — container is always created as part of a multi-entity group
  ): Promise<void>;

  // TODO: stageContainerPropertyDefaults(containerSystemId, sessionId, groupId)
  //       Reads container property definitions and stages CREATE edit_actions with default payloads.
  //       Requires a read port for container property definitions. Deferred — no DTO defined yet.
}
```

### 14.4 IModuleEditRepository — stageModuleCreate

`stageModuleCreate` is defined in the main `IModuleEditRepository` interface (§6). It accepts a full `SpfModule` domain object, which carries `dataPorts` and `controlPorts` via the `Node` base class, and writes CREATE edit_actions for the module, its node, and all its ports under the same `groupId`.

---

## 15. Add Module — UnitOfWork (additions)

```typescript
export interface UnitOfWork {
  // ... existing methods ...
  getModuleDefinitionReadRepository(): IModuleDefinitionReadRepository;
  getSubgraphEditRepository():         ISubgraphEditRepository;
  getContainerEditRepository():        IContainerEditRepository;
}
```

---

## 16. Add Module — Command and Handler (core)

### 16.1 Command

```typescript
// packages/core/src/application/module/add-module/add-module.command.ts

export class AddModuleCommand extends BaseCommand {
  constructor(
    public readonly fileSystemId:      number,
    public readonly moduleId:          number,          // natural module ID (= moduleDefinitionId)
    public readonly procId:            number,          // processor ID
    public readonly parentId:          number | null,   // parent node (subsystem); null = top-level
    public readonly subgraphSystemId:  number | null,   // null → auto-create Subgraph (Variant 1)
    public readonly containerSystemId: number | null,   // null → auto-create Container (Variants 1, 2)
    public readonly sessionId:         number,
  ) { super(); }
}
```

### 16.2 Handler

```typescript
// packages/core/src/application/module/add-module/add-module.handler.ts

export class AddModuleHandler implements CommandHandler<AddModuleCommand> {
  async handle(command: AddModuleCommand, uow: UnitOfWork): Promise<void> {
    await uow.startTransaction();
    try {
      const groupId = generateUuid();   // shared across ALL edit_actions for this call

      // ── 1. Load definition ──────────────────────────────────────────────────
      const defRepo = uow.getModuleDefinitionReadRepository();
      const definition = await defRepo.findByModuleIdAndProcId(
        command.moduleId, command.procId, command.fileSystemId
      );
      if (!definition) throw new EntityNotFoundException('SpfModuleDefinition', command.moduleId);

      const subgraphRepo  = uow.getSubgraphEditRepository();
      const containerRepo = uow.getContainerEditRepository();
      const moduleRepo    = uow.getModuleEditRepository();

      // ── 2. Subgraph (Variant 1: auto-create) ─────────────────────────────────
      let subgraphSystemId: number;

      if (command.subgraphSystemId === null) {
        subgraphSystemId = uow.idPort.getNextId(command.fileSystemId);
        const subgraph = new Subgraph({
          systemId:     subgraphSystemId,
          subgraphId:   subgraphSystemId,   // natural ID = systemId for server-created subgraphs
          name:         `SG_${subgraphSystemId}`,   // default name; rename API can change later
          isExported:   false,
          fileSystemId: command.fileSystemId,
        });
        await subgraphRepo.stageSubgraphCreate(subgraph, command.sessionId, groupId);
        // TODO: await subgraphRepo.stageSubgraphPropertyDefaults(subgraphSystemId, command.sessionId, groupId);
      } else {
        subgraphSystemId = command.subgraphSystemId;
        const exists = await subgraphRepo.subgraphExists(subgraphSystemId, command.fileSystemId);
        if (!exists) throw new EntityNotFoundException('Subgraph', subgraphSystemId);
      }

      // ── 3. Container (Variants 1 and 2: auto-create) ─────────────────────────
      let resolvedContainerSystemId: number;

      if (command.containerSystemId === null) {
        resolvedContainerSystemId = uow.idPort.getNextId(command.fileSystemId);
        // Business rule: use the first container type the definition permits
        const containerTypeSystemId = [...definition.containerTypesSystemIds][0] ?? null;
        const container = new Container(
          resolvedContainerSystemId,
          resolvedContainerSystemId,
          containerTypeSystemId,    // FK to container_types — no name lookup needed
          command.fileSystemId,
        );
        await containerRepo.stageContainerCreate(container, command.sessionId, groupId);
        // TODO: await containerRepo.stageContainerPropertyDefaults(resolvedContainerSystemId, command.sessionId, groupId);
      } else {
        resolvedContainerSystemId = command.containerSystemId;
        const exists = await containerRepo.containerExists(resolvedContainerSystemId, command.fileSystemId);
        if (!exists) throw new EntityNotFoundException('Container', resolvedContainerSystemId);
      }

      // ── 4. Build ports from definition ────────────────────────────────────────
      const dataPorts: DataPort[] = definition.dataPortGroups.flatMap(group =>
        group.staticPortDefinitions.map(def => new DataPort({
          systemId:   uow.idPort.getNextId(command.fileSystemId),
          dataPortId: def.dataPortId,
          portIoType: group.portIoType,
          isStatic:   true,
          name:       def.name,
        }))
      );

      const moduleSystemId = uow.idPort.getNextId(command.fileSystemId);

      const controlPorts: ControlPort[] = definition.staticControlPorts.map(def =>
        new ControlPort({
          systemId:        uow.idPort.getNextId(command.fileSystemId),
          portId:          def.portId,
          isStatic:        true,
          nodeSystemId:    moduleSystemId,
          name:            def.portName,
          intentSystemIds: [],
        })
      );

      // ── 5. Build and stage module (+ node + ports) ────────────────────────────
      const module = new SpfModule({
        systemId:           moduleSystemId,
        instanceId:         command.moduleId,
        definitionSystemId: definition.systemId,
        containerSystemId:  resolvedContainerSystemId,
        subgraphSystemId,
        fileSystemId:       command.fileSystemId,
        parentSystemId:     command.parentId ?? undefined,
        dataPorts,
        controlPorts,
      });

      await moduleRepo.stageModuleCreate(module, command.sessionId, groupId);

      await uow.commit();
    } catch (e) {
      await uow.rollback();
      throw e;
    }
  }
}
```

**Handler responsibilities:**
1. Generate `groupId` — shared across all repos
2. Load definition context (single read call)
3. Create or validate Subgraph, then Container, then Module — in dependency order
4. Build domain objects (Subgraph, Container, SpfModule with ports) from definition data
5. Delegate all staging to repos — no payload construction or DB knowledge in handler

---

## 17. Add Module — Infrastructure

### 17.1 ModuleEditRepository — stageModuleCreate

```typescript
async stageModuleCreate(module: SpfModule, sessionId: number, groupId: string): Promise<void> {

  // Node (same systemId as module — 1:1)
  await this.stagingService.stageEntityCreate({
    systemId: module.systemId, aggregateId: module.systemId,
    tableName: ENTITY_NAMES.Node,
    payload: {
      systemId:     module.systemId,
      type:         'module',
      parentId:     module.parentId ?? null,
      fileSystemId: module.fileSystemId,
    },
    sessionId, groupId,
  });

  // SpfModule
  await this.stagingService.stageEntityCreate({
    systemId: module.systemId, aggregateId: module.systemId,
    tableName: ENTITY_NAMES.SpfModule,
    payload: {
      systemId:           module.systemId,
      instanceId:         module.instanceId,
      alias:              module.alias,
      definitionSystemId: module.definitionSystemId,
      containerSystemId:  module.containerSystemId,
      subgraphSystemId:   module.subgraphSystemId,
      fileSystemId:       module.fileSystemId,
    },
    sessionId, groupId,
  });

  // DataPorts
  for (const port of module.dataPorts) {
    await this.stagingService.stageEntityCreate({
      systemId: port.systemId, aggregateId: module.systemId,
      tableName: ENTITY_NAMES.DataPort,
      payload: {
        systemId:     port.systemId,
        dataPortId:   port.dataPortId,
        portIoType:   port.portIoType,
        isStatic:     port.isStatic,
        name:         port.name,
        nodeSystemId: module.systemId,   // infrastructure FK derived from module
      },
      sessionId, groupId,
    });
  }

  // ControlPorts
  for (const port of module.controlPorts) {
    await this.stagingService.stageEntityCreate({
      systemId: port.systemId, aggregateId: module.systemId,
      tableName: ENTITY_NAMES.ControlPort,
      payload: {
        systemId:     port.systemId,
        portId:       port.portId,
        isStatic:     port.isStatic,
        name:         port.name,
        nodeSystemId: port.nodeSystemId,
      },
      sessionId, groupId,
    });
  }
}
```

### 17.2 SubgraphEditRepository

```typescript
export class SubgraphEditRepository implements ISubgraphEditRepository {

  async subgraphExists(systemId, fileSystemId): Promise<boolean> {
    const row = await this.qr.manager
      .createQueryBuilder()
      .select('1')
      .from(ENTITY_NAMES.Subgraph, 's')
      .where('s.systemId = :systemId AND s.fileSystemId = :fileSystemId', { systemId, fileSystemId })
      .getRawOne();
    return !!row;
  }

  async stageSubgraphCreate(subgraph, sessionId, groupId): Promise<void> {
    await this.stagingService.stageEntityCreate({
      systemId: subgraph.systemId, aggregateId: subgraph.systemId,
      tableName: ENTITY_NAMES.Subgraph,
      payload: {
        systemId:     subgraph.systemId,
        subgraphId:   subgraph.subgraphId,
        name:         subgraph.name,
        isExported:   subgraph.isExported,
        fileSystemId: subgraph.fileSystemId,
      },
      sessionId, groupId,
    });
    // TODO: stage default property data rows once ISubgraphEditRepository.stageSubgraphPropertyDefaults is implemented
  }
}
```

### 17.3 ContainerEditRepository

```typescript
export class ContainerEditRepository implements IContainerEditRepository {

  async containerExists(systemId, fileSystemId): Promise<boolean> {
    const row = await this.qr.manager
      .createQueryBuilder()
      .select('1')
      .from(ENTITY_NAMES.Container, 'c')
      .where('c.systemId = :systemId AND c.fileSystemId = :fileSystemId', { systemId, fileSystemId })
      .getRawOne();
    return !!row;
  }

  async stageContainerCreate(container, sessionId, groupId): Promise<void> {
    await this.stagingService.stageEntityCreate({
      systemId: container.systemId, aggregateId: container.systemId,
      tableName: ENTITY_NAMES.Container,
      payload: {
        systemId:              container.systemId,
        containerId:           container.containerId,
        containerTypeSystemId: container.containerTypeSystemId,
        fileSystemId:          container.fileSystemId,
      },
      sessionId, groupId,
    });
    // TODO: stage default property data rows once IContainerEditRepository.stageContainerPropertyDefaults is implemented
  }
}
```

---

## 18. Add Module — API Layer

> **Note:** Full API design is owned by a separate API LLD. This section identifies the command contract so the API LLD has what it needs.

`AddModuleCommand` is dispatched from the `POST /spf-modules` endpoint already present in swagger (`BaseSpfModuleRequest` — `moduleId`, `procId`, `parentId?`, `subgraphSystemId?`, `containerSystemId?`). The controller resolves `sessionId` from the active session before dispatching.

Property data creation for auto-created Subgraph and Container is deferred. When the API LLD designs those operations, they will dispatch into `ISubgraphEditRepository.stageSubgraphPropertyDefaults` and `IContainerEditRepository.stageContainerPropertyDefaults` respectively once those methods are implemented.

---

## 19. Add Module — End-to-End Trace (Variant 1: empty canvas)

```
POST /spf-modules  body:{ moduleId:0x12, procId:0x01 }
  — subgraphId absent, containerId absent → Variant 1

SessionModeGuard: session active, mode=DESIGNER ✓

AddModuleHandler:
  groupId = uuid("abc-123")

  ─ Definition lookup ──────────────────────────────────────────────────
  defRepo.findByModuleIdAndProcId(0x12, 0x01, fileId)
    → definition: { staticControlPorts:[CP1], dataPortGroups:[{portIoType:Input, staticPorts:[DP1]}],
                    containerTypesSystemIds:{500}, systemId:DEF }

  ─ Subgraph (auto-create) ─────────────────────────────────────────────
  SG_ID = idPort.getNextId(fileId)
  new Subgraph({ systemId:SG_ID, subgraphId:SG_ID, name:"SG_<SG_ID>", isExported:false })
  subgraphRepo.stageSubgraphCreate(subgraph, sessionId, "abc-123")
    → EntityStagingService.stageEntityCreate(
        { systemId:SG_ID, aggregateId:SG_ID, tableName:'subgraphs', ... })
    → EditActionsService.insertEditAction
        INSERT: { systemId:SG_ID, aggId:SG_ID, op:CREATE,
                  payload:{systemId:SG_ID,name:"SG_<SG_ID>",...},
                  groupId:"abc-123", baseVer:null, validUntil:NULL }

  ─ Container (auto-create) ────────────────────────────────────────────
  // containerTypeSystemId comes directly from definition — no name lookup needed
  containerTypeSystemId = [...definition.containerTypesSystemIds][0]  // = 500
  CT_ID = idPort.getNextId(fileId)
  new Container(CT_ID, CT_ID, 500, fileId)
  containerRepo.stageContainerCreate(container, sessionId, "abc-123")
    → INSERT: { systemId:CT_ID, aggId:CT_ID, op:CREATE,
                payload:{systemId:CT_ID, containerTypeSystemId:500, ...},
                groupId:"abc-123", baseVer:null, validUntil:NULL }

  ─ Module, Node, Ports ────────────────────────────────────────────────
  DP1_ID = idPort.getNextId(fileId)   // DataPort for DP1
  CP1_ID = idPort.getNextId(fileId)   // ControlPort for CP1
  M_ID   = idPort.getNextId(fileId)   // Module/Node

  moduleRepo.stageModuleCreate(module, sessionId, "abc-123")

    Node INSERT:    { systemId:M_ID,   aggId:M_ID,   op:CREATE, groupId:"abc-123" }
    Module INSERT:  { systemId:M_ID,   aggId:M_ID,   op:CREATE, groupId:"abc-123",
                      payload:{instanceId:0x12, definitionSystemId:DEF,
                               subgraphSystemId:SG_ID, containerSystemId:CT_ID, ...} }
    DataPort INSERT:{ systemId:DP1_ID, aggId:M_ID,   op:CREATE, groupId:"abc-123",
                      payload:{dataPortId:DP1.id, portIoType:Input, nodeSystemId:M_ID, ...} }
    CtrlPort INSERT:{ systemId:CP1_ID, aggId:M_ID,   op:CREATE, groupId:"abc-123",
                      payload:{portId:CP1.portId, nodeSystemId:M_ID, ...} }

  commit()

─ edit_actions written (5 rows, all groupId="abc-123") ──────────────────
  SG_ID  → aggregateId=SG_ID,   tableName=subgraphs,       op=CREATE
  CT_ID  → aggregateId=CT_ID,   tableName=containers,      op=CREATE
  M_ID   → aggregateId=M_ID,    tableName=nodes,            op=CREATE
  M_ID   → aggregateId=M_ID,    tableName=spf_modules,      op=CREATE
  DP1_ID → aggregateId=M_ID,    tableName=data_ports,       op=CREATE
  CP1_ID → aggregateId=M_ID,    tableName=control_ports,    op=CREATE

─ Undo: /activate-change on any row in groupId="abc-123" reverts all 6 ─
```

---

*End of Document*
