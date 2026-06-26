/**
 * Voice command executor for the push-to-talk turn — the IO glue that turns a
 * detected command intent into real daemon actions and a spoken reply.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import {
  detectCommandIntent,
  boardReply, approvalsReply, resolvedReply, noApprovalToResolveReply,
  directivesReply, createdTaskReply, connectivityReply, setConnectivityReply,
  type CommandIntent,
} from "./command-intent";
import {
  RollingCommandContextStore,
  rememberApprovalList,
  rememberLastTask,
  rememberTurn,
  resolveApprovalReference,
  type ContextApproval,
} from "./command-context";
import { buildVoiceBriefing, usageReply, type BriefingUsage, type BriefingBrowserReadiness, type BriefingWorkflowInbox } from "./briefing";
import { synthesizeSpeech } from "./tts";
import { buildVoiceBrowserLaneTask } from "./browser-lane-intent";
import { buildVoiceMailDeleteTask } from "./mail-delete-intent";
import type { ApprovalQueueItem } from "@/lib/approvals/queue";
import type { DirectiveRow } from "@/lib/orchestrator/directive-store";

interface VoiceTaskRef { _id: string; title: string }
interface VoiceDirectiveRef { _id?: string; goal: string; status: string }

export interface CommandTurnOverride {
  reply: string;
  audioBase64: string;
  command: { kind: CommandIntent["kind"]; detail?: string; taskId?: string };
}

export interface CommandTurnDeps {
  sessionId?: string;
  synthesize?: (text: string) => Promise<string>;
  buildApprovalQueue?: () => Promise<ApprovalQueueItem[]> | ApprovalQueueItem[];
  resolveApproval?: (taskId: string, timestamp: string, decision: "approve" | "done" | "denied", via: string) => Promise<void>;
  listDirectives?: () => Promise<VoiceDirectiveRef[]> | VoiceDirectiveRef[];
  updateDirective?: (id: string, fields: Record<string, unknown>) => Promise<void> | void;
  createTask?: (payload: Record<string, unknown>) => Promise<VoiceTaskRef>;
  listFailedTasks?: () => Promise<VoiceTaskRef[]> | VoiceTaskRef[];
  retryTask?: (id: string) => Promise<void> | void;
  updateTaskModel?: (id: string, model: string) => Promise<{ title: string } | null>;
  getUsage?: () => Promise<BriefingUsage | null>;
  getMetrics?: () => Promise<Record<string, unknown>>;
  getBrowserReadiness?: () => Promise<BriefingBrowserReadiness | null> | BriefingBrowserReadiness | null;
  getWorkflowInbox?: () => Promise<BriefingWorkflowInbox | null> | BriefingWorkflowInbox | null;
}

const contextStore = new RollingCommandContextStore();

/**
 * Gather the operator standup and render it to one spoken/notifiable string.
 * Shared by the "good morning" voice command and the scheduled morning push so
 * both read the same data and phrasing.
 */
export async function composeBriefing(deps: CommandTurnDeps = {}): Promise<string> {
  const [approvals, directives, failedTasks, usage, browserReadiness, workflowInbox] = await Promise.all([
    approvalQueue(deps),
    listDirectives(deps),
    listFailedTasks(deps),
    getUsage(deps),
    getBrowserReadiness(deps),
    getWorkflowInboxCounts(deps),
  ]);
  return buildVoiceBriefing({
    approvals: approvals.map((item) => ({ title: item.title, kind: item.kind })),
    failedTasks: failedTasks.map((task) => ({ title: task.title })),
    directives: directives.map((d) => ({ goal: d.goal, status: d.status })),
    usage,
    browserReadiness,
    workflowInbox,
  });
}

/**
 * Workflow Inbox counts for the briefing — read-only over the run/action ledger.
 * Counts only (reviews / ready / blocked / attention); never executes, never leaks
 * artifact content. Degrades to null if the inbox is unavailable.
 */
async function getWorkflowInboxCounts(deps: CommandTurnDeps): Promise<BriefingWorkflowInbox | null> {
  if (deps.getWorkflowInbox) return deps.getWorkflowInbox();
  try {
    const { getWorkflowInbox } = await import("@/lib/workflows/inbox");
    const c = getWorkflowInbox().counts;
    return {
      needsReview: c.needs_review + c.changes_requested,
      ready: c.proposed_actions_ready,
      blocked: c.proposed_actions_blocked,
      attention: c.failed_or_attention,
    };
  } catch {
    return null;
  }
}

