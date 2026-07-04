/**
 * Model-advised decomposition of a broad prompt into work-package step
 * fragments. Backend-agnostic and KEYLESS: the resolved completion client is
 * local Qwen (HTTP) or a codex/ChatGPT CLI session — never a cloud API key, and
 * never Claude/Anthropic.
 *
 * The model only proposes step TEXT. All safety policy (risk, the held
 * release/deploy gate, dependency gating, concurrency) is applied deterministically
 * downstream by proposedItemsFromFragments() in classify.ts — so the model can
 * never escalate risk or bypass a gate. On any failure (offline, no client, bad
 * output, throw) decompose returns null and intake uses the deterministic split.
 *
 * See docs/superpowers/specs/2026-06-27-model-advised-decomposition-design.md.
 */

import { resolveCompletionClient, hasLocalCompletionModel, type ChatComplete } from "@/lib/models/chat-client";
import { getQwenProfile } from "@/lib/config/qwen-profile";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import type { IntakeInput } from "./classify";

export const MAX_STEPS = 12;

// Token budget for the step list. A reasoning model (DeepSeek/DwarfStar with
// thinking enabled) spends tokens inside <think> before emitting the JSON array,
// so a tight budget can be exhausted mid-thought and yield no parseable steps.
// The output itself is small (≤12 short strings); the extra headroom covers the
// thinking pass so the array actually lands.
export const DECOMPOSE_MAX_TOKENS = 1024;
export const DECOMPOSE_MAX_TOKENS_THINKING = 4096;

// A local reasoning model spends ~20s prefilling the prompt before its first
// token, plus the thinking pass, so the chat client's 12s default aborts every
// decompose. This budget lets the array actually land; on genuine unavailability
// the call still fails and intake uses the deterministic split.
export const DECOMPOSE_TIMEOUT_MS = 60_000;

/** Goal Flight context that makes the split goal-aware and criteria-covering. */
export interface DecomposeGoalContext {
  goal: string;
  successCriteria: string[];
  constraints?: string[];
}

export interface DecomposeDeps {
  client?: ChatComplete | null;
  connectivityMode?: string;
  force?: boolean;
  /**
   * When the prompt is a Goal Flight, its extracted goal + success criteria.
   * Present → the model is told the goal and asked to cover every criterion.
   */
  goalFlight?: DecomposeGoalContext | null;
  /** Override local-model availability (tests). Defaults to hasLocalCompletionModel(). */
  localModelAvailable?: boolean;
  /** Override reasoning-budget sizing (tests). Defaults to the Qwen profile's thinkingEnabled. */
  thinkingEnabled?: boolean;
}

/** Robustly extract a list of step strings from a model reply. Never throws. */
export function parseSteps(raw: string): string[] {
  if (!raw) return [];
  // Strip reasoning blocks emitted by reasoning models (Qwen <think>…</think>).
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  let steps: string[] = [];
  // Prefer the first JSON array of strings.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(arr)) steps = arr.filter((x): x is string => typeof x === "string");
    } catch { /* fall through to line parsing */ }
  }
  // Fallback: numbered / bulleted lines only.
  if (steps.length === 0) {
    steps = text
      .split(/\r?\n/)
      .filter((l) => /^\s*(?:\d+[.)]|[-*])\s+/.test(l))
      .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s+/, "").trim());
  }

  // Trim, drop empties, dedupe (preserve order).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of steps) {
    const t = s.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const SYSTEM_PROMPT =
  "You split a software goal into a short, ordered list of concrete, buildable steps.\n" +
  "Rules:\n" +
  "- Reply with ONLY a JSON array of step strings — no prose, no markdown, no object keys.\n" +
  '- Each step is ONE imperative sentence naming a concrete deliverable ("Add …", "Build …", "Wire …").\n' +
  "- Order steps so earlier steps are prerequisites of later ones (foundation → features → release).\n" +
  "- Cover every stated success criterion with at least one step.\n" +
  "- Keep it minimal: merge trivial steps, no more than 12, invent no unrelated work.\n" +
  "- Put any release / deploy / publish step last.";

/**
 * Build the chat messages. When goal context is present the user turn is
 * structured (goal + success criteria + constraints + full request) so the model
 * splits toward the goal and covers the criteria the Flight loop later checks;
 * otherwise it is the raw request text.
 */
export function buildMessages(description: string, goal?: DecomposeGoalContext | null) {
  let user = description;
  if (goal && goal.goal) {
    const parts = [`Goal: ${goal.goal}`];
    const criteria = (goal.successCriteria ?? []).filter((c) => c && c.trim());
    if (criteria.length) parts.push(`\nSuccess criteria (each must be covered by a step):\n${criteria.map((c) => `- ${c}`).join("\n")}`);
    const constraints = (goal.constraints ?? []).filter((c) => c && c.trim());
    if (constraints.length) parts.push(`\nConstraints:\n${constraints.map((c) => `- ${c}`).join("\n")}`);
    parts.push(`\nFull request:\n${description}`);
    user = parts.join("\n");
  }
  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: user },
  ];
}

/**
 * Decompose a prompt into step fragments using the configured keyless backend.
 * Returns null (→ deterministic fallback) when no client is configured, when
 * offline with no local model reachable, on malformed output, on fewer than two
 * steps, or on any error.
 *
 * A local loopback model (DeepSeek/DwarfStar on 127.0.0.1) is keyless and
 * reachable even fully offline, so decomposition uses it in every connectivity
 * mode; only the cloud CLI backend is disabled offline.
 */
export async function decompose(input: IntakeInput, deps: DecomposeDeps = {}): Promise<string[] | null> {
  const mode = deps.connectivityMode ?? getConnectivityPolicy().mode;

  const client = deps.client !== undefined ? deps.client : resolveCompletionClient(mode);
  if (!client) return null;

  // Offline: only a local loopback model is reachable; the cloud CLI is not.
  const localAvailable = deps.localModelAvailable ?? hasLocalCompletionModel();
  if (mode === "offline" && !localAvailable) return null;

  const thinking = deps.thinkingEnabled ?? getQwenProfile()?.thinkingEnabled ?? false;
  const maxTokens = thinking ? DECOMPOSE_MAX_TOKENS_THINKING : DECOMPOSE_MAX_TOKENS;

  try {
    // A reasoning model spends ~20s just prefilling the prompt before it emits a
    // token, so the chat client's 12s default would abort every thinking-mode
    // decompose and silently fall back to the regex split. Give the reasoning
    // pass room to land, and cap its effort — this is a mechanical list, not a
    // task that benefits from deep thinking.
    const reply = await client(buildMessages(input.description, deps.goalFlight ?? null), {
      maxTokens,
      temperature: 0,
      timeoutMs: DECOMPOSE_TIMEOUT_MS,
      reasoningEffort: "low",
    });
    const steps = parseSteps(reply);
    if (steps.length < 2) return null;
    return steps.slice(0, MAX_STEPS);
  } catch {
    return null;
  }
}
