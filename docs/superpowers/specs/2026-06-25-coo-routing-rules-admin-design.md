# COO Routing Rules Admin Surface Design

> Date: 2026-06-25 · Status: draft awaiting operator approval · Topic: coo-routing-rules-admin
> Builds on the existing SQL-backed COO routing rule store, daemon CRUD routes, and Lanes-tab COO Dispatch surface.

## Problem

HiveMatrix already persists COO routing rules in `coo_routing_rules` and records changes in
`coo_routing_rule_history`. The daemon exposes these entries through:

- `GET /coo/routing-rules`
- `GET /coo/routing-rules/:id`
- `POST /coo/routing-rules`
- `DELETE /coo/routing-rules/:id`
- `GET /coo/routing-rules/:id/history`
- `POST /coo/routing-rules/seed`
- `POST /coo/routing-rules/resolve`

But the operator console only exposes COO Dispatch. There is no operator-facing way to
see the current COO database entries, inspect their match/action fields, or update them
without calling the API manually.

## Guardrails

- Treat "COO db entries" as the typed COO routing rules, not arbitrary SQL rows.
- Keep routes secret-free. Rules may store metadata, match conditions, policies, and notes,
  but not passwords, cookies, tokens, bearer strings, or Keychain material.
- Do not add arbitrary SQL editing or prompt-like rule editing.
- Preserve the existing store normalization: canonical lane ids on write, compatibility
  aliases accepted at boundaries.
- Keep dispatch behavior unchanged; this is an admin surface for the entries that dispatch
  already uses.
- No local-model code paths are touched, so `qwen-readiness` is not required for this slice.

## Existing Shape

`src/lib/coo/store.ts` already has the persistence operations we need:

- `listCooRoutingRules`
- `getCooRoutingRule`
- `upsertCooRoutingRule`
- `deleteCooRoutingRule`
- `listCooRoutingRuleHistory`
- `resolveCooRouteFromRules`
- `seedDefaultCooRoutingRules`

`src/lib/coo/routing-rules.ts` already validates the typed contract and rejects prompt-like
keys. The console can therefore use the existing daemon endpoints instead of adding a new
database abstraction.

## Options

### Option A: Read-only list in the Lanes tab

Show COO routing rules below COO Dispatch: name, enabled state, priority, lane, capability,
match phrases/domains, and notes. Include Seed defaults and Refresh.

Pros:
- Smallest change and low risk.
- Quickly exposes the hidden database entries.

Cons:
- Does not satisfy "allow updates."
- Operator still needs manual API calls to fix rules.

### Option B: Structured CRUD editor in the Lanes tab

Add a "COO routing rules" section below COO Dispatch with:

- Refresh and Seed defaults buttons.
- Rule cards sorted by priority, matching the backend order.
- Inline controls for common fields: enabled, name, priority, intent, lane, capability,
  backend policy, model posture, risk tier, notes.
- Text inputs for match arrays: phrases, domains, projects, workflows, tags.
- Textareas for JSON policy objects: constraints, approval policy, verification policy.
- Save, Duplicate, Delete, and View history actions.
- Resolve tester that reuses `POST /coo/routing-rules/resolve`.

Pros:
- Meets the request directly.
- Reuses the existing typed API and history table.
- Keeps rule edits structured and reviewable.

Cons:
- More console code and source-test coverage.
- JSON object textareas need careful validation/error display.

### Option C: Separate dedicated COO Rules tab

Create a new Settings subtab or top-level operator console page only for COO rules.

Pros:
- Cleaner long-term layout if COO routing grows.
- Avoids making the Lanes tab even denser.

Cons:
- More navigation and UI plumbing.
- Bigger slice than needed to expose/update the entries now.

## Recommended Design

Use **Option B**, but keep it as a focused MVP inside the existing Lanes settings tab.
The backend already exists; the missing piece is an operator-safe editor. A dedicated tab
can come later if the rules surface becomes large enough to deserve it.

## MVP Details

### Console UI

In `src/daemon/console.ts`, add a section after COO Dispatch and before Browser Lane
readiness:

- Header: "COO routing rules" with Refresh and Seed defaults buttons.
- Summary line with total rules, enabled rules, and the currently selected lane filter.
- Optional lane filter select: all, browser, mail, message, terminal, desktop, memory, review.
- Rule list rendered as compact cards.
- Each card has a details editor:
  - Basic fields: `id` (read-only for existing rules), `name`, `priority`, `enabled`, `intent`.
  - Route fields: `lane`, `capability`, `backendPolicy`, `modelPosture`, `riskTier`.
  - Match arrays as comma/newline-separated text.
  - JSON policy textareas for `constraints`, `approvalPolicy`, `verificationPolicy`.
  - `notes`.
  - Buttons: Save, Duplicate, Delete, History.
- New rule button creates an unsaved draft prefilled with safe defaults:
  - lane `browser`
  - capability `workflow.run`
  - backendPolicy `lane_owned_first`
  - modelPosture `mixed-local-first`
  - riskTier `normal`
  - enabled `true`
  - empty match arrays and policy objects

### API Usage

No new backend routes should be needed.

- List: `GET /coo/routing-rules`
- Save: `POST /coo/routing-rules` with `{ rule }`
- Delete: `DELETE /coo/routing-rules/:id`
- History: `GET /coo/routing-rules/:id/history`
- Seed: `POST /coo/routing-rules/seed`
- Resolve tester: `POST /coo/routing-rules/resolve`

### Validation

Client-side validation should catch obvious mistakes before POST:

- Required string fields: name, intent, lane, capability.
- Priority must be finite.
- JSON policy fields must parse to objects.
- Secret-looking text should be refused in UI before submit using the same rough token
  patterns used elsewhere: password, token, secret, cookie, bearer, api key.

Server-side validation remains authoritative through `normalizeCooRoutingRule`.

### Tests

Write failing tests before production changes:

- `scripts/coo-routing-rules-console.test.mjs`
  - Lanes settings source contains the COO routing rules section.
  - Contains calls to the existing list/save/delete/history/seed/resolve endpoints.
  - Contains lane/policy/risk controls.
  - Does not expose password/token/cookie/secret fields.
- `src/lib/coo/store.test.ts`
  - Add one focused regression if needed for optional UI behavior, for example duplicate/new
    rule id generation or history shape. Avoid duplicating existing store coverage.
- `src/daemon/server.test.ts`
  - Only add endpoint-level tests if current server coverage does not already protect
    error status behavior for rule updates/deletes.

## Verification

- `npm test -- scripts/coo-routing-rules-console.test.mjs`
- Focused COO store/server tests if changed.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`

## Approval Question

Approve Option B as the implementation direction?
