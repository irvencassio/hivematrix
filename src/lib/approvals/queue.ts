/**
 * Unified approvals queue (W6.1) — the HTTP surface a phone consumes.
 *
 * Every founder-in-the-loop gate already lands in the file-based approval store:
 * task-tool approvals and the W4.1/W5.2/W5.3 checkpoint + content + LinkedIn
 * gates as ApprovalRequests, and stuck tasks as StuckRequests. This normalizes
 * both into one list the iOS/Android client can render and resolve, so the
 * founder can approve email sends, content posts, LinkedIn comments, and stuck
 * tasks from the lock screen. Pure over the store reads — easy to test.
 */

import { getPendingApprovals, type ApprovalRequest } from "@/lib/orchestrator/approval";
import { getPendingStuck } from "@/lib/orchestrator/stuck";

export type ApprovalKind = "checkpoint" | "content" | "tool" | "stuck";

export interface ApprovalQueueItem {
  kind: ApprovalKind;
  taskId: string;
  timestamp: string;
  title: string;
  detail: string;
  options: string[];
}

/** Classify a pending approval by the gate that raised it (from its timestamp). */
export function classifyApproval(req: ApprovalRequest): ApprovalKind {
  if (req.timestamp === "checkpoint-content") return "content";
  if (req.timestamp.startsWith("checkpoint-")) return "checkpoint";
  return "tool";
}

function approvalItem(req: ApprovalRequest): ApprovalQueueItem {
  const kind = classifyApproval(req);
  const title =
    kind === "tool" ? `${req.tool}: ${req.command}`.slice(0, 120) : (req.command || "Approval needed").slice(0, 120);
  return {
    kind,
    taskId: req.taskId,
    timestamp: req.timestamp,
    title,
    detail: req.context || "",
    options: ["approve", "deny"],
  };
}

/** The merged, normalized pending queue: approvals first, then stuck tasks. */
export function buildApprovalQueue(): ApprovalQueueItem[] {
  const approvals = getPendingApprovals().map(approvalItem);
  const stuck = getPendingStuck().map((s) => ({
    kind: "stuck" as const,
    taskId: s.taskId,
    timestamp: s.timestamp,
    title: `Stuck: ${s.reason}`.slice(0, 120),
    detail: s.lastOutput || "",
    options: s.options.length > 0 ? s.options : ["retry", "skip", "abort"],
  }));
  return [...approvals, ...stuck];
}
