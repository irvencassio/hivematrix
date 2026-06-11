import { Task } from "@/lib/db";
import { MAX_AGENTS } from "@/lib/config/constants";
import { NO_REPO_LOCK_PROJECTS } from "@/lib/routing/aliases";
import {
  spawnAgent as spawnProcess,
  killAgent as killProcess,
  ensureAuth,
  type AgentProcess,
} from "./subprocess";
import { registerPid, unregisterPid } from "./pid-registry";
import type { StreamEvent } from "./stream-parser";
import { TurnBuilder } from "./turn-builder";
import type { Turn, WorkflowPhase } from "./turn-types";
import { deriveOutput } from "./derive-output";
import { raiseStuck } from "./stuck";
import { deriveReviewStateFromTurns } from "@/lib/tasks/review-state";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { isCodexModel } from "@/lib/models/catalog";
import { getLocalFallbackDecision, type LocalFallbackReason } from "@/lib/local-model/fallback";
import {
  notifySuperwhisperSession,
  notifySuperwhisperStreamEvent,
  notifySuperwhisperTaskStart,
  notifySuperwhisperTaskStop,
} from "@/lib/integrations/superwhisper-hive";

type EventBroadcaster = (taskId: string, event: StreamEvent) => void;
type TaskUpdateBroadcaster = (taskId: string, fields: Record<string, unknown>) => void;
type PendingSteer = { message: string; sessionId: string };
type TransientFailure = { transient: boolean; delayMinutes: number; reason: string };

export function detectTransientFailureText(text: string): TransientFailure {
  const patterns = [
    { match: /out of extra usage/i, delay: 60, reason: "Rate limit — out of extra usage" },
    { match: /rate limit/i, delay: 15, reason: "Rate limited" },
    { match: /not logged in/i, delay: 5, reason: "Auth expired — not logged in" },
    { match: /please run \/login/i, delay: 5, reason: "Auth expired — login required" },
    { match: /token.*expired/i, delay: 5, reason: "OAuth token expired" },
    { match: /another instance is currently performing an update|performing an update[\s\S]{0,200}please wait and try again later/i, delay: 2, reason: "Claude CLI update in progress" },
    { match: /overloaded/i, delay: 10, reason: "API overloaded" },
  ];

  for (const { match, delay, reason } of patterns) {
    if (match.test(text)) {
      return { transient: true, delayMinutes: delay, reason };
    }
  }
  return { transient: false, delayMinutes: 0, reason: "" };
}

type WatchdogTaskInfo = { missionId?: string | null; source?: string | null } | null | undefined;

export function shouldRaiseSilenceWatchdog(task: WatchdogTaskInfo): boolean {
  if (!task) return false;
  if (task.missionId) return true;
  return task.source === "dashboard";
}

class AgentManager {
  private agents = new Map<number, AgentProcess>();
  private broadcaster: EventBroadcaster = () => {};
  private taskUpdateBroadcaster: TaskUpdateBroadcaster = () => {};
  private textBuffers = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>();
  private turnBuilders = new Map<string, TurnBuilder>();
  private turnWritePromises = new Map<string, Promise<void>[]>();
  private lastEventAt = new Map<string, number>();
  private stuckRaisedFor = new Set<string>();
  private pendingSteers = new Map<string, PendingSteer>();
  private watchdogInterval: ReturnType<typeof setInterval> | null = null;

  // Spawn gate: prevents concurrent OAuth token refreshes by blocking new spawns
  // until the previous agent completes its auth handshake (init event).
  private spawnGateReady = true;
  private spawnGateTimeout: ReturnType<typeof setTimeout> | null = null;
  private static SPAWN_GATE_TIMEOUT_MS = 15_000;

  setBroadcaster(fn: EventBroadcaster) {
    this.broadcaster = fn;
  }

