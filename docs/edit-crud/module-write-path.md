<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# LLD2 — Module Write Path

**Status:** Draft
**Owner:** Nithin Simon

**Parent:** `overall-design.md` (this folder). Read that first for storage model, aggregate registry, and write-flow context.
**Depends on:** `foundation.md` (LLD1) — schema, `PendingChangeWriter`, `WriteContext`, `SessionGuard`, `CommandBus` mode check.
**Prior art:** `docs/superpowers/specs/2026-06-11-modification-framework-design.md` — first-pass module write path against the old schema. LLD2 supersedes it, retaining the domain-verb repo pattern but updating for the new `edit_actions` shape, `PendingChangeWriter`, and `ActiveSession` / `WriteContext`.
**Source of truth:** `docs/superpowers/specs/2026-07-04-modification-framework-requirements.md`

**Scope:** the module aggregate's write path — a consolidated PATCH endpoint for module structural updates (alias, containerId, port counts) and a POST endpoint for Add Module (three creation variants with auto-created Subgraph and Container). Also delivers the sibling `ISubgraphEditRepository`, `IContainerEditRepository`, `ISubsystemEditRepository`, `IModuleDefinitionEditRepository`, and link-read ports (`IDataLinkReadRepository`, `IControlLinkReadRepository`) needed by AddModule and PATCH port-count changes. Sized for one PR.

---

## 1. Purpose & Scope

- One paragraph on this LLD's role — the first user-visible write path on top of LLD1's foundation.
- **In scope:**
  - `IModuleEditRepository` port + adapter with domain-verb methods: `renameModule`, `changeContainer`, `changeNumberOfInputPorts`, `changeNumberOfOutputPorts`, `changeNumberOfControlPorts`, `addDataPort`, `addControlPort`, `removeDataPort`, `removeControlPort`, `createModule`.
  - `ISubgraphEditRepository` port + adapter: `subgraphExists`, `createSubgraph`. Property-data defaults on auto-create are deferred (§10).
  - `IContainerEditRepository` port + adapter: `containerExists`, `createContainer`, `getContainerById`. Property-data defaults on auto-create are deferred.
  - `ISubsystemEditRepository` port + adapter: `subsystemExists`. Subsystem CREATE/EDIT is deferred; LLD2 only validates existence when AddModule's `parentId` references one.
  - `IModuleDefinitionEditRepository` port + adapter: `findByModuleIdAndProcId`.
  - `IDataLinkReadRepository` port + adapter: `getLinksByPortSystemIds` — needed by PATCH port-count-decrease flow to detect "unused" ports.
  - `IControlLinkReadRepository` port + adapter: `getLinksByPortSystemIds` — same purpose for ControlPorts.
  - CQRS commands + handlers:
    - `PatchSpfModuleCommand` / `PatchSpfModuleHandler` — one consolidated command backing `PATCH /spf-modules/:id` with optional fields (alias, containerId, numberOfInputPorts, numberOfOutputPorts, numberOfControlPorts).
    - `AddModuleCommand` / `AddModuleHandler` — backs `POST /spf-modules` (three variants).
  - Existence validation via read ports (REQ-VAL-01, REQ-VAL-02).
  - Container-type compatibility validation on PATCH containerId change.
  - Port-count validation (against definition max) + LIFO unused-port removal on PATCH port-count decrease.
  - Wiring in `UnitOfWork`, command handler registry.
- **Out of scope:**
  - Module DELETE and last-module cascade (LLD5).
  - Read overlay updates for module GETs (LLD3).
  - Commit service, stage/unstage APIs (LLD4).
  - Property-data seeding for auto-created Subgraph and Container (deferred; see §10 open question).
  - DiffMerge writes and definition CRUD (LLD6a-c).

---

## 2. Requirements Owned

- REQ-MOD-01 to REQ-MOD-04 (module modification rules, accumulated payload, base-version preservation).
- REQ-PORT-01 to REQ-PORT-03 (port modification rules; port names read-only per REQ-PORT-03).
- REQ-ADD-01 to REQ-ADD-08 minus REQ-ADD-04 property-data seeding which is deferred to a follow-up on LLD2 or a small dedicated LLD (§10). Specifically LLD2 delivers:
  - REQ-ADD-01 three creation variants.
  - REQ-ADD-02, REQ-ADD-03, REQ-ADD-05 default subgraph name, container type resolution, definition lookup.
  - REQ-ADD-06 port auto-creation from definition (static ports only).
  - REQ-ADD-07 (atomicity via shared `groupId`) — atomically stages every entity produced by Add Module.
  - REQ-ADD-08 multi-aggregate spanning.
- REQ-VAL-01 (existence check on UPDATE), REQ-VAL-02 (existence check on AddModule variants with provided subgraphSystemId / containerSystemId).
- REQ-SESS-06 mode allow-list enforcement — LLD2 declares `allowedModes = [DESIGNER, DIFF_MERGE]` per REQ-SESS-07 on all commands.

---

## 3. Frozen Constraints (unchanged by this LLD)

- `spf_modules`, `nodes`, `data_ports`, `control_ports`, `subgraphs`, `containers`, `spf_module_definitions` entity tables and TypeORM schemas.
- Domain entities: `SpfModule`, `DataPort`, `ControlPort`, `Subgraph`, `Container`, `SpfModuleDefinition` — imported by write repos and handlers.
- LLD1 deliverables (`PendingChangeWriter`, `WriteContext` on UoW, `SessionGuard`, `CommandBus` mode check).

---

## 4. Architecture Overview (LLD2 slice)

LLD2 sits on top of LLD1's foundation. It adds aggregate-specific edit repos + CQRS handlers, but every write ultimately flows into LLD1's `PendingChangeWriter`.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  @arc/api                                                               │
│    SpfModuleController + endpoints                                      │
│    @UseGuards(SessionGuard) applied per endpoint                        │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │  commandBus.execute(cmd, session)
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  @arc/core (application)                                                │
│                                                                         │
│    Commands (each declares static readonly allowedModes):               │
│      SetModuleAliasCommand                                              │
│      SetModuleContainerCommand                                          │
│      AddDataPortCommand                                                 │
│      AddControlPortCommand                                              │
│      AddModuleCommand                                                   │
│                                                                         │
│    Handlers (one per command; register in CommandHandlerRegistry):      │
│      SetModuleAliasHandler                                              │
│      SetModuleContainerHandler                                          │
│      AddDataPortHandler                                                 │
│      AddControlPortHandler                                              │
│      AddModuleHandler                                                   │
│                                                                         │
│    Ports (new):                                                         │
│      IModuleEditRepository                                              │
│      ISubgraphEditRepository                                            │
│      IContainerEditRepository                                           │
│      IModuleDefinitionEditRepository                                    │
│                                                                         │
│    Existing (unchanged):                                                │
│      Domain entities (SpfModule, DataPort, ControlPort, Subgraph, ...)  │
│      IdGenerationPort           (system IDs — existing)                 │
│      NaturalIdGenerationPort    (natural IDs — existing; see §5.4)      │
│      BaseCommand (extended in LLD1)                                     │
│      CommandBus (extended in LLD1)                                      │
│      UnitOfWork port (extended in LLD1)                                 │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │  port implementations
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  @arc/infrastructure/persistence                                        │
│                                                                         │
│    Adapters (new):                                                      │
│      ModuleEditRepository        →  PendingChangeWriter (LLD1)          │
│      SubgraphEditRepository      →  PendingChangeWriter                 │
│      ContainerEditRepository     →  PendingChangeWriter                 │
│      ModuleDefinitionEditRepository (raw TypeORM read)                  │
│                                                                         │
│    Extended (LLD1):                                                     │
│      TypeOrmUnitOfWork  ← expose new repos via new getters              │
│                                                                         │
│    Reused (LLD1):                                                       │
│      PendingChangeWriter, WriteContext, EditActionsQueryService         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Data flow per write API call:**

