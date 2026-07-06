/**
 * Escalation package — the "detects but doesn't fix" bridge.
 *
 * When a LOCAL coding agent exhausts its verification-gate retries and the code
 * still fails, dead-ending the task as "failed" wastes the draft (which is usually
 * 95% right). Instead we package {original spec, the failure diagnostics} and hand
 * it to the FRONTIER as a fix task: "produce the minimal diff that makes it pass",
 * never a rewrite — so the frontier spends cheap input tokens reading the draft
 * rather than expensive output tokens regenerating it.
 *
 * Fires only when the cloud is reachable (so the fix runs now). Offline, the task
 * still lands failed and the standing frontier-review-debt net covers code-critical
 * work separately. Idempotent per original task; never escalates an escalation.
 */

import { getDb, Task } from "@/lib/db";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";

export const ESCALATION_SOURCE = "escalation";

/** Pure: the fix-task prompt — spec + diagnostics + the minimal-diff instruction. */
export function escalationTaskDescription(spec: string, report: string): string {
  return [
    "A local model attempted this task and its code FAILED the verification gate after",
    "several fix attempts. Your job: make the EXISTING code pass — produce the minimal",
    "diff that fixes the failure. Do NOT rewrite from scratch; keep the working parts.",
    "Run the verification yourself before reporting done.",
    "",
    "Verification failure (diagnostics from the local attempt):",
    report.trim(),
    "",
    "Original task:",
    spec.trim(),
  ].join("\n");
}

/** Pure decision: escalate this failure now? */
export function shouldEscalate(input: {
  cloudOk: boolean;
  hasReport: boolean;
  sourceIsEscalation: boolean;
}): boolean {
  return input.cloudOk && input.hasReport && !input.sourceIsEscalation;
}

/**
 * Create a frontier fix task for a local verification failure. No-op (returns null)
 * unless the cloud is reachable, the report is non-empty, the source task isn't
 * itself an escalation, and no escalation already exists for it.
 */
export async function maybeEscalateToFrontier(taskId: string, report: string): Promise<string | null> {
  if (!report.trim()) return null;
  const cloudOk = getConnectivityPolicy().mode === "cloud-ok";
  const orig = await Task.findById(taskId);
  if (!orig) return null;
  if (!shouldEscalate({ cloudOk, hasReport: true, sourceIsEscalation: orig.source === ESCALATION_SOURCE })) {
    return null;
  }
  // Idempotency: one escalation per original task.
  const dup = getDb()
    .prepare(`SELECT _id FROM tasks WHERE source = ? AND json_extract(output, '$.escalation.originalTaskId') = ? LIMIT 1`)
    .get(ESCALATION_SOURCE, taskId);
  if (dup) return null;

  const created = await Task.create({
    title: `Frontier fix: ${(orig.title ?? taskId).slice(0, 60)}`,
    description: escalationTaskDescription(orig.description ?? "", report),
    project: orig.project,
    projectPath: orig.projectPath,
    status: "backlog",
    executor: "agent",
    source: ESCALATION_SOURCE,
    model: "mixed", // code-critical → frontier under cloud-ok
    output: { escalation: { originalTaskId: taskId } },
  });
  return String(created._id);
}
