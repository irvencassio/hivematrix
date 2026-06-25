# Onboarding Lane Copy Design

## Context

The Settings/Lanes surface now presents embedded capabilities with lane names, but onboarding readiness still emits Bee-era names in active operator-facing strings:

- `DesktopBee (desktop control)`
- `MessageBee (text HiveMatrix)`
- `MailBee (email watch)`
- default details such as `MessageBee disabled`
- remediation text such as `Settings -> MessageBee`

These strings can appear in setup checklists and readiness flows, so they should follow the same lane naming strategy as Settings.

## Goal

Rename active onboarding and guided setup copy to lane language while preserving implementation and bundle compatibility names.

Use:

- `Desktop Lane`
- `Message Lane`
- `Mail Lane`

Keep:

- `desktopbee`, `messagebee`, and `mailbee` step ids
- `DesktopBeeHelper.app` bundle/executable names
- `com.hivematrix.desktopbee.helper` launchd label
- TypeScript function names such as `configureMessageBee`

## Options

### Option A: Rename Onboarding IDs And Helper Bundle

This would create a cleaner surface but risks breaking existing route callers, persisted status ids, launchd helpers, and bundle packaging.

### Option B: Rename Only Active Copy

Keep ids and helper bundle names stable, but make titles, details, remediations, and action result details use lane names.

### Option C: Defer Until A Full Module Rename

This keeps the screenshot-adjacent setup surface inconsistent and continues leaking the voice-hostile names.

## Decision

Use Option B. It is the right safe slice: visible/operator-facing language changes now, compatibility stays intact.

## Acceptance Criteria

1. `getOnboardingStatus` optional lane titles use `Desktop Lane`, `Message Lane`, and `Mail Lane`.
2. Onboarding default details and remediations do not contain `DesktopBee`, `MessageBee`, or `MailBee`.
3. `configureMessageBee` result details use `Message Lane` language.
4. Helper bundle strings such as `DesktopBeeHelper.app` remain unchanged.
5. Focused onboarding tests, `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
