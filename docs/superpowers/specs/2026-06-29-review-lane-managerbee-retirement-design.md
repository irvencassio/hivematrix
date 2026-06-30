# Review Lane / ManagerBee Retirement Design

> **Status:** Draft — awaiting approval before implementation.

## Context

HiveMatrix adopted "lanes" as the canonical product language and has progressively renamed Bee surfaces. Most lanes now present their lane identity at every operator-visible boundary. Review Lane is the last remaining lane whose internal `kind` is still `"managerbee"` all the way from the catalog entry through the API routes, payload shapes, WebSocket events, and exported TypeScript symbols.

Stale `managerbee` surfaces found during research (2026-06-29):

| Surface | File | Stale value |
|---|---|---|
| Catalog entry `kind` | `src/lib/lanes/catalog.ts:49` | `kind: "managerbee"` |
| Status map | `src/lib/lanes/status.ts:15-24` | `managerbee → review` mapping (needed because catalog still says managerbee) |
| Service-manager descriptor | `src/lib/lanes/service-manager.ts:96` | `kind: "managerbee"` |
| Daemon route — status | `src/daemon/server.ts:950` | `GET /managerbee/status` (only route) |
| Daemon route — health | `src/daemon/server.ts:950,954` | `GET /api/managerbee/health`, payload `{ bee: "managerbee" }` |
| Heartbeat broadcast | `src/lib/managerbee/heartbeat.ts:24` | `type: "managerbee_status"` |
| Exported interface | `src/lib/managerbee/report.ts:16` | `ManagerBeeReport` |
| Exported function | `src/lib/managerbee/report.ts:49` | `buildManagerBeeReport()` |
| Exported function | `src/lib/managerbee/heartbeat.ts:17` | `getManagerBeeStatus()` |
| Exported function | `src/lib/managerbee/heartbeat.ts:30` | `startManagerBeeHeartbeat()` |
| Exported function | `src/lib/managerbee/heartbeat.ts:38` | `stopManagerBeeHeartbeat()` |
| Telemetry import | `src/lib/telemetry/diagnostics.ts:12` | `buildManagerBeeReport, ManagerBeeReport` |
| Daemon startup | `src/daemon/index.ts:144` | `startManagerBeeHeartbeat()` |

## Existing canonical infrastructure (already correct)

These surfaces already emit the Review Lane identity and are **not** changed by this work:

- `src/lib/lanes/contracts.ts` — `LANE_IDS` includes `"review"`; `laneDisplayName("review")` returns `"Review Lane"`.
- `src/lib/central/contracts.ts` — `LANE_ALIAS_TO_WORKER_KIND["review"] = "managerbee"` normalises lane-input to the persisted kind; `"managerbee"` is kept in `WORKER_KINDS` for persisted records.
- `src/lib/lanes/status.ts` — `shapeLaneServiceStatuses` already emits `kind: "review"` and `name: "Review Lane"` in its output (via `STATUS_KIND_TO_LANE`).

## Goal

Make `"review"` the canonical lane id everywhere from the catalog entry outward. Keep old `managerbee` names only as explicit, clearly-labelled deprecated compatibility aliases where removing them would break persisted records or old clients.

## Non-goals

- No destructive DB migrations (no column renames, no rewriting persisted task rows).
- Do not remove `"managerbee"` from `WORKER_KINDS` — it is the persisted kind for existing central-task and worker-registration records.
- Do not rename the `src/lib/managerbee/` directory — it is a module boundary, not a product name; callers will use canonical re-exports.
- Do not touch the broader `bee`-field migration in central contracts (that is Workstream 3 of the handoff design and out of scope here).

## Approach

### 1. Widen `LaneDefinition.kind` type in `catalog.ts`

`LaneDefinition.kind` is currently typed as `WorkerKind`. Because `"review"` is not a `WorkerKind`, changing the Review Lane entry requires widening the type.

Change the type to `WorkerKind | LaneId`:

```ts
import type { WorkerKind } from "@/lib/central/contracts";
import type { LaneId } from "@/lib/lanes/contracts";

export interface LaneDefinition {
  kind: WorkerKind | LaneId;
  // ...
}
```

Then update the Review Lane catalog entry:

```ts
{
  kind: "review",           // was "managerbee"
  name: "Review Lane",
  role: "meta",
  // ...
}
```

Because `getLaneDefinition` accepts `WorkerKind | string | null | undefined`, old callers that pass `"managerbee"` must still resolve. Add a compatibility fallback to the lookup:

