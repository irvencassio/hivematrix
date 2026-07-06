/**
 * Workflow definition: Content research brief.
 *
 * Pure data — discovery metadata only (def-only module, so the registry can import
 * it without pulling in the prepare logic / runs store).
 * Low-risk: local research only, no external side effects, human-reviewed output.
 */

import type { WorkflowDefinition } from "./registry";

export const CONTENT_RESEARCH_BRIEF_WORKFLOW: WorkflowDefinition = {
  id: "content.research_brief",
  name: "Content research brief",
  description:
    "Prepare a structured markdown research brief for a content/video topic — audience, objective, local sources, key points, open questions, and a suggested next action. Read-only and human-reviewed; no external side effects.",
  lane: "review",
  capability: "research.brief",
  inputSchema: [
    { name: "topic", type: "string", required: true, description: "The topic to research." },
    { name: "audience", type: "string", required: false, description: "Who the content is for." },
    { name: "objective", type: "string", required: false, description: "What the content should achieve." },
    { name: "sources", type: "string[]", required: false, description: "Optional source URLs or references to consider." },
  ],
  readiness: {
    required: false,
    note: "No external readiness gate — the brief is assembled from local context only.",
  },
  approvalPolicy: {
    mode: "manual",
    note: "Human review the brief before using or publishing it. Nothing is posted or published.",
  },
  handoffPoints: [
    "MANUAL HANDOFF — Review: a person reviews the brief before it is used or published.",
  ],
  artifacts: [
    "Markdown research brief",
    "Cited local sources",
    "Open questions",
    "Suggested next action",
  ],
  runbook: "docs/runbooks/content-research-brief.md",
  routing: {
    domains: [],
    phrases: ["research brief", "content brief", "prepare topic brief", "topic brief", "brief on"],
    tags: ["research", "content", "brief"],
  },
  handler: "content-research-brief",
};
