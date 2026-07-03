# First-Run Setup Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Design Reference

- `docs/superpowers/specs/2026-07-03-first-run-setup-reliability-design.md`

## Goal

Make the first-run wizard truthful and complete for a new HiveMatrix install:

- Do not infer raw macOS permission status from optional lane readiness.
- Provide explicit check/request actions for Full Disk Access, Desktop Control, Mail Automation, and Microphone.
- Surface local model provisioning and persona/birth ritual in first-run setup.
- Preserve passive `/onboarding` behavior for ordinary dashboard refreshes.

## Execution Status — 2026-07-03

- Implemented Tasks 1-8.
- Focused setup coverage passed:
  - `node --import tsx/esm --test --test-name-pattern "GET /onboarding/setup|POST /onboarding/setup|full disk access grant|desktop control reports|mail automation is not requested|microphone opened|local model provisioning|onboarding wizard|console browser script" src/lib/onboarding/setup-status.test.ts src/daemon/server.test.ts src/daemon/console.test.ts`
- Repo gates passed:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
- Local daemon build passed:
  - `npm run build:daemon`
  - `npm run verify:daemon-runtime`
- Qwen live readiness gate attempted but blocked because this Mac has no `~/.hivematrix/config.json` and therefore no Qwen profile for `scripts/qwen-readiness.mts` to read.
- Signed app release/autodeploy blocked because `~/.hivematrix/tauri-updater.key`, `~/.hivematrix/tauri-updater.key.password`, and the notarytool Keychain item `com.apple.gke.notary.tool.saved-creds.hivematrix` are missing.
- Live updater feed checked: GitHub latest is `0.1.123` at source commit `810c069641ef382913f43fb1a8c5cecc03a4ae19`. That matches the current repository HEAD before these uncommitted setup fixes, so the public update feed does not yet contain this work.

## Task 1 — RED: Pure First-Run Setup Status Model

- [ ] Add failing tests in `src/lib/onboarding/setup-status.test.ts`.
- [ ] Assert the model separates raw setup from optional lane readiness.
- [ ] Assert Full Disk Access can be `granted` from an explicit chat.db probe even when Message Lane is disabled.
- [ ] Assert Desktop Control reports helper reachability separately from permission grants.
- [ ] Assert Mail Automation says `not_requested` when passive and `granted` after an explicit probe.
- [ ] Assert Microphone never reports `granted` from `opened` alone.
- [ ] Assert local model provisioning and persona state appear as setup sections.

Test skeleton:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildFirstRunSetupStatus } from "./setup-status";

test("full disk access grant is independent from Message Lane enablement", () => {
  const status = buildFirstRunSetupStatus({
    onboarding: {
      requiredComplete: false,
      allComplete: false,
      generatedAt: "T",
      steps: [
        { id: "messagebee", title: "Message Lane", required: false, state: "incomplete", detail: "Message Lane disabled" },
      ],
    },
    fullDiskAccessProbe: {
      enabled: false,
      chatDbReadable: true,
      chatDbDetail: "Messages database readable",
      chatDbProbeSkipped: false,
      identities: [],
    },
  });
  const row = status.permissions.find((p) => p.id === "fullDiskAccess")!;
  assert.equal(row.state, "granted");
  assert.match(row.detail, /Messages database readable/);
});

test("microphone opened is not represented as granted", () => {
  const status = buildFirstRunSetupStatus({ microphoneOpened: true });
  const row = status.permissions.find((p) => p.id === "microphone")!;
  assert.equal(row.state, "opened");
  assert.match(row.detail, /request.*first Talk Mode/i);
});
```

- [ ] Run:

```bash
npm test -- src/lib/onboarding/setup-status.test.ts
```

Expected RED: module does not exist.

## Task 2 — GREEN: Implement First-Run Setup Status Model

- [ ] Add `src/lib/onboarding/setup-status.ts`.
- [ ] Export:

```ts
export type SetupItemState =
  | "unknown"
  | "not_requested"
  | "opened"
  | "needs_action"
  | "granted"
  | "configured"
  | "ready";

export interface SetupItem {
  id: string;
  title: string;
  state: SetupItemState;
  detail: string;
  action?: string;
}