  /**
   * Silence watchdog: if no stream event arrives
   * within `watchdogMinutes` (default 5), raise a `stuck` request so a human
   * can nudge via Telegram/iOS. Applies to mission and dashboard-started tasks.
   * Default-on per user spec — opt out by setting
   * `telegram.watchdogMinutes` to 0 in ~/.hive/config.json.
   */
  startWatchdog() {
    if (this.watchdogInterval) return;
    const minutes = this.loadWatchdogMinutes();
    if (minutes <= 0) return;
    const thresholdMs = minutes * 60_000;

    this.watchdogInterval = setInterval(async () => {
      const now = Date.now();
      for (const agent of this.agents.values()) {
        if (this.stuckRaisedFor.has(agent.taskId)) continue;
        const last = this.lastEventAt.get(agent.taskId) ?? agent.startedAt.getTime();
        if (now - last < thresholdMs) continue;

        let task: WatchdogTaskInfo = null;
        try {
          task = await Task.findById(agent.taskId);
        } catch {
          // ignore
        }
        if (!shouldRaiseSilenceWatchdog(task)) continue;

        this.stuckRaisedFor.add(agent.taskId);
        const last50Lines = agent.textBuffer.split("\n").slice(-50).join("\n");
        // Fire and forget — resolution comes back via `resolveStuck` async.
        raiseStuck(
          agent.taskId,
          `Agent silent for ${minutes}+ min. Last activity ${new Date(last).toISOString()}.`,
          last50Lines,
          "watchdog"
        )
          .catch(() => {})
          .finally(() => this.stuckRaisedFor.delete(agent.taskId));
      }
    }, 60_000);
  }

  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  private loadWatchdogMinutes(): number {
    try {
      const cfg = JSON.parse(readFileSync(join(homedir(), ".hive", "config.json"), "utf-8"));
      const v = cfg?.telegram?.watchdogMinutes;
      if (typeof v === "number" && Number.isFinite(v)) return v;
    } catch {
      // default
    }
    return 5;
  }

  setTaskUpdateBroadcaster(fn: TaskUpdateBroadcaster) {
    this.taskUpdateBroadcaster = fn;
  }

  getRunningCount(): number {
    return this.agents.size;
  }

  getActiveRepos(): Set<string> {
    const repos = new Set<string>();
    for (const agent of this.agents.values()) {
      repos.add(agent.projectPath);
    }
    return repos;
  }

  // projectPaths of agents running WITHOUT a worktree (the 1-per-project slot)
  getActiveNonWorktreeRepos(): Set<string> {
    const repos = new Set<string>();
    for (const agent of this.agents.values()) {
      if (!agent.worktreeName) repos.add(agent.projectPath);
    }
    return repos;
  }

  // Active worktree locks as { projectPath, worktreeName } pairs
  getActiveWorktreeLocks(): { projectPath: string; worktreeName: string }[] {
    const locks: { projectPath: string; worktreeName: string }[] = [];
    for (const agent of this.agents.values()) {
      if (agent.worktreeName) {
        locks.push({ projectPath: agent.projectPath, worktreeName: agent.worktreeName });
      }
    }
    return locks;
  }

  getSlots(): { used: number; total: number; available: number } {
    return {
      used: this.agents.size,
      total: MAX_AGENTS,
      available: MAX_AGENTS - this.agents.size,
    };
  }

  /** Returns false while a recently spawned agent is still completing OAuth. */
  isSpawnGateReady(): boolean {
    return this.spawnGateReady;
  }

  private closeSpawnGate() {
    this.spawnGateReady = false;
    if (this.spawnGateTimeout) clearTimeout(this.spawnGateTimeout);
    this.spawnGateTimeout = setTimeout(() => {
      this.spawnGateReady = true;
      this.spawnGateTimeout = null;
    }, AgentManager.SPAWN_GATE_TIMEOUT_MS);
  }

  private openSpawnGate() {
    this.spawnGateReady = true;
    if (this.spawnGateTimeout) {
      clearTimeout(this.spawnGateTimeout);
      this.spawnGateTimeout = null;
    }
  }

  getAgentList() {
    return Array.from(this.agents.values()).map((a) => ({
      pid: a.pid,
      taskId: a.taskId,
      projectPath: a.projectPath,
      startedAt: a.startedAt.toISOString(),
      runtimeSeconds: Math.floor((Date.now() - a.startedAt.getTime()) / 1000),
    }));
  }

  isRepoLocked(projectPath: string, project?: string, worktreeName?: string | null, model?: string): boolean {
    if (project && NO_REPO_LOCK_PROJECTS.has(project)) return false;
    // Codex Computer Use drives the desktop, not the repo — skip repo locking regardless of project.
    if (model === "codex:gpt-5.4-computer-use") return false;
    if (worktreeName) {
      // Worktree tasks: locked only if the same worktree is already running
      return this.getActiveWorktreeLocks().some(
        (l) => l.projectPath === projectPath && l.worktreeName === worktreeName
      );
    }
    // Non-worktree tasks: locked if any non-worktree agent is running for this project
    return this.getActiveNonWorktreeRepos().has(projectPath);
  }

