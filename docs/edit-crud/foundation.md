<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# LLD1 — Foundation

**Status:** Draft
**Owner:** Nithin Simon

**Parent:** `overall-design.md` (this folder). Read that first.
**Source of truth:** `docs/superpowers/specs/2026-07-04-modification-framework-requirements.md`

**Scope:** the shared infrastructure every downstream LLD builds on — schema, session context plumbing, staging service, overlay merge, commit-order policy, session guard. Sized for one PR.

---

## 1. Purpose & Scope

- One paragraph on this LLD's role — the foundation layer that unblocks LLD2 (Module Write Path), LLD3 (Read Overlay), LLD4 (Commit), and all Phase 2 work.
- **In scope:** items in §15 of overall-design under LLD1 — schema + migration, `PendingChangeWriter`, `EditActionsQueryService`, `OverlayMerge`, `PendingChangeCache`, `SessionGuard`, session hand-off via `execute(cmd, {session})` (Pattern A), `WriteContext` on UoW + `groupId` stamping, `CommandBus` mode check.
- **Out of scope:** edit repos per aggregate (LLD2), read-service adapters per aggregate (LLD3), commit service (LLD4), stage/unstage (LLD4), delete cascade (LLD5), DiffMerge (LLD6a-c).

---

## 2. Requirements Owned

- REQ-EA-01 to REQ-EA-14 (pending-change persistence, effective state, staging defaults, payload rules, capture-once).
- REQ-AGG-01 to REQ-AGG-03 (aggregate scoping mechanics, at the query-service level; specific edit-repo enforcement is LLD2).
- REQ-ATO-01 to REQ-ATO-05 (API-call atomicity via `groupId`).
- REQ-SESS-01, REQ-SESS-05, REQ-SESS-06 (session existence + mode allow-list gating).
- REQ-CMT-02 apply-order requirement is acknowledged; the commit service itself (including apply-order code) is deferred to a dedicated Commit LLD outside LLD1.
- I1 (single active session), I2 (single-valued effective state), I3 (capture-once), I4 (aggregate scoping), I5 (API-call atomicity), I7 (only STAGED at commit — filter infrastructure), I9 (read-overlay parity).
- NFR-INDEX-01 (index coverage), NFR-CONSIST-01 (transaction wrap by UoW).

---

## 3. Frozen Constraints (unchanged by this LLD)

- `project_sessions`, `session_commits` table shapes (session existence + audit are already-implemented infrastructure).
- All entity tables (`spf_modules`, `subgraphs`, `containers`, `nodes`, `data_ports`, `control_ports`, etc.).
- CQRS framework (`CommandBus`, `QueryBus`, `BaseCommand`, `BaseQuery`, handler registries).
- Existing `UnitOfWork` core interface + `TypeOrmUnitOfWork` adapter — extended, not replaced.
- Migration workflow per `CLAUDE.md` (regenerate single `initial-create` migration).

---

## 4. Architecture Overview (LLD1 slice)

