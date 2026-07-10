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
  type RouteScorecardRow,
  type RunTelemetryInput,
  normalizeRun,
  summarizeTelemetry,
  routeScorecard,
} from "./contracts";
import { aggregateArms, recommendRoutes, type RouteRecommendation } from "@/lib/routing/bandit";

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
    cacheCreate5mTokens: n("cacheCreate5mTokens"),
    cacheCreate1hTokens: n("cacheCreate1hTokens"),
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
       inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
       cacheCreate5mTokens, cacheCreate1hTokens, reasoningTokens,
       totalTokens, tokensPerSec, latencyMs, ttftMs, turns, toolCalls, costUsd,
       directiveId, runId, proverType, project, createdAt)
     VALUES (@taskId, @runIndex, @provider, @model, @role, @connectivity, @status,
       @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreationTokens,
       @cacheCreate5mTokens, @cacheCreate1hTokens, @reasoningTokens,
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

export interface HiddenProviderRow {
  key: string;
  runs: number;
}

export interface ObservabilitySummary extends ObservabilityTotals {
  /**
   * Providers with rows in this window that `isAllowed` excluded (e.g. a
   * disabled frontier provider) — never silently dropped from the response,
   * so a caller can render "Codex — 4 runs hidden (disabled)" instead of the
   * provider just vanishing. Empty when no `isAllowed` filter is given.
   */
  hiddenProviders: HiddenProviderRow[];
}

/**
 * Totals over the most recent `window` rows (default 1000), optionally
 * restricted to providers `isAllowed` admits (e.g. the enabled-frontier
 * gate). Filtering happens BEFORE summarizeTelemetry — filtering totals
 * after aggregation would leave tokens/split counting the hidden provider's
 * rows, which is exactly the bug this exists to prevent (a disabled Codex
 * still inflating the headline token count).
 */
export function observabilitySummary(window = 1000, isAllowed?: (provider: string) => boolean): ObservabilitySummary {
  const rows = listTaskTelemetry(window);
  if (!isAllowed) return { ...summarizeTelemetry(rows), hiddenProviders: [] };

  const visible = rows.filter((r) => isAllowed(r.provider));
  const hiddenCounts = new Map<string, number>();
  for (const r of rows) {
    if (!isAllowed(r.provider)) hiddenCounts.set(r.provider, (hiddenCounts.get(r.provider) ?? 0) + 1);
  }
  const hiddenProviders = [...hiddenCounts.entries()]
    .map(([key, runs]) => ({ key, runs }))
    .sort((a, b) => b.runs - a.runs);

  return { ...summarizeTelemetry(visible), hiddenProviders };
}

/** Per-route scorecard (first-pass rate, rework, cost/task) over the most recent `window` rows. */
export function observabilityScorecard(window = 1000): RouteScorecardRow[] {
  return routeScorecard(listTaskTelemetry(window));
}

/**
 * Per-class routing recommendations (the bandit's advice) over the most recent
 * `window` rows. Advisory only — epsilon=0 so the display is the stable "what the
 * data says is best" pick, not a flickering exploration sample. Classes without
 * enough data recommend route=null (defer to the default router).
 */
export function routingRecommendations(window = 1000): RouteRecommendation[] {
  return recommendRoutes(aggregateArms(listTaskTelemetry(window)), { epsilon: 0 });
}