  async spawnAgent(taskId: string, description: string, projectPath: string, maxBudgetUsd: number, project?: string, workflow?: string, resumeSessionId?: string, model?: string, profile?: string, workflowStepIndex?: number, worktreeName?: string | null, agentType?: string, thinkingMode?: string, fastMode?: boolean) {
    if (this.agents.size >= MAX_AGENTS) {
      throw new Error(`Agent limit reached (${MAX_AGENTS})`);
    }
    if (this.isRepoLocked(projectPath, project, worktreeName, model)) {
      throw new Error(`Repo locked: ${projectPath}${worktreeName ? `:${worktreeName}` : ""}`);
    }
    // Computer Use mutex: only one CU task may run at a time (mouse/keyboard can't be shared).
    if (model === "codex:gpt-5.4-computer-use") {
      for (const a of this.agents.values()) {
        if (a.modelsUsed?.includes("codex:gpt-5.4-computer-use")) {
          throw new Error("Another Codex Computer Use task is already running");
        }
      }
    }

    // Skip auth check for non-Claude models (they use API keys, not OAuth)
    if (!model || model.startsWith("claude-")) {
      const auth = ensureAuth(profile);
      if (!auth.loggedIn) {
        throw new Error(`Auth failed for profile ${profile || "default"}: ${auth.error || "not logged in"}`);
      }
    }

    await Task.findByIdAndUpdate(taskId, {
      status: "in_progress",
      startedAt: new Date().toISOString(),
    });

    const agent = spawnProcess(
      taskId,
      description,
      projectPath,
      maxBudgetUsd,
      (tid, event) => this.handleEvent(tid, event),
      (tid, code, signal) => this.handleExit(tid, code, signal),
      project,
      workflow,
      resumeSessionId,
      model,
      profile,
      workflowStepIndex,
      worktreeName,
      agentType,
      thinkingMode,
      fastMode,
    );

    this.agents.set(agent.pid, agent);
    registerPid(taskId, agent.pid, projectPath);
    this.closeSpawnGate();
    notifySuperwhisperTaskStart({ taskId, description, projectPath, project, model });

    // Initialize per-agent TurnBuilder for structured log capture. Lives
    // alongside the legacy `logs[]` write path during dual-write phase.
    const phase: WorkflowPhase | undefined =
      workflow && workflow !== "standalone"
        ? {
            workflow,
            stepIndex: workflowStepIndex ?? 0,
          }
        : undefined;
    this.turnWritePromises.set(taskId, []);
    const builder = new TurnBuilder(taskId, (turn) => this.queueTurnPersist(taskId, turn), phase);
    this.turnBuilders.set(taskId, builder);
    if (phase) builder.emitWorkflowStart();

    await Task.findByIdAndUpdate(taskId, { agentPid: agent.pid, launchCommand: agent.launchCommand ?? null });

    const spawnLog = {
      timestamp: agent.startedAt.toISOString(),
      type: "text",
      content: `Agent spawned (PID ${agent.pid}) in ${projectPath}`,
    };
    try {
      await Task.findByIdAndUpdate(taskId, { $push: { logs: spawnLog } });
    } catch {
      // Broadcast still lets the live view reflect startup progress.
    }
    this.broadcaster(taskId, {
      type: "text",
      content: spawnLog.content,
    });
  }

  private queueTurnPersist(taskId: string, turn: Turn) {
    const pending = this.turnWritePromises.get(taskId) ?? [];
    const write = this.persistTurn(taskId, turn);
    pending.push(write);
    this.turnWritePromises.set(taskId, pending);
  }

  private async persistTurn(taskId: string, turn: Turn) {
    try {
      await Task.findByIdAndUpdate(taskId, { $push: { turns: turn as unknown as Record<string, unknown> } });
    } catch {
      // Don't crash on turn write failure — legacy `logs[]` path remains.
    }
  }

