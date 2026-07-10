/**
 * Prompt wizard: rewrites a rough New-Task ask into a clear, self-contained
 * prompt using the local Qwen model, and SUGGESTS an agent role for it — a
 * human is looking at the preview before Create, so classification happens
 * where it can be corrected, instead of silently in a scheduler tick later.
 * Never blocks task creation — every failure path (no local model, HTTP
 * error, bad JSON, an invalid/hallucinated role) falls back to returning the
 * raw prompt with agentType "auto", unchanged.
 *
 * Role-neutral by design: earlier versions of this prompt hard-coded "a
 * coding-agent task queue" and told the model to infer file paths, so every
 * task — including "write the launch blog post" — got rewritten into a
 * coding-shaped prompt before the role was even known, and role
 * classification downstream (intent-classifier.ts) then read that already
 * coding-biased text. The rewrite is now conditioned on the SUGGESTED role,
 * decided in the same call, and only a developer/qa/designer suggestion
 * pulls in file-path/test-shaped structure.
 */

import { hasLocalCompletionModel, localChatComplete, type ChatComplete, type ChatMessage } from "@/lib/models/chat-client";
import { stripThinkBlocks } from "@/lib/models/deep-think";
import { getCoreAgentProfiles } from "@/lib/config/agent-profiles";

export interface EnhanceResult {
  enhanced: string;
  rationale: string;
  /** Short (<=60 char) task name for the board/sidebar. Empty on passthrough — the
   * caller falls back to deriving a title from the raw description as before. */
  title: string;
  /** A core-roster profile id, or "auto" (never a coordinator/domain id,
   * never a hallucinated id — validated against the live roster before
   * being returned). This is a SUGGESTION: the operator's own pick on the
   * New Task role select always wins over it. */
  agentType: string;
}

const MAX_TITLE_LEN = 60;

function buildRoleChoices(): string {
  return getCoreAgentProfiles().map((p) => `- ${p.id}: ${p.description}`).join("\n");
}

function buildSystemPrompt(): string {
  return "You are a prompt wizard for a task queue shared by several specialist agent roles. Given the "
    + "user's rough request, do three things:\n\n"
    + "1. Pick the ONE role below that best fits the request — respond with its id, or \"auto\" if it "
    + "is genuinely ambiguous. Do not guess a role the request doesn't support.\n\n"
    + `Roles:\n${buildRoleChoices()}\n\n`
    + "2. Write a short task name: a single line, under " + String(MAX_TITLE_LEN) + " characters, no "
    + "markdown, that identifies the task at a glance (e.g. \"Fix login redirect loop\", not \"Fix the "
    + "bug\").\n\n"
    + "3. Rewrite the request into a clear, self-contained prompt that role can execute without "
    + "follow-up questions, structured for THAT role's kind of work — not generic. A developer/qa/"
    + "designer task gets an objective, relevant context/constraints, a concrete approach, and a "
    + "done-checklist (infer file paths only when strongly implied by the request). A researcher task "
    + "gets a scope and the sources/questions to cover — no file paths, no code, no test steps. A "
    + "founder/marketing/general task gets the objective and any stated constraints in plain language — "
    + "never invent a coding structure, file paths, or a test/build step for work that isn't code. Never "
    + "invent requirements, scope, or facts the user did not state. If the request is already "
    + "well-specified, return it largely unchanged.\n\n"
    + "Respond with ONLY a JSON object: {\"agentType\": \"<a role id from the list above, or "
    + "\\\"auto\\\">\", \"title\": \"<the short task name>\", \"enhanced\": \"<the rewritten prompt as "
    + "markdown>\", \"rationale\": \"<one sentence on what you changed>\"}.";
}

function passthrough(raw: string): EnhanceResult {
  return { enhanced: raw, rationale: "", title: "", agentType: "auto" };
}

export async function enhancePrompt(raw: string, opts?: { chatComplete?: ChatComplete }): Promise<EnhanceResult> {
  const chatComplete = opts?.chatComplete;
  if (!chatComplete && !hasLocalCompletionModel()) return passthrough(raw);
  const complete = chatComplete ?? ((messages: ChatMessage[], chatOpts?: Parameters<ChatComplete>[1]) => localChatComplete(messages, chatOpts));

  let reply: string;
  try {
    reply = await complete(
      [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: raw },
      ],
      { temperature: 0.3, maxTokens: 1200, timeoutMs: 30_000, reasoningEffort: "low" },
    );
  } catch {
    return passthrough(raw);
  }

  const cleaned = stripThinkBlocks(reply);
  let enhanced = "";
  let rationale = "";
  let title = "";
  let agentType = "auto";
  try {
    const parsed = JSON.parse(cleaned) as { enhanced?: unknown; rationale?: unknown; title?: unknown; agentType?: unknown };
    if (typeof parsed.enhanced === "string") enhanced = parsed.enhanced;
    if (typeof parsed.rationale === "string") rationale = parsed.rationale;
    if (typeof parsed.title === "string") title = parsed.title;
    if (typeof parsed.agentType === "string") agentType = parsed.agentType;
  } catch {
    enhanced = cleaned;
    rationale = "";
  }

  if (!enhanced.trim()) return passthrough(raw);
  return { enhanced, rationale, title: cleanTitle(title), agentType: validateAgentType(agentType) };
}

/** Never trust the model's role choice verbatim — a hallucinated or
 * coordinator/domain id (which the wizard must never suggest; those are
 * explicit-pick only) falls back to "auto", exactly like every other
 * failure path in this module. */
function validateAgentType(raw: string): string {
  if (raw === "auto") return "auto";
  const core = getCoreAgentProfiles();
  return core.some((p) => p.id === raw) ? raw : "auto";
}

/** One line, no markdown, capped to MAX_TITLE_LEN — a model that ignores the
 * length/formatting instruction shouldn't produce a title the board can't fit. */
function cleanTitle(raw: string): string {
  const oneLine = raw.split("\n")[0].replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim();
  if (oneLine.length <= MAX_TITLE_LEN) return oneLine;
  const slice = oneLine.slice(0, MAX_TITLE_LEN);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 20 ? slice.slice(0, lastSpace) : slice).trim() + "…";
}
