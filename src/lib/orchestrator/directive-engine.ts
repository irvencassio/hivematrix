/**
 * Directive run engine — the 24x7 autonomy loop.
 *
 * A Directive is a standing objective. When due, the engine opens a Run and
 * walks it through the plan → execute → verify → reflect → yield loop, one
 * scheduler tick at a time. Every transition is written to run_journal so an
 * interrupted run resumes from its last recorded step after a daemon restart.
 *
 *   Directive (weeks)  ──>  Run (one episode)  ──>  Task[] (work units)
 *
 * Run phases (runs.phase):
 *   plan     → create bounded task set toward unmet criteria; journal "planned"
 *   execute  → wait for spawned tasks to reach a terminal state
 *   verify   → run provers; only prover results mutate criteria.proven
 *   reflect  → record a reflection; re-arm the directive per trigger policy
 *   done/failed → terminal
 *
 * The planner here is intentionally deterministic for v1 (one task per unmet
 * criterion, capped). An LLM `think`-role planner can replace planRun() later
 * without changing the state machine.
 */

import { Task } from "@/lib/db";
import {
  type DirectiveRow,
  type RunRow,
  getDirective,
  getDueDirectives,
  getActiveRuns,
  createRun,
  setRunPhase,
  updateDirective,
  journal,
  getCriteria,
  markCriterionProven,
  allCriteriaProven,
} from "./directive-store";
import { computeNextRunAt, parseTriggerPolicy, type TriggerPolicy } from "@/lib/scheduling/trigger-policy";

const MAX_TASKS_PER_RUN = 5;
const TERMINAL_TASK_STATUSES = new Set(["review", "done", "failed"]);

async function collectRunTasks(directiveId: string, runId: string): Promise<Array<{ _id: string; status: string }>> {
  // Tasks spawned by this run are tagged with directiveId and a runId marker in output.
  const tasks = await Task.find({ directiveId });
  return tasks
    .filter((t) => {
      const out = (t.output ?? {}) as Record<string, unknown>;
      return out.runId === runId;
    })
    .map((t) => ({ _id: t._id.toString(), status: t.status as string }));
}

// ---------------------------------------------------------------------------
// Phase handlers
// ---------------------------------------------------------------------------

async function planRun(directive: DirectiveRow, run: RunRow): Promise<void> {
  const criteria = getCriteria(directive._id).filter((c) => c.proven === 0);

  // Deterministic v1 planner: one task per unmet criterion (capped). If a
  // directive has no criteria yet, fall back to a single goal task.
  const targets = criteria.length > 0
    ? criteria.slice(0, MAX_TASKS_PER_RUN).map((c) => c.description)
    : [directive.goal];

  const createdTaskIds: string[] = [];
  for (const target of targets) {
    const task = await Task.create({
      title: `[directive] ${target.slice(0, 60)}`,
      description: target,
      project: directive.project,
      projectPath: directive.projectPath,
      profile: directive.profile,
      directiveId: directive._id,
      status: "backlog",
      executor: "agent",
      // Tag the originating run so verify can find this run's tasks.
      output: { runId: run._id },
    });
    createdTaskIds.push(task._id.toString());
  }

  const planSummary = `Planned ${createdTaskIds.length} task(s): ${targets.map((t) => t.slice(0, 40)).join("; ")}`;
  setRunPhase(run._id, "execute", { planSummary });
  journal(run._id, directive._id, "planned", { taskIds: createdTaskIds, planSummary });
}

async function advanceExecuting(directive: DirectiveRow, run: RunRow): Promise<void> {
  const tasks = await collectRunTasks(directive._id, run._id);
  if (tasks.length === 0) {
    // Nothing was created (shouldn't happen) — go straight to verify.
    setRunPhase(run._id, "verify");
    journal(run._id, directive._id, "execute_empty", {});
    return;
  }
  const allTerminal = tasks.every((t) => TERMINAL_TASK_STATUSES.has(t.status));
  if (!allTerminal) return; // keep waiting; re-checked next tick

  setRunPhase(run._id, "verify");
  journal(run._id, directive._id, "executed", {
    tasks: tasks.map((t) => ({ id: t._id, status: t.status })),
  });
}

