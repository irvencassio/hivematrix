/**
 * Parent Context Pack — the block prepended to every Flight (work-package) child
 * task prompt so a decomposed child never loses the parent Flight's intent. A
 * broad parent request is split into small item prompts; on its own a fragment
 * like "compute the daily threshold" reads as context-free and the child worker
 * ends up asking the operator for values (the 7-day window, 14.3%, …) that the
 * parent already specified.
 *
 * Pure + deterministic (no model): the pack carries the parent title, the full
 * parent description, the concrete examples/numbers/criteria extracted from it,
 * the sibling item list, and an explicit instruction to infer from parent context
 * before asking the operator — and, when truly stuck, to emit a structured
 * needs_parent_decision blocker for the Flight coordinator instead of a vague
 * operator question.
 *
 * See docs/superpowers/specs/2026-06-29-flight-child-autonomy-design.md.
 */

export interface ParentContextSource {
  /** Parent Flight title. */
  title: string;
  /** Full parent Flight description. */
  description: string;
  /** Parsed intake (used for goalFlight successCriteria/constraints). */
  intake?: Record<string, unknown> | null;
}

export interface SiblingSummary {
  title: string;
  status: string;
  done: boolean;
  /** Commit hash / short result summary when a completed sibling has one. */
  summary?: string | null;
}

/** The verbatim anti-vague-question instruction (asserted by tests + the UI spec). */
export const PARENT_CONTEXT_NO_VAGUE_QUESTIONS =
  "Do not ask the operator for clarification if the parent context gives a reasonable default. " +
  "Use the parent context and proceed.";

/** Sentences/clauses that contain a concrete anchor worth preserving. */
const ANCHOR_RE = /\d|%|\be\.g\.\b|\bfor example\b|\bacceptance\b|\bcriteria\b/i;

/**
 * Extract the concrete examples / numbers / acceptance anchors from a parent
 * description so they survive decomposition. Splits on sentence boundaries and
 * keeps clauses carrying a digit, a percent, or an explicit example marker.
 */
export function extractParentExamples(description: string): string[] {
  if (!description) return [];
  const clauses = description
    .split(/(?<=[.;:!?])\s+|\n+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const clause of clauses) {
    if (!ANCHOR_RE.test(clause)) continue;
    const norm = clause.replace(/\s+/g, " ").trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 8) break;
  }
  return out;
}

/** Pull goalFlight successCriteria + constraints out of a parsed intake object. */
function goalCriteria(intake: Record<string, unknown> | null | undefined): string[] {
  if (!intake || typeof intake !== "object") return [];
  const gf = (intake as Record<string, unknown>).goalFlight;
  if (!gf || typeof gf !== "object") return [];
  const out: string[] = [];
  for (const key of ["successCriteria", "constraints"]) {
    const v = (gf as Record<string, unknown>)[key];
    if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return out;
}

function renderSiblings(self: { title: string }, siblings: SiblingSummary[]): string {
  if (siblings.length === 0) return "(this is the only item)";
  return siblings
    .map((s, i) => {
      const isSelf = s.title === self.title;
      const marker = isSelf ? "→ this item" : s.done ? "done" : s.status;
      const summary = s.summary ? ` — ${s.summary}` : "";
      return `${i + 1}. [${marker}] ${s.title}${summary}`;
    })
    .join("\n");
}

/**
 * Render the Parent Context Pack block (without the item's own task body). Stable,
 * labelled sections so a worker can reliably locate the parent intent.
 */
export function buildParentContextPack(
  parent: ParentContextSource,
  self: { title: string; prompt: string },
  siblings: SiblingSummary[],
): string {
  const examples = [...extractParentExamples(parent.description), ...goalCriteria(parent.intake)];
  const examplesBlock = examples.length
    ? examples.map((e) => `- ${e}`).join("\n")
    : "(none explicitly stated — infer reasonable defaults from the parent request)";

  return [
    "=== Parent Flight Context (do not lose this) ===",
    `Flight: ${parent.title}`,
    "",
    "Parent request:",
    parent.description,
    "",
    "Concrete examples / acceptance criteria from the parent:",
    examplesBlock,
    "",
    "This Flight's other items:",
    renderSiblings(self, siblings),
    "",
    "How to proceed:",
    "- This task is one step of the parent Flight above. Infer any unstated value, " +
      "period, or threshold from the parent request and examples before asking.",
    `- ${PARENT_CONTEXT_NO_VAGUE_QUESTIONS}`,
    "- If you are genuinely blocked and the parent context does not resolve it, do NOT " +
      "ask the operator. Instead emit a parent-decision blocker by printing a single " +
      "fenced marker on its own lines:",
    "  <<<NEEDS_PARENT_DECISION",
    '  {"ambiguity":"…","parentExcerpt":"…","options":["…","…"],"recommendedDefault":"…","confidence":0.0}',
    "  NEEDS_PARENT_DECISION>>>",
    "  The Flight coordinator (status needs_parent_decision) will answer it from the " +
      "parent context and requeue you — the operator is only involved for genuine " +
      "product, destructive, or safety decisions.",
  ].join("\n");
}

/** Full child task description: the Parent Context Pack followed by the item's own prompt. */
export function buildChildTaskPrompt(
  parent: ParentContextSource,
  self: { title: string; prompt: string },
  siblings: SiblingSummary[],
): string {
  return [buildParentContextPack(parent, self, siblings), "", "=== Your task ===", self.prompt.trim()].join("\n");
}
