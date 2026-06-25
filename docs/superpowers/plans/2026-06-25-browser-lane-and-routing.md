# Browser Lane And COO Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Implement the first coherent Browser Lane slice in HiveMatrix:

- Replace user/model-facing BrowserBee/WebBee/Weaver browser concepts with Browser Lane / `hivematrix_browser`.
- Remove BrowserBee, WebBee, and Weaver as named components after a compatibility bridge.
- Add typed SQL-backed COO routing rules.
- Add Browser Lane site/readiness/trace schema.
- Add `hive browser` CLI skeleton.
- Add early Mac app scaffold for Browser Lane Console.
- Keep compatibility aliases so existing flows do not break during the rename.

## Constraints

- Use macOS Keychain only for browser secrets.
- Do not expose passwords, cookies, TOTP secrets, or bearer tokens to models, logs, traces, or docs.
- Do not expose raw Claude Chrome MCP / Codex Chrome MCP as normal browser tools.
- Keep old Bee names only as compatibility aliases during migration.
- Compatibility aliases are temporary; final verification must show BrowserBee, WebBee, and Weaver removed from active code paths.
- Follow TDD: each production change starts with a failing test.
- For Apple portal setup, use Computer Use only in an operator-assisted flow and stop on password/2FA.

## Task 1: Add Lane Naming Contracts

- [ ] Write failing tests in `src/lib/lanes/contracts.test.ts`.

Expected test coverage:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  LANE_IDS,
  normalizeLaneId,
  laneDisplayName,
  legacyCapabilityToLane,
} from "./contracts";

test("normalizes public lane ids and legacy bee capability ids", () => {
  assert.deepEqual([...LANE_IDS], ["browser", "desktop", "terminal", "mail", "message", "memory", "review"]);
  assert.equal(normalizeLaneId("Browser Lane"), "browser");
  assert.equal(laneDisplayName("browser"), "Browser Lane");
  assert.equal(legacyCapabilityToLane("browserbee"), "browser");
  assert.equal(legacyCapabilityToLane("webbee"), "browser");
  assert.equal(legacyCapabilityToLane("termbee"), "terminal");
});
```

- [ ] Implement `src/lib/lanes/contracts.ts`.
- [ ] Export typed lane IDs, display names, and legacy capability mapping.
- [ ] Run `npm test -- src/lib/lanes/contracts.test.ts`.

## Task 2: Add COO Routing Rule Contracts

- [ ] Write failing tests in `src/lib/coo/routing-rules.test.ts`.

Expected test coverage:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCooRoutingRule, resolveCooRoute } from "./routing-rules";

test("normalizes a browser workflow rule without prompt text", () => {
  const rule = normalizeCooRoutingRule({
    id: "rule_heygen",
    name: "HeyGen browser workflow",
    priority: 100,
    intent: "authenticated_browser_workflow",
    match: { domains: ["heygen.com"], phrases: ["browser", "HeyGen"] },
    lane: "browser",
    capability: "workflow.run",
    backendPolicy: "lane_owned_first",
    modelPosture: "local_first_frontier_on_failure",
    riskTier: "external_side_effect",
  });
  assert.equal(rule.lane, "browser");
  assert.equal(rule.capability, "workflow.run");
});

test("resolves highest-priority enabled route", () => {
  const route = resolveCooRoute({
    text: "Use the browser to upload this script to HeyGen",
    domains: ["app.heygen.com"],
  }, [
    normalizeCooRoutingRule({
      id: "low",
      name: "Generic browser",
      priority: 1,
      intent: "browser",
      match: { phrases: ["browser"] },
      lane: "browser",
      capability: "open",
    }),
    normalizeCooRoutingRule({
      id: "high",
      name: "HeyGen workflow",
      priority: 100,
      intent: "authenticated_browser_workflow",
      match: { domains: ["heygen.com"], phrases: ["HeyGen"] },
      lane: "browser",
      capability: "workflow.run",
    }),
  ]);
  assert.equal(route?.ruleId, "high");
});
```

