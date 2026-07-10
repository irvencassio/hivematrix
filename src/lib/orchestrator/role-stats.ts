/**
 * Real usage statistics for a single agent profile — the roles console
 * screen's "Insight" panel. Deliberately honest about emptiness: a role
 * that has never run reports totalRuns: 0, not a fabricated rate.
 */

import { Task } from "@/lib/db";
import { percentile } from "@/lib/observability/contracts";

export interface RoleProvenanceSplit {
  explicit: number;
  classifier: number;
  keyword: number;
  default: number;
  unknown: number;
}

export interface RoleStats {
  totalRuns: number;
  byStatus: Record<string, number>;
  /** archived / (archived + failed) — null (not a fabricated 0) when the
   * resolved-outcome population is under the confidence threshold. */
  successRate: number | null;
  lastRunAt: string | null;
  medianDurationMs: number | null;
  provenance: RoleProvenanceSplit;
}

const MIN_RESOLVED_FOR_SUCCESS_RATE = 5;

export async function computeRoleStats(agentType: string): Promise<RoleStats> {
  const tasks = await Task.find({ agentType });

  const byStatus: Record<string, number> = {};
  const provenance: RoleProvenanceSplit = { explicit: 0, classifier: 0, keyword: 0, default: 0, unknown: 0 };
  const timestamps: string[] = [];
  const durations: number[] = [];

  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

    // t.output is already a parsed object (TaskDoc, db/index.ts rowToTask) —
    // roleProvenance was written by scheduler.ts / server.ts POST /tasks.
    const prov = t.output?.roleProvenance as { source?: string } | undefined;
    const source = prov?.source;
    if (source === "explicit" || source === "classifier" || source === "keyword" || source === "default") {
      provenance[source]++;
    } else {
      provenance.unknown++;
    }

    const last = t.completedAt ?? t.assignedAt ?? null;
    if (last) timestamps.push(last);

    if (t.startedAt && t.completedAt) {
      const ms = Date.parse(t.completedAt) - Date.parse(t.startedAt);
      if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
    }
  }

  const archived = byStatus.archived ?? 0;
  const failed = byStatus.failed ?? 0;
  const resolved = archived + failed;
  const successRate = resolved >= MIN_RESOLVED_FOR_SUCCESS_RATE ? archived / resolved : null;

  timestamps.sort();
  const lastRunAt = timestamps.length ? timestamps[timestamps.length - 1] : null;

  return {
    totalRuns: tasks.length,
    byStatus,
    successRate,
    lastRunAt,
    medianDurationMs: percentile(durations, 50),
    provenance,
  };
}
