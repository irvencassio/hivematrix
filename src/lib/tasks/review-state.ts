import { deriveOutput } from "@/lib/orchestrator/derive-output";
import type { Turn } from "@/lib/orchestrator/turn-types";

export type ReviewState = "needs_input" | "ready_for_review";

export function deriveReviewStateFromTurns(turns: Turn[]): ReviewState {
  const output = deriveOutput(turns);
  return output.awaiting?.kind === "user_response" ? "needs_input" : "ready_for_review";
}

export function getReviewStateMeta(reviewState: ReviewState | null): { label: string; tone: "attention" | "review" } | null {
  if (reviewState === "needs_input") {
    return { label: "Needs Input", tone: "attention" };
  }
  if (reviewState === "ready_for_review") {
    return { label: "Ready for Review", tone: "review" };
  }
  return null;
}
