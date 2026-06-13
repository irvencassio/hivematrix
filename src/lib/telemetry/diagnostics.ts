/**
 * Diagnostics bundle — the payload behind a "send diagnostics" button.
 *
 * Operational signal only (versions, modes, counts, errors) — no task content,
 * descriptions, or message bodies — so it is safe to hand to support. It is
 * built on demand and returned; actually sending it anywhere is an explicit,
 * opt-in user action (local-first).
 */

import { getDb } from "@/lib/db";
import { getSchedulerDiagnostics, type SchedulerDiagnostics } from "@/lib/orchestrator/scheduler";
import { buildManagerBeeReport, type ManagerBeeReport } from "@/lib/managerbee/report";
import { getTelemetrySummary, type TelemetrySummary } from "./telemetry";

export interface DiagnosticsBundle {
  generatedAt: string;
  version: string | null;
  connectivity: string | null;
  scheduler: SchedulerDiagnostics;
  manager: ManagerBeeReport;
  recentTaskFailures: Array<{ taskId: string; error: string }>;
  recentRunFailures: Array<{ runId: string; directiveId: string; reason: string; at: string }>;
  telemetry: TelemetrySummary;
}

export interface DiagnosticsContext {
  version?: string | null;
  connectivity?: string | null;
}

export function buildDiagnosticsBundle(
  ctx: DiagnosticsContext = {},
  nowIso: string = new Date().toISOString(),
): DiagnosticsBundle {
  const db = getDb();

  const recentTaskFailures = (
    db
      .prepare("SELECT _id, error FROM tasks WHERE error IS NOT NULL AND error != '' ORDER BY updatedAt DESC LIMIT 5")
      .all() as Array<{ _id: string; error: string }>
  ).map((r) => ({ taskId: r._id, error: r.error }));

  const recentRunFailures = (
    db
      .prepare("SELECT runId, directiveId, payload, recordedAt FROM run_journal WHERE step = 'run_failed' ORDER BY _id DESC LIMIT 5")
      .all() as Array<{ runId: string; directiveId: string; payload: string; recordedAt: string }>
  ).map((r) => {
    let reason = "";
    try {
      reason = String((JSON.parse(r.payload) as { reason?: unknown }).reason ?? "");
    } catch {
      reason = "";
    }
    return { runId: r.runId, directiveId: r.directiveId, reason, at: r.recordedAt };
  });

  return {
    generatedAt: nowIso,
    version: ctx.version ?? null,
    connectivity: ctx.connectivity ?? null,
    scheduler: getSchedulerDiagnostics(),
    manager: buildManagerBeeReport(nowIso),
    recentTaskFailures,
    recentRunFailures,
    telemetry: getTelemetrySummary(),
  };
}
