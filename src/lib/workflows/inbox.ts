/**
 * Workflow Inbox / COO Queue — a read-only aggregator over workflow_runs and
 * workflow_actions that answers: what needs review, what's ready to execute, what's
 * blocked, what failed, and what recently completed.
 *
 * Read-only and side-effect-free: it NEVER executes an action. Action readiness reuses
 * assessWorkflowAction (the same gate logic as executeWorkflowAction), so the inbox and
 * execution always agree. Secret-free: items carry titles/statuses/ids/field-names/system
 * reasons — never artifact content.
 */

import { listWorkflowRuns, scrubSecretText, type WorkflowRunRecord } from "./runs";
import { assessWorkflowAction, listWorkflowActions, type WorkflowActionRecord, type WorkflowActionReadiness } from "./actions";

export const INBOX_GROUPS = [
  "needs_review",
  "changes_requested",
  "proposed_actions_ready",
  "proposed_actions_blocked",
  "failed_or_attention",
  "running_or_pending",
  "recently_completed",
] as const;
export type InboxGroup = (typeof INBOX_GROUPS)[number];

export interface InboxItem {
  kind: "run" | "action";
  id: string;
  workflowId: string;
  title: string;
  status: string;
  sourceRunId?: string;
  targetWorkflowId?: string;
  reason?: string;
  blockedReason?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  nextAction: string;
}

export interface WorkflowInbox {
  counts: Record<InboxGroup, number>;
  groups: Record<InboxGroup, InboxItem[]>;
}

const RUN_DONE = new Set(["done", "published"]);
const RUN_ATTENTION = new Set(["rejected", "failed", "blocked"]);

function emptyGroups(): Record<InboxGroup, InboxItem[]> {
  return Object.fromEntries(INBOX_GROUPS.map((g) => [g, [] as InboxItem[]])) as Record<InboxGroup, InboxItem[]>;
}

function clean(s: string | null | undefined): string {
  return s ? scrubSecretText(s) : "";
}

function runItem(run: WorkflowRunRecord): { group: InboxGroup; item: InboxItem } {
  let group: InboxGroup;
  let nextAction: string;
  if (run.status === "needs_review") { group = "needs_review"; nextAction = "Review the draft"; }
  else if (run.status === "changes_requested") { group = "changes_requested"; nextAction = "Revise and re-approve"; }
  else if (RUN_ATTENTION.has(run.status)) { group = "failed_or_attention"; nextAction = "Resolve or retry"; }
  else if (RUN_DONE.has(run.status)) { group = "recently_completed"; nextAction = "Done"; }
  else { group = "running_or_pending"; nextAction = "In progress"; }
  return {
    group,
    item: {
      kind: "run", id: run.id, workflowId: run.workflowId, title: clean(run.title), status: run.status,
      reason: clean(run.blocker) || undefined, blockedReason: run.status === "changes_requested" ? clean(run.blocker) || undefined : undefined,
      createdAt: run.createdAt, updatedAt: run.updatedAt, completedAt: run.completedAt ?? undefined, nextAction,
    },
  };
}

function actionGroup(readiness: WorkflowActionReadiness): InboxGroup {
  if (readiness === "ready") return "proposed_actions_ready";
  if (readiness === "review_required" || readiness === "needs_input") return "proposed_actions_blocked";
  if (readiness === "completed") return "recently_completed";
  return "failed_or_attention"; // refused / failed / unsupported / invalid
}

function actionNextAction(readiness: WorkflowActionReadiness, missing?: string[]): string {
  switch (readiness) {
    case "ready": return "Execute";
    case "review_required": return "Approve the source run first";
    case "needs_input": return `Provide: ${(missing ?? []).join(", ")}`;
    case "completed": return "Done";
    default: return "Resolve or refuse";
  }
}

function actionItem(action: WorkflowActionRecord): { group: InboxGroup; item: InboxItem } {
  const a = assessWorkflowAction(action); // read-only, no dispatch, no operator inputs
  const group = actionGroup(a.readiness);
  const blockedReason = a.readiness === "needs_input"
    ? `needs input: ${(a.missing ?? []).join(", ")}`
    : a.readiness === "review_required" ? clean(a.reason) : undefined;
  return {
    group,
    item: {
      kind: "action", id: action.id, workflowId: action.targetWorkflowId, title: clean(action.title), status: a.readiness,
      sourceRunId: action.sourceRunId, targetWorkflowId: action.targetWorkflowId,
      reason: clean(a.reason) || undefined, blockedReason,
      createdAt: action.createdAt, updatedAt: action.updatedAt,
      completedAt: a.readiness === "completed" ? action.updatedAt : undefined,
      nextAction: actionNextAction(a.readiness, a.missing),
    },
  };
}

export function getWorkflowInbox(filter: { workflowId?: string; limit?: number } = {}): WorkflowInbox {
  const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 100)));
  const groups = emptyGroups();

  for (const run of listWorkflowRuns({ workflowId: filter.workflowId, limit })) {
    const { group, item } = runItem(run);
    groups[group].push(item);
  }
  for (const action of listWorkflowActions({ limit })) {
    if (filter.workflowId && action.targetWorkflowId !== filter.workflowId) continue;
    const { group, item } = actionItem(action);
    groups[group].push(item);
  }

  // Keep recently_completed short and deterministic (list order is createdAt DESC, rowid DESC).
  groups.recently_completed = groups.recently_completed.slice(0, 8);

  const counts = Object.fromEntries(INBOX_GROUPS.map((g) => [g, groups[g].length])) as Record<InboxGroup, number>;
  return { counts, groups };
}

/** Concise, operational, secret-free one-liner for the COO / model. */
export function formatWorkflowInboxSummary(inbox: WorkflowInbox): string {
  const c = inbox.counts;
  const total = INBOX_GROUPS.reduce((n, g) => n + c[g], 0);
  if (total === 0) return "Workflow inbox: empty — nothing pending.";
  const parts = [
    `${c.needs_review} need review`,
    `${c.proposed_actions_ready} action${c.proposed_actions_ready === 1 ? "" : "s"} ready`,
    `${c.proposed_actions_blocked} blocked`,
    `${c.changes_requested} need revision`,
    `${c.failed_or_attention} need attention`,
  ];
  return `Workflow inbox: ${parts.join(" · ")}.`;
}
