# First-Run Setup Reliability Design

## Context

Screenshots from July 3, 2026 show the first-run wizard stuck on the System Permissions step even after the relevant macOS Privacy & Security panes already contain granted entries:

- Full Disk Access shows `HiveMatrix` enabled, but the wizard still shows Full Disk Access unchecked.
- Screen & System Audio Recording shows `DesktopBeeHelper` enabled and `Hive` enabled, but the wizard still shows Accessibility + Screen Recording unchecked.
- Microphone shows `Codex`, `Google Chrome`, and `Microsoft Teams`, not `HiveMatrix`; the wizard marks Microphone based only on the user having opened the pane.
- Automation is empty, which is expected until a process actually asks macOS to control another app. The wizard currently asks the user to open Mail.app, but it does not actively trigger the Apple Events permission request.

The setup rail behind the modal also shows additional missing setup states:

- `Configuration file`
- `Local model (Rapid-MLX)`
- `Background daemon`
- `Persona (birth ritual)`
- `Frontier model access`
- `Desktop Lane`
- `Message Lane`
- `Mail Lane`
- `Anonymous usage stats`

The current release line is `0.1.123` (`BUILD_NUMBER = 667`, `BUILD_DATE = "2026-07-03"`). The current source does not yet fully handle these first-run setup issues.

## Current Implementation Findings

The first-run modal lives in `src/daemon/console.ts`.

The modal's permission polling uses `GET /onboarding` and derives permission marks indirectly:

- Full Disk Access is inferred from the optional `messagebee` step detail matching `chat.db readable`.
- Accessibility + Screen Recording is inferred from the optional `desktopbee` step being `done`, which requires helper built, helper reachable, and both helper-reported permissions true.
- Automation is inferred from the optional `mailbee` step detail matching `Mail controllable`.
- Microphone is not probed; it is marked complete only when `localStorage.hm_ob_mic_opened === "1"`.

The onboarding backend lives in `src/lib/onboarding/onboarding.ts` and `src/lib/onboarding/actions.ts`.

Important constraints already in tests:

- `GET /onboarding` is intentionally passive for Mail Lane when Mail Lane is disabled.
- `GET /onboarding` is intentionally passive for Message Lane when Message Lane is disabled.
- Explicit probe endpoints exist for Message Lane and Mail Lane so the UI can run a user-initiated probe without making the passive dashboard prompt macOS.

## Problem

The wizard mixes three different concepts into one visual checkbox:

1. The user opened a Settings pane.
2. macOS granted the relevant TCC permission to the relevant binary.
3. The full feature/lane is configured and operational.

That creates false negatives and confusing guidance on new installs:

- Full Disk Access can be granted to `HiveMatrix` while Message Lane remains disabled or unallowlisted; the wizard still shows the permission as missing.
- Screen Recording can be granted to `DesktopBeeHelper`, but the wizard may still show unchecked if the helper is not running/reachable.
- Microphone cannot be accurately represented as granted if HiveMatrix has never triggered the microphone permission prompt.
- Automation will not list HiveMatrix until HiveMatrix actually attempts an Apple Events operation against Mail; opening the pane alone cannot create the row.
- Local model setup is manual endpoint entry, even though the repo already has a hardware-aware Rapid-MLX provisioner and status model.
- Persona setup exists as `/onboarding/birth-ritual`, but the first-run modal does not surface it as a first-class step.

## Goals

1. Make the first-run setup wizard truthful: distinguish "opened", "permission granted", and "feature configured".
2. Fix the screenshots' concrete false negatives for Full Disk Access and Desktop Lane permissions.
3. Provide explicit user-initiated probes for TCC surfaces that cannot be passively checked without prompting macOS.
4. Make the wizard cover everything a new install will run into:
   - install location / daemon
   - system permissions
   - model backend setup, including hardware-aware local model provisioning
   - brain root
   - persona/birth ritual
   - optional lanes and usage stats
5. Preserve passive `/onboarding` behavior for Mail and Message lanes.
6. Keep all implementation TDD-first.

## Non-Goals

- Do not edit the macOS TCC database directly.
- Do not claim a permission is granted if the app cannot prove it.
- Do not make optional lanes required for first-run completion.
- Do not require a local model on hardware that cannot run one.
- Do not run expensive model downloads or Apple Events probes automatically on every dashboard refresh.

## Approaches

### Approach A: Copy-Only Wizard Clarification

Keep the current status mechanics and rewrite the UI copy to explain that each checkbox reflects feature readiness, not the raw macOS permission.

Pros:

- Smallest change.
- Low risk.

Cons:

- Does not fix false negatives from the screenshots.
- Still leaves Microphone and Automation as confusing dead ends.
- Does not improve local model or persona setup.

### Approach B: Add a Dedicated Setup Capability Model

Introduce a first-run setup model separate from `OnboardingStep` feature readiness. It can report individual setup items with states such as:

- `unknown`
- `not_requested`
- `opened`
- `granted`
- `needs_action`
- `configured`
- `ready`

Use it to render the modal while preserving existing `/onboarding` feature readiness for the dashboard rail.

Implementation shape:

- Add a pure setup-status module that composes:
  - current onboarding required steps
  - explicit lane status
  - Desktop Lane helper permission snapshot when reachable
  - Message Lane explicit chat.db probe only after the user requests it
  - Mail Lane explicit Automation probe only after the user requests it
  - local engine plan/provision status
  - birth ritual status
