# YouTube Video Summary Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-06-26-youtube-summary-workflow-design.md`

---

## Task 1 — Write failing tests (RED)

**File:** `src/lib/workflows/youtube-summary.test.ts`  
**Goal:** All tests must FAIL before any implementation code is written.

```typescript
// src/lib/workflows/youtube-summary.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-youtube-summary-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { extractVideoId, buildYoutubeSummaryMarkdown, prepareYoutubeSummary } = await import("./youtube-summary");
const { getWorkflowRegistry } = await import("./registry");
const { getWorkflowRun } = await import("./runs");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events;"); });

// --- extractVideoId ---
test("extractVideoId: watch URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=9PUaEj0pMYE"), "9PUaEj0pMYE");
});
test("extractVideoId: youtu.be URL", () => {
  assert.equal(extractVideoId("https://youtu.be/9PUaEj0pMYE"), "9PUaEj0pMYE");
});
test("extractVideoId: no-www watch URL", () => {
  assert.equal(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});
test("extractVideoId: invalid URL → null", () => {
  assert.equal(extractVideoId("not a url"), null);
});
test("extractVideoId: non-YouTube URL → null", () => {
  assert.equal(extractVideoId("https://vimeo.com/123456789"), null);
});
test("extractVideoId: watch URL missing v param → null", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch"), null);
});

// --- buildYoutubeSummaryMarkdown ---
test("buildYoutubeSummaryMarkdown: transcript path includes transcript content and transcriptUsed=true", () => {
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE", videoId: "9PUaEj0pMYE" },
    { transcript: "Hello world this is the transcript.", title: "My Test Video" },
  );
  assert.match(md, /# YouTube summary:/);
  assert.match(md, /My Test Video/);
  assert.match(md, /Hello world this is the transcript/);
  assert.match(md, /transcriptUsed.*true/i);
  assert.match(md, /youtube\.com\/watch\?v=9PUaEj0pMYE/);
});
test("buildYoutubeSummaryMarkdown: no-transcript path includes honest note, transcriptUsed=false, browser fallback mention", () => {
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE", videoId: "9PUaEj0pMYE" },
    { transcript: null, title: null },
  );
  assert.match(md, /transcriptUsed.*false/i);
  assert.doesNotMatch(md, /Hello world/);
  assert.match(md, /No transcript/i);
  assert.match(md, /Browser Lane|private|login/i);
});
test("buildYoutubeSummaryMarkdown: long transcript is truncated", () => {
  const longTranscript = "word ".repeat(2000);
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=abc1234defg", videoId: "abc1234defg" },
    { transcript: longTranscript, title: null },
  );
  assert.match(md, /\[truncated\]/i);
});

// --- registry: workflow is discoverable ---
test("workflow registry contains content.youtube_summary", () => {
  const def = getWorkflowRegistry().get("content.youtube_summary");
  assert.ok(def, "workflow must be in registry");
  assert.equal(def.lane, "review");
  assert.equal(def.capability, "content.youtube.summary");
  assert.equal(def.handler, "content-youtube-summary");
});
test("registry.match: youtube.com domain matches content.youtube_summary", () => {
  const def = getWorkflowRegistry().match({ domains: ["youtube.com"] });
  assert.ok(def);
  assert.equal(def?.id, "content.youtube_summary");
});
test("registry.match: 'youtube summary' phrase matches content.youtube_summary", () => {
  const def = getWorkflowRegistry().match({ text: "can you run the YouTube thing that summarizes for: https://www.youtube.com/watch?v=9PUaEj0pMYE" });
  assert.ok(def);
  assert.equal(def?.id, "content.youtube_summary");
});
test("registry.match: youtu.be domain matches", () => {
  const def = getWorkflowRegistry().match({ domains: ["youtu.be"] });
  assert.ok(def);
  assert.equal(def?.id, "content.youtube_summary");
});

// --- prepareYoutubeSummary: happy path (with transcript) ---
const fakeTranscript = async (_id: string) => "This is the transcript text for the video.";
const fakeTitle = async (_id: string) => "Great Video Title";
const nullTranscript = async (_id: string) => null;
const nullTitle = async (_id: string) => null;

test("prepareYoutubeSummary: with transcript → needs_review run + markdown artifact + transcriptUsed=true", async () => {
  const result = await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: fakeTranscript, fetchTitle: fakeTitle },
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "prepared");
  assert.ok(result.runId);
  assert.equal(result.transcriptUsed, true);
  assert.match(result.markdown, /Great Video Title/);
  assert.match(result.markdown, /This is the transcript text/);

  const run = getWorkflowRun(result.runId!);
  assert.ok(run);
  assert.equal(run.workflowId, "content.youtube_summary");
  assert.equal(run.status, "needs_review");
  assert.ok(run.artifacts.summaryMarkdown);
  assert.equal(run.artifacts.transcriptUsed, true);
  // No secrets in run
  assert.doesNotMatch(JSON.stringify(run), /password|cookie|secret|credentialRef|\btoken\b/i);
});

// --- prepareYoutubeSummary: no transcript path ---
test("prepareYoutubeSummary: no transcript → run with transcriptUsed=false, honest markdown", async () => {
  const result = await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: nullTranscript, fetchTitle: nullTitle },
  );
  assert.equal(result.ok, true);
  assert.equal(result.transcriptUsed, false);
  assert.match(result.markdown, /No transcript/i);

  const run = getWorkflowRun(result.runId!);
  assert.ok(run);
  assert.equal(run.artifacts.transcriptUsed, false);
});

// --- prepareYoutubeSummary: missing url ---
test("prepareYoutubeSummary: missing url → needs_input", async () => {
  const result = await prepareYoutubeSummary({ url: "" }, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, "needs_input");
});

// --- prepareYoutubeSummary: invalid url (not YouTube) ---
test("prepareYoutubeSummary: non-YouTube URL → needs_input", async () => {
  const result = await prepareYoutubeSummary({ url: "https://vimeo.com/123" }, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, "needs_input");
});

// --- prepareWorkflowById dispatcher ---
test("prepareWorkflowById dispatches content.youtube_summary handler", async () => {
  const { prepareWorkflowById } = await import("./prepare");
  const out = await prepareWorkflowById("content.youtube_summary", {
    url: "https://www.youtube.com/watch?v=9PUaEj0pMYE",
  });
  // Either prepared (if live network) or needs_input (no url). In tests we pass url but
  // fetchTranscript hits the real net and likely fails → still creates a run.
  assert.ok(out.status === "prepared" || out.status === "needs_input" || out.status === "unsupported" || out.ok !== undefined);
  assert.notEqual(out.status, "unsupported");
});

// --- Browser Lane NOT required for public happy path ---
test("prepareYoutubeSummary: does not create any browser-lane tasks", async () => {
  await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: fakeTranscript, fetchTitle: fakeTitle },
  );
  const taskCount = getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE source = 'browser-lane'").get() as { n: number };
  assert.equal(taskCount.n, 0);
});
```