LLD1 delivers the shared plumbing every later LLD depends on. It touches all three layers but adds no aggregate-specific code (that lives in LLD2+). Here is how LLD1's components fit inside the overall architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│  @arc/api                                                              │
│                                                                        │
│    SessionGuard                                                        │
│      - Depends on: ProjectSessionQueryRepository port                  │
│      - Attaches session → request.arcSession                           │
│                                                                        │
│    SessionModeNotAllowedError filter                                   │
│      - Maps to 403 with structured body                                │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  @arc/core                                                             │
│                                                                        │
│    BaseCommand (extended)  ← static readonly allowedModes              │
│    CommandBus (extended)   ← ActiveSession arg + mode check           │
│                                                                        │
│    change-vocabulary.ts (extended)  ← + SOURCE enum                    │
│    ActiveSession (new)    { sessionId, mode, fileSystemId, projectId? }│
│    WriteContext (new)     { session: ActiveSession, groupId: string }  │
│    SessionModeNotAllowedError (new)                                    │
│                                                                        │
│    UnitOfWork port (extended):                                         │
│      + setWriteContext(ctx) / getWriteContext()                        │
│      + getPendingChangeCache() / applyCachedActions()                  │
│                                                                        │
│    New ports:                                                          │
│      - ProjectSessionQueryRepository (session lookup)                  │
│      - PendingChangeCache (interface only; adapter in persistence)     │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │  port adapters
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  @arc/infrastructure/persistence                                       │
│                                                                        │
│    entity_schema:                                                      │
│      - edit-action.schema.ts (reshaped)                                │
│      - session-entity-version.schema.ts (new)                          │
│                                                                        │
│    queries/edit-session:                                               │
│      - edit-actions-query-service.ts (rewrite)                         │
│      - overlay-merge.ts (rewrite)                                      │
│      - field-path-reducer.ts (new)                                     │
│                                                                        │
│    repositories/session:                                               │
│      - typeorm-project-session-query.repository.ts (new)               │
│                                                                        │
│    services:                                                           │
│      - pending-change-writer.ts (rewrite of former staging service)    │
│      - pending-change-cache.ts (new)                                   │
│                                                                        │
│    unit-of-work:                                                       │
│      - typeorm-unit-of-work.ts (extended)                              │
│                                                                        │
│    migrations:                                                         │
│      - initial-create migration regenerated                            │
└────────────────────────────────────────────────────────────────────────┘
```

**Integration points at boundaries:**

- **`CommandBus` ↔ `UoW`:** CommandBus receives an `ActiveSession` on `execute()`, creates a UoW via existing factory, calls `uow.setWriteContext({ session, groupId: uuid() })` before starting the transaction. Handler receives `(cmd, uow)`.
- **`SessionGuard` ↔ port:** Guard depends on `ProjectSessionQueryRepository` (core port). Wired via NestJS DI to the persistence adapter.
- **`PendingChangeWriter` ↔ `UoW`:** Writer reads `uow.getWriteContext()` for `sessionId`, `mode`, `groupId`. Reads `uow.getPendingChangeCache()` when caller passes `cache: true`.
- **Read-service adapters (LLD3+) ↔ `EditActionsQueryService` + `OverlayMerge`:** every read service will construct with these dependencies. LLD1 delivers them; LLD3 wires them into each aggregate's read adapter.
- **Aggregate edit-repo adapters (LLD2+) ↔ `PendingChangeWriter`:** every edit repo will inject the writer and delegate all row-shaping to it. LLD1 delivers the writer; LLD2 wires it.

---

## 5. Schema Changes

Single migration regenerated per the project workflow (`CLAUDE.md` §Database Migration Workflow). No additive migration since the project is pre-production and existing dev-DB rows are disposable.

### 5.1 `edit_actions` — reshape

Column-by-column diff:

| Column | Type | Current schema | LLD1 schema | Change |
|---|---|---|---|---|
| `change_id` | integer PK | ✓ | ✓ | unchanged |
| `session_id` | integer, NOT NULL | ✓ | ✓ | unchanged |
| `aggregate_id` | integer, NOT NULL | ✓ | ✓ | unchanged |
| `system_id` | integer, NOT NULL | ✓ | (renamed) | **rename → `target_system_id`** |
| `table_name` | varchar(100), NOT NULL | ✓ | (renamed) | **rename → `target_table`** |
| `operation` | simple-enum | ✓ | ✓ | unchanged (`NONE / CREATE / UPDATE / DELETE`) |
| `payload` | simple-json, NOT NULL | ✓ | — | **dropped** (replaced by `field_path` + `new_value`) |
| `field_path` | varchar, nullable | — | ✓ | **added** — addressing scheme (§4.1 overall-design) |
| `new_value` | simple-json, nullable | — | ✓ | **added** — replacement value for the addressed target |
| `source` | simple-enum, NOT NULL | — | ✓ | **added** — `MANUAL / DIFF_TOOL / AUTO_ROUTING` |
| `change_status` | simple-enum | ✓ | ✓ | unchanged; default `STAGED` |
| `base_version` | integer, nullable | ✓ | — | **dropped** (moves to `session_entity_versions` side-table) |
| `group_id` | text, nullable | ✓ | ✓ | unchanged (UUID for API-call atomicity) |
| `cross_entity_group_id` | varchar, nullable | — | ✓ | **added** — REQ-ACG-01 server-enforced |
| `created_at` | datetime | ✓ | ✓ | unchanged |
| `valid_until` | datetime, nullable | ✓ | ✓ | unchanged |

**Enum values:**
- `operation`: from existing `CHANGE_OPERATION`.
- `change_status`: from existing `CHANGE_STATUS`.
- `source`: new `SOURCE` enum defined in `change-vocabulary.ts` (§6).

**Indexes:**

| Index | Columns | Filter | Purpose |
|---|---|---|---|
| `uniq_edit_actions_current` (unique) | `session_id, target_system_id, field_path` | `WHERE valid_until IS NULL` | Supersession + one-active-row-per-slot |
| `idx_edit_actions_agg_active` | `session_id, aggregate_id` | `WHERE valid_until IS NULL` | Aggregate-scoped overlay |
| `idx_edit_actions_table_active` | `session_id, target_table` | `WHERE valid_until IS NULL` | Table-scoped queries |
| `idx_edit_actions_status_active` | `session_id, change_status` | `WHERE valid_until IS NULL` | Stage/commit filters |
| `idx_edit_actions_source_active` | `session_id, source` | `WHERE valid_until IS NULL` | Wipe-by-source on diff re-apply |
| `idx_edit_actions_xgroup_active` | `session_id, cross_entity_group_id` | `WHERE valid_until IS NULL AND cross_entity_group_id IS NOT NULL` | Cross-entity group expansion |

**TypeORM `EntitySchema` file:** replace the existing `edit-action.schema.ts` in `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/edit-session/`. Row interface `EditActionRow` retains its exported name.

### 5.2 `session_entity_versions` — new side-table

Purpose: capture-once storage for optimistic-lock `baseVersion` per session-entity (REQ-EA-11, REQ-EA-13).

| Column | Type | Notes |
|---|---|---|
| `session_id` | integer, PK part | FK → `project_sessions(session_id)` ON DELETE CASCADE |
| `target_system_id` | integer, PK part | The entity's systemId |
| `base_version` | integer, NOT NULL | Committed `version` of the entity at first modification |

Composite PK on `(session_id, target_system_id)`.

**INSERT-IGNORE semantics:**
- SQLite: `INSERT OR IGNORE INTO session_entity_versions (...) VALUES (...)`.
- Postgres reference: `INSERT ... ON CONFLICT (session_id, target_system_id) DO NOTHING`.

No additional indexes needed — the composite PK covers every query pattern (write by exact key on first modification; read by exact key at commit time).

Session-created entities never get a row here (REQ-EA-12). Post-commit cleanup removes rows for applied entities so subsequent modifications capture a fresh baseline.

### 5.3 Migration workflow

Per `CLAUDE.md` §Database Migration Workflow:

1. Update entity schemas (`edit-action.schema.ts`, add `session-entity-version.schema.ts`).
2. Run `pnpm run build` so the TypeORM CLI can see updated schemas.
3. Delete the current migration file (`packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/<timestamp>-initial-create.ts`).
4. Run `pnpm run migration:gen ./packages/infrastructure/persistence/src/persistence-typeorm-sqllite/migrations/initial-create`.
5. Post-process the generated file — add Qualcomm copyright header, change `import {MigrationInterface, QueryRunner} from 'typeorm'` to `import type {...}`.
6. Update `migration-index.ts` to reference the new timestamp.

**Data considerations:** dev-only DBs. Any existing `edit_actions` rows are discarded when the migration rebuilds. No production data to preserve.

---

## 6. Change Vocabulary Updates (`@arc/core`)

### 6.1 Existing constants unchanged

- `CHANGE_OPERATION` (`NONE / CREATE / UPDATE / DELETE`) — kept.
- `CHANGE_STATUS` (`STAGED / UNSTAGED`) — kept.

### 6.2 New constants

- `SOURCE` (`MANUAL / DIFF_TOOL / AUTO_ROUTING`) — enum + type export.
- Location: `packages/core/src/application/shared/change-vocabulary.ts` (extend existing file).

---

## 7. `SessionGuard` (`@arc/api`)

### 7.1 Responsibilities

- Resolve active session for target project (REQ-SESS-01, REQ-SESS-05). URLs carry `{projectId}` per the codebase's existing convention; the guard resolves `projectId → fileSystemId → active session` in one port call (see §7.5).
- Attach session (including its `mode`, `fileSystemId`, and `projectId`) to request-scoped context — surfaces to UoW downstream.
- **No mode allow-list check.** Mode enforcement is handled by CommandBus (§7a) so it applies uniformly to direct API dispatch and to dynamic dispatch paths (e.g., validation auto-fix — see validation framework doc §6.3, where the apply-fix controller routes to CQRS commands dynamically based on `commandType` in the body; a Nest guard on that endpoint cannot know the underlying command's mode requirements).
- No DB writes.

### 7.2 Trigger mechanism

- NestJS guard applied to controllers/endpoints that require an active session (write endpoints, session-scoped read endpoints).
- Applied via `@UseGuards(SessionGuard)` on controller classes or specific methods.
- Read-only endpoints that do not require a session (e.g., static definition reads) omit the guard.

### 7.3 Failure modes

- No active session for the project's file → `403 Forbidden` with structured error (session-not-active).
- Project not found / not connected → `404` (delegated to the same port or the controller before the guard).

### 7.4 Integration points

- Wired into `@arc/api` module providers.
- Attaches session to a request-scoped `WriteContext` accessible from `UnitOfWork` (§8).

### 7.5 Session query port

- New port in core: `ProjectSessionQueryRepository.findActiveSessionByProjectId(projectId): Promise<ProjectSession | null>`.
- Adapter in persistence: joins `projects` → `project_sessions WHERE status = 'ACTIVE'` in one SQL round-trip.
- Same pattern as the existing read-side `ProjectQueryService.getFileIdByProjectId(projectId)` — read APIs already use `projectId` in URLs and resolve to `fileSystemId` internally. Write APIs match this convention.

---

## 7a. CommandBus Mode-Check (`@arc/core`)

### 7a.1 Responsibility

- Enforce REQ-SESS-06: every write API call has a declared session-mode allow-list; disallowed mode → `403 Forbidden`.
- Applies to every command that flows through the CommandBus regardless of dispatch origin (direct controller, `FixCommandDispatcher`, future batch/retry endpoints).

### 7a.2 Command-side declaration

Every command class declares its allowed modes as a plain static field:

```
export class SetModuleAliasCommand extends BaseCommand {
  static readonly allowedModes: readonly SessionMode[] = [SESSION_MODE.Designer];
  ...
}

