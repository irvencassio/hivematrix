/**
 * Pipeline self-audit — the accountability layer dogfooding its own machinery.
 *
 * "HiveMatrix as COO" stops being a metaphor when the COO files its own bug reports.
 * This inspects the pipeline's own metrics (the success scoreboard, the route
 * scorecard, feedback loop-health) and files any material concern into the SAME
 * feedback backlog that a maintenance directive works — so a pipeline regression
 * becomes tracked work, deduped so it doesn't spam a row every run.
 *
 * Runs on the weekly learning-loop slow pass. Pure detection is separated from the
 * DB write so the heuristics are testable without a database.
 */

import { recordFeedbackDedup } from "./feedback";
import type { Scoreboard } from "./scoreboard";
import type { RouteScorecardRow } from "@/lib/observability/contracts";

export interface AuditConcern {
  kind: "bug" | "enhancement";
  title: string;
  detail: string;
}

// Thresholds — deliberately conservative so the audit speaks on trends, not noise.
const LOCAL_FLOOR = 0.6;        // local first-pass below this…
const FRONTIER_GAP = 0.2;      // …and this far under the frontier → re-route nudge
const MIN_ROUTE_TASKS = 3;
const FAIL_RATE = 0.3;         // >30% of the week's tasks failing is a real problem
const MIN_WEEK_TASKS = 5;
const MIN_CRITERIA = 3;        // enough standing objectives to expect movement
const LOOP_FLOOR = 0.5;        // feedback resolution below half → the loop is clogging
const MIN_LOOP_ITEMS = 5;

/**
 * Pure: which pipeline concerns are worth filing, given the current metrics. Empty
 * when the pipeline is healthy or there's not enough data.
 */
export function pipelineConcerns(input: {
  scoreboard: Scoreboard;
  routeScorecard: RouteScorecardRow[];
  loopResolutionRate: number | null;
  loopItems: number;
}): AuditConcern[] {
  const out: AuditConcern[] = [];
  const { scoreboard: s, routeScorecard } = input;

  // 1) Local coding quality lags the frontier → suggest re-routing coding.
  const local = routeScorecard.find((r) => r.route === "local-qwen" && r.tasks >= MIN_ROUTE_TASKS && r.firstPassRate !== null);
  const frontier = routeScorecard
    .filter((r) => r.route !== "local-qwen" && r.tasks >= MIN_ROUTE_TASKS && r.firstPassRate !== null)
    .sort((a, b) => (b.firstPassRate ?? 0) - (a.firstPassRate ?? 0))[0];
  if (local?.firstPassRate != null && frontier?.firstPassRate != null &&
      local.firstPassRate < LOCAL_FLOOR && frontier.firstPassRate - local.firstPassRate >= FRONTIER_GAP) {
    out.push({
      kind: "enhancement",
      title: "Route coding to the frontier by default",
      detail: `Local first-pass (${Math.round(local.firstPassRate * 100)}%) trails the frontier (${Math.round(frontier.firstPassRate * 100)}%) — the local coding path is costing rework.`,
    });
  }

  // 2) Task failure rate is high this window.
  const total = s.tasksDone + s.tasksFailed;
  if (total >= MIN_WEEK_TASKS && s.tasksFailed / total > FAIL_RATE) {
    out.push({
      kind: "bug",
      title: "Task failure rate is high",
      detail: `${s.tasksFailed} of ${total} tasks failed in the last ${s.windowDays}d (${Math.round((s.tasksFailed / total) * 100)}%). Investigate the failing class.`,
    });
  }

  // 3) Standing objectives aren't advancing.
  if (s.criteriaTotal >= MIN_CRITERIA && s.criteriaProven === 0) {
    out.push({
      kind: "enhancement",
      title: "Directive criteria are not advancing",
      detail: `${s.criteriaTotal} prover-gated criteria across active directives, none proven yet — planning or provers may be stuck.`,
    });
  }

  // 4) The self-improvement loop is clogging (feedback in, little out).
  if (input.loopItems >= MIN_LOOP_ITEMS && input.loopResolutionRate != null && input.loopResolutionRate < LOOP_FLOOR) {
    out.push({
      kind: "enhancement",
      title: "Feedback backlog resolution is low",
      detail: `Only ${Math.round(input.loopResolutionRate * 100)}% of feedback is resolved — the backlog is accumulating faster than it clears.`,
    });
  }

  return out;
}

/** Gather the metrics, detect concerns, and file each into the feedback backlog. */
export async function runPipelineSelfAudit(): Promise<{ filed: number; concerns: AuditConcern[] }> {
  try {
    const { getScoreboard } = await import("./scoreboard");
    const { observabilityScorecard } = await import("@/lib/observability/store");
    const { loopHealth } = await import("./self-improvement");

    const lh = loopHealth();
    const concerns = pipelineConcerns({
      scoreboard: getScoreboard(0),
      routeScorecard: observabilityScorecard(),
      loopResolutionRate: lh.total > 0 ? lh.resolutionRate : null,
      loopItems: lh.total,
    });

    let filed = 0;
    for (const c of concerns) {
      const { created } = recordFeedbackDedup({ kind: c.kind, title: c.title, detail: c.detail, source: "pipeline-audit" });
      if (created) filed += 1;
    }
    return { filed, concerns };
  } catch {
    return { filed: 0, concerns: [] };
  }
}