```
1. Client → HTTP request (POST/PATCH on /projects/{projectId}/spf-modules/...).
2. SessionGuard resolves session → request.arcSession populated.
3. Controller reads request.arcSession, builds command, calls
     commandBus.execute(cmd, request.arcSession).
4. CommandBus mode check (LLD1) — allowed? → 403 if not.
5. CommandBus stamps WriteContext = { session, groupId: uuid() } on UoW.
6. CommandBus starts transaction, invokes handler.
7. Handler:
     - Validates entity existence via read ports (moduleExists, containerExists...).
     - For AddModule: loads definition, allocates systemIds, constructs domain objects.
     - Calls edit repo method(s).
8. Edit repo adapter maps domain args → PendingChangeWriter call
     (fieldGroup + payload derived from mode + operation type).
9. PendingChangeWriter (LLD1) writes edit_actions row(s), captures baseVersion.
10. CommandBus commits transaction, returns { groupId, changeIds }.
```

---

## 5. Aggregate Write Pattern

Every edit-repo method across every aggregate follows the same shape. LLD2 establishes it for module/subgraph/container; LLD3 and Phase 2 LLDs extend the same pattern to other aggregates.

### 5.1 Method signature convention

```ts
recordXxxChange(
  ...positional required domain args...,   // ids, domain values, or domain objects
  uow: UnitOfWork,
  options?: {
    fieldGroup?:         string
    crossEntityGroupId?: string
    cache?:              boolean
    source?:             Source                     // default MANUAL
    changeStatus?:       "STAGED" | "UNSTAGED"      // honored only when source = DIFF_TOOL
  },
): Promise<void>
```

**Rules:**
- **Domain-verb method names** — `renameModule`, `changeContainer`, `addDataPort`, `createModule`. Not `stage*`. The repository *class* (`IModuleEditRepository`) already conveys the "pending edit" nature.
- **`sessionId`, `groupId`, `mode` are read from `uow.getWriteContext()`** inside the adapter. Never on the method signature.
- **Options bag is optional.** DESIGNER handlers omit it entirely — defaults apply (`source = MANUAL`, `fieldGroup = null` (accumulator), `cache = false`).
- **Return type `Promise<void>`.** Row identifiers are exposed at the CommandBus level (`{ groupId, changeIds }` in the write response); repo callers don't need per-write results.

### 5.2 Handler pattern

Every command handler follows the same skeleton:

```ts
class SomeHandler implements CommandHandler<SomeCommand> {
  async handle(command: SomeCommand, uow: UnitOfWork): Promise<void> {
    // 1. Get repos from UoW
    const moduleRepo = uow.getModuleEditRepository()

    // 2. Validate existence via read-side checks
    const exists = await moduleRepo.moduleExists(command.moduleSystemId, command.fileSystemId)
    if (!exists) throw new EntityNotFoundException('SpfModule', command.moduleSystemId)

    // 3. For multi-aggregate handlers: load context (definitions), allocate systemIds,
    //    construct domain objects. AddModule specifically.

    // 4. Call domain-verb repo method(s)
    await moduleRepo.renameModule(command.moduleSystemId, command.newAlias, uow)

    // 5. (No commit / return statement — CommandBus owns transaction lifecycle)
  }
}
```

**Handler responsibilities:**
- Read-side existence validation (REQ-VAL-01, REQ-VAL-02).
- ID allocation for CREATEs — see §5.4 for the two-tier system+natural ID pattern.
- Domain-object construction (`new SpfModule(...)`, `new DataPort(...)`).
- Delegation to edit repo methods with pure domain args.

**Handler must NOT:**
- Reference SQL, TypeORM, or `edit_actions` row shapes.
- Compute `aggregateId`, `fieldGroup`, or `groupId` — those live in the adapter / CommandBus.
- Perform DB writes directly. All writes go through edit repos.
- Own the transaction — CommandBus starts and commits.

### 5.3 Adapter pattern

Every edit-repo adapter is a thin translation layer over `PendingChangeWriter`:

```ts
class ModuleEditRepository implements IModuleEditRepository {
  constructor(
    private readonly writer: PendingChangeWriter,   // LLD1
    private readonly qr: QueryRunner,                // for existence checks
  ) {}

  async moduleExists(systemId: number, fileSystemId: number): Promise<boolean> {
    const row = await this.qr.manager
      .createQueryBuilder()
      .select('1')
      .from(ENTITY_NAMES.SpfModule, 'm')
      .where('m.systemId = :systemId AND m.fileSystemId = :fileSystemId',
             { systemId, fileSystemId })
      .getRawOne()
    return !!row
  }

  async renameModule(
    moduleSystemId: number,
    newAlias: string,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void> {
    await this.writer.writeDelta({
      targetTable:    ENTITY_NAMES.SpfModule,
      targetSystemId: moduleSystemId,
      aggregateId:    moduleSystemId,               // module is its own aggregate root
      delta:          { alias: newAlias },
      ...options,
    }, uow)
  }

  // ... changeContainer, addDataPort, addControlPort, createModule similarly ...
}
```

**Adapter responsibilities:**
- Domain object → delta/payload record mapping.
- Assigns `aggregateId` and `targetTable` per §5 of overall-design.
- Derives infrastructure-only FK columns (e.g., `nodeSystemId` on a DataPort payload, since domain `DataPort` has no `nodeSystemId` field).
- Delegates the write to `PendingChangeWriter.writeDelta` / `writeCreate` / `writeDelete`.
- Existence-check methods use `qr.manager` directly (no writer involvement).

