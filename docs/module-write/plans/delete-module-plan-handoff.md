# Plan Handoff: Delete Module API

**Spec:** `docs/module-write/design/delete-module-design.md`
**Requirements:** `docs/module-write/requirements/delete-module-requirements.md`
**Plan output:** `docs/module-write/plans/delete-module.md`
**Goal:** Implement the Designer-mode Delete Module API with effective-state cascade deletion, subsystem route reporting and intent cleanup, independent container/subgraph lifecycle handling, and transactional edit-action persistence.
**Architecture:** Keep cascade and lifecycle decisions in `@arc/core` application services. Repository ports expose domain-oriented effective-state reads and explicit write operations; TypeORM adapters translate those operations into edit actions and own persistence-only identities. The NestJS controller remains a thin CQRS adapter.
**Scope note:** Implement the initial Designer-only delivery from design sections 1-18. Preserve the documented TODOs for DiffMerge change-selection dependencies. Do not implement commit-time subsystem boundary-port cleanup or the general Stage/Unstage dependency mechanism.

## Batches

### Batch 1 (parallel)

- **UseCase relationship persistence identity** | Sections 7, 15.2, 16 step 1 | Tasks 1-5
- **Core DTO, module projection, and intent topology operation** | Sections 4, 5, 8.3, 11, 15.1 | Tasks 6-10

### Batch 2 (sequential, after batch 1)

- **Repository ports and UnitOfWork contracts** | Sections 6.1-6.7, 10 | Tasks 11-14

### Batch 3 (parallel, after batch 2)

- **Module aggregate persistence adapter** | Sections 6.1, 10, 15.2 | Tasks 15-18
- **Link and subsystem persistence adapters** | Sections 6.2, 6.3, 6.7, 10, 11, 15.2 | Tasks 19-23
- **Container, subgraph, and UseCase persistence adapters** | Sections 6.4-6.6, 7, 10, 15.2 | Tasks 24-28

### Batch 4 (sequential, after batch 3)

- **Delete cascade application services** | Sections 8.1-8.5, 11, 12, 15.1 | Tasks 29-35

### Batch 5 (sequential, after batch 4)

- **Delete command, handler, and registry wiring** | Sections 3.2, 9, 10, 13, 14, 15.1 | Tasks 36-39

### Batch 6 (sequential, after batch 5)

- **Controller, API DTO, Swagger, and end-to-end verification** | Sections 3.1, 4, 12, 14, 15.3, 16 | Tasks 40-44

## Chapter Constraints

- Every chapter must follow `.ai/skills/writing-plans/references/plan-format.md`.
- Use exact current repository paths and ESM `.js` imports.
- Core must not import NestJS, TypeORM, SQLite, or Node.js APIs.
- Repository reads used by this endpoint return effective state by default: committed rows plus active `STAGED` and `UNSTAGED` edit actions.
- Persistence adapters own edit-action table mapping, base-version capture, owned-row enumeration, and persistence-only generated IDs.
- `module-properties` is not part of the delete cascade.
- Subsystem boundary ports are retained; only stale subsystem ControlPort intents are cleared.
- `SubsystemRepository.clearControlPortIntents` owns intent deletion.
- Reuse existing `DataLink`, `ControlLink`, `SubsystemDataLink`, and `SubsystemControlLink` domain entities.
- `ControlIntentPropagationService.findPortsToClearAfterDeletingLinks` must evaluate the complete deleted-segment set and return `{subsystemSystemId, controlPortSystemId}` pairs.
- Reuse `ContainerStackSizeService`; if the current branch still lacks it, include its shared implementation and effective-state read support as a prerequisite within the application-services chapter.
- Regenerate the single `initial-create` migration using the repository workflow; never hand-write migration SQL.
- All command-produced edit actions share the request `groupId`, while each aggregate retains its correct `aggregateId`.
- Include explicit TODOs for future DiffMerge dependency registration and enablement, but no placeholder implementation tasks.
