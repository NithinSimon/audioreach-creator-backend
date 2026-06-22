<!--
 Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 SPDX-License-Identifier: BSD-3-Clause
-->

# Diff DTO Design Comparison

**Date:** 2026-06-20
**Status:** Decision
**Owner:** Nithin Simon

---

## Context

When surfacing change context (old value, new value, staging state) alongside entity data in API responses, two structural approaches were evaluated. Both use the same underlying `edit_actions` DB design with `field_group` as the staging discriminator. The difference is purely at the API DTO layer.

---

## Approach A — `Diff<T>` per editable field

Each editable field on the entity DTO is replaced with a generic wrapper. Non-editable fields (e.g. `systemId`) remain plain.

```typescript
interface Diff<T> {
  entity: T;           // current effective value — always present
  changeId?: number;
  status?: "STAGED" | "UNSTAGED";
  operation?: "CREATE" | "UPDATE" | "DELETE";
  oldValue?: T;        // absent when no pending change
}

interface SpfModuleDto {
  systemId: number;                 // non-editable — plain
  alias: Diff<string>;              // editable — always wrapped
  containerSystemId: Diff<number>;  // editable — always wrapped
}
```

When nothing has changed:

```json
{ "systemId": 100, "alias": { "entity": "Mod1" }, "containerSystemId": { "entity": 100 } }
```

When `alias` has a pending change:

```json
{
  "systemId": 100,
  "alias": { "entity": "Mod2", "changeId": 501, "status": "STAGED", "operation": "UPDATE", "oldValue": "Mod1" },
  "containerSystemId": { "entity": 100 }
}
```

---

## Approach B — `DiffEntityBase` as optional field on the entity

Entity fields stay plain and typed. One optional field carries all change context. Absent entirely when there are no pending changes.

```typescript
interface DiffEntityBase {
  operation: "CREATE" | "UPDATE" | "DELETE";
  status: "STAGED" | "UNSTAGED" | "PARTIAL";
  changeUnits: ChangeUnitDto[];
}

interface ChangeUnitDto {
  changeId: number;
  status: "STAGED" | "UNSTAGED";
  fields: FieldChangeDto[];        // all fields in this unit staged atomically
}

interface FieldChangeDto {
  fieldName: string;
  oldValue: unknown | null;
  newValue: unknown | null;
}

interface SpfModuleDto {
  systemId: number;
  alias: string;                   // plain — unchanged from today
  containerSystemId: number;       // plain — unchanged from today
  diffEntity?: DiffEntityBase;     // absent when no pending changes
}
```

When nothing has changed: `diffEntity` is absent — no overhead.

When `alias` and `containerSystemId` have independent pending changes:

```json
{
  "systemId": 100,
  "alias": "Mod2",
  "containerSystemId": 100,
  "diffEntity": {
    "operation": "UPDATE",
    "status": "PARTIAL",
    "changeUnits": [
      { "changeId": 501, "status": "STAGED",   "fields": [{ "fieldName": "alias",            "oldValue": "Mod1", "newValue": "Mod2" }] },
      { "changeId": 502, "status": "UNSTAGED", "fields": [{ "fieldName": "containerSystemId", "oldValue": 100,    "newValue": 200   }] }
    ]
  }
}
```

---

## Trade-off Comparison

### Co-location of change info

**Approach A wins.** `module.alias.oldValue` and `module.alias.status` are immediately accessible at the field itself. No correlation step needed.

**Approach B** requires finding the matching entry in `changeUnits` by `fieldName`. This is addressed with a one-line UI utility: `getFieldDiff(diffEntity, "alias")` — the string match happens once, in one place.

---

### Response size when no changes

**Approach B wins.** When nothing has changed, `diffEntity` is absent entirely. The response is identical to a plain entity read.

**Approach A** always sends `{ entity: value }` for every editable field in every response, in every mode. An entity with 10 editable fields always carries 10 wrapper objects — even in READ-ONLY mode with no pending changes.

---

### Entity-level operation and status

**Approach B wins.** `diffEntity.operation` and `diffEntity.status: "PARTIAL"` are explicit. The UI can render an entity-level staged indicator or creation badge without any computation.

**Approach A** pushes this aggregation to every UI consumer. To know if an entity is `PARTIAL`, the consumer must inspect every editable field's `status`. To know if an entity is being created, it must check all fields for `operation: "CREATE"`.

