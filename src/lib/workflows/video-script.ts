/**
 * Video script from brief — prepare logic for the content.video_script_from_brief
 * workflow. Deterministic and low-risk: drafts a script from a topic + research brief,
 * creates a needs_review run, and PROPOSES (never executes) a HeyGen action carrying a
 * real script. No external side effects, no Browser Lane task creation, no secrets.
 */

import { ContractValidationError } from "@/lib/central/contracts";
import { createWorkflowRun, getWorkflowRun, linkWorkflowRunArtifact, updateWorkflowRunStatus } from "./runs";
import { proposeWorkflowAction } from "./actions";
import { getWorkflowRegistry, summarizeWorkflow, type WorkflowSummary } from "./registry";

const WORKFLOW_ID = "content.video_script_from_brief";
const HEYGEN_TARGET = "heygen.portal_video_from_script";

export interface VideoScriptInput {
  topic: string;
  audience?: string;
  objective?: string;
  briefMarkdown?: string;
  sourceRunId?: string;
  tone?: string;
  duration?: string;
}

export interface VideoScriptContext {
  briefExcerpt: string;
}

/** Light value-level secret scrub (key=value / bearer / cookies). */
function scrubSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b((?:set-)?cookie|password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|session)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, "$1=[redacted]");
}

function audienceOf(input: VideoScriptInput): string {
  return input.audience?.trim() || "the audience";
}

/** Deterministic beat outline. */
function beats(input: VideoScriptInput): string[] {
  const topic = input.topic.trim();
  const out = [
    "Open with the hook",
    `Why ${topic} matters to ${audienceOf(input)}`,
    `The key insight: how ${topic} actually helps`,
  ];
  if (input.objective?.trim()) out.push(`Show how it achieves: ${input.objective.trim()}`);
  out.push("A concrete example");
  out.push("Close with the call to action");
  return out;
}

function hookOf(input: VideoScriptInput): string {
  return `Here's what every ${audienceOf(input)} should know about ${input.topic.trim()}.`;
}

function ctaOf(input: VideoScriptInput): string {
  return `If this was useful, follow for more on ${input.topic.trim()}.`;
}

/** Pure, deterministic narration text (the real "script"). Secret-scrubbed. */
export function buildVideoScriptText(input: VideoScriptInput, context: VideoScriptContext): string {
  const topic = input.topic.trim();
  const excerpt = scrubSecrets((context.briefExcerpt || "").replace(/\s+/g, " ").trim()).slice(0, 300);
  const lines = [
    hookOf(input),
    `${topic} is changing how ${audienceOf(input)} work.`,
    excerpt ? `From the research: ${excerpt}.` : `Here's the core idea, in plain terms.`,
    input.objective?.trim() ? `The goal: ${input.objective.trim()}.` : `The takeaway is simple and practical.`,
    `Here's a concrete example you can apply today.`,
    ctaOf(input),
  ];
  return lines.join("\n\n");
}

/** Pure, deterministic full script document (markdown, DRAFT banner). Secret-scrubbed. */
export function buildVideoScriptMarkdown(input: VideoScriptInput, context: VideoScriptContext): string {
  const topic = input.topic.trim();
  const beatList = beats(input).map((b, i) => `${i + 1}. ${b}`).join("\n");
  return [
    `# Video script: ${topic}`,
    "",
    "> DRAFT video script — requires human review and editing before it is recorded or used.",
    "",
    `- Audience: ${input.audience?.trim() || "(unspecified)"}`,
    `- Objective: ${input.objective?.trim() || "(unspecified)"}`,
    `- Tone: ${input.tone?.trim() || "informative"}`,
    `- Target length: ${input.duration?.trim() || "60s"}`,
    "",
    `**Hook:** ${hookOf(input)}`,
    "",
    "## Beats",
    beatList,
    "",
    "## Script",
    buildVideoScriptText(input, context),
    "",
    `**CTA:** ${ctaOf(input)}`,
    "",
    "## Assumptions / open questions",
    "- Verify any facts pulled from the brief before recording.",
    `- Is the tone right for ${audienceOf(input)}?`,
    "- Does the hook earn the first five seconds?",
    "",
  ].join("\n");
}

export interface VideoScriptDeps {
  /** Load a prior run (default: getWorkflowRun). Injectable for tests. */
  getRun?: (id: string) => { artifacts: Record<string, unknown> } | null;
}

export interface PrepareVideoScriptResult {
  workflow: WorkflowSummary;
  runId: string;
  title: string;
  script: string;
  markdown: string;
  isDraft: true;
  proposedAction: { id: string; targetWorkflowId: string; title: string } | null;
}

export async function prepareVideoScriptFromBrief(input: VideoScriptInput, deps: VideoScriptDeps = {}): Promise<PrepareVideoScriptResult> {
  const topic = (input.topic ?? "").trim();
  if (!topic) throw new ContractValidationError("topic is required to draft a video script");

  let briefMarkdown = input.briefMarkdown?.trim() ?? "";
  if (!briefMarkdown && input.sourceRunId) {
    const getRun = deps.getRun ?? getWorkflowRun;
    const source = getRun(input.sourceRunId);
    const fromArtifact = source?.artifacts?.briefMarkdown;
    if (typeof fromArtifact === "string") briefMarkdown = fromArtifact;
  }
  if (!briefMarkdown) {
    throw new ContractValidationError("a briefMarkdown or a sourceRunId with a briefMarkdown artifact is required");
  }

  const context: VideoScriptContext = { briefExcerpt: briefMarkdown };
  const title = `Video: ${topic}`;
  const script = buildVideoScriptText(input, context);
  const markdown = buildVideoScriptMarkdown(input, context);

  const run = createWorkflowRun({ workflowId: WORKFLOW_ID, title: `Video script: ${topic}`, status: "drafting", currentStep: "drafting script" });
  linkWorkflowRunArtifact(run.id, "scriptMarkdown", markdown);
  linkWorkflowRunArtifact(run.id, "scriptText", script);
  linkWorkflowRunArtifact(run.id, "title", title);
  linkWorkflowRunArtifact(run.id, "hook", hookOf(input));
  linkWorkflowRunArtifact(run.id, "beats", beats(input));
  linkWorkflowRunArtifact(run.id, "cta", ctaOf(input));
  updateWorkflowRunStatus(run.id, "needs_review", { currentStep: "draft script ready for human review" });

  // Propose (NOT execute) the HeyGen portal video with a REAL script + title — so the
  // action can prepare successfully once the operator approves the draft. Preparing it
  // never creates a Browser Lane task.
  let proposedAction: PrepareVideoScriptResult["proposedAction"] = null;
  if (getWorkflowRegistry().get(HEYGEN_TARGET)) {
    const action = proposeWorkflowAction({
      sourceRunId: run.id,
      targetWorkflowId: HEYGEN_TARGET,
      title,
      reason: "Requires script approval. Once the draft script is approved, turn it into a HeyGen portal video.",
      suggestedInputs: { title, script },
      // Pull the CURRENT (possibly revised) script + title from this run at execute time.
      sourceArtifactMap: { script: "scriptText", title: "title" },
    });
    proposedAction = { id: action.id, targetWorkflowId: action.targetWorkflowId, title: action.title };
  }

  return { workflow: summarizeWorkflow(getWorkflowRegistry().get(WORKFLOW_ID)!), runId: run.id, title, script, markdown, isDraft: true, proposedAction };
}
