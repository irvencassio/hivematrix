/**
 * YouTube video summary — prepare logic for content.youtube_summary workflow.
 *
 * Deterministic: fetches transcript + title (injectable for tests), builds a
 * structured markdown artifact, creates a needs_review workflow run. No Browser
 * Lane tasks are created. Browser Lane is mentioned only in the no-transcript path
 * as a human-facing recommendation — never auto-created.
 */

import { createWorkflowRun, linkWorkflowRunArtifact, updateWorkflowRunStatus } from "./runs";
import { getWorkflowRegistry, summarizeWorkflow, type WorkflowSummary } from "./registry";

const WORKFLOW_ID = "content.youtube_summary";
const TRANSCRIPT_CHAR_LIMIT = 4000;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Pure: extract the 11-char video ID from a YouTube watch or short URL. Returns null for invalid/non-YouTube input. */
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
  /** A real, generated summary. Null/absent → honest "needs generation" copy. */
  summary?: string | null;
  /** Generated key points. Null/absent → honest "needs generation" copy. */
  keyPoints?: string[] | null;
}

/** Pure, deterministic markdown for a YouTube summary artifact. */
export function buildYoutubeSummaryMarkdown(
  input: YoutubeSummaryBuildInput,
  context: YoutubeSummaryContext,
): string {
  const title = input.titleOverride?.trim() || context.title?.trim() || `Video ${input.videoId}`;
  const transcriptUsed = !!context.transcript;
  const summary = context.summary?.trim() || "";
  const keyPoints = (context.keyPoints ?? []).map((p) => p.trim()).filter(Boolean);
  const summaryGenerated = !!summary;

  // ## Summary
  let summarySection: string;
  if (summaryGenerated) {
    summarySection = ["## Summary", "", summary].join("\n");
  } else if (transcriptUsed) {
    summarySection = [
      "## Summary",
      "",
      "_A transcript was captured, but a concise summary still needs generation/review._",
      "_No summarizer was available — review the transcript below, or generate the summary._",
    ].join("\n");
  } else {
    summarySection = [
      "## Summary",
      "",
      "_No summary — no transcript could be fetched for this video (see Source / transcript status)._",
    ].join("\n");
  }

  // ## Key points
  let keyPointsSection: string;
  if (keyPoints.length) {
    keyPointsSection = ["## Key points", "", ...keyPoints.map((p) => `- ${p}`)].join("\n");
  } else {
    keyPointsSection = [
      "## Key points",
      "",
      "_Pending — key points are generated together with the summary._",
    ].join("\n");
  }

  // ## Source / transcript status (keeps the transcript excerpt for provenance)
  let sourceSection: string;
  if (context.transcript) {
    const raw = context.transcript;
    const truncated = raw.length > TRANSCRIPT_CHAR_LIMIT;
    const excerpt = truncated ? raw.slice(0, TRANSCRIPT_CHAR_LIMIT) : raw;
    sourceSection = [
      "## Source / transcript status",
      "",
      "A public transcript was fetched daemon-side (no Browser Lane required).",
      "",
      "### Transcript excerpt",
      "",
      excerpt,
      truncated ? "\n_[truncated] — full transcript available on YouTube_" : "",
    ].join("\n");
  } else {
    sourceSection = [
      "## Source / transcript status",
      "",
      "_No transcript was available for this video._",
      "",
      "> **Fallback:** If the video is private, age-restricted, or requires login, no public transcript can be fetched.",
      "> To access it, use Browser Lane with an authenticated YouTube session. Public videos never need Browser Lane.",
    ].join("\n");
  }

  return [
    `# YouTube summary: ${title}`,
    "",
    `- **Source:** ${input.url}`,
    `- **Video ID:** ${input.videoId}`,
    `- **transcriptUsed:** ${transcriptUsed}`,
    `- **summaryGenerated:** ${summaryGenerated}`,
    "",
    summarySection,
    "",
    keyPointsSection,
    "",
    sourceSection,
    "",
    "## Limitations",
    "",
    summaryGenerated
      ? "- Summary is model-generated from the transcript — verify claims before using or publishing."
      : "- No generated summary yet — do not treat the transcript excerpt as a vetted summary.",
    "- Transcript is best-effort auto-captions; it may contain errors or omissions.",
    "- This artifact has no external side effects; a human reviews it before any use.",
    "",
  ].join("\n");
}

/**
 * Parse a summarizer completion of the form:
 *   SUMMARY: <text>
 *   KEY POINTS:
 *   - <point>
 *   - <point>
 * Returns null when there is no usable summary text. Pure.
 */
export function parseSummaryResponse(text: string): { summary: string; keyPoints: string[] } | null {
  if (!text || !text.trim()) return null;
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?:\n\s*KEY\s*POINTS:|$)/i);
  const summary = (summaryMatch?.[1] ?? "").trim();
  const kpBlock = text.split(/KEY\s*POINTS:/i)[1] ?? "";
  const keyPoints = kpBlock
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 0);
  if (!summary && keyPoints.length === 0) return null;
  return { summary: summary || keyPoints.join(" "), keyPoints };
}

export interface YoutubeSummaryInput {
  url: string;
  title?: string;
}

export interface SummarizeInput {
  transcript: string;
  title: string | null;
  url: string;
}
export type SummarizeFn = (
  input: SummarizeInput,
) => Promise<{ summary: string; keyPoints: string[] } | null>;