export interface FirstRunSetupStatus {
  permissions: SetupItem[];
  models: SetupItem[];
  memory: SetupItem[];
  optional: SetupItem[];
  requiredReady: boolean;
}
```

- [ ] Implement `buildFirstRunSetupStatus(input)` as a pure mapper over:
  - `OnboardingStatus`
  - optional explicit `MessagebeeStatus`
  - optional explicit `MailbeeStatus`
  - optional Desktop helper permission snapshot
  - optional local engine provision plan/status
  - optional persona status
  - `microphoneOpened`
- [ ] No filesystem, network, or child process calls in this module.
- [ ] Run:

```bash
npm test -- src/lib/onboarding/setup-status.test.ts
```

Expected GREEN.

## Task 3 — RED: Server Setup Endpoint and Explicit Probe Routing

- [ ] Add tests in `src/daemon/server.test.ts`.
- [ ] Preserve existing passive `/onboarding` tests.
- [ ] Add a test for `GET /onboarding/setup`:
  - returns setup sections
  - does not call disabled Message Lane or Mail Lane probes
- [ ] Add a test for `POST /onboarding/setup/full-disk-access/probe`:
  - calls the Message Lane chat.db probe even when Message Lane is disabled
  - returns a permission row with `state: "granted"` when readable
- [ ] Add a test for `POST /onboarding/setup/mail-automation/probe`:
  - calls the explicit Mail Automation probe
  - returns a permission row with `state: "granted"` when controllable
- [ ] Add a test for `POST /onboarding/setup/desktop-permissions/request`:
  - dispatches `desktop.permissions` with `{ prompt: true }`
  - returns Desktop Control permission detail

Example assertion:

```ts
assert.equal(body.permissions.find((p) => p.id === "mailAutomation")?.state, "granted");
```

- [ ] Run:

```bash
npm test -- src/daemon/server.test.ts
```

Expected RED: routes do not exist.

## Task 4 — GREEN: Implement Server Setup Routes

- [ ] Edit `src/daemon/server.ts`.
- [ ] Add helper code near `GET /onboarding` to build the setup status without mutating state.
- [ ] Add routes:
  - `GET /onboarding/setup`
  - `POST /onboarding/setup/full-disk-access/probe`
  - `POST /onboarding/setup/mail-automation/probe`
  - `POST /onboarding/setup/desktop-permissions/request`
- [ ] Reuse existing modules:
  - `getMessagebeeStatus({ probe: true })`
  - `getMailbeeStatus({ probe: true })`
  - `probeDesktopBeeHelper()`
  - `dispatchDesktopBeeAction({ action: "desktop.permissions", params: { prompt: true } })`
  - `planLocalEngine()` / `getProvisionStatus()`
  - `getPersonaStatus()`
- [ ] Keep `GET /onboarding` unchanged in passive behavior.
- [ ] Run:

```bash
npm test -- src/daemon/server.test.ts
```

Expected GREEN.

## Task 5 — RED: Console Wizard Uses Setup Model, Not Regex Detail Guesses

- [ ] Add/extend assertions in `src/daemon/console.test.ts`.
- [ ] Assert the first-run wizard fetches `/onboarding/setup`.
- [ ] Assert it calls explicit probe routes for Full Disk Access, Mail Automation, and Desktop permissions.
- [ ] Assert it no longer uses regexes like `chat\.db readable|enabled; reading` to infer Full Disk Access.
- [ ] Assert it exposes local engine provisioning and birth ritual controls in the first-run wizard.
- [ ] Assert Microphone copy says it can be opened/requested but is not marked granted by localStorage alone.

Run:

```bash
npm test -- src/daemon/console.test.ts
```

Expected RED.

## Task 6 — GREEN: Wire Console Wizard to Setup Model

- [ ] Edit `src/daemon/console.ts`.
- [ ] Add `state.firstRunSetup` or equivalent.
- [ ] Add `loadFirstRunSetup()` that calls `/onboarding/setup`.
- [ ] Change `_obPollPerms()` to render permission rows from setup status instead of onboarding detail regexes.
- [ ] Add user-initiated functions:
  - `obCheckFullDiskAccess()`
  - `obRequestDesktopPermissions()`
  - `obProbeMailAutomation()`
  - `obOpenPermMic()` should mark `opened`, not `granted`.
- [ ] In the Model Backends step:
  - Show local engine plan/provision status from `/onboarding/setup`.
  - Add a one-click `Provision Rapid-MLX` action that reuses `/local-engine/provision`.
  - Keep manual LM Studio endpoint connect as advanced/fallback.
- [ ] In the Brain step:
  - After brain root is set, show birth ritual state.
  - Add a `Run birth ritual` button wired to existing `/onboarding/birth-ritual`.
  - For this first implementation, it is acceptable to show ritual SSE output as plain status text.
- [ ] Run:

```bash
npm test -- src/daemon/console.test.ts
```

Expected GREEN.

## Task 7 — Review: Spec Compliance

- [ ] Review the diff against `docs/superpowers/specs/2026-07-03-first-run-setup-reliability-design.md`.
- [ ] Confirm:
  - raw permission status is separate from lane readiness
  - passive `/onboarding` behavior is preserved
  - local model setup is represented
  - persona setup is represented
  - optional lanes do not block required setup

## Task 8 — Review: Code Quality

- [ ] Check for:
  - no TCC database edits
  - no auto-launching Mail on passive refresh
  - no repeated expensive probes in polling loops
  - no brittle status regexes
  - small pure model with explicit types
  - clear UI copy for unknown/not requested/opened/granted states

## Task 9 — Verification Gates

- [ ] Run focused tests:

```bash
npm test -- src/lib/onboarding/setup-status.test.ts src/daemon/server.test.ts src/daemon/console.test.ts
```

- [ ] Run repo gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
npx tsx scripts/qwen-readiness.mts
```

Because this touches local-model setup, the Qwen readiness gate is required.

## Task 10 — Build/Release Decision

- [ ] If all gates pass, build the current app if requested by the operator or needed for release validation.
- [ ] If publishing is requested, use the existing release flow:

```bash
npm run autodeploy
```

- [ ] Verify the live feed with:

```bash
npm run release:verify
```
