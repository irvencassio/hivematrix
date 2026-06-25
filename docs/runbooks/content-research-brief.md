# Runbook — Content Research Brief Workflow

A low-risk, human-reviewed workflow that turns a topic into a structured markdown
**research brief** for content/video planning. It is **read-only**: it gathers local
context (your brain notes) and any sources you provide, and produces a brief — it never
posts, publishes, or touches an external service.

> Workflow id: `content.research_brief` · lane: **Review** · capability: `research.brief`
> Console: **Settings → Lanes → Workflows → Prepare research brief**.

## What it produces

A markdown brief artifact on a durable **workflow run** (status `needs_review`):

- topic, audience, objective
- **Sources considered** — the sources you provided + matching local brain docs
- **Key points** — short excerpts from local context (secret-scrubbed)
- **Open questions** — templated prompts to sharpen the angle
- **Suggested next action** — e.g. draft a script for the HeyGen portal video workflow

## Prepare a brief

### Console
In **Settings → Lanes → Workflows**, type a topic in **Prepare research brief** and click
the button. The created run + a short preview appear under **Recent runs**.

### API
```
POST /workflows/content.research_brief/prepare
{ "topic": "AI video tools for solo founders",
  "audience": "solo founders",      // optional
  "objective": "plan a launch video", // optional
  "sources": ["https://example.com/a"] // optional
}
```
Returns `{ ok, workflow, runId, markdown, run }`. The full brief is also stored as the
run's `briefMarkdown` artifact (`GET /workflows/runs/:id`).

## Read + review

Open the run (`GET /workflows/runs/:id`, or the Workflows panel). Read the brief, answer
the open questions, and refine. **A person must review the brief before it is used or
published** — this is the workflow's only handoff.

## Feed it into a video

Once the brief is approved, draft a script and create a HeyGen portal video with the
HeyGen portal workflow (see `docs/runbooks/heygen-portal-video-pipeline.md`).

## Notes

- No external side effects: local search is read-only; nothing is posted/published.
- No secrets: provided sources + local snippets are secret-scrubbed before they enter the
  brief or the run ledger.
- Reference: `docs/superpowers/specs/2026-06-25-content-research-brief-workflow-design.md`.