- [ ] Implement `src/lib/coo/routing-rules.ts`.
- [ ] Keep matcher deliberately simple: phrases + domains + optional project/workflow tags.
- [ ] Reject arbitrary prompt blobs in routing rules.
- [ ] Run `npm test -- src/lib/coo/routing-rules.test.ts`.

## Task 3: Add Database Migrations For Lanes And Browser Lane

- [ ] Write failing tests in `src/lib/db/browser-lane-schema.test.ts`.

Expected assertions:

- `lane_providers` exists.
- `lane_capabilities` exists.
- `coo_routing_rules` exists.
- `coo_routing_rule_history` exists.
- `browser_sites` exists.
- `browser_credentials` exists and stores only `credentialRef`, never secret values.
- `browser_readiness_probes` exists.
- `browser_readiness_runs` exists.
- `browser_trace_runs` exists.
- `browser_trace_events` exists.

- [ ] Append migrations only in `src/lib/db/index.ts`; do not edit/reorder existing migrations.
- [ ] Add helper functions only if existing DB patterns support them.
- [ ] Run `npm test -- src/lib/db/browser-lane-schema.test.ts`.

## Task 4: Add Browser Lane Contracts

- [ ] Write failing tests in `src/lib/browser-lane/contracts.test.ts`.

Expected coverage:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBrowserSite,
  normalizeReadinessProbe,
  normalizeBrowserReadinessState,
} from "./contracts";

test("browser site stores keychain references but no secret values", () => {
  const site = normalizeBrowserSite({
    id: "heygen",
    displayName: "HeyGen",
    homeUrl: "https://app.heygen.com/home",
    loginUrl: "https://app.heygen.com/login",
    allowedDomains: ["app.heygen.com"],
    credentialRef: "hivematrix.browser.heygen.primary",
  });
  assert.equal(site.credentialRef, "hivematrix.browser.heygen.primary");
  assert.deepEqual(site.allowedDomains, ["app.heygen.com"]);
});