/**
 * Browser Lane readiness for the briefing — counts the sites needing attention
 * (red + orange + gray/unknown) and surfaces the top few. Metadata only.
 */
async function getBrowserReadiness(deps: CommandTurnDeps): Promise<BriefingBrowserReadiness | null> {
  if (deps.getBrowserReadiness) return deps.getBrowserReadiness();
  try {
    const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
    const { getBrowserLaneReadinessDashboard } = await import("@/lib/browser-lane/store");
    const config = getBrowserLaneReadinessConfig();
    const dash = getBrowserLaneReadinessDashboard({ staleAfterHours: config.staleAfterHours });
    const attention = dash.sites.filter((s) => ["red", "orange", "gray"].includes(s.readiness.color));
    return {
      needsAttention: attention.length,
      byColor: dash.totals.byColor,
      staleCount: dash.totals.stale,
      lastSweepAt: config.lastRunAt ?? null,
      topSites: attention.slice(0, 3).map((s) => ({
        name: s.displayName,
        color: s.readiness.color,
        status: s.readiness.status,
        siteId: s.id,
        traceRunId: s.readiness.traceRunId,
      })),
    };
  } catch {
    return null; // briefing degrades gracefully if the dashboard is unavailable
  }
}

/** Resolve a detected command to a spoken answer, performing any action. */
export async function commandTurnOverride(transcript: string, deps: CommandTurnDeps = {}): Promise<CommandTurnOverride | null> {
  const intent = detectCommandIntent(transcript || "");
  if (intent.kind === "none") return null;

  let result: { reply: string; taskId?: string; detail?: string } | null = null;
  const sessionId = deps.sessionId ?? "default";
  try {
    result = await runCommand(intent, deps, sessionId);
  } catch (e) {
    console.error(`[voice-cmd] ${intent.kind} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (result == null) return null;

  contextStore.update(sessionId, (ctx) => rememberTurn(ctx, { kind: intent.kind, text: transcript }));

  let audioBase64 = "";
  try {
    const path = deps.synthesize ? await deps.synthesize(result.reply) : (await synthesizeSpeech(result.reply)).path;
    audioBase64 = path ? readFileSync(path).toString("base64") : "";
  } catch { /* speak-less fallback: the client shows the text reply */ }

  return { reply: result.reply, audioBase64, command: { kind: intent.kind, detail: result.detail, taskId: result.taskId } };
}

async function runCommand(intent: CommandIntent, deps: CommandTurnDeps, sessionId: string): Promise<{ reply: string; taskId?: string; detail?: string } | null> {
  const r = (reply: string, taskId?: string, detail?: string) => ({ reply, taskId, detail });
  switch (intent.kind) {
    case "board": {
      const { Task } = await import("@/lib/db");
      return r(boardReply(Task.countByStatus()));
    }
    case "approvalsList": {
      const items = await approvalQueue(deps);
      contextStore.update(sessionId, (ctx) => rememberApprovalList(ctx, toContextApprovals(items)));
      return r(approvalsReply(items.map((i) => ({ title: i.title, kind: i.kind }))));
    }
    case "approve":
    case "deny": {
      const items = await approvalQueue(deps);
      const resolution = resolveApprovalReference(intent, contextStore.get(sessionId), toContextApprovals(items));
      if (resolution.status === "none") return r(noApprovalToResolveReply());
      if (resolution.status === "ambiguous") return r(disambiguationReply(resolution.choices));
      const decision = intent.kind === "approve" ? "approve" : "denied";
      await resolveApproval(deps, resolution.item.taskId, resolution.item.timestamp, decision);
      return r(resolvedReply(intent.kind === "approve" ? "approve" : "deny", resolution.item.title));
    }
    case "directives": {
      const directives = await listDirectives(deps);
      return r(directivesReply(directives.map((d) => ({ goal: d.goal, status: d.status }))));
    }
    case "briefing": {
      return r(await composeBriefing(deps));
    }
    case "usage": {
      return r(usageReply(await getUsage(deps)));
    }
    case "analytics": {
      const metrics = await getMetrics(deps);
      const tasks = metrics.tasksByStatus as Record<string, number> | undefined;
      const dirs = metrics.directivesByStatus as Record<string, number> | undefined;
      const runs = metrics.runs as { failed?: number; done?: number; total?: number } | undefined;
      return r(`Analytics: ${tasks?.backlog ?? 0} queued tasks, ${tasks?.failed ?? 0} failed, ${dirs?.active ?? 0} active directives, ${runs?.failed ?? 0} failed runs.`);
    }
    case "retryFailedTask": {
      const [task] = await listFailedTasks(deps);
      if (!task) return r("No failed tasks to retry.");
      await retryTask(deps, task._id);
      return r(`Retrying ${task.title}.`, task._id);
    }
    case "setTaskModel": {
      if (!intent.taskRef || !intent.model) return r("Tell me the task and model to use.");
      const task = await updateTaskModel(deps, intent.taskRef, intent.model);
      if (!task) return r(`I couldn't find task ${intent.taskRef}.`);
      return r(`Set ${task.title} to ${intent.model}.`, intent.taskRef);
    }
    case "startDirective":
    case "pauseDirective": {
      const directive = findDirective(await listDirectives(deps), intent.directiveText ?? "");
      if (!directive?._id) return r(`I couldn't find directive ${intent.directiveText ?? ""}.`);
      const status = intent.kind === "startDirective" ? "active" : "sleeping";
      await updateDirective(deps, directive._id, { status });
      return r(`${intent.kind === "startDirective" ? "Started" : "Paused"} directive: ${directive.goal}.`);
    }
    case "triggerReleaseVerification": {
      const task = await createTask(deps, {
        title: "Release verification",
        description: "Run HiveMatrix release verification and report whether autoupdate is ready.\n\nCommand: npm run release:verify",
        project: "hivematrix",
        projectPath: process.cwd(),
        status: "backlog",
        executor: "agent",
        source: "voice",
      });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r("I queued release verification.", task._id);
    }
    case "browserLaneTask": {
      if (!intent.browserLane) return null;
      const payload = buildVoiceBrowserLaneTask(intent.browserLane, { titlePrefix: "Voice" });
      const task = await createTask(deps, { ...payload });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r(`I queued Browser Lane ${intent.browserLane.mode}.`, task._id);
    }
    case "mailDeleteTask": {
      if (!intent.mailDelete) return null;
      const payload = buildVoiceMailDeleteTask(intent.mailDelete);
      const task = await createTask(deps, { ...payload });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r(`I queued a Mail Lane deletion review for ${intent.mailDelete.query}. No email has been deleted.`, task._id);
    }
    case "createTask": {
      const text = (intent.taskText || "").trim();
      if (!text) return null;
      const { DEFAULT_TASK_PROJECT } = await import("@/lib/routing/project-constants");
      const title = text.length > 60 ? text.slice(0, 57).trimEnd() + "…" : text;
      const task = await createTask(deps, {
        title,
        description: text,
        project: DEFAULT_TASK_PROJECT,
        projectPath: homedir(),
        status: "backlog",
        executor: "agent",
        source: "voice",
      });
      contextStore.update(sessionId, (ctx) => rememberLastTask(ctx, task._id));
      return r(createdTaskReply(title), task._id);
    }
    case "connectivity": {
      const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
      return r(connectivityReply(getConnectivityPolicy().mode));
    }
    case "setConnectivity": {
      const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
      const mode = intent.mode ?? "auto";
      getConnectivityPolicy().setManualOverride(mode === "auto" ? null : mode, "voice command");
      return r(setConnectivityReply(mode));
    }
    default:
      return null;
  }
}