```ts
// In getLaneDefinition():
return LANE_DEFINITION_MAP.get(kind as WorkerKind)
  ?? COMPATIBILITY_KIND_MAP.get(kind)
  ?? null;

const COMPATIBILITY_KIND_MAP = new Map<string, LaneDefinition>([
  ["managerbee", /* point to the review entry */],
]);
```

### 2. Update `service-manager.ts` descriptor

Change the Review Lane descriptor kind from `"managerbee"` to `"review"`:

```ts
{
  kind: "review",    // was "managerbee"
  runtimeMode: "embedded",
  manageable: false,
},
```

`DESCRIPTOR_MAP` uses the `kind` as its key; lookups from `status.ts` via `laneKindToManagedWorkerKind("review")` already return the correct worker kind for autostart operations.

### 3. Simplify `status.ts` mapping

Once the catalog emits `"review"` as the kind, `STATUS_KIND_TO_LANE` no longer needs `managerbee → review`. Keep it as a compatibility entry for any old status emitters that still report `kind: "managerbee"` (e.g. external workers, legacy persisted snapshots):

```ts
const STATUS_KIND_TO_LANE: Record<string, LaneId> = {
  // ...
  managerbee: "review",  // compatibility: old workers or persisted snapshots
  // "review" passes through as LaneId directly — no entry needed
};
```

The `shapeLaneServiceStatuses` function already handles pass-through when the kind is already a `LaneId` (the `laneId ?? status.kind` branch).

### 4. Canonical API routes (new, non-breaking addition)

Add two canonical routes in `src/daemon/server.ts`:

| New canonical route | Payload shape |
|---|---|
| `GET /review-lane/status` | `ReviewLaneReport` (same object as before, no `bee` field at root) |
| `GET /api/review-lane/health` | `{ lane: "review", name: "Review Lane", ok: boolean, health: "ok" \| "attention", report: ReviewLaneReport }` |

Keep the old routes as deprecated compatibility aliases:

| Compatibility route | Payload shape |
|---|---|
| `GET /managerbee/status` | Same `ReviewLaneReport` body — unchanged |
| `GET /api/managerbee/health` | `{ bee: "managerbee", ok: boolean, health: ..., report }` — unchanged deprecated shape |

Both old routes log a single `[deprecated]` console line at debug level when hit, so they show up in traces without spamming production logs.

### 5. Canonical symbols in `src/lib/managerbee/`

**`report.ts`** — add canonical type and function aliases, keep legacy names as deprecated re-exports:

```ts
// Canonical — new code should import these
export type ReviewLaneReport = ManagerBeeReport;
export const buildReviewLaneReport = buildManagerBeeReport;

// Deprecated compatibility — kept for one release window
/** @deprecated Use ReviewLaneReport */
export type { ManagerBeeReport };
/** @deprecated Use buildReviewLaneReport */
export { buildManagerBeeReport };
```

**`heartbeat.ts`** — same pattern:

```ts
// Canonical exports
export function getReviewLaneStatus(): ReviewLaneReport { ... }
export function startReviewLaneHeartbeat(intervalMs?: number): () => void { ... }
export function stopReviewLaneHeartbeat(): void { ... }

// Deprecated compatibility wrappers
/** @deprecated Use getReviewLaneStatus */
export const getManagerBeeStatus = getReviewLaneStatus;
/** @deprecated Use startReviewLaneHeartbeat */
export const startManagerBeeHeartbeat = startReviewLaneHeartbeat;
/** @deprecated Use stopReviewLaneHeartbeat */
export const stopManagerBeeHeartbeat = stopReviewLaneHeartbeat;
```

WebSocket broadcast: emit **both** event types for one release window, then drop `managerbee_status` in a follow-up:

```ts
broadcast({ type: "review_lane_status", lane: "review", report: lastReport });
broadcast({ type: "managerbee_status", report: lastReport }); // deprecated compat
```

### 6. Update call sites in the same PR

Update all internal call sites to use the canonical symbols so `@deprecated` is not immediately violated by our own code:

| File | Old import | New import |
|---|---|---|
| `src/lib/telemetry/diagnostics.ts` | `buildManagerBeeReport, ManagerBeeReport` | `buildReviewLaneReport, ReviewLaneReport` |
| `src/daemon/index.ts` | `startManagerBeeHeartbeat` | `startReviewLaneHeartbeat` |
| `src/daemon/server.ts` | `getManagerBeeStatus` | `getReviewLaneStatus` |

## Compatibility surface that stays

These are intentionally kept as deprecated aliases after this PR:

| Surface | Reason |
|---|---|
| `"managerbee"` in `WORKER_KINDS` | Persisted central-task and worker-registration records use this value |
| `LANE_ALIAS_TO_WORKER_KIND["review"] = "managerbee"` | Normalises incoming "review" to persisted "managerbee" for the protocol layer |
| `GET /managerbee/status` route | Old clients and diagnostics scripts may call it |
| `GET /api/managerbee/health` route | Old iOS/console clients check `bee: "managerbee"` |
| `type ManagerBeeReport` re-export | Compilation safety for any external worker that imported the type |
| `managerbee_status` WS event | Existing console/iOS socket listeners |
| `getLaneDefinition("managerbee")` resolves | Avoids a null-deref in any code that builds status from raw central worker records |

## What is explicitly NOT preserved

| Surface | Replacement |
|---|---|
| `kind: "managerbee"` in lane catalog entry | `kind: "review"` |
| `kind: "managerbee"` in service-manager descriptor | `kind: "review"` |
| `{ bee: "managerbee" }` on canonical `/api/review-lane/health` | `{ lane: "review", name: "Review Lane" }` |
| Internal call sites importing deprecated symbols | Imports switched to canonical names |

## Tests (TDD — write failing tests first)

All test files go in `tests/` mirroring the `src/` structure.

### T1 — Catalog: `"review"` is the canonical kind

```
tests/lib/lanes/catalog.review-lane-kind.test.ts
```

- `getLaneDefinition("review")` is non-null
- `getLaneDefinition("review")?.kind` is `"review"` (not `"managerbee"`)
- `getLaneDefinition("managerbee")` is non-null (compatibility)
- `listLaneDefinitions()` contains no entry whose `kind === "managerbee"`
- `getLaneDefinition("review")?.name` is `"Review Lane"`

### T2 — Status: "review" passes through shape correctly

```
tests/lib/lanes/status.review-lane-shape.test.ts
```

- `shapeLaneServiceStatuses([{kind: "review", name: "Review Lane", ...}])` returns `[{kind: "review", name: "Review Lane"}]`
- `shapeLaneServiceStatuses([{kind: "managerbee", name: "ManagerBee", ...}])` still returns `[{kind: "review", name: "Review Lane"}]` (compat)

### T3 — API routes: canonical and compatibility

```
tests/daemon/review-lane-routes.test.ts
```

- `GET /review-lane/status` returns 200 with a valid report object (no `bee` field at root)
- `GET /api/review-lane/health` returns 200 with `{ lane: "review", name: "Review Lane", ok: boolean, health: string }`
- `GET /managerbee/status` returns 200 (same data — compat)
- `GET /api/managerbee/health` returns 200 with `{ bee: "managerbee" }` (deprecated shape preserved)

### T4 — Symbol canonicalisation

```
tests/lib/managerbee/review-lane-symbols.test.ts
```

- `buildReviewLaneReport()` returns same shape as `buildManagerBeeReport()`
- `getReviewLaneStatus()` returns same type as `getManagerBeeStatus()`
- `ReviewLaneReport` is assignable to `ManagerBeeReport` (structural compatibility)

### T5 — No operator-visible ManagerBee on canonical routes

```
tests/daemon/review-lane-no-managerbee-payload.test.ts
```

- `/api/review-lane/health` response body does NOT contain the key `"bee"` at the top level
- `/review-lane/status` response body does NOT contain the key `"bee"` at the top level
- WS event `"review_lane_status"` is emitted (assert broadcast call includes it)

## Verification gates

```bash
npm run typecheck   # zero errors
npm test            # all tests pass (950+)
node scripts/scope-wall.mjs   # zero violations
```

## Implementation order

1. Write failing tests T1–T5.
2. Widen `LaneDefinition.kind` type and update catalog entry (T1 → green).
3. Update service-manager descriptor (T1 side-effect coverage).
4. Simplify status.ts mapping (T2 → green).
5. Add canonical exports to `managerbee/report.ts` and `managerbee/heartbeat.ts`; update call sites in diagnostics.ts and daemon/index.ts (T4 → green).
6. Add canonical routes and keep compatibility routes in daemon/server.ts (T3, T5 → green).
7. Run all gates.

## Follow-up (out of scope here)

- Remove `GET /managerbee/*` routes after one release window.
- Remove `managerbee_status` WS event.
- Remove deprecated `ManagerBeeReport`, `getManagerBeeStatus`, `startManagerBeeHeartbeat`, `stopManagerBeeHeartbeat` re-exports.
- Migrate persisted central-task `bee: "managerbee"` records to `lane: "review"` as part of a later broad central-protocol migration (Workstream 3 of 2026-06-25-lane-rename-remaining-handoff-design.md).