export class AddModuleCommand extends BaseCommand {
  static readonly allowedModes: readonly SessionMode[] = [
    SESSION_MODE.Designer,
    SESSION_MODE.DiffMerge,
  ];
  ...
}
```

- `BaseCommand` declares `static readonly allowedModes: readonly SessionMode[] = []` as the base.
- Empty array = mode check is a no-op for that command (used for commands that don't require an active session, e.g., start-session).
- Pure TypeScript — no NestJS import, no reflect-metadata. Compatible with React Native consumers.

### 7a.3 Bus-side enforcement

Before starting a transaction and invoking the handler, `CommandBus.execute()` runs the mode check:

```
CommandBus.execute(cmd):
  ctx = uow.getWriteContext()
  allowedModes = (cmd.constructor as typeof BaseCommand).allowedModes
  if allowedModes.length > 0 and !allowedModes.includes(ctx.session.mode):
    throw new SessionModeNotAllowedError(cmd.constructor.name, ctx.session.mode, allowedModes)
  // proceed: startTransaction → stamp groupId on ctx → invoke handler → commit/rollback
```

Placement: **before** `startTransaction()` so rejected calls do not open a transaction.

### 7a.4 Error mapping (`@arc/api`)

- `SessionModeNotAllowedError` mapped to `403 Forbidden` by an exception filter.
- Response body includes: current mode, allowed modes, command type name.

### 7a.5 Interaction with `SessionGuard`

- `SessionGuard` runs first — resolves session → attaches to UoW.
- If SessionGuard rejects (no active session), the request never reaches CommandBus.
- If SessionGuard passes, CommandBus performs the mode check using the attached session.
- Commands with `allowedModes = []` (e.g., session-lifecycle commands like start/end) still require the guard to pass, but the mode check is a no-op — the command works regardless of mode.

### 7a.6 Testing

- Unit test: command dispatched with a matching mode → passes; dispatched with a disallowed mode → throws `SessionModeNotAllowedError`.
- Unit test: command with empty `allowedModes` → passes regardless of mode.
- Integration test: end-to-end request through SessionGuard + CommandBus with a session in wrong mode → returns 403.

---

## 8. `WriteContext` and Session Hand-Off (Pattern A)

### 8.1 Types — `ActiveSession` and `WriteContext`

Two plain TS types in core:

```
type ActiveSession = {
  sessionId:    number
  mode:         SessionMode
  fileSystemId: number
  projectId:    string          // for audit/error context
}

