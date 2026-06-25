# COO Route-to-Execution Bridge — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: coo-dispatch-bridge
> Builds on commit `e5c4325` (SQL-backed COO routing rules + Browser Lane readiness dashboard).

## Problem

COO routing can already **resolve** a request to a `(lane, capability, policy)` via
`resolveCooRouteFromRules` (SQL-backed, canonical lane ids). Nothing yet turns a
resolved route into **execution**. We need the first route-to-execution bridge:
take a request, resolve it, and produce a *safe lane execution envelope* — and for
the Browser Lane specifically, a Browser-Lane-ready work item built from the
existing lane abstractions.

## Non-goals / guardrails (explicit)

- **No destructive Bee→Lane cleanup.** No persisted `WorkerKind` value flips, no
  `DesktopBeeHelper.app` rename, no `src/lib/<x>bee/` module sweeps. Compatibility
  ids stay intact. (See `2026-06-25-bee-to-lane-destructive-migration-design.md`.)
- **No silent risky actions.** Desktop, Mail, Message, and Terminal lanes must be
  explicit about their approval/trust requirement and must NOT perform anything.
- **No secrets in responses or logs.** The bridge never resolves or embeds
  credential values, cookies, or Keychain material. Browser work items carry only
  objective/url/steps; the lane resolves credentials later via `credentialRef`
  indirection, outside this bridge.
- **Prefer envelopes over actions.** For MVP, dispatch *prepares* a work
  envelope/work item rather than executing. Browser is the one "executable" lane,
  but "executable" here means it produces a Browser-Lane-ready work item — actual
  engine/backing selection and task execution stay in the existing
  `executeBrowserBeeRun` path. The bridge does not POST `/tasks` itself in this
  slice (no side effects → fully unit-testable; task creation is a clean follow-up).

## Design

New module `src/lib/coo/dispatch.ts`:

```
dispatchCooRequest(request: CooDispatchRequest): CooDispatchResult
```

1. `resolveCooRouteFromRules(request)` (unchanged; behavior-compatible).
2. No match → `status: "no_match"` (a disabled rule never resolves, so it also
   yields `no_match`).
3. Matched → consult a per-lane dispatch policy + the rule's `riskTier`:

   | Lane                     | Policy mode        | Result status        |
   |--------------------------|--------------------|----------------------|
   | browser                  | executable         | `prepared` (build work item) or `needs_input` (no URL derivable) |
   | mail, message, desktop, terminal | approval_required | `approval_required` |
   | memory, review           | unsupported        | `unsupported` (no bridge yet) |

   **Risk escalation:** if the matched rule's `riskTier` is `sensitive` or
   `destructive`, the result is forced to `approval_required` regardless of lane —
   a browser rule flagged sensitive will not auto-prepare.

4. Browser work item: derive `objective = request.text`, `startUrl` from the first
   request domain (`https://<domain>`), `project = request.project ?? "hive"`,
   `requiresLogin = capability === "workflow.run"`. Validate/normalize through the
   existing `parseBrowserBeeJobCreate`, wrap with `buildBrowserBeeTaskRequestEnvelope`
   (pure; default `codex_computer_use` backing — engine is re-decided at real
   execution time). If no domain/url can produce a valid `startUrl`, return
   `needs_input` with a clear reason rather than a half-built job.

### Result shape

```ts
type CooDispatchStatus =
  | "no_match" | "prepared" | "approval_required" | "unsupported" | "needs_input";

interface CooDispatchResult {
  status: CooDispatchStatus;
  request: CooDispatchRequest;            // echoed (no secret fields accepted)
  route: CooResolvedRouteWithDisplay | null;
  lane: LaneId | null;
  capability: string | null;
  workItem: { envelopeId: string; lane: "browser"; capability: string;
              envelope: BrowserBeeTaskRequestEnvelope } | null;
  approval: { required: boolean; trust: string } | null;
  reason: string;                         // refusal / approval / needs-input explanation
  auditId: string | null;
}
```

### Audit

Append-only table `coo_dispatch_audit` (new additive migration; no edits to existing
migrations). Records: request text + sanitized context, matched ruleId/ruleName,
lane/capability, status, workItemId (envelopeId if any), reason, createdAt. Answers
"what was asked, what rule matched, where it routed, what got created, why
refused/held." `listCooDispatchAudit(limit)` orders by `createdAt DESC, rowid DESC`
(monotonic tiebreak — `_id` is a random UUID).

## Daemon

`POST /coo/dispatch` — body `{ text, domains?, project?, workflow?, tags? }` →
`{ ok: true, result }`. `POST /coo/routing-rules/resolve` is unchanged.
`GET /coo/dispatch/audit?limit=` exposes the audit trail.

## Tests (RED first)

- successful browser dispatch → `prepared`, lane `browser`, work item present, valid startUrl.
- no-match → `no_match`, no work item.
- disabled rule → request that would match a disabled rule resolves to `no_match`.
- legacy lane alias → rule stored with `lane: "browserbee"` dispatches as canonical `browser`.
- approval-required lane (mail/message/desktop/terminal) → `approval_required`, no action, clear trust note.
- (bonus) risk escalation → a `sensitive` browser rule → `approval_required`.
- audit row persisted with rule + lane + status + reason; no secret fields.

## Verification

`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
