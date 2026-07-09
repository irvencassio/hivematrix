/**
 * Prompt wizard: rewrites a rough New-Task ask into a structured prompt (objective,
 * context, approach, done-checklist) using the local Qwen model. Never blocks task
 * creation — every failure path (no local model, HTTP error, bad JSON) falls back to
 * returning the raw prompt unchanged.
 */

import { hasLocalCompletionModel, localChatComplete, type ChatComplete, type ChatMessage } from "@/lib/models/chat-client";
import { stripThinkBlocks } from "@/lib/models/deep-think";

export interface EnhanceResult {
  enhanced: string;
  rationale: string;
}

const SYSTEM_PROMPT = "You are a prompt wizard for a coding-agent task queue. Rewrite the user's rough request "
  + "into a clear, self-contained task prompt that a coding agent can execute without "
  + "follow-up questions. Structure it as: a one-line objective; relevant context/constraints; "
  + "a concrete step-by-step approach; and a short done-checklist of verifiable outcomes. "
  + "Infer likely file paths only when strongly implied — never invent requirements, scope, "
  + "or facts the user did not state. If the request is already well-specified, return it "
  + "largely unchanged. Respond with ONLY a JSON object: {\"enhanced\": \"<the rewritten "
  + "prompt as markdown>\", \"rationale\": \"<one sentence on what you changed>\"}.";

function passthrough(raw: string): EnhanceResult {
  return { enhanced: raw, rationale: "" };
}

export async function enhancePrompt(raw: string, opts?: { chatComplete?: ChatComplete }): Promise<EnhanceResult> {
  const chatComplete = opts?.chatComplete;
  if (!chatComplete && !hasLocalCompletionModel()) return passthrough(raw);
  const complete = chatComplete ?? ((messages: ChatMessage[], chatOpts?: Parameters<ChatComplete>[1]) => localChatComplete(messages, chatOpts));

  let reply: string;
  try {
    reply = await complete(
      [
        { role: "system", content: SYSTEM_PROMPT },
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
  try {
    const parsed = JSON.parse(cleaned) as { enhanced?: unknown; rationale?: unknown };
    if (typeof parsed.enhanced === "string") enhanced = parsed.enhanced;
    if (typeof parsed.rationale === "string") rationale = parsed.rationale;
  } catch {
    enhanced = cleaned;
    rationale = "";
  }

  if (!enhanced.trim()) return passthrough(raw);
  return { enhanced, rationale };
}
