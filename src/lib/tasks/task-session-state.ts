import { isCodexModel } from "@/lib/models/catalog";
import type { ReviewState } from "./review-state";

export type TaskSessionStateKey = "live" | "needs_input" | "ready_for_review";
export type TaskSessionTone = "live" | "attention" | "review";

export interface TaskSessionMeta {
  key: TaskSessionStateKey;
  label: string;
  tone: TaskSessionTone;
  title: string;
  body: string;
  actionLabel: string;
}

interface TaskSessionStateInput {
  status: string;
  reviewState?: ReviewState | null;
  sessionId?: string | null;
  model?: string | null;
}

export function getTaskSessionMeta(task: TaskSessionStateInput): TaskSessionMeta | null {
  if (task.status === "in_progress" && isCodexModel(task.model) && task.sessionId) {
    return {
      key: "live",
      label: "Live Session",
      tone: "live",
      title: "Live task session",
      body: "This task is still in progress. You can steer the active Codex run from the session panel.",
      actionLabel: "Steer",
    };
  }

  if (task.status !== "review") return null;

  if (task.reviewState === "needs_input") {
    return {
      key: "needs_input",
      label: "Needs Input",
      tone: "attention",
      title: "Needs your input",
      body: "The agent is waiting on a human answer before it can continue this task.",
      actionLabel: "Answer",
    };
  }

  return {
    key: "ready_for_review",
    label: "Ready for Review",
    tone: "review",
    title: "Ready for review",
    body: "This task reached a useful stopping point and is waiting for your review or approval.",
    actionLabel: "Reply",
  };
}
