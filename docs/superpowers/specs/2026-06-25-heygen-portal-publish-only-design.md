# HeyGen Portal Publish-Only Path — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: heygen-portal-publish-only
> Builds on commit `f48fde1` (HeyGen portal child-task completion → parent draft).

## Problem

A `portal_completed` draft has a real local MP4 (the portal made it), but the only
way to publish today is the approve flow, which **re-renders** via the HeyGen API
(`make-avatar.mjs`) before publishing. We add a publish-only path that uploads the
existing local file to YouTube via `publish.mjs` — no re-render — while leaving the
API render+publish flow untouched.

## Non-goals / guardrails

- No browser clicking / credential injection / Playwright. No mail/message/desktop/
  terminal execution. No destructive Bee→Lane cleanup, `WorkerKind` flips,
  `DesktopBeeHelper.app` rename, or module sweeps.
- Publish-only must **never** call `make-avatar.mjs` or any HeyGen render script.
- `needs_publish_input` (URL/note only, no local file) must NOT be falsely published.
- The existing `renderAndPublish` (API render mode) stays behaviour-compatible — it
  may only share publish *internals*.
- No secrets in responses or draft metadata.

## Design

### 1. Publish-only helper (`src/lib/video/news-review.ts`)
Extract the publish step of `renderAndPublish` into a shared internal
`runPublish(run, draft) → youtubeUrl?` (runs `publish.mjs` with the title/description/
tags files + privacy, parses the YouTube URL). `renderAndPublish` keeps rendering
first, then calls `runPublish` — same behaviour.

New `publishDraftVideo(id, deps?)`:
- `deps`: `{ runVideoScript?(args): Promise<{stdout,stderr}>, fileExists?(p): boolean }`
  (injectable for tests; defaults = `runNode(videoProjectDir(), …)` + `existsSync`).
- Loads the draft. Then:
  - already `published` + `youtubeUrl` → **idempotent** success (`alreadyPublished`).
  - `needs_publish_input` → refuse with `code:"needs_publish_input"` (no local file).
  - status not `portal_completed` → refuse `code:"not_publishable"`.
  - `paths.video` missing on disk → refuse `code:"missing_video"`.
  - else → `runPublish` (publish.mjs only), parse URL, `updateDraft({ status:"published",
    youtubeUrl })`, return `{ ok:true, published:true, youtubeUrl }`.
- When a runner is injected, the `videoProjectDir()` requirement is skipped (tests
  don't need a real project dir).
- Returns a typed `PublishDraftResult` — never any secret.

### 2. Endpoint (`src/daemon/server.ts`)
- `POST /video/publish-draft` — body `{ draftId }`. Maps the result:
  `ok` → 200 (`published:true`, `youtubeUrl`); `no_draft` → 404;
  `needs_publish_input` / `not_publishable` / `missing_video` / `no_project` → 409 with the
  reason. Already-published returns 200 idempotently.

### 3. Operator copy (`src/lib/video/portal-completion.ts`)
- `portalReviewCopy` for `portal_completed`: "…ready to publish — use Publish to YouTube
  (no re-render)." `needs_publish_input` stays manual (unchanged), not pretending upload
  is possible.

## Tests (RED first)
- `portal_completed` + existing video → `runVideoScript` called with `publish.mjs`,
  **never** `make-avatar.mjs`; draft → `published` + `youtubeUrl`; result `published:true`.
- `needs_publish_input` → refused, `code:"needs_publish_input"`, runner NOT called.
- already `published` → idempotent success, runner NOT called.
- missing video file → `code:"missing_video"`, runner NOT called.
- result/metadata carry no secrets.
- existing review/script tests stay green.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
