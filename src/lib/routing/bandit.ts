/**
 * Telemetry-driven routing bandit (measurement → recommendation).
 *
 * The route scorecard answers "how is each route doing?"; this answers the next
 * question — "for THIS class of task, which route should we prefer?" — by mining
 * the same task_telemetry rows. It is an epsilon-greedy bandit over (task class,
 * route) arms, scoring each arm on first-pass success minus a cost penalty so a
 * free local arm that lands tasks first-time beats a frontier arm that costs real
 * money for a marginal quality edge.
 *
 * SAFETY POSTURE — advisory by default:
 *   - Cold start: a class with fewer than two arms above the per-arm sample floor
 *     returns a null route → "defer to the default router". The bandit never acts
 *     on thin data; it only speaks once a class has a real track record.
 *   - It emits a RECOMMENDATION, not a routing mutation. Wiring it to actually
 *     flip live routing is a separate, explicitly opted-in step (a config flag),
 *     precisely because a bandit with little data makes bad picks.
 *   - The scoring weights are transparent and tunable; they need calibration once
 *     real cost/quality data accumulates (that is the whole point of measuring
 *     first). Treat the defaults as a starting guess, not gospel.
 */

import type { TaskTelemetry } from "@/lib/observability/contracts";

/** Per-arm sample floor: below this a route's rate is too noisy to trust for a class. */
export const DEFAULT_MIN_PULLS = 5;
/** Exploration rate — how often to try a non-best arm so a loser keeps getting re-tested. */
export const DEFAULT_EPSILON = 0.1;
/**
 * Utility weight on cost, in "first-pass points per dollar". At 2.0, one dollar of
 * average cost/task is worth ~0.2 (20 points) of first-pass rate — i.e. a free
 * local arm may trail the frontier by up to ~20 points on a ~$0.10 task and still win.
 * Tunable; calibrate against real spend once the data is there.
 */
export const DEFAULT_COST_PENALTY = 2.0;

export interface ArmStats {
  /** The route (provider): local-qwen | anthropic | openai-codex | other. */
  route: string;
  /** Distinct tasks this arm handled (any run). */
  pulls: number;
  /** Fraction of first attempts on this arm that succeeded (0..1). */
  firstPassRate: number;
  /** Average provider-reported cost per task (0 when free/unreported, e.g. local). */
  avgCostUsd: number;
  /** Composite utility (higher is better). */
  score: number;
}

export interface ClassArms {
  taskClass: string;
  arms: ArmStats[];
}

/** Pure: the utility of an arm — reward first-pass success, penalize average cost. */
export function armScore(firstPassRate: number, avgCostUsd: number, costPenalty = DEFAULT_COST_PENALTY): number {
  return firstPassRate - costPenalty * avgCostUsd;
}

/** Pure: telemetry rows → per-(class, route) arm stats, classes with most tasks first. */
export function aggregateArms(rows: TaskTelemetry[], costPenalty = DEFAULT_COST_PENALTY): ClassArms[] {
  const byClass = new Map<string, Map<string, TaskTelemetry[]>>();
  for (const r of rows) {
    const cls = r.role ?? "unknown";
    const route = r.provider;
    const routes = byClass.get(cls) ?? byClass.set(cls, new Map()).get(cls)!;
    (routes.get(route) ?? routes.set(route, []).get(route)!).push(r);
  }
  const out: ClassArms[] = [];
  for (const [taskClass, routes] of byClass) {
    const arms: ArmStats[] = [];
    for (const [route, rs] of routes) {
      const pulls = new Set(rs.map((r) => r.taskId)).size;
      const firstRuns = rs.filter((r) => r.runIndex === 0);
      const firstAttempts = new Set(firstRuns.map((r) => r.taskId)).size;
      const firstPasses = firstRuns.filter((r) => r.status === "done" || r.status === "review").length;
      const firstPassRate = firstAttempts ? firstPasses / firstAttempts : 0;
      const costs = rs.map((r) => r.costUsd).filter((v): v is number => v != null);
      const avgCostUsd = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
      arms.push({ route, pulls, firstPassRate, avgCostUsd, score: armScore(firstPassRate, avgCostUsd, costPenalty) });
    }
    arms.sort((a, b) => b.score - a.score);
    out.push({ taskClass, arms });
  }
  return out.sort((a, b) => armPulls(b) - armPulls(a));
}

function armPulls(c: ClassArms): number {
  return c.arms.reduce((acc, a) => acc + a.pulls, 0);
}

export interface RouteRecommendation {
  taskClass: string;
  /** The recommended route, or null → not enough data; defer to the default router. */
  route: string | null;
  reason: string;
  /** True when this pick is an exploration (a deliberate non-best try), not exploitation. */
  explore: boolean;
}

/**
 * Pure: recommend a route for one class. Epsilon-greedy over the arms that clear
 * the sample floor; returns route=null (defer) until at least two arms qualify, so
 * the bandit never acts on cold data. `rng` is injectable for deterministic tests.
 */
export function recommendRoute(
  cls: ClassArms,
  opts: { minPulls?: number; epsilon?: number; rng?: () => number } = {},
): RouteRecommendation {
  const minPulls = opts.minPulls ?? DEFAULT_MIN_PULLS;
  const epsilon = opts.epsilon ?? DEFAULT_EPSILON;
  const rng = opts.rng ?? Math.random;

  const trusted = cls.arms.filter((a) => a.pulls >= minPulls);
  if (trusted.length < 2) {
    return {
      taskClass: cls.taskClass,
      route: null,
      reason: `insufficient data (${trusted.length}/${2} routes above ${minPulls} tasks) — defer to default routing`,
      explore: false,
    };
  }

  // Exploration: occasionally try a non-best trusted arm so a current loser keeps
  // being re-measured and can recover if it improves.
  if (trusted.length > 1 && rng() < epsilon) {
    const others = trusted.slice(1); // trusted is score-desc; [0] is the exploit pick
    const pick = others[Math.floor(rng() * others.length)] ?? others[0];
    return {
      taskClass: cls.taskClass,
      route: pick.route,
      reason: `exploring ${pick.route} (${Math.round(pick.firstPassRate * 100)}% first-pass) to keep it measured`,
      explore: true,
    };
  }

  const best = trusted[0];
  return {
    taskClass: cls.taskClass,
    route: best.route,
    reason: `best utility: ${best.route} at ${Math.round(best.firstPassRate * 100)}% first-pass, $${best.avgCostUsd.toFixed(4)}/task`,
    explore: false,
  };
}

/** Recommend a route for every class in the aggregated telemetry. */
export function recommendRoutes(
  classes: ClassArms[],
  opts: { minPulls?: number; epsilon?: number; rng?: () => number } = {},
): RouteRecommendation[] {
  return classes.map((c) => recommendRoute(c, opts));
}
