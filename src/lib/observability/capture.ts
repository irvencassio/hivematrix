/**
 * Capture per-run telemetry at task exit. Called from agent-manager's success
 * and failure paths with the in-scope objects; pulls the run's normalized
 * record together and persists it. Observability is non-critical — any failure
 * here must never affect task completion, so the whole thing is guarded.
 */

import type { AgentProcess } from "@/lib/orchestrator/subprocess";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { recordRun } from "./store";

type RunResult = AgentProcess["lastResult"];

export function captureRunTelemetry(args: {
  taskId: string;
  task: Record<string, unknown> | null;
  agent: AgentProcess;
  result: RunResult;
  status: string;
  completedAt: string;
  runIndex: number;
}): void {
  try {
    const t = args.task ?? {};
    let connectivity: string | null = null;
    try {
      connectivity = getConnectivityPolicy().mode;
    } catch {
      /* connectivity optional */
    }
    recordRun({
      taskId: args.taskId,
      runIndex: args.runIndex,
      model: args.agent.modelsUsed[0] ?? (t.model as string | null | undefined) ?? null,
      role: (t.profile as string | undefined) ?? (t.agentType as string | undefined) ?? null,
      connectivity,
      status: args.status,
      inputTokens: args.result?.inputTokens ?? null,
      outputTokens: args.result?.outputTokens ?? null,
      cacheReadTokens: args.result?.cacheReadTokens ?? null,
      cacheCreationTokens: args.result?.cacheCreationTokens ?? null,
      cacheCreate5mTokens: args.result?.cacheCreate5mTokens ?? null,
      cacheCreate1hTokens: args.result?.cacheCreate1hTokens ?? null,
      reasoningTokens: args.result?.reasoningTokens ?? null,
      costUsd: args.result?.cost ?? null,
      turns: args.result?.turns ?? null,
      startedAtMs: args.agent.startedAt.getTime(),
      completedAtMs: Date.parse(args.completedAt),
      firstTokenAtMs: args.agent.firstTokenAt ? args.agent.firstTokenAt.getTime() : null,
      directiveId: (t.directiveId as string | undefined) ?? null,
      proverType: (t.proverType as string | undefined) ?? null,
      project: (t.project as string | undefined) ?? null,
      createdAt: args.completedAt,
    });
  } catch {
    /* observability is non-critical — never break task completion */
  }
}
