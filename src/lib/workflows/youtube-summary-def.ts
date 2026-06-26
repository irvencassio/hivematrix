/**
 * Workflow definition: YouTube video summary.
 *
 * Pure data — discovery metadata only (def-only module, like content-research-brief.ts,
 * so the registry can import it without pulling in the prepare logic / runs store).
 * Low-risk: public transcript fetch only, no Browser Lane, human-reviewed output.
 */

import type { WorkflowDefinition } from "./registry";

export const YOUTUBE_SUMMARY_WORKFLOW: WorkflowDefinition = {
  id: "content.youtube_summary",
  name: "YouTube video summary",
  description:
    "Fetch the transcript for a public YouTube video and produce a structured summary artifact for human review. No Browser Lane required for public videos — transcript is fetched daemon-side. Browser Lane is recommended only when the video is private, age-restricted, or requires login.",
  lane: "review",
  capability: "content.youtube.summary",
  inputSchema: [
    {
      name: "url",
      type: "string",
      required: true,
      description: "The YouTube video URL (youtube.com/watch?v= or youtu.be/).",
    },
    {
      name: "title",
      type: "string",
      required: false,
      description: "Optional title override (model may pre-fill from its context).",
    },
  ],
  readiness: {
    required: false,
    note: "No external readiness gate — transcript fetched from public YouTube directly. Browser Lane is only a fallback if the video requires auth.",
  },
  approvalPolicy: {
    mode: "manual",
    note: "Human reviews the transcript-based summary before using or publishing it. Nothing is posted or published.",
  },
  handoffPoints: [
    "MANUAL HANDOFF — Review: a person reviews the summary artifact before it is used or published.",
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