export interface YoutubeSummaryDeps {
  /** Injectable for tests — defaults to live YouTube page scraper. */
  fetchTranscript?: (videoId: string) => Promise<string | null>;
  /** Injectable for tests — defaults to og:title scrape. */
  fetchTitle?: (videoId: string) => Promise<string | null>;
  /** Injectable for tests — defaults to a local/frontier completion summarizer. */
  summarize?: SummarizeFn;
}

export interface PrepareYoutubeSummaryResult {
  ok: boolean;
  status: "prepared" | "needs_input";
  workflow: WorkflowSummary | null;
  runId?: string;
  markdown: string;
  transcriptUsed: boolean;
  summaryGenerated: boolean;
  videoId?: string;
  missing?: string[];
  reason?: string;
}

// Test seam (mirrors content/pipeline.ts's _setContentRendererForTests): lets the
// server-level POST /tasks route test override the live fetchers/summarizer so the
// route is exercised deterministically without touching the network.
let depsForTests: YoutubeSummaryDeps | null = null;
export function _setYoutubeSummaryDepsForTests(deps: YoutubeSummaryDeps | null): void {
  depsForTests = deps;
}

/** Default summarizer — wraps the existing local/frontier completion helper. Honest null when unconfigured. */
async function defaultSummarize(
  input: SummarizeInput,
): Promise<{ summary: string; keyPoints: string[] } | null> {
  try {
    const { renderViaCompletion } = await import("@/lib/content/render");
    const transcript = input.transcript.slice(0, TRANSCRIPT_CHAR_LIMIT * 2);
    const prompt = [
      "Summarize the following YouTube video transcript for an operator's review.",
      "Be faithful to the transcript — do not invent facts not present in it.",
      "Return EXACTLY this format and nothing else:",
      "",
      "SUMMARY: <2-4 sentence concise summary>",
      "KEY POINTS:",
      "- <key point>",
      "- <key point>",
      "",
      `Title: ${input.title ?? "(unknown)"}`,
      "Transcript:",
      transcript,
    ].join("\n");
    const out = await renderViaCompletion(prompt);
    if (!out.ok || !out.text.trim()) return null;
    return parseSummaryResponse(out.text);
  } catch {
    return null;
  }
}

async function defaultFetchTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
      {
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" },
        signal: AbortSignal.timeout(15_000),
      },
    );
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
  // Explicit per-call deps win; otherwise the test seam; otherwise live defaults.
  const fx = depsForTests ?? {};

  const url = (input.url ?? "").trim();
  if (!url) {
    return {
      ok: false,
      status: "needs_input",
      workflow,
      markdown: "",
      transcriptUsed: false,
      summaryGenerated: false,
      missing: ["url"],
    };
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return {
      ok: false,
      status: "needs_input",
      workflow,
      markdown: "",
      transcriptUsed: false,
      summaryGenerated: false,
      missing: ["url"],
      reason: `Could not extract a YouTube video ID from: ${url}`,
    };
  }

  const fetchTranscriptFn = deps.fetchTranscript ?? fx.fetchTranscript ?? (async (id: string) => {
    const { fetchTranscript } = await import("@/lib/youtube/transcript");
    return fetchTranscript(id);
  });
  const fetchTitleFn = deps.fetchTitle ?? fx.fetchTitle ?? defaultFetchTitle;
  const summarizeFn = deps.summarize ?? fx.summarize ?? defaultSummarize;

  const [transcript, fetchedTitle] = await Promise.all([
    fetchTranscriptFn(videoId).catch(() => null),
    fetchTitleFn(videoId).catch(() => null),
  ]);

  // Only summarize when there is a real transcript — never hallucinate from nothing.
  let summary: string | null = null;
  let keyPoints: string[] | null = null;
  if (transcript) {
    const generated = await summarizeFn({ transcript, title: fetchedTitle, url }).catch(() => null);
    if (generated && generated.summary.trim()) {
      summary = generated.summary.trim();
      keyPoints = generated.keyPoints;
    }
  }
  const summaryGenerated = !!summary;

  const markdown = buildYoutubeSummaryMarkdown(
    { url, videoId, titleOverride: input.title },
    { transcript, title: fetchedTitle, summary, keyPoints },
  );

  const run = createWorkflowRun({
    workflowId: WORKFLOW_ID,
    title: `YouTube summary: ${fetchedTitle ?? videoId}`,
    status: "preparing",
    currentStep: "building summary artifact",
  });

  linkWorkflowRunArtifact(run.id, "summaryMarkdown", markdown);
  linkWorkflowRunArtifact(run.id, "sourceUrl", url);
  linkWorkflowRunArtifact(run.id, "videoId", videoId);
  linkWorkflowRunArtifact(run.id, "transcriptUsed", !!transcript);
  linkWorkflowRunArtifact(run.id, "summaryGenerated", summaryGenerated);

  updateWorkflowRunStatus(run.id, "needs_review", {
    currentStep: summaryGenerated
      ? "summary ready for human review"
      : "transcript captured — summary needs generation/review",
  });

  return {
    ok: true,
    status: "prepared",
    workflow,
    runId: run.id,
    markdown,
    transcriptUsed: !!transcript,
    summaryGenerated,
    videoId,
  };
}
