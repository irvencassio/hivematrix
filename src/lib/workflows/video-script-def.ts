/**
 * Workflow definition: Video script from a research brief.
 *
 * Pure data — discovery metadata only (def-only module, so the registry imports it
 * without pulling in the prepare logic / runs store). The script-development step
 * between research and HeyGen: it drafts a script for human review; the "either
 * briefMarkdown or sourceRunId" rule is enforced in the handler, not the schema.
 * Low-risk: no external side effects, no publishing, no Browser Lane task creation.
 */

import type { WorkflowDefinition } from "./registry";

export const VIDEO_SCRIPT_WORKFLOW: WorkflowDefinition = {
  id: "content.video_script_from_brief",
  name: "Video script from brief",
  description:
    "Draft a video script from a research brief (or topic) — title, hook, beat outline, narration, CTA, and open questions. The script is a DRAFT for human review; preparing it has no external side effects and creates no Browser Lane task.",
  lane: "review",
  capability: "content.script",
  inputSchema: [
    { name: "topic", type: "string", required: true, description: "The video topic." },
    { name: "audience", type: "string", required: false, description: "Who the video is for." },
    { name: "objective", type: "string", required: false, description: "What the video should achieve." },
    { name: "briefMarkdown", type: "string", required: false, description: "The research brief markdown to draft from (or pass sourceRunId)." },
    { name: "sourceRunId", type: "string", required: false, description: "A prior content.research_brief run whose briefMarkdown artifact seeds the script." },
    { name: "tone", type: "string", required: false, description: "Optional tone (e.g. upbeat, authoritative)." },
    { name: "duration", type: "string", required: false, description: "Optional target length (e.g. 60s)." },
  ],
  readiness: {
    required: false,
    note: "No external readiness gate — the draft is assembled from local context only.",
  },
  approvalPolicy: {
    mode: "manual",
    note: "The script is a draft. A person reviews and edits it before it is recorded or used.",
  },
  handoffPoints: [
    "MANUAL HANDOFF — Review: a person reviews and edits the draft script before it is recorded.",
  ],
  artifacts: [
    "Draft video script (markdown + plain narration)",
    "Hook, beat outline, and CTA",
    "Assumptions / open questions",
  ],
  runbook: "docs/runbooks/content-research-brief.md",
  routing: {
    domains: [],
    phrases: ["video script", "script from brief", "draft a script", "draft a video script", "write a script"],
    tags: ["content", "script", "research"],
  },
  handler: "content-video-script",
};