Run: `npm test -- --test-name-pattern "extractVideoId|buildYoutubeSummary|prepareYoutubeSummary|registry.*youtube|workflow registry"` → all FAIL (files don't exist yet).

---

## Task 2 — Implement `youtube-summary-def.ts` (pure data)

**File:** `src/lib/workflows/youtube-summary-def.ts`

```typescript
import type { WorkflowDefinition } from "./registry";

export const YOUTUBE_SUMMARY_WORKFLOW: WorkflowDefinition = {
  id: "content.youtube_summary",
  name: "YouTube video summary",
  description:
    "Fetch the transcript for a public YouTube video and produce a structured summary artifact for human review. No Browser Lane required for public videos. Browser Lane is recommended only when a video is private, age-restricted, or requires login.",
  lane: "review",
  capability: "content.youtube.summary",
  inputSchema: [
    { name: "url", type: "string", required: true, description: "The YouTube video URL (youtube.com/watch?v= or youtu.be/)." },
    { name: "title", type: "string", required: false, description: "Optional title override (model may pre-fill from its context)." },
  ],
  readiness: {
    required: false,
    note: "No external readiness gate — transcript fetched from public YouTube directly. Browser Lane is only a fallback if the video requires auth.",
  },
  approvalPolicy: {
    mode: "manual",
    note: "Human reviews the transcript-based summary before using or publishing it. Nothing is posted.",
  },
  handoffPoints: [
    "MANUAL HANDOFF — Review: a person reviews the summary artifact before it is used.",
  ],
  artifacts: [
    "summaryMarkdown — structured summary with transcript (or honest no-transcript note)",
    "sourceUrl — the original YouTube URL",
    "videoId — extracted video ID",
    "transcriptUsed — true if a transcript was fetched, false otherwise",
  ],
  runbook: "docs/runbooks/youtube-summary.md",
  routing: {
    domains: ["youtube.com", "youtu.be"],
    phrases: [
      "youtube summary",
      "summarize this youtube video",
      "summarize youtube",
      "run the youtube thing",
      "youtube thing that summarizes",
      "youtube video summary",
    ],
    tags: ["youtube", "video", "summary"],
  },
  handler: "content-youtube-summary",
};
```

---

## Task 3 — Implement `youtube-summary.ts` (prepare logic)

**File:** `src/lib/workflows/youtube-summary.ts`

Key functions:
- `extractVideoId(url)` — pure, no network
- `buildYoutubeSummaryMarkdown(input, context)` — pure, deterministic
- `fetchYouTubeTitle(videoId)` — default impl (injectable)
- `prepareYoutubeSummary(input, deps)` — async prepare handler

```typescript
/**
 * YouTube video summary — prepare logic for content.youtube_summary workflow.
 *
 * Deterministic: fetches transcript + title (injectable for tests), builds a
 * structured markdown artifact, creates a needs_review workflow run. No Browser
 * Lane tasks are created. Browser Lane is mentioned only in the no-transcript path
 * as a human-facing recommendation.
 */

import { createWorkflowRun, linkWorkflowRunArtifact, updateWorkflowRunStatus } from "./runs";
import { getWorkflowRegistry, summarizeWorkflow, type WorkflowSummary } from "./registry";

const WORKFLOW_ID = "content.youtube_summary";
const TRANSCRIPT_CHAR_LIMIT = 4000;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") {
      if (u.pathname !== "/watch") return null;
      const v = u.searchParams.get("v");
      return v && VIDEO_ID_RE.test(v) ? v : null;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1).split("?")[0].split("/")[0];
      return id && VIDEO_ID_RE.test(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export interface YoutubeSummaryBuildInput {
  url: string;
  videoId: string;
  titleOverride?: string;
}

export interface YoutubeSummaryContext {
  transcript: string | null;
  title: string | null;
}

export function buildYoutubeSummaryMarkdown(input: YoutubeSummaryBuildInput, context: YoutubeSummaryContext): string {
  const title = input.titleOverride?.trim() || context.title?.trim() || `Video ${input.videoId}`;
  const transcriptUsed = !!context.transcript;

  let transcriptSection: string;
  if (context.transcript) {
    const raw = context.transcript;
    const truncated = raw.length > TRANSCRIPT_CHAR_LIMIT;
    const excerpt = truncated ? raw.slice(0, TRANSCRIPT_CHAR_LIMIT) : raw;
    transcriptSection = [
      "## Transcript",
      "",
      excerpt,
      truncated ? "\n_[truncated — full transcript available on YouTube]_" : "",
    ].join("\n");
  } else {
    transcriptSection = [
      "## Transcript",
      "",
      "_No transcript was available for this video._",
      "",
      "> **Note:** If the video is private, age-restricted, or requires login, no public transcript can be fetched.",
      "> To access it, use Browser Lane with an authenticated YouTube session.",
    ].join("\n");
  }

  return [
    `# YouTube summary: ${title}`,
    "",
    `- **Source:** ${input.url}`,
    `- **Video ID:** ${input.videoId}`,
    `- **transcriptUsed:** ${transcriptUsed}`,
    "",
    transcriptSection,
    "",
    "## Open questions",
    "",
    "- What is the core claim or takeaway of this video?",
    "- Is the information current and credible?",
    "- What context or follow-up research is needed?",
    "",
    "_Human review required before using or publishing. This summary has no external side effects._",
    "",
  ].join("\n");
}