type WriteContext = {
  session: ActiveSession
  groupId: string               // stamped by CommandBus
}
```

- `ActiveSession` — call-boundary input; populated by `SessionGuard` from the DB, passed to `CommandBus.execute()`.
- `WriteContext` — ambient in-request state; held on `UnitOfWork`; consumed by handlers, edit repos, and `PendingChangeWriter`.

- `source` is NOT on `WriteContext`. It moves per-write via the options bag on edit-repo methods (§9). Rationale: nested services within one request (diff-stager, auto-routing runner) produce writes with different sources than the outer handler; mid-request mutation of a shared source field would be error-prone.

### 8.2 Session hand-off flow (Pattern A)

Explicit hand-off, no NestJS request-scope leakage into core. Note: every URL uses `{projectId}` (not `fileSystemId`) — the `projectId → fileSystemId` mapping is a query concern handled by the session-query port, not by the caller.

```
1. Client → HTTP request to /arc-api/v1/projects/{projectId}/...
2. SessionGuard (@arc/api):
     Reads projectId from request params.
     Queries active session via ProjectSessionQueryPort.findActiveSessionByProjectId(projectId).
       Adapter resolves projectId → fileSystemId internally, joins project_sessions where status=ACTIVE.
     No active session → 403.
     Attaches to request:  request.arcSession = { sessionId, mode, fileSystemId, projectId }.  // ActiveSession
3. Controller:
     Reads request.arcSession.
     Builds command:  cmd = new SetModuleAliasCommand(...)
     Calls:           commandBus.execute(cmd, request.arcSession)
4. CommandBus (@arc/core):
     Reads command.constructor.allowedModes.
     Compares against session.mode → throws SessionModeNotAllowedError if mismatched.
     Creates UoW.
     uow.setWriteContext({ session, groupId: uuidv4() })
     Starts transaction.
     Invokes handler.
5. Handler (@arc/core):
     Calls edit repo methods — passes only uow and domain args.
6. Edit repo adapter (@arc/persistence):
     Reads WriteContext from uow — uses ctx.session.sessionId, ctx.session.mode, ctx.groupId.
     Writes via PendingChangeWriter.
```

- SessionGuard does the one session lookup (via a port that also resolves projectId → fileSystemId).
- CommandBus does no re-query.
- Edit repos do no re-query — they consume WriteContext from UoW.
- Read APIs follow the same projectId pattern (existing behavior). The `projectId → fileSystemId` resolution port is shared between read paths (existing query services) and the SessionGuard.

### 8.3 `groupId` stamping

- CommandBus generates UUID at `execute()` time, after the mode check passes.
- Stamped into `WriteContext` before handler invocation.
- Same value on every row produced within the call — atomic handle for undo/redo/stage/unstage.

### 8.4 CommandBus signature

Core port shape:

```
interface CommandBus {
  execute<T extends BaseCommand>(
    command: T,
    session: ActiveSession,
  ): Promise<CommandResult<T>>
}
```

- Controller responsible for populating `session` from `request.arcSession`.
- No dependency on NestJS in core — `ActiveSession` is a plain TS type.
- CommandBus internally constructs `WriteContext = { session, groupId: uuidv4() }` and puts it on UoW.

### 8.5 `UnitOfWork` extensions

New accessors on the UoW port (`@arc/core`):

```
interface UnitOfWork {
  // existing: startTransaction, commit, rollback, ...

  setWriteContext(ctx: WriteContext): void       // called by CommandBus once
  getWriteContext(): WriteContext                  // called by repos + writer

