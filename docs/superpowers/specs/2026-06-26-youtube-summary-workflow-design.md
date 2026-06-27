# YouTube Video Summary Workflow — Design

> Saved: 2026-06-26  
> Status: **APPROVED** (self-approved per Superpowers brainstorm → design flow)

## Problem

A user prompt like `"can you run the YouTube thing that summarizes for: https://www.youtube.com/watch?v=9PUaEj0pMYE"` was routed to a generic Codex task in `/Users/irvencassio/Documents/Inbox`. That sandbox cannot reach the internet, so it failed. The host machine has `yt-dlp`, YouTube DNS, and the daemon — all the tools needed — but the request bypassed them.

Root cause: no registered workflow for YouTube video summaries, so the router fell through to a generic task.

## Goal

Add a first-class, deterministic `content.youtube_summary` workflow that:
1. Matches YouTube URL phrases/domains in the COO router and workflow registry
2. Runs entirely daemon-side without Browser Lane for public videos
3. Fetches the transcript via the existing scraper in `src/lib/youtube/transcript.ts`
4. Produces a structured markdown artifact that is stored as a workflow run and sent to `needs_review`
5. Only recommends Browser Lane if a public transcript fetch fails due to auth/age/private gates

## Architecture

### Files to create

| File | Purpose |
|---|---|
| `src/lib/workflows/youtube-summary-def.ts` | Pure workflow definition (no logic, no imports from runs store) |
| `src/lib/workflows/youtube-summary.ts` | Prepare logic: `extractVideoId`, `buildYoutubeSummaryMarkdown`, `prepareYoutubeSummary` |
| `src/lib/workflows/youtube-summary.test.ts` | TDD tests (injectable deps, no live network) |

### Files to modify

| File | Change |
|---|---|
| `src/lib/workflows/registry.ts` | Import `YOUTUBE_SUMMARY_WORKFLOW`; add to `BUILTIN_WORKFLOWS` |
| `src/lib/workflows/prepare.ts` | Add `case "content-youtube-summary"` dispatcher |
| `src/lib/coo/store.ts` | Add `content.youtube_summary` rule to `DEFAULT_COO_ROUTING_RULES` (priority 20, above generic 10) |

### What does NOT change

- `src/lib/youtube/transcript.ts` — used as-is via dep injection
- `src/lib/youtube/poller.ts` — watcher behavior unchanged; the new workflow is ad-hoc only
- Any Browser Lane code — not involved in the public happy path

## Workflow definition

```
id:         content.youtube_summary
name:       YouTube video summary
lane:       review
capability: content.youtube.summary
handler:    content-youtube-summary
```

### Routing signals

```
domains:  ["youtube.com", "youtu.be"]
phrases:  ["youtube summary", "summarize this youtube video",
           "summarize youtube", "run the youtube thing",
           "youtube thing that summarizes", "youtube video summary"]
tags:     ["youtube", "video", "summary"]
```

### Input schema

| name  | type   | required | description |
|-------|--------|----------|-------------|
| url   | string | yes      | The YouTube watch URL (youtube.com/watch or youtu.be) |
| title | string | no       | Optional title override (model may fill from its context) |

## Prepare logic

### `extractVideoId(url: string): string | null`

Pure extraction — no network. Handles:
- `https://www.youtube.com/watch?v=ID`
- `https://youtube.com/watch?v=ID`
- `https://youtu.be/ID`
- Invalid/non-YouTube URLs → `null`

Video ID validated against `^[A-Za-z0-9_-]{11}$`.

### `buildYoutubeSummaryMarkdown(input, context): string`

Pure, deterministic. Sections:
1. `# YouTube summary: <title or video ID>`
2. Source URL
3. Transcript section (if available) — first 4000 chars with truncation note if longer
4. No-transcript notice (if not available) — honest about what is/isn't available
5. `transcriptUsed: true/false` in a metadata block
6. Open questions (for the human reviewer)
7. Browser Lane fallback note (only when transcript is absent due to apparent auth/private gate)

### `prepareYoutubeSummary(input, deps): Promise<PrepareSummaryResult>`

