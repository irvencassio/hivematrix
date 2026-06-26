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
}

/** Pure, deterministic markdown for a YouTube summary artifact. */
export function buildYoutubeSummaryMarkdown(
  input: YoutubeSummaryBuildInput,
  context: YoutubeSummaryContext,
): string {
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
      truncated ? "\n_[truncated] — full transcript available on YouTube_" : "",
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
  /** Injectable for tests — defaults to live YouTube page scraper. */
  fetchTranscript?: (videoId: string) => Promise<string | null>;
  /** Injectable for tests — defaults to og:title scrape. */
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

  const url = (input.url ?? "").trim();
  if (!url) {
    return {
      ok: false,
      status: "needs_input",
      workflow,
      markdown: "",
      transcriptUsed: false,
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
      missing: ["url"],
      reason: `Could not extract a YouTube video ID from: ${url}`,
    };
  }

  const fetchTranscriptFn = deps.fetchTranscript ?? (async (id: string) => {
    const { fetchTranscript } = await import("@/lib/youtube/transcript");
    return fetchTranscript(id);
  });
  const fetchTitleFn = deps.fetchTitle ?? defaultFetchTitle;

  const [transcript, fetchedTitle] = await Promise.all([
    fetchTranscriptFn(videoId).catch(() => null),
    fetchTitleFn(videoId).catch(() => null),
  ]);

  const markdown = buildYoutubeSummaryMarkdown(
    { url, videoId, titleOverride: input.title },
    { transcript, title: fetchedTitle },
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

  updateWorkflowRunStatus(run.id, "needs_review", {
    currentStep: "summary ready for human review",
  });

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
