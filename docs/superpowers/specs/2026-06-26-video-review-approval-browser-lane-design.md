# Video Review Approval Uses Browser Lane

> Date: 2026-06-26 · Status: approved by operator correction · Topic: video-review-approval-browser-lane

## Problem

The AI-news video review task still treats `approve` as the legacy HeyGen API render
path. In practice that means the desktop console's `Approve & render` button and the
voice "approve the video" path can call `make-avatar.mjs`, which is exactly the path
we no longer want for the normal video factory.

The Browser Lane / HeyGen portal workflow already exists and can create a child task
through `/video/heygen-workflow`, but it is adjacent to the review flow instead of
being the approval flow.

## Decision

Normal video review approval must create a HeyGen portal Browser Lane child task.
The legacy API render path is removed from `resolveVideoDraft`; `make-avatar.mjs`
must not be reachable from the review approval code.

Publishing remains separate:

- `portal_pending`: Browser Lane child is doing the HeyGen portal work.
- `portal_completed`: a local MP4 is ready; `publishDraftVideo` uploads it with
  `publish.mjs` only.
- `needs_publish_input`: no local MP4 exists; the operator must handle publishing
  manually.

## Scope

- Update review copy so it says approve creates a Browser Lane / HeyGen portal task.
- Update `resolveVideoDraft(..., "approve")` to create the portal child task.
- Keep edit, regenerate, cancel, and publish-only behavior intact.
- Remove stale console copy and the separate "Approve & render" affordance.
- Fix portal parent-task updates so they write only real task columns.
- Keep the old standalone `video/factory.ts` creative-agent test untouched; this
  change targets the AI-news review approval path.

## Non-Goals

- No Browser Lane browser automation implementation changes.
- No automatic YouTube publish before a local portal MP4 is handed back.
- No credential handling changes.
- No destructive draft migration.

## Acceptance Criteria

- Review approval creates a Browser Lane / HeyGen portal task and marks the draft
  `portal_pending`.
- Review approval does not call `make-avatar.mjs`.
- Console review controls no longer advertise "Approve & render" or `~$0.05/sec`.
- Voice "approve/publish the video" on a review draft uses the same portal approval.
- Portal completion helper does not attempt to write non-existent task columns.
- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, and
  `npm run verify:portal` pass.