  private async awaitTurnWrites(taskId: string) {
    const pending = this.turnWritePromises.get(taskId) ?? [];
    this.turnWritePromises.delete(taskId);
    if (pending.length === 0) return;
    await Promise.allSettled(pending);
  }

  private async flushTextBuffer(taskId: string) {
    const buf = this.textBuffers.get(taskId);
    if (!buf || !buf.text) return;
    const content = buf.text;
    buf.text = "";

    try {
      await Task.findByIdAndUpdate(taskId, {
        $push: { logs: { timestamp: new Date().toISOString(), type: "text", content } },
      });
    } catch {
      // Don't crash on log write failure
    }
  }

  private async handleEvent(taskId: string, event: StreamEvent) {
    // Track last activity for the silence watchdog.
    this.lastEventAt.set(taskId, Date.now());
    const agent = Array.from(this.agents.values()).find((a) => a.taskId === taskId);
    if (agent && event.type === "error" && event.content) {
      agent.textBuffer += `\n${event.content}`;
    }

    // Feed every event into the TurnBuilder (dual-write alongside logs[]).
    const builder = this.turnBuilders.get(taskId);
    if (builder) builder.ingest(event);

    // For text deltas: accumulate and flush every 500ms to avoid spamming DB
    if (event.type === "text") {
      let buf = this.textBuffers.get(taskId);
      if (!buf) {
        buf = { text: "", timer: setTimeout(() => {}, 0) };
        this.textBuffers.set(taskId, buf);
      }
      buf.text += event.content;
      clearTimeout(buf.timer);
      buf.timer = setTimeout(() => this.flushTextBuffer(taskId), 500);

      // Broadcast immediately for live UI
      this.broadcaster(taskId, event);
      return;
    }

    // Flush any pending text before non-text events
    if (this.textBuffers.has(taskId)) {
      clearTimeout(this.textBuffers.get(taskId)!.timer);
      await this.flushTextBuffer(taskId);
    }

    if (event.type === "session") {
      if (agent) agent.sessionId = event.sessionId;
      try {
        await Task.findByIdAndUpdate(taskId, { sessionId: event.sessionId });
      } catch {
        // Best effort only.
      }
      this.taskUpdateBroadcaster(taskId, { sessionId: event.sessionId });
      notifySuperwhisperSession({ taskId, sessionId: event.sessionId, projectPath: agent?.projectPath });
      return;
    }

    // Init events are handled in subprocess (model tracking) — broadcast as text for live UI
    // Opening the spawn gate here signals that OAuth completed successfully,
    // so the next agent can safely start without racing on token refresh.
    if (event.type === "init") {
      this.openSpawnGate();
      const content = `Session started (model: ${event.model})`;
      try {
        await Task.findByIdAndUpdate(taskId, {
          $push: { logs: { timestamp: new Date().toISOString(), type: "text", content } },
        });
      } catch {
        // Don't block the stream on log persistence.
      }
      this.broadcaster(taskId, { type: "text", content });
      return;
    }

    // Build log entry for non-text events
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: event.type === "result" ? "text" : event.type,
      content:
        event.type === "tool_use"
          ? `${event.tool}: ${event.input.slice(0, 200)}`
          : event.type === "tool_result"
          ? event.content
          : event.type === "question"
          ? event.prompt
          : event.type === "result"
          ? event.result
          : event.type === "error"
          ? event.content
          : JSON.stringify(event),
    };

    try {
      await Task.findByIdAndUpdate(taskId, {
        $push: { logs: logEntry },
      });
    } catch {
      // Don't crash on log write failure
    }

