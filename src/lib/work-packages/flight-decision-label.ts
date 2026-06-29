/**
 * Shared labelling for a Flight child item's blocker, so the console and any other
 * surface agree on the two distinct states:
 *   - "Needs Flight decision" — a needs_parent_decision blocker the coordinator
 *     may still answer from the parent context; the operator need NOT act.
 *   - "Needs your reply" — a coordinator-escalated decision the operator must make.
 *
 * See docs/superpowers/specs/2026-06-29-flight-child-autonomy-design.md.
 */

import { PARENT_BLOCKER_PREFIX, OPERATOR_BLOCKER_PREFIX } from "./parent-blocker";

export type FlightDecisionState = "parent_decision" | "operator_decision";

/** Classify a stored item blocker into a decision state, or null for a plain blocker. */
export function flightChildDecisionState(blocker: string | null | undefined): FlightDecisionState | null {
  if (!blocker) return null;
  if (blocker.startsWith(PARENT_BLOCKER_PREFIX)) return "parent_decision";
  if (blocker.startsWith(OPERATOR_BLOCKER_PREFIX)) return "operator_decision";
  return null;
}

/** Operator-facing label for a decision state. */
export function flightDecisionLabel(state: FlightDecisionState | null): string {
  if (state === "parent_decision") return "Needs Flight decision";
  if (state === "operator_decision") return "Needs your reply";
  return "";
}

/**
 * Compact plain-text reason shown on manual-review items in the console so
 * operators understand WHY their action is required. Returns null when the
 * blocker HTML already explains the situation (structured blockers) or when
 * the item should have been auto-landed (shouldn't reach the UI).
 */
export function computeReviewReason(
  item: { taskStatus?: string | null; risk?: string | null; blocker?: string | null; executionMode?: string | null },
  loop: { profile: string } | null,
): string | null {
  if (item.taskStatus === "needs_input") return "Agent is waiting for your input";
  if (item.risk === "medium" || item.risk === "high")
    return `${item.risk.charAt(0).toUpperCase() + item.risk.slice(1)}-risk change — operator sign-off required`;
  if (loop && loop.profile === "release") return "Release sign-off required";
  if (item.blocker) return null; // flightBlockerHtml already renders structured blockers
  return null;
}
