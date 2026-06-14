/**
 * Observability store — persist + read normalized per-run telemetry.
 *
 * Writes one `task_telemetry` row per task-run (see contracts.ts) and keeps the
 * (previously dormant) `usage_totals` table rolling daily totals by provider +
 * project. All local: nothing leaves the Mac.
 */

import { getDb } from "@/lib/db";
import {
  type TaskTelemetry,
  type ObservabilityTotals,
  type RunTelemetryInput,
  normalizeRun,
  summarizeTelemetry,
} from "./contracts";

type Row = Record<string, unknown>;

function rowToTelemetry(r: Row): TaskTelemetry {
  const n = (k: string): number | null => (r[k] == null ? null : Number(r[k]));
  return {
    taskId: String(r.taskId),
    runIndex: Number(r.runIndex ?? 0),
    provider: String(r.provider) as TaskTelemetry["provider"],
    model: String(r.model),
    role: r.role == null ? null : String(r.role),
    connectivity: r.connectivity == null ? null : String(r.connectivity),
    status: String(r.status),
    inputTokens: n("inputTokens"),
    outputTokens: n("outputTokens"),
    cacheReadTokens: n("cacheReadTokens"),
    cacheCreationTokens: n("cacheCreationTokens"),
    reasoningTokens: n("reasoningTokens"),
    totalTokens: n("totalTokens"),
    tokensPerSec: n("tokensPerSec"),
    latencyMs: n("latencyMs"),
    ttftMs: n("ttftMs"),
    turns: n("turns"),
    toolCalls: n("toolCalls"),
    costUsd: n("costUsd"),
    directiveId: r.directiveId == null ? null : String(r.directiveId),
    runId: r.runId == null ? null : String(r.runId),
    proverType: r.proverType == null ? null : String(r.proverType),
    project: r.project == null ? null : String(r.project),
    createdAt: String(r.createdAt ?? ""),
  };
}

/** Insert one telemetry row and update the daily usage_totals rollup. */
export function recordTaskTelemetry(t: TaskTelemetry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO task_telemetry
      (taskId, runIndex, provider, model, role, connectivity, status,
       inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, reasoningTokens,
       totalTokens, tokensPerSec, latencyMs, ttftMs, turns, toolCalls, costUsd,
       directiveId, runId, proverType, project, createdAt)
     VALUES (@taskId, @runIndex, @provider, @model, @role, @connectivity, @status,
       @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreationTokens, @reasoningTokens,
       @totalTokens, @tokensPerSec, @latencyMs, @ttftMs, @turns, @toolCalls, @costUsd,
       @directiveId, @runId, @proverType, @project, @createdAt)`,
  ).run({
    ...t,
    createdAt: t.createdAt || new Date().toISOString(),
  });

  // Daily rollup: one row per (provider, project, day). profile = provider.
  const day = (t.createdAt || new Date().toISOString()).slice(0, 10);
  db.prepare(
    `INSERT INTO usage_totals (profile, project, period, periodStart, taskCount, cost, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, turns, updatedAt)
     VALUES (@provider, @project, 'day', @day, 1, @cost, @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreationTokens, @turns, datetime('now'))
     ON CONFLICT(profile, project, period, periodStart) DO UPDATE SET
       taskCount = taskCount + 1,
       cost = cost + @cost,
       inputTokens = inputTokens + @inputTokens,
       outputTokens = outputTokens + @outputTokens,
       cacheReadTokens = cacheReadTokens + @cacheReadTokens,
       cacheCreationTokens = cacheCreationTokens + @cacheCreationTokens,
       turns = turns + @turns,
       updatedAt = datetime('now')`,
  ).run({
    provider: t.provider,
    project: t.project ?? "—",
    day,
    cost: t.costUsd ?? 0,
    inputTokens: t.inputTokens ?? 0,
    outputTokens: t.outputTokens ?? 0,
    cacheReadTokens: t.cacheReadTokens ?? 0,
    cacheCreationTokens: t.cacheCreationTokens ?? 0,
    turns: t.turns ?? 0,
  });
}

/** Normalize raw run data and persist it (the call site agent-manager uses). */
export function recordRun(input: RunTelemetryInput): void {
  recordTaskTelemetry(normalizeRun(input));
}

/** Recent telemetry rows, newest first. */
export function listTaskTelemetry(limit = 100): TaskTelemetry[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM task_telemetry ORDER BY _id DESC LIMIT ?`)
    .all(Math.max(1, Math.min(1000, limit))) as Row[];
  return rows.map(rowToTelemetry);
}

/** All telemetry rows for one task (each run), oldest first. */
export function getTaskTelemetry(taskId: string): TaskTelemetry[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM task_telemetry WHERE taskId = ? ORDER BY runIndex ASC, _id ASC`)
    .all(taskId) as Row[];
  return rows.map(rowToTelemetry);
}

/** Totals over the most recent `window` rows (default 1000). */
export function observabilitySummary(window = 1000): ObservabilityTotals {
  return summarizeTelemetry(listTaskTelemetry(window));
}
