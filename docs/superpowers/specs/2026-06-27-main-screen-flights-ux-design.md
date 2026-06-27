# Main-Screen Flights UX Design

Date: 2026-06-27
Status: approved

## Context

HiveMatrix currently stages broad or risky prompts as durable Work Packages, but the operator UI lives under Settings -> Lanes. That hides the most important orchestration state: what is staged, what is running, what is blocked, what completed, and what needs review.

The operator approved renaming the product-facing concept to **Flights**. A Flight is a staged collection of tasks intended for autonomous execution with light operator looping. The existing backend term `work-packages` can remain internal for this slice to avoid database churn.

The `frontendui` skill requested by the operator is not available in this session, so this design uses the repo's existing console patterns and frontend guidance.

## Goals

- Make Flights visible from the main screen, not hidden in Settings.
- Preserve the current task board and task-detail workflow.
- Let the operator stage, inspect progress, start/advance, edit, delete, and see completion.
- Rename operator-facing copy from Work Package to Flight.
- Keep conservative execution: no run-all control, held gates remain held, same-repo writer safety remains in the orchestrator.
- Keep Settings -> Lanes as a secondary/admin surface during the transition, using Flight language.

## Naming

Use **Flight** for the singular object and **Flights** for the main-screen section.

Operator language:

- Stage Flight
- Start Flight
- Advance
- In flight
- Landed
- Blocked
- Review needed

Implementation language:

- Keep REST paths as `/work-packages` for compatibility.
- Keep DB tables as `work_packages` and `work_package_items`.
- Prefer new helper names in console code only where it does not make the diff confusing.

## UX Shape

### Main Board Rail

Add a compact **Flights** section below `New task` and above the task lanes.

It shows:

- Active/staged/review Flight cards.
- A status badge.
- Progress text such as `12/20 landed`.
- A narrow progress bar.
- A selected state when a Flight is open in the center panel.

The section is not a card inside a card. It is a compact list in the existing board rail.

### Center Detail Panel

Selecting a Flight replaces the empty overview/task detail panel with Flight detail.

The detail shows:

- Title, status, project, and project path.
- Counts by status.
- Progress bar based on done/review/running/failed/held/ready/draft/cancelled.
- Actions: Start Flight, Advance, Edit, Delete.
- Items as rows with title, prompt, risk, execution mode, linked task id, blocker, and status controls.
- Item edit controls for title/prompt/risk/status.

The center panel is the primary review surface; Settings is not required for normal use.

### Overview

When no task or Flight is selected, the Overview should include Flight counts beside task counts:

- staged
- in flight
- review
- landed
- blocked/failed

This gives completion/progress visibility even before the operator opens a specific Flight.

### New Task Flow

The route selector label changes from `Work Package (orchestrate steps)` to `Flight (stage autonomous run)`.

When `POST /tasks` returns `routed:"work_package"`, the console should:

- Toast: `Staged as a Flight (...)`.
- Refresh Flights.
- Select the new Flight in the center panel.

The old instruction to open Settings -> Lanes must be removed.

## Edit And Delete

### Edit

Package edit:

- Allow editing `title` and `description`.
- Continue accepting status updates through the existing patch path.

Item edit:

- Allow editing `title`, `prompt`, `risk`, `executionMode`, `status`, and `blocker`.
- Continue redacting secret-looking content on write.
- Do not allow changing `createdTaskId`, `resultTaskId`, or `commitHash` from the UI.

### Delete

Delete should be conservative:

- A Flight with currently running child tasks cannot be deleted.
- Deleting a Flight removes its package row and item rows.
- It does not delete already-created board tasks; linked tasks are real task history and should remain.
- The UI confirmation copy must say linked tasks remain on the board.

This matches the operator's "delete" expectation without destructive task-history side effects.

## Backend Changes

Add store function:

- `deleteWorkPackage(id): { deleted: boolean; reason?: string }`

Add route:

- `DELETE /work-packages/:id`

Behavior:

- 404 if the package does not exist.
- 409 if any item status is `running` or any linked task is `assigned`/`in_progress`.
- 200/204 on success.
- Broadcast `work-packages:updated`.

Extend `ITEM_PATCH_FIELDS` to include safe editable fields:

- `title`
- `prompt`

Sanitize title/prompt/blocker with `scrubSecretText`.

## Tests

Add failing tests before implementation:

- Store test: item title/prompt edits persist and redact secrets.
- Store test: delete removes package and items, but blocks running items.
- Server test: `DELETE /work-packages/:id` succeeds for non-running package and returns 409 for running package.
- Console source test: main screen includes Flights rail/detail controls.
- Console source test: user-facing Work Package route/toast/settings copy is replaced with Flight language.

Existing no-run-all tests remain.

## Acceptance

- Flights visible from the main screen.
- New broad prompt stages a Flight and opens its center detail.
- Operator can see progress and completion without opening Settings.
- Operator can edit Flight/item text.
- Operator can delete non-running Flights.
- Unknown/risky orchestration behavior remains manual/conservative.
- Gates pass:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
