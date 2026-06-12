# W3.2 Posture Audit Design

## Context

The commercial workplan requires the 100%-local posture to be honest: work that
needs cloud services must be visible as queued or degraded, never silently
failed. Related slices already exist: local serving lifecycle, TermBee offline
lane, mflux image fallback, and frontier-review debt.

## Goal

Expose a small, stable posture report that clients can show in the console and
mobile apps. The report must describe every capability in the current
connectivity mode and also expose the three reference modes for comparison.

## Design

- Add `src/lib/connectivity/posture.ts`.
- Represent each capability with:
  - `disposition`: `works`, `degraded`, or `queued`
  - `action`: `run_now`, `use_local_fallback`, or `wait_for_cloud`
  - a user-facing note explaining the behavior
- Include counts so clients can summarize the mode without re-deriving state.
- Keep the report pure and deterministic from `ConnectivityMode`.
- Add `GET /posture` for the full all-mode report.
- Embed the same report in `GET /connectivity` so existing clients get it with
  their normal status payload.
- Render the current posture in the console's Connectivity panel.

## Acceptance Criteria

- `cloud-ok` reports all capabilities as `works`.
- `local-only` and `offline` report local Qwen, DesktopBee, and TermBee as
  `works`.
- `local-only` and `offline` report image generation as `degraded` through the
  local mflux fallback.
- `local-only` and `offline` report frontier, WebBee, BrowserBee, and
  frontier-review debt as `queued`.
- No report has a failure/unknown disposition.
- Typecheck and connectivity tests pass.