export interface YoutubeSummaryInput {
  url: string;
  title?: string;
}

export interface YoutubeSummaryDeps {
  fetchTranscript?: (videoId: string) => Promise<string | null>;
  fetchTitle?: (videoId: string) => Promise<string | null>;
}

export interface PrepareYoutubeSummaryResult {
  ok: boolean;
  status: "prepared" | "needs_input";
  workflow: WorkflowSummary | null;
  runId?: string;
  markdown: string;
  transcriptUsed: boolean;
  videoId?: string;
  missing?: string[];
  reason?: string;
}

async function defaultFetchTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta property="og:title" content="([^"]+)"/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export async function prepareYoutubeSummary(
  input: YoutubeSummaryInput,
  deps: YoutubeSummaryDeps = {},
): Promise<PrepareYoutubeSummaryResult> {
  const workflow = summarizeWorkflow(getWorkflowRegistry().get(WORKFLOW_ID)!);

  const url = (input.url ?? "").trim();
  if (!url) {
    return { ok: false, status: "needs_input", workflow, markdown: "", transcriptUsed: false, missing: ["url"] };
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return {
      ok: false, status: "needs_input", workflow, markdown: "", transcriptUsed: false,
      missing: ["url"], reason: `Could not extract a YouTube video ID from: ${url}`,
    };
  }

  const fetchTranscript = deps.fetchTranscript ?? (async (id: string) => {
    const { fetchTranscript: ft } = await import("@/lib/youtube/transcript");
    return ft(id);
  });
  const fetchTitle = deps.fetchTitle ?? defaultFetchTitle;

  const [transcript, fetchedTitle] = await Promise.all([
    fetchTranscript(videoId).catch(() => null),
    fetchTitle(videoId).catch(() => null),
  ]);

  const markdown = buildYoutubeSummaryMarkdown(
    { url, videoId, titleOverride: input.title },
    { transcript, title: fetchedTitle },
  );

  const run = createWorkflowRun({
    workflowId: WORKFLOW_ID,
    title: `YouTube summary: ${fetchedTitle || videoId}`,
    status: "preparing",
    currentStep: "building summary artifact",
  });

  linkWorkflowRunArtifact(run.id, "summaryMarkdown", markdown);
  linkWorkflowRunArtifact(run.id, "sourceUrl", url);
  linkWorkflowRunArtifact(run.id, "videoId", videoId);
  linkWorkflowRunArtifact(run.id, "transcriptUsed", !!transcript);

  updateWorkflowRunStatus(run.id, "needs_review", { currentStep: "summary ready for human review" });

  return {
    ok: true,
    status: "prepared",
    workflow,
    runId: run.id,
    markdown,
    transcriptUsed: !!transcript,
    videoId,
  };
}
```

---

## Task 4 — Wire up registry.ts

**File:** `src/lib/workflows/registry.ts`

Add import and entry:
```typescript
import { YOUTUBE_SUMMARY_WORKFLOW } from "./youtube-summary-def";

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  HEYGEN_PORTAL_VIDEO_WORKFLOW,
  CONTENT_RESEARCH_BRIEF_WORKFLOW,
  VIDEO_SCRIPT_WORKFLOW,
  YOUTUBE_SUMMARY_WORKFLOW,  // ← add
];
```

Also reset singleton so new def is picked up if module is cached:
```typescript
export function _resetWorkflowRegistryForTests(): void {
  singleton = null;
}
```

---

## Task 5 — Wire up prepare.ts

**File:** `src/lib/workflows/prepare.ts`

Add case in the switch:
```typescript
case "content-youtube-summary": {
  const { prepareYoutubeSummary } = await import("./youtube-summary");
  const out = await prepareYoutubeSummary({
    url: typeof inputs.url === "string" ? inputs.url : "",
    title: typeof inputs.title === "string" ? inputs.title : undefined,
  });
  if (!out.ok) return { ok: false, status: out.status, workflow, missing: out.missing, reason: out.reason };
  return { ok: true, status: "prepared", workflow, runId: out.runId, result: { markdown: out.markdown, transcriptUsed: out.transcriptUsed, videoId: out.videoId } };
}
```

---

## Task 6 — Add COO routing rule seed in coo/store.ts

**File:** `src/lib/coo/store.ts`

Add to `DEFAULT_COO_ROUTING_RULES` array:
```typescript
{
  id: "content.youtube_summary",
  name: "YouTube Video Summary",
  priority: 20,
  intent: "youtube_video_summary",
  match: {
    phrases: [
      "youtube summary",
      "summarize this youtube video",
      "summarize youtube",
      "run the youtube thing",
      "youtube thing that summarizes",
      "youtube video summary",
    ],
    domains: ["youtube.com", "youtu.be"],
  },
  lane: "review",
  capability: "content.youtube.summary",
  backendPolicy: "local_first_frontier_on_failure",
  modelPosture: "mixed-claude",
  riskTier: "low",
  notes: "Routes YouTube video summary requests to the content.youtube_summary workflow (review lane). Public transcript fetched daemon-side — no Browser Lane required for public videos. Browser Lane is a human-directed fallback only.",
},
```

---

## Task 7 — Run gates

```bash
npm run typecheck       # zero errors
npm test                # all tests pass
node scripts/scope-wall.mjs  # zero violations
```

Fix any errors before proceeding.

---

## Task 8 — Commit and push

```bash
git add src/lib/workflows/youtube-summary-def.ts \
        src/lib/workflows/youtube-summary.ts \
        src/lib/workflows/youtube-summary.test.ts \
        src/lib/workflows/registry.ts \
        src/lib/workflows/prepare.ts \
        src/lib/coo/store.ts \
        docs/superpowers/specs/2026-06-26-youtube-summary-workflow-design.md \
        docs/superpowers/plans/2026-06-26-youtube-summary-workflow.md

