/**
 * Structured Flight blocker model. A Flight child that cannot infer a value from
 * the Parent Context Pack emits a fenced NEEDS_PARENT_DECISION marker instead of a
 * vague operator question. The orchestrator records that on the work-package item's
 * `blocker` column using a sentinel prefix so the coordinator (and the console) can
 * distinguish three states:
 *   - plain text                    → an ordinary failure blocker
 *   - NEEDS_PARENT_DECISION:<json>  → child ambiguity the coordinator may resolve
 *   - NEEDS_OPERATOR_DECISION:<json>→ coordinator escalated; the operator must decide
 *
 * Sentinel blockers MUST be persisted via raw SQL (never updateWorkPackageItem),
 * because that path scrubs secret-looking text and would corrupt the JSON payload.
 *
 * See docs/superpowers/specs/2026-06-29-flight-child-autonomy-design.md.
 */

export interface ParentDecisionBlocker {
  /** What the child could not infer. */
  ambiguity: string;
  /** The slice of the parent request the child believes is relevant (may be empty). */
  parentExcerpt: string;
  /** 2-3 candidate answers. */
  options: string[];
  /** The child's recommended default among the options. */
  recommendedDefault: string;
  /** 0..1 confidence in the recommended default. */
  confidence: number;
}

export interface OperatorEscalation {
  question: string;
  options: string[];
  recommendedDefault: string;
  ambiguity: string;
}

export const PARENT_BLOCKER_PREFIX = "NEEDS_PARENT_DECISION:";
export const OPERATOR_BLOCKER_PREFIX = "NEEDS_OPERATOR_DECISION:";

const MARKER_RE = /<<<NEEDS_PARENT_DECISION\s*([\s\S]*?)\s*NEEDS_PARENT_DECISION>>>/;

function coerce(raw: unknown): ParentDecisionBlocker | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.ambiguity !== "string" || !o.ambiguity.trim()) return null;
  const options = Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string") : [];
  const confidence = typeof o.confidence === "number" && isFinite(o.confidence)
    ? Math.max(0, Math.min(1, o.confidence))
    : 0;
  return {
    ambiguity: o.ambiguity.trim(),
    parentExcerpt: typeof o.parentExcerpt === "string" ? o.parentExcerpt.trim() : "",
    options,
    recommendedDefault: typeof o.recommendedDefault === "string" ? o.recommendedDefault.trim() : (options[0] ?? ""),
    confidence,
  };
}

/** Parse a fenced NEEDS_PARENT_DECISION marker out of arbitrary agent text. */
export function parseParentDecisionBlocker(text: string | null | undefined): ParentDecisionBlocker | null {
  if (!text) return null;
  const m = MARKER_RE.exec(text);
  if (!m) return null;
  try {
    return coerce(JSON.parse(m[1].trim()));
  } catch {
    return null;
  }
}

/** Serialize a parent-decision blocker for storage in work_package_items.blocker. */
export function serializeParentBlocker(b: ParentDecisionBlocker): string {
  return PARENT_BLOCKER_PREFIX + JSON.stringify(b);
}

/** Serialize a coordinator escalation (operator must decide) for the item blocker. */
export function serializeOperatorEscalation(b: ParentDecisionBlocker, question: string): string {
  const payload: OperatorEscalation = {
    question,
    options: b.options,
    recommendedDefault: b.recommendedDefault,
    ambiguity: b.ambiguity,
  };
  return OPERATOR_BLOCKER_PREFIX + JSON.stringify(payload);
}

export type ReadBlocker =
  | { kind: "parent"; payload: ParentDecisionBlocker }
  | { kind: "operator"; payload: OperatorEscalation };

/** Interpret a stored item blocker; null for a plain failure blocker or no blocker. */
export function readItemBlocker(blocker: string | null | undefined): ReadBlocker | null {
  if (!blocker) return null;
  if (blocker.startsWith(PARENT_BLOCKER_PREFIX)) {
    try {
      const payload = coerce(JSON.parse(blocker.slice(PARENT_BLOCKER_PREFIX.length)));
      return payload ? { kind: "parent", payload } : null;
    } catch {
      return null;
    }
  }
  if (blocker.startsWith(OPERATOR_BLOCKER_PREFIX)) {
    try {
      const o = JSON.parse(blocker.slice(OPERATOR_BLOCKER_PREFIX.length)) as OperatorEscalation;
      if (o && typeof o.question === "string") {
        return {
          kind: "operator",
          payload: {
            question: o.question,
            options: Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string") : [],
            recommendedDefault: typeof o.recommendedDefault === "string" ? o.recommendedDefault : "",
            ambiguity: typeof o.ambiguity === "string" ? o.ambiguity : "",
          },
        };
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}