  getPendingChangeCache(): PendingChangeCache
  applyCachedActions(): Promise<void>              // called by handler before commit
}
```

Implementation on `TypeOrmUnitOfWork` in persistence.

---

## 9. `PendingChangeWriter` (`@arc/persistence`)

Low-level service that writes rows to the `edit_actions` table. Called by aggregate edit repos (LLD2+), not by handlers directly. The former "EntityStagingService" — renamed because it does not perform staging (the `changeStatus = STAGED` flip). It records pending changes; whether those rows are STAGED or UNSTAGED depends on the caller's `source` + session mode.

### 9.1 Interface

- Method signatures (all take `uow` for WriteContext access):
  - `writeDelta(spec: WriteDeltaSpec, uow): Promise<void>`
  - `writeCreate(spec: WriteCreateSpec, uow): Promise<void>`
  - `writeDelete(spec: WriteDeleteSpec, uow): Promise<void>`
- Spec shapes carry `targetTable`, `targetSystemId`, `aggregateId`, `fieldGroup?`, `newValue`, `source`, `cache?`.
- `sessionId`, `mode`, `groupId` are read from `uow.getWriteContext()` — not on the spec.

### 9.2 Accumulator merge (fieldGroup = null)

- Fetch current active row for `(sessionId, targetSystemId, fieldGroup=null)`.
- If found: merge new delta keys into existing payload → new payload.
- If not found: attempt baseVersion capture (§9.5).
- Supersede prior row (set `validUntil = NOW`).
- Insert new row with merged payload.

### 9.3 Per-slot supersession (fieldGroup ≠ null)

- Fetch current active row for `(sessionId, targetSystemId, fieldGroup)`.
- No merge — new value replaces prior.
- Supersede prior row.
- Insert new row.

### 9.4 CREATE + CREATE-then-modify (REQ-EA-10c)

- CREATE row with `fieldGroup = "$"`, `operation = CREATE`, `newValue` = full payload.
- Subsequent modifications on the same entity: write on other fieldGroups (or accumulator).
- baseVersion never captured for session-created entities (REQ-EA-12).

### 9.5 baseVersion capture (`session_entity_versions`)

- Before writing an UPDATE/DELETE on a committed entity, attempt `INSERT OR IGNORE` into `session_entity_versions` with `entity_table.version`.
- No-op if a row already exists for `(sessionId, targetSystemId)` — REQ-EA-13 capture-once.
- Session-created entities skip this step entirely.

### 9.6 changeStatus determination

Derived at write time from `source` + `mode` + optional caller override:

| Source | Mode | changeStatus |
|---|---|---|
| MANUAL | DESIGNER | `STAGED` |
| MANUAL | DIFF_MERGE | `STAGED` (REQ-SESS-12) |
| DIFF_TOOL | DIFF_MERGE | Caller-provided if `options.changeStatus` set; otherwise defaults to `UNSTAGED` (REQ-EA-05 revised — tool may configure to write `STAGED` directly per apply-diff call) |
| AUTO_ROUTING | DESIGNER | `UNSTAGED` (REQ-EA-05 — auto-routing does not support override) |

Options bag on edit-repo methods gains one optional field for the DIFF_TOOL override:

```
options?: {
  fieldGroup?, crossEntityGroupId?, cache?, source?,
  changeStatus?: "STAGED" | "UNSTAGED"   // honored only when source = DIFF_TOOL
}
```

`PendingChangeWriter` enforces:
- `MANUAL` writes with any explicit `options.changeStatus` are rejected — MANUAL is always STAGED.
- `AUTO_ROUTING` writes with any explicit `options.changeStatus` are rejected — AUTO_ROUTING is always UNSTAGED.
- `DIFF_TOOL` writes honor `options.changeStatus` when provided; default UNSTAGED otherwise.

In practice, the diff-stager sets `changeStatus` uniformly across all rows produced in one apply-diff call — the setting comes from a per-call configuration (e.g., request body flag on `POST /diff-merge/apply`), not per-field.

### 9.7 Cached bulk mode (`cache = true`)

- Row is appended to `PendingChangeCache` buffer (§10) instead of INSERTed.
- baseVersion capture is also queued for bulk resolution.
- Only valid for non-accumulator fieldGroups (accumulator needs read-modify-write on every SET and can't defer).

---

## 10. `PendingChangeCache` and `applyCachedActions()`

UoW-scoped in-memory buffer used for bulk write paths (DiffMerge apply, auto-routing) where individual INSERT-per-row would be too slow. Core defines the port; persistence provides the adapter.

### 10.1 Interface (core port)

```
interface PendingChangeCache {
  enqueueRow(row: PendingChangeInsert): void
  enqueueBaseVersionCapture(target: { targetTable, targetSystemId }): void

  size(): number
  isEmpty(): boolean
}

// on UnitOfWork:
applyCachedActions(): Promise<void>   // performs the flush described in §10.2
```

`PendingChangeInsert` is a persistence-shaped row insert spec — core sees it as opaque, treated as data that flows through. `PendingChangeWriter` constructs these when `cache: true`.

### 10.2 Flush algorithm

`applyCachedActions()` performs, in order:

```
1. baseVersion capture batch:
   - Group queued targets by targetTable (targets are {targetTable, targetSystemId}
     tuples enqueued by PendingChangeWriter; one target per entity regardless of
     how many field_paths that entity has pending — session_entity_versions has
     exactly one row per (sessionId, targetSystemId), enforced by composite PK).
   - For each table group, one SELECT fetches current versions:
       SELECT system_id, version FROM <table> WHERE system_id IN (<targets>)
   - Assemble (sessionId, targetSystemId, baseVersion) tuples from the results.
   - INSERT OR IGNORE INTO session_entity_versions VALUES (...), (...), ... —
     chunked to 500-1000 tuples per statement to stay under SQLite's parameter
     limit (SQLITE_MAX_VARIABLE_NUMBER, default ~500). Multiple INSERT statements
     if the total exceeds the chunk size, all inside the same transaction.

2. pending row INSERT batch:
   - Enqueued rows are already per-field_path — a single entity with N pending
     field_paths contributes N rows to this batch.
   - Multi-row INSERT INTO edit_actions (...) VALUES (...), (...), ... — same
     chunking rule as above (500-1000 rows per statement).

