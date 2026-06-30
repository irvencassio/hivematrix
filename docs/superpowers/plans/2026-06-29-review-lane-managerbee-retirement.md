# Review Lane / ManagerBee Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-06-29-review-lane-managerbee-retirement-design.md`

---

## Overview

Make `"review"` the canonical lane id for Review Lane everywhere from the catalog entry outward. Keep old `managerbee` names only as explicit deprecated compatibility aliases where removing them would break persisted records or old clients. This is a rename-with-compat, not a destructive migration.

**No DB migrations. No directory renames. No removal of `"managerbee"` from `WORKER_KINDS`.**

---

## Task 1 — Write failing test: catalog kind (T1)

**File:** `tests/lib/lanes/catalog.review-lane-kind.test.ts`

Create the file. All assertions must fail on the current codebase (catalog still says `kind: "managerbee"`):

```ts
import { getLaneDefinition, listLaneDefinitions } from "@/lib/lanes/catalog";

describe("Review Lane catalog kind", () => {
  it('getLaneDefinition("review") is non-null', () => {
    expect(getLaneDefinition("review")).not.toBeNull();
  });

  it('getLaneDefinition("review").kind is "review"', () => {
    expect(getLaneDefinition("review")?.kind).toBe("review");
  });

  it('getLaneDefinition("managerbee") is non-null (compat)', () => {
    expect(getLaneDefinition("managerbee")).not.toBeNull();
  });

  it('listLaneDefinitions() has no entry with kind === "managerbee"', () => {
    const all = listLaneDefinitions();
    expect(all.every((d) => d.kind !== "managerbee")).toBe(true);
  });

  it('getLaneDefinition("review").name is "Review Lane"', () => {
    expect(getLaneDefinition("review")?.name).toBe("Review Lane");
  });
});
```

Run `npm test -- --testPathPattern=catalog.review-lane-kind` and confirm RED.

- [ ] Create test file
- [ ] Run and confirm failures

---

## Task 2 — Write failing test: status shape (T2)

**File:** `tests/lib/lanes/status.review-lane-shape.test.ts`

```ts
import { shapeLaneServiceStatuses } from "@/lib/lanes/status";

const makeStatus = (kind: string, name: string) => ({
  kind,
  name,
  pid: null,
  running: true,
  health: "ok" as const,
});

describe("Review Lane status shape", () => {
  it('kind "review" passes through as kind: "review"', () => {
    const result = shapeLaneServiceStatuses([makeStatus("review", "Review Lane")]);
    expect(result[0]?.kind).toBe("review");
    expect(result[0]?.name).toBe("Review Lane");
  });

  it('kind "managerbee" maps to kind: "review" (compat)', () => {
    const result = shapeLaneServiceStatuses([makeStatus("managerbee", "ManagerBee")]);
    expect(result[0]?.kind).toBe("review");
    expect(result[0]?.name).toBe("Review Lane");
  });
});
```

Run and confirm RED (the "review" pass-through case may be yellow depending on current code; the assertion on the final shape must fail or pass correctly — document the actual failure reason).

- [ ] Create test file
- [ ] Run and confirm expected failures

---

## Task 3 — Write failing test: symbol canonicalisation (T4)

**File:** `tests/lib/managerbee/review-lane-symbols.test.ts`

```ts
// These imports will fail until the canonical exports exist
import {
  buildReviewLaneReport,
  buildManagerBeeReport,
  type ReviewLaneReport,
  type ManagerBeeReport,
} from "@/lib/managerbee/report";
import {
  getReviewLaneStatus,
  getManagerBeeStatus,
} from "@/lib/managerbee/heartbeat";

describe("Review Lane canonical symbols", () => {
  it("buildReviewLaneReport returns a valid report", () => {
    const report = buildReviewLaneReport();
    expect(report).toBeDefined();
    expect(typeof report).toBe("object");
  });

  it("buildReviewLaneReport and buildManagerBeeReport return same shape", () => {
    const canonical = buildReviewLaneReport();
    const legacy = buildManagerBeeReport();
    expect(Object.keys(canonical).sort()).toEqual(Object.keys(legacy).sort());
  });

  it("getReviewLaneStatus returns same type as getManagerBeeStatus", () => {
    // Both must return objects with the same keys — structural compat
    const canonical = getReviewLaneStatus();
    const legacy = getManagerBeeStatus();
    expect(Object.keys(canonical).sort()).toEqual(Object.keys(legacy).sort());
  });

  it("ReviewLaneReport is assignable to ManagerBeeReport (type-level, runtime shape check)", () => {
    const r: ReviewLaneReport = buildReviewLaneReport();
    const m: ManagerBeeReport = r; // must compile
    expect(m).toBeDefined();
  });
});
```