async function approvalQueue(deps: CommandTurnDeps): Promise<ApprovalQueueItem[]> {
  if (deps.buildApprovalQueue) return await deps.buildApprovalQueue();
  const { buildApprovalQueue } = await import("@/lib/approvals/queue");
  return buildApprovalQueue();
}

function toContextApprovals(items: ApprovalQueueItem[]): ContextApproval[] {
  return items.map((item) => ({
    kind: item.kind,
    taskId: item.taskId,
    timestamp: item.timestamp,
    title: item.title,
  }));
}

async function resolveApproval(deps: CommandTurnDeps, taskId: string, timestamp: string, decision: "approve" | "denied"): Promise<void> {
  if (deps.resolveApproval) return deps.resolveApproval(taskId, timestamp, decision, "voice");
  const { resolveApproval } = await import("@/lib/orchestrator/approval");
  await resolveApproval(taskId, timestamp, decision, "voice");
}

async function listDirectives(deps: CommandTurnDeps): Promise<VoiceDirectiveRef[]> {
  if (deps.listDirectives) return await deps.listDirectives();
  const { listDirectives } = await import("@/lib/orchestrator/directive-store");
  return listDirectives();
}

async function updateDirective(deps: CommandTurnDeps, id: string, fields: Record<string, unknown>): Promise<void> {
  if (deps.updateDirective) return void await deps.updateDirective(id, fields);
  const { updateDirective } = await import("@/lib/orchestrator/directive-store");
  updateDirective(id, fields as Partial<DirectiveRow>);
}

