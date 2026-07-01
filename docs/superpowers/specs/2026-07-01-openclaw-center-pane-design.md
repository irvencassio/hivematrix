# OpenClaw Center Pane Design

## Problem

The OpenClaw dock works, but its bottom placement creates an eye-travel problem in the three-column HiveMatrix console. The operator chooses context on the left, reads system state across the center/right, then must drop to a thin bottom strip to type. The composer is technically wide, but visually small and low in the window, so it does not feel like the natural chat target.

## Approaches Considered

1. **Make the dock taller and auto-expanded.** This is low-risk, but it still asks the operator to work at the bottom edge of the app and competes with the whole console width.
2. **Move OpenClaw into the right context rail.** This keeps it near usage/status, but the rail is already dense and narrow. It would preserve the small-target problem.
3. **Make OpenClaw a center-column workspace selected from the left rail.** This matches the existing Overview/New task model: left chooses the current work surface, center becomes the place to act, right remains context.

## Recommended Design

Use approach 3.

- Add an **OpenClaw** navigation button directly below **New task** in the left rail.
- Clicking it clears task/Flight selection and renders an OpenClaw chat workspace in the center column.
- The center workspace has a compact header, session picker, refresh action, large transcript region, and a full-width composer at the bottom of the center column.
- The entire composer shell focuses the textarea, making the message area an easy click target.
- Retire the visible bottom dock so OpenClaw has one obvious place to read and type.
- Keep the feature gated by `openclaw.chatDock`; if the flag is off, hide the OpenClaw left-rail entry.

## Acceptance Criteria

- OpenClaw can be opened from a left-rail button under New task.
- The center column renders OpenClaw chat without requiring the operator to look down at the bottom dock.
- The center composer has a larger click target than the dock input and supports Enter-to-send.
- Existing OpenClaw unavailable/error states still render in the center pane.
- Existing OpenClaw send/create-task behavior still uses the daemon bridge and never exposes gateway credentials.
