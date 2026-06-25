# HeyGen Portal Child-Task Completion — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: heygen-portal-completion
> Builds on commit `f028625` (HeyGen Browser Lane workflow skeleton).
> NOTE: there is no commit *after* `f028625` — the portal workflow was added as a
> standalone Browser Lane task with no parent-draft linkage. This slice adds that
> linkage and the completion feedback path.

## Problem

The HeyGen portal task (`/video/heygen-workflow`) creates a Browser Lane task but is
not connected to the video draft/review flow. When the operator finishes the portal
work, there is no way to hand the final video URL / local path / completion note back
to the parent draft. We add a completion contract + resolver that updates the parent
draft honestly — without pretending YouTube publishing happened.

## Non-goals / guardrails

- No general browser clicking / credential injection / Playwright. No
  mail/message/desktop/terminal execution. No destructive Bee→Lane cleanup,
  `WorkerKind` flips, `DesktopBeeHelper.app` rename, or module sweeps.
- **No secrets**, cookies, session data, or credential details in the completion
  contract, draft, task copy, traces, or responses.
- Portal completion must **not** falsely mark YouTube publishing done.
- The existing HeyGen **API** render/publish path (`renderAndPublish`) stays compatible.

## Design

### 1. Draft state (`src/lib/video/draft-store.ts`)
- New `DraftStatus` values: `portal_pending` (child created, waiting),
  `portal_completed` (a usable local video is ready to publish),
  `needs_publish_input` (only a HeyGen URL / manual note — no local file to publish).
- New optional fields: `portalTaskId`, `portalResolvedTaskId` (idempotency),
  `portalVideoUrl`, `portalCompletedAt`, `manualCompletionNote`.

### 2. Completion contract + resolver (`src/lib/video/portal-completion.ts`)
- `HeyGenPortalCompletion { parentDraftId, childTaskId?, childStatus?, finalVideoUrl?,
  localVideoPath?, manualCompletionNote? }`. `normalizeHeyGenPortalCompletion` validates
  (requires `parentDraftId`) and **rejects secret-looking fields**
  (password/token/cookie/secret/session/credential).
- `applyHeyGenPortalCompletion(completion, deps?)`:
  - No draft → `{ ok:false }`.
  - **Idempotent**: if `draft.portalResolvedTaskId === childTaskId`, no-op
    (`alreadyProcessed:true`).
  - `childStatus` `failed`/`cancelled` → draft back to `review` (recoverable), record the
    note, clear `portalTaskId` so a retry can create a fresh child; record
    `portalResolvedTaskId`.
  - `childStatus` `done`:
    - usable `localVideoPath` (exists, injectable check) → `portal_completed`,
      `paths.video = localVideoPath`, stamp `portalCompletedAt` — the existing publish
      path can continue.
    - else `finalVideoUrl`/`manualCompletionNote` → `needs_publish_input`, store
      `portalVideoUrl`/`manualCompletionNote`, **do not** set `youtubeUrl` or `published`.
    - else → `{ ok:false }` (no completion data).
  - Updates the linked review task copy via `portalReviewCopy(draft)`.
- `markPortalTaskCreated(draftId, childTaskId, deps?)` → draft `portal_pending` +
  `portalTaskId`; refreshes the review task copy.
- `portalChildPending(draft, force?)` → true when a pending child already exists (dup
  guard); `portalReviewCopy(draft)` → operator-facing one-liner (created / waiting /
  completed / needs manual publish input).

### 3. Daemon
- `POST /video/heygen-workflow` accepts optional `parentDraftId`; before dispatch, if
  `portalChildPending(draft)` and not `force`, return the existing pending child (no
  duplicate). On create, the `persistTask` stores `output.heygen.parentDraftId` and calls
  `markPortalTaskCreated`. A blocked readiness never creates a child (unchanged).
- `POST /video/portal-complete` — body = the completion contract; applies it and marks the
  child task `done`/`failed`/`cancelled`. Idempotent.

## Tests (RED first)
- normalizer: requires `parentDraftId`; rejects secret-looking fields.
- resolver: local path → `portal_completed` + `paths.video`; url/note → `needs_publish_input`
  (no `youtubeUrl`, not `published`); duplicate childTaskId → idempotent no-op;
  failed/cancelled → `review` (recoverable) + `portalTaskId` cleared; missing draft → fail;
  draft/task copy contain linkage and no secrets.
- `markPortalTaskCreated` → `portal_pending`; `portalChildPending` dup guard.
- Existing draft-store + video review/script tests stay green.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
