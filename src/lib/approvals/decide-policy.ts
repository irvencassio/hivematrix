/**
 * decidePolicy — the single auto-approval decision.
 *
 * Before this, the choice of "auto-approve or ask the operator?" was composed
 * inline inside approval.ts's file-I/O path, tangling three inputs with disk
 * writes and broadcasts. This extracts the composition into one pure function so
 * there is exactly one place that answers the question, and it is testable
 * without a disk:
 *
 *   1. Explicit operator policy (the Settings toggles / voice auto-approval).
 *   2. Earned trust under the autonomy dial (the trust ramp).
 *
 * The HARD SAFETY FLOOR lives inside trustAllowsAutoApproval (only checkpoint /
 * lowRiskTool are ever eligible; content / external / tool / stuck / protected
 * never auto-approve at any trust level) and inside evaluateAutoApprovalPolicy's
 * NEVER_AUTO_APPROVE set. decidePolicy composes them without weakening either —
 * it can only ever return an auto-approval that BOTH layers would permit.
 *
 * This is the seam the Subtraction Pass (DECISIONS Q14 / S4) unifies onto: other
 * gates (bee-tool sends, directive checkpoints) can delegate here rather than
 * carry their own parallel logic.
 */

import {
  type AutoApprovalCategory,
  type AutoApprovalPolicy,
  evaluateAutoApprovalPolicy,
} from "@/lib/voice/auto-approval-policy";
import { trustAllowsAutoApproval, type TrustLedger } from "@/lib/approvals/trust-ledger";
import type { AutonomyLevel } from "@/lib/config/autonomy";

export interface PolicyInputs {
  category: AutoApprovalCategory;
  tool?: string;
  policy: AutoApprovalPolicy;
  autonomyLevel: AutonomyLevel;
  ledger: TrustLedger;
}

export interface PolicyVerdict {
  /** True → auto-approve without asking the operator. False → the operator decides. */
  autoApprove: boolean;
  /** How the decision was reached (audit/log tagging). */
  via: "explicit-policy" | "earned-trust" | "operator-required";
  /** Human-readable reason, present whether approved or not. */
  reason: string;
  /** When approved via earned trust, the ledger key to count for spot-checks; else null. */
  recordTrustKey: string | null;
}

/**
 * Pure: the whole auto-approval decision. No disk, no broadcast, no side effects.
 * Order matters — an explicit operator toggle wins first, then earned trust; if
 * neither grants it, the operator is asked.
 */
export function decidePolicy(input: PolicyInputs): PolicyVerdict {
  // 1) Explicit operator policy (Settings toggles). NEVER_AUTO_APPROVE categories
  //    are rejected inside this call.
  const explicit = evaluateAutoApprovalPolicy(input.policy, { category: input.category, toolName: input.tool });
  if (explicit.allowed) {
    return { autoApprove: true, via: "explicit-policy", reason: `voice-auto (${explicit.reason})`, recordTrustKey: null };
  }

  // 2) Earned trust under autonomous mode. The hard safety floor is enforced
  //    inside trustAllowsAutoApproval (returns key=null for ineligible classes).
  const trust = trustAllowsAutoApproval({ category: input.category, tool: input.tool }, input.autonomyLevel, input.ledger);
  if (trust.allowed && trust.key) {
    return { autoApprove: true, via: "earned-trust", reason: `earned-trust (${trust.reason})`, recordTrustKey: trust.key };
  }

  // 3) Neither layer granted it — the operator decides.
  return {
    autoApprove: false,
    via: "operator-required",
    reason: explicit.reason || trust.reason || "operator review required",
    recordTrustKey: null,
  };
}
