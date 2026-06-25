# Content Research Brief Workflow — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: content-research-brief-workflow
> Builds on commit `01a5ac3` (Workflow Run Ledger MVP).

## Problem

The Workflow Registry + Run Ledger have only one workflow (HeyGen). We add a second,
**low-risk Research Brief** workflow for solo-founder content/video planning — proving
the fabric is generic and giving a no-side-effect, human-reviewed artifact that can feed
the HeyGen pipeline.

## Non-goals / guardrails

- No browser clicking / credential injection / Playwright / posting / publishing. No
  mail/message/desktop/terminal execution. No destructive Bee→Lane cleanup, `WorkerKind`
  flips, `DesktopBeeHelper.app` rename, or module sweeps.
- **No external side effects** — local context only (injected search in tests; default
  `searchBrain`, read-only). No secrets in the brief, run, API, or console.
- HeyGen pipeline stays green; `npm run verify:portal` still passes.

## Design

### 1. Workflow definition (`src/lib/workflows/content-research-brief.ts`, def-only)
To avoid an import cycle (registry → def → runs → registry), the *definition* is a
def-only module (like `heygen-portal.ts`); the *prepare logic* lives separately.
- `id: "content.research_brief"`, `name: "Content research brief"`.
- `lane: "review"` (meta/planning — no external side effect), `capability: "research.brief"`.
- `inputSchema`: topic (required), audience, objective, sources[] (all optional but topic).
- `readiness: { required: false }` — no external gate.
- `approvalPolicy: { mode: "manual", note: "Human review before using/publishing." }`.
- `handoffPoints`: ["Human review the brief before using or publishing it."].
- `artifacts`: ["Markdown research brief", "Cited local sources", "Open questions",
  "Suggested next action"].
- `runbook: "docs/runbooks/content-research-brief.md"`.
- `routing.phrases`: research brief / content brief / prepare topic brief / topic brief /
  brief on. `tags`: research, content, brief. `domains`: [] (no site).
- `handler: "content-research-brief"`.

### 2. Prepare helper (`src/lib/workflows/content-research.ts`)
- `buildResearchBriefMarkdown(input, context)` — **pure, deterministic** markdown:
  topic, audience, objective, sources considered (provided + local hits), key points
  (from hit snippets), open questions (templated), suggested next action. Secret-scrubbed.
- `prepareContentResearchBrief(input, deps?)` — validates `topic`; creates a workflow run
  (`content.research_brief`, status `needs_review`); gathers local context via injected
  `search` (default `searchBrain`, read-only); links artifacts (`briefMarkdown`, `sources`,
  `openQuestions`, `nextAction`); returns `{ workflow, runId, markdown, sources, openQuestions,
  nextAction }`. Injected search/now for tests; no live web required.

### 3. API
- `POST /workflows/:id/prepare` extended: branch on `wf.handler`. `content-research-brief`
  → `prepareContentResearchBrief(body)` (topic required) → `{ ok, workflow, runId, run,
  markdown }`. `heygen-portal-video` unchanged.

### 4. Console (Workflows panel)
A compact "Prepare research brief" control: topic input + button → the prepare endpoint;
shows the created run + a short artifact summary. `prepareResearchBrief()`.

### 5. COO / model visibility
`registry.match` already powers `CooDispatchResult.workflow`; the new phrases make
"research brief"-style text surface `content.research_brief` even with no lane execution.

### 6. Runbook (`docs/runbooks/content-research-brief.md`)
What it is, inputs, how to prepare (console / API), reading the brief, the human-review
handoff, and feeding it into the HeyGen video workflow. No secrets.

## Tests (RED first)
- registry lists BOTH workflows; duplicate ids still rejected; match `content.research_brief`
  by phrase.
- `buildResearchBriefMarkdown` deterministic (topic/audience/objective/sources/open
  questions/next action); no secrets.
- `prepareContentResearchBrief` creates a run + `briefMarkdown` artifact (injected search);
  returns runId + markdown; redacted; no secrets.
- COO dispatch surfaces `content.research_brief` from "research brief" text.
- console source has the prepare control + the prepare endpoint call.
- `npm run verify:portal` still 9/9.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal` — all green.
