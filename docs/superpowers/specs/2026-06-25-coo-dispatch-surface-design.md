# COO Dispatch — Model + Operator Surface — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: coo-dispatch-surface
> Builds on commit `606e622` (explicit Browser-Lane task creation + dispatch hardening).
> Extends `2026-06-25-coo-dispatch-task-creation-design.md`.

## Problem

`dispatchCooRequest` / `dispatchCooTask` exist and are wired to `POST /coo/dispatch`,
but nothing the model or operator touches uses them. This slice exposes COO dispatch
so Browser-Lane routing can be used **intentionally** — a model-facing lane tool and a
small operator console surface — while risky lanes stay approval-only.

## Non-goals / guardrails

- Do **not** implement mail/message/desktop/terminal execution. Those lanes keep
  returning `approval_required`.
- No destructive Bee→Lane cleanup, no `WorkerKind` flips, no `DesktopBeeHelper.app`
  rename, no `src/lib/<x>bee/` module sweeps. Compatibility ids intact internally.
- `POST /coo/dispatch` and `POST /coo/routing-rules/resolve` behavior unchanged.
- Visible UI/model copy avoids "Bee" product names; persisted ids stay legacy.
- The surface **reuses** `dispatchCooTask` (via the existing endpoint) — it must not
  duplicate routing logic.

## Design

### 1. Model-facing lane tool — `coo_dispatch` (`src/lib/orchestrator/lane-tools.ts`)
- New entry in `LANE_TOOL_DEFINITIONS`, gated on the `browserbee` capability (the one
  executable lane in this slice) via `LANE_TOOL_CAPABILITY`.
- Params: `text` (required objective), `domains` (string[]), `project` (label),
  `create` (boolean). When `create`, the real execution project root comes from the
  tool's `LaneToolContext.projectPath` (a real path under `$HOME`).
- `executeCooDispatch(args, ctx, runner?)`: builds the request and calls an injectable
  `CooDispatchToolRunner` (default = loopback `POST /coo/dispatch`, reusing the
  endpoint → `dispatchCooTask`; **no duplicated routing**). Tests inject a direct
  runner backed by `dispatchCooRequest`/`dispatchCooTask`.
- Returns a structured, secret-free model-facing string via the pure, exported
  `formatCooDispatchResult(result)` — one rendering per status: `prepared`, `created`,
  `no_match`, `needs_input`, `approval_required`, `unsupported`.
- Routing guide line + tool description state: **Browser Lane is the canonical browser
  automation path**; use `coo_dispatch` to route browser/site/workflow requests through
  COO rules (and to create the routed Browser-Lane task).

### 2. Operator console surface (`src/daemon/console.ts`, Lanes settings tab)
- A "COO Dispatch" card under the existing Lanes panel with: objective `textarea`,
  domains input, project-path input, **Prepare** button.
- **Create Browser Lane task** button rendered/enabled only when the last prepared
  result is browser-safe (`status === "prepared" && lane === "browser"`).
- Renders: status, matched rule, lane, capability, reason, `auditId`, `taskId`.
- Talks to `POST /coo/dispatch` via the existing `api()` helper (Bearer token).
  Prepare → `{ text, domains, project }`; Create → adds `create:true, projectPath`.
- No secrets shown (the dispatch result never carries credentials; the echoed objective
  is the operator's own text).

### 3. Docs / copy
- The `coo_dispatch` tool description + `CAPABILITY_ROUTING_LINES` entry carry the
  "canonical browser automation path" statement (model-facing copy). No "Bee" names.

### 4. Process cleanup
- Tick the completed checkboxes in the two prior COO dispatch plan docs
  (`...coo-dispatch-bridge.md`, `...coo-dispatch-task-creation.md`). Doc-only; no
  behavior change.

## Tests (RED first)
- `formatCooDispatchResult` renders each status correctly and leaks no secret tokens.
- `coo_dispatch` is a registered lane tool (`isLaneTool` true; present in definitions
  with required `text`; gated on `browserbee`).
- `executeCooDispatch` with an injected runner: prepare → `prepared` browser result;
  `create:true` → `created` + `taskId`; non-browser/no_match/needs_input → never
  creates (runner create path not taken).
- Console source test: the Lanes panel contains the COO Dispatch inputs, Prepare +
  gated Create buttons, the `/coo/dispatch` call, and exposes no secret fields.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
