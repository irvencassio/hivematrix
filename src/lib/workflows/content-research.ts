/**
 * Content research brief — prepare logic for the content.research_brief workflow.
 *
 * Low-risk and deterministic: assembles a structured markdown brief from the inputs
 * plus any safe LOCAL context (the brain, read-only). No external side effects, no
 * posting/publishing. Search is injectable so tests need no live web or brain root.
 * Snippets are secret-scrubbed before they enter the brief.
 */

import { ContractValidationError } from "@/lib/central/contracts";
import { createWorkflowRun, linkWorkflowRunArtifact, updateWorkflowRunStatus } from "./runs";
import { proposeWorkflowAction } from "./actions";
import { getWorkflowRegistry, summarizeWorkflow, type WorkflowSummary } from "./registry";

const SCRIPT_TARGET = "content.video_script_from_brief";

const WORKFLOW_ID = "content.research_brief";

export interface ResearchBriefInput {
  topic: string;
  audience?: string;
  objective?: string;
  sources?: string[];
}

export interface ResearchBriefContext {
  hits: Array<{ path: string; snippet: string }>;
  providedSources: string[];
}

/** Light value-level secret scrub for local snippets (key=value / bearer / cookies). */
function scrubSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b((?:set-)?cookie|password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|session)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, "$1=[redacted]");
}

function bullets(items: string[], empty: string): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
}

/** Pure, deterministic markdown for a research brief. Secret-scrubbed. */
export function buildResearchBriefMarkdown(input: ResearchBriefInput, context: ResearchBriefContext): string {
  const topic = input.topic.trim();
  const audience = input.audience?.trim() || "(unspecified)";
  const objective = input.objective?.trim() || "(unspecified)";

  const localSources = context.hits.map((h) => `${h.path}`);
  const sources = [...context.providedSources, ...localSources];
  const keyPoints = context.hits.slice(0, 5).map((h) => scrubSecrets(h.snippet.replace(/\s+/g, " ").trim()).slice(0, 200));

  const openQuestions = [
    `What does ${audience === "(unspecified)" ? "the audience" : audience} already know about ${topic}?`,
    "What is the single most important takeaway?",
    "Which credible sources are still missing?",
  ];

  return [
    `# Research brief: ${topic}`,
    "",
    `- Audience: ${audience}`,
    `- Objective: ${objective}`,
    "",
    "## Sources considered",
    bullets(sources, "No sources provided or found locally — start from primary research."),
    "",
    "## Key points",
    bullets(keyPoints, "No local context found — gather primary research before drafting."),
    "",
    "## Open questions",
    bullets(openQuestions, ""),
    "",
    "## Suggested next action",
    `- Review and refine this brief, then draft a script (e.g. for the HeyGen portal video workflow) once it is approved.`,
    "",
    "_Human review required before using or publishing. This brief has no external side effects._",
    "",
  ].join("\n");
}

export interface ResearchBriefDeps {
  /** Local context search (default: searchBrain — read-only). Injectable for tests. */
  search?: (query: string) => Promise<{ hits: Array<{ path: string; snippet: string }> }>;
}

export interface PrepareResearchBriefResult {
  workflow: WorkflowSummary;
  runId: string;
  markdown: string;
  sources: string[];
  openQuestions: string[];
  nextAction: string;
  /** A durable, explicitly-executable proposal for the next workflow (model-facing). */
  proposedAction: { id: string; targetWorkflowId: string; title: string } | null;
}

const NEXT_ACTION = "Review and refine, then draft a script for the HeyGen portal video workflow once approved.";

export async function prepareContentResearchBrief(input: ResearchBriefInput, deps: ResearchBriefDeps = {}): Promise<PrepareResearchBriefResult> {
  const topic = (input.topic ?? "").trim();
  if (!topic) throw new ContractValidationError("topic is required to prepare a research brief");

  const search = deps.search ?? (async (q: string) => {
    const { searchBrain } = await import("@/lib/brain/search");
    return searchBrain(q, { maxResults: 5 });
  });

  let hits: Array<{ path: string; snippet: string }> = [];
  try {
    const found = await search(topic);
    hits = (found.hits ?? []).map((h) => ({ path: h.path, snippet: h.snippet }));
  } catch { /* local context is best-effort; the brief still has value without it */ }

  const providedSources = (input.sources ?? []).map((s) => s.trim()).filter(Boolean);
  const context: ResearchBriefContext = { hits, providedSources };
  const markdown = buildResearchBriefMarkdown(input, context);
  const sources = [...providedSources, ...hits.map((h) => h.path)];
  const openQuestions = [
    `What does ${input.audience?.trim() || "the audience"} already know about ${topic}?`,
    "What is the single most important takeaway?",
    "Which credible sources are still missing?",
  ];

  const run = createWorkflowRun({
    workflowId: WORKFLOW_ID,
    title: `Research brief: ${topic}`,
    status: "preparing",
    currentStep: "assembling brief",
  });
  linkWorkflowRunArtifact(run.id, "briefMarkdown", markdown);
  linkWorkflowRunArtifact(run.id, "sources", sources);
  linkWorkflowRunArtifact(run.id, "openQuestions", openQuestions);
  linkWorkflowRunArtifact(run.id, "nextAction", NEXT_ACTION);
  updateWorkflowRunStatus(run.id, "needs_review", { currentStep: "brief ready for human review" });

  // Propose (NOT execute) the next workflow: draft a video script from this brief. The
  // script workflow is the bridge to a HeyGen video — going straight to HeyGen would
  // only return needs_input["script"]. The proposal carries the brief linkage.
  let proposedAction: PrepareResearchBriefResult["proposedAction"] = null;
  if (getWorkflowRegistry().get(SCRIPT_TARGET)) {
    const action = proposeWorkflowAction({
      sourceRunId: run.id,
      targetWorkflowId: SCRIPT_TARGET,
      title: `Video script: ${topic}`,
      reason: "Draft a video script from this research brief, then review it before recording.",
      suggestedInputs: { topic, sourceRunId: run.id, audience: input.audience?.trim() || undefined, objective: input.objective?.trim() || undefined },
    });
    proposedAction = { id: action.id, targetWorkflowId: action.targetWorkflowId, title: action.title };
  }

  return {
    workflow: summarizeWorkflow(getWorkflowRegistry().get(WORKFLOW_ID)!),
    runId: run.id,
    markdown,
    sources,
    openQuestions,
    nextAction: NEXT_ACTION,
    proposedAction,
  };
}