3. Clear both buffers on success.
```

Two independent concerns baked into that algorithm:
- **Grouping by table** (step 1) — for SELECT efficiency, one query per table instead of one per entity.
- **Chunking per INSERT statement** (both steps) — for DB statement-size limits, orthogonal to grouping.

Failures propagate to the enclosing transaction — rollback disposes the buffer implicitly.

Example — a 5000-change DiffMerge apply spanning ~2000 distinct entities across 5 tables produces roughly: 5 SELECTs (one per table) + ~4 INSERTs to `session_entity_versions` (2000 tuples chunked) + ~10 INSERTs to `edit_actions` (5000 rows chunked) = ~19 SQL round-trips instead of 5000 without batching.

### 10.3 Lifecycle

- One `PendingChangeCache` instance per UoW (per request).
- `PendingChangeWriter` calls `enqueueRow()` when caller passes `cache: true`.
- Handler is responsible for calling `uow.applyCachedActions()` after all writes are queued and **before** `uow.commit()`. Order in the handler:
  ```
  await stager.stage(compareResult, uow)   // enqueues rows
  await uow.applyCachedActions()            // flushes
  // (CommandBus completes with commit)
  ```
- If a handler queues writes but never calls `applyCachedActions()`, the transaction still commits successfully but the queued rows are silently dropped — an implementation bug. LLD1 will surface this via a UoW-level assertion or a warning-log at commit time.

### 10.4 Constraints

- `cache = true` is invalid for accumulator writes (`fieldGroup = null`). Accumulator needs read-modify-write on every SET and cannot defer. Enforced in `PendingChangeWriter` — rejects with a runtime error.
- `cache = true` is invalid for CREATE-then-modify sequences that depend on reading prior rows within the same call. Diff-apply and auto-routing don't hit this because they write once per fieldPath.

---

## 11. `EditActionsQueryService` (`@arc/persistence`)

Raw pending-change queries. No overlay merge, no domain shaping. Rewritten from the existing service to reflect the new schema and to add source-filtering methods.

### 11.1 Interface

```
interface EditActionsQueryService {
  // Session resolution (used by SessionGuard)
  findActiveSession(fileSystemId: number): Promise<ProjectSessionRow | null>
  // Also findActiveSessionByProjectId available on ProjectSessionQueryRepository (§7.5)

  // Fetch active pending rows
  getByAggregateId(
    sessionId: number,
    aggregateId: number,
    options?: EditActionsQueryOptions,
  ): Promise<EditActionRow[]>

  getByAggregateAndTable(
    sessionId: number,
    aggregateId: number,
    targetTable: EntityName,
    options?: EditActionsQueryOptions,
  ): Promise<EditActionRow[]>

  getByTable(
    sessionId: number,
    targetTable: EntityName,
    options?: EditActionsQueryOptions,
  ): Promise<EditActionRow[]>

  getBySource(
    sessionId: number,
    source: Source,
    options?: EditActionsQueryOptions,
  ): Promise<EditActionRow[]>

  // Wipe-by-source (used by DiffMerge re-apply; details in LLD6a)
  deleteBySource(
    sessionId: number,
    source: Source,
    changeStatus?: ChangeStatus,   // optional filter; default no filter (wipes all)
  ): Promise<number>   // rows affected

  // Session-scoped supersession lookup (used by PendingChangeWriter)
  findCurrentRow(
    sessionId: number,
    targetSystemId: number,
    fieldPath: string | null,
  ): Promise<EditActionRow | null>
}
```

### 11.2 `EditActionsQueryOptions`

```
type EditActionsQueryOptions = {
  operations?:   ChangeOperation[]   // filter by op; default: all
  changeStatus?: ChangeStatus        // filter by status; default: both STAGED + UNSTAGED
  source?:       Source              // filter by source; default: all
}
```

All queries filter `valid_until IS NULL` implicitly — active rows only. No option to widen this at LLD1; historical rows are only needed for undo/redo (deferred).

### 11.3 Row-type mapping

- `EditActionRow` TypeScript interface reflects the new columns (see §5.1). Owned by persistence, imported by the service impl.
- Consumers of the row shape are inside persistence only (read-service adapters, `PendingChangeWriter`). Core never sees `EditActionRow`.

### 11.4 Concurrency

- All queries run against the current UoW's `queryRunner` when called during a transaction, or against the shared `DataSource` for read-only usage (SessionGuard).

---

## 12. `OverlayMerge` (`@arc/persistence`)

Pure in-memory fold utility. Given committed rows + active pending rows for an aggregate scope, produces effective rows with optional diff context. No DB access. Reusable across every aggregate's read-service adapter (LLD3+).

### 12.1 Interface

```
interface OverlayMerge {
  // Merge N pending rows onto one base row.
  // Returns the effective row + per-field diff entries.
  // Returns null if the effective state is a tombstone (final row was DELETE
  // and there was no CREATE-then-DELETE cancellation).
  applyToSingle<T extends { systemId: number }>(
    baseRow: T | null,             // null when the entity is being CREATEd in-session
    pendingRows: EditActionRow[],
  ): OverlayResult<T> | null

  // Merge pending rows onto a collection of base rows.
  // - Rows targeting existing base entities → merged as in applyToSingle.
  // - CREATE rows for entities absent from baseRows → produce new virtual rows.
  // - DELETE rows → excluded from the returned array (tombstoned).
  applyToCollection<T extends { systemId: number }>(
    baseRows: T[],
    pendingRows: EditActionRow[],
  ): OverlayResult<T>[]
}

type OverlayResult<T> = {
  effective: T                       // committed + pending applied
  diffEntries: DiffEntry[]           // per-field diff context (§8 of overall-design)
  pendingChangeStatus: "STAGED" | "UNSTAGED" | "PARTIAL"   // for entity DTO
  operation: "CREATE" | "UPDATE" | "DELETE"
}

