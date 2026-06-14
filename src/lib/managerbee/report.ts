/**
 * ManagerBee — the control-plane heartbeat + diagnostics surface.
 *
 * ManagerBee does not run work; it reports on the autonomy loop. It folds the
 * scheduler diagnostics, the directive/run state, and the pending-escalation
 * counts into one snapshot the console + iOS render and the heartbeat caches.
 * Pure read-over-state so it is cheap to call on every tick and in tests.
 */

import { getSchedulerDiagnostics } from "@/lib/orchestrator/scheduler";
import { listDirectives, getActiveRuns, type DirectiveStatus, type RunPhase } from "@/lib/orchestrator/directive-store";
import { getPendingApprovals } from "@/lib/orchestrator/approval";
import { getPendingStuck } from "@/lib/orchestrator/stuck";
import { loopHealth, type LoopHealth } from "@/lib/feedback/self-improvement";

export interface ManagerBeeReport {
  generatedAt: string;
  scheduler: {
    state: string;
    blockReason: string;
    blockDetail?: string;
    slots: { used: number; total: number; available: number };
    spawnGateReady: boolean;
    backlogCount: number;
    delayedTaskCount: number;
    lastTickAt: string | null;
  };
  directives: {
    total: number;
    byStatus: Record<DirectiveStatus, number>;
  };
  runs: {
    inFlight: number;
    byPhase: Record<RunPhase, number>;
  };
  escalations: {
    pendingApprovals: number;
    pendingStuck: number;
  };
  /** Self-improvement loop signal: backlog resolution rate, recurring issues, age. */
  selfImprovement: LoopHealth;
  /** Roll-up health: "ok" unless the scheduler is blocked or escalations are waiting. */
  health: "ok" | "attention";
}

const DIRECTIVE_STATUSES: DirectiveStatus[] = ["active", "sleeping", "blocked", "done", "retired"];
const RUN_PHASES: RunPhase[] = ["plan", "execute", "verify", "reflect", "done", "failed"];

export function buildManagerBeeReport(nowIso: string = new Date().toISOString()): ManagerBeeReport {
  const diag = getSchedulerDiagnostics();

  const directives = listDirectives();
  const byStatus = Object.fromEntries(DIRECTIVE_STATUSES.map((s) => [s, 0])) as Record<DirectiveStatus, number>;
  for (const d of directives) {
    if (d.status in byStatus) byStatus[d.status] += 1;
  }

  const byPhase = Object.fromEntries(RUN_PHASES.map((p) => [p, 0])) as Record<RunPhase, number>;
  const activeRuns = getActiveRuns();
  for (const r of activeRuns) {
    if (r.phase in byPhase) byPhase[r.phase] += 1;
  }

  const pendingApprovals = getPendingApprovals().length;
  const pendingStuck = getPendingStuck().length;

  const health: ManagerBeeReport["health"] =
    diag.state === "blocked" || pendingStuck > 0 || pendingApprovals > 0 ? "attention" : "ok";

  return {
    generatedAt: nowIso,
    scheduler: {
      state: diag.state,
      blockReason: diag.blockReason,
      blockDetail: diag.blockDetail,
      slots: diag.slots,
      spawnGateReady: diag.spawnGateReady,
      backlogCount: diag.backlogCount,
      delayedTaskCount: diag.delayedTaskCount,
      lastTickAt: diag.lastTickAt,
    },
    directives: { total: directives.length, byStatus },
    runs: { inFlight: activeRuns.length, byPhase },
    escalations: { pendingApprovals, pendingStuck },
    selfImprovement: loopHealth(() => nowIso),
    health,
  };
}
