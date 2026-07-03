# Optional Codex And OpenClaw Cleanup Design

## Context

HiveMatrix supports multiple model backends, but two surfaces imply unavailable tools are required:

- A task can fail with `[codex-agent] codex CLI not found` when `frontierProvider` is set to Codex, even if the user has Claude or a local model and never intends to run ChatGPT/Codex.
- Settings → Features shows an OpenClaw Chat row on machines where OpenClaw is not installed, even though OpenClaw is no longer part of the intended install path.

## Goal

- Codex CLI must be optional. HiveMatrix should only route to Codex when Codex is actually configured or explicitly selected.
- Settings should expose a clear optional Codex CLI setup path.
- OpenClaw Chat should not appear as a normal feature toggle when OpenClaw is absent.

## Non-Goals

- Do not remove the existing OpenClaw bridge code in this slice.
- Do not require API keys.
- Do not make Claude mandatory either.

## Approach

- Make frontier model resolution check installed/configured frontier backends before choosing default Codex models.
- If the configured frontier provider is Codex but Codex is missing, fall back to Claude when Claude is available; otherwise return `null` so work queues/fails honestly instead of launching a missing CLI.
- Add an optional onboarding/setup step for Codex CLI with install/login guidance.
- Have the Setup button open the model setup wizard directly to the Codex install guide.
- Filter OpenClaw Chat out of `/settings/features` when discovery says OpenClaw is not installed.

## Verification

- Unit tests for frontier provider fallback.
- Onboarding tests for the optional Codex CLI setup row.
- Feature tests for hiding OpenClaw when absent.
- Focused console tests for the Codex setup action.
- Full gates: typecheck, npm test, scope-wall.
