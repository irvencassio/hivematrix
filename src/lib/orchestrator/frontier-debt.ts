/**
 * Frontier-review-debt loop (W3.3).
 *
 * When code-critical work runs locally (Mixed mode, cloud unavailable), the
 * router flags "frontier review debt" — but until now that flag was only logged.
 * This records the debt and, once cloud-ok returns and the original task has
 * finished, replays it as a frontier REVIEW task that re-examines the local work
 * for correctness. The local-quality-ceiling risk, actually closed.
 */

import { getDb, generateId, Task } from "@/lib/db";
import { getConnectivityPolicy, type ConnectivityMode } from "@/lib/connectivity/policy";
import { startPollLoop } from "@/lib/lanes/poll-loop";

export interface DebtRow {
  _id: string;
  taskId: string;
  project: string | null;
  projectPath: string | null;
  status: string;
  reviewTaskId: string | null;
}

/** Record that a task ran code-critical locally and owes a frontier review. Idempotent per task. */
export function enqueueFrontierDebt(taskId: string, project: string | null, projectPath: string | null): void {
  getDb().prepare(
    `INSERT INTO frontier_review_debt (_id, taskId, project, projectPath, status)
     VALUES (?, ?, ?, ?, 'pending')
     ON CONFLICT(taskId) DO NOTHING`,
  ).run(generateId(), taskId, project ?? null, projectPath ?? null);
}

export function listPendingDebt(): DebtRow[] {
  return getDb().prepare("SELECT * FROM frontier_review_debt WHERE status = 'pending'").all() as DebtRow[];
}

export interface DebtStatus { pending: number; drained: number; cancelled: number }

export function getDebtStatus(): DebtStatus {
  const rows = getDb().prepare("SELECT status, COUNT(*) AS n FROM frontier_review_debt GROUP BY status").all() as Array<{ status: string; n: number }>;
  const by = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return { pending: by("pending"), drained: by("drained"), cancelled: by("cancelled") };
}

/**
 * Pure: what to do with one pending debt now. Drain only when the cloud is
 * reachable AND the original task has reached a terminal review/done state;
 * cancel orphans; otherwise wait.
 */
export function decideDebtAction(input: {
  mode: ConnectivityMode;
  originalTaskStatus: string | null;
}): "drain" | "cancel" | "wait" {
  if (input.originalTaskStatus === null) return "cancel"; // original task gone
  if (input.mode !== "cloud-ok") return "wait";
  if (input.originalTaskStatus === "done" || input.originalTaskStatus === "review") return "drain";
  return "wait";
}

function markDrained(debtId: string, reviewTaskId: string): void {
  getDb().prepare("UPDATE frontier_review_debt SET status = 'drained', reviewTaskId = ?, drainedAt = datetime('now') WHERE _id = ?")
    .run(reviewTaskId, debtId);
}
function markCancelled(debtId: string): void {
  getDb().prepare("UPDATE frontier_review_debt SET status = 'cancelled', drainedAt = datetime('now') WHERE _id = ?").run(debtId);
}

/** Replay eligible debt as frontier review tasks. Returns how many were drained. */
export async function drainFrontierDebt(): Promise<number> {
  const mode = getConnectivityPolicy().mode;
  let drained = 0;
  for (const debt of listPendingDebt()) {
    const original = await Task.findById(debt.taskId);
    const action = decideDebtAction({ mode, originalTaskStatus: original?.status ?? null });
    if (action === "cancel") { markCancelled(debt._id); continue; }
    if (action === "wait") continue;

    const review = await Task.create({
      title: `Frontier review: ${original?.title ?? debt.taskId}`,
      description: [
        `Frontier review of code-critical work done LOCALLY (Mixed mode, cloud was unavailable) on task ${debt.taskId}.`,
        `Re-examine that task's changes and output for correctness, security, and completeness; fix or report any issues.`,
        "",
        "Original task instructions:",
        original?.description ?? "(unavailable)",
      ].join("\n"),
      project: debt.project ?? original?.project ?? "inbox",
      projectPath: debt.projectPath ?? original?.projectPath ?? process.env.HOME ?? ".",
      status: "backlog",
      executor: "agent",
      source: "review-debt",
      model: "mixed", // code-critical → frontier under cloud-ok
      output: { reviewDebt: { originalTaskId: debt.taskId } },
    });
    markDrained(debt._id, review._id);
    drained += 1;
  }
  return drained;
}

const INTERVAL_MS = 10_000;
let stopFn: (() => void) | null = null;

/** Start the drain loop (idempotent). Self-gates: only replays under cloud-ok. */
export function startFrontierDebtLoop(intervalMs = INTERVAL_MS, drain: () => Promise<number> = drainFrontierDebt): () => void {
  if (stopFn) return stopFrontierDebtLoop;
  stopFn = startPollLoop({ name: "frontier-debt", intervalMs, tick: async () => { await drain(); } });
  return stopFrontierDebtLoop;
}

export function stopFrontierDebtLoop(): void {
  if (stopFn) { stopFn(); stopFn = null; }
}
