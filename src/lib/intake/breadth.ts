/**
 * Breadth detection — a pure, deterministic check for whether a prompt is broad
 * enough to warrant multi-step handling. The Work Package / Flight decomposition
 * subsystem was removed (2026-07-06); broad prompts now dispatch as a single task
 * with `workflow: "work"` and the frontier coding harness plans its own subtasks
 * via Superpowers. This module keeps only the breadth signal the /tasks route and
 * lane detectors use to decide "broad → self-plan" vs "narrow → lane/normal".
 *
 * No IO, no LLM, no DB.
 */

const BROAD_KEYWORD_RE = /\bfix all\b|\ball (the|of the|of)\b|\bevery(thing|where)?\b|\bacross the (codebase|repo(sitory)?|project)\b|\b(the whole|entire)\b|\bmigrate\b|\band then\b/i;

/** Layered splitter: first splitter to yield >=2 substantive fragments wins. */
function splitFragments(text: string): string[] {
  const t = text.trim();
  const splitters: RegExp[] = [
    /\s*\d+[.)]\s+/, // numbered: "1. ", "2) "
    /\n+|\s*[-*]\s+/, // newlines / bullets
    /\s+and then\s+/i, // sequential conjunction
    /;\s*/, // semicolon list
    /,\s*(?:and\s+)?/i, // comma list, optional "and"
  ];
  for (const re of splitters) {
    const parts = t
      .split(re)
      .map((p) => p.replace(/[.!?,;]+$/, "").trim())
      .filter((p) => p.length > 2);
    if (parts.length >= 2) return parts;
  }
  return [t];
}

function numberedCount(text: string): number {
  return (text.match(/(?:^|\s)\d+[.)]\s+/g) ?? []).length;
}

/**
 * Is the prompt broad enough to be worth a multi-step breakdown? Broad "auto"
 * prompts dispatch as a single task with workflow:"work" so the coding harness
 * self-plans; narrow prompts fall through to lane/normal routing.
 */
export function isBroadPrompt(description: string): boolean {
  const text = (description ?? "").trim();
  if (!text) return false;
  return BROAD_KEYWORD_RE.test(text) || numberedCount(text) >= 2 || splitFragments(text).length >= 3;
}
