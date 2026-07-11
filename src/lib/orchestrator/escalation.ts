/**
 * Escalation package — the "detects but doesn't fix" bridge.
 *
 * When a coding agent exhausts its verification-gate retries and the code still
 * fails, dead-ending the task wastes the draft (usually 95% right). Instead we package
 * {original spec, failure diagnostics} and hand it to a fix task on the frontier
 * (Claude/Codex): "produce the minimal diff that makes it pass", never a rewrite.
 * Frontier reads the draft (cheap input tokens) and emits a small diff.
 *
 * Idempotent per originating task; the per-task `hop` marker bounds the ladder so it
 * can never loop (one frontier rung, then stop).
 */

import { getDb, Task } from "@/lib/db";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";

export const ESCALATION_SOURCE = "escalation";

export type EscalationHop = "frontier";

/** Pure: the fix-task prompt — spec + diagnostics + the minimal-diff instruction. */
export function escalationTaskDescription(spec: string, report: string): string {
  return [
    "A previous attempt on this task FAILED the verification gate after several fix",
    "attempts. Your job: make the EXISTING code pass — produce the minimal diff that",
    "fixes the failure. Do NOT rewrite from scratch; keep the working parts.",
    "Run the verification yourself before reporting done.",
    "",
    "Verification failure (diagnostics from the previous attempt):",
    report.trim(),
    "",
    "Original task:",
    spec.trim(),
  ].join("\n");
}

export interface EscalationRung {
  model: string;
  hop: EscalationHop;
  titlePrefix: string;
}

/**
 * Pure: pick the next rung, or null when the ladder is exhausted. One frontier
 * rung, only if the cloud is reachable and it hasn't been tried yet.
 */
export function chooseEscalationRung(input: {
  priorHop: EscalationHop | null;
  currentModel: string | null;
  cloudOk: boolean;
}): EscalationRung | null {
  if (input.cloudOk && input.priorHop !== "frontier") return { model: "mixed", hop: "frontier", titlePrefix: "Frontier fix" };
  return null;
}

/**
 * Create the next fix task for a verification failure, or null when nothing to do
 * (empty report, task gone, an escalation already exists for it, or the ladder is
 * exhausted). The rung (local hop vs frontier) is chosen by chooseEscalationRung.
 */
export async function maybeEscalate(taskId: string, report: string): Promise<string | null> {
  if (!report.trim()) return null;
  const orig = await Task.findById(taskId);
  if (!orig) return null;

  // Idempotency: one escalation per originating task (the chain keys each rung to its
  // immediate parent, so fast→coding→frontier still advances).
  const dup = getDb()
    .prepare(`SELECT _id FROM tasks WHERE source = ? AND json_extract(output, '$.escalation.originalTaskId') = ? LIMIT 1`)
    .get(ESCALATION_SOURCE, taskId);
  if (dup) return null;

  const priorHop = (orig.output as { escalation?: { hop?: EscalationHop } } | null)?.escalation?.hop ?? null;
  const rung = chooseEscalationRung({
    priorHop,
    currentModel: (orig.model as string | null) ?? null,
    cloudOk: getConnectivityPolicy().mode === "cloud-ok",
  });
  if (!rung) return null;

  const created = await Task.create({
    title: `${rung.titlePrefix}: ${(orig.title ?? taskId).slice(0, 60)}`,
    description: escalationTaskDescription(orig.description ?? "", report),
    project: orig.project,
    projectPath: orig.projectPath,
    status: "backlog",
    executor: "agent",
    source: ESCALATION_SOURCE,
    model: rung.model,
    output: { escalation: { originalTaskId: taskId, hop: rung.hop } },
  });
  return String(created._id);
}
