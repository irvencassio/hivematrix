/**
 * Escalation package — the "detects but doesn't fix" bridge, as a cheap-first ladder.
 *
 * When a LOCAL coding agent exhausts its verification-gate retries and the code still
 * fails, dead-ending the task wastes the draft (usually 95% right). Instead we package
 * {original spec, failure diagnostics} and hand it to a fix task: "produce the minimal
 * diff that makes it pass", never a rewrite.
 *
 * The ladder spends the cheapest capable rung first:
 *   1. LOCAL HOP — retry on the other local model (the on-device coding specialist,
 *      27B-dense), which often fixes what the fast tier couldn't. Free, and works even
 *      OFFLINE. Only one local hop (fast → coding); a coding-tier failure skips this.
 *   2. FRONTIER — only if the local hop is unavailable/exhausted and the cloud is
 *      reachable. Frontier reads the draft (cheap input tokens) and emits a small diff.
 *
 * Idempotent per originating task; the per-task `hop` marker bounds the ladder so it
 * can never loop (one local hop, then one frontier, then stop).
 */

import { getDb, Task } from "@/lib/db";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { SUPPORTED_LOCAL_TIER_PRESETS } from "@/lib/models/local-engine";

export const ESCALATION_SOURCE = "escalation";

export type EscalationHop = "local" | "frontier";

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

/**
 * Pure: the other local model to try — the coding tier (27B on-device fix specialist).
 * Returns null when the failing model IS already the coding tier (no better local), or
 * when it isn't a recognized local tier (e.g. a frontier/mixed model — nothing to hop to).
 */
export function alternateLocalModel(currentModelId: string | null): string | null {
  const coding = SUPPORTED_LOCAL_TIER_PRESETS.find((t) => t.key === "coding")?.alias ?? null;
  if (!coding || currentModelId === coding) return null;
  const isLocalTier = SUPPORTED_LOCAL_TIER_PRESETS.some((t) => t.alias === currentModelId);
  return isLocalTier ? coding : null;
}

export interface EscalationRung {
  model: string;
  hop: EscalationHop;
  titlePrefix: string;
}

/**
 * Pure: pick the next rung, or null when the ladder is exhausted. Local hop first
 * (once), then frontier (once), bounded by the prior hop so it never loops.
 */
export function chooseEscalationRung(input: {
  priorHop: EscalationHop | null;
  currentModel: string | null;
  cloudOk: boolean;
}): EscalationRung | null {
  const alt = input.priorHop === "local" ? null : alternateLocalModel(input.currentModel);
  if (alt) return { model: alt, hop: "local", titlePrefix: "Local fix" };
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
