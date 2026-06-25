/**
 * HeyGen portal video → Workflow Run Ledger linkage.
 *
 * One shared module used by BOTH the daemon endpoints and the verify:portal dry-run
 * harness, so the run-state mapping lives in exactly one place. Find-or-create by
 * draft id, so a retry updates the existing run instead of duplicating it.
 */

import type { CooDispatchResult } from "@/lib/coo/dispatch";
import type { PublishDraftResult } from "@/lib/video/news-review";
import {
  createWorkflowRun,
  findWorkflowRunByDraft,
  linkWorkflowRunArtifact,
  setWorkflowRunLinks,
  updateWorkflowRunStatus,
  type WorkflowRunRecord,
} from "./runs";

export const HEYGEN_PORTAL_WORKFLOW_ID = "heygen.portal_video_from_script";

/** Map a dispatch status to a run status. */
function dispatchRunStatus(status: string): { status: string; blocked: boolean } {
  switch (status) {
    case "created": return { status: "portal_pending", blocked: false };
    case "readiness_required":
    case "execution_unavailable": return { status: "blocked", blocked: true };
    default: return { status, blocked: false }; // prepared / needs_input / etc.
  }
}

function ensureRun(draftId: string | undefined, title: string): WorkflowRunRecord {
  const existing = draftId ? findWorkflowRunByDraft(draftId, HEYGEN_PORTAL_WORKFLOW_ID) : null;
  return existing ?? createWorkflowRun({ workflowId: HEYGEN_PORTAL_WORKFLOW_ID, title, draftId });
}

export function linkHeyGenPortalRunOnDispatch(
  result: CooDispatchResult & { taskId?: string | null },
  ctx: { draftId?: string; title: string },
): WorkflowRunRecord {
  const run = ensureRun(ctx.draftId, ctx.title);
  const mapped = dispatchRunStatus(result.status);
  updateWorkflowRunStatus(run.id, mapped.status, {
    blocker: mapped.blocked ? result.reason : null,
    currentStep: mapped.blocked ? "dispatch blocked" : "portal task created",
  });
  if (result.taskId) setWorkflowRunLinks(run.id, { childTaskId: result.taskId });
  if (result.auditId) linkWorkflowRunArtifact(run.id, "dispatchAuditId", result.auditId);
  if (result.readiness?.status) linkWorkflowRunArtifact(run.id, "readinessStatus", result.readiness.status);
  return findWorkflowRunByDraft(ctx.draftId ?? "", HEYGEN_PORTAL_WORKFLOW_ID) ?? run;
}

export function linkHeyGenPortalRunOnCompletion(
  draftId: string,
  completion: { status?: string; childStatus?: "done" | "failed" | "cancelled" },
): WorkflowRunRecord | null {
  const run = findWorkflowRunByDraft(draftId, HEYGEN_PORTAL_WORKFLOW_ID);
  if (!run) return null;
  let status: string;
  let blocker: string | null = null;
  let step: string;
  if (completion.childStatus === "failed" || completion.childStatus === "cancelled") {
    status = completion.childStatus;
    blocker = `portal task ${completion.childStatus}`;
    step = "portal task ended";
  } else if (completion.status === "portal_completed") {
    status = "portal_completed"; step = "local video ready to publish";
  } else if (completion.status === "needs_publish_input") {
    status = "needs_publish_input"; blocker = "no local file — manual publish"; step = "needs manual publish input";
  } else {
    status = completion.status ?? "blocked"; step = "completion recorded";
  }
  updateWorkflowRunStatus(run.id, status, { blocker, currentStep: step });
  return findWorkflowRunByDraft(draftId, HEYGEN_PORTAL_WORKFLOW_ID);
}

export function linkHeyGenPortalRunOnPublish(draftId: string, publish: PublishDraftResult): WorkflowRunRecord | null {
  const run = findWorkflowRunByDraft(draftId, HEYGEN_PORTAL_WORKFLOW_ID);
  if (!run) return null;
  if (publish.ok && publish.published) {
    if (publish.youtubeUrl) linkWorkflowRunArtifact(run.id, "youtubeUrl", publish.youtubeUrl);
    updateWorkflowRunStatus(run.id, "done", { blocker: null, currentStep: "published to YouTube" });
  }
  return findWorkflowRunByDraft(draftId, HEYGEN_PORTAL_WORKFLOW_ID);
}