async function createTask(deps: CommandTurnDeps, payload: Record<string, unknown>): Promise<VoiceTaskRef> {
  if (deps.createTask) return deps.createTask(payload);
  const { Task, generateId } = await import("@/lib/db");
  const task = await Task.create({ _id: generateId(), ...payload });
  return { _id: task._id, title: task.title };
}

async function listFailedTasks(deps: CommandTurnDeps): Promise<VoiceTaskRef[]> {
  if (deps.listFailedTasks) return await deps.listFailedTasks();
  const { Task } = await import("@/lib/db");
  return (await Task.find({ status: "failed" }).sort({ updatedAt: -1 }).limit(5)).map((t) => ({ _id: t._id, title: t.title }));
}

async function retryTask(deps: CommandTurnDeps, id: string): Promise<void> {
  if (deps.retryTask) return void await deps.retryTask(id);
  const { Task } = await import("@/lib/db");
  await Task.findByIdAndUpdate(id, { status: "backlog", error: null, agentPid: null, startedAt: null, completedAt: null, reviewState: null });
}

async function updateTaskModel(deps: CommandTurnDeps, id: string, model: string): Promise<{ title: string } | null> {
  if (deps.updateTaskModel) return deps.updateTaskModel(id, model);
  const { Task } = await import("@/lib/db");
  return Task.findByIdAndUpdate(id, { model });
}

async function getUsage(deps: CommandTurnDeps): Promise<BriefingUsage | null> {
  if (deps.getUsage) return deps.getUsage();
  const { getFrontierUsage } = await import("@/lib/usage/frontier-usage");
  const usage = await getFrontierUsage();
  const sub = usage.subscription;
  const window = sub?.fiveHour ?? sub?.sevenDay ?? sub?.sevenDayOpus ?? sub?.sevenDaySonnet ?? null;
  const subscriptionPercentRemaining = typeof window?.remaining === "number" ? window.remaining : null;
  return {
    totalCost: usage.totalCost,
    todayCost: usage.todayCost,
    taskCount: usage.taskCount,
    todayTaskCount: usage.todayTaskCount,
    subscriptionPercentRemaining,
  };
}

async function getMetrics(deps: CommandTurnDeps): Promise<Record<string, unknown>> {
  if (deps.getMetrics) return deps.getMetrics();
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const taskRows = db.prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status").all() as Array<{ status: string; n: number }>;
  const dirRows = db.prepare("SELECT status, COUNT(*) as n FROM directives GROUP BY status").all() as Array<{ status: string; n: number }>;
  const toMap = (rows: Array<{ status: string; n: number }>) => Object.fromEntries(rows.map((row) => [row.status, row.n]));
  const runs = db.prepare("SELECT phase, COUNT(*) as n FROM runs GROUP BY phase").all() as Array<{ phase: string; n: number }>;
  return {
    tasksByStatus: toMap(taskRows),
    directivesByStatus: toMap(dirRows),
    runs: {
      failed: runs.find((row) => row.phase === "failed")?.n ?? 0,
      done: runs.find((row) => row.phase === "done")?.n ?? 0,
      total: runs.reduce((sum, row) => sum + row.n, 0),
    },
  };
}

function findDirective(
  directives: VoiceDirectiveRef[],
  query: string,
): VoiceDirectiveRef | null {
  const q = query.toLowerCase().trim();
  return directives.find((d) => d.goal.toLowerCase().includes(q)) ?? null;
}

function disambiguationReply(choices: ContextApproval[]): string {
  const visible = choices.slice(0, 3).map((item, index) => `${index + 1}: ${item.title}`).join("; ");
  return `Which approval should I resolve? Say first, second, or third. ${visible}.`;
}