**Adapter must NOT:**
- Interact with the command bus.
- Know about `groupId` (the writer reads it from UoW's WriteContext).
- Own transaction control.

### 5.4 ID Allocation — two-tier pattern

Every entity has TWO identifiers, allocated by two different ports. Both are needed when constructing new domain objects for CREATE.

| ID | Purpose | Source |
|---|---|---|
| `systemId` | Server-generated primary key, unique across the DB. Used by FK columns, edit_actions, and internal wiring. | `IdGenerationPort.getNextId(fileSystemId)` — existing. |
| Natural ID (`subgraphId`, `containerId`, `instanceId`, `parentId` for subsystems) | Domain-visible identifier, unique per file per entity kind. Used in cross-references within `.awsp`/`.acdb` binary formats and by the module runtime. | `NaturalIdGenerationPort.getNextId(fileSystemId, type)` where `type: NaturalIdType` is one of `SUBGRAPH`, `CONTAINER`, `MODINSTANCE`, `SUBSYSTEM`. |

**When to use which:**
- Subgraph → `subgraph.systemId = idGeneration.getNextId(fileId)` **and** `subgraph.subgraphId = naturalIdGeneration.getNextId(fileId, SUBGRAPH)`.
- Container → same pattern with `NaturalIdType.CONTAINER`.
- SpfModule → `systemId` via `IdGenerationPort`; `instanceId` via `naturalIdGeneration.getNextId(fileId, MODINSTANCE)`.
- Node — 1:1 with SpfModule; shares systemId. No separate natural ID.
- DataPort / ControlPort — `systemId` via `IdGenerationPort`; natural IDs (`dataPortId`, `portId`) come from the **module definition** (`DataPortDefinition.dataPortId`, `StaticControlPortDefinition.portId`), NOT the generator. They are definition-scoped identifiers, not file-scoped.

**Handler access:**

Both ports are injected into command handlers via `CommandHandlerDependencies` (the existing pattern used by `CommandHandlerRegistry`):

```ts
export interface CommandHandlerDependencies {
  uow: UnitOfWork
  idGeneration: IdGenerationPort              // ← systemId allocator
  naturalIdGeneration: NaturalIdGenerationPort // ← natural ID allocator
  // ... other existing deps ...
}

class AddModuleHandler {
  constructor(
    private readonly idGeneration: IdGenerationPort,
    private readonly naturalIdGeneration: NaturalIdGenerationPort,
  ) {}
  // ...
}
```

Handlers access them as `this.idGeneration` and `this.naturalIdGeneration`. Not through UoW — natural ID and systemId allocation are separate concerns from transactional state.

**Post-commit / release:**
- Deferred to Commit LLD and Delete Module LLD (LLD5). Both `IdGenerationPort` and `NaturalIdGenerationPort` support `release()` for freeing IDs after DELETE. LLD2's Add Module allocates but does not release.

---

## 6. `IModuleEditRepository`

### 6.1 Port interface (`@arc/core`)

```ts
// packages/core/src/application/ports/persistence/repositories/module/module-edit.repository.ts
export interface IModuleEditRepository {

  // ── Existence check (REQ-VAL-01) ──────────────────────────────────────
  moduleExists(systemId: number, fileSystemId: number): Promise<boolean>

  // Read supporting the port-count and container-change flows in PATCH.
  findModuleForPatch(systemId: number, fileSystemId: number): Promise<SpfModuleReadModel | null>

  // ── Module root ───────────────────────────────────────────────────────
  renameModule(
    moduleSystemId: number,
    newAlias: string,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>

  changeContainer(
    moduleSystemId: number,
    newContainerSystemId: number,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>

  // ── Port-count changes (used by PATCH) ────────────────────────────────
  // Adds ports of the specified kind up to the requested count, or removes
  // unused ports (LIFO on systemId) to reach the requested count. The handler
  // (§11) is responsible for the count-delta computation and the "unused only"
  // check. These repo methods just stage the individual add/remove writes.

  // ── Individual ports (create) ─────────────────────────────────────────
  // Used internally by AddModule (§6.2) and by PatchSpfModuleHandler when
  // port count increases. Not exposed as their own CQRS commands.
  addDataPort(
    port: DataPort,
    moduleSystemId: number,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>

  addControlPort(
    port: ControlPort,
    moduleSystemId: number,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>

  // ── Individual ports (delete) ─────────────────────────────────────────
  // Used by PatchSpfModuleHandler when port count decreases. Full "delete
  // module + cascade" is LLD5; these are per-port deletes only.
  removeDataPort(
    dataPortSystemId: number,
    moduleSystemId: number,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>

  removeControlPort(
    controlPortSystemId: number,
    moduleSystemId: number,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>

  // ── Module + all children (atomic creation) ───────────────────────────
  createModule(
    module: SpfModule,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>
}
```

`EditOptions` is the shared options-bag type (§5.1), exported from a shared location under `@arc/core/application/ports/persistence/`.

`SpfModuleReadModel` on `findModuleForPatch` returns the module with its current ports enumerated — needed for port-count delta computation. If a suitable read shape already exists on the read side, reuse it; otherwise minimum fields the PATCH handler needs are: `systemId`, `containerSystemId`, `definitionSystemId`, `dataPorts[]` (with systemId + portIoType), `controlPorts[]` (with systemId).

### 6.2 Adapter (`@arc/persistence`)

```
packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/
  module-edit.repository.ts
```

- Constructed per-request from `TypeOrmUnitOfWork` with `PendingChangeWriter` (shared) + `QueryRunner` (per-transaction).
- `moduleExists` — TypeORM SELECT `1` from `spf_modules` filtered by `(systemId, fileSystemId)`.
- `findModuleForPatch` — reads `spf_modules` + joined `data_ports` + `control_ports` for this module. **Uses raw committed state** — no overlay merge (PATCH handler runs inside the transaction that just staged the writes; committed baseline is what matters for count math).
- `renameModule` → `writer.writeDelta({ targetTable: SpfModule, targetSystemId: moduleSystemId, aggregateId: moduleSystemId, delta: { alias: newAlias }, ...options })`.
- `changeContainer` → same pattern with `{ containerSystemId: newContainerSystemId }`.
- `addDataPort` → `writer.writeCreate({ targetTable: DataPort, targetSystemId: port.systemId, aggregateId: moduleSystemId, payload: {...port fields..., nodeSystemId: moduleSystemId}, ...options })`.
- `addControlPort` → same pattern with `targetTable: ControlPort`. `port.nodeSystemId` set by caller.
- `removeDataPort` → `writer.writeDelete({ targetTable: DataPort, targetSystemId: dataPortSystemId, aggregateId: moduleSystemId, ...options })`.
- `removeControlPort` → same pattern with `targetTable: ControlPort`.
- `createModule` → sequence of `writer.writeCreate` calls in FK order:
  1. Node row (`aggregateId = module.systemId, targetTable = Node`).
  2. SpfModule row (`aggregateId = module.systemId, targetTable = SpfModule`).
  3. Each DataPort in `module.dataPorts` (all `aggregateId = module.systemId, targetTable = DataPort`).
  4. Each ControlPort in `module.controlPorts` (same aggregate, `targetTable = ControlPort`).
  All share the ambient `groupId` from WriteContext, giving REQ-ADD-07 single-undo-step atomicity.

### 6.3 Reused infrastructure

- `IdGenerationPort` — handlers allocate `systemId` via `this.idGeneration.getNextId(fileSystemId)` before calling `addDataPort` / `addControlPort` / `createModule` (see §5.4).
- `NaturalIdGenerationPort` — handlers allocate natural IDs (`subgraphId`, `containerId`, `instanceId`) via `this.naturalIdGeneration.getNextId(fileSystemId, type)` (see §5.4).
- `ENTITY_NAMES` — canonical `targetTable` values.
- `PendingChangeWriter` (LLD1).

---

## 6a. Link Read Repositories (support for port-count decrease)

Two read-only ports supporting the "which ports are unused" check in `PatchSpfModuleHandler` when port count decreases.

### 6a.1 Port interfaces (`@arc/core`)

```ts
// packages/core/src/application/ports/persistence/repositories/data-link/data-link-read.repository.ts
export interface IDataLinkReadRepository {
  // Returns the systemIds of all DataLinks that reference ANY of the given
  // DataPort systemIds as source or destination.
  getLinksByPortSystemIds(portSystemIds: number[]): Promise<Array<{
    linkSystemId: number
    portSystemId: number       // which of the input ports this link references
  }>>
}

// packages/core/src/application/ports/persistence/repositories/control-link/control-link-read.repository.ts
export interface IControlLinkReadRepository {
  getLinksByPortSystemIds(portSystemIds: number[]): Promise<Array<{
    linkSystemId: number
    portSystemId: number
  }>>
}
```

### 6a.2 Adapters

- Simple SELECT on `data_links` / `control_links` filtering by src or dst port systemId in the given list.
- No overlay — the PATCH handler wants raw committed link state to determine linkage.
- Empty input array → empty result (no query).

### 6a.3 Usage

Called by `PatchSpfModuleHandler` during port-count decrease flow. Handler computes which ports are unused by comparing the module's port systemIds against the linked-port set returned by these repos. See §11.2 for the full handler flow.

---

## 7. `ISubgraphEditRepository`

### 7.1 Port interface (`@arc/core`)

```ts
// packages/core/src/application/ports/persistence/repositories/subgraph/subgraph-edit.repository.ts
export interface ISubgraphEditRepository {
  subgraphExists(systemId: number, fileSystemId: number): Promise<boolean>

  createSubgraph(
    subgraph: Subgraph,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>

  // Deferred to follow-up (§10 / OQ-1):
  //   createSubgraphPropertyDefaults(subgraphSystemId: number, uow: UnitOfWork, options?: EditOptions): Promise<void>
}
```

### 7.2 Adapter

- `subgraphExists` — `SELECT 1 FROM subgraphs WHERE system_id = ? AND file_system_id = ?`.
- `createSubgraph` → `writer.writeCreate({ targetTable: Subgraph, targetSystemId: subgraph.systemId, aggregateId: subgraph.systemId, payload: {...subgraph fields...}, ...options })`.
- Placeholder in the file for `createSubgraphPropertyDefaults` — throws `NotImplementedException` until follow-up LLD lands.

---

## 8. `IContainerEditRepository`

### 8.1 Port interface (`@arc/core`)

```ts
// packages/core/src/application/ports/persistence/repositories/container/container-edit.repository.ts
export interface IContainerEditRepository {
  containerExists(systemId: number, fileSystemId: number): Promise<boolean>

  // Used by PatchSpfModuleHandler to check container type compatibility with the module's definition.
  getContainerById(systemId: number, fileSystemId: number): Promise<Container | null>

  createContainer(
    container: Container,
    uow: UnitOfWork,
    options?: EditOptions,
  ): Promise<void>

  // Deferred to follow-up (§10 / OQ-1):
  //   createContainerPropertyDefaults(containerSystemId: number, uow: UnitOfWork, options?: EditOptions): Promise<void>
}
```

### 8.2 Adapter

- `containerExists` — `SELECT 1 FROM containers WHERE system_id = ? AND file_system_id = ?`.
- `getContainerById` — full row fetch, returned as domain `Container` (with `containerTypeSystemId` visible for the PATCH type-compat check). Raw committed state, no overlay.
- `createContainer` → `writer.writeCreate({ targetTable: Container, targetSystemId: container.systemId, aggregateId: container.systemId, payload: {...container fields...}, ...options })`.
- Placeholder for `createContainerPropertyDefaults` — throws until follow-up.

---

## 8a. `ISubsystemEditRepository`

### 8a.1 Port interface (`@arc/core`)

```ts
// packages/core/src/application/ports/persistence/repositories/subsystem/subsystem-edit.repository.ts
export interface ISubsystemEditRepository {
  subsystemExists(systemId: number, fileSystemId: number): Promise<boolean>

  // Deferred: Subsystem CREATE / UPDATE / DELETE are out of scope for LLD2.
  // LLD5 (Delete Module) and a future subsystem-write LLD will extend this repo.
}
```

### 8a.2 Adapter

- `subsystemExists` — `SELECT 1 FROM nodes WHERE system_id = ? AND file_system_id = ? AND type = 'subsystem'`. Subsystems are stored in the `nodes` table with `type = 'subsystem'` (the same table also holds module nodes with `type = 'module'`).

### 8a.3 Usage in LLD2

Only one consumer — `AddModuleHandler`. When the command carries a non-null `parentId`, the handler validates the referenced subsystem exists in the target file before proceeding. If missing → `EntityNotFoundException('Subsystem', parentId)` → 404 at the api layer.

Subsystems are **never auto-created** by AddModule. If the client wants a module under a subsystem, that subsystem must already exist. (Contrast with Subgraph and Container, which are auto-created in Add-Module Variants 1 and 2 respectively.)

---

## 9. `IModuleDefinitionEditRepository`

### 9.1 Port interface (`@arc/core`)

```ts
// packages/core/src/application/ports/persistence/repositories/module/module-definition-edit.repository.ts
export interface IModuleDefinitionEditRepository {
  findByModuleIdAndProcId(
    moduleId: number,       // maps to SpfModuleDefinition.moduleDefinitionId
    procId: number,         // processor identifier
    fileSystemId: number,
  ): Promise<SpfModuleDefinition | null>
}
```

### 9.2 Adapter

- Reads `spf_module_definitions` joined with related definition tables (`processor_definitions`, `module_definition_processor_links`, `data_port_groups`, `data_port_definitions`, `static_control_port_definitions`, `module_definition_container_type_links`) — enough to construct the full domain `SpfModuleDefinition` needed by AddModule's port materialization.
- Returns a domain `SpfModuleDefinition` including:
  - `systemId`
  - `moduleDefinitionId`
  - `containerTypesSystemIds` (needed for REQ-ADD-03 — first-entry-wins container type resolution).
  - `dataPortGroups[]` with their `staticPortDefinitions[]` (needed for REQ-ADD-06 static DataPort creation).
  - `staticControlPorts[]` (needed for REQ-ADD-06 static ControlPort creation).
- Returns `null` when no definition matches `(moduleId, procId, fileSystemId)`; handler maps to 404 (REQ-ADD-05).

---

## 10. Property-Data Defaults on Auto-Create — Deferred

### 10.1 What's deferred

- REQ-ADD-04 requires that when a Subgraph or Container is auto-created (Add Module Variants 1 and 2), the framework also stages property-data rows using default payloads from subgraph/container property definitions.
- Requires:
  - A read port for subgraph property definitions.
  - A read port for container property definitions.
  - Domain-shaped defaults (may need DTO-level defaulting logic).
  - `createSubgraphPropertyDefaults` and `createContainerPropertyDefaults` on the respective edit repos.

### 10.2 Handling in LLD2

- Ports declared with TODO stubs on `ISubgraphEditRepository` and `IContainerEditRepository`.
- AddModule handler places TODO comments where the property-data seeding calls will land.
- Actual implementation is a follow-up LLD (or an extension to LLD2 in a follow-up PR).
- LLD2's Add Module stages Subgraph and Container CREATE rows but no property-data rows. Users may see subgraphs/containers with no property data — acceptable in Phase 1 dev.

Open question — track as OQ-1 in the requirements doc; expect resolution in the follow-up LLD.

---

## 11. Commands and Handlers

Two user-facing CQRS commands back the two write endpoints:

- `PatchSpfModuleCommand` — backs `PATCH /projects/:projectId/spf-modules/:spfModuleSystemId`.
- `AddModuleCommand` — backs `POST /projects/:projectId/spf-modules`.

The former per-field commands (`SetModuleAliasCommand`, `SetModuleContainerCommand`, `AddDataPortCommand`, `AddControlPortCommand`) are removed. `PATCH` handles all module structural updates in one call; individual port add/remove operations remain as internal `IModuleEditRepository` methods used by `AddModuleHandler` and `PatchSpfModuleHandler`.

Folder structure (`packages/core/src/application/`):

```
module/
  patch/
    patch-spf-module.command.ts
    patch-spf-module.handler.ts
  add-module/
    add-module.command.ts
    add-module.handler.ts
```

### 11.1 PatchSpfModuleHandler

Command:
```ts
// packages/core/src/application/module/patch/patch-spf-module.command.ts
export class PatchSpfModuleCommand extends BaseCommand {
  static readonly allowedModes: readonly SessionMode[] = [
    SESSION_MODE.Designer,
    SESSION_MODE.DiffMerge,   // REQ-SESS-07
  ]

  constructor(
    public readonly moduleSystemId:          number,
    public readonly fileSystemId:            number,
    public readonly alias?:                  string,
    public readonly containerSystemId?:      number,   // FK — must reference existing container
    public readonly numberOfInputPorts?:     number,
    public readonly numberOfOutputPorts?:    number,
    public readonly numberOfControlPorts?:   number,
  ) { super() }

  static fromPayload(p: Record<string, unknown>): PatchSpfModuleCommand {
    return new PatchSpfModuleCommand(
      p.moduleSystemId          as number,
      p.fileSystemId            as number,
      p.alias                   as string | undefined,
      p.containerSystemId       as number | undefined,
      p.numberOfInputPorts      as number | undefined,
      p.numberOfOutputPorts     as number | undefined,
      p.numberOfControlPorts    as number | undefined,
    )
  }
}
```

Handler:
```ts
// packages/core/src/application/module/patch/patch-spf-module.handler.ts
export class PatchSpfModuleHandler implements CommandHandler<PatchSpfModuleCommand> {
  constructor(
    private readonly idGeneration: IdGenerationPort,
  ) {}

  async handle(command: PatchSpfModuleCommand, uow: UnitOfWork): Promise<void> {
    const moduleRepo    = uow.getModuleEditRepository()
    const containerRepo = uow.getContainerEditRepository()
    const defRepo       = uow.getModuleDefinitionEditRepository()
    const dataLinkRead  = uow.getDataLinkReadRepository()
    const ctrlLinkRead  = uow.getControlLinkReadRepository()
    const fileId = command.fileSystemId

    // 0. Existence: the module.
    const module = await moduleRepo.findModuleForPatch(command.moduleSystemId, fileId)
    if (!module) throw new EntityNotFoundException('SpfModule', command.moduleSystemId)

    // 1. alias — trivial rename
    if (command.alias !== undefined) {
      await moduleRepo.renameModule(command.moduleSystemId, command.alias, uow)
    }

    // 2. containerSystemId — validate existence + type compatibility (§11.1.a)
    if (command.containerSystemId !== undefined) {
      await this.applyContainerChange(command.containerSystemId, module, defRepo, containerRepo, uow, moduleRepo, fileId)
    }

    // 3-5. port-count changes — see §11.1.b
    if (command.numberOfInputPorts !== undefined) {
      await this.applyDataPortCountChange(module, 'INPUT', command.numberOfInputPorts, defRepo, dataLinkRead, moduleRepo, uow, fileId)
    }
    if (command.numberOfOutputPorts !== undefined) {
      await this.applyDataPortCountChange(module, 'OUTPUT', command.numberOfOutputPorts, defRepo, dataLinkRead, moduleRepo, uow, fileId)
    }
    if (command.numberOfControlPorts !== undefined) {
      await this.applyControlPortCountChange(module, command.numberOfControlPorts, defRepo, ctrlLinkRead, moduleRepo, uow, fileId)
    }
  }
}
```

All writes staged within this handler share the same `groupId` via ambient WriteContext — the entire PATCH is one atomic undo step (REQ-ATO-01).

### 11.1.a Container change (with type-compatibility check)

New domain rule: the target container's `containerTypeSystemId` must be in the module definition's `containerTypesSystemIds` allowed list.

```ts
private async applyContainerChange(
  newContainerSystemId: number,
  module: SpfModuleReadModel,
  defRepo: IModuleDefinitionEditRepository,
  containerRepo: IContainerEditRepository,
  uow: UnitOfWork,
  moduleRepo: IModuleEditRepository,
  fileId: number,
): Promise<void> {
  const container = await containerRepo.getContainerById(newContainerSystemId, fileId)
  if (!container) throw new EntityNotFoundException('Container', newContainerSystemId)

  const definition = await defRepo.findByModuleIdAndProcId(
    module.moduleId, module.procId, fileId,   // fields available on SpfModuleReadModel
  )
  if (!definition) throw new EntityNotFoundException('SpfModuleDefinition', module.moduleId)

  const allowedTypes = new Set(definition.containerTypesSystemIds)
  if (container.containerTypeSystemId !== null && !allowedTypes.has(container.containerTypeSystemId)) {
    throw new ContainerTypeIncompatibleError({
      moduleSystemId:    module.systemId,
      containerSystemId: newContainerSystemId,
      containerTypeSystemId: container.containerTypeSystemId,
      allowedTypeSystemIds:   [...allowedTypes],
    })   // → 422 ARC-MOD-CONTAINER-TYPE-INCOMPATIBLE
  }

  await moduleRepo.changeContainer(module.systemId, newContainerSystemId, uow)
}
```

### 11.1.b Port-count changes — algorithm

Symmetric across DataPort input, DataPort output, and ControlPort. Below is the flow for DataPort (INPUT); OUTPUT is identical with a different filter; ControlPort uses the control-link read repo instead of data-link.

```ts
private async applyDataPortCountChange(
  module:      SpfModuleReadModel,
  ioType:      'INPUT' | 'OUTPUT',
  requested:   number,
  defRepo:     IModuleDefinitionEditRepository,
  linkRead:    IDataLinkReadRepository,
  moduleRepo:  IModuleEditRepository,
  uow:         UnitOfWork,
  fileId:      number,
): Promise<void> {
  // 1. Enumerate current ports of this ioType on the module.
  const current = module.dataPorts.filter(p => p.portIoType === ioType)
  const currentCount = current.length
  if (requested === currentCount) return   // no-op

  // 2. Load definition to check the absolute max.
  const definition = await defRepo.findByModuleIdAndProcId(module.moduleId, module.procId, fileId)
  if (!definition) throw new EntityNotFoundException('SpfModuleDefinition', module.moduleId)
  const maxAllowed = ioType === 'INPUT'
    ? definition.maxInputPortsSupported
    : definition.maxOutputPortsSupported

  if (requested > maxAllowed) {
    throw new PortCountExceedsDefinitionError({
      moduleSystemId: module.systemId, ioType, requested, maxAllowed,
    })   // → 422 ARC-MOD-PORT-COUNT-EXCEEDS-DEFINITION
  }

  if (requested > currentCount) {
    // ── ADD ── stage |diff| new DataPorts using definition's port template for this ioType
    const diff = requested - currentCount
    const group = definition.dataPortGroups.find(g => g.portIoType === ioType)
    if (!group) throw new PortCountExceedsDefinitionError({ /* no group → 0 max */ })

    // Naming / natural-ID sourcing:
    //   Definition may enumerate more static ports than currently present.
    //   Handler adds ports beyond the currently-materialized ones using the definition's remaining slots.
    //   Domain question: how is dataPortId assigned for the new ports? — presumed derived from the
    //   definition's staticPortDefinitions ordering. LLD2 execution phase to confirm exact rule.
    for (let i = 0; i < diff; i++) {
      const port = new DataPort({
        systemId:   this.idGeneration.getNextId(fileId),
        dataPortId: /* next available id per the definition's slot */ ,
        portIoType: ioType,
        isStatic:   true,
        name:       /* per definition */ ,
      })
      await moduleRepo.addDataPort(port, module.systemId, uow)
    }
  } else {
    // ── REMOVE ── stage |diff| DataPort deletes, unused-only, LIFO by systemId
    const diff = currentCount - requested

    // 3. Detect which of the current ports are unused (no data-link references).
    const currentIds = current.map(p => p.systemId)
    const links = await linkRead.getLinksByPortSystemIds(currentIds)
    const linkedPortIds = new Set(links.map(l => l.portSystemId))
    const unused = current.filter(p => !linkedPortIds.has(p.systemId))

    if (unused.length < diff) {
      // Not enough unused ports — block with actionable error.
      const blockedPortSystemIds = current
        .filter(p => linkedPortIds.has(p.systemId))
        .map(p => p.systemId)
      const blockingLinkSystemIds = links
        .filter(l => blockedPortSystemIds.includes(l.portSystemId))
        .map(l => l.linkSystemId)
      throw new PortCountDecreaseBlockedError({
        moduleSystemId: module.systemId,
        ioType,
        requested,
        currentCount,
        blockedPortSystemIds,
        blockingLinkSystemIds,
      })   // → 422 ARC-MOD-PORT-COUNT-DECREASE-BLOCKED
    }

    // 4. LIFO: sort unused by systemId DESC, take |diff|.
    const toRemove = [...unused]
      .sort((a, b) => b.systemId - a.systemId)
      .slice(0, diff)

    for (const p of toRemove) {
      await moduleRepo.removeDataPort(p.systemId, module.systemId, uow)
    }
  }
}
```

`applyControlPortCountChange` mirrors this exactly using `ctrlLinkRead` and `moduleRepo.removeControlPort` / `addControlPort`. ControlPort has no ioType — count applies to all.

### 11.1.c Error types

Three domain errors surface as 422 responses via exception filters (defined in `@arc/api`):

| Error class (in `@arc/core`) | Code | HTTP | Body includes |
|---|---|---|---|
| `ContainerTypeIncompatibleError` | `ARC-MOD-CONTAINER-TYPE-INCOMPATIBLE` | 422 | moduleSystemId, containerSystemId, containerTypeSystemId, allowedTypeSystemIds |
| `PortCountExceedsDefinitionError` | `ARC-MOD-PORT-COUNT-EXCEEDS-DEFINITION` | 422 | moduleSystemId, ioType, requested, maxAllowed |
| `PortCountDecreaseBlockedError` | `ARC-MOD-PORT-COUNT-DECREASE-BLOCKED` | 422 | moduleSystemId, ioType, requested, currentCount, blockedPortSystemIds, blockingLinkSystemIds |

Registration in the validation-framework's code catalog is a follow-up detail; error classes and exception filters land in this LLD.

### 11.2 AddModuleHandler

Command:
```ts
export class AddModuleCommand extends BaseCommand {
  static readonly allowedModes: readonly SessionMode[] = [
    SESSION_MODE.Designer,
    SESSION_MODE.DiffMerge,
  ]

  constructor(
    public readonly fileSystemId:      number,
    public readonly moduleId:          number,          // natural module ID (= moduleDefinitionId)
    public readonly procId:            number,          // processor ID
    public readonly parentId:          number | null,   // subsystem parent; null = top-level
    public readonly subgraphSystemId:  number | null,   // null → auto-create (Variant 1)
    public readonly containerSystemId: number | null,   // null → auto-create (Variants 1, 2)
  ) { super() }
}
```

Handler flow:

```ts
class AddModuleHandler {
  constructor(
    private readonly idGeneration: IdGenerationPort,
    private readonly naturalIdGeneration: NaturalIdGenerationPort,
  ) {}

  async handle(command: AddModuleCommand, uow: UnitOfWork): Promise<void> {
    const defRepo       = uow.getModuleDefinitionEditRepository()
    const subgraphRepo  = uow.getSubgraphEditRepository()
    const containerRepo = uow.getContainerEditRepository()
    const subsystemRepo = uow.getSubsystemEditRepository()
    const moduleRepo    = uow.getModuleEditRepository()
    const fileId = command.fileSystemId

    // 1. Load definition (REQ-ADD-05)
    const definition = await defRepo.findByModuleIdAndProcId(
      command.moduleId, command.procId, fileId,
    )
    if (!definition) throw new EntityNotFoundException('SpfModuleDefinition', command.moduleId)

    // 1a. Parent subsystem existence check (if parentId provided; not auto-created)
    if (command.parentId !== null) {
      if (!await subsystemRepo.subsystemExists(command.parentId, fileId))
        throw new EntityNotFoundException('Subsystem', command.parentId)
    }

    // 2. Subgraph (Variant 1 = auto-create; otherwise validate)
    let subgraphSystemId: number
    if (command.subgraphSystemId === null) {
      subgraphSystemId    = this.idGeneration.getNextId(fileId)
      const subgraphId    = this.naturalIdGeneration.getNextId(fileId, NaturalIdType.SUBGRAPH)
      const subgraph = new Subgraph({
        systemId:     subgraphSystemId,
        subgraphId,                                // natural ID via NaturalIdGenerationPort
        name:         `SG_${subgraphId}`,           // REQ-ADD-02 default name
        isExported:   false,
        fileSystemId: fileId,
      })
      await subgraphRepo.createSubgraph(subgraph, uow)
      // TODO(OQ-1): subgraphRepo.createSubgraphPropertyDefaults(subgraphSystemId, uow)
    } else {
      subgraphSystemId = command.subgraphSystemId
      if (!await subgraphRepo.subgraphExists(subgraphSystemId, fileId))
        throw new EntityNotFoundException('Subgraph', subgraphSystemId)
    }

    // 3. Container (Variants 1 & 2 = auto-create; Variant 3 validates)
    let containerSystemId: number
    if (command.containerSystemId === null) {
      const containerTypeSystemId = [...definition.containerTypesSystemIds][0] ?? null   // REQ-ADD-03
      containerSystemId  = this.idGeneration.getNextId(fileId)
      const containerId  = this.naturalIdGeneration.getNextId(fileId, NaturalIdType.CONTAINER)
      const container = new Container(
        containerSystemId,       // systemId
        containerId,             // natural ID via NaturalIdGenerationPort
        containerTypeSystemId,
        fileId,
      )
      await containerRepo.createContainer(container, uow)
      // TODO(OQ-1): containerRepo.createContainerPropertyDefaults(containerSystemId, uow)
    } else {
      containerSystemId = command.containerSystemId
      if (!await containerRepo.containerExists(containerSystemId, fileId))
        throw new EntityNotFoundException('Container', containerSystemId)
    }

    // 4. Materialize static ports from definition (REQ-ADD-06)
    // Port natural IDs (dataPortId, portId) come from the DEFINITION, not from
    // NaturalIdGenerationPort — they are definition-scoped identifiers.
    const dataPorts: DataPort[] = definition.dataPortGroups.flatMap(group =>
      group.staticPortDefinitions.map(def => new DataPort({
        systemId:   this.idGeneration.getNextId(fileId),
        dataPortId: def.dataPortId,                // ← from definition
        portIoType: group.portIoType,
        isStatic:   true,
        name:       def.name,
      })),
    )

    // 5. Module: allocate systemId + natural instanceId, build the aggregate
    const moduleSystemId = this.idGeneration.getNextId(fileId)
    const instanceId     = this.naturalIdGeneration.getNextId(fileId, NaturalIdType.MODINSTANCE)

    const controlPorts: ControlPort[] = definition.staticControlPorts.map(def =>
      new ControlPort({
        systemId:        this.idGeneration.getNextId(fileId),
        portId:          def.portId,               // ← from definition
        isStatic:        true,
        nodeSystemId:    moduleSystemId,
        name:            def.portName,
        intentSystemIds: [],
      }),
    )

    const module = new SpfModule({
      systemId:           moduleSystemId,
      instanceId,                                   // natural ID via NaturalIdGenerationPort
      definitionSystemId: definition.systemId,
      containerSystemId,
      subgraphSystemId,
      fileSystemId:       fileId,
      parentSystemId:     command.parentId ?? undefined,
      dataPorts,
      controlPorts,
    })

    await moduleRepo.createModule(module, uow)

    // 6. All edit_actions rows across steps 2-5 share the same groupId via WriteContext
    //    → single-undo-step atomicity (REQ-ADD-07)
  }
}
```

**REQ-ADD traceability inside this handler:**
- REQ-ADD-01 — the three variants distinguished by which optionals are null.
- REQ-ADD-02 — `SG_${subgraphSystemId}` default name.
- REQ-ADD-03 — `[0]` of `containerTypesSystemIds`.
- REQ-ADD-05 — definition lookup + 404 on miss.
- REQ-ADD-06 — static port materialization from `dataPortGroups` and `staticControlPorts`.
- REQ-ADD-07 — shared `groupId` via ambient WriteContext (not visible in handler code — it just works).
- REQ-ADD-08 — multi-aggregate spanning across Subgraph, Container, Module (distinct `aggregateId` per row).

---

## 12. Existence & Domain Validation

**Existence checks (404):**
- `PatchSpfModuleHandler` — validates target module exists via `moduleRepo.findModuleForPatch` (REQ-VAL-01). Additionally validates container (if `containerSystemId` is present) via `containerRepo.getContainerById`. Module definition lookup fails → 404 as well.
- `AddModuleHandler` — validates definition, provided `subgraphSystemId` / `containerSystemId` (REQ-VAL-02), and provided `parentId` (subsystem — §8a).
- Missing entity → typed domain exception → 404 at api layer. Errors surface before any staging.

**Domain-rule violations (422):**
- PATCH `containerSystemId` — target container's `containerTypeSystemId` must be in the module definition's `containerTypesSystemIds` allowed list. Else `ContainerTypeIncompatibleError`.
- PATCH `numberOf{Input,Output,Control}Ports` — requested count must not exceed the definition's declared max for that kind. Else `PortCountExceedsDefinitionError`.
- PATCH port-count decrease — enough unused ports must exist to satisfy the delta. Else `PortCountDecreaseBlockedError` with `blockedPortSystemIds` + `blockingLinkSystemIds` for actionable UX.

All checks run before staging any writes. Order within the handler: existence first, then domain rules, then writes.

---

## 12a. Write API Response Shape

Every write handler in LLD2 returns a uniform `WriteResult`:

```ts
type WriteResult = {
  groupId:   string       // atomic handle for undo/redo/stage/unstage of the whole call
  changeIds: number[]     // per-row handles
}
```

Both `PatchSpfModuleHandler` and `AddModuleHandler` return this shape. No handler-specific extensions.

### HTTP response shape (returned by controller)

The API contract (matching PR #90 + existing swagger) returns the full effective `SpfModuleDto` on both PATCH and POST. **Handlers do NOT construct this DTO.** Controller composes the response via a follow-up read after the write command succeeds:

```ts
// Controller pattern (illustrative — actual code in @arc/api)
async patchModule(params, body, session): Promise<ApiResult<SpfModuleDto>> {
  const cmd = new PatchSpfModuleCommand(...)
  await this.commandBus.execute(cmd, session)                   // stages edit_actions
  const module = await this.spfModuleQueryService.findOne(     // reads effective state
    params.spfModuleSystemId, session.fileSystemId,
  )
  return ApiResult.ok(module)
}
```

**Why controller composes reads + writes:**

- Preserves CQRS separation — command handlers stage edits, query services return effective state. Neither has to know about the other's concerns.
- LLD2 (writes) stays independently buildable/testable — no dependency on LLD3 (reads) landing first.
- Handler tests never need read-service stubs; controller tests can mock both.
- The just-written pending change is visible to the follow-up read because the read overlay includes `edit_actions` rows with `validUntil IS NULL`. Same-transaction is not required; per-session single-writer (I1) guarantees no interleaving between the write and the read.

For AddModule, allocated systemIds (module, subgraph, container, ports) surface naturally in the returned `SpfModuleDto` — no separate `allocatedSystemIds` envelope needed.

---

## 13. `UnitOfWork` Wiring

### 13.1 Accessors added

```
interface UnitOfWork {
  // existing (LLD1): setWriteContext, getWriteContext, getPendingChangeCache, applyCachedActions

  getModuleEditRepository():           IModuleEditRepository
  getSubgraphEditRepository():         ISubgraphEditRepository
  getContainerEditRepository():        IContainerEditRepository
  getSubsystemEditRepository():        ISubsystemEditRepository
  getModuleDefinitionEditRepository(): IModuleDefinitionEditRepository
  getDataLinkReadRepository():         IDataLinkReadRepository
  getControlLinkReadRepository():      IControlLinkReadRepository
}
```

### 13.2 Adapter wiring

- `TypeOrmUnitOfWork` returns instances scoped to the current `queryRunner`.
- Each adapter is constructed with the shared `PendingChangeWriter` and the queryRunner.
- Link-read adapters use `queryRunner.manager` for their SELECTs (no writer needed).

### 13.3 Handler registration

- Register each new command handler in `CommandHandlerRegistry.registerAllCommandHandlers()` using a `CommandHandlerFactory` that plucks the ports the handler needs from `CommandHandlerDependencies`:

```ts
// Inside registerAllCommandHandlers():
this.registerFactory(PatchSpfModuleCommand, {
  create: (deps) => new PatchSpfModuleHandler(deps.idGeneration),
})

this.registerFactory(AddModuleCommand, {
  create: (deps) => new AddModuleHandler(deps.idGeneration, deps.naturalIdGeneration),
})
```

`CommandHandlerDependencies` already exposes `idGeneration` and `naturalIdGeneration` (existing).

---

## 14. File Layout

Full folder tree — files created or modified:

- `packages/core/src/application/ports/persistence/repositories/module/module-edit.repository.ts` — new port.
- `.../repositories/subgraph/subgraph-edit.repository.ts` — new port.
- `.../repositories/container/container-edit.repository.ts` — new port.
- `.../repositories/subsystem/subsystem-edit.repository.ts` — new port.
- `.../repositories/module/module-definition-edit.repository.ts` — new port.
- `.../repositories/data-link/data-link-read.repository.ts` — new port (link-read, §6a).
- `.../repositories/control-link/control-link-read.repository.ts` — new port (link-read, §6a).
- `packages/core/src/application/module/patch/*.ts` — `PatchSpfModuleCommand` + `PatchSpfModuleHandler`.
- `packages/core/src/application/module/add-module/*.ts` — `AddModuleCommand` + `AddModuleHandler`.
- `packages/core/src/application/errors/module-errors.ts` — new domain errors: `ContainerTypeIncompatibleError`, `PortCountExceedsDefinitionError`, `PortCountDecreaseBlockedError`.
- `packages/core/src/application/ports/persistence/unit-of-work.ts` — extend with new accessors.
- `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/repositories/module/module-edit.repository.ts` — new adapter.
- `.../repositories/subgraph/subgraph-edit.repository.ts` — new adapter.
- `.../repositories/container/container-edit.repository.ts` — new adapter.
- `.../repositories/subsystem/subsystem-edit.repository.ts` — new adapter.
- `.../repositories/module/module-definition-edit.repository.ts` — new adapter.
- `.../repositories/data-link/data-link-read.repository.ts` — new adapter.
- `.../repositories/control-link/control-link-read.repository.ts` — new adapter.
- `.../unit-of-work/typeorm-unit-of-work.ts` — extend to expose new accessors.
- `packages/core/src/application/orchestration/cqrs/registries/command-handler-registry.ts` — register `PatchSpfModuleHandler` and `AddModuleHandler` via factories.
- `packages/api/src/filters/*.filter.ts` — exception filters mapping `ContainerTypeIncompatibleError`, `PortCountExceedsDefinitionError`, `PortCountDecreaseBlockedError` to 422 with structured body.
- API controller wiring — `PATCH /spf-modules/:id` and `POST /spf-modules` methods in `SpfModuleController`. Handler-side spec is in this LLD; controller-side implementation follows the codebase's NestJS conventions.

---

## 15. Testing Strategy

### 15.1 Unit tests

- `PatchSpfModuleHandler` — stub repos verify:
  - Each optional field routed correctly (alias → renameModule; containerId → validate + changeContainer; port counts → add/remove with correct LIFO ordering).
  - Container type-compatibility check triggers the right error.
  - Port-count exceed-max throws `PortCountExceedsDefinitionError`.
  - Port-count decrease with linked ports throws `PortCountDecreaseBlockedError`; error body has expected `blockedPortSystemIds` / `blockingLinkSystemIds`.
  - No-op fields (undefined optionals) don't invoke repos.
  - Multi-field PATCH stages all changes under one groupId.
- `AddModuleHandler` — three variants + failure paths (missing definition, missing subgraph, missing container, missing subsystem).
- Each adapter tested with a stub `PendingChangeWriter` — verify domain → payload mapping + `targetTable` / `aggregateId` assignment + `fieldPath` mode derivation.
- `IDataLinkReadRepository` / `IControlLinkReadRepository` — basic query correctness with fixture links.

### 15.2 Integration tests (`packages/infrastructure/persistence/tests/integration`)

- In-memory SQLite; realistic module aggregate setup.
- End-to-end: dispatch command → verify `edit_actions` rows produced (correct `aggregateId`, `fieldPath`, `newValue`, `source = MANUAL`, `changeStatus = STAGED`, shared `groupId` where applicable).
- PATCH with all five fields — verify all writes share one `groupId`.
- PATCH port-count decrease — with fixture data-links, verify unused ports are removed and linked ports are protected; count exactly matching linked-count fails with the expected error body.
- AddModule Variant 1: verify 4+ rows produced (Subgraph, Container, Module, Node, N DataPorts, N ControlPorts) all sharing one `groupId`.

### 15.3 E2E (`packages/api/tests/e2e`)

- Full HTTP path through SessionGuard + controller + CommandBus + handler + repo + writer.
- Verify 403 on wrong mode, 404 on missing entity, 422 on domain-rule violations, 200 on success with correct `SpfModuleDto` in the response.

---

## 16. Migration & Rollout Notes

- No schema changes in this LLD (LLD1 owns them).
- Existing `SpfModuleQueryHandler` (query-spf-modules.handler.ts) is not touched by LLD2 — reads are LLD3's concern. LLD2's PATCH/AddModule controllers invoke the existing read service for the response — it works with the current overlay implementation; LLD3 will rewrite that overlay in place.
- PR #90 (colleague's API-layer PR) adds `PATCH /spf-modules/:id` and related endpoints as stubs throwing `NotImplementedException`. LLD2 replaces those stubs with real dispatches to `PatchSpfModuleCommand` / `AddModuleCommand`. Note: PR #90's `PatchSpfModuleRequestDto` field names (`maxInputPortsSupported` etc.) will need renaming to `numberOfInputPorts` / `numberOfOutputPorts` / `numberOfControlPorts` to match LLD2 semantics — coordinate before LLD2 execution begins.
- LLD1 must land before LLD2 execution starts (schema + `PendingChangeWriter` + `SessionGuard` + `CommandBus` mode check are LLD2 dependencies).

---

## 17. Open Questions

- **OQ-1 — Property-data defaults on auto-create** (§10). Deferred to a follow-up. Needs read ports for subgraph and container property definitions plus a domain-shaped defaulting policy.
- **OQ-2 — Container type resolution for DIFF_MERGE AddModule** — REQ-ADD-03 says "first entry" from the definition. If the diff-tool wants to specify a different container type, would need an extension. Not blocking for Phase 1.
- **OQ-3 — Write-handler error style: `Result<T>` vs exceptions.** Read handlers in the current codebase (e.g., `SpfModuleQueryHandler`) return `Result<T>`. LLD2's write handlers throw. Recommendation: keep writes on exceptions (simpler; failures are exceptional; commit failures already use `ValidationReport` for user-actionable errors). Reads on `Result<T>` for the read-may-return-partial-success case. Confirm during LLD2 execution.
- **OQ-4 — Definition slot assignment for PATCH port-count increase.** When PATCH increases `numberOfInputPorts` from 2 to 5, the handler stages 3 new DataPort CREATEs. Which `dataPortId` (natural ID from the definition's `staticPortDefinitions[]`) and `name` do the new ports use? Assumed: definition-slot-order — take the next unused slot from `staticPortDefinitions[]`. If definitions declare only up to `numberOfCurrentPorts` and no more slots exist, the operation should error (impossible if `maxInputPortsSupported ≥ requested`, but worth confirming). LLD2 execution phase must confirm the exact slot-assignment rule.

---

*End of Outline*
