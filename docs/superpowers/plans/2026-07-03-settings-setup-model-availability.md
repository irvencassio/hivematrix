# Settings Setup And Model Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Design Reference

- `docs/superpowers/specs/2026-07-03-settings-setup-visibility-design.md`

## Goal

Make HiveMatrix Settings work correctly when setup is incomplete and across model backend states:

- no model backend installed yet
- Claude only
- Codex only
- Claude and Codex both
- local only
- local plus one or both frontier CLIs

## Task 1 — RED: Settings Setup Tab And Model Availability Tests

- [ ] Edit `src/daemon/console.test.ts`.
- [ ] Add assertions that Settings includes a dedicated Setup tab and panel.
- [ ] Add assertions that Settings tab order is `about`, `setup`, then the existing tabs.
- [ ] Add assertions that Settings -> Setup has an `Open setup wizard` action wired to `openObWizard()`.
- [ ] Add assertions that About setup text points to Settings -> Setup rather than the dashboard rail.
- [ ] Add assertions that `openSettings()` loads `/models` if Settings opens before `models` is populated.
- [ ] Add assertions that empty model lists render a disabled `(no models configured)` default selector.
- [ ] Add assertions that frontier provider controls handle one or both frontier CLIs.

Run:

```bash
npm test -- src/daemon/console.test.ts
```

Expected RED: Setup tab/helper and defensive model renderer do not exist.

## Task 2 — GREEN: Add Settings Setup Tab

- [ ] Edit `src/daemon/console.ts`.
- [ ] Add `tab-setup` after `tab-about`.
- [ ] Add `settingsSetup` panel after `settingsAbout`.
- [ ] Add `renderSettingsSetup()` that reads `state.onboarding`.
- [ ] Render required and optional setup rows with existing onboarding state.
- [ ] Add `Open setup wizard` button calling `openObWizard()`.
- [ ] Update About setup summary to direct users to Settings -> Setup.
- [ ] Add `setup` to `switchSettingsTab`.

Run:

```bash
npm test -- src/daemon/console.test.ts
```

Expected partial GREEN for setup assertions.

## Task 3 — GREEN: Make Model Settings Defensive

- [ ] Extract the model-related body of `openSettings()` into `renderSettingsModelControls()`.
- [ ] Make `openSettings()` async and call `loadModels()` when `models` is missing.
- [ ] Guard `models.available` and `models.backends` with arrays.
- [ ] When there are no models, render disabled default selector with `(no models configured)`.
- [ ] Make `saveDefault()` no-op with a toast when no default model is selectable.
- [ ] Show frontier provider row when at least one frontier backend is configured.
- [ ] Disable the frontier provider selector when exactly one frontier backend is configured.
- [ ] Keep `renderRoleModels()` gated on `mixed`.

Run:

```bash
npm test -- src/daemon/console.test.ts
```

Expected GREEN.

## Task 4 — Review: Spec Compliance

- [ ] Review diff against `docs/superpowers/specs/2026-07-03-settings-setup-visibility-design.md`.
- [ ] Confirm Settings shows Setup.
- [ ] Confirm Settings works with no models configured.
- [ ] Confirm Claude-only, Codex-only, and Claude+Codex states are explicit.
- [ ] Confirm no local model implementation files changed.

## Task 5 — Review: Code Quality

- [ ] Check that UI helpers avoid duplicated backend logic.
- [ ] Check that null/empty arrays do not throw in Settings.
- [ ] Check that model controls do not present unavailable providers as selectable.
- [ ] Check that the setup wizard remains the single detailed setup flow.

## Task 6 — Verification Gates

- [ ] Run focused tests:

```bash
npm test -- src/daemon/console.test.ts
```

- [ ] Run required gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

No Qwen readiness gate is required because this plan does not edit local-model implementation, Qwen profile, backend registry semantics, readiness gates, fallback logic, or LM Studio integration.