git commit -m "feat: add content.youtube_summary workflow (ad-hoc YouTube transcript summary)"
git push
```

---

# Follow-up Plan — closing the three gaps (2026-06-27)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

TDD throughout: write the failing test, watch it fail, write minimal code, watch it pass.

## Task F1 — YouTube-summary intent helper (reuse registry routing)

- [ ] RED: `src/lib/workflows/youtube-summary-intent.test.ts`
  - exact failed prompt → `isYoutubeSummaryRequest` is `true`
  - exact failed prompt → `extractYoutubeUrlFromText` returns the watch URL
  - a youtube URL with no phrase → `true` (domain match)
  - a non-YouTube task ("fix the login bug") → `false`, URL extractor `null`
- [ ] GREEN: `src/lib/workflows/youtube-summary-intent.ts`
  - `extractYoutubeUrlFromText(text)` — first URL whose `extractVideoId` validates
  - `extractDomainsFromText(text)` — hostnames of URLs in the text
  - `isYoutubeSummaryRequest(text)` — `getWorkflowRegistry().match({ text, domains }).id === "content.youtube_summary"`

## Task F2 — real summary artifact + injectable summarizer

- [ ] RED: extend `src/lib/workflows/youtube-summary.test.ts`
  - builder emits `## Summary`, `## Key points`, `## Source / transcript status`, `## Limitations`
  - fake summarizer → real summary + key points appear; `summaryGenerated:true`
  - transcript present but summarizer `null` → honest "needs generation" note; `summaryGenerated:false`; no hallucinated summary
  - no transcript → summarizer NOT called; honest no-transcript note retained