test("readiness states map to green yellow orange red semantics", () => {
  assert.equal(normalizeBrowserReadinessState("ready").color, "green");
  assert.equal(normalizeBrowserReadinessState("needs_reauth").color, "orange");
  assert.equal(normalizeBrowserReadinessState("probe_failed").color, "yellow");
  assert.equal(normalizeBrowserReadinessState("blocked").color, "red");
});
```

- [ ] Implement `src/lib/browser-lane/contracts.ts`.
- [ ] Add site, credential ref, probe, run, trace event, and readiness state types.
- [ ] Include explicit `secretValue?: never` style guard or runtime rejection for secret-looking keys.
- [ ] Run `npm test -- src/lib/browser-lane/contracts.test.ts`.

## Task 5: Add Mac Keychain Adapter Contract

- [ ] Write failing tests in `src/lib/browser-lane/keychain.test.ts` using an injectable mock command runner.

Expected behavior:

- Save username/password by site credential ref.
- Read credential only inside adapter API.
- Redact values in returned diagnostic output.
- Reject unsupported secret kinds.

- [ ] Implement `src/lib/browser-lane/keychain.ts`.
- [ ] Use macOS `security` CLI as the first implementation unless an existing native bridge is already present.
- [ ] Service name should be `HiveMatrix Browser Lane`.
- [ ] Account keys should be deterministic, for example `heygen:username` and `heygen:password`.
- [ ] Never log command output containing a secret.
- [ ] Run `npm test -- src/lib/browser-lane/keychain.test.ts`.

## Task 6: Add Browser Lane Tool Wrapper With Legacy Aliases

- [ ] Write failing tests in `src/lib/orchestrator/lane-tools.test.ts`.

Expected coverage:

- `hivematrix_browser` is advertised for browser work.
- `webbee_search` and `browserbee_run` are accepted as aliases but marked legacy.
- Routing guide says "Browser Lane" and does not say WebBee/BrowserBee.
- Claude/Codex Chrome MCP is not described as the default browser.

- [ ] Create `src/lib/orchestrator/lane-tools.ts` or refactor `src/lib/orchestrator/bee-tools.ts` in place with compatibility exports.
- [ ] Keep `availableBeeTools` / `executeBeeTool` wrappers temporarily if other code imports them.
- [ ] Add `availableLaneTools` / `executeLaneTool`.
- [ ] Map:
  - `webbee_search` -> `hivematrix_browser` with mode `search`.
  - `browserbee_run` -> `hivematrix_browser` with mode `workflow`.
  - `desktopbee_action` -> future `hivematrix_desktop` alias.
  - `termbee_run` -> future `hivematrix_terminal` alias.
- [ ] Run `npm test -- src/lib/orchestrator/lane-tools.test.ts src/lib/orchestrator/bee-tools.test.ts`.

## Task 7: Add `hive browser` CLI Skeleton

- [ ] Write failing tests in `src/lib/cli/browser.test.ts` for command parsing and JSON output.

Expected commands:

```bash
hive browser status --json
hive browser readiness run --all --json
hive browser sites list --json
hive browser sites add --json
hive browser trace latest --json
```

- [ ] Implement CLI parser in `src/lib/cli/browser.ts`.
- [ ] Add executable entrypoint `src/cli/hive.ts`.
- [ ] Add `bin` entry to `package.json` if appropriate:

```json
{
  "bin": {
    "hive": "./dist/cli/hive.js"
  }
}
```

- [ ] Keep commands returning deterministic JSON with stable exit codes.
- [ ] Run `npm test -- src/lib/cli/browser.test.ts`.

## Task 8: Add Browser Lane Readiness Service

- [ ] Write failing tests in `src/lib/browser-lane/readiness.test.ts`.

Expected behavior:

- Reads `browser_sites` and `browser_readiness_probes`.
- Produces green/yellow/orange/red readiness results.
- Treats CAPTCHA/2FA as `human_required`, not failure.
- Writes trace run and trace event records.
- Does not call credential adapter unless probe requires auth and site has an allowed credential ref.

- [ ] Implement `src/lib/browser-lane/readiness.ts`.
- [ ] Use a fake browser adapter interface for tests.
- [ ] Do not implement real CDP/agent-browser control in this task.
- [ ] Run `npm test -- src/lib/browser-lane/readiness.test.ts`.

## Task 9: Add Browser Adapter Interface

- [ ] Write failing tests in `src/lib/browser-lane/adapter.test.ts`.

Expected interface:

```ts
export interface BrowserLaneAdapter {
  open(input: OpenInput): Promise<OpenResult>;
  snapshot(input: SnapshotInput): Promise<PageSnapshot>;
  act(input: BrowserAction): Promise<BrowserActionResult>;
  screenshot(input: ScreenshotInput): Promise<ScreenshotResult>;
  close(input: CloseInput): Promise<CloseResult>;
}
```

- [ ] Implement `src/lib/browser-lane/adapter.ts`.
- [ ] Add `agent-browser` backend stub in `src/lib/browser-lane/adapters/agent-browser.ts`.
- [ ] Add Playwright/Chrome MCP as future backend enum values only, not implementations.
- [ ] Run `npm test -- src/lib/browser-lane/adapter.test.ts`.

## Task 10: Add Browser Lane Console App Scaffold

- [ ] Choose app scaffold path after checking existing desktop packaging:
  - Preferred if Tauri is the main app shell: `src-tauri/browser-lane/` or an app window route inside existing Tauri.
  - Preferred if SwiftUI helper path is cleaner: `browser-lane-app/Package.swift`.
- [ ] Write failing smoke test or build script test:
  - `scripts/verify-browser-lane-app.mjs`
  - confirms bundle id string, app display name, and required files exist.
- [ ] Add app metadata:
  - App name: `Hive Browser`
  - Bundle ID: `com.irvcassio.hivematrix.browserlane`
  - Team placeholder: Irv Cassio
- [ ] Add placeholder screens:
  - Sites dashboard.
  - Add Site.
  - Readiness detail.
  - Trace detail.
- [ ] Do not wire real credentials into UI yet.
- [ ] Run smoke test.

## Task 11: Add Apple Developer Portal Runbook

- [ ] Create `docs/runbooks/browser-lane-apple-provisioning.md`.
- [ ] Include exact target:
  - Team: Irv Cassio
  - Apple ID account: `cassio.irv@gmail.com`
  - Bundle ID: `com.irvcassio.hivematrix.browserlane`
  - App name: `Hive Browser`
- [ ] Include Computer Use instructions:
  - Stop at password prompt.
  - Stop at 2FA prompt.
  - Verify Team before creating anything.
  - Never echo credentials or codes.
- [ ] Include created artifact checklist:
  - Identifier created.
  - Capability choices recorded.
  - Development profile created if needed.
  - Distribution profile created if needed.
  - Profile downloaded path recorded without secret material.
- [ ] No tests required beyond doc review.

## Task 12: Add Scope Wall Updates

- [ ] Inspect `scripts/scope-wall.mjs`.
- [ ] Write failing scope-wall fixture/test if existing structure supports it.
- [ ] Update allowed component language:
  - Browser Lane replaces BrowserBee/WebBee/Weaver public names.
  - Legacy names allowed only in compatibility aliases and migration docs.
- [ ] Run `node scripts/scope-wall.mjs`.

## Task 13: Update Docs And Routing References

- [ ] Update `docs/MODEL-ROUTING.md`.
- [ ] Update `docs/superpowers/specs/2026-06-25-browser-auth-landscape-design.md` only if implementation decisions differ.
- [ ] Update component docs that mention BrowserBee/WebBee/Weaver as user-facing names.
- [ ] Keep old specs as historical records; do not rewrite historical decisions.
- [ ] Run `rg -n "BrowserBee|WebBee|Weaver|browserbee|webbee" docs src` and classify remaining hits as:
  - compatibility alias
  - historical spec
  - bug to fix

## Task 14: Remove BrowserBee/WebBee/Weaver Active Components

- [ ] Write failing tests that assert no active model-visible tools use removed names:
  - `src/lib/orchestrator/lane-tools.test.ts`
  - `src/lib/lanes/contracts.test.ts`
- [ ] Move or replace active BrowserBee code:
  - `src/lib/browserbee/contracts.ts` -> `src/lib/browser-lane/contracts.ts`
  - `src/lib/browserbee/contracts.test.ts` -> `src/lib/browser-lane/contracts.test.ts`
- [ ] Move or replace active WebBee code:
  - `src/lib/webbee/client.ts` -> `src/lib/browser-lane/fetch.ts` or `src/lib/browser-lane/web-read.ts`
- [ ] Delete active import paths once replacements compile:
  - `src/lib/browserbee/`
  - `src/lib/webbee/`
- [ ] Search for Weaver code or docs:
  - `rg -n "Weaver|weaver" .`
  - Delete or archive active Weaver code if present.
  - Historical docs may keep references only when clearly historical.
- [ ] Remove active tool names:
  - `browserbee_run`
  - `webbee_search`
  - any `weaver_*`
- [ ] Keep migration aliases only if they are hidden from model-visible tool definitions and covered by tests.
- [ ] Run `rg -n "browserbee_run|webbee_search|BrowserBee|WebBee|Weaver|src/lib/browserbee|src/lib/webbee" src docs`.
- [ ] Confirm remaining hits are historical specs or explicit migration notes only.

## Task 15: Verification Gate

- [ ] Run targeted tests from each task.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `node scripts/scope-wall.mjs`.
- [ ] If local-model routing files changed, run `npx tsx scripts/qwen-readiness.mts`.
- [ ] Produce a short implementation report:
  - What public names changed.
  - Which aliases remain.
  - Which DB migrations were added.
  - How to run the Browser Lane CLI.
  - What is intentionally stubbed.

## Risks And Non-Negotiables

- Do not let direct Chrome MCP leak back into normal model tool profiles.
- Do not put secrets in SQLite.
- Do not build arbitrary SQL/prompt editing as COO routing.
- Do not try to remove every old Bee filename before compatibility tests are green.
- Do not spend app effort on polish before readiness, Keychain refs, and trace basics work.