Run and confirm RED (imports will throw because `buildReviewLaneReport` does not exist yet).

- [ ] Create test file
- [ ] Run and confirm failures

---

## Task 4 — Write failing test: API routes (T3 + T5)

**File:** `tests/daemon/review-lane-routes.test.ts`

Note: check how existing daemon route tests work (look at tests already in `tests/daemon/` for the correct server setup pattern). If the daemon server test requires a running server instance, mirror that exact setup.

```ts
// Adjust the import to match the existing test harness pattern
import { buildApp } from "@/daemon/server";
// or: import request from "supertest"; import { app } from "@/daemon/server";

describe("Review Lane routes", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => { app = buildApp(); });

  // Canonical routes
  it("GET /review-lane/status returns 200", async () => {
    const res = await request(app).get("/review-lane/status");
    expect(res.status).toBe(200);
  });

  it("GET /review-lane/status response has no top-level bee field", async () => {
    const res = await request(app).get("/review-lane/status");
    expect(res.body).not.toHaveProperty("bee");
  });

  it("GET /api/review-lane/health returns lane: review", async () => {
    const res = await request(app).get("/api/review-lane/health");
    expect(res.status).toBe(200);
    expect(res.body.lane).toBe("review");
    expect(res.body.name).toBe("Review Lane");
    expect(res.body).not.toHaveProperty("bee");
  });

  // Compatibility routes (must stay working)
  it("GET /managerbee/status returns 200 (compat)", async () => {
    const res = await request(app).get("/managerbee/status");
    expect(res.status).toBe(200);
  });

  it("GET /api/managerbee/health returns bee: managerbee (deprecated shape preserved)", async () => {
    const res = await request(app).get("/api/managerbee/health");
    expect(res.status).toBe(200);
    expect(res.body.bee).toBe("managerbee");
  });
});
```

Run and confirm RED (`/review-lane/status` and `/api/review-lane/health` will 404).

- [ ] Create test file
- [ ] Run and confirm failures

---

## Task 5 — Widen `LaneDefinition.kind` type in `catalog.ts`

**File:** `src/lib/lanes/catalog.ts`

1. Change `kind` field type from `WorkerKind` to `WorkerKind | LaneId`:
   ```ts
   import type { LaneId } from "@/lib/lanes/contracts";
   export interface LaneDefinition {
     kind: WorkerKind | LaneId;
     // ...existing fields
   }
   ```

2. Update the Review Lane entry (currently at ~line 49):
   ```ts
   {
     kind: "review",     // was "managerbee"
     name: "Review Lane",
     // ...rest unchanged
   }
   ```

3. Add a `COMPATIBILITY_KIND_MAP` and update `getLaneDefinition` to fall back to it:
   ```ts
   const COMPATIBILITY_KIND_MAP = new Map<string, LaneDefinition>([
     ["managerbee", LANE_DEFINITIONS.find((d) => d.kind === "review")!],
   ]);

   export function getLaneDefinition(kind: WorkerKind | string | null | undefined): LaneDefinition | null {
     if (!kind) return null;
     return (
       LANE_DEFINITION_MAP.get(kind as WorkerKind)
       ?? LANE_DEFINITION_MAP.get(kind as LaneId)
       ?? COMPATIBILITY_KIND_MAP.get(kind)
       ?? null
     );
   }
   ```

Run `npm test -- --testPathPattern=catalog.review-lane-kind` → must go GREEN.
Run `npm run typecheck` → zero errors.

