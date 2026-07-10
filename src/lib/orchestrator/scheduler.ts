import { Task } from "@/lib/db";
import { SCHEDULER_INTERVAL_MS, getActiveProfile } from "@/lib/config/constants";
import { NO_REPO_LOCK_PROJECTS } from "@/lib/routing/aliases";
import { agentManager } from "./agent-manager";
import { readCachedUsage, type ProfileUsage } from "@/lib/usage/fetcher";
import { broadcast } from "@/lib/ws/broadcaster";
import { getLocalFallbackDecision } from "@/lib/local-model/fallback";
import { missionTick } from "./mission-engine";
import { syncMissionProgressDoc } from "./mission-progress-doc";
import { scheduledRunnerTick } from "./scheduled-runner";
import { isCodexModel } from "@/lib/models/catalog";
import { dispatchInventorBeeTask } from "@/lib/inventorbee/task-dispatch";
import type { TaskDelayReason } from "@/lib/types";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { getRoleModels } from "@/lib/models/available";
import { isFeatureEnabled } from "@/lib/config/features";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 60_000;

// --- Scheduler diagnostics (observable state) ---
export type SchedulerBlockReason =
  | "none"
  | "no_slots"
  | "spawn_gate"
  | "rate_limited"
  | "no_backlog";

export interface SchedulerDiagnostics {
  state: "running" | "blocked" | "idle";
  blockReason: SchedulerBlockReason;
  blockDetail?: string;
  slots: { used: number; total: number; available: number };
  spawnGateReady: boolean;
  usage: {
    blocked: boolean;
    resetsAt?: string;
    activeProfile: string;
  };
  delayedTaskCount: number;
  backlogCount: number;
  consecutiveErrors: number;
  lastTickAt: string | null;
}

let lastDiagnostics: SchedulerDiagnostics = {
  state: "idle",
  blockReason: "none",
  slots: { used: 0, total: 4, available: 4 },
  spawnGateReady: true,
  usage: { blocked: false, activeProfile: "" },
  delayedTaskCount: 0,
  backlogCount: 0,
  consecutiveErrors: 0,
  lastTickAt: null,
};

let lastBroadcastState = "";

function updateDiagnostics(partial: Partial<SchedulerDiagnostics>) {
  lastDiagnostics = { ...lastDiagnostics, ...partial, lastTickAt: new Date().toISOString() };

  // Broadcast only when the observable state actually changes
  const key = `${lastDiagnostics.state}:${lastDiagnostics.blockReason}:${lastDiagnostics.slots.used}:${lastDiagnostics.usage.blocked}:${lastDiagnostics.delayedTaskCount}:${lastDiagnostics.backlogCount}`;
  if (key !== lastBroadcastState) {
    lastBroadcastState = key;
    broadcast({ type: "scheduler_status", diagnostics: lastDiagnostics });
  }
}

export function getSchedulerDiagnostics(): SchedulerDiagnostics {
  return { ...lastDiagnostics };
}

export interface TaskUsageSubject {
  model?: string | null;
  profile?: string | null;
  delayUntil?: string | null;
  delayReason?: TaskDelayReason | null;
}

export interface TaskUsageAvailability {
  ok: boolean;
  provider: "claude" | "codex" | "other";
  profile?: string;
  resetsAt?: string;
}

function normalizeClaudeUsageProfile(profileOrConfigDir: string | null | undefined): string {
  const normalized = String(profileOrConfigDir ?? "").trim().replace(/^\./, "");
  if (!normalized || normalized === "claude") return "default";
  return normalized.replace(/^claude-/, "") || "default";
}

function getUsageSubject(task: TaskUsageSubject, activeProfile: string): Pick<TaskUsageAvailability, "provider" | "profile"> {
  if (isCodexModel(task.model)) {
    return { provider: "codex", profile: "chatgpt" };
  }
  if (task.model && !task.model.startsWith("claude-")) {
    return { provider: "other" };
  }
  return {
    provider: "claude",
    profile: normalizeClaudeUsageProfile(task.profile || activeProfile),
  };
}

