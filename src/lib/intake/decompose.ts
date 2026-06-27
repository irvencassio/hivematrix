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

import { resolveCompletionClient, type ChatComplete } from "@/lib/models/chat-client";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import type { IntakeInput } from "./classify";

export const MAX_STEPS = 12;

export interface DecomposeDeps {
  client?: ChatComplete | null;
  connectivityMode?: string;
  force?: boolean;
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

function buildMessages(description: string) {
  return [
    {
      role: "system" as const,
      content:
        "You split a broad software request into a short, ordered list of concrete, independently-actionable steps. " +
        "Reply with ONLY a JSON array of step strings (no prose, no markdown). " +
        "Each step is one imperative sentence. Keep it minimal — merge trivial steps. Do not invent unrelated work.",
    },
    { role: "user" as const, content: description },
  ];
}

/**
 * Decompose a prompt into step fragments using the configured keyless backend.
 * Returns null (→ deterministic fallback) when offline, when no client is
 * configured, on malformed output, on fewer than two steps, or on any error.
 */
export async function decompose(input: IntakeInput, deps: DecomposeDeps = {}): Promise<string[] | null> {
  const mode = deps.connectivityMode ?? getConnectivityPolicy().mode;
  if (mode === "offline") return null;

  const client = deps.client !== undefined ? deps.client : resolveCompletionClient(mode);
  if (!client) return null;

  try {
    const reply = await client(buildMessages(input.description), { maxTokens: 1024, temperature: 0 });
    const steps = parseSteps(reply);
    if (steps.length < 2) return null;
    return steps.slice(0, MAX_STEPS);
  } catch {
    return null;
  }
}
