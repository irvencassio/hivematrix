# Runbook — HeyGen Portal Video Pipeline

How an operator takes an AI-news script through the **HeyGen portal** (app.heygen.com)
and publishes it to YouTube, using the Browser Lane + COO readiness gates. This is the
*portal* flow — distinct from the HeyGen **API** render path (the normal "Approve & render"
button), which is unchanged.

> Lifecycle: **draft → portal task → portal completion → publish-only.**
> Console: **Settings → Lanes → HeyGen portal videos**.

## Dry-run check first

Verify the whole pipeline locally with no real HeyGen/YouTube side effects:

```
npm run verify:portal
```

It runs every phase (seed, draft, readiness gate, portal task, completion, publish-only,
needs-publish refusal, endpoint wiring) against a throwaway temp HOME + DB and exits
non-zero if any wiring is broken. Run it after changing any portal helper or endpoint.

## Prerequisites

- HiveMatrix daemon running; you can reach the console.
- The HeyGen Browser Lane site is seeded (the `/video/heygen-workflow` endpoint seeds it
  idempotently; `npm run verify:portal` also seeds it in scratch).
- You are signed in to HeyGen **in your own browser** — login / 2FA / CAPTCHA are manual
  operator steps and are never automated.
- For publishing, the YouTube publish path (`video/publish.mjs`) is configured per the
  YouTube factory setup.

## 1. Readiness check

COO will only create a portal task when the HeyGen site readiness is **green and fresh**.
In **Settings → Lanes → Browser Lane readiness**, click **Run readiness check**. A daily
sweep also keeps it fresh. Green + recent = ready.

## 2. Create the portal task

From a reviewed script's review card, click **🎬 HeyGen portal** (or call
`POST /video/heygen-workflow` with `parentDraftId`, `create: true`). This routes through
COO/Browser Lane readiness:

- **Green + fresh** → a Browser Lane child task is created; the draft moves to
  `portal_pending`. Do the portal work in your browser (pick avatar/voice, paste the
  script, generate, preview, export the final MP4).
- **Not ready** → you get `readiness_required` and **no task is created** (see
  troubleshooting).

The duplicate-child guard means re-clicking while a child is already pending will not
create a second one (pass `force` only for an intentional retry).

## 3. Record portal completion

When the portal work is done, open **Record portal completion** in the HeyGen portal
panel (or `POST /video/portal-complete`) and provide:

- `parentDraftId` — the draft id (required).
- `childTaskId` — the Browser Lane child task id (optional, for idempotency).
- Exactly one result:
  - `localVideoPath` — path to the exported MP4 → draft becomes **`portal_completed`**
    (publishable).
  - `finalVideoUrl` and/or `manualCompletionNote` — link/note only → draft becomes
    **`needs_publish_input`** (manual; there is no local file to upload).

A failed/cancelled portal task (send `childStatus: failed`/`cancelled`) returns the draft
to **`review`** so you can retry or cancel.

> Never paste passwords, cookies, session tokens, or Keychain values into the completion
> form — the contract rejects secret-looking fields.

## 4. Publish to YouTube (no re-render)

For a `portal_completed` draft, click **Publish to YouTube** in the panel (or
`POST /video/publish-draft` with `{ draftId }`). This uploads the **existing local MP4**
via `publish.mjs` — it does **not** re-render through HeyGen. On success the draft becomes
`published` with its `youtubeUrl`. Re-clicking an already-published draft is idempotent.

By voice: "**publish the video**" publishes a `portal_completed` draft; "approve the video"
on a `review` draft still uses the API render+publish path.

## 5. `needs_publish_input` handling

This means the portal returned only a link/note — there is **no local file**, so it cannot
be uploaded automatically. Options:

- Download the final MP4 from HeyGen, then re-record completion with `localVideoPath` to
  make it `portal_completed`, then publish.
- Or publish manually from the HeyGen URL and treat the draft as done.

## Troubleshooting

- **`readiness_required`** — the HeyGen site isn't green/fresh. Run a readiness check
  (step 1). If it shows `needs_reauth`, sign in to HeyGen in your browser; if `unknown` /
  no run, run the check; if stale, re-run it. Then create the portal task again.
- **`portal_pending` stuck** — the child task is still running (or you haven't recorded
  completion yet). Finish the portal work and record completion (step 3). A failed/cancelled
  child returns the draft to `review`.
- **`missing_video`** on publish — the `localVideoPath` recorded at completion doesn't exist
  on disk. Re-record completion with the correct path, then publish.
- **`execution_unavailable`** — Browser Lane execution is offline (connectivity). Routing
  worked; the work waits for connectivity. Nothing is silently rerouted.

## Reference

- Endpoints: `POST /video/heygen-workflow`, `POST /video/portal-complete`,
  `POST /video/publish-draft`, `GET /video/drafts`.
- Specs: `docs/superpowers/specs/2026-06-25-heygen-portal-completion-design.md`,
  `…-heygen-portal-publish-only-design.md`, `…-heygen-portal-operator-controls-design.md`.