/** Check if a task's own provider/profile has enough usage headroom to spawn. */
export function getUsageAvailabilityForTask(
  task: TaskUsageSubject,
  cached: { profiles: ProfileUsage[] } | null,
  activeProfile: string = getActiveProfile()
): TaskUsageAvailability {
  const subject = getUsageSubject(task, activeProfile);
  if (subject.provider === "other" || !cached) return { ok: true, ...subject };

  const profile = cached.profiles.find((p: ProfileUsage) => {
    const provider = p.provider ?? "claude";
    return provider === subject.provider && p.profile === subject.profile;
  });
  if (!profile) return { ok: true, ...subject };

  // Block if 5-hour window is at 95%+ utilization
  if (profile.fiveHour && profile.fiveHour.utilization >= 95) {
    return { ok: false, ...subject, resetsAt: profile.fiveHour.resetsAt };
  }

  // Block if 7-day window is at 95%+ utilization
  if (profile.sevenDay && profile.sevenDay.utilization >= 95) {
    return { ok: false, ...subject, resetsAt: profile.sevenDay.resetsAt };
  }

  return { ok: true, ...subject };
}

/**
 * Resolve "auto" to a concrete agentType: classify when the
 * `agentSpecialization` feature is on, else the fixed "developer" fallback
 * (today's behavior — unchanged when the flag is absent/off). Only ever
 * called for tasks whose agentType is "auto"; an explicit agentType on the
 * task always bypasses this entirely.
 */
export async function resolveAutoAgentType(description: string): Promise<string> {
  if (!isFeatureEnabled("agentSpecialization")) return "developer";
  const { classifyTask } = await import("./intent-classifier");
  return classifyTask(description);
}

export function resolveModelForAgentRole(currentModel: string | null | undefined, agentType: string | null | undefined): string | undefined {
  const pinned = currentModel?.trim();
  if (pinned) return pinned;
  const roleModels = getRoleModels();
  const normalizedAgent = String(agentType ?? "").trim();
  if (normalizedAgent === "developer" || normalizedAgent === "cto" || normalizedAgent === "qa") {
    return roleModels.coding.trim() || undefined;
  }
  if (normalizedAgent === "marketing") {
    return roleModels.writer.trim() || undefined;
  }
  return undefined;
}

function toResetIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function matchesAnyUsageReset(delayUntil: string | null | undefined, cached: { profiles: ProfileUsage[] } | null): boolean {
  const delayIso = toResetIso(delayUntil);
  if (!delayIso || !cached) return false;
  const delayMs = new Date(delayIso).getTime();
  const resetToleranceMs = 2 * 60 * 1000;

  return cached.profiles.some((profile) => {
    const resetValues = [
      profile.fiveHour?.resetsAt,
      profile.sevenDay?.resetsAt,
      profile.sevenDayOpus?.resetsAt,
      profile.sevenDaySonnet?.resetsAt,
    ];
    return resetValues.some((reset) => {
      const resetIso = toResetIso(reset);
      if (!resetIso) return false;
      return Math.abs(new Date(resetIso).getTime() - delayMs) <= resetToleranceMs;
    });
  });
}

export function shouldClearStaleUsageDelay(
  task: TaskUsageSubject,
  cached: { profiles: ProfileUsage[] } | null,
  activeProfile: string = getActiveProfile()
): boolean {
  if (task.delayReason && task.delayReason !== "usage_limit") return false;
  if (!matchesAnyUsageReset(task.delayUntil, cached)) return false;
  return getUsageAvailabilityForTask(task, cached, activeProfile).ok;
}

async function clearStaleUsageDelays(
  cached: { profiles: ProfileUsage[] } | null,
  activeProfile: string
): Promise<number> {
  if (!cached) return 0;
  const now = new Date().toISOString();
  const delayed = await Task.find({
    status: "backlog",
    executor: "agent",
    delayUntil: { $gt: now },
  }).limit(50);

  let cleared = 0;
  const restoredProviders = new Set<string>();
  for (const task of delayed) {
    if (!shouldClearStaleUsageDelay(
      {
        model: task.model ?? undefined,
        profile: task.profile ?? undefined,
        delayUntil: task.delayUntil ?? undefined,
        delayReason: task.delayReason as TaskDelayReason | null | undefined,
      },
      cached,
      activeProfile
    )) {
      continue;
    }
    await Task.findByIdAndUpdate(task._id.toString(), { delayUntil: null, delayReason: null });
    broadcast({ type: "task:updated", taskId: task._id.toString(), fields: { delayUntil: null, delayReason: null } });
    const subject = getUsageSubject(
      { model: task.model ?? undefined, profile: task.profile ?? undefined },
      activeProfile
    );
    restoredProviders.add(subject.provider);
    cleared++;
  }
  const policy = getConnectivityPolicy();
  for (const provider of restoredProviders) {
    policy.onUsageWindowRestored(provider);
  }
  return cleared;
}