- [ ] Widen kind type
- [ ] Update Review Lane catalog entry to `kind: "review"`
- [ ] Add compatibility fallback map and update getLaneDefinition
- [ ] T1 GREEN
- [ ] typecheck GREEN

---

## Task 6 — Update service-manager descriptor

**File:** `src/lib/lanes/service-manager.ts` (~line 96)

Change the Review Lane descriptor kind:
```ts
{
  kind: "review",    // was "managerbee"
  runtimeMode: "embedded",
  manageable: false,
},
```

Confirm the `DESCRIPTOR_MAP` key for this entry also becomes `"review"`. Verify `laneKindToManagedWorkerKind("review")` still returns the correct worker kind by checking how the function resolves — it may need to look up `LANE_ALIAS_TO_WORKER_KIND` from `central/contracts.ts` (which maps `"review" → "managerbee"`).

Run `npm run typecheck` and `npm test` → both pass.

- [ ] Update descriptor kind to "review"
- [ ] Confirm DESCRIPTOR_MAP key resolution is correct
- [ ] typecheck GREEN, existing tests pass

---

## Task 7 — Simplify `status.ts` mapping

**File:** `src/lib/lanes/status.ts` (lines 15–24)

Keep `managerbee → review` in `STATUS_KIND_TO_LANE` as a compatibility entry, but remove any internal mapping that is now redundant because the catalog emits `"review"` directly. The `shapeLaneServiceStatuses` function should handle `kind: "review"` as a pass-through LaneId.

Verify the pass-through path works by checking the branch in `shapeLaneServiceStatuses` that handles `laneId ?? status.kind`. No code change may be needed — just confirm the existing logic handles `"review"` correctly after the catalog is fixed.

Run `npm test -- --testPathPattern=status.review-lane-shape` → T2 GREEN.

- [ ] Review shapeLaneServiceStatuses pass-through logic
- [ ] Make changes if needed (may be no-op)
- [ ] T2 GREEN

---

## Task 8 — Add canonical exports to `src/lib/managerbee/report.ts`

**File:** `src/lib/managerbee/report.ts`

Add below existing exports:
```ts
// Canonical — new code should import these
export type ReviewLaneReport = ManagerBeeReport;
export const buildReviewLaneReport = buildManagerBeeReport;

// Deprecated compatibility re-exports (kept for one release window)
/** @deprecated Use ReviewLaneReport */
export type { ManagerBeeReport };
/** @deprecated Use buildReviewLaneReport */
export { buildManagerBeeReport };
```

(The `export type { ManagerBeeReport }` line may already exist; ensure it is present and add the `@deprecated` JSDoc.)

- [ ] Add ReviewLaneReport type alias
- [ ] Add buildReviewLaneReport function alias
- [ ] Ensure deprecated re-exports are present with @deprecated JSDoc

---

## Task 9 — Add canonical exports to `src/lib/managerbee/heartbeat.ts`

**File:** `src/lib/managerbee/heartbeat.ts`

1. Rename the internal implementations to canonical names and re-export the old names as deprecated aliases:
   ```ts
   // Rename existing implementations:
   export function getReviewLaneStatus(): ReviewLaneReport { ... }
   export function startReviewLaneHeartbeat(intervalMs?: number): () => void { ... }
   export function stopReviewLaneHeartbeat(): void { ... }

   // Deprecated compatibility aliases
   /** @deprecated Use getReviewLaneStatus */
   export const getManagerBeeStatus = getReviewLaneStatus;
   /** @deprecated Use startReviewLaneHeartbeat */
   export const startManagerBeeHeartbeat = startReviewLaneHeartbeat;
   /** @deprecated Use stopReviewLaneHeartbeat */
   export const stopManagerBeeHeartbeat = stopReviewLaneHeartbeat;
   ```

2. Update the WebSocket broadcast to emit both event types (dual-emit for one release window):
   ```ts
   broadcast({ type: "review_lane_status", lane: "review", report: lastReport });
   broadcast({ type: "managerbee_status", report: lastReport }); // @deprecated compat
   ```

Run `npm test -- --testPathPattern=review-lane-symbols` → T4 GREEN.