type DiffEntry = {
  fieldName: string                  // for element paths: full tree path e.g., "elements[stereoEq].elements[left]"
  oldValue: unknown | null           // null for CREATE
  newValue: unknown | null           // null for DELETE
  changeId: number
  groupId: string
  crossEntityGroupId: string | null
  changeStatus: ChangeStatus
  source: Source
}
```

### 12.2 Fold algorithm

For each targetSystemId (single entity or one entry in a collection):

```
1. Group pending rows by targetSystemId (collection case; single case has one group).
2. Sort by (createdAt ASC, changeId ASC).
3. Start with effective = deep-clone(baseRow) (or {} if base is null and there's a CREATE).
4. For each pending row in sort order:
     - Look up dispatch case by row.fieldPath shape (via FieldPathReducer):
       - scalar column name → effective[fieldPath] = row.newValue
       - "$" or multi-key JSON payload → for each key k in row.newValue: effective[k] = row.newValue[k]
       - element path e.g., "elements[gain]" or "elements[stereoEq].elements[left]"
                → parse effective's serialized column into the typed element tree
                  (ConfigElement / StructElement / ElementArray / StructArray —
                   see `element-definition.ts` in @arc/core),
                  navigate the tree by path, replace at target node, re-serialize
       - null (accumulator) → same as multi-key JSON payload; payload holds all merged fields
     - Record diff entry per touched field (fieldName, oldValue, newValue, and metadata).
     - Handle operation:
       - CREATE → mark operation for the whole result; effective is the created row.
       - UPDATE → default operation; effective diverges from base per field.
       - DELETE → set tombstone; discard effective; return null (or exclude in collection case).
5. Compute pendingChangeStatus from the set of pending row statuses:
     - all STAGED → "STAGED"
     - all UNSTAGED → "UNSTAGED"
     - mix → "PARTIAL"
6. Return OverlayResult (or null for tombstone).
```

### 12.3 `FieldPathReducer`

**Role:** applies a single pending change row to an effective-state object, dispatching on the row's `fieldPath` shape. `OverlayMerge` calls it once per row inside its fold loop.

Analogy: if `OverlayMerge` is like `Array.reduce(callback, initial)`, then `FieldPathReducer.applyRow` is the `callback` — takes `(accumulator, row)`, mutates accumulator. Dispatch on `row.fieldPath` decides HOW.

Factored out from `OverlayMerge` because:
- **Testability** — each fieldPath shape gets independent unit tests without spinning up the fold loop.
- **Locality** — element-path handling needs a type-aware parser/navigator/re-serializer that's non-trivial; keeping it in its own module keeps `OverlayMerge` slim.
- **Extensibility** — new serialized-column types register additional reducer cases via `(targetTable, columnName)` keys.
- **Reuse at commit time** — the Commit LLD can reuse the same dispatch logic to translate pending rows into partial-UPDATE SQL against entity tables, keeping commit and read overlay consistent.

```
interface FieldPathReducer {
  applyRow(effective: Record<string, unknown>, row: EditActionRow): void
  deriveDiffEntries(row: EditActionRow, baseRow: Record<string, unknown> | null): DiffEntry[]
}
```

**Dispatch table (on `row.fieldPath`):**

| `fieldPath` value | Action |
|---|---|
| scalar column name (e.g., `"alias"`) | `effective[fieldPath] = row.newValue`; one diff entry `{fieldName: fieldPath, oldValue: baseRow?.[fieldPath], newValue}` |
| `"$"` (whole-row replacement) | For each key `k` in `row.newValue`: `effective[k] = row.newValue[k]`; one diff entry per key |
| `null` (accumulator) | Same as `"$"` — payload is a multi-key JSON object |
| Custom named group (e.g., `"identity"`) | Same as `"$"` — payload is a multi-key JSON object; server treats the name as opaque |
| Element path (e.g., `"elements[gain]"`, `"elements[stereoEq].elements[left]"`, `"elements[channels][0].doa"`) | Path expression through the `elementsStructure` tree. Reducer parses `effective["elements_structure"]` (the serialized column identified in the reducer registry) into the typed element tree, navigates by the path, replaces at the target node with `row.newValue`, re-serializes. One diff entry `{fieldName: <path>, oldValue: <prior node>, newValue: row.newValue}`. Path syntax + navigation logic are LLD6c-owned. |

The reducer registry maps `(entity kind, structured-column name)` to a parse/navigate/serialize triple. In Phase 1 the registry has no entries — no serialized-column entities are in edit scope. LLD6c registers the ParameterDefinition entry.

### 12.4 CREATE / DELETE handling

- **CREATE**: row's `fieldPath = "$"` and `operation = CREATE`. The reducer treats it as a base for subsequent rows. Effective row starts empty; the CREATE row fills it. Subsequent UPDATE-style rows on the same entity apply on top.
- **DELETE**: row's `operation = DELETE`. Returns null (single case) or excludes (collection case). If a DELETE follows a CREATE on the same entity — CREATE-then-DELETE cancellation — the fold recognizes this and returns null.

### 12.5 Extensibility

- New fieldPath shapes: add a case in `FieldPathReducer`. Element-path reducers register per (targetTable, columnName).
- New collection semantics (e.g., array-of-objects at a nested path): extend the reducer registry.

---

### 12.4 Interfaces

- `applyToSingle<T>(baseRow, editActions[])` — merge N rows onto one base row.
- `applyToCollection<T>(baseRows, editActions[])` — group by systemId, apply per group; CREATE actions produce new virtual rows.

### 12.5 Diff context output

- Every changed field surfaces as a diff entry with `{ fieldName, oldValue, newValue, changeId, groupId, status, source, crossEntityGroupId? }`.
- Consumed by read-service adapters to populate `diffEntity` on entity DTOs (LLD3).

---

## 13. Commit — Deferred

The commit service (ordering, apply logic, error-to-`ValidationIssue` mapping, auto-generated commit description, partial-success policy) is deferred to a dedicated Commit LLD outside LLD1.

Overall Design §9 records the direction — commit is hand-written per entity kind, with domain-aware error messages and auto-summaries. A CI-time FK-consistency check may accompany it as a safety net. See §15 of overall-design for LLD sequencing.

LLD1 provides only the foundation the commit service will build on: `edit_actions` + `session_entity_versions` schemas, `PendingChangeWriter` for writes, `EditActionsQueryService` for reads, `OverlayMerge` for effective-state computation. It does NOT ship the commit service itself.


---

## 14. `UnitOfWork` Extensions

- New port methods added to `packages/core/.../unit-of-work.ts`:
  - `getWriteContext(): WriteContext`
  - `getPendingChangeCache(): PendingChangeCache`
  - `applyCachedActions(): Promise<void>`
- `TypeOrmUnitOfWork` implements — instantiates cache per request, wires into `PendingChangeWriter`.
- CommandBus populates WriteContext before invoking handler.

---

## 15. File Layout

Full folder tree of files created or modified by this LLD.

- `packages/core/src/application/shared/change-vocabulary.ts` — add `SOURCE` enum.
- `packages/core/src/application/orchestration/cqrs/base-command.ts` — extend with `static readonly allowedModes: readonly SessionMode[] = []`.
- `packages/core/src/application/orchestration/cqrs/command-bus.ts` — accept `ActiveSession` on `execute()`; add mode check before `startTransaction()`; construct `WriteContext = { session, groupId: uuidv4() }` and put on UoW; throw `SessionModeNotAllowedError` on mismatch.
- `packages/core/src/application/orchestration/cqrs/active-session.ts` — new `ActiveSession` type.
- `packages/core/src/application/orchestration/cqrs/write-context.ts` — new `WriteContext = { session: ActiveSession, groupId: string }`.
- `packages/core/src/application/orchestration/cqrs/errors.ts` — new `SessionModeNotAllowedError` (or extend existing error module).
- `packages/core/src/application/ports/persistence/unit-of-work.ts` — extend with `setWriteContext()`, `getWriteContext()`, `getPendingChangeCache()`, `applyCachedActions()`.
- `packages/core/src/application/ports/persistence/repositories/session/project-session-query.repository.ts` — new port (SessionGuard's session-lookup dependency).
- `packages/core/src/application/ports/persistence/pending-change-cache.ts` — new port.
- `packages/infrastructure/persistence/src/persistence-typeorm-sqllite/entity-schema/edit-session/edit-action.schema.ts` — reshape.
- `.../entity-schema/edit-session/session-entity-version.schema.ts` — new.
- `.../queries/edit-session/edit-actions-query-service.ts` — rewrite.
- `.../queries/edit-session/overlay-merge.ts` — rewrite.
- `.../queries/edit-session/field-path-reducer.ts` — new.
- `.../repositories/session/typeorm-project-session-query.repository.ts` — new (adapter for the core port).
- `.../services/pending-change-writer.ts` — rewrite (replaces existing `entity-staging-service.ts`; rename reflects the change from "stage" verb to "record pending change").
- `.../services/pending-change-cache.ts` — new (persistence adapter for the core port).
- `.../unit-of-work/typeorm-unit-of-work.ts` — extend with WriteContext + cache accessors.
- `packages/api/src/guards/session-guard.ts` — new (active-session resolution only; uses `ProjectSessionQueryRepository` port).
- `packages/api/src/filters/session-mode-not-allowed.filter.ts` — new (maps `SessionModeNotAllowedError` to 403).
- Migration file — regenerated `initial-create`.

---

## 16. Testing Strategy

### 16.1 Unit tests (`packages/core`, `packages/infrastructure/persistence`)

- `PendingChangeWriter`: accumulator merge, per-slot supersession, CREATE-then-modify, cached bulk write, changeStatus determination from source + mode.
- `PendingChangeCache`: flush with mixed baseVersion captures + inserts; empty-cache no-op.
- `OverlayMerge` + `FieldPathReducer`: each fieldPath shape, CREATE/UPDATE/DELETE semantics, fold order determinism, diff context production.

### 16.2 Integration tests (`packages/infrastructure/persistence/tests/integration`)

- In-memory SQLite with the new schema.
- End-to-end: staging + query + overlay merge across an aggregate.
- baseVersion capture through the side-table.
- Wipe-by-source.

### 16.3 E2E (`packages/api/tests/e2e`)

- `SessionGuard` behavior — 403s for missing session / disallowed mode.
- End-to-end write → read overlay cycle with an existing SET handler stub (or deferred to LLD2 if no handlers land in LLD1).

---

## 17. Migration & Rollout Notes

- Existing pending edit-actions in dev databases are discarded on migration regeneration — no data preservation.
- Any references to the old `payload` column in old query services need to be updated in later LLDs — LLD1 flags them but doesn't rewrite (LLD3 rewrites the module read side).
- Session Guard applies to endpoints wired with `@UseGuards(SessionGuard)`. Endpoints without it (e.g., pure read endpoints) are unaffected. Mode enforcement rolls out per command as commands declare their `static readonly allowedModes` field — commands with the empty default (`[]`) work in any mode until updated.

---

## 18. Open Questions

- Enumerate any decisions deliberately deferred to LLD execution phase.
- Cross-cutting questions that surface during content fill.

---

*End of Outline*
