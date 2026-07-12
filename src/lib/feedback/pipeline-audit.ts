/**
 * Pipeline self-audit — the accountability layer dogfooding its own machinery.
 *
 * "HiveMatrix as COO" stops being a metaphor when the COO files its own bug reports.
 * This inspects the pipeline's own metrics (the success scoreboard, the model-tier
 * scorecard, feedback loop-health) and files any material concern into the SAME
 * feedback backlog that a maintenance directive works — so a pipeline regression
 * becomes tracked work, deduped so it doesn't spam a row every run.
 *
 * Runs on the weekly learning-loop slow pass. Pure detection is separated from the
 * DB write so the heuristics are testable without a database.
 */

import { recordFeedbackDedup } from "./feedback";
import type { Scoreboard } from "./scoreboard";
import type { TierScorecardRow } from "@/lib/observability/contracts";

export interface AuditConcern {
  kind: "bug" | "enhancement";
  title: string;
  detail: string;
}

// Thresholds — deliberately conservative so the audit speaks on trends, not noise.
const TIER_FLOOR = 0.6;        // a tier's first-pass rate below this…
const TIER_GAP = 0.2;          // …and this far under the best-performing tier → escalation nudge
const MIN_TIER_TASKS = 3;
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
  tierScorecard: TierScorecardRow[];
  loopResolutionRate: number | null;
  loopItems: number;
}): AuditConcern[] {
  const out: AuditConcern[] = [];
  const { scoreboard: s, tierScorecard } = input;

  // 1) One model tier's coding quality lags the best-performing tier → suggest
  // escalating tasks off the weak tier. Post-cutover there's no local-vs-frontier
  // axis left — every route is a Claude tier or Codex — so the comparison is now
  // "worst tier with enough data" vs "best tier with enough data" rather than a
  // fixed local/frontier pairing. A single active tier can't be compared against
  // itself, so `worst.tier !== best.tier` guards that case (matches the old
  // guard against a retired local route leaking into the frontier side).
  const eligible = tierScorecard.filter((r) => r.tasks >= MIN_TIER_TASKS && r.firstPassRate !== null);
  const worst = eligible.reduce<TierScorecardRow | null>(
    (acc, r) => (acc === null || (r.firstPassRate as number) < (acc.firstPassRate as number) ? r : acc), null);
  const best = eligible.reduce<TierScorecardRow | null>(
    (acc, r) => (acc === null || (r.firstPassRate as number) > (acc.firstPassRate as number) ? r : acc), null);
  if (worst && best && worst.tier !== best.tier && worst.firstPassRate != null && best.firstPassRate != null &&
      worst.firstPassRate < TIER_FLOOR && best.firstPassRate - worst.firstPassRate >= TIER_GAP) {
    out.push({
      kind: "enhancement",
      title: `Escalate ${worst.tier} tasks to a stronger tier`,
      detail: `${worst.tier} first-pass (${Math.round(worst.firstPassRate * 100)}%) trails ${best.tier} (${Math.round(best.firstPassRate * 100)}%) — tasks landing on ${worst.tier} are costing rework.`,
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
    const { observabilityTierScorecard } = await import("@/lib/observability/store");
    const { loopHealth } = await import("./self-improvement");

    const lh = loopHealth();
    const concerns = pipelineConcerns({
      scoreboard: getScoreboard(0),
      tierScorecard: observabilityTierScorecard(),
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