- [ ] GREEN: `src/lib/workflows/youtube-summary.ts`
  - extend `YoutubeSummaryContext` with `summary`/`keyPoints`/`summaryGenerated`
  - restructure `buildYoutubeSummaryMarkdown` sections
  - add `summarize` dep (default wraps `renderViaCompletion`) + `_setYoutubeSummaryDepsForTests`
  - call summarizer only when transcript present; link `summaryGenerated` artifact

## Task F3 — `/tasks` ingress routing

- [ ] RED: `src/daemon/server.test.ts`
  - POST `/tasks` with the exact failed prompt (deps stubbed via the test seam)
  - response `routed:"workflow"`, `workflowId:"content.youtube_summary"`, has `runId` + `taskId`
  - the created task's `executor !== "agent"`; no `executor:"agent"` task exists
  - no Browser Lane task created; no secrets in the response/task output
- [ ] GREEN: `src/daemon/server.ts`
  - third intent branch before generic `Task.create`; uses `prepareWorkflowById`; links run↔task

## Task F4 — COO dispatch sanity test

- [ ] RED/GREEN: `src/lib/coo/dispatch.test.ts`
  - `dispatchCooRequest({ text: <failed prompt> }).workflow?.id === "content.youtube_summary"`

## Task F5 — runbook

- [ ] `docs/runbooks/youtube-summary.md` (public path, no Browser Lane, fallback, trigger, troubleshooting)

## Task F6 — gates + commit

- [ ] `npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs`
- [ ] commit + push to main (no release)
