# iOS Goal Flights And Settings Consistency Design

Date: 2026-06-28
Status: proposed

## Context

HiveMatrix iOS already exposes Flights on the Board and has Start, Advance,
Delete, item edit, and item status controls. The desktop product is moving
toward Goal Flights: a Flight profile for one long-running autonomous objective
with looped planning, execution, verification, and follow-up work.

iOS must remain a trustworthy remote operator surface while desktop remains the
source of truth for orchestration.

## Goals

- Show Goal Flights clearly in the iOS Board and Flight detail screens.
- Keep iOS controls compatible with desktop semantics.
- Add loop/pass visibility when daemon endpoints are available.
- Keep unknown daemon fields backward-compatible.
- Align iOS Settings tab order and labels with the desktop settings order.

## Non-Goals

- Do not implement local autonomous orchestration on iOS.
- Do not duplicate desktop daemon business logic.
- Do not require a new daemon API version for basic Goal Flight display.
- Do not ship a design-only screen with dead controls.

## Goal Flight iOS UX

### Board

Goal Flights should show:
- a distinct `Goal` chip or subtitle;
- title and status;
- project/path if present;
- progress text;
- last updated age.

### Detail

When Flight detail includes `intake.goalFlight`, show a Goal section before
actions:
- goal/objective;
- success criteria;
- constraints;
- autonomy mode;
- loop profile/pass count if available.

### Controls

Controls should match desktop language:
- Start Flight
- Pause Loop
- Resume Loop
- Run Pass
- Advance / Repair
- Delete

If loop endpoints are unavailable, hide loop-specific controls and keep Start,
Advance/Repair, Delete.

### Status Labels

iOS should include desktop-compatible labels:
- `done_with_skips`: Landed with skips
- `archived`: Archived
- `skipped`: Skipped

Unknown statuses remain displayed as raw strings rather than crashing.

## Settings Consistency

Settings tab order should mirror desktop's main mental model. Proposed iOS order:

1. General
2. Projects
3. Models
4. Lanes
5. Workflows
6. Features
7. Remote
8. About

This puts operator setup and project defaults before model internals while
keeping advanced capabilities and remote pairing grouped later.

Acceptance:
- `SettingsTab.allCases` order matches the agreed order.
- Initial active tab is `General`.
- Existing settings sections still load lazily and avoid unnecessary network work
  in demo mode.
- Smoke tests assert order and labels.

## Acceptance Criteria

- [ ] iOS decodes and displays Goal Flight metadata from Flight detail.
- [ ] iOS shows Goal Flights distinctly on the Board.
- [ ] iOS supports desktop-compatible status labels including `done_with_skips`.
- [ ] iOS exposes loop controls only when supported by daemon responses.
- [ ] iOS Settings starts on General and uses the agreed order.
- [ ] Demo data includes at least one Goal Flight.
- [ ] `xcodegen generate` is run if project membership changes.
- [ ] iOS tests/build pass.

