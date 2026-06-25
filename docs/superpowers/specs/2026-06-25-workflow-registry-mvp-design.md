# Workflow Registry MVP — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: workflow-registry-mvp
> Builds on commit `a10c06a` (HeyGen portal pipeline dry-run verification).

## Problem

Repeatable business workflows (the HeyGen portal video pipeline being the first) are
reachable only through bespoke endpoints. We add a typed, deterministic **Workflow
Registry** so COO / model / operator surfaces can *discover* workflows — their lane,
readiness needs, handoffs, artifacts, and runbook — without a new one-off endpoint
each time. HeyGen is registered as the first workflow; it points at the existing
`dispatchHeyGenVideoWorkflow`, not duplicate logic.

## Non-goals / guardrails

- No browser clicking / credential injection / Playwright. No mail/message/desktop/
  terminal execution. No destructive Bee→Lane cleanup, `WorkerKind` flips,
  `DesktopBeeHelper.app` rename, or module sweeps.
- Definitions are **pure data** (serializable, secret-free) — no functions, no secrets.
- No prompt-defined workflows. Existing `/coo/dispatch` + HeyGen pipeline stay compatible;
  `npm run verify:portal` must still pass.

## Design

### 1. Registry contracts (`src/lib/workflows/registry.ts`)
```ts
interface WorkflowInputField { name; type: "string"|"string[]"|"boolean"; required; description }
interface WorkflowDefinition {
  id; name; description;
  lane: LaneId; capability;
  inputSchema: WorkflowInputField[];
  readiness: { required: boolean; siteId?: string; note: string };
  approvalPolicy: { mode: "manual"|"auto"|"confirm_external"; note: string };
  handoffPoints: string[];
  artifacts: string[];
  runbook: string;                 // docs path
  routing: { domains: string[]; phrases: string[]; tags: string[] };
  handler: string;                 // marker → maps to an existing helper (no logic here)
}
```
- `normalizeWorkflowDefinition(input)` — validates required fields + **rejects
  secret-looking field names**.
- `createWorkflowRegistry(defs)` — normalizes + **validates unique ids** (throws on dup);
  returns `{ list(), get(id), match({text?,domains?,tags?}) }`.
- `getWorkflowRegistry()` — default singleton over `BUILTIN_WORKFLOWS`.
- `summarizeWorkflow(def)` → `{ id, name, runbook, lane }` (the compact shape surfaced to
  COO/model).

### 2. HeyGen workflow (`src/lib/workflows/heygen-portal.ts`)
`id: "heygen.portal_video_from_script"`, lane `browser`, capability `workflow.run`.
`readiness {required:true, siteId:"heygen"}`. `handoffPoints` = `HEYGEN_HANDOFF_POINTS`.
`routing.domains` = `HEYGEN_SITE.allowedDomains`; phrases incl. `heygen`. `runbook` =
`docs/runbooks/heygen-portal-video-pipeline.md`. `handler: "heygen-portal-video"`
(maps to `dispatchHeyGenVideoWorkflow`). Imports only the HeyGen *constants*.

### 3. APIs (`src/daemon/server.ts`)
- `GET /workflows` → `{ workflows: WorkflowDefinition[] }` (secret-free data).
- `GET /workflows/:id` → `{ workflow }` or 404.
- `POST /workflows/:id/prepare` (HeyGen handler only, low-risk prepare): body `{script,title,…}`
  → `dispatchHeyGenVideoWorkflow(input, { staleAfterHours })` prepare; returns the result +
  the workflow summary. Other handlers → 400 "no prepare handler".

### 4. COO / model visibility
- `CooDispatchResult` gains an additive nullable `workflow: { id, name, runbook, lane } | null`,
  set in `dispatchCooRequest` from `registry.match(request)` (independent of rule matching —
  COO can name the workflow even on `no_match`). Existing behaviour unchanged.
- `formatCooDispatchResult` (lane tool) renders the matched workflow id + runbook; the
  `coo_dispatch` routing-guide line mentions registered workflows.

### 5. Console (`src/daemon/console.ts`, Lanes tab)
A compact **Workflows** panel: fetch `GET /workflows`, list id/name/lane, readiness need,
and a runbook pointer. No redesign.

## Tests (RED first)
- Registry: `createWorkflowRegistry` throws on duplicate ids; `list()` includes HeyGen;
  HeyGen def has `readiness.required` + `siteId:"heygen"`, all six handoffs, HeyGen domains,
  the runbook path; `match` finds HeyGen by domain `app.heygen.com` and by phrase `heygen`;
  no secrets in any definition.
- COO: `dispatchCooRequest({domains:["app.heygen.com"]})` → `result.workflow.id ===
  "heygen.portal_video_from_script"`; `formatCooDispatchResult` surfaces it.
- Console source: Workflows panel + `/workflows` fetch + runbook link; no secrets.
- `npm run verify:portal` still 8/8.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal` — all green.
