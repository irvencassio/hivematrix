# Runbook — YouTube Video Summary Workflow

A low-risk, human-reviewed workflow that turns a public YouTube URL into a structured
markdown **summary** for review. It is **read-only**: it fetches the public transcript
daemon-side and produces a summary artifact — it never posts, publishes, or signs into
anything.

> Workflow id: `content.youtube_summary` · lane: **Review** · capability: `content.youtube.summary`
> Runbook referenced by the workflow def (`src/lib/workflows/youtube-summary-def.ts`).

## What it produces

A markdown artifact on a durable **workflow run** (status `needs_review`), linked to a
review-visible task on the board. The artifact has four sections:

- **Summary** — a concise, model-generated summary of the transcript (or an honest
  "needs generation/review" note when no summarizer is configured — see below).
- **Key points** — bullet takeaways generated alongside the summary.
- **Source / transcript status** — how the transcript was obtained, plus a transcript
  excerpt for provenance (truncated for long videos).
- **Limitations** — honest caveats (auto-caption errors, verify-before-use, no side effects).

Run artifacts: `summaryMarkdown`, `sourceUrl`, `videoId`, `transcriptUsed`,
`summaryGenerated`. No secrets are stored — artifact keys are secret-redacted on write.

## The public transcript path (no Browser Lane)

For a normal **public** video the daemon fetches the transcript directly from the YouTube
watch page (`src/lib/youtube/transcript.ts` — scrapes the caption track and pulls the
json3 timedtext). This runs entirely on the host machine. **Browser Lane is not used and
not required for public videos.**

The summarizer is the existing local/frontier completion helper
(`renderViaCompletion`, `src/lib/content/render.ts`), configured via
`config.content.{endpoint,model,apiKeyEnv}`:

- **Configured** → a real Summary + Key points are generated from the transcript.
- **Not configured / unreachable** → the transcript is still captured and the artifact
  honestly reports that the summary still needs generation/review. It does **not**
  fabricate a summary.

The summarizer is only invoked when a transcript was actually fetched — a missing
transcript never produces a hallucinated summary.

## Browser Lane fallback — auth/age/login only

Browser Lane is the fallback **only** when a public transcript cannot be fetched because
the video is:

- **private** or unlisted-with-restrictions,
- **age-restricted**, or
- **login-required** / members-only.

In that case the artifact's *Source / transcript status* section recommends using Browser
Lane with an **authenticated** YouTube session. The workflow never creates a Browser Lane
task automatically — a human directs that fallback explicitly.

## How to trigger

### Normal task creation (the board)
Just create a task whose text is a YouTube-summary request, e.g.:

```
can you run the YouTube thing that summarizes for: https://www.youtube.com/watch?v=9PUaEj0pMYE
```

`POST /tasks` detects the request (`isYoutubeSummaryRequest`, reusing the workflow's
registered routing), extracts the URL, and routes it through
`prepareWorkflowById("content.youtube_summary", { url })`. The response is:

```json
{ "routed": "workflow", "workflowId": "content.youtube_summary", "runId": "…", "taskId": "…", "status": "prepared" }
```

The created task has `executor: "workflow"` (the scheduler only claims `executor: "agent"`,
so it is **never** run as a generic Codex agent) and is linked to the run via
`parentTaskId`, so the operator sees the prepared summary from the normal board flow.

If the text has no extractable YouTube URL, the route still creates a review-visible
workflow task with `reviewState: "needs_input"` — it does not fall through to a generic
agent.

### API (direct)
```
POST /workflows/content.youtube_summary/prepare
{ "url": "https://www.youtube.com/watch?v=9PUaEj0pMYE" }
```

## Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| `transcriptUsed: false`, no summary | No public transcript (private/age-gated/login, or captions disabled) | Use Browser Lane with an authenticated YouTube session, or pick a video with captions. |
| `summaryGenerated: false` but transcript present | No content completion endpoint configured (`config.content.*`) or it was unreachable | Configure `config.content.{endpoint,model,apiKeyEnv}`, then re-run; review the transcript excerpt in the meantime. |
| `needs_input` task / `Could not extract a YouTube video ID` | The request had no valid `youtube.com/watch?v=` or `youtu.be/` URL | Reply/recreate with a full YouTube URL. |
| Video unavailable / removed | The watch page 404s or has no caption tracks | Confirm the URL opens in a browser; the workflow returns the honest no-transcript note. |
| Routed to a generic agent instead | The text didn't match the workflow routing | Include a YouTube URL or a summary phrase (see `routing` in the workflow def). |

## Security

- Only public, daemon-side transcript fetch — no credentials in this flow.
- Video ID is validated against `^[A-Za-z0-9_-]{11}$` before being used in any URL.
- Artifacts and run metadata are secret-key-redacted on write; the public YouTube URL is
  stored as-is (not a credential).
- The artifact has no external side effects; a human reviews it before any use.