Injectable deps:
```ts
interface YoutubeSummaryDeps {
  fetchTranscript?: (videoId: string) => Promise<string | null>;
  fetchTitle?: (videoId: string) => Promise<string | null>;
}
```

Flow:
1. Validate `url` is present
2. `extractVideoId(url)` → if null, return `needs_input` with reason
3. Fetch transcript + title in parallel (both best-effort, never throw)
4. `buildYoutubeSummaryMarkdown(input, context)` → markdown string
5. `createWorkflowRun({ workflowId, status: "preparing", ... })`
6. `linkWorkflowRunArtifact(run.id, "summaryMarkdown", markdown)`
7. `linkWorkflowRunArtifact(run.id, "sourceUrl", url)`
8. `linkWorkflowRunArtifact(run.id, "videoId", videoId)`
9. `linkWorkflowRunArtifact(run.id, "transcriptUsed", !!transcript)`
10. `updateWorkflowRunStatus(run.id, "needs_review", ...)`
11. Return `{ workflow, runId, markdown, transcriptUsed, videoId }`

When no transcript and no metadata: return `needs_input` status with `blockedReason` explaining why (private/auth/unavailable). Do NOT fabricate content.

## COO routing rule

```js
{
  id:            "content.youtube_summary",
  name:          "YouTube Video Summary",
  priority:      20,   // higher than generic defaults (10)
  intent:        "youtube_video_summary",
  match:         { phrases: [...], domains: ["youtube.com", "youtu.be"] },
  lane:          "review",
  capability:    "content.youtube.summary",
  backendPolicy: "local_first_frontier_on_failure",
  modelPosture:  "mixed-claude",
  riskTier:      "low",
  notes:         "Routes YouTube summary requests to content.youtube_summary workflow. Public transcript fetched daemon-side — no Browser Lane required for public videos.",
}
```

Since "review" lane is `unsupported` in the COO execution bridge (`LANE_DISPATCH_POLICY`), `dispatchCooRequest` returns `status: "unsupported"` — but the `workflow` field shows the matched workflow. The model then calls `prepareWorkflowById("content.youtube_summary", { url: "..." })` directly.

## Browser Lane scope

Browser Lane is **never** auto-created by this workflow. The markdown artifact may include a note like:
> "No transcript was available for this video. If the video is private, age-restricted, or requires login, you may need Browser Lane to access it."

The operator/human decides whether to escalate.

## Existing watcher compatibility

`src/lib/youtube/poller.ts` creates Codex tasks with `profile: "researcher"` for monitored playlist videos. This is unchanged. The new workflow is for **ad-hoc** one-off requests only. No conflict.

## Security

- Video ID validated against allowlist pattern `^[A-Za-z0-9_-]{11}$` before use in URLs
- Transcript text is not passed through `redactSecrets` (plain captions, not credentials)
- Artifact keys do not match secret patterns (`summaryMarkdown`, `sourceUrl`, `videoId`, `transcriptUsed`)
- URL stored in artifact as-is (public YouTube URL, never a credential)
- No API keys or auth tokens in this flow

## Acceptance criteria

- `"can you run the YouTube thing that summarizes for: https://www.youtube.com/watch?v=9PUaEj0pMYE"` routes to `content.youtube_summary`, not generic Codex
- Public transcript path works daemon-side without Browser Lane
- Browser Lane is mentioned only in the "no transcript" fallback note
- `npm run typecheck` — zero errors
- `npm test` — all tests pass
- `node scripts/scope-wall.mjs` — zero violations

---

# Follow-up — closing the three gaps (2026-06-27)

> Status: **APPROVED** (self-approved per Superpowers brainstorm → design flow)

The 2026-06-26 commit (`9d1ff9f`) registered the workflow and the prepare path, but a
quality review found three gaps that meant the *original failed board prompt* could still
spawn a generic Codex task and the artifact was not a real summary. This follow-up closes them.

## Gap 1 — `/tasks` ingress did not route YouTube-summary requests