async function tick() {
  try {
    // Fire due scheduled_tasks first so their tasks can be claimed this tick
    try {
      await scheduledRunnerTick();
    } catch (err) {
      console.error("[scheduler] scheduledRunnerTick error:", err instanceof Error ? err.message : err);
    }

    // Run mission DAG engine before scheduling — promotes eligible tasks
    try {
      await missionTick();
    } catch (err) {
      console.error("[scheduler] missionTick error:", err instanceof Error ? err.message : err);
    }

    const slots = agentManager.getSlots();

    if (slots.available <= 0) {
      updateDiagnostics({ state: "blocked", blockReason: "no_slots", blockDetail: `${slots.used}/${slots.total} agents running`, slots, consecutiveErrors });
      return;
    }

    // Wait for the previous agent to finish its OAuth handshake before
    // spawning another — concurrent token refreshes cause login prompts.
    if (!agentManager.isSpawnGateReady()) {
      updateDiagnostics({ state: "blocked", blockReason: "spawn_gate", blockDetail: "Waiting for agent OAuth handshake", slots, spawnGateReady: false, consecutiveErrors });
      return;
    }

    const usageCache = readCachedUsage();
    const activeProfile = getActiveProfile();
    const clearedStaleDelays = await clearStaleUsageDelays(usageCache, activeProfile);

    // Reset error count on successful operation
    consecutiveErrors = 0;

    const activeNonWorktreeRepos = agentManager.getActiveNonWorktreeRepos();
    const activeWorktreeLocks = agentManager.getActiveWorktreeLocks();
    const hasAnyLocks = activeNonWorktreeRepos.size > 0 || activeWorktreeLocks.length > 0;

    // Find oldest backlog task not targeting a locked slot.
    // Rules:
    //   - No-lock projects (e.g. ops) always run
    //   - Non-worktree tasks: 1 per projectPath (blocked by activeNonWorktreeRepos)
    //   - Worktree tasks: 1 per (projectPath, worktreeName) (blocked by activeWorktreeLocks)
    const noLockProjects = Array.from(NO_REPO_LOCK_PROJECTS);
    // Exclude tasks delayed until a future time from the query itself
    // (prevents the scheduler from repeatedly picking up and reverting the same delayed task)
    const now = new Date().toISOString();
    const notDelayed = { $or: [{ delayUntil: null }, { delayUntil: { $lte: now } }] };
    const query: Record<string, unknown> = { status: "backlog", executor: "agent" };
    if (hasAnyLocks) {
      // Non-worktree tasks eligible if their projectPath has no non-worktree agent running
      const isNonWorktree = { $or: [{ worktreeName: null }, { worktreeName: { $exists: false } }] };
      const nonWorktreeCondition: Record<string, unknown> =
        activeNonWorktreeRepos.size > 0
          ? { $and: [isNonWorktree, { projectPath: { $nin: Array.from(activeNonWorktreeRepos) } }] }
          : isNonWorktree;

      // Worktree tasks eligible if their specific (projectPath, worktreeName) isn't running
      const worktreeCondition: Record<string, unknown> = { worktreeName: { $ne: null } };
      if (activeWorktreeLocks.length > 0) {
        worktreeCondition.$nor = activeWorktreeLocks.map(({ projectPath, worktreeName }) => ({
          projectPath,
          worktreeName,
        }));
      }

      // Combine lock eligibility with delay filter using $and
      query.$and = [
        notDelayed,
        { $or: [
          { project: { $in: noLockProjects } },
          nonWorktreeCondition,
          worktreeCondition,
        ] },
      ];
    } else {
      // No locks — just add the delay filter
      Object.assign(query, notDelayed);
    }

    // Count backlog stats for diagnostics
    const [backlogCount, delayedCount] = await Promise.all([
      Task.countDocuments({ status: "backlog", executor: "agent" }),
      Task.countDocuments({ status: "backlog", executor: "agent", delayUntil: { $ne: null, $gt: new Date().toISOString() } }),
    ]);

    // Multi-claim loop: fill all available slots in one tick for parallel wave execution
    let claimed = 0;
    let currentSlots = slots;
    let rateLimitedTasks = 0;
    let lastRateLimitReset: string | undefined;

    while (currentSlots.available > 0 && agentManager.isSpawnGateReady()) {
      const assignedAt = new Date().toISOString();
      const task = await Task.findOne(query).sort({ position: 1 });

      if (!task) break; // No more eligible tasks

      // An explicit agentType on the task (set by the operator or the prompt
      // wizard) always wins and is used as-is — resolveAutoAgentType is only
      // consulted for "auto". The resolved agent role also determines which
      // role-model default applies when the task itself was intentionally
      // created backend-agnostic.
      let agentType = ((task as Record<string, unknown>).agentType as string) ?? "auto";
      if (agentType === "auto") {
        agentType = await resolveAutoAgentType(task.description);
      }
      const effectiveModel = resolveModelForAgentRole(task.model ?? undefined, agentType);

      const usage = getUsageAvailabilityForTask(
        { model: effectiveModel, profile: task.profile ?? undefined },
        usageCache,
        activeProfile
      );
      if (!usage.ok) {
        // Notify connectivity policy so it can degrade to local-only mode
        if (usage.provider) {
          getConnectivityPolicy().onUsageWindowExhausted(usage.provider);
        }
        const fallback = await getLocalFallbackDecision({
          currentModelId: effectiveModel,
          project: task.project,
          reason: "usage",
        });
        if (fallback) {
          const output = {
            ...(task.output ?? {}),
            fallbackReason: "usage_exhausted",
            fallbackSourceModel: effectiveModel ?? "claude-default",
            fallbackTargetModel: fallback.modelId,
            fallbackAt: new Date().toISOString(),
          };
          await Task.findByIdAndUpdate(task._id.toString(), {
            model: fallback.modelId,
            project: fallback.project,
            projectPath: fallback.projectPath,
            delayUntil: null,
            delayReason: null,
            output,
          });
          broadcast({
            type: "task:updated",
            taskId: task._id.toString(),
            fields: {
              model: fallback.modelId,
              project: fallback.project,
              projectPath: fallback.projectPath,
              delayUntil: null,
              delayReason: null,
              output,
            },
          });
          continue;
        }

        const resetTime = usage.resetsAt
          ? new Date(usage.resetsAt).toISOString()
          : new Date(Date.now() + 15 * 60_000).toISOString();
        await Task.findByIdAndUpdate(task._id.toString(), { delayUntil: resetTime, delayReason: "usage_limit" });
        broadcast({ type: "task:updated", taskId: task._id.toString(), fields: { delayUntil: resetTime, delayReason: "usage_limit" } });
        rateLimitedTasks++;
        lastRateLimitReset = resetTime;
        continue;
      }

      await Task.findByIdAndUpdate(task._id.toString(), {
        status: "assigned",
        assignedAt,
        delayUntil: null,
        delayReason: null,
        ...(effectiveModel && effectiveModel !== task.model ? { model: effectiveModel } : {}),
        ...(agentType !== ((task as Record<string, unknown>).agentType as string) ? { agentType } : {}),
      });
      if (task.missionId) {
        await syncMissionProgressDoc(task.missionId.toString());
      }

      broadcast({
        type: "task:updated",
        taskId: task._id.toString(),
        fields: {
          status: "assigned",
          assignedAt,
          delayUntil: null,
          delayReason: null,
          ...(effectiveModel && effectiveModel !== task.model ? { model: effectiveModel } : {}),
          ...(agentType !== ((task as Record<string, unknown>).agentType as string) ? { agentType } : {}),
        },
      });

      try {
        if (agentType === "inventor") {
          await dispatchInventorBeeTask(task);
        } else {
          await agentManager.spawnAgent(
            task._id.toString(),
            task.description,
            task.projectPath,
            task.maxBudgetUsd,
            task.project,
            task.workflow,
            task.resumeSessionId ?? undefined,
            effectiveModel,
            task.profile ?? undefined,
            (task as Record<string, unknown>).workflowStepIndex as number | undefined,
            (task as Record<string, unknown>).worktreeName as string | null | undefined,
            agentType,
            (task as Record<string, unknown>).thinkingMode as string | undefined,
            (task as Record<string, unknown>).fastMode === true,
          );
        }
      } catch (spawnErr) {
        const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
        const isAuth = msg.includes("Auth failed");
        const delayMinutes = isAuth ? 2 : 1;
        const delayUntil = new Date(Date.now() + delayMinutes * 60_000).toISOString();
        await Task.findByIdAndUpdate(task._id.toString(), {
          status: "backlog",
          agentPid: null,
          startedAt: null,
          error: msg,
          delayUntil,
          delayReason: "transient_retry",
        });
        broadcast({
          type: "task:updated",
          taskId: task._id.toString(),
          fields: { status: "backlog", error: msg, delayUntil, delayReason: "transient_retry" },
        });
        console.error(`[scheduler] Spawn failed for task ${task._id}: ${msg} — requeued with ${delayMinutes}m delay`);
        if (isAuth) break;
      }

      if (task.resumeSessionId) {
        await Task.findByIdAndUpdate(task._id, { resumeSessionId: null });
      }

      claimed++;
      currentSlots = agentManager.getSlots();

      // Wait for spawn gate (OAuth handshake) before claiming next
      if (!agentManager.isSpawnGateReady()) break;
    }

    if (claimed === 0) {
      const rateLimited = rateLimitedTasks > 0;
      updateDiagnostics({
        state: backlogCount > 0 ? "blocked" : "idle",
        blockReason: rateLimited ? "rate_limited" : backlogCount > 0 ? "no_backlog" : "none",
        blockDetail: rateLimited
          ? `Delayed ${rateLimitedTasks} task${rateLimitedTasks === 1 ? "" : "s"} until ${lastRateLimitReset}`
          : backlogCount > 0 ? `${backlogCount} backlog (${delayedCount} delayed)` : undefined,
        slots: currentSlots,
        spawnGateReady: true,
        usage: { blocked: rateLimited, resetsAt: lastRateLimitReset, activeProfile: getActiveProfile() },
        backlogCount,
        delayedTaskCount: Math.max(0, delayedCount - clearedStaleDelays) + rateLimitedTasks,
        consecutiveErrors,
      });
      return;
    }

    // Update diagnostics after successful spawn(s)
    const updatedSlots = agentManager.getSlots();
    updateDiagnostics({
      state: "running",
      blockReason: "none",
      blockDetail: undefined,
      slots: updatedSlots,
      spawnGateReady: agentManager.isSpawnGateReady(),
      usage: { blocked: false, activeProfile: getActiveProfile() },
      backlogCount: Math.max(0, backlogCount - claimed),
      delayedTaskCount: delayedCount,
      consecutiveErrors,
    });
  } catch (err) {
    consecutiveErrors++;
    // Only log every 10th error to avoid spam
    if (consecutiveErrors <= 1 || consecutiveErrors % 10 === 0) {
      console.error(
        `[scheduler] tick error (${consecutiveErrors}x):`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

export function startScheduler() {
  if (schedulerInterval) return;
  console.log(`[scheduler] Starting (interval: ${SCHEDULER_INTERVAL_MS}ms)`);

  // Use dynamic interval that backs off on repeated errors
  const scheduleTick = () => {
    const delay =
      consecutiveErrors > 0
        ? Math.min(SCHEDULER_INTERVAL_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS)
        : SCHEDULER_INTERVAL_MS;
    schedulerInterval = setTimeout(() => {
      tick().finally(scheduleTick);
    }, delay);
  };

  tick().finally(scheduleTick);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearTimeout(schedulerInterval);
    schedulerInterval = null;
    console.log("[scheduler] Stopped");
  }
}