    notifySuperwhisperStreamEvent({ taskId, sessionId: agent?.sessionId, projectPath: agent?.projectPath }, event);
    this.broadcaster(taskId, event);
  }

  /** Detect transient failures (rate limit, auth) that should auto-retry. */
  private detectTransientFailure(agent: AgentProcess): TransientFailure {
    return detectTransientFailureText(agent.textBuffer);
  }

  private detectLocalFallbackReason(agent: AgentProcess): LocalFallbackReason | null {
    const text = agent.textBuffer.toLowerCase();
    if (/out of extra usage|rate limit|quota|usage limit|too many requests|http 429|\b429\b/i.test(text)) {
      return "usage";
    }
    if (
      /offline|network.*unreachable|internet.*unreachable|enotfound|eai_again|timed out|fetch failed|connection error|could not resolve|dns|socket hang up/i.test(text)
    ) {
      return "offline";
    }
    if (/api overloaded|service unavailable|bad gateway|temporarily unavailable|http 503|http 502|overloaded/i.test(text)) {
      return "provider_unavailable";
    }
    return null;
  }

  private async handleExit(taskId: string, code: number | null, signal: string | null) {
    // Ensure spawn gate is open so next agent can start
    this.openSpawnGate();

    // Flush any pending text buffer
    if (this.textBuffers.has(taskId)) {
      clearTimeout(this.textBuffers.get(taskId)!.timer);
      await this.flushTextBuffer(taskId);
      this.textBuffers.delete(taskId);
    }

    // Close any open turn, emit workflow_step_end if applicable.
    const builder = this.turnBuilders.get(taskId);
    if (builder) {
      builder.emitWorkflowEnd();
      builder.flush();
      this.turnBuilders.delete(taskId);
    }
    await this.awaitTurnWrites(taskId);

    const agent = Array.from(this.agents.values()).find((a) => a.taskId === taskId);
    if (!agent) return;

    this.agents.delete(agent.pid);
    unregisterPid(agent.pid);
    this.lastEventAt.delete(agent.taskId);
    this.stuckRaisedFor.delete(agent.taskId);

    try {
      // Read current task state for token accumulation (needed by ALL exit paths)
      const result = agent.lastResult;
      let task: Awaited<ReturnType<typeof Task.findById>> = null;
      try {
        task = await Task.findById(taskId);
      } catch {
        // Don't block completion if task read fails
      }

      // Accumulate token usage across runs — runs for ALL exit paths (success,
      // failure, transient retry) so that no spend data is silently discarded.
      const prev = (task?.output ?? {}) as Record<string, unknown>;
      const prevCost = (prev.cost as number) ?? 0;
      const prevTurns = (prev.turns as number) ?? 0;
      const prevInput = (prev.inputTokens as number) ?? 0;
      const prevOutput = (prev.outputTokens as number) ?? 0;
      const prevCacheRead = (prev.cacheReadTokens as number) ?? 0;
      const prevCacheCreate = (prev.cacheCreationTokens as number) ?? 0;
      const prevRunCount = (prev.runCount as number) ?? (prevCost > 0 ? 1 : 0);
      const prevModels = (prev.modelsUsed as string[]) ?? [];

      const runCost = result?.cost ?? 0;
      const runTurns = result?.turns ?? 0;
      const runInput = result?.inputTokens ?? 0;
      const runOutput = result?.outputTokens ?? 0;

      // Merge models: keep unique list across all runs
      const allModels = [...new Set([...prevModels, ...agent.modelsUsed])];

      const accumulatedOutput = {
        ...(task?.output ?? {}),
        cost: prevCost + runCost,
        turns: prevTurns + runTurns,
        inputTokens: prevInput + runInput,
        outputTokens: prevOutput + runOutput,
        cacheReadTokens: prevCacheRead + (result?.cacheReadTokens ?? 0),
        cacheCreationTokens: prevCacheCreate + (result?.cacheCreationTokens ?? 0),
        contextWindow: result?.contextWindow ?? 0,
        modelsUsed: allModels,
        lastRunCost: runCost,
        lastRunTurns: runTurns,
        lastRunInputTokens: runInput,
        lastRunOutputTokens: runOutput,
        runCount: prevRunCount + 1,
      };

      const pendingSteer = this.pendingSteers.get(taskId);
      if (pendingSteer) {
        this.pendingSteers.delete(taskId);
        await this.restartTaskWithSteer(taskId, task, accumulatedOutput, pendingSteer);
        return;
      }

      if (code !== 0) {
        const fallbackReason = this.detectLocalFallbackReason(agent);
        if (fallbackReason) {
          const currentTask = task as Record<string, unknown> | null;
          const fallback = await getLocalFallbackDecision({
            currentModelId: currentTask?.model as string | null | undefined,
            project: String(currentTask?.project ?? ""),
            reason: fallbackReason,
          });
          if (fallback) {
            const output = {
              ...accumulatedOutput,
              transientRetries: 0,
              fallbackReason,
              fallbackSourceModel: currentTask?.model ?? "claude-default",
              fallbackTargetModel: fallback.modelId,
              fallbackAt: new Date().toISOString(),
            };
            await Task.findByIdAndUpdate(taskId, {
              status: "backlog",
              model: fallback.modelId,
              project: fallback.project,
              projectPath: fallback.projectPath,
              agentPid: null,
              completedAt: null,
              startedAt: null,
              error: null,
              delayUntil: null,
              delayReason: null,
              output,
              logs: [],
              turns: [],
            });

            this.broadcaster(taskId, {
              type: "text",
              content: fallback.summary,
            });
            notifySuperwhisperTaskStop({
              taskId,
              sessionId: agent.sessionId,
              projectPath: fallback.projectPath,
              status: "backlog",
              summary: fallback.summary,
            });
            return;
          }
        }
      }

      // Auto-retry transient failures (rate limit, auth) instead of marking failed.
      // Token data is accumulated BEFORE requeue so it survives the retry.
      // Cap consecutive transient retries to prevent infinite loops (e.g. bad prompt,
      // persistent auth failure) — after MAX_TRANSIENT_RETRIES, mark as failed.
      const MAX_TRANSIENT_RETRIES = 5;
      if (code !== 0) {
        const transient = this.detectTransientFailure(agent);
        if (transient.transient) {
          // For auth failures, attempt token refresh before requeueing
          if (transient.reason.includes("Auth") || transient.reason.includes("login") || transient.reason.includes("token")) {
            const taskProfile = (task as Record<string, unknown>)?.profile as string | undefined;
            const refreshResult = ensureAuth(taskProfile);
            if (refreshResult.loggedIn) {
              console.log(`[auth] Refreshed auth for profile ${taskProfile || "default"} after transient failure`);
            }
          }

          const prevTransientRetries = (prev.transientRetries as number) ?? 0;
          const nextRetries = prevTransientRetries + 1;

          if (nextRetries <= MAX_TRANSIENT_RETRIES) {
            const delayUntil = new Date(Date.now() + transient.delayMinutes * 60_000).toISOString();
            await Task.findByIdAndUpdate(taskId, {
              status: "backlog",
              agentPid: null,
              completedAt: null,
              startedAt: null,
              error: null,
              delayUntil,
              delayReason: "transient_retry",
              output: { ...accumulatedOutput, transientRetries: nextRetries },
              logs: [], // Clear logs so retry starts fresh
              turns: [], // Clear structured turns alongside
            });

            this.broadcaster(taskId, {
              type: "text",
              content: `Auto-retry ${nextRetries}/${MAX_TRANSIENT_RETRIES}: ${transient.reason}. Requeued — will retry after ${transient.delayMinutes}m.`,
            });
            notifySuperwhisperTaskStop({
              taskId,
              sessionId: agent.sessionId,
              projectPath: agent.projectPath,
              status: "backlog",
              summary: `Auto-retry ${nextRetries}/${MAX_TRANSIENT_RETRIES}: ${transient.reason}. Requeued and will retry after ${transient.delayMinutes} minutes.`,
            });
            return;
          }
          // Exceeded retry cap — fall through to mark as failed
          this.broadcaster(taskId, {
            type: "error",
            content: `Transient retry cap exceeded (${MAX_TRANSIENT_RETRIES} consecutive failures). Last reason: ${transient.reason}. Marking as failed.`,
          });
        }
      }

      // Build summary for ALL exit paths — both success and failure benefit from
      // surfacing the agent's text output so users don't have to dig through logs.
      //
      // Primary path: derive headline from structured turns. Falls back to
      // legacy log-walking heuristic when turns[] is empty (old tasks,
      // dual-write gap, or builder failure).
      let summary = "";
      const turns = (task as unknown as { turns?: Array<Record<string, unknown>> })?.turns ?? [];
      if (Array.isArray(turns) && turns.length > 0) {
        try {
          const workflow = task?.workflow && task.workflow !== "standalone"
            ? { workflow: task.workflow as string, stepIndex: (task.workflowStepIndex as number) ?? 0 }
            : undefined;
          const view = deriveOutput(turns as unknown as Turn[], { workflow });
          if (view.awaiting && view.headline) {
            summary = `❓ Awaiting your reply:\n\n${view.headline.text}`;
          } else if (view.headline?.text) {
            summary = view.headline.text;
          } else if (view.resultStats?.summaryText) {
            summary = view.resultStats.summaryText;
          }
        } catch {
          // Fall through to legacy path
        }
      }

      if (!summary) {
        // Legacy fallback: walk logs[] backwards for consecutive trailing text.
        try {
          if (task?.logs?.length) {
            let lastMessage = "";
            for (let i = task.logs.length - 1; i >= 0; i--) {
              const log = task.logs[i] as Record<string, unknown>;
              if (log.type === "text" && typeof log.content === "string" && (log.content as string).trim().length > 0) {
                lastMessage = (log.content as string) + lastMessage;
              } else if (lastMessage) {
                break;
              }
            }
            if (lastMessage.trim()) summary = lastMessage.trim();
          }
        } catch {
          // Don't block completion if log check fails
        }

        if (!summary) {
          summary = result?.result || agent.textBuffer.slice(-5000) || "";
        }

        // Surface AskUserQuestion content from logs[] (legacy path only).
        try {
          if (task?.logs?.length) {
            const questions = task.logs
              .filter(
                (log: Record<string, unknown>) =>
                  log.type === "tool_use" &&
                  typeof log.content === "string" &&
                  (log.content as string).startsWith("AskUserQuestion:")
              )
              .map((log: Record<string, unknown>) =>
                (log.content as string).replace("AskUserQuestion: ", "").trim()
              );
            if (questions.length > 0) {
              const qBlock = questions.map((q: string) => `❓ ${q}`).join("\n");
              summary = `${qBlock}\n\n---\n\n${summary}`;
            }
          }
        } catch {
          // Don't block completion if log re-read fails
        }
      }

      if (code === 0) {
        // Re-read in case the agent PATCHed status (e.g. self-reported failure)
        // immediately before exiting.
        let currentStatus: string | undefined;
        let currentError: string | null | undefined;
        try {
          const fresh = await Task.findById(taskId);
          currentStatus = (fresh as Record<string, unknown> | null)?.status as string | undefined;
          currentError = (fresh as Record<string, unknown> | null)?.error as string | null | undefined;
        } catch {
          // Fall through and use default behavior
        }

        const agentReportedFailure = currentStatus === "failed";
        const completedAt = new Date().toISOString();
        const output = {
          ...accumulatedOutput,
          summary,
          filesChanged: [],
          transientRetries: 0, // reset on success
        };
        const nextStatus = agentReportedFailure ? "failed" : "review";
        const reviewState = agentReportedFailure
          ? null
          : summary.startsWith("❓ Awaiting your reply:")
            ? "needs_input"
            : deriveReviewStateFromTurns(turns as unknown as Turn[]);
        const update: Record<string, unknown> = {
          status: nextStatus,
          reviewState,
          agentPid: null,
          completedAt,
          sessionId: result?.sessionId ?? null,
          output,
        };
        if (agentReportedFailure && currentError) {
          update.error = currentError;
        }
        await Task.findByIdAndUpdate(taskId, update);
        this.taskUpdateBroadcaster(taskId, {
          ...update,
          turns,
        });
        if (task?.missionId) {
          // directive progress is tracked via run_journal in db, not a progress doc
        }
        notifySuperwhisperTaskStop({
          taskId,
          sessionId: result?.sessionId ?? agent.sessionId,
          projectPath: agent.projectPath,
          project: task?.project,
          model: task?.model ?? undefined,
          status: nextStatus,
          summary,
          error: agentReportedFailure ? currentError : null,
        });
      } else {
        const completedAt = new Date().toISOString();
        const error = signal
          ? `Killed by signal: ${signal}`
          : `Exited with code: ${code}`;
        await Task.findByIdAndUpdate(taskId, {
          status: "failed",
          agentPid: null,
          completedAt,
          error,
          output: { ...accumulatedOutput, summary },
        });
        if (task?.missionId) {
          // directive progress is tracked via run_journal in db, not a progress doc
        }
        this.taskUpdateBroadcaster(taskId, {
          status: "failed",
          agentPid: null,
          completedAt,
          error,
          output: { ...accumulatedOutput, summary },
          turns,
        });
        notifySuperwhisperTaskStop({
          taskId,
          sessionId: agent.sessionId,
          projectPath: agent.projectPath,
          project: task?.project,
          model: task?.model ?? undefined,
          status: "failed",
          summary,
          error,
        });
      }
    } catch (err) {
      console.error("Failed to update task on agent exit:", err);
    }

    this.broadcaster(taskId, {
      type: "text",
      content: `Agent exited (code=${code}, signal=${signal})`,
    });
  }

  async killAgentByPid(pid: number) {
    const agent = this.agents.get(pid);
    if (!agent) return;
    await killProcess(agent.proc);
  }

  async killAgentByTaskId(taskId: string) {
    const agent = Array.from(this.agents.values()).find((a) => a.taskId === taskId);
    if (!agent) return;
    await killProcess(agent.proc);
  }

  async requestSteerByTaskId(taskId: string, message: string) {
    const steer = message.trim();
    if (!steer) throw new Error("message is required");

    const agent = Array.from(this.agents.values()).find((a) => a.taskId === taskId);
    if (!agent) throw new Error("No running agent for this task");

    const task = await Task.findById(taskId);
    if (!task) throw new Error("Task not found");
    if (task.status !== "in_progress") throw new Error("Can only steer in-progress tasks");
    if (!isCodexModel(task.model)) throw new Error("Steering is currently supported only for Codex/ChatGPT tasks");

    const sessionId = agent.sessionId ?? task.sessionId;
    if (!sessionId) throw new Error("Codex thread id is not available yet. Wait for the task to finish starting and try again.");

    this.pendingSteers.set(taskId, { message: steer, sessionId });
    this.broadcaster(taskId, {
      type: "text",
      content: `Steer requested. Interrupting current run and resuming the Codex thread with your new instruction.`,
    });
    await killProcess(agent.proc);
  }

  private async restartTaskWithSteer(
    taskId: string,
    task: Awaited<ReturnType<typeof Task.findById>>,
    accumulatedOutput: Record<string, unknown>,
    pendingSteer: PendingSteer,
  ) {
    if (!task) throw new Error("Task not found during steer restart");

    const nextDescription = `${task.description}\n\n---\n**Steer:** ${pendingSteer.message}`;
    const taskRow = task as Record<string, unknown>;
    const nextSessionId = pendingSteer.sessionId;
    const requeueFields = {
      description: nextDescription,
      status: "backlog",
      agentPid: null,
      startedAt: null,
      completedAt: null,
      error: null,
      sessionId: nextSessionId,
      resumeSessionId: nextSessionId,
      output: { ...accumulatedOutput, transientRetries: 0 },
    };

    await Task.findByIdAndUpdate(taskId, requeueFields);
    if (task.missionId) {
      // directive progress is tracked via run_journal in db, not a progress doc
    }
    this.taskUpdateBroadcaster(taskId, requeueFields);
    this.broadcaster(taskId, {
      type: "text",
      content: "Restarting the task with your steer command in the same Codex thread.",
    });

    try {
      await this.spawnAgent(
        taskId,
        nextDescription,
        task.projectPath,
        task.maxBudgetUsd,
        task.project,
        task.workflow,
        nextSessionId,
        task.model ?? undefined,
        task.profile ?? undefined,
        taskRow.workflowStepIndex as number | undefined,
        taskRow.worktreeName as string | null | undefined,
        (taskRow.agentType as string | undefined) ?? "auto",
        taskRow.thinkingMode as string | undefined,
        taskRow.fastMode === true,
      );
      await Task.findByIdAndUpdate(taskId, { resumeSessionId: null });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await Task.findByIdAndUpdate(taskId, {
        status: "backlog",
        agentPid: null,
        startedAt: null,
        completedAt: null,
        error,
      });
      this.taskUpdateBroadcaster(taskId, {
        status: "backlog",
        agentPid: null,
        startedAt: null,
        completedAt: null,
        error,
      });
      this.broadcaster(taskId, {
        type: "error",
        content: `Failed to restart steered task: ${error}`,
      });
    }
  }

  async shutdown() {
    const kills = Array.from(this.agents.values()).map((a) => killProcess(a.proc));
    await Promise.all(kills);
    this.agents.clear();
  }
}

// Global singleton — survives Next.js module re-bundling so server.ts
// and API routes always share the same instance.
const g = globalThis as unknown as { __hiveAgentManager?: AgentManager };
if (!g.__hiveAgentManager) {
  g.__hiveAgentManager = new AgentManager();
}
export const agentManager = g.__hiveAgentManager;