async function verifyRun(directive: DirectiveRow, run: RunRow, nowIso: string): Promise<void> {
  const tasks = await collectRunTasks(directive._id, run._id);
  const succeeded = new Set(tasks.filter((t) => t.status === "review" || t.status === "done").map((t) => t._id));
  const criteria = getCriteria(directive._id).filter((c) => c.proven === 0);

  // v1 prover: a criterion is proven when the run produced ≥1 successful task.
  // (Richer provers — test/probe/artifact — slot in here by criterion.proverType.)
  const proven: string[] = [];
  if (succeeded.size > 0) {
    for (const c of criteria) {
      markCriterionProven(c._id, nowIso);
      proven.push(c._id);
    }
  }

  setRunPhase(run._id, "reflect");
  journal(run._id, directive._id, "verified", { provenCriteria: proven, successfulTasks: succeeded.size });
}

function reflectAndYield(directive: DirectiveRow, run: RunRow, nowIso: string): void {
  const done = allCriteriaProven(directive._id);
  const reflection = done
    ? `All criteria proven; directive complete.`
    : `Run complete; criteria remain open. Re-arming per trigger policy.`;

  setRunPhase(run._id, "done", { reflectionText: reflection, completedAt: nowIso });
  journal(run._id, directive._id, "reflected", { done, reflection });

  if (done) {
    updateDirective(directive._id, { status: "done", lastRunId: run._id, lastRunAt: nowIso, nextRunAt: null });
    journal(run._id, directive._id, "yielded", { directiveStatus: "done" });
    return;
  }

  // Re-arm: compute next run time from the trigger policy.
  const policy: TriggerPolicy | null = parseTriggerPolicy(directive.triggerPolicy);
  const nextRunAt = policy ? computeNextRunAt(policy, nowIso, new Date(nowIso)) : null;
  // Manual/one-shot triggers (no schedule) go to sleep until re-triggered.
  const nextStatus = nextRunAt ? "active" : "sleeping";
  updateDirective(directive._id, {
    status: nextStatus,
    lastRunId: run._id,
    lastRunAt: nowIso,
    nextRunAt,
  });
  journal(run._id, directive._id, "yielded", { directiveStatus: nextStatus, nextRunAt });
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/**
 * One engine tick: advance every in-flight run by one phase, then open runs
 * for any due directives that don't already have an active run.
 *
 * Idempotent and safe to call every scheduler tick.
 */
export async function directiveTick(now: Date = new Date()): Promise<void> {
  const nowIso = now.toISOString();

  // 1. Advance in-flight runs.
  const active = getActiveRuns();
  const directivesWithActiveRun = new Set(active.map((r) => r.directiveId));

  for (const run of active) {
    const directive = getDirective(run.directiveId);
    if (!directive) {
      setRunPhase(run._id, "failed", { failedAt: nowIso, failReason: "directive missing" });
      continue;
    }
    try {
      switch (run.phase) {
        case "plan":    await planRun(directive, run); break;
        case "execute": await advanceExecuting(directive, run); break;
        case "verify":  await verifyRun(directive, run, nowIso); break;
        case "reflect": reflectAndYield(directive, run, nowIso); break;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setRunPhase(run._id, "failed", { failedAt: nowIso, failReason: reason });
      journal(run._id, directive._id, "run_failed", { reason });
    }
  }

  // 2. Open runs for due directives without an active run.
  for (const directive of getDueDirectives(nowIso)) {
    if (directivesWithActiveRun.has(directive._id)) continue;
    const run = createRun(directive._id);
    journal(run._id, directive._id, "run_started", { goal: directive.goal });
    updateDirective(directive._id, { lastRunId: run._id, lastRunAt: nowIso });
  }
}
