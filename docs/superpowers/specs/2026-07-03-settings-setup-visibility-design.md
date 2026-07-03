# Settings Setup And Model Availability Design

## Context

The first-run setup reliability work already added a richer setup model and routes:

- `GET /onboarding/setup`
- `POST /onboarding/setup/full-disk-access/probe`
- `POST /onboarding/setup/mail-automation/probe`
- `POST /onboarding/setup/desktop-permissions/request`

The console also has a first-run wizard modal in `src/daemon/console.ts` that uses those routes for permissions, local model setup, and persona setup.

The first problem is discoverability. The Settings modal does not have a dedicated Setup tab. It only shows a small Setup summary in Settings -> About:

- When required setup is incomplete, the summary tells the operator to see the dashboard Setup panel.
- When required setup is complete, the dashboard Setup panel is hidden entirely.
- The full setup wizard remains implemented, but Settings does not provide an obvious setup surface.

That matches the operator report: "HiveMatrix setting screen does not show setup."

The second problem is model availability. Settings should work correctly across all real install states:

- no model backend installed yet
- Claude Code CLI only
- Codex CLI only
- Claude and Codex both installed
- local model only
- local plus one or both frontier CLIs

The core model catalog already supports these states in `src/lib/models/available.ts`, but the Settings UI is less explicit:

- `openSettings()` returns early if `/models` has not loaded yet, which can leave Settings partially blank.
- The default model selector can render empty when no models are configured.
- The frontier-provider control only appears when both Claude and Codex are configured, so Claude-only or Codex-only installs do not clearly show which provider will be used.
- Mixed-mode role controls are hidden unless a local+frontier `mixed` posture exists, which is correct for role overrides, but Settings still needs clear provider status in frontier-only mode.

## Goals

1. Make setup visible and actionable from the Settings screen.
2. Reuse the existing first-run wizard and `/onboarding/setup` model.
3. Make Settings robust whether zero, one, or multiple model backends are configured.
4. Clearly show Claude-only, Codex-only, and Claude+Codex frontier states.
5. Keep the dashboard rail behavior unchanged unless needed for consistency.
6. Keep this change UI-only: no local model backend, Qwen profile, or setup-status semantics changes.

## Non-Goals

- Do not redesign first-run setup.
- Do not change passive `/onboarding` behavior.
- Do not make optional lanes required.
- Do not add new setup probes or local-model provisioning behavior.

## Approaches

### Approach A: Add a Setup Button to About

Keep Settings tabs unchanged. Add a visible button under the existing About -> Setup summary:

- `Open setup wizard`
- It calls `openObWizard()`.

Pros:

- Smallest change.
- Uses existing wizard unchanged.
- Low test surface.

Cons:

- Setup remains buried under About.
- The operator's complaint says the Settings screen does not show setup; a button under About may still feel hidden.

### Approach B: Add a Dedicated Settings -> Setup Tab

Add a `Setup` tab near the front of Settings. The tab contains:

- Current setup summary.
- `Open setup wizard` action.
- A compact list of required onboarding steps and their states.
- A compact list of optional setup steps.

Pros:

- Setup is obvious in Settings.
- Reuses existing setup and onboarding data.
- Minimal behavior change, but directly solves discoverability.

Cons:

- Adds one more tab to an already busy Settings modal.

### Approach C: Embed the Full Wizard Inline in Settings

Move or duplicate the wizard controls directly into Settings -> Setup.

Pros:

- Everything lives in one place.

Cons:

- Highest duplication risk.
- Harder to keep modal wizard and Settings state in sync.
- Larger UI change than the bug requires.

### Approach D: Make Settings Model Hydration Defensive

Keep the existing model catalog and backend detection, but make the Settings modal render meaningful controls in every backend state:

- If `/models` is not loaded when Settings opens, load it before populating controls.
- If no models are configured, disable the default model selector and show `(no models configured)`.
- If exactly one frontier CLI is configured, show the frontier provider row as a read-only selected provider.
- If both frontier CLIs are configured, show the provider selector as editable.
- Keep role-model overrides visible only when the `mixed` posture exists.

Pros:

- Solves the Claude-only / Codex-only / both case without backend churn.
- Preserves existing catalog tests.
- Keeps role-model complexity out of frontier-only installs.

Cons:

- Settings needs a small renderer helper to avoid repeating null guards.

## Recommendation

Use Approach B plus Approach D.

Add a dedicated `Setup` tab immediately after `About`, and keep the existing modal wizard as the detailed setup experience. The Settings tab should be a launchpad and status surface, not a second implementation of the setup flow.

Make the Settings model renderer defensive and explicit. The backend catalog already knows what is installed; the UI should reflect it without blank controls.

## Proposed UI

Settings tabs:

```text
About | Setup | Features | Personalization | Models | Observability | Lanes | Remote | License
```

Settings -> Setup:

- Summary text:
  - `Required setup complete.`
  - or `N required steps remaining.`
- Primary action:
  - `Open setup wizard`
- Required steps:
  - rows from `state.onboarding.steps` where `required === true`
- Optional setup:
  - rows from `state.onboarding.steps` where `required === false`

The existing About -> Setup summary can stay, but it should point to Settings -> Setup instead of the dashboard rail.

Settings -> Models:

- Default model:
  - If at least one model exists, selectable as today.
  - If none exist, disabled with `(no models configured)`.
- Backends:
  - Always show Local server, Claude Code, and Codex cards.
  - Missing backends show their install/connect guidance.
- Frontier provider:
  - Hidden only when no frontier backend is configured.
  - Read-only when exactly one of Claude or Codex exists.
  - Editable when both exist.
- Mixed-mode role models:
  - Still shown only when `models.available` contains `mixed`.

## Test Strategy

Add focused assertions in `src/daemon/console.test.ts`:

- Settings HTML includes `tab-setup` and `settingsSetup`.
- Settings tab order includes `setup` immediately after `about`.
- `switchSettingsTab("setup")` renders setup state.
- Settings -> Setup includes an `Open setup wizard` action wired to `openObWizard()`.
- About setup summary points to Settings -> Setup rather than the dashboard rail.
- `openSettings()` attempts `loadModels()` when Settings is opened before models are loaded.
- The default model selector renders a disabled `(no models configured)` option when no models are available.
- The frontier provider row appears for one or two frontier CLIs, disables the selector for one CLI, and remains editable for both.

Then run:

```bash
npm test -- src/daemon/console.test.ts
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

No Qwen readiness gate is required because this is a console UI visibility change and does not touch local-model implementation files.

## Open Question

Should clicking the Settings gear default to the new Setup tab when required setup is incomplete, or should Settings continue opening on About and let the visible Setup tab carry discovery?

Recommendation: keep Settings opening on About to avoid surprising existing users, but make About include a button/link to open the Setup tab.
