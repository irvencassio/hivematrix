/**
 * HeyGen portal child-task completion handling.
 *
 * The HeyGen portal work runs in a Browser Lane child task. When the operator
 * finishes (or it fails/cancels), the result is handed back here and applied to the
 * parent video draft — honestly:
 *   - a usable LOCAL video path → portal_completed (the existing publish path can run)
 *   - only a HeyGen URL / manual note → needs_publish_input (NOT a YouTube publish)
 *   - failed / cancelled → back to review (recoverable), child cleared for a retry
 *
 * Idempotent by the child task id. No secrets/cookies/session/credential data are
 * ever accepted or stored — only the final URL/path/note + linkage.
 */

import { existsSync } from "fs";
import { getDraft, updateDraft, type DraftStatus, type VideoDraft } from "./draft-store";

export interface HeyGenPortalCompletion {
  parentDraftId: string;
  childTaskId?: string;
  childStatus?: "done" | "failed" | "cancelled";
  finalVideoUrl?: string;
  localVideoPath?: string;
  manualCompletionNote?: string;
}

export interface PortalCompletionDeps {
  fileExists?: (path: string) => boolean;
  updateTask?: (taskId: string, fields: Record<string, unknown>) => Promise<void> | void;
}

export interface PortalCompletionResult {
  ok: boolean;
  status?: DraftStatus;
  draftId: string;
  alreadyProcessed?: boolean;
  reason?: string;
}

const SECRET_KEY = /password|passwd|pwd|secret|token|cookie|session|credential|api[_-]?key|bearer|keychain/i;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function optString(record: Record<string, unknown>, key: string): string | undefined {
  const v = record[key];
  if (v == null) return undefined;
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  const t = v.trim();
  return t.length ? t : undefined;
}

/** Validate a completion payload and reject any secret-looking fields. */
export function normalizeHeyGenPortalCompletion(input: unknown): HeyGenPortalCompletion {
  const record = asRecord(input, "portal completion");
  for (const key of Object.keys(record)) {
    if (SECRET_KEY.test(key)) throw new Error(`portal completion field "${key}" looks like a secret and is not allowed`);
  }
  const parentDraftId = optString(record, "parentDraftId");
  if (!parentDraftId) throw new Error("parentDraftId is required");

  const childStatusRaw = optString(record, "childStatus");
  const childStatus = childStatusRaw && ["done", "failed", "cancelled"].includes(childStatusRaw)
    ? (childStatusRaw as HeyGenPortalCompletion["childStatus"])
    : undefined;

  return {
    parentDraftId,
    childTaskId: optString(record, "childTaskId"),
    childStatus,
    finalVideoUrl: optString(record, "finalVideoUrl"),
    localVideoPath: optString(record, "localVideoPath"),
    manualCompletionNote: optString(record, "manualCompletionNote"),
  };
}

/** A pending portal child already exists for this draft (dup guard). `force` overrides. */
export function portalChildPending(draft: VideoDraft, force = false): boolean {
  if (force) return false;
  return draft.status === "portal_pending" && !!draft.portalTaskId;
}

/** Operator-facing one-liner describing the draft's portal state. */
export function portalReviewCopy(draft: VideoDraft): string {
  switch (draft.status) {
    case "portal_pending":
      return `HeyGen portal task created${draft.portalTaskId ? ` (${draft.portalTaskId})` : ""} — waiting on portal completion.`;
    case "portal_completed":
      return "HeyGen portal completed with a local video — ready to publish.";
    case "needs_publish_input":
      return `HeyGen portal completed${draft.portalVideoUrl ? ` (${draft.portalVideoUrl})` : ""} — needs manual publish input (no local file to publish).`;
    case "review":
      return draft.error ? `HeyGen portal did not finish: ${draft.error}. You can retry or cancel.` : "Awaiting review.";
    default:
      return `Draft status: ${draft.status}.`;
  }
}

async function refreshReviewCopy(draft: VideoDraft, deps: PortalCompletionDeps): Promise<void> {
  if (!draft.taskId || !deps.updateTask) return;
  await deps.updateTask(draft.taskId, { portalState: draft.status, portalNote: portalReviewCopy(draft) });
}

/** Mark that a portal child task was created for a draft (→ portal_pending). */
export async function markPortalTaskCreated(draftId: string, childTaskId: string, deps: PortalCompletionDeps = {}): Promise<VideoDraft | null> {
  const updated = updateDraft(draftId, { status: "portal_pending", portalTaskId: childTaskId });
  if (updated) await refreshReviewCopy(updated, deps);
  return updated;
}

export async function applyHeyGenPortalCompletion(input: HeyGenPortalCompletion | unknown, deps: PortalCompletionDeps = {}): Promise<PortalCompletionResult> {
  // Always normalize — this also enforces the no-secret-fields rule on the boundary.
  const completion = normalizeHeyGenPortalCompletion(input);
  const fileExists = deps.fileExists ?? existsSync;

  const draft = getDraft(completion.parentDraftId);
  if (!draft) return { ok: false, draftId: completion.parentDraftId, reason: "no video draft found for parentDraftId" };

  // Idempotent: the same child's completion is applied at most once.
  if (completion.childTaskId && draft.portalResolvedTaskId === completion.childTaskId) {
    return { ok: true, draftId: draft.id, status: draft.status, alreadyProcessed: true };
  }

  const resolvedMarker = completion.childTaskId ?? draft.portalTaskId;
  const childStatus = completion.childStatus ?? "done";

  // Failed / cancelled → recoverable. Clear the child so a retry starts fresh.
  if (childStatus === "failed" || childStatus === "cancelled") {
    const note = completion.manualCompletionNote || `Portal task ${childStatus}.`;
    const updated = updateDraft(draft.id, {
      status: "review",
      error: note,
      portalTaskId: undefined,
      portalResolvedTaskId: resolvedMarker,
    });
    if (updated) await refreshReviewCopy(updated, deps);
    return { ok: true, draftId: draft.id, status: "review" };
  }

  // Done with a usable local video → ready for the existing publish path.
  if (completion.localVideoPath && fileExists(completion.localVideoPath)) {
    const updated = updateDraft(draft.id, {
      status: "portal_completed",
      paths: { ...draft.paths, video: completion.localVideoPath },
      portalCompletedAt: new Date().toISOString(),
      portalResolvedTaskId: resolvedMarker,
      ...(completion.manualCompletionNote ? { manualCompletionNote: completion.manualCompletionNote } : {}),
    });
    if (updated) await refreshReviewCopy(updated, deps);
    return { ok: true, draftId: draft.id, status: "portal_completed" };
  }

  // Done with only a URL / manual note → completed in the portal, but NOT published.
  if (completion.finalVideoUrl || completion.manualCompletionNote) {
    const updated = updateDraft(draft.id, {
      status: "needs_publish_input",
      portalVideoUrl: completion.finalVideoUrl,
      manualCompletionNote: completion.manualCompletionNote,
      portalCompletedAt: new Date().toISOString(),
      portalResolvedTaskId: resolvedMarker,
    });
    if (updated) await refreshReviewCopy(updated, deps);
    return { ok: true, draftId: draft.id, status: "needs_publish_input" };
  }

  return { ok: false, draftId: draft.id, reason: "completion has no localVideoPath, finalVideoUrl, or manualCompletionNote" };
}
