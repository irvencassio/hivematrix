# Settings Toggle Standardization Design

## Context

The Settings > Features tab currently renders optional capability toggles as small text buttons using the `.reply-toggle` style. In dark mode, the active `On` state is hard to read and visually inconsistent with binary settings controls.

## Goals

- Standardize feature/settings binary controls as switch-style buttons.
- Make active and inactive states readable in dark, light, and Matrix themes.
- Keep Reply/Retry action buttons visually separate from settings switches.
- Preserve existing endpoints and behavior.

## Design

Introduce a dedicated `.settings-switch` component in the console stylesheet and a small `settingsSwitch(...)` renderer helper in the inline console script.

The switch uses:

- `role="switch"` and `aria-checked` for accessibility.
- A track/knob visual indicator for binary state.
- Readable text labels: `Enabled` and `Off`.
- A disabled `Unavailable` state for incapable features.

Existing feature, voice auto-approval, and morning briefing controls will use the shared helper.

## Verification

- Add static console tests that require the dedicated switch class, ARIA role, readable labels, and no `.reply-toggle` usage inside `renderFeatures`.
- Run the focused console test, then the full HiveMatrix gates:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