- Add explicit POST actions for:
  - prompting Desktop Lane helper permissions
  - probing Full Disk Access on demand
  - triggering Apple Mail Automation prompt on demand
  - microphone check/prompt where possible through the Tauri app, or a clear `opened/needs first voice session` state when not possible from the daemon
  - starting local engine provisioning
  - running birth ritual
- Render setup wizard from this richer state rather than regexes over feature detail strings.

Pros:

- Correctly separates raw setup from lane readiness.
- Preserves passive onboarding tests.
- Scales to local model and persona setup.
- Gives new users a single reliable path.

Cons:

- More files and tests.
- Needs careful UI scope to avoid a sprawling wizard.

### Approach C: Fold Everything Into Existing `OnboardingStep`

Extend `OnboardingStep` with setup sub-checks and keep one `/onboarding` endpoint.

Pros:

- Fewer endpoints.
- Reuses existing data path.

Cons:

- Risks breaking passive `/onboarding` constraints.
- Makes the rail and modal carry different meanings through the same fields.
- Harder to keep optional lanes from looking required.

## Recommendation

Use Approach B.

The screenshots show the modal is not wrong because one string is stale; it is wrong because it is using feature readiness as a proxy for raw macOS setup. A dedicated setup capability model lets the UI show:

- "Full Disk Access granted; Message Lane still needs channel + allowlist."
- "Desktop Lane helper running; Screen Recording granted; Accessibility still needs grant."
- "Automation not requested yet; click Probe Mail Automation to make macOS show HiveMatrix in the Automation list."
- "Microphone not requested by HiveMatrix yet; start Talk Mode or run the app-level microphone prompt."
- "Local model: this Mac can run fast + coding tiers; click Provision Rapid-MLX."
- "Persona: brain configured, birth ritual not run."

## Proposed User Flow

### Step 1: Mac Permissions

Each row should have a status and one or two actions:

- Full Disk Access
  - `Open Settings`
  - `Check now`
  - If chat.db probe succeeds: `Granted`.
  - If probe fails: show the structured reason and explain whether to add `HiveMatrix`, restart, or enable Message Lane later.

- Desktop Control
  - `Install/Start Helper`
  - `Request Permissions`
  - `Open Accessibility`
  - `Open Screen Recording`
  - Use `desktop.permissions` with `prompt: true` only from the user's click.

- Mail Automation
  - `Open Mail`
  - `Request Automation`
  - `Open Automation`
  - Keep passive `/onboarding` quiet; only the clicked probe may launch/probe Mail.

- Microphone
  - Prefer an app-level microphone prompt if Tauri exposes one.
  - Otherwise label honestly as `Open settings; HiveMatrix will request this on first Talk Mode`.
  - Do not show a green `Granted` merely because settings opened.

### Step 2: Models

Show three choices:

- Claude Code CLI
- Codex CLI
- Local model

For local model:

- Show hardware plan from `planLocalEngine()`.
- If local-capable: `Provision Rapid-MLX` starts the background provisioner and streams/polls progress.
- If not local-capable: offer `Cloud-only` and mark local model satisfied.
- Keep manual LM Studio endpoint entry as an advanced option.
- After provisioning, run or link to the Qwen readiness gate for local-model changes.

### Step 3: Brain + Persona

Use the existing brain root setup, then immediately show the birth ritual:

- If persona exists: greet by name/sigil.
- If missing: `Run birth ritual`.
- If the brain root is missing: keep birth ritual blocked with a clear reason.

### Optional Setup

After required setup, present optional lane cards:

- Message Lane
- Mail Lane
- Desktop Lane readiness
- Anonymous usage stats

These should be visible but not block finishing.

## Test Strategy

Because this touches local-model setup paths, final verification must include the local-model readiness gate in addition to the normal gates.

Focused tests:

- `src/lib/onboarding/setup-status.test.ts`
  - raw permission rows do not require optional lane enabled state
  - explicit probe results distinguish `granted` from `configured`
  - local engine plan produces correct local-capable/cloud-only guidance
  - persona row is blocked until brain root exists

- `src/daemon/server.test.ts`
  - passive `GET /onboarding` stays passive
  - new explicit setup probe endpoints may call Mail/chat.db/Desktop helper only when requested

- `src/daemon/console.test.ts`
  - wizard no longer regexes feature detail strings to infer permission grants
  - wizard has separate actions for check/probe/request
  - local model provision and birth ritual are present in first-run wizard

- Existing tests:
  - `src/lib/onboarding/onboarding.test.ts`
  - `src/lib/onboarding/actions.test.ts`
  - `src/lib/models/provision.test.ts`
  - `src/lib/onboarding/birth-ritual.test.ts`

Full gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
npx tsx scripts/qwen-readiness.mts
```

## Open Question

Should the first-run wizard consider `HiveMatrix` having Full Disk Access enough to mark the raw permission row granted, even when Message Lane remains disabled/unallowlisted, or should it only mark granted after an explicit `chat.db` readability check succeeds?

Recommendation: use the explicit readability check. macOS TCC listings are not reliably queryable from the daemon, and readability is the operational proof the app needs.