- [ ] Rename internal implementations to canonical names
- [ ] Add deprecated aliases for old names
- [ ] Update WS broadcast to dual-emit
- [ ] T4 GREEN

---

## Task 10 — Update internal call sites

Switch all internal imports away from the deprecated symbols (so `@deprecated` is not violated by our own code in the same PR).

| File | Old symbol | New symbol |
|------|-----------|-----------|
| `src/lib/telemetry/diagnostics.ts` | `buildManagerBeeReport`, `ManagerBeeReport` | `buildReviewLaneReport`, `ReviewLaneReport` |
| `src/daemon/index.ts` | `startManagerBeeHeartbeat` | `startReviewLaneHeartbeat` |
| `src/daemon/server.ts` | `getManagerBeeStatus` | `getReviewLaneStatus` |

Steps:
- Edit each file's import line and update all usages of the old symbol name within the file.
- Run `npm run typecheck` after each file to catch mistakes early.

- [ ] Update diagnostics.ts imports and usages
- [ ] Update daemon/index.ts imports and usages
- [ ] Update daemon/server.ts imports and usages (getManagerBeeStatus → getReviewLaneStatus)
- [ ] typecheck GREEN

---

## Task 11 — Add canonical API routes to `src/daemon/server.ts`

**File:** `src/daemon/server.ts`

Add two new route handlers alongside the existing `/managerbee` routes:

```ts
// Canonical Review Lane routes
app.get("/review-lane/status", (_req, res) => {
  const report = getReviewLaneStatus();
  res.json(report);
});

app.get("/api/review-lane/health", (_req, res) => {
  const report = getReviewLaneStatus();
  res.json({
    lane: "review",
    name: "Review Lane",
    ok: report.health === "ok",
    health: report.health,
    report,
  });
});
```

Update the existing compatibility routes to add a deprecation log at debug level:

```ts
app.get("/managerbee/status", (_req, res) => {
  console.debug("[deprecated] GET /managerbee/status — use /review-lane/status");
  const report = getReviewLaneStatus();
  res.json(report);
});

app.get("/api/managerbee/health", (_req, res) => {
  console.debug("[deprecated] GET /api/managerbee/health — use /api/review-lane/health");
  const report = getReviewLaneStatus();
  res.json({
    bee: "managerbee",
    ok: report.health === "ok",
    health: report.health,
    report,
  });
});
```

Run `npm test -- --testPathPattern=review-lane-routes` → T3 + T5 GREEN.

- [ ] Add /review-lane/status route
- [ ] Add /api/review-lane/health route
- [ ] Add deprecation debug logs to existing /managerbee routes
- [ ] T3 GREEN
- [ ] T5 GREEN

---

## Task 12 — Full verification gate

Run all three gates in sequence. All must pass before marking this implementation complete.

```bash
npm run typecheck          # zero errors
npm test                   # all tests pass (950+)
node scripts/scope-wall.mjs  # zero violations
```

If any gate fails, fix the failure before proceeding.

- [ ] npm run typecheck → zero errors
- [ ] npm test → all tests pass
- [ ] node scripts/scope-wall.mjs → zero violations

---

## Test coverage summary

| Test file | Suite | What turns GREEN |
|-----------|-------|-----------------|
| `tests/lib/lanes/catalog.review-lane-kind.test.ts` | T1 | Tasks 5 |
| `tests/lib/lanes/status.review-lane-shape.test.ts` | T2 | Tasks 6–7 |
| `tests/lib/managerbee/review-lane-symbols.test.ts` | T4 | Tasks 8–9 |
| `tests/daemon/review-lane-routes.test.ts` | T3 + T5 | Tasks 10–11 |

---

## Follow-up (explicitly out of scope — track in a separate plan)

- Remove `GET /managerbee/*` routes after one release window.
- Remove `managerbee_status` WS dual-emit.
- Remove deprecated `ManagerBeeReport`, `getManagerBeeStatus`, `startManagerBeeHeartbeat`, `stopManagerBeeHeartbeat` re-exports.
- Migrate persisted central-task `bee: "managerbee"` records to `lane: "review"` (Workstream 3 of `docs/superpowers/specs/2026-06-25-lane-rename-remaining-handoff-design.md`).