`POST /tasks` special-cased only the AI-news video and Terminal Lane intents, then fell through
to generic `Task.create`. So the exact failed prompt still created an `executor:"agent"` task.

**Fix.** Add a third intent branch in `POST /tasks`, *before* the generic `Task.create`, that:
- detects a YouTube-summary request with a new pure helper `isYoutubeSummaryRequest(text)`,
- extracts the YouTube URL with `extractYoutubeUrlFromText(text)`,
- calls the **registered** `prepareWorkflowById("content.youtube_summary", { url })` — no bespoke
  duplicate prepare logic,
- creates one **review-visible** task with `executor:"workflow"` (the scheduler only claims
  `executor:"agent"`, so this is never run as a Codex agent) linked to the workflow run via
  `setWorkflowRunLinks(runId, { parentTaskId })`,
- responds with `{ routed:"workflow", workflowId, runId, taskId, status }`.

A `needs_input` prepare (e.g. no URL in the text) still creates a review-visible workflow task
with `reviewState:"needs_input"` — it does **not** fall through to a generic agent. The only
fall-through to a normal task is an *unexpected* thrown error during preparation.

### Why reuse the registry for intent detection

`isYoutubeSummaryRequest` does not re-declare phrase/domain lists. It extracts URL hostnames from
the text and calls `getWorkflowRegistry().match({ text, domains })`, returning true only when the
match resolves to `content.youtube_summary`. The routing source of truth stays the workflow def's
`routing` block — one place, no drift.

## Gap 2 — artifact stored an excerpt, not a summary

`buildYoutubeSummaryMarkdown()` stored a transcript excerpt + open questions, but never produced
a concise summary / key points.

**Fix.** Add an **injectable summarizer** dependency to `prepareYoutubeSummary`:

```ts
type SummarizeFn = (input: { transcript: string; title: string | null; url: string })
  => Promise<{ summary: string; keyPoints: string[] } | null>;
```

- Tests inject a fake summarizer returning `{ summary, keyPoints }`.
- The default summarizer wraps the existing local/frontier completion helper
  `renderViaCompletion()` (`src/lib/content/render.ts`) with a structured prompt and parses the
  `Summary:` / key-point lines out of the response.
- The summarizer is **only** called when a transcript is present — never hallucinate a summary
  from a missing transcript.
- If no summarizer is configured (the completion endpoint is absent) or it fails, the artifact is
  **honest**: the `## Summary` / `## Key points` sections say the transcript was captured but the
  concise summary still needs generation/review. This is the spec-sanctioned honest fallback, not
  a pretend summary.

The markdown is restructured into the required sections:
`## Summary`, `## Key points`, `## Source / transcript status` (keeps the transcript excerpt for
provenance + the no-transcript Browser-Lane fallback note), and `## Limitations`.

A `summaryGenerated: boolean` artifact records whether a real summary was produced, so the board /
reviewer can tell at a glance.

## Gap 3 — missing runbook

The workflow def references `docs/runbooks/youtube-summary.md`, which did not exist.

**Fix.** Create the runbook: public transcript path, why no Browser Lane is needed for public
videos, Browser Lane as the *only* fallback for private/age-gated/login-required videos, how to
trigger from normal task creation, and troubleshooting (no transcript / unavailable / auth-required).

## Testing approach (no live network)

`prepareYoutubeSummary` keeps its explicit `deps` arg (used by unit tests). For the **server-level**
route test, a `_setYoutubeSummaryDepsForTests(deps)` seam (mirroring `content/pipeline.ts`'s
`_setContentRendererForTests`) overrides the live transcript/title/summarizer fetchers so
`POST /tasks` is deterministic and never touches the network.

## Acceptance criteria (follow-up)

- The exact failed prompt no longer creates an `executor:"agent"` task — it routes to
  `content.youtube_summary` and creates a review-visible workflow task + run.
- Browser Lane is never required/created for public YouTube URLs.
- The artifact contains a real `## Summary` + `## Key points` when a summarizer is available, and an
  honest "needs generation" note otherwise.
- `docs/runbooks/youtube-summary.md` exists.
- No secrets appear in the task/run output.
- Gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
