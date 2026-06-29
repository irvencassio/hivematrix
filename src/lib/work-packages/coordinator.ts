/**
 * Flight coordinator — deterministic auto-resolution of a child's
 * needs_parent_decision blocker from the parent Flight context alone (no model,
 * mirroring the rest of work-package orchestration). The coordinator answers
 * ambiguities the parent already settled and requeues the child; it escalates to
 * the operator ONLY when the parent context is genuinely insufficient, the choice
 * is a product/business decision, or the action is destructive/credentialed/safety.
 *
 * See docs/superpowers/specs/2026-06-29-flight-child-autonomy-design.md.
 */

import { extractParentExamples, type ParentContextSource } from "./parent-context";
import type { ParentDecisionBlocker } from "./parent-blocker";

export interface ParentResolution {
  resolved: boolean;
  /** Text to requeue the child with (present when resolved). */
  answer?: string;
  /** Human-readable rationale (for logs + the operator escalation question). */
  reason: string;
  escalate?: boolean;
  escalateReason?: "insufficient_context" | "product_decision" | "destructive" | "safety";
}

// Mirror intake's gate regexes (kept local so the coordinator stays decoupled).
const DESTRUCTIVE_RE = /\b(delete|drop table|drop\b|rm -rf|force[- ]push|wipe|destroy|truncate)\b/i;
const SAFETY_RE = /\b(charge|refund|transfer|wire|payment|api[_-]?keys?|credential|password|legal|contract|compliance)\b/i;
const PRODUCT_RE = /\b(pricing|price|tier|plan|brand|logo|copy|wording|messaging|name(?:s|d)?|scope|which feature|positioning|color\s*scheme|tone)\b/i;

// Period/window ambiguities the parent typically pins down with a concrete window.
const PERIOD_AMBIGUITY_RE = /\b(period|window|interval|timeframe|time frame|how many days|day|week|hour)\b/i;
const WINDOW_RE = /(\d+)\s*[- ]?\s*(day|hour|week|month|minute)s?\b/i;

function roundedPerDay(days: number): string {
  // One-decimal per-day budget, e.g. 100/7 → 14.3.
  return (Math.round((100 / days) * 10) / 10).toFixed(1);
}

function parentText(parent: ParentContextSource): string {
  return [parent.description, ...extractParentExamples(parent.description)].join("\n");
}

/** True when `needle` (non-empty) appears in the parent description/examples. */
function groundedInParent(parent: ParentContextSource, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  return parentText(parent).toLowerCase().includes(n);
}

/**
 * Try to answer a child's parent-decision blocker from the parent context alone.
 * Order: hard escalations (destructive/safety) → period anchor → grounded default
 * → product decision → insufficient context.
 */
export function resolveParentDecision(
  parent: ParentContextSource,
  blocker: ParentDecisionBlocker,
): ParentResolution {
  const haystack = `${blocker.ambiguity}\n${blocker.options.join("\n")}\n${blocker.recommendedDefault}`;

  // 1. Destructive / safety / credentialed actions are never auto-resolved.
  if (DESTRUCTIVE_RE.test(haystack)) {
    return { resolved: false, escalate: true, escalateReason: "destructive", reason: "ambiguity involves a destructive action" };
  }
  if (SAFETY_RE.test(haystack)) {
    return { resolved: false, escalate: true, escalateReason: "safety", reason: "ambiguity involves a credentialed/financial/legal action" };
  }

  // 2. Period/window ambiguity grounded by a concrete window in the parent.
  if (PERIOD_AMBIGUITY_RE.test(blocker.ambiguity)) {
    const m = WINDOW_RE.exec(parentText(parent));
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const window = `${n}-${unit}`;
      const answer = unit === "day"
        ? `Use the ${window} period (specified in the parent request); daily threshold = 100 / ${n} = ${roundedPerDay(n)}%.`
        : `Use the ${window} window, as specified in the parent request.`;
      return { resolved: true, answer, reason: `parent specifies a ${window} window` };
    }
  }

  // 3. A recommended default that is itself grounded in the parent + confident enough.
  if (blocker.recommendedDefault && blocker.confidence >= 0.5) {
    if (groundedInParent(parent, blocker.recommendedDefault) || groundedInParent(parent, blocker.parentExcerpt)) {
      return {
        resolved: true,
        answer: `Use "${blocker.recommendedDefault}" — it matches the parent request${blocker.parentExcerpt ? ` ("${blocker.parentExcerpt}")` : ""}.`,
        reason: "recommended default is grounded in the parent context",
      };
    }
  }

  // 4. Product/business decision the parent did not settle → operator owns it.
  if (PRODUCT_RE.test(haystack)) {
    return { resolved: false, escalate: true, escalateReason: "product_decision", reason: "ambiguity implies a product/business decision" };
  }

  // 5. Nothing in the parent resolves it.
  return { resolved: false, escalate: true, escalateReason: "insufficient_context", reason: "parent context does not contain the answer" };
}
