# HeyGen Portal Operator Controls (Console + Voice) — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: heygen-portal-operator-controls
> Builds on commit `709ead5` (portal publish-only path).

## Problem

The HeyGen portal lifecycle (create portal task → record completion → publish-only)
has endpoints but no operator-facing controls. We add console + voice affordances so
the operator can drive it honestly — without implying API render+publish for portal
drafts, and without ever falsely publishing a `needs_publish_input` draft.

## Non-goals / guardrails

- No browser clicking / credential injection / Playwright. No mail/message/desktop/
  terminal execution. No destructive Bee→Lane cleanup, `WorkerKind` flips,
  `DesktopBeeHelper.app` rename, or module sweeps.
- No secrets accepted or rendered (console form + voice).
- The existing API approve→render+publish path stays behaviour-compatible.

## Design

### 1. Console — HeyGen portal panel (`src/daemon/console.ts`, Lanes settings tab)
A self-contained panel that fetches `GET /video/drafts` and renders portal-state drafts:
- `portal_pending` → "waiting on portal task" + the child task id.
- `portal_completed` → "ready to publish (no re-render)" + a **Publish to YouTube**
  button → `POST /video/publish-draft` (`publishPortalDraft`).
- `needs_publish_input` → shows the HeyGen URL / manual note and explains there is **no
  local file** — manual only (no publish button).
- `published` → shows the YouTube URL.
- The panel never shows "avatar render" / "~$0.05/sec" copy for portal states.
- **Portal completion form** (`submitPortalCompletion`): `parentDraftId`, optional
  `childTaskId`, and one of `localVideoPath` / `finalVideoUrl` / `manualCompletionNote`
  → `POST /video/portal-complete`. No secret fields.
- **Create portal task** (`createPortalTask`): fetch the draft's script+title from
  `GET /video/drafts/:id`, then `POST /video/heygen-workflow` with `parentDraftId`,
  `create:true`, `projectPath:"~"` — respecting the readiness gates + duplicate-child
  guard already in the endpoint.

### 2. Voice — status-aware portal handling (`src/lib/video/voice-turn.ts`)
The detector is unchanged (`"publish the video"` stays `approve`). Routing becomes
status-aware on the latest actionable draft (review or portal):
- `approve` intent on:
  - `portal_completed` → publish-only (`publishDraftVideo`); speak the YouTube URL.
  - `needs_publish_input` → **refuse**: only a link/note came back, no local file —
    publish manually. Never publishes.
  - `portal_pending` → "the portal task is still running."
  - `review` → existing approve→render+publish (unchanged).
- `read` reflects the draft's status honestly; `cancel`/`rework` keep the review flow.
- New injectable deps (`latestDraft`, `publishDraft`, `resolveDraft`) for testability;
  defaults preserve current behaviour (no draft → "no video script waiting").

## Tests (RED first)
- Voice: `portal_completed` + "publish the video" → `publishDraft` called, reply has the
  YouTube URL; `needs_publish_input` + "publish the video" → refused, `publishDraft` NOT
  called; no-draft read still says "no video script"; no secrets in replies.
- Console source: Publish-to-YouTube button + `/video/publish-draft` call; portal
  completion form + `/video/portal-complete` call; create-portal-task + `/video/heygen-workflow`
  call; no "avatar render"/"~$0.05" copy in the portal panel; no secret fields.
- Existing voice-intent / voice-turn / review tests stay green.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