---

### Atomic group visibility

**Approach B wins.** When `alias` and `containerSystemId` must always be staged together (atomic), they sit inside one `changeUnit` with one `changeId`. The grouping is explicit in the structure — impossible to miss.

**Approach A** uses the same `changeId` value on multiple fields to signal atomicity. The grouping is implicit. The consumer must discover it by comparing `changeId` values across fields — nothing in the type communicates this constraint.

---

### Child entities

**Approach B wins.** Each child entity carries its own `diffEntity`. The pattern is uniform at every level of the response hierarchy.

**Approach A** handles scalar fields cleanly but becomes structurally awkward at child entity boundaries. A CKV is not a scalar — it is an entity with its own `systemId`, children, and independent staging. `Diff<CkvDto>` does not model this naturally, and a `changeId` on the array wrapper does not map to a DB `edit_action` row in any meaningful way.

---

### OpenAPI / Swagger

**Approach B wins.** `DiffEntityBase` is one concrete reusable type. Works cleanly with any OpenAPI generator.

**Approach A** uses TypeScript generics which have no direct OpenAPI equivalent. Schema generators must produce separate concrete types per field: `AliasChange`, `ContainerSystemIdChange`, etc. The generated API documentation loses the conceptual unity of the `Diff<T>` pattern and grows proportionally with the number of editable fields.

---

### API Evolution on Regrouping — the decisive point

This is where the structural difference matters most.

**In Approach A, the atomic grouping of fields is encoded in the DTO structure itself.**

If `alias` and `containerSystemId` are one atomic unit today, they must be modelled as one DTO property:

```typescript
// Today — grouped as one atomic unit
interface SpfModuleDto {
  aliasAndContainerId: Diff<{ alias: string; containerId: number }>;
}
```

If next year the decision changes and they become independently stageable, the DTO must change:

```typescript
// Next year — split into independent fields
interface SpfModuleDto {
  alias: Diff<string>;
  containerId: Diff<number>;
}
```

**Property count changed. Every client breaks. API versioning required.**

**In Approach B, the grouping lives entirely in the runtime content of `changeUnits` — not in the DTO type.**

The DTO shape is identical regardless of how fields are grouped:

```typescript
// DTO shape — same today and next year
interface SpfModuleDto {
  alias: string;
  containerId: number;
  diffEntity?: DiffEntityBase;
}
```

| Period | `changeUnits` content |
|---|---|
| Today (grouped) | `[{ changeId: 501, fields: [alias, containerId] }]` |
| Next year (split) | `[{ changeId: 501, fields: [alias] }, { changeId: 502, fields: [containerId] }]` |

**Same DTO. Different data. No client breakage. No versioning needed.**

Grouping decisions are business logic — they belong in data, not in types. Approach A encodes a business decision into the type system, making every regrouping a versioning event.

---

## Summary

| Concern | Approach A — `Diff<T>` per field | Approach B — `DiffEntityBase` |
|---|---|---|
| Co-location of change info | Right on the field — no correlation | String match in `changeUnits` — one UI utility |
| Response when no changes | `{ entity: value }` on every editable field | `diffEntity` absent — zero overhead |
| Entity-level operation / status | Must aggregate from all fields | Explicit on `diffEntity` |
| Atomic group visibility | Implicit — same `changeId` value | Explicit — one `changeUnit`, multiple `fields` |
| Child entities | Awkward at entity boundaries | Uniform — each child carries its own `diffEntity` |
| OpenAPI / Swagger | Generic `T` → separate type per field | One concrete reusable type |
| **API evolution on regrouping** | **DTO property count changes → versioning required** | **DTO unchanged — grouping is runtime data** |

---

## Decision

**Approach B (`DiffEntityBase`) is adopted.**

Approach A has a genuine ergonomic advantage in co-location — accessing `module.alias.oldValue` directly is more natural than a `fieldName` lookup. This advantage is real but addressable with a small UI utility function.

Approach A's API evolution cost is structural and permanent: grouping decisions are coupled to the type system. Any change to how fields are grouped — a routine business decision as requirements evolve — forces a breaking API change and versioning. This cost is unacceptable in a long-lived open source API.

---

*End of Document*
